import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const bomCatalog = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'data/bom_catalog.json'), 'utf-8')
)
const vendorSkus = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'data/vendor_skus.json'), 'utf-8')
)

const MARGIN_RANGES = {
  Hardware:             { low: 8,  high: 18 },
  Software:            { low: 12, high: 25 },
  Cloud:               { low: 10, high: 20 },
  ProfessionalServices: { low: 25, high: 45 },
  ManagedServices:     { low: 20, high: 35 },
  ComplexSolution:     { low: 15, high: 30 }
}

const DEFAULT_DISCOUNTS = {
  Hardware: 0.30,
  Software: 0.20,
  Cloud: 0.18,
  ProfessionalServices: 0.15,
  ManagedServices: 0.18,
  ComplexSolution: 0.25
}

// Build unified in-memory catalog at cold start
const catalog = buildCatalog()

function buildCatalog() {
  const items = []
  const seen = new Set()

  // 1. Flatten vendor_skus.json — richer data with real SKUs
  for (const [manufacturer, categories] of Object.entries(vendorSkus)) {
    for (const [category, roles] of Object.entries(categories)) {
      for (const [role, skus] of Object.entries(roles)) {
        for (const sku of skus) {
          const key = `${manufacturer}:${sku.sku}`
          if (seen.has(key)) continue
          seen.add(key)
          items.push({
            partNumber: sku.sku,
            description: sku.name,
            manufacturer,
            category,
            role,
            listPrice: sku.listPrice,
            suggestedDiscount: DEFAULT_DISCOUNTS[category] ?? 0.20,
            typicalMarginRange: MARGIN_RANGES[category] ?? MARGIN_RANGES.Hardware
          })
        }
      }
    }
  }

  // 2. Merge bom_catalog.json — only add items not already covered
  for (const item of bomCatalog) {
    const key = `${item.vendor}:${item.productId}`
    if (seen.has(key)) continue
    seen.add(key)
    const category = item.category || 'Hardware'
    items.push({
      partNumber: item.productId,
      description: item.name,
      manufacturer: item.vendor,
      category,
      role: 'core',
      listPrice: item.listPrice,
      suggestedDiscount: item.discountRate ?? DEFAULT_DISCOUNTS[category] ?? 0.20,
      typicalMarginRange: MARGIN_RANGES[category] ?? MARGIN_RANGES.Hardware
    })
  }

  return items
}

/**
 * Search the unified product catalog.
 *
 * @param {object} params
 * @param {string} [params.query]        - Free-text search (AND logic for multiple words)
 * @param {string} [params.manufacturer] - Exact manufacturer filter (case-insensitive)
 * @param {string} [params.category]     - Exact category filter (case-insensitive)
 * @param {number} [params.limit=20]     - Max results (1–100)
 * @returns {{ results: object[], total: number, query: string }}
 */
export function searchCatalog({ query, manufacturer, category, limit } = {}) {
  const maxLimit = Math.min(Math.max(1, limit != null ? limit : 20), 100)
  const queryStr = (query || '').trim()
  const words = queryStr.toLowerCase().split(/\s+/).filter(Boolean)

  let results = catalog

  // Filter by manufacturer (case-insensitive exact match)
  if (manufacturer) {
    const mfr = manufacturer.toLowerCase()
    results = results.filter(item => item.manufacturer.toLowerCase() === mfr)
  }

  // Filter by category (case-insensitive exact match)
  if (category) {
    const cat = category.toLowerCase()
    results = results.filter(item => item.category.toLowerCase() === cat)
  }

  // Free-text search: all words must match across partNumber, description, or name
  if (words.length) {
    results = results.filter(item => {
      const searchable = `${item.partNumber} ${item.description}`.toLowerCase()
      return words.every(w => searchable.includes(w))
    })
  }

  const total = results.length

  return {
    results: results.slice(0, maxLimit),
    total,
    query: queryStr || null
  }
}

export { catalog as _catalog }
