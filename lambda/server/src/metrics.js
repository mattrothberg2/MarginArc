import { estimateWinProb } from './winprob.js'

function scenario(input, marginPct){
  const price = input.oemCost*(1+marginPct/100)
  const grossProfit = input.oemCost*(marginPct/100)
  const winProb = estimateWinProb({
    marginPct,
    competitors: input.competitors,
    dealRegType: input.dealRegType,
    customerSegment: input.customerSegment,
    relationshipStrength: input.relationshipStrength,
    valueAdd: input.valueAdd,
    isNewLogo: input.isNewLogo,
    solutionComplexity: input.solutionComplexity,
    servicesAttached: input.servicesAttached,
    quarterEnd: input.quarterEnd,
    competitorProfiles: input.competitorProfiles
  })
  const riskAdjusted = grossProfit*winProb/100
  return { marginPct, price, grossProfit, winProb, riskAdjusted }
}

export function compareWithPlan(input, plannedMarginPct, recommendedMarginPct){
  if (plannedMarginPct==null) return null
  const planned = scenario(input, plannedMarginPct)
  const recommended = scenario(input, recommendedMarginPct)
  return {
    planned,
    recommended,
    delta: {
      grossProfit: recommended.grossProfit - planned.grossProfit,
      riskAdjusted: recommended.riskAdjusted - planned.riskAdjusted
    }
  }
}
