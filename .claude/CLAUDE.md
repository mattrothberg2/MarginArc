# MarginArc — Project Rules

## Architecture
- Monorepo: `sfdc/` (Salesforce 2GP Package) + `lambda/` (AWS Lambda API)
- Lambda function `marginarc-api` deployed at `api.marginarc.com` (CloudFront `E1V89O84EUZGU1`)
- Admin SPA served from Lambda at `/admin/*`
- API routes at `/api/*`, `/admin/api/*`, `/oauth/*`, `/docs/*`
- PostgreSQL on RDS for licensing, admin users, audit logs, deal analytics
- SSM parameters under `/marginarc/` prefix
- SFDC org: `matt.542a9844149e@agentforce.com`

## Core Engine Files (DO NOT MODIFY without explicit approval)
- `lambda/server/src/rules.js` — 22-rule margin recommendation engine (margin-on-selling-price convention)
- `lambda/server/src/metrics.js` — Price/GP calculations
- `lambda/server/src/winprob.js` — Win probability sigmoid (knee=15%, slope=0.095)
- These use `markupToMarginSP()` converters. Do NOT change the convention.

## SFDC API Names
All Salesforce API names use `Fulcrum_` prefix (e.g., `Fulcrum_OEM__c`, `Fulcrum_Config__c`). These are IMMUTABLE — see `docs/sfdc-api-names.md`. All user-facing labels say "MarginArc".

## Naming Conventions
- Apex classes: `MarginArc*` (e.g., `MarginArcController`, `MarginArcBatchAnalyzer`)
- LWC components: `marginarc*` (e.g., `marginarcMarginAdvisor`, `marginarcManagerDashboard`)
- Test classes: `MarginArc*Test`
- CSS classes: `marginarc-*` (e.g., `marginarc-widget`, `marginarc-card`)
- SFDC field/object API names: `Fulcrum_*__c` (preserved, immutable)
- License key prefix: `FULC-` (preserved, active keys exist)

## Deployment

### SFDC
```bash
cd sfdc
SF_USE_GENERIC_UNIX_KEYCHAIN=true sf project deploy start --target-org matt.542a9844149e@agentforce.com
```

### Lambda
Build in `/tmp/` (NOT in repo — Google Drive sync is slow):
```bash
rm -rf /tmp/lambda-build && mkdir -p /tmp/lambda-build
cp -r lambda/server/* /tmp/lambda-build/
rm -rf /tmp/lambda-build/node_modules
cd /tmp/lambda-build && npm install --production
cd /tmp/lambda-build && zip -r /tmp/lambda-deploy.zip . -x "*.git*" "__tests__/*"
aws lambda update-function-code --function-name marginarc-api --zip-file fileb:///tmp/lambda-deploy.zip --region us-east-1
aws lambda wait function-updated --function-name marginarc-api --region us-east-1
aws lambda publish-version --function-name marginarc-api --description "vN: description" --region us-east-1
```

Always `npm install --production` before zipping (corruption causes @smithy missing errors).

## CI/CD
- GitHub Actions auto-deploy SFDC on push to `main` (when `sfdc/force-app/**` changes)
- Lambda deploys are manual (zip + AWS CLI)

## Key Config
- Admin portal: admin / MarginArc2026!
- API key: marginarc-key-2025
- Lambda env var: `MARGINARC_API_KEY`
- SFDC custom setting `Fulcrum_Config__c` stores API_URL__c and API_Key__c

## Safety Rules
- NEVER commit directly to `main` — use feature branches + PRs
- NEVER force-push to `main`
- NEVER modify core engine files without approval
- NEVER change SSM parameters, DB schemas, or IAM policies without asking
- NEVER deploy code that isn't committed to GitHub
- Before package version create: abort CronTrigger jobs with LIKE '%MarginArc%'
- Verify deployments with headless browser test, not just curl
- `Math.exp()` does NOT exist in Apex — use `Math.pow(2.718281828459045, x)`
- LWC templates don't allow `!` unary expressions — use computed getter for negation

## File Structure
```
sfdc/
  force-app/main/default/
    classes/                    MarginArc*.cls (14 prod + 14 test)
    lwc/                        marginarc* (10 components)
    objects/                    Fulcrum_*__c custom objects + fields
    permissionsets/             Fulcrum_Admin/Manager/User
    tabs/                       Fulcrum_* tabs → marginarc* LWC
    remoteSiteSettings/         Fulcrum_API → api.marginarc.com
    reports/                    Fulcrum_Reports/
  sfdx-project.json             Package: "Fulcrum AI" (0Hofj0000001BflCAE)

lambda/
  server/
    index.js                    Express app, routes, Lambda handler
    src/
      rules.js, metrics.js,    Core engine (DO NOT MODIFY)
      winprob.js, knn.js
      bom.js, gemini.js        BOM builder, Gemini AI
      quality-tiers.js          Gold/Silver/Bronze data quality
      analytics.js              Deal persistence, margin distributions
      licensing/
        admin.js                Admin API (multi-user auth, bcrypt)
        db.js                   PostgreSQL connection + migrations
        license.js              License key generation
        routes.js               License validation API
      salesforce/
        oauth.js                Salesforce OAuth flow
        demo-data.js            Demo data loading
      docs/
        auth.js                 Docs portal auth
        content.js              Docs content API
    web/                        Admin portal SPA (Vite)
    web-docs/                   Docs portal SPA (Vite)
    data/                       Sample deals, BOM catalog, vendor SKUs
```
