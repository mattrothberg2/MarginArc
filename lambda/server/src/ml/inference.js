// ── ML Inference — Margin Sweep & Recommendation ────────────────
// Given a trained model and a deal, sweep proposed margins to find
// the optimal risk-adjusted margin recommendation.

import { deserializeModel, predict } from './logistic-regression.js'
import { featurize, FEATURE_DISPLAY_NAMES } from './features.js'

/**
 * Compute a confidence score for a specific prediction.
 * Based on model AUC and training data volume.
 *
 * @param {object} modelPackage - stored model JSONB
 * @param {object} dealInput - the deal being scored (reserved for future use)
 * @returns {number} confidence 0.1–0.95
 */
export function computeConfidence(modelPackage, dealInput) {
  const auc = modelPackage.metrics?.auc ?? 0.5
  const dealCount = modelPackage.dealCount ?? 0

  // Base: maps AUC 0.5→0, AUC 1.0→1
  const base = (auc - 0.5) * 2

  // Data factor: more training data = more confident, saturates at 500
  const dataFactor = Math.min(1, dealCount / 500)

  const raw = base * dataFactor
  return Math.max(0.1, Math.min(0.95, raw))
}

/**
 * Sweep proposed margins and return optimal, conservative, and aggressive options.
 *
 * @param {object} dealInput - camelCase DealInput from Zod validation
 * @param {object} modelPackage - JSONB from customer_config.ml_model
 * @returns {object} recommendation with three margin options + metadata
 */
export function recommendMargin(dealInput, modelPackage) {
  // 1. Deserialize model
  const model = deserializeModel(modelPackage.model)
  const normStats = modelPackage.normStats

  // 2. Margin sweep: 5% to 35% in 0.5pp steps (61 points)
  const sweepPoints = []
  for (let i = 0; i <= 60; i++) {
    const margin = 0.05 + i * 0.005
    const featureResult = featurize(dealInput, normStats, { proposedMargin: margin })
    const pWin = predict(model, featureResult.features)
    const sellPrice = dealInput.oemCost / (1 - margin)
    const gp = sellPrice - dealInput.oemCost
    const expectedGP = gp * pWin
    sweepPoints.push({ margin, pWin, expectedGP, sellPrice, gp })
  }

  // 3. Find three margin options
  // Optimal: highest expectedGP
  let optimal = sweepPoints[0]
  for (const pt of sweepPoints) {
    if (pt.expectedGP > optimal.expectedGP) optimal = pt
  }

  // Conservative: highest margin where pWin >= 0.70
  let conservative = null
  for (const pt of sweepPoints) {
    if (pt.pWin >= 0.70) {
      if (!conservative || pt.margin > conservative.margin) conservative = pt
    }
  }
  // Fallback: if nothing meets 0.70 threshold, pick margin with highest pWin
  if (!conservative) {
    conservative = sweepPoints[0]
    for (const pt of sweepPoints) {
      if (pt.pWin > conservative.pWin) conservative = pt
    }
  }

  // Aggressive: highest margin where pWin >= 0.45
  let aggressive = null
  for (const pt of sweepPoints) {
    if (pt.pWin >= 0.45) {
      if (!aggressive || pt.margin > aggressive.margin) aggressive = pt
    }
  }
  // Fallback: use optimal
  if (!aggressive) {
    aggressive = optimal
  }

  // 4. Key drivers from feature importance
  const drivers = generateKeyDrivers(modelPackage, dealInput, normStats)

  // 5. Confidence
  const confidence = computeConfidence(modelPackage, dealInput)

  // 6. GP curve for frontend chart (every 3rd point)
  const expectedGPCurve = []
  for (let i = 0; i < sweepPoints.length; i += 3) {
    const pt = sweepPoints[i]
    expectedGPCurve.push({
      margin: parseFloat((pt.margin * 100).toFixed(1)),
      pWin: Math.round(pt.pWin * 100),
      expectedGP: Math.round(pt.expectedGP)
    })
  }

  // 7. Return
  return {
    suggestedMarginPct: parseFloat((optimal.margin * 100).toFixed(1)),
    conservativeMarginPct: parseFloat((conservative.margin * 100).toFixed(1)),
    aggressiveMarginPct: parseFloat((aggressive.margin * 100).toFixed(1)),
    winProbability: optimal.pWin,
    expectedGP: optimal.expectedGP,
    confidence,
    keyDrivers: drivers,
    expectedGPCurve,
    modelMetrics: {
      auc: modelPackage.metrics?.auc,
      dealCount: modelPackage.dealCount,
      trainedAt: modelPackage.trainedAt
    },
    source: 'ml_model'
  }
}

/**
 * Generate human-readable key drivers from feature importance + actual deal values.
 */
function generateKeyDrivers(modelPackage, dealInput, normStats) {
  const importance = modelPackage.importance || []
  const top5 = importance.slice(0, 5)

  // Featurize the deal at its current state to get actual normalized values
  const featureResult = featurize(dealInput, normStats)
  const featureMap = {}
  for (let i = 0; i < featureResult.featureNames.length; i++) {
    featureMap[featureResult.featureNames[i]] = featureResult.features[i]
  }

  return top5.map(feat => {
    const displayName = FEATURE_DISPLAY_NAMES[feat.name] || feat.name
    const normalizedValue = featureMap[feat.name] ?? 0
    const contribution = feat.weight * normalizedValue
    const impact = Math.abs(contribution) * 100 // convert to percentage points
    const direction = contribution >= 0 ? 'positive' : 'negative'

    let sentence
    if (direction === 'positive') {
      sentence = `${displayName} is helping win probability (+${impact.toFixed(1)}pp)`
    } else {
      sentence = `${displayName} is reducing win probability (-${impact.toFixed(1)}pp)`
    }

    return { name: displayName, sentence, impact, direction }
  })
}
