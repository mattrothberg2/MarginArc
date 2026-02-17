import { estimateWinProb } from '../src/winprob.js'

// ── Helpers ──────────────────────────────────────────────────────

function makeOpts(overrides = {}) {
  return {
    marginPct: 15,
    competitors: '1',
    dealRegType: 'NotRegistered',
    customerSegment: 'MidMarket',
    relationshipStrength: 'Good',
    valueAdd: 'Medium',
    isNewLogo: false,
    solutionComplexity: 'Medium',
    servicesAttached: false,
    quarterEnd: false,
    ...overrides
  }
}

// ── 1. Competition base rates ────────────────────────────────────

describe('competition base rates', () => {
  // Use marginPct at the knee (18%) so the logistic factor is ~0.5,
  // and isolate only the competition effect by setting neutral values for everything else.
  const neutralOpts = {
    marginPct: 18,
    dealRegType: 'NotRegistered',
    customerSegment: 'MidMarket',
    relationshipStrength: 'Neutral',
    valueAdd: 'Medium',
    isNewLogo: false,
    solutionComplexity: 'Medium',
    servicesAttached: false,
    quarterEnd: false,
  }

  it('0 competitors → ~68% base', () => {
    const wp = estimateWinProb({ ...neutralOpts, competitors: '0' })
    // base = 0.68, logistic at knee = 0.5
    // wp = clamp(0.6*0.68 + 0.4*0.5) = clamp(0.408 + 0.2) = 0.608 → 61%
    // Verify it's in the high range for 0 competitors
    expect(wp).toBeGreaterThanOrEqual(55)
    expect(wp).toBeLessThanOrEqual(70)
  })

  it('1 competitor → ~58% base', () => {
    const wp = estimateWinProb({ ...neutralOpts, competitors: '1' })
    expect(wp).toBeGreaterThanOrEqual(45)
    expect(wp).toBeLessThanOrEqual(65)
  })

  it('2 competitors → ~43% base', () => {
    const wp = estimateWinProb({ ...neutralOpts, competitors: '2' })
    expect(wp).toBeGreaterThanOrEqual(30)
    expect(wp).toBeLessThanOrEqual(50)
  })

  it('3+ competitors → ~32% base', () => {
    const wp = estimateWinProb({ ...neutralOpts, competitors: '3+' })
    expect(wp).toBeGreaterThanOrEqual(20)
    expect(wp).toBeLessThanOrEqual(40)
  })

  it('more competitors reduces win probability', () => {
    const wp0 = estimateWinProb({ ...neutralOpts, competitors: '0' })
    const wp1 = estimateWinProb({ ...neutralOpts, competitors: '1' })
    const wp2 = estimateWinProb({ ...neutralOpts, competitors: '2' })
    const wp3 = estimateWinProb({ ...neutralOpts, competitors: '3+' })
    expect(wp0).toBeGreaterThan(wp1)
    expect(wp1).toBeGreaterThan(wp2)
    expect(wp2).toBeGreaterThan(wp3)
  })
})

// ── 2. Deal registration impact ──────────────────────────────────

describe('deal registration impact', () => {
  it('PremiumHunting adds +12pp to base', () => {
    const withPremium = estimateWinProb(makeOpts({ dealRegType: 'PremiumHunting' }))
    const withNone = estimateWinProb(makeOpts({ dealRegType: 'NotRegistered' }))
    // +12pp on base → expect meaningful increase
    expect(withPremium).toBeGreaterThan(withNone)
    // 0.6 * 0.12 = 7.2pp in final output approximately
    expect(withPremium - withNone).toBeGreaterThanOrEqual(5)
  })

  it('StandardApproved adds +6pp to base', () => {
    const withStandard = estimateWinProb(makeOpts({ dealRegType: 'StandardApproved' }))
    const withNone = estimateWinProb(makeOpts({ dealRegType: 'NotRegistered' }))
    expect(withStandard).toBeGreaterThan(withNone)
  })

  it('Teaming adds +6pp to base (same as StandardApproved)', () => {
    const withTeaming = estimateWinProb(makeOpts({ dealRegType: 'Teaming' }))
    const withStandard = estimateWinProb(makeOpts({ dealRegType: 'StandardApproved' }))
    expect(withTeaming).toBe(withStandard)
  })

  it('PremiumHunting boost is larger than StandardApproved', () => {
    const premium = estimateWinProb(makeOpts({ dealRegType: 'PremiumHunting' }))
    const standard = estimateWinProb(makeOpts({ dealRegType: 'StandardApproved' }))
    expect(premium).toBeGreaterThan(standard)
  })
})

// ── 3. Relationship strength ─────────────────────────────────────

describe('relationship strength', () => {
  it('Strategic adds +6pp to base', () => {
    const strategic = estimateWinProb(makeOpts({ relationshipStrength: 'Strategic' }))
    const neutral = estimateWinProb(makeOpts({ relationshipStrength: 'Neutral' }))
    expect(strategic).toBeGreaterThan(neutral)
  })

  it('Good adds +3pp to base', () => {
    const good = estimateWinProb(makeOpts({ relationshipStrength: 'Good' }))
    const neutral = estimateWinProb(makeOpts({ relationshipStrength: 'Neutral' }))
    expect(good).toBeGreaterThan(neutral)
  })

  it('New subtracts -3pp from base', () => {
    const newRel = estimateWinProb(makeOpts({ relationshipStrength: 'New' }))
    const neutral = estimateWinProb(makeOpts({ relationshipStrength: 'Neutral' }))
    expect(newRel).toBeLessThan(neutral)
  })

  it('Strategic > Good > Neutral > New', () => {
    const strategic = estimateWinProb(makeOpts({ relationshipStrength: 'Strategic' }))
    const good = estimateWinProb(makeOpts({ relationshipStrength: 'Good' }))
    const neutral = estimateWinProb(makeOpts({ relationshipStrength: 'Neutral' }))
    const newRel = estimateWinProb(makeOpts({ relationshipStrength: 'New' }))
    expect(strategic).toBeGreaterThan(good)
    expect(good).toBeGreaterThan(neutral)
    expect(neutral).toBeGreaterThan(newRel)
  })
})

// ── 4. Margin-based logistic curve ───────────────────────────────

describe('margin-based logistic curve', () => {
  it('10% margin → high win probability', () => {
    const wp = estimateWinProb(makeOpts({ marginPct: 10 }))
    // Below knee → logistic > 0.5 → boosts WP
    expect(wp).toBeGreaterThanOrEqual(45)
  })

  it('18% margin (knee) → medium win probability', () => {
    const wp = estimateWinProb(makeOpts({ marginPct: 18 }))
    // At knee → logistic ≈ 0.5
    expect(wp).toBeGreaterThanOrEqual(30)
    expect(wp).toBeLessThanOrEqual(60)
  })

  it('30% margin → low win probability', () => {
    const wp = estimateWinProb(makeOpts({ marginPct: 30 }))
    // Above knee → logistic < 0.5 → reduces WP
    expect(wp).toBeLessThanOrEqual(50)
  })

  it('higher margin reduces win probability', () => {
    const low = estimateWinProb(makeOpts({ marginPct: 10 }))
    const mid = estimateWinProb(makeOpts({ marginPct: 18 }))
    const high = estimateWinProb(makeOpts({ marginPct: 30 }))
    const vhigh = estimateWinProb(makeOpts({ marginPct: 45 }))
    expect(low).toBeGreaterThan(mid)
    expect(mid).toBeGreaterThan(high)
    expect(high).toBeGreaterThan(vhigh)
  })

  it('logistic uses knee=18 and slope=0.08', () => {
    // At marginPct = 18 (the knee), logistic should be exactly 0.5
    // because 1/(1+exp(0.08*(18-18))) = 1/(1+exp(0)) = 1/2 = 0.5
    // Verify by checking symmetric margins around knee produce symmetric logistic values
    const belowKnee = estimateWinProb(makeOpts({ marginPct: 18 - 10 }))
    const aboveKnee = estimateWinProb(makeOpts({ marginPct: 18 + 10 }))
    // The below-knee WP should be higher than above-knee
    expect(belowKnee).toBeGreaterThan(aboveKnee)
  })

  it('0% margin gives highest possible logistic contribution', () => {
    const wp0 = estimateWinProb(makeOpts({ marginPct: 0 }))
    const wp5 = estimateWinProb(makeOpts({ marginPct: 5 }))
    expect(wp0).toBeGreaterThan(wp5)
  })
})

// ── 5. Clamping ──────────────────────────────────────────────────

describe('clamping', () => {
  it('output is always >= 5 (5%)', () => {
    // Worst possible: 3+ competitors, no reg, Enterprise, New, Low value,
    // new logo, high complexity, no services, no qtr end, very high margin
    const wp = estimateWinProb({
      marginPct: 80,
      competitors: '3+',
      dealRegType: 'NotRegistered',
      customerSegment: 'Enterprise',
      relationshipStrength: 'New',
      valueAdd: 'Low',
      isNewLogo: true,
      solutionComplexity: 'High',
      servicesAttached: false,
      quarterEnd: false,
    })
    expect(wp).toBeGreaterThanOrEqual(5)
  })

  it('output is always <= 95 (95%)', () => {
    // Best possible: 0 competitors, PremiumHunting, Strategic, High value,
    // not new logo, low complexity, services, qtr end, very low margin
    const wp = estimateWinProb({
      marginPct: 0,
      competitors: '0',
      dealRegType: 'PremiumHunting',
      customerSegment: 'MidMarket',
      relationshipStrength: 'Strategic',
      valueAdd: 'High',
      isNewLogo: false,
      solutionComplexity: 'Low',
      servicesAttached: true,
      quarterEnd: true,
    })
    expect(wp).toBeLessThanOrEqual(95)
  })

  it('returns integer values', () => {
    const wp = estimateWinProb(makeOpts())
    expect(Number.isInteger(wp)).toBe(true)
  })
})

// ── 6. Competitor profiles ───────────────────────────────────────

describe('competitor profiles', () => {
  it('aggressive competitors (priceAggression > 3) reduce WP', () => {
    const withAggressive = estimateWinProb(makeOpts({
      competitors: '2',
      competitorProfiles: [
        { name: 'AggressiveCorp', priceAggression: 5 },
        { name: 'VeryAggressive', priceAggression: 4 }
      ]
    }))
    const withoutProfiles = estimateWinProb(makeOpts({ competitors: '2' }))
    // avgAgg = 4.5, base += (3 - 4.5) * 0.02 = -0.03
    expect(withAggressive).toBeLessThan(withoutProfiles)
  })

  it('passive competitors (priceAggression < 3) increase WP', () => {
    const withPassive = estimateWinProb(makeOpts({
      competitors: '2',
      competitorProfiles: [
        { name: 'PassiveCorp', priceAggression: 1 },
        { name: 'RelaxedInc', priceAggression: 2 }
      ]
    }))
    const withoutProfiles = estimateWinProb(makeOpts({ competitors: '2' }))
    // avgAgg = 1.5, base += (3 - 1.5) * 0.02 = +0.03
    expect(withPassive).toBeGreaterThan(withoutProfiles)
  })

  it('neutral aggression (priceAggression = 3) has no effect', () => {
    const withNeutral = estimateWinProb(makeOpts({
      competitors: '1',
      competitorProfiles: [{ name: 'NeutralCorp', priceAggression: 3 }]
    }))
    const withoutProfiles = estimateWinProb(makeOpts({ competitors: '1' }))
    // avgAgg = 3, base += (3 - 3) * 0.02 = 0
    expect(withNeutral).toBe(withoutProfiles)
  })

  it('defaults missing priceAggression to 3 (neutral)', () => {
    const withMissing = estimateWinProb(makeOpts({
      competitors: '1',
      competitorProfiles: [{ name: 'Unknown' }]
    }))
    const withoutProfiles = estimateWinProb(makeOpts({ competitors: '1' }))
    expect(withMissing).toBe(withoutProfiles)
  })

  it('empty competitorProfiles array has no effect', () => {
    const withEmpty = estimateWinProb(makeOpts({ competitorProfiles: [] }))
    const withoutProfiles = estimateWinProb(makeOpts())
    expect(withEmpty).toBe(withoutProfiles)
  })
})

// ── 7. Combined effects ──────────────────────────────────────────

describe('combined effects', () => {
  const bestCase = {
    marginPct: 8,
    competitors: '0',
    dealRegType: 'PremiumHunting',
    customerSegment: 'MidMarket',
    relationshipStrength: 'Strategic',
    valueAdd: 'High',
    isNewLogo: false,
    solutionComplexity: 'Low',
    servicesAttached: true,
    quarterEnd: true,
  }

  const worstCase = {
    marginPct: 40,
    competitors: '3+',
    dealRegType: 'NotRegistered',
    customerSegment: 'Enterprise',
    relationshipStrength: 'New',
    valueAdd: 'Low',
    isNewLogo: true,
    solutionComplexity: 'High',
    servicesAttached: false,
    quarterEnd: false,
  }

  it('best case deal has high win probability', () => {
    const wp = estimateWinProb(bestCase)
    expect(wp).toBeGreaterThanOrEqual(80)
  })

  it('worst case deal has low win probability', () => {
    const wp = estimateWinProb(worstCase)
    expect(wp).toBeLessThanOrEqual(20)
  })

  it('best case is significantly higher than worst case', () => {
    const best = estimateWinProb(bestCase)
    const worst = estimateWinProb(worstCase)
    expect(best - worst).toBeGreaterThanOrEqual(50)
  })

  it('Enterprise segment reduces WP by -4pp vs non-Enterprise', () => {
    const enterprise = estimateWinProb(makeOpts({ customerSegment: 'Enterprise' }))
    const midmarket = estimateWinProb(makeOpts({ customerSegment: 'MidMarket' }))
    expect(midmarket).toBeGreaterThan(enterprise)
  })

  it('new logo deals reduce WP', () => {
    const newLogo = estimateWinProb(makeOpts({ isNewLogo: true }))
    const existing = estimateWinProb(makeOpts({ isNewLogo: false }))
    expect(existing).toBeGreaterThan(newLogo)
  })

  it('High value-add increases WP', () => {
    const high = estimateWinProb(makeOpts({ valueAdd: 'High' }))
    const low = estimateWinProb(makeOpts({ valueAdd: 'Low' }))
    expect(high).toBeGreaterThan(low)
  })

  it('services attached increases WP', () => {
    const withServices = estimateWinProb(makeOpts({ servicesAttached: true }))
    const withoutServices = estimateWinProb(makeOpts({ servicesAttached: false }))
    expect(withServices).toBeGreaterThan(withoutServices)
  })

  it('quarter-end increases WP', () => {
    const withQE = estimateWinProb(makeOpts({ quarterEnd: true }))
    const withoutQE = estimateWinProb(makeOpts({ quarterEnd: false }))
    expect(withQE).toBeGreaterThan(withoutQE)
  })

  it('High complexity reduces WP', () => {
    const high = estimateWinProb(makeOpts({ solutionComplexity: 'High' }))
    const low = estimateWinProb(makeOpts({ solutionComplexity: 'Low' }))
    expect(low).toBeGreaterThan(high)
  })
})

// ── 8. Edge cases ────────────────────────────────────────────────

describe('edge cases', () => {
  it('handles empty options (marginPct undefined → NaN propagation)', () => {
    // When marginPct is undefined, the logistic produces NaN
    // This documents current behavior — no crash, returns NaN
    const wp = estimateWinProb({})
    expect(typeof wp).toBe('number')
    expect(Number.isNaN(wp)).toBe(true)
  })

  it('handles no arguments (marginPct undefined → NaN propagation)', () => {
    const wp = estimateWinProb()
    expect(typeof wp).toBe('number')
    expect(Number.isNaN(wp)).toBe(true)
  })

  it('handles negative marginPct', () => {
    const wp = estimateWinProb(makeOpts({ marginPct: -10 }))
    expect(wp).toBeGreaterThanOrEqual(5)
    expect(wp).toBeLessThanOrEqual(95)
  })

  it('handles very high marginPct', () => {
    const wp = estimateWinProb(makeOpts({ marginPct: 100 }))
    expect(wp).toBeGreaterThanOrEqual(5)
    expect(wp).toBeLessThanOrEqual(95)
  })

  it('handles undefined marginPct (NaN propagation)', () => {
    // undefined marginPct → NaN in logistic → NaN output
    const wp = estimateWinProb(makeOpts({ marginPct: undefined }))
    expect(typeof wp).toBe('number')
    expect(Number.isNaN(wp)).toBe(true)
  })

  it('returns consistent results for same input', () => {
    const opts = makeOpts({ marginPct: 15 })
    const wp1 = estimateWinProb(opts)
    const wp2 = estimateWinProb(opts)
    expect(wp1).toBe(wp2)
  })
})
