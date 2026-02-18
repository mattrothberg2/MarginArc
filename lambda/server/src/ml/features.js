// ── Feature Engineering for ML Margin Optimizer ─────────────────
// Converts raw deal records into numeric feature vectors for
// logistic regression training and inference.

// ── Helpers ──────────────────────────────────────────────────────

/**
 * Convert competitor string to numeric value.
 * '0'→0, '1'→1, '2'→2, '3+'→4
 */
export function competitorToNum(str) {
  if (str === '3+') return 4
  const n = parseInt(str, 10)
  return Number.isFinite(n) ? n : 0
}

/**
 * Map product category DB values to model categories.
 */
function mapProductCategory(cat) {
  if (cat === 'ProfessionalServices' || cat === 'ManagedServices') return 'Services'
  if (cat === 'Cloud') return 'Software'
  if (cat === 'ComplexSolution') return 'Other'
  if (cat === 'Hardware' || cat === 'Software' || cat === 'Services') return cat
  return 'Other'
}

/**
 * Map deal reg type DB values to model categories.
 * 'Teaming' → 'StandardApproved'
 */
function mapDealReg(reg) {
  if (reg === 'Teaming') return 'StandardApproved'
  return reg
}

/**
 * Map OEM name to top-OEM category.
 */
const TOP_OEMS = new Set(['Cisco', 'Dell', 'HPE', 'Microsoft', 'Palo Alto', 'CrowdStrike'])
function mapOem(oem) {
  if (oem && TOP_OEMS.has(oem)) return oem
  return 'Other'
}

// ── Feature Specification ────────────────────────────────────────

export const FEATURE_SPEC = [
  // --- Continuous (8) ---
  {
    name: 'deal_size_log',
    type: 'continuous',
    source: (deal) => Math.log((deal.oemCost ?? 0) + 1),
  },
  {
    name: 'price_sensitivity',
    type: 'continuous',
    source: (deal) => deal.customerPriceSensitivity ?? 3,
  },
  {
    name: 'customer_loyalty',
    type: 'continuous',
    source: (deal) => deal.customerLoyalty ?? 3,
  },
  {
    name: 'deal_urgency',
    type: 'continuous',
    source: (deal) => deal.dealUrgency ?? 3,
  },
  {
    name: 'solution_differentiation',
    type: 'continuous',
    source: (deal) => deal.solutionDifferentiation ?? 3,
  },
  {
    name: 'bom_line_count',
    type: 'continuous',
    source: (deal) => deal.bomLineCount ?? 0,
  },
  {
    name: 'competitor_count',
    type: 'continuous',
    source: (deal) => competitorToNum(deal.competitors ?? '0'),
  },
  {
    name: 'proposed_margin',
    type: 'continuous',
    source: (deal) => deal.achievedMargin ?? 0,
  },

  // --- Binary (4) ---
  {
    name: 'is_new_logo',
    type: 'binary',
    source: (deal) => (deal.isNewLogo ? 1 : 0),
  },
  {
    name: 'services_attached',
    type: 'binary',
    source: (deal) => (deal.servicesAttached ? 1 : 0),
  },
  {
    name: 'quarter_end',
    type: 'binary',
    source: (deal) => (deal.quarterEnd ? 1 : 0),
  },
  {
    name: 'has_bom',
    type: 'binary',
    source: (deal) => ((deal.bomLineCount ?? 0) > 0 ? 1 : 0),
  },

  // --- Categorical (6 groups, one-hot, drop last) ---
  {
    name: 'segment',
    type: 'categorical',
    source: (deal) => deal.segment,
    categories: ['SMB', 'MidMarket', 'Enterprise'],
  },
  {
    name: 'deal_reg',
    type: 'categorical',
    source: (deal) => mapDealReg(deal.dealRegType),
    categories: ['NotRegistered', 'StandardApproved', 'PremiumHunting'],
  },
  {
    name: 'complexity',
    type: 'categorical',
    source: (deal) => deal.solutionComplexity,
    categories: ['Low', 'Medium', 'High'],
  },
  {
    name: 'relationship',
    type: 'categorical',
    source: (deal) => deal.relationshipStrength,
    categories: ['New', 'Good', 'Strategic'],
  },
  {
    name: 'oem_top',
    type: 'categorical',
    source: (deal) => mapOem(deal.oem),
    categories: ['Cisco', 'Dell', 'HPE', 'Microsoft', 'Palo Alto', 'CrowdStrike', 'Other'],
  },
  {
    name: 'product_cat',
    type: 'categorical',
    source: (deal) => mapProductCategory(deal.productCategory),
    categories: ['Hardware', 'Software', 'Services', 'Other'],
  },
]

// ── Derived feature names (expanded) ─────────────────────────────

function buildFeatureNames() {
  const names = []
  for (const spec of FEATURE_SPEC) {
    if (spec.type === 'categorical') {
      // One-hot, drop last category
      const cats = spec.categories.slice(0, -1)
      for (const cat of cats) {
        names.push(`${spec.name}_${cat}`)
      }
    } else {
      names.push(spec.name)
    }
  }
  return names
}

const EXPANDED_NAMES = buildFeatureNames()

/**
 * Returns the expected feature vector length (29).
 */
export function getFeatureCount() {
  return EXPANDED_NAMES.length
}

// ── Display names ────────────────────────────────────────────────

export const FEATURE_DISPLAY_NAMES = {
  // Continuous
  deal_size_log: 'Deal Size',
  price_sensitivity: 'Price Sensitivity',
  customer_loyalty: 'Customer Loyalty',
  deal_urgency: 'Deal Urgency',
  solution_differentiation: 'Solution Differentiation',
  bom_line_count: 'BOM Line Count',
  competitor_count: 'Competitor Count',
  proposed_margin: 'Proposed Margin',

  // Binary
  is_new_logo: 'New Logo',
  services_attached: 'Services Attached',
  quarter_end: 'Quarter End',
  has_bom: 'Has BOM',

  // Categorical — segment
  segment_SMB: 'SMB Segment',
  segment_MidMarket: 'Mid-Market Segment',

  // Categorical — deal_reg
  deal_reg_NotRegistered: 'Not Registered',
  deal_reg_StandardApproved: 'Standard Approved',

  // Categorical — complexity
  complexity_Low: 'Low Complexity',
  complexity_Medium: 'Medium Complexity',

  // Categorical — relationship
  relationship_New: 'New Relationship',
  relationship_Good: 'Good Relationship',

  // Categorical — oem_top
  oem_top_Cisco: 'Cisco (OEM)',
  oem_top_Dell: 'Dell (OEM)',
  oem_top_HPE: 'HPE (OEM)',
  oem_top_Microsoft: 'Microsoft (OEM)',
  'oem_top_Palo Alto': 'Palo Alto (OEM)',
  oem_top_CrowdStrike: 'CrowdStrike (OEM)',

  // Categorical — product_cat
  product_cat_Hardware: 'Hardware',
  product_cat_Software: 'Software',
  product_cat_Services: 'Services',
}

// ── Normalization stats ──────────────────────────────────────────

/**
 * Compute mean and population std for each continuous feature.
 * Returns { means: { name→number }, stds: { name→number } }
 */
export function computeNormStats(deals) {
  const continuousSpecs = FEATURE_SPEC.filter((s) => s.type === 'continuous')
  const means = {}
  const stds = {}

  for (const spec of continuousSpecs) {
    const values = deals.map((d) => spec.source(d))
    const n = values.length
    const mean = n > 0 ? values.reduce((a, b) => a + b, 0) / n : 0
    const variance =
      n > 0 ? values.reduce((a, v) => a + (v - mean) ** 2, 0) / n : 0
    const std = Math.sqrt(variance)
    means[spec.name] = mean
    stds[spec.name] = std === 0 ? 1 : std
  }

  return { means, stds }
}

// ── Featurize ────────────────────────────────────────────────────

/**
 * Transform a single deal object into a numeric feature vector.
 *
 * @param {object} deal - camelCase deal object
 * @param {{ means: object, stds: object }} normStats - from computeNormStats
 * @param {{ proposedMargin?: number }} [options] - overrides
 * @returns {{ features: number[], featureNames: string[] }}
 */
export function featurize(deal, normStats, options = {}) {
  const features = []
  const featureNames = []

  for (const spec of FEATURE_SPEC) {
    if (spec.type === 'continuous') {
      let value
      if (spec.name === 'proposed_margin' && options.proposedMargin != null) {
        value = options.proposedMargin
      } else {
        value = spec.source(deal)
      }
      const mean = normStats.means[spec.name] ?? 0
      const std = normStats.stds[spec.name] || 1
      if (value == null) {
        // Impute to mean → normalized = 0
        features.push(0)
      } else {
        features.push((value - mean) / std)
      }
      featureNames.push(spec.name)
    } else if (spec.type === 'binary') {
      features.push(spec.source(deal))
      featureNames.push(spec.name)
    } else if (spec.type === 'categorical') {
      const rawValue = spec.source(deal)
      const cats = spec.categories.slice(0, -1) // drop last
      for (const cat of cats) {
        features.push(rawValue === cat ? 1 : 0)
        featureNames.push(`${spec.name}_${cat}`)
      }
    }
  }

  return { features, featureNames }
}
