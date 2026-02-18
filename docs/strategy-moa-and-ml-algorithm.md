# MarginArc Strategy: MOA Scanner + Real ML Algorithm

## The Two Products

### Product 1: Margin Opportunity Assessment (MOA) — Open Source
**Purpose:** Free diagnostic tool that shows VARs how much margin they're leaving on the table. Sells MarginArc by proving the problem exists with their own data.

**Business model:** Free. Open source (Apache 2.0). Separate repo, separate SFDC package. Zero connection to MarginArc codebase. The Scanner is the diagnosis; MarginArc is the treatment.

**GTM motion:**
1. Prospect installs MOA from GitHub (5 min, self-serve)
2. MOA scans their last 24 months of closed deals
3. Produces a "Margin Opportunity Report" showing total $ left on the table
4. Sales call to walk through findings
5. "MarginArc captures this continuously. Want a 30-day pilot?"
6. **Critical:** MOA's historical data bootstraps MarginArc Phase 2 on day 1 — no cold start

### Product 2: MarginArc ML Engine — Proprietary
**Purpose:** Replace the hardcoded rules engine with a real predictive model trained on each customer's historical deals. The model learns patterns humans can't see and recommends margins that maximize expected gross profit.

**Why ML beats rules:**
- Rules: "Enterprise base = 14%, add 3% for deal reg" — any pricing manager knows this
- ML: "Cisco deals in Life Sciences with 2+ competitors and services attached close BETTER at 18% than 14% — your team has been underpricing these by 4pp" — no human sees this pattern across 5,000 deals

---

## MOA Scanner: Technical Design

### What It Computes (All Basic Statistics, Nothing Proprietary)

```
INPUT: Last 24 months of Closed Won + Closed Lost Opportunities
       + Account data (Industry, Segment, AnnualRevenue)
       + OpportunityLineItem data (Product Family, UnitPrice, Quantity)

ANALYSIS:
  1. Segment deals into cohorts:
     - OEM (from Product Family or line item patterns)
     - Size bucket: <$25K, $25-100K, $100-500K, $500K-1M, $1M+
     - Customer tier: SMB / MidMarket / Enterprise (from AnnualRevenue)
     - Industry (from Account.Industry)

  2. For each cohort (minimum 5 deals to report):
     - Median margin achieved on Won deals
     - P25 / P75 (interquartile range)
     - Win rate overall
     - Win rate by margin band (0-10%, 10-15%, 15-20%, 20%+)
     - Deal count

  3. For each deal:
     - Compare actual margin to cohort median
     - Delta ($) = (cohort_median - actual_margin) × amount
     - Flag: "above median" / "below median" / "significantly below" (>5pp gap)

  4. For each rep (Opportunity.Owner):
     - Average margin vs team average on same-cohort deals
     - Consistency score (std dev of margin within cohorts)
     - "Margin left on table" = sum of deltas on below-median deals

  5. Roll-up metrics:
     - Total margin opportunity = Σ(delta) for all below-median Won deals
     - Rep variance impact = difference between top quartile and bottom quartile rep margins
     - "If every deal matched cohort median: $X additional GP/year"
     - "If every rep matched top quartile on their cohort: $Y additional GP/year"
```

### What It Shows (The Report)

**Page 1: Executive Summary**
- Deals analyzed / Total revenue / Time period
- Current average margin vs achievable average margin
- Annual margin opportunity ($)
- Top 3 opportunity areas by segment

**Page 2: Segment Breakdown**
- Table: Cohort | Deal Count | Avg Margin | Median Margin | Opportunity ($)
- Bar chart: Margin distribution by top 5 segments
- Heatmap: OEM × Customer Tier → average margin (color = above/below median)

**Page 3: Rep Performance**
- Table: Rep | Deals | Avg Margin | vs Team Avg | Consistency | Opportunity ($)
- Chart: Rep margin vs team average on same-cohort deals
- "Your top reps achieve X% — your bottom reps achieve Y% on identical deal profiles"

**Page 4: Win Rate Analysis**
- Win rate by margin band (shows the "pricing sweet spot")
- Scatter: Margin % vs Win Probability (actual data points)
- Key insight: "Deals priced between X-Y% win at Z% rate — the sweet spot"

### What It Does NOT Contain
- Zero MarginArc algorithm code
- Zero API calls (everything in Apex, on their org)
- Zero data exfiltration
- No predictive modeling
- No recommendations (only retrospective analysis)
- "Powered by MarginArc" footer with link to website

### Architecture
```
marginarc/margin-opportunity-assessment/    (separate GitHub repo)
├── README.md
├── LICENSE                                 (Apache 2.0)
├── sfdx-project.json
├── force-app/main/default/
│   ├── classes/
│   │   ├── MOA_Scanner.cls                 (main analysis engine)
│   │   ├── MOA_ScannerTest.cls
│   │   ├── MOA_ReportGenerator.cls         (builds report data)
│   │   ├── MOA_ReportGeneratorTest.cls
│   │   ├── MOA_InstallHandler.cls          (post-install: auto-scan)
│   │   └── MOA_InstallHandlerTest.cls
│   ├── lwc/
│   │   ├── moaDashboard/                   (main report view)
│   │   ├── moaSegmentChart/                (segment breakdown)
│   │   ├── moaRepLeaderboard/              (rep performance)
│   │   └── moaWinRateChart/                (win rate analysis)
│   ├── permissionsets/
│   │   └── MOA_User.permissionset-meta.xml (read-only: Opportunity, Account, OLI, User)
│   ├── tabs/
│   │   └── Margin_Opportunity_Assessment.tab-meta.xml
│   └── customMetadata/
│       └── MOA_Config.md-meta.xml          (scan parameters: time range, min cohort size)
└── docs/
    ├── sample-report.png
    ├── installation-guide.md
    └── how-it-works.md                      (explains the statistics for transparency)
```

### Trial Expiry Logic
- `MOA_InstallHandler` records install date in a Custom Setting
- Dashboard checks: if today > install_date + 30 days, show "Trial expired" banner
- Report data is still visible (don't delete their analysis) but "Scan Now" button disabled
- Banner includes CTA: "Want continuous margin optimization? Learn about MarginArc →"

---

## MarginArc ML Engine: Technical Design

### Why Replace the Rules Engine

The current rules engine (`rules.js`) is:
```javascript
// This is a spreadsheet, not AI
const segmentBase = { SMB: 20, MidMarket: 17, Enterprise: 14 }
let margin = segmentBase[segment]
if (dealReg === 'Premium') margin += 3
if (competitors >= 3) margin -= 2
// ... 15 more if/else rules with hardcoded weights
```

A customer's pricing manager could write this in an afternoon. There is no learning, no adaptation, no pattern discovery. The weights are our guesses, not derived from data.

### The ML Approach: Two-Model Architecture

**Model 1: Win Probability Model**
```
Input:  Deal features + proposed_margin
Output: P(win | features, proposed_margin)
Type:   Logistic regression (MVP) → Gradient boosted trees (v2)
```

- Trained on Closed Won (label=1) and Closed Lost (label=0) deals
- `proposed_margin` is an INPUT feature — the model learns how margin affects win probability
- This captures: "at 20% margin with Cisco Enterprise 2-competitor deals, P(win) = 0.62"

**Model 2: Margin Optimizer**
```
For a new deal with known features:
  For margin in [5%, 5.5%, 6%, ... 29.5%, 30%]:
    expected_gp = margin × amount × P(win | features, margin)

  Recommend:
    optimal_margin    = argmax(expected_gp)         — maximize expected profit
    conservative_margin = max margin where P(win) > 0.7  — prioritize winning
    aggressive_margin  = max margin where P(win) > 0.5   — maximize margin
```

This gives the rep three options:
- "Safe bet: 14% (72% chance of winning, $7,840 expected GP)"
- "Optimal: 17% (61% chance of winning, $9,537 expected GP)"  ← recommended
- "Aggressive: 21% (48% chance of winning, $10,080 expected GP)"

### Feature Set

| Feature | Type | Source |
|---------|------|--------|
| oem | Categorical | Product Family / line items |
| deal_size | Continuous (log) | Opportunity.Amount |
| customer_segment | Categorical | Account.AnnualRevenue tiers |
| industry | Categorical | Account.Industry |
| n_competitors | Integer | Competitor count field |
| deal_reg_type | Categorical | Deal registration field |
| has_services | Binary | Services attached field |
| customer_loyalty | Ordinal (1-5) | Customer loyalty field |
| deal_urgency | Ordinal (1-5) | Deal urgency field |
| solution_complexity | Ordinal (1-5) | Solution complexity field |
| is_new_logo | Binary | New vs existing customer |
| quarter_end | Binary | Close date near quarter end |
| proposed_margin | Continuous | The margin being evaluated |

### Why Logistic Regression for MVP

1. **Runs in Node.js** — no Python dependency needed. The model is just a weight vector. Inference = dot product + sigmoid.
2. **Interpretable** — weights directly map to "key drivers" for the rep. "Competitors: -1.3pp per competitor" is a real learned coefficient, not a hardcoded guess.
3. **Fast to train** — gradient descent on 5,000 deals takes < 1 second
4. **Trainable in-Lambda** — no SageMaker, no GPU, no infrastructure
5. **Good enough** — logistic regression performs within 2-3% AUC of GBT on structured tabular data with <10K rows
6. **Upgradeable** — swap to XGBoost later without changing the API contract

### Training Pipeline

```
Trigger: Nightly batch OR on-demand via admin API

1. EXTRACT
   - Pull all Closed Won + Closed Lost deals from recorded_deals table
   - Filter: last 36 months, has margin data, has outcome (won/lost)
   - Minimum: 100 deals to train (below this, fall back to industry benchmarks)

2. FEATURE ENGINEERING
   - One-hot encode categoricals (OEM, segment, industry, deal_reg)
   - Log-transform deal_size
   - Normalize continuous features (z-score)
   - Handle missing values (impute median for continuous, "Unknown" category for categorical)
   - Create interaction features: oem × segment, has_services × deal_size

3. TRAIN
   - Split: 80% train, 20% validation
   - Logistic regression with L2 regularization
   - Hyperparameter: regularization strength λ via cross-validation
   - Output: weight vector W, bias b, feature_means, feature_stds

4. EVALUATE
   - AUC-ROC on validation set (target: > 0.65 for MVP)
   - Calibration: predicted P(win) vs actual win rate in buckets
   - Feature importance: |W_i| ranked
   - Sanity checks: does increasing margin decrease P(win)? (it must)

5. SERIALIZE
   - Store model parameters as JSON in customer_config table:
     { weights: [...], bias: 0.3, features: [...], means: [...], stds: [...], auc: 0.71, trained_at: "2026-02-17", n_deals: 4832 }
   - Also store in S3 as backup

6. ACTIVATE
   - Set customer phase to 2 (if previously phase 1 and AUC > 0.60)
   - Log training metrics to CloudWatch
```

### Inference Pipeline (Replaces Rules Engine)

```
Request: POST /api/recommend
  { oem: "Cisco", dealSize: 56000, segment: "Enterprise", ... , plannedMarginPct: 15 }

1. Load model parameters for this customer (from customer_config or S3)
2. Feature-engineer the input (same transforms as training)
3. Sweep margin from 5% to 30% in 0.5% steps:
   For each margin_point:
     features_with_margin = [...deal_features, margin_point]
     logit = dot(W, features_with_margin) + b
     p_win = sigmoid(logit)
     expected_gp = margin_point × amount × p_win
4. Find:
   - optimal_margin = argmax(expected_gp)
   - conservative_margin = max margin where p_win > 0.7
   - aggressive_margin = max margin where p_win > 0.5
   - expected_gp_curve = [{margin, p_win, expected_gp}, ...]
5. Compute key drivers from feature weights:
   - Sort |W_i × x_i| descending
   - Top 5 = key drivers with direction and magnitude
6. Return:
   {
     suggestedMarginPct: optimal_margin,
     conservativeMarginPct: conservative_margin,
     aggressiveMarginPct: aggressive_margin,
     winProbability: p_win_at_optimal,
     expectedGP: max_expected_gp,
     confidence: based on similar deal count + model AUC,
     keyDrivers: [
       { name: "Cisco OEM", impact: -1.3, direction: "negative", sentence: "Cisco deals close at 1.3pp lower margin than average — tight vendor margins" },
       { name: "Deal registration", impact: +2.8, direction: "positive", sentence: "Premium registration protects 2.8pp of margin on average" },
       ...
     ],
     expectedGPCurve: [...],  // for the "margin vs GP" chart
     modelMetrics: { auc: 0.71, nDeals: 4832, trainedAt: "2026-02-17" }
   }
```

### Phase Progression (Revised)

| Phase | Trigger | Algorithm | What Seller Sees |
|-------|---------|-----------|-----------------|
| **Phase 1** | 0-99 deals recorded | Industry benchmarks (static, curated by us) | Margin range from benchmark data + deal score + data quality nudges |
| **Phase 2** | 100+ deals with outcomes, model AUC > 0.60 | Customer-specific logistic regression | Specific margin recommendation + confidence interval + key drivers + expected GP curve |
| **Phase 3** | 500+ deals, customer opts in to network | Network-pooled model (multi-customer) + competitor intelligence from network | Everything in Phase 2 + competitor pricing intelligence + cross-VAR benchmarks |

**Key change:** Phase 1 threshold moves from 50 "scored" deals to 100 deals with OUTCOMES (Closed Won/Lost with margin data). Scoring a deal doesn't teach the model anything — winning or losing does.

### Signal Taxonomy (Revised)

**Principle:** Maximize auto-detected signals, minimize rep input. Reps won't fill in fields.

**Tier 1 — Auto-Detected from SFDC/recorded_deals (Zero Friction):**
Deal Size, Industry Vertical, Account Size, Customer Segment, Quarter-End Timing, Rep Win Rate, Discount Patterns, Purchase Cadence, Lifetime Margin Trend, Contract Type

**Tier 2 — Auto-Inferred (Minor Setup):**
OEM Vendor (from Product Family), Product Category, Services Mix (from line items), Relationship Depth (computed from deal history), Head-to-Head Record, Compliance Score

**Tier 3 — Rep Input (3 Fields Max):**
Deal Registration Type (picklist, 1 click), Competitor Count (picklist, 1 click), Displacement Flag (checkbox, 1 click)

**Total: 18 features for the ML model.** 15 auto-detected, 3 rep-input clicks.

### Data Infrastructure (Already Built)

The `recorded_deals` table already contains all needed columns:
- Features: segment, industry, product_category, deal_reg_type, competitors, oem, oem_cost, services_attached, quarter_end, customer_price_sensitivity, customer_loyalty, deal_urgency, is_new_logo, solution_differentiation, solution_complexity, value_add, relationship_strength, competitor_names, bom_line_count, bom_avg_margin_pct
- Outcome: `status` (Won/Lost), `achieved_margin` (NUMERIC as fraction), `loss_reason`
- Multi-tenant: `org_id`

`MarginArcDealOutcomeSync` already pushes closed deals weekly to `POST /api/deals`. No new data pipeline needed.

### Phase 1 Redesign: Industry Benchmarks

Instead of hiding the margin recommendation, Phase 1 uses **curated industry benchmarks** (from public data, analyst reports, our own research):

```javascript
// Static benchmark data compiled by MarginArc team
const BENCHMARKS = {
  "Cisco|Enterprise|$100K-500K": { median: 14.5, p25: 11.0, p75: 18.0, source: "Industry benchmark (2025)" },
  "Dell|MidMarket|$25K-100K":   { median: 18.2, p25: 14.0, p75: 22.0, source: "Industry benchmark (2025)" },
  "HPE|SMB|<$25K":              { median: 21.0, p25: 17.0, p75: 25.0, source: "Industry benchmark (2025)" },
  // ... curated by us, updated quarterly
}
```

Phase 1 sellers see:
> **Industry Benchmark: 14-18%** (based on similar Cisco Enterprise deals)
> Your planned margin (15%) is in the middle of the range.
> *This benchmark is based on industry data. Your personalized recommendation unlocks after 100 closed deals.*

This is useful from day 1 without requiring any customer-specific data.

### Key Drivers: Learned, Not Hardcoded

Current (useless):
> "SMB segment pricing supports higher base margins"

With ML (useful):
> "Deal registration protects 2.8pp of margin — your registered deals close at 17.1% vs 14.3% unregistered (p < 0.01, n=847)"
> "Each additional competitor costs ~1.3pp — this deal has 3, which is above your average of 1.4"
> "Cisco networking deals with services attached close 3.1pp higher — consider bundling implementation"

These sentences are generated from actual model coefficients trained on the customer's own data. They're specific, quantified, and actionable because they come from real patterns, not templates.

---

## How MOA and ML Connect

```
PROSPECT JOURNEY:

1. Install MOA (free, open source)
   └── MOA scans 24 months of deals
   └── MOA shows: "You left $14.8M on the table"

2. Sales call: "How do we fix this?"
   └── "Install MarginArc. We'll use your historical data to build a custom model."

3. Install MarginArc
   └── MarginArc ingests the same deals MOA analyzed
   └── If 100+ deals with outcomes → skip Phase 1, go straight to Phase 2
   └── Train win probability model on their historical data
   └── Day 1: personalized margin recommendations on every open deal

4. Ongoing
   └── Every closed deal retrains the model (nightly)
   └── Model gets better over time
   └── Phase 3: opt into network pooling for cross-VAR intelligence
```

The cold-start problem is GONE. MOA is the bridge.

---

## Implementation Prompts

### Epic 13: MOA Scanner (Open Source)

| Prompt | What | Dependencies |
|--------|------|-------------|
| 13A | Scaffold repo, SFDC project, permission set, install handler, README | None |
| 13B | Scanner engine: deal extraction, cohort segmentation, statistical analysis | 13A |
| 13C | Report LWC: executive summary, segment breakdown, rep leaderboard, win rate chart | 13B |
| 13D | Polish: PDF export, trial expiry, "Powered by MarginArc" CTA, sample screenshots | 13C |

### Epic 14: ML Algorithm (Proprietary)

| Prompt | What | Dependencies |
|--------|------|-------------|
| 14A | Training pipeline: feature engineering, logistic regression, model serialization (all in Node.js on Lambda) | None |
| 14B | Inference pipeline: replace rules engine with model-based predictions, margin sweep, expected GP curve | 14A |
| 14C | Phase 1 redesign: curated industry benchmarks, range display, "unlocks at 100 deals" messaging | 14A |
| 14D | Phase 2 integration: auto-train trigger, model quality checks, phase promotion logic | 14A, 14B |
| 14E | Key drivers: generate specific, quantified insights from model coefficients | 14B |
| 14F | LWC updates: show margin range (Phase 1) / specific recommendation with confidence (Phase 2), expected GP curve, learned drivers | 14B, 14C, 14E |

### Epic 15: Management Features Audit + Fix

| Prompt | What | Dependencies |
|--------|------|-------------|
| 15A | Load Manager Dashboard with demo data, screenshot every section, identify broken features | None |
| 15B | Fix identified issues from 15A audit | 15A |
| 15C | Add "Does Following MarginArc Work?" cohort analysis using real model-based recommendations | 14B |
