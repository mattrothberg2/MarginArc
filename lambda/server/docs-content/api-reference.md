# MarginArc API Reference

**Version:** 1.1
**Last Updated:** 2026-02-07
**Base URL:** `https://api.marginarc.com`
**API Version:** v1

---

## Table of Contents

1. [Overview](#overview)
2. [Authentication](#authentication)
3. [Request & Response Format](#request--response-format)
4. [Endpoints](#endpoints)
   - [POST /api/recommend](#post-apirecommend)
   - [GET /api/customers](#get-apicustomers)
   - [GET /api/bomcatalog](#get-apibomcatalog)
   - [GET /api/sampledeals](#get-apisampledeals)
5. [Apex Methods](#apex-methods)
   - [FulcrumController.generateAIExplanation](#fulcrumcontrollergenerateaiexplanation)
   - [FulcrumController.getOpportunityData](#fulcrumcontrollergetopportunitydata)
   - [FulcrumCompetitiveController.getAccountIntelligence](#fulcrumcompetitivecontrollergetaccountintelligence)
   - [FulcrumCompetitiveController.getCompetitorProfile](#fulcrumcompetitivecontrollergetcompetitorprofile)
6. [Error Handling](#error-handling)
7. [Rate Limiting](#rate-limiting)
8. [Changelog](#changelog)

---

## Overview

The MarginArc API provides margin intelligence and deal optimization for IT Value-Added Resellers (VARs). It analyzes deal parameters against historical performance data, peer network benchmarks, and OEM program rules to generate actionable margin recommendations.

### Architecture

The API operates in two contexts:

1. **Embedded in Salesforce** — Lightning Web Components (LWCs) running on Opportunity record pages call the API via `fetch()` from the browser. Apex controllers handle supplementary operations (AI narratives, competitive intelligence).

2. **Server-to-Server** — External systems can integrate directly with the REST API for batch processing, custom dashboards, or third-party CRM integrations.

### Base URL

All REST API endpoints are served from:

```
https://api.marginarc.com
```

All requests must use HTTPS. HTTP requests are rejected with a `301` redirect.

### API Versioning

The API is currently at **v1**. Versioning is implicit in the current release. Future versions will use path-based versioning (`/v2/api/recommend`). Breaking changes will never be introduced without a version increment and a minimum 90-day deprecation window.

---

## Authentication

### Salesforce LWC Context (Browser-Based)

When MarginArc LWCs make API calls from the Salesforce UI, authentication relies on the combination of:

- **Origin validation** — The API validates that requests originate from a Salesforce org domain (`*.lightning.force.com`, `*.my.salesforce.com`).
- **CORS headers** — Only whitelisted Salesforce org domains receive valid CORS responses.
- **CSP Trusted Site** — Salesforce must have `api.marginarc.com` configured as a CSP Trusted Site to allow outbound `fetch()` calls.

No explicit API key is required for browser-based calls from the Salesforce LWC. The CSP + CORS mechanism provides the trust boundary.

**Request headers from LWC:**

```http
Content-Type: application/json
Accept: application/json
```

### Server-to-Server Context

For server-to-server integrations (batch jobs, external dashboards, middleware):

| Header             | Value                       | Required    |
| ------------------ | --------------------------- | ----------- |
| `Authorization`    | `Bearer <api-key>`          | Yes         |
| `Content-Type`     | `application/json`          | Yes         |
| `Accept`           | `application/json`          | Recommended |
| `X-MarginArc-Org-Id` | Salesforce Org ID (18-char) | Recommended |

API keys are provisioned per-organization during onboarding. Contact your MarginArc account team to obtain credentials.

**Example:**

```http
POST /api/recommend HTTP/1.1
Host: api.marginarc.com
Authorization: Bearer fcrm_live_a1b2c3d4e5f6g7h8i9j0...
Content-Type: application/json
Accept: application/json
X-MarginArc-Org-Id: 00D5e000000EXAMPLE
```

### Token Lifecycle

| Property   | Value                                            |
| ---------- | ------------------------------------------------ |
| Format     | `fcrm_live_` prefix + 48 alphanumeric characters |
| Expiration | Non-expiring; revocation on request              |
| Rotation   | Manual via account team                          |
| Scope      | Full API access for the provisioned org          |

---

## Request & Response Format

### Content Type

All requests and responses use JSON:

```
Content-Type: application/json
```

### Character Encoding

UTF-8 is required for all request bodies and is used for all responses.

### Timestamps

All timestamps are returned in ISO 8601 format with UTC timezone:

```
2026-02-06T14:30:00.000Z
```

### Null Handling

- Null values are included in responses as `null` rather than omitted.
- Optional request parameters may be omitted entirely or sent as `null`.

### Numeric Precision

- **Percentages** — Returned as decimal values (e.g., `14.5` means 14.5%, not 0.145).
- **Currency** — Returned as numbers with up to 2 decimal places.
- **Scores** — Returned as integers in the range 0-100 unless otherwise specified.

---

## Endpoints

---

### POST /api/recommend

The primary endpoint for MarginArc. Accepts deal parameters and returns an AI-powered margin recommendation with confidence scoring, win probability, competitive drivers, and network benchmarks.

**URL:** `https://api.marginarc.com/api/recommend`
**Method:** `POST`
**Content-Type:** `application/json`

#### Request Headers

| Header             | Type   | Required    | Description                                                      |
| ------------------ | ------ | ----------- | ---------------------------------------------------------------- |
| `Content-Type`     | string | Yes         | Must be `application/json`                                       |
| `Accept`           | string | No          | Should be `application/json`                                     |
| `Authorization`    | string | Conditional | Required for server-to-server. Not required from Salesforce LWC. |
| `X-MarginArc-Org-Id` | string | No          | Salesforce Org ID for network segmentation                       |

#### Request Body Schema

| Parameter            | Type     | Required | Default           | Description                                                                                                                                                           |
| -------------------- | -------- | -------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `oem`                        | string   | Yes      | —                 | OEM vendor name. Must match a known Fulcrum_OEM\_\_c record. Examples: `"Cisco"`, `"Palo Alto"`, `"HPE"`, `"Dell"`, `"Fortinet"`                                       |
| `oemCost`                    | number   | Yes      | —                 | OEM cost basis in USD. Must be > 0. Example: `200000`                                                                                                                  |
| `competitors`                | string   | Yes      | `"0"`             | Number of known competitors. Enum: `"0"`, `"1"`, `"2"`, `"3+"`                                                                                                        |
| `competitorNames`            | string[] | No       | `[]`              | Array of competitor VAR names. Example: `["CDW", "SHI"]`                                                                                                               |
| `dealRegType`                | string   | Yes      | `"NotRegistered"` | Deal registration tier. Enum: `"NotRegistered"`, `"StandardApproved"`, `"PremiumHunting"`, `"Teaming"`                                                                 |
| `customerSegment`            | string   | Yes      | —                 | Customer segment. Enum: `"SMB"`, `"MidMarket"`, `"Enterprise"`                                                                                                        |
| `relationshipStrength`       | string   | Yes      | —                 | Relationship strength with customer. Enum: `"New"`, `"Good"`, `"Strategic"`                                                                                            |
| `customerTechSophistication` | string   | No       | `"Medium"`        | Customer technical sophistication. Enum: `"Low"`, `"Medium"`, `"High"`                                                                                                 |
| `solutionComplexity`         | string   | Yes      | `"Low"`           | Solution complexity tier. Enum: `"Low"`, `"Medium"`, `"High"`                                                                                                          |
| `valueAdd`                   | string   | Yes      | `"Low"`           | Level of value-add services/customization. Enum: `"Low"`, `"Medium"`, `"High"`                                                                                         |
| `varStrategicImportance`     | string   | No       | `"Medium"`        | VAR's strategic importance to the OEM. Enum: `"Low"`, `"Medium"`, `"High"`                                                                                             |
| `customerIndustry`           | string   | Yes      | —                 | Customer's industry. Must be an exact match from `customers.json`. See valid values below.                                                                             |
| `productCategory`            | string   | No       | `"Hardware"`      | Product category. Enum: `"Hardware"`, `"Software"`, `"Cloud"`, `"ProfessionalServices"`, `"ManagedServices"`, `"ComplexSolution"`                                      |
| `servicesAttached`           | boolean  | No       | `false`           | Whether professional services are bundled with the deal                                                                                                                |
| `quarterEnd`                 | boolean  | No       | `false`           | Whether the deal is closing within the OEM's quarter-end window                                                                                                        |
| `dealSize`                   | number   | No       | `null`            | Total deal value in USD. Example: `250000`                                                                                                                             |
| `accountName`                | string   | No       | `null`            | Account name. **Anonymized** before network transmission — used only for local context enrichment. Example: `"Acme Corp"`                                              |
| `dealType`                   | string   | No       | `null`            | Type of deal. Free text or picklist value from Opportunity. Example: `"New Business"`                                                                                  |

**Valid `customerIndustry` values** (must match exactly, validated via `customers.json`):

`"Technology"`, `"Financial Services"`, `"Life Sciences & Healthcare"`, `"Manufacturing & Automotive"`, `"Retail"`, `"Energy"`, `"Media & Telecommunications"`, `"Consumer Goods & Food"`, `"Transportation & Logistics"`, `"Diversified Conglomerates"`

> **Important:** The request body must be wrapped as `{ "input": { ... }, "plannedMarginPct": N }`. The `input` object contains all parameters above. `plannedMarginPct` is optional and used for plan-vs-recommended comparison.

#### Response Body Schema

| Field                     | Type           | Description                                                                                                                                     |
| ------------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `recommendedMargin`       | number         | AI-recommended margin percentage. Range: 0.0–50.0. Example: `14.5`                                                                              |
| `confidence`              | number         | Model confidence score as a percentage. Range: 0–100. Example: `82`                                                                             |
| `drivers`                 | object[]       | Array of margin driver objects explaining the recommendation                                                                                    |
| `drivers[].name`          | string         | Human-readable driver name. Example: `"Deal Registration Boost"`                                                                                |
| `drivers[].impact`        | number         | Margin impact in percentage points (positive = upward pressure, negative = downward). Example: `2.5`                                            |
| `drivers[].direction`     | string         | `"up"` or `"down"` — direction of the margin impact                                                                                             |
| `drivers[].description`   | string         | Narrative explanation of the driver                                                                                                             |
| `winProbability`          | number         | Estimated win probability at the recommended margin. Range: 0.0–1.0. Calculated via logistic function: `1 / (1 + exp(0.08 * (marginPct - 18)))` |
| `networkStats`            | object         | Anonymized network benchmark statistics                                                                                                         |
| `networkStats.ownDeals`   | number         | Count of the requesting org's historical deals matching this profile                                                                            |
| `networkStats.poolDeals`  | number         | Count of anonymized network peer deals matching this profile                                                                                    |
| `networkStats.totalDeals` | number         | Total deals in the analysis pool (`ownDeals + poolDeals`)                                                                                       |
| `firewallActive`          | boolean        | Whether the conflict firewall engaged (suppresses network data if competitors are in the pool)                                                  |
| `firewallMessage`         | string \| null | Human-readable firewall explanation when `firewallActive` is `true`                                                                             |
| `explanation`             | string         | Short textual explanation of the recommendation                                                                                                 |
| `qualitativeSummary`      | string         | Longer narrative summary suitable for display in a tooltip or detail panel                                                                      |

#### Drivers Object Detail

Each driver in the `drivers[]` array represents a single factor influencing the margin recommendation:

```json
{
  "name": "Deal Registration Boost",
  "impact": 2.5,
  "direction": "up",
  "description": "Premium hunting registration with Cisco adds 2.5pp to base margin through protected pricing."
}
```

Common driver names include:

| Driver Name               | Typical Direction | Description                                 |
| ------------------------- | ----------------- | ------------------------------------------- |
| `OEM Base Margin`         | up                | Starting margin from OEM program            |
| `Deal Registration Boost` | up                | Margin protection from deal reg             |
| `Services Margin Boost`   | up                | Uplift from attached services               |
| `Quarter-End Discount`    | up                | OEM quarter-end pricing benefit             |
| `Competitive Pressure`    | down              | Margin compression from competitors         |
| `Segment Adjustment`      | varies            | Adjustment based on customer segment norms  |
| `Relationship Premium`    | up                | Margin uplift from strategic relationships  |
| `Deal Size Compression`   | down              | Larger deals typically have thinner margins |
| `Value-Add Premium`       | up                | Margin protection from high value-add       |
| `Network Benchmark`       | varies            | Adjustment based on peer deal outcomes      |

#### Example Request

```json
POST /api/recommend
Content-Type: application/json

{
  "input": {
    "oem": "Cisco",
    "oemCost": 218000,
    "competitors": "2",
    "competitorNames": ["CDW", "SHI"],
    "dealRegType": "StandardApproved",
    "customerSegment": "Enterprise",
    "relationshipStrength": "Good",
    "customerIndustry": "Financial Services",
    "customerTechSophistication": "Medium",
    "solutionComplexity": "Medium",
    "valueAdd": "High",
    "varStrategicImportance": "Medium",
    "productCategory": "Hardware",
    "servicesAttached": true,
    "quarterEnd": false,
    "dealSize": 250000,
    "accountName": "Acme Corp",
    "dealType": "New Business"
  },
  "plannedMarginPct": 12.0
}
```

#### Example Response

```json
{
  "recommendedMargin": 14.5,
  "confidence": 82,
  "drivers": [
    {
      "name": "OEM Base Margin",
      "impact": 10.0,
      "direction": "up",
      "description": "Cisco networking base margin at 10% for Enterprise segment."
    },
    {
      "name": "Deal Registration Boost",
      "impact": 2.0,
      "direction": "up",
      "description": "Standard deal registration adds 2pp margin protection."
    },
    {
      "name": "Services Margin Boost",
      "impact": 3.5,
      "direction": "up",
      "description": "Attached professional services contribute 3.5pp uplift to blended margin."
    },
    {
      "name": "Value-Add Premium",
      "impact": 1.5,
      "direction": "up",
      "description": "High value-add positioning supports premium margin."
    },
    {
      "name": "Competitive Pressure",
      "impact": -2.5,
      "direction": "down",
      "description": "Two known competitors (CDW, SHI) create downward price pressure of ~2.5pp."
    }
  ],
  "winProbability": 0.77,
  "networkStats": {
    "ownDeals": 23,
    "poolDeals": 147,
    "totalDeals": 170
  },
  "firewallActive": false,
  "firewallMessage": null,
  "explanation": "Recommended margin of 14.5% reflects Cisco Enterprise deal with standard registration, services attached, and moderate competitive pressure from CDW and SHI.",
  "qualitativeSummary": "This deal has strong margin support from deal registration and services attachment. The primary headwind is competitive pressure from two known VARs. Your planned margin of 12.0% is 2.5pp below recommendation — consider whether the discount is necessary given your Good relationship strength and High value-add positioning. Network peers are winning similar deals at 13.8% median margin."
}
```

#### Error Responses

**400 Bad Request** — Invalid or missing required parameters.

```json
{
  "error": "INVALID_REQUEST",
  "message": "Missing required parameter: oem",
  "details": {
    "field": "oem",
    "constraint": "required"
  }
}
```

**400 Bad Request** — Invalid parameter value.

```json
{
  "error": "INVALID_PARAMETER",
  "message": "Invalid value for 'customerSegment'. Expected one of: SMB, MidMarket, Enterprise",
  "details": {
    "field": "customerSegment",
    "value": "Unknown",
    "allowed": ["SMB", "MidMarket", "Enterprise"]
  }
}
```

**401 Unauthorized** — Missing or invalid authentication (server-to-server only).

```json
{
  "error": "UNAUTHORIZED",
  "message": "Invalid or missing API key"
}
```

**429 Too Many Requests** — Rate limit exceeded.

```json
{
  "error": "RATE_LIMITED",
  "message": "Rate limit exceeded. Retry after 60 seconds.",
  "retryAfter": 60
}
```

**500 Internal Server Error** — Unexpected server failure.

```json
{
  "error": "INTERNAL_ERROR",
  "message": "An unexpected error occurred. Please retry or contact support.",
  "requestId": "req_a1b2c3d4e5"
}
```

**503 Service Unavailable** — ML engine temporarily unavailable.

```json
{
  "error": "SERVICE_UNAVAILABLE",
  "message": "Recommendation engine is temporarily unavailable. Fallback data may be returned.",
  "retryAfter": 30
}
```

---

### GET /api/customers

Returns customer reference data used to populate account-related fields and provide customer context for the recommendation engine.

**URL:** `https://api.marginarc.com/api/customers`
**Method:** `GET`
**Content-Type:** `application/json`

#### Request Headers

| Header          | Type   | Required    | Description                         |
| --------------- | ------ | ----------- | ----------------------------------- |
| `Accept`        | string | No          | Should be `application/json`        |
| `Authorization` | string | Conditional | Required for server-to-server calls |

#### Query Parameters

| Parameter  | Type   | Required | Description                                                                    |
| ---------- | ------ | -------- | ------------------------------------------------------------------------------ |
| `segment`  | string | No       | Filter by customer segment: `SMB`, `Mid-Market`, `Enterprise`, `Public Sector` |
| `industry` | string | No       | Filter by industry vertical                                                    |
| `limit`    | number | No       | Max records to return. Default: 100. Max: 1000.                                |
| `offset`   | number | No       | Pagination offset. Default: 0.                                                 |

#### Response Body Schema

| Field                              | Type     | Description                                   |
| ---------------------------------- | -------- | --------------------------------------------- |
| `customers`                        | object[] | Array of customer records                     |
| `customers[].id`                   | string   | Unique customer identifier                    |
| `customers[].name`                 | string   | Customer display name                         |
| `customers[].segment`              | string   | Customer segment classification               |
| `customers[].industry`             | string   | Industry vertical                             |
| `customers[].accountSize`          | number   | Annual IT spend estimate in USD               |
| `customers[].relationshipStrength` | string   | Current relationship tier                     |
| `customers[].dealCount`            | number   | Number of historical deals                    |
| `customers[].avgMargin`            | number   | Average historical margin percentage          |
| `customers[].lastDealDate`         | string   | ISO 8601 timestamp of most recent closed deal |
| `total`                            | number   | Total matching records (for pagination)       |
| `limit`                            | number   | Records per page                              |
| `offset`                           | number   | Current offset                                |

#### Example Request

```http
GET /api/customers?segment=Enterprise&limit=10
Accept: application/json
```

#### Example Response

```json
{
  "customers": [
    {
      "id": "cust_001",
      "name": "Acme Financial",
      "segment": "Enterprise",
      "industry": "Financial Services",
      "accountSize": 5200000,
      "relationshipStrength": "Strategic",
      "dealCount": 14,
      "avgMargin": 13.2,
      "lastDealDate": "2026-01-15T00:00:00.000Z"
    },
    {
      "id": "cust_002",
      "name": "GlobalTech Manufacturing",
      "segment": "Enterprise",
      "industry": "Manufacturing",
      "accountSize": 3800000,
      "relationshipStrength": "Good",
      "dealCount": 8,
      "avgMargin": 11.7,
      "lastDealDate": "2025-12-20T00:00:00.000Z"
    }
  ],
  "total": 47,
  "limit": 10,
  "offset": 0
}
```

#### Error Responses

| Code | Error               | Description                |
| ---- | ------------------- | -------------------------- |
| 400  | `INVALID_PARAMETER` | Invalid filter value       |
| 401  | `UNAUTHORIZED`      | Missing or invalid API key |
| 500  | `INTERNAL_ERROR`    | Server error               |

---

### GET /api/bomcatalog

Returns the bill of materials (BOM) product catalog, including OEM product lines, categories, and standard cost structures. Used for deal configuration and product-level margin analysis.

**URL:** `https://api.marginarc.com/api/bomcatalog`
**Method:** `GET`
**Content-Type:** `application/json`

#### Request Headers

| Header          | Type   | Required    | Description                         |
| --------------- | ------ | ----------- | ----------------------------------- |
| `Accept`        | string | No          | Should be `application/json`        |
| `Authorization` | string | Conditional | Required for server-to-server calls |

#### Query Parameters

| Parameter  | Type   | Required | Description                                       |
| ---------- | ------ | -------- | ------------------------------------------------- |
| `oem`      | string | No       | Filter by OEM vendor name. Example: `Cisco`       |
| `category` | string | No       | Filter by product category. Example: `Networking` |
| `search`   | string | No       | Free-text search across product name and SKU      |
| `limit`    | number | No       | Max records to return. Default: 100. Max: 500.    |
| `offset`   | number | No       | Pagination offset. Default: 0.                    |

#### Response Body Schema

| Field                        | Type           | Description                                                              |
| ---------------------------- | -------------- | ------------------------------------------------------------------------ |
| `products`                   | object[]       | Array of BOM catalog entries                                             |
| `products[].sku`             | string         | Product SKU / part number                                                |
| `products[].name`            | string         | Product display name                                                     |
| `products[].oem`             | string         | OEM vendor name                                                          |
| `products[].category`        | string         | Product category (Networking, Security, Compute, Storage, Collaboration) |
| `products[].listPrice`       | number         | OEM list price in USD                                                    |
| `products[].costMultiplier`  | number         | Typical cost as a multiplier of list price (e.g., 0.65 = 35% off list)   |
| `products[].baseMargin`      | number         | Standard base margin percentage for this product line                    |
| `products[].dealRegEligible` | boolean        | Whether this product is eligible for deal registration                   |
| `products[].eol`             | boolean        | Whether this product is end-of-life                                      |
| `products[].replacement`     | string \| null | Replacement SKU if EOL                                                   |
| `total`                      | number         | Total matching records                                                   |
| `limit`                      | number         | Records per page                                                         |
| `offset`                     | number         | Current offset                                                           |

#### Example Request

```http
GET /api/bomcatalog?oem=Cisco&category=Networking&limit=5
Accept: application/json
```

#### Example Response

```json
{
  "products": [
    {
      "sku": "C9300-48P-A",
      "name": "Catalyst 9300 48-port PoE+ Advantage",
      "oem": "Cisco",
      "category": "Networking",
      "listPrice": 12800,
      "costMultiplier": 0.62,
      "baseMargin": 10.0,
      "dealRegEligible": true,
      "eol": false,
      "replacement": null
    },
    {
      "sku": "C9200L-24P-4G-E",
      "name": "Catalyst 9200L 24-port PoE+ Essentials",
      "oem": "Cisco",
      "category": "Networking",
      "listPrice": 4500,
      "costMultiplier": 0.6,
      "baseMargin": 12.0,
      "dealRegEligible": true,
      "eol": false,
      "replacement": null
    }
  ],
  "total": 234,
  "limit": 5,
  "offset": 0
}
```

#### Error Responses

| Code | Error               | Description                |
| ---- | ------------------- | -------------------------- |
| 400  | `INVALID_PARAMETER` | Invalid filter value       |
| 401  | `UNAUTHORIZED`      | Missing or invalid API key |
| 500  | `INTERNAL_ERROR`    | Server error               |

---

### GET /api/sampledeals

Returns sample deal data for testing, demos, and sandbox environments. Each sample deal contains realistic parameters that can be passed directly to `/api/recommend`.

**URL:** `https://api.marginarc.com/api/sampledeals`
**Method:** `GET`
**Content-Type:** `application/json`

#### Request Headers

| Header          | Type   | Required    | Description                         |
| --------------- | ------ | ----------- | ----------------------------------- |
| `Accept`        | string | No          | Should be `application/json`        |
| `Authorization` | string | Conditional | Required for server-to-server calls |

#### Query Parameters

| Parameter  | Type   | Required | Description                                                                                          |
| ---------- | ------ | -------- | ---------------------------------------------------------------------------------------------------- |
| `scenario` | string | No       | Filter by deal scenario: `competitive`, `high-margin`, `low-margin`, `services-heavy`, `quarter-end` |
| `oem`      | string | No       | Filter by OEM                                                                                        |
| `limit`    | number | No       | Max records. Default: 20. Max: 100.                                                                  |

#### Response Body Schema

| Field                                     | Type     | Description                                                                          |
| ----------------------------------------- | -------- | ------------------------------------------------------------------------------------ |
| `deals`                                   | object[] | Array of sample deal objects                                                         |
| `deals[].id`                              | string   | Sample deal identifier                                                               |
| `deals[].name`                            | string   | Descriptive deal name for demo/testing context                                       |
| `deals[].scenario`                        | string   | Deal scenario classification                                                         |
| `deals[].parameters`                      | object   | Deal parameters object — structured identically to the `/api/recommend` request body |
| `deals[].expectedOutcome`                 | object   | Expected recommendation results for validation                                       |
| `deals[].expectedOutcome.marginRange`     | number[] | Expected margin range `[low, high]`                                                  |
| `deals[].expectedOutcome.confidenceRange` | number[] | Expected confidence range `[low, high]`                                              |
| `total`                                   | number   | Total sample deals available                                                         |

#### Example Request

```http
GET /api/sampledeals?scenario=competitive&limit=2
Accept: application/json
```

#### Example Response

```json
{
  "deals": [
    {
      "id": "sample_comp_001",
      "name": "Competitive Enterprise Cisco Deal",
      "scenario": "competitive",
      "parameters": {
        "oem": "Cisco",
        "oemCost": 310000,
        "competitors": "3+",
        "competitorNames": ["CDW", "SHI", "Presidio"],
        "dealRegType": "StandardApproved",
        "customerSegment": "Enterprise",
        "relationshipStrength": "Good",
        "customerIndustry": "Life Sciences & Healthcare",
        "solutionComplexity": "High",
        "valueAdd": "Medium",
        "servicesAttached": false,
        "quarterEnd": false,
        "dealSize": 350000,
        "accountName": "Sample Healthcare Corp",
        "dealType": "Competitive Displacement"
      },
      "expectedOutcome": {
        "marginRange": [9.0, 13.0],
        "confidenceRange": [65, 80]
      }
    },
    {
      "id": "sample_comp_002",
      "name": "Competitive Mid-Market Palo Alto Deal",
      "scenario": "competitive",
      "parameters": {
        "oem": "Palo Alto",
        "oemCost": 96000,
        "competitors": "2",
        "competitorNames": ["Optiv", "Insight"],
        "dealRegType": "NotRegistered",
        "customerSegment": "MidMarket",
        "relationshipStrength": "Good",
        "customerIndustry": "Technology",
        "solutionComplexity": "Low",
        "valueAdd": "High",
        "servicesAttached": true,
        "quarterEnd": true,
        "dealSize": 120000,
        "accountName": "Sample Tech Inc",
        "dealType": "Renewal"
      },
      "expectedOutcome": {
        "marginRange": [13.0, 17.0],
        "confidenceRange": [70, 85]
      }
    }
  ],
  "total": 12
}
```

#### Error Responses

| Code | Error               | Description             |
| ---- | ------------------- | ----------------------- |
| 400  | `INVALID_PARAMETER` | Invalid scenario filter |
| 500  | `INTERNAL_ERROR`    | Server error            |

---

## Apex Methods

MarginArc uses Salesforce Apex controllers for operations that require direct Salesforce data access or external AI integration. These methods are invoked by LWCs using the `@wire` adapter or imperative calls.

All Apex methods are `@AuraEnabled(cacheable=true)` unless otherwise noted and use API version 62.0.

---

### FulcrumController.generateAIExplanation

Calls the Google Gemini API to generate a natural-language narrative explanation of a margin recommendation. This provides the qualitative "storytelling" layer on top of the quantitative recommendation.

**Class:** `FulcrumController`
**Method:** `generateAIExplanation`
**Access:** `@AuraEnabled`
**Cacheable:** No (each invocation generates a unique response)

#### Parameters

| Parameter           | Type    | Required | Description                                                   |
| ------------------- | ------- | -------- | ------------------------------------------------------------- |
| `opportunityId`     | Id      | Yes      | The Salesforce Opportunity record ID                          |
| `recommendedMargin` | Decimal | Yes      | The margin recommendation from the API                        |
| `confidence`        | Decimal | Yes      | Confidence score from the API                                 |
| `drivers`           | String  | Yes      | JSON-serialized array of driver objects from the API response |
| `plannedMargin`     | Decimal | No       | The rep's current planned margin for comparison               |

#### Return Type

`String` — The AI-generated narrative explanation as plain text (typically 2-4 paragraphs).

#### Implementation Details

1. **Prompt Construction** — The method builds a structured prompt that includes:
   - Deal context (OEM, deal size, segment, competitors)
   - The recommended margin and confidence score
   - All margin drivers with their impacts
   - The rep's planned margin (if provided) for gap analysis
   - Instructions to write from the perspective of a margin intelligence advisor

2. **Gemini API Call** — Makes an HTTP callout to:

   ```
   https://generativelanguage.googleapis.com/v1/models/gemini-pro:generateContent
   ```

   - Uses a stored API key in the Apex controller
   - Requires a Remote Site Setting for `generativelanguage.googleapis.com`
   - Request timeout: 30 seconds

3. **Response Parsing** — Extracts the generated text from the Gemini response JSON:

   ```
   response.candidates[0].content.parts[0].text
   ```

4. **Fallback Behavior** — If the Gemini API is unavailable (timeout, error, rate limit), the method returns a structured fallback message built from the driver data rather than throwing an exception. The fallback message uses a template: `"Based on analysis of [N] deal factors, a margin of [X]% is recommended with [Y]% confidence."`

#### Error Handling

| Exception              | Cause                                        | Behavior                        |
| ---------------------- | -------------------------------------------- | ------------------------------- |
| `CalloutException`     | Network timeout or Gemini API unreachable    | Returns fallback text           |
| `JSONException`        | Malformed Gemini response                    | Returns fallback text           |
| `AuraHandledException` | Invalid opportunityId or missing permissions | Throws to LWC for toast display |

#### Example LWC Invocation

```javascript
import generateAIExplanation from "@salesforce/apex/FulcrumController.generateAIExplanation";

const explanation = await generateAIExplanation({
  opportunityId: this.recordId,
  recommendedMargin: 14.5,
  confidence: 82,
  drivers: JSON.stringify(this.drivers),
  plannedMargin: 12.0
});
```

---

### FulcrumController.getOpportunityData

Queries a single Opportunity record with all MarginArc custom fields and key relationship data. This is the primary data-fetch method used by the MarginArc LWC on initial load.

**Class:** `FulcrumController`
**Method:** `getOpportunityData`
**Access:** `@AuraEnabled(cacheable=true)`
**Cacheable:** Yes

#### Parameters

| Parameter       | Type | Required | Description                          |
| --------------- | ---- | -------- | ------------------------------------ |
| `opportunityId` | Id   | Yes      | The Salesforce Opportunity record ID |

#### Return Type

`Opportunity` — A single Opportunity sObject with all standard and MarginArc custom fields populated.

#### SOQL Query Fields

The method queries the following fields:

**Standard Fields:**

- `Id`, `Name`, `Amount`, `StageName`, `CloseDate`, `Probability`
- `Account.Name`, `Account.Industry`, `Account.AnnualRevenue`
- `Owner.Name`

**MarginArc Custom Fields (all 22):**

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

#### Access Control

- Respects Salesforce object-level and field-level security (FLS)
- Users without read access to MarginArc fields will receive `null` for those fields
- WITH SECURITY_ENFORCED is used in the SOQL query

#### Example LWC Invocation

```javascript
import getOpportunityData from '@salesforce/apex/FulcrumController.getOpportunityData';

@wire(getOpportunityData, { opportunityId: '$recordId' })
wiredOpportunity({ data, error }) {
    if (data) {
        this.opportunity = data;
        this.oem = data.Fulcrum_OEM__c;
        this.segment = data.Fulcrum_Customer_Segment__c;
        // Access relationship fields directly
        this.accountName = data.Account?.Name;
        this.industry = data.Account?.Industry;
    }
}
```

> **Important:** Relationship fields (e.g., `Account.Name`) must be accessed via direct property navigation (`data.Account?.Name`), not via `getFieldValue()` with dot-path strings. See known issues.

---

### FulcrumCompetitiveController.getAccountIntelligence

Queries closed Opportunities on the given Account to build competitive intelligence: historical matchup results, competitive strategies used in past wins, and recent deal data.

**Class:** `FulcrumCompetitiveController`
**Method:** `getAccountIntelligence`
**Access:** `@AuraEnabled(cacheable=true)`
**Cacheable:** Yes

#### Parameters

| Parameter   | Type | Required | Description                      |
| ----------- | ---- | -------- | -------------------------------- |
| `accountId` | Id   | Yes      | The Salesforce Account record ID |

#### Return Type

`Map<String, Object>` — A map containing three keys:

| Key           | Type                        | Description                                          |
| ------------- | --------------------------- | ---------------------------------------------------- |
| `matchups`    | `List<Map<String, Object>>` | Head-to-head matchup records against each competitor |
| `strategies`  | `List<String>`              | Winning strategies extracted from closed-won deals   |
| `recentDeals` | `List<Map<String, Object>>` | Recent closed deals for the account                  |

**Matchups structure:**

```json
{
  "competitorName": "CDW",
  "totalDeals": 8,
  "wins": 5,
  "losses": 3,
  "winRate": 62.5,
  "avgWinMargin": 13.2,
  "avgLossMargin": 9.8,
  "lastEncounter": "2026-01-10T00:00:00.000Z"
}
```

**Recent Deals structure:**

```json
{
  "opportunityId": "006XXXXXXXXXXXXXXX",
  "name": "Acme Corp - Q1 Network Refresh",
  "amount": 250000,
  "margin": 14.5,
  "stage": "Closed Won",
  "closeDate": "2026-01-15T00:00:00.000Z",
  "competitors": "CDW;SHI",
  "oem": "Cisco"
}
```

#### Query Logic

1. Queries all Opportunities on the Account where `StageName IN ('Closed Won', 'Closed Lost')` and MarginArc fields are populated
2. Groups by `Fulcrum_Competitor_Names__c` (multi-select picklist, semicolon-delimited)
3. Calculates win/loss ratios per competitor
4. Extracts margin statistics for wins vs. losses
5. Identifies winning strategies from deal patterns (services attached, deal reg, value-add levels)

> **Note:** Because `Fulcrum_Competitor_Names__c` is a multi-select picklist, it cannot be used in `GROUP BY` SOQL clauses. The method queries individual records and aggregates in Apex.

#### Example LWC Invocation

```javascript
import getAccountIntelligence from "@salesforce/apex/FulcrumCompetitiveController.getAccountIntelligence";

const intel = await getAccountIntelligence({ accountId: this.accountId });
this.matchups = intel.matchups;
this.strategies = intel.strategies;
this.recentDeals = intel.recentDeals;
```

---

### FulcrumCompetitiveController.getCompetitorProfile

Retrieves a detailed profile for a specific competitor VAR, sourced from the `Fulcrum_Competitor__c` custom object or hardcoded fallback data for well-known competitors.

**Class:** `FulcrumCompetitiveController`
**Method:** `getCompetitorProfile`
**Access:** `@AuraEnabled(cacheable=true)`
**Cacheable:** Yes

#### Parameters

| Parameter        | Type   | Required | Description                                                                                          |
| ---------------- | ------ | -------- | ---------------------------------------------------------------------------------------------------- |
| `competitorName` | String | Yes      | The competitor's name. Must match `Name` field on `Fulcrum_Competitor__c` or a hardcoded competitor. |

#### Return Type

`Map<String, Object>` — Competitor profile data:

| Key                  | Type    | Description                                           |
| -------------------- | ------- | ----------------------------------------------------- |
| `name`               | String  | Competitor name                                       |
| `description`        | String  | Overview of the competitor                            |
| `primaryStrength`    | String  | Key competitive advantage                             |
| `priceAggression`    | Integer | Price aggression score (1-10, 10 = most aggressive)   |
| `marginAggression`   | Integer | Margin aggression score (1-10)                        |
| `servicesCapability` | String  | Services capability description                       |
| `primaryOEMs`        | String  | Comma-separated list of primary OEM partnerships      |
| `howToWin`           | String  | Tactical guidance for winning against this competitor |
| `typicalDiscount`    | Decimal | Typical discount percentage this competitor offers    |

#### Data Source Priority

1. **Custom Object** — Queries `Fulcrum_Competitor__c` WHERE `Name = :competitorName` LIMIT 1
2. **Hardcoded Fallback** — If no custom object record exists, checks a hardcoded map of well-known competitors (CDW, SHI, Presidio, Optiv, Insight)
3. **Generic Profile** — If neither source has data, returns a generic competitor profile with neutral values

#### Example LWC Invocation

```javascript
import getCompetitorProfile from "@salesforce/apex/FulcrumCompetitiveController.getCompetitorProfile";

const profile = await getCompetitorProfile({ competitorName: "CDW" });
this.competitorProfile = profile;
```

#### Example Response

```json
{
  "name": "CDW",
  "description": "Largest US IT VAR with broad capabilities across all segments. Strong procurement and logistics engine.",
  "primaryStrength": "Scale and breadth of portfolio",
  "priceAggression": 7,
  "marginAggression": 6,
  "servicesCapability": "Growing professional services arm; strongest in deployment and managed services",
  "primaryOEMs": "Cisco, Dell, HPE, Microsoft, Lenovo",
  "howToWin": "Differentiate on technical depth, solution design, and relationship. CDW often competes on price — avoid margin wars by demonstrating architectural value and post-sale support. Leverage deal registration to protect pricing.",
  "typicalDiscount": 18.5
}
```

---

## Error Handling

### Error Response Format

All API errors follow a consistent structure:

```json
{
  "error": "ERROR_CODE",
  "message": "Human-readable description",
  "details": {},
  "requestId": "req_..."
}
```

### HTTP Status Codes

| Code | Meaning               | Retry | Description                                         |
| ---- | --------------------- | ----- | --------------------------------------------------- |
| 200  | Success               | —     | Request processed successfully                      |
| 400  | Bad Request           | No    | Invalid parameters or malformed request body        |
| 401  | Unauthorized          | No    | Invalid or missing API key                          |
| 403  | Forbidden             | No    | API key valid but insufficient permissions          |
| 404  | Not Found             | No    | Endpoint does not exist                             |
| 429  | Too Many Requests     | Yes   | Rate limit exceeded; respect `retryAfter`           |
| 500  | Internal Server Error | Yes   | Server-side failure; retry with exponential backoff |
| 502  | Bad Gateway           | Yes   | Upstream dependency failure                         |
| 503  | Service Unavailable   | Yes   | ML engine or dependency temporarily down            |

### Retry Strategy

For retryable errors (429, 500, 502, 503):

1. **First retry** — Wait `retryAfter` seconds (from response header or body), or 1 second if not provided
2. **Second retry** — Wait 2 seconds (exponential backoff)
3. **Third retry** — Wait 4 seconds
4. **Maximum retries** — 3 attempts total, then fail with error to the user

### Fallback Behavior

When the recommendation engine is unavailable, the LWC implements a client-side fallback:

1. **API timeout (>10s)** — LWC shows a "Recommendation unavailable" state with a retry button
2. **Gemini unavailable** — Apex returns a template-based explanation instead of AI-generated text
3. **Network stats unavailable** — Recommendation proceeds with org-only data; `networkStats.poolDeals` = 0
4. **Complete API failure** — LWC falls back to a mock logistic model: `1 / (1 + exp(0.08 * (marginPct - 18)))` for win probability estimation only

---

## Rate Limiting

### Limits by Endpoint

| Endpoint               | Rate Limit   | Window     | Scope   |
| ---------------------- | ------------ | ---------- | ------- |
| `POST /api/recommend`  | 100 requests | Per minute | Per org |
| `GET /api/customers`   | 60 requests  | Per minute | Per org |
| `GET /api/bomcatalog`  | 60 requests  | Per minute | Per org |
| `GET /api/sampledeals` | 30 requests  | Per minute | Per org |

### Rate Limit Headers

All responses include rate limit information:

```http
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 87
X-RateLimit-Reset: 1707235260
```

| Header                  | Description                                      |
| ----------------------- | ------------------------------------------------ |
| `X-RateLimit-Limit`     | Maximum requests allowed in the current window   |
| `X-RateLimit-Remaining` | Requests remaining in the current window         |
| `X-RateLimit-Reset`     | Unix timestamp when the rate limit window resets |

### Burst Handling

Short bursts up to 2x the per-minute limit are allowed within a 5-second window, provided the average over the full minute stays within limits.

### Exceeding Limits

When a rate limit is exceeded, the API returns `429 Too Many Requests` with a `Retry-After` header indicating how many seconds to wait.

---

## Changelog

### v1.0 — 2026-02-06 (Current)

- Initial public API release
- `POST /api/recommend` with full 31-signal analysis
- `GET /api/customers` with pagination and filtering
- `GET /api/bomcatalog` with product catalog search
- `GET /api/sampledeals` with scenario-based filtering
- Apex controllers for AI explanation and competitive intelligence
- Win probability calculation via logistic function
- Conflict firewall for network data isolation
- Rate limiting with per-org quotas

### v0.9 — 2026-01-15 (Beta)

- Added `winProbability` to `/api/recommend` response
- Added `firewallActive` and `firewallMessage` fields
- Added `competitorNames` array parameter
- Expanded `drivers[]` response with `direction` field

### v0.8 — 2025-12-01 (Alpha)

- Initial `/api/recommend` endpoint
- Basic margin recommendation with OEM base margins
- Customer and BOM catalog endpoints
- Apex controller for Gemini AI integration

---

## Appendix: Known Issues

### Apex Decimal to JavaScript Number

Apex `Decimal` values returned from `@AuraEnabled` methods do not behave as JavaScript `Number` instances in LWC. They support arithmetic operators (`*`, `>=`) but lack `Number.prototype` methods like `.toFixed()`.

**Workaround:** Always wrap Apex-returned decimals with `Number()` before calling `.toFixed()`:

```javascript
// Incorrect — will throw TypeError
const display = data.Fulcrum_Margin__c.toFixed(1);

// Correct
const display = Number(data.Fulcrum_Margin__c).toFixed(1);

// Or use a helper
function n(val) {
  return val == null ? 0 : Number(val);
}
const display = n(data.Fulcrum_Margin__c).toFixed(1);
```

### Relationship Field Access in LWC

`getFieldValue` from `lightning/uiRecordApi` does not work with string dot-path notation for relationship fields.

**Workaround:** Use direct property access:

```javascript
// Incorrect
const accountName = getFieldValue(data, "Account.Name");

// Correct
const accountName = data.fields?.Account?.value?.fields?.Name?.value;
```

### Multi-Select Picklist GROUP BY

`Fulcrum_Competitor_Names__c` (multi-select picklist) cannot be used in `GROUP BY` SOQL clauses. The `getAccountIntelligence` method handles this by querying individual records and aggregating in Apex.
