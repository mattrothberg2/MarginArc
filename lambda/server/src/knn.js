export function similarity(input, d){
  let s = 0
  const val = (x,def=3)=> x ?? def
  const dealIndustry = d.customerIndustry || d.industry
  if (dealIndustry && input.customerIndustry){
    s += dealIndustry === input.customerIndustry ? 0.5 : 0.1
  }
  s += (d.segment===input.customerSegment)? 1.0 : 0.2
  s += (d.productCategory===input.productCategory)? 0.8 : 0.1
  s += (d.dealRegType===input.dealRegType)? 0.6 : 0.2
  s += (d.valueAdd===input.valueAdd)? 0.6 : 0.2
  s += (d.solutionComplexity===input.solutionComplexity)? 0.5 : 0.2
  s += (d.relationshipStrength===input.relationshipStrength)? 0.4 : 0.1
  s += (d.customerTechSophistication===input.customerTechSophistication)? 0.3 : 0.1
  s += (d.competitors===input.competitors)? 0.6 :
        ((['2','3+'].includes(d.competitors) && ['2','3+'].includes(input.competitors))? 0.4 : 0.1)

  // Competitor identity matching
  if (Array.isArray(input.competitorNames) && input.competitorNames.length > 0) {
    const inputSet = new Set(input.competitorNames)
    const dealNames = Array.isArray(d.competitorNames) ? d.competitorNames : []
    if (dealNames.length > 0) {
      const dealSet = new Set(dealNames)
      const overlap = [...inputSet].filter(n => dealSet.has(n)).length
      const unionSize = new Set([...inputSet, ...dealSet]).size
      const jaccard = unionSize > 0 ? overlap / unionSize : 0
      s += 0.1 + jaccard * 0.5
    } else {
      s += 0.1
    }
  } else {
    s += 0.1
  }
  s += (val(d.customerPriceSensitivity)===val(input.customerPriceSensitivity))? 0.3 : 0.1
  s += (val(d.customerLoyalty)===val(input.customerLoyalty))? 0.2 : 0.1
  s += (val(d.dealUrgency)===val(input.dealUrgency))? 0.3 : 0.1
  s += ((d.isNewLogo??false)===(input.isNewLogo??false))? 0.2 : 0.1
  s += (val(d.solutionDifferentiation)===val(input.solutionDifferentiation))? 0.3 : 0.1
  const band = (x)=> x>500000?3 : x>100000?2 : 1
  s += (band(d.oemCost)===band(input.oemCost))? 0.4 : 0.1

  const lineCountInput = input.bomLineCount ?? 0
  const lineCountDeal = d.bomLineCount ?? 0
  if (lineCountInput === 0 && lineCountDeal === 0){
    s += 0.15
  } else if (lineCountInput > 0 && lineCountDeal > 0){
    const diff = Math.abs(lineCountInput - lineCountDeal)
    s += diff === 0 ? 0.6 : diff <= 2 ? 0.4 : 0.2
  } else {
    s += 0.1
  }

  const avgMarginInput = typeof input.bomAvgMarginPct === 'number' ? input.bomAvgMarginPct : null
  const avgMarginDeal = typeof d.bomAvgMarginPct === 'number' ? d.bomAvgMarginPct : null
  if (avgMarginInput != null && avgMarginDeal != null){
    const diff = Math.abs(avgMarginInput - avgMarginDeal)
    if (diff < 0.02) s += 0.45
    else if (diff < 0.05) s += 0.3
    else if (diff < 0.1) s += 0.18
    else s += 0.08
  }

  const manualMatch = (input.hasManualBom ?? false) === (d.hasManualBom ?? false)
  s += manualMatch ? 0.3 : 0.1

  // OEM vendor match (NEW)
  if (input.oem && d.oem) {
    s += (d.oem === input.oem) ? 0.5 : 0.1
  }

  // Services attached match (NEW)
  if (input.servicesAttached != null && d.servicesAttached != null) {
    s += (d.servicesAttached === input.servicesAttached) ? 0.25 : 0.1
  }

  // Quarter-end match (NEW)
  if (input.quarterEnd != null && d.quarterEnd != null) {
    s += (d.quarterEnd === input.quarterEnd) ? 0.2 : 0.1
  }

  return s
}

export function topKNeighbors(input, deals, k=12){
  const scored = deals.map(d => ({ d, s: similarity(input, d) })).sort((a,b)=>b.s-a.s)
  const top = scored.slice(0,k)
  const totalS = top.reduce((acc,x)=> acc + x.s, 0) || 1
  const wAvg = top.reduce((acc,x)=> acc + x.s*(x.d.achievedMargin||0), 0)/totalS
  const lossOnPrice = top.filter(x=>x.d.status==='Lost' && /price/i.test(x.d.lossReason||'')).length
  const highWins = top.filter(x=>x.d.status==='Won' && (x.d.achievedMargin||0)>0.20).length
  return { top: top.map(x=>x.d), weightedAvg: wAvg, lossOnPrice, highWins, count: top.length }
}
