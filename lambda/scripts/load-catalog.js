#!/usr/bin/env node
/**
 * Load GPL product catalog data from CSV into PostgreSQL.
 *
 * Usage:
 *   node scripts/load-catalog.js [path-to-csv]
 *
 * Default CSV: ~/gsa-bom-data/output/bom_database_full.csv
 *
 * Requires AWS credentials for SSM (database config).
 * Set AWS_REGION=us-east-1 if not already set.
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Import from the server source (uses the same DB connection)
const { ensureCatalogTable, upsertProducts } = await import(
  path.join(__dirname, '..', 'server', 'src', 'catalog-db.js')
)

const DEFAULT_CSV = path.join(
  process.env.HOME, 'gsa-bom-data', 'output', 'bom_database_full.csv'
)

async function parseCsv(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8')
  const lines = content.split('\n')
  const header = lines[0].split(',').map(h => h.trim())

  // Find column indices
  const colIdx = {}
  const EXPECTED = ['manufacturer', 'part_number', 'description', 'product_category', 'product_family', 'list_price', 'gsa_price', 'source']
  for (const col of EXPECTED) {
    const idx = header.indexOf(col)
    if (idx === -1) {
      console.warn(`Warning: column '${col}' not found in CSV header`)
    }
    colIdx[col] = idx
  }

  const products = []
  let skipped = 0

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue

    // Simple CSV parser that handles quoted fields
    const fields = parseCSVLine(line)

    const manufacturer = fields[colIdx.manufacturer]?.trim()
    const partNumber = fields[colIdx.part_number]?.trim()

    if (!manufacturer || !partNumber) {
      skipped++
      continue
    }

    const listPriceRaw = fields[colIdx.list_price]?.trim()
    const gsaPriceRaw = fields[colIdx.gsa_price]?.trim()

    products.push({
      manufacturer,
      partNumber,
      description: fields[colIdx.description]?.trim() || null,
      category: fields[colIdx.product_category]?.trim() || null,
      family: fields[colIdx.product_family]?.trim() || null,
      listPrice: listPriceRaw ? parseFloat(listPriceRaw) || null : null,
      gsaPrice: gsaPriceRaw ? parseFloat(gsaPriceRaw) || null : null,
      source: fields[colIdx.source]?.trim() || null
    })
  }

  console.log(`Parsed ${products.length} products from CSV (${skipped} skipped)`)
  return products
}

function parseCSVLine(line) {
  const fields = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i++ // skip escaped quote
      } else {
        inQuotes = !inQuotes
      }
    } else if (ch === ',' && !inQuotes) {
      fields.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  fields.push(current)
  return fields
}

async function main() {
  const csvPath = process.argv[2] || DEFAULT_CSV

  if (!fs.existsSync(csvPath)) {
    console.error(`CSV file not found: ${csvPath}`)
    process.exit(1)
  }

  console.log(`Loading catalog from: ${csvPath}`)

  // Ensure table exists
  await ensureCatalogTable()

  // Parse CSV
  const products = await parseCsv(csvPath)

  // Filter out products without a price (not useful for BOM tool)
  const withPrice = products.filter(p => p.listPrice || p.gsaPrice)
  const noPrice = products.length - withPrice.length
  console.log(`${withPrice.length} products have pricing, ${noPrice} without pricing`)

  // Deduplicate by (manufacturer, partNumber) — keep last occurrence
  const deduped = new Map()
  for (const p of withPrice) {
    deduped.set(`${p.manufacturer}\t${p.partNumber}`, p)
  }
  const unique = [...deduped.values()]
  if (unique.length < withPrice.length) {
    console.log(`Deduplicated: ${withPrice.length} → ${unique.length} unique products`)
  }

  // Upsert in batches
  console.log('Upserting into database...')
  const total = await upsertProducts(unique)
  console.log(`Done! Upserted ${total} products.`)

  process.exit(0)
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
