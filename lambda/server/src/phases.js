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
// Factor label lookups (score/max ratio → human-readable sentence)
// ---------------------------------------------------------------------------

const FACTOR_LABELS = {
  marginAlignment: (ratio) => {
    if (ratio < 0.33) return 'Your margin is significantly below market for this deal profile'
    if (ratio <= 0.66) return 'Your margin is in the right range but could be optimized'
    return 'Your margin is well-aligned with market benchmarks'
  },
  winProbability: (ratio) => {
    if (ratio < 0.33) return 'Win probability is low — competitive pressure or pricing risk'
    if (ratio <= 0.66) return 'Moderate win probability — deal structure is reasonable'
    return 'Strong win probability — deal is well-positioned'
  },
  dataQuality: (ratio) => {
    if (ratio < 0.33) return 'Missing deal data is reducing scoring accuracy — fill in more fields'
    if (ratio <= 0.66) return 'Good data coverage — a few more fields would improve accuracy'
    return 'Excellent data quality — scoring is highly confident'
  },
  algorithmConfidence: (ratio) => {
    if (ratio < 0.33) return 'Limited comparable deals — recommendation based on general benchmarks'
    if (ratio <= 0.66) return 'Some comparable deals found — recommendation is moderately confident'
    return 'Many comparable deals — recommendation is highly confident'
  }
}

// ---------------------------------------------------------------------------
// Driver name → plain-English sentence mapping (deterministic lookup)
// ---------------------------------------------------------------------------

const DRIVER_SENTENCES = {
  // Segment bases
  'SMB base': 'SMB segment pricing supports higher base margins',
  'Mid-market base': 'Mid-market segment provides a moderate margin baseline',
  'Enterprise base': 'Enterprise segment typically has compressed base margins',
  // Deal registration
  'Premium/Hunting registration': 'Deal registration (Premium Hunting) is protecting your margin',
  'Standard/Teaming registration': 'Deal registration (Standard/Teaming) provides some margin protection',
  'No registration benefit': 'No deal registration — registering could improve your margin position',
  // Competition
  'No competitors': 'No direct competition allows stronger margin positioning',
  '1 competitor': 'Single competitor — balanced competitive pressure',
  '2 competitors': '2 competitors are pressuring price — consider differentiation',
  '3+ competitors': '3+ competitors creating significant price pressure',
  // Value-add
  'High VAR value-add': 'High value-add justifies premium margin',
  'Medium VAR value-add': 'Medium value-add supports moderate margin',
  // Relationship
  'Strategic relationship': 'Strategic relationship supports margin confidence',
  'Good relationship': 'Good relationship provides moderate margin support',
  // Price sensitivity
  'High price sensitivity': 'Customer is price-sensitive — margin pressure expected',
  'Low price sensitivity': 'Low price sensitivity supports higher margins',
  // Customer loyalty
  'High customer loyalty': 'High customer loyalty reduces competitive risk',
  'Low customer loyalty': 'Low customer loyalty increases switching risk',
  // Product category
  'Services category': 'Services category typically supports higher margins',
  'Software/Cloud': 'Software/Cloud category supports moderate margin uplift',
  'Complex solution': 'Complex solution mix supports margin premium',
  // Solution complexity
  'High complexity': 'High solution complexity justifies margin premium',
  'Low complexity': 'Low complexity limits margin justification',
  // Strategic importance
  'High strategic importance (accept lower)': 'Strategic importance suggests accepting lower margin for long-term value',
  // Deal urgency
  'High deal urgency': 'High deal urgency supports stronger pricing',
  'Low deal urgency': 'Low deal urgency — buyer has time to shop alternatives',
  // New logo
  'New logo deal': 'New logo deal — margin concession to acquire the account',
  // Differentiation
  'Strong solution differentiation': 'Strong differentiation supports premium pricing',
  'Weak solution differentiation': 'Weak differentiation limits pricing power',
  // Tech sophistication
  'High tech sophistication': 'Tech-savvy buyer may push back on pricing',
  'Low tech sophistication': 'Lower tech sophistication reduces price scrutiny',
  // Deal size
  'XL deal size': 'Extra-large deal size compresses margin expectations',
  'Large deal size': 'Large deal size creates some margin compression',
  'Small deal premium': 'Small deal size supports higher margin rates',
  'Mega deal compression': 'Mega deal compression reduces achievable margin',
  // Services
  'Services attached': 'Services attached typically support higher blended margins',
  'Services uplift on hardware': 'Services on hardware/complex deals boost blended margin',
  // Timing
  'Quarter-end timing': 'Quarter-end timing may provide additional vendor incentives',
  // Displacement
  'Displacement deal': 'Displacement deal requires more aggressive pricing',
}

/**
 * Convert a list of drivers [{name, val}] into top 3 plain-English sentences.
 * Sorts by absolute impact and uses deterministic lookup.
 */
export function generateTopDrivers(drivers) {
  if (!Array.isArray(drivers) || drivers.length === 0) return []

  return drivers
    .slice() // don't mutate original
    .sort((a, b) => Math.abs(b.val) - Math.abs(a.val))
    .slice(0, 3)
    .map(d => DRIVER_SENTENCES[d.name] || `${d.name} is influencing the recommendation`)
}

/**
 * Generate Phase 1 directional guidance from drivers and deal context.
 * Returns 2-3 tips when suggestedMarginPct is null (Phase 1).
 */
export function generatePhase1Guidance(drivers, input) {
  if (!Array.isArray(drivers) || drivers.length === 0) return []

  const sorted = drivers.slice().sort((a, b) => Math.abs(b.val) - Math.abs(a.val))
  const guidance = []

  // Top positive drivers → "Deal strengths: ..."
  const positives = sorted.filter(d => d.val > 0)
  if (positives.length > 0) {
    guidance.push(`Deal strengths: ${positives[0].name}`)
  }

  // Top negative drivers → "Watch out for: ..."
  const negatives = sorted.filter(d => d.val < 0)
  if (negatives.length > 0) {
    guidance.push(`Watch out for: ${negatives[0].name}`)
  }

  // Contextual tips
  if (input?.dealRegType === 'NotRegistered') {
    guidance.push('Registering this deal could improve your margin position')
  }

  const competitorCount = input?.competitors === '3+' ? 4 : parseInt(input?.competitors || '0', 10)
  if (competitorCount >= 3) {
    guidance.push('With multiple competitors, focus on value differentiation')
  }

  return guidance.slice(0, 3)
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

  const factors = {
    marginAlignment: { score: Math.round(clamp(alignmentScore, 0, 40)), max: 40 },
    winProbability: { score: Math.round(clamp(winScore, 0, 25)), max: 25 },
    dataQuality: { score: Math.round(clamp(dqScore, 0, 20)), max: 20 },
    algorithmConfidence: { score: Math.round(clamp(confScore, 0, 15)), max: 15 }
  }

  // Add human-readable labels and direction to each factor
  for (const [key, factor] of Object.entries(factors)) {
    const ratio = factor.max > 0 ? factor.score / factor.max : 0
    factor.label = FACTOR_LABELS[key](ratio)
    factor.direction = ratio >= 0.5 ? 'positive' : 'negative'
  }

  return {
    dealScore: clamp(total, 0, 100),
    scoreFactors: factors
  }
}

function clamp(x, a, b) { return Math.max(a, Math.min(b, x)) }
