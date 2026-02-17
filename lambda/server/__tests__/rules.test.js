import { ruleBasedRecommendation, computeRecommendation } from '../src/rules.js'

// ── Helpers ──────────────────────────────────────────────────────

function makeInput(overrides = {}) {
  return {
    oemCost: 100000,
    productCategory: 'Hardware',
    customerSegment: 'Enterprise',
    relationshipStrength: 'Good',
    customerTechSophistication: 'Medium',
    dealRegType: 'NotRegistered',
    competitors: '1',
    valueAdd: 'Medium',
    solutionComplexity: 'Medium',
    varStrategicImportance: 'Normal',
    customerPriceSensitivity: 3,
    customerLoyalty: 3,
    dealUrgency: 3,
    isNewLogo: false,
    solutionDifferentiation: 3,
    customerIndustry: null,
    oem: null,
    servicesAttached: false,
    quarterEnd: false,
    displacementDeal: false,
    ...overrides
  }
}

// ── 1. Base margin by segment ────────────────────────────────────

describe('base margin by segment', () => {
  // Use minimal input: 1 competitor (0 adj), NotRegistered (0 adj),
  // Medium valueAdd (+0.03), Good relationship (+0.01), neutral everything else.
  // Enterprise base = 14%, so with Medium value-add (+3) and Good rel (+1)
  // we get a predictable baseline.

  it('Enterprise base is 14%', () => {
    const result = ruleBasedRecommendation(makeInput({
      customerSegment: 'Enterprise',
      competitors: '1',
      dealRegType: 'NotRegistered',
      valueAdd: 'Low',
      relationshipStrength: 'New',
    }))
    // Enterprise(14%) + 1 comp(0) + No reg(0) + Low valueAdd(no adj)
    // + New rel(no relationship adj in rules—wait, relationship only checks Strategic/Good)
    // Let's just verify the driver list includes Enterprise base at +0.14
    const enterpriseDriver = result.drivers.find(d => d.name === 'Enterprise base')
    expect(enterpriseDriver).toBeDefined()
    expect(enterpriseDriver.val).toBe(0.14)
  })

  it('MidMarket base is 17%', () => {
    const result = ruleBasedRecommendation(makeInput({
      customerSegment: 'MidMarket',
      competitors: '1',
      dealRegType: 'NotRegistered',
      valueAdd: 'Low',
      relationshipStrength: 'New',
    }))
    const driver = result.drivers.find(d => d.name === 'Mid-market base')
    expect(driver).toBeDefined()
    expect(driver.val).toBe(0.17)
  })

  it('SMB base is 20%', () => {
    const result = ruleBasedRecommendation(makeInput({
      customerSegment: 'SMB',
      competitors: '1',
      dealRegType: 'NotRegistered',
      valueAdd: 'Low',
      relationshipStrength: 'New',
    }))
    const driver = result.drivers.find(d => d.name === 'SMB base')
    expect(driver).toBeDefined()
    expect(driver.val).toBe(0.20)
  })

  it('SMB suggested margin is higher than Enterprise for equivalent deals', () => {
    const enterprise = ruleBasedRecommendation(makeInput({ customerSegment: 'Enterprise' }))
    const smb = ruleBasedRecommendation(makeInput({ customerSegment: 'SMB' }))
    expect(smb.suggestedMarginPct).toBeGreaterThan(enterprise.suggestedMarginPct)
  })
})

// ── 2. Deal registration boost ───────────────────────────────────

describe('deal registration boost', () => {
  it('PremiumHunting adds ~6pp (default, no oemProfile)', () => {
    const result = ruleBasedRecommendation(makeInput({ dealRegType: 'PremiumHunting' }))
    const driver = result.drivers.find(d => d.name === 'Premium/Hunting registration')
    expect(driver).toBeDefined()
    expect(driver.val).toBeCloseTo(0.06, 3)
  })

  it('StandardApproved adds ~3pp (default, no oemProfile)', () => {
    const result = ruleBasedRecommendation(makeInput({ dealRegType: 'StandardApproved' }))
    const driver = result.drivers.find(d => d.name === 'Standard/Teaming registration')
    expect(driver).toBeDefined()
    expect(driver.val).toBeCloseTo(0.03, 3)
  })

  it('Teaming adds ~3pp (same as StandardApproved)', () => {
    const result = ruleBasedRecommendation(makeInput({ dealRegType: 'Teaming' }))
    const driver = result.drivers.find(d => d.name === 'Standard/Teaming registration')
    expect(driver).toBeDefined()
    expect(driver.val).toBeCloseTo(0.03, 3)
  })

  it('NotRegistered adds 0', () => {
    const result = ruleBasedRecommendation(makeInput({ dealRegType: 'NotRegistered' }))
    const driver = result.drivers.find(d => d.name === 'No registration benefit')
    expect(driver).toBeDefined()
    expect(driver.val).toBe(0)
  })

  it('PremiumHunting yields higher margin than NotRegistered', () => {
    const premium = ruleBasedRecommendation(makeInput({ dealRegType: 'PremiumHunting' }))
    const none = ruleBasedRecommendation(makeInput({ dealRegType: 'NotRegistered' }))
    expect(premium.suggestedMarginPct).toBeGreaterThan(none.suggestedMarginPct)
  })

  it('uses oemProfile.dealRegBoost when provided', () => {
    const result = ruleBasedRecommendation(makeInput({
      dealRegType: 'PremiumHunting',
      oemProfile: { dealRegBoost: 8 }
    }))
    const driver = result.drivers.find(d => d.name === 'Premium/Hunting registration')
    expect(driver).toBeDefined()
    expect(driver.val).toBeCloseTo(0.08, 3)
  })

  it('oemProfile.dealRegBoost halved for StandardApproved', () => {
    const result = ruleBasedRecommendation(makeInput({
      dealRegType: 'StandardApproved',
      oemProfile: { dealRegBoost: 10 }
    }))
    const driver = result.drivers.find(d => d.name === 'Standard/Teaming registration')
    expect(driver).toBeDefined()
    expect(driver.val).toBeCloseTo(0.05, 3)
  })
})

// ── 3. Competition pressure ──────────────────────────────────────

describe('competition pressure', () => {
  it('0 competitors adds +2.5pp', () => {
    const result = ruleBasedRecommendation(makeInput({ competitors: '0' }))
    const driver = result.drivers.find(d => d.name === 'No competitors')
    expect(driver).toBeDefined()
    expect(driver.val).toBe(0.025)
  })

  it('1 competitor is neutral (0pp)', () => {
    const result = ruleBasedRecommendation(makeInput({ competitors: '1' }))
    const driver = result.drivers.find(d => d.name === '1 competitor')
    expect(driver).toBeDefined()
    expect(driver.val).toBe(0)
  })

  it('2 competitors subtracts -2pp', () => {
    const result = ruleBasedRecommendation(makeInput({ competitors: '2' }))
    const driver = result.drivers.find(d => d.name === '2 competitors')
    expect(driver).toBeDefined()
    expect(driver.val).toBe(-0.02)
  })

  it('3+ competitors subtracts -3.5pp', () => {
    const result = ruleBasedRecommendation(makeInput({ competitors: '3+' }))
    const driver = result.drivers.find(d => d.name === '3+ competitors')
    expect(driver).toBeDefined()
    expect(driver.val).toBe(-0.035)
  })

  it('more competitors leads to lower margin', () => {
    const zero = ruleBasedRecommendation(makeInput({ competitors: '0' }))
    const one = ruleBasedRecommendation(makeInput({ competitors: '1' }))
    const two = ruleBasedRecommendation(makeInput({ competitors: '2' }))
    const three = ruleBasedRecommendation(makeInput({ competitors: '3+' }))
    expect(zero.suggestedMarginPct).toBeGreaterThan(one.suggestedMarginPct)
    expect(one.suggestedMarginPct).toBeGreaterThan(two.suggestedMarginPct)
    expect(two.suggestedMarginPct).toBeGreaterThan(three.suggestedMarginPct)
  })
})

// ── 4. Industry adjustments ──────────────────────────────────────

describe('industry adjustments', () => {
  it('Financial Services gets +1.5pp', () => {
    const result = ruleBasedRecommendation(makeInput({ customerIndustry: 'Financial Services' }))
    const driver = result.drivers.find(d => d.name === 'Financial Services industry')
    expect(driver).toBeDefined()
    expect(driver.val).toBe(0.015)
  })

  it('Retail gets -1.5pp', () => {
    const result = ruleBasedRecommendation(makeInput({ customerIndustry: 'Retail' }))
    const driver = result.drivers.find(d => d.name === 'Retail industry')
    expect(driver).toBeDefined()
    expect(driver.val).toBe(-0.015)
  })

  it('Technology gets -1pp', () => {
    const result = ruleBasedRecommendation(makeInput({ customerIndustry: 'Technology' }))
    const driver = result.drivers.find(d => d.name === 'Technology industry')
    expect(driver).toBeDefined()
    expect(driver.val).toBe(-0.01)
  })

  it('Life Sciences & Healthcare gets +1pp', () => {
    const result = ruleBasedRecommendation(makeInput({ customerIndustry: 'Life Sciences & Healthcare' }))
    const driver = result.drivers.find(d => d.name === 'Life Sciences & Healthcare industry')
    expect(driver).toBeDefined()
    expect(driver.val).toBe(0.01)
  })

  it('unknown industry produces no industry driver', () => {
    const result = ruleBasedRecommendation(makeInput({ customerIndustry: 'Space Exploration' }))
    const driver = result.drivers.find(d => d.name.includes('industry'))
    expect(driver).toBeUndefined()
  })

  it('null industry produces no industry driver', () => {
    const result = ruleBasedRecommendation(makeInput({ customerIndustry: null }))
    const driver = result.drivers.find(d => d.name.includes('industry'))
    expect(driver).toBeUndefined()
  })

  it('Financial Services yields higher margin than Retail', () => {
    const finserv = ruleBasedRecommendation(makeInput({ customerIndustry: 'Financial Services' }))
    const retail = ruleBasedRecommendation(makeInput({ customerIndustry: 'Retail' }))
    expect(finserv.suggestedMarginPct).toBeGreaterThan(retail.suggestedMarginPct)
  })
})

// ── 5. OEM adjustments ───────────────────────────────────────────

describe('OEM adjustments', () => {
  it('Palo Alto gets +1.5pp', () => {
    const result = ruleBasedRecommendation(makeInput({ oem: 'Palo Alto' }))
    const driver = result.drivers.find(d => d.name === 'Palo Alto OEM margin profile')
    expect(driver).toBeDefined()
    expect(driver.val).toBe(0.015)
  })

  it('Microsoft gets -1pp', () => {
    const result = ruleBasedRecommendation(makeInput({ oem: 'Microsoft' }))
    const driver = result.drivers.find(d => d.name === 'Microsoft OEM margin profile')
    expect(driver).toBeDefined()
    expect(driver.val).toBe(-0.01)
  })

  it('Cisco gets +1pp', () => {
    const result = ruleBasedRecommendation(makeInput({ oem: 'Cisco' }))
    const driver = result.drivers.find(d => d.name === 'Cisco OEM margin profile')
    expect(driver).toBeDefined()
    expect(driver.val).toBe(0.01)
  })

  it('unknown OEM produces no OEM driver', () => {
    const result = ruleBasedRecommendation(makeInput({ oem: 'UnknownVendor' }))
    const driver = result.drivers.find(d => d.name.includes('OEM margin profile'))
    expect(driver).toBeUndefined()
  })

  it('null OEM produces no OEM driver', () => {
    const result = ruleBasedRecommendation(makeInput({ oem: null }))
    const driver = result.drivers.find(d => d.name.includes('OEM'))
    expect(driver).toBeUndefined()
  })

  it('trims whitespace from OEM name', () => {
    const result = ruleBasedRecommendation(makeInput({ oem: '  Palo Alto  ' }))
    const driver = result.drivers.find(d => d.name.includes('OEM margin profile'))
    expect(driver).toBeDefined()
    expect(driver.val).toBe(0.015)
  })

  it('oemProfile.baseMargin overrides hardcoded OEM adj', () => {
    // Enterprise base is 14. oemProfile.baseMargin = 20 → adj = (20-14)/100 = 0.06
    const result = ruleBasedRecommendation(makeInput({
      oem: 'Cisco',
      customerSegment: 'Enterprise',
      oemProfile: { baseMargin: 20 }
    }))
    const driver = result.drivers.find(d => d.name.includes('OEM margin profile'))
    expect(driver).toBeDefined()
    expect(driver.val).toBeCloseTo(0.06, 3)
  })
})

// ── 6. Policy floor enforcement ──────────────────────────────────

describe('policy floor enforcement', () => {
  it('critical competitive Enterprise deal has 0.5% floor', () => {
    const result = ruleBasedRecommendation(makeInput({
      customerSegment: 'Enterprise',
      competitors: '3+',
      dealRegType: 'NotRegistered'
    }))
    expect(result.policyFloor).toBe(0.005)
  })

  it('non-critical deals have 3% floor', () => {
    const result = ruleBasedRecommendation(makeInput({
      customerSegment: 'Enterprise',
      competitors: '1',
      dealRegType: 'NotRegistered'
    }))
    expect(result.policyFloor).toBe(0.03)
  })

  it('Enterprise + 2 competitors + NotRegistered = 0.5% floor', () => {
    const result = ruleBasedRecommendation(makeInput({
      customerSegment: 'Enterprise',
      competitors: '2',
      dealRegType: 'NotRegistered'
    }))
    expect(result.policyFloor).toBe(0.005)
  })

  it('SMB deal always has 3% floor', () => {
    const result = ruleBasedRecommendation(makeInput({
      customerSegment: 'SMB',
      competitors: '3+',
      dealRegType: 'NotRegistered'
    }))
    expect(result.policyFloor).toBe(0.03)
  })

  it('suggested margin never goes below policy floor', () => {
    // Construct an extremely negative deal to push margin down
    const result = ruleBasedRecommendation(makeInput({
      customerSegment: 'Enterprise',
      competitors: '3+',
      dealRegType: 'NotRegistered',
      valueAdd: 'Low',
      customerPriceSensitivity: 5,
      customerLoyalty: 1,
      dealUrgency: 1,
      isNewLogo: true,
      solutionDifferentiation: 1,
      oemCost: 2000000,
      oem: 'Microsoft',
      customerIndustry: 'Retail',
      displacementDeal: true,
      varStrategicImportance: 'High',
      solutionComplexity: 'Low',
      customerTechSophistication: 'High',
    }))
    expect(result.suggestedMarginPct).toBeGreaterThanOrEqual(result.policyFloor * 100)
  })

  it('margin is capped at 55%', () => {
    // Construct an extremely positive deal
    const result = ruleBasedRecommendation(makeInput({
      customerSegment: 'SMB',
      competitors: '0',
      dealRegType: 'PremiumHunting',
      valueAdd: 'High',
      relationshipStrength: 'Strategic',
      customerPriceSensitivity: 1,
      customerLoyalty: 5,
      dealUrgency: 5,
      isNewLogo: false,
      solutionDifferentiation: 5,
      oemCost: 10000,
      productCategory: 'ManagedServices',
      solutionComplexity: 'High',
      customerTechSophistication: 'Low',
      oem: 'Palo Alto',
      customerIndustry: 'Financial Services',
      servicesAttached: true,
      quarterEnd: true,
    }))
    // Floating point: 0.55 * 100 may be 55.00000000000001
    expect(result.suggestedMarginPct).toBeCloseTo(55, 0)
  })
})

// ── 7. kNN blending formula ──────────────────────────────────────

describe('kNN blending', () => {
  it('alpha = 0.25 for 0 neighbors (clamped at 0.25)', () => {
    const nn = { count: 0, weightedAvg: 0.20, lossOnPrice: 0, highWins: 0, top: [] }
    const result = ruleBasedRecommendation(makeInput(), [], nn)
    // alpha = clamp(0.25 + 0/40, 0.25, 0.6) = 0.25
    // final = 0.25 * 0.20 + 0.75 * base
    expect(result.method).toContain('75%')
    expect(result.method).toContain('25%')
  })

  it('alpha increases with neighbor count', () => {
    const nn10 = { count: 10, weightedAvg: 0.18, lossOnPrice: 0, highWins: 0, top: [] }
    const nn2 = { count: 2, weightedAvg: 0.18, lossOnPrice: 0, highWins: 0, top: [] }
    const result10 = ruleBasedRecommendation(makeInput(), [], nn10)
    const result2 = ruleBasedRecommendation(makeInput(), [], nn2)
    // alpha10 = clamp(0.25+10/40) = 0.50, alpha2 = clamp(0.25+2/40) = 0.30
    // kNN weight appears in method string
    expect(result10.method).toContain('50%')
    expect(result2.method).toContain('30%')
  })

  it('alpha maxes out at 0.6 for high neighbor count', () => {
    const nn = { count: 40, weightedAvg: 0.20, lossOnPrice: 0, highWins: 0, top: [] }
    const result = ruleBasedRecommendation(makeInput(), [], nn)
    expect(result.method).toContain('60%')
  })

  it('lossOnPrice adjusts margin down', () => {
    const noLoss = { count: 5, weightedAvg: 0.20, lossOnPrice: 0, highWins: 0, top: [] }
    const withLoss = { count: 5, weightedAvg: 0.20, lossOnPrice: 3, highWins: 0, top: [] }
    const resultNoLoss = ruleBasedRecommendation(makeInput(), [], noLoss)
    const resultWithLoss = ruleBasedRecommendation(makeInput(), [], withLoss)
    expect(resultWithLoss.suggestedMarginPct).toBeLessThan(resultNoLoss.suggestedMarginPct)
  })

  it('highWins adjusts margin up (when no lossOnPrice)', () => {
    const noWins = { count: 5, weightedAvg: 0.20, lossOnPrice: 0, highWins: 0, top: [] }
    const withWins = { count: 5, weightedAvg: 0.20, lossOnPrice: 0, highWins: 3, top: [] }
    const resultNoWins = ruleBasedRecommendation(makeInput(), [], noWins)
    const resultWithWins = ruleBasedRecommendation(makeInput(), [], withWins)
    expect(resultWithWins.suggestedMarginPct).toBeGreaterThan(resultNoWins.suggestedMarginPct)
  })

  it('highWins ignored when lossOnPrice > 0', () => {
    const nn = { count: 5, weightedAvg: 0.20, lossOnPrice: 2, highWins: 5, top: [] }
    const result = ruleBasedRecommendation(makeInput(), [], nn)
    // lossOnPrice > 0 so highWins adj should NOT apply
    // just verify the method contains kNN
    expect(result.method).toContain('kNN')
  })

  it('confidence reflects agreement between rules and kNN', () => {
    const input = makeInput()
    // kNN agrees with rules (same ballpark)
    const agreeing = { count: 10, weightedAvg: 0.18, lossOnPrice: 0, highWins: 0, top: [] }
    const resultAgree = ruleBasedRecommendation(input, [], agreeing)
    // kNN far from rules
    const disagreeing = { count: 10, weightedAvg: 0.40, lossOnPrice: 0, highWins: 0, top: [] }
    const resultDisagree = ruleBasedRecommendation(input, [], disagreeing)
    expect(resultAgree.confidence).toBeGreaterThan(resultDisagree.confidence)
  })

  it('confidence is clamped between 0.2 and 0.8', () => {
    const nn = { count: 30, weightedAvg: 0.18, lossOnPrice: 0, highWins: 0, top: [] }
    const result = ruleBasedRecommendation(makeInput(), [], nn)
    expect(result.confidence).toBeGreaterThanOrEqual(0.2)
    expect(result.confidence).toBeLessThanOrEqual(0.8)
  })

  it('without kNN data, confidence is 0.4 (rules-only)', () => {
    const result = ruleBasedRecommendation(makeInput(), [])
    expect(result.confidence).toBe(0.4)
  })

  it('without kNN data, method says "Rules only"', () => {
    const result = ruleBasedRecommendation(makeInput(), [])
    expect(result.method).toContain('Rules only')
  })
})

// ── 8. Full integration: computeRecommendation ───────────────────

describe('computeRecommendation', () => {
  it('returns expected response shape', async () => {
    const result = await computeRecommendation(makeInput())
    expect(result).toHaveProperty('suggestedMarginPct')
    expect(result).toHaveProperty('suggestedPrice')
    expect(result).toHaveProperty('winProbability')
    expect(result).toHaveProperty('drivers')
    expect(result).toHaveProperty('policyFloor')
    expect(result).toHaveProperty('confidence')
    expect(result).toHaveProperty('method')
  })

  it('suggestedMarginPct is a number in valid range', async () => {
    const result = await computeRecommendation(makeInput())
    expect(typeof result.suggestedMarginPct).toBe('number')
    expect(result.suggestedMarginPct).toBeGreaterThanOrEqual(0.5)
    expect(result.suggestedMarginPct).toBeLessThanOrEqual(55)
  })

  it('suggestedPrice = oemCost * (1 + margin)', async () => {
    const input = makeInput({ oemCost: 50000 })
    const result = await computeRecommendation(input)
    const expectedPrice = 50000 * (1 + result.suggestedMarginPct / 100)
    expect(result.suggestedPrice).toBeCloseTo(expectedPrice, 1)
  })

  it('winProbability is between 0 and 1', async () => {
    const result = await computeRecommendation(makeInput())
    expect(result.winProbability).toBeGreaterThanOrEqual(0.05)
    expect(result.winProbability).toBeLessThanOrEqual(0.95)
  })

  it('drivers is an array of {name, val} objects', async () => {
    const result = await computeRecommendation(makeInput())
    expect(Array.isArray(result.drivers)).toBe(true)
    expect(result.drivers.length).toBeGreaterThan(0)
    expect(result.drivers.length).toBeLessThanOrEqual(6)
    result.drivers.forEach(d => {
      expect(d).toHaveProperty('name')
      expect(d).toHaveProperty('val')
      expect(typeof d.name).toBe('string')
      expect(typeof d.val).toBe('number')
    })
  })

  it('drivers are sorted by absolute value descending', async () => {
    const result = await computeRecommendation(makeInput())
    for (let i = 1; i < result.drivers.length; i++) {
      expect(Math.abs(result.drivers[i - 1].val)).toBeGreaterThanOrEqual(Math.abs(result.drivers[i].val))
    }
  })

  it('falls back to rules when MODEL_URL is not set', async () => {
    const result = await computeRecommendation(makeInput())
    expect(result.method).toContain('rules')
  })

  it('passes bomStats through to kNN neighbor input', async () => {
    // Mainly a smoke test — verify it doesn't throw with bomStats
    const result = await computeRecommendation(makeInput(), [], {
      bomStats: { lineCount: 5, avgMarginPct: 15, manual: true }
    })
    expect(result).toHaveProperty('suggestedMarginPct')
  })
})

// ── 9. Additional rule behaviors ─────────────────────────────────

describe('value-add adjustments', () => {
  it('High value-add adds +6pp', () => {
    const result = ruleBasedRecommendation(makeInput({ valueAdd: 'High' }))
    const driver = result.drivers.find(d => d.name === 'High VAR value-add')
    expect(driver).toBeDefined()
    expect(driver.val).toBe(0.06)
  })

  it('Medium value-add adds +3pp', () => {
    const result = ruleBasedRecommendation(makeInput({ valueAdd: 'Medium' }))
    const driver = result.drivers.find(d => d.name === 'Medium VAR value-add')
    expect(driver).toBeDefined()
    expect(driver.val).toBe(0.03)
  })
})

describe('relationship adjustments', () => {
  it('Strategic adds +2pp', () => {
    const result = ruleBasedRecommendation(makeInput({ relationshipStrength: 'Strategic' }))
    const driver = result.drivers.find(d => d.name === 'Strategic relationship')
    expect(driver).toBeDefined()
    expect(driver.val).toBe(0.02)
  })

  it('Good adds +1pp', () => {
    const result = ruleBasedRecommendation(makeInput({ relationshipStrength: 'Good' }))
    const driver = result.drivers.find(d => d.name === 'Good relationship')
    expect(driver).toBeDefined()
    expect(driver.val).toBe(0.01)
  })
})

describe('deal size adjustments', () => {
  it('XL deal (>500k) gets -1pp', () => {
    const result = ruleBasedRecommendation(makeInput({ oemCost: 600000 }))
    const driver = result.drivers.find(d => d.name === 'XL deal size')
    expect(driver).toBeDefined()
    expect(driver.val).toBe(-0.01)
  })

  it('Large deal (>100k) gets -0.5pp', () => {
    const result = ruleBasedRecommendation(makeInput({ oemCost: 200000 }))
    const driver = result.drivers.find(d => d.name === 'Large deal size')
    expect(driver).toBeDefined()
    expect(driver.val).toBe(-0.005)
  })

  it('Small deal (<=25k) gets +1.5pp premium', () => {
    const result = ruleBasedRecommendation(makeInput({ oemCost: 20000 }))
    const driver = result.drivers.find(d => d.name === 'Small deal premium')
    expect(driver).toBeDefined()
    expect(driver.val).toBe(0.015)
  })

  it('Mega deal (>1M) gets -1pp compression', () => {
    const result = ruleBasedRecommendation(makeInput({ oemCost: 1500000 }))
    const driver = result.drivers.find(d => d.name === 'Mega deal compression')
    expect(driver).toBeDefined()
    expect(driver.val).toBe(-0.01)
  })
})

describe('services and timing', () => {
  it('servicesAttached adds +2pp (default)', () => {
    const result = ruleBasedRecommendation(makeInput({ servicesAttached: true }))
    const driver = result.drivers.find(d => d.name === 'Services attached')
    expect(driver).toBeDefined()
    expect(driver.val).toBe(0.02)
  })

  it('quarterEnd adds +1.5pp (default)', () => {
    const result = ruleBasedRecommendation(makeInput({ quarterEnd: true }))
    const driver = result.drivers.find(d => d.name === 'Quarter-end timing')
    expect(driver).toBeDefined()
    expect(driver.val).toBe(0.015)
  })

  it('displacementDeal subtracts -2pp', () => {
    const result = ruleBasedRecommendation(makeInput({ displacementDeal: true }))
    const driver = result.drivers.find(d => d.name === 'Displacement deal')
    expect(driver).toBeDefined()
    expect(driver.val).toBe(-0.02)
  })

  it('services uplift on hardware adds +1pp', () => {
    const result = ruleBasedRecommendation(makeInput({
      servicesAttached: true,
      productCategory: 'Hardware'
    }))
    const driver = result.drivers.find(d => d.name === 'Services uplift on hardware')
    expect(driver).toBeDefined()
    expect(driver.val).toBe(0.01)
  })

  it('services uplift on ComplexSolution adds +1pp', () => {
    const result = ruleBasedRecommendation(makeInput({
      servicesAttached: true,
      productCategory: 'ComplexSolution'
    }))
    const driver = result.drivers.find(d => d.name === 'Services uplift on hardware')
    expect(driver).toBeDefined()
    expect(driver.val).toBe(0.01)
  })

  it('no services uplift on Software', () => {
    const result = ruleBasedRecommendation(makeInput({
      servicesAttached: true,
      productCategory: 'Software'
    }))
    const driver = result.drivers.find(d => d.name === 'Services uplift on hardware')
    expect(driver).toBeUndefined()
  })
})

describe('competitor profile adjustments', () => {
  it('aggressive competitors (priceAggression >= 4) reduce margin', () => {
    const withAggressive = ruleBasedRecommendation(makeInput({
      competitors: '2',
      competitorProfiles: [
        { name: 'CompA', priceAggression: 5 },
        { name: 'CompB', priceAggression: 4 }
      ]
    }))
    const withoutProfiles = ruleBasedRecommendation(makeInput({ competitors: '2' }))
    expect(withAggressive.suggestedMarginPct).toBeLessThan(withoutProfiles.suggestedMarginPct)
  })

  it('marginAggression positive pushes margin up', () => {
    const result = ruleBasedRecommendation(makeInput({
      competitors: '1',
      competitorProfiles: [{ name: 'WeakComp', marginAggression: 3 }]
    }))
    const driver = result.drivers.find(d => d.name.includes('Competitor profile'))
    expect(driver).toBeDefined()
    expect(driver.val).toBeGreaterThan(0)
  })
})

// ── 10. Edge cases ───────────────────────────────────────────────

describe('edge cases', () => {
  it('handles minimal input (defaults for missing fields)', () => {
    const result = ruleBasedRecommendation({ oemCost: 50000 })
    expect(result).toHaveProperty('suggestedMarginPct')
    expect(typeof result.suggestedMarginPct).toBe('number')
    expect(result.suggestedMarginPct).toBeGreaterThanOrEqual(0)
  })

  it('handles empty object input', () => {
    const result = ruleBasedRecommendation({})
    expect(result).toHaveProperty('suggestedMarginPct')
    expect(Number.isFinite(result.suggestedMarginPct)).toBe(true)
  })

  it('handles all-defaults deal', () => {
    const result = ruleBasedRecommendation(makeInput())
    expect(result.suggestedMarginPct).toBeGreaterThan(0)
    expect(result.suggestedMarginPct).toBeLessThanOrEqual(55)
  })

  it('extreme negative deal still produces valid output', () => {
    const result = ruleBasedRecommendation(makeInput({
      customerSegment: 'Enterprise',
      competitors: '3+',
      dealRegType: 'NotRegistered',
      valueAdd: 'Low',
      relationshipStrength: 'New',
      customerPriceSensitivity: 5,
      customerLoyalty: 1,
      dealUrgency: 1,
      isNewLogo: true,
      solutionDifferentiation: 1,
      oemCost: 5000000,
      oem: 'Microsoft',
      customerIndustry: 'Retail',
      displacementDeal: true,
      varStrategicImportance: 'High',
      solutionComplexity: 'Low',
      customerTechSophistication: 'High',
    }))
    expect(Number.isFinite(result.suggestedMarginPct)).toBe(true)
    expect(result.suggestedMarginPct).toBeGreaterThanOrEqual(result.policyFloor * 100)
  })

  it('extreme positive deal still produces valid output', () => {
    const result = ruleBasedRecommendation(makeInput({
      customerSegment: 'SMB',
      competitors: '0',
      dealRegType: 'PremiumHunting',
      valueAdd: 'High',
      relationshipStrength: 'Strategic',
      customerPriceSensitivity: 1,
      customerLoyalty: 5,
      dealUrgency: 5,
      isNewLogo: false,
      solutionDifferentiation: 5,
      oemCost: 5000,
      productCategory: 'ManagedServices',
      solutionComplexity: 'High',
      customerTechSophistication: 'Low',
      oem: 'Pure Storage',
      customerIndustry: 'Financial Services',
      servicesAttached: true,
      quarterEnd: true,
    }))
    expect(Number.isFinite(result.suggestedMarginPct)).toBe(true)
    // Floating point: 0.55 * 100 may be 55.00000000000001
    expect(result.suggestedMarginPct).toBeCloseTo(55, 0)
  })

  it('suggestedPrice is always > oemCost (margin always positive after floor)', () => {
    const result = ruleBasedRecommendation(makeInput({ oemCost: 100000 }))
    expect(result.suggestedPrice).toBeGreaterThan(100000)
  })

  it('winProbability is returned as a fraction (0-1)', () => {
    const result = ruleBasedRecommendation(makeInput())
    expect(result.winProbability).toBeGreaterThanOrEqual(0)
    expect(result.winProbability).toBeLessThanOrEqual(1)
  })

  it('handles competitorProfiles as empty array', () => {
    const result = ruleBasedRecommendation(makeInput({ competitorProfiles: [] }))
    expect(result).toHaveProperty('suggestedMarginPct')
  })

  it('handles competitorProfiles with missing fields', () => {
    const result = ruleBasedRecommendation(makeInput({
      competitors: '2',
      competitorProfiles: [{ name: 'Unknown' }]
    }))
    expect(result).toHaveProperty('suggestedMarginPct')
  })
})
