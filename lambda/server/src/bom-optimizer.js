/**
 * BOM Optimizer — per-line margin optimization for POST /api/bom/analyze
 *
 * Uses margin-on-selling-price convention throughout:
 *   marginPct = (price - cost) / price
 *   price = cost / (1 - marginPct)
 */

const CATEGORY_FLOORS = {
  Hardware: 0.05,
  Software: 0.08,
  Cloud: 0.06,
  ProfessionalServices: 0.15,
  ManagedServices: 0.12,
  ComplexSolution: 0.10
}

// Elasticity: how much margin room a category has above its floor.
// Higher = optimizer pushes more margin here; lower = keeps competitive.
const CATEGORY_ELASTICITY = {
  Hardware: 0.3,
  Software: 0.7,
  Cloud: 0.5,
  ProfessionalServices: 0.9,
  ManagedServices: 0.8,
  ComplexSolution: 0.5
}

// Base margin targets by category (before deal-context adjustments)
const CATEGORY_BASE_TARGETS = {
  Hardware: 0.12,
  Software: 0.18,
  Cloud: 0.14,
  ProfessionalServices: 0.30,
  ManagedServices: 0.25,
  ComplexSolution: 0.18
}

function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x))
}

function roundCurrency(v) {
  return Math.round(v * 100) / 100
}

function roundPct(v, decimals = 1) {
  const f = Math.pow(10, decimals)
  return Math.round(v * f) / f
}

/**
 * Compute deal-context adjustment applied to category base targets.
 * Mirrors the rule logic in rules.js but returns a single additive adjustment.
 */
function contextAdjustment(ctx) {
  let adj = 0

  // Segment
  if (ctx.customerSegment === 'SMB') adj += 0.03
  else if (ctx.customerSegment === 'Enterprise') adj -= 0.02

  // Deal registration
  if (ctx.dealRegType === 'PremiumHunting') adj += 0.04
  else if (ctx.dealRegType === 'StandardApproved' || ctx.dealRegType === 'Teaming') adj += 0.02
  else if (ctx.dealRegType === 'NotRegistered') adj -= 0.01

  // Competition
  const comp = String(ctx.competitors || '1')
  if (comp === '0') adj += 0.02
  else if (comp === '2') adj -= 0.015
  else if (comp === '3+') adj -= 0.03

  // Value-add
  if (ctx.valueAdd === 'High') adj += 0.03
  else if (ctx.valueAdd === 'Low') adj -= 0.02

  // Relationship
  if (ctx.relationshipStrength === 'Strategic') adj += 0.015
  else if (ctx.relationshipStrength === 'New') adj -= 0.01

  // Complexity
  if (ctx.solutionComplexity === 'High') adj += 0.01
  else if (ctx.solutionComplexity === 'Low') adj -= 0.005

  return adj
}

/**
 * Compute per-category margin targets adjusted for deal context.
 */
function categoryTargets(ctx) {
  const adj = contextAdjustment(ctx)
  const targets = {}
  for (const [cat, base] of Object.entries(CATEGORY_BASE_TARGETS)) {
    const floor = CATEGORY_FLOORS[cat] || 0.05
    targets[cat] = clamp(base + adj, floor, 0.55)
  }
  return targets
}

/**
 * Generate a short rationale string for a BOM line.
 */
function lineRationale(cat, recommendedPct, floorPct, ctx) {
  const parts = []
  const comp = String(ctx.competitors || '1')
  const competitive = comp === '2' || comp === '3+'

  if (cat === 'Hardware') {
    if (competitive) {
      parts.push(`Hardware in competitive ${ctx.oem || 'OEM'} deal — keep tight to win`)
    } else {
      parts.push(`Hardware line — standard margin for ${ctx.oem || 'OEM'}`)
    }
  } else if (cat === 'ProfessionalServices') {
    if (ctx.valueAdd === 'High') {
      parts.push('Professional services — high value-add justifies premium')
    } else {
      parts.push('Professional services — standard delivery margin')
    }
  } else if (cat === 'ManagedServices') {
    parts.push('Managed services — recurring revenue supports healthy margin')
  } else if (cat === 'Software') {
    parts.push('Software line — low marginal cost supports margin')
  } else if (cat === 'Cloud') {
    if (competitive) {
      parts.push('Cloud capacity — keep competitive against hyperscaler direct')
    } else {
      parts.push('Cloud line — moderate margin on reserved capacity')
    }
  } else if (cat === 'ComplexSolution') {
    parts.push('Complex solution bundle — blended margin across stack')
  } else {
    parts.push(`${cat} — standard margin`)
  }

  if (recommendedPct <= floorPct + 1) {
    parts.push('(at floor)')
  }

  return parts.join(' ')
}

/**
 * Core optimizer: solve for per-line margins that achieve a target blended margin
 * while respecting category floors and maximizing margin on high-elasticity lines.
 *
 * Algorithm:
 *   1. Assign each line its category floor as baseline.
 *   2. Compute the GP shortfall needed to hit the target blended margin.
 *   3. Distribute the shortfall proportionally to each line's
 *      (extendedCost × elasticity), capped at a per-category ceiling.
 *   4. If the target is impossible (total cost can't support it even at ceilings),
 *      flag targetAchieved = false and return the best achievable blend.
 */
export function optimizeBom(bomLines, context) {
  if (!Array.isArray(bomLines) || bomLines.length === 0) {
    return {
      lines: [],
      totals: {
        totalCost: 0,
        totalPrice: 0,
        blendedMarginPct: 0,
        totalGrossProfit: 0,
        targetAchieved: false,
        targetMarginPct: context?.targetBlendedMargin || 0,
        gap: context?.targetBlendedMargin || 0
      },
      recommendations: {
        healthScore: 0,
        insights: ['No BOM lines provided']
      }
    }
  }

  const ctx = context || {}
  const targetBlended = (ctx.targetBlendedMargin || 0) / 100 // convert pct to decimal
  const catTargets = categoryTargets(ctx)

  // Per-category ceiling (max we'll push any single category)
  const CATEGORY_CEILINGS = {
    Hardware: 0.25,
    Software: 0.40,
    Cloud: 0.30,
    ProfessionalServices: 0.50,
    ManagedServices: 0.45,
    ComplexSolution: 0.35
  }

  // Build line data
  const lines = bomLines.map((line, idx) => {
    const cat = line.category || 'Hardware'
    const qty = Math.max(1, Number(line.quantity) || 1)
    const unitCost = Math.max(0, Number(line.unitCost) || 0)
    const extCost = unitCost * qty
    const currentMarginPct = Number(line.marginPct) || 0
    const floor = CATEGORY_FLOORS[cat] || 0.05
    const ceiling = CATEGORY_CEILINGS[cat] || 0.35
    const elasticity = CATEGORY_ELASTICITY[cat] || 0.5
    const catTarget = catTargets[cat] || 0.12

    return {
      index: idx,
      partNumber: line.partNumber || undefined,
      description: line.description || undefined,
      category: cat,
      quantity: qty,
      unitCost,
      extendedCost: extCost,
      currentMarginPct,
      floor,
      ceiling,
      elasticity,
      catTarget,
      recommendedMarginDecimal: floor // start at floor
    }
  })

  const totalCost = lines.reduce((s, l) => s + l.extendedCost, 0)

  if (totalCost <= 0) {
    return {
      lines: lines.map(l => formatLine(l, ctx)),
      totals: {
        totalCost: 0,
        totalPrice: 0,
        blendedMarginPct: 0,
        totalGrossProfit: 0,
        targetAchieved: targetBlended <= 0,
        targetMarginPct: roundPct(targetBlended * 100),
        gap: roundPct(targetBlended * 100)
      },
      recommendations: {
        healthScore: 0,
        insights: ['All lines have zero cost']
      }
    }
  }

  // Step 1: Start each line at its category target (clamped to floor..ceiling)
  for (const line of lines) {
    line.recommendedMarginDecimal = clamp(line.catTarget, line.floor, line.ceiling)
  }

  // Step 2: Compute current blended margin at category targets
  let currentBlended = computeBlended(lines, totalCost)

  // Step 3: If we need to adjust to hit target, redistribute
  if (targetBlended > 0 && Math.abs(currentBlended - targetBlended) > 0.001) {
    // Target GP needed:  totalPrice * targetMargin = totalGP
    // totalPrice = totalCost / (1 - targetBlended)
    const targetTotalPrice = totalCost / (1 - targetBlended)
    const targetTotalGP = targetTotalPrice - totalCost

    // Current GP at category targets
    let currentGP = lines.reduce((s, l) => {
      const price = l.extendedCost / (1 - l.recommendedMarginDecimal)
      return s + (price - l.extendedCost)
    }, 0)

    const gpGap = targetTotalGP - currentGP

    if (gpGap > 0) {
      // Need more GP — push high-elasticity lines up
      distributeGP(lines, gpGap, 'up')
    } else if (gpGap < 0) {
      // Need less GP — pull high-elasticity lines down toward floors
      distributeGP(lines, -gpGap, 'down')
    }
  }

  // Compute final numbers
  const resultLines = lines.map(l => formatLine(l, ctx))
  const totalPrice = resultLines.reduce((s, l) => s + l.extendedPrice, 0)
  const totalGP = totalPrice - totalCost
  const blendedMarginPct = totalPrice > 0 ? (totalGP / totalPrice) * 100 : 0

  const targetAchieved = targetBlended > 0
    ? Math.abs(blendedMarginPct - targetBlended * 100) < 0.5
    : true
  const gap = targetBlended > 0
    ? roundPct(targetBlended * 100 - blendedMarginPct)
    : 0

  // Health score and insights
  const { healthScore, insights } = generateInsights(
    lines, resultLines, blendedMarginPct, targetBlended * 100, targetAchieved, ctx
  )

  return {
    lines: resultLines,
    totals: {
      totalCost: roundCurrency(totalCost),
      totalPrice: roundCurrency(totalPrice),
      blendedMarginPct: roundPct(blendedMarginPct),
      totalGrossProfit: roundCurrency(totalGP),
      targetAchieved,
      targetMarginPct: roundPct(targetBlended * 100),
      gap: targetAchieved ? 0 : roundPct(Math.max(0, gap))
    },
    recommendations: {
      healthScore,
      insights
    }
  }
}

/**
 * Distribute a GP delta across lines proportional to elasticity × cost.
 * direction: 'up' = push margins up toward ceilings, 'down' = toward floors
 */
function distributeGP(lines, gpDelta, direction) {
  // Compute available room per line
  const rooms = lines.map(l => {
    if (direction === 'up') {
      // Room = GP at ceiling minus GP at current
      const gpCurrent = l.extendedCost / (1 - l.recommendedMarginDecimal) - l.extendedCost
      const gpCeiling = l.extendedCost / (1 - l.ceiling) - l.extendedCost
      return { room: Math.max(0, gpCeiling - gpCurrent), weight: l.elasticity * l.extendedCost }
    } else {
      // Room = GP at current minus GP at floor
      const gpCurrent = l.extendedCost / (1 - l.recommendedMarginDecimal) - l.extendedCost
      const gpFloor = l.extendedCost / (1 - l.floor) - l.extendedCost
      return { room: Math.max(0, gpCurrent - gpFloor), weight: l.elasticity * l.extendedCost }
    }
  })

  const totalWeight = rooms.reduce((s, r) => s + (r.room > 0 ? r.weight : 0), 0)
  if (totalWeight <= 0) return // no room to adjust

  let remaining = gpDelta

  // Iterative distribution (handles cases where some lines cap out)
  for (let iter = 0; iter < 5 && remaining > 0.01; iter++) {
    const activeWeight = rooms.reduce((s, r, i) => {
      if (r.room <= 0) return s
      return s + r.weight
    }, 0)
    if (activeWeight <= 0) break

    for (let i = 0; i < lines.length; i++) {
      if (rooms[i].room <= 0 || remaining <= 0) continue

      const share = (rooms[i].weight / activeWeight) * remaining
      const applied = Math.min(share, rooms[i].room)

      // Convert GP delta to new margin
      const currentGP = lines[i].extendedCost / (1 - lines[i].recommendedMarginDecimal) - lines[i].extendedCost
      let newGP
      if (direction === 'up') {
        newGP = currentGP + applied
      } else {
        newGP = currentGP - applied
      }
      const newPrice = lines[i].extendedCost + Math.max(0, newGP)
      const newMargin = newPrice > 0 ? (newPrice - lines[i].extendedCost) / newPrice : 0
      lines[i].recommendedMarginDecimal = clamp(newMargin, lines[i].floor, lines[i].ceiling)

      // Update remaining room
      const actualGPNow = lines[i].extendedCost / (1 - lines[i].recommendedMarginDecimal) - lines[i].extendedCost
      const actualApplied = direction === 'up'
        ? actualGPNow - currentGP
        : currentGP - actualGPNow
      remaining -= Math.max(0, actualApplied)
      rooms[i].room -= Math.max(0, actualApplied)
    }
  }
}

/**
 * Compute cost-weighted blended margin (margin-on-selling-price).
 */
function computeBlended(lines, totalCost) {
  let totalPrice = 0
  for (const l of lines) {
    totalPrice += l.extendedCost / (1 - l.recommendedMarginDecimal)
  }
  return totalPrice > 0 ? (totalPrice - totalCost) / totalPrice : 0
}

/**
 * Format a line for output.
 */
function formatLine(line, ctx) {
  const marginDecimal = line.recommendedMarginDecimal
  const extPrice = line.extendedCost / (1 - marginDecimal)
  const gp = extPrice - line.extendedCost

  const result = {
    index: line.index,
    currentMarginPct: roundPct(line.currentMarginPct),
    recommendedMarginPct: roundPct(marginDecimal * 100),
    marginFloor: roundPct(line.floor * 100),
    extendedCost: roundCurrency(line.extendedCost),
    extendedPrice: roundCurrency(extPrice),
    grossProfit: roundCurrency(gp),
    rationale: lineRationale(line.category, marginDecimal * 100, line.floor * 100, ctx)
  }

  if (line.partNumber) result.partNumber = line.partNumber
  if (line.description) result.description = line.description

  return result
}

/**
 * Generate health score (0-100) and actionable insights.
 */
function generateInsights(lines, resultLines, blendedPct, targetPct, targetAchieved, ctx) {
  const insights = []
  let healthScore = 50 // base

  // Target achievement
  if (targetPct > 0) {
    if (targetAchieved) {
      healthScore += 25
    } else {
      const gap = targetPct - blendedPct
      healthScore -= Math.min(25, Math.round(gap * 3))

      // Find lines with room to grow
      const servicesLines = lines.filter(l =>
        (l.category === 'ProfessionalServices' || l.category === 'ManagedServices') &&
        l.recommendedMarginDecimal < l.ceiling - 0.02
      )
      if (servicesLines.length > 0) {
        const room = servicesLines.reduce((s, l) => s + (l.ceiling - l.recommendedMarginDecimal) * 100, 0)
        insights.push(`Services margin can absorb ${Math.round(room / servicesLines.length)}pp more to close the gap`)
      }

      if (ctx.dealRegType === 'NotRegistered') {
        insights.push('Consider deal registration to unlock 3pp of OEM margin')
      }

      if (ctx.valueAdd !== 'High') {
        insights.push('Increasing value-add (professional services, training) justifies higher margins')
      }
    }
  }

  // Deal registration bonus
  if (ctx.dealRegType === 'PremiumHunting' || ctx.dealRegType === 'StandardApproved') {
    healthScore += 10
  }

  // Value-add
  if (ctx.valueAdd === 'High') {
    healthScore += 10
  } else if (ctx.valueAdd === 'Low') {
    healthScore -= 5
  }

  // Relationship
  if (ctx.relationshipStrength === 'Strategic') {
    healthScore += 5
  }

  // Competition pressure
  const comp = String(ctx.competitors || '1')
  if (comp === '3+') {
    healthScore -= 10
    insights.push('Heavy competition — focus on differentiation to protect margin')
  } else if (comp === '0') {
    healthScore += 10
  }

  // Check for lines at floor
  const atFloor = lines.filter(l => l.recommendedMarginDecimal <= l.floor + 0.005)
  if (atFloor.length > 0 && atFloor.length === lines.length) {
    insights.push('All lines at minimum floor — consider restructuring the deal mix')
  }

  // Check for hardware-heavy BOM
  const hwCost = lines.filter(l => l.category === 'Hardware').reduce((s, l) => s + l.extendedCost, 0)
  const totalCost = lines.reduce((s, l) => s + l.extendedCost, 0)
  if (totalCost > 0 && hwCost / totalCost > 0.8) {
    insights.push('BOM is hardware-heavy — adding services lines improves blended margin')
  }

  // Margin spread check
  if (resultLines.length > 1) {
    const margins = resultLines.map(l => l.recommendedMarginPct)
    const spread = Math.max(...margins) - Math.min(...margins)
    if (spread > 25) {
      healthScore += 5 // good differentiation
    }
  }

  healthScore = clamp(healthScore, 0, 100)

  if (insights.length === 0) {
    if (targetAchieved && targetPct > 0) {
      insights.push('BOM margins are well-balanced and meet the target')
    } else {
      insights.push('Review per-line margins for optimization opportunities')
    }
  }

  return { healthScore, insights }
}
