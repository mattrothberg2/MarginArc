/**
 * Industry Benchmarks for Phase 1 margin guidance.
 *
 * Returns OEM/segment/size-based margin ranges from curated industry data
 * so Phase 1 customers get actionable guidance from Day 1 (before ML kicks in).
 */

// ── Benchmark Data ──────────────────────────────────────────────────
// Structure: OEM → Segment → { p25, median, p75, source }
// Margins are percentage points (e.g. 15 = 15%).
// Sources: distributor surveys, public earnings reports, VAR industry knowledge.

const BENCHMARKS = {
  Cisco: {
    Enterprise: { p25: 10, median: 14, p75: 17, source: 'Cisco Enterprise benchmark' },
    MidMarket:  { p25: 15, median: 19, p75: 24, source: 'Cisco MidMarket benchmark' },
    SMB:        { p25: 18, median: 23, p75: 28, source: 'Cisco SMB benchmark' },
  },
  Dell: {
    Enterprise: { p25: 8,  median: 12, p75: 16, source: 'Dell Enterprise benchmark' },
    MidMarket:  { p25: 14, median: 18, p75: 23, source: 'Dell MidMarket benchmark' },
    SMB:        { p25: 18, median: 22, p75: 27, source: 'Dell SMB benchmark' },
  },
  HPE: {
    Enterprise: { p25: 9,  median: 13, p75: 17, source: 'HPE Enterprise benchmark' },
    MidMarket:  { p25: 15, median: 19, p75: 24, source: 'HPE MidMarket benchmark' },
    SMB:        { p25: 19, median: 23, p75: 28, source: 'HPE SMB benchmark' },
  },
  Microsoft: {
    Enterprise: { p25: 12, median: 16, p75: 22, source: 'Microsoft Enterprise benchmark' },
    MidMarket:  { p25: 18, median: 22, p75: 28, source: 'Microsoft MidMarket benchmark' },
    SMB:        { p25: 22, median: 26, p75: 32, source: 'Microsoft SMB benchmark' },
  },
  'Palo Alto': {
    Enterprise: { p25: 12, median: 16, p75: 20, source: 'Palo Alto Enterprise benchmark' },
    MidMarket:  { p25: 18, median: 22, p75: 27, source: 'Palo Alto MidMarket benchmark' },
    SMB:        { p25: 22, median: 26, p75: 32, source: 'Palo Alto SMB benchmark' },
  },
  CrowdStrike: {
    Enterprise: { p25: 18, median: 22, p75: 28, source: 'CrowdStrike Enterprise benchmark' },
    MidMarket:  { p25: 22, median: 26, p75: 32, source: 'CrowdStrike MidMarket benchmark' },
    SMB:        { p25: 25, median: 30, p75: 35, source: 'CrowdStrike SMB benchmark' },
  },
  Fortinet: {
    Enterprise: { p25: 12, median: 15, p75: 20, source: 'Fortinet Enterprise benchmark' },
    MidMarket:  { p25: 16, median: 20, p75: 25, source: 'Fortinet MidMarket benchmark' },
    SMB:        { p25: 20, median: 24, p75: 28, source: 'Fortinet SMB benchmark' },
  },
  VMware: {
    Enterprise: { p25: 10, median: 14, p75: 18, source: 'VMware Enterprise benchmark' },
    MidMarket:  { p25: 16, median: 20, p75: 25, source: 'VMware MidMarket benchmark' },
    SMB:        { p25: 20, median: 24, p75: 30, source: 'VMware SMB benchmark' },
  },
  'Pure Storage': {
    Enterprise: { p25: 12, median: 16, p75: 22, source: 'Pure Storage Enterprise benchmark' },
    MidMarket:  { p25: 18, median: 22, p75: 28, source: 'Pure Storage MidMarket benchmark' },
    SMB:        { p25: 22, median: 26, p75: 32, source: 'Pure Storage SMB benchmark' },
  },
  _default: {
    Enterprise: { p25: 10, median: 14, p75: 18, source: 'General IT VAR Enterprise benchmark' },
    MidMarket:  { p25: 14, median: 18, p75: 23, source: 'General IT VAR MidMarket benchmark' },
    SMB:        { p25: 18, median: 22, p75: 27, source: 'General IT VAR SMB benchmark' },
  },
}

// The spec table has Enterprise split into Large (>$100K) and Small (<$100K).
// We store Enterprise as one entry and handle size via compression below.
// For <$25K deals we bump up to SMB-level margins regardless of segment.

// ── Size Bucket ─────────────────────────────────────────────────────

export function getSizeBucket(oemCost) {
  if (oemCost < 25_000)    return '<$25K'
  if (oemCost < 100_000)   return '$25K-$100K'
  if (oemCost < 500_000)   return '$100K-$500K'
  if (oemCost < 1_000_000) return '$500K-$1M'
  return '$1M+'
}

// ── Benchmark Lookup ────────────────────────────────────────────────

const FINAL_FALLBACK = { p25: 12, median: 16, p75: 22, source: 'General IT VAR benchmark' }

export function getBenchmark(oem, segment, oemCost) {
  const sizeBucket = getSizeBucket(oemCost)

  // For small deals (<$25K), use SMB margins (more margin room)
  const effectiveSegment = sizeBucket === '<$25K' ? 'SMB' : (segment || 'MidMarket')

  // Cascading lookup
  let entry = null
  let specificity = 'general'

  if (oem && BENCHMARKS[oem] && BENCHMARKS[oem][effectiveSegment]) {
    entry = BENCHMARKS[oem][effectiveSegment]
    specificity = 'oem_segment'
  } else if (oem && BENCHMARKS[oem]) {
    // OEM exists but not the segment — pick MidMarket or first available
    entry = BENCHMARKS[oem].MidMarket || Object.values(BENCHMARKS[oem])[0]
    specificity = 'oem_default'
  } else if (BENCHMARKS._default[effectiveSegment]) {
    entry = BENCHMARKS._default[effectiveSegment]
    specificity = 'general'
  } else {
    entry = FINAL_FALLBACK
    specificity = 'general'
  }

  // Apply size compression for large deals
  let { p25, median, p75, source } = entry
  let compression = 0
  if (sizeBucket === '$500K-$1M') compression = 2
  else if (sizeBucket === '$1M+')  compression = 4

  if (compression > 0) {
    p25    = Math.max(5, p25 - compression)
    median = Math.max(5, median - compression)
    p75    = Math.max(5, p75 - compression)
  }

  return { low: p25, median, high: p75, source, specificity }
}

// ── Insights Generator ──────────────────────────────────────────────

function generateInsights(dealInput, benchmark) {
  const insights = []

  if (dealInput.dealRegType && dealInput.dealRegType !== 'NotRegistered') {
    insights.push('Deal registration typically supports 2-4pp above median')
  }
  if (dealInput.competitors === '3+') {
    insights.push('3+ competitors typically compress margins 2-3pp below median')
  }
  if (dealInput.servicesAttached) {
    insights.push('Services-attached deals achieve 3-5pp higher blended margins')
  }
  if (dealInput.productCategory && (dealInput.productCategory.includes('Services') || dealInput.productCategory === 'ManagedServices')) {
    insights.push('Services/managed categories support premium margins')
  }
  if (dealInput.oemCost >= 500_000) {
    insights.push('Large deal sizes ($500K+) create 2-4pp margin compression')
  }

  // Always include the ML caveat
  insights.push('These ranges are industry benchmarks — your ML model will personalize after 100 closed deals')

  // Cap at 4 insights
  return insights.slice(0, 4)
}

// ── Public API ──────────────────────────────────────────────────────

export function generateBenchmarkResponse(dealInput) {
  const benchmark = getBenchmark(
    dealInput.oem,
    dealInput.customerSegment,
    dealInput.oemCost
  )

  const suggestedPrice = dealInput.oemCost / (1 - benchmark.median / 100)

  return {
    suggestedMarginPct: benchmark.median,
    suggestedMarginRange: { low: benchmark.low, high: benchmark.high },
    suggestedPrice: Math.round(suggestedPrice * 100) / 100,
    benchmarkSource: benchmark.source,
    benchmarkSpecificity: benchmark.specificity,
    insights: generateInsights(dealInput, benchmark),
    source: 'industry_benchmark',
  }
}

// ── IQR Lookup (used by ML training for segment-aware synthetic shifts) ──

/**
 * Get the IQR (p75 - p25) for a given OEM/segment combination.
 * Returns values in percentage points (e.g., 7 means 7pp).
 * Falls back to _default OEM, then to a hardcoded 10pp if nothing matches.
 */
export function getBenchmarkIQR(oem, segment) {
  const DEFAULT_IQR = 10
  const effectiveSegment = segment || 'MidMarket'

  if (oem && BENCHMARKS[oem] && BENCHMARKS[oem][effectiveSegment]) {
    const entry = BENCHMARKS[oem][effectiveSegment]
    return entry.p75 - entry.p25
  }

  if (BENCHMARKS._default[effectiveSegment]) {
    const entry = BENCHMARKS._default[effectiveSegment]
    return entry.p75 - entry.p25
  }

  return DEFAULT_IQR
}
