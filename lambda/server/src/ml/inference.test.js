import { describe, it, expect } from '@jest/globals'
import { recommendMargin, computeConfidence } from './inference.js'
import { getFeatureCount, computeNormStats, FEATURE_SPEC } from './features.js'
import { serializeModel, getFeatureImportance } from './logistic-regression.js'

// ── Build a deterministic mock model package ────────────────────
// 29 features — proposed_margin (index 7) gets a large negative weight
// so higher margin → lower pWin (realistic behavior).

const FEATURE_COUNT = getFeatureCount() // 29

function buildMockModelPackage() {
  // Weights tuned so expectedGP peaks where pWin is between 0.45–0.70,
  // ensuring conservative < optimal < aggressive ordering.
  const weights = new Array(FEATURE_COUNT).fill(0.02)
  weights[7] = -1.5   // proposed_margin — moderate negative: higher margin → lower pWin

  // Set a few other recognizable weights for key drivers test
  weights[0] = 0.08   // deal_size_log — positive
  weights[1] = -0.06  // price_sensitivity — negative
  weights[2] = 0.07   // customer_loyalty — positive
  weights[3] = 0.05   // deal_urgency — positive

  const model = {
    weights,
    bias: 0.5,  // moderate bias: pWin transitions through 0.45–0.70 in the 15–25% margin zone
    featureCount: FEATURE_COUNT,
    epochsRun: 100,
    trainLoss: 0.4,
    valLoss: 0.45,
    trainedAt: '2026-02-01T00:00:00.000Z'
  }

  // Build feature names matching the expanded feature spec
  const featureNames = []
  for (const spec of FEATURE_SPEC) {
    if (spec.type === 'categorical') {
      const cats = spec.categories.slice(0, -1)
      for (const cat of cats) {
        featureNames.push(`${spec.name}_${cat}`)
      }
    } else {
      featureNames.push(spec.name)
    }
  }

  const importance = getFeatureImportance(model, featureNames)

  // Norm stats: means/stds for continuous features
  const normStats = {
    means: {
      deal_size_log: 10,
      price_sensitivity: 3,
      customer_loyalty: 3,
      deal_urgency: 3,
      solution_differentiation: 3,
      bom_line_count: 5,
      competitor_count: 1.5,
      proposed_margin: 0.18
    },
    stds: {
      deal_size_log: 2,
      price_sensitivity: 1,
      customer_loyalty: 1,
      deal_urgency: 1,
      solution_differentiation: 1,
      bom_line_count: 3,
      competitor_count: 1,
      proposed_margin: 0.08
    }
  }

  return {
    model: serializeModel(model),
    normStats,
    featureNames,
    metrics: { auc: 0.75, logLoss: 0.45, accuracy: 0.72, n: 300 },
    importance,
    dealCount: 200,
    trainedAt: '2026-02-01T00:00:00.000Z',
    version: 1
  }
}

// Mock deal input matching the DealInput schema (camelCase)
const mockDealInput = {
  oemCost: 50000,
  oem: 'Cisco',
  customerSegment: 'MidMarket',
  productCategory: 'Hardware',
  customerPriceSensitivity: 4,
  customerLoyalty: 3,
  dealUrgency: 3,
  solutionDifferentiation: 3,
  competitors: '2',
  isNewLogo: false,
  servicesAttached: true,
  quarterEnd: false,
  bomLineCount: 5,
  dealRegType: 'StandardApproved',
  solutionComplexity: 'Medium',
  relationshipStrength: 'Good'
}

describe('recommendMargin', () => {
  const modelPackage = buildMockModelPackage()

  it('should produce monotonic pWin decrease as margin increases', () => {
    const result = recommendMargin(mockDealInput, modelPackage)
    const curve = result.expectedGPCurve

    // The curve is every 3rd point, so check pWin is non-increasing
    for (let i = 1; i < curve.length; i++) {
      expect(curve[i].pWin).toBeLessThanOrEqual(curve[i - 1].pWin)
    }
  })

  it('should find optimal margin that maximizes expectedGP (not at extremes)', () => {
    const result = recommendMargin(mockDealInput, modelPackage)

    // Optimal should not be the minimum margin (5%) or maximum margin (35%)
    expect(result.suggestedMarginPct).toBeGreaterThan(5.0)
    expect(result.suggestedMarginPct).toBeLessThan(35.0)
  })

  it('should have conservative pWin >= aggressive pWin', () => {
    const result = recommendMargin(mockDealInput, modelPackage)

    // We need to look up the pWin for each option via the curve or re-derive
    // Since conservative has pWin >= 0.70 and aggressive has pWin >= 0.45,
    // conservative margin <= aggressive margin means conservative pWin >= aggressive pWin
    expect(result.conservativeMarginPct).toBeLessThanOrEqual(result.aggressiveMarginPct)
  })

  it('should have three options in correct order: conservative <= optimal <= aggressive', () => {
    const result = recommendMargin(mockDealInput, modelPackage)

    expect(result.conservativeMarginPct).toBeLessThanOrEqual(result.suggestedMarginPct)
    expect(result.suggestedMarginPct).toBeLessThanOrEqual(result.aggressiveMarginPct)
  })

  it('should generate 5 key drivers with required fields', () => {
    const result = recommendMargin(mockDealInput, modelPackage)

    expect(result.keyDrivers).toHaveLength(5)
    for (const driver of result.keyDrivers) {
      expect(driver).toHaveProperty('name')
      expect(driver).toHaveProperty('sentence')
      expect(driver).toHaveProperty('impact')
      expect(driver).toHaveProperty('direction')
      expect(typeof driver.name).toBe('string')
      expect(typeof driver.sentence).toBe('string')
      expect(typeof driver.impact).toBe('number')
      expect(['positive', 'negative']).toContain(driver.direction)
    }
  })

  it('should produce a non-empty GP curve', () => {
    const result = recommendMargin(mockDealInput, modelPackage)

    expect(result.expectedGPCurve.length).toBeGreaterThan(0)
    for (const pt of result.expectedGPCurve) {
      expect(pt).toHaveProperty('margin')
      expect(pt).toHaveProperty('pWin')
      expect(pt).toHaveProperty('expectedGP')
    }
  })

  it('should set source to ml_model', () => {
    const result = recommendMargin(mockDealInput, modelPackage)

    expect(result.source).toBe('ml_model')
  })

  it('should include model metrics in result', () => {
    const result = recommendMargin(mockDealInput, modelPackage)

    expect(result.modelMetrics).toEqual({
      auc: 0.75,
      dealCount: 200,
      trainedAt: '2026-02-01T00:00:00.000Z'
    })
  })
})

describe('computeConfidence', () => {
  it('should return confidence between 0.1 and 0.95 for typical inputs', () => {
    const modelPackage = { metrics: { auc: 0.75 }, dealCount: 200 }
    const confidence = computeConfidence(modelPackage, mockDealInput)

    expect(confidence).toBeGreaterThanOrEqual(0.1)
    expect(confidence).toBeLessThanOrEqual(0.95)
  })

  it('should return minimum 0.1 for AUC near 0.5', () => {
    const modelPackage = { metrics: { auc: 0.51 }, dealCount: 10 }
    const confidence = computeConfidence(modelPackage, mockDealInput)

    expect(confidence).toBe(0.1)
  })

  it('should increase with higher AUC', () => {
    const low = computeConfidence({ metrics: { auc: 0.60 }, dealCount: 500 }, mockDealInput)
    const high = computeConfidence({ metrics: { auc: 0.85 }, dealCount: 500 }, mockDealInput)

    expect(high).toBeGreaterThan(low)
  })

  it('should increase with more training data', () => {
    const few = computeConfidence({ metrics: { auc: 0.75 }, dealCount: 50 }, mockDealInput)
    const many = computeConfidence({ metrics: { auc: 0.75 }, dealCount: 500 }, mockDealInput)

    expect(many).toBeGreaterThan(few)
  })
})
