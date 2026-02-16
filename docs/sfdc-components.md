# SFDC Components Reference

## LWC Components (10)

### marginarcMarginAdvisor (Main Widget)
- **Target**: Opportunity Record Page
- **Purpose**: AI-powered margin recommendation with 5-level graceful degradation
- **Apex**: MarginArcController (callMarginArcApi, generateAIExplanation, getOemRecords, logRecommendation, getRecommendationHistory, saveBomLines, getBomLines), MarginArcAdminController (getCompetitorList)
- **Features**: Recommendation display, confidence gauge, win probability, plan-vs-recommendation comparison, AI explanation, recommendation history, "Apply Recommendation" writeback
- **Child**: `<c-marginarc-bom-table>` for per-line BOM editing

### marginarcBomTable (BOM Child)
- **Target**: Child of marginarcMarginAdvisor (not placed directly)
- **Purpose**: Bill of Materials table with per-line plan vs recommended margin
- **Apex**: None (receives data via @api from parent)
- **Features**: 8-column grid, editable per-line margins, category badges, BOM recalculate dispatch

### marginarcBomBuilder (Standalone BOM)
- **Target**: Opportunity Record Page
- **Purpose**: Standalone BOM builder with catalog search and CSV import
- **Apex**: MarginArcController (searchBomCatalog, analyzeBom, saveBomLines, getBomLines)
- **Note**: Currently broken — `/api/bom/search` and `/api/bom/analyze` Lambda endpoints don't exist

### marginarcManagerDashboard
- **Target**: Lightning Tab ("MarginArc Dashboard"), App Page
- **Purpose**: Team-wide pipeline health, rep performance, margin opportunity
- **Apex**: MarginArcManagerController (getPipelineSummary, getHistoricalPerformance, getUserContext, getTeamComparison, getRepDetail, getBackfillSummary, getBackfillDetails)
- **Features**: KPI strip, pipeline health table (sortable, paginated), scatter plot, team comparison, rep drill-down modal, time range filter

### marginarcCompetitiveIntel
- **Target**: Opportunity Record Page
- **Purpose**: Account-specific competitive intelligence from historical deals
- **Apex**: MarginArcCompetitiveController (getAccountIntelligence, getCompetitorProfile)
- **Features**: Win/loss records, strategy recommendations, competitor detail modal

### marginarcDealInsights
- **Target**: Opportunity Record Page
- **Purpose**: Contextual deal insights (client-side only, no API calls)
- **Features**: OEM market averages, margin tips, segment strategy, stage alerts

### marginarcWhatIf
- **Target**: Opportunity Record Page
- **Purpose**: What-if scenario modeling
- **Features**: Adjust competitors, deal reg, complexity, relationship; scenario comparison cards

### marginarcAdminConfig
- **Target**: Lightning Tab ("MarginArc Setup")
- **Purpose**: Admin panel for OEM vendors, competitors, connection testing
- **Apex**: MarginArcAdminController (CRUD for OEM/Competitor), MarginArcLicenseActivator (activateLicense, getLicenseStatus), MarginArcLicenseValidator (validateLicenseNow)

### marginarcSetupWizard
- **Target**: Lightning Tab ("Getting Started")
- **Purpose**: 6-step guided setup wizard
- **Apex**: MarginArcSetupController (getSetupStatus, getFieldMappingSuggestions, runBackfill, getBackfillJobStatus, runNightlyAnalyzer, getMaturityAssessment), MarginArcDemoDataLoader (loadDemoData)

### marginarcBackfillReport
- **Target**: Lightning Tab ("MarginArc ROI Report")
- **Purpose**: Historical backfill analysis results
- **Apex**: MarginArcManagerController (getBackfillSummary, getBackfillDetails)

---

## Apex Controllers (14)

### MarginArcController
- `callMarginArcApi(payload)` — HTTP proxy to Lambda `/api/recommend`
- `generateAIExplanation(context)` — Calls Gemini API for AI narratives
- `getOpportunityData(opportunityId)` — Query Opportunity with custom fields
- `logRecommendation(data)` — Insert Fulcrum_Recommendation_History__c
- `getRecommendationHistory(opportunityId)` — Last 10 history records
- `searchBomCatalog(query, manufacturer, category)` — Proxy to `/api/bom/search`
- `analyzeBom(bomLinesJson, contextJson)` — Proxy to `/api/bom/analyze`
- `saveBomLines(bomLinesJson, opportunityId)` — CRUD on Fulcrum_BOM_Line__c
- `getBomLines(opportunityId)` — Query BOM lines for an Opportunity
- `getOemRecords()` — Query Fulcrum_OEM__c records

### MarginArcCompetitiveController
- `getAccountIntelligence(accountId)` — Win/loss data from closed Opportunities
- `getCompetitorProfile(competitorName)` — Fulcrum_Competitor__c or hardcoded fallback

### MarginArcManagerController
- `getPipelineSummary(teamFilter)` — Open pipeline with server-side deal scores
- `getHistoricalPerformance(timeRange, teamFilter)` — Closed deal analytics
- `getUserContext()` — User role, permissions, direct reports
- `getTeamComparison(timeRange)` — Per-team KPIs (admin/VP only)
- `getRepDetail(repId, timeRange)` — Rep drill-down
- `getBackfillSummary()` / `getBackfillDetails()` — Backfill results

### MarginArcBatchAnalyzer
- `Database.Batchable + Schedulable` — Nightly 2AM batch
- Mon-Sat: incremental (unanalyzed deals only)
- Sunday: full refresh (all open deals)
- Batch size: 10 (callout governor compliance)

### MarginArcBackfillAnalyzer
- `Database.Batchable + AllowsCallouts` — Historical closed deal scoring
- Triggered from Setup Wizard (Step 5) with configurable lookback period

### MarginArcAdminController
- CRUD for Fulcrum_OEM__c and Fulcrum_Competitor__c
- `getConnectionStatus()` — API reachability test
- `getDataHealth()` — Field fill rates

### MarginArcSetupController
- `getSetupStatus()` — Comprehensive setup completeness
- `getFieldMappingSuggestions()` — Field mapping recommendations
- `runBackfill(monthsBack)` / `getBackfillJobStatus(jobId)` — Backfill management
- `runNightlyAnalyzer()` — One-time full refresh trigger
- `getMaturityAssessment()` — Intelligence Maturity Level 1-5

### MarginArcInstallHandler
- 2GP post-install script (`InstallHandler` interface)
- Creates default Fulcrum_Config__c, schedules nightly analyzer, sends welcome email

### MarginArcDemoDataLoader
- `loadDemoData()` — Creates demo Opportunities with MarginArc fields populated

### MarginArcLicenseActivator / MarginArcLicenseValidator / MarginArcLicenseGate / MarginArcLicenseMock
- License activation, weekly validation, enforcement gate, test mock

### MarginArcDemoDataService / MarginArcDemoDataQueueable
- REST API (`/marginarc/demo-data/*`) for demo data management
- Queueable chain for large demo loads (7000+ deals)

---

## Custom Objects

### Fulcrum_OEM__c
OEM vendor margin profiles. Fields: Name, Base_Margin__c, Deal_Reg_Margin_Boost__c, Services_Margin_Boost__c, Quarter_End_Discount__c, Product_Category__c, Logo_URL__c

### Fulcrum_Competitor__c
Competitor VAR profiles. Fields: Name, Primary_Strength__c, Price_Aggression__c, Margin_Aggression__c, Services_Capability__c, Primary_OEMs__c, How_To_Win__c, Typical_Discount__c, Description__c

### Fulcrum_Recommendation_History__c
Immutable audit trail (Master-Detail to Opportunity). Fields: Recommended_Margin__c, AI_Confidence__c, Win_Probability__c, Planned_Margin_At_Time__c, Source__c (Manual/Batch/API), Applied__c, Recommendation_Date__c

### Fulcrum_Backfill_Result__c
Historical deal scoring results from MarginArcBackfillAnalyzer

### Fulcrum_BOM_Line__c
Bill of Materials line items linked to Opportunities

---

## Permission Sets

| Set | Grants |
|-----|--------|
| Fulcrum_Admin | Full access to all MarginArc objects, fields, tabs, reports |
| Fulcrum_Manager | Dashboard access + team pipeline visibility |
| Fulcrum_User | Opportunity field access + Recommendation History create/edit |
