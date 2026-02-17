import { getSSMParameter } from './licensing/db.js'

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite'
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models'

// Lazy-loaded, cached Gemini API key (SSM with env fallback for local dev)
let _geminiApiKey = null
async function getGeminiApiKey() {
  if (_geminiApiKey !== null) return _geminiApiKey
  if (process.env.GEMINI_API_KEY) {
    _geminiApiKey = process.env.GEMINI_API_KEY
    return _geminiApiKey
  }
  try {
    _geminiApiKey = await getSSMParameter('/marginarc/gemini/api-key')
  } catch (e) {
    console.error('Failed to load Gemini API key from SSM, Gemini calls disabled:', e.message)
    _geminiApiKey = ''
  }
  return _geminiApiKey
}

// Simple in-memory cache (key → { text, ts })
const cache = new Map()
const CACHE_TTL_MS = 10 * 60 * 1000 // 10 minutes

function cacheKey(prompt) {
  // Use first 200 chars + last 100 chars + length to reduce collision risk
  return prompt.slice(0, 200) + '|' + prompt.slice(-100) + '|' + prompt.length
}

async function callGemini(prompt, { retries = 1, timeoutMs = 8000 } = {}){
  const apiKey = await getGeminiApiKey()
  if(!apiKey) return ''

  const key = cacheKey(prompt)
  const cached = cache.get(key)
  if (cached && (Date.now() - cached.ts) < CACHE_TTL_MS) return cached.text

  const url = `${GEMINI_BASE}/${GEMINI_MODEL}:generateContent`

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }] }),
        signal: controller.signal
      })
      clearTimeout(timer)
      if(!res.ok){
        const errorText = await res.text()
        console.error(`Gemini API HTTP error ${res.status} (attempt ${attempt+1})`, errorText)
        if (attempt < retries && (res.status === 429 || res.status >= 500)) {
          await new Promise(r => setTimeout(r, 1000 * (attempt + 1)))
          continue
        }
        return ''
      }
      const json = await res.json()
      if(json?.error){
        console.error('Gemini API error payload', json.error)
        return ''
      }
      const text = json?.candidates?.[0]?.content?.parts?.[0]?.text
      const result = text ? text.trim() : ''
      if (result) cache.set(key, { text: result, ts: Date.now() })
      return result
    } catch (e) {
      console.error(`Gemini call failed (attempt ${attempt+1})`, e.message)
      if (attempt < retries) {
        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)))
        continue
      }
      return ''
    }
  }
  return ''
}

export async function explainRecommendation(rec, context = {}){
  const { bom } = context
  const driversText = (rec.drivers||[]).map(d=>`${d.name}: ${(d.val*100).toFixed(1)}%`).join('\n') || 'No explicit drivers were surfaced.'
  const bomNote = bom?.origin === 'manual'
    ? 'The AE supplied a manual bill of materials that overrides the auto-generated mix.'
    : 'A synthesized bill of materials allocates revenue across bundles, services, and support.'
  const prompt = [
    'You are a pricing assistant for Margin.AI. Summarize the quantitative logic behind a margin recommendation.',
    `Recommended margin: ${rec.suggestedMarginPct.toFixed(1)}%.`,
    bomNote,
    'Key drivers with their contribution deltas (% of margin):',
    driversText,
    'Produce a short (2 sentence) explanation in a friendly, professional tone, highlighting the most influential levers and what they imply for customer positioning.'
  ].join('\n')
  return await callGemini(prompt)
}

export async function summarizeQualitative({ input, rec, metrics, bom, algorithmMarginPct }){
  const segment = input.customerSegment
  const competition = input.competitors
  const reg = input.dealRegType
  const relationship = input.relationshipStrength
  const tech = input.customerTechSophistication
  const valueAdd = input.valueAdd
  const manualFlag = bom?.origin === 'manual'
  const bomSummary = manualFlag
    ? `The AE supplied ${bom.stats?.lineCount || 'multiple'} line items with a blended margin of ${(bom.stats?.blendedMarginPct*100 || 0).toFixed(1)}%.`
    : `Auto-generated BOM estimate blended margin ${(bom?.totals?.marginPct*100 || 0).toFixed(1)}%.`
  const algoCompare = algorithmMarginPct != null
    ? `Model baseline margin was ${algorithmMarginPct.toFixed(1)}%, now set to ${rec.suggestedMarginPct.toFixed(1)}%.`
    : `The rules plus kNN blend suggested ${rec.suggestedMarginPct.toFixed(1)}%.`
  const metricsLine = metrics
    ? `Versus the seller plan, expected gross profit shifts by ${formatCurrency(metrics.delta.grossProfit)} and risk-adjusted profit by ${formatCurrency(metrics.delta.riskAdjusted)}.`
    : ''
  const prompt = [
    'You are crafting a qualitative rationale for an AE using Margin.AI.',
    'Translate these quantitative signals into a narrative about business impact (win probability, trust, and profit).',
    `Segment: ${segment}. Registration: ${reg}. Relationship: ${relationship}. Competition: ${competition} players. Tech sophistication: ${tech}. VAR value-add: ${valueAdd}.`,
    algoCompare,
    bomSummary,
    metricsLine,
    'Use 3-4 sentences. Focus on why the recommendation balances win probability, governance, and profit. Reference the customer context plainly (no jargon) and mention how the BOM or baseline mix influences the story.'
  ].join('\n')
  return await callGemini(prompt)
}

function formatCurrency(value){
  const num = Number(value || 0)
  const abs = Math.abs(num)
  const sign = num >= 0 ? '+' : '-'
  return `${sign}$${abs.toLocaleString(undefined,{ minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
