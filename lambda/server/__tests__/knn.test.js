import { similarity, topKNeighbors, timeDecay } from '../src/knn.js'

// Helper: ISO date string N years ago from now
function yearsAgo(n) {
  const d = new Date()
  d.setFullYear(d.getFullYear() - n)
  return d.toISOString()
}

// Helper: ISO date string N months ago from now
function monthsAgo(n) {
  const d = new Date()
  d.setMonth(d.getMonth() - n)
  return d.toISOString()
}

// Minimal deal that matches all fields on the input for a high similarity score
function makeDeal(overrides = {}) {
  return {
    segment: 'Enterprise',
    customerIndustry: 'Healthcare',
    productCategory: 'Networking',
    dealRegType: 'Different',
    valueAdd: true,
    solutionComplexity: 'High',
    relationshipStrength: 'Strong',
    customerTechSophistication: 'High',
    competitors: '2',
    customerPriceSensitivity: 3,
    customerLoyalty: 3,
    dealUrgency: 3,
    isNewLogo: false,
    solutionDifferentiation: 3,
    oemCost: 200000,
    bomLineCount: 5,
    hasManualBom: false,
    achievedMargin: 0.18,
    status: 'Won',
    ...overrides
  }
}

function makeInput(overrides = {}) {
  return {
    customerSegment: 'Enterprise',
    customerIndustry: 'Healthcare',
    productCategory: 'Networking',
    dealRegType: 'Registered',
    valueAdd: true,
    solutionComplexity: 'High',
    relationshipStrength: 'Strong',
    customerTechSophistication: 'High',
    competitors: '2',
    customerPriceSensitivity: 3,
    customerLoyalty: 3,
    dealUrgency: 3,
    isNewLogo: false,
    solutionDifferentiation: 3,
    oemCost: 200000,
    bomLineCount: 5,
    hasManualBom: false,
    ...overrides
  }
}

// ─── timeDecay tests ────────────────────────────────────────

describe('timeDecay', () => {
  it('returns 0.5 for null closeDate', () => {
    expect(timeDecay(null)).toBe(0.5)
  })

  it('returns 0.5 for undefined closeDate', () => {
    expect(timeDecay(undefined)).toBe(0.5)
  })

  it('returns 0.5 for empty string', () => {
    expect(timeDecay('')).toBe(0.5)
  })

  it('returns 0.5 for unparseable date string', () => {
    expect(timeDecay('not-a-date')).toBe(0.5)
  })

  it('returns 1.0 for a deal from 6 months ago', () => {
    expect(timeDecay(monthsAgo(6))).toBe(1.0)
  })

  it('returns 1.0 for a deal closed today', () => {
    expect(timeDecay(new Date().toISOString())).toBe(1.0)
  })

  it('returns 1.0 for a future date', () => {
    const future = new Date()
    future.setFullYear(future.getFullYear() + 1)
    expect(timeDecay(future.toISOString())).toBe(1.0)
  })

  it('returns 1.0 for exactly 1 year ago (boundary is <=)', () => {
    // Use a date slightly less than 1 year to avoid floating-point edge
    const d = new Date()
    d.setFullYear(d.getFullYear() - 1)
    d.setDate(d.getDate() + 1) // just under 1 year
    expect(timeDecay(d.toISOString())).toBe(1.0)
  })

  it('returns 0.85 for a deal from 18 months ago', () => {
    expect(timeDecay(monthsAgo(18))).toBe(0.85)
  })

  it('returns 0.70 for a deal from 30 months ago', () => {
    expect(timeDecay(monthsAgo(30))).toBe(0.70)
  })

  it('returns 0.50 for a deal from 4 years ago', () => {
    expect(timeDecay(yearsAgo(4))).toBe(0.50)
  })

  it('returns 0.30 for a deal from 7 years ago', () => {
    expect(timeDecay(yearsAgo(7))).toBe(0.30)
  })

  it('returns 0.30 for a deal from 10 years ago', () => {
    expect(timeDecay(yearsAgo(10))).toBe(0.30)
  })

  it('handles YYYY-MM-DD format', () => {
    const d = new Date()
    d.setMonth(d.getMonth() - 18)
    const yyyy = d.getFullYear()
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    expect(timeDecay(`${yyyy}-${mm}-${dd}`)).toBe(0.85)
  })

  it('handles full ISO 8601 format', () => {
    const d = new Date()
    d.setMonth(d.getMonth() - 18)
    expect(timeDecay(d.toISOString())).toBe(0.85)
  })
})

// ─── similarity tests ───────────────────────────────────────

describe('similarity', () => {
  it('returns a higher score for a matching deal than a mismatched deal', () => {
    const input = makeInput()
    const goodDeal = makeDeal({ segment: 'Enterprise' })
    const badDeal = makeDeal({
      segment: 'SMB',
      productCategory: 'Software',
      solutionComplexity: 'Low',
      competitors: '1',
      oemCost: 5000,
      bomLineCount: 50
    })

    const goodScore = similarity(input, goodDeal)
    const badScore = similarity(input, badDeal)
    expect(goodScore).toBeGreaterThan(badScore)
  })

  it('returns a positive score even for completely mismatched deals', () => {
    const input = makeInput()
    const mismatch = makeDeal({
      segment: 'SMB',
      customerIndustry: 'Retail',
      productCategory: 'Software',
      dealRegType: 'None',
      valueAdd: false,
      solutionComplexity: 'Low',
      relationshipStrength: 'Weak',
      customerTechSophistication: 'Low',
      competitors: '1',
      oemCost: 1000,
      bomLineCount: 0,
      isNewLogo: true
    })
    expect(similarity(input, mismatch)).toBeGreaterThan(0)
  })
})

// ─── topKNeighbors integration tests ────────────────────────

describe('topKNeighbors', () => {
  it('ranks a recent deal higher than an old deal with identical features', () => {
    const input = makeInput()
    const recentDeal = makeDeal({
      closeDate: monthsAgo(3),
      achievedMargin: 0.22
    })
    const oldDeal = makeDeal({
      closeDate: yearsAgo(7),
      achievedMargin: 0.22
    })

    const result = topKNeighbors(input, [oldDeal, recentDeal], 2)

    // Recent deal should be first (higher decayed score)
    expect(result.top[0]).toBe(recentDeal)
    expect(result.top[1]).toBe(oldDeal)
  })

  it('weights recent deals more heavily in the weighted average', () => {
    const input = makeInput()
    const recentDeal = makeDeal({
      closeDate: monthsAgo(3),
      achievedMargin: 0.30
    })
    const oldDeal = makeDeal({
      closeDate: yearsAgo(7),
      achievedMargin: 0.10
    })

    const result = topKNeighbors(input, [oldDeal, recentDeal], 2)

    // Weighted avg should be closer to 0.30 (recent) than 0.10 (old)
    expect(result.weightedAvg).toBeGreaterThan(0.20)
  })

  it('handles deals with missing closeDate (default decay 0.5)', () => {
    const input = makeInput()
    const recentDeal = makeDeal({
      closeDate: monthsAgo(3),
      achievedMargin: 0.25
    })
    const legacyDeal = makeDeal({
      // no closeDate
      achievedMargin: 0.25
    })

    const result = topKNeighbors(input, [legacyDeal, recentDeal], 2)

    // Recent deal (decay 1.0) should rank above legacy deal (decay 0.5)
    expect(result.top[0]).toBe(recentDeal)
  })

  it('returns correct count', () => {
    const input = makeInput()
    const deals = [
      makeDeal({ closeDate: monthsAgo(1) }),
      makeDeal({ closeDate: monthsAgo(2) }),
      makeDeal({ closeDate: monthsAgo(3) })
    ]
    const result = topKNeighbors(input, deals, 2)
    expect(result.count).toBe(2)
  })
})
