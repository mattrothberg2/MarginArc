# MarginArc Security Whitepaper

**Document Classification:** Public
**Version:** 1.0.0
**Last Updated:** February 2026
**Author:** MarginArc Security Team
**Review Cycle:** Quarterly

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Security Philosophy](#2-security-philosophy)
3. [Architecture Security](#3-architecture-security)
4. [Data Classification](#4-data-classification)
5. [Data Privacy](#5-data-privacy)
6. [Conflict Firewall](#6-conflict-firewall)
7. [Differential Privacy](#7-differential-privacy)
8. [Federated Learning](#8-federated-learning)
9. [Network Security](#9-network-security)
10. [Salesforce Security](#10-salesforce-security)
11. [Infrastructure Security](#11-infrastructure-security)
12. [AI/ML Security](#12-aiml-security)
13. [Compliance Roadmap](#13-compliance-roadmap)
14. [Incident Response](#14-incident-response)
15. [Third-Party Dependencies](#15-third-party-dependencies)
16. [Appendix](#16-appendix)

---

## 1. Executive Summary

MarginArc is an AI-powered margin intelligence platform purpose-built for IT Value-Added
Resellers (VARs). It operates as a native Salesforce application, embedding directly within the
CRM environment where sales teams already work. The platform analyzes deal parameters to
deliver margin recommendations, win probability estimates, competitive intelligence, and
AI-generated explanations --- all without extracting customer data from the Salesforce
environment. MarginArc's security architecture is grounded in three foundational principles:
data minimization, privacy by design, and defense in depth. No personally identifiable
information (PII), account names, or customer identifiers are ever transmitted to the MarginArc
API. The backend is a stateless AWS Lambda function that processes deal parameters in
ephemeral execution contexts with no persistent storage of deal data.

The MarginArc Network --- the platform's anonymized benchmarking layer --- employs three
independent privacy safeguards operating in concert: a SHA-256 conflict firewall that
prevents organizations from encountering their own data in network aggregates, differential
privacy with Laplace noise injection (privacy budget epsilon = 1.0) on every network query, and
federated learning that ensures raw deal data never leaves the customer's Salesforce org.
Only encrypted model gradients are shared with the network, and all aggregations enforce a
minimum threshold of five contributing organizations (k-anonymity) before returning results.
These measures collectively ensure that MarginArc delivers industry-level intelligence without
compromising the confidentiality of any individual customer's pricing strategy.

---

## 2. Security Philosophy

### 2.1 Defense in Depth

MarginArc's security model employs multiple independent layers of protection. No single control
is relied upon in isolation. The architecture establishes distinct security boundaries ---
Salesforce, API, and Network --- each with its own authentication, authorization, and data
handling controls. A failure at any single layer does not compromise the confidentiality of
customer data because adjacent layers enforce independent protections.

The defense-in-depth strategy is reflected across every domain:

- **Authentication:** Salesforce session-based auth for user-facing components; API key
  authentication for server-to-server communication; separate credential management for
  third-party AI services.
- **Transport:** TLS 1.2+ encryption on every network hop, with no fallback to unencrypted
  channels.
- **Data handling:** Minimal data collection at the API layer, no persistent storage, and
  multiple privacy mechanisms (differential privacy, conflict firewall, federated learning)
  operating independently on network queries.
- **Infrastructure:** Serverless, ephemeral compute with no standing servers to patch or
  harden; edge-layer protections via CloudFront; IAM-scoped Lambda execution roles.

### 2.2 Zero-Trust Principles

MarginArc does not assume trust based on network location, identity, or prior authentication
state. Every request is independently validated:

- **Verify explicitly:** Every API call includes authentication credentials that are validated
  on every invocation. There is no session caching or token reuse across Lambda invocations.
- **Least privilege access:** The MarginArc Salesforce package accesses only the specific fields
  required for margin analysis. Apex controllers run with `with sharing` enforcement,
  ensuring the platform respects the customer's existing Salesforce security model.
- **Assume breach:** The architecture is designed so that even if the API layer were
  compromised, an attacker would gain access only to anonymous deal parameters (margin
  percentages, deal sizes, product categories) with no ability to associate them with
  specific customers, accounts, or organizations.

### 2.3 Privacy by Design

Privacy is not a feature added to MarginArc --- it is a structural property of the architecture.
The system was designed from inception so that privacy-violating behavior is not merely
prohibited by policy but is made structurally impossible:

- **Data minimization:** The API receives only the numerical and categorical parameters
  required for analysis. Account names, contact information, and organizational identifiers
  are never transmitted.
- **Purpose limitation:** Data received by the API is used solely for the immediate analysis
  request and is not retained after the Lambda execution context terminates.
- **Privacy-preserving analytics:** The MarginArc Network employs differential privacy and
  federated learning to deliver aggregate intelligence without exposing individual data
  points.
- **Transparency:** Customers can inspect exactly what data is transmitted by examining the
  LWC source code and Apex controller callout logic within their own Salesforce org.

### 2.4 Secure by Default

All security controls are enabled by default with no opt-in required:

- Differential privacy noise injection is always active on network queries.
- The conflict firewall is always active; it cannot be disabled.
- Field-Level Security respects the customer's existing Salesforce permissions model.
- HTTPS is enforced on all communications with no HTTP fallback.

---

## 3. Architecture Security

### 3.1 Component Isolation

MarginArc's architecture is segmented into three distinct security boundaries, each with
well-defined interfaces and independent security controls.

**Salesforce Boundary**

All customer CRM data resides within the customer's own Salesforce org. The MarginArc managed
package consists of four Lightning Web Components (LWCs), two Apex controllers, 22 custom
fields on standard objects, and two custom objects. All components execute within the
Salesforce security context:

- LWCs run in the Lightning Locker Service sandbox, preventing DOM access across namespaces.
- Apex controllers enforce `with sharing`, meaning they respect the customer's org-wide
  defaults, role hierarchy, and sharing rules.
- `@AuraEnabled` methods are accessible only to authenticated Salesforce users with
  appropriate profile/permission set assignments.
- Custom fields and objects follow Salesforce's standard Field-Level Security (FLS) model.

**API Boundary**

The MarginArc API is a Node.js 18 application deployed as an AWS Lambda function behind
Amazon CloudFront. It receives deal parameters (never PII), performs margin analysis, and
returns recommendations. Key isolation properties:

- Stateless execution: each Lambda invocation starts with a clean environment. No deal data
  persists between invocations.
- No database: the Lambda function reads from static data files (OEM benchmarks, model
  parameters) and does not connect to any database.
- Scoped IAM role: the Lambda execution role has minimal permissions --- only CloudWatch Logs
  write access for operational monitoring.
- CloudFront provides edge caching, DDoS mitigation, and geographic distribution.

**Network Boundary**

The MarginArc Network is the anonymized intelligence layer that provides cross-organization
benchmarking. It operates behind multiple privacy barriers:

- Only encrypted model gradients enter the network (federated learning).
- All queries are subject to differential privacy noise injection.
- The conflict firewall prevents self-referential data exposure.
- Minimum aggregation thresholds (k=5) ensure no individual organization's contribution
  can be isolated.

### 3.2 Attack Surface Analysis

MarginArc's attack surface is intentionally minimal:

| Surface          | Exposure                            | Controls                                             |
| ---------------- | ----------------------------------- | ---------------------------------------------------- |
| LWC UI           | Salesforce-authenticated users only | Lightning Locker, CSP, FLS                           |
| Apex Controllers | Salesforce-authenticated context    | `with sharing`, `@AuraEnabled`                       |
| API Endpoint     | HTTPS via CloudFront                | API key auth, input validation, rate limiting        |
| Network Queries  | Indirect via API only               | Differential privacy, conflict firewall, k-anonymity |
| AI Service       | Outbound HTTPS to Gemini API        | API key auth, no inbound surface                     |
| CI/CD            | GitHub Actions                      | Secret management, branch protection                 |

There is no administrative interface, no user management system, no database, and no
standing server infrastructure. The system has no inbound SSH, RDP, or management plane
access because there are no servers to manage.

### 3.3 Trust Boundaries

The following diagram illustrates the trust boundaries and data flow between components:

```
+------------------------------------------------------------------+
|                    CUSTOMER SALESFORCE ORG                        |
|  (Trust Boundary 1: Customer-controlled environment)             |
|                                                                  |
|  +------------------+    +------------------+                    |
|  |   LWC Components |    |  Apex Controllers|                    |
|  |  - Margin Advisor|    |  - FulcrumAPI    |                    |
|  |  - Deal Insights |--->|  - FulcrumGemini |                    |
|  |  - What-If       |    |    (with sharing)|                    |
|  |  - Competitive   |    +--------+---------+                    |
|  +------------------+             |                              |
|                                   | Deal parameters only         |
|  +----------------------------+   | (no PII, no account names)   |
|  | Custom Fields & Objects    |   |                              |
|  | (22 fields, 2 objects)     |   |                              |
|  | FLS-protected              |   |                              |
|  +----------------------------+   |                              |
+-----------------------------------+------------------------------+
                                    |
                          HTTPS (TLS 1.2+)
                          API Key Auth
                                    |
         +--------------------------+---------------------------+
         |              FULCRUM API BOUNDARY                    |
         |  (Trust Boundary 2: MarginArc-controlled)              |
         |                                                      |
         |  +-------------------+                               |
         |  | Amazon CloudFront |  WAF, DDoS protection, edge  |
         |  +--------+----------+                               |
         |           |                                          |
         |  +--------v----------+    +----------------------+   |
         |  | AWS Lambda        |    | Static Data Files    |   |
         |  | (Node.js 18)      |--->| (OEM benchmarks,     |   |
         |  | Stateless,        |    |  model parameters)   |   |
         |  | ephemeral)        |    +----------------------+   |
         |  +--------+----------+                               |
         |           |                                          |
         +-----------+------------------------------------------+
                     |
           HTTPS (TLS 1.2+)
           Encrypted gradients only
                     |
         +-----------v------------------------------------------+
         |              FULCRUM NETWORK BOUNDARY                |
         |  (Trust Boundary 3: Anonymized intelligence)         |
         |                                                      |
         |  +--------------------+  +------------------------+  |
         |  | Federated Learning |  | Differential Privacy   |  |
         |  | Aggregation        |  | Engine (epsilon=1.0)   |  |
         |  +--------------------+  +------------------------+  |
         |                                                      |
         |  +--------------------+  +------------------------+  |
         |  | Conflict Firewall  |  | k-Anonymity Enforcer   |  |
         |  | (SHA-256)          |  | (min k=5)              |  |
         |  +--------------------+  +------------------------+  |
         |                                                      |
         +------------------------------------------------------+
                     |
           HTTPS (TLS 1.2+)
           API Key Auth
                     |
         +-----------v------------------------------------------+
         |              GOOGLE CLOUD BOUNDARY                   |
         |  (Trust Boundary 4: Third-party AI service)          |
         |                                                      |
         |  +--------------------+                              |
         |  | Google Gemini API  |                              |
         |  | (Explanation gen)  |                              |
         |  +--------------------+                              |
         +------------------------------------------------------+
```

### 3.4 Data Flow Summary

1. User opens an Opportunity record in Salesforce.
2. LWC components load and invoke `@AuraEnabled` Apex methods.
3. Apex reads deal parameters from the Opportunity and related objects.
4. Apex makes an HTTPS callout to the MarginArc API with deal parameters only.
5. Lambda processes the request using local model parameters and static benchmarks.
6. Lambda optionally queries the MarginArc Network for peer benchmarks (with DP noise).
7. Lambda optionally calls the Gemini API for natural-language explanation generation.
8. Lambda returns the complete response (score, recommendation, explanation) to Apex.
9. Apex returns the response to the LWC for display.
10. No data is stored by the Lambda function after the response is sent.

---

## 4. Data Classification

### 4.1 Data Categories

MarginArc processes four distinct categories of data, each with different handling rules:

**Category 1: Deal Parameters (Transmitted to API)**

These are the numerical and categorical fields extracted from the Salesforce Opportunity
and sent to the MarginArc API for analysis. They include margin percentages, deal size ranges,
product categories, OEM identifiers, deal stage, and similar business parameters. They do
not include account names, contact information, or any field that could identify the
end customer of the deal.

**Category 2: CRM Data (Remains in Salesforce)**

All customer relationship data --- account names, contact records, activity history, notes,
attachments, and any data beyond the specific deal parameters listed in Category 1 ---
remains entirely within the customer's Salesforce org. MarginArc does not read, access,
transmit, or process this data.

**Category 3: Network Aggregates (Anonymized)**

When the MarginArc Network provides peer benchmarks, the data returned consists of
statistical aggregates (means, medians, percentiles) computed across multiple organizations.
These aggregates are subject to differential privacy noise injection and never reflect
the data of fewer than five contributing organizations.

**Category 4: AI Explanations (Generated, Ephemeral)**

Natural-language explanations are generated by Google Gemini based on the deal parameters
and recommendation output. These explanations are returned to the user in real time and are
not stored by MarginArc, the Lambda function, or Google (per Google's data processing terms
for API usage).

### 4.2 Sensitivity Levels

| Data Category      | Sensitivity | Classification        | Handling                                 |
| ------------------ | ----------- | --------------------- | ---------------------------------------- |
| Deal Parameters    | Medium      | Business Confidential | Encrypted in transit, not stored at rest |
| CRM Data           | High        | Customer Confidential | Never leaves Salesforce org              |
| Network Aggregates | Low         | Anonymized            | Differential privacy applied             |
| AI Explanations    | Medium      | Business Confidential | Ephemeral, not stored                    |

### 4.3 Data Lifecycle

**Creation**

Deal parameters are created when a sales representative enters or updates Opportunity
fields in Salesforce. MarginArc custom fields (e.g., `Fulcrum_Recommended_Margin__c`,
`Fulcrum_Deal_Score__c`) are populated by the platform's write-back functionality and
are stored as standard Salesforce fields within the customer's org.

**Processing**

When a user views an Opportunity with MarginArc components, the Apex controller reads the
relevant fields and constructs an API request payload. The Lambda function processes this
payload against local models and benchmarks. Processing is synchronous and completes within
the Lambda invocation lifecycle (typically under 2 seconds).

**Transmission**

Deal parameters are transmitted from Salesforce to the MarginArc API over HTTPS (TLS 1.2+).
The payload is a JSON object containing only the fields listed in Appendix B. No PII, no
account names, and no customer identifiers are included.

**Storage**

MarginArc does not persistently store deal parameters. The Lambda function is stateless ---
each invocation runs in an ephemeral execution environment that is destroyed after the
response is sent. There is no database, no file system persistence, and no caching layer
that retains deal data.

**Deletion**

Because deal data is not stored, there is no deletion process required on the MarginArc side.
MarginArc custom fields stored within the customer's Salesforce org follow the customer's
standard data retention and deletion policies. Customers can delete MarginArc fields at any
time by uninstalling the managed package or removing the fields manually.

---

## 5. Data Privacy

### 5.1 What Data MarginArc Accesses

Within the customer's Salesforce org, the MarginArc Apex controllers read the following fields
from the Opportunity object and related records:

**Opportunity Fields:**

- `Amount` (deal size)
- `StageName` (deal stage)
- `CloseDate` (expected close date)
- `Probability` (Salesforce probability)
- `Type` (new business, renewal, etc.)
- `LeadSource` (lead origin)

**MarginArc Custom Fields on Opportunity:**

- `Fulcrum_OEM__c` (primary OEM/vendor)
- `Fulcrum_Product_Category__c` (product category)
- `Fulcrum_Competitor_Names__c` (competitor presence)
- `Fulcrum_Incumbent__c` (incumbent flag)
- `Fulcrum_Contract_Duration__c` (contract length)
- `Fulcrum_Services_Attached__c` (services flag)
- `Fulcrum_Planned_Margin__c` (rep's planned margin %)
- `Fulcrum_Recommended_Margin__c` (MarginArc recommendation)
- `Fulcrum_Deal_Score__c` (MarginArc Deal Score 0-100)
- `Fulcrum_Win_Probability__c` (estimated win probability)

**Account Fields (read-only, not transmitted):**

- `Account.Name` (displayed in the LWC but NOT transmitted to the API)
- `Account.Industry` (used locally for context)

The complete field list is provided in Appendix B.

### 5.2 What Data MarginArc Transmits

The API request payload contains only anonymous deal parameters. Here is a representative
example of the complete payload:

```json
{
  "dealSize": 250000,
  "margin": 18.5,
  "oem": "Cisco",
  "productCategory": "Networking",
  "dealStage": "Proposal",
  "competitorPresent": true,
  "competitorNames": ["Arista", "Juniper"],
  "contractDuration": 36,
  "servicesAttached": true,
  "isIncumbent": true,
  "isRenewal": false,
  "leadSource": "Partner Referral"
}
```

**What is NOT in the payload:**

- No account name
- No contact name or email
- No Salesforce record IDs
- No organization identifier (except for the conflict firewall hash)
- No IP addresses of end customers
- No geographic information about the deal
- No free-text notes or descriptions

### 5.3 What Data MarginArc Stores

**MarginArc stores no deal data persistently.**

The AWS Lambda function is stateless. Each invocation:

1. Receives the request payload.
2. Processes it using in-memory models and bundled static data files.
3. Returns the response.
4. The execution environment is destroyed.

There is no database (SQL or NoSQL), no object storage (S3 buckets for deal data), no
caching layer (ElastiCache, DynamoDB), and no logging of deal parameter values. AWS
CloudWatch Logs capture invocation metadata (duration, memory usage, error messages)
but do not log request or response payloads.

### 5.4 What Data Enters the Network

The MarginArc Network receives only encrypted model gradient updates, never raw deal data.
The federated learning architecture ensures:

- Local models are trained within the Salesforce/API boundary using the customer's deal
  parameters.
- Only the resulting model parameter updates (gradients) are encrypted and shared with the
  network.
- Gradients are aggregated across a minimum of five organizations before being used to
  update the global model.
- Individual gradients cannot be reverse-engineered to recover the original training data
  due to the aggregation and noise injection process.

### 5.5 GDPR Considerations

MarginArc's architecture is designed to be compatible with the General Data Protection
Regulation (GDPR):

- **Lawful basis:** MarginArc processes deal parameters under the legitimate interest basis
  (Article 6(1)(f)). The processing is necessary for the customer's legitimate business
  interest in optimizing pricing strategy.
- **Data minimization (Article 5(1)(c)):** Only the minimum necessary deal parameters are
  transmitted. No PII is included in API payloads.
- **Purpose limitation (Article 5(1)(b)):** Data is used solely for margin analysis and
  recommendation generation.
- **Storage limitation (Article 5(1)(e)):** No deal data is stored beyond the duration of
  the API call.
- **Right to erasure (Article 17):** Because MarginArc stores no deal data, there is nothing
  to erase on the MarginArc side. MarginArc custom fields in Salesforce can be deleted by the
  customer at any time.
- **Data Protection Impact Assessment:** MarginArc's privacy-by-design architecture (no PII
  processing, no persistent storage, differential privacy) significantly reduces the risk
  profile. Customers should conduct their own DPIA as part of their procurement process.
- **Data transfers:** API processing occurs in AWS us-east-1. Customers requiring EU data
  residency should contact MarginArc to discuss regional deployment options.

### 5.6 CCPA Considerations

MarginArc's architecture is designed to be compatible with the California Consumer Privacy
Act (CCPA):

- **Personal information:** MarginArc does not collect, store, or sell personal information as
  defined by the CCPA. Deal parameters (margin percentages, deal sizes, product categories)
  do not constitute personal information.
- **Right to know:** MarginArc can confirm that no personal information is collected or stored.
- **Right to delete:** No personal information exists in MarginArc systems to delete.
- **Right to opt-out of sale:** MarginArc does not sell data of any kind. Aggregated network
  intelligence is derived from federated learning and differential privacy, not from the sale
  or sharing of individual customer data.
- **Non-discrimination:** MarginArc's pricing and feature availability are not conditioned on
  the exercise of privacy rights.

---

## 6. Conflict Firewall

### 6.1 How It Works

The conflict firewall is a cryptographic mechanism that prevents organizations from
encountering their own data when querying the MarginArc Network for peer benchmarks. It
operates as follows:

1. Each organization in the MarginArc Network is assigned a unique identifier within the
   system.
2. When deal data contributes to the network (via federated learning gradient updates),
   the contributing organization's identifier is hashed using SHA-256 and associated with
   the contribution.
3. When the same organization later queries the network for benchmarks, its identifier hash
   is included in the query.
4. The aggregation engine excludes all contributions whose SHA-256 hash matches the
   querying organization's hash before computing the aggregate statistics.
5. The result: an organization always sees peer data that excludes its own contributions.

### 6.2 Why It Exists

The conflict firewall addresses a specific information integrity concern: without it, an
organization with a small number of deals in a particular segment could query the network,
see aggregate statistics heavily influenced by its own data, and draw incorrect conclusions
about market positioning. The firewall ensures that network intelligence always reflects
genuine peer comparison, not self-referential feedback.

Additionally, the firewall prevents a theoretical attack vector where an organization could
submit known data points and then query the network to isolate other participants'
contributions through differencing. By excluding the querying organization's own data from
results, this attack vector is eliminated.

### 6.3 Technical Implementation

```
Organization ID: "ORG-12345-ACME"
                    |
                    v
            SHA-256 Hash Function
                    |
                    v
Hash: "a3f2b8c1d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1"
                    |
                    v
        Stored with each gradient contribution
                    |
                    v
    On query: EXCLUDE WHERE contributor_hash = requester_hash
                    |
                    v
        Return aggregates from remaining contributors only
```

Key implementation details:

- **Hash algorithm:** SHA-256, producing a 256-bit (64 hex character) digest.
- **Collision resistance:** SHA-256 has no known practical collision attacks. The probability
  of two distinct organizations producing the same hash is approximately 2^(-128), which is
  negligible.
- **One-way property:** The hash cannot be reversed to recover the organization identifier.
  Even if an attacker obtained the hash, they could not determine which organization it
  represents.
- **Salting:** Organization identifiers are salted before hashing to prevent rainbow table
  attacks against the hash values.
- **Deterministic:** The same organization always produces the same hash, ensuring consistent
  firewall operation across queries.

### 6.4 Verification and Audit

Customers can verify the conflict firewall's operation through the following mechanisms:

1. **Payload inspection:** Customers can inspect the Apex controller source code to verify
   that the organization hash is included in network queries and that the hash is computed
   correctly.
2. **Response validation:** Customers can compare their own known deal parameters against
   network aggregates to verify that their data is excluded. If a customer's deals have a
   known average margin of X% in a segment, the network aggregate for that segment should
   not reflect that specific value.
3. **Audit logging:** MarginArc can provide audit logs showing that the conflict firewall
   exclusion was applied on each network query, including the hash used for exclusion and
   the number of contributions excluded.
4. **Third-party audit:** The conflict firewall implementation is included in the scope of
   MarginArc's planned SOC 2 Type II audit (see Section 13).

---

## 7. Differential Privacy

### 7.1 What Is Differential Privacy

Differential privacy is a mathematical framework for quantifying and limiting the privacy
risk of statistical queries against datasets. In non-technical terms, it provides a formal
guarantee that the output of a query will be approximately the same whether or not any
single individual's data is included in the dataset. This means that an observer cannot
determine, with meaningful confidence, whether any specific organization's data contributed
to a particular query result.

The intuition is straightforward: before returning any aggregate statistic (such as "the
average margin for Cisco Networking deals in the $200K-$500K range"), the system adds a
carefully calibrated amount of random noise to the result. This noise is large enough to
mask the contribution of any single organization but small enough to preserve the statistical
utility of the aggregate.

### 7.2 Implementation: Laplace Mechanism

MarginArc implements the Laplace mechanism, one of the most well-studied and widely deployed
differential privacy techniques. The implementation works as follows:

1. **True aggregate computation:** The system computes the exact aggregate statistic (e.g.,
   mean margin) from the contributing data points after conflict firewall exclusion.

2. **Sensitivity calculation:** The sensitivity of the query is determined. For a mean query
   over bounded margins (0%-100%), the sensitivity is the maximum possible change in the
   output caused by adding or removing a single data point.

3. **Noise generation:** A random value is drawn from a Laplace distribution with scale
   parameter b = sensitivity / epsilon, where epsilon (the privacy budget) is set to 1.0.

4. **Noise injection:** The random value is added to the true aggregate to produce the
   differentially private result.

5. **Result return:** The noised result is returned to the querying organization.

**Mathematical formulation:**

```
Noised_Result = True_Aggregate + Laplace(0, sensitivity / epsilon)

Where:
  - Laplace(0, b) is a random draw from the Laplace distribution centered at 0
    with scale parameter b
  - sensitivity = max |f(D) - f(D')| for any two datasets D, D' differing in one record
  - epsilon = 1.0 (MarginArc's privacy budget)
```

### 7.3 Privacy Budget: Epsilon = 1.0

The privacy budget epsilon (often written as the Greek letter epsilon) is the core parameter
that controls the trade-off between privacy and accuracy. A smaller epsilon means stronger
privacy but noisier results; a larger epsilon means more accurate results but weaker privacy
guarantees.

MarginArc uses epsilon = 1.0, which is considered a moderate-to-strong privacy guarantee in
the differential privacy literature. For context:

| Epsilon | Privacy Level       | Typical Use Case                        |
| ------- | ------------------- | --------------------------------------- |
| 0.1     | Very strong         | Highly sensitive medical/financial data |
| 0.5     | Strong              | Government statistical releases         |
| **1.0** | **Moderate-strong** | **MarginArc: business deal analytics** |
| 2.0     | Moderate            | General-purpose analytics               |
| 5.0+    | Weak                | Low-sensitivity statistical queries     |

The US Census Bureau's 2020 disclosure avoidance system used epsilon values in a similar
range, and Apple's differential privacy implementations for iOS keyboard and usage analytics
use epsilon values between 1 and 8 per query.

### 7.4 What This Means in Practice

When a MarginArc user views network benchmark data --- for example, "the median margin for
Cisco Networking deals in the $200K-$500K range is 19.2%" --- the actual median computed
from contributing organizations' data has been altered by a random noise value drawn from
the Laplace distribution. The user does not know whether the true median is 19.2%, 18.8%,
or 19.6%. This uncertainty is the privacy guarantee.

**Practical example:**

Suppose five organizations contribute data to a network query, with true margins of
[16%, 18%, 20%, 21%, 23%]. The true mean is 19.6%.

With epsilon = 1.0 and the Laplace mechanism, the returned result might be any value in a
range around 19.6%. On repeated queries, the results would vary due to fresh noise injection.
An observer cannot determine whether the true mean is 19.6% or whether the value shifted
because a particular organization's data was included or excluded.

### 7.5 Privacy Guarantee: Probability of Re-Identification

The formal differential privacy guarantee (epsilon = 1.0) ensures that for any single
organization's data:

```
Pr[Output | Organization included] <= e^1.0 * Pr[Output | Organization excluded]
                                    = 2.72 * Pr[Output | Organization excluded]
```

In practical terms, an adversary attempting to determine whether a specific organization's
data was included in a query result is limited to a maximum advantage factor of 2.72x over
random guessing. Combined with the conflict firewall (which excludes the querying
organization's own data) and k-anonymity (minimum five contributors), the effective
re-identification risk is negligible for practical purposes.

### 7.6 Trade-Off: Privacy vs. Accuracy

Differential privacy introduces a fundamental trade-off: stronger privacy guarantees require
more noise, which reduces the accuracy of aggregate statistics. MarginArc manages this
trade-off through several mechanisms:

- **Aggregation minimums (k=5):** By requiring at least five contributing organizations,
  the sensitivity of each query is bounded, limiting the noise required.
- **Bounded data ranges:** Margin percentages are bounded between 0% and a reasonable
  maximum (e.g., 60%), limiting the sensitivity of mean/median queries.
- **Query composition:** MarginArc tracks the privacy budget across queries to prevent
  excessive information leakage through repeated querying (composition theorem).
- **Utility monitoring:** MarginArc monitors the signal-to-noise ratio of network queries
  to ensure that the privacy mechanism does not degrade the utility of recommendations
  below acceptable thresholds.

---

## 8. Federated Learning

### 8.1 Architecture

MarginArc's federated learning architecture is designed to enable cross-organization intelligence
without centralizing raw data. The architecture follows the standard federated learning
paradigm with MarginArc-specific adaptations for the VAR margin intelligence domain.

**High-Level Architecture:**

```
+-------------------+  +-------------------+  +-------------------+
|  Organization A   |  |  Organization B   |  |  Organization C   |
|                   |  |                   |  |                   |
|  Local Deal Data  |  |  Local Deal Data  |  |  Local Deal Data  |
|       |           |  |       |           |  |       |           |
|  Local Model      |  |  Local Model      |  |  Local Model      |
|  Training         |  |  Training         |  |  Training         |
|       |           |  |       |           |  |       |           |
|  Encrypted        |  |  Encrypted        |  |  Encrypted        |
|  Gradients        |  |  Gradients        |  |  Gradients        |
+-------+-----------+  +-------+-----------+  +-------+-----------+
        |                      |                      |
        +----------+-----------+----------+-----------+
                   |                      |
                   v                      v
        +----------+----------+  +--------+--------+
        | Gradient Aggregation|  | Conflict        |
        | Server              |  | Firewall        |
        | (Secure Aggregation)|  | (SHA-256)       |
        +----------+----------+  +-----------------+
                   |
                   v
        +----------+----------+
        | Global Model Update |
        | + Diff. Privacy     |
        +----------+----------+
                   |
        +----------+----------+----------+
        |                     |          |
        v                     v          v
  Org A receives        Org B receives   Org C receives
  updated global        updated global   updated global
  model parameters      model parameters model parameters
```

**Process:**

1. **Initialization:** Each participating organization receives the current global model
   parameters.
2. **Local training:** The organization's local model is trained (or updated) using its own
   deal data within the Salesforce/API boundary.
3. **Gradient computation:** The difference between the updated local model and the initial
   global model is computed. These differences are the gradients.
4. **Encryption:** Gradients are encrypted before transmission.
5. **Aggregation:** The central aggregation server collects encrypted gradients from multiple
   organizations and computes a weighted average.
6. **Privacy application:** Differential privacy noise is injected into the aggregated
   gradient before updating the global model.
7. **Distribution:** The updated global model is distributed back to all participating
   organizations.

### 8.2 What Is Shared

The only data transmitted from a participating organization to the MarginArc Network consists
of encrypted model parameter updates (gradients). These gradients represent the direction
and magnitude of model adjustments learned from the organization's local data. They are:

- **Numerical vectors:** Arrays of floating-point numbers representing changes to model
  weights and biases.
- **Encrypted:** All gradients are encrypted in transit using TLS 1.2+ and may be further
  encrypted using secure aggregation protocols.
- **Aggregated:** Individual gradients are never exposed to other organizations. They are
  combined server-side before being used to update the global model.

### 8.3 What Is NOT Shared

The following data never leaves the customer's Salesforce org or the ephemeral Lambda
execution context:

- Raw deal data (margins, deal sizes, specific values)
- Customer names, account names, or any identifying information
- Individual deal records or Opportunity details
- Pricing strategies or discount schedules
- Competitor-specific intelligence derived from individual deals
- Any Salesforce record IDs or metadata

### 8.4 Aggregation Minimum: k=5

To prevent the isolation of individual organizations' contributions within aggregate
statistics, MarginArc enforces a minimum contributor threshold of k=5 for all network
queries. This means:

- A network benchmark query will only return results if at least five distinct organizations
  have contributed data to the relevant segment.
- If fewer than five organizations have contributed, the query returns no network data, and
  the MarginArc recommendation is based solely on local models and static benchmarks.
- The k=5 threshold applies after conflict firewall exclusion: five contributing
  organizations must remain after removing the querying organization's own data.

This k-anonymity guarantee ensures that even in narrow market segments, no individual
organization's contribution can be isolated through statistical analysis.

### 8.5 Gradient Privacy

A known concern in federated learning is the potential for gradient inversion attacks, where
an adversary attempts to reconstruct training data from observed gradients. MarginArc mitigates
this risk through multiple layers:

1. **Secure aggregation:** Individual gradients are combined server-side before any party
   (including the aggregation server) can observe them.
2. **Differential privacy on aggregates:** Noise is injected into the aggregated gradient,
   further obscuring individual contributions.
3. **Gradient clipping:** Individual gradients are clipped to a maximum norm before
   aggregation, limiting the information content of any single contribution.
4. **Aggregation minimum (k=5):** The aggregation of at least five participants' gradients
   makes inversion significantly more difficult than single-participant gradient inversion.

---

## 9. Network Security

### 9.1 Transport Security

All communications between MarginArc components use HTTPS with TLS 1.2 or higher. There is
no fallback to unencrypted HTTP for any communication path:

| Communication Path     | Protocol                        | Minimum TLS       |
| ---------------------- | ------------------------------- | ----------------- |
| LWC to Apex Controller | Salesforce internal (encrypted) | N/A (in-platform) |
| Apex to MarginArc API    | HTTPS                           | TLS 1.2           |
| MarginArc API to Network | HTTPS                           | TLS 1.2           |
| MarginArc API to Gemini  | HTTPS                           | TLS 1.2           |
| Browser to Salesforce  | HTTPS                           | TLS 1.2           |
| CI/CD to AWS           | HTTPS                           | TLS 1.2           |

TLS configuration is managed by AWS CloudFront and Salesforce, both of which maintain
current cipher suite configurations and automatically deprecate weak ciphers. MarginArc does
not implement custom TLS termination.

### 9.2 API Authentication

MarginArc uses a layered authentication model:

**User-facing (Salesforce to API):**

- Salesforce session-based authentication: LWC components execute in the context of an
  authenticated Salesforce user. The user must have a valid Salesforce session to invoke
  `@AuraEnabled` Apex methods.
- API key: The Apex controller includes an API key in the request header when calling the
  MarginArc API. This key identifies the customer organization and authorizes the request.
- Session validation: The API validates that the request originates from a legitimate
  Salesforce callout by verifying the API key and request headers.

**Server-to-server (API to third-party services):**

- Gemini API: Authenticated via API key included in the request header. The key is stored
  in the Apex controller and is never exposed to the client side.
- Network API: Authenticated via separate server-to-server credentials.

### 9.3 Rate Limiting and DDoS Protection

MarginArc employs multiple layers of rate limiting and DDoS protection:

- **CloudFront:** Amazon CloudFront provides edge-layer DDoS protection, including automatic
  mitigation of volumetric attacks (Layer 3/4) and application-layer flood protection
  (Layer 7).
- **Lambda concurrency:** AWS Lambda concurrency limits prevent runaway invocations. The
  function is configured with reserved concurrency to ensure availability while preventing
  abuse.
- **API key rate limiting:** Each API key is subject to per-minute and per-hour request
  rate limits. Requests exceeding the limit receive a 429 (Too Many Requests) response.
- **Salesforce platform limits:** Salesforce enforces its own callout limits (100 callouts
  per transaction, governor limits), which naturally throttle the rate of API requests from
  any single org.

### 9.4 Input Validation and Sanitization

All input to the MarginArc API is validated and sanitized:

- **Schema validation:** The API validates that incoming JSON payloads conform to the expected
  schema. Unexpected fields are rejected. Required fields are enforced.
- **Type checking:** Numeric fields (deal size, margin percentage) are validated as numbers
  within expected ranges. String fields (OEM, product category) are validated against
  allowed value lists.
- **Injection prevention:** The API does not construct SQL queries, shell commands, or
  template strings from input data. There is no injection surface because there is no
  database, no shell execution, and no server-side template rendering.
- **Payload size limits:** API payloads are limited to a maximum size to prevent
  resource-exhaustion attacks. CloudFront and Lambda enforce payload size limits at the
  infrastructure level.
- **Output encoding:** API responses are returned as JSON with proper content-type headers.
  No user input is reflected in responses without sanitization.

### 9.5 No SQL Injection Surface

MarginArc's API has no SQL injection attack surface because the Lambda function does not
connect to any database. The function reads from:

- Bundled static JSON data files (OEM benchmarks, model parameters) that are included in the
  deployment package.
- In-memory model computations.

There is no SQL, NoSQL, or any other query language evaluated against user input at any
point in the processing pipeline.

---

## 10. Salesforce Security

### 10.1 Field-Level Security Model

MarginArc custom fields follow Salesforce's standard Field-Level Security (FLS) model.
Administrators can control visibility and editability of all 22 custom fields and 2 custom
objects at the profile or permission set level. This means:

- Sales representatives can be granted read access to MarginArc recommendation fields while
  restricting edit access to prevent manual override.
- Management profiles can be granted full read/write access for configuration and
  override purposes.
- Non-sales profiles can have MarginArc fields hidden entirely.

MarginArc does not bypass FLS. The Apex controllers use `with sharing` enforcement and respect
the running user's field-level permissions.

### 10.2 No Background Data Sync

MarginArc does not perform any background data synchronization. There are no scheduled Apex
jobs, no batch processes, no change data capture listeners, and no platform event
subscribers that run outside of a user-initiated context. All MarginArc operations are
triggered by a user viewing an Opportunity record, which causes the LWC components to load
and invoke Apex methods.

This design has important security implications:

- There is no standing connection between the customer's Salesforce org and the MarginArc API.
- Data is transmitted only when a user actively views a record.
- If the user does not view the record, no data is transmitted.
- There is no bulk export or continuous sync of deal data.

### 10.3 @wire Adapter Security

MarginArc LWCs use the `@wire` adapter to retrieve record data from Salesforce. The `@wire`
adapter executes in the context of the current user, meaning:

- The LWC can only access records and fields that the current user has permission to view.
- Sharing rules, role hierarchy, and record-level access are all respected.
- If a user does not have access to an Opportunity, the LWC will not load data for that
  record and will not make an API callout.

### 10.4 Apex Controller Security

Both MarginArc Apex controllers are implemented with the following security controls:

- **`with sharing` keyword:** All controllers enforce the running user's sharing rules.
  A user can only access records they have permission to see.
- **`@AuraEnabled` methods:** All methods exposed to LWCs use the `@AuraEnabled` annotation,
  which requires an authenticated Salesforce session. These methods cannot be called
  anonymously or from external systems.
- **CRUD/FLS checking:** Controllers check create, read, update, and delete permissions
  before performing DML operations on MarginArc custom fields.
- **Callout isolation:** HTTP callouts to the MarginArc API are performed from Apex, not from
  the client-side LWC. This ensures the API key is never exposed to the browser.

### 10.5 CSP and Remote Site Configuration

The MarginArc managed package requires two security configurations in the customer's Salesforce
org:

1. **CSP Trusted Site:** A Content Security Policy trusted site entry for the MarginArc API
   domain, allowing the LWC to make fetch requests to the API endpoint. This is required
   because LWCs operate within Salesforce's Content Security Policy, which blocks requests
   to untrusted domains by default.

2. **Remote Site Setting:** A Remote Site Setting for the MarginArc API domain, allowing Apex
   controllers to make HTTP callouts to the API. Salesforce requires explicit allowlisting
   of all external endpoints that Apex code communicates with.

Both configurations are limited to the specific MarginArc API domain. No wildcard domains or
overly permissive configurations are required.

---

## 11. Infrastructure Security

### 11.1 AWS Lambda: Serverless Execution

MarginArc's backend runs on AWS Lambda, which provides several inherent security advantages:

- **Ephemeral execution:** Each Lambda invocation runs in an isolated execution environment
  (microVM based on Firecracker). The environment is created for the invocation and may be
  reused for subsequent invocations to the same function but is never shared across
  different functions or AWS accounts.
- **No server management:** There are no EC2 instances, no operating systems to patch, and
  no SSH keys to manage. AWS manages the underlying infrastructure, including security
  patching of the Lambda runtime.
- **IAM scoping:** The Lambda function's execution role is scoped to the minimum required
  permissions: CloudWatch Logs write access for operational monitoring. The role has no
  access to S3, DynamoDB, RDS, or any other AWS data service.
- **VPC isolation:** The Lambda function does not run in a customer VPC. It accesses only
  the public internet (for API responses and outbound calls to Gemini) and CloudWatch Logs.
- **Concurrency controls:** Reserved concurrency limits prevent the function from consuming
  excessive resources in the event of a traffic spike or attack.

### 11.2 CloudFront: Edge Security

Amazon CloudFront serves as the entry point for all API requests and provides:

- **DDoS protection:** Automatic mitigation of volumetric and protocol-level attacks through
  AWS Shield Standard (included with CloudFront at no additional cost).
- **Geographic distribution:** Edge locations worldwide reduce latency and distribute load.
- **TLS termination:** CloudFront terminates TLS at the edge and re-encrypts traffic to the
  Lambda origin, ensuring encryption in transit throughout.
- **WAF capability:** AWS WAF can be attached to the CloudFront distribution to add
  application-layer filtering rules (IP reputation, rate limiting, managed rule groups).
- **Access logging:** CloudFront access logs can be enabled for security monitoring and
  forensic analysis.

### 11.3 No Persistent Data Storage

MarginArc's infrastructure includes no persistent data storage for deal data:

- No Amazon S3 buckets for deal data storage.
- No Amazon DynamoDB tables.
- No Amazon RDS databases.
- No Amazon ElastiCache instances.
- No Amazon EFS file systems.
- No third-party database services.

The only persistent data in the deployment is the Lambda function code package itself,
which contains the application logic and static benchmark data files. This package is
stored in AWS Lambda's internal storage, managed by AWS, and versioned through the CI/CD
deployment pipeline.

### 11.4 CI/CD Security

MarginArc uses GitHub Actions for continuous integration and deployment:

- **Secret management:** API keys, AWS credentials, and deployment tokens are stored in
  GitHub Actions encrypted secrets. They are never committed to the repository.
- **Branch protection:** The master branch requires passing CI checks before merge.
  Direct pushes to master trigger automated deployment.
- **Deployment pipeline:** On push to master, GitHub Actions automatically packages the
  Lambda function and deploys it using the AWS CLI with scoped IAM credentials.
- **Audit trail:** All deployments are logged in GitHub Actions run history, providing a
  complete audit trail of who deployed what and when.
- **No manual deployments:** The CI/CD pipeline is the only mechanism for deploying code to
  production, eliminating the risk of unauthorized manual deployments.

### 11.5 Dependency Management

The Lambda function's Node.js dependencies are managed through npm with the following
practices:

- **Lock file:** A `package-lock.json` file ensures deterministic dependency resolution
  across builds.
- **Minimal dependencies:** The function uses a minimal set of well-maintained dependencies
  to reduce the attack surface.
- **Update cadence:** Dependencies are reviewed and updated regularly to incorporate security
  patches.
- **No vulnerable dependencies:** Known vulnerabilities are addressed promptly through
  dependency updates or patches.

---

## 12. AI/ML Security

### 12.1 Google Gemini API: Data Handling

MarginArc uses Google's Gemini API for generating natural-language explanations of margin
recommendations. The integration has the following security properties:

- **API usage, not model training:** MarginArc uses the Gemini API in inference mode only.
  Per Google's API terms of service, data submitted through the API is not used to train
  or improve Google's models.
- **Data transmitted to Gemini:** The prompt sent to Gemini contains the deal parameters
  and MarginArc's recommendation output. It does not contain account names, contact
  information, or any PII.
- **Data retention:** Per Google's API data processing terms, API inputs and outputs are
  not retained by Google beyond the duration of the API call for non-default data
  retention customers.
- **No persistent context:** Each Gemini API call is independent. There is no conversation
  history, no fine-tuning, and no memory across calls.

### 12.2 Model Integrity

MarginArc implements several controls to ensure the integrity of its margin intelligence
models:

- **Versioned model parameters:** Model parameters are included in the Lambda deployment
  package and are versioned alongside the application code. Unauthorized model modifications
  require access to the CI/CD pipeline.
- **Input validation:** Model inputs are validated for range and type before processing,
  preventing adversarial inputs from causing unexpected model behavior.
- **Output bounding:** Model outputs (margin recommendations, deal scores, win probabilities)
  are bounded to valid ranges (e.g., 0-100 for scores, 0%-100% for margins), preventing
  the model from producing nonsensical recommendations.
- **Fallback mode:** If the API is unavailable or returns an error, the LWC components
  fall back to a local mock model, ensuring continuity of service without compromising
  security by exposing error details.

### 12.3 Adversarial Robustness

MarginArc considers the following adversarial scenarios and mitigations:

- **Data poisoning:** A malicious participant could attempt to corrupt the federated learning
  model by submitting adversarial gradient updates. MarginArc mitigates this through gradient
  clipping (limiting the magnitude of any single update), robust aggregation (outlier
  detection on submitted gradients), and the k=5 aggregation minimum (diluting the impact
  of any single participant).
- **Model inversion:** An attacker could attempt to extract training data from the model's
  outputs. Differential privacy (epsilon=1.0) provides a mathematical bound on the
  information leakage from model queries.
- **Evasion attacks:** An attacker could craft inputs designed to produce incorrect
  recommendations. Input validation and output bounding limit the impact of such attacks,
  and the recommendation is always presented alongside the underlying signals, allowing
  the sales representative to exercise judgment.

### 12.4 Bias Monitoring

MarginArc monitors its models for potential biases that could result in unfair or inaccurate
recommendations:

- **Segment analysis:** Model performance is analyzed across OEMs, product categories, deal
  sizes, and other segments to identify systematic biases.
- **Calibration monitoring:** The relationship between predicted win probability and actual
  win rates is monitored to ensure calibration across all segments.
- **Feedback loops:** The architecture is designed to minimize harmful feedback loops where
  recommendations could become self-reinforcing in ways that degrade accuracy over time.
- **Human oversight:** All MarginArc recommendations are presented as suggestions alongside
  supporting evidence. The sales representative always makes the final pricing decision.

---

## 13. Compliance Roadmap

### 13.1 SOC 2 Type II (In Progress)

MarginArc is preparing for SOC 2 Type II certification, which will provide independent
assurance of the platform's security, availability, and confidentiality controls. The scope
includes:

- **Security:** Access controls, encryption, authentication, and authorization mechanisms.
- **Availability:** Uptime commitments, disaster recovery, and incident response.
- **Confidentiality:** Data classification, privacy controls, and data handling procedures.

Target timeline: SOC 2 Type I readiness assessment by Q3 2026, Type II audit period
beginning Q4 2026.

### 13.2 ISO 27001 (Planned)

MarginArc plans to pursue ISO 27001 certification for its information security management
system (ISMS). This certification will demonstrate a systematic approach to managing
sensitive information, including:

- Risk assessment and treatment processes.
- Information security policies and procedures.
- Continuous improvement of security controls.

Target timeline: ISO 27001 gap assessment by Q1 2027.

### 13.3 Salesforce Security Review

MarginArc intends to undergo the Salesforce Security Review process for AppExchange listing.
This review includes:

- Source code review of all Apex and LWC components.
- CRUD/FLS compliance verification.
- Callout security validation.
- Lightning Locker Service compliance.
- Vulnerability assessment (OWASP Top 10 for Salesforce).

Target timeline: Security Review submission by Q2 2026.

### 13.4 Penetration Testing

MarginArc will conduct regular penetration testing of its infrastructure and application:

- **Annual third-party penetration test:** Conducted by an independent security firm,
  covering the API, Lambda function, CloudFront configuration, and Salesforce package.
- **Continuous automated scanning:** Automated vulnerability scanning of dependencies and
  infrastructure configuration.
- **Bug bounty program:** Planned for post-SOC 2 certification, providing a channel for
  security researchers to report vulnerabilities.

Target timeline: First penetration test by Q2 2026, recurring annually.

---

## 14. Incident Response

### 14.1 Detection and Monitoring

MarginArc monitors for security incidents through multiple channels:

- **CloudWatch metrics:** Lambda invocation errors, duration anomalies, and throttling
  events are monitored with automated alerting.
- **CloudFront access logs:** Request patterns are analyzed for anomalies, including
  unusual geographic distributions, request volume spikes, and error rate increases.
- **API key abuse detection:** Unusual patterns of API key usage (volume, timing, request
  patterns) trigger automated alerts.
- **Dependency vulnerability monitoring:** Automated alerts for newly disclosed
  vulnerabilities in dependencies.
- **GitHub security alerts:** Automated scanning for secrets in code and vulnerable
  dependencies.

### 14.2 Response Procedure

MarginArc follows a structured incident response procedure:

1. **Identification:** Confirm the incident, determine scope and severity, and assign an
   incident commander.
2. **Containment:** Isolate affected components. For the MarginArc architecture, containment
   options include: rotating API keys, disabling CloudFront distribution, updating Lambda
   function to reject requests, and revoking compromised credentials.
3. **Eradication:** Identify and remove the root cause. Deploy patched code through the
   CI/CD pipeline.
4. **Recovery:** Restore normal operations. Verify that the fix is effective and that no
   residual compromise exists.
5. **Post-incident review:** Conduct a blameless post-mortem within 72 hours. Document
   findings, identify process improvements, and update controls.

### 14.3 Notification Timeline

MarginArc commits to the following notification timeline for security incidents affecting
customer data:

| Severity                  | Initial Notification   | Detailed Report              |
| ------------------------- | ---------------------- | ---------------------------- |
| Critical (data breach)    | Within 24 hours        | Within 72 hours              |
| High (service compromise) | Within 48 hours        | Within 5 business days       |
| Medium (vulnerability)    | Within 5 business days | Within 10 business days      |
| Low (informational)       | Next scheduled update  | Included in quarterly report |

Note: Because MarginArc does not store customer deal data, the scope of potential data breaches
is limited to API keys and configuration data. Deal parameter data cannot be breached from
MarginArc's infrastructure because it is not retained.

### 14.4 Contact Information

For security inquiries, vulnerability reports, or incident notifications:

- **Security team email:** security@fulcrum.ai
- **Vulnerability reporting:** Report security vulnerabilities to security@fulcrum.ai with
  the subject line "Security Vulnerability Report."
- **Emergency contact:** For critical security issues requiring immediate response, contact
  the MarginArc engineering team directly through the customer success channel.

---

## 15. Third-Party Dependencies

### 15.1 Amazon Web Services (AWS)

| Service    | Purpose              | Compliance                             |
| ---------- | -------------------- | -------------------------------------- |
| Lambda     | API compute          | SOC 1/2/3, ISO 27001, FedRAMP, PCI DSS |
| CloudFront | CDN, DDoS protection | SOC 1/2/3, ISO 27001, FedRAMP          |
| CloudWatch | Monitoring, logging  | SOC 1/2/3, ISO 27001, FedRAMP          |
| IAM        | Access management    | SOC 1/2/3, ISO 27001, FedRAMP          |

AWS maintains comprehensive compliance certifications. Full details are available at
https://aws.amazon.com/compliance/programs/.

MarginArc's use of AWS is limited to stateless compute (Lambda) and CDN (CloudFront). No AWS
data storage services are used for customer deal data.

### 15.2 Google Cloud (Gemini API)

| Service    | Purpose                   | Compliance           |
| ---------- | ------------------------- | -------------------- |
| Gemini API | AI explanation generation | SOC 1/2/3, ISO 27001 |

Google Cloud's AI API terms specify that customer data submitted through the API is not
used for model training. MarginArc transmits only anonymous deal parameters and recommendation
outputs to the Gemini API. No PII is included in API prompts.

### 15.3 Salesforce Platform

| Component          | Purpose          | Compliance                           |
| ------------------ | ---------------- | ------------------------------------ |
| Lightning Platform | LWC/Apex runtime | SOC 1/2/3, ISO 27001, FedRAMP, HIPAA |
| Sales Cloud        | CRM data storage | SOC 1/2/3, ISO 27001, FedRAMP, HIPAA |

Salesforce is the data controller for all CRM data. MarginArc operates within the Salesforce
security model and does not circumvent any platform security controls. All customer data
remains within the customer's Salesforce org under the customer's administrative control.

### 15.4 No Other Third-Party Data Processors

MarginArc does not use any third-party data processors beyond the three listed above. There
are no analytics services, no third-party logging platforms, no customer data enrichment
services, and no marketing analytics tools that receive customer deal data.

---

## 16. Appendix

### Appendix A: Data Flow Diagram

```
+------------------------------------------------------------------+
|                      SALESFORCE ORG                               |
|                                                                  |
|  User views     LWC reads         Apex constructs                |
|  Opportunity --> Opp fields -----> API request payload            |
|                  (via @wire)       (deal params only)             |
|                                         |                        |
|                                         | HTTPS POST             |
+------------------------------------------------------------------+
                                          |
                                          v
+------------------------------------------------------------------+
|                      CLOUDFRONT                                  |
|  TLS termination, DDoS protection, geographic routing            |
+------------------------------------------------------------------+
                                          |
                                          v
+------------------------------------------------------------------+
|                      AWS LAMBDA                                  |
|                                                                  |
|  1. Parse request                                                |
|  2. Validate inputs                                              |
|  3. Compute deal score (local model)                             |
|  4. Compute margin recommendation (local model + benchmarks)     |
|  5. Compute win probability (logistic model)                     |
|  6. Query Network (optional, with DP + firewall)                 |
|  7. Call Gemini for explanation (optional)                        |
|  8. Assemble response                                            |
|  9. Return response                                              |
|  10. Execution context terminates (no data retained)             |
|                                                                  |
+------------------------------------------------------------------+
       |                                         |
       v                                         v
+------------------+                   +--------------------+
| FULCRUM NETWORK  |                   | GOOGLE GEMINI API  |
| - Federated      |                   | - Explanation gen  |
|   learning       |                   | - No data retained |
| - Diff. privacy  |                   | - No model training|
| - Conflict wall  |                   +--------------------+
| - k-anonymity    |
+------------------+
```

### Appendix B: Fields Accessed (Complete List)

**Standard Opportunity Fields:**

| Field API Name | Type     | Transmitted to API     | Purpose                       |
| -------------- | -------- | ---------------------- | ----------------------------- |
| `Amount`       | Currency | Yes (as `dealSize`)    | Deal size for margin analysis |
| `StageName`    | Picklist | Yes (as `dealStage`)   | Deal maturity signal          |
| `CloseDate`    | Date     | Yes (as relative days) | Urgency signal                |
| `Probability`  | Percent  | No                     | Displayed in LWC only         |
| `Type`         | Picklist | Yes (as `isRenewal`)   | Renewal vs. new business      |
| `LeadSource`   | Picklist | Yes (as `leadSource`)  | Channel signal                |

**MarginArc Custom Fields on Opportunity:**

| Field API Name                  | Type         | Transmitted to API          | Purpose                    |
| ------------------------------- | ------------ | --------------------------- | -------------------------- |
| `Fulcrum_OEM__c`                | Picklist     | Yes (as `oem`)              | Primary OEM/vendor         |
| `Fulcrum_Product_Category__c`   | Picklist     | Yes (as `productCategory`)  | Product segment            |
| `Fulcrum_Competitor_Names__c`   | Multi-select | Yes (as `competitorNames`)  | Competitive landscape      |
| `Fulcrum_Incumbent__c`          | Checkbox     | Yes (as `isIncumbent`)      | Incumbent flag             |
| `Fulcrum_Contract_Duration__c`  | Number       | Yes (as `contractDuration`) | Contract length in months  |
| `Fulcrum_Services_Attached__c`  | Checkbox     | Yes (as `servicesAttached`) | Services attach flag       |
| `Fulcrum_Planned_Margin__c`     | Percent      | Yes (as `margin`)           | Rep's planned margin       |
| `Fulcrum_Recommended_Margin__c` | Percent      | No (output field)           | MarginArc recommendation     |
| `Fulcrum_Deal_Score__c`         | Number       | No (output field)           | Deal Score (0-100)         |
| `Fulcrum_Win_Probability__c`    | Percent      | No (output field)           | Win probability estimate   |
| `Fulcrum_AI_Analysis__c`        | Long Text    | No (output field)           | AI explanation text        |
| `Fulcrum_Last_Analysis_Date__c` | DateTime     | No (output field)           | Last analysis timestamp    |
| `Fulcrum_Margin_Delta__c`       | Percent      | No (output field)           | Plan vs. recommended delta |
| `Fulcrum_Network_Benchmark__c`  | Percent      | No (output field)           | Network peer benchmark     |
| `Fulcrum_Confidence_Level__c`   | Picklist     | No (output field)           | Recommendation confidence  |
| `Fulcrum_Risk_Level__c`         | Picklist     | No (output field)           | Deal risk assessment       |
| `Fulcrum_Key_Drivers__c`        | Long Text    | No (output field)           | Key recommendation drivers |

**MarginArc Custom Fields on Account:**

| Field API Name                   | Type     | Transmitted to API              | Purpose                |
| -------------------------------- | -------- | ------------------------------- | ---------------------- |
| `Fulcrum_Network_Participant__c` | Checkbox | No                              | Network opt-in flag    |
| `Fulcrum_Org_Hash__c`            | Text     | Yes (as conflict firewall hash) | SHA-256 org identifier |

**MarginArc Custom Objects:**

| Object API Name           | Purpose               | Contains PII         | Transmitted |
| ------------------------- | --------------------- | -------------------- | ----------- |
| `Fulcrum_OEM_Config__c`   | OEM-specific settings | No                   | No          |
| `Fulcrum_Analysis_Log__c` | Analysis audit trail  | No (parameters only) | No          |

**Standard Account Fields (Read-Only, NOT Transmitted):**

| Field API Name | Type     | Transmitted to API | Purpose               |
| -------------- | -------- | ------------------ | --------------------- |
| `Name`         | Text     | No                 | Displayed in LWC only |
| `Industry`     | Picklist | No                 | Local context only    |

### Appendix C: API Request/Response Sanitization Rules

**Request sanitization (Apex to API):**

1. Account Name: NEVER included in API request.
2. Contact Names: NEVER included in API request.
3. Salesforce Record IDs: NEVER included in API request.
4. Free-text fields (Description, Notes): NEVER included in API request.
5. Numeric fields: Validated as numbers within expected ranges before transmission.
6. Picklist fields: Validated against allowed values before transmission.
7. Organization identifier: Transmitted only as SHA-256 hash for conflict firewall.

**Response sanitization (API to Apex):**

1. API response contains only: deal score, recommended margin, win probability, key drivers
   (categorical), AI explanation text, network benchmark (if available), and confidence level.
2. No customer identifiers are present in the response because none were sent in the request.
3. Network benchmark values have differential privacy noise applied before inclusion.
4. AI explanation text is generated from anonymous parameters and does not contain customer-
   identifying information.

### Appendix D: Encryption Standards Summary

| Domain                       | Standard                 | Key Length       | Notes                                |
| ---------------------------- | ------------------------ | ---------------- | ------------------------------------ |
| Transport (all paths)        | TLS 1.2+                 | 256-bit AES      | Managed by AWS/Salesforce            |
| Conflict firewall hash       | SHA-256                  | 256-bit          | One-way, salted                      |
| Federated learning gradients | TLS 1.2+ (in transit)    | 256-bit AES      | Encrypted during transmission        |
| API key storage (Salesforce) | Salesforce encryption    | Platform-managed | Stored in Apex controller            |
| CI/CD secrets                | GitHub encrypted secrets | Platform-managed | AES-256, access-controlled           |
| Lambda environment           | AWS-managed encryption   | Platform-managed | Encryption at rest for function code |

---

## Document Revision History

| Version | Date          | Author                   | Changes         |
| ------- | ------------- | ------------------------ | --------------- |
| 1.0.0   | February 2026 | MarginArc Security Team | Initial release |

---

## Acknowledgments

This document was prepared by the MarginArc security team with input from engineering,
product, and legal stakeholders. The differential privacy and federated learning sections
were informed by published research from Google, Apple, and the academic privacy community.

---

_This document is updated quarterly. For the latest version, visit the MarginArc
documentation portal or contact security@fulcrum.ai._

_Copyright 2026 MarginArc. All rights reserved._
