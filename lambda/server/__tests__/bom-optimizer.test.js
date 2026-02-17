import { optimizeBom } from '../src/bom-optimizer.js'

// ── Helpers ──────────────────────────────────────────────────────

function hwLine(overrides = {}) {
  return {
    partNumber: 'C9300-48P-A',
    category: 'Hardware',
    quantity: 10,
    unitCost: 5717,
    marginPct: 12,
    ...overrides
  }
}

function svcLine(overrides = {}) {
  return {
    description: 'Implementation Services',
    category: 'ProfessionalServices',
    quantity: 80,
    unitCost: 175,
    marginPct: 30,
    ...overrides
  }
}

function baseContext(overrides = {}) {
  return {
    oem: 'Cisco',
    customerSegment: 'MidMarket',
    dealRegType: 'StandardApproved',
    competitors: '1',
    solutionComplexity: 'Medium',
    relationshipStrength: 'Good',
    valueAdd: 'High',
    targetBlendedMargin: 18.5,
    ...overrides
  }
}

// ── Empty BOM ────────────────────────────────────────────────────

describe('empty BOM', () => {
  it('returns empty lines and zero totals', () => {
    const result = optimizeBom([], baseContext())
    expect(result.lines).toEqual([])
    expect(result.totals.totalCost).toBe(0)
    expect(result.totals.totalPrice).toBe(0)
    expect(result.totals.blendedMarginPct).toBe(0)
    expect(result.totals.totalGrossProfit).toBe(0)
    expect(result.totals.targetAchieved).toBe(false)
    expect(result.recommendations.insights).toContain('No BOM lines provided')
  })

  it('handles null bomLines', () => {
    const result = optimizeBom(null, baseContext())
    expect(result.lines).toEqual([])
  })

  it('handles undefined bomLines', () => {
    const result = optimizeBom(undefined, baseContext())
    expect(result.lines).toEqual([])
  })
})

// ── Single line BOM ──────────────────────────────────────────────

describe('single line BOM', () => {
  it('returns one line with correct index', () => {
    const result = optimizeBom([hwLine()], baseContext())
    expect(result.lines).toHaveLength(1)
    expect(result.lines[0].index).toBe(0)
  })

  it('respects hardware margin floor', () => {
    const result = optimizeBom([hwLine()], baseContext({ targetBlendedMargin: 1 }))
    expect(result.lines[0].recommendedMarginPct).toBeGreaterThanOrEqual(5)
    expect(result.lines[0].marginFloor).toBe(5)
  })

  it('includes partNumber in output', () => {
    const result = optimizeBom([hwLine()], baseContext())
    expect(result.lines[0].partNumber).toBe('C9300-48P-A')
  })

  it('includes description when provided', () => {
    const result = optimizeBom([svcLine()], baseContext())
    expect(result.lines[0].description).toBe('Implementation Services')
  })

  it('computes extendedCost as quantity * unitCost', () => {
    const result = optimizeBom([hwLine()], baseContext())
    expect(result.lines[0].extendedCost).toBe(57170)
  })
})

// ── Margin floors by category ────────────────────────────────────

describe('category margin floors', () => {
  const floorCases = [
    ['Hardware', 5],
    ['Software', 8],
    ['Cloud', 6],
    ['ProfessionalServices', 15],
    ['ManagedServices', 12],
    ['ComplexSolution', 10]
  ]

  it.each(floorCases)('%s floor is %d%%', (category, expectedFloor) => {
    // Set a very low target so the optimizer can't go below floor
    const line = { description: 'Test', category, quantity: 1, unitCost: 1000, marginPct: 2 }
    const result = optimizeBom([line], baseContext({ targetBlendedMargin: 0.1 }))
    expect(result.lines[0].marginFloor).toBe(expectedFloor)
    expect(result.lines[0].recommendedMarginPct).toBeGreaterThanOrEqual(expectedFloor)
  })
})

// ── Margin-on-selling-price convention ───────────────────────────

describe('margin-on-selling-price convention', () => {
  it('price = cost / (1 - marginPct/100)', () => {
    const result = optimizeBom([hwLine({ quantity: 1, unitCost: 1000 })], baseContext())
    const line = result.lines[0]
    const marginDecimal = line.recommendedMarginPct / 100
    const expectedPrice = 1000 / (1 - marginDecimal)
    expect(line.extendedPrice).toBeCloseTo(expectedPrice, 1)
  })

  it('grossProfit = extendedPrice - extendedCost', () => {
    const result = optimizeBom([hwLine()], baseContext())
    const line = result.lines[0]
    expect(line.grossProfit).toBeCloseTo(line.extendedPrice - line.extendedCost, 1)
  })

  it('blended margin is (totalPrice - totalCost) / totalPrice', () => {
    const result = optimizeBom([hwLine(), svcLine()], baseContext())
    const { totalCost, totalPrice, blendedMarginPct } = result.totals
    const expected = ((totalPrice - totalCost) / totalPrice) * 100
    expect(blendedMarginPct).toBeCloseTo(expected, 0)
  })
})

// ── Target blended margin ────────────────────────────────────────

describe('target blended margin', () => {
  it('achieves target when feasible', () => {
    const lines = [
      hwLine({ quantity: 5, unitCost: 1000 }),
      svcLine({ quantity: 10, unitCost: 200, category: 'ProfessionalServices' })
    ]
    const result = optimizeBom(lines, baseContext({ targetBlendedMargin: 15 }))
    expect(result.totals.targetAchieved).toBe(true)
    expect(result.totals.blendedMarginPct).toBeCloseTo(15, 0)
    expect(result.totals.gap).toBe(0)
  })

  it('flags when target is impossible', () => {
    // All hardware, very high target — can't reach it
    const lines = [hwLine({ quantity: 100, unitCost: 10000 })]
    const result = optimizeBom(lines, baseContext({ targetBlendedMargin: 50 }))
    expect(result.totals.targetAchieved).toBe(false)
    expect(result.totals.gap).toBeGreaterThan(0)
    expect(result.totals.targetMarginPct).toBe(50)
  })

  it('handles zero target blended margin', () => {
    const result = optimizeBom([hwLine()], baseContext({ targetBlendedMargin: 0 }))
    expect(result.totals.targetAchieved).toBe(true)
  })

  it('returns targetMarginPct matching input', () => {
    const result = optimizeBom([hwLine()], baseContext({ targetBlendedMargin: 22 }))
    expect(result.totals.targetMarginPct).toBe(22)
  })
})

// ── Elasticity: services absorb more margin ──────────────────────

describe('elasticity-based margin distribution', () => {
  it('services get higher margin than hardware', () => {
    const lines = [
      hwLine({ quantity: 10, unitCost: 5000 }),
      svcLine({ quantity: 40, unitCost: 200, category: 'ProfessionalServices' })
    ]
    const result = optimizeBom(lines, baseContext({ targetBlendedMargin: 18 }))
    const hw = result.lines.find(l => l.partNumber === 'C9300-48P-A')
    const svc = result.lines.find(l => l.description === 'Implementation Services')
    expect(svc.recommendedMarginPct).toBeGreaterThan(hw.recommendedMarginPct)
  })

  it('software gets higher margin than hardware', () => {
    const lines = [
      { partNumber: 'HW-001', category: 'Hardware', quantity: 1, unitCost: 10000, marginPct: 10 },
      { partNumber: 'SW-001', category: 'Software', quantity: 1, unitCost: 5000, marginPct: 15 }
    ]
    const result = optimizeBom(lines, baseContext({ targetBlendedMargin: 15 }))
    const hw = result.lines.find(l => l.partNumber === 'HW-001')
    const sw = result.lines.find(l => l.partNumber === 'SW-001')
    expect(sw.recommendedMarginPct).toBeGreaterThan(hw.recommendedMarginPct)
  })
})

// ── All-services BOM ─────────────────────────────────────────────

describe('all-services BOM', () => {
  it('handles BOM with only ProfessionalServices lines', () => {
    const lines = [
      svcLine({ quantity: 40, unitCost: 200 }),
      svcLine({ description: 'Consulting', quantity: 20, unitCost: 300 })
    ]
    const result = optimizeBom(lines, baseContext({ targetBlendedMargin: 25 }))
    expect(result.lines).toHaveLength(2)
    result.lines.forEach(l => {
      expect(l.recommendedMarginPct).toBeGreaterThanOrEqual(15) // ProfessionalServices floor
    })
    expect(result.totals.totalCost).toBeGreaterThan(0)
  })

  it('handles ManagedServices-only BOM', () => {
    const lines = [
      { description: 'Managed NOC', category: 'ManagedServices', quantity: 12, unitCost: 5000, marginPct: 20 }
    ]
    const result = optimizeBom(lines, baseContext({ targetBlendedMargin: 20 }))
    expect(result.lines[0].recommendedMarginPct).toBeGreaterThanOrEqual(12)
  })
})

// ── All-hardware BOM ─────────────────────────────────────────────

describe('all-hardware BOM', () => {
  it('handles BOM with only Hardware lines', () => {
    const lines = [
      hwLine({ partNumber: 'SW-A', quantity: 5, unitCost: 10000 }),
      hwLine({ partNumber: 'SW-B', quantity: 3, unitCost: 8000 })
    ]
    const result = optimizeBom(lines, baseContext({ targetBlendedMargin: 12 }))
    expect(result.lines).toHaveLength(2)
    result.lines.forEach(l => {
      expect(l.recommendedMarginPct).toBeGreaterThanOrEqual(5) // Hardware floor
    })
  })

  it('generates insight about hardware-heavy BOM', () => {
    const lines = [hwLine({ quantity: 50, unitCost: 10000 })]
    const result = optimizeBom(lines, baseContext({ targetBlendedMargin: 20 }))
    const hasHwInsight = result.recommendations.insights.some(i =>
      i.toLowerCase().includes('hardware')
    )
    expect(hasHwInsight).toBe(true)
  })
})

// ── Deal context adjustments ─────────────────────────────────────

describe('deal context adjustments', () => {
  it('competitive deals produce tighter hardware margins', () => {
    const lines = [hwLine(), svcLine()]
    // Use targetBlendedMargin: 0 to isolate context effect on category targets
    const relaxed = optimizeBom(lines, baseContext({ competitors: '0', targetBlendedMargin: 0 }))
    const competitive = optimizeBom(lines, baseContext({ competitors: '3+', targetBlendedMargin: 0 }))
    const hwRelaxed = relaxed.lines.find(l => l.partNumber === 'C9300-48P-A')
    const hwCompetitive = competitive.lines.find(l => l.partNumber === 'C9300-48P-A')
    // More competitive = lower or equal margin
    expect(hwCompetitive.recommendedMarginPct).toBeLessThanOrEqual(hwRelaxed.recommendedMarginPct)
  })

  it('high value-add allows higher margins', () => {
    const lines = [hwLine(), svcLine()]
    const low = optimizeBom(lines, baseContext({ valueAdd: 'Low', targetBlendedMargin: 0 }))
    const high = optimizeBom(lines, baseContext({ valueAdd: 'High', targetBlendedMargin: 0 }))
    expect(high.totals.blendedMarginPct).toBeGreaterThanOrEqual(low.totals.blendedMarginPct)
  })

  it('SMB segment gets higher base margins than Enterprise', () => {
    const lines = [hwLine()]
    const smb = optimizeBom(lines, baseContext({ customerSegment: 'SMB', targetBlendedMargin: 0 }))
    const ent = optimizeBom(lines, baseContext({ customerSegment: 'Enterprise', targetBlendedMargin: 0 }))
    expect(smb.totals.blendedMarginPct).toBeGreaterThanOrEqual(ent.totals.blendedMarginPct)
  })

  it('deal registration boosts margins', () => {
    const lines = [hwLine()]
    const noReg = optimizeBom(lines, baseContext({ dealRegType: 'NotRegistered', targetBlendedMargin: 0 }))
    const premium = optimizeBom(lines, baseContext({ dealRegType: 'PremiumHunting', targetBlendedMargin: 0 }))
    expect(premium.totals.blendedMarginPct).toBeGreaterThan(noReg.totals.blendedMarginPct)
  })
})

// ── Totals computation ───────────────────────────────────────────

describe('totals computation', () => {
  it('totalCost is sum of all extendedCosts', () => {
    const lines = [hwLine(), svcLine()]
    const result = optimizeBom(lines, baseContext())
    const sumCost = result.lines.reduce((s, l) => s + l.extendedCost, 0)
    expect(result.totals.totalCost).toBeCloseTo(sumCost, 1)
  })

  it('totalPrice is sum of all extendedPrices', () => {
    const lines = [hwLine(), svcLine()]
    const result = optimizeBom(lines, baseContext())
    const sumPrice = result.lines.reduce((s, l) => s + l.extendedPrice, 0)
    expect(result.totals.totalPrice).toBeCloseTo(sumPrice, 1)
  })

  it('totalGrossProfit = totalPrice - totalCost', () => {
    const lines = [hwLine(), svcLine()]
    const result = optimizeBom(lines, baseContext())
    expect(result.totals.totalGrossProfit).toBeCloseTo(
      result.totals.totalPrice - result.totals.totalCost, 1
    )
  })
})

// ── Response shape ───────────────────────────────────────────────

describe('response shape', () => {
  it('has lines, totals, and recommendations', () => {
    const result = optimizeBom([hwLine()], baseContext())
    expect(result).toHaveProperty('lines')
    expect(result).toHaveProperty('totals')
    expect(result).toHaveProperty('recommendations')
  })

  it('totals has all required fields', () => {
    const result = optimizeBom([hwLine()], baseContext())
    expect(result.totals).toHaveProperty('totalCost')
    expect(result.totals).toHaveProperty('totalPrice')
    expect(result.totals).toHaveProperty('blendedMarginPct')
    expect(result.totals).toHaveProperty('totalGrossProfit')
    expect(result.totals).toHaveProperty('targetAchieved')
    expect(result.totals).toHaveProperty('targetMarginPct')
    expect(result.totals).toHaveProperty('gap')
  })

  it('recommendations has healthScore and insights', () => {
    const result = optimizeBom([hwLine()], baseContext())
    expect(typeof result.recommendations.healthScore).toBe('number')
    expect(result.recommendations.healthScore).toBeGreaterThanOrEqual(0)
    expect(result.recommendations.healthScore).toBeLessThanOrEqual(100)
    expect(Array.isArray(result.recommendations.insights)).toBe(true)
    expect(result.recommendations.insights.length).toBeGreaterThan(0)
  })

  it('each line has required fields', () => {
    const result = optimizeBom([hwLine()], baseContext())
    const line = result.lines[0]
    expect(line).toHaveProperty('index')
    expect(line).toHaveProperty('currentMarginPct')
    expect(line).toHaveProperty('recommendedMarginPct')
    expect(line).toHaveProperty('marginFloor')
    expect(line).toHaveProperty('extendedCost')
    expect(line).toHaveProperty('extendedPrice')
    expect(line).toHaveProperty('grossProfit')
    expect(line).toHaveProperty('rationale')
    expect(typeof line.rationale).toBe('string')
    expect(line.rationale.length).toBeGreaterThan(0)
  })
})

// ── Health score ─────────────────────────────────────────────────

describe('health score', () => {
  it('is higher for deals with registration and high value-add', () => {
    const lines = [hwLine(), svcLine()]
    const good = optimizeBom(lines, baseContext({
      dealRegType: 'PremiumHunting',
      valueAdd: 'High',
      competitors: '0',
      relationshipStrength: 'Strategic',
      targetBlendedMargin: 15
    }))
    const bad = optimizeBom(lines, baseContext({
      dealRegType: 'NotRegistered',
      valueAdd: 'Low',
      competitors: '3+',
      relationshipStrength: 'New',
      targetBlendedMargin: 40
    }))
    expect(good.recommendations.healthScore).toBeGreaterThan(bad.recommendations.healthScore)
  })

  it('is between 0 and 100', () => {
    const result = optimizeBom([hwLine()], baseContext())
    expect(result.recommendations.healthScore).toBeGreaterThanOrEqual(0)
    expect(result.recommendations.healthScore).toBeLessThanOrEqual(100)
  })
})

// ── Insights ─────────────────────────────────────────────────────

describe('insights', () => {
  it('suggests deal registration when not registered', () => {
    const lines = [hwLine()]
    const result = optimizeBom(lines, baseContext({
      dealRegType: 'NotRegistered',
      targetBlendedMargin: 30
    }))
    const hasDealRegInsight = result.recommendations.insights.some(i =>
      i.toLowerCase().includes('deal registration')
    )
    expect(hasDealRegInsight).toBe(true)
  })

  it('flags heavy competition', () => {
    const lines = [hwLine()]
    const result = optimizeBom(lines, baseContext({ competitors: '3+' }))
    const hasCompInsight = result.recommendations.insights.some(i =>
      i.toLowerCase().includes('competition')
    )
    expect(hasCompInsight).toBe(true)
  })
})

// ── Edge cases ───────────────────────────────────────────────────

describe('edge cases', () => {
  it('handles zero-cost lines', () => {
    const line = { description: 'Free item', category: 'Hardware', quantity: 1, unitCost: 0, marginPct: 0 }
    const result = optimizeBom([line], baseContext())
    expect(result.lines).toHaveLength(1)
    expect(result.totals.totalCost).toBe(0)
  })

  it('handles missing context gracefully', () => {
    const result = optimizeBom([hwLine()], {})
    expect(result.lines).toHaveLength(1)
    expect(result.lines[0].recommendedMarginPct).toBeGreaterThanOrEqual(5)
  })

  it('handles null context', () => {
    const result = optimizeBom([hwLine()], null)
    expect(result.lines).toHaveLength(1)
  })

  it('handles undefined context', () => {
    const result = optimizeBom([hwLine()])
    expect(result.lines).toHaveLength(1)
  })

  it('defaults unknown category to Hardware floor', () => {
    const line = { description: 'Mystery', category: 'UnknownCategory', quantity: 1, unitCost: 100, marginPct: 5 }
    const result = optimizeBom([line], baseContext())
    expect(result.lines[0].marginFloor).toBe(5) // default floor
  })

  it('handles large BOM (20 lines)', () => {
    const lines = Array.from({ length: 20 }, (_, i) => ({
      partNumber: `PART-${i}`,
      category: i % 2 === 0 ? 'Hardware' : 'ProfessionalServices',
      quantity: 5,
      unitCost: 1000 + i * 100,
      marginPct: 10
    }))
    const result = optimizeBom(lines, baseContext({ targetBlendedMargin: 18 }))
    expect(result.lines).toHaveLength(20)
    expect(result.totals.totalCost).toBeGreaterThan(0)
  })

  it('preserves currentMarginPct from input', () => {
    const result = optimizeBom([hwLine({ marginPct: 15.7 })], baseContext())
    expect(result.lines[0].currentMarginPct).toBe(15.7)
  })

  it('handles very high target that exceeds all ceilings', () => {
    const result = optimizeBom([hwLine()], baseContext({ targetBlendedMargin: 99 }))
    expect(result.totals.targetAchieved).toBe(false)
    expect(result.totals.gap).toBeGreaterThan(0)
    // Should still have a reasonable recommendation, not NaN or Infinity
    expect(Number.isFinite(result.lines[0].recommendedMarginPct)).toBe(true)
    expect(Number.isFinite(result.totals.blendedMarginPct)).toBe(true)
  })

  it('handles negative unitCost (treated as 0)', () => {
    const result = optimizeBom([hwLine({ unitCost: -500 })], baseContext())
    expect(result.lines[0].extendedCost).toBe(0)
  })

  it('handles missing quantity (defaults to 1)', () => {
    const line = { partNumber: 'X', category: 'Hardware', unitCost: 1000, marginPct: 10 }
    const result = optimizeBom([line], baseContext())
    expect(result.lines[0].extendedCost).toBe(1000)
  })
})

// ── Multi-category mix ───────────────────────────────────────────

describe('multi-category mix', () => {
  it('optimizes across Hardware + Software + Services', () => {
    const lines = [
      { partNumber: 'HW-1', category: 'Hardware', quantity: 5, unitCost: 8000, marginPct: 10 },
      { partNumber: 'SW-1', category: 'Software', quantity: 10, unitCost: 500, marginPct: 15 },
      { description: 'Deploy', category: 'ProfessionalServices', quantity: 40, unitCost: 200, marginPct: 25 }
    ]
    const result = optimizeBom(lines, baseContext({ targetBlendedMargin: 15 }))
    expect(result.lines).toHaveLength(3)

    // Services should have highest margin, hardware lowest
    const hw = result.lines[0]
    const sw = result.lines[1]
    const svc = result.lines[2]
    expect(svc.recommendedMarginPct).toBeGreaterThanOrEqual(sw.recommendedMarginPct)
    expect(sw.recommendedMarginPct).toBeGreaterThanOrEqual(hw.recommendedMarginPct)
  })

  it('Cloud + ManagedServices mix', () => {
    const lines = [
      { description: 'Cloud capacity', category: 'Cloud', quantity: 12, unitCost: 3000, marginPct: 8 },
      { description: 'Managed oversight', category: 'ManagedServices', quantity: 12, unitCost: 2000, marginPct: 18 }
    ]
    const result = optimizeBom(lines, baseContext({ targetBlendedMargin: 16 }))
    expect(result.lines).toHaveLength(2)
    // Both should be above their respective floors
    expect(result.lines[0].recommendedMarginPct).toBeGreaterThanOrEqual(6)  // Cloud floor
    expect(result.lines[1].recommendedMarginPct).toBeGreaterThanOrEqual(12) // ManagedServices floor
  })
})
