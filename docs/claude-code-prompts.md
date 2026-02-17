# Claude Code Prompts — MarginArc Development Roadmap

Each prompt below is self-contained and can be pasted directly into Claude Code web (claude.ai/code) connected to the `mattrothberg2/MarginArc` repo. They are ordered by dependency — complete earlier ones before later ones where noted.

## Critical Gotchas (read before running any prompt)

These are hard-won lessons from running prompts 1A-1C. Every prompt should respect these:

1. **File paths**: The data directory is `lambda/server/src/data/` (NOT `lambda/server/data/`). Generator is at `lambda/server/src/data/generateSyntheticDeals.js`, sample deals at `lambda/server/src/data/sample_deals.json`.

2. **Lambda async gotcha**: On AWS Lambda, the execution context FREEZES after the HTTP response is sent. Any fire-and-forget promises (`doSomething().then(...)` after `res.json()`) will be KILLED before they complete. Always `await` async operations BEFORE calling `res.json()`. Make handlers `async` when needed.

3. **DB migrations — CREATE TABLE IF NOT EXISTS is dangerous**: If a table already exists with a different schema, this silently succeeds but subsequent INSERTs fail with "column X does not exist". Use `DROP TABLE IF EXISTS` + `CREATE TABLE` for clean migrations, or use proper `ALTER TABLE ADD COLUMN IF NOT EXISTS` for additive changes.

4. **Keep sample data in sync with algorithm**: If you add a new field to the algorithm (knn.js, rules.js, winprob.js, quality.js), you MUST also add it to the `lambdaDeal` object in `generateSyntheticDeals.js` and regenerate `sample_deals.json`. Otherwise all 7,000 deals get the fallback/default value and the feature has zero effect.

5. **API validation is strict**: The `/api/recommend` and `/api/deals` endpoints use Zod schemas with strict enums. Industry must be one of: "Consumer Goods & Food", "Diversified Conglomerates", "Energy", "Financial Services", "Life Sciences & Healthcare", "Manufacturing & Automotive", "Media & Telecommunications", "Retail", "Technology", "Transportation & Logistics". Check the Zod schemas in `index.js` before testing.

6. **The deal recording endpoint is `POST /api/deals`** (NOT `/api/deals/ingest`). It expects `achievedMarginPct` (percentage like 28), not `achievedMargin` (decimal like 0.28).

7. **CI/CD auto-deploys on merge to main**: Lambda deploys automatically via GitHub Actions when `lambda/server/**` changes are merged to `main`. SFDC deploys when `sfdc/force-app/**` changes. After merging, verify the deploy succeeded via `gh run list` or the GitHub Actions tab.

8. **Testing and verification**: Always run `cd lambda/server && npm test` before committing. After CI/CD deploys, verify the live API at `api.marginarc.com` with curl. For SFDC changes, verify with the SF CLI.

9. **PR creation**: Create a feature branch, commit, and push. Then open a PR from the GitHub UI at `https://github.com/mattrothberg2/MarginArc/pull/new/<branch-name>`.

10. **SFDC CI/CD is now live (as of PR #17).** The pipeline runs prettier, eslint, aborts CronTrigger jobs, deploys, runs tests, and reschedules jobs. If you modify any `.cls` or LWC `.js` file, run `cd sfdc && npx prettier --write <file>` and `npx eslint <file>` before committing. Add any new test classes to the `--tests` list in `.github/workflows/deploy-sfdc.yml` (both dry-run and deploy steps).

## Running Prompts Concurrently

You can run multiple prompts in parallel Claude Code web sessions **if they don't modify the same files**. The main bottleneck is `lambda/server/index.js` — many Lambda prompts add routes to it.

### Concurrency Map

| Prompt | Modifies | Safe to run with |
|--------|----------|-----------------|
| **2A** | `lambda/server/index.js`, new `src/phases.js` | Any SFDC prompt (2B*, 2C*, 4C*) or 6A |
| **2B** | `sfdc/.../marginarcMarginAdvisor/*` | 3A, 3B, 3C, 4A, 4B, 6A (any Lambda-only prompt) |
| **2C** | `sfdc/.../marginarcSetupWizard/*`, `MarginArcSetupController.cls` | 3A, 3B, 3C, 4A, 4B, 6A (any Lambda-only prompt) |
| **3A** | `lambda/server/index.js`, `docs/lambda-api.md` | Any SFDC prompt (2B, 2C, 4C) or 6A |
| **3B** | `lambda/server/index.js`, new `src/bom-optimizer.js` | Any SFDC prompt or 6A |
| **3C** | `lambda/server/src/data/vendor_skus.json` only | Almost anything except 4B |
| **4A** | `lambda/server/src/data/generateSyntheticDeals.js`, new `src/data/scenarios.js` | Any SFDC prompt, 6A, or 3A/3B (if 3A/3B don't touch generator) |
| **4B** | `lambda/server/src/data/generateSyntheticDeals.js`, `sample_deals.json` | Any SFDC prompt or 6A |
| **4C** | `sfdc/.../marginarcSetupWizard/*`, `lambda/server/index.js` | 3C, 6A |
| **4D** | `sfdc/.../marginarcMarginAdvisor/*`, `marginarcManagerDashboard/*`, `marginarcDealInsights/*`, `marginarcBackfillReport/*` | Any Lambda prompt, 6A |
| **5A** | DEFERRED | — |
| **5B** | `lambda/server/index.js`, new `openapi.yaml` | Any SFDC prompt or 6A |
| **6A** | new `docs/network-design.md` (design doc only) | **Everything** |

### Safe Parallel Pairs (no file conflicts)

- **3C + 4C** — catalog data + SFDC setup wizard (different dirs)
- **3C + 4D** — catalog data + SFDC UI fixes (different dirs)
- **4D + 5B** — SFDC UI fixes + Lambda OpenAPI spec
- **4D + 3C** — SFDC UI fixes + Lambda catalog data
- **4C + 5B** — both touch index.js so NOT safe, but 4C is SFDC-heavy
- **6A + anything** — design doc touches no code

### DO NOT run in parallel (same file conflicts)

- **4C + 4D** — 4C modifies setup wizard, 4D modifies other LWCs, but both deploy to same SFDC org
- **4C + 5B** — both modify `index.js`
- Any two prompts that both modify `lambda/server/index.js`

### How to run concurrent sessions

1. Open two Claude Code web tabs, both connected to `mattrothberg2/MarginArc`
2. Paste one prompt in each tab
3. Each will create its own feature branch — no conflicts during development
4. **Merge order matters**: merge whichever finishes first, then the second PR may need a rebase if they touched nearby (but different) files. If they touch completely different directories (`sfdc/` vs `lambda/`), merge order doesn't matter.

---

## Epic 1: Fix the Foundation

### 1A — Fix Synthetic Data Field Gaps [COMPLETE]

*Completed in PR #4. Added oem, servicesAttached, quarterEnd, displacementDeal to Lambda deal objects. Regenerated sample_deals.json and sfdc_seed_data.json.*

### 1B — Persist Deal Outcomes to PostgreSQL [COMPLETE]

*Completed in PR #7 + #8. Created analytics.js with PostgreSQL persistence, 5-min cached reads, graceful fallback. Fixed Lambda fire-and-forget issue (PR #8 — must await insert before responding).*

### 1C — Add Time Decay to kNN Similarity [COMPLETE]

*Completed in PR #9 + #10. Added timeDecay() function with 5 decay tiers applied as multiplier in topKNeighbors(). Fixed missing closeDate in sample deals (PR #10).*

### 1D — Wire SFDC Won/Lost Deals Back to Lambda [COMPLETE]

*Completed in PR #12. Created MarginArcDealOutcomeSync batch (weekly Sunday 3 AM) that sends closed Won/Lost deals to Lambda POST /api/deals. Also fixed SFDC CI/CD pipeline (PRs #13-17): npm cache, npm ci→install, prettier, eslint, CronTrigger auto-abort/reschedule.*

```
Read these files to understand the current architecture:
- sfdc/force-app/main/default/classes/MarginArcBatchAnalyzer.cls (nightly batch that scores open deals)
- sfdc/force-app/main/default/classes/MarginArcController.cls (the main Apex controller)
- lambda/server/index.js (the POST /api/deals endpoint — NOT /api/deals/ingest)

Currently, when a deal closes in Salesforce (won or lost), the outcome is never sent back to Lambda. This means the kNN algorithm can never learn from real outcomes.

Create a mechanism to send closed deal outcomes to Lambda:

1. Create a new Apex class `MarginArcDealOutcomeSync.cls` that:
   - Implements Database.Batchable<SObject> and Database.AllowsCallouts
   - Queries recently closed Opportunities (Closed Won or Closed Lost in the last 7 days)
   - For each, builds a payload with: all the fields the kNN needs (see the buildPayload() method in MarginArcBatchAnalyzer for the field mapping), plus the outcome (won/lost), actual margin achieved (from Fulcrum_Planned_Margin__c or Fulcrum_GP_Percent__c), close date, and loss reason (Fulcrum_Loss_Reason__c)
   - POSTs to the POST /api/deals endpoint on Lambda (NOT /api/deals/ingest — that route doesn't exist)
   - The payload format must match what /api/deals expects: `{ input: {...all fields...}, achievedMarginPct: <number 0-100>, status: "Won"|"Lost", lossReason: "..." }`
   - Read the Zod `DealRecord` schema in lambda/server/index.js to see the exact required fields and their types/enums
   - Batch size: 10 (same as MarginArcBatchAnalyzer — respects callout governor limits)

2. Schedule it to run weekly (e.g., Sundays at 3 AM, after the license validator at 2 AM and before the nightly analyzer at 2 AM Mon-Sat). Add the scheduling to MarginArcInstallHandler.cls alongside the existing nightly analyzer scheduling.

3. Create a test class `MarginArcDealOutcomeSyncTest.cls` with:
   - Test with mock HTTP callout (use HttpCalloutMock interface)
   - Test with no closed deals (empty batch)
   - Test with mixed won/lost deals
   - Test with missing margin fields (should still send with derived values)

4. Important Apex notes from CLAUDE.md:
   - Math.exp() does NOT exist in Apex — use Math.pow(2.718281828459045, x) if needed
   - All custom field API names use Fulcrum_*__c prefix (see docs/sfdc-api-names.md)
   - Follow existing naming conventions: class name MarginArc*, test class MarginArc*Test

5. Add the new test class to the --tests list in .github/workflows/deploy-sfdc.yml (both dry-run and deploy steps).

6. IMPORTANT: Read the API_URL and API_Key from Fulcrum_Config__c custom setting (same pattern as MarginArcController.cls and MarginArcBatchAnalyzer.cls). Do NOT hardcode the URL.

Create a feature branch, commit, and push. Open a PR from the GitHub UI.
```

---

## Epic 2: Multi-Phase Algorithm

### 2A — Design Algorithm Phase System (depends on 1B) [COMPLETE]

```
Read these files to understand the current system:
- lambda/server/index.js — the /api/recommend route
- lambda/server/src/rules.js — the 22-rule margin engine
- lambda/server/src/knn.js — nearest neighbor matching (now includes timeDecay)
- lambda/server/src/quality-tiers.js — data quality scoring
- lambda/server/src/analytics.js — deal persistence layer (getAllDeals, getRecordedDeals)
- lambda/server/src/licensing/db.js — database connection and migrations

Design and implement a 3-phase algorithm system where each customer can be at a different phase:

**Phase 1 — "Score Only" (default for new customers):**
- Returns a deal score (0-100) and factor breakdown
- Does NOT return a recommended margin (suggestedMarginPct should be null)
- Uses rules.js to compute what the margin WOULD be, but only exposes it as a score
- Score formula: blend of data quality score (from quality-tiers.js) + algorithm confidence + factor alignment
- The UX message: "Score your deals to build your data foundation. Margin recommendations unlock at Phase 2."

**Phase 2 — "Score + Margin" (admin-enabled):**
- Returns deal score AND recommended margin (current behavior)
- Requires: minimum 50 real recorded deals in the database AND data quality avg > 60%
- The admin portal shows a "Ready for Phase 2" indicator when thresholds are met

**Phase 3 — "Score + Margin + BOM" (admin-enabled):**
- Returns everything from Phase 2 PLUS per-line BOM margin recommendations
- Requires: Phase 2 active AND minimum 20 deals with BOM data
- This phase enables the /api/bom/analyze endpoint

Implementation:

1. Add a `algorithm_phase` column to the `customer_config` table (integer, default 1). IMPORTANT: Use `ALTER TABLE customer_config ADD COLUMN IF NOT EXISTS algorithm_phase INTEGER DEFAULT 1` — do NOT use DROP TABLE, as customer_config has existing production data.

2. Create a new file lambda/server/src/phases.js that:
   - Exports `getCustomerPhase(orgId)` — reads from customer_config
   - Exports `checkPhaseReadiness(orgId)` — returns { currentPhase, phase2Ready: bool, phase2Requirements: {...}, phase3Ready: bool, phase3Requirements: {...} }
   - Exports `setCustomerPhase(orgId, phase)` — updates customer_config

3. Modify the /api/recommend route in index.js to:
   - Look up the customer's phase (from x-org-id header or a new parameter)
   - If Phase 1: compute everything internally but only return { dealScore, scoreFactors, dataQuality, phaseInfo: { current: 1, nextPhaseReady: bool, requirements: {...} } }
   - If Phase 2: return full recommendation (current behavior) plus dealScore
   - If Phase 3: return full recommendation plus BOM analysis (when implemented)

4. Add admin API endpoints in index.js:
   - GET /admin/api/customers/:id/phase — returns current phase + readiness
   - POST /admin/api/customers/:id/phase — sets the phase (with validation that requirements are met)

5. Add the deal score computation. The score should be 0-100 based on:
   - How aligned the rep's planned margin is with the recommendation (0-40 points)
   - Win probability (0-25 points)
   - Data quality / completeness (0-20 points)
   - Algorithm confidence (0-15 points)

6. Write tests for the phase system in lambda/server/__tests__/phases.test.js.

7. IMPORTANT: The /api/recommend handler is async. Any new DB queries must be awaited before res.json(). Do NOT use fire-and-forget patterns — Lambda kills them after responding.

8. Run all existing tests before committing: cd lambda/server && npm test

Create a feature branch, commit, and push. Open a PR from the GitHub UI.
```

### 2B — Add Phase-Aware UX to SFDC Margin Advisor (depends on 2A) [COMPLETE]

```
Read these files:
- sfdc/force-app/main/default/lwc/marginarcMarginAdvisor/marginarcMarginAdvisor.js
- sfdc/force-app/main/default/lwc/marginarcMarginAdvisor/marginarcMarginAdvisor.html
- sfdc/force-app/main/default/lwc/marginarcMarginAdvisor/marginarcMarginAdvisor.css

The Lambda /api/recommend endpoint now returns phase information in the response (see Epic 2A). Update the Margin Advisor LWC to handle all three phases:

**Phase 1 (Score Only):**
- Show the deal score (0-100) prominently with color coding (red/yellow/green)
- Show score factor breakdown (what's helping, what's hurting)
- Show data quality indicators
- Do NOT show recommended margin, win probability comparison, or "Apply Recommendation" button
- Show a callout: "You're building your data foundation. [X] more scored deals until margin recommendations unlock."
- Show the "Score My Deal" button (still works — just returns score instead of full recommendation)

**Phase 2 (Score + Margin):**
- Show everything from Phase 1 PLUS the full recommendation (current behavior)
- This is basically what the widget does today, plus the deal score at the top

**Phase 3 (Score + Margin + BOM):**
- Show everything from Phase 2 PLUS per-line BOM margin recommendations in the BOM summary section
- "Optimize BOM Margins" button that calls /api/bom/analyze

The phase is determined by the `phaseInfo` object in the API response. The LWC should NOT hardcode which phase the customer is on — it should always render based on what the API returns.

Important LWC notes from CLAUDE.md:
- LWC templates don't allow `!` unary expressions — use computed getters for negation (e.g., get isNotPhaseOne() { return this.phase !== 1; })
- Follow existing CSS class naming: marginarc-* prefix
- Follow existing component naming conventions

Create a feature branch, commit, and push. Open a PR from the GitHub UI.
```

### 2C — Add Phase Guidance to Setup Wizard (depends on 2A) [COMPLETE]

```
Read these files:
- sfdc/force-app/main/default/lwc/marginarcSetupWizard/marginarcSetupWizard.js
- sfdc/force-app/main/default/lwc/marginarcSetupWizard/marginarcSetupWizard.html
- sfdc/force-app/main/default/classes/MarginArcSetupController.cls

The setup wizard currently has a 5-step flow and an "Intelligence Maturity Level" (1-5). Enhance it to surface the algorithm phase system:

1. Add a new section to the setup wizard (after the existing steps) called "Algorithm Phases" that shows:
   - Current phase (1, 2, or 3) with a visual indicator
   - Requirements for the next phase with progress bars
   - A "Enable Phase X" button that becomes active when requirements are met
   - Clear explanation of what each phase unlocks

2. Add a new Apex method to MarginArcSetupController:
   - `getAlgorithmPhaseStatus()` — calls Lambda GET /admin/api/customers/:id/phase and returns the phase info
   - `enableAlgorithmPhase(Integer phase)` — calls Lambda POST /admin/api/customers/:id/phase and returns success/failure

3. The phase requirements (from Lambda) should be displayed as:
   - Phase 2: "50 scored deals needed (current: X)" with progress bar, "Data quality above 60% (current: X%)" with progress bar
   - Phase 3: "Phase 2 active", "20 deals with BOM data needed (current: X)" with progress bar

4. When the admin clicks "Enable Phase 2", show a confirmation modal explaining what changes for reps, then call the API.

Important: The customer/org ID for the API call should come from Fulcrum_License__c.Customer_ID__c custom setting. Read MarginArcLicenseActivator.cls to see how this is stored.

Important: Read the API_URL from Fulcrum_Config__c custom setting (same pattern as other controllers). Do NOT hardcode the Lambda URL.

Create a feature branch, commit, and push. Open a PR from the GitHub UI.
```

---

## Epic 3: BOM Line-Item Engine

### 3A — Implement BOM Catalog Search API (no dependencies) [COMPLETE]

```
Read these files:
- lambda/server/index.js — look for any existing /api/bom/* routes (there's a /api/bomcatalog GET route)
- lambda/server/src/data/bom_catalog.json — the current product catalog (~20 items)
- lambda/server/src/data/vendor_skus.json — vendor SKU database (10 OEMs x 6 categories x 4-5 roles = ~240 entries with real SKU numbers and list prices)
- lambda/server/src/bom.js — existing BOM generation logic, especially the lookupSku() function
- docs/lambda-api.md — shows /api/bom/search as "NOT YET IMPLEMENTED"

Implement the POST /api/bom/search endpoint:

1. Merge bom_catalog.json and vendor_skus.json into a unified searchable catalog. The vendor_skus.json data is richer (real SKU numbers, list prices per OEM/category/role). Build an in-memory index at cold start.

2. The endpoint should accept:
   {
     "query": "C9300",           // free-text search (matches partNumber, description, name)
     "manufacturer": "Cisco",    // optional filter
     "category": "Hardware",     // optional filter (Hardware, Software, Cloud, ProfessionalServices, ManagedServices, ComplexSolution)
     "limit": 20                 // default 20, max 100
   }

3. Return:
   {
     "results": [
       {
         "partNumber": "C9300-48P-A",
         "description": "Catalyst 9300 48-Port PoE+ Switch",
         "manufacturer": "Cisco",
         "category": "Hardware",
         "role": "core",
         "listPrice": 8795,
         "suggestedDiscount": 0.35,
         "typicalMarginRange": { "low": 8, "high": 18 }
       }
     ],
     "total": 45,
     "query": "C9300"
   }

4. Search should be fuzzy — use case-insensitive substring matching on partNumber, description, and name fields. If the query has multiple words, all words must match (AND logic).

5. Add the typicalMarginRange based on category:
   - Hardware: 8-18%
   - Software: 12-25%
   - Cloud: 10-20%
   - ProfessionalServices: 25-45%
   - ManagedServices: 20-35%
   - ComplexSolution: 15-30%

6. Require x-api-key authentication (same as /api/recommend).

7. Update docs/lambda-api.md to remove the "NOT YET IMPLEMENTED" note and document the real endpoint.

8. Write tests in lambda/server/__tests__/bom-search.test.js.

9. Run all existing tests before committing: cd lambda/server && npm test

Create a feature branch, commit, and push. Open a PR from the GitHub UI.
```

### 3B — Implement BOM Per-Line Margin Optimizer (depends on 3A) [COMPLETE]

```
Read these files:
- lambda/server/src/bom.js — existing BOM template generation and suggestBom() function
- lambda/server/src/rules.js — understand how the overall margin recommendation works
- lambda/server/src/metrics.js — price/GP calculations (markupToMarginSP, marginSPToMarkup)
- lambda/server/index.js — look for /api/bom/analyze route (currently not implemented)
- docs/lambda-api.md — shows /api/bom/analyze as "NOT YET IMPLEMENTED"

Implement the POST /api/bom/analyze endpoint that provides per-line margin optimization:

1. The endpoint accepts:
   {
     "bomLines": [
       { "partNumber": "C9300-48P-A", "manufacturer": "Cisco", "category": "Hardware", "quantity": 10, "unitCost": 5717, "marginPct": 12 },
       { "description": "Implementation Services", "category": "ProfessionalServices", "quantity": 80, "unitCost": 175, "marginPct": 30 }
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

2. The optimizer should:
   a. Compute category-level margin floors:
      - Hardware: 5% minimum
      - Software: 8% minimum
      - Cloud: 6% minimum
      - ProfessionalServices: 15% minimum
      - ManagedServices: 12% minimum
      - ComplexSolution: 10% minimum

   b. Compute category-level margin targets based on deal context (use rules from rules.js as guidance — competitive deals get tighter margins, high-value-add gets more margin room, services lines can absorb more margin when hardware is competitive)

   c. Solve for per-line margins that:
      - Meet or exceed each category floor
      - Achieve the target blended margin (weighted by extended cost)
      - Maximize margin on services/software lines (higher elasticity) while keeping hardware competitive
      - If the target blended margin is impossible with the floors, return the best achievable margin and flag it

3. Return:
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
       },
       {
         "index": 1,
         "description": "Implementation Services",
         "currentMarginPct": 30,
         "recommendedMarginPct": 35.2,
         "marginFloor": 15,
         "extendedCost": 14000,
         "extendedPrice": 21605,
         "grossProfit": 7605,
         "rationale": "Professional services — high value-add justifies premium"
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

4. Important: Use margin-on-selling-price convention throughout (see CLAUDE.md — the engine uses markupToMarginSP() converters). Do NOT use markup-based calculations.

5. Create the optimizer as a new file: lambda/server/src/bom-optimizer.js

6. Wire it into index.js as POST /api/bom/analyze with x-api-key authentication. The handler must be async. Await all operations before res.json().

7. Update docs/lambda-api.md to document the endpoint.

8. Write comprehensive tests in lambda/server/__tests__/bom-optimizer.test.js including edge cases: empty BOM, single line, impossible target, all-services BOM, all-hardware BOM.

9. Run all existing tests before committing: cd lambda/server && npm test

Create a feature branch, commit, and push. Open a PR from the GitHub UI.
```

### 3C — Expand Product Catalog to 200+ Items (no dependencies) [COMPLETE]

```
Read lambda/server/src/data/vendor_skus.json and lambda/server/src/data/bom_catalog.json to understand the current catalog structure.

The current catalog has ~240 vendor SKU entries (10 OEMs x 6 categories) but many are generic placeholders. Expand it to 200+ realistic, searchable products:

1. For each of the 10 OEMs (Cisco, Dell, HPE, Palo Alto, Fortinet, Microsoft, VMware, Aruba, Juniper, Pure Storage), add 15-25 real products across their actual product lines:

   - Cisco: Catalyst switches (9200, 9300, 9500), ISR routers (1100, 4000), Meraki (MR, MS, MX), Firepower/FTD, UCS servers, Webex, DNA licensing
   - Dell: PowerEdge servers (R660, R760), PowerStore, PowerScale, VxRail, OptiPlex, Latitude, Dell networking
   - HPE: ProLiant (DL360, DL380), Aruba switches (CX 6300, 6400), SimpliVity, Nimble, GreenLake
   - Palo Alto: PA-400, PA-800, PA-3200, PA-5200, Prisma Access, Cortex XDR, WildFire
   - Fortinet: FortiGate (60-3000 series), FortiSwitch, FortiAP, FortiManager, FortiAnalyzer, FortiSASE
   - Microsoft: M365 E3/E5, Azure Reserved Instances, Windows Server, SQL Server, Dynamics 365, Copilot
   - VMware: vSphere, vSAN, NSX, Horizon, Aria, Tanzu
   - Aruba: CX switches, AP series (500, 600), ClearPass, Central
   - Juniper: EX switches (2300, 4400), SRX firewalls, Mist AI, QFX
   - Pure Storage: FlashArray (//X, //C, //XL), FlashBlade, Evergreen//One, Portworx

2. Each product entry should have:
   - partNumber (realistic SKU format for that vendor)
   - description (actual product name)
   - manufacturer
   - category (Hardware, Software, Cloud, ProfessionalServices, ManagedServices)
   - role (core, accessory, support, license, service)
   - listPrice (realistic MSRP)
   - typicalDiscount (what VARs typically get: 25-45% on hardware, 15-30% on software)

3. Also add 20-30 generic services line items:
   - Implementation services (by complexity tier)
   - Project management
   - Migration services
   - Training
   - Managed services (NOC, SOC, help desk) — monthly pricing
   - Staff augmentation (by skill level)

4. Update vendor_skus.json with the expanded catalog. Keep the existing structure but add the new entries.

5. Make sure the data is valid JSON and no duplicate partNumbers exist within the same manufacturer.

6. Verify with: cd lambda/server && node -e "const d = JSON.parse(require('fs').readFileSync('src/data/vendor_skus.json','utf8')); console.log('Total SKUs:', d.length || Object.keys(d).length)"

Create a feature branch, commit, and push. Open a PR from the GitHub UI.
```

---

## Epic 4: Synthetic Data Generator v2

### 4A — Configurable POC Scenarios (depends on 1A) [COMPLETE]

```
Read lambda/server/src/data/generateSyntheticDeals.js to understand the current synthetic data generator. It creates 7,000 deals with realistic distributions.

Add configurable POC scenario presets that generate tailored demo data for different VAR profiles. This is critical for sales demos — we need to show prospects data that looks like their business.

1. Create a new file lambda/server/src/data/scenarios.js that exports scenario configurations:

   - "networking-var": Heavy Cisco/Aruba/Juniper mix, 60% hardware, mid-market focus, 3-4 competitors typical, avg deal $75K
   - "security-var": Palo Alto/Fortinet dominant, 40% software + 30% services, enterprise-leaning, 2-3 competitors, avg deal $120K
   - "cloud-var": Microsoft/VMware heavy, 50% cloud/software, SMB-heavy, 1-2 competitors, avg deal $45K
   - "full-stack-var": Even OEM distribution, balanced categories, all segments, 2-3 competitors, avg deal $90K (the default)
   - "services-heavy-var": Any OEM, 50% professional/managed services attached, enterprise focus, avg deal $150K

2. Each scenario should configure:
   - OEM weight distribution (which OEMs appear and how often)
   - Product category mix (hardware/software/cloud/services percentages)
   - Customer segment distribution (SMB/MidMarket/Enterprise percentages)
   - Average deal size and standard deviation
   - Typical competitor count
   - Win rate baseline
   - Average margin range
   - BOM complexity (avg lines per deal)

3. Modify generateSyntheticDeals.js to accept a scenario parameter:
   - node src/data/generateSyntheticDeals.js --scenario=networking-var --deals=500
   - Default (no args): current behavior (7,000 full-stack deals)
   - The scenario adjusts all the distribution parameters but keeps the same realistic generation logic (customer lifecycle, seasonal patterns, margin compression trend, etc.)

4. Generate and save a sample file for each scenario:
   - lambda/server/src/data/scenarios/networking-var.json
   - lambda/server/src/data/scenarios/security-var.json
   - etc.
   - Keep sample_deals.json as the default full dataset

5. Add a --output flag to write to a specific file path.

6. IMPORTANT: Every generated deal must include `closeDate` in the lambdaDeal object (it was missing before PR #10 and broke time decay). Verify all scenario outputs include closeDate.

Create a feature branch, commit, and push. Open a PR from the GitHub UI.
```

### 4B — Full BOM History for All Synthetic Deals (depends on 1A, 3C) [COMPLETE]

```
Read lambda/server/src/data/generateSyntheticDeals.js — specifically the BOM generation section (search for "bom" in the file). Currently, only deals from 2024+ get BOM line items. Older deals have no line-item history.

Expand BOM generation to all deals:

1. Generate realistic BOM lines for ALL 7,000 deals, not just 2024+. Use the expanded vendor_skus.json catalog (from Epic 3C) for product selection.

2. BOM complexity should vary by deal characteristics:
   - Small deals (<$50K): 2-4 lines
   - Medium deals ($50K-$200K): 4-8 lines
   - Large deals ($200K-$500K): 6-12 lines
   - Enterprise deals (>$500K): 8-20 lines

3. BOM composition should match the deal's OEM and product category:
   - A Cisco Hardware deal should have Cisco switches/routers as core lines + services
   - A Palo Alto Security deal should have firewalls + subscriptions + implementation
   - A Microsoft Cloud deal should have M365 licenses + Azure + migration services

4. Per-line margins should be realistic:
   - Hardware: 8-18% (lower for competitive deals)
   - Software/Licensing: 12-25%
   - Cloud subscriptions: 10-20%
   - Professional services: 25-45%
   - Managed services: 20-35%

5. The BOM total cost should align with the deal's OEM cost (oemCost field), and the BOM total price should align with the deal amount.

6. Store BOM lines in each deal object as a `bomLines` array with fields: description, category, quantity, unitCost, unitPrice, marginPct, vendor, productNumber, sortOrder.

7. Regenerate sample_deals.json with the full BOM data. IMPORTANT: Verify closeDate is still present in all deals after regeneration.

8. Run all existing tests: cd lambda/server && npm test

Create a feature branch, commit, and push. Open a PR from the GitHub UI.
```

### 4C — One-Click POC Data Loading in Setup Wizard (depends on 4A) [COMPLETE — PR #34, PR #35 prettier fix]

```
Read these files:
- sfdc/force-app/main/default/classes/MarginArcDemoDataLoader.cls
- sfdc/force-app/main/default/classes/MarginArcDemoDataService.cls
- sfdc/force-app/main/default/classes/MarginArcDemoDataQueueable.cls
- sfdc/force-app/main/default/lwc/marginarcSetupWizard/marginarcSetupWizard.js (look for the demo data step)

The setup wizard already has a "Load Demo Data" step. Enhance it to support scenario selection:

1. Add a scenario picker to the demo data step in the setup wizard. Show 5 cards, one per scenario (networking-var, security-var, cloud-var, full-stack-var, services-heavy-var) with:
   - Scenario name and icon
   - Brief description ("Cisco/Aruba heavy, mid-market, avg $75K deals")
   - Deal count selector (100, 250, 500)

2. Modify MarginArcDemoDataLoader.loadDemoData() to accept a scenario parameter. It should call Lambda to get scenario-specific demo data:
   - Add a new Lambda endpoint: GET /api/demo-data?scenario=networking-var&count=250
   - Lambda returns the pre-generated scenario data (from lambda/server/src/data/scenarios/*.json), sliced to the requested count

3. The existing MarginArcDemoDataQueueable chain should handle the actual SFDC record creation (Accounts, Opportunities, BOM Lines, Recommendation History). Make sure it creates BOM lines for each deal (using the bomLines array from the scenario data).

4. Add a "Clear Demo Data" button that deletes all demo-created records (use a Demo_Data__c flag or naming convention to identify them).

5. After loading, show a summary: "Loaded 250 opportunities across 45 accounts with 1,200 BOM lines."

Important: The queueable chain exists because Salesforce has governor limits on DML operations. Don't try to insert everything in one transaction — use the existing chained queueable pattern.

Important: Read the API_URL from Fulcrum_Config__c custom setting. Do NOT hardcode the Lambda URL.

Create a feature branch, commit, and push. Open a PR from the GitHub UI.
```

---

## Epic 4.5: UX Polish & Demo Readiness

### 4D — Fix Demo-Blocking UI Bugs (depends on 2A, 2B) [COMPLETE — PR #40]

```
Read these files:
- sfdc/force-app/main/default/lwc/marginarcMarginAdvisor/marginarcMarginAdvisor.js
- sfdc/force-app/main/default/lwc/marginarcMarginAdvisor/marginarcMarginAdvisor.html
- sfdc/force-app/main/default/lwc/marginarcManagerDashboard/marginarcManagerDashboard.js
- sfdc/force-app/main/default/lwc/marginarcManagerDashboard/marginarcManagerDashboard.html
- sfdc/force-app/main/default/lwc/marginarcBackfillReport/marginarcBackfillReport.js (if it exists)
- sfdc/force-app/main/default/lwc/marginarcBackfillReport/marginarcBackfillReport.html (if it exists)
- sfdc/force-app/main/default/lwc/marginarcDealInsights/marginarcDealInsights.js
- sfdc/force-app/main/default/lwc/marginarcDealInsights/marginarcDealInsights.html

These bugs were found by taking Playwright screenshots of the live SFDC org. Fix ALL of them:

1. **Phase 1 progress message is misleading.** After clicking "Score My Deal", the Phase 1 message says "0 more scored deals until margin recommendations unlock." This reads as "you need zero more deals" (i.e., you're already done). Fix the message to clearly communicate how many deals are NEEDED vs how many have been scored. Example: "You've scored X deals. Score Y more to unlock margin recommendations (50 required)." The deal count comes from the API response's phaseInfo object.

2. **Remove version badges from all components.** The "v4.1" badge on Margin Advisor and "v4.0" badge on Industry Intelligence are developer artifacts. Customers should not see internal version numbers. Remove all visible version number badges/labels from:
   - marginarcMarginAdvisor
   - marginarcDealInsights (Industry Intelligence)
   - marginarcManagerDashboard
   - Any other component that shows a version number

3. **Fix "Does Following MarginArc Work?" showing 0.0% Avg Margin.** In the Manager Dashboard, the "MarginArc-Aligned vs Off-target" comparison section shows "0.0%" for Avg Margin on both sides. The win rate split works (100% vs 0%) but margin shows 0.0% for both. Investigate the margin calculation — it likely needs to read from `achievedMargin` or `Fulcrum_Recommended_Margin__c` on closed deals. If the field is null/missing in the data, show "N/A" instead of "0.0%".

4. **Fix "100% Alignment" header KPI contradiction.** The dashboard header shows "100% Alignment" but the warning banner says "184 deals with margin >3pp below recommendation." These can't both be true. Investigate the Alignment calculation — it may be computing against the wrong field or filtering incorrectly. The alignment metric should be: "% of deals where the rep's planned margin is within 3pp of the MarginArc recommendation."

5. **Score factor pills need denominators.** After clicking "Score My Deal", the score factors show "+35 Margin aligned with recommendation" and "+18 Strong win probability" — but the rep doesn't know these are out of 40 and 25 respectively. Change to show the denominator: "+35/40 Margin alignment", "+18/25 Win probability", etc. The max values come from the API response's scoreFactors object (each factor has a `score` and `max` field).

6. **ROI Report tab is broken.** The Fulcrum_ROI_Report tab (which links to marginarcBackfillReport component) shows "Page doesn't exist." Either the component doesn't exist, wasn't deployed, or has an error. Investigate and fix. If the component is a stub/placeholder, create a minimal version that shows a "Coming Soon" message with the MarginArc branding rather than a Salesforce error page.

7. **Data quality column has no variance.** Every deal in the Pipeline Health table shows "EXCELLENT" quality. This means the quality scoring has no signal — if everything is excellent, the column is useless. Check how quality grades are computed (likely from predictionQuality in the API response) and verify that the synthetic data produces a realistic distribution. If the issue is that all synthetic deals have all fields populated (so quality is always high), consider adjusting the threshold or adding a field-completeness component to the grade.

Run prettier and eslint before committing:
  cd sfdc && npx prettier --write force-app/main/default/lwc/marginarcMarginAdvisor/**/*.{js,html}
  cd sfdc && npx prettier --write force-app/main/default/lwc/marginarcManagerDashboard/**/*.{js,html}
  cd sfdc && npx prettier --write force-app/main/default/lwc/marginarcDealInsights/**/*.{js,html}
  cd sfdc && npx prettier --write force-app/main/default/lwc/marginarcBackfillReport/**/*.{js,html}
  cd sfdc && npx eslint force-app/main/default/lwc/marginarc*/**/*.js

Add any new test classes to .github/workflows/deploy-sfdc.yml (both dry-run and deploy steps).

Create a feature branch, commit, and push. Open a PR from the GitHub UI.
```

---

## Epic 5: API & Polish

### 5A — Split Lambda into Engine + Mothership (depends on 1B, 2A) [DEFERRED — not needed yet]

> **Deprioritized**: Premature microservice split. The monolith Lambda works fine and splitting adds
> complexity for zero user-facing value. Revisit when on-prem deployment is actually needed.

<details>
<summary>Original prompt (click to expand)</summary>

```
Read lambda/server/index.js thoroughly. The current Lambda function serves everything:
- /api/recommend, /api/bomcatalog, /api/bom/* — the scoring engine
- /api/v1/license/*, /api/v1/telemetry — the licensing mothership
- /admin/* — the admin portal SPA
- /oauth/* — Salesforce OAuth
- /docs/* — documentation portal

For on-prem deployment, customers need to self-host the scoring engine but NOT the licensing/admin infrastructure. Split the codebase:

1. Create a new file lambda/server/engine.js that:
   - Contains ONLY the scoring engine routes: /api/recommend, /api/bom/*, /api/bomcatalog, /api/deals, /api/sampledeals, /api/industries
   - Has its own Express app and Lambda handler
   - Loads deal data from local files OR a customer-provided PostgreSQL connection
   - Authenticates via API key (same x-api-key pattern)
   - Does NOT require SSM parameters for licensing — only for DB connection (optional)
   - Works fully offline (no phone-home to api.marginarc.com)

2. Keep index.js as the "full" version that includes everything (engine + licensing + admin). This is what runs at api.marginarc.com.

3. Create a new file lambda/server/engine-config.js that defines the engine's configuration:
   - API_KEY (required)
   - DB_HOST, DB_USER, DB_PASSWORD, DB_NAME (optional — if not set, uses in-memory sample data only)
   - DATA_DIR (optional — path to custom sample_deals.json)
   - LOG_LEVEL (optional)

4. The engine should be deployable as:
   - A standalone Lambda function (engine.js as handler)
   - A Docker container (add a Dockerfile)
   - A plain Node.js process (node engine.js)

5. Create lambda/Dockerfile:
   ```
   FROM node:18-slim
   WORKDIR /app
   COPY server/ .
   RUN npm install --production
   EXPOSE 3000
   CMD ["node", "engine.js"]
   ```

6. Create lambda/docker-compose.yml for local development:
   - Engine service (port 3000)
   - PostgreSQL service (port 5432)
   - Volume mounts for data/ directory

7. Update docs/deployment.md with the on-prem deployment options.

8. IMPORTANT: The deal recording endpoint is POST /api/deals (not /api/deals/ingest). Make sure engine.js uses the same route name. The handler must be async and await the DB insert before responding (Lambda freeze issue).

9. Run all existing tests before committing: cd lambda/server && npm test

Create a feature branch, commit, and push. Open a PR from the GitHub UI.
```
</details>

### 5B — Create OpenAPI Spec for Engine API (depends on 3A, 3B) [COMPLETE — PR #37]

```
Read these files to understand all API endpoints:
- lambda/server/index.js — all route definitions
- docs/lambda-api.md — current API documentation

Create a formal OpenAPI 3.0 specification for the MarginArc Engine API:

1. Create lambda/server/openapi.yaml covering these endpoints:
   - POST /api/recommend — full request/response schema with all input fields, response fields, and examples
   - POST /api/bom/search — catalog search with query/filter parameters
   - POST /api/bom/analyze — BOM optimization with per-line response
   - POST /api/deals — deal outcome recording (note: achievedMarginPct is a percentage 0-100, not a decimal)
   - GET /api/bomcatalog — full catalog retrieval
   - GET /api/industries — industry list

2. Include:
   - Authentication scheme (API key via x-api-key header)
   - All request body schemas with field descriptions, types, enums, and required flags
   - All response schemas
   - Error response schemas (400, 401, 500)
   - Example requests and responses for each endpoint
   - The exact enum values for customerIndustry (see the /api/industries endpoint for the valid list)

3. Add a /docs/api route in index.js that serves Swagger UI (use swagger-ui-express) pointing to the openapi.yaml file. This gives customers interactive API documentation.

4. Update docs/lambda-api.md to reference the OpenAPI spec as the canonical API documentation.

5. Run all existing tests before committing: cd lambda/server && npm test

Create a feature branch, commit, and push. Open a PR from the GitHub UI.
```

---

## Epic 6: Future-Proofing for MarginArc Network

### 6A — Design Network Data Schema (no code changes needed yet) [COMPLETE — PR #39]

```
This is a DESIGN task, not an implementation task. Create a design document, not code.

Read these files to understand the current data model:
- lambda/server/src/knn.js — what deal fields the similarity function uses (including timeDecay on closeDate)
- lambda/server/src/analytics.js — how deals are persisted and retrieved from PostgreSQL
- lambda/server/src/data/generateSyntheticDeals.js — what fields exist on a deal
- lambda/server/src/licensing/db.js — current database schema and migration patterns

The website at marginarc.com describes a "MarginArc Network" concept: anonymized deal data pooled across non-competing VARs via federated learning with differential privacy.

Create a design document at docs/network-design.md that covers:

1. **Anonymized Deal Schema**: What fields from a deal can be safely shared across VARs? Design a schema that strips all PII (customer names, account names, rep names, amounts) but preserves the signals useful for margin intelligence:
   - OEM vendor (keep)
   - Product category (keep)
   - Customer segment (keep — SMB/MidMarket/Enterprise, not the actual company)
   - Deal size band (e.g., "$50K-$100K" instead of exact amount)
   - Competitor count (keep)
   - Deal registration type (keep)
   - Win/loss outcome (keep)
   - Achieved margin band (e.g., "15-20%" instead of exact)
   - Industry vertical (keep)
   - Region (new — add to deal schema: Northeast, Southeast, Midwest, West, International)

2. **Competitor Firewalling**: How to prevent VAR A from seeing data that identifies VAR B's pricing against them. Design a hashed exclusion system where each VAR declares their identity, and the network filters out deals where they were the competitor.

3. **Data Contribution Tiers**: Design 3 tiers:
   - Observer (receives network priors, contributes nothing) — free but limited accuracy boost
   - Contributor (receives + contributes) — full accuracy boost
   - Premium Contributor (high-volume contributor) — priority model updates

4. **Integration Points**: How would network data flow into the existing kNN system? Propose adding a 3rd data source to `getAllDeals()` in analytics.js: local sample data + recorded customer deals + network deals. Network deals would have a lower similarity weight (e.g., 0.6x multiplier) since they're from different VARs. Consider how this interacts with timeDecay().

5. **Database Schema**: Design the tables needed:
   - network_deals (anonymized deal records from all contributing VARs)
   - network_participants (VAR identity, contribution tier, excluded competitors)
   - network_sync_log (last sync timestamps per participant)

6. **Privacy Guarantees**: Describe what differential privacy mechanisms would be applied (noise injection on margin values, k-anonymity on deal characteristics, minimum cohort sizes before sharing).

This is a documentation/design task only. Do not write any code. The output should be a thorough markdown document that a team could use to implement the network in a future sprint.

Create a feature branch, commit, and push. Open a PR from the GitHub UI.
```

---
---

# Post-Review Sprints (Sprint 24–27)

> **Source**: 5-perspective executive review conducted 2026-02-17 (`docs/executive-review-2026-02-17.md`).
> Reviewers: CEO (7/10), CTO (7.5/10), CISO (6.5/10), Head of UX (6.6/10), VAR CRO (MAYBE→YES).
> These sprints systematically address all P0–P2 issues and the CTO/CISO risk registers.

### Concurrency Map (Sprints 24–27)

| Prompt | Modifies | Safe to run with |
|--------|----------|-----------------|
| **7A** | `lambda/server/src/licensing/db.js`, `lambda/server/index.js`, `lambda/server/package.json`, `lambda/server/src/gemini.js` | Any SFDC prompt (7B, 7C) |
| **7B** | `sfdc/.../marginarcBackfillReport/*`, possibly `sfdc/.../tabs/*` | Any Lambda prompt (7A, 7D) |
| **7C** | SFDC org data only (Apex anonymous scripts + API calls) — no file changes | **Everything** |
| **7D** | `lambda/server/index.js` (Zod schemas), `lambda/server/openapi.yaml` | Any SFDC prompt (7B, 7C) |
| **8A** | `sfdc/.../marginarcMarginAdvisor/*`, `sfdc/.../marginarcDealInsights/*` | Any Lambda prompt (8C, 8D) |
| **8B** | `sfdc/.../marginarcManagerDashboard/*` | 8C, 8D (Lambda only) |
| **8C** | `lambda/server/src/licensing/admin.js`, `lambda/server/src/licensing/auth.js` | Any SFDC prompt (8A, 8B) |
| **8D** | `lambda/server/src/analytics.js`, `lambda/server/src/phases.js`, `lambda/server/index.js` | Any SFDC prompt |
| **9A** | `lambda/server/__tests__/rules.test.js` (new), `lambda/server/__tests__/winprob.test.js` (new) | Almost anything |
| **9B** | `.github/workflows/deploy-lambda.yml` | Almost anything |
| **9C** | `sfdc/.../marginarcMarginAdvisor/*` | Any Lambda prompt, 9D |
| **9D** | `sfdc/.../marginarcBomBuilder/*`, `sfdc/.../marginarcBomTable/*`, `sfdc/.../marginarcManagerDashboard/*` | Any Lambda prompt |
| **10A** | `lambda/server/index.js`, `lambda/server/src/licensing/admin.js` | Any SFDC prompt |
| **10B** | `lambda/server/src/licensing/admin.js`, `lambda/server/src/licensing/auth.js`, `lambda/server/src/licensing/db.js` | Any SFDC prompt |
| **10C** | `docs/` only | **Everything** |
| **10D** | `docs/` only | **Everything** |

---

## Epic 7: P0 Fixes — Sprint 24 (This Week)

### 7A — DB SSL + Security Headers + Gemini Key to SSM (CISO CRITICAL-1 & CRITICAL-2) [COMPLETE — PR #44]

```
Read these files:
- lambda/server/src/licensing/db.js — the PostgreSQL connection pool configuration (lines 50-63 have no `ssl` property)
- lambda/server/index.js — the Express app setup (no helmet middleware present)
- lambda/server/src/gemini.js — Gemini API key loaded from process.env instead of SSM
- lambda/server/package.json — current dependencies

The CISO security review flagged two CRITICAL items that must be fixed immediately:

**CRITICAL-1: No SSL on PostgreSQL connection**

The database connection in db.js lines 50-63 has no `ssl` config. All DB traffic (licenses, tokens, deals) is potentially unencrypted between Lambda and RDS.

Fix:
1. Add `ssl: { rejectUnauthorized: true }` to the dbConfig object in the `loadDBConfig()` function.
2. If the RDS instance uses Amazon's RDS CA bundle, you may need `ssl: { rejectUnauthorized: false }` initially (many RDS instances use Amazon root CA which Node.js trusts). Start with `ssl: { rejectUnauthorized: true }` and fall back to `ssl: true` only if connection fails. Add a comment explaining why.

**CRITICAL-2: No security headers**

The Express app has zero security headers. The admin portal at `/admin` has no clickjacking/XSS protection.

Fix:
1. Install `helmet`: add it to package.json dependencies
2. Import and use helmet middleware BEFORE any route handlers in index.js (after the CORS setup, before routes):
   ```javascript
   import helmet from 'helmet'
   app.use(helmet({
     contentSecurityPolicy: {
       directives: {
         defaultSrc: ["'self'"],
         scriptSrc: ["'self'", "'unsafe-inline'"],  // needed for admin SPA
         styleSrc: ["'self'", "'unsafe-inline'"],    // needed for admin SPA
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
   ```
3. IMPORTANT: The admin SPA, docs SPA, and public landing page all use inline scripts/styles. The CSP must allow `'unsafe-inline'` for script-src and style-src to avoid breaking them. Test by verifying the admin portal, docs portal, and public site all still load after adding helmet.
4. The Swagger UI at `/docs/api-reference` also uses inline scripts — make sure it still works.

**Also fix: Move Gemini API key to SSM**

The CTO review noted that `gemini.js` line 1 reads `GEMINI_API_KEY` from `process.env` instead of SSM like other secrets.

1. Read lambda/server/src/gemini.js
2. Change it to load the key from SSM parameter `/marginarc/gemini/api-key` using the same pattern as db.js (lazy-loaded, cached)
3. IMPORTANT: Keep the `process.env.GEMINI_API_KEY` as a fallback for local development:
   ```javascript
   const GEMINI_API_KEY = process.env.GEMINI_API_KEY || await getSSMParameter('/marginarc/gemini/api-key');
   ```
4. The SSM parameter already exists — this was set up when Gemini was first integrated. The Lambda function has IAM permission to read it.

Run all tests: cd lambda/server && npm test

Create a feature branch, commit, and push. Open a PR from the GitHub UI.
```

### 7B — Fix ROI Report Tab (P0 — Every Reviewer Flagged) [COMPLETE — PR #43]

```
Read these files:
- sfdc/force-app/main/default/lwc/marginarcBackfillReport/marginarcBackfillReport.js
- sfdc/force-app/main/default/lwc/marginarcBackfillReport/marginarcBackfillReport.html
- sfdc/force-app/main/default/lwc/marginarcBackfillReport/marginarcBackfillReport.css
- sfdc/force-app/main/default/lwc/marginarcBackfillReport/marginarcBackfillReport.js-meta.xml
- sfdc/force-app/main/default/tabs/ — look for any tab referencing this component or "ROI"

Every reviewer flagged that the ROI Report tab shows "Page doesn't exist" in Salesforce. This is the #1 credibility killer — a broken tab in a paid product destroys trust immediately.

Investigate and fix:

1. Check if the tab definition file exists at `sfdc/force-app/main/default/tabs/Fulcrum_ROI_Report.tab-meta.xml` (or similar). If it references a component by the old name (`fulcrumBackfillReport`), update it to `marginarcBackfillReport`.

2. If no tab file exists in the repo, create one at `sfdc/force-app/main/default/tabs/Fulcrum_ROI_Report.tab-meta.xml`:
   ```xml
   <?xml version="1.0" encoding="UTF-8"?>
   <CustomTab xmlns="http://soap.sforce.com/2006/04/metadata">
       <label>ROI Report</label>
       <lwcComponent>marginarcBackfillReport</lwcComponent>
       <motif>Custom57: Handsaw</motif>
   </CustomTab>
   ```

3. Verify the component itself works by checking:
   - Does the .js controller have valid Apex imports? Check that all `@wire` and imperative Apex calls reference `MarginArc*` class names (not `Fulcrum*`).
   - Does the .html template render without errors? Check for any undefined variables or missing getter methods.
   - Is the component exposed for the right targets in the .js-meta.xml? It should include `lightning__Tab`.

4. If the component has substantive bugs that prevent rendering, fix them. If it's a stub that was never fully built, implement a minimal working version:
   - Show a "Backfill Analysis" header with MarginArc branding (match the navy gradient style from other components)
   - Display a summary of the most recent backfill run (if data exists) or a "Run Backfill Analysis" CTA if no data
   - The backfill data comes from MarginArcBackfillAnalyzer.cls — read that class to understand what data is available
   - At minimum, show: total deals analyzed, total GP opportunity identified, average margin gap, and a table of top 10 deals with the biggest margin gap

5. Run prettier and eslint:
   cd sfdc && npx prettier --write force-app/main/default/lwc/marginarcBackfillReport/**/*.{js,html}
   cd sfdc && npx eslint force-app/main/default/lwc/marginarcBackfillReport/**/*.js

Create a feature branch, commit, and push. Open a PR from the GitHub UI.
```

### 7C — Promote Demo Org to Phase 2 + Pre-Load OEM/Competitor Data (P0) [COMPLETE — Org Config]

```
This is an ORG CONFIGURATION task, not a code task. You are running Apex anonymous scripts and API calls against the live Salesforce org and Lambda API.

Read these files to understand the current state:
- lambda/server/src/phases.js — how phases work (Phase 2 requires >=50 recorded deals + avg quality >60)
- lambda/server/index.js — the admin API endpoints for phase management (GET/POST /admin/api/customers/:id/phase)
- sfdc/force-app/main/default/classes/MarginArcSetupController.cls — OEM and Competitor configuration

The demo org has 361 deals loaded but is stuck in Phase 1, meaning reps see deal scores but NO margin recommendations. Every reviewer flagged this as a demo blocker.

**Step 1: Check current phase status**

Call the Lambda admin API to see the current phase:
```bash
# First, get an admin JWT token
TOKEN=$(curl -s -X POST https://api.marginarc.com/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"MarginArc2026!"}' | jq -r '.token')

# Check phase readiness for the demo org
curl -s https://api.marginarc.com/admin/api/customers/1/phase \
  -H "Authorization: Bearer $TOKEN" | jq .
```

**Step 2: Record enough deals to meet Phase 2 requirements**

If the phase readiness check shows fewer than 50 recorded deals, we need to backfill. Run this against the Lambda API to record synthetic deals:

```bash
# Record 60 synthetic deals to meet the 50-deal threshold
for i in $(seq 1 60); do
  curl -s -X POST https://api.marginarc.com/api/deals \
    -H "Content-Type: application/json" \
    -H "x-api-key: marginarc-key-2025" \
    -d "{
      \"input\": {
        \"oem\": \"Cisco\",
        \"oemCost\": $((50000 + RANDOM % 200000)),
        \"customerSegment\": \"MidMarket\",
        \"productCategory\": \"Hardware\",
        \"relationshipStrength\": \"Good\",
        \"customerTechSophistication\": \"Medium\",
        \"dealRegType\": \"StandardApproved\",
        \"competitors\": \"1\",
        \"valueAdd\": \"Medium\",
        \"solutionComplexity\": \"Medium\",
        \"varStrategicImportance\": \"Medium\",
        \"customerIndustry\": \"Technology\"
      },
      \"achievedMarginPct\": $((12 + RANDOM % 15)),
      \"status\": \"Won\"
    }" > /dev/null
done
```

Vary the OEMs (Cisco, Dell, HPE, Palo Alto, Fortinet), segments (SMB, MidMarket, Enterprise), and industries across the 60 deals for realistic distribution.

**Step 3: Promote to Phase 2**

```bash
curl -s -X POST https://api.marginarc.com/admin/api/customers/1/phase \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"phase": 2}' | jq .
```

**Step 4: Pre-load OEM Vendor and Competitor records**

Run Apex anonymous scripts to populate the OEM Vendors and Competitors sections in the Setup tab. IMPORTANT: Before running, check the actual field API names by reading the object directories under `sfdc/force-app/main/default/objects/Fulcrum_OEM_Vendor__c/` and `sfdc/force-app/main/default/objects/Fulcrum_Competitor__c/`. Adjust field names below if they differ.

Create 7 OEM Vendor records (Cisco, Dell, HPE, Palo Alto, Fortinet, Microsoft, VMware) with realistic base margins, deal reg boosts, quarter-end discounts, and services boosts.

Create 5 Competitor records (CDW, SHI, Presidio, Optiv, Insight) with price aggression, margin aggression, typical discount, services capability, primary OEMs, and primary strength.

**Step 5: Verify with Playwright headless browser**

Take screenshots of:
1. An Opportunity page — verify "Score My Deal" now returns a recommended margin (not just a score)
2. The Setup tab — verify OEM Vendors and Competitors sections are populated
3. The Dashboard tab — verify pipeline data shows margin recommendations

No code changes needed — this is all org configuration. No branch/PR required.
```

### 7D — Make API Fields Optional with Defaults (P1 #5) [COMPLETE — PR #45]

```
Read lambda/server/index.js — specifically the Zod schemas starting around line 289.

The CEO and CTO reviews flagged that the API is too strict for direct integration. The DealInput Zod schema requires several fields that a lightweight integration (webhook, form submission, or minimal REST client) might not have:

Currently REQUIRED (should be OPTIONAL with defaults):
- customerTechSophistication (line 295) — required enum, should default to "Medium"
- varStrategicImportance (line 300) — required enum, should default to "Medium"
- solutionComplexity (line 299) — required enum, should default to "Medium"
- valueAdd (line 298) — required enum, should default to "Medium"
- relationshipStrength (line 294) — required enum, should default to "Good"
- dealRegType (line 296) — required enum, should default to "NotRegistered"
- competitors (line 297) — required enum, should default to "1"

Fix:
1. Change each of these fields from `.enum([...])` to `.enum([...]).optional().default("Medium")` (or appropriate default):
   - customerTechSophistication → default "Medium"
   - varStrategicImportance → default "Medium"
   - solutionComplexity → default "Medium"
   - valueAdd → default "Medium"
   - relationshipStrength → default "Good"
   - dealRegType → default "NotRegistered"
   - competitors → default "1"

2. Keep these fields REQUIRED (they are core to the recommendation and cannot be defaulted meaningfully):
   - oem (already optional)
   - oemCost (must know the cost)
   - productCategory (core to margin calculation)
   - customerSegment (core to base margin)
   - customerIndustry (core to industry adjustment)

3. Update the OpenAPI spec at lambda/server/openapi.yaml:
   - Mark the newly-optional fields as `required: false` in the schema
   - Add `default: "Medium"` (or appropriate default) to each
   - Update the example requests to show a minimal payload with only the 5 required fields

4. Test with a minimal payload that only sends the required fields:
   ```bash
   curl -X POST https://api.marginarc.com/api/recommend \
     -H "Content-Type: application/json" \
     -H "x-api-key: marginarc-key-2025" \
     -d '{"input":{"oemCost":100000,"productCategory":"Hardware","customerSegment":"MidMarket","customerIndustry":"Technology"},"plannedMarginPct":15}'
   ```
   This should return a valid recommendation, not a Zod validation error.

5. Run all tests: cd lambda/server && npm test

Create a feature branch, commit, and push. Open a PR from the GitHub UI.
```

---

## Epic 8: POC Readiness — Sprint 25

### 8A — Fix Phase Counter + Industry Intelligence Contradictions (P1 #6, #9)

```
Read these files:
- sfdc/force-app/main/default/lwc/marginarcMarginAdvisor/marginarcMarginAdvisor.js
- sfdc/force-app/main/default/lwc/marginarcMarginAdvisor/marginarcMarginAdvisor.html
- sfdc/force-app/main/default/lwc/marginarcDealInsights/marginarcDealInsights.js
- sfdc/force-app/main/default/lwc/marginarcDealInsights/marginarcDealInsights.html

Two P1 issues from the executive review:

**Issue 1: Phase callout message is contradictory (P1 #6)**

After clicking "Score My Deal", the Phase 1 message shows "You've scored 0 deals. Score 0 more to unlock margin recommendations (50 required)." This was partially addressed in PR #40 but still shows stale data.

Fix:
1. The deal count in the phase callout should update in real-time after scoring. When the `/api/recommend` response comes back, the `phaseInfo` object contains the current scored deal count and the threshold. Use these values to update the message.
2. If the user JUST scored a deal, optimistically increment the local counter by 1 (the API response may not reflect the deal that was just scored since recording happens async).
3. Change the message format to be unambiguous:
   - "You've scored X of 50 deals needed to unlock margin recommendations." (single clear sentence)
   - Show a small progress bar or fraction (e.g., "12/50") below the message
4. If the counter shows 50+ but phase is still 1, show: "Data threshold met! Ask your admin to enable Phase 2 in Setup."

**Issue 2: Industry Intelligence shows contradictory data (P1 #9)**

The Industry Intelligence component (marginarcDealInsights) shows "43 Accounts Analyzed" but "0 Total Deals". These numbers contradict each other — you can't have 43 accounts with 0 deals.

Fix:
1. Read the component's data source — it likely calls an Apex method that queries Opportunity records and aggregates by account/industry.
2. The "0 Total Deals" is probably reading from a field that is null/empty for the demo data. Find the getter that computes `totalDeals` and fix it.
3. If the data is coming from the API, check what the response returns and ensure the component handles missing/zero values gracefully.
4. If both metrics cannot be populated from available data, hide the one that shows 0 rather than displaying contradictory numbers.

Run prettier and eslint:
  cd sfdc && npx prettier --write force-app/main/default/lwc/marginarcMarginAdvisor/**/*.{js,html}
  cd sfdc && npx prettier --write force-app/main/default/lwc/marginarcDealInsights/**/*.{js,html}
  cd sfdc && npx eslint force-app/main/default/lwc/marginarcMarginAdvisor/**/*.js
  cd sfdc && npx eslint force-app/main/default/lwc/marginarcDealInsights/**/*.js

Create a feature branch, commit, and push. Open a PR from the GitHub UI.
```

### 8B — Dashboard KPI Tooltips + Pipeline Search (P1 #7, P2 #12)

```
Read these files:
- sfdc/force-app/main/default/lwc/marginarcManagerDashboard/marginarcManagerDashboard.js
- sfdc/force-app/main/default/lwc/marginarcManagerDashboard/marginarcManagerDashboard.html
- sfdc/force-app/main/default/lwc/marginarcManagerDashboard/marginarcManagerDashboard.css

Two issues from the executive review:

**Issue 1: Dashboard KPIs lack tooltips (P1 #7)**

The KPI strip shows 5 metrics: Total Pipeline, MarginArc Value, Win Rate, Alignment, Data Quality. The last three are proprietary metrics with no explanation. New users have no idea what "Alignment" or "Data Quality" mean.

Fix:
1. Add an info icon (ⓘ) next to each KPI label that shows a tooltip on hover/click. Use SLDS `lightning-helptext` component or a custom tooltip.
2. Tooltip content:
   - **Total Pipeline**: "Sum of Amount across all open opportunities in your pipeline."
   - **MarginArc Value**: "Additional gross profit your team would capture if every deal followed MarginArc's margin recommendations. Calculated as the sum of (Recommended Margin - Planned Margin) x Deal Amount across all open deals."
   - **Win Rate**: "Percentage of deals closed as Won in the last 90 days."
   - **Alignment**: "Percentage of open deals where the rep's planned margin is within 3 percentage points of MarginArc's recommendation. Higher alignment = more margin-disciplined team."
   - **Data Quality**: "Average prediction readiness score (0-100) across all open deals. Measures how many deal attributes are filled in — more data means more accurate recommendations."
3. Style the tooltip consistently with the dark navy theme.

**Issue 2: Pipeline table needs search (P2 #12)**

361 deals across 15 pages with no text search. A manager looking for a specific deal or account must paginate through everything.

Fix:
1. Add a search input above the pipeline table (between the filter pills and the table header).
2. Search should filter by: deal name, account name, and rep name (case-insensitive substring match).
3. The search should work client-side against the already-loaded pipeline data (no additional API calls needed).
4. Show a "Showing X of Y deals" counter that updates as the user types.
5. The search should compose with the existing filter pills — e.g., searching "Cisco" while the "Critical" pill is active shows only critical Cisco deals.
6. Add a clear button (X) to reset the search.
7. Debounce the search input by 300ms to avoid excessive re-renders.

Run prettier and eslint:
  cd sfdc && npx prettier --write force-app/main/default/lwc/marginarcManagerDashboard/**/*.{js,html}
  cd sfdc && npx eslint force-app/main/default/lwc/marginarcManagerDashboard/**/*.js

Create a feature branch, commit, and push. Open a PR from the GitHub UI.
```

### 8C — Password Policy Upgrade + Admin Security (CISO P1 #8)

```
Read these files:
- lambda/server/src/licensing/admin.js — search for password validation logic (around line 1264 for the 6-char minimum)
- lambda/server/src/licensing/auth.js — search for token expiry setting (around line 144)

The CISO review flagged a weak admin password policy (6-character minimum) and several admin auth improvements.

Fix:

1. **Upgrade password policy** in admin.js:
   - Minimum 12 characters (was 6)
   - Must contain at least: 1 uppercase, 1 lowercase, 1 digit, 1 special character
   - Add a validation function:
     ```javascript
     function validatePasswordStrength(password) {
       if (password.length < 12) return 'Password must be at least 12 characters';
       if (!/[A-Z]/.test(password)) return 'Password must contain an uppercase letter';
       if (!/[a-z]/.test(password)) return 'Password must contain a lowercase letter';
       if (!/[0-9]/.test(password)) return 'Password must contain a digit';
       if (!/[^A-Za-z0-9]/.test(password)) return 'Password must contain a special character';
       return null; // valid
     }
     ```
   - Apply this validation to: create admin user, update admin password, and any password reset flow

2. **Reduce JWT token expiry** from 4 hours to 1 hour:
   - In lambda/server/src/licensing/auth.js, find the token expiry setting and change to `expiresIn: '1h'`
   - The admin SPA should already handle token expiry by redirecting to login — verify this works

3. **Log failed authentication attempts**:
   - In the `/auth/login` route handler in admin.js, add explicit logging for failed logins:
     ```javascript
     console.warn(JSON.stringify({
       event: 'auth_failure',
       username: req.body.username,
       ip: req.ip,
       userAgent: req.headers['user-agent'],
       timestamp: new Date().toISOString()
     }));
     ```
   - This enables CloudWatch alerting on brute-force patterns

4. **Remove or deprecate the SSM fallback login** if it exists. The admin.js code may have a fallback path that accepts a shared SSM password — this should be removed or clearly marked as deprecated with a TODO.

5. Run all tests: cd lambda/server && npm test

Create a feature branch, commit, and push. Open a PR from the GitHub UI.
```

### 8D — Add org_id to recorded_deals for Multi-Tenant Isolation (CTO HIGH Risk)

```
Read these files:
- lambda/server/src/analytics.js — the deal persistence layer (getAllDeals, getRecordedDeals, insertRecordedDeal, ensureDealsSchema)
- lambda/server/src/phases.js — phase readiness checks that query recorded_deals
- lambda/server/index.js — the /api/recommend and /api/deals route handlers (look for how x-org-id header is used)

The CTO review flagged this as the HIGHEST severity architectural risk: `recorded_deals` has no customer/org identifier. All customers' deal data is mixed together. This means:
- Customer A's proprietary deal data influences Customer B's recommendations
- Phase readiness is computed across ALL customers' deals (semantically wrong)
- No way to delete a single customer's data (right to erasure / data sovereignty)

Fix:

1. **Add org_id column to recorded_deals**:
   In analytics.js's `ensureDealsSchema()` function, add:
   ```sql
   ALTER TABLE recorded_deals ADD COLUMN IF NOT EXISTS org_id TEXT DEFAULT 'global';
   CREATE INDEX IF NOT EXISTS idx_recorded_deals_org_id ON recorded_deals(org_id);
   ```
   Use `ALTER TABLE ADD COLUMN IF NOT EXISTS` — do NOT drop and recreate the table (it has production data).

2. **Update insertRecordedDeal()** to accept and store org_id:
   - Add `orgId` parameter
   - Include it in the INSERT statement
   - Default to 'global' if not provided (backwards compatibility)

3. **Update the /api/deals route handler** in index.js to pass the `x-org-id` header to `insertRecordedDeal()`.

4. **Update getRecordedDeals()** and **getAllDeals()** in analytics.js:
   - Add optional `orgId` parameter
   - If provided, filter: `WHERE org_id = $1`
   - If not provided, return all deals (backwards compatible for analytics/admin)

5. **Update phase readiness checks** in phases.js:
   - `checkPhaseReadiness()` should count deals for the SPECIFIC org, not globally
   - Change the query to include `WHERE org_id = $1`
   - Pass the orgId through from the API request

6. **Update the /api/recommend route** in index.js:
   - Pass orgId to `getAllDeals()` so that kNN only considers the customer's own deals + sample data (not other customers' deals)
   - The `x-org-id` header is already read from the request — thread it through

7. **Invalidate the deals cache** per-org:
   - The current cache in analytics.js is global. Change it to a Map keyed by orgId: `const cache = new Map()` with entries like `cache.get(orgId)`
   - Keep a 'global' cache entry for admin/analytics queries that don't filter by org

8. IMPORTANT: All schema changes must use `ALTER TABLE ADD COLUMN IF NOT EXISTS` — NOT `DROP TABLE`. The table has real data.

9. Run all tests: cd lambda/server && npm test
   Some tests may need updating if they rely on the global deal pool behavior.

Create a feature branch, commit, and push. Open a PR from the GitHub UI.
```

---

## Epic 9: Testing + UX Polish — Sprint 26

### 9A — Rules Engine + Win Probability Test Suite (CTO Risk #3)

```
Read these files:
- lambda/server/src/rules.js — the 22-rule margin recommendation engine (319 lines, ZERO tests)
- lambda/server/src/winprob.js — the win probability model (53 lines, ZERO tests)
- lambda/server/__tests__/knn.test.js — example of existing test patterns (Jest)
- lambda/server/__tests__/bom-optimizer.test.js — example of comprehensive test coverage

The CTO review identified this as the #3 technical risk: the rules engine is the core IP of the product and has no test coverage. Any regression — a sign flip, a miscalculated clamp — would silently produce bad recommendations.

Create two test files:

**1. lambda/server/__tests__/rules.test.js**

Test `computeRecommendation()` (the main export) and `ruleBasedRecommendation()`:

a. **Base margin by segment**: Verify that Enterprise base is ~14%, MidMarket ~17%, SMB ~20% (from the rule logic at lines 68-71).

b. **Deal registration boost**: Verify PremiumHunting adds ~6pp, StandardApproved adds ~3pp, NotRegistered adds 0 (lines 79-84).

c. **Competition pressure**: Verify 0 competitors is neutral, 1 adds mild pressure, 2 adds more, 3+ adds ~-3.5pp (lines 86-96).

d. **Industry adjustments**: Verify Financial Services gets a positive adjustment, Retail gets negative (INDUSTRY_MARGIN_ADJ map at lines 13-24).

e. **OEM adjustments**: Verify Palo Alto gets +1.5pp, Microsoft gets -1pp (OEM_MARGIN_ADJ map at lines 27-38).

f. **Policy floor enforcement**: Verify that the output never goes below 0.5% for critical competitive Enterprise deals and 3% for everything else (policyFloorFor at lines 4-8).

g. **kNN blending formula**: Test with mock kNN data — verify that alpha increases with neighbor count (alpha = clamp(0.25 + count/40, 0.25, 0.6)) and that confidence reflects rules/kNN agreement.

h. **Full integration**: Test computeRecommendation() with a complete deal object and verify the response shape includes suggestedMarginPct, confidence, explanation fields, and score components.

i. **Edge cases**: Empty/null inputs, all-defaults, extreme values, unknown OEMs, unknown industries.

**2. lambda/server/__tests__/winprob.test.js**

Test `estimateWinProb()`:

a. **Competition base rates**: 0 competitors → ~68%, 1 → ~58%, 2 → ~43%, 3+ → ~32% (line 5).

b. **Deal registration impact**: PremiumHunting adds +12pp, StandardApproved adds +6pp (lines 8-9).

c. **Relationship strength**: Strategic adds +6pp, Good adds +3pp, New subtracts -3pp (lines 15-17).

d. **Margin-based logistic curve**: Verify that higher margins reduce win probability (knee at 18%, slope 0.08, lines 44-48). Test: 10% margin → high WP, 18% margin → medium WP, 30% margin → low WP.

e. **Clamping**: Verify output is always between 5% and 95% (line 48).

f. **Competitor profiles**: Verify that aggressive competitors (priceAggression > 3) reduce WP and passive competitors increase it (lines 37-41).

g. **Combined effects**: Test a "best case" deal (no competitors, PremiumHunting, Strategic relationship, high value-add, low margin) and a "worst case" deal — verify reasonable spread.

Run all tests: cd lambda/server && npm test
Verify all new tests pass alongside existing 138 tests.

Create a feature branch, commit, and push. Open a PR from the GitHub UI.
```

### 9B — Add npm test to Lambda CI Pipeline (CTO Gap)

```
Read .github/workflows/deploy-lambda.yml — the current Lambda CI/CD pipeline.

The CTO review identified that the Lambda pipeline does NOT run `npm test` before deploying. 138 tests pass locally but are never executed in CI — a broken test would not block deployment.

Fix:

1. Add a test step AFTER dependency installation but BEFORE creating the deployment zip:

   ```yaml
   - name: Install all dependencies (including dev)
     working-directory: lambda/server
     run: npm install

   - name: Run tests
     working-directory: lambda/server
     run: npm test

   - name: Install production dependencies only
     working-directory: lambda/server
     run: npm install --production
   ```

   Note: Tests require dev dependencies (jest, sinon, etc.), so we need `npm install` (full) for the test step, then `npm install --production` before zipping to keep the deployment package small.

2. The existing pipeline has `npm install --production` at line 32. Change it to this 3-step flow:
   - `npm install` (full, for testing)
   - `npm test` (run tests)
   - `npm install --production` (strip dev deps for deployment)

3. Alternatively, if reinstalling is too slow, you can run tests with full deps and then prune:
   ```yaml
   - name: Install dependencies
     working-directory: lambda/server
     run: npm install

   - name: Run tests
     working-directory: lambda/server
     run: npm test

   - name: Prune dev dependencies
     working-directory: lambda/server
     run: npm prune --production
   ```

4. Make sure the test step fails the pipeline if any test fails (Jest exits with code 1 on failure — this is the default behavior, no extra config needed).

Create a feature branch, commit, and push. Open a PR from the GitHub UI.
```

### 9C — Progressive Disclosure on Opportunity Page (UX P1 #3)

```
Read these files:
- sfdc/force-app/main/default/lwc/marginarcMarginAdvisor/marginarcMarginAdvisor.js
- sfdc/force-app/main/default/lwc/marginarcMarginAdvisor/marginarcMarginAdvisor.html
- sfdc/force-app/main/default/lwc/marginarcMarginAdvisor/marginarcMarginAdvisor.css

The UX review scored cognitive load at 6/10 and flagged that the Margin Advisor widget tries to do too much in one card. After scoring, it contains 10+ distinct sections creating extensive vertical scroll on the Opportunity page.

Implement progressive disclosure:

1. **Collapsed scored state** (what the rep sees after scoring):
   - Deal Score circle (the big number + spectrum bar) — KEEP visible
   - Recommended margin and "Apply Recommendation" button — KEEP visible
   - One-line summary: "Score: 92/100 | Rec: 18.5% margin | Confidence: High" — ADD this
   - "Show Details" toggle button — ADD this

2. **Expanded state** (clicking "Show Details"):
   - Score factor pills breakdown
   - Data quality indicators
   - AI-generated explanation
   - Plan vs Recommendation comparison table
   - Key drivers section
   - Recommendation history

3. **Implementation**:
   - Add a `isDetailExpanded` tracked boolean property, default to `false`
   - Add a `toggleDetails()` handler
   - Wrap the detail sections in a `template:if={isDetailExpanded}` block
   - Animate the expand/collapse with CSS transition (max-height + opacity)
   - Remember: LWC templates don't allow `!` unary expressions — use `get isDetailCollapsed() { return !this.isDetailExpanded; }`

4. **The summary line** in collapsed state should use the compact format:
   ```html
   <div class="marginarc-score-summary">
     <span class="summary-score">Score: {dealScore}/100</span>
     <span class="summary-divider">|</span>
     <span class="summary-margin">Rec: {recommendedMargin}%</span>
     <span class="summary-divider">|</span>
     <span class="summary-confidence">{confidenceLabel}</span>
   </div>
   ```

5. Keep the "Score My Deal" button and the initial unscored state unchanged — progressive disclosure only applies AFTER scoring.

6. The BOM Builder and Industry Intelligence components below should remain separate — this change only affects the Margin Advisor card height.

Run prettier and eslint:
  cd sfdc && npx prettier --write force-app/main/default/lwc/marginarcMarginAdvisor/**/*.{js,html}
  cd sfdc && npx eslint force-app/main/default/lwc/marginarcMarginAdvisor/**/*.js

Create a feature branch, commit, and push. Open a PR from the GitHub UI.
```

### 9D — BOM Builder Responsive Fix + Accessibility (UX P2 #13, P3 #14)

```
Read these files:
- sfdc/force-app/main/default/lwc/marginarcBomBuilder/ — all files
- sfdc/force-app/main/default/lwc/marginarcBomTable/ — all files (if separate component)
- sfdc/force-app/main/default/lwc/marginarcManagerDashboard/marginarcManagerDashboard.html
- sfdc/force-app/main/default/lwc/marginarcManagerDashboard/marginarcManagerDashboard.js

Two UX issues:

**Issue 1: BOM Builder not responsive below 1024px (P2 #13)**

The BOM table has 9 columns with no responsive breakpoint. On tablets and narrow laptops, it's unusable.

Fix:
1. Add a horizontal scroll wrapper around the BOM table:
   ```css
   .bom-table-wrapper {
     overflow-x: auto;
     -webkit-overflow-scrolling: touch;
   }
   ```
2. Add a `@media (max-width: 1024px)` breakpoint that:
   - Hides the least critical columns (productNumber, vendor, note) on small screens
   - Reduces column padding
   - Uses smaller font size for numeric cells
3. Add a `@media (max-width: 768px)` breakpoint that converts to a card-based layout:
   - Each BOM line becomes a stacked card
   - Shows: description, category, quantity, unit cost, margin%, extended price
   - Hides: product number, vendor, sortOrder

**Issue 2: Accessibility gaps (P3 #14)**

The UX review found several accessibility issues across components:

Fix in marginarcManagerDashboard:
1. **Section headers** use `onclick` but lack keyboard support:
   - Add `role="button"` and `tabindex="0"` to all collapsible section header divs
   - Add `onkeydown={handleSectionKeydown}` handler that triggers toggle on Enter/Space:
     ```javascript
     handleSectionKeydown(event) {
       if (event.key === 'Enter' || event.key === ' ') {
         event.preventDefault();
         this.toggleSection(event);
       }
     }
     ```
   - Add `aria-expanded={isSectionExpanded}` to each header

2. **Filter pills** in the pipeline section need `aria-pressed`:
   - Add `aria-pressed={isActive}` to each filter pill button where isActive is true for the currently selected filter

3. **Sort column headers** need proper ARIA:
   - Change sort header divs to use `role="columnheader"`
   - Add `aria-sort="ascending"` or `aria-sort="descending"` based on current sort state
   - Add `tabindex="0"` and keyboard handler

Fix in marginarcBomBuilder/marginarcBomTable:
4. **Table role attributes**: Ensure the BOM table has `role="grid"` with proper `role="row"` and `role="gridcell"` on all rows/cells.

Run prettier and eslint on all modified files.

Create a feature branch, commit, and push. Open a PR from the GitHub UI.
```

---

## Epic 10: Enterprise Readiness — Sprint 27

### 10A — API Key Rotation Mechanism (CISO/CTO P2 #11)

```
Read these files:
- lambda/server/index.js — the API key check (around line 263-271, single `MARGINARC_API_KEY` comparison)
- lambda/server/src/licensing/auth.js — the JWT dual-key rotation pattern (lines 42-62 show how JWT supports two simultaneous secrets)
- lambda/server/src/licensing/routes.js — the license validation endpoint

The CISO and CTO both flagged: single shared API key with no rotation mechanism. Changing the key requires simultaneous Lambda + SFDC org updates = downtime risk.

Implement dual-key API rotation (same pattern as JWT secrets):

1. **Lambda side** — Support two simultaneous API keys:
   - Load two SSM parameters: `/marginarc/api/key-primary` and `/marginarc/api/key-secondary`
   - Accept requests if the provided key matches EITHER key
   - Use constant-time comparison (`crypto.timingSafeEqual`) instead of `!==` to prevent timing attacks
   - Cache both keys with a 5-minute TTL (re-read from SSM periodically to pick up rotations without redeploying)

2. **Admin API** — Add key rotation endpoints:
   - `POST /admin/api/rotate-api-key` — Generates a new key, stores it as the secondary key in SSM, returns the new key. The old primary key remains valid.
   - `POST /admin/api/promote-api-key` — Promotes the secondary key to primary, clears the old primary. Now only the new key works.
   - Both require `super_admin` role.

3. **Rotation flow** (documented in response):
   - Step 1: Admin calls rotate-api-key → gets new key
   - Step 2: Admin updates SFDC org's Fulcrum_Config__c.API_Key__c with the new key
   - Step 3: Admin verifies SFDC can reach Lambda with new key
   - Step 4: Admin calls promote-api-key → old key stops working
   - Zero-downtime: both keys work simultaneously between steps 1-4

4. **Per-customer API keys** (stretch goal — only implement if time allows):
   - Add an `api_key` column to the `customers` table
   - During license activation, generate a unique API key per customer
   - The SFDC org receives its unique key in the activation response
   - The Lambda API key check becomes: match against global key OR any customer's key
   - This enables per-customer key revocation

5. Update the OpenAPI spec (openapi.yaml) to document the rotation endpoints.

6. Run all tests: cd lambda/server && npm test

Create a feature branch, commit, and push. Open a PR from the GitHub UI.
```

### 10B — MFA on Admin Portal (CISO P1, SOC 2 Requirement)

```
Read these files:
- lambda/server/src/licensing/admin.js — admin auth routes (login, create user, password management)
- lambda/server/src/licensing/auth.js — JWT token generation and verification
- lambda/server/src/licensing/db.js — database schema and migrations

The CISO review flagged MFA as a SOC 2 blocker. Implement TOTP-based MFA for the admin portal.

1. **Database changes** in db.js:
   - Add to admin_users table: `ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS mfa_secret TEXT, ADD COLUMN IF NOT EXISTS mfa_enabled BOOLEAN DEFAULT FALSE`
   - Do NOT use DROP TABLE — existing admin users have data

2. **Install dependency**: Add `otpauth` to package.json for TOTP generation/verification.

3. **MFA setup flow** — new admin endpoints:
   - `POST /admin/api/mfa/setup` — Generates a TOTP secret, returns the secret + provisioning URI (for Google Authenticator / Authy). Stores the secret (encrypted) on the admin user record. Does NOT enable MFA yet.
   - `POST /admin/api/mfa/verify` — Takes a TOTP code, verifies it against the stored secret. If valid, sets `mfa_enabled = true` on the admin user. This confirms the user successfully configured their authenticator app.
   - `POST /admin/api/mfa/disable` — Requires super_admin role. Disables MFA for a specific admin user (emergency recovery).

4. **Login flow change**:
   - If `mfa_enabled = false`: current behavior (username/password → JWT token)
   - If `mfa_enabled = true`:
     - Step 1: username/password → returns `{ mfa_required: true, mfa_token: "<short-lived-token>" }` (the mfa_token is a JWT with 5-minute expiry and `mfa_pending: true` claim)
     - Step 2: Client sends `{ mfa_token, totp_code }` to `POST /admin/api/mfa/authenticate` → if valid, returns the full admin JWT token
   - The `requireAuth` middleware should reject tokens with `mfa_pending: true` for all routes except `/admin/api/mfa/authenticate`

5. **Enforce MFA for new admin users**:
   - When creating a new admin user, generate and return the MFA setup link
   - Add a flag: after a configurable date (or after first customer onboard), MFA becomes required for all admin users

6. **Admin SPA changes**: The admin React SPA will need a new MFA verification screen. If modifying the admin SPA is out of scope for this prompt, at minimum ensure the API endpoints work correctly and document the flow. The SPA update can be a separate prompt.

7. Run all tests: cd lambda/server && npm test

Create a feature branch, commit, and push. Open a PR from the GitHub UI.
```

### 10C — SOC 2 Documentation Prep (CISO Compliance Roadmap)

```
This is a DOCUMENTATION task, not a code task. Create two documents.

Read these files for context:
- docs/executive-review-2026-02-17.md — the CISO compliance roadmap section
- docs/network-design.md — privacy guarantees section
- lambda/server/src/licensing/db.js — data storage patterns
- lambda/server/src/licensing/auth.js — authentication patterns

**Document 1: docs/data-processing-agreement.md**

Create a DPA template covering:
1. **Data processed**: What data MarginArc processes from the customer's Salesforce org:
   - Opportunity fields: OEM vendor, cost, segment, product category, margin, stage, amount
   - Account fields: name, industry (used for display only, not stored permanently)
   - User fields: owner name (for dashboard display only)
   - What is NOT sent: customer PII, contact records, email addresses, phone numbers
2. **Data storage**: Where data is stored (AWS us-east-1, RDS PostgreSQL, encrypted at rest via AWS KMS)
3. **Data retention**: How long deal data is retained (proposal: 36 months, configurable per customer)
4. **Data deletion**: Process for deleting a customer's data on contract termination
5. **Sub-processors**: AWS (hosting), Google Cloud (Gemini AI explanations — deal context sent, not customer names)
6. **Security measures**: Summarize the security controls (SSM secrets, bcrypt, JWT rotation, FLS enforcement, parameterized SQL, rate limiting, HTTPS/TLS)
7. **Breach notification**: 72-hour notification commitment (GDPR standard)
8. **Network data sharing** (if applicable): Reference the network-design.md privacy guarantees

**Document 2: docs/security-overview.md**

Create a security overview document suitable for sharing with prospects' InfoSec teams during procurement:
1. **Architecture**: Two-tier (SFDC package + AWS Lambda), no data leaves Salesforce except anonymized deal attributes for scoring
2. **Authentication**: SFDC native auth (no separate login), admin portal uses bcrypt + JWT + MFA
3. **Authorization**: SFDC FLS/CRUD enforcement, with-sharing, permission sets (Admin/Manager/User)
4. **Encryption**: In transit (TLS 1.2+), at rest (AWS KMS for RDS, AES-256-GCM for OAuth tokens)
5. **Data handling**: What data is sent to the API, what is stored, what is ephemeral
6. **Compliance**: SOC 2 Type I in progress, DPA available, GDPR-ready
7. **Network security**: VPC, security groups, no public DB access
8. **Monitoring**: CloudWatch logging, admin audit trail, rate limiting
9. **Vulnerability management**: Dependency scanning, CI/CD gating

These are markdown documents — not code. Keep the tone professional and factual (not marketing).

Create a feature branch, commit, and push. Open a PR from the GitHub UI.
```

### 10D — Design Partner Onboarding Package

```
This is a DOCUMENTATION task. Create a playbook for onboarding the first 3-5 design partners.

Read these files for context:
- docs/executive-review-2026-02-17.md — CRO section on POC success criteria and pricing guidance
- sfdc/force-app/main/default/classes/MarginArcInstallHandler.cls — what happens on package install
- sfdc/force-app/main/default/classes/MarginArcDemoDataLoader.cls — demo data loading
- sfdc/force-app/main/default/lwc/marginarcSetupWizard/ — the setup wizard

Create docs/onboarding-guide.md:

1. **Pre-onboarding checklist** (what the MarginArc team does before the customer call):
   - Create customer record in admin portal
   - Generate license key
   - Prepare scenario data matching the customer's VAR profile

2. **Day 1: Install + Configure (1 hour call)**:
   - Install the unlocked package
   - Assign permission sets (Fulcrum_Admin, Fulcrum_User, Fulcrum_Manager)
   - Activate license
   - Run connection test
   - Load demo data (pick the matching VAR scenario)

3. **Day 1-3: Data Quality Assessment**:
   - Run the Data Quality check in the Setup Wizard
   - Identify missing fields
   - Create data cleanup plan
   - Run Historical Backfill analysis

4. **Week 1: Rep Enablement**:
   - Training: "How to Score Your Deal"
   - Target: 50 scored deals in 7 days to unlock Phase 2
   - Daily adoption monitoring via dashboard

5. **Week 2: Phase 2 Activation**:
   - Enable Phase 2 via admin portal
   - Configure OEM Vendors and Competitors with customer-specific data
   - Updated rep training on margin recommendations

6. **Week 3-4: Measure + Report**:
   - Dashboard review with sales leadership
   - Alignment metric baseline
   - GP Upside calculation
   - Cohort analysis (aligned vs off-target)
   - Collect rep testimonials

7. **Day 30: POC Decision Meeting**:
   - Present CRO success criteria results
   - Present pricing proposal ($25-75/user/month)
   - Decision: expand or exit

Keep it practical and actionable — this is the playbook the MarginArc team will use repeatedly.

Create a feature branch, commit, and push. Open a PR from the GitHub UI.
```
