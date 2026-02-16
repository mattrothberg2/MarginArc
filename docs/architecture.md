# MarginArc Architecture

## System Overview

MarginArc is a two-tier system:

1. **Salesforce Package** (`sfdc/`) — LWC components + Apex controllers that live inside the customer's Salesforce org. All deal data (OEM, cost, margins, competitors) stays within Salesforce.

2. **Lambda API** (`lambda/`) — Node.js Express app deployed as AWS Lambda. Handles the recommendation engine, licensing, admin portal, and (future) anonymized benchmarks.

## Data Flow: Margin Recommendation

```
User opens Opportunity
        │
        ▼
marginarcMarginAdvisor (LWC)
        │ reads Opportunity fields via @wire
        ▼
MarginArcController.callMarginArcApi() (Apex)
        │ HTTP POST with x-api-key header
        ▼
api.marginarc.com/api/recommend (CloudFront → Lambda)
        │
        ├── rules.js: 22-rule margin engine
        │   - Segment base margins (SMB=20%, MidMarket=17%, Enterprise=14%)
        │   - OEM-specific adjustments
        │   - Competitive pressure, deal registration, services, quarter-end
        │   - Policy floors (3% normal, 0.5% critical)
        │
        ├── knn.js: k-Nearest Neighbor similarity
        │   - 12 neighbors, ~18 dimensions
        │   - Alpha blend 25-60% with rules engine
        │
        ├── winprob.js: Win probability model
        │   - Logistic: 0.6*base + 0.4*(1/(1+exp(0.08*(m-18))))
        │   - 10 input factors, clamped 5-95%
        │
        ├── bom.js: Bill of Materials (if BOM lines provided)
        │   - Per-line margin recommendations
        │   - Blended margin calculation
        │
        └── gemini.js: AI explanation (via Google Gemini)
            - Qualitative narrative of the recommendation
        │
        ▼
Response: { suggestedMarginPct, winProbability, confidence, drivers[], bom, aiExplanation }
        │
        ▼
LWC displays recommendation, user clicks "Apply"
        │
        ▼
Opportunity fields updated: Recommended_Margin, AI_Confidence, Win_Probability
```

## Licensing Flow

```
Package installed in customer org
        │
        ▼
Admin enters license key in Setup Wizard
        │
        ▼
MarginArcLicenseActivator.activateLicense(key) (Apex)
        │ HTTP POST
        ▼
api.marginarc.com/api/v1/license/activate
        │ Validates key, returns org config
        ▼
Fulcrum_License__c updated with status, expiry, seats
        │
        ▼ (Weekly, Sundays at 2 AM)
MarginArcLicenseValidator phone-home
        │ HTTP POST
        ▼
api.marginarc.com/api/v1/license/validate
        │ Returns current status + any config updates
        ▼
Fulcrum_License__c refreshed
```

## Nightly Batch Analysis

```
2 AM daily (System.schedule)
        │
        ▼
MarginArcBatchAnalyzer (Batchable + AllowsCallouts)
        │
        ├── Mon-Sat: Incremental (only unanalyzed deals)
        └── Sunday: Full refresh (all open deals)
        │
        ▼ (batch size: 10, callout limit compliance)
For each Opportunity:
        │
        ▼
POST /api/recommend (same as interactive flow)
        │
        ▼
Write back: Fulcrum_Recommended_Margin__c, AI_Confidence, Win_Probability
```

## Infrastructure

| Component | Service | Config |
|-----------|---------|--------|
| API | AWS Lambda `marginarc-api` | Node.js 18.x, 512MB, 30s timeout |
| CDN | CloudFront `E1V89O84EUZGU1` | Domain: api.marginarc.com |
| Database | RDS PostgreSQL | Licensing, admin users, telemetry, deal analytics |
| Secrets | SSM Parameter Store | All under `/marginarc/` prefix |
| Admin SPA | S3 `marginarc-admin` | Served at /admin/* via CloudFront |
| SFDC | Developer Edition | orgfarm-bff1a6b1a0-dev-ed.develop.lightning.force.com |

## SSM Parameters

| Path | Purpose |
|------|---------|
| `/marginarc/db/host` | RDS hostname |
| `/marginarc/db/user` | DB username |
| `/marginarc/db/password` | DB password (SecureString) |
| `/marginarc/db/name` | Database name |
| `/marginarc/license/secret` | License key signing secret |
| `/marginarc/admin/password` | Admin portal fallback password |
| `/marginarc/jwt/secret` | JWT signing secret |
| `/marginarc/sf-consumer-key` | Salesforce Connected App key |
| `/marginarc/sf-consumer-secret` | Salesforce Connected App secret |

## Future: Data Separation Architecture

The 22-rule engine, kNN, and win probability are pure math — they can run entirely in Apex. The target architecture:

- **In Salesforce (customer side)**: Rules engine, kNN (using SOQL for historical corpus), win probability — all deal data stays in-org
- **Lambda (MarginArc infrastructure)**: Licensing only + MarginArc Network (anonymized benchmarks) + Gemini AI relay

For the current demo, the single-tenant architecture (all via Lambda) is appropriate.
