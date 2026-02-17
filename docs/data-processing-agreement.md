# MarginArc Data Processing Agreement (DPA)

**Version:** 1.0
**Effective Date:** [Insert Date]
**Last Updated:** February 2026

This Data Processing Agreement ("DPA") forms part of the Master Subscription Agreement between MarginArc ("Processor") and the subscribing organization ("Controller," "Customer") and governs the processing of personal data and business data by MarginArc in connection with the MarginArc service.

---

## 1. Data Processed

### 1.1 Salesforce Opportunity Data

MarginArc processes the following fields from the Customer's Salesforce Opportunity records when a user initiates a deal scoring request:

| Field Category | Fields | Purpose |
|---|---|---|
| Deal attributes | OEM vendor, product category, segment, deal registration type, solution complexity, value-add level | Similarity matching and margin recommendation via the scoring engine |
| Financial | OEM cost, sell price, margin percentage, deal amount | Margin calculation, recommendation generation, and historical analytics |
| Status | Stage, won/lost status, loss reason, close date | Win probability modeling and cohort analysis |
| Context | Competitor count, deal urgency, quarter-end flag, services attached | Contextual scoring adjustments |

### 1.2 Salesforce Account Data

| Field | Usage | Storage |
|---|---|---|
| Account name | Displayed in the MarginArc UI for deal identification | Stored in `recorded_deals` only if the user saves the deal |
| Industry | Used as a scoring input (similarity matching) | Stored with saved deals |

Account data is used for display and scoring context. It is not shared with third parties or used for purposes beyond the MarginArc service.

### 1.3 Salesforce User Data

| Field | Usage | Storage |
|---|---|---|
| Opportunity owner name | Displayed on the Manager Dashboard for pipeline visibility | Stored with saved deals |

### 1.4 Data NOT Processed

MarginArc does **not** access, transmit, or store the following data from the Customer's Salesforce org:

- Contact records (names, emails, phone numbers, addresses)
- Lead records
- Customer personally identifiable information (PII)
- Email messages or activity history
- Attachments or files
- Chatter posts or collaboration data
- Custom objects outside the Opportunity and Account standard objects (unless explicitly configured)

The MarginArc Salesforce package enforces Field-Level Security (FLS) and CRUD permissions, ensuring it can only access fields the running user has permission to view.

---

## 2. Data Storage

### 2.1 Infrastructure

| Component | Location | Provider |
|---|---|---|
| Application server | AWS Lambda | Amazon Web Services, us-east-1 (N. Virginia) |
| Database | Amazon RDS (PostgreSQL) | Amazon Web Services, us-east-1 |
| Content delivery | Amazon CloudFront | Amazon Web Services (global edge) |
| Secrets management | AWS Systems Manager Parameter Store | Amazon Web Services, us-east-1 |

### 2.2 Encryption at Rest

- **Database:** Amazon RDS encryption using AWS Key Management Service (KMS). All data stored in PostgreSQL — including deal records, license data, audit logs, and OAuth tokens — is encrypted at rest via AES-256 through the RDS encryption layer.
- **OAuth tokens:** Salesforce OAuth access tokens and refresh tokens are additionally encrypted at the application layer using AES-256-GCM before storage in the database, providing defense-in-depth beyond RDS-level encryption.
- **Secrets:** All secrets (database credentials, JWT signing keys, API keys) are stored in AWS SSM Parameter Store with SecureString encryption (AWS KMS).

### 2.3 Encryption in Transit

- All API communication between the Salesforce package and the MarginArc API occurs over HTTPS (TLS 1.2 or higher).
- All database connections use SSL/TLS with certificate verification (`rejectUnauthorized: true`).
- The admin portal and documentation portal are served over HTTPS via CloudFront.

---

## 3. Data Retention

### 3.1 Deal Data

| Data Type | Default Retention | Configurable |
|---|---|---|
| Saved deal records (`recorded_deals`) | 36 months from deal close date | Yes — configurable per customer upon request |
| Deal analytics (aggregated) | 36 months | Yes |
| Ephemeral scoring data (not saved) | Duration of the API request only | N/A — not persisted |

### 3.2 Operational Data

| Data Type | Retention |
|---|---|
| License records | Duration of the contract + 12 months |
| Audit logs | 24 months |
| Admin portal access logs | 24 months |
| Salesforce OAuth tokens | Duration of the active connection; revoked on disconnection |

### 3.3 Automatic Expiry

Deal records older than the retention period are eligible for automated deletion. Customers may request a shorter retention period at any time.

---

## 4. Data Deletion

### 4.1 On Contract Termination

Upon termination or expiration of the Customer's subscription, MarginArc will:

1. **Within 30 days:** Disable API access and revoke all active license keys for the Customer's Salesforce org(s).
2. **Within 60 days:** Delete all Customer deal data from the `recorded_deals` table, including all associated analytics records.
3. **Within 60 days:** Delete the Salesforce OAuth connection record and destroy the encrypted access/refresh tokens.
4. **Within 60 days:** Remove the Customer record and associated license records from the licensing database.
5. **Within 90 days:** Purge all audit log entries referencing the Customer's data from backups.

### 4.2 On Request

The Customer may request deletion of their data at any time by contacting MarginArc support. MarginArc will confirm deletion in writing within 30 days of the request.

### 4.3 Deletion Method

Data deletion is performed via SQL `DELETE` operations against the production database. RDS automated backups (retained for 7 days) will naturally expire, removing deleted data from backup snapshots. MarginArc does not retain offline or archival copies of Customer data beyond the RDS backup window.

---

## 5. Sub-Processors

MarginArc uses the following sub-processors in the delivery of the service:

| Sub-Processor | Purpose | Data Accessed | Location |
|---|---|---|---|
| **Amazon Web Services (AWS)** | Infrastructure hosting (Lambda, RDS, CloudFront, SSM) | All Customer data as described in Section 1 | us-east-1 (N. Virginia), with CloudFront edge caching (no Customer data cached at edge) |
| **Google Cloud (Vertex AI / Gemini)** | AI-generated natural-language explanations of margin recommendations | Deal context attributes only: OEM, segment, product category, margin band, competitor count, deal registration type. **No customer names, account names, or exact dollar amounts are sent.** | Google Cloud US regions |

### 5.1 Sub-Processor Commitments

- MarginArc maintains Data Processing Agreements with all sub-processors.
- Both AWS and Google Cloud maintain SOC 2 Type II, ISO 27001, and other industry certifications.
- MarginArc will notify the Customer at least 30 days before engaging a new sub-processor that would process Customer data, providing the Customer an opportunity to object.

### 5.2 Data Sent to Gemini AI

When the AI explanation feature is invoked, the following data is sent to Google Gemini:

- Deal attributes: OEM vendor, product category, segment, deal registration type, competitor count, value-add level, solution complexity
- Scoring output: recommended margin range, win probability estimate, matched rule names
- **NOT sent:** Customer name, account name, opportunity name, exact dollar amounts, sales rep name, or any PII

The Gemini API is called in stateless mode. Google does not retain the prompt or response data beyond the duration of the API request, per the Vertex AI data processing terms.

---

## 6. Security Measures

MarginArc implements the following technical and organizational security measures:

### 6.1 Authentication and Access Control

- **Salesforce users:** Authenticated via native Salesforce session — no separate login required. MarginArc inherits the Customer's existing authentication controls (SSO, MFA, IP restrictions).
- **Admin portal:** Individual user accounts with bcrypt-hashed passwords (cost factor 12), JWT-based sessions (1-hour expiry), role-based access control (super_admin, admin, viewer), and JWT key rotation support.
- **Password policy:** Minimum 12 characters, requiring uppercase, lowercase, digit, and special character.
- **Rate limiting:** Applied to authentication endpoints and registration endpoints to prevent brute-force attacks.

### 6.2 Authorization

- **Salesforce FLS/CRUD enforcement:** The MarginArc Apex code checks field-level security and object-level permissions before every read and write, using `with sharing` enforcement.
- **Permission sets:** Three tiers — Fulcrum_Admin, Fulcrum_Manager, Fulcrum_User — controlling access to MarginArc features within the Customer's Salesforce org.
- **Admin portal RBAC:** Write operations (create/update/delete customers, licenses, admin users) require `super_admin` or `admin` role. Viewer role is read-only.

### 6.3 Data Protection

- **Parameterized SQL:** All database queries use parameterized statements to prevent SQL injection.
- **Input validation:** API inputs are validated using Zod schema validation. Sort columns are restricted to a whitelist to prevent injection through query parameters.
- **Audit logging:** All write operations in the admin portal are recorded with username, action, resource, IP address, and user agent.
- **OAuth token encryption:** AES-256-GCM application-layer encryption for stored Salesforce tokens.
- **Secrets management:** All credentials stored in AWS SSM Parameter Store with KMS encryption; no secrets in source code or environment variables (except the API key, which is a Lambda environment variable encrypted by AWS).

### 6.4 Network Security

- **HTTPS only:** All endpoints served over TLS 1.2+.
- **Database SSL:** PostgreSQL connections enforce SSL with certificate verification.
- **No public database access:** RDS instance is not publicly accessible; connections are restricted to the Lambda execution environment within the VPC.
- **CloudFront distribution:** Provides DDoS protection and edge termination of TLS.

---

## 7. Breach Notification

### 7.1 Notification Timeline

In the event of a confirmed personal data breach affecting Customer data, MarginArc will:

1. Notify the Customer without undue delay, and in any event **within 72 hours** of becoming aware of the breach, consistent with GDPR Article 33 requirements.
2. Provide a written incident report including:
   - Nature of the breach and categories of data affected
   - Approximate number of records affected
   - Description of measures taken to contain and remediate the breach
   - Contact information for MarginArc's incident response lead
3. Cooperate with the Customer's own breach notification obligations, including providing information necessary for the Customer to notify affected data subjects or supervisory authorities.

### 7.2 Incident Response

MarginArc maintains an incident response procedure that includes:

- Immediate containment (credential rotation, access revocation)
- Root cause analysis
- Remediation and verification
- Post-incident review and documentation

---

## 8. Network Data Sharing

### 8.1 Overview

MarginArc offers an optional network intelligence feature ("MarginArc Network") that pools anonymized deal data across participating, non-competing VARs to improve margin recommendation accuracy. **This feature is opt-in and requires explicit enrollment.**

### 8.2 Privacy Guarantees

If the Customer enrolls in the MarginArc Network, the following privacy guarantees apply (as documented in the MarginArc Network Design Document):

- **Anonymization:** All deal data is anonymized before contribution. Customer names, account names, exact dollar amounts, exact margins, and competitor names are stripped or hashed. Financial values are banded into ranges (e.g., "$50K-$100K").
- **Competitor firewalling:** Deals are never shared with VARs who were named as competitors on that deal. Competitor names are SHA-256 hashed and filtered at query time.
- **k-Anonymity:** A deal is only shared with the network if at least 5 other deals share the same quasi-identifier combination, preventing re-identification of unique deals.
- **Differential privacy:** Noise is applied to numeric values (achieved margin) before contribution, making it mathematically infeasible to recover exact values.
- **Temporal delay:** Deals are not shared until at least 30 days after close, preventing real-time competitive intelligence.
- **Contribution privacy:** No participant can determine how many VARs are in the network, which VARs are contributing, or how many deals any specific VAR has contributed.
- **Right to withdraw:** A Customer may withdraw from the network at any time. Contributed deals are hard-deleted within 72 hours of withdrawal.

### 8.3 Non-Participation

Customers who do not enroll in the MarginArc Network are not affected by it. No deal data is shared or contributed. The scoring engine operates solely on the Customer's own deal data and built-in sample data.

---

## 9. Customer Rights and Obligations

### 9.1 Customer Rights

The Customer retains:

- **Right of access:** The Customer may request an export of all data MarginArc holds about their organization at any time.
- **Right of deletion:** The Customer may request deletion of their data as described in Section 4.
- **Right to object to sub-processors:** The Customer may object to a new sub-processor per Section 5.1.
- **Right to audit:** The Customer may request evidence of MarginArc's security controls, including SOC 2 reports, penetration test summaries, and security questionnaire responses.

### 9.2 Controller Obligations

The Customer is responsible for:

- Ensuring that their use of MarginArc complies with applicable data protection laws.
- Configuring appropriate Salesforce permissions and field-level security.
- Securing their own Salesforce org credentials and admin portal accounts.
- Notifying MarginArc of any data subject requests that require MarginArc's assistance.

---

## 10. Governing Terms

This DPA is governed by the same jurisdiction and dispute resolution provisions as the Master Subscription Agreement. In the event of a conflict between this DPA and the Master Subscription Agreement, this DPA shall prevail with respect to data processing matters.

---

*This document is a template and should be reviewed by legal counsel before execution. For questions, contact security@marginarc.com.*
