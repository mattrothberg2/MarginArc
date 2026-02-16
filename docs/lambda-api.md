# Lambda API Reference

**Function**: `marginarc-api`
**Domain**: `https://api.marginarc.com`
**Runtime**: Node.js 18.x, 512MB, 30s timeout
**Entry point**: `lambda/server/index.js`

## Authentication

API key via `x-api-key` header. Key set in Lambda env var `MARGINARC_API_KEY`.

Admin portal uses JWT tokens (bcrypt password auth → JWT cookie).

## Endpoints

### POST /api/recommend
Core recommendation engine. Accepts a deal + planned margin, returns recommended margin, win probability, confidence, drivers, BOM, and AI explanation.

**Request**:
```json
{
  "input": {
    "oem": "Cisco",
    "oemCost": 100000,
    "productCategory": "Hardware",
    "customerSegment": "MidMarket",
    "dealRegType": "StandardApproved",
    "competitors": "1",
    "competitorNames": ["CDW"],
    "valueAdd": "High",
    "solutionComplexity": "Medium",
    "relationshipStrength": "Good",
    "customerIndustry": "Technology",
    "customerTechSophistication": "Medium",
    "servicesAttached": false,
    "quarterEnd": false,
    "isNewLogo": false
  },
  "plannedMarginPct": 15,
  "bomLines": [],
  "meta": {
    "hasRealOemCost": true,
    "hasRealCompetitors": true,
    "hasRealDealReg": true,
    "hasRealOem": true,
    "hasRealSegment": true
  }
}
```

**Response**:
```json
{
  "suggestedMarginPct": 18.5,
  "winProbability": 72,
  "confidence": 85,
  "qualityTier": { "level": "gold", "label": "High Confidence", "missingForUpgrade": [] },
  "drivers": [
    { "factor": "OEM Profile", "direction": "up", "impact": 2.5, "explanation": "..." }
  ],
  "metrics": { "planned": {...}, "recommended": {...}, "delta": {...} },
  "bom": { "items": [...], "totals": {...} },
  "neighborData": { "count": 12, "ruleBase": 0.18, "weightedAvg": 0.19 }
}
```

### POST /api/deals/ingest
Persist deal outcomes to PostgreSQL for model training. Used by Smart Onboarding.

### GET /api/org/:orgId/defaults
Retrieve org-learned defaults (from historical deal analysis).

### GET /api/sampledeals
Returns sample deal data for testing.

### GET /api/industries
Returns industry list from customers.json.

### GET /api/bomcatalog
Returns the 50-item curated product catalog.

### POST /api/bom/search (NOT YET IMPLEMENTED)
Search product catalog by query, manufacturer, category.

### POST /api/bom/analyze (NOT YET IMPLEMENTED)
Analyze BOM lines and return per-line margin recommendations.

### GET /api/bom/catalog/stats (NOT YET IMPLEMENTED)
Catalog metadata (size, category breakdown).

---

## Licensing API

### POST /api/v1/license/activate
Activate a license key for a Salesforce org.

### POST /api/v1/license/validate
Phone-home validation (called weekly by MarginArcLicenseValidator).

### POST /api/v1/license/telemetry
Usage telemetry submission.

---

## Admin Portal

### POST /admin/api/auth/login
Login with username/password. Returns JWT token.

### GET /admin/api/dashboard
Dashboard statistics (customers, licenses, telemetry).

### /admin/api/customers/*
CRUD for customer management.

### /admin/api/licenses/*
License management.

### /admin/api/config/*
System configuration.

---

## OAuth Routes

### GET /oauth/authorize
Initiate Salesforce OAuth flow.

### GET /oauth/callback
Handle OAuth callback.

### GET /oauth/connections
List connected Salesforce orgs.

---

## Core Engine Files (DO NOT MODIFY without approval)

| File | Purpose |
|------|---------|
| `server/src/rules.js` | 22-rule margin engine (margin-on-selling-price convention) |
| `server/src/metrics.js` | Price/GP calculations |
| `server/src/winprob.js` | Win probability sigmoid (knee=15%, slope=0.095) |

These files use `markupToMarginSP()` converters. Never change the margin convention.

## PostgreSQL Tables

| Table | Purpose |
|-------|---------|
| `customers` | Customer organizations |
| `licenses` | License keys and activation status |
| `customer_config` | Per-customer configuration |
| `telemetry_events` | Usage telemetry |
| `license_activations` | Activation history |
| `audit_logs` | Admin action audit trail |
| `admin_users` | Multi-user admin auth (bcrypt) |
| `settings` | System settings (key-value) |
| `recorded_deals` | Historical deals for model training |
| `org_margin_distributions` | Per-org percentile margin stats |
