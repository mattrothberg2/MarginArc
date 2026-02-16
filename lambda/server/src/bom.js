import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const VENDOR_SKUS = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'data/vendor_skus.json'), 'utf-8')
)

// Normalize OEM name to match vendor_skus.json keys
const OEM_ALIASES = {
  'cisco': 'Cisco',
  'cisco systems': 'Cisco',
  'palo alto': 'Palo Alto',
  'palo alto networks': 'Palo Alto',
  'pan': 'Palo Alto',
  'hpe': 'HPE',
  'hewlett packard enterprise': 'HPE',
  'hewlett-packard': 'HPE',
  'hp enterprise': 'HPE',
  'dell': 'Dell',
  'dell technologies': 'Dell',
  'dell emc': 'Dell',
  'fortinet': 'Fortinet',
  'vmware': 'VMware',
  'broadcom': 'VMware',
  'microsoft': 'Microsoft',
  'pure storage': 'Pure Storage',
  'pure': 'Pure Storage',
  'netapp': 'NetApp',
  'net app': 'NetApp',
  'arista': 'Arista',
  'arista networks': 'Arista'
}

function resolveVendor(oem) {
  if (!oem) return null
  const key = oem.trim().toLowerCase()
  if (OEM_ALIASES[key]) return OEM_ALIASES[key]
  if (VENDOR_SKUS[oem]) return oem
  return null
}

function lookupSku(vendor, productCategory, role) {
  const vendorData = VENDOR_SKUS[vendor]
  if (!vendorData) return null
  const catData = vendorData[productCategory]
  if (!catData) return null
  const skus = catData[role]
  if (!Array.isArray(skus) || !skus.length) return null
  // Pick the first SKU for deterministic output
  return skus[0]
}

const clamp = (val, min, max) => Math.max(min, Math.min(max, val))

const HOURS_BY_COMPLEXITY = {
  Low: 48,
  Medium: 80,
  High: 128
}

const SEGMENT_HOUR_MULTIPLIER = {
  SMB: 0.85,
  MidMarket: 1,
  Enterprise: 1.25
}

const RELATIONSHIP_HOUR_MULTIPLIER = {
  Strategic: 0.9,
  Good: 1,
  New: 1.08
}

const BOM_TEMPLATES = {
  Hardware: [
    { key: 'core', label: 'OEM hardware bundle', category: 'Hardware', weight: 0.64, unit: 'bundle', quantity: 1, marginAdj: -0.05 },
    { key: 'services', label: 'Implementation services', category: 'Services', weight: 0.22, unit: 'hrs', quantityFn: serviceHours, minQuantity: 16, marginAdj: 0.07 },
    { key: 'support', label: 'Premium support (12 mo)', category: 'Support', weight: 0.14, unit: 'yr', quantity: 1, marginAdj: -0.02 }
  ],
  Software: [
    { key: 'subscription', label: 'Annual software subscription', category: 'Software', weight: 0.55, unit: 'subscription', quantity: 1, marginAdj: -0.03 },
    { key: 'onboarding', label: 'Implementation & onboarding', category: 'Services', weight: 0.25, unit: 'hrs', quantityFn: serviceHours, minQuantity: 24, marginAdj: 0.06 },
    { key: 'enablement', label: 'Customer success workshops', category: 'Services', weight: 0.1, unit: 'sessions', quantityFn: workshopSessions, minQuantity: 2, marginAdj: 0.04 },
    { key: 'support', label: 'Enterprise support plan', category: 'Support', weight: 0.1, unit: 'yr', quantity: 1, marginAdj: -0.01 }
  ],
  Cloud: [
    { key: 'capacity', label: 'Reserved cloud capacity', category: 'Cloud', weight: 0.5, unit: 'mo', quantityFn: reservedMonths, minQuantity: 6, marginAdj: -0.02 },
    { key: 'managed', label: 'Managed services oversight', category: 'Services', weight: 0.3, unit: 'hrs', quantityFn: serviceHours, minQuantity: 24, marginAdj: 0.05 },
    { key: 'optimization', label: 'Cost governance tooling', category: 'Software', weight: 0.2, unit: 'bundle', quantity: 1, marginAdj: 0.02 }
  ],
  ProfessionalServices: [
    { key: 'consulting', label: 'Consulting squad', category: 'Services', weight: 0.6, unit: 'hrs', quantityFn: serviceHours, minQuantity: 32, marginAdj: 0.08 },
    { key: 'specialists', label: 'Specialist SMEs', category: 'Services', weight: 0.25, unit: 'hrs', quantityFn: specialistHours, minQuantity: 16, marginAdj: 0.1 },
    { key: 'program', label: 'Program management & QA', category: 'Services', weight: 0.15, unit: 'weeks', quantityFn: pmWeeks, minQuantity: 4, marginAdj: 0.04 }
  ],
  ManagedServices: [
    { key: 'subscription', label: 'Managed service subscription', category: 'Services', weight: 0.5, unit: 'mo', quantityFn: managedMonths, minQuantity: 6, marginAdj: 0.06 },
    { key: 'automation', label: 'Automation & onboarding', category: 'Services', weight: 0.2, unit: 'hrs', quantityFn: serviceHours, minQuantity: 20, marginAdj: 0.05 },
    { key: 'success', label: 'QBR & success cadence', category: 'Services', weight: 0.15, unit: 'sessions', quantityFn: qbrSessions, minQuantity: 2, marginAdj: 0.03 },
    { key: 'support', label: 'Proactive monitoring', category: 'Support', weight: 0.15, unit: 'mo', quantityFn: managedMonths, minQuantity: 6, marginAdj: 0 }
  ],
  ComplexSolution: [
    { key: 'platform', label: 'Integrated platform stack', category: 'Hardware', weight: 0.45, unit: 'bundle', quantity: 1, marginAdj: -0.03 },
    { key: 'software', label: 'Analytics & software layer', category: 'Software', weight: 0.2, unit: 'bundle', quantity: 1, marginAdj: 0.02 },
    { key: 'services', label: 'Solution delivery squad', category: 'Services', weight: 0.25, unit: 'hrs', quantityFn: complexHours, minQuantity: 40, marginAdj: 0.07 },
    { key: 'governance', label: 'Program governance & support', category: 'Support', weight: 0.1, unit: 'mo', quantityFn: managedMonths, minQuantity: 6, marginAdj: 0.01 }
  ]
}

function serviceHours(input){
  const base = HOURS_BY_COMPLEXITY[input.solutionComplexity] ?? HOURS_BY_COMPLEXITY.Medium
  const segment = SEGMENT_HOUR_MULTIPLIER[input.customerSegment] ?? 1
  const relationship = RELATIONSHIP_HOUR_MULTIPLIER[input.relationshipStrength] ?? 1
  const valueAdd = input.valueAdd === 'High' ? 1.12 : input.valueAdd === 'Low' ? 0.92 : 1
  const urgency = input.dealUrgency >= 4 ? 0.92 : input.dealUrgency <= 2 ? 1.05 : 1
  const raw = base * segment * relationship * valueAdd * urgency
  return Math.max(16, Math.round(raw / 4) * 4)
}

function specialistHours(input){
  return Math.max(12, Math.round(serviceHours(input) * 0.35 / 4) * 4)
}

function complexHours(input){
  return Math.max(24, Math.round(serviceHours(input) * 1.25 / 4) * 4)
}

function workshopSessions(input){
  return Math.max(2, Math.round(serviceHours(input) / 35))
}

function pmWeeks(input){
  return Math.max(4, Math.round(serviceHours(input) / 30))
}

function managedMonths(input){
  const base = input.customerSegment === 'Enterprise' ? 12 : input.customerSegment === 'SMB' ? 6 : 9
  const regBonus = input.dealRegType === 'PremiumHunting' ? 3 : input.dealRegType === 'Teaming' ? 2 : 0
  return base + regBonus
}

function qbrSessions(input){
  return Math.max(4, Math.round(managedMonths(input) / 3))
}

function reservedMonths(input){
  return Math.max(6, managedMonths(input))
}

function ensureWeights(items){
  let total = items.reduce((sum, item)=> sum + (item.weight ?? 0), 0)
  if (!total) total = 1
  items.forEach(item => { item.weight = (item.weight ?? (1/items.length)) / total })
}

function shiftWeight(items, fromIdx, toIdx, amount, adjustments, reason){
  if (fromIdx === -1 || toIdx === -1 || amount <= 0) return
  const available = Math.max(0, items[fromIdx].weight - 0.05)
  const applied = Math.min(amount, available)
  if (applied <= 0) return
  items[fromIdx].weight -= applied
  items[toIdx].weight += applied
  if (reason){
    adjustments.push(reason.replace('{pct}', (applied*100).toFixed(0)))
  }
}

function adjustWeights(template, input){
  const items = template.map(item => ({ ...item }))
  const adjustments = []
  ensureWeights(items)
  const findIdx = (predicate)=> items.findIndex(predicate)
  const primaryIdx = findIdx(i=>['Hardware','Software','Cloud'].includes(i.category)) !== -1
    ? findIdx(i=>['Hardware','Software','Cloud'].includes(i.category))
    : 0
  const servicesIdx = findIdx(i=> i.category === 'Services')
  const supportIdx = findIdx(i=> i.category === 'Support')

  if (input.solutionComplexity === 'High'){
    shiftWeight(items, primaryIdx, servicesIdx, 0.05, adjustments, 'High solution complexity shifts {pct}% of cost into delivery services.')
  } else if (input.solutionComplexity === 'Low'){
    shiftWeight(items, servicesIdx, primaryIdx, 0.04, adjustments, 'Lower complexity returns {pct}% of cost to core offering.')
  }
  if (input.valueAdd === 'High'){
    shiftWeight(items, primaryIdx, servicesIdx, 0.03, adjustments, 'High VAR value-add expands services scope (+{pct}%).')
    shiftWeight(items, primaryIdx, supportIdx, 0.015, adjustments, 'High value-add upgrades support coverage (+{pct}%).')
  } else if (input.valueAdd === 'Low'){
    shiftWeight(items, servicesIdx, primaryIdx, 0.02, adjustments, 'Lower value-add keeps cost concentrated in OEM offer (-{pct}% services).')
  }
  if ((input.isNewLogo ?? false)){
    shiftWeight(items, primaryIdx, servicesIdx, 0.02, adjustments, 'New logo onboarding adds {pct}% more implementation effort.')
  }
  if (input.customerSegment === 'Enterprise'){
    shiftWeight(items, primaryIdx, supportIdx, 0.025, adjustments, 'Enterprise coverage reserves {pct}% for premium support.')
  }
  ensureWeights(items)
  return { items, adjustments }
}

function inferQuantity(item, input){
  if (typeof item.quantityFn === 'function') return item.quantityFn(input)
  if (typeof item.quantity === 'number') return item.quantity
  return 1
}

function defaultNote(unit, quantity){
  if (!unit) return ''
  const q = Number.isInteger(quantity) ? quantity : quantity.toFixed(1)
  if (unit === 'hrs') return `Sized at ${q} hrs of effort.`
  if (unit === 'sessions') return `${q} enablement sessions.`
  if (unit === 'weeks') return `${q} weeks of program coverage.`
  if (unit === 'mo') return `${q} month term.`
  if (unit === 'yr') return `${q} year coverage.`
  return ''
}

function parseNumber(value){
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

export function computeManualBomStats(lines){
  if (!Array.isArray(lines) || !lines.length){
    return {
      lineCount: 0,
      avgMarginPct: 0,
      blendedMarginPct: 0,
      totals: { cost: 0, price: 0, marginPct: 0 },
      manual: false
    }
  }
  let totalCost = 0
  let totalPrice = 0
  let marginSum = 0
  lines.forEach(line => {
    const quantity = Math.max(0.01, parseNumber(line.quantity ?? 1))
    const unitCost = Math.max(0, parseNumber(line.discountedPrice ?? line.cost ?? 0))
    const unitPrice = Math.max(0, parseNumber(line.priceAfterMargin ?? line.finalPrice ?? line.extendedPrice ?? 0))
    const cost = unitCost * quantity
    const price = unitPrice * quantity
    totalCost += cost
    totalPrice += price
    const margin = price > 0 ? (price - cost) / price : 0
    marginSum += margin
  })
  const blended = totalPrice > 0 ? (totalPrice - totalCost) / totalPrice : 0
  const avg = marginSum / lines.length || 0
  return {
    lineCount: lines.length,
    avgMarginPct: avg,
    blendedMarginPct: blended,
    totals: {
      cost: roundCurrency(totalCost),
      price: roundCurrency(totalPrice),
      marginPct: blended
    },
    manual: true
  }
}

export function buildBillOfMaterials(input, rec, options = {}){
  const manualLines = Array.isArray(options.manualLines) ? options.manualLines : []
  if (manualLines.length){
    const enriched = manualLines.map((line, idx)=> {
      const quantity = Math.max(0.01, parseNumber(line.quantity ?? 1))
      const listPrice = Math.max(0, parseNumber(line.listPrice))
      const discountedPrice = Math.max(0, parseNumber(line.discountedPrice))
      const priceAfterMargin = Math.max(0, parseNumber(line.priceAfterMargin ?? line.finalPrice ?? line.extendedPrice))
      const marginPct = priceAfterMargin > 0 ? (priceAfterMargin - discountedPrice)/priceAfterMargin : 0
      const recommendedMarginPct = line.recommendedMarginPct != null
        ? Math.max(0, parseNumber(line.recommendedMarginPct)/100)
        : null
      const extendedCost = discountedPrice * quantity
      const extendedPrice = priceAfterMargin * quantity
      return {
        key: line.key || `manual-${idx}`,
        label: line.description || line.label || `Line ${idx+1}`,
        category: line.category || 'Hardware',
        unit: line.unit || 'ea',
        productNumber: line.productNumber || '',
        productId: line.productId || '',
        vendor: line.vendor || '',
        quantity: roundTo(quantity, 2),
        unitCost: roundCurrency(discountedPrice),
        unitPrice: roundCurrency(priceAfterMargin),
        listPrice: roundCurrency(listPrice),
        discountedPrice: roundCurrency(discountedPrice),
        priceAfterMargin: roundCurrency(priceAfterMargin),
        extendedCost: roundCurrency(extendedCost),
        extendedPrice: roundCurrency(extendedPrice),
        marginPct,
        recommendedMarginPct,
        note: line.note || ''
      }
    })
    const stats = computeManualBomStats(manualLines)
    const summary = [
      'Manual BOM provided.',
      `Blended margin ${(stats.blendedMarginPct*100).toFixed(1)}% across ${stats.lineCount} line(s).`
    ].join(' ')
    return {
      origin: 'manual',
      items: enriched,
      totals: stats.totals,
      summary,
      stats
    }
  }


  if (!input || !rec) {
    return {
      origin: 'generated',
      items: [],
      totals: { cost: 0, price: 0, marginPct: 0 },
      summary: 'No BOM available.',
      stats: { lineCount: 0, avgMarginPct: 0, blendedMarginPct: 0, manual: false }
    }
  }
  const totalCost = Number(input.oemCost ?? 0)
  if (!(totalCost > 0)) {
    return {
      origin: 'generated',
      items: [],
      totals: { cost: 0, price: 0, marginPct: 0 },
      summary: 'No BOM available.',
      stats: { lineCount: 0, avgMarginPct: 0, blendedMarginPct: 0, manual: false }
    }
  }
  const marginPct = Number(rec.suggestedMarginPct ?? 0) / 100
  const targetPrice = Number(rec.suggestedPrice ?? totalCost * (1 + marginPct))

  const vendor = resolveVendor(input.oem)
  const template = (BOM_TEMPLATES[input.productCategory] || BOM_TEMPLATES.ComplexSolution || []).map(item => ({ ...item }))
  const { items: weightedItems, adjustments } = adjustWeights(template, input)

  let items = weightedItems.map(item => {
    const baseQuantity = Math.max(item.minQuantity ?? 1, inferQuantity(item, input))
    const extendedCost = totalCost * item.weight
    const unitCost = extendedCost / baseQuantity
    const marginTarget = clamp(marginPct + (item.marginAdj ?? 0), 0.05, 0.7)
    const extendedPrice = extendedCost * (1 + marginTarget)

    // Look up vendor-specific SKU for this BOM role
    const sku = vendor ? lookupSku(vendor, input.productCategory, item.key) : null
    const label = sku ? sku.name : item.label
    const productNumber = sku ? sku.sku : ''

    return {
      key: item.key,
      label,
      category: item.category,
      unit: item.unit || '',
      productNumber,
      vendor: vendor || '',
      quantity: baseQuantity,
      unitCost,
      extendedCost,
      marginTarget,
      extendedPrice,
      note: defaultNote(item.unit, baseQuantity)
    }
  })

  const priceSum = items.reduce((sum, item)=> sum + item.extendedPrice, 0)
  const scale = priceSum > 0 ? targetPrice / priceSum : 1

  items = items.map(item => {
    const scaledExtendedPrice = item.extendedPrice * scale
    const unitPrice = scaledExtendedPrice / item.quantity
    const marginPct = scaledExtendedPrice > 0 ? (scaledExtendedPrice - item.extendedCost) / scaledExtendedPrice : 0
    const quantityDecimals = item.unit && ['hrs','sessions','weeks','mo','yr'].includes(item.unit) ? 0 : 2
    return {
      key: item.key,
      label: item.label,
      category: item.category,
      unit: item.unit,
      productNumber: item.productNumber || '',
      vendor: item.vendor || '',
      quantity: roundTo(item.quantity, quantityDecimals),
      unitCost: roundCurrency(item.unitCost),
      unitPrice: roundCurrency(unitPrice),
      extendedCost: roundCurrency(item.extendedCost),
      extendedPrice: roundCurrency(scaledExtendedPrice),
      marginPct,
      note: item.note
    }
  })

  const totals = items.reduce((acc,item)=> {
    acc.cost += item.extendedCost
    acc.price += item.extendedPrice
    return acc
  }, { cost:0, price:0 })
  totals.cost = roundCurrency(totals.cost)
  totals.price = roundCurrency(totals.price)
  totals.marginPct = totals.price > 0 ? (totals.price - totals.cost) / totals.price : 0

  const summaryParts = []
  if (adjustments.length){
    summaryParts.push(adjustments.join(' '))
  }
  summaryParts.push(`BOM totals to $${totals.price.toLocaleString(undefined,{maximumFractionDigits:0})} and holds ${(totals.marginPct*100).toFixed(1)}% blended margin.`)
  const summary = summaryParts.join(' ')

  const avgMargin = items.reduce((sum,item)=> sum + item.marginPct, 0) / (items.length || 1)

  return {
    origin: 'generated',
    items,
    totals,
    summary,
    stats: {
      lineCount: items.length,
      avgMarginPct: avgMargin,
      blendedMarginPct: totals.marginPct,
      manual: false
    }
  }
}

function roundCurrency(value){
  return Math.round(value * 100) / 100
}

function roundTo(value, decimals){
  const factor = Math.pow(10, decimals)
  return Math.round(value * factor) / factor
}
