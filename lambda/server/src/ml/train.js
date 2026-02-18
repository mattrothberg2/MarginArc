// ── ML Training Pipeline + Model Storage ─────────────────────────
// Trains per-customer logistic regression models on historical deal
// outcomes and persists the serialized model + metadata in customer_config.

import { query } from '../licensing/db.js'
import { featurize, computeNormStats } from './features.js'
import { train, evaluate, getFeatureImportance, serializeModel } from './logistic-regression.js'
import { getCustomerPhaseById, setCustomerPhase } from '../phases.js'

// ── Schema migration (idempotent) ───────────────────────────────

export async function ensureMLSchema() {
  try {
    await query('ALTER TABLE customer_config ADD COLUMN IF NOT EXISTS ml_model JSONB')
    console.log('customer_config.ml_model column ensured')
  } catch (err) {
    if (err.message?.includes('already exists')) {
      console.log('customer_config.ml_model column already exists')
    } else {
      console.error('Failed to add ml_model column:', err.message)
    }
  }
}

// ── Row-to-deal conversion (mirrors analytics.js rowToDeal) ─────

function rowToDeal(row) {
  return {
    segment: row.segment,
    industry: row.industry,
    customerIndustry: row.industry,
    productCategory: row.product_category,
    dealRegType: row.deal_reg_type,
    competitors: row.competitors,
    valueAdd: row.value_add,
    relationshipStrength: row.relationship_strength,
    customerTechSophistication: row.customer_tech_sophistication,
    solutionComplexity: row.solution_complexity,
    varStrategicImportance: row.var_strategic_importance,
    customerPriceSensitivity: row.customer_price_sensitivity,
    customerLoyalty: row.customer_loyalty,
    dealUrgency: row.deal_urgency,
    isNewLogo: row.is_new_logo,
    solutionDifferentiation: row.solution_differentiation,
    oemCost: parseFloat(row.oem_cost),
    oem: row.oem,
    servicesAttached: row.services_attached,
    quarterEnd: row.quarter_end,
    competitorNames: row.competitor_names,
    bomLineCount: row.bom_line_count,
    bomAvgMarginPct: row.bom_avg_margin_pct != null ? parseFloat(row.bom_avg_margin_pct) : null,
    hasManualBom: row.has_manual_bom,
    achievedMargin: parseFloat(row.achieved_margin),
    status: row.status,
    lossReason: row.loss_reason || '',
    bomLines: row.bom_lines
  }
}

// ── Main training function ──────────────────────────────────────

export async function trainCustomerModel(customerId) {
  // 1. Get org_ids for this customer
  const orgResult = await query(
    'SELECT org_id FROM licenses WHERE customer_id = $1 AND status = \'active\' AND org_id IS NOT NULL',
    [customerId]
  )
  const orgIds = orgResult.rows.map(r => r.org_id).filter(Boolean)
  if (orgIds.length === 0) {
    return { success: false, reason: 'No active licenses with org_id found' }
  }

  // 2. Pull training data — all closed deals for this customer's orgs
  const placeholders = orgIds.map((_, i) => `$${i + 1}`).join(', ')
  const dealsResult = await query(
    `SELECT * FROM recorded_deals WHERE org_id IN (${placeholders}) AND status IN ('Won', 'Lost')`,
    orgIds
  )
  const realDeals = dealsResult.rows.map(rowToDeal)

  // 3. Validate minimum data requirements
  const wonDeals = realDeals.filter(d => d.status === 'Won')
  const lostDeals = realDeals.filter(d => d.status === 'Lost')

  if (realDeals.length < 100 || wonDeals.length < 20 || lostDeals.length < 20) {
    const needed = Math.max(0, 100 - realDeals.length)
    return {
      success: false,
      reason: `Need ${needed} more deals (${wonDeals.length} won, ${lostDeals.length} lost currently)`,
      dealCount: realDeals.length,
      wonCount: wonDeals.length,
      lostCount: lostDeals.length
    }
  }

  // 4. Create training samples with synthetic augmentation
  const allSamples = []

  for (const deal of wonDeals) {
    // Real Won → label 1
    allSamples.push({ ...deal, proposedMargin: deal.achievedMargin, label: 1 })
    // Synthetic: margin + 10pp → label 0 (would have lost at higher price)
    const syntheticMargin = Math.min(deal.achievedMargin + 0.10, 0.55)
    allSamples.push({ ...deal, proposedMargin: Math.max(syntheticMargin, 0.01), label: 0 })
  }

  for (const deal of lostDeals) {
    // Real Lost → label 0
    allSamples.push({ ...deal, proposedMargin: deal.achievedMargin, label: 0 })
    // Synthetic: margin - 5pp → label 1 (might have won at lower price)
    const syntheticMargin = Math.max(deal.achievedMargin - 0.05, 0.01)
    allSamples.push({ ...deal, proposedMargin: Math.min(syntheticMargin, 0.55), label: 1 })
  }

  // 5. Compute normalization stats from real deals only (avoids synthetic bias)
  const normStats = computeNormStats(realDeals)

  // 6. Featurize all samples
  const X = []
  const y = []
  let featureNames = null

  for (const sample of allSamples) {
    const result = featurize(sample, normStats, { proposedMargin: sample.proposedMargin })
    X.push(result.features)
    y.push(sample.label)
    if (!featureNames) featureNames = result.featureNames
  }

  // 7. Train the model
  const model = train(X, y, {
    learningRate: 0.01,
    lambda: 0.01,
    epochs: 500,
    batchSize: 32,
    validationSplit: 0.2,
    earlyStoppingPatience: 20
  })

  // 8. Evaluate on original deals only (honest metrics)
  const X_real = []
  const y_real = []
  for (const deal of realDeals) {
    const margin = deal.achievedMargin
    const result = featurize(deal, normStats, { proposedMargin: margin })
    X_real.push(result.features)
    y_real.push(deal.status === 'Won' ? 1 : 0)
  }
  const evaluationResult = evaluate(model, X_real, y_real)

  // 9. Get feature importance
  const topFeatures = getFeatureImportance(model, featureNames)

  // 10. Store model package
  const modelPackage = {
    model: serializeModel(model),
    normStats,
    featureNames,
    metrics: evaluationResult,
    importance: topFeatures,
    dealCount: realDeals.length,
    trainedAt: new Date().toISOString(),
    version: 1
  }
  await query(
    'UPDATE customer_config SET ml_model = $1 WHERE customer_id = $2',
    [JSON.stringify(modelPackage), customerId]
  )

  // 11. Auto-promote to Phase 2 if model is good enough
  const currentPhase = await getCustomerPhaseById(customerId)
  if (evaluationResult.auc >= 0.60 && realDeals.length >= 100 && currentPhase < 2) {
    await setCustomerPhase(customerId, 2)
  }

  // 12. Return result
  return {
    success: true,
    metrics: {
      auc: evaluationResult.auc,
      logLoss: evaluationResult.logLoss,
      accuracy: evaluationResult.accuracy,
      n: realDeals.length
    },
    dealCount: realDeals.length,
    syntheticCount: allSamples.length - realDeals.length,
    topFeatures: topFeatures.slice(0, 10),
    phase: await getCustomerPhaseById(customerId),
    epochsRun: model.epochsRun
  }
}

// ── Model retrieval ─────────────────────────────────────────────

export async function getModel(customerId) {
  const result = await query('SELECT ml_model FROM customer_config WHERE customer_id = $1', [customerId])
  if (result.rows.length === 0 || !result.rows[0].ml_model) return null
  return result.rows[0].ml_model // PostgreSQL auto-parses JSONB
}

export async function getModelByOrgId(orgId) {
  if (!orgId) return null
  const result = await query(
    `SELECT cc.ml_model FROM customer_config cc
     JOIN licenses l ON l.customer_id = cc.customer_id
     WHERE l.org_id = $1 AND l.status = 'active'
     LIMIT 1`,
    [orgId]
  )
  return result.rows.length > 0 ? result.rows[0].ml_model : null
}
