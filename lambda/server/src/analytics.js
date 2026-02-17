import { query } from './licensing/db.js'

// ── Schema migration (idempotent) ──────────────────────────────────
export async function ensureDealsSchema() {
  await query(`
    CREATE TABLE IF NOT EXISTS recorded_deals (
      id                            SERIAL PRIMARY KEY,
      segment                       VARCHAR(50) NOT NULL,
      industry                      VARCHAR(100) NOT NULL,
      product_category              VARCHAR(50) NOT NULL,
      deal_reg_type                 VARCHAR(30) NOT NULL,
      competitors                   VARCHAR(5) NOT NULL,
      value_add                     VARCHAR(10) NOT NULL,
      relationship_strength         VARCHAR(20) NOT NULL,
      customer_tech_sophistication  VARCHAR(10) NOT NULL,
      solution_complexity           VARCHAR(10) NOT NULL,
      var_strategic_importance      VARCHAR(10) NOT NULL,
      customer_price_sensitivity    SMALLINT,
      customer_loyalty              SMALLINT,
      deal_urgency                  SMALLINT,
      is_new_logo                   BOOLEAN,
      solution_differentiation      SMALLINT,
      oem_cost                      NUMERIC(12,2) NOT NULL,
      oem                           VARCHAR(100),
      services_attached             BOOLEAN,
      quarter_end                   BOOLEAN,
      competitor_names              JSONB,
      bom_line_count                INTEGER DEFAULT 0,
      bom_avg_margin_pct            NUMERIC(10,4),
      has_manual_bom                BOOLEAN DEFAULT false,
      achieved_margin               NUMERIC(10,4) NOT NULL,
      status                        VARCHAR(10) NOT NULL,
      loss_reason                   VARCHAR(255) DEFAULT '',
      bom_lines                     JSONB,
      created_at                    TIMESTAMPTZ DEFAULT NOW()
    )
  `)
  await query(`CREATE INDEX IF NOT EXISTS idx_recorded_deals_created_at ON recorded_deals(created_at)`)
  await query(`CREATE INDEX IF NOT EXISTS idx_recorded_deals_status ON recorded_deals(status)`)
  // Per-org tenant isolation: add org_id column to existing table (safe for production data)
  await query(`ALTER TABLE recorded_deals ADD COLUMN IF NOT EXISTS org_id TEXT DEFAULT 'global'`)
  await query(`CREATE INDEX IF NOT EXISTS idx_recorded_deals_org_id ON recorded_deals(org_id)`)
  console.log('Deals schema ensured')
}

// ── Insert a recorded deal ─────────────────────────────────────────
export async function insertRecordedDeal(deal, orgId) {
  const result = await query(
    `INSERT INTO recorded_deals (
      segment, industry, product_category, deal_reg_type, competitors,
      value_add, relationship_strength, customer_tech_sophistication,
      solution_complexity, var_strategic_importance,
      customer_price_sensitivity, customer_loyalty, deal_urgency,
      is_new_logo, solution_differentiation, oem_cost,
      oem, services_attached, quarter_end, competitor_names,
      bom_line_count, bom_avg_margin_pct, has_manual_bom,
      achieved_margin, status, loss_reason, bom_lines, org_id
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28
    ) RETURNING id`,
    [
      deal.segment,
      deal.customerIndustry || deal.industry,
      deal.productCategory,
      deal.dealRegType,
      deal.competitors,
      deal.valueAdd,
      deal.relationshipStrength,
      deal.customerTechSophistication,
      deal.solutionComplexity,
      deal.varStrategicImportance,
      deal.customerPriceSensitivity ?? null,
      deal.customerLoyalty ?? null,
      deal.dealUrgency ?? null,
      deal.isNewLogo ?? null,
      deal.solutionDifferentiation ?? null,
      deal.oemCost,
      deal.oem || null,
      deal.servicesAttached ?? null,
      deal.quarterEnd ?? null,
      deal.competitorNames ? JSON.stringify(deal.competitorNames) : null,
      deal.bomLineCount || 0,
      deal.bomAvgMarginPct ?? null,
      deal.hasManualBom || false,
      deal.achievedMargin,
      deal.status,
      deal.lossReason || '',
      deal.bomLines ? JSON.stringify(deal.bomLines) : null,
      orgId || 'global'
    ]
  )
  return result.rows[0].id
}

// ── Per-org cached read ─────────────────────────────────────────────
const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes
const dealsCache = new Map() // keyed by orgId (or 'global' for unfiltered)

function rowToDeal(row) {
  return {
    segment: row.segment,
    industry: row.industry,
    customerIndustry: row.industry,
    productCategory: row.product_category,
    dealRegType: row.deal_reg_type,
    competitors: row.competitors,
    valueAdd: row.value_add,
    relationshipStrength: row.relationship_strength,
    customerTechSophistication: row.customer_tech_sophistication,
    solutionComplexity: row.solution_complexity,
    varStrategicImportance: row.var_strategic_importance,
    customerPriceSensitivity: row.customer_price_sensitivity,
    customerLoyalty: row.customer_loyalty,
    dealUrgency: row.deal_urgency,
    isNewLogo: row.is_new_logo,
    solutionDifferentiation: row.solution_differentiation,
    oemCost: parseFloat(row.oem_cost),
    oem: row.oem,
    servicesAttached: row.services_attached,
    quarterEnd: row.quarter_end,
    competitorNames: row.competitor_names,
    bomLineCount: row.bom_line_count,
    bomAvgMarginPct: row.bom_avg_margin_pct != null ? parseFloat(row.bom_avg_margin_pct) : null,
    hasManualBom: row.has_manual_bom,
    achievedMargin: parseFloat(row.achieved_margin),
    status: row.status,
    lossReason: row.loss_reason || '',
    bomLines: row.bom_lines
  }
}

/**
 * Get recorded deals, optionally filtered by orgId.
 * If orgId is provided, only that org's deals are returned.
 * If orgId is omitted/null, all deals are returned (admin/analytics use).
 */
export async function getRecordedDeals(orgId) {
  const cacheKey = orgId || 'global'
  const now = Date.now()
  const cached = dealsCache.get(cacheKey)
  if (cached && (now - cached.timestamp) < CACHE_TTL_MS) {
    return cached.deals
  }
  try {
    let result
    if (orgId) {
      result = await query('SELECT * FROM recorded_deals WHERE org_id = $1 ORDER BY created_at', [orgId])
    } else {
      result = await query('SELECT * FROM recorded_deals ORDER BY created_at')
    }
    const deals = result.rows.map(rowToDeal)
    dealsCache.set(cacheKey, { deals, timestamp: Date.now() })
    return deals
  } catch (err) {
    console.error('Failed to load recorded deals from DB:', err.message)
    return cached?.deals || []
  }
}

/**
 * Invalidate the deals cache.
 * If orgId is provided, invalidates only that org's cache entry (plus the global entry).
 * If orgId is omitted, clears the entire cache.
 */
export function invalidateDealsCache(orgId) {
  if (orgId) {
    dealsCache.delete(orgId)
    dealsCache.delete('global') // global aggregate is also stale
  } else {
    dealsCache.clear()
  }
}

// ── Combined deal pool ─────────────────────────────────────────────
/**
 * Get all deals (sample + recorded), optionally filtered by orgId.
 * When orgId is provided, only that org's recorded deals are included
 * alongside the shared sample data — preventing cross-customer data leakage.
 */
export async function getAllDeals(sampleDeals, orgId) {
  try {
    const recorded = await getRecordedDeals(orgId)
    return sampleDeals.concat(recorded)
  } catch (err) {
    console.error('Failed to get all deals:', err.message)
    return sampleDeals
  }
}
