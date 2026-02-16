# MarginArc.ai Data Dictionary

**Version:** 1.1
**Last Updated:** 2026-02-07
**Salesforce API Version:** 62.0
**Namespace Prefix:** (none — all fields use `Fulcrum_` naming convention)

---

## Table of Contents

1. [Overview](#overview)
2. [Data Architecture](#data-architecture)
3. [Opportunity Custom Fields](#opportunity-custom-fields)
4. [Fulcrum_OEM\_\_c Object](#fulcrum_oem__c-object)
5. [Fulcrum_Competitor\_\_c Object](#fulcrum_competitor__c-object)
6. [Field Dependencies](#field-dependencies)
7. [Data Types & Validation](#data-types--validation)
8. [Signal-to-Field Mapping](#signal-to-field-mapping)
9. [Data Flow](#data-flow)
10. [Calculated Fields](#calculated-fields)
11. [Historical Data Requirements](#historical-data-requirements)

---

## Overview

MarginArc.ai extends the standard Salesforce Opportunity object with 22 custom fields and introduces two custom objects (`Fulcrum_OEM__c` and `Fulcrum_Competitor__c`) to power its margin intelligence engine. This data dictionary documents every field, its constraints, relationships, and role in the recommendation pipeline.

### Design Principles

- **Convention over configuration** — All MarginArc fields share the `Fulcrum_` prefix for easy identification and permission assignment.
- **Picklist-driven inputs** — Rep-entered fields use restricted picklists to ensure data quality and ML model compatibility.
- **Write-back pattern** — The LWC reads deal parameters, sends them to the API, and writes back recommendations to Opportunity fields. This ensures all intelligence is persisted on the record for reporting.
- **Separation of concerns** — OEM reference data and competitor profiles are stored in dedicated custom objects, not hard-coded.

---

## Data Architecture

### Object Relationship Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Opportunity                                  │
│  (Standard Object + 22 MarginArc Custom Fields)                        │
│                                                                      │
│  Fulcrum_OEM__c ─────────────────────── Text lookup by OEM name      │
│  Fulcrum_Competitor_Names__c ────────── Text lookup by competitor     │
│                                          name(s)                     │
│                                                                      │
│  ┌──────────────┐    ┌───────────────┐    ┌────────────────────┐     │
│  │ Deal Input   │    │ AI Output     │    │ Competitive Intel  │     │
│  │ Fields (12)  │───>│ Fields (5)    │    │ Fields (5)         │     │
│  └──────────────┘    └───────────────┘    └────────────────────┘     │
│                                                                      │
└──────────────────────────────────────┬──────────────────────────────┘
                                       │
                    ┌──────────────────┼──────────────────┐
                    │                  │                   │
                    v                  v                   v
          ┌─────────────────┐  ┌──────────────┐  ┌──────────────────┐
          │ Fulcrum_OEM__c  │  │   Account    │  │ Fulcrum_         │
          │ (Custom Object) │  │  (Standard)  │  │ Competitor__c    │
          │                 │  │              │  │ (Custom Object)  │
          │ - Base margins  │  │ - Industry   │  │                  │
          │ - Deal reg %    │  │ - Revenue    │  │ - Price aggress. │
          │ - Services %    │  │ - Segment    │  │ - How to win     │
          │ - Quarter end % │  │              │  │ - Strengths      │
          │ - Product cats  │  │              │  │ - Typical disc.  │
          │ - Logo URL      │  │              │  │ - OEM partners   │
          └─────────────────┘  └──────────────┘  └──────────────────┘
```

### Field Categories

| Category                       | Count | Purpose                                                           |
| ------------------------------ | ----- | ----------------------------------------------------------------- |
| Deal Input Fields              | 12    | Parameters entered by reps or auto-populated from the Opportunity |
| AI Output Fields               | 5     | Recommendation results written back by the LWC                    |
| Competitive Intel Fields       | 3     | Competitor information for the deal                               |
| Financial Fields               | 2     | Cost and revenue tracking                                         |
| Fulcrum_OEM\_\_c Fields        | 6     | OEM program reference data                                        |
| Fulcrum_Competitor\_\_c Fields | 8     | Competitor VAR profiles                                           |

---

## Opportunity Custom Fields

All 22 custom fields on the Opportunity object. Fields are organized by functional category.

### AI Output Fields

These fields are populated by the MarginArc LWC after receiving a recommendation from the API. They should be **read-only** for sales reps in most configurations.

| #   | API Name                        | Label              | Type    | Precision | Required | Default | Description                                                                                                                                             |
| --- | ------------------------------- | ------------------ | ------- | --------- | -------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `Fulcrum_Recommended_Margin__c` | Recommended Margin | Percent | 16,2      | No       | —       | AI-recommended margin percentage. Written by LWC after API response. Range: 0%–50%.                                                                     |
| 2   | `Fulcrum_AI_Confidence__c`      | AI Confidence      | Percent | 16,2      | No       | —       | Model confidence score for the recommendation. Range: 0%–100%. Higher confidence indicates more training data supporting the recommendation.            |
| 3   | `Fulcrum_Win_Probability__c`    | Win Probability    | Percent | 16,2      | No       | —       | Estimated probability of winning at the recommended margin. Calculated via logistic function: `1 / (1 + exp(0.08 * (marginPct - 18)))`. Range: 0%–100%. |
| 4   | `Fulcrum_Margin__c`             | MarginArc Margin     | Percent | 16,2      | No       | —       | The final applied margin after rep review. May differ from recommended margin if rep overrides. Used for historical analysis and ML training.           |
| 5   | `Fulcrum_GP_Percent__c`         | Gross Profit %     | Percent | 16,2      | No       | —       | Actual gross profit percentage realized on the deal. Calculated from revenue and cost fields.                                                           |

### Deal Structure Fields

These fields describe the structural characteristics of the deal. Some are auto-populated from the Opportunity; others require rep input.

| #   | API Name                         | Label                  | Type     | Precision/Length | Required | Default         | Description                                                                                                                                       |
| --- | -------------------------------- | ---------------------- | -------- | ---------------- | -------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 6   | `Fulcrum_OEM__c`                 | OEM Vendor             | Text     | 255              | Yes      | —               | Primary OEM vendor for the deal. Must match a `Fulcrum_OEM__c` record name. Examples: Cisco, Palo Alto, HPE, Dell, Fortinet.                      |
| 7   | `Fulcrum_Product_Category__c`    | Product Category       | Picklist | —                | No       | —               | Primary product category for the deal.                                                                                                            |
| 8   | `Fulcrum_Deal_Type__c`           | Deal Type              | Picklist | —                | No       | —               | Classification of the deal type.                                                                                                                  |
| 9   | `Fulcrum_Deal_Reg_Type__c`       | Deal Registration Type | Picklist | —                | No       | `NotRegistered` | OEM deal registration status. Affects margin protection and pricing.                                                                              |
| 10  | `Fulcrum_Services_Attached__c`   | Services Attached      | Checkbox | —                | No       | `false`         | Whether professional services are bundled with the hardware/software deal. Services attachment typically adds 2–5pp to blended margin.            |
| 11  | `Fulcrum_Solution_Complexity__c` | Solution Complexity    | Picklist | —                | No       | `Single`        | Complexity tier of the solution being proposed. Multi-vendor solutions typically support higher margins.                                          |
| 12  | `Fulcrum_Quarter_End__c`         | Quarter End            | Checkbox | —                | No       | `false`         | Whether the deal is expected to close within the OEM's fiscal quarter-end window. Quarter-end timing can unlock additional OEM discounts of 2–8%. |
| 13  | `Fulcrum_Value_Add__c`           | Value Add              | Picklist | —                | No       | `Low`           | Level of value-added services, design, or customization the VAR is providing. Higher value-add supports premium margin positioning.               |

### Customer Profile Fields

Fields describing the customer relationship and segment.

| #   | API Name                           | Label                 | Type     | Precision/Length | Required | Default | Description                                                                                                    |
| --- | ---------------------------------- | --------------------- | -------- | ---------------- | -------- | ------- | -------------------------------------------------------------------------------------------------------------- |
| 14  | `Fulcrum_Customer_Segment__c`      | Customer Segment      | Picklist | —                | Yes      | —       | Customer size/type classification. Determines baseline margin expectations and network peer grouping.          |
| 15  | `Fulcrum_Relationship_Strength__c` | Relationship Strength | Picklist | —                | No       | —       | Depth of the existing relationship with the customer. Stronger relationships correlate with margin resilience. |

### Competitive Fields

Fields capturing the competitive landscape for the deal.

| #   | API Name                      | Label            | Type                  | Precision/Length | Required | Default | Description                                                                                                                                            |
| --- | ----------------------------- | ---------------- | --------------------- | ---------------- | -------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 16  | `Fulcrum_Competitors__c`      | Competitor Count | Picklist              | —                | No       | `0`     | Number of known competitor VARs bidding on this deal. More competitors create downward margin pressure.                                                |
| 17  | `Fulcrum_Competitor_Names__c` | Competitor Names | Multi-Select Picklist | —                | No       | —       | Specific competitor VARs identified on this deal. Semicolon-delimited in storage. Used for competitive intelligence lookups and head-to-head analysis. |
| 18  | `Fulcrum_Loss_Reason__c`      | Loss Reason      | Text                  | 255              | No       | —       | Free-text reason for deal loss. Populated on Closed Lost opportunities for competitive analysis.                                                       |

### Financial Fields

Currency and cost fields for margin calculation.

| #   | API Name                    | Label          | Type     | Precision | Required | Default | Description                                                                                                                                                    |
| --- | --------------------------- | -------------- | -------- | --------- | -------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 19  | `Fulcrum_Revenue__c`        | Revenue        | Currency | 16,2      | No       | —       | Total deal revenue (sell price). Used with OEM Cost to calculate actual margin.                                                                                |
| 20  | `Fulcrum_Cost__c`           | Cost           | Currency | 16,2      | No       | —       | Total deal cost including all line items. Revenue minus Cost equals gross profit.                                                                              |
| 21  | `Fulcrum_OEM_Cost__c`       | OEM Cost       | Currency | 16,2      | No       | —       | OEM cost basis (buy price from distributor/OEM). Sent to the API for margin calculation. Distinct from `Cost__c` which may include additional cost components. |
| 22  | `Fulcrum_Planned_Margin__c` | Planned Margin | Percent  | 16,2      | No       | —       | The rep's intended margin before AI recommendation. Used for plan-vs-recommended gap analysis in the MarginArc dashboard.                                        |

---

### Picklist Value Definitions

#### Fulcrum_Customer_Segment\_\_c

| Value        | Description                                                      | Typical Deal Size | Typical Margin Range |
| ------------ | ---------------------------------------------------------------- | ----------------- | -------------------- |
| `SMB`        | Small and medium businesses. <500 employees or <$50M revenue.    | $10K–$150K        | 15%–25%              |
| `MidMarket`  | Mid-market companies. 500–5,000 employees or $50M–$500M revenue. | $50K–$500K        | 12%–20%              |
| `Enterprise` | Large enterprises. 5,000+ employees or $500M+ revenue.           | $100K–$5M+        | 8%–16%               |

> **Note:** The Lambda API Zod schema accepts `SMB`, `MidMarket`, `Enterprise` (no hyphen, no `Public Sector`). The Salesforce picklist values must match these exactly for API calls to succeed.

#### Fulcrum_Competitors\_\_c

| Value | Description                                             |
| ----- | ------------------------------------------------------- |
| `0`   | No known competitors — sole source or incumbent renewal |
| `1`   | One known competitor                                    |
| `2`   | Two known competitors                                   |
| `3+`  | Three or more known competitors — highly competitive    |

#### Fulcrum_Deal_Reg_Type\_\_c

| Value              | Description                                                             | Typical Margin Impact    |
| ------------------ | ----------------------------------------------------------------------- | ------------------------ |
| `NotRegistered`    | No deal registration filed with the OEM                                 | Baseline (no protection) |
| `StandardApproved` | Standard deal registration — basic pricing protection                   | +1.5pp to +3pp           |
| `PremiumHunting`   | Premium/hunting registration — maximum pricing protection for new logos | +2.5pp to +5pp           |
| `Teaming`          | Teaming/partnership arrangement with another VAR                        | +1pp to +2pp             |

> **Note:** The Lambda API Zod schema accepts `NotRegistered`, `StandardApproved`, `PremiumHunting`, `Teaming`. The Salesforce picklist must use these exact values.

#### Fulcrum_Relationship_Strength\_\_c

| Value        | Description                                                         | Typical Margin Impact          |
| ------------ | ------------------------------------------------------------------- | ------------------------------ |
| `New`        | First transaction with this customer. No established trust.         | -1pp to -2pp (price-sensitive) |
| `Developing` | 2–3 prior deals. Building trust but not yet embedded.               | Baseline                       |
| `Good`       | 4–10 prior deals. Trusted advisor status emerging.                  | +0.5pp to +1.5pp               |
| `Strategic`  | 10+ deals, multi-year relationship. Deeply embedded in IT planning. | +1pp to +3pp                   |

#### Fulcrum_Solution_Complexity\_\_c

| Value    | Description                                                     | Typical Margin Impact |
| -------- | --------------------------------------------------------------- | --------------------- |
| `Low`    | Single-vendor, single-product-line solution                     | Baseline              |
| `Medium` | Moderate complexity, some integration required                  | +0.5pp to +1.5pp      |
| `High`   | Multi-vendor or multi-technology solution requiring integration | +1pp to +3pp          |

> **Note:** The Lambda API Zod schema accepts `Low`, `Medium`, `High` (not `Single`/`Multi-vendor`).

#### Fulcrum_Value_Add\_\_c

| Value    | Description                                                              | Typical Margin Impact |
| -------- | ------------------------------------------------------------------------ | --------------------- |
| `Low`    | Commodity fulfillment — little differentiation from competitors          | Baseline              |
| `Medium` | Some design, configuration, or deployment services included              | +0.5pp to +1.5pp      |
| `High`   | Significant architecture design, custom integration, or managed services | +1.5pp to +4pp        |

#### Fulcrum_Product_Category\_\_c

| Value           | Description                                                 |
| --------------- | ----------------------------------------------------------- |
| `Networking`    | Switches, routers, wireless access points, SD-WAN           |
| `Security`      | Firewalls, endpoint protection, SIEM, SASE, zero trust      |
| `Compute`       | Servers, HCI, edge compute, GPUs                            |
| `Storage`       | SAN, NAS, object storage, backup/DR                         |
| `Collaboration` | Unified communications, video, conferencing, contact center |
| `Software`      | Licensing, SaaS, management tools                           |
| `Services`      | Professional services, managed services, support contracts  |

#### Fulcrum_Deal_Type\_\_c

| Value                      | Description                                                          |
| -------------------------- | -------------------------------------------------------------------- |
| `New Business`             | Net-new customer or net-new technology area                          |
| `Renewal`                  | Renewal of existing contract, subscription, or support               |
| `Expansion`                | Expanding existing deployment (additional capacity, sites, licenses) |
| `Competitive Displacement` | Replacing an incumbent competitor's solution                         |
| `Refresh`                  | Technology refresh / hardware lifecycle replacement                  |

#### Fulcrum_Competitor_Names\_\_c (Multi-Select Picklist)

| Value        |
| ------------ |
| `CDW`        |
| `SHI`        |
| `Presidio`   |
| `Optiv`      |
| `Insight`    |
| `Connection` |
| `ePlus`      |
| `Trace3`     |
| `WWT`        |
| `Zones`      |
| `Other`      |

---

## Fulcrum_OEM\_\_c Object

### Object Description

The `Fulcrum_OEM__c` custom object stores reference data for each OEM vendor supported by MarginArc. Each record contains margin program parameters that feed into the recommendation engine as baseline inputs.

**Object Properties:**

| Property          | Value                        |
| ----------------- | ---------------------------- |
| API Name          | `Fulcrum_OEM__c`             |
| Label             | MarginArc OEM                  |
| Plural Label      | MarginArc OEMs                 |
| Record Name       | `Name` (Text, 80 chars)      |
| Sharing Model     | Read Only (org-wide default) |
| Deployment Status | Deployed                     |
| Search            | Enabled                      |
| Reports           | Enabled                      |
| Activities        | Disabled                     |
| Feed Tracking     | Disabled                     |

### Fields

| #   | API Name                   | Label                 | Type    | Precision/Length | Required   | Description                                                                                                                                                     |
| --- | -------------------------- | --------------------- | ------- | ---------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `Name`                     | OEM Name              | Text    | 80               | Yes (auto) | Standard Name field. The OEM vendor name. Must be unique. Used as the lookup key from `Fulcrum_OEM__c` on Opportunity.                                          |
| 2   | `Base_Margin__c`           | Base Margin           | Percent | 16,2             | Yes        | Standard base margin for this OEM's product lines. This is the starting point before deal-specific adjustments. Range: 0%–30%.                                  |
| 3   | `Deal_Reg_Margin_Boost__c` | Deal Reg Margin Boost | Percent | 16,2             | No         | Additional margin percentage unlocked by standard deal registration. Added to base margin when `Deal_Reg_Type__c` is Standard or PremiumHunting. Range: 0%–10%. |
| 4   | `Logo_URL__c`              | Logo URL              | URL     | 255              | No         | URL to the OEM's logo image. Used for display in the MarginArc LWC dashboard. Should be a publicly accessible HTTPS URL.                                          |
| 5   | `Product_Category__c`      | Product Category      | Text    | 255              | No         | Primary product categories this OEM covers. Comma-separated if multiple. Example: `"Networking, Security, Collaboration"`.                                      |
| 6   | `Quarter_End_Discount__c`  | Quarter End Discount  | Percent | 16,2             | No         | Additional discount percentage available during the OEM's fiscal quarter-end. Applied as a margin boost when `Quarter_End__c` is checked. Range: 0%–15%.        |
| 7   | `Services_Margin_Boost__c` | Services Margin Boost | Percent | 16,2             | No         | Additional blended margin uplift when professional services are attached. Applied when `Services_Attached__c` is checked. Range: 0%–10%.                        |

### Sample Records

| Name      | Base Margin | Deal Reg Boost | Quarter End Discount | Services Boost | Product Category                    |
| --------- | ----------- | -------------- | -------------------- | -------------- | ----------------------------------- |
| Cisco     | 10.0%       | 2.5%           | 4.0%                 | 3.5%           | Networking, Security, Collaboration |
| Palo Alto | 12.0%       | 3.0%           | 3.5%                 | 4.0%           | Security                            |
| HPE       | 8.0%        | 2.0%           | 5.0%                 | 3.0%           | Compute, Storage, Networking        |
| Dell      | 7.5%        | 1.5%           | 6.0%                 | 2.5%           | Compute, Storage                    |
| Fortinet  | 14.0%       | 3.5%           | 3.0%                 | 3.5%           | Security                            |

### Access & Sharing

- **OWD:** Read Only — All users can view OEM records but only admins can modify
- **Profiles:** System Administrator has full CRUD; all other profiles have Read-only
- **Field-Level Security:** All fields visible to all MarginArc users
- **Record Types:** None (single record type)

---

## Fulcrum_Competitor\_\_c Object

### Object Description

The `Fulcrum_Competitor__c` custom object stores detailed profiles of competitor VARs. These profiles power the competitive intelligence panel in the MarginArc LWC and provide tactical guidance for sales reps.

**Object Properties:**

| Property          | Value                        |
| ----------------- | ---------------------------- |
| API Name          | `Fulcrum_Competitor__c`      |
| Label             | MarginArc Competitor           |
| Plural Label      | MarginArc Competitors          |
| Record Name       | `Name` (Text, 80 chars)      |
| Sharing Model     | Read Only (org-wide default) |
| Deployment Status | Deployed                     |
| Search            | Enabled                      |
| Reports           | Enabled                      |
| Activities        | Disabled                     |
| Feed Tracking     | Disabled                     |

### Fields

| #   | API Name                 | Label               | Type           | Precision/Length | Required   | Description                                                                                                                                                                                                                                                                                    |
| --- | ------------------------ | ------------------- | -------------- | ---------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `Name`                   | Competitor Name     | Text           | 80               | Yes (auto) | Standard Name field. The competitor VAR's name. Must match values in `Fulcrum_Competitor_Names__c` multi-select picklist.                                                                                                                                                                      |
| 2   | `Description__c`         | Description         | Long Text Area | 32,000           | No         | Detailed overview of the competitor, their market position, strengths, and typical engagement model.                                                                                                                                                                                           |
| 3   | `Primary_Strength__c`    | Primary Strength    | Text           | 255              | No         | The competitor's single most important competitive advantage. Displayed prominently in the competitive intel panel.                                                                                                                                                                            |
| 4   | `Price_Aggression__c`    | Price Aggression    | Picklist       | —                | No         | Score (1–5) indicating how aggressively this competitor discounts to win deals. 5 = most aggressive. Stored as Picklist with string values "1" through "5". Apex must null-check before `Integer.valueOf()`.                                                                                   |
| 5   | `Margin_Aggression__c`   | Margin Aggression   | Number         | 18,0             | No         | Numeric score (1–10) indicating how thin this competitor is willing to make their margin. 10 = will accept near-zero margin to win. Distinct from price aggression — a competitor can be price-aggressive (deep OEM discounts) without being margin-aggressive (still maintaining healthy GP). |
| 6   | `Services_Capability__c` | Services Capability | Picklist       | —                | No         | Score (1–5) indicating the competitor's professional services capabilities. Stored as Picklist with string values "1" through "5". Apex must null-check before `Integer.valueOf()`.                                                                                                            |
| 7   | `Primary_OEMs__c`        | Primary OEMs        | Text           | 255              | No         | Comma-separated list of OEM vendors where this competitor has strong partnerships. Example: `"Cisco, Dell, HPE"`.                                                                                                                                                                              |
| 8   | `How_To_Win__c`          | How To Win          | Long Text Area | 32,000           | No         | Tactical guidance for winning against this competitor. Written as actionable advice for the sales rep.                                                                                                                                                                                         |
| 9   | `Typical_Discount__c`    | Typical Discount    | Percent        | 16,2             | No         | The typical discount off list price this competitor offers. Used as a benchmark for pricing strategy. Range: 0%–40%.                                                                                                                                                                           |

### Sample Records

#### CDW

| Field               | Value                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Name                | CDW                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Description         | Largest US IT VAR with over $23B in annual revenue. Publicly traded (NASDAQ: CDW). Broad capabilities across all technology domains with strength in procurement efficiency and logistics. Serves all segments from SMB to Federal. Growing managed services and cloud practices.                                                                                                                                      |
| Primary Strength    | Scale and breadth of portfolio                                                                                                                                                                                                                                                                                                                                                                                         |
| Price Aggression    | 7                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Margin Aggression   | 6                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Services Capability | Growing professional services arm; strongest in deployment, managed services, and lifecycle management. Less differentiated in custom solution design.                                                                                                                                                                                                                                                                 |
| Primary OEMs        | Cisco, Dell, HPE, Microsoft, Lenovo                                                                                                                                                                                                                                                                                                                                                                                    |
| How To Win          | Differentiate on technical depth and solution architecture. CDW excels at fulfillment and procurement efficiency but often lacks deep technical engagement. Lead with design workshops, proof-of-concept labs, and post-sale support commitments. Leverage deal registration early to lock in pricing protection. Avoid head-to-head price competition — CDW's scale gives them better cost basis on commodity orders. |
| Typical Discount    | 18.5%                                                                                                                                                                                                                                                                                                                                                                                                                  |

#### SHI

| Field               | Value                                                                                                                                                                                                                                                                                                                                                |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Name                | SHI                                                                                                                                                                                                                                                                                                                                                  |
| Description         | Second-largest US VAR, privately held. Over $14B in annual revenue. Strong software licensing heritage with expanding hardware and services capabilities. Known for competitive pricing and efficient quoting.                                                                                                                                       |
| Primary Strength    | Software licensing expertise and competitive pricing                                                                                                                                                                                                                                                                                                 |
| Price Aggression    | 8                                                                                                                                                                                                                                                                                                                                                    |
| Margin Aggression   | 7                                                                                                                                                                                                                                                                                                                                                    |
| Services Capability | Solid deployment and migration services. Strong cloud optimization and software asset management. Less embedded in complex infrastructure design.                                                                                                                                                                                                    |
| Primary OEMs        | Microsoft, Cisco, Dell, VMware, Adobe                                                                                                                                                                                                                                                                                                                |
| How To Win          | SHI competes aggressively on price, especially in software-heavy deals. Counter by emphasizing services wrap, ongoing support, and total cost of ownership (TCO) including implementation risk. For hardware deals, leverage OEM relationships and deal registration. SHI is weakest when the deal requires significant design and integration work. |
| Typical Discount    | 20.0%                                                                                                                                                                                                                                                                                                                                                |

#### Presidio

| Field               | Value                                                                                                                                                                                                                                                                                                                 |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Name                | Presidio                                                                                                                                                                                                                                                                                                              |
| Description         | Technology solutions provider focused on digital infrastructure, cloud, and security. Strong engineering bench with emphasis on complex, multi-vendor solutions. Owned by CD&R private equity.                                                                                                                        |
| Primary Strength    | Engineering depth and complex solution design                                                                                                                                                                                                                                                                         |
| Price Aggression    | 5                                                                                                                                                                                                                                                                                                                     |
| Margin Aggression   | 4                                                                                                                                                                                                                                                                                                                     |
| Services Capability | Deep engineering capabilities across networking, security, and cloud. Known for complex migration projects and managed services. Strong in multi-vendor integration.                                                                                                                                                  |
| Primary OEMs        | Cisco, Palo Alto, HPE, Pure Storage                                                                                                                                                                                                                                                                                   |
| How To Win          | Presidio is a capable competitor in complex deals. Compete by demonstrating equivalent or superior technical depth. Presidio can be slow on quoting and proposal development — speed of response is an advantage. In simpler deals, Presidio may be overengineering the solution — position right-sized alternatives. |
| Typical Discount    | 15.0%                                                                                                                                                                                                                                                                                                                 |

#### Optiv

| Field               | Value                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Name                | Optiv                                                                                                                                                                                                                                                                                                                                                                                  |
| Description         | Largest pure-play cybersecurity integrator in the US. Over $4B in revenue. Deep specialization in security strategy, architecture, and managed security services (MSSP).                                                                                                                                                                                                               |
| Primary Strength    | Cybersecurity specialization and managed security                                                                                                                                                                                                                                                                                                                                      |
| Price Aggression    | 4                                                                                                                                                                                                                                                                                                                                                                                      |
| Margin Aggression   | 3                                                                                                                                                                                                                                                                                                                                                                                      |
| Services Capability | Best-in-class security services including MSSP, incident response, security assessments, and compliance consulting. Less competitive outside security domain.                                                                                                                                                                                                                          |
| Primary OEMs        | Palo Alto, CrowdStrike, Fortinet, Splunk, Zscaler                                                                                                                                                                                                                                                                                                                                      |
| How To Win          | Optiv is dangerous in pure security deals due to deep specialization. Counter by positioning broader solution scope that includes networking, compute, or collaboration — areas where Optiv has limited capability. In security-only deals, emphasize vendor-specific certifications and OEM deal registration advantages. Optiv's pricing is not aggressive — they sell on expertise. |
| Typical Discount    | 12.0%                                                                                                                                                                                                                                                                                                                                                                                  |

#### Insight

| Field               | Value                                                                                                                                                                                                                                                                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Name                | Insight                                                                                                                                                                                                                                                                                                                                     |
| Description         | Global technology integrator with $9B+ in revenue. Publicly traded (NASDAQ: NSIT). Strong cloud transformation practice (acquired PCM, Datalink). Balanced hardware and services capabilities.                                                                                                                                              |
| Primary Strength    | Cloud transformation and multi-cloud management                                                                                                                                                                                                                                                                                             |
| Price Aggression    | 6                                                                                                                                                                                                                                                                                                                                           |
| Margin Aggression   | 5                                                                                                                                                                                                                                                                                                                                           |
| Services Capability | Strong cloud architecture and managed services. Solid data center and workspace modernization practices. Growing security capabilities through acquisitions.                                                                                                                                                                                |
| Primary OEMs        | Microsoft, Dell, Cisco, HPE, NetApp                                                                                                                                                                                                                                                                                                         |
| How To Win          | Insight competes broadly but is strongest in cloud-adjacent infrastructure deals. In on-premises deals, leverage deeper OEM specialization and local support. Insight's sales model can be less technical — bring engineering talent early to establish credibility. Deal registration and speed of quote delivery are key differentiators. |
| Typical Discount    | 16.5%                                                                                                                                                                                                                                                                                                                                       |

---

## Field Dependencies

### Required Field Combinations

The MarginArc recommendation engine requires certain field combinations to generate a recommendation. Missing required fields result in either a lower-confidence recommendation or a "not enough data" response.

#### Minimum Required Fields (for any recommendation)

| Field                         | Source     | Notes                                |
| ----------------------------- | ---------- | ------------------------------------ |
| `Fulcrum_OEM__c`              | Rep / Auto | Must match a Fulcrum_OEM\_\_c record |
| `Amount` (standard)           | Rep        | Used as deal size                    |
| `Fulcrum_Customer_Segment__c` | Rep        | Required for network peer matching   |

#### Full Recommendation Fields (for high-confidence result)

All minimum fields plus:

| Field                              | Source     | Notes                                    |
| ---------------------------------- | ---------- | ---------------------------------------- |
| `Fulcrum_Deal_Reg_Type__c`         | Rep        | Affects margin protection calculation    |
| `Fulcrum_Competitors__c`           | Rep        | Affects competitive pressure driver      |
| `Fulcrum_Services_Attached__c`     | Rep        | Affects services margin boost            |
| `Fulcrum_Solution_Complexity__c`   | Rep        | Affects complexity premium               |
| `Fulcrum_Relationship_Strength__c` | Rep        | Affects relationship premium             |
| `Fulcrum_Value_Add__c`             | Rep        | Affects value-add premium                |
| `Fulcrum_Quarter_End__c`           | Rep / Auto | Affects quarter-end discount             |
| `Fulcrum_OEM_Cost__c`              | Rep        | Required for absolute margin calculation |
| `Account.Industry`                 | Account    | Used for industry vertical signal        |

### Calculation Dependencies

```
Fulcrum_GP_Percent__c = (Fulcrum_Revenue__c - Fulcrum_Cost__c) / Fulcrum_Revenue__c * 100

Fulcrum_Win_Probability__c = f(Fulcrum_Recommended_Margin__c)
   where f(x) = 1 / (1 + exp(0.08 * (x - 18)))

Fulcrum_Recommended_Margin__c = API response (depends on ALL deal input fields)

Fulcrum_AI_Confidence__c = API response (depends on historical data volume + input completeness)
```

### Field Write Sequence

When the "Apply Recommendation" button is clicked in the LWC, fields are written in a single `updateRecord()` call:

1. `Fulcrum_Recommended_Margin__c` — From API response (`suggestedMarginPct`)
2. `Fulcrum_AI_Confidence__c` — From API response (`confidence`)
3. `Fulcrum_Win_Probability__c` — From API response (`winProbability * 100`)
4. `Amount` — Recalculated: `oemCost / (1 - suggestedMarginPct/100)`
5. `Fulcrum_Margin__c` — Set to `suggestedMarginPct` (rep can override later)
6. `Fulcrum_Revenue__c` — Set to the recalculated amount (`Math.round(newAmount)`)
7. `Fulcrum_GP_Percent__c` — Calculated: `((newAmount - oemCost) / newAmount) * 100`

> **Note:** `Fulcrum_Planned_Margin__c` is intentionally NOT overwritten during Apply — it preserves the rep's original planned margin for comparison reporting.

---

## Data Types & Validation

### Percent Fields

All Percent-type fields use Salesforce's native Percent field type:

- **Storage:** Stored as decimal values internally (e.g., 14.5% stored as 14.5, not 0.145)
- **Display:** Rendered with `%` suffix in Salesforce UI
- **Precision:** 16 digits total, 2 decimal places
- **API Behavior:** Returned as plain numbers from Apex. Example: `14.5` (not `0.145`)

> **Important:** When reading Percent fields via `@AuraEnabled` Apex methods, the returned value is an Apex `Decimal` that supports arithmetic but lacks JavaScript `Number.prototype` methods. Always wrap with `Number()` before calling `.toFixed()`.

### Currency Fields

- **Storage:** Stored in the org's corporate currency
- **Precision:** 16 digits total, 2 decimal places
- **Multi-currency:** If multi-currency is enabled, MarginArc currency fields use the Opportunity's currency

### Picklist Validation

All picklist fields enforce their value sets. Invalid values submitted via API are rejected. The following constraints apply:

| Field                              | Constraint                                                                                                             |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `Fulcrum_Customer_Segment__c`      | Exactly one of: `SMB`, `MidMarket`, `Enterprise`                                                                       |
| `Fulcrum_Competitors__c`           | Exactly one of: `0`, `1`, `2`, `3+`                                                                                    |
| `Fulcrum_Deal_Reg_Type__c`         | Exactly one of: `NotRegistered`, `StandardApproved`, `PremiumHunting`, `Teaming`                                       |
| `Fulcrum_Relationship_Strength__c` | Exactly one of: `New`, `Developing`, `Good`, `Strategic`                                                               |
| `Fulcrum_Solution_Complexity__c`   | Exactly one of: `Low`, `Medium`, `High`                                                                                |
| `Fulcrum_Value_Add__c`             | Exactly one of: `Low`, `Medium`, `High`                                                                                |
| `Fulcrum_Competitor_Names__c`      | One or more of: `CDW`, `SHI`, `Presidio`, `Optiv`, `Insight`, `Connection`, `ePlus`, `Trace3`, `WWT`, `Zones`, `Other` |

### Number Ranges

| Field                      | Min | Max | Notes                                    |
| -------------------------- | --- | --- | ---------------------------------------- |
| `Price_Aggression__c`      | 1   | 5   | Picklist (not Number) — values "1"–"5"   |
| `Services_Capability__c`   | 1   | 5   | Picklist (not Number) — values "1"–"5"   |
| `Margin_Aggression__c`     | 1   | 10  | Number field — Integer only              |
| `Base_Margin__c`           | 0%  | 30% | —            |
| `Deal_Reg_Margin_Boost__c` | 0%  | 10% | —            |
| `Quarter_End_Discount__c`  | 0%  | 15% | —            |
| `Services_Margin_Boost__c` | 0%  | 10% | —            |
| `Typical_Discount__c`      | 0%  | 40% | —            |

---

## Signal-to-Field Mapping

MarginArc's recommendation engine analyzes 31 signals organized into 6 categories. Each signal maps to one or more Salesforce fields and has a defined collection method.

### Signal Collection Methods

| Code | Method       | Description                                                     |
| ---- | ------------ | --------------------------------------------------------------- |
| AUTO | Automatic    | Derived automatically from Salesforce data or calculated fields |
| REP  | Rep Input    | Entered by the sales rep on the Opportunity                     |
| ACCT | Account Data | Pulled from the Account record                                  |
| NET  | Network      | Sourced from the anonymized MarginArc Network peer pool           |

### Deal Structure Signals (6)

| #   | Signal              | Collection | Unit     | Source Field(s)                                                            | Description                                                                                                |
| --- | ------------------- | ---------- | -------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 1   | Deal Size           | AUTO       | $        | `Opportunity.Amount`                                                       | Total deal value. Larger deals typically have thinner margins due to volume expectations.                  |
| 2   | OEM Vendor          | AUTO       | vendor   | `Fulcrum_OEM__c` (Opportunity) → `Fulcrum_OEM__c` (Object)                 | OEM vendor identity. Each OEM has different base margins, program rules, and competitive dynamics.         |
| 3   | Product Category    | AUTO       | category | `Fulcrum_Product_Category__c` → `Fulcrum_OEM__c.Product_Category__c`       | Product line classification. Security products typically command higher margins than commodity networking. |
| 4   | Deal Registration   | REP        | tier     | `Fulcrum_Deal_Reg_Type__c` → `Fulcrum_OEM__c.Deal_Reg_Margin_Boost__c`     | Deal registration status. Registration protects margin by limiting competitor access to OEM pricing.       |
| 5   | Services Mix        | REP        | %        | `Fulcrum_Services_Attached__c` → `Fulcrum_OEM__c.Services_Margin_Boost__c` | Whether services are attached. Services blending lifts overall margin.                                     |
| 6   | Solution Complexity | REP        | tier     | `Fulcrum_Solution_Complexity__c`                                           | Multi-vendor solutions are harder for competitors to replicate, supporting premium pricing.                |

### Customer Profile Signals (6)

| #   | Signal                | Collection | Unit      | Source Field(s)                                                                      | Description                                                                                                               |
| --- | --------------------- | ---------- | --------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| 7   | Customer Segment      | ACCT       | tier      | `Fulcrum_Customer_Segment__c`                                                        | Market segment. SMB deals typically have higher margins than Enterprise.                                                  |
| 8   | Industry Vertical     | AUTO       | label     | `Account.Industry`                                                                   | Industry classification. Regulated industries (healthcare, finance) often accept higher margins for compliance expertise. |
| 9   | Account Size          | AUTO       | $         | `Account.AnnualRevenue`                                                              | Customer's annual revenue. Larger accounts expect volume discounts but offer more predictable revenue streams.            |
| 10  | Relationship Depth    | ACCT       | tier      | `Fulcrum_Relationship_Strength__c`                                                   | Depth of existing relationship. Strategic accounts tolerate higher margins due to switching costs and trust.              |
| 11  | Purchase Cadence      | AUTO       | deals/qtr | Calculated: `COUNT(Opportunity WHERE AccountId = :acct AND IsWon = true) / quarters` | Historical purchase frequency. High-cadence buyers value consistency over price on individual deals.                      |
| 12  | Lifetime Margin Trend | AUTO       | %         | Calculated: `AVG(Fulcrum_Margin__c) GROUP BY CloseDate quarter`                      | Trend of margin on this account over time. Declining trends may indicate competitive pressure or commoditization.         |

### Competitive Signals (5)

| #   | Signal               | Collection | Unit  | Source Field(s)                                                                          | Description                                                                                              |
| --- | -------------------- | ---------- | ----- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| 13  | Competitor Count     | REP        | int   | `Fulcrum_Competitors__c`                                                                 | Number of known competitors. More competitors = more price pressure.                                     |
| 14  | Competitor Identity  | REP        | names | `Fulcrum_Competitor_Names__c` → `Fulcrum_Competitor__c`                                  | Specific competitor names. Each competitor has known tactics that inform pricing strategy.               |
| 15  | Displacement Flag    | REP        | bool  | Derived from `Fulcrum_Deal_Type__c = 'Competitive Displacement'`                         | Whether this deal involves displacing an incumbent. Displacement deals often require aggressive pricing. |
| 16  | Head-to-Head Record  | AUTO       | %     | Calculated from historical `Fulcrum_Competitor_Names__c` on won/lost Opportunities       | Win rate against named competitors on this account.                                                      |
| 17  | Price Pressure Index | AUTO       | score | Calculated from `Fulcrum_Competitor__c.Price_Aggression__c` weighted by competitor count | Composite score representing aggregate competitive price pressure on this deal.                          |

### Market Signals (5)

| #   | Signal                  | Collection | Unit | Source Field(s)                                              | Description                                                                    |
| --- | ----------------------- | ---------- | ---- | ------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| 18  | OEM Base Margins        | NET        | %    | `Fulcrum_OEM__c.Base_Margin__c` + network calibration        | OEM program margins calibrated against network peer experience.                |
| 19  | Quarter-End Timing      | AUTO       | days | `Opportunity.CloseDate` vs. OEM fiscal quarter-end dates     | Days until OEM quarter-end. Closer proximity = more OEM incentive to discount. |
| 20  | Seasonal Patterns       | AUTO       | %    | Historical margin analysis by month/quarter                  | Seasonal margin patterns for this OEM + category combination.                  |
| 21  | Category Benchmarks     | AUTO       | %    | Network aggregate by `Fulcrum_Product_Category__c`           | Median margin for this product category across the network.                    |
| 22  | Program & Rebate Shifts | AUTO       | %    | `Fulcrum_OEM__c` field updates + OEM program change tracking | Changes in OEM program terms that affect available margin.                     |

### Network Signals (5)

| #   | Signal               | Collection | Unit     | Source Field(s)                                               | Description                                                          |
| --- | -------------------- | ---------- | -------- | ------------------------------------------------------------- | -------------------------------------------------------------------- |
| 23  | Peer Win Rates       | NET        | %        | Anonymized network pool: win rates for matching deal profiles | How often network peers win deals with similar parameters.           |
| 24  | Network Margin Bands | NET        | %        | Anonymized network pool: P25/P50/P75 margin distribution      | Margin distribution (quartiles) from network peers on similar deals. |
| 25  | Regional Variance    | NET        | %        | Anonymized network pool: margin by geographic region          | How margins vary by region for comparable deals.                     |
| 26  | Deal Velocity Norms  | NET        | days     | Anonymized network pool: days-to-close distribution           | How quickly similar deals close across the network.                  |
| 27  | Competitive Tactics  | NET        | profiles | Anonymized network pool: competitor behavior patterns         | Tactical patterns observed when competing against named competitors. |

### Rep Performance Signals (4)

| #   | Signal            | Collection | Unit | Source Field(s)                                                          | Description                                                                  |
| --- | ----------------- | ---------- | ---- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| 28  | Rep Win Rate      | AUTO       | %    | `Opportunity.OwnerId` → historical win rate calculation                  | The rep's overall win rate. High-performing reps can sustain higher margins. |
| 29  | Discount Patterns | AUTO       | %    | Historical `Fulcrum_Planned_Margin__c` vs. `Fulcrum_Margin__c` per rep   | How frequently and deeply the rep discounts below recommended margin.        |
| 30  | Forecast Accuracy | AUTO       | %    | Historical `Opportunity.Amount` vs. `Fulcrum_Revenue__c` per rep         | How accurately the rep forecasts deal value vs. actual closed value.         |
| 31  | Compliance Score  | AUTO       | %    | Percentage of deals where rep followed MarginArc recommendation within 2pp | How often the rep prices within the recommended margin band.                 |

---

## Data Flow

### End-to-End Data Flow

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                              SALESFORCE ORG                                  │
│                                                                              │
│  ┌────────────┐    ┌───────────────────┐    ┌────────────────────────────┐   │
│  │ Opportunity │    │   MarginArc LWC     │    │   Apex Controllers         │   │
│  │ Record Page │───>│                   │    │                            │   │
│  │             │    │ 1. @wire loads    │    │ MarginArcController          │   │
│  │ 22 MarginArc  │    │    Opp data       │    │  .getOpportunityData()     │   │
│  │ fields      │    │                   │    │  .generateAIExplanation()  │   │
│  │             │    │ 2. Rep enters     │    │                            │   │
│  │ Account     │    │    deal params    │    │ MarginArcCompetitiveCtrl     │   │
│  │  .Industry  │    │                   │    │  .getAccountIntelligence() │   │
│  │  .Revenue   │    │ 3. fetch() to API │    │  .getCompetitorProfile()   │   │
│  └─────────────┘    │                   │    └────────────────────────────┘   │
│                     │ 6. Write back     │                                     │
│                     │    to Opp fields  │                                     │
│                     └───────┬───────────┘                                     │
│                             │                                                 │
└─────────────────────────────┼─────────────────────────────────────────────────┘
                              │
                    4. POST /api/recommend
                              │
                              v
               ┌──────────────────────────────┐
               │  MarginArc API Backend         │
               │  (api.marginarc.com)           │
               │                               │
               │  ┌─────────────────────────┐  │
               │  │ Recommendation Engine   │  │
               │  │                         │  │
               │  │ - Signal processing     │  │
               │  │ - OEM rule application  │  │
               │  │ - Network peer matching │  │
               │  │ - ML model inference    │  │
               │  │ - Conflict firewall     │  │
               │  │ - Win prob calculation  │  │
               │  └─────────────────────────┘  │
               │                               │
               │  5. Returns:                  │
               │     - recommendedMargin       │
               │     - confidence              │
               │     - drivers[]               │
               │     - winProbability           │
               │     - networkStats            │
               └──────────────────────────────┘
```

### Data Flow Steps

| Step | Direction      | Description                                                                                                                                                             |
| ---- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | SF → LWC       | LWC loads Opportunity data via `@wire(getRecord)` or `@wire(getOpportunityData)`. Includes all 22 MarginArc fields plus Account relationship fields.                      |
| 2    | User → LWC     | Rep reviews pre-populated fields, enters/adjusts deal parameters (competitors, deal reg, services, etc.).                                                               |
| 3    | LWC → API      | LWC constructs a JSON payload from the Opportunity fields and sends `POST /api/recommend` via `fetch()`.                                                                |
| 4    | API Processing | The recommendation engine processes the 31 signals, applies OEM rules, queries the network peer pool, runs the ML model, and calculates win probability.                |
| 5    | API → LWC      | API returns the recommendation response (margin, confidence, drivers, win probability, network stats).                                                                  |
| 6    | LWC → SF       | When the rep clicks "Apply Recommendation," the LWC writes the recommendation results back to the Opportunity record using `updateRecord` from `lightning/uiRecordApi`. |

### Parallel Data Flows

In addition to the primary recommendation flow, the LWC makes parallel calls for supplementary data:

- **AI Explanation** — After receiving the API response, the LWC calls `MarginArcController.generateAIExplanation()` to get a Gemini-generated narrative.
- **Competitive Intelligence** — On load, the LWC calls `MarginArcCompetitiveController.getAccountIntelligence()` to populate the competitive intel panel.
- **Competitor Profiles** — When the rep selects a competitor name, the LWC calls `MarginArcCompetitiveController.getCompetitorProfile()` to display the detailed profile.

---

## Calculated Fields

### Fields Computed in Real-Time (Not Stored Until Apply)

These values are computed by the recommendation engine or the LWC and are only persisted when the rep clicks "Apply Recommendation."

| Field                           | Calculation                                                            | Source                               |
| ------------------------------- | ---------------------------------------------------------------------- | ------------------------------------ |
| `Fulcrum_Recommended_Margin__c` | ML model output from 31 signals                                        | API                                  |
| `Fulcrum_AI_Confidence__c`      | Model confidence based on training data volume and signal completeness | API                                  |
| `Fulcrum_Win_Probability__c`    | `1 / (1 + exp(0.08 * (marginPct - 18)))`                               | API (also available as LWC fallback) |
| `Fulcrum_Revenue__c`            | `Fulcrum_OEM_Cost__c / (1 - (Fulcrum_Margin__c / 100))`                | LWC                                  |
| `Fulcrum_GP_Percent__c`         | `(Fulcrum_Revenue__c - Fulcrum_Cost__c) / Fulcrum_Revenue__c * 100`    | LWC                                  |

### Fields Computed Periodically (Background)

These values are calculated by scheduled processes or triggered by data changes:

| Metric                             | Calculation                                        | Frequency     |
| ---------------------------------- | -------------------------------------------------- | ------------- |
| Purchase Cadence (Signal #11)      | Count of won Opps / number of active quarters      | On Opp close  |
| Lifetime Margin Trend (Signal #12) | Rolling average of `Fulcrum_Margin__c` by quarter  | Nightly batch |
| Head-to-Head Record (Signal #16)   | Win/loss ratio per competitor per account          | On Opp close  |
| Rep Win Rate (Signal #28)          | Won Opps / (Won + Lost Opps) per rep               | Nightly batch |
| Discount Patterns (Signal #29)     | Variance between planned and actual margin per rep | Nightly batch |
| Forecast Accuracy (Signal #30)     | Actual vs. forecast variance per rep               | Nightly batch |
| Compliance Score (Signal #31)      | % of deals within 2pp of recommendation per rep    | Nightly batch |

### Win Probability Function

The win probability logistic function deserves special attention:

```
P(win) = 1 / (1 + exp(0.08 * (marginPct - 18)))
```

**Properties:**

- **Inflection point:** 50% win probability at 18% margin
- **Slope coefficient:** 0.08 (controls steepness of the curve)
- **At 10% margin:** ~82% win probability
- **At 14% margin:** ~73% win probability
- **At 18% margin:** ~50% win probability
- **At 22% margin:** ~27% win probability
- **At 26% margin:** ~12% win probability

The function is intentionally inverse — higher margin means lower win probability, reflecting the real-world tradeoff between profitability and competitiveness.

---

## Historical Data Requirements

### ML Model Training Phases

The recommendation engine's accuracy improves as more historical data is available. The system operates in tiered phases:

| Phase              | Minimum Deals        | Confidence Ceiling | Capabilities                                                                                                                             |
| ------------------ | -------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **Cold Start**     | 0–25 closed deals    | 40%                | OEM rule-based recommendations only. No ML. Uses `Fulcrum_OEM__c` base margins + static adjustments for deal reg, services, quarter-end. |
| **Early Learning** | 26–100 closed deals  | 60%                | Basic ML active. Learns org-specific margin patterns. Limited competitive and customer signals.                                          |
| **Operational**    | 101–500 closed deals | 80%                | Full ML active. All 31 signals operational. Network data supplements org data.                                                           |
| **Mature**         | 500+ closed deals    | 95%                | Advanced ML with high-resolution segmentation. Rep-level signals active. Seasonal and trend analysis fully operational.                  |

### Data Quality Requirements

For a closed deal to contribute to ML training, the following fields must be populated:

**Required (deal excluded from training if missing):**

- `Fulcrum_OEM__c`
- `Amount` (standard)
- `Fulcrum_Customer_Segment__c`
- `StageName` = `Closed Won` or `Closed Lost`
- `CloseDate`

**Strongly Recommended (reduces confidence if missing):**

- `Fulcrum_Margin__c` (actual margin — required for won deals)
- `Fulcrum_Competitors__c`
- `Fulcrum_Deal_Reg_Type__c`
- `Fulcrum_Services_Attached__c`
- `Account.Industry`

**Nice to Have (improves granularity):**

- `Fulcrum_Competitor_Names__c`
- `Fulcrum_Relationship_Strength__c`
- `Fulcrum_Value_Add__c`
- `Fulcrum_Loss_Reason__c` (for lost deals)
- `Fulcrum_OEM_Cost__c`

### Network Data Requirements

To participate in the MarginArc Network and receive peer benchmarks:

| Requirement         | Minimum                                                 |
| ------------------- | ------------------------------------------------------- |
| Closed deals shared | 50+                                                     |
| Data recency        | Deals from last 12 months                               |
| Field completeness  | OEM, Amount, Segment, Margin populated on 80%+ of deals |
| Opt-in consent      | Explicit network participation agreement                |

### Data Retention

| Data Type                 | Retention                  | Notes                                                   |
| ------------------------- | -------------------------- | ------------------------------------------------------- |
| Opportunity field data    | Indefinite                 | Stored in Salesforce, subject to org retention policies |
| API request/response logs | 90 days                    | Stored in the MarginArc backend                           |
| Network anonymized data   | 24 months                  | Rolling window for ML training                          |
| AI explanation text       | Not persisted              | Generated on demand; not stored after session           |
| Competitive intelligence  | Refreshed on each LWC load | Calculated from live Salesforce data                    |
