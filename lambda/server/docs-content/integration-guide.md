# MarginArc Integration Guide

**Version:** 1.0
**Last Updated:** 2026-02-06
**Salesforce API Version:** 62.0
**Target Platform:** Salesforce Lightning Experience

---

## Table of Contents

1. [Overview](#overview)
2. [Salesforce Configuration](#salesforce-configuration)
3. [API Integration](#api-integration)
4. [Gemini AI Integration](#gemini-ai-integration)
5. [Network Integration](#network-integration)
6. [Data Migration](#data-migration)
7. [Testing](#testing)
8. [Monitoring & Maintenance](#monitoring--maintenance)
9. [Troubleshooting](#troubleshooting)

---

## Overview

MarginArc is an AI margin intelligence platform that embeds directly into Salesforce via Lightning Web Components (LWCs). The integration involves four distinct layers:

1. **Salesforce Metadata** — Custom fields, objects, LWC components, Apex controllers, and page layouts deployed to the Salesforce org.
2. **Backend API** — A REST API hosted at `https://api.marginarc.com` that processes deal parameters and returns margin recommendations.
3. **Gemini AI** — Google's Gemini API, called from Apex, that generates natural-language explanations of margin recommendations.
4. **MarginArc Network** — An opt-in anonymized peer data network that enriches recommendations with cross-organization benchmarks.

### Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        SALESFORCE ORG                            │
│                                                                  │
│  ┌──────────────────────┐  ┌──────────────────────────────────┐ │
│  │  Opportunity Record  │  │  MarginArc LWCs                    │ │
│  │  Page Layout         │  │  - fulcrumDashboard              │ │
│  │  + MarginArc Widget  │  │  - fulcrumCompetitiveIntel       │ │
│  │                      │  │  - fulcrumMarginChart            │ │
│  └──────────────────────┘  └──────────┬───────────────────────┘ │
│                                       │                          │
│  ┌──────────────────────┐             │  ┌──────────────────┐   │
│  │  Apex Controllers    │<────────────┘  │  Custom Objects  │   │
│  │  - FulcrumController │                │  - Fulcrum_OEM   │   │
│  │  - FulcrumCompCtrl   │                │  - Fulcrum_Comp  │   │
│  └──────────┬───────────┘                └──────────────────┘   │
│             │                                                    │
└─────────────┼────────────────────────────────────────────────────┘
              │                            │
              │ Apex HTTP Callout          │ LWC fetch()
              │ (Gemini API)               │ (MarginArc API)
              v                            v
  ┌──────────────────────┐    ┌─────────────────────────────┐
  │  Google Gemini API   │    │  MarginArc Backend API        │
  │  generativelanguage  │    │  api.marginarc.com      │
  │  .googleapis.com     │    │                             │
  └──────────────────────┘    │  ┌───────────────────────┐  │
                              │  │  ML Recommendation    │  │
                              │  │  Engine               │  │
                              │  └───────────┬───────────┘  │
                              │              │              │
                              │  ┌───────────v───────────┐  │
                              │  │  MarginArc Network      │  │
                              │  │  (Anonymized Peer     │  │
                              │  │   Data Pool)          │  │
                              │  └───────────────────────┘  │
                              └─────────────────────────────┘
```

### Prerequisites

Before beginning integration, ensure the following:

| Requirement          | Details                                                                                           |
| -------------------- | ------------------------------------------------------------------------------------------------- |
| Salesforce Edition   | Enterprise, Performance, or Unlimited                                                             |
| Lightning Experience | Enabled (Classic is not supported)                                                                |
| API Version          | 62.0 or higher                                                                                    |
| Admin Access         | System Administrator profile for configuration                                                    |
| Network Access       | Outbound HTTPS from Salesforce to `api.marginarc.com` and `generativelanguage.googleapis.com` |

---

## Salesforce Configuration

### 2.1 CSP Trusted Sites

MarginArc LWCs make client-side `fetch()` calls to the backend API. Salesforce's Content Security Policy (CSP) blocks these by default. You must add `api.marginarc.com` as a CSP Trusted Site.

**Steps:**

1. Navigate to **Setup** > **Security** > **CSP Trusted Sites**
2. Click **New Trusted Site**
3. Configure:

| Field             | Value                           |
| ----------------- | ------------------------------- |
| Trusted Site Name | `FulcrumAPI`                    |
| Trusted Site URL  | `https://api.marginarc.com` |
| Context           | `All`                           |
| Connect           | Checked                         |
| Script            | Checked                         |
| Style             | Unchecked                       |
| Font              | Unchecked                       |
| Img               | Unchecked                       |
| Media             | Unchecked                       |
| Frame             | Unchecked                       |

4. Click **Save**

**Verification:** After saving, deploy the MarginArc LWC to a sandbox Opportunity page and attempt a recommendation. Open the browser developer console (F12) and confirm no CSP violation errors appear.

### 2.2 Remote Site Settings

Apex controllers make server-side HTTP callouts to the Gemini API. This requires a Remote Site Setting.

**Steps:**

1. Navigate to **Setup** > **Security** > **Remote Site Settings**
2. Click **New Remote Site**
3. Configure:

| Field            | Value                                           |
| ---------------- | ----------------------------------------------- |
| Remote Site Name | `GoogleGeminiAPI`                               |
| Remote Site URL  | `https://generativelanguage.googleapis.com`     |
| Description      | `Google Gemini API for MarginArc AI explanations` |
| Active           | Checked                                         |

4. Click **Save**

> **Note:** If your org uses a proxy or firewall that inspects outbound traffic, ensure `generativelanguage.googleapis.com` on port 443 is whitelisted.

### 2.3 Custom Field Deployment

MarginArc adds 22 custom fields to the Opportunity object and two custom objects. These can be deployed via:

- **Managed Package** (recommended) — Install from the MarginArc AppExchange listing. This handles all metadata deployment automatically.
- **Change Set** — For orgs that require manual deployment, a change set is provided.
- **Metadata API / SFDX** — For CI/CD pipelines, the metadata is available as an SFDX project.

#### Change Set Components

If deploying manually, include the following components in your inbound change set:

**Custom Objects:**

- `Fulcrum_OEM__c` (object + all fields)
- `Fulcrum_Competitor__c` (object + all fields)

**Opportunity Custom Fields (all 22):**

- `Fulcrum_AI_Confidence__c`
- `Fulcrum_Competitor_Names__c`
- `Fulcrum_Competitors__c`
- `Fulcrum_Cost__c`
- `Fulcrum_Customer_Segment__c`
- `Fulcrum_Deal_Reg_Type__c`
- `Fulcrum_Deal_Type__c`
- `Fulcrum_GP_Percent__c`
- `Fulcrum_Loss_Reason__c`
- `Fulcrum_Margin__c`
- `Fulcrum_OEM__c`
- `Fulcrum_OEM_Cost__c`
- `Fulcrum_Planned_Margin__c`
- `Fulcrum_Product_Category__c`
- `Fulcrum_Quarter_End__c`
- `Fulcrum_Recommended_Margin__c`
- `Fulcrum_Relationship_Strength__c`
- `Fulcrum_Revenue__c`
- `Fulcrum_Services_Attached__c`
- `Fulcrum_Solution_Complexity__c`
- `Fulcrum_Value_Add__c`
- `Fulcrum_Win_Probability__c`

**Apex Classes:**

- `FulcrumController`
- `FulcrumCompetitiveController`
- `FulcrumControllerTest`
- `FulcrumCompetitiveControllerTest`

**Lightning Web Components:**

- `fulcrumDashboard`
- `fulcrumCompetitiveIntel`
- `fulcrumMarginChart`

**Page Layouts:**

- `Opportunity-MarginArc Enhanced` (or modify existing)

### 2.4 Page Layout Configuration

After deploying metadata, add the MarginArc LWC widgets to the Opportunity record page.

**Steps:**

1. Navigate to an Opportunity record
2. Click the **gear icon** > **Edit Page** (opens Lightning App Builder)
3. In the component palette, search for `fulcrum`
4. Drag the following components onto the page:

| Component                 | Recommended Placement                     | Width      |
| ------------------------- | ----------------------------------------- | ---------- |
| `fulcrumDashboard`        | Main content area, below standard details | Full width |
| `fulcrumCompetitiveIntel` | Right sidebar or tab                      | Standard   |
| `fulcrumMarginChart`      | Tab within dashboard or standalone        | Standard   |

5. Configure component properties:
   - **fulcrumDashboard**: No configuration required. Automatically binds to the current Opportunity record via `@api recordId`.
   - **fulcrumCompetitiveIntel**: No configuration required. Uses the Opportunity's Account ID automatically.
   - **fulcrumMarginChart**: Optional: set `showNetworkBands` to `true` to display network peer margin bands.

6. Click **Save** and **Activate** the page
7. Assign the page to the appropriate org default, app, record type, or profile

### 2.5 User Permissions

MarginArc fields require appropriate Field-Level Security (FLS) configuration. The following matrix defines the recommended access levels:

#### Field-Level Security Matrix

| Field                              | Sales Rep  | Sales Manager | System Admin |
| ---------------------------------- | ---------- | ------------- | ------------ |
| `Fulcrum_OEM__c`                   | Read/Write | Read/Write    | Read/Write   |
| `Fulcrum_Customer_Segment__c`      | Read/Write | Read/Write    | Read/Write   |
| `Fulcrum_Deal_Reg_Type__c`         | Read/Write | Read/Write    | Read/Write   |
| `Fulcrum_Competitors__c`           | Read/Write | Read/Write    | Read/Write   |
| `Fulcrum_Competitor_Names__c`      | Read/Write | Read/Write    | Read/Write   |
| `Fulcrum_Services_Attached__c`     | Read/Write | Read/Write    | Read/Write   |
| `Fulcrum_Solution_Complexity__c`   | Read/Write | Read/Write    | Read/Write   |
| `Fulcrum_Relationship_Strength__c` | Read/Write | Read/Write    | Read/Write   |
| `Fulcrum_Value_Add__c`             | Read/Write | Read/Write    | Read/Write   |
| `Fulcrum_Quarter_End__c`           | Read/Write | Read/Write    | Read/Write   |
| `Fulcrum_Planned_Margin__c`        | Read/Write | Read/Write    | Read/Write   |
| `Fulcrum_OEM_Cost__c`              | Read/Write | Read/Write    | Read/Write   |
| `Fulcrum_Deal_Type__c`             | Read/Write | Read/Write    | Read/Write   |
| `Fulcrum_Product_Category__c`      | Read/Write | Read/Write    | Read/Write   |
| `Fulcrum_Revenue__c`               | Read Only  | Read/Write    | Read/Write   |
| `Fulcrum_Cost__c`                  | Read Only  | Read/Write    | Read/Write   |
| `Fulcrum_Recommended_Margin__c`    | Read Only  | Read Only     | Read/Write   |
| `Fulcrum_AI_Confidence__c`         | Read Only  | Read Only     | Read/Write   |
| `Fulcrum_Win_Probability__c`       | Read Only  | Read Only     | Read/Write   |
| `Fulcrum_Margin__c`                | Read/Write | Read/Write    | Read/Write   |
| `Fulcrum_GP_Percent__c`            | Read Only  | Read Only     | Read/Write   |
| `Fulcrum_Loss_Reason__c`           | Read/Write | Read/Write    | Read/Write   |

> **Critical:** The LWC writes to `Fulcrum_Recommended_Margin__c`, `Fulcrum_AI_Confidence__c`, `Fulcrum_Win_Probability__c`, `Fulcrum_Margin__c`, `Fulcrum_Revenue__c`, and `Fulcrum_GP_Percent__c` via `updateRecord`. The running user (the rep) must have **Write** access to these fields for the "Apply Recommendation" button to work. If reps should not be able to manually edit these fields, use a combination of FLS (Read/Write) + validation rules that only allow updates from the LWC context.

### 2.6 Permission Set Configuration

It is recommended to create a dedicated Permission Set for MarginArc access rather than modifying profiles directly.

**Steps:**

1. Navigate to **Setup** > **Permission Sets**
2. Create a new Permission Set:

| Field    | Value          |
| -------- | -------------- |
| Label    | `MarginArc User` |
| API Name | `Fulcrum_User` |
| License  | Salesforce     |

3. Configure the Permission Set:
   - **Object Permissions:**
     - `Fulcrum_OEM__c`: Read
     - `Fulcrum_Competitor__c`: Read
   - **Field-Level Security:** Apply the matrix from section 2.5 for the "Sales Rep" column
   - **Apex Class Access:** Add `FulcrumController` and `FulcrumCompetitiveController`

4. Create an additional Permission Set for managers:

| Field    | Value             |
| -------- | ----------------- |
| Label    | `MarginArc Manager` |
| API Name | `Fulcrum_Manager` |

5. Assign Permission Sets to users or Permission Set Groups

---

## API Integration

### 3.1 Endpoint Configuration

The MarginArc backend API is hosted on AWS (Lambda + CloudFront) and is accessible at:

```
https://api.marginarc.com
```

All communication uses HTTPS (TLS 1.2 or higher). No additional endpoint configuration is needed beyond the CSP Trusted Site setup described in section 2.1.

### 3.2 Authentication Setup

#### Browser-Based (LWC)

No explicit API key is required for LWC-based calls. Authentication is handled via:

1. **CSP Trusted Site** — Salesforce allows the `fetch()` call
2. **CORS** — The backend validates the request origin against known Salesforce domains
3. **Implicit trust** — Requests originating from `*.lightning.force.com` or `*.my.salesforce.com` are accepted

The LWC makes standard `fetch()` calls:

```javascript
const response = await fetch("https://api.marginarc.com/api/recommend", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Accept: "application/json"
  },
  body: JSON.stringify(dealParameters)
});
```

#### Server-to-Server

For external integrations, an API key is required:

1. Contact your MarginArc account team to provision an API key
2. Store the key securely (environment variable, secret manager, or Salesforce Named Credential)
3. Include in every request as a Bearer token:

```
Authorization: Bearer fcrm_live_<your-key>
```

#### Salesforce Named Credential (Recommended for Apex Callouts)

If you need to call the MarginArc API from Apex (not the default LWC pattern), configure a Named Credential:

1. Navigate to **Setup** > **Named Credentials**
2. Create a new Named Credential:

| Field                   | Value                           |
| ----------------------- | ------------------------------- |
| Label                   | `FulcrumAPI`                    |
| Name                    | `FulcrumAPI`                    |
| URL                     | `https://api.marginarc.com` |
| Identity Type           | Named Principal                 |
| Authentication Protocol | Custom Header                   |
| Header Name             | `Authorization`                 |
| Header Value            | `Bearer fcrm_live_<your-key>`   |

### 3.3 Network Connectivity Requirements

| Source                   | Destination                       | Port | Protocol | Purpose                |
| ------------------------ | --------------------------------- | ---- | -------- | ---------------------- |
| Salesforce Org (browser) | api.marginarc.com             | 443  | HTTPS    | LWC API calls          |
| Salesforce Org (Apex)    | generativelanguage.googleapis.com | 443  | HTTPS    | Gemini AI explanations |

If your organization routes Salesforce traffic through a corporate proxy or CASB:

1. Whitelist `api.marginarc.com` for outbound HTTPS
2. Whitelist `generativelanguage.googleapis.com` for outbound HTTPS
3. Ensure TLS 1.2+ is supported end-to-end
4. Do not perform SSL inspection on these domains (certificate pinning may fail)

### 3.4 SSL/TLS Requirements

| Requirement              | Specification                          |
| ------------------------ | -------------------------------------- |
| Minimum TLS Version      | 1.2                                    |
| Certificate Authority    | Amazon Trust Services (AWS CloudFront) |
| Certificate Type         | RSA 2048-bit                           |
| HSTS                     | Enabled with max-age=31536000          |
| Certificate Transparency | Logged                                 |

---

## Gemini AI Integration

### 4.1 API Key Management

The Gemini API key is stored directly in the `FulcrumController` Apex class. In production deployments, it is recommended to move the key to one of the following secure storage mechanisms:

| Option                            | Pros                                      | Cons                          |
| --------------------------------- | ----------------------------------------- | ----------------------------- |
| **Apex Class Constant** (current) | Simple, no additional configuration       | Key visible in source code    |
| **Custom Metadata Type**          | Deployable, versionable, admin-accessible | Visible in Setup              |
| **Custom Setting (Protected)**    | Not visible in source code                | Requires manual setup per org |
| **Named Credential**              | Most secure, supports rotation            | More complex setup            |

**Recommended approach for production:**

1. Create a Protected Custom Setting named `Fulcrum_Settings__c`
2. Add a field `Gemini_API_Key__c` (Text, Encrypted, 255 chars)
3. Populate via **Setup** > **Custom Settings** > **Fulcrum Settings** > **Manage**
4. Update the Apex controller to read from the Custom Setting:

```apex
String apiKey = Fulcrum_Settings__c.getOrgDefaults().Gemini_API_Key__c;
```

### 4.2 Remote Site Setting

The Gemini API requires an active Remote Site Setting (configured in section 2.2). Without it, Apex callouts will throw a `CalloutException`:

```
System.CalloutException: Unauthorized endpoint, please check Remote Site Settings.
```

### 4.3 Prompt Configuration

The `generateAIExplanation` method constructs a prompt with the following structure:

```
You are a margin intelligence advisor for an IT Value-Added Reseller.
Analyze the following deal and explain the margin recommendation.

Deal Context:
- OEM: {oem}
- Deal Size: ${dealSize}
- Customer Segment: {segment}
- Competitors: {competitorCount} ({competitorNames})
- Deal Registration: {dealRegType}
- Services Attached: {servicesAttached}
- Solution Complexity: {complexity}
- Relationship Strength: {relationship}

Recommendation:
- Recommended Margin: {recommendedMargin}%
- Confidence: {confidence}%
- Planned Margin: {plannedMargin}% (gap: {gap}pp)

Drivers:
{for each driver: "- {name}: {impact}pp ({direction}) — {description}"}

Write 2-3 paragraphs explaining:
1. Why this margin is recommended
2. Key risks and opportunities
3. Specific actions the rep should take
```

The prompt is not user-configurable in the current release. Future versions will support custom prompt templates stored in Custom Metadata.

### 4.4 Fallback Behavior

When the Gemini API is unavailable, the Apex controller returns a structured fallback message rather than an error. This ensures the LWC always has content to display:

**Failure Scenarios:**

| Scenario                    | Detection                      | Fallback                                                              |
| --------------------------- | ------------------------------ | --------------------------------------------------------------------- |
| Gemini API timeout (>30s)   | `CalloutException`             | Template-based explanation built from driver data                     |
| Gemini API 429 rate limit   | HTTP 429 response              | Template-based explanation + "AI detail temporarily unavailable" note |
| Gemini API error            | HTTP 4xx/5xx                   | Template-based explanation                                            |
| Malformed response          | `JSONException` during parsing | Template-based explanation                                            |
| Remote Site Setting missing | `CalloutException`             | Template-based explanation + admin notification                       |

**Fallback Template:**

```
Based on analysis of {driverCount} deal factors, a margin of {recommendedMargin}%
is recommended with {confidence}% confidence.

Key factors: {top 3 driver names and impacts}.

{If plannedMargin provided: "Your planned margin of {plannedMargin}% is
{above/below} the recommendation by {gap}pp."}
```

---

## Network Integration

### 5.1 Opting In to the MarginArc Network

The MarginArc Network is an anonymized peer data pool that enriches margin recommendations with cross-organization benchmarks. Participation is optional and requires explicit opt-in.

**Enrollment Process:**

1. **Data Sharing Agreement** — Review and sign the MarginArc Network Data Sharing Agreement, which specifies:
   - Only anonymized deal parameters are shared (no account names, rep names, or PII)
   - Data is used exclusively for peer benchmarking
   - You can withdraw at any time with 30-day data purge

2. **Configuration** — Contact your MarginArc account team to enable network participation for your org. They will:
   - Enable the network flag on your org profile
   - Configure your org's conflict list (competitors who should not receive your data)
   - Set your geographic region for regional benchmarking

3. **Data Seeding** — Initial network contribution requires sharing anonymized historical deal data. The system automatically extracts and anonymizes the following from closed Opportunities:
   - OEM, Product Category, Deal Size (bucketed), Segment
   - Margin (actual), Competitors (count only), Deal Reg Type
   - Services Attached, Quarter End, Close Date

4. **Ongoing Contribution** — After enrollment, new closed deals are automatically anonymized and contributed to the network pool.

### 5.2 Data Anonymization Process

All data shared with the network undergoes strict anonymization:

| Original Field   | Anonymization               | Shared As                         |
| ---------------- | --------------------------- | --------------------------------- |
| Account Name     | Completely removed          | Not shared                        |
| Opportunity Name | Completely removed          | Not shared                        |
| Rep Name         | Completely removed          | Not shared                        |
| Org Identity     | Hashed org ID               | Anonymous contributor ID          |
| Deal Size        | Bucketed into ranges        | Size bucket (e.g., "$100K-$250K") |
| Margin           | Rounded to 0.5pp            | Approximate margin                |
| Close Date       | Month/year only             | Period                            |
| Competitor Names | Removed if in conflict list | Count only                        |
| Industry         | Generalized                 | Broad category                    |
| Geography        | Region only                 | Region code                       |

### 5.3 Conflict Firewall

The conflict firewall prevents competitive data leakage within the network. When your org's deal data is queried by the recommendation engine, the firewall:

1. **Checks the requester's identity** against your conflict list
2. **Suppresses your data** if the requester is a known competitor
3. **Reciprocally suppresses** the competitor's data from your recommendations

When the firewall activates, the API response includes:

```json
{
  "firewallActive": true,
  "firewallMessage": "Network data filtered: conflict firewall removed 3 peer records from a competitor organization."
}
```

The recommendation proceeds with remaining non-conflicted peer data plus the requesting org's own historical data.

**Configuring the Conflict List:**

Contact your MarginArc account team with the list of competitor org names. The firewall matches on anonymized org hashes, so no competitor data is ever visible to you.

### 5.4 Minimum Data Requirements

| Requirement              | Threshold                                      | Impact If Not Met                                           |
| ------------------------ | ---------------------------------------------- | ----------------------------------------------------------- |
| Closed deals contributed | 50+                                            | Network signals return empty; org-only data used            |
| Deal recency             | Last 12 months                                 | Stale data weighted lower; may not meet minimum             |
| Field completeness       | 80% of deals have OEM, Amount, Segment, Margin | Incomplete deals excluded from network pool                 |
| Ongoing contribution     | 5+ deals/quarter                               | Network access maintained; below threshold triggers warning |

---

## Data Migration

### 6.1 Importing Historical Deal Data

Historical deal data must be loaded into the MarginArc custom fields on existing closed Opportunities. This data feeds the ML training pipeline and dramatically improves recommendation accuracy.

**Recommended approach:**

1. Export closed Opportunities from your current system
2. Map fields to MarginArc fields (see mapping table below)
3. Validate data quality
4. Load via Data Loader, Dataloader.io, or SFDX bulk API

### 6.2 Field Mapping from Existing Fields

If your org already tracks margin and deal structure data in custom or standard fields, map them to the corresponding MarginArc fields:

| Common Existing Field      | MarginArc Target Field         | Transformation                                                             |
| -------------------------- | ------------------------------ | -------------------------------------------------------------------------- |
| `Amount` (standard)        | N/A (used directly)            | No transformation needed                                                   |
| Custom margin field (%)    | `Fulcrum_Margin__c`            | Ensure stored as percentage, not decimal                                   |
| Custom cost field ($)      | `Fulcrum_Cost__c`              | Direct mapping                                                             |
| Custom OEM/vendor field    | `Fulcrum_OEM__c`               | Normalize to match Fulcrum_OEM\_\_c record names (e.g., "CSCO" -> "Cisco") |
| Customer type/tier         | `Fulcrum_Customer_Segment__c`  | Map to: SMB, Mid-Market, Enterprise, Public Sector                         |
| Deal registration checkbox | `Fulcrum_Deal_Reg_Type__c`     | If boolean, map true -> "Standard", false -> "NotRegistered"               |
| Services included checkbox | `Fulcrum_Services_Attached__c` | Direct boolean mapping                                                     |
| Competitor count field     | `Fulcrum_Competitors__c`       | Map to: "0", "1", "2", "3+"                                                |
| Loss reason text           | `Fulcrum_Loss_Reason__c`       | Direct text mapping                                                        |

### 6.3 Data Cleansing Requirements

Before loading historical data, cleanse for the following issues:

| Issue                      | Detection                                            | Resolution                                                     |
| -------------------------- | ---------------------------------------------------- | -------------------------------------------------------------- |
| Missing OEM vendor         | `Fulcrum_OEM__c IS NULL`                             | Cross-reference with product line items or opportunity name    |
| Invalid margin values      | Margin < 0% or > 50%                                 | Review for data entry errors; exclude outliers                 |
| Missing segment            | `Fulcrum_Customer_Segment__c IS NULL`                | Derive from Account.AnnualRevenue or Account.NumberOfEmployees |
| Duplicate competitor names | Inconsistent spelling ("CDW" vs "cdw" vs "CDW Corp") | Normalize to standard picklist values                          |
| Stale cost data            | `Fulcrum_OEM_Cost__c` from 3+ years ago              | Flag as historical; ML model applies time decay weighting      |
| Zero-value deals           | Amount = 0 or Fulcrum_Revenue\_\_c = 0               | Exclude from migration — these corrupt margin calculations     |

### 6.4 Bulk Data Loading

**Recommended tool:** Salesforce Data Loader (command-line mode for large volumes)

**Batch sizing:**

| Volume               | Approach                         | Batch Size |
| -------------------- | -------------------------------- | ---------- |
| < 1,000 records      | Data Loader GUI or Dataloader.io | 200        |
| 1,000–50,000 records | Data Loader CLI (Bulk API)       | 2,000      |
| > 50,000 records     | SFDX Bulk API 2.0                | 10,000     |

**Loading sequence:**

1. Load `Fulcrum_OEM__c` records first (reference data)
2. Load `Fulcrum_Competitor__c` records (reference data)
3. Load Opportunity field updates (deal data)
4. Validate with SOQL spot-checks

**Validation queries after load:**

```sql
-- Count deals with MarginArc data
SELECT COUNT(Id)
FROM Opportunity
WHERE Fulcrum_OEM__c != null
AND IsClosed = true

-- Check margin distribution
SELECT Fulcrum_Customer_Segment__c, AVG(Fulcrum_Margin__c), COUNT(Id)
FROM Opportunity
WHERE Fulcrum_Margin__c != null AND IsClosed = true
GROUP BY Fulcrum_Customer_Segment__c

-- Verify OEM coverage
SELECT Fulcrum_OEM__c, COUNT(Id)
FROM Opportunity
WHERE Fulcrum_OEM__c != null AND IsClosed = true
GROUP BY Fulcrum_OEM__c
ORDER BY COUNT(Id) DESC
```

---

## Testing

### 7.1 Sandbox vs. Production Deployment

| Phase                   | Environment                     | Duration  | Criteria to Advance                                                             |
| ----------------------- | ------------------------------- | --------- | ------------------------------------------------------------------------------- |
| 1. Unit Testing         | Developer Sandbox               | 1–2 days  | All Apex tests pass, LWC renders correctly                                      |
| 2. Integration Testing  | Full Sandbox                    | 3–5 days  | API connectivity confirmed, end-to-end flow working, field write-back validated |
| 3. UAT                  | Full Sandbox or Partial Sandbox | 1–2 weeks | Sales rep validation, manager review, data accuracy confirmed                   |
| 4. Production Pilot     | Production (limited users)      | 2–4 weeks | 5–10 pilot reps using MarginArc on live deals                                     |
| 5. General Availability | Production (all users)          | Ongoing   | Full rollout with training                                                      |

### 7.2 Test Data Setup

#### OEM Reference Data

Load the following minimum OEM records for testing:

```json
[
  {
    "Name": "Cisco",
    "Base_Margin__c": 10.0,
    "Deal_Reg_Margin_Boost__c": 2.5,
    "Quarter_End_Discount__c": 4.0,
    "Services_Margin_Boost__c": 3.5,
    "Product_Category__c": "Networking, Security, Collaboration"
  },
  {
    "Name": "Palo Alto",
    "Base_Margin__c": 12.0,
    "Deal_Reg_Margin_Boost__c": 3.0,
    "Quarter_End_Discount__c": 3.5,
    "Services_Margin_Boost__c": 4.0,
    "Product_Category__c": "Security"
  },
  {
    "Name": "HPE",
    "Base_Margin__c": 8.0,
    "Deal_Reg_Margin_Boost__c": 2.0,
    "Quarter_End_Discount__c": 5.0,
    "Services_Margin_Boost__c": 3.0,
    "Product_Category__c": "Compute, Storage, Networking"
  },
  {
    "Name": "Dell",
    "Base_Margin__c": 7.5,
    "Deal_Reg_Margin_Boost__c": 1.5,
    "Quarter_End_Discount__c": 6.0,
    "Services_Margin_Boost__c": 2.5,
    "Product_Category__c": "Compute, Storage"
  },
  {
    "Name": "Fortinet",
    "Base_Margin__c": 14.0,
    "Deal_Reg_Margin_Boost__c": 3.5,
    "Quarter_End_Discount__c": 3.0,
    "Services_Margin_Boost__c": 3.5,
    "Product_Category__c": "Security"
  }
]
```

#### Competitor Reference Data

Load at least these competitor records:

```json
[
  {
    "Name": "CDW",
    "Primary_Strength__c": "Scale and breadth",
    "Price_Aggression__c": 7,
    "Margin_Aggression__c": 6,
    "Typical_Discount__c": 18.5
  },
  {
    "Name": "SHI",
    "Primary_Strength__c": "Software licensing and pricing",
    "Price_Aggression__c": 8,
    "Margin_Aggression__c": 7,
    "Typical_Discount__c": 20.0
  },
  {
    "Name": "Presidio",
    "Primary_Strength__c": "Engineering depth",
    "Price_Aggression__c": 5,
    "Margin_Aggression__c": 4,
    "Typical_Discount__c": 15.0
  }
]
```

#### Sample Test Opportunities

Create at least 5 test Opportunities spanning different scenarios:

| Scenario       | OEM       | Amount   | Segment    | Competitors | Deal Reg       | Services | Expected Margin |
| -------------- | --------- | -------- | ---------- | ----------- | -------------- | -------- | --------------- |
| High Margin    | Fortinet  | $80,000  | SMB        | 0           | PremiumHunting | Yes      | 18%–22%         |
| Competitive    | Cisco     | $350,000 | Enterprise | 3+          | Standard       | No       | 9%–13%          |
| Services-Heavy | HPE       | $200,000 | Mid-Market | 1           | Standard       | Yes      | 12%–16%         |
| Quarter-End    | Dell      | $500,000 | Enterprise | 2           | NotRegistered  | No       | 10%–14%         |
| New Account    | Palo Alto | $150,000 | Mid-Market | 1           | PremiumHunting | Yes      | 15%–19%         |

### 7.3 Validation Checklist

Use this checklist to validate each integration point before promoting to the next environment:

#### API Connectivity

- [ ] LWC loads without CSP errors in browser console
- [ ] `POST /api/recommend` returns a 200 response with valid JSON
- [ ] Response includes `recommendedMargin`, `confidence`, `drivers[]`, `winProbability`
- [ ] `networkStats` is populated (or shows zero if network not enrolled)
- [ ] API response time is under 3 seconds for a standard request
- [ ] Error handling works: disconnect network and verify timeout message appears

#### Field Write-Back

- [ ] Clicking "Apply Recommendation" writes `Fulcrum_Recommended_Margin__c`
- [ ] `Fulcrum_AI_Confidence__c` is populated after apply
- [ ] `Fulcrum_Win_Probability__c` is populated after apply
- [ ] `Fulcrum_Margin__c` is set to the recommended value
- [ ] `Fulcrum_Revenue__c` is calculated correctly from cost and margin
- [ ] `Fulcrum_GP_Percent__c` is calculated correctly
- [ ] Changing deal parameters and re-running updates all fields
- [ ] Fields persist after page reload

#### AI Explanation

- [ ] AI explanation text appears after recommendation
- [ ] Explanation references the specific deal parameters (OEM, segment, competitors)
- [ ] Explanation mentions the planned margin gap (if planned margin is entered)
- [ ] Fallback text appears when Gemini API is unavailable (disconnect Remote Site Setting to test)
- [ ] No error toast when Gemini times out

#### Competitive Intelligence

- [ ] Competitive intel panel loads on Opportunities with an Account
- [ ] Matchup data appears for accounts with closed deals and competitor data
- [ ] Competitor profile loads when a competitor name is selected
- [ ] "How to Win" guidance is displayed
- [ ] Panel shows "Not enough data" message for accounts with < 3 closed deals

### 7.4 Mock Mode for Demos

For demonstrations and training sessions, the MarginArc LWC includes a mock mode that uses sample data instead of live API calls.

**Enabling Mock Mode:**

There is no UI toggle. Mock mode is activated by using sample deals from the `/api/sampledeals` endpoint. In a demo environment:

1. Load sample deals via the API: `GET /api/sampledeals`
2. Use the sample deal parameters to populate test Opportunities
3. Run the recommendation — the API will return deterministic results for known sample parameters

This approach ensures demos are repeatable and independent of network conditions.

---

## Monitoring & Maintenance

### 8.1 Health Check Endpoints

| Endpoint              | Method | Purpose                                         | Expected Response       |
| --------------------- | ------ | ----------------------------------------------- | ----------------------- |
| `GET /`               | GET    | API root — confirms the service is running      | 200 with version info   |
| `GET /api/customers`  | GET    | Verifies database connectivity                  | 200 with customer data  |
| `POST /api/recommend` | POST   | Full pipeline test (use sample deal parameters) | 200 with recommendation |

**Automated health check script:**

```bash
#!/bin/bash
# MarginArc API Health Check

API_URL="https://api.marginarc.com"

# Check API availability
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$API_URL/api/customers")
if [ "$HTTP_CODE" -eq 200 ]; then
    echo "PASS: API is reachable (HTTP $HTTP_CODE)"
else
    echo "FAIL: API returned HTTP $HTTP_CODE"
fi

# Check recommendation endpoint
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST "$API_URL/api/recommend" \
    -H "Content-Type: application/json" \
    -d '{"oem":"Cisco","dealSize":100000,"competitors":"0","dealRegType":"Standard","segment":"Enterprise","servicesAttached":false,"solutionComplexity":"Single","relationship":"Good","valueAdd":"Medium","quarterEnd":false}')
if [ "$HTTP_CODE" -eq 200 ]; then
    echo "PASS: Recommendation engine is operational (HTTP $HTTP_CODE)"
else
    echo "FAIL: Recommendation engine returned HTTP $HTTP_CODE"
fi
```

### 8.2 Common Error Scenarios and Resolution

| Error                                   | Impact                         | Root Cause                                            | Resolution                                                              |
| --------------------------------------- | ------------------------------ | ----------------------------------------------------- | ----------------------------------------------------------------------- |
| LWC shows "Unable to reach MarginArc API" | No recommendations             | CSP Trusted Site missing or misconfigured             | Verify CSP Trusted Site setup per section 2.1                           |
| API returns 500 on recommend            | No recommendations             | Backend Lambda error                                  | Check CloudWatch logs for `fulcrum-api` Lambda function                 |
| AI explanation shows template text      | Degraded (functional)          | Gemini API key expired or Remote Site Setting removed | Verify Remote Site Setting and API key in Apex                          |
| "Apply" button throws error             | Cannot persist recommendations | Field-level security prevents write                   | Verify FLS for all output fields per section 2.5                        |
| Network stats always show 0             | Reduced accuracy               | Not enrolled in MarginArc Network                       | Contact account team to enable network; or insufficient historical data |
| Slow API responses (>5s)                | Poor user experience           | Backend cold start or Lambda throttling               | Retry; if persistent, check Lambda concurrent execution limits          |

### 8.3 Log Access

**Salesforce Apex Logs:**

1. Navigate to **Setup** > **Debug Logs**
2. Add the user experiencing issues as a traced entity
3. Reproduce the issue
4. Review the debug log for:
   - `FulcrumController` callout logs (Gemini API)
   - `FulcrumCompetitiveController` SOQL query results
   - Any `AuraHandledException` or `CalloutException` entries

**Backend API Logs:**

Backend logs are available in AWS CloudWatch:

- **Log Group:** `/aws/lambda/fulcrum-api`
- **Region:** us-east-1
- **Retention:** 90 days
- **Access:** AWS Console or `aws logs` CLI

Key log patterns to search for:

```
# Errors
"ERROR" OR "error" OR "Exception"

# Specific request failures
"status: 500" OR "status: 400"

# Slow requests
"duration" > 5000

# Firewall activations
"firewallActive: true"
```

### 8.4 Performance Monitoring

| Metric                        | Target   | Measurement                                      |
| ----------------------------- | -------- | ------------------------------------------------ |
| API response time (P50)       | < 500ms  | CloudWatch Lambda duration metric                |
| API response time (P95)       | < 2000ms | CloudWatch Lambda duration metric                |
| API error rate                | < 1%     | CloudWatch Lambda error count / invocation count |
| LWC load time                 | < 3s     | Browser Performance API                          |
| Gemini API response time      | < 5s     | Apex debug log timing                            |
| Field write-back success rate | > 99%    | Salesforce error logs                            |

---

## Troubleshooting

### 9.1 "API not reachable" — LWC Cannot Connect to Backend

**Symptoms:**

- The MarginArc dashboard shows an error message: "Unable to reach MarginArc API"
- Browser console shows `Refused to connect to 'https://api.marginarc.com'`
- The error includes `CSP` or `Content-Security-Policy` in the message

**Diagnosis:**

1. Open the browser developer console (F12 > Console tab)
2. Look for CSP violation messages
3. Check for `net::ERR_BLOCKED_BY_CLIENT` (could be ad blocker)

**Resolution:**

| Cause                           | Fix                                                                                                |
| ------------------------------- | -------------------------------------------------------------------------------------------------- |
| CSP Trusted Site not configured | Add `api.marginarc.com` per section 2.1                                                        |
| CSP Trusted Site misconfigured  | Verify URL is exactly `https://api.marginarc.com` (no trailing slash) and "Connect" is checked |
| Corporate proxy blocking        | Whitelist `api.marginarc.com` in corporate proxy/firewall                                      |
| Ad blocker interference         | Disable ad blocker for the Salesforce domain                                                       |
| SSL/TLS version mismatch        | Ensure client supports TLS 1.2+                                                                    |

### 9.2 "AI explanation unavailable" — Gemini Integration Failure

**Symptoms:**

- The AI explanation area shows generic template text instead of a rich narrative
- The template says "Based on analysis of N deal factors..."
- No error toast appears (this is expected — the fallback is intentional)

**Diagnosis:**

1. Check Salesforce **Setup** > **Security** > **Remote Site Settings** for `GoogleGeminiAPI`
2. Run a debug log on the user and look for `CalloutException` in `FulcrumController`
3. Check if the Gemini API key is still valid

**Resolution:**

| Cause                        | Fix                                                                     |
| ---------------------------- | ----------------------------------------------------------------------- |
| Remote Site Setting missing  | Add per section 2.2                                                     |
| Remote Site Setting inactive | Edit the Remote Site Setting and check "Active"                         |
| API key expired              | Update the API key in the Apex controller or Custom Setting             |
| Gemini API rate limited      | Wait 60 seconds; if persistent, upgrade API quota with Google           |
| Network timeout to Google    | Verify outbound connectivity to `generativelanguage.googleapis.com:443` |

### 9.3 "Recommendation not loading" — API Returns Error or Hangs

**Symptoms:**

- Spinning indicator that never resolves
- Error toast: "Failed to get recommendation"
- No data in the recommendation panel

**Diagnosis:**

1. Open browser developer console > Network tab
2. Filter for `recommend`
3. Check the HTTP status code and response body
4. If 400, check the error message for the invalid parameter
5. If 500, the issue is server-side

**Resolution:**

| Cause                   | Fix                                                                                |
| ----------------------- | ---------------------------------------------------------------------------------- |
| Missing required fields | Ensure `Fulcrum_OEM__c`, `Amount`, and `Fulcrum_Customer_Segment__c` are populated |
| Invalid OEM name        | `Fulcrum_OEM__c` value must match a `Fulcrum_OEM__c` record name exactly           |
| Invalid picklist value  | Check that all picklist fields have valid values (not null or empty)               |
| API timeout             | Retry; if persistent, check Lambda health in CloudWatch                            |
| Field permissions       | User may lack Read access to required MarginArc fields — check FLS                   |
| LWC not bound to record | Verify the LWC is on the Opportunity record page and `recordId` is populated       |

### 9.4 "Apply button error" — Cannot Write Back to Opportunity

**Symptoms:**

- Clicking "Apply Recommendation" shows an error toast
- Error message may include "Insufficient access" or "FIELD_CUSTOM_VALIDATION_EXCEPTION"
- Recommendation loads correctly but cannot be saved

**Diagnosis:**

1. Check the error toast message for specifics
2. Run a debug log on the user and search for `DmlException`
3. Verify field-level security for all output fields

**Resolution:**

| Cause                            | Fix                                                                                          |
| -------------------------------- | -------------------------------------------------------------------------------------------- |
| FLS prevents write               | Grant Read/Write access to output fields per section 2.5                                     |
| Record type restriction          | Ensure the record type allows MarginArc picklist values                                        |
| Validation rule conflict         | Check for custom validation rules on Opportunity that may conflict with MarginArc field values |
| Record locked (approval process) | Unlock the record or skip apply until after approval                                         |
| Trigger failure                  | Check for Apex triggers on Opportunity that may throw exceptions during update               |
| Sharing rule restriction         | Verify the user has Edit access to the specific Opportunity record                           |

### 9.5 "Competitive intel empty" — No Matchup Data

**Symptoms:**

- The competitive intelligence panel shows "No competitive data available"
- Matchup table is empty
- Competitor profiles load but historical data does not

**Diagnosis:**

1. Check if the Account has any closed Opportunities with `Fulcrum_Competitor_Names__c` populated
2. Run this SOQL query:

```sql
SELECT Id, Name, StageName, Fulcrum_Competitor_Names__c, Fulcrum_Margin__c
FROM Opportunity
WHERE AccountId = '<account-id>'
AND StageName IN ('Closed Won', 'Closed Lost')
AND Fulcrum_Competitor_Names__c != null
```

3. If zero results, the issue is data completeness — there are no closed deals with competitor data for this account

**Resolution:**

| Cause                                | Fix                                                                                                                    |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| No closed deals with competitor data | This is expected for new accounts. Encourage reps to populate `Fulcrum_Competitor_Names__c` on deals as they progress. |
| Data not migrated                    | Run historical data migration per section 6.1 to populate competitor names on closed Opportunities                     |
| Account ID mismatch                  | Verify the LWC is reading the correct Account ID from the Opportunity. Check for person accounts or merged accounts.   |
| FLS on Fulcrum_Competitor_Names\_\_c | User needs Read access to `Fulcrum_Competitor_Names__c` on closed Opportunities                                        |
| Sharing model restriction            | User may not have visibility to closed Opportunities on the Account. Check OWD and sharing rules.                      |

### 9.6 "Confidence always low" — ML Model Not Learning

**Symptoms:**

- AI Confidence is consistently below 50%
- Recommendations seem generic (always near OEM base margin)
- Drivers are all static (no network or rep-specific signals)

**Diagnosis:**

Check the ML model training phase by examining the `networkStats` in API responses:

- `ownDeals < 25` — Cold Start phase. Expected behavior.
- `ownDeals 26-100` — Early Learning phase. Confidence ceiling of 60%.
- `ownDeals > 100` — Should be in Operational phase with higher confidence.

**Resolution:**

| Cause                              | Fix                                                                                                      |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Insufficient historical data       | Load more historical closed deals per section 6.1                                                        |
| Missing field data on closed deals | Enrich historical deals with OEM, segment, margin, and competitor data                                   |
| Data quality issues                | Run cleansing per section 6.3 — zero-value deals, missing OEMs, and invalid margins reduce model quality |
| Not enrolled in Network            | Network data increases model accuracy by 15-25%. Enroll per section 5.1.                                 |

---

## Appendix A: Quick Reference

### All MarginArc API Endpoints

| Method | Endpoint           | Purpose                      |
| ------ | ------------------ | ---------------------------- |
| POST   | `/api/recommend`   | Get margin recommendation    |
| GET    | `/api/customers`   | List customer reference data |
| GET    | `/api/bomcatalog`  | Product catalog              |
| GET    | `/api/sampledeals` | Sample deal data for testing |

### All Apex Methods

| Class                          | Method                     | Purpose                              |
| ------------------------------ | -------------------------- | ------------------------------------ |
| `FulcrumController`            | `generateAIExplanation()`  | Gemini AI narrative                  |
| `FulcrumController`            | `getOpportunityData()`     | Load Opportunity with MarginArc fields |
| `FulcrumCompetitiveController` | `getAccountIntelligence()` | Competitive matchup data             |
| `FulcrumCompetitiveController` | `getCompetitorProfile()`   | Competitor VAR profile               |

### All Custom Objects

| Object                  | Purpose                    | Records                        |
| ----------------------- | -------------------------- | ------------------------------ |
| `Fulcrum_OEM__c`        | OEM vendor margin programs | 5+ (one per supported OEM)     |
| `Fulcrum_Competitor__c` | Competitor VAR profiles    | 10+ (one per known competitor) |

### All Opportunity Custom Fields (22)

| API Name                           | Type                  | Category         |
| ---------------------------------- | --------------------- | ---------------- |
| `Fulcrum_AI_Confidence__c`         | Percent               | AI Output        |
| `Fulcrum_Competitor_Names__c`      | Multi-Select Picklist | Competitive      |
| `Fulcrum_Competitors__c`           | Picklist              | Competitive      |
| `Fulcrum_Cost__c`                  | Currency              | Financial        |
| `Fulcrum_Customer_Segment__c`      | Picklist              | Customer Profile |
| `Fulcrum_Deal_Reg_Type__c`         | Picklist              | Deal Structure   |
| `Fulcrum_Deal_Type__c`             | Picklist              | Deal Structure   |
| `Fulcrum_GP_Percent__c`            | Percent               | AI Output        |
| `Fulcrum_Loss_Reason__c`           | Text                  | Competitive      |
| `Fulcrum_Margin__c`                | Percent               | AI Output        |
| `Fulcrum_OEM__c`                   | Text                  | Deal Structure   |
| `Fulcrum_OEM_Cost__c`              | Currency              | Financial        |
| `Fulcrum_Planned_Margin__c`        | Percent               | Deal Structure   |
| `Fulcrum_Product_Category__c`      | Picklist              | Deal Structure   |
| `Fulcrum_Quarter_End__c`           | Checkbox              | Deal Structure   |
| `Fulcrum_Recommended_Margin__c`    | Percent               | AI Output        |
| `Fulcrum_Relationship_Strength__c` | Picklist              | Customer Profile |
| `Fulcrum_Revenue__c`               | Currency              | Financial        |
| `Fulcrum_Services_Attached__c`     | Checkbox              | Deal Structure   |
| `Fulcrum_Solution_Complexity__c`   | Picklist              | Deal Structure   |
| `Fulcrum_Value_Add__c`             | Picklist              | Deal Structure   |
| `Fulcrum_Win_Probability__c`       | Percent               | AI Output        |

### Key URLs

| Resource       | URL                                         |
| -------------- | ------------------------------------------- |
| MarginArc API    | `https://api.marginarc.com`             |
| Gemini API     | `https://generativelanguage.googleapis.com` |
| Salesforce API | `https://<your-domain>.my.salesforce.com`   |
