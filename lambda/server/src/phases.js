import { query } from './licensing/db.js'

// ---------------------------------------------------------------------------
// Schema migration — idempotent, safe to call on every cold start
// ---------------------------------------------------------------------------

export async function ensurePhaseSchema() {
  await query(`
    ALTER TABLE customer_config
    ADD COLUMN IF NOT EXISTS algorithm_phase INTEGER DEFAULT 1
  `)
  console.log('Phase schema ensured (algorithm_phase column)')
}

// ---------------------------------------------------------------------------
// Phase CRUD
// ---------------------------------------------------------------------------

/**
 * Get the current algorithm phase for a customer, identified by their
 * Salesforce org_id. Resolves org_id → customer_id via the licenses table.
 * Returns 1 (default) if no config row or no matching license exists.
 */
export async function getCustomerPhase(orgId) {
  if (!orgId) return 1

  const result = await query(
    `SELECT cc.algorithm_phase
     FROM customer_config cc
     JOIN licenses l ON l.customer_id = cc.customer_id
     WHERE l.org_id = $1 AND l.status = 'active'
     LIMIT 1`,
    [orgId]
  )
  return result.rows.length > 0 ? (result.rows[0].algorithm_phase ?? 1) : 1
}

/**
 * Get the current algorithm phase by customer UUID (for admin API).
 */
export async function getCustomerPhaseById(customerId) {
  if (!customerId) return 1

  const result = await query(
    `SELECT algorithm_phase FROM customer_config WHERE customer_id = $1`,
    [customerId]
  )
  return result.rows.length > 0 ? (result.rows[0].algorithm_phase ?? 1) : 1
}

/**
 * Set the algorithm phase for a customer by UUID.
 * Upserts into customer_config if no row exists yet.
 */
export async function setCustomerPhase(customerId, phase) {
  if (![1, 2, 3].includes(phase)) {
    throw new Error(`Invalid phase: ${phase}. Must be 1, 2, or 3.`)
  }

  await query(
    `INSERT INTO customer_config (customer_id, algorithm_phase)
     VALUES ($1, $2)
     ON CONFLICT (customer_id) DO UPDATE SET algorithm_phase = $2`,
    [customerId, phase]
  )
}

// ---------------------------------------------------------------------------
// Phase readiness checks
// ---------------------------------------------------------------------------

/**
 * Check whether a customer meets the requirements for Phase 2 and Phase 3.
 * Uses the customer UUID to look up their org_id and count recorded deals.
 */
export async function checkPhaseReadiness(customerId) {
  const currentPhase = await getCustomerPhaseById(customerId)

  // Find the org_id(s) associated with this customer's active licenses
  const orgResult = await query(
    `SELECT org_id FROM licenses WHERE customer_id = $1 AND status = 'active' AND org_id IS NOT NULL`,
    [customerId]
  )
  const orgIds = orgResult.rows.map(r => r.org_id).filter(Boolean)

  // Count recorded deals and compute average data quality for this customer's org(s)
  let totalDeals = 0
  let dealsWithBom = 0
  let qualitySum = 0

  if (orgIds.length > 0) {
    // Build placeholders for org_id IN (...) filter
    const placeholders = orgIds.map((_, i) => `$${i + 1}`).join(', ')
    const orgFilter = `WHERE org_id IN (${placeholders})`

    const dealCountResult = await query(
      `SELECT COUNT(*) as total FROM recorded_deals ${orgFilter}`,
      orgIds
    )
    totalDeals = parseInt(dealCountResult.rows[0].total, 10)

    const bomCountResult = await query(
      `SELECT COUNT(*) as total FROM recorded_deals ${orgFilter} AND bom_line_count > 0`,
      orgIds
    )
    dealsWithBom = parseInt(bomCountResult.rows[0].total, 10)

    // Compute average data quality score from this customer's recorded deals.
    // A deal is considered "high quality" if it has most optional fields filled.
    // We approximate quality by counting non-null optional fields per deal.
    const qualityResult = await query(`
      SELECT AVG(
        CASE WHEN oem IS NOT NULL AND oem != '' THEN 10 ELSE 0 END +
        CASE WHEN customer_price_sensitivity IS NOT NULL THEN 8 ELSE 0 END +
        CASE WHEN deal_urgency IS NOT NULL THEN 8 ELSE 0 END +
        CASE WHEN customer_loyalty IS NOT NULL THEN 6 ELSE 0 END +
        CASE WHEN solution_differentiation IS NOT NULL THEN 6 ELSE 0 END +
        CASE WHEN is_new_logo IS NOT NULL THEN 4 ELSE 0 END +
        CASE WHEN services_attached IS NOT NULL THEN 4 ELSE 0 END +
        CASE WHEN quarter_end IS NOT NULL THEN 4 ELSE 0 END +
        CASE WHEN competitor_names IS NOT NULL THEN 6 ELSE 0 END +
        CASE WHEN bom_line_count > 0 THEN 10 ELSE 0 END +
        34
      ) as avg_quality
      FROM recorded_deals ${orgFilter}
    `, orgIds)
    qualitySum = qualityResult.rows[0].avg_quality
      ? parseFloat(qualityResult.rows[0].avg_quality)
      : 0
  }

  const avgDataQuality = totalDeals > 0 ? Math.round(qualitySum) : 0

  const phase2Ready = totalDeals >= 50 && avgDataQuality > 60
  const phase3Ready = currentPhase >= 2 && dealsWithBom >= 20

  return {
    currentPhase,
    phase2Ready,
    phase2Requirements: {
      recordedDeals: { current: totalDeals, required: 50, met: totalDeals >= 50 },
      avgDataQuality: { current: avgDataQuality, required: 60, met: avgDataQuality > 60 }
    },
    phase3Ready,
    phase3Requirements: {
      phase2Active: { current: currentPhase >= 2, required: true, met: currentPhase >= 2 },
      dealsWithBom: { current: dealsWithBom, required: 20, met: dealsWithBom >= 20 }
    }
  }
}

// ---------------------------------------------------------------------------
// Deal score computation (0–100)
// ---------------------------------------------------------------------------

/**
 * Compute a deal score (0–100) based on:
 *   - Margin alignment (0–40 pts): how close the rep's planned margin is to the recommendation
 *   - Win probability (0–25 pts): direct mapping of winProbability
 *   - Data quality / completeness (0–20 pts): from the prediction quality assessment
 *   - Algorithm confidence (0–15 pts): from the recommendation confidence value
 *
 * @param {object} params
 * @param {number|null} params.plannedMarginPct - The rep's planned margin % (e.g. 18.5)
 * @param {number} params.suggestedMarginPct - The algorithm's recommended margin %
 * @param {number} params.winProbability - Win probability (0–1)
 * @param {number} params.confidence - Algorithm confidence (0–1)
 * @param {object} params.predictionQuality - Output of assessPredictionQuality ({ score, grade, missingFields })
 */
export function computeDealScore({ plannedMarginPct, suggestedMarginPct, winProbability, confidence, predictionQuality }) {
  // ── 1. Margin alignment (0–40 pts) ──
  let alignmentScore = 0
  if (plannedMarginPct != null && suggestedMarginPct != null) {
    const diff = Math.abs(plannedMarginPct - suggestedMarginPct)
    // Perfect alignment (0% diff) = 40 pts, >10% diff = 0 pts
    alignmentScore = Math.max(0, 40 * (1 - diff / 10))
  } else {
    // No planned margin — give a neutral midpoint score
    alignmentScore = 20
  }

  // ── 2. Win probability (0–25 pts) ──
  const wp = typeof winProbability === 'number' ? winProbability : 0.5
  const winScore = wp * 25

  // ── 3. Data quality / completeness (0–20 pts) ──
  const dqScore = predictionQuality != null && typeof predictionQuality.score === 'number'
    ? (predictionQuality.score / 100) * 20
    : 10 // neutral default

  // ── 4. Algorithm confidence (0–15 pts) ──
  const conf = typeof confidence === 'number' ? confidence : 0.4
  const confScore = conf * 15

  const total = Math.round(
    clamp(alignmentScore, 0, 40) +
    clamp(winScore, 0, 25) +
    clamp(dqScore, 0, 20) +
    clamp(confScore, 0, 15)
  )

  return {
    dealScore: clamp(total, 0, 100),
    scoreFactors: {
      marginAlignment: { score: Math.round(clamp(alignmentScore, 0, 40)), max: 40 },
      winProbability: { score: Math.round(clamp(winScore, 0, 25)), max: 25 },
      dataQuality: { score: Math.round(clamp(dqScore, 0, 20)), max: 20 },
      algorithmConfidence: { score: Math.round(clamp(confScore, 0, 15)), max: 15 }
    }
  }
}

function clamp(x, a, b) { return Math.max(a, Math.min(b, x)) }
