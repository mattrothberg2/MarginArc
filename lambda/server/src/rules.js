import { topKNeighbors } from './knn.js'
import { estimateWinProb } from './winprob.js'

function policyFloorFor(input){
  const compsHigh = (input.competitors==='2' || input.competitors==='3+')
  const critical = (input.customerSegment==='Enterprise' && compsHigh && input.dealRegType==='NotRegistered')
  return critical ? 0.005 : 0.03
}

function clamp(x,a,b){ return Math.max(a, Math.min(b, x)) }

// Industry margin adjustments: reflects typical VAR margin variability by vertical
const INDUSTRY_MARGIN_ADJ = {
  'Financial Services': +0.015,       // regulated, price-insensitive, compliance-heavy
  'Life Sciences & Healthcare': +0.01, // compliance, long cycles, willingness to pay
  'Energy': +0.01,                     // capital-intensive, project-based
  'Transportation & Logistics': +0.005, // operational, value-driven
  'Manufacturing & Automotive': 0,     // moderate, value-engineering buyers
  'Diversified Conglomerates': 0,      // varies
  'Media & Telecommunications': -0.005, // tech-savvy, competitive
  'Technology': -0.01,                 // savvy buyers, multiple alternatives
  'Consumer Goods & Food': -0.01,      // volume-driven, price-aware
  'Retail': -0.015                     // price-sensitive, volume-focused
}

// OEM base margin ranges (typical VAR cost-plus ranges)
const OEM_MARGIN_ADJ = {
  'Cisco':         +0.01,   // strong deal reg programs, higher VAR margins
  'Palo Alto':     +0.015,  // security premium, less price transparency
  'Fortinet':      +0.005,  // competitive pricing but good channel margins
  'HPE':           0,        // standard compute/storage margins
  'Dell':          -0.005,   // competitive, direct sales pressure
  'VMware':        +0.01,    // software stickiness, renewal margins
  'Microsoft':     -0.01,    // low-margin licensing, CSP pressure
  'Pure Storage':  +0.015,   // premium positioning, less competition
  'NetApp':        +0.005,   // storage specialist, solid margins
  'Arista':        +0.01     // data center premium, less price pressure
}

export function ruleBasedRecommendation(input, deals=[], nn=null){
  const {
    oemCost, productCategory, customerSegment,
    relationshipStrength, customerTechSophistication,
    dealRegType, competitors, valueAdd,
    solutionComplexity, varStrategicImportance,
    customerPriceSensitivity,
    customerLoyalty,
    dealUrgency,
    isNewLogo,
    solutionDifferentiation,
    customerIndustry,
    oem,
    servicesAttached,
    quarterEnd,
    displacementDeal
  } = input

  const priceSens = customerPriceSensitivity ?? 3
  const loyalty = customerLoyalty ?? 3
  const urgency = dealUrgency ?? 3
  const newLogo = isNewLogo ?? false
  const differentiation = solutionDifferentiation ?? 3

  const drivers = []
  const compsHigh = (competitors==='2'||competitors==='3+')

  // ── 1. Segment base ──
  let base = 0.14
  if (customerSegment==='SMB'){ base = 0.20; drivers.push(['SMB base', +0.20]) }
  else if (customerSegment==='MidMarket'){ base = 0.17; drivers.push(['Mid-market base', +0.17]) }
  else { drivers.push(['Enterprise base', +0.14]) }

  // ── 2. Deal registration ──
  {
    const oemDealRegBoost = input.oemProfile?.dealRegBoost != null
      ? input.oemProfile.dealRegBoost / 100
      : null
    if (dealRegType==='PremiumHunting'){
      const adj = oemDealRegBoost ?? 0.06
      base+=adj; drivers.push(['Premium/Hunting registration', +adj])
    } else if (dealRegType==='StandardApproved' || dealRegType==='Teaming'){
      const adj = oemDealRegBoost != null ? oemDealRegBoost / 2 : 0.03
      base+=adj; drivers.push(['Standard/Teaming registration', +adj])
    } else { drivers.push(['No registration benefit', 0]) }
  }

  // ── 3. Competition ──
  if (competitors==='0'){ base+=0.025; drivers.push(['No competitors', +0.025]) }
  else if (competitors==='2'){ base-=0.02; drivers.push(['2 competitors', -0.02]) }
  else if (competitors==='3+'){ base-=0.035; drivers.push(['3+ competitors', -0.035]) }
  else { drivers.push(['1 competitor', 0]) }

  // ── 3b. Competitor profile adjustments (additive to count-based rule) ──
  if (Array.isArray(input.competitorProfiles) && input.competitorProfiles.length > 0) {
    const profiles = input.competitorProfiles.filter(p => p.marginAggression != null)
    if (profiles.length > 0) {
      const avgAggression = profiles.reduce((s, p) => s + p.marginAggression, 0) / profiles.length
      const adj = avgAggression * 0.005
      if (Math.abs(adj) > 0.001) {
        base += adj
        const names = profiles.map(p => p.name).join(', ')
        drivers.push([`Competitor profile (${names})`, adj])
      }
    }

    const aggressiveComps = input.competitorProfiles.filter(p => (p.priceAggression || 3) >= 4)
    if (aggressiveComps.length > 0) {
      const adj = -0.01 * aggressiveComps.length
      base += adj
      const names = aggressiveComps.map(p => p.name).join(', ')
      drivers.push([`Price-aggressive competitors (${names})`, adj])
    }
  }

  // ── 4. VAR value-add ──
  if (valueAdd==='High'){ base+=0.06; drivers.push(['High VAR value-add', +0.06]) }
  else if (valueAdd==='Medium'){ base+=0.03; drivers.push(['Medium VAR value-add', +0.03]) }

  // ── 5. Relationship ──
  if (relationshipStrength==='Strategic'){ base+=0.02; drivers.push(['Strategic relationship', +0.02]) }
  else if (relationshipStrength==='Good'){ base+=0.01; drivers.push(['Good relationship', +0.01]) }

  // ── 6. Customer price sensitivity ──
  if (priceSens>=4){ base-=0.02; drivers.push(['High price sensitivity', -0.02]) }
  else if (priceSens<=2){ base+=0.02; drivers.push(['Low price sensitivity', +0.02]) }

  // ── 7. Customer loyalty ──
  if (loyalty>=4){ base+=0.015; drivers.push(['High customer loyalty', +0.015]) }
  else if (loyalty<=2){ base-=0.01; drivers.push(['Low customer loyalty', -0.01]) }

  // ── 8. Product category ──
  if (productCategory==='ManagedServices' || productCategory==='ProfessionalServices'){ base+=0.03; drivers.push(['Services category', +0.03]) }
  else if (productCategory==='Software' || productCategory==='Cloud'){ base+=0.01; drivers.push(['Software/Cloud', +0.01]) }
  else if (productCategory==='ComplexSolution'){ base+=0.015; drivers.push(['Complex solution', +0.015]) }

  // ── 9. Solution complexity ──
  if (solutionComplexity==='High'){ base+=0.01; drivers.push(['High complexity', +0.01]) }
  else if (solutionComplexity==='Low'){ base-=0.005; drivers.push(['Low complexity', -0.005]) }

  // ── 10. Strategic importance ──
  if (varStrategicImportance==='High'){ base-=0.01; drivers.push(['High strategic importance (accept lower)', -0.01]) }

  // ── 11. Deal urgency ──
  if (urgency>=4){ base+=0.015; drivers.push(['High deal urgency', +0.015]) }
  else if (urgency<=2){ base-=0.01; drivers.push(['Low deal urgency', -0.01]) }

  // ── 12. New logo ──
  if (newLogo){ base-=0.015; drivers.push(['New logo deal', -0.015]) }

  // ── 13. Solution differentiation ──
  if (differentiation>=4){ base+=0.02; drivers.push(['Strong solution differentiation', +0.02]) }
  else if (differentiation<=2){ base-=0.015; drivers.push(['Weak solution differentiation', -0.015]) }

  // ── 14. Tech sophistication ──
  if (customerTechSophistication==='High'){ base-=0.005; drivers.push(['High tech sophistication', -0.005]) }
  else if (customerTechSophistication==='Low'){ base+=0.005; drivers.push(['Low tech sophistication', +0.005]) }

  // ── 15. Deal size ──
  if (oemCost>500000){ base-=0.01; drivers.push(['XL deal size', -0.01]) }
  else if (oemCost>100000){ base-=0.005; drivers.push(['Large deal size', -0.005]) }

  // ── 16. Industry vertical (NEW) ──
  if (customerIndustry) {
    const adj = INDUSTRY_MARGIN_ADJ[customerIndustry] ?? 0
    if (adj !== 0) {
      base += adj
      drivers.push([`${customerIndustry} industry`, adj])
    }
  }

  // ── 17. OEM base margin awareness ──
  if (oem) {
    const oemKey = oem.trim()
    let adj = OEM_MARGIN_ADJ[oemKey] ?? 0

    // Use admin-configured OEM profile baseMargin when available
    if (input.oemProfile?.baseMargin != null) {
      const segmentBase = { SMB: 20, MidMarket: 17, Enterprise: 14 }
      const expected = segmentBase[customerSegment] || 17
      adj = (input.oemProfile.baseMargin - expected) / 100
    }

    if (adj !== 0) {
      base += adj
      drivers.push([`${oemKey} OEM margin profile`, adj])
    }
  }

  // ── 18. Services mix ──
  if (servicesAttached) {
    // Use admin-configured services boost when available, else hardcoded default
    const adj = input.oemProfile?.servicesBoost != null
      ? input.oemProfile.servicesBoost / 100
      : +0.02
    base += adj
    drivers.push(['Services attached', adj])
  }

  // ── 19. Quarter-end timing ──
  if (quarterEnd) {
    // Use admin-configured quarter-end discount when available, else hardcoded default
    const adj = input.oemProfile?.quarterEndDiscount != null
      ? input.oemProfile.quarterEndDiscount / 100
      : +0.015
    base += adj
    drivers.push(['Quarter-end timing', adj])
  }

  // ── 20. Displacement deal (NEW) ──
  if (displacementDeal) {
    // Displacing an incumbent — need to be more aggressive on price
    const adj = -0.02
    base += adj
    drivers.push(['Displacement deal', adj])
  }

  // ── 21. Services-heavy category boost (NEW) ──
  // If it's a hardware/complex deal AND services are attached, compound boost
  if (servicesAttached && (productCategory === 'Hardware' || productCategory === 'ComplexSolution')) {
    const adj = +0.01
    base += adj
    drivers.push(['Services uplift on hardware', adj])
  }

  // ── 22. Account size tier (NEW) ──
  // Beyond deal size: very small deals get higher margins, mega deals get compressed
  if (oemCost <= 25000) {
    const adj = +0.015
    base += adj
    drivers.push(['Small deal premium', adj])
  } else if (oemCost > 1000000) {
    const adj = -0.01
    base += adj
    drivers.push(['Mega deal compression', adj])
  }

  const policyFloor = policyFloorFor(input)

  // Neighbors
  let final = base
  let methodNote = 'Rules only'
  let confidence = 0.4
  const neighborData = nn || (Array.isArray(deals) && deals.length ? topKNeighbors(input, deals, 12) : null)
  if (neighborData){
    let adj = 0
    if (neighborData.lossOnPrice>0) adj -= 0.015*neighborData.lossOnPrice
    if (neighborData.highWins>0 && neighborData.lossOnPrice===0) adj += 0.01*neighborData.highWins
    const alpha = clamp(0.25 + neighborData.count/40, 0.25, 0.6)
    final = alpha*neighborData.weightedAvg + (1-alpha)*base + adj
    const agree = 1 - Math.min(1, Math.abs(base - neighborData.weightedAvg)/0.12)
    confidence = clamp(0.3 + 0.015*neighborData.count + 0.25*agree, 0.2, 0.8)
    methodNote = `Rules ${(100*(1-alpha)).toFixed(0)}% + kNN ${(100*alpha).toFixed(0)}%`
  }

  final = clamp(final, policyFloor, 0.55)
  const price = oemCost*(1+final)
  const driverList = drivers.sort((a,b)=>Math.abs(b[1])-Math.abs(a[1])).slice(0,6).map(([name,val])=>({name,val}))
  const winProbability = estimateWinProb({ marginPct: final*100, competitors, dealRegType, customerSegment, relationshipStrength, valueAdd, isNewLogo: newLogo, solutionComplexity, servicesAttached, quarterEnd, competitorProfiles: input.competitorProfiles }) / 100

  return {
    suggestedMarginPct: final*100,
    suggestedPrice: price,
    winProbability,
    drivers: driverList,
    policyFloor,
    confidence,
    method: `Advanced rules + kNN (${methodNote})`
  }
}

export async function computeRecommendation(input, deals=[], options={}){
  const bomStats = options?.bomStats || null
  const neighborInput = {
    ...input,
    bomLineCount: bomStats?.lineCount ?? 0,
    bomAvgMarginPct: bomStats?.avgMarginPct ?? null,
    hasManualBom: Boolean(bomStats?.manual)
  }
  const nn = Array.isArray(deals) && deals.length ? topKNeighbors(neighborInput, deals, 12) : null
  const policyFloor = policyFloorFor(input)
  const url = process.env.MODEL_URL
  const timeoutMs = parseInt(process.env.MODEL_TIMEOUT_MS, 10) || 2000

  if (url){
    try {
      const controller = new AbortController()
      const t = setTimeout(()=>controller.abort(), timeoutMs)
      const modelPayload = {
        input: neighborInput,
        neighbors: nn?.top || []
      }
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type':'application/json' },
        body: JSON.stringify(modelPayload),
        signal: controller.signal
      })
      clearTimeout(t)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      const margin = clamp(data.marginPct ?? 0, policyFloor, 0.55)
      const mlWinProb = estimateWinProb({ marginPct: margin*100, competitors: input.competitors, dealRegType: input.dealRegType, customerSegment: input.customerSegment, relationshipStrength: input.relationshipStrength, valueAdd: input.valueAdd, isNewLogo: input.isNewLogo, solutionComplexity: input.solutionComplexity, servicesAttached: input.servicesAttached, quarterEnd: input.quarterEnd, competitorProfiles: input.competitorProfiles }) / 100
      return {
        suggestedMarginPct: margin*100,
        suggestedPrice: input.oemCost*(1+margin),
        winProbability: mlWinProb,
        drivers: Array.isArray(data.drivers) ? data.drivers : [],
        policyFloor,
        confidence: data.confidence ?? 0.5,
        method: 'ML model'
      }
    } catch (err){
      console.error('Model fetch failed, falling back to rules:', err.message)
    }
  }

  return ruleBasedRecommendation(input, deals, nn)
}
