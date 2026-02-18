import { describe, it, expect } from '@jest/globals'
import {
  getSizeBucket,
  getBenchmark,
  generateBenchmarkResponse,
  getBenchmarkIQR,
} from './benchmarks.js'

// ── Test helpers ─────────────────────────────────────────────────

function makeDealInput(overrides = {}) {
  return {
    oem: 'Cisco',
    customerSegment: 'Enterprise',
    oemCost: 100_000,
    dealRegType: 'NotRegistered',
    competitors: '1',
    servicesAttached: false,
    productCategory: 'Hardware',
    ...overrides,
  }
}

// ── getSizeBucket ────────────────────────────────────────────────

describe('getSizeBucket', () => {
  it('categorizes deal sizes correctly', () => {
    expect(getSizeBucket(5_000)).toBe('<$25K')
    expect(getSizeBucket(50_000)).toBe('$25K-$100K')
    expect(getSizeBucket(250_000)).toBe('$100K-$500K')
    expect(getSizeBucket(750_000)).toBe('$500K-$1M')
    expect(getSizeBucket(2_000_000)).toBe('$1M+')
  })

  it('handles boundary values', () => {
    expect(getSizeBucket(24_999)).toBe('<$25K')
    expect(getSizeBucket(25_000)).toBe('$25K-$100K')
    expect(getSizeBucket(99_999)).toBe('$25K-$100K')
    expect(getSizeBucket(100_000)).toBe('$100K-$500K')
    expect(getSizeBucket(999_999)).toBe('$500K-$1M')
    expect(getSizeBucket(1_000_000)).toBe('$1M+')
  })
})

// ── getBenchmark ─────────────────────────────────────────────────

describe('getBenchmark', () => {
  it('returns Cisco-specific range for Cisco + Enterprise + $250K', () => {
    const b = getBenchmark('Cisco', 'Enterprise', 250_000)
    expect(b.specificity).toBe('oem_segment')
    expect(b.source).toContain('Cisco')
    expect(b.median).toBe(14)
    expect(b.low).toBe(10)
    expect(b.high).toBe(17)
  })

  it('falls back to _default range for unknown OEM', () => {
    const b = getBenchmark('Juniper', 'MidMarket', 75_000)
    expect(b.specificity).toBe('general')
    expect(b.source).toContain('General')
    expect(b.median).toBe(18)
  })

  it('compresses margins 4pp for $1M+ deals', () => {
    const base = getBenchmark('Cisco', 'Enterprise', 250_000)
    const mega = getBenchmark('Cisco', 'Enterprise', 1_500_000)
    expect(mega.median).toBe(base.median - 4)
    expect(mega.low).toBe(base.low - 4)
    expect(mega.high).toBe(base.high - 4)
  })

  it('returns SMB-level margins for small deals regardless of segment', () => {
    const b = getBenchmark('Cisco', 'Enterprise', 10_000)
    // <$25K should use SMB margins for Cisco
    expect(b.median).toBe(23)
    expect(b.source).toContain('Cisco SMB')
  })

  it('floors margins at 5% even for massive deals', () => {
    // Use a low-margin OEM base to test floor behavior
    const b = getBenchmark('Dell', 'Enterprise', 5_000_000)
    // Dell Enterprise base: p25=8, median=12, p75=16; minus 4 → 4,8,12 → floor at 5
    expect(b.low).toBe(5)
    expect(b.median).toBeGreaterThanOrEqual(5)
    expect(b.high).toBeGreaterThanOrEqual(5)
  })
})

// ── generateBenchmarkResponse ────────────────────────────────────

describe('generateBenchmarkResponse', () => {
  it('returns all required fields including source: industry_benchmark', () => {
    const result = generateBenchmarkResponse(makeDealInput())
    expect(result).toHaveProperty('suggestedMarginPct')
    expect(result).toHaveProperty('suggestedMarginRange')
    expect(result).toHaveProperty('suggestedPrice')
    expect(result).toHaveProperty('benchmarkSource')
    expect(result).toHaveProperty('benchmarkSpecificity')
    expect(result).toHaveProperty('insights')
    expect(result.source).toBe('industry_benchmark')
    expect(typeof result.suggestedMarginPct).toBe('number')
    expect(typeof result.suggestedPrice).toBe('number')
    expect(result.suggestedMarginRange).toHaveProperty('low')
    expect(result.suggestedMarginRange).toHaveProperty('high')
  })

  it('computes suggestedPrice correctly from median margin', () => {
    const deal = makeDealInput({ oemCost: 100_000 })
    const result = generateBenchmarkResponse(deal)
    const expectedPrice = 100_000 / (1 - result.suggestedMarginPct / 100)
    expect(result.suggestedPrice).toBeCloseTo(expectedPrice, 2)
  })
})

// ── Insights ─────────────────────────────────────────────────────

describe('insights', () => {
  it('includes competition warning for 3+ competitors', () => {
    const result = generateBenchmarkResponse(makeDealInput({ competitors: '3+' }))
    const competitionInsight = result.insights.find(i => i.includes('3+ competitors'))
    expect(competitionInsight).toBeDefined()
  })

  it('includes services uplift mention for services-attached deals', () => {
    const result = generateBenchmarkResponse(makeDealInput({ servicesAttached: true }))
    const servicesInsight = result.insights.find(i => i.includes('Services-attached'))
    expect(servicesInsight).toBeDefined()
  })

  it('always includes ML model caveat', () => {
    const result = generateBenchmarkResponse(makeDealInput())
    const caveat = result.insights.find(i => i.includes('ML model will personalize'))
    expect(caveat).toBeDefined()
  })

  it('caps insights at 4 max', () => {
    // Trigger as many insights as possible
    const result = generateBenchmarkResponse(makeDealInput({
      dealRegType: 'PremiumHunting',
      competitors: '3+',
      servicesAttached: true,
      productCategory: 'ManagedServices',
      oemCost: 750_000,
    }))
    expect(result.insights.length).toBeLessThanOrEqual(4)
  })
})

// ── getBenchmarkIQR ──────────────────────────────────────────────

describe('getBenchmarkIQR', () => {
  it('returns correct IQR for Cisco Enterprise (17 - 10 = 7)', () => {
    expect(getBenchmarkIQR('Cisco', 'Enterprise')).toBe(7)
  })

  it('returns correct IQR for CrowdStrike SMB (35 - 25 = 10)', () => {
    expect(getBenchmarkIQR('CrowdStrike', 'SMB')).toBe(10)
  })

  it('returns correct IQR for Dell MidMarket (23 - 14 = 9)', () => {
    expect(getBenchmarkIQR('Dell', 'MidMarket')).toBe(9)
  })

  it('falls back to _default for unknown OEM', () => {
    // _default MidMarket: p75=23, p25=14 => IQR=9
    expect(getBenchmarkIQR('Juniper', 'MidMarket')).toBe(9)
  })

  it('falls back to MidMarket when segment is null', () => {
    // Cisco MidMarket: p75=24, p25=15 => IQR=9
    expect(getBenchmarkIQR('Cisco', null)).toBe(9)
  })

  it('returns DEFAULT_IQR (10) for completely unknown OEM + segment', () => {
    expect(getBenchmarkIQR('UnknownVendor', 'UnknownSegment')).toBe(10)
  })
})
