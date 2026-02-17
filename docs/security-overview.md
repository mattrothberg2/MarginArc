# MarginArc Security Overview

**Version:** 1.0
**Date:** February 2026
**Audience:** Customer InfoSec teams, procurement reviewers, compliance auditors

This document describes the security architecture, controls, and practices of the MarginArc platform. It is intended to support security reviews during the procurement process.

---

## 1. Architecture

MarginArc is a two-tier application:

```
┌─────────────────────────────────────┐
│         Customer Salesforce Org     │
│                                     │
│  ┌───────────────────────────────┐  │
│  │  MarginArc Managed Package    │  │
│  │  (Apex + LWC, runs natively) │  │
│  └──────────────┬────────────────┘  │
└─────────────────┼───────────────────┘
                  │ HTTPS (TLS 1.2+)
                  │ Opportunity attributes only
                  ▼
┌─────────────────────────────────────┐
│         AWS (us-east-1)             │
│                                     │
│  ┌──────────┐   ┌───────────────┐   │
│  │ CloudFront│──▶│ AWS Lambda    │   │
│  │ (TLS)    │   │ (Node.js API) │   │
│  └──────────┘   └───────┬───────┘   │
│                         │            │
│              ┌──────────┼──────────┐ │
│              │          │          │ │
│              ▼          ▼          ▼ │
│         ┌────────┐ ┌───────┐ ┌─────┐│
│         │RDS     │ │SSM    │ │Gemini││
│         │(Pg+SSL)│ │Params │ │ AI  ││
│         └────────┘ └───────┘ └─────┘│
└─────────────────────────────────────┘
```

**Tier 1 — Salesforce Package:** An Apex and Lightning Web Component (LWC) managed package installed in the customer's Salesforce org. It runs natively within Salesforce, authenticated by the customer's own Salesforce session. No separate login is required.

**Tier 2 — AWS Lambda API:** A serverless API deployed on AWS Lambda behind Amazon CloudFront. Handles margin scoring, deal analytics, licensing, and an admin portal.

**Data flow principle:** Only deal-level attributes (OEM, cost, segment, product category, margin, stage, competitors) leave the Salesforce org. No contact records, email addresses, phone numbers, or customer PII are transmitted.

---

## 2. Authentication

### 2.1 Salesforce Users (Sales Reps, Managers)

MarginArc uses **native Salesforce authentication** exclusively. The managed package runs within the customer's org and inherits all authentication controls configured by the customer, including:

- Single sign-on (SSO)
- Multi-factor authentication (MFA)
- IP address restrictions
- Session timeout policies
- Login history and audit trail

There is no separate MarginArc login for end users.

### 2.2 API Authentication

Communication between the Salesforce package and the Lambda API is authenticated via a shared API key stored in:

- **Salesforce side:** `Fulcrum_Config__c` custom setting (protected, not visible to standard users)
- **Lambda side:** Lambda environment variable (encrypted by AWS at rest)

The API key is transmitted in the request header over TLS.

### 2.3 Admin Portal Authentication

The admin portal (used by MarginArc staff for license management) uses:

| Control | Implementation |
|---|---|
| Password hashing | bcrypt with cost factor 12 |
| Password policy | Minimum 12 characters; requires uppercase, lowercase, digit, and special character |
| Session tokens | JWT with 1-hour expiry |
| Key rotation | Dual-key JWT verification — supports rotation of the signing secret without invalidating active sessions |
| Role-based access | super_admin, admin, viewer roles |
| Audit logging | All login attempts (success and failure) and write operations are logged with username, IP address, and user agent |
| Failed login logging | Failed authentication attempts are logged to CloudWatch in structured JSON for alerting |

### 2.4 Documentation Portal Authentication

A separate docs portal for customer-facing documentation uses:

| Control | Implementation |
|---|---|
| Password hashing | bcrypt with cost factor 10 |
| Registration | Rate-limited (3 per hour per IP), free email domains blocked |
| Approval workflow | New users require admin approval before access is granted (auto-approved if email domain matches an active customer) |
| Session tokens | JWT with 8-hour expiry |

---

## 3. Authorization

### 3.1 Salesforce FLS/CRUD Enforcement

All Apex code in the MarginArc package enforces Salesforce's native security model:

- **`with sharing`** keyword on all Apex classes, ensuring record-level sharing rules are respected.
- **Field-Level Security (FLS)** checks before reading or writing any field.
- **CRUD permission** checks before DML operations.

### 3.2 Permission Sets

MarginArc ships three permission sets controlling feature access within the customer's org:

| Permission Set | Access Level |
|---|---|
| `Fulcrum_Admin` | Full access: configure settings, manage OEM/competitor records, view all dashboards |
| `Fulcrum_Manager` | Dashboard access: view team pipeline, KPIs, compliance cohorts, competitive performance |
| `Fulcrum_User` | Rep-level access: score deals, view own deal history and recommendations |

Customers assign permission sets to their users according to their own access policies.

### 3.3 Admin Portal RBAC

| Role | Permissions |
|---|---|
| `super_admin` | Full access: manage customers, licenses, admin users, settings |
| `admin` | Manage customers and licenses; cannot manage other admin users |
| `viewer` | Read-only access to all resources |

Write operations (POST, PUT, DELETE) enforce role checks at the route level. Self-deletion of admin accounts is explicitly blocked.

---

## 4. Encryption

### 4.1 In Transit

| Path | Protocol |
|---|---|
| Salesforce package to Lambda API | HTTPS (TLS 1.2+) |
| Lambda to RDS PostgreSQL | SSL with certificate verification (`rejectUnauthorized: true`) |
| Admin portal (browser to CloudFront) | HTTPS (TLS 1.2+) |
| Lambda to AWS SSM Parameter Store | HTTPS (AWS SDK, TLS 1.2+) |
| Lambda to Google Gemini API | HTTPS (TLS 1.2+) |

### 4.2 At Rest

| Data | Encryption Method |
|---|---|
| PostgreSQL database (all tables) | AWS KMS via RDS encryption (AES-256) |
| Salesforce OAuth tokens (access + refresh) | Application-layer AES-256-GCM encryption before database storage |
| Secrets (DB credentials, JWT secret, admin password) | AWS SSM Parameter Store SecureString (AWS KMS) |
| Lambda environment variables | AWS Lambda environment encryption (AWS KMS) |

OAuth tokens receive double encryption: AES-256-GCM at the application layer, plus AES-256 at the RDS storage layer.

---

## 5. Data Handling

### 5.1 Data Sent to the API

When a user scores a deal, the Salesforce package sends the following to the Lambda API:

- **Sent:** OEM vendor, product category, segment, OEM cost, margin, deal registration type, competitor count, value-add level, solution complexity, relationship strength, deal urgency, customer tech sophistication, customer price sensitivity, account industry, BOM line items (if applicable)
- **Not sent:** Contact names, email addresses, phone numbers, customer PII, attachment content

### 5.2 Data Stored (Persistent)

When a user explicitly saves a deal, the following is persisted in the `recorded_deals` table:

- Deal attributes (as listed above)
- Account name and opportunity owner name (for dashboard display)
- Scoring results (recommended margin, win probability, matched rules)
- Timestamp and Salesforce org identifier

### 5.3 Ephemeral Data

Scoring requests that are not saved are **not persisted**. The API processes the request, returns the scoring result, and discards all input data. No logs of deal content are retained for ephemeral requests.

### 5.4 Data Sent to Gemini AI

When the AI explanation feature is invoked, a subset of deal context is sent to Google Gemini:

- Deal attributes: OEM, segment, product category, deal registration type, competitor count
- Scoring output: margin range, win probability, rule names
- **Excluded:** Customer name, account name, exact dollar amounts, sales rep name

Google Gemini processes this as a stateless API call and does not retain the data.

---

## 6. Compliance

| Item | Status |
|---|---|
| SOC 2 Type I | In progress (target completion: 2026) |
| Data Processing Agreement (DPA) | Available — see `docs/data-processing-agreement.md` |
| GDPR readiness | Data minimization, 72-hour breach notification, right to deletion, sub-processor transparency |
| Penetration testing | Planned; engagement to be conducted by a third-party firm |
| Vulnerability disclosure | Contact security@marginarc.com |

MarginArc's sub-processors (AWS and Google Cloud) maintain SOC 2 Type II, ISO 27001, and other industry certifications.

---

## 7. Network Security

### 7.1 VPC and Network Isolation

- The RDS PostgreSQL instance runs within an AWS VPC and is **not publicly accessible**.
- Database connections are restricted to the Lambda execution environment via security groups.
- No SSH or direct database access is available from the public internet.

### 7.2 CloudFront

- Amazon CloudFront provides edge termination of TLS connections and DDoS mitigation.
- CloudFront is configured to require HTTPS; HTTP requests are redirected.
- Only the Lambda origin is configured — no customer data is cached at CloudFront edge locations.

### 7.3 DNS and Certificates

- The API endpoint (`api.marginarc.com`) is served via CloudFront with an AWS Certificate Manager (ACM) TLS certificate.
- Certificate renewal is automatic via ACM.

---

## 8. Monitoring and Audit Trail

### 8.1 Application Logging

- All API requests are logged via CloudWatch Logs, including request path, response status, and latency.
- Database query execution times are logged for performance monitoring.
- Sensitive data (passwords, tokens, deal content) is **not** included in logs.

### 8.2 Admin Audit Trail

Every write operation in the admin portal generates an audit log entry containing:

| Field | Description |
|---|---|
| `admin_user` | Username of the admin who performed the action |
| `action` | Operation type (create, update, delete, revoke, renew, login, etc.) |
| `resource_type` | Target resource (customers, licenses, admin_users, settings, etc.) |
| `resource_id` | Identifier of the affected record |
| `details` | JSON object with operation-specific context |
| `ip_address` | Originating IP address |
| `user_agent` | Browser/client user agent string |
| `created_at` | Timestamp of the event |

Audit logs are retained for 24 months and are available to MarginArc administrators for compliance reviews.

### 8.3 Authentication Monitoring

- Failed login attempts are logged in structured JSON format to CloudWatch, including username, IP address, user agent, and timestamp.
- These logs can be used to configure CloudWatch Alarms for brute-force detection.

### 8.4 Rate Limiting

- Admin portal authentication endpoints are rate-limited.
- Documentation portal registration is limited to 3 attempts per hour per IP address.
- API scoring endpoints include request validation to reject malformed payloads.

---

## 9. Vulnerability Management

### 9.1 Dependency Management

- Server-side dependencies are managed via npm with `package-lock.json` for reproducible builds.
- Production deployments use `npm install --production` to exclude development dependencies from the deployed artifact.

### 9.2 CI/CD Pipeline

- Salesforce package deployments are automated via GitHub Actions on push to `main`, gated by successful deployment validation against the target org.
- Lambda deployments are performed via a controlled manual process (zip archive + AWS CLI) with version tagging.

### 9.3 Secure Coding Practices

| Practice | Implementation |
|---|---|
| SQL injection prevention | All queries use parameterized statements (`$1, $2, ...`); no string concatenation in SQL |
| Input validation | Zod schema validation on API inputs; sort column whitelisting |
| XSS prevention | LWC framework provides built-in output encoding; admin portal served as a compiled SPA |
| CSRF protection | API uses Bearer token authentication (not cookies), inherently resistant to CSRF |
| Secret management | No hardcoded secrets; all credentials in SSM Parameter Store or Lambda environment variables |
| Soft deletion | Customer and license records are soft-deleted (status change), preserving audit trails |
| Error handling | Generic error messages returned to clients; detailed errors logged server-side only |

### 9.4 Planned Improvements

The following security enhancements are on the near-term roadmap:

| Item | Status |
|---|---|
| MFA on admin portal | Planned |
| API key rotation mechanism | Planned |
| Security headers (helmet middleware) | In progress |
| Third-party penetration test | Planned |

---

## 10. Incident Response

MarginArc maintains an incident response procedure covering:

1. **Detection:** CloudWatch monitoring, audit log review, and dependency vulnerability alerts.
2. **Containment:** Credential rotation, access revocation, and service isolation as appropriate.
3. **Notification:** Customer notification within 72 hours of a confirmed breach affecting their data.
4. **Remediation:** Root cause analysis, patch deployment, and verification.
5. **Post-incident review:** Documentation and process improvement.

---

## 11. Contact

For security questions, vulnerability reports, or to request a security questionnaire response:

- **Email:** security@marginarc.com
- **DPA requests:** Available upon request; see `docs/data-processing-agreement.md`
- **SOC 2 report:** Available upon completion of the Type I audit

---

*This document is maintained by the MarginArc engineering team and updated as security controls evolve. Last reviewed: February 2026.*
