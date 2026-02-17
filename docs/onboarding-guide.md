# MarginArc Design Partner Onboarding Playbook

Repeatable playbook for onboarding the first 3–5 design partner VARs through a 30-day POC.

---

## 1. Pre-Onboarding Checklist

Complete these steps **before** the Day 1 install call.

### Admin Portal Setup
- [ ] Log in to the admin portal at `https://api.marginarc.com/admin`
- [ ] Create a new customer record (company name, primary contact, Salesforce org ID)
- [ ] Generate a license key (prefix: `FULC-`) and record it — the customer will need this on Day 1
- [ ] Note the customer's Salesforce edition and user count (affects permission set assignment)

### Scenario Preparation
- [ ] Identify which VAR archetype best matches the customer:
  | Scenario | Best For |
  |----------|----------|
  | `networking-var` | Cisco/Arista-heavy resellers |
  | `security-var` | Palo Alto/Fortinet-focused resellers |
  | `cloud-var` | Microsoft/VMware cloud practices |
  | `full-stack-var` | Multi-vendor, broad portfolio |
  | `services-heavy-var` | Services-led, lower product margins |
- [ ] Prepare a brief profile of the customer's top OEM vendors and primary competitors
- [ ] Confirm API endpoint is healthy: `curl https://api.marginarc.com/api/recommend -H "x-api-key: <key>"` returns 200
- [ ] Schedule the Day 1 call (calendar invite with Zoom link, 60 minutes)
- [ ] Send pre-call email with:
  - Package install link (from Salesforce AppExchange or direct URL)
  - Permission set names they'll need: `Fulcrum_Admin`, `Fulcrum_User`, `Fulcrum_Manager`
  - Request: the customer should have a Salesforce admin on the call

---

## 2. Day 1: Install + Configure (1-Hour Call)

### Package Installation (10 min)
1. Customer installs the **Fulcrum AI** unlocked package in their Salesforce org
2. The install handler (`MarginArcInstallHandler`) automatically:
   - Creates default `Fulcrum_Config__c` custom setting with API URL (`https://api.marginarc.com/api/recommend`)
   - Initializes `Fulcrum_License__c` with mothership URL, org ID, and `pending` status
   - Schedules the **Nightly Analyzer** batch job (runs daily at 2 AM)
   - Schedules the **Deal Outcome Sync** (runs weekly, Sundays at 3 AM)
   - Sends a welcome email to the installing admin
3. Verify install: navigate to the **MarginArc Setup** tab — the Setup Wizard should load

### Permission Set Assignment (5 min)
1. Go to **Setup > Permission Sets**
2. Assign `Fulcrum_Admin` to:
   - The sales ops admin managing MarginArc
   - The person on this call
3. Assign `Fulcrum_Manager` to:
   - Sales managers who need the Manager Dashboard
4. Assign `Fulcrum_User` to:
   - All reps who will score deals (can be done later in bulk)
5. Confirm: admin user can see all MarginArc tabs

### License Activation (5 min)
1. Open the **Setup Wizard** (Step 1: Welcome)
2. Navigate to **Step 2: Connection**
3. Customer enters the license key (`FULC-XXXX-XXXX-XXXX`) in `Fulcrum_Config__c`:
   - `API_URL__c` = `https://api.marginarc.com/api/recommend`
   - `API_Key__c` = the generated API key
4. Click **Test Connection** — verify all 4 status indicators turn green:
   - API URL configured
   - API Key configured
   - Gemini Key configured (if applicable, or skip)
   - API Reachable
5. If connection test fails: check Remote Site Settings (`Fulcrum_API` → `https://api.marginarc.com`)

### Load Demo Data (10 min)
1. Return to **Step 1: Welcome** in the Setup Wizard
2. Select the matching VAR scenario (e.g., `networking-var`)
3. Choose deal count: **250** (recommended default for POC)
4. Click **Load Scenario Data**
5. Wait for confirmation toast — data loads include:
   - OEM Vendor records (10): Cisco, Palo Alto, Dell, HPE, Fortinet, Pure Storage, VMware, NetApp, Arista, Microsoft
   - Competitor profiles (10): CDW, SHI, Presidio, Optiv, Insight, ePlus, Trace3, Connection, Zones, Converge
   - Demo Accounts (marked with "(Demo)" suffix) and Opportunities
   - BOM lines generated in background via queueable job
6. Verify: navigate to any demo Opportunity and click **Score My Deal** — confirm a score appears

### Quick Orientation (30 min)
1. Walk through a sample deal scoring:
   - Open a demo Opportunity in Negotiation stage
   - Click **Score My Deal** — show the score, recommendations, and competitive intel
   - Explain the Phase 1 scoring (deal quality + win probability)
2. Show the **Manager Dashboard** tab:
   - KPI strip, pipeline table, scatter plot
   - Explain this will populate with real data once reps start scoring
3. Set expectations: "Over the next 3 days, we'll assess your real data quality. The demo data is here so your team can practice."

---

## 3. Day 1–3: Data Quality Assessment

### Run Data Quality Check
1. Open the Setup Wizard, navigate to **Step 3: Data Quality**
2. Review the 5 key field fill rates:
   | Field | What It Measures | Target |
   |-------|------------------|--------|
   | OEM Vendor | `Fulcrum_OEM__c` populated | ≥ 80% |
   | OEM Cost | `Fulcrum_OEM_Cost__c` populated | ≥ 60% |
   | Customer Segment | `Fulcrum_Customer_Segment__c` populated | ≥ 80% |
   | Deal Registration | `Fulcrum_Deal_Reg_Type__c` populated | ≥ 60% |
   | Competitors | `Fulcrum_Competitor_Names__c` populated | ≥ 50% |
3. Note the **Overall Fill Rate** percentage (shown in the progress ring)
4. Review the color coding:
   - Green (≥ 80%): good to go
   - Amber (≥ 50%): workable, plan to improve
   - Red (< 50%): needs attention before Phase 2

### Identify Field Mapping Opportunities
1. Click to view **improvement suggestions** — the wizard calls `getFieldMappingSuggestions()`
2. Look for fields marked **Auto-Derivable** — these can be populated automatically from existing Salesforce data
3. Document which fields need manual data entry vs. automation

### Create Data Cleanup Plan
- [ ] List fields below 60% fill rate
- [ ] For each: determine if data exists elsewhere in Salesforce (can be mapped) or truly missing
- [ ] Assign cleanup tasks to customer's sales ops team
- [ ] Set target: get to ≥ 60% overall fill rate within 5 business days
- [ ] Share the plan via email with the customer's admin

### Run Historical Backfill
1. Navigate to **Step 5: Backfill** in the Setup Wizard
2. Select time range: **12 months** (recommended)
3. Click **Run Historical Backfill**
4. The wizard launches an Apex batch job and polls every 3 seconds:
   - Progress bar shows `X of Y batches processed`
   - Wait for completion or note any errors
5. After backfill completes, click **Run Nightly Analyzer** to process the backfilled data
6. This populates the Manager Dashboard with historical baselines

---

## 4. Week 1: Rep Enablement

### Training Session: "How to Score Your Deal"
Conduct a 30-minute training with the rep team. Cover:

1. **Where to find it**: MarginArc lives on the Opportunity record — no new tabs or apps to learn
2. **How to score**: click **Score My Deal** — one click, results in 3–5 seconds
3. **What the score means**:
   - Deal quality score (data completeness + deal structure)
   - Win probability estimate
   - Phase 1: focuses on deal hygiene and competitive awareness
4. **What to do with it**: review the recommendations, note any missing fields flagged, improve data quality as you update the Opportunity
5. **What NOT to worry about**: margin recommendations come in Phase 2 — for now, focus on scoring every deal

### Adoption Target
- **Goal: 50 scored deals in 7 days** — this unlocks Phase 2
- This is a requirement in the algorithm phase gate (Setup Wizard Step 6)
- Share this target with the sales manager explicitly

### Daily Adoption Monitoring
- [ ] Check the Manager Dashboard daily during Week 1
- [ ] Track scored deal count (visible in dashboard KPIs)
- [ ] If adoption is slow by Day 3, schedule a 15-minute "office hours" drop-in for reps
- [ ] Send daily Slack/email update to the customer champion:
  - "X deals scored so far — Y to go before we can activate margin recommendations"
- [ ] Flag any reps who haven't scored a single deal — have the manager nudge them

### Data Quality Gate
- By end of Week 1, overall data quality should be ≥ 60%
- This is the second requirement to unlock Phase 2 (visible in Step 6 of the wizard)
- If below 60%, work with sales ops to prioritize the lowest fill-rate fields

---

## 5. Week 2: Phase 2 Activation

### Enable Phase 2
1. Open Setup Wizard, navigate to **Step 6: Algorithm Phases**
2. Verify Phase 2 requirements are met:
   - ≥ 50 scored deals (progress bar should be green)
   - ≥ 60% data quality (progress bar should be green)
3. Click **Enable Phase 2** → confirm in the modal
4. Phase 2 adds: **margin recommendations** on every scored deal

### Configure Customer-Specific OEM/Competitor Data
1. Navigate to **Step 4: Configuration** in the Setup Wizard (or use the Admin Config tab)
2. Review the 10 pre-loaded OEM vendors — adjust base margins and boost percentages to match the customer's actual vendor agreements:
   - `Base_Margin__c`: typical margin for this OEM
   - `Deal_Reg_Margin_Boost__c`: additional margin for registered deals
   - `Services_Margin_Boost__c`: margin uplift when services are attached
   - `Quarter_End_Discount__c`: expected quarter-end discount pressure
3. Review the 10 pre-loaded competitors — customize:
   - `Price_Aggression__c` and `Margin_Aggression__c` scores
   - `How_To_Win__c` playbook text with customer-specific intelligence
4. Add any OEM vendors or competitors that are missing from the defaults
5. Optional: clear demo data (`clearDemoData()`) once enough real data exists

### Updated Rep Training (15 min)
Cover what's new in Phase 2:
1. Margin recommendations now appear on scored deals
2. Explain the margin recommendation: "MarginArc suggests a target margin based on similar deals, OEM benchmarks, and competitive context"
3. Reps should: review the recommendation, compare to their planned margin, and note when they adjust based on the suggestion
4. Set new adoption target: reps actively reviewing margin recommendations on open deals

---

## 6. Week 3–4: Measure + Report

### Dashboard Review with Sales Leadership
Schedule a 45-minute review with the VP of Sales or sales director. Prepare:

1. **Pipeline Overview**
   - Total deals scored and in pipeline
   - Distribution by stage, OEM vendor, and customer segment
   - Use the scatter plot to show margin vs. deal size patterns

2. **Alignment Metric Baseline**
   - Pull the "Does Following MarginArc Work?" cohort analysis
   - This is the natural A/B test: deals where reps followed the recommendation vs. those that went off-target
   - Establish the baseline alignment rate (what percentage of reps are within range)

3. **GP Upside Calculation**
   - For deals where reps followed the margin recommendation: what was the actual GP% vs. their original planned margin?
   - Calculate the aggregate GP dollar difference
   - Frame it as: "If all reps followed the recommendation, the upside would be $X"

4. **Cohort Analysis**
   - Aligned deals (rep margin within ±2% of recommendation) vs. off-target deals
   - Compare: win rate, average GP%, deal cycle time
   - This is the "killer proof point" for the POC decision

5. **Competitive Performance**
   - Which competitors appear most often? Where do we win vs. lose?
   - How do margins compare when specific competitors are present?

### Collect Rep Testimonials
- [ ] Identify 3+ reps who have been active users
- [ ] Ask each: "Has a MarginArc recommendation changed how you priced a deal? Can you give a specific example?"
- [ ] Document quotes for the Day 30 decision meeting
- [ ] Look for stories where MarginArc caught underpricing or gave confidence to hold margin

### Data Quality Progress Report
- [ ] Re-run the Data Quality check in the Setup Wizard
- [ ] Compare current fill rates to Day 1 baseline
- [ ] Document improvement (e.g., "OEM Cost fill rate improved from 42% to 78%")

---

## 7. Day 30: POC Decision Meeting

### Attendees
- Customer: VP of Sales / CRO, Sales Ops lead, 1–2 rep champions
- MarginArc: Account lead, technical lead

### Agenda

#### 1. Results Against POC Success Criteria (15 min)
Present results against the 8 CRO success criteria:

| # | Criterion | Target | Actual | Status |
|---|-----------|--------|--------|--------|
| 1 | Active reps scoring deals | 20+ reps, 100+ scored | ___ reps, ___ scored | |
| 2 | Phase 2 activated | Margin recommendations live | Yes / No | |
| 3 | Deals where reps applied recommendation | 5+ deals | ___ deals | |
| 4 | Dashboard populated with real data | Pipeline visible | Yes / No | |
| 5 | Historical backfill complete | 12 months analyzed | ___ months | |
| 6 | Reps report recommendations are reasonable | 3+ reps | ___ reps | |
| 7 | No Salesforce performance degradation | < 3s page loads | ___s average | |
| 8 | Alignment metric baseline established | Baseline set | ___% alignment | |

#### 2. ROI Story (10 min)
- Present the GP upside calculation from the cohort analysis
- Show 2–3 specific deal examples where MarginArc added value
- Share rep testimonials
- Frame: "MarginArc identified $X in margin opportunity across Y deals in 30 days"

#### 3. Pricing Proposal (10 min)
Present pricing based on CRO guidance:

| Tier | Price/User/Month | Annual (est.) | Positioning |
|------|-----------------|---------------|-------------|
| Entry | $25–35 | Depends on seats | No-brainer at 4–5x ROI if capturing 5% upside |
| Standard | $50–75 | Depends on seats | Fair value at 2–3x ROI |
| Premium | $100 | Depends on seats | Requires 15%+ margin improvement proof |

Recommend starting at the **$25–35 tier** for design partners — the goal is adoption and proof, not revenue maximization.

#### 4. Decision (10 min)
Three possible outcomes:
1. **Expand**: convert to paid subscription, roll out to full sales team
2. **Extend**: need more time — agree on specific criteria and a 2-week extension
3. **Exit**: not a fit — collect feedback on why, offer to revisit in 6 months

If expanding:
- [ ] Agree on seat count and tier
- [ ] Assign `Fulcrum_User` permission set to remaining reps
- [ ] Schedule Phase 3 evaluation (BOM Builder, advanced analytics)
- [ ] Set quarterly business review cadence

---

## Appendix: Quick Reference

### Key URLs
| Resource | URL |
|----------|-----|
| Admin Portal | `https://api.marginarc.com/admin` |
| API Endpoint | `https://api.marginarc.com/api/recommend` |
| Package Install | Via Salesforce AppExchange or direct link |

### Permission Sets
| Permission Set | Who Gets It |
|---------------|-------------|
| `Fulcrum_Admin` | Sales ops admin, MarginArc config manager |
| `Fulcrum_Manager` | Sales managers, VP of Sales |
| `Fulcrum_User` | All sales reps |

### Demo Data Scenarios
| Scenario ID | Description | Typical Deal Mix |
|-------------|-------------|-----------------|
| `networking-var` | Cisco/Arista-heavy | Networking 60%, Security 20%, Compute 20% |
| `security-var` | Palo Alto/Fortinet-focused | Security 60%, Networking 25%, Software 15% |
| `cloud-var` | Microsoft/VMware cloud | Software 50%, Compute 30%, Networking 20% |
| `full-stack-var` | Multi-vendor broad portfolio | Even mix across all categories |
| `services-heavy-var` | Services-led, lower product margins | Services-attached on 70%+ of deals |

### Setup Wizard Steps (Reference)
| Step | What It Does |
|------|-------------|
| 1. Welcome | Intro + demo data loading |
| 2. Connection | API URL, API Key, Gemini Key verification + connectivity test |
| 3. Data Quality | Field fill rates for 5 key fields + improvement suggestions |
| 4. Configuration | OEM vendor and Competitor record check |
| 5. Backfill | Historical deal analysis (6/12/24 months) |
| 6. Algorithm Phases | Phase 1→2→3 progression with unlock requirements |
| 7. Complete | Intelligence Maturity score + next steps |

### Troubleshooting
| Issue | Fix |
|-------|-----|
| Connection test fails | Check Remote Site Setting: `Fulcrum_API` → `https://api.marginarc.com` |
| Demo data won't load | Verify API key is set in `Fulcrum_Config__c` and API is reachable |
| "Demo data already loaded" | Use **Clear Demo Data** first, then reload with new scenario |
| Backfill stuck | Check Apex Jobs in Setup — look for `MarginArcBatchAnalyzer` status |
| Phase 2 won't enable | Need ≥ 50 scored deals AND ≥ 60% data quality |
| Nightly analyzer not running | Check Scheduled Jobs for `MarginArc Nightly Analyzer` — reschedule if missing |
| Score My Deal button missing | Verify `Fulcrum_User` or `Fulcrum_Admin` permission set is assigned |
