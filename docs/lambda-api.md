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

### POST /api/bom/search
Search the unified product catalog (vendor SKUs + curated catalog) by free-text query, manufacturer, and/or category.

**Request**:
```json
{
  "query": "C9300",
  "manufacturer": "Cisco",
  "category": "Hardware",
  "limit": 20
}
```

All fields are optional. `query` performs case-insensitive substring matching on partNumber and description (multiple words use AND logic). `manufacturer` and `category` are exact filters (case-insensitive). `limit` defaults to 20, max 100.

**Response**:
```json
{
  "results": [
    {
      "partNumber": "C9300-48P-A",
      "description": "Catalyst 9300 48-Port PoE+ Switch",
      "manufacturer": "Cisco",
      "category": "Hardware",
      "role": "core",
      "listPrice": 12495,
      "suggestedDiscount": 0.30,
      "typicalMarginRange": { "low": 8, "high": 18 }
    }
  ],
  "total": 4,
  "query": "C9300"
}
```

### POST /api/bom/analyze
Analyze BOM lines and return per-line margin optimization. Solves for per-line margins that meet category floors, achieve a target blended margin (weighted by extended cost), and maximize margin on high-elasticity lines (services/software) while keeping hardware competitive.

Uses margin-on-selling-price convention throughout.

**Request**:
```json
{
  "bomLines": [
    {
      "partNumber": "C9300-48P-A",
      "manufacturer": "Cisco",
      "category": "Hardware",
      "quantity": 10,
      "unitCost": 5717,
      "marginPct": 12
    },
    {
      "description": "Implementation Services",
      "category": "ProfessionalServices",
      "quantity": 80,
      "unitCost": 175,
      "marginPct": 30
    }
  ],
  "context": {
    "oem": "Cisco",
    "customerSegment": "MidMarket",
    "dealRegType": "StandardApproved",
    "competitors": "1",
    "solutionComplexity": "Medium",
    "relationshipStrength": "Good",
    "valueAdd": "High",
    "targetBlendedMargin": 18.5
  }
}
```

**Fields**:
- `bomLines` (required, array): Each line has `category` (Hardware | Software | Cloud | ProfessionalServices | ManagedServices | ComplexSolution), `quantity`, `unitCost`, `marginPct` (current margin %), and optionally `partNumber` or `description`.
- `context` (optional, object): Deal context used to adjust category targets. `targetBlendedMargin` is the desired blended margin % across all lines.

**Category margin floors**: Hardware 5%, Software 8%, Cloud 6%, ProfessionalServices 15%, ManagedServices 12%, ComplexSolution 10%.

**Response**:
```json
{
  "lines": [
    {
      "index": 0,
      "partNumber": "C9300-48P-A",
      "currentMarginPct": 12,
      "recommendedMarginPct": 10.5,
      "marginFloor": 5,
      "extendedCost": 57170,
      "extendedPrice": 63522,
      "grossProfit": 6352,
      "rationale": "Hardware in competitive Cisco deal — keep tight to win"
    }
  ],
  "totals": {
    "totalCost": 71170,
    "totalPrice": 85127,
    "blendedMarginPct": 16.4,
    "totalGrossProfit": 13957,
    "targetAchieved": false,
    "targetMarginPct": 18.5,
    "gap": 2.1
  },
  "recommendations": {
    "healthScore": 72,
    "insights": [
      "Services margin can absorb 5pp more to close the gap",
      "Consider deal registration to unlock 3pp of OEM margin"
    ]
  }
}
```

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
