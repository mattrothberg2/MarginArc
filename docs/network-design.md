# MarginArc Network — Design Document

> Anonymized deal intelligence pooled across non-competing VARs via federated learning with differential privacy.

**Status:** Draft
**Date:** 2026-02-17
**Scope:** Design only — no implementation in this document.

---

## Table of Contents

1. [Anonymized Deal Schema](#1-anonymized-deal-schema)
2. [Competitor Firewalling](#2-competitor-firewalling)
3. [Data Contribution Tiers](#3-data-contribution-tiers)
4. [Integration Points](#4-integration-points)
5. [Database Schema](#5-database-schema)
6. [Privacy Guarantees](#6-privacy-guarantees)

---

## 1. Anonymized Deal Schema

### Design Principle

The network schema must preserve the signals that drive the kNN similarity function (`knn.js`) while stripping all fields that could identify a specific customer, account, sales rep, or VAR. The key insight: the similarity function never uses customer name, account name, rep name, or exact dollar amounts — it operates on categorical segments, ordinal scores, and cost bands. This means we can share almost everything the engine needs.

### Fields Kept (directly shareable)

These fields map 1:1 to what `similarity()` in `knn.js` already consumes:

| Field | Type | Source field | Rationale |
|---|---|---|---|
| `oem` | `VARCHAR(100)` | `oem` | OEM vendor identity (Cisco, HPE, etc.). Critical for similarity matching (0.5 weight). Public knowledge — VARs sell the same vendors. |
| `product_category` | `VARCHAR(50)` | `productCategory` | Hardware / Software / Cloud. 0.8 similarity weight. No PII risk. |
| `segment` | `VARCHAR(50)` | `segment` | SMB / MidMarket / Enterprise. 1.0 similarity weight (highest). Represents customer *type*, not identity. |
| `industry` | `VARCHAR(100)` | `customerIndustry` | Vertical (e.g., "Financial Services"). 0.5 weight. Broad category, not identifying. |
| `deal_reg_type` | `VARCHAR(30)` | `dealRegType` | NotRegistered / StandardApproved / PremiumHunting / Teaming. 0.6 weight. |
| `competitors` | `VARCHAR(5)` | `competitors` | Count: 0 / 1 / 2 / 3+. 0.6 weight. Does not reveal *who* competed. |
| `value_add` | `VARCHAR(10)` | `valueAdd` | Low / Medium / High. 0.6 weight. |
| `solution_complexity` | `VARCHAR(10)` | `solutionComplexity` | Low / Medium / High. 0.5 weight. |
| `relationship_strength` | `VARCHAR(20)` | `relationshipStrength` | New / Good / Strong / Strategic. 0.4 weight. Describes *the contributing VAR's* relationship, still useful as a signal of deal dynamics. |
| `customer_tech_sophistication` | `VARCHAR(10)` | `customerTechSophistication` | Low / Medium / High. 0.3 weight. |
| `customer_price_sensitivity` | `SMALLINT` | `customerPriceSensitivity` | 1-5 scale. 0.3 weight. |
| `customer_loyalty` | `SMALLINT` | `customerLoyalty` | 1-5 scale. 0.2 weight. |
| `deal_urgency` | `SMALLINT` | `dealUrgency` | 1-5 scale. 0.3 weight. |
| `is_new_logo` | `BOOLEAN` | `isNewLogo` | New vs. existing customer. 0.2 weight. |
| `solution_differentiation` | `SMALLINT` | `solutionDifferentiation` | 1-5 scale. 0.3 weight. |
| `services_attached` | `BOOLEAN` | `servicesAttached` | Whether services were bundled. 0.25 weight. |
| `quarter_end` | `BOOLEAN` | `quarterEnd` | Whether deal closed at quarter end. 0.2 weight. |
| `has_manual_bom` | `BOOLEAN` | `hasManualBom` | BOM entry method. 0.3 weight. |
| `status` | `VARCHAR(10)` | `status` | Won / Lost. Open deals are never shared. |
| `loss_reason` | `VARCHAR(255)` | `lossReason` | Price / Relationship / Technical / etc. Used by `topKNeighbors()` for `lossOnPrice` calculation. |

### Fields Transformed (banded or bucketed)

These fields carry useful signal but their exact values could fingerprint deals:

| Network Field | Type | Source | Transformation | Rationale |
|---|---|---|---|---|
| `deal_size_band` | `VARCHAR(30)` | `oemCost` | Bucketed into bands (see below) | Exact OEM cost reveals pricing. Bands preserve the `band()` function in `knn.js` which already buckets at $100K and $500K thresholds. |
| `achieved_margin_band` | `VARCHAR(20)` | `achievedMargin` | 5-point bands (see below) | Exact margin is the most sensitive competitive data. Bands still allow weighted average calculation within cohorts. |
| `bom_line_count_band` | `VARCHAR(20)` | `bomLineCount` | Bucketed: 1-3 / 4-6 / 7-10 / 11+ | Exact count could help identify deals. Bands preserve the diff-based similarity logic in `knn.js`. |
| `close_quarter` | `VARCHAR(10)` | `closeDate` | "Q3 2024" (quarter + year only) | Exact date narrows identification. Quarter preserves `timeDecay()` functionality (which operates on year-scale granularity: ≤1yr, ≤2yr, ≤3yr, ≤5yr). |

**Deal size bands:**

| Band Label | OEM Cost Range |
|---|---|
| `<$25K` | $0 – $24,999 |
| `$25K-$50K` | $25,000 – $49,999 |
| `$50K-$100K` | $50,000 – $99,999 |
| `$100K-$250K` | $100,000 – $249,999 |
| `$250K-$500K` | $250,000 – $499,999 |
| `$500K-$1M` | $500,000 – $999,999 |
| `$1M+` | $1,000,000+ |

These align with the `band()` function in `knn.js` (thresholds at $100K and $500K) while adding finer granularity at the lower end where most VAR deals cluster.

**Achieved margin bands:**

| Band Label | Margin Range |
|---|---|
| `0-5%` | 0.00 – 0.049 |
| `5-10%` | 0.05 – 0.099 |
| `10-15%` | 0.10 – 0.149 |
| `15-20%` | 0.15 – 0.199 |
| `20-25%` | 0.20 – 0.249 |
| `25-30%` | 0.25 – 0.299 |
| `30%+` | 0.30+ |

**BOM line count bands:**

| Band Label | Count Range |
|---|---|
| `1-3` | 1 – 3 |
| `4-6` | 4 – 6 |
| `7-10` | 7 – 10 |
| `11+` | 11+ |

### New Field: Region

A new `region` field is added to the deal schema to capture geographic signal. This is useful for network intelligence because margin expectations and competitive dynamics vary significantly by region.

| Value | Coverage |
|---|---|
| `Northeast` | CT, DC, DE, MA, MD, ME, NH, NJ, NY, PA, RI, VT, VA |
| `Southeast` | AL, AR, FL, GA, KY, LA, MS, NC, SC, TN, WV |
| `Midwest` | IA, IL, IN, KS, MI, MN, MO, ND, NE, OH, SD, WI |
| `West` | AK, AZ, CA, CO, HI, ID, MT, NM, NV, OR, UT, WA, WY, TX |
| `International` | Non-US deals |

Region is safe to share — it is broad enough to never identify a specific customer. It would need to be added to the local deal schema (`recorded_deals`) as well before it can flow into the network.

### Fields Stripped (never shared)

| Source Field | Reason for Exclusion |
|---|---|
| `description` | Contains customer name (e.g., "Acme Corp Networking #3") |
| `customer` | Direct PII — the customer/account name |
| `competitorNames` | Reveals *which* VARs competed. Critical exclusion — see §2. |
| `oemCost` (exact) | Exact cost reveals VAR-specific pricing from OEM |
| `achievedMargin` (exact) | Exact margin is the most competitively sensitive number |
| `amount` (exact) | Sell price = oemCost × (1 + margin), reconstructable |
| `bomLines` (detailed) | Individual line items with SKUs, unit costs, and unit prices are proprietary |
| `bomAvgMarginPct` (exact) | Exact BOM margin could fingerprint pricing strategy |
| `bomBlendedMarginPct` | Same concern as bomAvgMarginPct |
| `plannedMargin` | Internal pricing strategy |
| `avgDealSize` | Customer-level metric, identifying |
| `relationshipStage` | Customer-specific lifecycle data |
| `valueAddExpectation` | Customer-specific expectation |
| `displacementDeal` | Combined with other fields, could narrow identification |
| `varStrategicImportance` | VAR-internal classification |
| `closeDate` (exact) | Replaced by `close_quarter` |

### Derived Fields (computed at network level)

These fields don't exist on individual deals but are computed across the network for cohort-level intelligence:

| Field | Computation | Use |
|---|---|---|
| `cohort_win_rate` | Won / (Won + Lost) for deals matching a similarity profile | Network prior for win probability |
| `cohort_margin_median` | Median of `achieved_margin_band` midpoints within a cohort | Network prior for margin recommendation |
| `cohort_size` | Count of deals in a similarity cohort | Confidence indicator — suppressed if below minimum |
| `region_margin_delta` | Region median margin − national median margin | Regional adjustment signal |

---

## 2. Competitor Firewalling

### Problem Statement

VAR A and VAR B may compete on the same deals. If VAR A contributes a deal where VAR B was the competitor, and VAR B receives that deal from the network, VAR B could learn:
- That VAR A bid on this deal
- What margin range VAR A achieved
- How VAR A's pricing compared

This is unacceptable. The network must prevent any VAR from receiving deals where they were named as a competitor.

### Hashed Exclusion System

#### Onboarding: Identity Declaration

When a VAR enrolls in the network, they declare their identity using a set of names they are known by in the market:

```
VAR declares: ["CDW", "CDW Corporation", "CDW-G"]
```

Each name is normalized and hashed:

```
normalize("CDW") → "cdw"
SHA-256("cdw") → "a3f2...7b91"
```

The network stores only the hashes, never the plaintext names. This set becomes the VAR's **exclusion fingerprint**.

#### Deal Contribution: Competitor Hashing

When a VAR contributes a deal, the `competitorNames` field (e.g., `"CDW;Presidio;SHI International"`) is processed:

1. Split by delimiter (`;`)
2. Normalize each name (lowercase, trim, remove "Inc", "Corp", "LLC", etc.)
3. Hash each name: `SHA-256(normalize(name))`
4. Store the hash set on the network deal record as `competitor_hashes JSONB`

The plaintext competitor names are **never stored** in the network database.

#### Query-Time Filtering

When VAR B requests network deals for their kNN pool:

```sql
SELECT * FROM network_deals
WHERE NOT (competitor_hashes ?| ARRAY[:var_b_hashes])
  AND source_var_hash != :var_b_identity_hash
```

This filters out:
1. Any deal where VAR B was named as a competitor (`competitor_hashes` overlap)
2. Any deal contributed by VAR B themselves (they already have their own data)

#### Edge Cases

| Scenario | Handling |
|---|---|
| VAR has multiple trade names | Declare all during onboarding; all are hashed and added to exclusion set |
| VAR acquires another VAR | Update exclusion set to include acquired company's names |
| Competitor name misspellings in source data | Apply fuzzy normalization before hashing (remove punctuation, common suffixes). Accept that some misspellings may slip through — this is a best-effort filter, and the banding of margins limits information leakage even on misses. |
| VAR wants to add exclusion names later | Append new hashes. Retroactive filtering: existing network deals with matching hashes are excluded from future queries for this VAR. No need to delete — just filter at read time. |
| Collusion attack (VAR declares false names to exclude competitors' data) | Rate-limit identity declarations. Require verification of company identity during onboarding. Flag accounts with unusually large exclusion sets. |

#### Name Normalization Rules

```
1. Lowercase
2. Trim whitespace
3. Remove trailing: Inc, Inc., Corp, Corp., Corporation, LLC, Ltd, Ltd., LP, L.P.
4. Remove punctuation: periods, commas, hyphens (except internal)
5. Collapse multiple spaces to single space
6. Examples:
   "CDW Corporation" → "cdw"
   "SHI International" → "shi international"
   "Insight Enterprises, Inc." → "insight enterprises"
```

---

## 3. Data Contribution Tiers

### Tier Definitions

| Tier | Contribution Requirement | Benefits | Cost Model |
|---|---|---|---|
| **Observer** | None — contributes zero deals | Receives network *priors* only: cohort win rates, margin band distributions. No individual deal records in kNN pool. | Free (included with any MarginArc license) |
| **Contributor** | ≥50 closed deals contributed per rolling 12 months | Full network deal pool access for kNN (filtered per §2). Full accuracy boost from peer deal similarity. | Included with Standard license tier |
| **Premium Contributor** | ≥500 closed deals contributed per rolling 12 months | Everything in Contributor, plus: priority model updates (network refresh every 1 hour vs. 6 hours), access to regional and OEM-specific cohort analytics, early access to network-derived features. | Included with Enterprise license tier |

### Observer Tier — What "Priors Only" Means

Observers do not receive individual deal records. Instead, they receive pre-aggregated statistical priors computed across the full network:

```json
{
  "cohort": {
    "oem": "Cisco",
    "segment": "MidMarket",
    "product_category": "Hardware",
    "deal_reg_type": "StandardApproved"
  },
  "priors": {
    "win_rate": 0.62,
    "margin_band_distribution": {
      "5-10%": 0.08,
      "10-15%": 0.31,
      "15-20%": 0.42,
      "20-25%": 0.15,
      "25-30%": 0.04
    },
    "median_margin_band": "15-20%",
    "sample_size": 847,
    "loss_reason_distribution": {
      "Price": 0.38,
      "Technical": 0.22,
      "Relationship": 0.18,
      "Budget": 0.12,
      "Timing": 0.06,
      "Direct": 0.03,
      "NoDecision": 0.01
    }
  }
}
```

These priors can nudge the rules engine (`rules.js`) without requiring access to raw deal records. Implementation: add a `networkPrior` input to `ruleBasedRecommendation()` that adjusts the baseline margin by ±1-2 points based on where the network median falls relative to the rule output.

### Contribution Counting

Deals are counted toward tier qualification when they meet all of:
- `status` is `Won` or `Lost` (Open deals never count)
- All required fields are populated (segment, industry, productCategory, dealRegType, competitors, achievedMargin, status)
- `close_quarter` is within the last 36 months (stale deals don't count toward the rolling threshold)
- Deal passes k-anonymity checks (see §6) — deals that are too unique to share safely still count toward the *contribution threshold* even though their data is suppressed

### Tier Transitions

- Tier is evaluated daily based on the rolling 12-month contribution count
- Downgrade grace period: 30 days. If a Contributor drops below 50 deals, they retain Contributor access for 30 days before reverting to Observer.
- Upgrade is immediate upon meeting the threshold.
- Historical network deals already fetched and cached locally are not revoked on downgrade — they simply stop refreshing.

---

## 4. Integration Points

### Current Architecture: `getAllDeals()` in analytics.js

Today, `getAllDeals()` combines two data sources:

```
getAllDeals(sampleDeals) → sampleDeals + getRecordedDeals()
```

1. **Sample data** (`sample_deals.json`): ~7,000 synthetic deals generated by `generateSyntheticDeals.js`. Used for demo/eval purposes.
2. **Recorded deals** (`recorded_deals` table): Real deals saved by the VAR through the MarginArc UI.

### Proposed: Add Network Deals as 3rd Source

```
getAllDeals(sampleDeals) → sampleDeals + getRecordedDeals() + getNetworkDeals(varId)
```

The `getNetworkDeals(varId)` function would:
1. Check the VAR's contribution tier
2. If Observer: return empty array (priors are applied separately, not through kNN)
3. If Contributor or Premium: query `network_deals` table with competitor firewall filtering
4. Transform rows into the deal object format expected by `similarity()` in `knn.js`
5. Cache results with a TTL matching the tier's refresh interval (6 hours for Contributor, 1 hour for Premium)

### Network Deal Weighting: 0.6x Multiplier

Network deals come from different VARs with different customer relationships, pricing strategies, and go-to-market motions. They are useful as market signals but should not outweigh a VAR's own historical data.

**Implementation in `topKNeighbors()`:**

Currently in `knn.js`:
```js
const scored = deals.map(d => ({
  d,
  s: similarity(input, d) * timeDecay(d.closeDate)
}))
```

With network deals, add a source weight:
```js
const scored = deals.map(d => ({
  d,
  s: similarity(input, d) * timeDecay(d.closeDate) * (d._networkDeal ? 0.6 : 1.0)
}))
```

The `_networkDeal` flag is set by `getNetworkDeals()` when constructing deal objects. It is a runtime-only flag, never persisted.

**Rationale for 0.6x:**
- Network deals lack VAR-specific context (relationship history, custom pricing agreements)
- Banded fields (deal size, margin) introduce quantization noise that reduces similarity precision
- The contributing VAR's `relationshipStrength` reflects *their* customer relationship, not the querying VAR's
- 0.6x ensures that a local deal with similarity score 5.0 outranks a network deal with similarity score 7.0 (5.0 > 7.0 × 0.6 = 4.2), preserving local data primacy

**Interaction with `timeDecay()`:**

`timeDecay()` operates on `closeDate`, but network deals only have `close_quarter`. To compute time decay for network deals:

```js
function timeDecayFromQuarter(closeQuarter) {
  // closeQuarter format: "Q3 2024"
  if (!closeQuarter) return 0.5
  const match = closeQuarter.match(/Q(\d)\s+(\d{4})/)
  if (!match) return 0.5
  const quarter = parseInt(match[1])
  const year = parseInt(match[2])
  // Use midpoint of quarter as synthetic date
  const month = (quarter - 1) * 3 + 1 // Q1→Jan, Q2→Apr, Q3→Jul, Q4→Oct
  const syntheticDate = new Date(year, month, 15)
  return timeDecay(syntheticDate.toISOString())
}
```

This uses the midpoint of the quarter as a synthetic close date. The granularity loss is acceptable because `timeDecay()` already operates in year-scale buckets (≤1yr, ≤2yr, etc.).

### Similarity Computation with Banded Fields

Several network deal fields are banded rather than exact. The similarity function needs to handle this:

**`oemCost` → `deal_size_band`:** The existing `band()` function in `knn.js` already buckets at $100K and $500K. For network deals, map the band label to a representative midpoint value:

| Band | Midpoint for `band()` |
|---|---|
| `<$25K` | $15,000 |
| `$25K-$50K` | $37,500 |
| `$50K-$100K` | $75,000 |
| `$100K-$250K` | $175,000 |
| `$250K-$500K` | $375,000 |
| `$500K-$1M` | $750,000 |
| `$1M+` | $1,500,000 |

**`bomLineCount` → `bom_line_count_band`:** Map to midpoints: 1-3→2, 4-6→5, 7-10→8, 11+→14.

**`achievedMargin` → `achieved_margin_band`:** For weighted average calculation in `topKNeighbors()`, use band midpoints: 0-5%→0.025, 5-10%→0.075, etc. This introduces ±2.5% noise, which is acceptable given the 0.6x source weight already dampens network deal influence.

### Priority of Data Sources in kNN

When `topKNeighbors()` selects the top k=12 deals, the 0.6x multiplier naturally creates a priority ordering:

1. **Recent local deals** (high similarity × 1.0 time decay × 1.0 source weight) — dominate
2. **Older local deals** (high similarity × lower time decay × 1.0 source weight) — significant
3. **Recent network deals** (moderate similarity × 1.0 time decay × 0.6 source weight) — supplementary
4. **Sample data** (varies × 1.0 source weight, but often lower similarity) — fallback

For new VARs with few recorded deals, network deals would naturally rank higher and provide more influence — exactly the intended behavior.

### Observer Tier: Prior Integration (Non-kNN Path)

For Observer-tier VARs, network intelligence flows through a separate path — not through the deal pool. The `ruleBasedRecommendation()` function in `rules.js` would accept an optional `networkPrior` parameter:

```
ruleBasedRecommendation(input, bomLines, vendorSkus, networkPrior)
```

The prior would nudge the rule output:
- If the network median margin band for the cohort is higher than the rule output: bump suggested margin by +0.5 to +1.0 points
- If the network median is lower: reduce by -0.5 to -1.0 points
- Cap the adjustment at ±1.5 points to prevent network data from overriding local rules

This provides a modest accuracy boost without exposing individual deal records.

---

## 5. Database Schema

### Table: `network_deals`

Stores anonymized deal records contributed by all participating VARs.

```sql
CREATE TABLE IF NOT EXISTS network_deals (
  id                            SERIAL PRIMARY KEY,

  -- Source tracking (hashed, never plaintext)
  source_var_hash               VARCHAR(64) NOT NULL,   -- SHA-256 of contributing VAR's org ID
  contribution_batch_id         UUID NOT NULL,           -- groups deals from a single sync

  -- Categorical fields (kept as-is from source)
  oem                           VARCHAR(100) NOT NULL,
  product_category              VARCHAR(50) NOT NULL,
  segment                       VARCHAR(50) NOT NULL,
  industry                      VARCHAR(100) NOT NULL,
  deal_reg_type                 VARCHAR(30) NOT NULL,
  competitors                   VARCHAR(5) NOT NULL,     -- count: 0/1/2/3+
  value_add                     VARCHAR(10) NOT NULL,
  solution_complexity           VARCHAR(10) NOT NULL,
  relationship_strength         VARCHAR(20) NOT NULL,
  customer_tech_sophistication  VARCHAR(10) NOT NULL,
  customer_price_sensitivity    SMALLINT,
  customer_loyalty              SMALLINT,
  deal_urgency                  SMALLINT,
  is_new_logo                   BOOLEAN,
  solution_differentiation      SMALLINT,
  services_attached             BOOLEAN,
  quarter_end                   BOOLEAN,
  has_manual_bom                BOOLEAN DEFAULT false,
  status                        VARCHAR(10) NOT NULL,     -- Won / Lost only
  loss_reason                   VARCHAR(255) DEFAULT '',
  region                        VARCHAR(20),              -- Northeast/Southeast/Midwest/West/International

  -- Banded fields (transformed from exact values)
  deal_size_band                VARCHAR(30) NOT NULL,     -- e.g., "$50K-$100K"
  achieved_margin_band          VARCHAR(20) NOT NULL,     -- e.g., "15-20%"
  bom_line_count_band           VARCHAR(20),              -- e.g., "4-6"
  close_quarter                 VARCHAR(10) NOT NULL,     -- e.g., "Q3 2024"

  -- Competitor firewalling
  competitor_hashes             JSONB,                    -- array of SHA-256 hashes of competitor names

  -- Noise-injected numeric (see §6)
  achieved_margin_noisy         NUMERIC(10,4),            -- margin with ε-differential privacy noise

  -- Metadata
  contributed_at                TIMESTAMPTZ DEFAULT NOW(),
  expires_at                    TIMESTAMPTZ               -- auto-expire after 36 months
);

-- Indexes for query-time filtering
CREATE INDEX IF NOT EXISTS idx_network_deals_source ON network_deals(source_var_hash);
CREATE INDEX IF NOT EXISTS idx_network_deals_oem ON network_deals(oem);
CREATE INDEX IF NOT EXISTS idx_network_deals_segment ON network_deals(segment);
CREATE INDEX IF NOT EXISTS idx_network_deals_category ON network_deals(product_category);
CREATE INDEX IF NOT EXISTS idx_network_deals_quarter ON network_deals(close_quarter);
CREATE INDEX IF NOT EXISTS idx_network_deals_status ON network_deals(status);
CREATE INDEX IF NOT EXISTS idx_network_deals_expires ON network_deals(expires_at);
CREATE INDEX IF NOT EXISTS idx_network_deals_competitors ON network_deals USING GIN(competitor_hashes);
```

### Table: `network_participants`

Tracks VAR enrollment, contribution tier, and competitor exclusion configuration.

```sql
CREATE TABLE IF NOT EXISTS network_participants (
  id                    SERIAL PRIMARY KEY,
  license_id            UUID NOT NULL REFERENCES licenses(id),
  var_identity_hash     VARCHAR(64) NOT NULL UNIQUE,    -- SHA-256 of org identifier
  display_name_enc      TEXT,                            -- encrypted VAR name (for admin use only)

  -- Contribution tier
  contribution_tier     VARCHAR(20) NOT NULL DEFAULT 'observer',  -- observer/contributor/premium
  tier_evaluated_at     TIMESTAMPTZ,
  tier_grace_expires    TIMESTAMPTZ,                     -- 30-day downgrade grace period

  -- Contribution stats
  deals_contributed_12m INTEGER DEFAULT 0,               -- rolling 12-month count
  deals_contributed_all INTEGER DEFAULT 0,               -- all-time count
  last_contribution_at  TIMESTAMPTZ,

  -- Competitor exclusion
  exclusion_hashes      JSONB NOT NULL DEFAULT '[]',     -- array of SHA-256 hashes of names this VAR is known by
  exclusion_updated_at  TIMESTAMPTZ,

  -- Configuration
  auto_contribute       BOOLEAN DEFAULT false,           -- whether deals are auto-synced or manually pushed
  region_default        VARCHAR(20),                     -- VAR's primary region

  -- Metadata
  enrolled_at           TIMESTAMPTZ DEFAULT NOW(),
  status                VARCHAR(20) DEFAULT 'active'     -- active / suspended / withdrawn
);

CREATE INDEX IF NOT EXISTS idx_network_participants_license ON network_participants(license_id);
CREATE INDEX IF NOT EXISTS idx_network_participants_tier ON network_participants(contribution_tier);
```

### Table: `network_sync_log`

Tracks synchronization events — both contributions (VAR → network) and fetches (network → VAR).

```sql
CREATE TABLE IF NOT EXISTS network_sync_log (
  id                SERIAL PRIMARY KEY,
  participant_id    INTEGER NOT NULL REFERENCES network_participants(id),
  sync_type         VARCHAR(20) NOT NULL,     -- 'contribute' or 'fetch'
  deals_synced      INTEGER DEFAULT 0,        -- count of deals contributed or fetched
  deals_filtered    INTEGER DEFAULT 0,        -- count excluded by competitor firewall (fetch only)
  deals_suppressed  INTEGER DEFAULT 0,        -- count suppressed by k-anonymity (contribute only)
  sync_status       VARCHAR(20) DEFAULT 'success',  -- success / partial / failed
  error_message     TEXT,
  started_at        TIMESTAMPTZ DEFAULT NOW(),
  completed_at      TIMESTAMPTZ,
  next_sync_at      TIMESTAMPTZ               -- scheduled next sync based on tier
);

CREATE INDEX IF NOT EXISTS idx_network_sync_participant ON network_sync_log(participant_id);
CREATE INDEX IF NOT EXISTS idx_network_sync_type ON network_sync_log(sync_type);
CREATE INDEX IF NOT EXISTS idx_network_sync_started ON network_sync_log(started_at);
```

### Migration Pattern

Following the existing pattern in `db.js` (idempotent `CREATE TABLE IF NOT EXISTS` called on cold start), add a new function:

```
ensureNetworkSchema()
```

This would be called alongside `ensureDealsSchema()` and `ensureSalesforceSchema()` during Lambda cold start. All `CREATE TABLE` and `CREATE INDEX` statements use `IF NOT EXISTS` for safe re-runs.

### Data Retention

- Network deals expire after 36 months (`expires_at` column)
- A scheduled job (daily) deletes expired rows: `DELETE FROM network_deals WHERE expires_at < NOW()`
- This aligns with `timeDecay()` which assigns only 0.30 weight to deals older than 5 years — 36-month expiry ensures network deals are still reasonably weighted when they expire
- Sync logs are retained for 12 months for audit purposes

---

## 6. Privacy Guarantees

### Threat Model

| Threat | Description | Mitigation |
|---|---|---|
| **Direct identification** | VAR B recognizes a specific deal from deal attributes | k-anonymity (§6.2), field banding (§1) |
| **Competitor intelligence** | VAR B learns VAR A's pricing from deals where they competed | Competitor firewalling (§2) |
| **Margin reconstruction** | Attacker infers exact margin from banded value | Differential privacy noise (§6.1), band width ≥5% |
| **Re-identification via linkage** | Combining multiple banded fields to narrow to a single deal | k-anonymity with minimum cohort size (§6.2) |
| **Membership inference** | Determining whether a specific deal exists in the network | Differential privacy (§6.1) makes individual records indistinguishable |
| **Source fingerprinting** | Identifying which VAR contributed a deal | Source hash is the only link; no plaintext VAR names stored |

### 6.1 Differential Privacy

Apply (ε, δ)-differential privacy with parameters:

```
ε = 1.0     (moderate privacy, good utility)
δ = 10⁻⁵   (negligible probability of catastrophic leakage)
```

**Where noise is applied:**

1. **`achieved_margin_noisy`:** Laplace noise added to the exact margin before contribution:
   ```
   achieved_margin_noisy = achieved_margin + Laplace(0, Δf/ε)
   ```
   where `Δf` = 0.05 (maximum sensitivity — margin values are bounded 0–0.45, but the meaningful range is ~0.40). This yields noise with standard deviation ~0.07, which is significant but acceptable given that the primary use is weighted averaging across k=12 neighbors.

2. **Cohort-level statistics (for Observer tier):** When computing priors (win rates, margin distributions), add noise calibrated to the cohort size:
   ```
   noisy_win_rate = true_win_rate + Laplace(0, 1/(n·ε))
   ```
   where `n` is the cohort size. Larger cohorts get less noise.

**What is NOT noised:**
- Categorical fields (segment, OEM, industry, etc.) — these are inherently low-resolution and shared across many deals
- Boolean fields (isNewLogo, servicesAttached, etc.) — randomized response could be applied but would destroy utility at the k=12 neighbor scale
- Status (Won/Lost) — essential for the core win rate computation

### 6.2 k-Anonymity

A deal is only contributed to the network if at least `k` other deals in the network share the same combination of quasi-identifier fields:

**Quasi-identifier set:**
- `oem` + `segment` + `product_category` + `deal_size_band` + `close_quarter`

**Minimum k = 5**

If fewer than 5 deals in the network match this quasi-identifier combination, the deal is **suppressed** — it is not stored in `network_deals`. It still counts toward the contributing VAR's tier threshold (so they aren't penalized for having unique deals), but the data is withheld until enough similar deals accumulate.

**Practical impact:** Common combinations (e.g., Cisco + MidMarket + Hardware + $50K-$100K + Q4 2024) will easily exceed k=5 once the network has a few dozen participants. Rare combinations (e.g., Arista + Enterprise + Hardware + $1M+ + Q1 2020) may be suppressed — which is the correct behavior, since those deals are most identifiable.

### 6.3 Minimum Cohort Sizes for Aggregation

When computing cohort-level statistics (for Observer priors or network analytics):

| Statistic | Minimum cohort size | Rationale |
|---|---|---|
| Win rate | 20 deals | Small cohorts produce unreliable rates and could reveal individual outcomes |
| Margin distribution | 30 deals | Need sufficient spread to be meaningful |
| Loss reason distribution | 15 deals | Smaller minimum because it's a secondary signal |
| Regional delta | 50 deals per region | Regional breakdowns need larger samples to avoid fingerprinting |

If a cohort is below the minimum, the statistic is not returned — the API returns `null` and the client falls back to the VAR's local data only.

### 6.4 Temporal Privacy

- Deals are not shared until 30 days after close. This prevents near-real-time competitive intelligence (e.g., "someone just won a Cisco deal in the Northeast at 18% margin" could be identifiable if it was closed yesterday).
- The `close_quarter` field naturally provides 3-month temporal resolution.
- The 30-day embargo plus quarter-level granularity means the earliest a deal can appear in the network is ~30 days after close, attributed to a 3-month window.

### 6.5 Contribution Privacy

No VAR can determine:
- How many VARs are in the network (participant count is never exposed)
- Which VARs are contributing (source_var_hash is never exposed to other VARs)
- How many deals any specific VAR contributed (contribution counts are private)

The only signal a VAR receives about the network is:
- The total count of deals in their filtered pool (after competitor exclusion)
- The deal records themselves (anonymized per this schema)
- Cohort-level priors (for Observers)

### 6.6 Audit and Compliance

- All sync events are logged in `network_sync_log` with counts of deals contributed, fetched, filtered, and suppressed
- Contributing VARs can request a full export of their contributed (anonymized) deals for audit purposes
- A VAR can withdraw from the network at any time: their contributed deals are marked for deletion within 72 hours (hard delete, not soft delete)
- Data residency: network deal data is stored in the same RDS instance (us-east-1). If international VARs participate, a data residency discussion is required — likely need regional shards or explicit consent for cross-border data processing.

---

## Appendix A: Network Deal Object Shape

The JavaScript object shape for network deals as they would appear in the kNN deal pool (after fetch and transformation by `getNetworkDeals()`):

```js
{
  // Fields used by similarity()
  segment: "MidMarket",
  customerIndustry: "Financial Services",
  industry: "Financial Services",
  productCategory: "Hardware",
  dealRegType: "StandardApproved",
  competitors: "2",
  valueAdd: "High",
  solutionComplexity: "Medium",
  relationshipStrength: "Good",
  customerTechSophistication: "Medium",
  customerPriceSensitivity: 3,
  customerLoyalty: 3,
  dealUrgency: 4,
  isNewLogo: false,
  solutionDifferentiation: 3,
  servicesAttached: true,
  quarterEnd: false,
  hasManualBom: false,
  oem: "Cisco",
  status: "Won",
  lossReason: "",

  // Banded fields mapped to midpoints for similarity computation
  oemCost: 75000,               // midpoint of "$50K-$100K" band
  bomLineCount: 5,              // midpoint of "4-6" band
  bomAvgMarginPct: null,        // not available from network

  // For timeDecay computation
  closeDate: "2024-08-15",      // synthetic midpoint of "Q3 2024"

  // Margin for weighted average
  achievedMargin: 0.1723,       // noise-injected value

  // Runtime flags (not persisted)
  _networkDeal: true,           // triggers 0.6x source weight
  _region: "Northeast"          // available for future regional similarity
}
```

## Appendix B: Contribution Flow

```
VAR's MarginArc Instance
        │
        ▼
  [1] Gather closed deals from recorded_deals
      (status = Won or Lost, closed > 30 days ago, not previously contributed)
        │
        ▼
  [2] Anonymize each deal:
      - Strip: customer, description, competitorNames (plaintext), exact amounts
      - Band: oemCost → deal_size_band, achievedMargin → achieved_margin_band,
              bomLineCount → bom_line_count_band, closeDate → close_quarter
      - Hash: competitorNames → competitor_hashes (SHA-256 per name)
      - Noise: achievedMargin → achieved_margin_noisy (Laplace noise)
      - Add: region (from VAR config or deal metadata)
        │
        ▼
  [3] POST to /api/network/contribute
      Body: { batch_id, deals: [...anonymized deals] }
      Auth: API key + license validation
        │
        ▼
  [4] Server-side:
      - Validate contributing VAR's license and network enrollment
      - k-anonymity check: suppress deals below k=5 threshold
      - Insert passing deals into network_deals
      - Update network_participants: deals_contributed_12m, last_contribution_at
      - Re-evaluate contribution tier
      - Log to network_sync_log
        │
        ▼
  [5] Response: { accepted: N, suppressed: M, new_tier: "contributor" }
```

## Appendix C: Fetch Flow

```
VAR's MarginArc Instance
        │
        ▼
  [1] GET /api/network/deals
      Auth: API key + license validation
      Params: var_identity_hash (for self-exclusion + competitor filtering)
        │
        ▼
  [2] Server-side:
      - Verify VAR's contribution tier ≥ Contributor (else return priors only)
      - Look up VAR's exclusion_hashes from network_participants
      - Query network_deals:
          WHERE source_var_hash != :var_hash
            AND NOT (competitor_hashes ?| ARRAY[:exclusion_hashes])
            AND expires_at > NOW()
            AND status IN ('Won', 'Lost')
      - Log to network_sync_log
        │
        ▼
  [3] Response: array of anonymized deal objects
        │
        ▼
  [4] Client-side:
      - Transform banded fields to midpoints (see §4)
      - Set _networkDeal = true on each deal
      - Merge into kNN pool via getAllDeals()
      - Cache with TTL: 6h (Contributor) or 1h (Premium)
```
