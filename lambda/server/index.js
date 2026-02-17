import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import morgan from 'morgan'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { z } from 'zod'
import swaggerUi from 'swagger-ui-express'
import yaml from 'js-yaml'
import { computeRecommendation } from './src/rules.js'
import { explainRecommendation, summarizeQualitative } from './src/gemini.js'
import { compareWithPlan } from './src/metrics.js'
import { buildBillOfMaterials, computeManualBomStats } from './src/bom.js'
import { optimizeBom } from './src/bom-optimizer.js'
import { searchCatalog } from './src/bom-search.js'
import { assessPredictionQuality } from './src/quality.js'
import rateLimit from 'express-rate-limit'
import serverless from 'serverless-http'

// Licensing routes
import licenseRoutes from './src/licensing/routes.js'
import adminRoutes from './src/licensing/admin.js'

// Salesforce OAuth + demo data routes
import oauthRoutes from './src/salesforce/routes.js'
import demoDataRoutes from './src/salesforce/demo-data.js'

// Docs portal routes
import docsAuthRouter from './src/docs/auth.js'
import { verifyDocToken } from './src/docs/auth.js'
import docsContentRouter from './src/docs/content.js'

// Deal persistence
import { ensureDealsSchema, insertRecordedDeal, getAllDeals as fetchAllDeals, invalidateDealsCache } from './src/analytics.js'

// Phase system
import { ensurePhaseSchema, getCustomerPhase, computeDealScore } from './src/phases.js'

// Ensure Salesforce DB schema on cold start (idempotent)
import { ensureSalesforceSchema, ensureDocsSchema } from './src/licensing/db.js'
ensureSalesforceSchema().catch(err => console.error('Failed to ensure Salesforce schema:', err.message))
ensureDocsSchema().catch(err => console.error('Failed to ensure Docs schema:', err.message))
ensureDealsSchema().catch(err => console.error('Failed to ensure deals schema:', err.message))
ensurePhaseSchema().catch(err => console.error('Failed to ensure phase schema:', err.message))

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const isLambda = !!process.env.AWS_LAMBDA_FUNCTION_NAME
const sampleDeals = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'src/data/sample_deals.json'), 'utf-8')
)
const customers = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'src/data/customers.json'), 'utf-8')
)
const bomCatalog = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'src/data/bom_catalog.json'), 'utf-8')
)
const bomPresets = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'src/data/bom_presets.json'), 'utf-8')
)

const industries = Array.from(new Set(customers.map(c => c.industry))).sort()

const app = express()
app.set('trust proxy', 1) // Trust first proxy (CloudFront/Lambda URL)

// CORS configuration with per-path origin restrictions (H5)
// Broad Salesforce patterns — needed for LWC Apex callouts from any customer org
const SALESFORCE_ORIGINS = [
  'https://orgfarm-bff1a6b1a0-dev-ed.develop.lightning.force.com',
  'https://orgfarm-bff1a6b1a0-dev-ed.develop.my.salesforce.com',
  /\.lightning\.force\.com$/,
  /\.my\.salesforce\.com$/
]

// Strict admin origins — only the MarginArc admin portal and local dev
const ADMIN_ORIGINS = [
  'https://api.marginarc.com',
  'https://marginarc.com',
  // legacy origin origin removed — all traffic goes through api.marginarc.com now
]

if (!isLambda) {
  ADMIN_ORIGINS.push('http://localhost:8080', 'http://localhost:3000')
}

// Combined set for the /api/recommend and public API endpoints
const ALL_ORIGINS = [...ADMIN_ORIGINS, ...SALESFORCE_ORIGINS]

function matchesOriginList(origin, list) {
  return list.some(o => o instanceof RegExp ? o.test(origin) : o === origin)
}

app.use(cors({
  origin: (origin, callback) => {
    // Allow non-browser clients (Apex callouts, curl, etc.)
    if (!origin) return callback(null, true)

    // Determine which origin list to check based on the request path.
    // Note: at CORS preflight time we don't have req.path easily, so the
    // origin function receives the origin header only. We use the broadest
    // allowlist here, then enforce tighter per-path checks below via a
    // secondary middleware for admin routes.
    const allowed = matchesOriginList(origin, ALL_ORIGINS)
    callback(allowed ? null : new Error('CORS blocked'), allowed)
  },
  exposedHeaders: ['Content-Range']
}))

// Security headers — protects admin/docs SPAs against clickjacking, XSS, etc.
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],   // needed for admin SPA, docs SPA, Swagger UI
      styleSrc: ["'self'", "'unsafe-inline'"],     // needed for admin SPA, docs SPA, Swagger UI
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "https://api.marginarc.com"],
      fontSrc: ["'self'", "https://fonts.googleapis.com", "https://fonts.gstatic.com"],
      frameSrc: ["'none'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"]
    }
  },
  crossOriginEmbedderPolicy: false,  // needed for external fonts
  hsts: { maxAge: 31536000, includeSubDomains: true }
}))

// Secondary CORS enforcement for admin routes: reject browser requests from
// Salesforce domains (they should never call admin APIs directly)
app.use('/admin/api', (req, res, next) => {
  const origin = req.headers.origin
  if (origin && !matchesOriginList(origin, ADMIN_ORIGINS)) {
    return res.status(403).json({ error: 'Origin not allowed for admin API' })
  }
  next()
})

app.use(express.json({ limit: '1mb' }))

// Structured JSON logging for CloudWatch (Lambda) / morgan for local dev
function structuredLog(level, msg, data = {}) {
  const entry = { level, msg, timestamp: new Date().toISOString(), ...data }
  console.log(JSON.stringify(entry))
}

if (isLambda) {
  app.use((req, res, next) => {
    const start = Date.now()
    res.on('finish', () => {
      const duration = Date.now() - start
      structuredLog('info', 'request', {
        method: req.method,
        path: req.path,
        status: res.statusCode,
        duration,
        origin: req.headers.origin || 'none',
        userAgent: (req.headers['user-agent'] || '').slice(0, 80)
      })
    })
    next()
  })
} else {
  app.use(morgan('dev'))
}

// Optional: require a specific Host header when exposed to the internet
const REQUIRED_HOST = process.env.REQUIRE_HOST || ''
if (REQUIRED_HOST) {
  app.use((req,res,next)=> {
    const host = (req.headers.host || '').split(':')[0]
    if (host !== REQUIRED_HOST) return res.status(403).send('Forbidden')
    next()
  })
}

// H4: Dedicated rate limiter for admin login — 5 requests per minute per IP
const adminLoginLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts, please try again later' }
})
app.use('/admin/api/auth/login', adminLoginLimiter)

// C4: Rate limiter for license API endpoints — 5 requests per minute per IP
const licenseRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many license requests, please try again later' },
  skip: (req) => req.path === '/health'
})
app.use('/api/v1/license', licenseRateLimiter)

// Licensing API routes (no MarginArc API key required, before API key middleware)
app.use('/api/v1/license', licenseRoutes)
app.use('/admin/api', adminRoutes)

// Salesforce OAuth routes (JWT-authed, no API key required)
app.use('/oauth', oauthRoutes)

// Scenario data endpoint for SFDC Apex callouts (API-key authed)
// Must be defined BEFORE the JWT-authed demo-data router so GET /api/demo-data?scenario=... is caught here
app.get('/api/demo-data', (req, res) => {
  const { scenario, count } = req.query
  if (!scenario) {
    return res.status(400).json({ error: 'scenario query parameter is required' })
  }

  // Inline API key check (this route is before the general API key middleware)
  const apiKey = process.env.MARGINARC_API_KEY || ''
  if (apiKey) {
    const provided = req.headers['x-api-key'] || ''
    if (provided !== apiKey) {
      return res.status(401).json({ error: 'Invalid or missing API key' })
    }
  }

  const validScenarios = ['networking-var', 'security-var', 'cloud-var', 'full-stack-var', 'services-heavy-var']
  if (!validScenarios.includes(scenario)) {
    return res.status(400).json({ error: `Invalid scenario. Must be one of: ${validScenarios.join(', ')}` })
  }

  const dealCount = parseInt(count) || 250
  if (![100, 250, 500].includes(dealCount)) {
    return res.status(400).json({ error: 'count must be 100, 250, or 500' })
  }

  try {
    const __filename = fileURLToPath(import.meta.url)
    const __dirname = path.dirname(__filename)
    const filePath = path.join(__dirname, 'src', 'data', 'scenarios', `${scenario}-sfdc.json`)
    const rawData = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
    const sliced = rawData.slice(0, dealCount)

    // Transform to camelCase format expected by the MarginArcDemoDataQueueable
    const deals = sliced.map(d => ({
      name: d.Name,
      accountName: d.AccountName,
      accountIndustry: d.AccountIndustry || 'Technology',
      stageName: d.StageName,
      amount: d.Amount,
      closeDate: d.CloseDate,
      oem: d.Fulcrum_OEM__c,
      oemCost: d.Fulcrum_OEM_Cost__c,
      customerSegment: d.Fulcrum_Customer_Segment__c,
      dealRegType: d.Fulcrum_Deal_Reg_Type__c,
      competitorNames: d.Fulcrum_Competitor_Names__c,
      solutionComplexity: d.Fulcrum_Solution_Complexity__c,
      relationshipStrength: d.Fulcrum_Relationship_Strength__c,
      servicesAttached: d.Fulcrum_Services_Attached__c,
      productCategory: d.Fulcrum_Product_Category__c,
      plannedMargin: d.Fulcrum_Planned_Margin__c,
      gpPercent: d.Fulcrum_GP_Percent__c,
      lossReason: d.Fulcrum_Loss_Reason__c,
      dealType: d.Fulcrum_Deal_Type__c
    }))

    const uniqueAccounts = new Set(deals.map(d => d.accountName)).size

    res.json({
      success: true,
      scenario,
      count: deals.length,
      uniqueAccounts,
      deals
    })
  } catch (err) {
    console.error('Error loading scenario data:', err)
    res.status(500).json({ error: 'Failed to load scenario data' })
  }
})

// Demo data routes (JWT-authed, no API key required)
app.use('/api/demo-data', demoDataRoutes)

// API key authentication for production (applies to other /api routes)
const MARGINARC_API_KEY = process.env.MARGINARC_API_KEY || ''
if (MARGINARC_API_KEY) {
  app.use('/api', (req, res, next) => {
    if (req.path === '/health') return next()
    // Skip API key check for licensing routes and demo-data (JWT-authed)
    if (req.path.startsWith('/v1/license')) return next()
    if (req.path.startsWith('/demo-data')) return next()
    const provided = req.headers['x-api-key'] || ''
    if (provided !== MARGINARC_API_KEY) {
      return res.status(401).json({ error: 'Invalid or missing API key' })
    }
    next()
  })
}

// Rate limiting
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute window
  max: 60, // 60 requests per minute per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
  skip: (req) => req.path === '/health'
})
app.use('/api', limiter)

const DealInput = z.object({
  oem: z.string().trim().optional().default(''),
  oemCost: z.number().positive(),
  productCategory: z.enum(['Hardware','Software','Cloud','ProfessionalServices','ManagedServices','ComplexSolution']),
  customerSegment: z.enum(['SMB','MidMarket','Enterprise']),
  relationshipStrength: z.enum(['New','Good','Strategic']).optional().default('Good'),
  customerTechSophistication: z.enum(['Low','Medium','High']).optional().default('Medium'),
  dealRegType: z.enum(['NotRegistered','StandardApproved','PremiumHunting','Teaming']).optional().default('NotRegistered'),
  competitors: z.enum(['0','1','2','3+']).optional().default('1'),
  valueAdd: z.enum(['Low','Medium','High']).optional().default('Medium'),
  solutionComplexity: z.enum(['Low','Medium','High']).optional().default('Medium'),
  varStrategicImportance: z.enum(['Low','Medium','High']).optional().default('Medium'),
  customerIndustry: z.string().refine(val => industries.includes(val), 'Invalid industry option'),
  customerPriceSensitivity: z.number().int().min(1).max(5).optional(),
  customerLoyalty: z.number().int().min(1).max(5).optional(),
  dealUrgency: z.number().int().min(1).max(5).optional(),
  isNewLogo: z.boolean().optional(),
  solutionDifferentiation: z.number().int().min(1).max(5).optional(),
  servicesAttached: z.boolean().optional(),
  quarterEnd: z.boolean().optional(),
  displacementDeal: z.boolean().optional(),
  dealSize: z.number().optional(),
  dealType: z.string().trim().optional(),
  accountName: z.string().trim().optional(),
  competitorNames: z.array(z.string()).optional(),
  oemProfile: z.object({
    baseMargin: z.number().min(0).max(100).optional(),
    dealRegBoost: z.number().min(0).max(50).optional(),
    quarterEndDiscount: z.number().min(0).max(50).optional(),
    servicesBoost: z.number().min(0).max(50).optional(),
    productCategory: z.string().trim().optional()
  }).nullable().optional(),
  competitorProfiles: z.array(z.object({
    name: z.string().trim(),
    priceAggression: z.number().min(1).max(5).optional(),
    marginAggression: z.number().min(-5).max(5).optional(),
    typicalDiscount: z.number().min(0).max(100).optional(),
    servicesCapability: z.number().min(1).max(5).optional(),
    primaryOems: z.string().trim().optional(),
    primaryStrength: z.string().trim().optional()
  })).nullable().optional()
})


const BomLineInput = z.object({
  description: z.string().trim().min(1, 'Description required'),
  key: z.string().trim().optional().default(''),
  category: z.string().trim().optional().default('Hardware'),
  unit: z.string().trim().optional().default('ea'),
  productNumber: z.string().trim().optional().default(''),
  productId: z.string().trim().optional().default(''),
  vendor: z.string().trim().optional().default(''),
  listPrice: z.coerce.number().min(0),
  discountedPrice: z.coerce.number().min(0),
  priceAfterMargin: z.coerce.number().min(0),
  recommendedMarginPct: z.coerce.number().min(0).max(100).optional(),
  quantity: z.coerce.number().min(0.01).default(1),
  note: z.string().trim().optional().default('')
})

const BomLinesInput = z.array(BomLineInput).max(50)

function humanizeLabel(value = ''){
  return value.replace(/([a-z])([A-Z])/g, '$1 $2')
}

function humanizeLower(value = ''){
  return humanizeLabel(value).toLowerCase()
}

function fallbackExplanation(rec, bom){
  const topDrivers = (rec.drivers || [])
    .slice(0, 3)
    .map(d => `${d.name} ${(d.val * 100).toFixed(1)}%`)
    .join(', ')
  const driverText = topDrivers
    ? `Key contributors: ${topDrivers}.`
    : 'Leverages policy guardrails and peer benchmarks.'
  if (bom?.origin === 'manual'){
    return `Manual BOM blend anchors margin at ${rec.suggestedMarginPct.toFixed(1)}%. ${driverText}`
  }
  return `Margin set at ${rec.suggestedMarginPct.toFixed(1)}%. ${driverText}`
}

function fallbackQualitative(input, rec, bom, metrics, algorithmMarginPct){
  const sentences = []
  const compText = input.competitors === '0'
    ? 'no direct competition'
    : `${input.competitors} competitor${input.competitors === '1' ? '' : 's'}`
  sentences.push(`With ${compText}, a ${input.relationshipStrength.toLowerCase()} relationship, and ${humanizeLower(input.dealRegType)} registration, a ${rec.suggestedMarginPct.toFixed(1)}% blend balances win odds and profitability.`)
  if (bom?.origin === 'manual'){
    const bomPrice = Number(bom.totals?.price ?? 0).toLocaleString()
    const bomMargin = ((bom.totals?.marginPct ?? 0) * 100).toFixed(1)
    sentences.push(`The AE-provided BOM totals $${bomPrice} at ${bomMargin}% blended margin across ${bom.stats?.lineCount ?? 0} line items, rooting the override in customer-ready math.`)
  } else if (bom?.totals){
    const bomPrice = Number(bom.totals.price ?? 0).toLocaleString()
    const bomMargin = ((bom.totals.marginPct ?? 0) * 100).toFixed(1)
    sentences.push(`The synthesized BOM projects $${bomPrice} revenue at ${bomMargin}% blended margin across the mix of hardware, services, and support.`)
  }
  if (algorithmMarginPct != null && Math.abs(algorithmMarginPct - rec.suggestedMarginPct) > 0.1){
    sentences.push(`Baseline modeling suggested ${algorithmMarginPct.toFixed(1)}%, so the override reflects AE judgement while staying within guardrails.`)
  }
  if (metrics){
    const gross = formatCurrencyDelta(metrics.delta.grossProfit)
    const risk = formatCurrencyDelta(metrics.delta.riskAdjusted)
    sentences.push(`Versus the seller plan, gross profit shifts by ${gross} and risk-adjusted profit by ${risk}.`)
  }
  return sentences.join(' ')
}

function formatCurrencyDelta(value){
  const num = Number(value || 0)
  const abs = Math.abs(num)
  const sign = num >= 0 ? '+' : '-'
  return `${sign}$${abs.toLocaleString(undefined,{ minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

app.get('/health', (req,res)=> res.json({ ok:true }))

app.get('/api/sampledeals', async (req,res)=> {
  try {
    const deals = await fetchAllDeals(sampleDeals)
    res.json(deals)
  } catch (e) {
    res.json(sampleDeals)
  }
})

app.get('/api/industries', (req,res)=> res.json(industries))

app.get('/api/bomcatalog', (req,res)=> res.json({ catalog: bomCatalog, presets: bomPresets }))

app.post('/api/bom/search', (req, res) => {
  try {
    const { query, manufacturer, category, limit } = req.body || {}
    const result = searchCatalog({ query, manufacturer, category, limit })
    res.json(result)
  } catch (e) {
    res.status(400).json({ error: e?.message || 'Invalid request' })
  }
})

app.post('/api/bom/analyze', async (req, res) => {
  try {
    const { bomLines, context } = req.body || {}
    if (!Array.isArray(bomLines)) {
      return res.status(400).json({ error: 'bomLines must be an array' })
    }
    const result = optimizeBom(bomLines, context || {})
    return res.json(result)
  } catch (e) {
    return res.status(400).json({ error: e?.message || 'Invalid request' })
  }
})

app.get('/api/customers', (req,res)=> {
  const q = (req.query.q||'').toLowerCase()
  const matches = customers
    .filter(c=> c.name.toLowerCase().includes(q))
    .slice(0,10)
    .map(c=> ({
      ...c,
      relationshipStage: c.relationshipStrength,
      valueAddExpectation: c.valueAddExpectation || 'Medium',
      customerIndustry: c.industry,
      solutionComplexity: c.solutionComplexity || 'Medium',
      varStrategicImportance: c.varStrategicImportance || 'Medium'
    }))
  res.json(matches)
})

app.post('/api/recommend', async (req,res)=> {
  try {
    const input = DealInput.parse(req.body?.input)
    const planned = typeof req.body?.plannedMarginPct==='number'
      ? req.body.plannedMarginPct
      : null
    const manualBomLines = Array.isArray(req.body?.bomLines) ? BomLinesInput.parse(req.body.bomLines) : []
    const manualStats = manualBomLines.length ? computeManualBomStats(manualBomLines) : null

    // Determine customer phase from org_id header
    const orgId = req.headers['x-org-id'] || null
    let phase = 1
    try {
      phase = await getCustomerPhase(orgId)
    } catch (phaseErr) {
      // Default to Phase 1 if lookup fails — safe fallback
      structuredLog('warn', 'phase_lookup_failed', { orgId, error: phaseErr?.message })
    }

    const deals = await fetchAllDeals(sampleDeals, orgId)
    const rec = await computeRecommendation(input, deals, { bomStats: manualStats })
    const algorithmMarginPct = rec.suggestedMarginPct
    const algorithmSuggestedPrice = rec.suggestedPrice

    const response = { ...rec, algorithmMarginPct, algorithmSuggestedPrice }

    if (manualStats) {
      response.suggestedMarginPct = Math.max(0.5, Math.min(55, manualStats.blendedMarginPct * 100))
      response.suggestedPrice = manualStats.totals.price
      response.method = 'Manual BOM blend'
    }

    const bom = buildBillOfMaterials(input, response, { manualLines: manualBomLines })
    const metrics = compareWithPlan(input, planned, response.suggestedMarginPct)

    let explanation = ''
    let geminiExplainOk = false
    try {
      explanation = await explainRecommendation(response, { bom })
      geminiExplainOk = !!explanation
    } catch (e) {
      structuredLog('warn', 'gemini_explain_failed', { error: e?.message })
    }
    if (!explanation) explanation = fallbackExplanation(response, bom)

    let qualitativeSummary = ''
    let geminiQualOk = false
    try {
      qualitativeSummary = await summarizeQualitative({ input, rec: response, metrics, bom, algorithmMarginPct })
      geminiQualOk = !!qualitativeSummary
    } catch (e) {
      structuredLog('warn', 'gemini_qualitative_failed', { error: e?.message })
    }
    if (!qualitativeSummary) qualitativeSummary = fallbackQualitative(input, response, bom, metrics, algorithmMarginPct)

    const predictionQuality = assessPredictionQuality(input, rec)

    // Compute deal score (available in all phases)
    const { dealScore, scoreFactors } = computeDealScore({
      plannedMarginPct: planned,
      suggestedMarginPct: response.suggestedMarginPct,
      winProbability: response.winProbability,
      confidence: response.confidence,
      predictionQuality
    })

    if (isLambda) {
      structuredLog('info', 'recommendation', {
        oem: input.oem || 'unknown',
        segment: input.customerSegment,
        industry: input.customerIndustry,
        marginPct: response.suggestedMarginPct,
        confidence: response.confidence,
        method: response.method,
        hasBom: manualBomLines.length > 0,
        bomLineCount: manualBomLines.length,
        plannedMarginPct: planned,
        qualityScore: predictionQuality.score,
        dealScore,
        phase,
        geminiExplain: geminiExplainOk,
        geminiQual: geminiQualOk
      })
    }

    // Phase 1: Score Only — return deal score but suppress margin recommendation
    if (phase === 1) {
      return res.json({
        dealScore,
        scoreFactors,
        dataQuality: predictionQuality,
        suggestedMarginPct: null,
        suggestedPrice: null,
        winProbability: response.winProbability,
        confidence: response.confidence,
        method: response.method,
        drivers: response.drivers,
        policyFloor: response.policyFloor,
        phaseInfo: {
          current: 1,
          message: 'Score your deals to build your data foundation. Margin recommendations unlock at Phase 2.',
          nextPhaseReady: false // will be enriched client-side via admin API
        }
      })
    }

    // Phase 2 & 3: Full recommendation + deal score
    const fullResponse = {
      ...response,
      explanation,
      qualitativeSummary,
      metrics,
      bom: phase === 3 ? bom : { ...bom, lines: undefined },
      predictionQuality,
      dealScore,
      scoreFactors,
      phaseInfo: { current: phase }
    }

    return res.json(fullResponse)

  } catch (e) {
    if (isLambda) {
      structuredLog('error', 'recommend_failed', { error: e?.message })
    }
    return res.status(400).json({ error: e?.message || 'Invalid input' })
  }
})

const DealRecord = z.object({
  input: DealInput,
  achievedMarginPct: z.coerce.number().min(0).max(100),
  status: z.enum(['Won','Lost']),
  lossReason: z.string().optional(),
  bomLines: BomLinesInput.optional()
})

app.post('/api/deals', async (req,res)=> {
  try {
    const { input, achievedMarginPct, status, lossReason, bomLines } = DealRecord.parse(req.body)
    const manualStats = bomLines?.length ? computeManualBomStats(bomLines) : null
    const deal = {
      segment: input.customerSegment,
      industry: input.customerIndustry,
      customerIndustry: input.customerIndustry,
      productCategory: input.productCategory,
      dealRegType: input.dealRegType,
      competitors: input.competitors,
      valueAdd: input.valueAdd,
      relationshipStrength: input.relationshipStrength,
      customerTechSophistication: input.customerTechSophistication,
      solutionComplexity: input.solutionComplexity,
      varStrategicImportance: input.varStrategicImportance,
      customerPriceSensitivity: input.customerPriceSensitivity,
      customerLoyalty: input.customerLoyalty,
      dealUrgency: input.dealUrgency,
      isNewLogo: input.isNewLogo,
      solutionDifferentiation: input.solutionDifferentiation,
      achievedMargin: achievedMarginPct/100,
      status,
      oemCost: input.oemCost,
      lossReason: lossReason || '',
      oem: input.oem || '',
      servicesAttached: input.servicesAttached ?? null,
      quarterEnd: input.quarterEnd ?? null,
      competitorNames: input.competitorNames || [],
      bomLineCount: manualStats?.lineCount || 0,
      bomAvgMarginPct: manualStats?.avgMarginPct ?? null,
      hasManualBom: Boolean(manualStats?.manual)
    }
    if (bomLines?.length){
      deal.bomLines = bomLines.map(line => ({
        description: line.description,
        productNumber: line.productNumber || '',
        productId: line.productId || '',
        vendor: line.vendor || '',
        listPrice: line.listPrice,
        discountedPrice: line.discountedPrice,
        priceAfterMargin: line.priceAfterMargin,
        quantity: line.quantity ?? 1,
        recommendedMarginPct: line.recommendedMarginPct
      }))
    }
    // Persist to DB before responding (Lambda freezes after response, killing fire-and-forget promises)
    const orgId = req.headers['x-org-id'] || null
    try {
      await insertRecordedDeal(deal, orgId)
      invalidateDealsCache(orgId)
    } catch (err) {
      console.error('Failed to persist deal:', err.message)
    }
    res.json({ ok:true })
  } catch (e) {
    res.status(400).json({ error: e?.message || 'Invalid input' })
  }
})

// OpenAPI / Swagger UI — interactive API documentation
const openapiSpec = yaml.load(
  fs.readFileSync(path.join(__dirname, 'openapi.yaml'), 'utf-8')
)
app.use('/docs/api-reference', swaggerUi.serve, swaggerUi.setup(openapiSpec, {
  customSiteTitle: 'MarginArc API Reference',
  customCss: '.swagger-ui .topbar { display: none }'
}))

// Docs portal API routes
app.use('/docs/api', docsAuthRouter)
app.use('/docs/api/content', verifyDocToken, docsContentRouter)

// Docs portal SPA
const docsDir = path.join(__dirname, 'web-docs', 'dist')
app.get('/docs', (req, res, next) => {
  // Only redirect if no trailing slash (avoid loop since Express treats /docs and /docs/ the same)
  if (!req.originalUrl.endsWith('/')) return res.redirect(301, '/docs/')
  next()
})
app.use('/docs', express.static(docsDir))
app.get('/docs/*', (req, res) => {
  if (req.path.startsWith('/docs/api')) return // Don't catch API routes
  res.sendFile(path.join(docsDir, 'index.html'))
})

// Redirect /admin to /admin/ for CloudFront routing
app.get('/admin', (req, res, next) => {
  if (!req.originalUrl.endsWith('/')) return res.redirect(301, '/admin/')
  next()
})

// Serve Admin Portal SPA (built files from web/dist)
const adminDir = path.join(__dirname, 'web', 'dist')
app.use('/admin', express.static(adminDir))
app.get('/admin/*', (req, res) => res.sendFile(path.join(adminDir, 'index.html')))

// Serve SPA
const publicDir = path.join(__dirname, 'public')
app.use(express.static(publicDir))
app.get('*', (req,res)=> res.sendFile(path.join(publicDir, 'index.html')))

// Lambda handler export
export const handler = serverless(app)

// Only start server if not running in Lambda
if (!isLambda) {
  const PORT = process.env.PORT || 8080
  app.listen(PORT, ()=> {
    console.log(`Margin.AI running at http://localhost:${PORT}`)
  })
}
