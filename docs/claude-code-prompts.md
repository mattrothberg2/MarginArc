# Claude Code Prompts — MarginArc Development Roadmap

Each prompt below is self-contained and can be pasted directly into Claude Code web (claude.ai/code) connected to the `mattrothberg2/MarginArc` repo. They are ordered by dependency — complete earlier ones before later ones where noted.

---

## Epic 1: Fix the Foundation

### 1A — Fix Synthetic Data Field Gaps

```
Read lambda/server/data/generateSyntheticDeals.js and understand how synthetic deals are generated.

There are field gaps between what the generator creates and what the algorithm needs. The kNN similarity function in lambda/server/src/knn.js references fields that are missing from the generated Lambda deal objects.

Fix these specific issues:

1. In the `lambdaDeal` object construction (~line 568-591), ensure these fields are included:
   - `oem` (the OEM vendor name — it's already computed as `oem` earlier in the deal generation)
   - `servicesAttached` (boolean — already computed)
   - `quarterEnd` (boolean — already computed)
   - `displacementDeal` (boolean — NOT currently generated. Add it: ~5% of competitive deals where competitors >= 2 should be displacement deals)

2. Verify the `sfdcDeal` object also includes these fields with the correct Fulcrum_*__c API names.

3. After fixing the generator, regenerate the sample data by running:
   cd lambda/server/data && node generateSyntheticDeals.js
   This will overwrite sample_deals.json with corrected data.

4. Verify the output: spot-check 10 deals in sample_deals.json to confirm oem, servicesAttached, quarterEnd, and displacementDeal fields are present.

Important: The RNG seed 'fulcrum-var-v2' must NOT be changed — it ensures reproducible output. Only add new fields; don't change existing deal generation logic.

Create a feature branch, commit, and open a PR.
```

### 1B — Persist Deal Outcomes to PostgreSQL

```
The recommendation engine in lambda/server/src/knn.js uses historical deals for k-nearest-neighbor matching. Currently, real deal outcomes are stored in an in-memory array (see `recordedDeals` in lambda/server/index.js around the /api/deals/ingest route). This means all real customer data is lost on Lambda cold start — the system always falls back to the 7,000 static synthetic deals in lambda/server/data/sample_deals.json.

Fix this by persisting deal outcomes to the PostgreSQL database.

1. Read lambda/server/src/licensing/db.js to understand the existing database connection pattern (uses `pg` Pool, loads credentials from AWS SSM parameters under /marginarc/ prefix).

2. The `recorded_deals` table already exists in lambda/schema.sql — read it to understand the schema. If the schema doesn't match what's needed, add a migration.

3. Modify the /api/deals/ingest route in lambda/server/index.js to:
   - INSERT incoming deals into the `recorded_deals` PostgreSQL table instead of (or in addition to) the in-memory array
   - Include all fields that knn.js uses for similarity matching: oem, oemCost, customerSegment, dealRegType, competitors, competitorNames, valueAdd, solutionComplexity, relationshipStrength, customerIndustry, customerTechSophistication, varStrategicImportance, productCategory, servicesAttached, quarterEnd, isNewLogo, displacementDeal, dealSize, marginPct, outcome (won/lost), closeDate

4. Create an `allDeals()` function (or modify the existing one) that:
   - Loads sample_deals.json once at cold start (cached in memory)
   - Queries recorded_deals from PostgreSQL
   - Concatenates both arrays
   - Caches the DB results for 5 minutes to avoid hitting the DB on every API call

5. Update lambda/server/index.js /api/recommend route to use this new allDeals() function when passing deals to the kNN engine.

6. Add error handling: if the DB is unreachable, fall back to sample_deals.json only (don't break recommendations).

7. Write tests in lambda/server/__tests__/ for the persistence layer.

Important: Do NOT modify the core engine files (rules.js, metrics.js, winprob.js, knn.js) — those require explicit approval per CLAUDE.md. Only modify index.js and add new files.

Create a feature branch, commit, and open a PR.
```

### 1C — Add Time Decay to kNN Similarity

```
IMPORTANT: This task modifies a core engine file (lambda/server/src/knn.js). Read .claude/CLAUDE.md first — core engine files require careful handling.

The kNN similarity function in lambda/server/src/knn.js currently weights all historical deals equally regardless of age. A deal from 2016 has the same influence as a deal from 2025. This is wrong — recent deals are more relevant because margins, competition, and market conditions change.

Add time decay to the similarity calculation:

1. Read lambda/server/src/knn.js thoroughly. Understand the `similarity()` function and how `findNeighbors()` works.

2. Add a time decay factor to the similarity score. The decay should be:
   - Deals from the last 12 months: weight = 1.0 (no decay)
   - Deals 1-2 years old: weight = 0.85
   - Deals 2-3 years old: weight = 0.70
   - Deals 3-5 years old: weight = 0.50
   - Deals 5+ years old: weight = 0.30

3. Apply the decay as a multiplier on the final similarity score, not on individual dimension weights. This way the dimension matching stays clean and the decay is a separate concern.

4. The deal's close date is stored as `closeDate` (ISO string) in the deal objects. Parse it and compute the age in years.

5. If `closeDate` is missing (some legacy deals), default to weight = 0.5.

6. Write unit tests for the decay function with edge cases (null dates, future dates, exactly-on-boundary dates).

7. Run existing tests to make sure nothing breaks: cd lambda/server && npm test

Create a feature branch, commit, and open a PR. In the PR description, explain the decay curve and why these specific thresholds were chosen.
```

### 1D — Wire SFDC Won/Lost Deals Back to Lambda

```
Read these files to understand the current architecture:
- sfdc/force-app/main/default/classes/MarginArcBatchAnalyzer.cls (nightly batch that scores open deals)
- sfdc/force-app/main/default/classes/MarginArcController.cls (the main Apex controller)
- lambda/server/index.js (the /api/deals/ingest endpoint)

Currently, when a deal closes in Salesforce (won or lost), the outcome is never sent back to Lambda. This means the kNN algorithm can never learn from real outcomes.

Create a mechanism to send closed deal outcomes to Lambda:

1. Create a new Apex class `MarginArcDealOutcomeSync.cls` that:
   - Implements Database.Batchable<SObject> and Database.AllowsCallouts
   - Queries recently closed Opportunities (Closed Won or Closed Lost in the last 7 days)
   - For each, builds a payload with: all the fields the kNN needs (see the buildPayload() method in MarginArcBatchAnalyzer for the field mapping), plus the outcome (won/lost), actual margin achieved (from Fulcrum_Planned_Margin__c or Fulcrum_GP_Percent__c), close date, and loss reason (Fulcrum_Loss_Reason__c)
   - POSTs to the /api/deals/ingest endpoint on Lambda
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

Create a feature branch, commit, and open a PR.
```

---

## Epic 2: Multi-Phase Algorithm

### 2A — Design Algorithm Phase System (depends on 1B)

```
Read these files to understand the current system:
- lambda/server/index.js — the /api/recommend route
- lambda/server/src/rules.js — the 22-rule margin engine
- lambda/server/src/knn.js — nearest neighbor matching
- lambda/server/src/quality-tiers.js — data quality scoring
- lambda/server/src/licensing/db.js — database connection and customer_config table
- lambda/server/src/licensing/routes.js — how customer config is managed

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

1. Add a `algorithm_phase` column to the `customer_config` table (integer, default 1). Add a migration in lambda/server/src/licensing/db.js.

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

6. Write tests for the phase system.

Create a feature branch, commit, and open a PR. Include a table in the PR description showing the three phases and their requirements.
```

### 2B — Add Phase-Aware UX to SFDC Margin Advisor (depends on 2A)

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

Create a feature branch, commit, and open a PR.
```

### 2C — Add Phase Guidance to Setup Wizard (depends on 2A)

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
   - Phase 3: "Phase 2 active ✓", "20 deals with BOM data needed (current: X)" with progress bar

4. When the admin clicks "Enable Phase 2", show a confirmation modal explaining what changes for reps, then call the API.

Important: The customer/org ID for the API call should come from Fulcrum_License__c.Customer_ID__c custom setting. Read MarginArcLicenseActivator.cls to see how this is stored.

Create a feature branch, commit, and open a PR.
```

---

## Epic 3: BOM Line-Item Engine

### 3A — Implement BOM Catalog Search API (no dependencies)

```
Read these files:
- lambda/server/index.js — look for any existing /api/bom/* routes (there's a /api/bomcatalog GET route)
- lambda/server/data/bom_catalog.json — the current product catalog (~20 items)
- lambda/server/data/vendor_skus.json — vendor SKU database (10 OEMs × 6 categories × 4-5 roles = ~240 entries with real SKU numbers and list prices)
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

8. Write tests.

Create a feature branch, commit, and open a PR.
```

### 3B — Implement BOM Per-Line Margin Optimizer (depends on 3A)

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

6. Wire it into index.js as POST /api/bom/analyze with x-api-key authentication.

7. Update docs/lambda-api.md to document the endpoint.

8. Write comprehensive tests including edge cases: empty BOM, single line, impossible target, all-services BOM, all-hardware BOM.

Create a feature branch, commit, and open a PR.
```

### 3C — Expand Product Catalog to 200+ Items (no dependencies)

```
Read lambda/server/data/vendor_skus.json and lambda/server/data/bom_catalog.json to understand the current catalog structure.

The current catalog has ~240 vendor SKU entries (10 OEMs × 6 categories) but many are generic placeholders. Expand it to 200+ realistic, searchable products:

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

Create a feature branch, commit, and open a PR.
```

---

## Epic 4: Synthetic Data Generator v2

### 4A — Configurable POC Scenarios (depends on 1A)

```
Read lambda/server/data/generateSyntheticDeals.js to understand the current synthetic data generator. It creates 7,000 deals with realistic distributions.

Add configurable POC scenario presets that generate tailored demo data for different VAR profiles. This is critical for sales demos — we need to show prospects data that looks like their business.

1. Create a new file lambda/server/data/scenarios.js that exports scenario configurations:

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
   - node generateSyntheticDeals.js --scenario=networking-var --deals=500
   - Default (no args): current behavior (7,000 full-stack deals)
   - The scenario adjusts all the distribution parameters but keeps the same realistic generation logic (customer lifecycle, seasonal patterns, margin compression trend, etc.)

4. Generate and save a sample file for each scenario:
   - lambda/server/data/scenarios/networking-var.json
   - lambda/server/data/scenarios/security-var.json
   - etc.
   - Keep sample_deals.json as the default full dataset

5. Add a --output flag to write to a specific file path.

Create a feature branch, commit, and open a PR.
```

### 4B — Full BOM History for All Synthetic Deals (depends on 1A, 3C)

```
Read lambda/server/data/generateSyntheticDeals.js — specifically the BOM generation section (search for "bom" in the file). Currently, only deals from 2024+ get BOM line items. Older deals have no line-item history.

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

5. The BOM total cost should align with the deal's OEM cost (Fulcrum_OEM_Cost__c), and the BOM total price should align with the deal amount.

6. Store BOM lines in each deal object as a `bomLines` array with the same schema as Fulcrum_BOM_Line__c: description, category, quantity, unitCost, unitPrice, marginPct, vendor, productNumber, sortOrder.

7. Regenerate sample_deals.json with the full BOM data.

Create a feature branch, commit, and open a PR.
```

### 4C — One-Click POC Data Loading in Setup Wizard (depends on 4A)

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
   - Lambda returns the pre-generated scenario data (from lambda/server/data/scenarios/*.json), sliced to the requested count

3. The existing MarginArcDemoDataQueueable chain should handle the actual SFDC record creation (Accounts, Opportunities, BOM Lines, Recommendation History). Make sure it creates BOM lines for each deal (using the bomLines array from the scenario data).

4. Add a "Clear Demo Data" button that deletes all demo-created records (use a Demo_Data__c flag or naming convention to identify them).

5. After loading, show a summary: "Loaded 250 opportunities across 45 accounts with 1,200 BOM lines."

Important: The queueable chain exists because Salesforce has governor limits on DML operations. Don't try to insert everything in one transaction — use the existing chained queueable pattern.

Create a feature branch, commit, and open a PR.
```

---

## Epic 5: On-Prem Architecture

### 5A — Split Lambda into Engine + Mothership (depends on 1B, 2A)

```
Read lambda/server/index.js thoroughly. The current Lambda function serves everything:
- /api/recommend, /api/bomcatalog, /api/bom/* — the scoring engine
- /api/v1/license/*, /api/v1/telemetry — the licensing mothership
- /admin/* — the admin portal SPA
- /oauth/* — Salesforce OAuth
- /docs/* — documentation portal

For on-prem deployment, customers need to self-host the scoring engine but NOT the licensing/admin infrastructure. Split the codebase:

1. Create a new file lambda/server/engine.js that:
   - Contains ONLY the scoring engine routes: /api/recommend, /api/bom/*, /api/bomcatalog, /api/deals/ingest, /api/sampledeals, /api/industries
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

Create a feature branch, commit, and open a PR.
```

### 5B — Create OpenAPI Spec for Engine API (depends on 3A, 3B)

```
Read these files to understand all API endpoints:
- lambda/server/index.js — all route definitions
- docs/lambda-api.md — current API documentation

Create a formal OpenAPI 3.0 specification for the MarginArc Engine API:

1. Create lambda/server/openapi.yaml covering these endpoints:
   - POST /api/recommend — full request/response schema with all input fields, response fields, and examples
   - POST /api/bom/search — catalog search with query/filter parameters
   - POST /api/bom/analyze — BOM optimization with per-line response
   - POST /api/deals/ingest — deal outcome recording
   - GET /api/bomcatalog — full catalog retrieval
   - GET /api/sampledeals — sample deal data
   - GET /api/industries — industry list
   - GET /api/bom/catalog/stats — catalog metadata

2. Include:
   - Authentication scheme (API key via x-api-key header)
   - All request body schemas with field descriptions, types, enums, and required flags
   - All response schemas
   - Error response schemas (400, 401, 500)
   - Example requests and responses for each endpoint

3. Add a /docs/api route in index.js that serves Swagger UI (use swagger-ui-express) pointing to the openapi.yaml file. This gives customers interactive API documentation.

4. Update docs/lambda-api.md to reference the OpenAPI spec as the canonical API documentation.

Create a feature branch, commit, and open a PR.
```

---

## Epic 6: Future-Proofing for MarginArc Network

### 6A — Design Network Data Schema (no code changes needed yet)

```
This is a DESIGN task, not an implementation task. Create a design document, not code.

Read these files to understand the current data model:
- lambda/server/src/knn.js — what deal fields the similarity function uses
- lambda/server/data/generateSyntheticDeals.js — what fields exist on a deal
- lambda/schema.sql — current database schema
- The website at marginarc.com describes a "MarginArc Network" concept: anonymized deal data pooled across non-competing VARs via federated learning with differential privacy

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

4. **Integration Points**: How would network data flow into the existing kNN system? Propose adding a 3rd data source to `allDeals()`: local sample data + recorded customer deals + network deals. Network deals would have a lower similarity weight (e.g., 0.6x multiplier) since they're from different VARs.

5. **Database Schema**: Design the tables needed:
   - network_deals (anonymized deal records from all contributing VARs)
   - network_participants (VAR identity, contribution tier, excluded competitors)
   - network_sync_log (last sync timestamps per participant)

6. **Privacy Guarantees**: Describe what differential privacy mechanisms would be applied (noise injection on margin values, k-anonymity on deal characteristics, minimum cohort sizes before sharing).

This is a documentation/design task only. Do not write any code. The output should be a thorough markdown document that a team could use to implement the network in a future sprint.

Create a feature branch, commit, and open a PR.
```
