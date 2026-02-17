# Deployment Guide

## Salesforce Deployment

### Prerequisites
- Salesforce CLI installed (`npm install -g @salesforce/cli`)
- Authenticated to target org

### Manual Deploy
```bash
cd sfdc
SF_USE_GENERIC_UNIX_KEYCHAIN=true sf project deploy start \
  --target-org matt.542a9844149e@agentforce.com
```

### Deploy Specific Component
```bash
# Single LWC
SF_USE_GENERIC_UNIX_KEYCHAIN=true sf project deploy start \
  --target-org matt.542a9844149e@agentforce.com \
  -m "LightningComponentBundle:marginarcMarginAdvisor"

# Single Apex class
SF_USE_GENERIC_UNIX_KEYCHAIN=true sf project deploy start \
  --target-org matt.542a9844149e@agentforce.com \
  -m "ApexClass:MarginArcController"
```

### Run Tests
```bash
SF_USE_GENERIC_UNIX_KEYCHAIN=true sf apex run test \
  --target-org matt.542a9844149e@agentforce.com
```

### CI/CD (GitHub Actions)
Pushing to `main` with changes in `sfdc/force-app/**` automatically triggers deployment.

**Workflow**: `.github/workflows/deploy-sfdc.yml`

**If auth expires**, re-extract and update the secret:
```bash
# Get new auth URL
SF_USE_GENERIC_UNIX_KEYCHAIN=true sf org display \
  --target-org matt.542a9844149e@agentforce.com --verbose --json \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['result']['sfdxAuthUrl'])"

# Update GitHub secret
gh secret set SFDX_AUTH_URL --repo mattrothberg2/MarginArc --body "<paste-auth-url>"
```

### Before Package Version Create
Abort CronTrigger jobs first:
```bash
SF_USE_GENERIC_UNIX_KEYCHAIN=true sf apex run \
  --target-org matt.542a9844149e@agentforce.com \
  -f <(echo "
for (CronTrigger ct : [SELECT Id FROM CronTrigger WHERE CronJobDetail.Name LIKE '%MarginArc%']) {
    System.abortJob(ct.Id);
}
")
```

---

## Lambda Deployment

### Build Process
Always build in `/tmp/` (not in repo — Google Drive sync makes it slow).

```bash
# 1. Create build directory
rm -rf /tmp/lambda-build && mkdir -p /tmp/lambda-build

# 2. Copy server files
cp -r lambda/server/* /tmp/lambda-build/
rm -rf /tmp/lambda-build/node_modules

# 3. Fresh production install (CRITICAL: prevents @smithy corruption)
cd /tmp/lambda-build && npm install --production

# 4. Create zip
cd /tmp/lambda-build && zip -r /tmp/lambda-deploy.zip . \
  -x "*.git*" "jest.config.js" "__tests__/*"

# 5. Deploy
aws lambda update-function-code \
  --function-name marginarc-api \
  --zip-file fileb:///tmp/lambda-deploy.zip \
  --region us-east-1

# 6. Wait for update
aws lambda wait function-updated --function-name marginarc-api --region us-east-1

# 7. Publish version
aws lambda publish-version \
  --function-name marginarc-api \
  --description "vN: Description of changes" \
  --region us-east-1
```

### Verify Deployment
```bash
# Test recommendation endpoint
curl -s -X POST https://api.marginarc.com/api/recommend \
  -H "Content-Type: application/json" \
  -H "x-api-key: $MARGINARC_API_KEY" \
  -d '{"input":{"oem":"Cisco","oemCost":100000,"customerSegment":"MidMarket"},"plannedMarginPct":15}' \
  | python3 -m json.tool | head -10

# Test admin portal
curl -s https://api.marginarc.com/admin/ | head -3
```

### Environment Variables
| Variable | Value | Purpose |
|----------|-------|---------|
| `NODE_ENV` | `production` | Production mode |
| `MARGINARC_API_KEY` | *(stored in GitHub Secrets)* | API key for SFDC calls |

### Rollback
```bash
# List versions
aws lambda list-versions-by-function --function-name marginarc-api --region us-east-1

# Update to specific version's code
aws lambda update-function-code \
  --function-name marginarc-api \
  --s3-bucket <bucket> --s3-key <key> \
  --region us-east-1
```

---

## Admin Portal

**URL**: `https://api.marginarc.com/admin/`
**Login**: admin / *(see SSM parameter `/marginarc/admin-password`)*

The Admin SPA is built with Vite (React) and lives in `lambda/server/web/`. The built files are served directly by the Lambda function at `/admin/*`.

To rebuild:
```bash
cd lambda/server/web && npm install && npm run build
```
Then redeploy Lambda.
