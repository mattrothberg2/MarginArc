import { describe, it, expect } from '@jest/globals'
import {
  FEATURE_SPEC,
  featurize,
  computeNormStats,
  competitorToNum,
  getFeatureCount,
  FEATURE_DISPLAY_NAMES,
} from './features.js'

// ── Test helpers ─────────────────────────────────────────────────

function makeDeal(overrides = {}) {
  return {
    segment: 'Enterprise',
    industry: 'Technology',
    productCategory: 'Hardware',
    dealRegType: 'NotRegistered',
    competitors: '1',
    valueAdd: 'Medium',
    relationshipStrength: 'Good',
    customerTechSophistication: 'Medium',
    solutionComplexity: 'Medium',
    varStrategicImportance: 'Medium',
    customerPriceSensitivity: 3,
    customerLoyalty: 3,
    dealUrgency: 3,
    isNewLogo: false,
    solutionDifferentiation: 3,
    oemCost: 100000,
    oem: 'Cisco',
    servicesAttached: true,
    quarterEnd: false,
    competitorNames: ['CDW'],
    bomLineCount: 5,
    bomAvgMarginPct: 0.18,
    hasManualBom: false,
    achievedMargin: 0.185,
    status: 'Won',
    lossReason: '',
    ...overrides,
  }
}

function makeNormStats() {
  // Simple stats for testing — means at typical values, stds > 0
  return {
    means: {
      deal_size_log: 11.0,
      price_sensitivity: 3.0,
      customer_loyalty: 3.0,
      deal_urgency: 3.0,
      solution_differentiation: 3.0,
      bom_line_count: 4.0,
      competitor_count: 1.5,
      proposed_margin: 0.18,
    },
    stds: {
      deal_size_log: 1.5,
      price_sensitivity: 1.0,
      customer_loyalty: 1.0,
      deal_urgency: 1.0,
      solution_differentiation: 1.0,
      bom_line_count: 3.0,
      competitor_count: 1.2,
      proposed_margin: 0.05,
    },
  }
}

// ── Tests ────────────────────────────────────────────────────────

describe('features.js', () => {
  describe('featurize() — complete deal', () => {
    it('returns a vector of length 29 with correct feature names', () => {
      const deal = makeDeal()
      const stats = makeNormStats()
      const { features, featureNames } = featurize(deal, stats)

      expect(features).toHaveLength(29)
      expect(featureNames).toHaveLength(29)
      expect(getFeatureCount()).toBe(29)

      // Verify all features are numbers
      for (const f of features) {
        expect(typeof f).toBe('number')
        expect(Number.isFinite(f)).toBe(true)
      }

      // Spot-check some feature names
      expect(featureNames).toContain('deal_size_log')
      expect(featureNames).toContain('proposed_margin')
      expect(featureNames).toContain('is_new_logo')
      expect(featureNames).toContain('oem_top_Cisco')
      expect(featureNames).toContain('segment_SMB')
    })
  })

  describe('featurize() — missing nullable fields', () => {
    it('imputes continuous fields to mean (normalized 0), binary to 0', () => {
      const deal = makeDeal({
        customerPriceSensitivity: null,
        customerLoyalty: undefined,
        dealUrgency: null,
        isNewLogo: null,
        servicesAttached: null,
        quarterEnd: null,
        solutionDifferentiation: null,
      })
      const stats = makeNormStats()
      const { features, featureNames } = featurize(deal, stats)

      expect(features).toHaveLength(29)

      // price_sensitivity with null → source returns 3 (imputed), which matches mean 3 → normalized 0
      const psIdx = featureNames.indexOf('price_sensitivity')
      expect(features[psIdx]).toBeCloseTo(0, 5)

      // customer_loyalty with undefined → source returns 3 → normalized 0
      const clIdx = featureNames.indexOf('customer_loyalty')
      expect(features[clIdx]).toBeCloseTo(0, 5)

      // Binary fields with null → 0
      const inlIdx = featureNames.indexOf('is_new_logo')
      expect(features[inlIdx]).toBe(0)

      const saIdx = featureNames.indexOf('services_attached')
      expect(features[saIdx]).toBe(0)

      const qeIdx = featureNames.indexOf('quarter_end')
      expect(features[qeIdx]).toBe(0)
    })
  })

  describe('computeNormStats()', () => {
    it('computes correct mean and std for continuous features', () => {
      // Create 10 synthetic deals with varying values
      const deals = []
      for (let i = 0; i < 10; i++) {
        deals.push(
          makeDeal({
            oemCost: 50000 + i * 10000, // 50K to 140K
            customerPriceSensitivity: (i % 5) + 1, // 1-5 cycling
            customerLoyalty: 3,
            dealUrgency: 2 + (i % 3), // 2, 3, 4 cycling
            solutionDifferentiation: 3,
            bomLineCount: i,
            competitors: String(Math.min(i % 4, 2)) || '0',
            achievedMargin: 0.10 + i * 0.02, // 0.10 to 0.28
          })
        )
      }

      const stats = computeNormStats(deals)

      // Verify all continuous features have means and stds
      const continuousNames = FEATURE_SPEC.filter((s) => s.type === 'continuous').map((s) => s.name)
      for (const name of continuousNames) {
        expect(stats.means[name]).toBeDefined()
        expect(stats.stds[name]).toBeDefined()
        expect(typeof stats.means[name]).toBe('number')
        expect(typeof stats.stds[name]).toBe('number')
        expect(stats.stds[name]).toBeGreaterThan(0)
      }

      // Spot-check: deal_size_log mean should be around log(95001) ≈ 11.46
      // Values: log(50001), log(60001), ..., log(140001)
      const logValues = []
      for (let i = 0; i < 10; i++) {
        logValues.push(Math.log(50000 + i * 10000 + 1))
      }
      const expectedMean = logValues.reduce((a, b) => a + b, 0) / 10
      expect(stats.means.deal_size_log).toBeCloseTo(expectedMean, 4)

      // Verify population std (not sample)
      const variance = logValues.reduce((a, v) => a + (v - expectedMean) ** 2, 0) / 10
      const expectedStd = Math.sqrt(variance)
      expect(stats.stds.deal_size_log).toBeCloseTo(expectedStd, 4)
    })
  })

  describe('one-hot encoding', () => {
    it('Cisco OEM → oem_top_Cisco=1, others=0; unknown OEM → all zeros', () => {
      const stats = makeNormStats()

      // Cisco deal
      const ciscoDeal = makeDeal({ oem: 'Cisco' })
      const { features: ciscoF, featureNames } = featurize(ciscoDeal, stats)
      const ciscoIdx = featureNames.indexOf('oem_top_Cisco')
      expect(ciscoF[ciscoIdx]).toBe(1)

      // Other OEM indicators should be 0
      const oemIndices = featureNames
        .map((n, i) => (n.startsWith('oem_top_') ? i : -1))
        .filter((i) => i >= 0 && i !== ciscoIdx)
      for (const idx of oemIndices) {
        expect(ciscoF[idx]).toBe(0)
      }

      // Unknown OEM → all OEM features = 0 (treated as dropped 'Other' category)
      const unknownDeal = makeDeal({ oem: 'Juniper' })
      const { features: unknownF } = featurize(unknownDeal, stats)
      const allOemIndices = featureNames
        .map((n, i) => (n.startsWith('oem_top_') ? i : -1))
        .filter((i) => i >= 0)
      for (const idx of allOemIndices) {
        expect(unknownF[idx]).toBe(0)
      }
    })
  })

  describe('log transform', () => {
    it('oem_cost of 100000 → deal_size_log ≈ 11.51', () => {
      const deal = makeDeal({ oemCost: 100000 })
      // Use stats where mean=0, std=1 to get raw transformed value
      const rawStats = {
        means: { ...makeNormStats().means, deal_size_log: 0 },
        stds: { ...makeNormStats().stds, deal_size_log: 1 },
      }
      const { features, featureNames } = featurize(deal, rawStats)
      const idx = featureNames.indexOf('deal_size_log')
      // Math.log(100001) ≈ 11.5129
      expect(features[idx]).toBeCloseTo(Math.log(100001), 3)
      expect(features[idx]).toBeCloseTo(11.5129, 2)
    })
  })

  describe('competitorToNum()', () => {
    it("'3+' → 4", () => {
      expect(competitorToNum('3+')).toBe(4)
    })

    it("'0' → 0, '1' → 1, '2' → 2", () => {
      expect(competitorToNum('0')).toBe(0)
      expect(competitorToNum('1')).toBe(1)
      expect(competitorToNum('2')).toBe(2)
    })
  })

  describe('proposedMargin override', () => {
    it('uses options.proposedMargin instead of deal.achievedMargin', () => {
      const deal = makeDeal({ achievedMargin: 0.185 })
      const stats = makeNormStats()

      // Without override: uses achievedMargin
      const { features: f1, featureNames } = featurize(deal, stats)
      const pmIdx = featureNames.indexOf('proposed_margin')
      const expectedDefault = (0.185 - stats.means.proposed_margin) / stats.stds.proposed_margin
      expect(f1[pmIdx]).toBeCloseTo(expectedDefault, 5)

      // With override: uses proposedMargin
      const { features: f2 } = featurize(deal, stats, { proposedMargin: 0.25 })
      const expectedOverride = (0.25 - stats.means.proposed_margin) / stats.stds.proposed_margin
      expect(f2[pmIdx]).toBeCloseTo(expectedOverride, 5)

      // They should differ
      expect(f1[pmIdx]).not.toBeCloseTo(f2[pmIdx], 5)
    })
  })

  describe('product category mapping', () => {
    it("'ProfessionalServices' → 'Services', 'Cloud' → 'Software'", () => {
      const stats = makeNormStats()

      // ProfessionalServices → Services
      const psDeal = makeDeal({ productCategory: 'ProfessionalServices' })
      const { features: psF, featureNames } = featurize(psDeal, stats)
      const servicesIdx = featureNames.indexOf('product_cat_Services')
      expect(psF[servicesIdx]).toBe(1)

      // Cloud → Software
      const cloudDeal = makeDeal({ productCategory: 'Cloud' })
      const { features: cloudF } = featurize(cloudDeal, stats)
      const softwareIdx = featureNames.indexOf('product_cat_Software')
      expect(cloudF[softwareIdx]).toBe(1)
      // Services should be 0 for Cloud deal
      expect(cloudF[servicesIdx]).toBe(0)
    })

    it("'ManagedServices' → 'Services', 'ComplexSolution' → 'Other' (all zeros)", () => {
      const stats = makeNormStats()

      const msDeal = makeDeal({ productCategory: 'ManagedServices' })
      const { features: msF, featureNames } = featurize(msDeal, stats)
      const servicesIdx = featureNames.indexOf('product_cat_Services')
      expect(msF[servicesIdx]).toBe(1)

      // ComplexSolution → Other (dropped category, all zeros)
      const csDeal = makeDeal({ productCategory: 'ComplexSolution' })
      const { features: csF } = featurize(csDeal, stats)
      const pcIndices = featureNames
        .map((n, i) => (n.startsWith('product_cat_') ? i : -1))
        .filter((i) => i >= 0)
      for (const idx of pcIndices) {
        expect(csF[idx]).toBe(0)
      }
    })
  })

  describe('deal reg mapping', () => {
    it("'Teaming' maps to 'StandardApproved'", () => {
      const stats = makeNormStats()

      const teamingDeal = makeDeal({ dealRegType: 'Teaming' })
      const { features: tF, featureNames } = featurize(teamingDeal, stats)
      const saIdx = featureNames.indexOf('deal_reg_StandardApproved')
      expect(tF[saIdx]).toBe(1)

      // Should match an explicit StandardApproved deal
      const saDeal = makeDeal({ dealRegType: 'StandardApproved' })
      const { features: saF } = featurize(saDeal, stats)
      expect(saF[saIdx]).toBe(1)
    })
  })

  describe('edge case: all-same values in computeNormStats', () => {
    it('returns std of 1 (not 0) when all values are identical', () => {
      const deals = Array.from({ length: 5 }, () =>
        makeDeal({
          oemCost: 100000,
          customerPriceSensitivity: 3,
          customerLoyalty: 3,
          dealUrgency: 3,
          solutionDifferentiation: 3,
          bomLineCount: 5,
          competitors: '1',
          achievedMargin: 0.185,
        })
      )

      const stats = computeNormStats(deals)

      // All stds should be 1 since all values are identical
      for (const name of Object.keys(stats.stds)) {
        expect(stats.stds[name]).toBe(1)
      }
    })
  })
})
