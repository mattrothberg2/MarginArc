import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import seedrandom from 'seedrandom'
import { buildBillOfMaterials, computeManualBomStats } from '../bom.js'
import { ruleBasedRecommendation } from '../rules.js'

// Seeded RNG keeps demo data reproducible
seedrandom('fulcrum-var-v2', { global: true })

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const customers = JSON.parse(fs.readFileSync(path.join(__dirname, 'customers.json'), 'utf-8'))
const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, 'bom_catalog.json'), 'utf-8'))
const catalogById = new Map(catalog.map(item => [item.productId, item]))
const presets = JSON.parse(fs.readFileSync(path.join(__dirname, 'bom_presets.json'), 'utf-8'))

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
  const count = Math.min(6, Math.max(2, Math.round(randNormal(3, 1))))
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
// Constants and distributions
// ---------------------------------------------------------------------------

const TARGET_DEALS = 7000

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
const competitorWeights = { '0': 0.15, '1': 0.30, '2': 0.35, '3+': 0.20 }
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
function oemWeightsForYear(year) {
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

  // Assign proportional deal counts, minimum 2
  const counts = rawWeights.map(w => Math.max(2, Math.round(w / totalWeight * TARGET_DEALS)))
  let total = counts.reduce((a, b) => a + b, 0)

  // Adjust to hit target exactly
  while (total < TARGET_DEALS) {
    // Add to random high-weight customer
    const idx = randomInt(0, customers.length - 1)
    counts[idx]++
    total++
  }
  while (total > TARGET_DEALS) {
    const idx = randomInt(0, customers.length - 1)
    if (counts[idx] > 2) { counts[idx]--; total-- }
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
      const lambdaCategory = oemToLambdaCategory[oem]
      const sfdcCategory = oemToSfdcCategory[oem]

      // --- Numeric signals ---
      const customerPriceSensitivity = randomInt(1, 5)
      const customerLoyalty = randomInt(1, 5)
      const dealUrgency = randomInt(1, 5)
      const solutionDifferentiation = randomInt(1, 5)
      const isNewLogo = dealType === 'New Business' ? Math.random() < 0.70 : Math.random() < 0.10

      // --- Relationship evolves over time ---
      const relationshipStrength = relationshipForYear(cust, year, startYear)

      // --- OEM Cost (log-normal, industry-based, scaled by customer avgDealSize) ---
      const baseCost = industryCostMean[cust.industry] || 50000
      const custScale = (cust.avgDealSize || 30000) / 50000 // scale by customer size
      let oemCost = Math.round(clamp(randLogNormal(baseCost * custScale, 0.55), 5000, 2000000))

      // --- Services attached (correlate with valueAdd) ---
      const servicesAttached = valueAdd === 'High' ? Math.random() < 0.85
        : valueAdd === 'Medium' ? Math.random() < 0.55
          : Math.random() < 0.20

      // --- Quarter end (more likely in Q4) ---
      const quarterEnd = quarter === 4 ? Math.random() < 0.40 : Math.random() < 0.15

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
        const baseWinRate = 0.58 + (year - 2016) * 0.005
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
      let achievedMargin
      if (status === 'Won' || status === 'Open') {
        achievedMargin = recommendedMargin + randNormal(0, 0.02)
        achievedMargin = clamp(achievedMargin, 0.03, 0.45)
      } else {
        // Lost: bimodal (60% priced too high, 40% race-to-bottom)
        if (Math.random() < 0.60) {
          achievedMargin = recommendedMargin + randNormal(0.04, 0.02)
        } else {
          achievedMargin = recommendedMargin + randNormal(-0.03, 0.015)
        }
        achievedMargin = clamp(achievedMargin, 0.03, 0.45)
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
        isNewLogo
      }

      if (cust.avgDealSize) lambdaDeal.avgDealSize = cust.avgDealSize
      if (status === 'Lost' && lossReason) lambdaDeal.lossReason = lossReason

      // --- BOM generation ---
      // Full BOM for recent deals (2024+), synthetic stats for older ones (performance)
      if (year >= 2024) {
        const recForBom = { suggestedMarginPct: achievedMargin * 100, suggestedPrice: amount }
        if (Math.random() < 0.35) {
          const preset = Math.random() < 0.6 ? presets[Math.floor(Math.random() * presets.length)] : null
          const manualLines = createManualBomLines({ preset })
          const manualStats = computeManualBomStats(manualLines)
          lambdaDeal.bomLineCount = manualStats.lineCount
          lambdaDeal.bomAvgMarginPct = manualStats.avgMarginPct
          lambdaDeal.bomBlendedMarginPct = manualStats.blendedMarginPct
          lambdaDeal.hasManualBom = true
          lambdaDeal.manualBomLines = manualLines.map(line => ({
            ...line,
            note: preset ? preset.label : ''
          }))
        } else {
          const autoBom = buildBillOfMaterials(rulesInput, recForBom)
          lambdaDeal.bomLineCount = autoBom.stats.lineCount
          lambdaDeal.bomAvgMarginPct = autoBom.stats.avgMarginPct
          lambdaDeal.bomBlendedMarginPct = autoBom.stats.blendedMarginPct
          lambdaDeal.hasManualBom = false
        }
      } else {
        // Synthetic BOM stats for historical deals (fast)
        const hasManual = Math.random() < 0.35
        lambdaDeal.bomLineCount = randomInt(2, 6)
        lambdaDeal.bomAvgMarginPct = +(achievedMargin * 100 + randNormal(0, 2)).toFixed(1)
        lambdaDeal.bomBlendedMarginPct = +(achievedMargin * 100 + randNormal(0, 1.5)).toFixed(1)
        lambdaDeal.hasManualBom = hasManual
      }

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
console.log(`Target: ${TARGET_DEALS} deals across ${customers.length} accounts (2016-2026)\n`)

const { lambdaDeals, sfdcDeals } = generateDeals()

fs.writeFileSync(path.join(__dirname, 'sample_deals.json'), JSON.stringify(lambdaDeals, null, 2))
fs.writeFileSync(path.join(__dirname, 'sfdc_seed_data.json'), JSON.stringify(sfdcDeals, null, 2))

console.log(`\nGenerated ${lambdaDeals.length} Lambda deals -> sample_deals.json`)
console.log(`Generated ${sfdcDeals.length} SFDC deals  -> sfdc_seed_data.json`)

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
