import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import seedrandom from 'seedrandom'
import { buildBillOfMaterials, computeManualBomStats } from '../bom.js'
import { ruleBasedRecommendation } from '../rules.js'
import { getScenario, listScenarios } from './scenarios.js'

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

const cliArgs = process.argv.slice(2)
function getArg(name) {
  const prefix = `--${name}=`
  const arg = cliArgs.find(a => a.startsWith(prefix))
  return arg ? arg.slice(prefix.length) : null
}

const scenarioKey = getArg('scenario')
const cliDealCount = getArg('deals') ? parseInt(getArg('deals'), 10) : null
const cliOutput = getArg('output')

let activeScenario = null
if (scenarioKey) {
  activeScenario = getScenario(scenarioKey)
  if (!activeScenario) {
    console.error(`Unknown scenario: "${scenarioKey}"`)
    console.error(`Available scenarios: ${listScenarios().join(', ')}`)
    process.exit(1)
  }
}

// Seeded RNG keeps demo data reproducible (scenario-specific seed when active)
seedrandom(activeScenario ? `fulcrum-${scenarioKey}` : 'fulcrum-var-v2', { global: true })

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const customers = JSON.parse(fs.readFileSync(path.join(__dirname, 'customers.json'), 'utf-8'))
const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, 'bom_catalog.json'), 'utf-8'))
const catalogById = new Map(catalog.map(item => [item.productId, item]))
const presets = JSON.parse(fs.readFileSync(path.join(__dirname, 'bom_presets.json'), 'utf-8'))
const vendorSkuFlat = JSON.parse(fs.readFileSync(path.join(__dirname, 'vendor_skus.json'), 'utf-8'))

// Build nested index from flat array: { vendor: { category: { role: [skus] } } }
const vendorSkuData = {}
for (const item of vendorSkuFlat) {
  const vendor = item.manufacturer
  if (!vendorSkuData[vendor]) vendorSkuData[vendor] = {}
  if (!vendorSkuData[vendor][item.category]) vendorSkuData[vendor][item.category] = {}
  const subRoles = _mapToSubRoles(item.category, item.role)
  for (const sr of subRoles) {
    if (!vendorSkuData[vendor][item.category][sr]) vendorSkuData[vendor][item.category][sr] = []
    vendorSkuData[vendor][item.category][sr].push({
      sku: item.partNumber,
      name: item.description,
      listPrice: item.listPrice
    })
  }
}

function _mapToSubRoles(category, role) {
  if (role === 'core') return ['core', 'platform']
  if (role === 'accessory') return ['core']
  if (role === 'support') return ['support']
  if (role === 'license') {
    if (category === 'Software') return ['subscription', 'software']
    if (category === 'Cloud') return ['capacity']
    return ['subscription']
  }
  if (role === 'service') {
    if (category === 'ProfessionalServices') return ['consulting', 'specialists', 'services', 'program']
    if (category === 'ManagedServices') return ['subscription', 'managed', 'automation']
    return ['services', 'onboarding', 'enablement']
  }
  return [role]
}

// ---------------------------------------------------------------------------
// Utility functions
// ---------------------------------------------------------------------------

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val))
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function randNormal(mean = 0, sd = 1) {
  let u = 0, v = 0
  while (u === 0) u = Math.random()
  while (v === 0) v = Math.random()
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
  return z * sd + mean
}

function randGamma(k) {
  if (k < 1) {
    const u = Math.random()
    return randGamma(k + 1) * Math.pow(u, 1 / k)
  }
  const d = k - 1 / 3
  const c = 1 / Math.sqrt(9 * d)
  while (true) {
    let x, v
    do {
      x = randNormal()
      v = 1 + c * x
    } while (v <= 0)
    v = v * v * v
    const u = Math.random()
    if (u < 1 - 0.0331 * x ** 4) return d * v
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v
  }
}

function randBeta(a, b) {
  const x = randGamma(a)
  const y = randGamma(b)
  return x / (x + y)
}

function weightedPick(weights) {
  const r = Math.random()
  let acc = 0
  for (const [k, w] of Object.entries(weights)) {
    acc += w
    if (r < acc) return k
  }
  return Object.keys(weights)[0]
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)]
}

function pickN(arr, n) {
  const shuffled = [...arr].sort(() => Math.random() - 0.5)
  return shuffled.slice(0, n)
}

function randLogNormal(meanVal, sdFactor) {
  const mu = Math.log(meanVal) - 0.5 * sdFactor * sdFactor
  return Math.exp(randNormal(mu, sdFactor))
}

function formatDate(d) {
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function getQuarter(d) {
  return Math.floor(d.getMonth() / 3) + 1
}

function getQuarterLabel(d) {
  return `Q${getQuarter(d)} ${d.getFullYear()}`
}

// ---------------------------------------------------------------------------
// BOM helpers (simplified for speed — full BOM only for recent deals)
// ---------------------------------------------------------------------------

function selectCatalogProduct(excludeSet = new Set()) {
  const pool = catalog.filter(item => !excludeSet.has(item.productId))
  if (!pool.length) return catalog[Math.floor(Math.random() * catalog.length)]
  return pool[Math.floor(Math.random() * pool.length)]
}

function buildManualLineFromCatalog(product, quantity = 1, overrides = {}) {
  const discountRate = clamp(overrides.overrideDiscountRate ?? (product.discountRate + randNormal(0, 0.015)), 0.05, 0.4)
  const marginTarget = clamp(overrides.overrideMargin ?? (product.marginTarget + randNormal(0, 0.015)), 0.05, 0.45)
  const unitList = Math.round(product.listPrice * 100) / 100
  const unitDiscounted = Math.round(unitList * (1 - discountRate) * 100) / 100
  const unitFinal = Math.round(unitDiscounted * (1 + marginTarget) * 100) / 100
  return {
    description: product.name,
    productNumber: product.productId,
    productId: product.productId,
    vendor: product.vendor,
    listPrice: unitList,
    discountedPrice: unitDiscounted,
    priceAfterMargin: unitFinal,
    quantity,
    recommendedMarginPct: +(marginTarget * 100).toFixed(1)
  }
}

function createManualBomLinesFromPreset(preset) {
  return preset.lines.map(line => {
    const product = catalogById.get(line.productId) || selectCatalogProduct()
    return buildManualLineFromCatalog(product, line.quantity ?? 1, {
      overrideDiscountRate: line.overrideDiscountRate,
      overrideMargin: line.overrideMargin
    })
  })
}

function createManualBomLinesRandom() {
  const bomAvg = activeScenario?.bomLinesAvg || 3
  const bomSd = activeScenario?.bomLinesSd ? activeScenario.bomLinesSd * 0.5 : 1
  const count = Math.min(8, Math.max(2, Math.round(randNormal(bomAvg, bomSd))))
  const used = new Set()
  const lines = []
  for (let i = 0; i < count; i++) {
    const product = selectCatalogProduct(used)
    used.add(product.productId)
    const quantity = Math.max(1, Math.round(randNormal(1.5, 0.75)))
    lines.push(buildManualLineFromCatalog(product, quantity))
  }
  return lines
}

function createManualBomLines(options = {}) {
  if (options.preset) return createManualBomLinesFromPreset(options.preset)
  return createManualBomLinesRandom()
}

// ---------------------------------------------------------------------------
// BOM generation from vendor_skus.json (all deals)
// ---------------------------------------------------------------------------

// Deal amount → BOM line count by deal size tier
function bomLineCountForAmount(amount) {
  if (amount < 50000) return randomInt(2, 4)
  if (amount < 200000) return randomInt(4, 8)
  if (amount < 500000) return randomInt(6, 12)
  return randomInt(8, 20)
}

// Per-line margin ranges by BOM category (as decimals)
const BOM_MARGIN_RANGES = {
  'Hardware':              [0.08, 0.18],
  'Software':              [0.12, 0.25],
  'Cloud':                 [0.10, 0.20],
  'Professional Services': [0.25, 0.45],
  'Managed Services':      [0.20, 0.35],
  'Support':               [0.12, 0.22]
}

// Line slot recipes by Lambda product category
// weight = relative cost share; multi = can repeat for larger BOMs
const BOM_SLOT_RECIPES = {
  Hardware: [
    { skuCat: 'Hardware', skuRole: 'core', bomCat: 'Hardware', weight: 5.5, multi: true },
    { skuCat: 'Hardware', skuRole: 'services', bomCat: 'Professional Services', weight: 1.8 },
    { skuCat: 'Hardware', skuRole: 'support', bomCat: 'Support', weight: 1.2 },
    { skuCat: 'Software', skuRole: 'subscription', bomCat: 'Software', weight: 1.0 },
    { skuCat: 'ProfessionalServices', skuRole: 'consulting', bomCat: 'Professional Services', weight: 0.3 },
    { skuCat: 'ManagedServices', skuRole: 'subscription', bomCat: 'Managed Services', weight: 0.2 }
  ],
  Software: [
    { skuCat: 'Software', skuRole: 'subscription', bomCat: 'Software', weight: 4.5, multi: true },
    { skuCat: 'Software', skuRole: 'onboarding', bomCat: 'Professional Services', weight: 2.0 },
    { skuCat: 'Software', skuRole: 'enablement', bomCat: 'Professional Services', weight: 1.5 },
    { skuCat: 'Software', skuRole: 'support', bomCat: 'Support', weight: 1.0 },
    { skuCat: 'ProfessionalServices', skuRole: 'consulting', bomCat: 'Professional Services', weight: 0.5 },
    { skuCat: 'ProfessionalServices', skuRole: 'specialists', bomCat: 'Professional Services', weight: 0.5 }
  ],
  Cloud: [
    { skuCat: 'Cloud', skuRole: 'capacity', bomCat: 'Cloud', weight: 4.0, multi: true },
    { skuCat: 'Cloud', skuRole: 'managed', bomCat: 'Managed Services', weight: 2.5 },
    { skuCat: 'Cloud', skuRole: 'optimization', bomCat: 'Software', weight: 1.5 },
    { skuCat: 'ProfessionalServices', skuRole: 'consulting', bomCat: 'Professional Services', weight: 1.0 },
    { skuCat: 'ManagedServices', skuRole: 'subscription', bomCat: 'Managed Services', weight: 1.0 }
  ]
}

function pickSkuFromPool(vendorData, skuCat, skuRole, excludeSkus) {
  const pool = vendorData?.[skuCat]?.[skuRole]
  if (!Array.isArray(pool) || !pool.length) return null
  const available = pool.filter(s => !excludeSkus.has(s.sku))
  if (available.length) return available[Math.floor(Math.random() * available.length)]
  return null
}

function computeBomQuantity(bomCat, lineCost, sku) {
  if (bomCat === 'Hardware') {
    if (sku && sku.listPrice > 1000) {
      const discounted = sku.listPrice * 0.75
      return Math.max(1, Math.round(lineCost / discounted))
    }
    return 1
  }
  if (bomCat === 'Professional Services') {
    if (sku && sku.listPrice < 500) {
      const rate = sku.listPrice * 0.82
      return Math.max(8, Math.round(lineCost / rate / 4) * 4)
    }
    return Math.max(1, Math.round(lineCost / 250))
  }
  if (bomCat === 'Support') return 1
  if (bomCat === 'Software') {
    if (sku && sku.listPrice < 1000) {
      return Math.max(1, Math.round(lineCost / (sku.listPrice * 0.82)))
    }
    return 1
  }
  if (bomCat === 'Cloud') return randomInt(6, 24)
  if (bomCat === 'Managed Services') return 12
  return 1
}

function rc(v) { return Math.round(v * 100) / 100 }

function generateDealBomLines(oem, lambdaCategory, targetCount, oemCost, amount, isCompetitive) {
  const vendorData = vendorSkuData[oem]
  const recipe = BOM_SLOT_RECIPES[lambdaCategory] || BOM_SLOT_RECIPES.Hardware
  const usedSkus = new Set()
  const slots = []

  // Phase 1: One slot per recipe entry (priority order)
  for (const def of recipe) {
    if (slots.length >= targetCount) break
    if (!vendorData) break
    const sku = pickSkuFromPool(vendorData, def.skuCat, def.skuRole, usedSkus)
    if (!sku) continue
    usedSkus.add(sku.sku)
    slots.push({ ...def, sku })
  }

  // Phase 2: Fill remaining with multi-eligible or repeated entries
  const multiDefs = recipe.filter(d => d.multi)
  let attempts = 0
  while (slots.length < targetCount && attempts < 60) {
    attempts++
    const def = multiDefs.length && Math.random() < 0.7 ? pick(multiDefs) : pick(recipe)
    if (!vendorData) break
    let sku = pickSkuFromPool(vendorData, def.skuCat, def.skuRole, usedSkus)
    if (sku) {
      usedSkus.add(sku.sku)
      slots.push({ ...def, sku, weight: def.weight * (0.4 + Math.random() * 0.4) })
    } else {
      const pool = vendorData?.[def.skuCat]?.[def.skuRole]
      if (pool?.length) {
        sku = pool[Math.floor(Math.random() * pool.length)]
        slots.push({ ...def, sku, weight: def.weight * (0.3 + Math.random() * 0.3) })
      }
    }
  }

  // Phase 3: Generic fallback lines if vendor data missing
  const fallbackCats = ['Professional Services', 'Support', 'Managed Services']
  while (slots.length < targetCount) {
    slots.push({
      skuCat: null, skuRole: null,
      bomCat: fallbackCats[slots.length % fallbackCats.length],
      weight: 0.3,
      sku: null
    })
  }

  // Normalize cost weights
  const totalWeight = slots.reduce((s, sl) => s + sl.weight, 0)

  // Compute deal-level margin and shift category ranges to center on it.
  // This prevents the final price-scaling step from distorting per-line margins.
  const dealMarginOnPrice = amount > 0 ? (amount - oemCost) / amount : 0.15
  let weightedCatMid = 0
  for (const slot of slots) {
    const range = BOM_MARGIN_RANGES[slot.bomCat] || [0.10, 0.20]
    weightedCatMid += ((range[0] + range[1]) / 2) * (slot.weight / totalWeight)
  }
  const marginShift = dealMarginOnPrice - weightedCatMid

  // Build lines with cost distribution and shifted per-category margins
  const lines = slots.map((slot, idx) => {
    const costFraction = slot.weight / totalWeight
    const lineCost = oemCost * costFraction

    const range = BOM_MARGIN_RANGES[slot.bomCat] || [0.10, 0.20]
    let mLo = range[0] + marginShift
    let mHi = range[1] + marginShift
    if (isCompetitive) { mLo -= 0.02; mHi -= 0.02 }
    // Clamp to prevent unrealistic values
    mLo = Math.max(0.02, mLo)
    mHi = Math.max(mLo + 0.01, mHi)
    mHi = Math.min(0.55, mHi)
    const marginDecimal = mLo + Math.random() * (mHi - mLo)
    const linePrice = lineCost / (1 - marginDecimal)
    const qty = computeBomQuantity(slot.bomCat, lineCost, slot.sku)

    return {
      description: slot.sku ? slot.sku.name : `${slot.bomCat} - Item ${idx + 1}`,
      category: slot.bomCat,
      quantity: qty,
      unitCost: rc(lineCost / qty),
      unitPrice: rc(linePrice / qty),
      marginPct: +(marginDecimal * 100).toFixed(1),
      vendor: oem,
      productNumber: slot.sku ? slot.sku.sku : '',
      sortOrder: idx + 1
    }
  })

  // Final price scaling to exactly match deal amount (should be close to 1.0 now)
  const rawPriceTotal = lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0)
  if (rawPriceTotal > 0 && amount > 0) {
    const scale = amount / rawPriceTotal
    for (const line of lines) {
      line.unitPrice = rc(line.unitPrice * scale)
      let newMargin = line.unitPrice > 0 ? (1 - line.unitCost / line.unitPrice) : 0
      // Enforce minimum margin floor of 2%
      if (newMargin < 0.02) {
        newMargin = 0.02
        line.unitPrice = rc(line.unitCost / (1 - 0.02))
      }
      line.marginPct = +(newMargin * 100).toFixed(1)
    }
  }

  return lines
}

// ---------------------------------------------------------------------------
// Constants and distributions
// ---------------------------------------------------------------------------

const TARGET_DEALS = cliDealCount || 7000

// Deal volume by year (growing VAR business)
const YEAR_VOLUME = {
  2016: 450, 2017: 500, 2018: 550, 2019: 600, 2020: 650,
  2021: 700, 2022: 750, 2023: 800, 2024: 850, 2025: 900,
  2026: 250 // partial year: open pipeline
}

// Seasonal multipliers by quarter
const SEASONAL = { 1: 0.80, 2: 1.00, 3: 0.90, 4: 1.30 }

// Base categorical distributions
const dealRegWeights = { NotRegistered: 0.25, StandardApproved: 0.35, PremiumHunting: 0.25, Teaming: 0.15 }
const defaultCompetitorWeights = { '0': 0.15, '1': 0.30, '2': 0.35, '3+': 0.20 }
const competitorWeights = activeScenario?.competitorWeights || defaultCompetitorWeights
const complexityWeights = { Low: 0.30, Medium: 0.40, High: 0.30 }
const valueAddWeights = { Low: 0.25, Medium: 0.40, High: 0.35 }
const varStrategicWeights = { Low: 0.30, Medium: 0.40, High: 0.30 }

// Deal type weights shift over time (more renewals in later years)
function dealTypeWeightsForYear(year) {
  const renewalGrowth = clamp((year - 2016) * 0.015, 0, 0.15) // renewals grow as installed base grows
  return {
    'New Business': 0.40 - renewalGrowth,
    'Renewal': 0.20 + renewalGrowth,
    'Expansion': 0.20,
    'Refresh': 0.12,
    'Run Rate': 0.08
  }
}

// OEM weights shift over time (cloud/security growing, traditional HW declining)
// When a scenario is active, use fixed OEM weights with slight temporal drift
function oemWeightsForYear(year) {
  if (activeScenario) {
    // Apply slight temporal drift to scenario weights (±5% by 2026)
    const t = clamp((year - 2016) / 10, 0, 1)
    const drift = (t - 0.5) * 0.05 // -2.5% in 2016, +2.5% in 2026
    const base = activeScenario.oemWeights
    const weights = {}
    for (const [oem, w] of Object.entries(base)) {
      weights[oem] = Math.max(0.01, w + drift * (Math.random() - 0.5) * 0.1)
    }
    // Normalize to sum to 1
    const total = Object.values(weights).reduce((a, b) => a + b, 0)
    for (const oem of Object.keys(weights)) weights[oem] /= total
    return weights
  }
  const t = clamp((year - 2016) / 10, 0, 1) // 0 in 2016, 1 in 2026
  return {
    Cisco:         0.30 - t * 0.08,     // 30% → 22%
    HPE:           0.15 - t * 0.04,     // 15% → 11%
    Dell:          0.15 - t * 0.03,     // 15% → 12%
    'Palo Alto':   0.08 + t * 0.06,     // 8% → 14% (security boom)
    Fortinet:      0.05 + t * 0.04,     // 5% → 9% (security boom)
    VMware:        0.07 + t * 0.01,     // 7% → 8%
    Microsoft:     0.06 + t * 0.06,     // 6% → 12% (cloud/SaaS)
    'Pure Storage': 0.05 + t * 0.01,    // 5% → 6%
    NetApp:        0.05 - t * 0.02,     // 5% → 3%
    Arista:        0.04 - t * 0.01      // 4% → 3%
  }
}

// Segment weights shift (more mid-market over time as VAR grows)
function segmentWeightsForYear(year) {
  if (activeScenario) return activeScenario.segmentWeights
  const t = clamp((year - 2016) / 10, 0, 1)
  return {
    SMB:        0.35 - t * 0.07,    // 35% → 28%
    MidMarket:  0.38 + t * 0.04,    // 38% → 42%
    Enterprise: 0.27 + t * 0.03     // 27% → 30%
  }
}

// OEM -> Lambda productCategory
const oemToLambdaCategory = {
  Cisco: 'Hardware', HPE: 'Hardware', Dell: 'Hardware',
  'Palo Alto': 'Hardware', Fortinet: 'Hardware',
  VMware: 'Cloud', Microsoft: 'Software',
  'Pure Storage': 'Hardware', NetApp: 'Hardware', Arista: 'Hardware'
}

// OEM -> SFDC productCategory
const oemToSfdcCategory = {
  Cisco: 'Networking', HPE: 'Compute', Dell: 'Compute',
  'Palo Alto': 'Security', Fortinet: 'Security',
  VMware: 'Cloud', Microsoft: 'Software',
  'Pure Storage': 'Storage', NetApp: 'Storage', Arista: 'Networking'
}

// Scenario category mapping: translate scenario categories to Lambda categories
// "Services" isn't a Lambda category — map it to the OEM's default but flag servicesAttached
const scenarioCatToLambdaCat = { Hardware: 'Hardware', Software: 'Software', Cloud: 'Cloud', Services: null }

function pickLambdaCategoryForScenario(oem) {
  if (!activeScenario) return oemToLambdaCategory[oem]
  const catW = activeScenario.categoryWeights
  const roll = Math.random()
  let acc = 0
  for (const [cat, w] of Object.entries(catW)) {
    acc += w
    if (roll < acc) {
      const mapped = scenarioCatToLambdaCat[cat]
      // "Services" maps to the OEM's natural category
      return mapped || oemToLambdaCategory[oem]
    }
  }
  return oemToLambdaCategory[oem]
}

function isServicesCategory() {
  if (!activeScenario) return false
  const catW = activeScenario.categoryWeights
  return Math.random() < (catW.Services || 0)
}

// Industry -> base OEM cost (log-normal mean)
const industryCostMean = {
  'Retail': 35000, 'Technology': 70000,
  'Life Sciences & Healthcare': 55000, 'Energy': 60000,
  'Financial Services': 50000, 'Manufacturing & Automotive': 65000,
  'Media & Telecommunications': 55000, 'Transportation & Logistics': 48000,
  'Consumer Goods & Food': 38000, 'Diversified Conglomerates': 60000
}

const competitorNames = [
  'CDW', 'SHI International', 'Presidio', 'Optiv', 'Insight Enterprises',
  'Connection', 'ePlus', 'Trace3', 'Zones', 'Converge Technology',
  'Logicalis', 'Sirius Computer Solutions', 'Kovarus', 'NWN Carousel',
  'Red River Technology'
]

const lossReasonValues = ['Price', 'Relationship', 'Technical', 'Timing', 'Budget', 'Direct', 'NoDecision']
const openStageNames = ['Negotiation', 'Proposal', 'Qualification']

// ---------------------------------------------------------------------------
// Customer deal allocation: power-law from avgDealSize
// ---------------------------------------------------------------------------

function buildCustomerDealCounts() {
  // Use avgDealSize as a proxy for account importance → deal count
  const rawWeights = customers.map(c => {
    const ds = c.avgDealSize || 30000
    return ds
  })
  const totalWeight = rawWeights.reduce((a, b) => a + b, 0)

  // When deal count is small, only include a weighted subset of customers
  const minPerCustomer = TARGET_DEALS >= customers.length * 2 ? 2 : 1
  const counts = rawWeights.map(w => Math.max(minPerCustomer, Math.round(w / totalWeight * TARGET_DEALS)))
  let total = counts.reduce((a, b) => a + b, 0)

  // If target is very small, zero out low-weight customers to fit
  if (total > TARGET_DEALS && minPerCustomer === 1) {
    // Sort by weight ascending, zero out smallest customers first
    const indexed = rawWeights.map((w, i) => ({ i, w })).sort((a, b) => a.w - b.w)
    for (const entry of indexed) {
      if (total <= TARGET_DEALS) break
      if (counts[entry.i] > 0) {
        total -= counts[entry.i]
        counts[entry.i] = 0
      }
    }
  }

  // Adjust to hit target exactly
  while (total < TARGET_DEALS) {
    const idx = randomInt(0, customers.length - 1)
    counts[idx]++
    total++
  }
  while (total > TARGET_DEALS) {
    const idx = randomInt(0, customers.length - 1)
    if (counts[idx] > minPerCustomer) { counts[idx]--; total-- }
  }

  return counts
}

// ---------------------------------------------------------------------------
// Account lifecycle: start year and relationship evolution
// ---------------------------------------------------------------------------

function assignStartYear(customer) {
  const ds = customer.avgDealSize || 30000
  // Bigger customers have been around longer
  if (ds >= 90000) return 2016                        // whales: day one
  if (ds >= 60000) return 2016 + randomInt(0, 2)      // large: 2016-2018
  if (ds >= 35000) return 2016 + randomInt(1, 4)       // medium: 2017-2020
  if (ds >= 18000) return 2016 + randomInt(3, 7)       // small: 2019-2023
  return 2016 + randomInt(5, 9)                         // tiny: 2021-2025
}

function relationshipForYear(customer, year, startYear) {
  const yearsActive = year - startYear
  const currentRel = customer.relationshipStrength // their 2026 state

  if (yearsActive <= 1) return 'New'
  if (yearsActive <= 3) return currentRel === 'New' ? 'New' : 'Good'
  // 4+ years: use customer's current relationship level
  return currentRel
}

// ---------------------------------------------------------------------------
// Temporal deal scheduling
// ---------------------------------------------------------------------------

function assignDealYears(totalDeals, startYear) {
  // Distribute deals across years from startYear to 2025 (2026 is open pipeline)
  const years = []
  const endYear = 2025

  // Build yearly weights (growing business + seasonal)
  const yearEntries = []
  for (let y = startYear; y <= endYear; y++) {
    const baseVol = YEAR_VOLUME[y] || 700
    // Weight by year volume and years-since-start (more deals as relationship matures)
    const maturity = 1 + 0.1 * (y - startYear)
    yearEntries.push({ year: y, weight: baseVol * maturity })
  }
  const totalYearWeight = yearEntries.reduce((a, e) => a + e.weight, 0)

  // Reserve ~5% of deals for 2026 open pipeline
  const openPipelineCount = Math.max(0, Math.round(totalDeals * 0.05))
  const closedCount = totalDeals - openPipelineCount

  // Distribute closed deals across years
  for (let i = 0; i < closedCount; i++) {
    let r = Math.random() * totalYearWeight
    for (const entry of yearEntries) {
      r -= entry.weight
      if (r <= 0) { years.push(entry.year); break }
    }
    if (years.length <= i) years.push(endYear) // fallback
  }

  // Add 2026 open pipeline deals
  for (let i = 0; i < openPipelineCount; i++) {
    years.push(2026)
  }

  return years
}

function randomDateInQuarter(year, quarter) {
  const monthStart = (quarter - 1) * 3
  const startDate = new Date(year, monthStart, 1)
  const endDate = new Date(year, monthStart + 3, 0) // last day of quarter
  const ts = startDate.getTime() + Math.random() * (endDate.getTime() - startDate.getTime())
  return new Date(ts)
}

function pickQuarterSeasonal() {
  const r = Math.random()
  const total = SEASONAL[1] + SEASONAL[2] + SEASONAL[3] + SEASONAL[4]
  let acc = 0
  for (let q = 1; q <= 4; q++) {
    acc += SEASONAL[q] / total
    if (r < acc) return q
  }
  return 4
}

// ---------------------------------------------------------------------------
// Loss reason correlation
// ---------------------------------------------------------------------------

function pickLossReason(deal) {
  const weights = {
    Price: 1, Relationship: 1, Technical: 1, Timing: 1,
    Budget: 1, Direct: 1, NoDecision: 1
  }
  const highComp = deal.competitors === '2' || deal.competitors === '3+'
  if (highComp && deal.dealRegType === 'NotRegistered') {
    weights.Price += 4
    weights.Direct += 2
  }
  if (deal.relationshipStrength === 'New') {
    weights.Relationship += 3
  }
  if (deal.valueAdd === 'Low') {
    weights.Technical += 3
  }
  // Timing/Budget losses more common in Q4 (budget deadlines)
  if (deal._quarter === 4) {
    weights.Budget += 2
    weights.Timing += 2
  }
  const total = Object.values(weights).reduce((a, b) => a + b, 0)
  const normalized = {}
  for (const [k, v] of Object.entries(weights)) normalized[k] = v / total
  return weightedPick(normalized)
}

// ---------------------------------------------------------------------------
// Competitor name generation
// ---------------------------------------------------------------------------

function pickCompetitorNames(competitorCount) {
  if (competitorCount === '0') return null
  let n = 1
  if (competitorCount === '2') n = 2
  if (competitorCount === '3+') n = randomInt(3, 5)
  return pickN(competitorNames, Math.min(n, competitorNames.length)).join(';')
}

// ---------------------------------------------------------------------------
// Margin compression over time
// ---------------------------------------------------------------------------

function marginCompressionForYear(year) {
  // ~0.3pp/year decline from 2016 baseline (industry margin compression)
  return -(year - 2016) * 0.003
}

// ---------------------------------------------------------------------------
// Deal generation
// ---------------------------------------------------------------------------

function generateDeals() {
  const dealCounts = buildCustomerDealCounts()
  const customerDealCounter = new Map() // for unique names
  const lambdaDeals = []
  const sfdcDeals = []

  console.log(`Generating deals for ${customers.length} customers...`)

  for (let ci = 0; ci < customers.length; ci++) {
    const cust = customers[ci]
    const totalDeals = dealCounts[ci]
    const startYear = assignStartYear(cust)
    const dealYears = assignDealYears(totalDeals, startYear)

    for (let di = 0; di < totalDeals; di++) {
      const year = dealYears[di]
      const quarter = year === 2026 ? randomInt(1, 2) : pickQuarterSeasonal()
      const closeDate = randomDateInQuarter(year, quarter)

      // Per-customer counter
      const custCount = (customerDealCounter.get(cust.name) || 0) + 1
      customerDealCounter.set(cust.name, custCount)

      // --- Year-dependent distributions ---
      const customerSegment = weightedPick(segmentWeightsForYear(year))
      const dealRegType = weightedPick(dealRegWeights)
      const competitors = weightedPick(competitorWeights)
      const solutionComplexity = weightedPick(complexityWeights)
      const valueAdd = weightedPick(valueAddWeights)
      const varStrategicImportance = weightedPick(varStrategicWeights)
      const dealType = weightedPick(dealTypeWeightsForYear(year))
      const oem = weightedPick(oemWeightsForYear(year))
      const lambdaCategory = pickLambdaCategoryForScenario(oem)
      const sfdcCategory = oemToSfdcCategory[oem]
      const forceServices = isServicesCategory()

      // --- Numeric signals ---
      const customerPriceSensitivity = randomInt(1, 5)
      const customerLoyalty = randomInt(1, 5)
      const dealUrgency = randomInt(1, 5)
      const solutionDifferentiation = randomInt(1, 5)
      const isNewLogo = dealType === 'New Business' ? Math.random() < 0.70 : Math.random() < 0.10

      // --- Relationship evolves over time ---
      const relationshipStrength = relationshipForYear(cust, year, startYear)

      // --- OEM Cost (log-normal, industry-based, scaled by customer avgDealSize) ---
      let baseCost = industryCostMean[cust.industry] || 50000
      const custScale = (cust.avgDealSize || 30000) / 50000 // scale by customer size
      // When scenario is active, scale base cost toward scenario's avg deal size
      if (activeScenario) {
        const scenarioScale = activeScenario.avgDealSize / 90000 // normalize against default ~$90K
        baseCost = baseCost * scenarioScale
      }
      const sdFactor = activeScenario?.dealSizeSd || 0.55
      let oemCost = Math.round(clamp(randLogNormal(baseCost * custScale, sdFactor), 5000, 2000000))

      // --- Services attached (correlate with valueAdd; boosted by scenario services weight) ---
      let servicesAttached = valueAdd === 'High' ? Math.random() < 0.85
        : valueAdd === 'Medium' ? Math.random() < 0.55
          : Math.random() < 0.20
      if (forceServices) servicesAttached = true

      // --- Quarter end (more likely in Q4) ---
      const quarterEnd = quarter === 4 ? Math.random() < 0.40 : Math.random() < 0.15

      // --- Displacement deal (competitive deals with 2+ competitors, ~5% chance) ---
      const displacementDeal = competitors >= 2 ? Math.random() < 0.05 : false

      // --- Build input for rules engine ---
      const rulesInput = {
        oemCost,
        productCategory: lambdaCategory,
        customerSegment,
        relationshipStrength,
        customerTechSophistication: cust.customerTechSophistication,
        dealRegType,
        competitors,
        valueAdd,
        solutionComplexity,
        varStrategicImportance,
        customerPriceSensitivity,
        customerLoyalty,
        dealUrgency,
        isNewLogo,
        solutionDifferentiation
      }

      // --- Get recommendation from rules engine ---
      const rec = ruleBasedRecommendation(rulesInput, [], null)
      let recommendedMargin = rec.suggestedMarginPct / 100

      // Apply margin compression for the year
      recommendedMargin += marginCompressionForYear(year)
      recommendedMargin = clamp(recommendedMargin, 0.03, 0.45)

      // --- Determine status ---
      let status, stageName
      if (year === 2026) {
        // All 2026 deals are open pipeline
        status = 'Open'
        stageName = pick(openStageNames)
      } else {
        // Win rate improves slightly over time (better relationships)
        const scenarioWinBase = activeScenario?.winRateBaseline || 0.58
        const baseWinRate = scenarioWinBase + (year - 2016) * 0.005
        const statusRoll = Math.random()
        if (statusRoll < baseWinRate) {
          status = 'Won'
          stageName = 'Closed Won'
        } else {
          status = 'Lost'
          stageName = 'Closed Lost'
        }
      }

      // --- Compute achievedMargin causally from recommendation ---
      const marginFloor = activeScenario ? activeScenario.marginRange[0] * 0.6 : 0.03
      const marginCeil = activeScenario ? Math.min(activeScenario.marginRange[1] * 1.3, 0.45) : 0.45
      let achievedMargin
      if (status === 'Won' || status === 'Open') {
        achievedMargin = recommendedMargin + randNormal(0, 0.02)
        achievedMargin = clamp(achievedMargin, marginFloor, marginCeil)
      } else {
        // Lost: bimodal (60% priced too high, 40% race-to-bottom)
        if (Math.random() < 0.60) {
          achievedMargin = recommendedMargin + randNormal(0.04, 0.02)
        } else {
          achievedMargin = recommendedMargin + randNormal(-0.03, 0.015)
        }
        achievedMargin = clamp(achievedMargin, marginFloor, marginCeil)
      }
      achievedMargin = +achievedMargin.toFixed(4)

      // --- Amount (sell price) ---
      const amount = Math.round(oemCost * (1 + achievedMargin))

      // --- Planned margin: ~70% of deals get one ---
      let plannedMargin = null
      if (Math.random() < 0.70) {
        plannedMargin = recommendedMargin - Math.abs(randNormal(0.02, 0.01))
        plannedMargin = clamp(plannedMargin, 0.03, 0.45)
        plannedMargin = +plannedMargin.toFixed(4)
      }

      // --- Competitor names ---
      const competitorNameStr = pickCompetitorNames(competitors)

      // --- Loss reason ---
      const tempDeal = { competitors, dealRegType, relationshipStrength, valueAdd, _quarter: quarter }
      const lossReason = status === 'Lost' ? pickLossReason(tempDeal) : null

      // --- Build Lambda kNN deal ---
      const lambdaDeal = {
        description: `${cust.name} ${sfdcCategory} #${custCount}`,
        customer: cust.name,
        segment: customerSegment,
        industry: cust.industry,
        productCategory: lambdaCategory,
        dealRegType,
        competitors,
        valueAdd,
        relationshipStrength,
        relationshipStage: cust.relationshipStage,
        valueAddExpectation: cust.valueAddExpectation,
        customerTechSophistication: cust.customerTechSophistication,
        solutionComplexity,
        achievedMargin,
        status: status === 'Open' ? 'Won' : status,
        oemCost,
        varStrategicImportance,
        customerPriceSensitivity,
        customerLoyalty,
        dealUrgency,
        solutionDifferentiation,
        isNewLogo,
        oem,
        servicesAttached,
        quarterEnd,
        displacementDeal,
        closeDate: formatDate(closeDate)
      }

      if (cust.avgDealSize) lambdaDeal.avgDealSize = cust.avgDealSize
      if (status === 'Lost' && lossReason) lambdaDeal.lossReason = lossReason

      // --- BOM generation (all deals get full BOM lines) ---
      const bomTargetCount = bomLineCountForAmount(amount)
      const isCompetitiveDeal = competitors === '2' || competitors === '3+'
      const bomLines = generateDealBomLines(oem, lambdaCategory, bomTargetCount, oemCost, amount, isCompetitiveDeal)

      lambdaDeal.bomLines = bomLines
      lambdaDeal.bomLineCount = bomLines.length

      const bomTotalCost = bomLines.reduce((s, l) => s + l.unitCost * l.quantity, 0)
      const bomTotalPrice = bomLines.reduce((s, l) => s + l.unitPrice * l.quantity, 0)
      const bomBlendedMargin = bomTotalPrice > 0 ? (bomTotalPrice - bomTotalCost) / bomTotalPrice : 0
      const bomAvgMargin = bomLines.length > 0
        ? bomLines.reduce((s, l) => s + l.marginPct, 0) / bomLines.length
        : 0

      lambdaDeal.bomAvgMarginPct = +bomAvgMargin.toFixed(1)
      lambdaDeal.bomBlendedMarginPct = +(bomBlendedMargin * 100).toFixed(1)
      lambdaDeal.hasManualBom = false

      lambdaDeals.push(lambdaDeal)

      // --- Build SFDC seed deal ---
      const quarterLabel = getQuarterLabel(closeDate)
      const sfdcName = `${cust.name} - ${oem} ${sfdcCategory} ${quarterLabel} #${custCount}`

      const sfdcDeal = {
        Name: sfdcName.slice(0, 120), // SFDC 120 char limit
        AccountName: cust.name,
        AccountIndustry: cust.industry,
        StageName: stageName,
        Amount: amount,
        CloseDate: formatDate(closeDate),
        Fulcrum_OEM__c: oem,
        Fulcrum_OEM_Cost__c: oemCost,
        Fulcrum_Customer_Segment__c: customerSegment,
        Fulcrum_Deal_Reg_Type__c: dealRegType,
        Fulcrum_Competitors__c: competitors,
        Fulcrum_Competitor_Names__c: competitorNameStr,
        Fulcrum_Solution_Complexity__c: solutionComplexity,
        Fulcrum_Relationship_Strength__c: relationshipStrength,
        Fulcrum_Value_Add__c: valueAdd,
        Fulcrum_Services_Attached__c: servicesAttached,
        Fulcrum_Quarter_End__c: quarterEnd,
        Fulcrum_Displacement_Deal__c: displacementDeal,
        Fulcrum_Planned_Margin__c: plannedMargin !== null ? +(plannedMargin * 100).toFixed(1) : null,
        Fulcrum_GP_Percent__c: +(achievedMargin * 100).toFixed(1),
        Fulcrum_Product_Category__c: sfdcCategory,
        Fulcrum_Deal_Type__c: dealType,
        Fulcrum_Loss_Reason__c: lossReason
      }

      sfdcDeals.push(sfdcDeal)
    }
  }

  // Sort SFDC deals by close date (oldest first)
  sfdcDeals.sort((a, b) => a.CloseDate.localeCompare(b.CloseDate))

  return { lambdaDeals, sfdcDeals }
}

// ---------------------------------------------------------------------------
// Generate and write
// ---------------------------------------------------------------------------

console.log('=== MarginArc Synthetic Data Generator v2 ===')
if (activeScenario) {
  console.log(`Scenario: ${activeScenario.label} (${scenarioKey})`)
  console.log(`  ${activeScenario.description}`)
}
console.log(`Target: ${TARGET_DEALS} deals across ${customers.length} accounts (2016-2026)\n`)

const { lambdaDeals, sfdcDeals } = generateDeals()

// Determine output paths
const lambdaOutPath = cliOutput
  ? path.resolve(cliOutput)
  : activeScenario
    ? path.join(__dirname, 'scenarios', `${scenarioKey}.json`)
    : path.join(__dirname, 'sample_deals.json')

const sfdcOutPath = cliOutput
  ? path.resolve(cliOutput.replace(/\.json$/, '-sfdc.json'))
  : activeScenario
    ? path.join(__dirname, 'scenarios', `${scenarioKey}-sfdc.json`)
    : path.join(__dirname, 'sfdc_seed_data.json')

// Ensure output directory exists
const lambdaOutDir = path.dirname(lambdaOutPath)
if (!fs.existsSync(lambdaOutDir)) {
  fs.mkdirSync(lambdaOutDir, { recursive: true })
}
const sfdcOutDir = path.dirname(sfdcOutPath)
if (!fs.existsSync(sfdcOutDir)) {
  fs.mkdirSync(sfdcOutDir, { recursive: true })
}

fs.writeFileSync(lambdaOutPath, JSON.stringify(lambdaDeals, null, 2))
fs.writeFileSync(sfdcOutPath, JSON.stringify(sfdcDeals, null, 2))

const lambdaRelPath = path.relative(process.cwd(), lambdaOutPath)
const sfdcRelPath = path.relative(process.cwd(), sfdcOutPath)
console.log(`\nGenerated ${lambdaDeals.length} Lambda deals -> ${lambdaRelPath}`)
console.log(`Generated ${sfdcDeals.length} SFDC deals  -> ${sfdcRelPath}`)

// ---------------------------------------------------------------------------
// Summary stats
// ---------------------------------------------------------------------------

const wonCount = sfdcDeals.filter(d => d.StageName === 'Closed Won').length
const lostCount = sfdcDeals.filter(d => d.StageName === 'Closed Lost').length
const openCount = sfdcDeals.filter(d => !d.StageName.startsWith('Closed')).length
const margins = lambdaDeals.map(d => d.achievedMargin)
const avgMargin = (margins.reduce((a, b) => a + b, 0) / margins.length * 100).toFixed(1)

console.log(`\n--- Deal Status ---`)
console.log(`  Won:  ${wonCount} (${(wonCount / sfdcDeals.length * 100).toFixed(1)}%)`)
console.log(`  Lost: ${lostCount} (${(lostCount / sfdcDeals.length * 100).toFixed(1)}%)`)
console.log(`  Open: ${openCount} (${(openCount / sfdcDeals.length * 100).toFixed(1)}%)`)
console.log(`  Avg achieved margin: ${avgMargin}%`)
console.log(`  Unique customers: ${new Set(lambdaDeals.map(d => d.customer)).size}`)

// Year distribution
console.log(`\n--- Deals by Year ---`)
const byYear = {}
for (const d of sfdcDeals) {
  const y = d.CloseDate.slice(0, 4)
  byYear[y] = (byYear[y] || 0) + 1
}
for (const [y, c] of Object.entries(byYear).sort()) {
  const yearDeals = sfdcDeals.filter(d => d.CloseDate.startsWith(y))
  const yearWon = yearDeals.filter(d => d.StageName === 'Closed Won').length
  const yearMargins = lambdaDeals
    .filter((_, i) => sfdcDeals[i]?.CloseDate.startsWith(y))
  const yearAvgMargin = yearMargins.length
    ? (yearMargins.reduce((a, d) => a + d.achievedMargin, 0) / yearMargins.length * 100).toFixed(1)
    : 'N/A'
  console.log(`  ${y}: ${c} deals (${yearWon} won, avg margin ${yearAvgMargin}%)`)
}

// OEM distribution
console.log(`\n--- OEM Mix ---`)
const byOem = {}
for (const d of sfdcDeals) {
  byOem[d.Fulcrum_OEM__c] = (byOem[d.Fulcrum_OEM__c] || 0) + 1
}
for (const [oem, c] of Object.entries(byOem).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${oem}: ${c} (${(c / sfdcDeals.length * 100).toFixed(1)}%)`)
}

// Top 10 accounts by deal count
console.log(`\n--- Top 10 Accounts ---`)
const byAccount = {}
for (const d of sfdcDeals) {
  byAccount[d.AccountName] = (byAccount[d.AccountName] || 0) + 1
}
const topAccounts = Object.entries(byAccount).sort((a, b) => b[1] - a[1]).slice(0, 10)
for (const [name, c] of topAccounts) {
  console.log(`  ${name}: ${c} deals`)
}

// Segment distribution
console.log(`\n--- Segment Mix ---`)
const bySeg = {}
for (const d of sfdcDeals) {
  bySeg[d.Fulcrum_Customer_Segment__c] = (bySeg[d.Fulcrum_Customer_Segment__c] || 0) + 1
}
for (const [seg, c] of Object.entries(bySeg).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${seg}: ${c} (${(c / sfdcDeals.length * 100).toFixed(1)}%)`)
}

// File sizes
const lambdaSize = (Buffer.byteLength(JSON.stringify(lambdaDeals)) / 1024 / 1024).toFixed(1)
const sfdcSize = (Buffer.byteLength(JSON.stringify(sfdcDeals)) / 1024 / 1024).toFixed(1)
console.log(`\n--- File Sizes ---`)
console.log(`  sample_deals.json: ${lambdaSize} MB`)
console.log(`  sfdc_seed_data.json: ${sfdcSize} MB`)
