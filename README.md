# MarginArc

AI-powered margin intelligence for IT Value-Added Resellers (VARs). MarginArc embeds directly into Salesforce Opportunity records, providing real-time margin recommendations, competitive intelligence, win probability modeling, and deal analytics powered by a 22-rule recommendation engine and kNN similarity matching.

## Architecture

```
Salesforce Org                          AWS
┌─────────────────────────┐    ┌──────────────────────────────┐
│ LWC Components (10)     │    │ Lambda: marginarc-api        │
│  marginarcMarginAdvisor  │───▶│  POST /api/recommend         │
│  marginarcManagerDashboard│   │  POST /api/deals/ingest      │
│  marginarcCompetitiveIntel│   │  GET  /api/org/:id/defaults  │
│  marginarcBomBuilder     │   │  Admin Portal (React SPA)    │
│  marginarcAdminConfig    │   │   /admin/*                   │
│  marginarcSetupWizard    │   │  Licensing API               │
│  ...                     │   │   /api/v1/license/*          │
│                          │   │                              │
│ Apex Controllers (14)    │   │ CloudFront: api.marginarc.com│
│  MarginArcController     │   │ RDS PostgreSQL               │
│  MarginArcManagerCtrl    │   │ SSM Parameter Store           │
│  MarginArcBatchAnalyzer  │   └──────────────────────────────┘
│  ...                     │
│                          │    ┌──────────────────────────────┐
│ Custom Objects           │    │ Google Gemini API            │
│  Fulcrum_OEM__c          │    │  AI explanations             │
│  Fulcrum_Competitor__c   │    │  gemini-2.5-flash-lite       │
│  22 Opportunity fields   │    └──────────────────────────────┘
└─────────────────────────┘
```

## Monorepo Structure

```
MarginArc/
├── sfdc/                   # Salesforce 2GP Unlocked Package
│   ├── force-app/          # LWC, Apex, custom objects, permission sets
│   ├── sfdx-project.json   # Package: "Fulcrum AI" (0Hofj0000001BflCAE)
│   └── package.json        # Prettier/ESLint tooling
├── lambda/                 # AWS Lambda API backend
│   ├── server/
│   │   ├── index.js        # Express app + Lambda handler
│   │   ├── src/            # Recommendation engine, licensing, admin
│   │   ├── web/            # Admin portal SPA
│   │   └── data/           # Sample data, BOM catalog
│   └── schema.sql          # RDS schema reference
├── .github/workflows/      # CI/CD for SFDC deploys
├── docs/                   # Documentation
└── .claude/                # AI assistant config
```

## Quick Start

### Salesforce Deployment

```bash
cd sfdc
SF_USE_GENERIC_UNIX_KEYCHAIN=true sf project deploy start \
  --target-org matt.542a9844149e@agentforce.com
```

### Lambda Deployment

```bash
# Build in /tmp (not in repo — Google Drive sync is slow)
rm -rf /tmp/lambda-build && mkdir -p /tmp/lambda-build
cp -r lambda/server/* /tmp/lambda-build/
rm -rf /tmp/lambda-build/node_modules
cd /tmp/lambda-build && npm install --production
cd /tmp/lambda-build && zip -r /tmp/lambda-deploy.zip . -x "*.git*" "__tests__/*"

aws lambda update-function-code \
  --function-name marginarc-api \
  --zip-file fileb:///tmp/lambda-deploy.zip \
  --region us-east-1

aws lambda publish-version --function-name marginarc-api \
  --description "vN: description" --region us-east-1
```

## Documentation

- [Architecture & Data Flow](docs/architecture.md)
- [SFDC Components Reference](docs/sfdc-components.md)
- [Lambda API Reference](docs/lambda-api.md)
- [Deployment Guide](docs/deployment.md)
- [SFDC API Names Explained](docs/sfdc-api-names.md)

## Key Technical Details

- **Recommendation Engine**: 22 rules, margin-on-selling-price convention, kNN with 12 neighbors
- **Win Probability**: Logistic model with 10 input factors, clamped 5-95%
- **License Format**: `FULC-XXXXXX-XXXX` with phone-home validation
- **API Domain**: `https://api.marginarc.com` (CloudFront → Lambda)
- **SFDC Package**: 2GP Unlocked, ID `0Hofj0000001BflCAE`, no namespace

## Note on API Names

SFDC custom field API names use the `Fulcrum_` prefix (e.g., `Fulcrum_OEM__c`, `Fulcrum_Config__c`). These are immutable in a deployed 2GP package. All user-facing labels display "MarginArc". See [docs/sfdc-api-names.md](docs/sfdc-api-names.md) for the full explanation.
