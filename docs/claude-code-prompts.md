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

### 8A — Fix Phase Counter + Industry Intelligence Contradictions (P1 #6, #9) [COMPLETE — PR #48]

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

### 8B — Dashboard KPI Tooltips + Pipeline Search (P1 #7, P2 #12) [COMPLETE — PR #47]

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

### 8C — Password Policy Upgrade + Admin Security (CISO P1 #8) [COMPLETE — PR #52]

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

### 8D — Add org_id to recorded_deals for Multi-Tenant Isolation (CTO HIGH Risk) [COMPLETE — PR #51]

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

### 9A — Rules Engine + Win Probability Test Suite (CTO Risk #3) [COMPLETE — PR #50]

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

### 9B — Add npm test to Lambda CI Pipeline (CTO Gap) [COMPLETE — PR #54]

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

### 9C — Progressive Disclosure on Opportunity Page (UX P1 #3) [COMPLETE — PR #60]

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

### 9D — BOM Builder Responsive Fix + Accessibility (UX P2 #13, P3 #14) [COMPLETE — PR #61]

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

### 10A — API Key Rotation Mechanism (CISO/CTO P2 #11) [COMPLETE — PR #56]

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

### 10B — MFA on Admin Portal (CISO P1, SOC 2 Requirement) [COMPLETE — PR #62]

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

### 10C — SOC 2 Documentation Prep (CISO Compliance Roadmap) [COMPLETE — PR #57]

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

### 10D — Design Partner Onboarding Package [COMPLETE — PR #59]

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

---

## Epic 11: Founder UX Fixes — Sprint 28 (Critical Path to POC)

Context: The founder tested the live product and identified 6 UX/product issues. All 5 evaluator agents (VP Product, CTO, Sales Rep, VP Sales, CFO) reviewed the issues and unanimously agreed on priority order. These fixes are required before putting MarginArc in front of design partner reps.

Key finding: The client-side `computeDealScore()` in the LWC and the server-side version in `phases.js` use **completely different formulas** (5 factors at 35/25/20/10/10 vs 4 factors at 40/25/20/15). The server must become the single source of truth.

### Concurrency Map — Epic 11

| Prompt | Modifies | Safe to run with |
|--------|----------|-----------------|
| **11A** | `marginarcMarginAdvisor/*` (SFDC), `MarginArcController.cls` | 11B (Lambda-only) |
| **11B** | `index.js`, `phases.js`, `rules.js` (Lambda) | 11A (SFDC-only) |
| **11C** | `index.js` (Lambda) + `marginarcMarginAdvisor/*` (SFDC) | Nothing — depends on 11A + 11B |
| **11D** | `marginarcMarginAdvisor/*` (SFDC) | Nothing — depends on 11C |
| **11E** | `marginarcMarginAdvisor/*` (SFDC) | Nothing — depends on 11D |

**Execution order:** 11A + 11B in parallel → 11C → 11D → 11E

### 11A — Fix Segment Detection + Auto-Score on Page Load (Founder Issues #5, #1)

```
Read these files:
- sfdc/force-app/main/default/lwc/marginarcMarginAdvisor/marginarcMarginAdvisor.js
- sfdc/force-app/main/default/lwc/marginarcMarginAdvisor/marginarcMarginAdvisor.html
- sfdc/force-app/main/default/classes/MarginArcController.cls

Two critical fixes. The segment fix is a trust-destroying bug; the auto-score is the #1 adoption blocker.

**Fix 1: Segment detection uses deal amount instead of account size (CRITICAL)**

Regeneron is a $12B pharma company but shows as "SMB" because the $56K deal falls below the $100K threshold. The fallback logic at line ~215 of the JS derives segment from `Amount` when `Fulcrum_Customer_Segment__c` is empty.

Fix:
1. Add `Account.AnnualRevenue` and `Account.NumberOfEmployees` to the `OPPORTUNITY_FIELDS` array at the top of the JS file. Use the relationship field syntax: `"Opportunity.Account.AnnualRevenue"` and `"Opportunity.Account.NumberOfEmployees"`.
2. Change the segment derivation in `mapOpportunityData()` to use a cascading fallback:
   - First: explicit `Fulcrum_Customer_Segment__c` field (existing behavior)
   - Second: Account.AnnualRevenue — if >= $1B → Enterprise, >= $100M → Enterprise, >= $10M → MidMarket, < $10M → SMB
   - Third (last resort): deal Amount — keep existing thresholds as final fallback
3. Also fix the DIVERGED thresholds: the LWC uses $300K for Enterprise while MarginArcController.cls `mapSegmentFromAmount()` uses $500K. Align both to $500K.
4. When segment is INFERRED (not from the explicit field), add a visual indicator. Set a tracked property `isSegmentInferred = true` and render a small "(estimated)" label next to the segment badge in the HTML. This tells the rep the data came from a guess and encourages them to fill in the field.

**Fix 2: Auto-score on page load (HIGHEST PRIORITY from all 5 reviewers)**

Currently reps must click "Score My Deal" to trigger scoring. All 5 reviewers agree this kills adoption — the CFO estimates it's the difference between 30% and 90% deal coverage, a 3x ROI impact.

Fix:
1. In the `wiredOpportunity()` handler (the `@wire(getRecord)` callback), after `opportunityData` is populated and `recordId` exists, automatically call `fetchRecommendation()`.
2. Add a guard property `_hasAutoScored = false` to prevent double-firing (the wire adapter may fire multiple times). Set it to `true` after the first auto-score. Reset it when the recordId changes.
3. Remove the "Score My Deal" landing card entirely. Replace the initial state with the loading spinner state — the user should see "Analyzing your deal..." within 200ms of page load.
4. Keep the "Refresh" button for manual re-scoring after field changes.
5. IMPORTANT: The `@wire` adapter fires asynchronously and may fire with incomplete data first. Only auto-score when ALL required fields in `OPPORTUNITY_FIELDS` have been received (check that `opportunityData` is not null/undefined and `recordId` is truthy).
6. Handle the failure case: if the API call fails during auto-score, show the degraded state (mock recommendation) silently — do NOT show an error toast on page load. Only show error toasts on manual Refresh clicks.

Run prettier and eslint:
  cd sfdc && npx prettier --write force-app/main/default/lwc/marginarcMarginAdvisor/**/*.{js,html}
  cd sfdc && npx prettier --write force-app/main/default/classes/MarginArcController.cls
  cd sfdc && npx eslint force-app/main/default/lwc/marginarcMarginAdvisor/**/*.js

Create a feature branch, commit, and push. Open a PR from the GitHub UI.
```

### 11B — Unify Deal Scoring + Natural Language Factor Labels (Founder Issues #3, server-side)

```
Read these files:
- lambda/server/src/phases.js — server-side `computeDealScore()` at line ~170
- lambda/server/index.js — the /api/recommend endpoint response shape
- lambda/server/src/rules.js — the rule-based recommendation that produces drivers

Two issues found by the CTO and VP Product agents independently:

**Issue 1: Client-side and server-side deal scoring are completely diverged**

The server-side `computeDealScore()` in phases.js uses 4 factors:
- Margin alignment: 40% weight
- Win probability: 25% weight
- Data quality: 20% weight
- Algorithm confidence: 15% weight

The client-side `computeDealScore()` in the LWC uses 5 factors:
- Margin alignment: 35% weight
- Win probability: 25% weight
- Risk-adjusted value: 20% weight
- Deal structure: 10% weight
- Competitive position: 10% weight

These are DIFFERENT FORMULAS producing DIFFERENT SCORES. The server is the authoritative source.

Fix:
1. The server ALREADY returns `dealScore` and `scoreFactors` in the /api/recommend response. Ensure these are always included in the response — both Phase 1 and Phase 2.
2. Extend the `scoreFactors` object in the response to include human-readable labels for each factor. Add a `label` field with a contextual sentence:

   For each factor, generate the label based on the score/max ratio:
   - marginAlignment: If score/max < 0.33 → "Your margin is significantly below market for this deal profile"
     If score/max 0.33-0.66 → "Your margin is in the right range but could be optimized"
     If score/max > 0.66 → "Your margin is well-aligned with market benchmarks"
   - winProbability: If < 0.33 → "Win probability is low — competitive pressure or pricing risk"
     If 0.33-0.66 → "Moderate win probability — deal structure is reasonable"
     If > 0.66 → "Strong win probability — deal is well-positioned"
   - dataQuality: If < 0.33 → "Missing deal data is reducing scoring accuracy — fill in more fields"
     If 0.33-0.66 → "Good data coverage — a few more fields would improve accuracy"
     If > 0.66 → "Excellent data quality — scoring is highly confident"
   - algorithmConfidence: If < 0.33 → "Limited comparable deals — recommendation based on general benchmarks"
     If 0.33-0.66 → "Some comparable deals found — recommendation is moderately confident"
     If > 0.66 → "Many comparable deals — recommendation is highly confident"

3. Also include the factor `direction` ("positive" or "negative") based on whether the factor contributes positively or negatively to the deal score.

4. If drivers are available from the rules engine, include the top 3 drivers (sorted by absolute impact) as an array of strings in the response. Example:
   ```json
   "topDrivers": [
     "Deal registration (Premium Hunting) is protecting your margin",
     "2 competitors are pressuring price — consider differentiation",
     "Services attached typically support higher blended margins"
   ]
   ```
   Generate these driver strings by mapping the driver names to plain-English sentences. This is a deterministic lookup, not an LLM call.

5. In Phase 1 specifically, since `suggestedMarginPct` is null, add a `phase1Guidance` array to the response with 2-3 directional tips derived from the drivers:
   - Sort drivers by absolute impact value
   - Top positive drivers → "Deal strengths: [driver name]"
   - Top negative drivers → "Watch out for: [driver name]"
   - If dealRegType is "NotRegistered" → "Registering this deal could improve your margin position"
   - If competitors >= 3 → "With multiple competitors, focus on value differentiation"

6. Run all tests: cd lambda/server && npm test
   Update any tests that assert on the /api/recommend response shape.

Create a feature branch, commit, and push. Open a PR from the GitHub UI.
```

### 11C — Phase 1 Actionable Guidance + Fix "Rec: 0.0%" (Founder Issue #6)

```
Read these files:
- sfdc/force-app/main/default/lwc/marginarcMarginAdvisor/marginarcMarginAdvisor.js
- sfdc/force-app/main/default/lwc/marginarcMarginAdvisor/marginarcMarginAdvisor.html
- sfdc/force-app/main/default/lwc/marginarcMarginAdvisor/marginarcMarginAdvisor.css

DEPENDS ON: 11A (auto-score) and 11B (server-side scoring unification) must be merged first.

The Phase 1 experience is currently a dead end — all 5 reviewers flagged it as a POC-killer. Reps see a bare score ("43 — FAIR"), a progress bar to 50, and "Rec: 0.0%" with zero actionable guidance. The CFO calculated that half the POC period produces no measurable value.

**Fix 1: Remove "Rec: 0.0%" from Phase 1 summary line**

The summary line (around line 126-132 of HTML) shows "Score: 43/100 | Rec: 0.0% | Medium" in Phase 1. The "Rec: 0.0%" looks like the tool recommends zero margin — actively misleading.

Fix: In the summary line template, conditionally hide the "Rec:" segment when in Phase 1 (`isPhaseOne` is true). Replace it with the score label:
- Phase 1: "Score: 43/100 | Fair | [Data Quality tier]"
- Phase 2+: "Score: 43/100 | Rec: 18.5% | High" (existing behavior)

**Fix 2: Render Phase 1 guidance panel**

After 11B lands, the API response will include `phase1Guidance` (array of tip strings), `topDrivers` (array of driver sentences), and `scoreFactors` with human-readable `label` fields. Render these in the widget:

1. Below the Deal Score circle and spectrum bar, add a "Deal Insights" section that renders in Phase 1:
   ```html
   <template lwc:if={isPhaseOne}>
     <div class="marginarc-phase1-insights">
       <h3 class="insights-header">Deal Insights</h3>
       <template for:each={phase1Tips} for:item="tip">
         <div key={tip.id} class="insight-row">
           <lightning-icon icon-name={tip.icon} size="x-small"></lightning-icon>
           <span class="insight-text">{tip.text}</span>
         </div>
       </template>
     </div>
   </template>
   ```
2. The `phase1Tips` getter should consume the API response's `phase1Guidance` and `topDrivers` arrays and format them with appropriate icons (utility:like for strengths, utility:warning for risks, utility:info for neutral tips).
3. Style the insights section with the existing dark navy theme. Each tip should be a single line with an icon, fitting within the card width.

**Fix 3: Make Phase 1 progress counter org-wide**

The VP Sales pointed out that "1 of 50" is demoralizing for an individual rep. Make it team-based.

1. The API response already includes `phaseInfo.scoredDeals` (the deal count). Check if this is per-org or global (it should be per-org after 8D's org_id fix). If it's per-org, display it as: "Your team has scored X of 50 deals needed to unlock margin recommendations."
2. Change the pronoun from "You've scored" to "Your team has scored" since the threshold is org-wide, not per-rep.

**Fix 4: Replace raw score factor pills with natural language**

After 11B lands, `scoreFactors` will include a `label` field with a human-readable sentence. Replace the current pill rendering:

1. Instead of pills showing "0/35 Margin alignment", render a compact list of the factor labels from the API response.
2. Use a 3-tier color system based on score/max ratio: red (< 0.33), amber (0.33-0.66), green (> 0.66).
3. Each label should be one line of text (the sentence from the API), colored appropriately.
4. If the API didn't return labels (degraded mode), fall back to a simplified format: "Margin: Low", "Win Prob: Medium", "Data: High" — NOT the raw numbers.

**Fix 5: Remove the client-side `computeDealScore()` as primary scoring**

After 11B makes the server the source of truth:
1. The LWC should use the `dealScore` and `scoreFactors` from the API response as the PRIMARY display values.
2. Move the client-side `computeDealScore()` to only fire when `degradationLevel >= 3` (API unavailable). It becomes the fallback, not the default.
3. This eliminates the score divergence bug where reps see different scores than the manager dashboard.

Run prettier and eslint:
  cd sfdc && npx prettier --write force-app/main/default/lwc/marginarcMarginAdvisor/**/*.{js,html}
  cd sfdc && npx eslint force-app/main/default/lwc/marginarcMarginAdvisor/**/*.js

Create a feature branch, commit, and push. Open a PR from the GitHub UI.
```

### 11D — Details Panel Accordion + Multi-Vendor Badge (Founder Issues #2, #4)

```
Read these files:
- sfdc/force-app/main/default/lwc/marginarcMarginAdvisor/marginarcMarginAdvisor.js
- sfdc/force-app/main/default/lwc/marginarcMarginAdvisor/marginarcMarginAdvisor.html
- sfdc/force-app/main/default/lwc/marginarcMarginAdvisor/marginarcMarginAdvisor.css

DEPENDS ON: 11C must be merged first.

Two lower-priority but important UX fixes.

**Fix 1: Convert details panel from monolithic toggle to accordion sections**

The current "Show Details" toggle expands ALL detail sections at once, pushing the BOM Builder and other components off-screen. The recommendation history section already has its own accordion pattern (`toggleHistory()`, `collapsedSections` tracked property).

Fix:
1. Extend the `collapsedSections` tracked property (currently only tracks 'history') to also track: 'comparison', 'drivers', 'aiSummary', 'bomSummary'.
2. Add toggle methods for each section: `toggleComparison()`, `toggleDrivers()`, `toggleAiSummary()`, `toggleBomSummary()`. Follow the existing `toggleSection()` pattern.
3. Each section inside the details panel gets its own collapsible header with a chevron icon (right = collapsed, down = expanded). Use the existing `.section-header` styling pattern from the history section.
4. Default state when "Show Details" is clicked: 'comparison' expanded, all others collapsed. This shows the most important detail (Plan vs Recommended table) without overwhelming the viewport.
5. Add `max-height: 500px; overflow-y: auto;` to the `.marginarc-details-expanded` CSS class as a safety net. Add `-webkit-overflow-scrolling: touch` for mobile.
6. Add a "Collapse All" link at the bottom of the expanded details panel so users can close it without scrolling back to the toggle button.
7. Remember: LWC templates don't allow `!` unary expressions. Use computed getters like `get isComparisonCollapsed() { return this.collapsedSections.has('comparison'); }` for each section.

**Fix 2: Show BOM-derived vendor badges for multi-vendor deals**

The badge currently shows one OEM (e.g., "Cisco · Enterprise"). For multi-vendor deals, the BOM lines already contain per-line vendor data.

Fix:
1. Add a computed getter `secondaryVendors` that extracts unique vendor names from `activeBomData.items`, excluding the primary OEM:
   ```javascript
   get secondaryVendors() {
     if (!this.activeBomData?.items?.length) return [];
     const primary = this.opportunityData?.oem;
     const vendors = [...new Set(
       this.activeBomData.items
         .map(item => item.vendor)
         .filter(v => v && v !== primary && v !== 'Unknown')
     )];
     return vendors.slice(0, 3); // max 3 secondary badges
   }
   ```
2. In the HTML, after the primary OEM badge, render secondary badges:
   ```html
   <template for:each={secondaryVendors} for:item="vendor">
     <span key={vendor} class="marginarc-secondary-oem-badge">+{vendor}</span>
   </template>
   ```
3. Style the secondary badges smaller than the primary, with a muted color (e.g., semi-transparent white background instead of the solid teal).
4. If there are more than 3 secondary vendors, show "+2 more" as the last badge.

**Fix 3: Hide "MANUAL Applied +0.0pp" in Phase 1**

The screenshot shows "MANUAL Applied +0.0pp" below the phase callout. In Phase 1, there is no recommendation to apply, so this is confusing leftover UI. Gate the recommendation history section behind `isPhaseOne` — only show it in Phase 2+.

Run prettier and eslint:
  cd sfdc && npx prettier --write force-app/main/default/lwc/marginarcMarginAdvisor/**/*.{js,html}
  cd sfdc && npx eslint force-app/main/default/lwc/marginarcMarginAdvisor/**/*.js

Create a feature branch, commit, and push. Open a PR from the GitHub UI.
```

---

## Epic 12: UX Quick Wins — Sprint 29

### 11E — "Apply Recommendation" Safety + Copy Button (Sales Rep Feedback)

```
Read these files:
- sfdc/force-app/main/default/lwc/marginarcMarginAdvisor/marginarcMarginAdvisor.js
- sfdc/force-app/main/default/lwc/marginarcMarginAdvisor/marginarcMarginAdvisor.html

The Sales Rep evaluator flagged that the "Apply Recommendation" button is too scary — it overwrites the Opportunity Amount, Planned Margin, Recommended Margin, and Win Probability all at once. The confirmation dialog says "This action cannot be undone from this widget." For a rep, changing the Amount field flows into forecasting and pipeline reports. Reps will not trust an AI tool enough to let it change their forecast number.

Fix:
1. **Add a "Copy Recommendation" button** as the PRIMARY action, placed before the "Apply" button. This copies the recommended sell price and margin percentage to the clipboard in a clean format:
   "MarginArc Recommendation: 18.5% margin ($X sell price, $Y GP)"
   Use the `navigator.clipboard.writeText()` API. Show a brief toast: "Recommendation copied to clipboard."

2. **Demote "Apply Recommendation"** to a secondary/text-style button. Change it from `brand` variant to `neutral` variant. Keep the confirmation dialog.

3. **Add an "Undo" capability** to the Apply action. Before overwriting fields, save the current values in a tracked property `_preApplyValues`. After applying, show an "Undo" link for 30 seconds that restores the original values. This dramatically reduces the perceived risk of clicking Apply.

4. **In the confirmation dialog**, be more specific about what changes:
   - "This will update:" followed by a comparison table:
     | Field | Current | New |
     |-------|---------|-----|
     | Amount | $56,448 | $58,200 |
     | Planned Margin | 15.0% | 18.5% |
   - This lets the rep see the exact impact before confirming.

Run prettier and eslint on modified files.

Create a feature branch, commit, and push. Open a PR from the GitHub UI.
```

---

## Epic 12: Data Credibility & Trust Fixes (Sprint 30)

**Context:** After shipping 21 fixes (Epics 7-11), the founder tested the live product on a real deal — Regeneron (a $12B pharma company) with a $56K Cisco networking opportunity. Five evaluator agents (VP Product, CTO, Sales Rep, VP Sales, CFO) reviewed the screenshots and identified 9 issues that undermine data credibility and trust. The CFO rated purchase readiness at 4/10: "a wrong number is worse than no number."

**Core problem:** The segment detection fix (PR #66) added AnnualRevenue-based inference, but it is never reached because the `Fulcrum_Customer_Segment__c` field has an explicit "SMB" value on the Opportunity (from demo data). This cascades into every downstream calculation.

### Concurrency Guide
- **12A**, **12B**, and **12E** can run in **parallel** (all touch different files)
- **12D** depends on **12A** (both touch marginarcMarginAdvisor.js) — run AFTER 12A merges
- **12C** depends on **12D** (both touch marginarcMarginAdvisor.js) — run AFTER 12D merges

---

### Prompt 12A: Fix Segment Override + Demo Data [SFDC] (Sprint 30)

```
You are working on the MarginArc SFDC package in the `mattrothberg2/MarginArc` repo.

## Context

The segment detection code was fixed in PR #66 to use Account.AnnualRevenue as a fallback. The code is correct — but it never fires because the `Fulcrum_Customer_Segment__c` picklist field has an EXPLICIT value of "SMB" set on demo Opportunities (from the demo data loader). The explicit field takes priority at line 250 of `marginarcMarginAdvisor.js`, so the AnnualRevenue path at line 252 is never reached.

Regeneron is a $12B pharma company. A $56K deal there should be "Enterprise", not "SMB." The wrong segment cascades everywhere: base margin is 6pp wrong (20% SMB vs 14% Enterprise), deal insights reference "SMB segment pricing", and the deal score drops from ~55 to 36.

## File: `sfdc/force-app/main/default/lwc/marginarcMarginAdvisor/marginarcMarginAdvisor.js`

### Fix 1: Add segment sanity check

In `mapOpportunityData()` around line 250-269, AFTER the existing segment derivation logic, add a sanity check that overrides the explicit segment when it contradicts Account.AnnualRevenue by 2+ tiers:

```javascript
// After the existing if/else if/else segment block (around line 269):

// Sanity check: if explicit segment contradicts AnnualRevenue by 2+ tiers, override
if (!isSegmentInferred && annualRevenue != null && annualRevenue > 0) {
  const revenueSegment =
    annualRevenue >= 100000000 ? "Enterprise"
    : annualRevenue >= 10000000 ? "MidMarket"
    : "SMB";

  const tiers = { SMB: 0, MidMarket: 1, Enterprise: 2 };
  const explicitTier = tiers[customerSegment] ?? 1;
  const revenueTier = tiers[revenueSegment] ?? 1;

  if (Math.abs(explicitTier - revenueTier) >= 2) {
    // Explicit segment is wildly inconsistent with revenue — override
    customerSegment = revenueSegment;
    isSegmentInferred = true; // Mark as inferred since we overrode
    console.warn(
      `MarginArc: Overriding explicit segment "${explicitSegment}" with revenue-derived "${revenueSegment}" (AnnualRevenue: $${annualRevenue})`
    );
  }
}
```

This means: if someone set "SMB" on the Opportunity but Account.AnnualRevenue is $12B (Enterprise), override to Enterprise. But if the explicit segment is "MidMarket" and revenue says "Enterprise" (only 1 tier difference), trust the explicit value.

### Fix 2: Update the demo data loader to populate AnnualRevenue on Accounts

In `sfdc/force-app/main/default/classes/MarginArcDemoDataService.cls`, find the account creation logic and ensure every Account gets an appropriate `AnnualRevenue` value based on the segment assigned to its deals. For example:
- Enterprise deals → Account.AnnualRevenue = random between 500M and 50B
- MidMarket deals → Account.AnnualRevenue = random between 50M and 500M
- SMB deals → Account.AnnualRevenue = random between 1M and 50M

Also in `sfdc/force-app/main/default/classes/MarginArcDemoDataLoader.cls`, update the 30 hardcoded demo Opportunities to ensure their parent Accounts have AnnualRevenue set. The Account creation is at the top of the file.

### Fix 3: Add `Account.AnnualRevenue` to the OPPORTUNITY_FIELDS wire

Verify that `"Opportunity.Account.AnnualRevenue"` is already in the `OPPORTUNITY_FIELDS` array at the top of `marginarcMarginAdvisor.js`. It should have been added by PR #66 — just confirm it is there.

### Fix 4: Update the test class

In `sfdc/force-app/main/default/classes/MarginArcControllerTest.cls`, add a test that verifies the segment override behavior: create an Opportunity with `Fulcrum_Customer_Segment__c = 'SMB'` on an Account with `AnnualRevenue = 12000000000` and verify the widget would derive "Enterprise". Since the override is client-side (LWC), you may need to add a comment noting this is tested via the LWC rather than Apex.

Run prettier and eslint on modified files. Verify tests pass with `cd sfdc && npx prettier --write force-app/main/default/lwc/marginarcMarginAdvisor/marginarcMarginAdvisor.js && npx eslint force-app/main/default/lwc/marginarcMarginAdvisor/marginarcMarginAdvisor.js`.

Create a feature branch, commit, and push. Open a PR from the GitHub UI.
```

---

### Prompt 12B: Fix Win Rate Minimum Sample + Suppress Hardcoded Defaults [SFDC Apex] (Sprint 30)

Can run **in parallel** with 12A (touches different files).

```
You are working on the MarginArc SFDC package in the `mattrothberg2/MarginArc` repo.

## Context

The Industry Intelligence widget shows "Win rate in Life Sciences & Healthcare: 0%" and "Average margin on won deals: 15.0%" — but there are ZERO Closed Won deals in that industry. The 0% win rate is real data but is catastrophically misleading (all 5 evaluator agents flagged this as trust-destroying). The 15.0% margin is the hardcoded default from line 611, NOT actual data.

The CFO evaluator said: "Presenting '0%' with the same visual weight as a real metric is a fundamental analytics sin."

## File: `sfdc/force-app/main/default/classes/MarginArcCompetitiveController.cls`

### Fix 1: Add minimum sample size threshold for win rate

In the `getSimilarAccountData()` method around line 619-621:

```java
// Current:
Decimal winRate = totalDeals > 0 ? (Decimal) wonDeals / totalDeals * 100 : 0;

// Change to:
Decimal winRate = totalDeals >= 5 ? (Decimal) wonDeals / totalDeals * 100 : null;
```

When `winRate` is null, the insight at line 684 should change from showing "Win rate in X: 0%" to showing "Not enough data for win rate analysis (need 5+ closed deals)". Update the insight building logic:

```java
if (winRate != null) {
  insights.add('Win rate in ' + industry + ': ' + winRate.setScale(0) + '%');
} else {
  insights.add('Not enough closed deals in ' + industry + ' for win rate analysis');
}
```

### Fix 2: Suppress hardcoded default margin

At line 611: `Decimal avgMargin = 15.0; // Default margin`. When there are no actual won deals with margin data, this default gets displayed as "Average margin on won deals: 15.0%". Fix:

Track how many won deals actually have margin data using a counter variable. Then conditionally display:

```java
if (marginCount > 0) {
  insights.add('Average margin on won deals: ' + avgMargin.setScale(1) + '%');
} else {
  insights.add('No margin data available for ' + industry + ' deals yet');
}
```

Where `marginCount` tracks how many won deals actually had `Fulcrum_GP_Percent__c` populated. Add this counter to the existing SOQL/query logic.

### Fix 3: Add `hasDataConfidence` flag to return map

At line 702-711, the return map includes `'accountsAnalyzed' => accountCount`. Add a confidence flag:

```java
'hasDataConfidence' => (totalDeals >= 5),
```

The LWC Competitive Intelligence component can use this to show/hide confidence-dependent metrics.

### Fix 4: Update win rate in the return map

The `avgWinRate` key in the return map at line 706 should handle the null case:

```java
'avgWinRate' => winRate != null ? winRate.setScale(0) : null,
```

### Fix 5: Update test class

In `sfdc/force-app/main/default/classes/MarginArcCompetitiveControllerTest.cls`, add tests:
1. When `totalDeals < 5`, verify win rate insight says "Not enough closed deals..."
2. When no deals have `Fulcrum_GP_Percent__c`, verify margin insight says "No margin data available..."
3. When `totalDeals >= 5`, verify the normal win rate display still works

Run prettier on modified Apex files. Verify tests pass.

Create a feature branch, commit, and push. Open a PR from the GitHub UI.
```

---

### Prompt 12C: Deduplicate Insights + BOM Mismatch Warning + Phase 1 REC% [SFDC LWC] (Sprint 30)

**Depends on 12A** (both modify marginarcMarginAdvisor.js). Run AFTER 12A merges.

```
You are working on the MarginArc SFDC package in the `mattrothberg2/MarginArc` repo.

## Context

Three remaining UI trust issues from the post-fix review:

1. **Contradictory insights:** "Cisco OEM margin profile" appears as BOTH a thumbs-up ("influencing the recommendation") AND a warning ("Watch out for: Cisco OEM margin profile"). The `phase1Tips` getter at line 594 renders topDrivers and phase1Guidance independently — the same entity can appear in both lists with opposite framing.

2. **BOM/Opportunity Amount mismatch:** BOM totals $52,373 but Opportunity Amount is $56,448 — a 7.2% gap with no warning. The CFO evaluator called this "a material misstatement."

3. **REC% column shows dashes in Phase 1:** All three BOM lines show "—" in the REC% column because per-line recommendations are Phase 3 only. Dead UI real estate that makes the product look broken.

## File 1: `sfdc/force-app/main/default/lwc/marginarcMarginAdvisor/marginarcMarginAdvisor.js`

### Fix 1: Deduplicate insights in `phase1Tips` getter

In the `phase1Tips` getter (around line 594), add deduplication logic. After building all tips from topDrivers, phase1Guidance, and scoreFactors, deduplicate by extracting key entities and keeping only the first mention:

```javascript
// At the end of phase1Tips(), before `return tips;`:
// Deduplicate: if the same key entity appears in both topDrivers and phase1Guidance,
// keep only the first occurrence
const seen = new Set();
const dedupedTips = [];
for (const tip of tips) {
  const normalized = tip.text.toLowerCase();
  const entities = ['cisco', 'hpe', 'dell', 'palo alto', 'fortinet', 'vmware',
    'microsoft', 'netapp', 'pure storage', 'arista', 'crowdstrike', 'nutanix',
    'smb', 'midmarket', 'enterprise'];
  const matchedEntity = entities.find(e => normalized.includes(e));
  const key = matchedEntity || normalized.substring(0, 40);

  if (!seen.has(key)) {
    seen.add(key);
    dedupedTips.push(tip);
  }
}
return dedupedTips;
```

### Fix 2: Add BOM/Opportunity Amount mismatch warning

Add a computed getter that checks for discrepancy between BOM total and Opportunity Amount:

```javascript
get bomOppAmountMismatch() {
  if (!this.savedBomData?.totals?.totalPrice || !this.opportunityData?.amount) {
    return null;
  }
  const bomTotal = this.savedBomData.totals.totalPrice;
  const oppAmount = this.opportunityData.amount;
  const delta = Math.abs(bomTotal - oppAmount);
  const pctDiff = (delta / oppAmount) * 100;

  if (pctDiff > 2) {
    return {
      delta: delta.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }),
      pctDiff: pctDiff.toFixed(1),
      bomTotal: bomTotal.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }),
      oppAmount: oppAmount.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 })
    };
  }
  return null;
}
```

In the HTML template (`marginarcMarginAdvisor.html`), add a warning banner inside the BOM summary section (near the BOM totals display in the details panel). Show it only when `bomOppAmountMismatch` is non-null:

```html
<template lwc:if={bomOppAmountMismatch}>
  <div class="bom-mismatch-warning">
    <lightning-icon icon-name="utility:warning" size="x-small" variant="warning"></lightning-icon>
    <span>BOM total ({bomOppAmountMismatch.bomTotal}) differs from Opportunity Amount ({bomOppAmountMismatch.oppAmount}) by {bomOppAmountMismatch.delta} ({bomOppAmountMismatch.pctDiff}%)</span>
  </div>
</template>
```

Style the warning banner in the CSS file with a light amber background (#FEF3C7), dark text (#92400E), border-radius 8px, padding 8px 12px, margin 8px 0, font-size 12px, and flex layout with gap. Add the CSS class `.bom-mismatch-warning`.

## File 2: `sfdc/force-app/main/default/lwc/marginarcBomBuilder/marginarcBomBuilder.js` and `.html`

### Fix 3: Hide REC% column in Phase 1

The BOM Builder should detect whether any line has a recommendation and hide the "Rec%" column when none do. Add a phase-aware check:

1. In `marginarcBomBuilder.js`, add a computed getter:
```javascript
get showRecColumn() {
  return this._bomLines.some(line => line.recMargin != null);
}
```

2. In `marginarcBomBuilder.html`, wrap the Rec% column header and the corresponding data cells with `<template lwc:if={showRecColumn}>`. This way the column only appears when there is actual data to show.

3. Also in `marginarcMarginAdvisor.html`, in the BOM summary section inside the details panel, wrap the "Recommended" column header and cells in a similar conditional that checks if any BOM line has a `recommendedMarginDisplay` that is not "—".

Run prettier and eslint on ALL modified files:
```
cd sfdc
npx prettier --write force-app/main/default/lwc/marginarcMarginAdvisor/marginarcMarginAdvisor.js
npx prettier --write force-app/main/default/lwc/marginarcMarginAdvisor/marginarcMarginAdvisor.html
npx prettier --write force-app/main/default/lwc/marginarcMarginAdvisor/marginarcMarginAdvisor.css
npx prettier --write force-app/main/default/lwc/marginarcBomBuilder/marginarcBomBuilder.js
npx prettier --write force-app/main/default/lwc/marginarcBomBuilder/marginarcBomBuilder.html
npx eslint force-app/main/default/lwc/marginarcMarginAdvisor/marginarcMarginAdvisor.js
npx eslint force-app/main/default/lwc/marginarcBomBuilder/marginarcBomBuilder.js
```

Create a feature branch, commit, and push. Open a PR from the GitHub UI.
```

---

### Prompt 12D: Fix dealScoreFactors Crash + Score Improvement Tips [SFDC LWC] (Sprint 30)

**Depends on 12A** (both modify marginarcMarginAdvisor.js). Run AFTER 12A merges.

```
You are working on the MarginArc SFDC package in the `mattrothberg2/MarginArc` repo.

## Context

There is a **P0 crash** when clicking "Show Details" on the Margin Advisor widget. The error is:

```
[(intermediate value) || []].map is not a function
Function: get dealScoreFactors
Component: markup://c:marginarcMarginAdvisor
```

**Root cause:** The Lambda API (`/api/recommend`) returns `scoreFactors` as a **plain object** with named keys:
```json
{
  "marginAlignment": { "score": 0, "max": 40, "label": "Your margin is...", "direction": "negative" },
  "winProbability": { "score": 13, "max": 25, "label": "Moderate win...", "direction": "positive" },
  "dataQuality": { "score": 11, "max": 20, "label": "Good data...", "direction": "positive" },
  "algorithmConfidence": { "score": 6, "max": 15, "label": "Limited...", "direction": "negative" }
}
```

But the LWC `dealScoreFactors` getter (around line 2372) checks `Array.isArray(apiFactors)` — which returns false for the object. The fallback path then does `(this.dealScoreData?.factors || []).map(...)`. Since the `dealScoreData` getter at line 2345 sets `factors: this.recommendation.scoreFactors || []`, and `scoreFactors` is a truthy object, the `|| []` fallback never triggers. The code calls `.map()` on the plain object, which crashes.

## File: `sfdc/force-app/main/default/lwc/marginarcMarginAdvisor/marginarcMarginAdvisor.js`

### Fix 1: Convert scoreFactors object to array

In the `dealScoreFactors` getter (around line 2372), replace the `Array.isArray(apiFactors)` check with logic that handles BOTH shapes — object and array:

```javascript
get dealScoreFactors() {
    const apiFactors = this.recommendation?.scoreFactors;

    // Convert object shape { marginAlignment: {...}, ... } to array
    let factorsArray;
    if (apiFactors && typeof apiFactors === 'object' && !Array.isArray(apiFactors)) {
      // Server returns an object with named keys — convert to array
      const DISPLAY_NAMES = {
        marginAlignment: 'Margin Alignment',
        winProbability: 'Win Probability',
        dataQuality: 'Data Quality',
        algorithmConfidence: 'Algorithm Confidence'
      };
      factorsArray = Object.entries(apiFactors).map(([key, val]) => ({
        name: DISPLAY_NAMES[key] || key,
        score: val.score,
        max: val.max,
        label: val.label,
        direction: val.direction
      }));
    } else if (Array.isArray(apiFactors) && apiFactors.length > 0) {
      factorsArray = apiFactors;
    }

    if (factorsArray && factorsArray.length > 0) {
      return factorsArray.map((f) => {
        const ratio = f.max > 0 ? f.score / f.max : 0.5;
        let colorClass;
        if (ratio >= 0.66) colorClass = 'score-factor-label score-factor-label-green';
        else if (ratio >= 0.33) colorClass = 'score-factor-label score-factor-label-amber';
        else colorClass = 'score-factor-label score-factor-label-red';
        return { name: f.name, label: f.label || f.name, labelClass: colorClass };
      });
    }

    // Fallback: client-side factors (also guard against object shape)
    const clientFactors = this.dealScoreData?.factors;
    const clientArray = Array.isArray(clientFactors) ? clientFactors : [];
    // ... rest of fallback logic using clientArray instead of clientFactors
}
```

### Fix 2: Fix dealScoreData getter too

In the `dealScoreData` getter (around line 2345), also guard the `factors` assignment:

```javascript
// Change:
factors: this.recommendation.scoreFactors || []
// To:
factors: Array.isArray(this.recommendation.scoreFactors)
  ? this.recommendation.scoreFactors
  : []
```

This ensures the client-side fallback path always gets an actual array.

### Fix 3: Fix phase1Tips getter

In the `phase1Tips` getter (around line 632), there is a similar `Array.isArray(factors)` guard that silently skips the API scoreFactors object. Apply the same object-to-array conversion:

```javascript
// Where it reads scoreFactors for the detail view, apply the same conversion
const rawFactors = this.recommendation?.scoreFactors;
let factors;
if (rawFactors && typeof rawFactors === 'object' && !Array.isArray(rawFactors)) {
  factors = Object.entries(rawFactors).map(([key, val]) => ({
    name: key, score: val.score, max: val.max, label: val.label, direction: val.direction
  }));
} else if (Array.isArray(rawFactors)) {
  factors = rawFactors;
}
```

### Fix 4: Add "Improve Your Score" tips below deal score

When the details panel is expanded, show actionable tips that tell the rep HOW to improve the score. Add a getter:

```javascript
get scoreImprovementTips() {
  const tips = [];
  const factors = this.recommendation?.scoreFactors;
  if (!factors) return tips;

  // Convert object shape to usable format
  const f = typeof factors === 'object' && !Array.isArray(factors) ? factors : {};

  // Margin alignment — if score is low, suggest updating planned margin
  if (f.marginAlignment && f.marginAlignment.max > 0) {
    const ratio = f.marginAlignment.score / f.marginAlignment.max;
    if (ratio < 0.33) {
      tips.push({
        icon: 'utility:trending',
        text: 'Update your planned margin closer to the recommendation',
        pts: Math.round(f.marginAlignment.max * 0.5) - f.marginAlignment.score
      });
    }
  }

  // Data quality — if score is low, suggest filling in fields
  if (f.dataQuality && f.dataQuality.max > 0) {
    const ratio = f.dataQuality.score / f.dataQuality.max;
    if (ratio < 0.66) {
      const missingFields = this._missingFields || [];
      const fieldHint = missingFields.length > 0
        ? `Fill in: ${missingFields.slice(0, 3).join(', ')}`
        : 'Add more deal details (competitors, urgency, complexity)';
      tips.push({
        icon: 'utility:edit',
        text: fieldHint,
        pts: Math.round(f.dataQuality.max * 0.3)
      });
    }
  }

  // Algorithm confidence — if low, encourage more deal scoring
  if (f.algorithmConfidence && f.algorithmConfidence.max > 0) {
    const ratio = f.algorithmConfidence.score / f.algorithmConfidence.max;
    if (ratio < 0.5) {
      tips.push({
        icon: 'utility:database',
        text: 'Score more deals to improve algorithm confidence',
        pts: Math.round(f.algorithmConfidence.max * 0.3)
      });
    }
  }

  // Win probability — if low, suggest actions
  if (f.winProbability && f.winProbability.max > 0) {
    const ratio = f.winProbability.score / f.winProbability.max;
    if (ratio < 0.33) {
      tips.push({
        icon: 'utility:like',
        text: 'Register the deal or reduce competitor count to improve win probability',
        pts: Math.round(f.winProbability.max * 0.3)
      });
    }
  }

  // Sort by potential points, take top 3
  return tips.sort((a, b) => b.pts - a.pts).slice(0, 3);
}

get hasScoreImprovementTips() {
  return this.scoreImprovementTips.length > 0;
}
```

In the HTML template (`marginarcMarginAdvisor.html`), inside the details panel after the score factors display, add:

```html
<template lwc:if={hasScoreImprovementTips}>
  <div class="score-tips">
    <p class="score-tips-header">Improve your score:</p>
    <template for:each={scoreImprovementTips} for:item="tip">
      <div key={tip.text} class="score-tip-row">
        <lightning-icon icon-name={tip.icon} size="xx-small"></lightning-icon>
        <span class="score-tip-text">{tip.text}</span>
        <span class="score-tip-pts">+{tip.pts} pts</span>
      </div>
    </template>
  </div>
</template>
```

Style the tips section in the CSS:
- `.score-tips`: margin-top 12px, padding 12px, background #F8FAFC, border-radius 8px, border 1px solid #E2E8F0
- `.score-tips-header`: font-size 11px, font-weight 600, text-transform uppercase, letter-spacing 0.5px, color #64748B, margin-bottom 8px
- `.score-tip-row`: display flex, align-items center, gap 8px, padding 4px 0, font-size 13px
- `.score-tip-text`: flex 1, color #334155
- `.score-tip-pts`: font-size 11px, font-weight 600, color #059669 (green), white-space nowrap

Run prettier and eslint on ALL modified files. Verify the widget loads without errors — specifically test the "Show Details" toggle.

Create a feature branch, commit, and push. Open a PR from the GitHub UI.
```

---

### Prompt 12E: Fix BOM Table Overflow + Responsive Layout [SFDC LWC CSS] (Sprint 30)

Can run **in parallel** with 12A, 12B, and 12D (only touches CSS files and BOM component HTML).

```
You are working on the MarginArc SFDC package in the `mattrothberg2/MarginArc` repo.

## Context

The BOM Builder table extends beyond its container on the Salesforce Opportunity record page. The root cause is two layers of `overflow: hidden` on parent containers that clip the scroll wrapper, plus missing text truncation on long content.

## File 1: `sfdc/force-app/main/default/lwc/marginarcBomBuilder/marginarcBomBuilder.css`

### Fix 1: Remove overflow clipping on parent containers

The current CSS has:
```css
.bom-builder {
  overflow: hidden;    /* CLIPS horizontal content */
}
.table-section {
  overflow: hidden;    /* ALSO CLIPS horizontal content */
}
.table-scroll {
  overflow-x: auto;   /* This is correct but parents negate it */
}
```

Change `.bom-builder` from `overflow: hidden` to `overflow: visible`. Change `.table-section` from `overflow: hidden` to `overflow: visible`. Keep `.table-scroll` as `overflow-x: auto` — this is the intended scroll container.

If `overflow: hidden` on `.bom-builder` is needed to clip something specific (like absolute-positioned children), use `overflow-y: hidden; overflow-x: visible` instead. But first try `overflow: visible` and verify nothing breaks.

### Fix 2: Add text truncation for long content

Add these CSS rules to prevent long unbroken strings from pushing the grid wider:

```css
.cell-input,
.cell-desc,
.cell-num {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bom-table {
  width: 100%;
  min-width: 760px;
  word-break: break-word;
  overflow-wrap: break-word;
}
```

Also add `min-width: 0` to the grid row children:

```css
.table-header > *,
div[role="row"] > *,
.table-totals > * {
  min-width: 0;
  overflow: hidden;
}
```

### Fix 3: Ensure the Description column truncates gracefully

The Description column uses `1fr` and should not push other columns off-screen. Add:

```css
.cell-desc {
  width: 100%;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
```

And in the HTML template (`marginarcBomBuilder.html`), find the description input field and add `title={line.description}` so users can hover to see the full text.

## File 2: `sfdc/force-app/main/default/lwc/marginarcBomTable/marginarcBomTable.css`

### Fix 4: Add text truncation for the read-only BOM table

The read-only BOM table has similar overflow risks. Add truncation to the Line Item column:

```css
.bom-item-label,
.bom-item-sku {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bom-table-wrap > * {
  min-width: 0;
}
```

### Fix 5: Consistent currency formatting

In `marginarcBomBuilder.js`, find all places where currency values are displayed (Unit Cost and Ext Price columns). Ensure they use `.toFixed(2)` for consistent decimal places (e.g., "$6,232.30" not "$6,232.3"). Look for the formatting functions and fix any that produce inconsistent decimal output.

## Testing

After making changes:
1. Verify the BOM Builder table does not overflow its container on a standard Opportunity record page
2. Verify horizontal scroll works when the viewport is narrower than 760px
3. Verify long descriptions are truncated with ellipsis and show full text on hover
4. Verify the Category dropdown still appears correctly (not clipped by parent overflow)
5. Verify responsive breakpoints still work (1024px and 768px)

Run prettier on modified files:
```
cd sfdc
npx prettier --write force-app/main/default/lwc/marginarcBomBuilder/marginarcBomBuilder.css
npx prettier --write force-app/main/default/lwc/marginarcBomTable/marginarcBomTable.css
npx prettier --write force-app/main/default/lwc/marginarcBomBuilder/marginarcBomBuilder.html
npx prettier --write force-app/main/default/lwc/marginarcBomBuilder/marginarcBomBuilder.js
```

Create a feature branch, commit, and push. Open a PR from the GitHub UI.
```

---
---

## Epic 13: Margin Opportunity Assessment (MOA) — Open Source Scanner (Sprint 31-32)

**Context:** Free, open-source SFDC package that scans a VAR's historical deals and produces a "Margin Opportunity Report" showing how much margin they're leaving on the table. Separate repo (`mattrothberg2/margin-opportunity-assessment`), Apache 2.0 license. Zero MarginArc proprietary code.

**GTM motion:** Prospect self-installs MOA → sees "$X left on the table" → asks "how do I fix this?" → signs MarginArc. MOA data bootstraps Phase 2 on day 1 (no cold start).

### Concurrency Guide
- **13A** → **13B** → **13C** → **13D** (sequential — each builds on the previous)

---

### Prompt 13A: Scaffold MOA Repo + SFDC Project [SFDC] (Sprint 31)

```
You are creating a NEW open-source Salesforce package from scratch. This is NOT the MarginArc product — it's a free diagnostic tool called "Margin Opportunity Assessment" (MOA).

## Setup

1. Create a new GitHub repo:
gh repo create mattrothberg2/margin-opportunity-assessment --public --description "Free margin opportunity scanner for IT VARs. See how much margin your team is leaving on the table." --clone
cd margin-opportunity-assessment

2. Initialize the SFDC project:
sf project generate --name margin-opportunity-assessment --template standard

3. Create the Apache 2.0 LICENSE file.

4. Create this structure:
force-app/main/default/
├── classes/
│   ├── MOA_Scanner.cls              (placeholder — built in 13B)
│   ├── MOA_ScannerTest.cls          (placeholder)
│   ├── MOA_ScanController.cls       (AuraEnabled methods for LWC)
│   ├── MOA_ScanControllerTest.cls
│   ├── MOA_Models.cls               (data classes for scan results)
│   ├── MOA_InstallHandler.cls       (post-install setup)
│   └── MOA_InstallHandlerTest.cls
├── lwc/
│   └── moaDashboard/                (placeholder — built in 13C)
│       ├── moaDashboard.html
│       ├── moaDashboard.js
│       └── moaDashboard.css
├── permissionsets/
│   └── MOA_User.permissionset-meta.xml
├── tabs/
│   └── Margin_Opportunity_Assessment.tab-meta.xml
├── objects/
│   └── MOA_Config__c/               (Hierarchy Custom Setting)
│       ├── MOA_Config__c.object-meta.xml
│       └── fields/
│           ├── Install_Date__c.field-meta.xml    (Date)
│           ├── Scan_Months__c.field-meta.xml     (Number, default 24)
│           ├── Min_Cohort_Size__c.field-meta.xml (Number, default 5)
│           └── Last_Scan_Date__c.field-meta.xml  (DateTime)
│   └── MOA_Scan_Result__c/          (Hierarchy Custom Setting)
│       ├── MOA_Scan_Result__c.object-meta.xml
│       └── fields/
│           ├── Result_JSON__c.field-meta.xml     (Long Text Area, 131072)
│           ├── Scan_Status__c.field-meta.xml     (Text 20)
│           ├── Error_Message__c.field-meta.xml   (Long Text Area, 5000)
│           └── Scan_Date__c.field-meta.xml       (DateTime)
└── applications/
    └── MOA.app-meta.xml

## Permission Set: MOA_User

Read-only access to: Opportunity (all standard fields), Account (Industry, AnnualRevenue, NumberOfEmployees, Name), OpportunityLineItem, Product2 (Name, Family, ProductCode), User (Name). Read/write to MOA_Config__c and MOA_Scan_Result__c. NO write access to Opportunity or Account.

## Install Handler: MOA_InstallHandler

Implements InstallHandler. On install: set MOA_Config__c defaults (Install_Date = today, Scan_Months = 24, Min_Cohort_Size = 5).

## MOA_Models.cls

Data classes — create inner classes: Cohort (oem, sizeBucket, segment, dealCount, wonCount, lostCount, winRate, medianMargin, p25Margin, p75Margin, avgMargin, totalRevenue, marginOpportunity), RepStats (repName, repId, dealCount, wonCount, avgMargin, vsTeamAvg, consistency, marginLeftOnTable), MarginBand (band, dealCount, winRate), ScanResult (totalDeals, totalWon, totalLost, totalRevenue, currentAvgMargin, achievableAvgMargin, annualOpportunity, cohorts list, reps list, winRateByMarginBand list, scanDate, scanMonths).

## Tab

Points to moaDashboard LWC. Icon: standard:analytics.

## README.md

Professional README with:
- "Margin Opportunity Assessment by MarginArc"
- What it does (3 bullets: scans deals, segments by OEM/size/tier, quantifies the gap)
- What it does NOT do (no data leaves SF, no API calls, no writes, fully auditable code)
- Installation instructions
- How it works (link to docs/how-it-works.md)
- Screenshots placeholder
- License: Apache 2.0
- "Built by MarginArc — AI-powered margin optimization for IT VARs"

## docs/how-it-works.md

Explain methodology: cohort segmentation (OEM × Size × Tier), median as benchmark, opportunity = sum of below-median gaps, rep consistency measurement. Emphasize this is basic statistics, not AI.

Commit and push.
```

---

TODO:

### Prompt 13B: MOA Analysis Engine [SFDC Apex] (Sprint 31)

**Depends on 13A.**

```
You are working on the Margin Opportunity Assessment package in the `mattrothberg2/margin-opportunity-assessment` repo.

## Context

Build the core analysis engine — a Database.Batchable<SObject> that scans Closed Won/Lost Opportunities and computes margin opportunity statistics. Everything runs in Apex. No external calls.

## File: force-app/main/default/classes/MOA_Scanner.cls

Implements Database.Batchable<SObject>, Database.Stateful.

### start()

Query closed Opportunities from the last N months (MOA_Config__c.Scan_Months__c, default 24):

SELECT Id, Name, Amount, StageName, CloseDate, Type, OwnerId, IsClosed, IsWon,
       Account.Industry, Account.AnnualRevenue, Account.NumberOfEmployees, Account.Name,
       Owner.Name,
       (SELECT ProductCode, UnitPrice, Quantity, TotalPrice, Product2.Family, Product2.Name FROM OpportunityLineItems)
FROM Opportunity WHERE IsClosed = true AND CloseDate >= LAST_N_MONTHS:24 AND Amount > 0

### execute()

For each Opportunity in the batch:

1. Derive OEM from line items: Pattern match Product2.Family or Product2.Name against known vendors (Cisco, Dell, HPE, Lenovo, Microsoft, Palo Alto, CrowdStrike, Fortinet, VMware, NetApp, Juniper, Aruba). If no match → "Other".

2. Derive Size Bucket from Amount: <$25K, $25K-100K, $100K-500K, $500K-1M, $1M+

3. Derive Customer Segment from Account.AnnualRevenue: >= $1B → Enterprise, >= $100M → Mid-Market, >= $10M → SMB, < $10M or null → Unknown

4. Derive Margin: Try common custom fields in try/catch (many VARs use different field names):
   - Try: Opportunity.get('Fulcrum_GP_Percent__c') — for MarginArc users
   - Try: Opportunity.get('GP_Percent__c')
   - Try: Opportunity.get('Margin_Percent__c')
   - Fallback: If line items have cost data, compute from (Amount - cost) / Amount * 100
   - If no margin available: mark deal as "margin_unknown" (include in win rate analysis but exclude from margin analysis)

5. Accumulate into stateful maps:
   - Map<String, List<DealData>> by cohort key (OEM|Size|Segment)
   - Map<Id, RepAccumulator> by OwnerId

Use a stateful List<DealData> or similar pattern to carry data across batches.

### finish()

1. For each cohort with >= Min_Cohort_Size deals:
   - Sort margin values, compute median (middle value), p25, p75
   - Compute win rate = wonCount / totalCount * 100
   - Compute opportunity = sum of (median - actual) * amount for each Won deal where actual < median

2. For each rep:
   - For each of their deals, compare their margin to the cohort median for that deal's cohort
   - avgMargin vs team average on same-cohort deals
   - consistency = standard deviation of (deal_margin - cohort_median) across their deals

3. Win rate by margin band: group all deals into bands (0-5%, 5-10%, 10-15%, 15-20%, 20-25%, 25%+), compute win rate per band

4. Roll-ups:
   - achievableAvgMargin = sum(cohort_median * deal_amount) / sum(deal_amount) for all Won deals
   - annualOpportunity = total opportunity * (12 / scan_months) to annualize

5. Serialize as ScanResult, store in MOA_Scan_Result__c.Result_JSON__c. Set Scan_Status = 'Complete'.

6. Update MOA_Config__c.Last_Scan_Date__c = DateTime.now()

### Error handling

Wrap finish() in try/catch. On error, set MOA_Scan_Result__c.Scan_Status__c = 'Error', Error_Message__c = error message.

## File: force-app/main/default/classes/MOA_ScanController.cls

@AuraEnabled methods:
- startScan(): Set Scan_Status = 'Running', execute batch
- getScanResult(): Return Result_JSON__c
- getScanStatus(): Return Scan_Status__c

## File: force-app/main/default/classes/MOA_ScannerTest.cls

75%+ coverage. Create: 3 Accounts (Enterprise $5B, Mid-Market $200M, SMB $20M), 15 Opportunities (mix of Won/Lost, varying amounts), Products with Families matching OEM names. Run batch, verify Result_JSON has correct structure.

Commit and push.
```

---

### Prompt 13C: MOA Report Dashboard [SFDC LWC] (Sprint 31-32)

**Depends on 13B.**

```
You are working on the MOA package in the `mattrothberg2/margin-opportunity-assessment` repo.

## Context

Build the LWC dashboard that displays scan results. This is the "wow" screen for the sales conversation.

## Component: force-app/main/default/lwc/moaDashboard/

### Data Loading

connectedCallback: call getScanStatus(). If 'Complete' → getScanResult(), parse JSON. If 'Running' → show spinner, poll every 5s. If no result → show welcome with "Scan Now" button.

### Section 1: Executive Summary (KPI Strip)

5 KPIs in a row: Deals Analyzed, Total Revenue, Current Avg Margin, Achievable Avg Margin, Annual Margin Opportunity (hero number — large green text).

Below: "Your team is leaving an estimated $X/year on the table."

### Section 2: Segment Breakdown Table

Sortable table with columns: Segment (OEM × Size × Tier), Deals, Win Rate, Median Margin, Your Avg, Gap, Opportunity ($). Sort by Opportunity descending. Color-code Gap (green/red). Show top 15 with "Show All" toggle.

### Section 3: Rep Leaderboard

Table: Rep, Deals, Won, Win Rate, Avg Margin, vs Team Avg, Consistency, Opportunity ($). Color-code "vs Team Avg". Sort by Opportunity.

### Section 4: Win Rate by Margin Band

CSS bar chart (no library needed). Bars for each margin band showing win rate %. Label each bar with deal count. Highlight the "sweet spot" (highest win rate band with 10+ deals).

### Trial Expiry

Check MOA_Config__c.Install_Date__c. If > 30 days ago: show banner "Trial expired. Results still visible. Want continuous optimization? Learn about MarginArc →". Disable "Re-Scan" button.

### Scan Now / Re-Scan Button

Top of dashboard. Calls startScan(), shows progress, polls status. On complete, refresh.

### Footer

"Powered by MarginArc — AI-powered margin optimization for IT VARs. Learn more →"

### Styling

Clean, modern. White cards on #F1F5F9 background. Hero number: #059669 green, 28px bold. Tables: alternating rows, sticky headers. Responsive: stack KPIs vertically on mobile.

### CSV Export

"Export CSV" button for segment breakdown. Build CSV string in JS, create Blob, trigger download link.

Commit and push.
```

---

### Prompt 13D: MOA Polish + Release [SFDC] (Sprint 32)

**Depends on 13C.**

```
You are working on the MOA package in the `mattrothberg2/margin-opportunity-assessment` repo.

## Tasks

1. PDF Export: Create MOA_ReportPDF.page (Visualforce renderAs="pdf"). Page 1: 5 KPIs + summary. Page 2: Top 10 segments. Page 3: Rep leaderboard. Footer: "Margin Opportunity Assessment | marginarc.com". Wire the LWC "Export PDF" button to open this page.

2. Scan Progress: In the batch execute(), update MOA_Scan_Result__c.Scan_Status__c with progress count (e.g., "Running: 450/2847"). LWC polls and parses to show % progress bar.

3. Error UX: If scan fails, show friendly error: "Scan encountered an issue: {error}. Contact support@marginarc.com for help."

4. Deploy to MarginArc dev org for testing:
SF_USE_GENERIC_UNIX_KEYCHAIN=true sf project deploy start --target-org matt.542a9844149e@agentforce.com --source-dir force-app
Run the scan, take 3 screenshots (summary, segments, reps), save to docs/.

5. Update README with screenshots and a SFDC deploy button URL.

6. Create GitHub release v1.0.0.

Commit and push.
```

---
---

## Epic 14: Real ML Algorithm — Replace Rules Engine (Sprint 32-34)

**Context:** Replace the hardcoded rules engine (rules.js) with a real predictive model — logistic regression trained on each customer's Closed Won/Lost deals. The model learns which features predict winning, how margin affects win probability, and recommends the margin that maximizes expected GP.

**Data source:** `recorded_deals` table already has 27 feature columns + outcome (status Won/Lost) + achieved_margin. MarginArcDealOutcomeSync pushes closed deals weekly. No new pipeline needed.

**Architecture:** Win Probability Model: P(win | features, proposed_margin). Margin Optimizer: sweep 5-35%, find max expected GP. All pure Node.js — no Python, no SageMaker.

### Concurrency Guide
- **14A** and **14B** can run in **parallel** (separate new files)
- **14C** depends on **14A + 14B** (training uses both)
- **14D** depends on **14C** (inference needs trained model)
- **14E** can run in **parallel** with 14C/14D (standalone benchmarks module)
- **14F** depends on **14D + 14E** (LWC needs both working)

---

### Prompt 14A: Feature Engineering Module [Lambda Node.js] (Sprint 32)

Can run in **parallel** with 14B.

```
You are working on the MarginArc Lambda API in the `mattrothberg2/MarginArc` repo, under lambda/server/.

## Project Setup

- ES modules project ("type": "module" in package.json)
- Test runner: `node --experimental-vm-modules node_modules/.bin/jest`
- Import style: `import { x } from './path.js'` (must include .js extension)
- All new files go under lambda/server/src/ml/ (create the ml/ directory)

## Context — What This Is For

MarginArc is an AI margin optimizer for IT VARs (Value-Added Resellers). Sales reps enter deal details in Salesforce, and our Lambda API returns a recommended margin percentage. Currently we use a hardcoded rules engine (rules.js) — we're replacing it with real ML.

This module converts raw deal records from our PostgreSQL database into numeric feature vectors for logistic regression training. The model will predict P(win | features, proposed_margin) and sweep margins to find the optimal recommendation.

## Data Schema — recorded_deals Table

Deals are persisted by `src/analytics.js` via `insertRecordedDeal()`. The table schema (from analytics.js lines 6-37):

```sql
CREATE TABLE IF NOT EXISTS recorded_deals (
    id SERIAL PRIMARY KEY,
    segment VARCHAR(50) NOT NULL,              -- 'SMB', 'MidMarket', 'Enterprise'
    industry VARCHAR(100) NOT NULL,            -- e.g. 'Technology', 'Financial Services'
    product_category VARCHAR(50) NOT NULL,     -- 'Hardware','Software','Cloud','ProfessionalServices','ManagedServices','ComplexSolution'
    deal_reg_type VARCHAR(30) NOT NULL,        -- 'NotRegistered','StandardApproved','PremiumHunting','Teaming'
    competitors VARCHAR(5) NOT NULL,           -- '0','1','2','3+'
    value_add VARCHAR(10) NOT NULL,            -- 'Low','Medium','High'
    relationship_strength VARCHAR(20) NOT NULL, -- 'New','Good','Strategic'
    customer_tech_sophistication VARCHAR(10) NOT NULL, -- 'Low','Medium','High'
    solution_complexity VARCHAR(10) NOT NULL,   -- 'Low','Medium','High'
    var_strategic_importance VARCHAR(10) NOT NULL, -- 'Low','Medium','High'
    customer_price_sensitivity SMALLINT,        -- 1-5, nullable
    customer_loyalty SMALLINT,                  -- 1-5, nullable
    deal_urgency SMALLINT,                      -- 1-5, nullable
    is_new_logo BOOLEAN,                        -- nullable
    solution_differentiation SMALLINT,          -- 1-5, nullable
    oem_cost NUMERIC(12,2) NOT NULL,            -- deal cost in dollars (e.g. 150000.00)
    oem VARCHAR(100),                           -- vendor name: 'Cisco', 'Dell', 'HPE', etc.
    services_attached BOOLEAN,                  -- nullable
    quarter_end BOOLEAN,                        -- nullable
    competitor_names JSONB,                      -- array of strings
    bom_line_count INTEGER DEFAULT 0,
    bom_avg_margin_pct NUMERIC(10,4),           -- nullable
    has_manual_bom BOOLEAN DEFAULT false,
    achieved_margin NUMERIC(10,4) NOT NULL,     -- decimal fraction (0.185 = 18.5%)
    status VARCHAR(10) NOT NULL,                -- 'Won' or 'Lost'
    loss_reason VARCHAR(255) DEFAULT '',
    bom_lines JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    org_id TEXT DEFAULT 'global'                -- tenant isolation
);
```

The `rowToDeal()` function (analytics.js lines 99-130) converts DB rows to JS objects with camelCase keys:
- `row.segment` → `deal.segment`
- `row.oem_cost` → `deal.oemCost` (parseFloat)
- `row.deal_reg_type` → `deal.dealRegType`
- `row.achieved_margin` → `deal.achievedMargin` (parseFloat, stays as decimal fraction)
- etc.

## Create: lambda/server/src/ml/features.js

### Exports:

1. **FEATURE_SPEC** — Array of feature definition objects. Each has:
   - `name`: feature name in output vector
   - `type`: 'continuous' | 'binary' | 'categorical'
   - `source`: function(deal) that extracts raw value from a camelCase deal object
   - `transform`: optional function for continuous features (e.g. Math.log)
   - `categories`: for categorical features, array of possible values (one-hot, drop-last)

   Features to include:

   **Continuous (8):**
   - `deal_size_log`: from `deal.oemCost`, apply `Math.log(x + 1)` to compress range ($5K-$5M → 8.5-15.4)
   - `price_sensitivity`: from `deal.customerPriceSensitivity` (1-5, nullable → impute with 3)
   - `customer_loyalty`: from `deal.customerLoyalty` (1-5, nullable → impute with 3)
   - `deal_urgency`: from `deal.dealUrgency` (1-5, nullable → impute with 3)
   - `solution_differentiation`: from `deal.solutionDifferentiation` (1-5, nullable → impute with 3)
   - `bom_line_count`: from `deal.bomLineCount` (integer, default 0)
   - `competitor_count`: from `deal.competitors` string → number ('0'→0, '1'→1, '2'→2, '3+'→4)
   - `proposed_margin`: injected at inference time (decimal fraction 0-1), not from DB. Training uses `deal.achievedMargin`.

   **Binary (4):**
   - `is_new_logo`: from `deal.isNewLogo` (nullable bool → default false → 0/1)
   - `services_attached`: from `deal.servicesAttached` (nullable bool → default false → 0/1)
   - `quarter_end`: from `deal.quarterEnd` (nullable bool → default false → 0/1)
   - `has_bom`: derived from `deal.bomLineCount > 0` (0/1)

   **Categorical — one-hot encode, drop last category to avoid multicollinearity (6 groups):**
   - `segment`: categories ['SMB', 'MidMarket', 'Enterprise'] → 2 features (drop Enterprise)
   - `deal_reg`: from `deal.dealRegType`, categories ['NotRegistered', 'StandardApproved', 'PremiumHunting'] → 2 features (drop PremiumHunting). Map 'Teaming' → 'StandardApproved'.
   - `complexity`: from `deal.solutionComplexity`, categories ['Low', 'Medium', 'High'] → 2 features
   - `relationship`: from `deal.relationshipStrength`, categories ['New', 'Good', 'Strategic'] → 2 features
   - `oem_top`: from `deal.oem`, categories ['Cisco', 'Dell', 'HPE', 'Microsoft', 'Palo Alto', 'CrowdStrike', 'Other'] → 6 features. Map any OEM not in the list to 'Other'.
   - `product_cat`: from `deal.productCategory`, categories ['Hardware', 'Software', 'Services', 'Other'] → 3 features. Map 'ProfessionalServices'/'ManagedServices' → 'Services', 'Cloud' → 'Software', 'ComplexSolution' → 'Other'.

   **Total feature vector length:** 8 continuous + 4 binary + 2+2+2+2+6+3 one-hot = **29 features**

2. **featurize(deal, normStats, options)** — Transform a single deal object into a feature vector.
   - `deal`: camelCase deal object (from rowToDeal or API input)
   - `normStats`: { means: {name→number}, stds: {name→number} } for z-score normalization
   - `options`: { proposedMargin?: number } — override for proposed_margin at inference time
   - Returns: `{ features: number[], featureNames: string[] }`
   - Continuous features: z-score normalize using `(value - mean) / (std || 1)`. If value is null/undefined, use the mean (equivalent to imputing 0 after normalization).
   - Binary: 0 or 1 (null/undefined → 0)
   - Categorical: one-hot encode, unknown category → all zeros (treated as dropped category)

3. **computeNormStats(deals)** — Compute normalization statistics across an array of deal objects.
   - Only processes continuous features from FEATURE_SPEC
   - Returns: `{ means: { deal_size_log: 11.2, ... }, stds: { deal_size_log: 1.8, ... } }`
   - Standard deviation: use population std (not sample). If std is 0 (all same value), store 1 to avoid division by zero.

4. **FEATURE_DISPLAY_NAMES** — Object mapping feature names (including one-hot names like 'oem_top_Cisco') to human-readable labels. Examples:
   - `deal_size_log` → 'Deal Size'
   - `price_sensitivity` → 'Price Sensitivity'
   - `segment_SMB` → 'SMB Segment'
   - `oem_top_Cisco` → 'Cisco (OEM)'
   - `proposed_margin` → 'Proposed Margin'

5. **competitorToNum(str)** — Helper: '0'→0, '1'→1, '2'→2, '3+'→4

6. **getFeatureCount()** — Returns the expected feature vector length (29)

## Create: lambda/server/src/ml/features.test.js

Use `import { describe, it, expect } from '@jest/globals'` (ES module style).

Tests:
1. `featurize()` with a complete deal → returns vector of length 29 with correct feature names
2. `featurize()` with missing nullable fields → imputes correctly (continuous to mean, binary to 0)
3. `computeNormStats()` → correct mean and std for continuous features across 10 synthetic deals
4. One-hot encoding: 'Cisco' OEM → oem_top_Cisco=1, others=0; unknown OEM → all zeros
5. Log transform: oem_cost of 100000 → deal_size_log ≈ 11.51
6. Competitor string conversion: '3+' → 4
7. `proposedMargin` override works in featurize options
8. Product category mapping: 'ProfessionalServices' → 'Services', 'Cloud' → 'Software'
9. DealReg mapping: 'Teaming' → 'StandardApproved'
10. Edge case: all-same values in computeNormStats → std returns 1 (not 0)

Create branch feat/ml-features, commit, push. Open a PR from the GitHub UI.
```

---

### Prompt 14B: Logistic Regression Implementation [Lambda Node.js] (Sprint 32)

Can run in **parallel** with 14A.

```
You are working on the MarginArc Lambda API in the `mattrothberg2/MarginArc` repo, under lambda/server/.

## Project Setup

- ES modules project ("type": "module" in package.json)
- Test runner: `node --experimental-vm-modules node_modules/.bin/jest`
- Import style: `import { x } from './path.js'` (must include .js extension)
- All new files go under lambda/server/src/ml/ (create the ml/ directory if not exists)
- No external ML libraries — pure Node.js math only

## Context — Why From Scratch

MarginArc runs as an AWS Lambda function. Adding Python/TensorFlow/scikit-learn would balloon the deployment package from 15MB to 500MB+ and add cold-start latency. Logistic regression is simple enough to implement in ~200 lines of JavaScript, and it's the right model for our problem:
- Binary classification (Win/Loss)
- Need P(win) as a calibrated probability (not just a class label)
- Need interpretable feature weights (to explain "why" to sales reps)
- Dataset size: 100-10,000 deals per customer (not big data)
- Margin is a feature — by sweeping it, we find the profit-maximizing price point

## Create: lambda/server/src/ml/logistic-regression.js

### Exports:

1. **train(X, y, options)** — Mini-batch stochastic gradient descent with L2 regularization.
   - `X`: 2D array `[n_samples][n_features]` — numeric feature matrix
   - `y`: 1D array of 0/1 labels (0=Lost, 1=Won)
   - `options` (all optional with defaults):
     - `learningRate`: 0.01
     - `lambda`: 0.01 (L2 regularization strength — prevents overfitting on small datasets)
     - `epochs`: 500 (max iterations through the dataset)
     - `batchSize`: 32
     - `validationSplit`: 0.2 (hold out 20% for early stopping)
     - `earlyStoppingPatience`: 20 (stop if val loss hasn't improved in 20 epochs)
     - `seed`: null (optional seed for reproducible shuffling — use a simple LCG or Fisher-Yates with seed)
   - Algorithm:
     1. Validate inputs: X.length === y.length, X[0].length > 0, y contains only 0s and 1s
     2. Shuffle data (seeded if seed provided)
     3. Split into train (80%) and validation (20%) sets
     4. Initialize: weights = new Array(n_features).fill(0), bias = 0
     5. For each epoch:
        a. Shuffle training set
        b. Process mini-batches of size `batchSize`:
           - For each sample in batch: z = dot(weights, x) + bias, pred = sigmoid(z)
           - Gradient for weights: (1/batch_size) * Σ((pred - y) * x) + lambda * weights
           - Gradient for bias: (1/batch_size) * Σ(pred - y)
           - Update: weights -= learningRate * grad_w, bias -= learningRate * grad_b
        c. Compute training loss (log loss on full training set)
        d. Compute validation loss (log loss on validation set)
        e. If val loss is best so far, save weights snapshot
        f. If no improvement for `patience` epochs, stop and restore best weights
     6. Return model object
   - Returns: `{ weights: number[], bias: number, featureCount: number, epochsRun: number, trainLoss: number, valLoss: number, trainedAt: new Date().toISOString() }`

2. **predict(model, features)** — Single prediction.
   - Compute z = dot(model.weights, features) + model.bias
   - Clip z to [-500, 500] to prevent Math.exp overflow (exp(-501) = 0, exp(501) = Infinity)
   - Return sigmoid(z) = 1 / (1 + Math.exp(-z))
   - Validate: features.length === model.featureCount, throw if mismatch

3. **predictBatch(model, X)** — Predict for each row. Returns array of probabilities.

4. **evaluate(model, X, y)** — Comprehensive model evaluation.
   - Returns `{ auc, logLoss, accuracy, calibration, n }`
   - **AUC** (Area Under ROC Curve):
     1. Get predictions for all samples
     2. Create array of { pred, label } sorted by pred descending
     3. Walk through sorted list tracking true positive rate and false positive rate
     4. Compute AUC via trapezoidal integration
     5. Handle edge cases: all same label → AUC = 0.5
   - **Log Loss**: -(1/n) * Σ(y*log(p) + (1-y)*log(1-p)). Clip p to [1e-15, 1-1e-15] to avoid log(0).
   - **Accuracy**: threshold at 0.5
   - **Calibration**: 10 equal-width bins from 0 to 1. For each bin: `{ bucket: '0.0-0.1', predicted: mean_pred, actual: mean_label, count }`. Skip empty bins.

5. **getFeatureImportance(model, featureNames)** — Feature impact ranking.
   - Returns array sorted by |weight| descending: `[{ name: string, weight: number, absWeight: number, direction: 'positive'|'negative' }]`
   - `direction`: 'positive' if weight > 0 (increases win probability), 'negative' if weight < 0
   - featureNames must have same length as model.weights

6. **serializeModel(model)** → JSON string
   **deserializeModel(json)** → model object. Validate required fields exist.

### Internal helpers (not exported):
- `sigmoid(z)` — 1 / (1 + Math.exp(-clip(z, -500, 500)))
- `dot(a, b)` — inner product of two arrays
- `logLoss(y, p)` — single-sample log loss with clipping
- `shuffle(arr, seed?)` — Fisher-Yates shuffle, optionally seeded

## Create: lambda/server/src/ml/logistic-regression.test.js

Use `import { describe, it, expect } from '@jest/globals'`.

Tests:
1. **Linearly separable data → AUC > 0.95**: Generate 200 points where x[0] > 0 → y=1, x[0] <= 0 → y=0. Train. Evaluate. The model should nearly perfectly separate.
2. **Random data → AUC near 0.5**: Generate 200 points with random features and random labels. AUC should be between 0.35 and 0.65.
3. **L2 regularization effect**: Train same data with lambda=0 and lambda=1. Higher lambda should produce smaller max(|weight|).
4. **Early stopping fires**: On linearly separable data, training should stop well before `epochs` limit (e.g. within 100 epochs for easy data with patience=20).
5. **Serialization round-trip**: Train a model, serialize, deserialize, predict on same data — predictions should be identical (within floating point tolerance 1e-10).
6. **Feature importance correctness**: Generate data where only feature 2 (out of 5) determines the label. After training, feature 2 should have the highest |weight|.
7. **Calibration sanity**: After training on well-separable data, high-confidence predictions (>0.8) should have actual win rate > 0.6.
8. **predict() validates feature length**: Passing wrong-length feature vector should throw.
9. **Edge case: single feature**: Train with 1 feature, verify it works.
10. **Gradient math check**: For a simple case (2 features, 4 samples), manually compute one gradient step and verify weights update correctly.

Create branch feat/ml-logistic-regression, commit, push. Open a PR from the GitHub UI.
```

---

### Prompt 14C: Training Pipeline + Model Storage [Lambda Node.js] (Sprint 33)

**Depends on 14A + 14B.** Make sure both PRs are merged into main before starting.

```
You are working on the MarginArc Lambda API in the `mattrothberg2/MarginArc` repo, under lambda/server/.

## Project Setup

- ES modules project ("type": "module" in package.json)
- Test runner: `node --experimental-vm-modules node_modules/.bin/jest`
- Import style: `import { x } from './path.js'` (must include .js extension)
- Database: PostgreSQL via `src/licensing/db.js` which exports `query(text, params)` and `getSSMParameter(name)`
- DB queries use $1, $2 parameterized syntax (pg library)

## Existing Code You Need to Know

### Database query helper (src/licensing/db.js):
```js
export async function query(text, params) { /* returns { rows, rowCount } */ }
```

### Recorded deals (src/analytics.js):
```js
export async function getRecordedDeals(orgId)  // returns array of camelCase deal objects
```
The `rowToDeal()` function (analytics.js:99-130) converts DB snake_case to camelCase JS objects. The deal objects have fields like: `segment`, `industry`, `productCategory`, `dealRegType`, `competitors`, `oemCost`, `achievedMargin` (decimal fraction like 0.185), `status` ('Won'/'Lost'), etc.

### Phase management (src/phases.js):
```js
export async function getCustomerPhaseById(customerId)  // returns 1, 2, or 3
export async function setCustomerPhase(customerId, phase) // upserts, validates phase in [1,2,3]
```

### Customer → Org resolution (via licenses table):
```sql
SELECT org_id FROM licenses WHERE customer_id = $1 AND status = 'active' AND org_id IS NOT NULL
```

### Schema migration pattern (src/licensing/db.js lines 214-229):
```js
export async function ensureApiKeySchema() {
  const pool = await getPool();
  try {
    await pool.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS api_key VARCHAR(50) UNIQUE`);
    console.log('customers.api_key column ensured');
  } catch (err) {
    if (err.message && err.message.includes('already exists')) {
      console.log('customers.api_key column already exists');
    } else {
      console.error('Failed to add api_key column:', err.message);
    }
  }
}
```

### Cold-start init (index.js lines 44-49):
```js
ensureSalesforceSchema().catch(err => console.error('Failed to ensure Salesforce schema:', err.message))
ensureDocsSchema().catch(err => console.error('Failed to ensure Docs schema:', err.message))
ensureDealsSchema().catch(err => console.error('Failed to ensure deals schema:', err.message))
ensurePhaseSchema().catch(err => console.error('Failed to ensure phase schema:', err.message))
ensureApiKeySchema().catch(err => console.error('Failed to ensure api_key schema:', err.message))
ensureMfaSchema().catch(err => console.error('Failed to ensure MFA schema:', err.message))
```

### customer_config table (current columns):
```
customer_id UUID (PK, FK→customers.id), gemini_api_key VARCHAR(255),
fulcrum_api_url VARCHAR(500), phone_home_interval_days INTEGER,
features JSONB, settings JSONB, updated_at TIMESTAMP, algorithm_phase INTEGER
```

### Admin auth (src/middleware/auth.js):
The admin routes are protected by `verifyToken` middleware (JWT-based). The admin router is at `src/licensing/admin.js`. New admin routes should be added to that router before the `router.use(verifyToken)` line (for unauthed routes) or after it (for authed routes). All ML admin routes should be AFTER verifyToken (authed).

The admin router is mounted in index.js at: `app.use('/admin/api', adminRoutes)`

### ML modules from 14A and 14B:
```js
import { featurize, computeNormStats, FEATURE_SPEC, getFeatureCount } from './ml/features.js'
import { train, evaluate, getFeatureImportance, serializeModel, deserializeModel } from './ml/logistic-regression.js'
```

## Create: lambda/server/src/ml/train.js

### Export: ensureMLSchema()

Add `ml_model JSONB` column to customer_config. Follow the exact pattern from ensureApiKeySchema():
```js
import { query } from '../licensing/db.js'

export async function ensureMLSchema() {
  try {
    await query('ALTER TABLE customer_config ADD COLUMN IF NOT EXISTS ml_model JSONB')
    console.log('customer_config.ml_model column ensured')
  } catch (err) {
    if (err.message?.includes('already exists')) {
      console.log('customer_config.ml_model column already exists')
    } else {
      console.error('Failed to add ml_model column:', err.message)
    }
  }
}
```

### Export: trainCustomerModel(customerId)

This is the main training function. Steps:

1. **Get org_ids** for this customer from the licenses table:
   ```js
   const orgResult = await query(
     'SELECT org_id FROM licenses WHERE customer_id = $1 AND status = \'active\' AND org_id IS NOT NULL',
     [customerId]
   )
   const orgIds = orgResult.rows.map(r => r.org_id).filter(Boolean)
   ```
   If no org_ids, return `{ success: false, reason: 'No active licenses with org_id found' }`

2. **Pull training data** from recorded_deals — all closed deals for this customer's orgs:
   ```sql
   SELECT * FROM recorded_deals WHERE org_id IN ($1, $2, ...) AND status IN ('Won', 'Lost')
   ```
   Convert rows with the same field mapping as `rowToDeal()` in analytics.js.

3. **Validate minimum data requirements**:
   - Total deals >= 100 (statistical minimum for meaningful logistic regression)
   - Won deals >= 20 (need positive examples)
   - Lost deals >= 20 (need negative examples)
   - If not met, return `{ success: false, reason: 'Need X more deals (Y won, Z lost currently)', dealCount: total, wonCount, lostCount }`

4. **Create training samples** — the key insight is teaching margin sensitivity:
   - Each Won deal: `{ ...deal, proposedMargin: deal.achievedMargin, label: 1 }`
   - Each Lost deal: `{ ...deal, proposedMargin: deal.achievedMargin, label: 0 }`
   - **Synthetic augmentation** (teaches model that margin affects win probability):
     - For each Won deal: add a synthetic sample at `achievedMargin + 0.10` with `label: 0` (if you'd asked for 10pp more, you likely would have lost)
     - For each Lost deal: add a synthetic sample at `achievedMargin - 0.05` with `label: 1` (if you'd priced 5pp lower, you might have won)
     - Cap synthetic margins to [0.01, 0.55] range

5. **Compute normalization stats** from all training samples (including synthetic): `computeNormStats(allSamples)`

6. **Featurize all samples**: For each sample, call `featurize(deal, normStats, { proposedMargin: sample.proposedMargin })`. Collect into X (2D array) and y (labels array).

7. **Train the model**:
   ```js
   const model = train(X, y, {
     learningRate: 0.01,
     lambda: 0.01,
     epochs: 500,
     batchSize: 32,
     validationSplit: 0.2,
     earlyStoppingPatience: 20
   })
   ```

8. **Evaluate on ORIGINAL deals only** (not synthetic) — this gives honest metrics:
   - Re-featurize only the real Won/Lost deals
   - Call `evaluate(model, X_real, y_real)`

9. **Get feature importance**: `getFeatureImportance(model, featureNames)`

10. **Store model package** as JSON in customer_config.ml_model:
    ```js
    const modelPackage = {
      model: serializeModel(model),    // { weights, bias, featureCount, ... }
      normStats,                        // { means, stds }
      featureNames,                     // from featurize output
      metrics: evaluationResult,        // { auc, logLoss, accuracy, calibration, n }
      importance: topFeatures,          // from getFeatureImportance
      dealCount: realDeals.length,
      trainedAt: new Date().toISOString(),
      version: 1                        // for future schema migrations
    }
    await query(
      'UPDATE customer_config SET ml_model = $1 WHERE customer_id = $2',
      [JSON.stringify(modelPackage), customerId]
    )
    ```

11. **Auto-promote to Phase 2** if model is good enough:
    ```js
    const currentPhase = await getCustomerPhaseById(customerId)
    if (evaluationResult.auc >= 0.60 && realDeals.length >= 100 && currentPhase < 2) {
      await setCustomerPhase(customerId, 2)
    }
    ```

12. **Return result**:
    ```js
    return {
      success: true,
      metrics: { auc, logLoss, accuracy, n: realDeals.length },
      dealCount: realDeals.length,
      syntheticCount: allSamples.length - realDeals.length,
      topFeatures: topFeatures.slice(0, 10),
      phase: await getCustomerPhaseById(customerId),
      epochsRun: model.epochsRun
    }
    ```

### Export: getModel(customerId)

Load the model package from customer_config:
```js
export async function getModel(customerId) {
  const result = await query('SELECT ml_model FROM customer_config WHERE customer_id = $1', [customerId])
  if (result.rows.length === 0 || !result.rows[0].ml_model) return null
  return result.rows[0].ml_model  // PostgreSQL auto-parses JSONB
}
```

### Export: getModelByOrgId(orgId)

Resolve org_id → customer_id → model (needed by /api/recommend):
```js
export async function getModelByOrgId(orgId) {
  if (!orgId) return null
  const result = await query(
    `SELECT cc.ml_model FROM customer_config cc
     JOIN licenses l ON l.customer_id = cc.customer_id
     WHERE l.org_id = $1 AND l.status = 'active'
     LIMIT 1`,
    [orgId]
  )
  return result.rows.length > 0 ? result.rows[0].ml_model : null
}
```

## Modify: lambda/server/index.js

### Add to imports (near line 40):
```js
import { ensureMLSchema, getModelByOrgId } from './src/ml/train.js'
```

### Add to cold-start init (after line 49):
```js
ensureMLSchema().catch(err => console.error('Failed to ensure ML schema:', err.message))
```

### Add admin routes to src/licensing/admin.js

Add these routes AFTER the `router.use(verifyToken)` line:

```js
// ML training endpoints
router.post('/ml/train/:customerId', async (req, res) => {
  try {
    const { trainCustomerModel } = await import('../ml/train.js')
    const result = await trainCustomerModel(req.params.customerId)
    res.json(result)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/ml/model/:customerId', async (req, res) => {
  try {
    const { getModel } = await import('../ml/train.js')
    const modelPkg = await getModel(req.params.customerId)
    if (!modelPkg) return res.status(404).json({ error: 'No trained model' })
    // Don't expose raw weights — just metadata
    res.json({
      metrics: modelPkg.metrics,
      dealCount: modelPkg.dealCount,
      topFeatures: modelPkg.importance?.slice(0, 10),
      trainedAt: modelPkg.trainedAt,
      version: modelPkg.version
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})
```

## Testing: lambda/server/src/ml/train.test.js

Use `import { describe, it, expect, jest } from '@jest/globals'`.

**Mock the database** — do NOT connect to real PostgreSQL. Mock `../licensing/db.js`:
```js
jest.unstable_mockModule('../licensing/db.js', () => ({
  query: jest.fn(),
  getSSMParameter: jest.fn()
}))
```
Then dynamically import after mocking:
```js
const { query } = await import('../licensing/db.js')
const { trainCustomerModel, getModel } = await import('./train.js')
```

Set up query mock to return:
- For `SELECT org_id FROM licenses...`: return `{ rows: [{ org_id: 'test_org' }] }`
- For `SELECT * FROM recorded_deals...`: return 150 synthetic deal rows (80 Won, 70 Lost) with varying features and margins
- For `SELECT algorithm_phase FROM customer_config...`: return `{ rows: [{ algorithm_phase: 1 }] }`
- For `UPDATE customer_config SET ml_model...`: return `{ rowCount: 1 }`
- For `INSERT INTO customer_config...`: return `{ rowCount: 1 }`

Generate synthetic deals: randomize segment, competitors, oemCost ($10K-$500K), achievedMargin (0.08-0.30), with Won deals tending to have lower margins and stronger deal structure (creates a learnable signal).

Tests:
1. Training completes successfully with 150 deals → returns `{ success: true }`
2. AUC > 0.5 (model learned something from the data)
3. Returns correct dealCount and topFeatures
4. Rejects when < 100 deals → returns `{ success: false, reason: ... }`
5. Rejects when < 20 Won or < 20 Lost deals
6. Model is stored via UPDATE query with valid JSON
7. Auto-promotes to Phase 2 when AUC >= 0.60
8. getModel returns null when no model exists

Create branch feat/ml-training-pipeline, commit, push. Open a PR from the GitHub UI.
```

---

### Prompt 14D: ML Inference — Replace Rules Engine [Lambda Node.js] (Sprint 33)

**Depends on 14C.** Make sure PR is merged into main before starting.

```
You are working on the MarginArc Lambda API in the `mattrothberg2/MarginArc` repo, under lambda/server/.

## Project Setup

- ES modules project ("type": "module" in package.json)
- Test runner: `node --experimental-vm-modules node_modules/.bin/jest`
- Import style: `import { x } from './path.js'` (must include .js extension)

## Business Context

When a sales rep opens an Opportunity in Salesforce and clicks "Get Recommendation," the LWC calls our Apex controller which calls POST /api/recommend on this Lambda. Currently, we use a hardcoded rules engine. Now, if a customer has a trained ML model, we use it instead. The rules engine stays as a fallback.

The key insight: the ML model predicts P(win | features, proposed_margin). By sweeping `proposed_margin` from 5% to 35%, we find the margin that maximizes Expected GP = margin × deal_value × P(win). This gives the rep three options: conservative (safe), optimal (max ROI), and aggressive (max margin).

## Existing /api/recommend Handler (index.js lines 474-608)

Here is the CURRENT flow — you'll modify it, not replace it:

```js
app.post('/api/recommend', async (req, res) => {
  try {
    const input = DealInput.parse(req.body?.input)
    const planned = typeof req.body?.plannedMarginPct === 'number' ? req.body.plannedMarginPct : null
    const manualBomLines = Array.isArray(req.body?.bomLines) ? BomLinesInput.parse(req.body.bomLines) : []
    const manualStats = manualBomLines.length ? computeManualBomStats(manualBomLines) : null

    const orgId = req.headers['x-org-id'] || null
    let phase = 1
    try { phase = await getCustomerPhase(orgId) } catch (phaseErr) { /* ... */ }

    const deals = await fetchAllDeals(sampleDeals, orgId)
    const rec = await computeRecommendation(input, deals, { bomStats: manualStats })
    // ... (BOM override, Gemini AI, deal score computation)

    // Phase 1: Returns dealScore but suggestedMarginPct: null
    if (phase === 1) {
      return res.json({
        dealScore, scoreFactors, topDrivers, phase1Guidance, dataQuality,
        suggestedMarginPct: null,  // <-- THIS IS THE PROBLEM (no value!)
        suggestedPrice: null,
        winProbability: rec.winProbability, confidence: rec.confidence,
        method: rec.method, drivers: rec.drivers, policyFloor: rec.policyFloor,
        phaseInfo: { current: 1, message: '...', nextPhaseReady: false }
      })
    }

    // Phase 2/3: Full recommendation
    return res.json({ ...response, explanation, qualitativeSummary, metrics, bom, ... })
  } catch (e) { ... }
})
```

### Current imports at top of index.js (relevant ones):
```js
import { computeRecommendation } from './src/rules.js'               // line 14
import { assessPredictionQuality } from './src/quality.js'            // line 18
import { ensurePhaseSchema, getCustomerPhase, computeDealScore, generateTopDrivers, generatePhase1Guidance } from './src/phases.js'  // line 40
```

### ML modules available from 14A-14C:
```js
// These are the new imports you'll add:
import { getModelByOrgId } from './src/ml/train.js'
import { recommendMargin } from './src/ml/inference.js'  // the file you create below
import { generateBenchmarkResponse } from './src/ml/benchmarks.js'  // from 14E (may not exist yet, guard it)
```

## Create: lambda/server/src/ml/inference.js

### Export: recommendMargin(dealInput, modelPackage)

Parameters:
- `dealInput`: the DealInput object from the API request (camelCase, from Zod validation)
- `modelPackage`: the JSONB object from customer_config.ml_model containing { model (serialized), normStats, featureNames, metrics, importance }

Algorithm:
1. Deserialize the model: `deserializeModel(modelPackage.model)`
2. Load normStats from modelPackage
3. **Margin sweep**: iterate `proposedMargin` from 0.05 to 0.35 in 0.005 steps (61 points):
   - For each margin value:
     a. Create deal with proposed margin: `const featureResult = featurize(dealInput, normStats, { proposedMargin: margin })`
     b. Predict: `const pWin = predict(model, featureResult.features)`
     c. Compute expected GP: `const sellPrice = dealInput.oemCost / (1 - margin)`, `const gp = sellPrice - dealInput.oemCost`, `const expectedGP = gp * pWin`
     d. Store: `{ margin, pWin, expectedGP, sellPrice, gp }`

4. **Find three margin options**:
   - `optimal`: the margin with highest `expectedGP` (best risk-adjusted return)
   - `conservative`: the HIGHEST margin where `pWin >= 0.70` (safe bet)
   - `aggressive`: the HIGHEST margin where `pWin >= 0.45` (push the envelope)
   - If no margin meets conservative threshold, use the margin with highest pWin
   - If no margin meets aggressive threshold, use optimal

5. **Generate key drivers** from feature importance + deal's actual feature values:
   - Take top 5 features from `modelPackage.importance`
   - For each: look up the feature's actual value in the deal, compute its contribution to the prediction (weight × normalized_value), generate a human-readable sentence using FEATURE_DISPLAY_NAMES
   - Each driver: `{ name: string, sentence: string, impact: number (in percentage points), direction: 'positive'|'negative' }`

6. **Compute confidence**: `computeConfidence(modelPackage, dealInput)`

7. **Build GP curve** for frontend chart: every 3rd point from the sweep → `[{ margin: 5.0, pWin: 82, expectedGP: 12500 }, ...]`

8. **Return**:
   ```js
   {
     suggestedMarginPct: optimal.margin * 100,      // e.g. 18.5
     conservativeMarginPct: conservative.margin * 100,
     aggressiveMarginPct: aggressive.margin * 100,
     winProbability: optimal.pWin,                    // 0-1
     expectedGP: optimal.expectedGP,                  // dollar amount
     confidence: confidence,                           // 0-1
     keyDrivers: drivers,                              // array of 5 driver objects
     expectedGPCurve: curvePoints,                     // for chart
     modelMetrics: {
       auc: modelPackage.metrics.auc,
       dealCount: modelPackage.dealCount,
       trainedAt: modelPackage.trainedAt
     },
     source: 'ml_model'
   }
   ```

### Export: computeConfidence(modelPackage, dealInput)

Confidence is a 0-1 score reflecting how much we trust this specific prediction:
- Base = (AUC - 0.5) × 2 — maps AUC 0.5→0, AUC 1.0→1
- Data factor = min(1, dealCount / 500) — more training data = more confident
- Return: clamp(base × dataFactor, 0.1, 0.95)

## Modify: lambda/server/index.js — /api/recommend handler

**IMPORTANT: Do NOT delete rules.js or change computeRecommendation. Keep the existing code as fallback.**

### Add imports at the top (after existing imports, around line 40):
```js
import { getModelByOrgId } from './src/ml/train.js'
import { recommendMargin } from './src/ml/inference.js'
```

### Modify the handler — new flow (insert AFTER phase lookup, BEFORE the existing rules engine call):

After line 491 (where `phase` is determined), add ML model lookup:
```js
    // Try to load ML model for this customer
    let modelPackage = null
    try {
      modelPackage = await getModelByOrgId(orgId)
    } catch (mlErr) {
      structuredLog('warn', 'ml_model_lookup_failed', { orgId, error: mlErr?.message })
    }
```

Then restructure the response logic into 3 tiers:

**Tier 1 — ML Model (Phase 2+, has model with AUC >= 0.55):**
```js
    if (modelPackage && modelPackage.metrics?.auc >= 0.55) {
      // ML inference
      const mlResult = recommendMargin(input, modelPackage)
      // Still compute deal score using ML's values
      const predictionQuality = assessPredictionQuality(input, { confidence: mlResult.confidence })
      const { dealScore, scoreFactors } = computeDealScore({
        plannedMarginPct: planned,
        suggestedMarginPct: mlResult.suggestedMarginPct,
        winProbability: mlResult.winProbability,
        confidence: mlResult.confidence,
        predictionQuality
      })
      return res.json({
        ...mlResult,                  // suggestedMarginPct, conservativeMarginPct, aggressiveMarginPct, etc.
        dealScore, scoreFactors,
        topDrivers: mlResult.keyDrivers.map(d => d.sentence),
        predictionQuality,
        phaseInfo: { current: phase },
        source: 'ml_model'
      })
    }
```

**Tier 2 — Phase 1 (keep existing Phase 1 code, but add `source: 'rules_engine'`):**
The existing Phase 1 block (lines 563-584) stays mostly the same. Just add `source: 'rules_engine'` to the response object.

**NOTE: If 14E (benchmarks) has been merged, replace the Phase 1 block with benchmark-based response. But if 14E hasn't been merged yet, just add the source field. 14E will handle its own integration.**

**Tier 3 — Rules Engine fallback (existing Phase 2/3 code):**
Add `source: 'rules_engine'` to the Phase 2/3 response object.

### Summary of changes to /api/recommend:
1. Add `getModelByOrgId` import and `recommendMargin` import
2. After phase lookup, try to load ML model
3. If model exists and AUC >= 0.55, use ML inference (new code)
4. If Phase 1, use existing Phase 1 code + `source` field
5. If Phase 2/3 without model, use existing rules engine + `source` field
6. `source` field is present in ALL code paths

## Testing: lambda/server/src/ml/inference.test.js

Use `import { describe, it, expect } from '@jest/globals'`.

Create a mock model package with known weights (don't train — just set weights directly so tests are deterministic):
- 29 features (matching getFeatureCount())
- Set the proposed_margin weight to a large negative value (e.g. -5.0) so higher margin → lower pWin
- Set a few other weights to known values

Tests:
1. **Monotonic pWin decrease**: As margin increases from 5% to 35%, pWin should strictly decrease (because proposed_margin weight is negative)
2. **Optimal margin maximizes expectedGP**: The optimal margin should NOT be the lowest margin (0% GP) or the highest margin (0% win prob), but somewhere in the middle
3. **Conservative has higher pWin than aggressive**: conservative.pWin should be >= aggressive.pWin
4. **Three options are in correct order**: conservativeMarginPct <= suggestedMarginPct <= aggressiveMarginPct
5. **Confidence calculation**: AUC=0.75, dealCount=200 → confidence should be between 0.1 and 0.95
6. **Key drivers are generated**: result.keyDrivers should have 5 items with name, sentence, impact, direction
7. **GP curve has points**: result.expectedGPCurve should be a non-empty array
8. **Source is 'ml_model'**: result.source === 'ml_model'

Create branch feat/ml-inference, commit, push. Open a PR from the GitHub UI.
```

---

### Prompt 14E: Industry Benchmarks for Phase 1 [Lambda Node.js] (Sprint 33)

Can run in **parallel** with 14C/14D (standalone module, no dependencies on ML training).

```
You are working on the MarginArc Lambda API in the `mattrothberg2/MarginArc` repo, under lambda/server/.

## Project Setup

- ES modules project ("type": "module" in package.json)
- Test runner: `node --experimental-vm-modules node_modules/.bin/jest`
- Import style: `import { x } from './path.js'` (must include .js extension)
- New file goes under lambda/server/src/ml/ directory

## Business Context — Why This Matters

Phase 1 customers currently see `suggestedMarginPct: null` — the UI shows "Score your deals to build your data foundation" with no actual margin guidance. This is terrible for adoption because:
- A VAR sales rep opens an Opportunity, clicks "Get Recommendation," and gets... nothing useful
- They need to score 50+ deals before getting any margin guidance
- Most will churn before reaching that threshold

**Fix:** Return industry-standard margin benchmarks based on OEM, customer segment, and deal size. Not ML — just curated data from public earnings reports, distributor surveys, and industry knowledge. Still useful from Day 1.

## Current Phase 1 Response (index.js lines 563-584)

```js
if (phase === 1) {
  return res.json({
    dealScore, scoreFactors, topDrivers, phase1Guidance, dataQuality,
    suggestedMarginPct: null,        // <-- REPLACE THIS
    suggestedPrice: null,            // <-- REPLACE THIS
    winProbability: response.winProbability,
    confidence: response.confidence,
    method: response.method,
    drivers: response.drivers,
    policyFloor: response.policyFloor,
    phaseInfo: {
      current: 1,
      message: 'Score your deals to build your data foundation. Margin recommendations unlock at Phase 2.',
      nextPhaseReady: false
    }
  })
}
```

## OEM Margin Context from Current Rules Engine (rules.js)

The rules engine already has OEM-specific adjustments (rules.js lines 27-38):
```js
const OEM_MARGIN_ADJ = {
  Cisco: 0.01, 'Palo Alto': 0.015, Fortinet: 0.005, HPE: 0,
  Dell: -0.005, VMware: 0.01, Microsoft: -0.01, 'Pure Storage': 0.015,
  NetApp: 0.005, Arista: 0.01
}
```

These are adjustments around a ~17% midpoint, but they're too granular. The benchmarks module should use broader, more defensible ranges.

## DealInput Fields Available (from Zod schema in index.js)

The `input` object has these fields you can use for benchmark lookup:
- `input.oem` (string, optional) — OEM vendor name like 'Cisco', 'Dell', 'HPE'
- `input.customerSegment` (enum: 'SMB', 'MidMarket', 'Enterprise')
- `input.oemCost` (number, required) — deal cost in dollars, use as deal size proxy
- `input.dealRegType` (enum: 'NotRegistered', 'StandardApproved', 'PremiumHunting', 'Teaming')
- `input.competitors` (enum: '0', '1', '2', '3+')
- `input.servicesAttached` (boolean, optional)
- `input.productCategory` (enum: 'Hardware', 'Software', 'Cloud', 'ProfessionalServices', 'ManagedServices', 'ComplexSolution')

## Create: lambda/server/src/ml/benchmarks.js

### BENCHMARKS constant

Nested object structure: `OEM → Segment → SizeBucket → { p25, median, p75, source }`

The margins are percentage points (e.g. 15 means 15%). Source is a string describing where the benchmark comes from (for display in UI).

Include these OEMs with realistic IT VAR margins (based on typical distributor margins, public data from Tech Data/Ingram reports, and VAR industry knowledge):

| OEM | Enterprise Large | Enterprise Small | MidMarket | SMB |
|-----|-----------------|-----------------|-----------|-----|
| Cisco | 10-14-17% | 12-16-20% | 15-19-24% | 18-23-28% |
| Dell | 8-12-16% | 10-14-18% | 14-18-23% | 18-22-27% |
| HPE | 9-13-17% | 11-15-19% | 15-19-24% | 19-23-28% |
| Microsoft | 12-16-22% | 14-18-24% | 18-22-28% | 22-26-32% |
| Palo Alto | 12-16-20% | 14-18-23% | 18-22-27% | 22-26-32% |
| CrowdStrike | 18-22-28% | 20-24-30% | 22-26-32% | 25-30-35% |
| Fortinet | 12-15-20% | 14-18-22% | 16-20-25% | 20-24-28% |
| VMware | 10-14-18% | 12-16-20% | 16-20-25% | 20-24-30% |
| Pure Storage | 12-16-22% | 14-18-24% | 18-22-28% | 22-26-32% |
| _default | 10-14-18% | 12-16-20% | 14-18-23% | 18-22-27% |

Size buckets (based on `oemCost`):
- `<$25K` → use SMB margins even for larger segments (small deals have more margin room)
- `$25K-$100K` → use segment-appropriate margins
- `$100K-$500K` → use segment-appropriate margins
- `$500K-$1M` → compress 2pp from base (big deals = price pressure)
- `$1M+` → compress 4pp from base (mega deals = significant compression)

### getSizeBucket(oemCost)

Returns string: '<$25K', '$25K-$100K', '$100K-$500K', '$500K-$1M', '$1M+'

### getBenchmark(oem, segment, oemCost)

Cascading lookup:
1. Try exact OEM + segment + size-adjusted
2. Fall back to OEM + segment (ignore size)
3. Fall back to `_default` + segment
4. Final fallback: `{ p25: 12, median: 16, p75: 22, source: 'General IT VAR benchmark' }`

Apply size compression:
- For $500K-$1M: subtract 2 from each (p25, median, p75), floor at 5
- For $1M+: subtract 4 from each, floor at 5

Returns: `{ low: p25, median, high: p75, source: string, specificity: 'oem_segment'|'oem_default'|'general' }`

### generateBenchmarkResponse(dealInput)

Takes the validated DealInput object and returns a response object:

```js
{
  suggestedMarginPct: benchmark.median,           // e.g. 18.0
  suggestedMarginRange: { low: benchmark.low, high: benchmark.high },  // e.g. { low: 14, high: 23 }
  suggestedPrice: dealInput.oemCost / (1 - benchmark.median / 100),   // sell price at median margin
  benchmarkSource: benchmark.source,               // e.g. 'Cisco Enterprise benchmark'
  benchmarkSpecificity: benchmark.specificity,      // how precise the lookup was
  insights: generateInsights(dealInput, benchmark), // contextual tips
  source: 'industry_benchmark'                      // tells LWC to render benchmark UI
}
```

### generateInsights(dealInput, benchmark) — internal helper

Returns array of 2-4 contextual strings based on deal attributes:
- If `dealRegType` !== 'NotRegistered': "Deal registration typically supports 2-4pp above median"
- If `competitors` === '3+': "3+ competitors typically compress margins 2-3pp below median"
- If `servicesAttached`: "Services-attached deals achieve 3-5pp higher blended margins"
- If `productCategory` includes 'Services' or 'Managed': "Services/managed categories support premium margins"
- If deal size > $500K: "Large deal sizes ($500K+) create 2-4pp margin compression"
- Always include: "These ranges are industry benchmarks — your ML model will personalize after 100 closed deals"

Limit to 4 insights max.

## Modify: lambda/server/index.js — Wire benchmarks into Phase 1

### Add import (near other ML imports):
```js
import { generateBenchmarkResponse } from './src/ml/benchmarks.js'
```

### Replace the Phase 1 response block (lines 563-584):

```js
if (phase === 1) {
  // Generate benchmark-based recommendation for Phase 1
  const benchmarkData = generateBenchmarkResponse(input)
  const phase1Guidance = generatePhase1Guidance(response.drivers, input)

  return res.json({
    dealScore, scoreFactors, topDrivers, phase1Guidance, dataQuality,
    suggestedMarginPct: benchmarkData.suggestedMarginPct,     // NOW HAS A VALUE!
    suggestedMarginRange: benchmarkData.suggestedMarginRange, // NEW: { low, high }
    suggestedPrice: benchmarkData.suggestedPrice,             // NOW HAS A VALUE!
    benchmarkSource: benchmarkData.benchmarkSource,           // NEW
    benchmarkInsights: benchmarkData.insights,                // NEW
    winProbability: response.winProbability,
    confidence: response.confidence,
    method: response.method,
    drivers: response.drivers,
    policyFloor: response.policyFloor,
    phaseInfo: {
      current: 1,
      message: 'Industry benchmark guidance active. ML recommendations unlock after 100 closed deals with outcomes.',
      nextPhaseReady: false
    },
    source: 'industry_benchmark'                               // NEW
  })
}
```

## Testing: lambda/server/src/ml/benchmarks.test.js

Use `import { describe, it, expect } from '@jest/globals'`.

Tests:
1. Cisco + Enterprise + $250K deal → returns Cisco-specific range (not default)
2. Unknown OEM ('Juniper') → falls back to _default range
3. $1M+ deal → margins are compressed 4pp vs base
4. SMB + $10K deal → returns SMB-level margins (higher than Enterprise)
5. Deal with 3+ competitors → insights include competition warning
6. Deal with services attached → insights include services uplift mention
7. Always includes "ML model will personalize" caveat in insights
8. generateBenchmarkResponse returns all required fields including `source: 'industry_benchmark'`
9. getSizeBucket correctly categorizes: $5K → '<$25K', $50K → '$25K-$100K', $750K → '$500K-$1M'
10. Margin floors: even $5M deal shouldn't go below 5% benchmark

Create branch feat/ml-benchmarks, commit, push. Open a PR from the GitHub UI.
```

---

### Prompt 14F: LWC Updates — ML Recommendations Display [SFDC LWC] (Sprint 34)

**Depends on 14D + 14E.** Make sure both PRs are merged into main before starting.

```
You are working on the MarginArc SFDC package in the `mattrothberg2/MarginArc` repo, under sfdc/.

## Context — What Changed in the API

The Lambda API now returns different response shapes based on `source`:

### Phase 1 Response (source: 'industry_benchmark'):
```json
{
  "dealScore": 52,
  "scoreFactors": { "marginAlignment": {...}, "winProbability": {...}, ... },
  "suggestedMarginPct": 18.0,
  "suggestedMarginRange": { "low": 14, "high": 23 },
  "suggestedPrice": 182926.83,
  "benchmarkSource": "Cisco Enterprise benchmark",
  "benchmarkInsights": ["Deal registration typically supports 2-4pp above median", ...],
  "winProbability": 0.62,
  "confidence": 0.45,
  "source": "industry_benchmark",
  "phaseInfo": { "current": 1, "message": "..." }
}
```

### Phase 2+ Response with ML (source: 'ml_model'):
```json
{
  "suggestedMarginPct": 18.5,
  "conservativeMarginPct": 15.2,
  "aggressiveMarginPct": 22.0,
  "winProbability": 0.68,
  "expectedGP": 27750,
  "confidence": 0.72,
  "keyDrivers": [
    { "name": "proposed_margin", "sentence": "Margin level is the strongest factor in win probability", "impact": -3.2, "direction": "negative" },
    { "name": "deal_reg", "sentence": "Premium deal registration adds margin protection", "impact": 2.1, "direction": "positive" }
  ],
  "expectedGPCurve": [{ "margin": 5.0, "pWin": 92, "expectedGP": 7500 }, ...],
  "modelMetrics": { "auc": 0.71, "dealCount": 312, "trainedAt": "2026-02-15T..." },
  "dealScore": 68,
  "scoreFactors": { ... },
  "source": "ml_model",
  "phaseInfo": { "current": 2 }
}
```

### Phase 2+ Response without ML (source: 'rules_engine') — unchanged from current.

## File: sfdc/force-app/main/default/lwc/marginarcMarginAdvisor/marginarcMarginAdvisor.js

**This file is 2671 lines long.** Key locations:

- **Tracked properties**: Lines 56-81 (recordId, isLoading, recommendation, opportunityData, etc.)
- **phase1Tips getter**: Lines 594-654 — builds array of insight objects from topDrivers, phase1Guidance, scoreFactors
- **fetchRecommendation()**: Lines 1908-2042 — main API call flow. Assigns `this.recommendation = recommendation` at line 2010.
- **dealScoreData getter**: Lines 2315-2350 — extracts score from API response
- **dealScoreFactors getter**: Lines 2372-2419 — **BUG: expects array but API returns object** (this is the crash from prompt 12D — check if it's been fixed. If `scoreFactors` is still an object, convert to array first with `Object.entries()`)
- **recommendedMargin getter**: Line 842 — `this.recommendation?.suggestedMarginPct?.toFixed(1) || '0.0'`
- **toggleDetails()**: Lines 423-435 — expands/collapses detail panel

## File: sfdc/force-app/main/default/lwc/marginarcMarginAdvisor/marginarcMarginAdvisor.html

**This file is 709 lines.** Key sections:

- **Deal Score Hero**: Lines 30-109 — dark navy card with score, spectrum bar, phase1 tips
- **Score Summary Line**: Lines 112-127 — `lwc:if={isPhaseOne}` shows label; `lwc:if={isNotPhaseOne}` shows margin
- **Phase 1 Callout**: Lines 156-187 — progress bar toward threshold
- **Recommended Margin Callout**: Lines 202-215 — `lwc:if={showMarginRecommendation}` (phase >= 2)
- **Expandable Details Panel**: Lines 287-619 — comparison table, drivers, AI summary, history, BOM

## File: sfdc/force-app/main/default/lwc/marginarcMarginAdvisor/marginarcMarginAdvisor.css

**This file is 2173 lines.** Key design tokens:

```css
:host {
  --navy-900: #0a1a2f; --navy-800: #0f2744; --navy-700: #1a3a5c;
  --teal-500: #02b1b5; --teal-400: #14c8cc; --teal-600: #019a9e;
  --slate-50: #f8fafc; --slate-200: #e2e8f0; --slate-500: #64748b;
  --red-500: #ef4444; --green-500: #22c55e;
}
```

## Changes to Make

### Change 1: Source Detection Getters (add after line ~870 in JS)

```js
get recommendationSource() {
  return this.recommendation?.source || 'rules_engine';
}
get isMLRecommendation() {
  return this.recommendationSource === 'ml_model';
}
get isBenchmarkRecommendation() {
  return this.recommendationSource === 'industry_benchmark';
}
get hasMarginRange() {
  return this.recommendation?.suggestedMarginRange != null;
}
get marginRangeLow() {
  return this.recommendation?.suggestedMarginRange?.low || 0;
}
get marginRangeHigh() {
  return this.recommendation?.suggestedMarginRange?.high || 0;
}
get benchmarkSource() {
  return this.recommendation?.benchmarkSource || 'Industry benchmark';
}
get hasConservativeMargin() {
  return this.recommendation?.conservativeMarginPct != null;
}
get conservativeMarginPct() {
  return this.recommendation?.conservativeMarginPct?.toFixed(1) || '0.0';
}
get aggressiveMarginPct() {
  return this.recommendation?.aggressiveMarginPct?.toFixed(1) || '0.0';
}
get hasMLKeyDrivers() {
  return this.isMLRecommendation && Array.isArray(this.recommendation?.keyDrivers) && this.recommendation.keyDrivers.length > 0;
}
get mlKeyDrivers() {
  return (this.recommendation?.keyDrivers || []).map((d, i) => ({
    id: `driver-${i}`,
    sentence: d.sentence,
    impact: d.impact > 0 ? `+${d.impact.toFixed(1)}pp` : `${d.impact.toFixed(1)}pp`,
    isPositive: d.direction === 'positive',
    isNegative: d.direction === 'negative',
    iconName: d.direction === 'positive' ? 'utility:arrowup' : 'utility:arrowdown',
    impactClass: d.direction === 'positive' ? 'driver-impact-positive' : 'driver-impact-negative'
  }));
}
get hasModelMetrics() {
  return this.recommendation?.modelMetrics != null;
}
get modelMetricsDisplay() {
  const m = this.recommendation?.modelMetrics;
  if (!m) return '';
  const deals = m.dealCount || 0;
  const accuracy = m.auc ? Math.round(m.auc * 100) : 0;
  const trained = m.trainedAt ? new Date(m.trainedAt).toLocaleDateString() : 'unknown';
  return `Model trained on ${deals} deals | Accuracy: ${accuracy}% | Last trained: ${trained}`;
}
```

### Change 2: Update phase1Tips Getter (lines 594-654)

Add benchmark insights as a new source at the TOP of the priority chain. Before the existing topDrivers check (line 598), add:

```js
// Priority 0: Benchmark insights (Phase 1 with industry_benchmark source)
const benchmarkInsights = this.recommendation?.benchmarkInsights;
if (Array.isArray(benchmarkInsights) && benchmarkInsights.length > 0) {
  benchmarkInsights.forEach((text, i) => {
    tips.push({ id: `benchmark-${i}`, icon: 'utility:trending', text });
  });
}
```

### Change 3: Phase 1 Benchmark Range Display (HTML)

Replace the **Phase 1 Callout** section (lines 156-187) with a benchmark-aware version. When `isBenchmarkRecommendation`:

- Show a visual margin range bar (horizontal bar from `marginRangeLow` to `marginRangeHigh` with the median marked and the rep's planned margin as a colored indicator)
- Show text: "Based on {benchmarkSource}" (e.g. "Based on Cisco Enterprise benchmark")
- Position assessment: if planned margin is within range → green "In Range"; below → amber "Below Benchmark"; above → red "Above Benchmark"
- Caveat text: "Personalized ML recommendations unlock after 100 closed deals"

When NOT `isBenchmarkRecommendation` (old behavior), keep the existing progress-bar-toward-threshold UI.

### Change 4: Phase 2 Three Margin Options (HTML)

When `isMLRecommendation` AND `hasConservativeMargin`, replace the single "Recommended Margin" callout (lines 202-215) with a 3-column card layout:

```html
<div class="margin-options-grid">
  <div class="margin-option margin-option-conservative">
    <div class="margin-option-label">Conservative</div>
    <div class="margin-option-value">{conservativeMarginPct}%</div>
    <div class="margin-option-detail">Higher win probability</div>
  </div>
  <div class="margin-option margin-option-optimal">
    <div class="margin-option-badge">Best ROI</div>
    <div class="margin-option-label">Recommended</div>
    <div class="margin-option-value">{recommendedMargin}%</div>
    <div class="margin-option-detail">Max expected GP</div>
  </div>
  <div class="margin-option margin-option-aggressive">
    <div class="margin-option-label">Aggressive</div>
    <div class="margin-option-value">{aggressiveMarginPct}%</div>
    <div class="margin-option-detail">Higher margin</div>
  </div>
</div>
```

When NOT ML but still Phase 2+ (rules engine), keep the existing single margin callout.

### Change 5: ML Key Drivers Section (HTML)

In the expandable details panel, when `hasMLKeyDrivers`, show a "Key Drivers (learned from your data)" section ABOVE the existing drivers section:

```html
<template lwc:if={hasMLKeyDrivers}>
  <div class="ml-drivers-section">
    <div class="section-header">Key Drivers <span class="ml-badge">Learned from your data</span></div>
    <template for:each={mlKeyDrivers} for:item="driver">
      <div key={driver.id} class="ml-driver-row">
        <lightning-icon icon-name={driver.iconName} size="x-small" class={driver.impactClass}></lightning-icon>
        <span class="ml-driver-text">{driver.sentence}</span>
        <span class={driver.impactClass}>{driver.impact}</span>
      </div>
    </template>
  </div>
</template>
```

### Change 6: Model Transparency (HTML)

In the expanded details panel (at the bottom, before the Collapse All button at line 610), add:

```html
<template lwc:if={hasModelMetrics}>
  <div class="model-transparency">
    <lightning-icon icon-name="utility:info" size="xx-small"></lightning-icon>
    <span class="model-transparency-text">{modelMetricsDisplay}</span>
  </div>
</template>
```

### Change 7: CSS Additions

Add to the CSS file:

```css
/* Benchmark Range Bar */
.benchmark-range-container { padding: 16px 0; }
.benchmark-range-bar {
  position: relative; height: 24px; border-radius: 12px;
  background: linear-gradient(90deg, #fef3c7 0%, #d1fae5 50%, #fef3c7 100%);
  margin: 8px 0;
}
.benchmark-range-marker {
  position: absolute; top: -4px; width: 4px; height: 32px;
  background: var(--teal-600); border-radius: 2px;
}
.benchmark-range-planned {
  position: absolute; top: -6px; width: 12px; height: 12px;
  border-radius: 50%; border: 3px solid var(--navy-900);
  transform: translateX(-50%);
}
.benchmark-in-range { background: var(--green-500); }
.benchmark-below { background: #f59e0b; }
.benchmark-above { background: var(--red-500); }
.benchmark-source-text {
  font-size: 12px; color: var(--slate-500); margin-top: 4px;
}
.benchmark-caveat {
  font-size: 11px; color: var(--slate-500); font-style: italic; margin-top: 8px;
}

/* Three Margin Options */
.margin-options-grid {
  display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px;
  padding: 16px 0;
}
.margin-option {
  padding: 16px; border-radius: 12px; text-align: center;
  border: 2px solid var(--slate-200); background: white;
  cursor: pointer; transition: all 0.2s ease;
}
.margin-option:hover { border-color: var(--teal-400); box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
.margin-option-optimal {
  border-color: var(--teal-500); background: #f0fdfa;
  box-shadow: 0 2px 12px rgba(2,177,181,0.15);
}
.margin-option-badge {
  display: inline-block; padding: 2px 8px; border-radius: 10px;
  background: var(--teal-500); color: white; font-size: 10px;
  font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;
  margin-bottom: 8px;
}
.margin-option-label { font-size: 12px; color: var(--slate-500); font-weight: 600; text-transform: uppercase; }
.margin-option-value { font-size: 28px; font-weight: 800; color: var(--navy-900); margin: 4px 0; }
.margin-option-detail { font-size: 11px; color: var(--slate-500); }

/* ML Key Drivers */
.ml-drivers-section { padding: 16px 0; border-bottom: 1px solid var(--slate-200); }
.ml-badge {
  display: inline-block; padding: 2px 8px; border-radius: 8px;
  background: #ede9fe; color: #7c3aed; font-size: 10px; font-weight: 600;
  margin-left: 8px; vertical-align: middle;
}
.ml-driver-row {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 0; border-bottom: 1px solid var(--slate-50);
}
.ml-driver-text { flex: 1; font-size: 13px; color: var(--slate-700); }
.driver-impact-positive { color: var(--green-500); font-weight: 600; font-size: 12px; }
.driver-impact-negative { color: var(--red-500); font-weight: 600; font-size: 12px; }

/* Model Transparency */
.model-transparency {
  display: flex; align-items: center; gap: 6px;
  padding: 12px 16px; margin-top: 12px;
  background: var(--slate-50); border-radius: 8px;
}
.model-transparency-text { font-size: 11px; color: var(--slate-500); }
```

## Important Notes

- LWC templates do NOT support `!` unary operator in expressions. Use computed getters for negation: `get isNotBenchmark() { return !this.isBenchmarkRecommendation; }`
- For the benchmark range bar positioning, compute left% using: `((value - low) / (high - low)) * 100`
- Ensure the 3-column grid degrades gracefully on narrow screens (Salesforce utility panel is ~380px wide) — consider `@media` or min-width fallback
- Run prettier and eslint on all modified files before committing

Create branch feat/ml-lwc-display, commit, push. Open a PR from the GitHub UI.
```
