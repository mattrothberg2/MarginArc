import { searchCatalog, _catalog } from '../src/bom-search.js'

// ── Catalog build ─────────────────────────────────────────────────

describe('catalog build', () => {
  it('builds a non-empty unified catalog', () => {
    expect(_catalog.length).toBeGreaterThan(0)
  })

  it('includes vendor_skus entries (Cisco C9300)', () => {
    const match = _catalog.find(i => i.partNumber === 'C9300-48P-A')
    expect(match).toBeDefined()
    expect(match.manufacturer).toBe('Cisco')
    expect(match.category).toBe('Hardware')
    expect(match.listPrice).toBe(12495)
  })

  it('includes bom_catalog entries not in vendor_skus', () => {
    const match = _catalog.find(i => i.partNumber === 'DEL-PWX820')
    expect(match).toBeDefined()
    expect(match.manufacturer).toBe('Dell Technologies')
  })

  it('every item has required fields', () => {
    for (const item of _catalog) {
      expect(item).toHaveProperty('partNumber')
      expect(item).toHaveProperty('description')
      expect(item).toHaveProperty('manufacturer')
      expect(item).toHaveProperty('category')
      expect(item).toHaveProperty('role')
      expect(item).toHaveProperty('listPrice')
      expect(item).toHaveProperty('suggestedDiscount')
      expect(item).toHaveProperty('typicalMarginRange')
      expect(item.typicalMarginRange).toHaveProperty('low')
      expect(item.typicalMarginRange).toHaveProperty('high')
    }
  })
})

// ── Search — free-text query ──────────────────────────────────────

describe('searchCatalog — free-text query', () => {
  it('matches partNumber substring', () => {
    const { results, total } = searchCatalog({ query: 'C9300' })
    expect(total).toBeGreaterThan(0)
    expect(results.every(r =>
      r.partNumber.toLowerCase().includes('c9300') ||
      r.description.toLowerCase().includes('c9300')
    )).toBe(true)
  })

  it('matches description substring (case-insensitive)', () => {
    const { results, total } = searchCatalog({ query: 'firewall' })
    expect(total).toBeGreaterThan(0)
    results.forEach(r => {
      const searchable = `${r.partNumber} ${r.description}`.toLowerCase()
      expect(searchable).toContain('firewall')
    })
  })

  it('multi-word AND logic', () => {
    const { results } = searchCatalog({ query: 'Catalyst 9300' })
    expect(results.length).toBeGreaterThan(0)
    results.forEach(r => {
      const text = `${r.partNumber} ${r.description}`.toLowerCase()
      expect(text).toContain('catalyst')
      expect(text).toContain('9300')
    })
  })

  it('returns empty for nonsense query', () => {
    const { results, total } = searchCatalog({ query: 'xyzzyfoobarbaz999' })
    expect(results).toEqual([])
    expect(total).toBe(0)
  })
})

// ── Search — filters ──────────────────────────────────────────────

describe('searchCatalog — filters', () => {
  it('filters by manufacturer (case-insensitive)', () => {
    const { results, total } = searchCatalog({ manufacturer: 'cisco' })
    expect(total).toBeGreaterThan(0)
    results.forEach(r => expect(r.manufacturer).toBe('Cisco'))
  })

  it('filters by category', () => {
    const { results } = searchCatalog({ category: 'Software' })
    expect(results.length).toBeGreaterThan(0)
    results.forEach(r => expect(r.category).toBe('Software'))
  })

  it('combines query + manufacturer + category', () => {
    const { results } = searchCatalog({
      query: 'DNA',
      manufacturer: 'Cisco',
      category: 'Software'
    })
    expect(results.length).toBeGreaterThan(0)
    results.forEach(r => {
      expect(r.manufacturer).toBe('Cisco')
      expect(r.category).toBe('Software')
      const text = `${r.partNumber} ${r.description}`.toLowerCase()
      expect(text).toContain('dna')
    })
  })

  it('returns all items when no filters', () => {
    const { results, total } = searchCatalog({})
    expect(total).toBe(_catalog.length)
    expect(results.length).toBeLessThanOrEqual(20) // default limit
  })
})

// ── Search — limit ────────────────────────────────────────────────

describe('searchCatalog — limit', () => {
  it('defaults to 20 results', () => {
    const { results, total } = searchCatalog({})
    expect(results.length).toBeLessThanOrEqual(20)
    expect(total).toBe(_catalog.length)
  })

  it('respects custom limit', () => {
    const { results } = searchCatalog({ limit: 5 })
    expect(results.length).toBeLessThanOrEqual(5)
  })

  it('caps at 100', () => {
    const { results } = searchCatalog({ limit: 999 })
    expect(results.length).toBeLessThanOrEqual(100)
  })

  it('treats limit < 1 as 1', () => {
    const { results } = searchCatalog({ limit: 0 })
    expect(results.length).toBeLessThanOrEqual(1)
  })
})

// ── Margin ranges ─────────────────────────────────────────────────

describe('typicalMarginRange by category', () => {
  const expected = {
    Hardware:             { low: 8,  high: 18 },
    Software:            { low: 12, high: 25 },
    Cloud:               { low: 10, high: 20 },
    ProfessionalServices: { low: 25, high: 45 },
    ManagedServices:     { low: 20, high: 35 }
  }

  for (const [category, range] of Object.entries(expected)) {
    it(`${category} → ${range.low}-${range.high}%`, () => {
      const { results } = searchCatalog({ category, limit: 100 })
      expect(results.length).toBeGreaterThan(0)
      results.forEach(r => {
        expect(r.typicalMarginRange).toEqual(range)
      })
    })
  }
})

// ── Response shape ────────────────────────────────────────────────

describe('response shape', () => {
  it('returns { results, total, query }', () => {
    const res = searchCatalog({ query: 'test' })
    expect(res).toHaveProperty('results')
    expect(res).toHaveProperty('total')
    expect(res).toHaveProperty('query')
    expect(Array.isArray(res.results)).toBe(true)
    expect(typeof res.total).toBe('number')
  })

  it('query is null when no query provided', () => {
    const res = searchCatalog({})
    expect(res.query).toBeNull()
  })

  it('query is null when query is empty string', () => {
    const res = searchCatalog({ query: '   ' })
    expect(res.query).toBeNull()
  })
})
