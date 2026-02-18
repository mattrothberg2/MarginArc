import { describe, it, expect, jest, beforeEach } from '@jest/globals'

// ── Mock database ────────────────────────────────────────────────
jest.unstable_mockModule('../licensing/db.js', () => ({
  query: jest.fn(),
  getSSMParameter: jest.fn()
}))

// ── Mock phases ──────────────────────────────────────────────────
jest.unstable_mockModule('../phases.js', () => ({
  getCustomerPhaseById: jest.fn(),
  setCustomerPhase: jest.fn()
}))

// Dynamic imports after mocking
const { query } = await import('../licensing/db.js')
const { getCustomerPhaseById, setCustomerPhase } = await import('../phases.js')
const { trainCustomerModel, getModel, getModelByOrgId, ensureMLSchema } = await import('./train.js')

// ── Synthetic deal generator ─────────────────────────────────────

const SEGMENTS = ['SMB', 'MidMarket', 'Enterprise']
const DEAL_REGS = ['NotRegistered', 'StandardApproved', 'PremiumHunting']
const COMPLEXITIES = ['Low', 'Medium', 'High']
const RELATIONSHIPS = ['New', 'Good', 'Strategic']
const OEMS = ['Cisco', 'Dell', 'HPE', 'Microsoft', 'Palo Alto', 'CrowdStrike']
const CATEGORIES = ['Hardware', 'Software', 'Services']

function seededRandom(seed) {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) & 0x7fffffff
    return s / 0x7fffffff
  }
}

function pick(arr, rng) {
  return arr[Math.floor(rng() * arr.length)]
}

/**
 * Generate synthetic deal rows (snake_case, as DB would return).
 * Won deals tend to have lower margins and stronger deal structure,
 * creating a learnable signal for the logistic regression.
 */
function generateDealRows(wonCount, lostCount, seed = 42) {
  const rng = seededRandom(seed)
  const rows = []

  for (let i = 0; i < wonCount; i++) {
    const isStrong = rng() > 0.3 // Won deals more likely to have strong structure
    rows.push({
      segment: pick(SEGMENTS, rng),
      industry: 'Technology',
      product_category: pick(CATEGORIES, rng),
      deal_reg_type: isStrong ? pick(['StandardApproved', 'PremiumHunting'], rng) : pick(DEAL_REGS, rng),
      competitors: pick(['0', '1', '2'], rng),
      value_add: 'Medium',
      relationship_strength: isStrong ? pick(['Good', 'Strategic'], rng) : pick(RELATIONSHIPS, rng),
      customer_tech_sophistication: 'Medium',
      solution_complexity: pick(COMPLEXITIES, rng),
      var_strategic_importance: 'Medium',
      customer_price_sensitivity: Math.floor(rng() * 3) + 1, // 1-3 (lower)
      customer_loyalty: Math.floor(rng() * 3) + 3, // 3-5 (higher)
      deal_urgency: Math.floor(rng() * 5) + 1,
      is_new_logo: rng() > 0.7,
      solution_differentiation: Math.floor(rng() * 3) + 3, // 3-5 (higher)
      oem_cost: String(10000 + Math.floor(rng() * 490000)),
      oem: pick(OEMS, rng),
      services_attached: rng() > 0.4,
      quarter_end: rng() > 0.6,
      competitor_names: null,
      bom_line_count: Math.floor(rng() * 10),
      bom_avg_margin_pct: null,
      has_manual_bom: false,
      achieved_margin: String(0.08 + rng() * 0.12), // 8-20% (won = lower margins)
      status: 'Won',
      loss_reason: '',
      bom_lines: null,
      org_id: 'test_org'
    })
  }

  for (let i = 0; i < lostCount; i++) {
    const isWeak = rng() > 0.3 // Lost deals more likely to have weak structure
    rows.push({
      segment: pick(SEGMENTS, rng),
      industry: 'Technology',
      product_category: pick(CATEGORIES, rng),
      deal_reg_type: isWeak ? 'NotRegistered' : pick(DEAL_REGS, rng),
      competitors: pick(['1', '2', '3+'], rng),
      value_add: 'Low',
      relationship_strength: isWeak ? 'New' : pick(RELATIONSHIPS, rng),
      customer_tech_sophistication: 'High',
      solution_complexity: pick(COMPLEXITIES, rng),
      var_strategic_importance: 'Low',
      customer_price_sensitivity: Math.floor(rng() * 3) + 3, // 3-5 (higher)
      customer_loyalty: Math.floor(rng() * 3) + 1, // 1-3 (lower)
      deal_urgency: Math.floor(rng() * 5) + 1,
      is_new_logo: rng() > 0.4,
      solution_differentiation: Math.floor(rng() * 3) + 1, // 1-3 (lower)
      oem_cost: String(10000 + Math.floor(rng() * 490000)),
      oem: pick(OEMS, rng),
      services_attached: rng() > 0.7,
      quarter_end: rng() > 0.8,
      competitor_names: null,
      bom_line_count: Math.floor(rng() * 5),
      bom_avg_margin_pct: null,
      has_manual_bom: false,
      achieved_margin: String(0.15 + rng() * 0.15), // 15-30% (lost = higher margins)
      status: 'Lost',
      loss_reason: 'Price',
      bom_lines: null,
      org_id: 'test_org'
    })
  }

  return rows
}

// ── Mock setup helpers ───────────────────────────────────────────

function setupQueryMock(dealRows, options = {}) {
  const { phase = 1, orgRows = [{ org_id: 'test_org' }] } = options

  query.mockImplementation((sql, params) => {
    // ALTER TABLE for schema migration
    if (sql.includes('ALTER TABLE')) {
      return Promise.resolve({ rows: [], rowCount: 0 })
    }
    // Licenses lookup
    if (sql.includes('SELECT org_id FROM licenses')) {
      return Promise.resolve({ rows: orgRows })
    }
    // Recorded deals lookup
    if (sql.includes('SELECT * FROM recorded_deals')) {
      return Promise.resolve({ rows: dealRows })
    }
    // Phase lookup
    if (sql.includes('SELECT algorithm_phase FROM customer_config')) {
      return Promise.resolve({ rows: [{ algorithm_phase: phase }] })
    }
    // Model storage
    if (sql.includes('UPDATE customer_config SET ml_model')) {
      return Promise.resolve({ rowCount: 1 })
    }
    // Model retrieval
    if (sql.includes('SELECT ml_model FROM customer_config')) {
      return Promise.resolve({ rows: [] })
    }
    // Phase upsert
    if (sql.includes('INSERT INTO customer_config')) {
      return Promise.resolve({ rowCount: 1 })
    }
    return Promise.resolve({ rows: [], rowCount: 0 })
  })
}

// ── Tests ────────────────────────────────────────────────────────

describe('ensureMLSchema', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('calls ALTER TABLE to add ml_model column', async () => {
    query.mockResolvedValueOnce({ rows: [], rowCount: 0 })
    await ensureMLSchema()
    expect(query).toHaveBeenCalledWith(
      'ALTER TABLE customer_config ADD COLUMN IF NOT EXISTS ml_model JSONB'
    )
  })
})

describe('trainCustomerModel', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('trains successfully with 150 deals and returns success', async () => {
    const dealRows = generateDealRows(80, 70)
    setupQueryMock(dealRows, { phase: 1 })
    getCustomerPhaseById.mockResolvedValue(1)
    setCustomerPhase.mockResolvedValue(undefined)

    const result = await trainCustomerModel('cust-123')

    expect(result.success).toBe(true)
    expect(result.dealCount).toBe(150)
    expect(result.metrics).toBeDefined()
    expect(result.metrics.auc).toBeGreaterThan(0)
    expect(result.metrics.logLoss).toBeGreaterThan(0)
    expect(result.metrics.accuracy).toBeGreaterThan(0)
    expect(result.metrics.n).toBe(150)
    expect(result.syntheticCount).toBe(150) // one synthetic per real deal
    expect(result.topFeatures).toBeDefined()
    expect(result.topFeatures.length).toBeLessThanOrEqual(10)
    expect(result.epochsRun).toBeGreaterThan(0)
    expect(result.phase).toBeDefined()
  })

  it('produces AUC > 0.5 (model learned from the data)', async () => {
    const dealRows = generateDealRows(80, 70)
    setupQueryMock(dealRows, { phase: 1 })
    getCustomerPhaseById.mockResolvedValue(1)
    setCustomerPhase.mockResolvedValue(undefined)

    const result = await trainCustomerModel('cust-123')

    expect(result.success).toBe(true)
    expect(result.metrics.auc).toBeGreaterThan(0.5)
  })

  it('returns correct dealCount and topFeatures', async () => {
    const dealRows = generateDealRows(80, 70)
    setupQueryMock(dealRows, { phase: 1 })
    getCustomerPhaseById.mockResolvedValue(1)
    setCustomerPhase.mockResolvedValue(undefined)

    const result = await trainCustomerModel('cust-123')

    expect(result.dealCount).toBe(150)
    expect(Array.isArray(result.topFeatures)).toBe(true)
    expect(result.topFeatures.length).toBeGreaterThan(0)
    for (const feature of result.topFeatures) {
      expect(feature).toHaveProperty('name')
      expect(feature).toHaveProperty('weight')
      expect(feature).toHaveProperty('absWeight')
      expect(feature).toHaveProperty('direction')
    }
  })

  it('rejects when < 100 deals', async () => {
    const dealRows = generateDealRows(40, 30) // 70 total
    setupQueryMock(dealRows)

    const result = await trainCustomerModel('cust-123')

    expect(result.success).toBe(false)
    expect(result.reason).toContain('more deals')
    expect(result.dealCount).toBe(70)
    expect(result.wonCount).toBe(40)
    expect(result.lostCount).toBe(30)
  })

  it('rejects when < 20 Won deals', async () => {
    const dealRows = generateDealRows(15, 90) // 105 total, but only 15 won
    setupQueryMock(dealRows)

    const result = await trainCustomerModel('cust-123')

    expect(result.success).toBe(false)
    expect(result.wonCount).toBe(15)
  })

  it('rejects when < 20 Lost deals', async () => {
    const dealRows = generateDealRows(90, 15) // 105 total, but only 15 lost
    setupQueryMock(dealRows)

    const result = await trainCustomerModel('cust-123')

    expect(result.success).toBe(false)
    expect(result.lostCount).toBe(15)
  })

  it('stores model via UPDATE query with valid JSON', async () => {
    const dealRows = generateDealRows(80, 70)
    setupQueryMock(dealRows, { phase: 1 })
    getCustomerPhaseById.mockResolvedValue(1)
    setCustomerPhase.mockResolvedValue(undefined)

    await trainCustomerModel('cust-123')

    // Find the UPDATE call
    const updateCall = query.mock.calls.find(
      call => typeof call[0] === 'string' && call[0].includes('UPDATE customer_config SET ml_model')
    )
    expect(updateCall).toBeDefined()

    const jsonStr = updateCall[1][0]
    const parsed = JSON.parse(jsonStr)
    expect(parsed.model).toBeDefined()
    expect(parsed.normStats).toBeDefined()
    expect(parsed.featureNames).toBeDefined()
    expect(parsed.metrics).toBeDefined()
    expect(parsed.importance).toBeDefined()
    expect(parsed.dealCount).toBe(150)
    expect(parsed.trainedAt).toBeDefined()
    expect(parsed.version).toBe(2)
  })

  it('auto-promotes to Phase 2 when AUC >= 0.60', async () => {
    const dealRows = generateDealRows(80, 70)
    setupQueryMock(dealRows, { phase: 1 })
    getCustomerPhaseById.mockResolvedValue(1)
    setCustomerPhase.mockResolvedValue(undefined)

    const result = await trainCustomerModel('cust-123')

    // If AUC >= 0.60, setCustomerPhase should have been called
    if (result.metrics.auc >= 0.60) {
      expect(setCustomerPhase).toHaveBeenCalledWith('cust-123', 2)
    }
  })

  it('does not demote from Phase 2 or higher', async () => {
    const dealRows = generateDealRows(80, 70)
    setupQueryMock(dealRows, { phase: 2 })
    getCustomerPhaseById.mockResolvedValue(2)
    setCustomerPhase.mockResolvedValue(undefined)

    await trainCustomerModel('cust-123')

    // Should not call setCustomerPhase since currentPhase (2) is NOT < 2
    expect(setCustomerPhase).not.toHaveBeenCalled()
  })

  it('trains with segment/OEM-aware synthetic shifts', async () => {
    const dealRows = generateDealRows(80, 70)
    // Override some Won deals to Cisco Enterprise and some Lost deals to CrowdStrike SMB
    for (let i = 0; i < 40; i++) {
      dealRows[i].oem = 'Cisco'
      dealRows[i].segment = 'Enterprise'
    }
    for (let i = 80; i < 115; i++) {
      dealRows[i].oem = 'CrowdStrike'
      dealRows[i].segment = 'SMB'
    }
    setupQueryMock(dealRows, { phase: 1 })
    getCustomerPhaseById.mockResolvedValue(1)
    setCustomerPhase.mockResolvedValue(undefined)

    const result = await trainCustomerModel('cust-123')

    expect(result.success).toBe(true)
    expect(result.syntheticCount).toBe(150) // 1:1 ratio preserved
    expect(result.metrics.auc).toBeGreaterThan(0)
  })

  it('returns failure when no active licenses with org_id', async () => {
    query.mockImplementation((sql) => {
      if (sql.includes('SELECT org_id FROM licenses')) {
        return Promise.resolve({ rows: [] })
      }
      return Promise.resolve({ rows: [], rowCount: 0 })
    })

    const result = await trainCustomerModel('cust-123')

    expect(result.success).toBe(false)
    expect(result.reason).toBe('No active licenses with org_id found')
  })
})

describe('getModel', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns null when no model exists', async () => {
    query.mockResolvedValueOnce({ rows: [] })

    const model = await getModel('cust-123')
    expect(model).toBeNull()
  })

  it('returns null when ml_model column is null', async () => {
    query.mockResolvedValueOnce({ rows: [{ ml_model: null }] })

    const model = await getModel('cust-123')
    expect(model).toBeNull()
  })

  it('returns the model package when it exists', async () => {
    const mockModel = {
      model: '{}',
      normStats: { means: {}, stds: {} },
      featureNames: ['f1'],
      metrics: { auc: 0.75 },
      version: 1
    }
    query.mockResolvedValueOnce({ rows: [{ ml_model: mockModel }] })

    const model = await getModel('cust-123')
    expect(model).toEqual(mockModel)
  })
})

describe('getModelByOrgId', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns null for null orgId', async () => {
    const model = await getModelByOrgId(null)
    expect(model).toBeNull()
    expect(query).not.toHaveBeenCalled()
  })

  it('returns null when no matching license/model', async () => {
    query.mockResolvedValueOnce({ rows: [] })

    const model = await getModelByOrgId('org-456')
    expect(model).toBeNull()
  })

  it('returns the model when found via org_id join', async () => {
    const mockModel = { version: 1, metrics: { auc: 0.80 } }
    query.mockResolvedValueOnce({ rows: [{ ml_model: mockModel }] })

    const model = await getModelByOrgId('org-456')
    expect(model).toEqual(mockModel)
  })
})
