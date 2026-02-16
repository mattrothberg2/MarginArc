export function assessPredictionQuality(input, rec) {
  let score = 0
  const missing = []

  // ── Required fields (always present via Zod validation) ── baseline 22 pts
  score += 5   // oemCost (positive number, always provided)
  score += 2   // customerSegment (required enum)
  score += 2   // productCategory (required enum)
  score += 2   // relationshipStrength (required enum)
  score += 1   // customerTechSophistication (required enum)
  score += 2   // dealRegType (required enum)
  score += 2   // competitors (required enum)
  score += 2   // valueAdd (required enum)
  score += 1   // solutionComplexity (required enum)
  score += 1   // varStrategicImportance (required enum)
  score += 2   // customerIndustry (required string)

  // ── Optional high-impact fields ──
  if (input.oem && input.oem.trim()) { score += 5 } else { missing.push('OEM vendor') }
  if (input.customerPriceSensitivity != null) { score += 4 } else { missing.push('Price sensitivity (1-5)') }
  if (input.dealUrgency != null) { score += 4 } else { missing.push('Deal urgency (1-5)') }
  if (input.customerLoyalty != null) { score += 3 } else { missing.push('Customer loyalty (1-5)') }
  if (input.solutionDifferentiation != null) { score += 3 } else { missing.push('Solution differentiation (1-5)') }
  if (input.isNewLogo != null) { score += 2 } else { missing.push('New logo flag') }
  if (input.servicesAttached != null) { score += 2 } else { missing.push('Services attached') }
  if (input.quarterEnd != null) { score += 2 } else { missing.push('Quarter-end timing') }
  if (input.displacementDeal != null) { score += 1 } else { missing.push('Displacement deal') }

  // ── Enrichment data ──
  if (input.oemProfile) { score += 5 } else { missing.push('OEM margin profile (admin config)') }
  if (Array.isArray(input.competitorNames) && input.competitorNames.length > 0) { score += 3 } else { missing.push('Competitor names') }
  if (Array.isArray(input.competitorProfiles) && input.competitorProfiles.length > 0) { score += 4 } else { missing.push('Competitor profiles (admin config)') }

  // ── Algorithm confidence as proxy for kNN data richness + convergence (0-20 pts) ──
  const conf = rec.confidence || 0.4
  score += Math.round(conf * 25)  // 0.8 confidence → 20 pts

  score = Math.min(100, Math.round(score))
  const grade = score >= 80 ? 'Excellent' : score >= 60 ? 'Good' : score >= 40 ? 'Fair' : 'Poor'

  return { score, grade, missingFields: missing.slice(0, 5) }
}
