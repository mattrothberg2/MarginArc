export function estimateWinProb(opts = {}){
  const { marginPct, competitors, dealRegType, customerSegment,
    relationshipStrength, valueAdd, isNewLogo, solutionComplexity, servicesAttached, quarterEnd } = opts
  // Base probability from competition level
  let base = (competitors==='0')? 0.68 : (competitors==='1')? 0.58 : (competitors==='2')? 0.43 : 0.32

  // Deal registration
  if (dealRegType==='PremiumHunting') base += 0.12
  else if (dealRegType==='StandardApproved' || dealRegType==='Teaming') base += 0.06

  // Segment
  if (customerSegment==='Enterprise') base -= 0.04

  // Relationship strength
  if (relationshipStrength==='Strategic') base += 0.06
  else if (relationshipStrength==='Good') base += 0.03
  else if (relationshipStrength==='New') base -= 0.03

  // Value-add boosts win probability
  if (valueAdd==='High') base += 0.04
  else if (valueAdd==='Low') base -= 0.02

  // New logo deals are harder to win
  if (isNewLogo) base -= 0.04

  // Complex solutions have longer cycles but services stickiness
  if (solutionComplexity==='High') base -= 0.02
  else if (solutionComplexity==='Low') base += 0.01

  // Services attached improves stickiness
  if (servicesAttached) base += 0.03

  // Quarter-end urgency helps close
  if (quarterEnd) base += 0.03

  // Competitor aggression factor
  if (Array.isArray(opts.competitorProfiles) && opts.competitorProfiles.length > 0) {
    const avgAgg = opts.competitorProfiles.reduce((s, p) =>
      s + (p.priceAggression || 3), 0) / opts.competitorProfiles.length
    base += (3 - avgAgg) * 0.02
  }

  // Margin-based logistic: higher margin = lower win probability
  const knee = 18
  const slope = 0.08
  const delta = marginPct - knee
  const logistic = 1/(1+Math.exp(slope*delta))
  const wp = clamp( (0.6*base + 0.4*logistic), 0.05, 0.95 )
  return Math.round(wp*100)
}

function clamp(x,a,b){ return Math.max(a, Math.min(b, x)) }
