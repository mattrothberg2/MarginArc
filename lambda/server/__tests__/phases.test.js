import { jest } from '@jest/globals'

// Mock db.js before importing phases
const mockQuery = jest.fn()
jest.unstable_mockModule('../src/licensing/db.js', () => ({
  query: mockQuery,
  default: jest.fn(),
  getClient: jest.fn(),
  getSSMParameter: jest.fn()
}))

const {
  ensurePhaseSchema,
  getCustomerPhase,
  getCustomerPhaseById,
  setCustomerPhase,
  checkPhaseReadiness,
  computeDealScore
} = await import('../src/phases.js')

// ── Tests ──────────────────────────────────────────────────────────

beforeEach(() => {
  mockQuery.mockReset()
})

// ─── ensurePhaseSchema ────────────────────────────────────────────

describe('ensurePhaseSchema', () => {
  it('runs ALTER TABLE to add algorithm_phase column', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 })
    await ensurePhaseSchema()
    expect(mockQuery).toHaveBeenCalledTimes(1)
    expect(mockQuery.mock.calls[0][0]).toMatch(/ALTER TABLE customer_config/)
    expect(mockQuery.mock.calls[0][0]).toMatch(/algorithm_phase/)
    expect(mockQuery.mock.calls[0][0]).toMatch(/IF NOT EXISTS/)
  })
})

// ─── getCustomerPhase ─────────────────────────────────────────────

describe('getCustomerPhase', () => {
  it('returns 1 when orgId is null or empty', async () => {
    expect(await getCustomerPhase(null)).toBe(1)
    expect(await getCustomerPhase('')).toBe(1)
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('returns the phase from DB when a matching license + config exists', async () => {
    mockQuery.mockResolvedValue({ rows: [{ algorithm_phase: 2 }], rowCount: 1 })
    const phase = await getCustomerPhase('00D5f000003ABCD')
    expect(phase).toBe(2)
    expect(mockQuery).toHaveBeenCalledTimes(1)
    const [sql, params] = mockQuery.mock.calls[0]
    expect(sql).toMatch(/customer_config/)
    expect(sql).toMatch(/licenses/)
    expect(params).toEqual(['00D5f000003ABCD'])
  })

  it('returns 1 when no matching license/config row exists', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 })
    const phase = await getCustomerPhase('00D5f000003NOEX')
    expect(phase).toBe(1)
  })

  it('returns 1 when algorithm_phase is null in DB', async () => {
    mockQuery.mockResolvedValue({ rows: [{ algorithm_phase: null }], rowCount: 1 })
    const phase = await getCustomerPhase('00D5f000003NULL')
    expect(phase).toBe(1)
  })
})

// ─── getCustomerPhaseById ─────────────────────────────────────────

describe('getCustomerPhaseById', () => {
  it('returns 1 when customerId is null', async () => {
    expect(await getCustomerPhaseById(null)).toBe(1)
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('returns the phase from DB', async () => {
    mockQuery.mockResolvedValue({ rows: [{ algorithm_phase: 3 }], rowCount: 1 })
    const phase = await getCustomerPhaseById('uuid-123')
    expect(phase).toBe(3)
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('customer_config'),
      ['uuid-123']
    )
  })

  it('returns 1 when no config row exists', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 })
    const phase = await getCustomerPhaseById('uuid-nonexist')
    expect(phase).toBe(1)
  })
})

// ─── setCustomerPhase ─────────────────────────────────────────────

describe('setCustomerPhase', () => {
  it('upserts the phase into customer_config', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 })
    await setCustomerPhase('uuid-123', 2)
    expect(mockQuery).toHaveBeenCalledTimes(1)
    const [sql, params] = mockQuery.mock.calls[0]
    expect(sql).toMatch(/INSERT INTO customer_config/)
    expect(sql).toMatch(/ON CONFLICT/)
    expect(params).toEqual(['uuid-123', 2])
  })

  it('throws for invalid phase values', async () => {
    await expect(setCustomerPhase('uuid-123', 0)).rejects.toThrow('Invalid phase')
    await expect(setCustomerPhase('uuid-123', 4)).rejects.toThrow('Invalid phase')
    await expect(setCustomerPhase('uuid-123', -1)).rejects.toThrow('Invalid phase')
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('accepts phase values 1, 2, and 3', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 })
    await setCustomerPhase('uuid-1', 1)
    await setCustomerPhase('uuid-2', 2)
    await setCustomerPhase('uuid-3', 3)
    expect(mockQuery).toHaveBeenCalledTimes(3)
  })
})

// ─── checkPhaseReadiness ──────────────────────────────────────────

describe('checkPhaseReadiness', () => {
  it('returns not ready when customer has no org and no deals', async () => {
    // getCustomerPhaseById query
    mockQuery.mockResolvedValueOnce({ rows: [{ algorithm_phase: 1 }], rowCount: 1 })
    // licenses query (no orgs)
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 })

    const result = await checkPhaseReadiness('uuid-123')
    expect(result.currentPhase).toBe(1)
    expect(result.phase2Ready).toBe(false)
    expect(result.phase2Requirements.recordedDeals.current).toBe(0)
    expect(result.phase2Requirements.avgDataQuality.current).toBe(0)
    expect(result.phase3Ready).toBe(false)
  })

  it('returns phase2Ready when deal count and quality thresholds are met', async () => {
    // getCustomerPhaseById
    mockQuery.mockResolvedValueOnce({ rows: [{ algorithm_phase: 1 }], rowCount: 1 })
    // licenses query (has org)
    mockQuery.mockResolvedValueOnce({ rows: [{ org_id: '00D123' }], rowCount: 1 })
    // deal count
    mockQuery.mockResolvedValueOnce({ rows: [{ total: '55' }], rowCount: 1 })
    // BOM deal count
    mockQuery.mockResolvedValueOnce({ rows: [{ total: '10' }], rowCount: 1 })
    // quality avg (fully filled deals score ~100)
    mockQuery.mockResolvedValueOnce({ rows: [{ avg_quality: '78' }], rowCount: 1 })

    const result = await checkPhaseReadiness('uuid-123')
    expect(result.currentPhase).toBe(1)
    expect(result.phase2Ready).toBe(true)
    expect(result.phase2Requirements.recordedDeals.met).toBe(true)
    expect(result.phase2Requirements.avgDataQuality.met).toBe(true)
  })

  it('returns phase2 not ready when deals below threshold', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ algorithm_phase: 1 }], rowCount: 1 })
    mockQuery.mockResolvedValueOnce({ rows: [{ org_id: '00D123' }], rowCount: 1 })
    mockQuery.mockResolvedValueOnce({ rows: [{ total: '30' }], rowCount: 1 })
    mockQuery.mockResolvedValueOnce({ rows: [{ total: '5' }], rowCount: 1 })
    mockQuery.mockResolvedValueOnce({ rows: [{ avg_quality: '80' }], rowCount: 1 })

    const result = await checkPhaseReadiness('uuid-123')
    expect(result.phase2Ready).toBe(false)
    expect(result.phase2Requirements.recordedDeals.met).toBe(false)
  })

  it('returns phase3Ready when phase 2 is active and BOM deal count met', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ algorithm_phase: 2 }], rowCount: 1 })
    mockQuery.mockResolvedValueOnce({ rows: [{ org_id: '00D123' }], rowCount: 1 })
    mockQuery.mockResolvedValueOnce({ rows: [{ total: '100' }], rowCount: 1 })
    mockQuery.mockResolvedValueOnce({ rows: [{ total: '25' }], rowCount: 1 })
    mockQuery.mockResolvedValueOnce({ rows: [{ avg_quality: '75' }], rowCount: 1 })

    const result = await checkPhaseReadiness('uuid-123')
    expect(result.currentPhase).toBe(2)
    expect(result.phase3Ready).toBe(true)
    expect(result.phase3Requirements.phase2Active.met).toBe(true)
    expect(result.phase3Requirements.dealsWithBom.met).toBe(true)
  })

  it('returns phase3 not ready when BOM deals below threshold', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ algorithm_phase: 2 }], rowCount: 1 })
    mockQuery.mockResolvedValueOnce({ rows: [{ org_id: '00D123' }], rowCount: 1 })
    mockQuery.mockResolvedValueOnce({ rows: [{ total: '100' }], rowCount: 1 })
    mockQuery.mockResolvedValueOnce({ rows: [{ total: '15' }], rowCount: 1 })
    mockQuery.mockResolvedValueOnce({ rows: [{ avg_quality: '75' }], rowCount: 1 })

    const result = await checkPhaseReadiness('uuid-123')
    expect(result.phase3Ready).toBe(false)
    expect(result.phase3Requirements.dealsWithBom.met).toBe(false)
  })
})

// ─── computeDealScore ─────────────────────────────────────────────

describe('computeDealScore', () => {
  it('returns 0-100 score with factor breakdown', () => {
    const result = computeDealScore({
      plannedMarginPct: 20,
      suggestedMarginPct: 20,
      winProbability: 0.7,
      confidence: 0.6,
      predictionQuality: { score: 80, grade: 'Excellent', missingFields: [] }
    })

    expect(result.dealScore).toBeGreaterThanOrEqual(0)
    expect(result.dealScore).toBeLessThanOrEqual(100)
    expect(result.scoreFactors).toHaveProperty('marginAlignment')
    expect(result.scoreFactors).toHaveProperty('winProbability')
    expect(result.scoreFactors).toHaveProperty('dataQuality')
    expect(result.scoreFactors).toHaveProperty('algorithmConfidence')
  })

  it('gives perfect alignment score when planned matches suggested', () => {
    const result = computeDealScore({
      plannedMarginPct: 18.5,
      suggestedMarginPct: 18.5,
      winProbability: 0.5,
      confidence: 0.5,
      predictionQuality: { score: 50, grade: 'Fair', missingFields: [] }
    })

    expect(result.scoreFactors.marginAlignment.score).toBe(40) // max alignment
  })

  it('gives zero alignment score when diff exceeds 10%', () => {
    const result = computeDealScore({
      plannedMarginPct: 5,
      suggestedMarginPct: 25,
      winProbability: 0.5,
      confidence: 0.5,
      predictionQuality: { score: 50, grade: 'Fair', missingFields: [] }
    })

    expect(result.scoreFactors.marginAlignment.score).toBe(0)
  })

  it('gives neutral alignment when plannedMarginPct is null', () => {
    const result = computeDealScore({
      plannedMarginPct: null,
      suggestedMarginPct: 20,
      winProbability: 0.5,
      confidence: 0.5,
      predictionQuality: { score: 50, grade: 'Fair', missingFields: [] }
    })

    expect(result.scoreFactors.marginAlignment.score).toBe(20) // midpoint
  })

  it('scales win probability linearly (0–25 pts)', () => {
    const low = computeDealScore({
      plannedMarginPct: 20,
      suggestedMarginPct: 20,
      winProbability: 0,
      confidence: 0.5,
      predictionQuality: { score: 50 }
    })
    const high = computeDealScore({
      plannedMarginPct: 20,
      suggestedMarginPct: 20,
      winProbability: 1.0,
      confidence: 0.5,
      predictionQuality: { score: 50 }
    })

    expect(low.scoreFactors.winProbability.score).toBe(0)
    expect(high.scoreFactors.winProbability.score).toBe(25)
  })

  it('scales data quality score from predictionQuality (0–20 pts)', () => {
    const lowQ = computeDealScore({
      plannedMarginPct: 20,
      suggestedMarginPct: 20,
      winProbability: 0.5,
      confidence: 0.5,
      predictionQuality: { score: 0 }
    })
    const highQ = computeDealScore({
      plannedMarginPct: 20,
      suggestedMarginPct: 20,
      winProbability: 0.5,
      confidence: 0.5,
      predictionQuality: { score: 100 }
    })

    expect(lowQ.scoreFactors.dataQuality.score).toBe(0)
    expect(highQ.scoreFactors.dataQuality.score).toBe(20)
  })

  it('scales algorithm confidence (0–15 pts)', () => {
    const lowC = computeDealScore({
      plannedMarginPct: 20,
      suggestedMarginPct: 20,
      winProbability: 0.5,
      confidence: 0,
      predictionQuality: { score: 50 }
    })
    const highC = computeDealScore({
      plannedMarginPct: 20,
      suggestedMarginPct: 20,
      winProbability: 0.5,
      confidence: 1.0,
      predictionQuality: { score: 50 }
    })

    expect(lowC.scoreFactors.algorithmConfidence.score).toBe(0)
    expect(highC.scoreFactors.algorithmConfidence.score).toBe(15)
  })

  it('handles missing predictionQuality gracefully', () => {
    const result = computeDealScore({
      plannedMarginPct: 20,
      suggestedMarginPct: 20,
      winProbability: 0.5,
      confidence: 0.5,
      predictionQuality: null
    })

    expect(result.dealScore).toBeGreaterThanOrEqual(0)
    expect(result.dealScore).toBeLessThanOrEqual(100)
    expect(result.scoreFactors.dataQuality.score).toBe(10) // neutral default
  })

  it('clamps total score to 100', () => {
    // All perfect inputs
    const result = computeDealScore({
      plannedMarginPct: 20,
      suggestedMarginPct: 20,
      winProbability: 1.0,
      confidence: 1.0,
      predictionQuality: { score: 100 }
    })

    expect(result.dealScore).toBe(100)
  })

  it('clamps total score to 0', () => {
    const result = computeDealScore({
      plannedMarginPct: 50,
      suggestedMarginPct: 5,
      winProbability: 0,
      confidence: 0,
      predictionQuality: { score: 0 }
    })

    expect(result.dealScore).toBe(0)
  })

  it('each factor has a max property', () => {
    const result = computeDealScore({
      plannedMarginPct: 20,
      suggestedMarginPct: 20,
      winProbability: 0.5,
      confidence: 0.5,
      predictionQuality: { score: 50 }
    })

    expect(result.scoreFactors.marginAlignment.max).toBe(40)
    expect(result.scoreFactors.winProbability.max).toBe(25)
    expect(result.scoreFactors.dataQuality.max).toBe(20)
    expect(result.scoreFactors.algorithmConfidence.max).toBe(15)
  })
})
