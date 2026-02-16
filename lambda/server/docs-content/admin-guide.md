# MarginArc Admin Guide

## Table of Contents

1. [Overview](#1-overview)
2. [Initial Setup](#2-initial-setup)
3. [Security Configuration](#3-security-configuration)
4. [OEM Configuration](#4-oem-configuration)
5. [Competitor Configuration](#5-competitor-configuration)
6. [Account Setup](#6-account-setup)
7. [User Training](#7-user-training)
8. [Monitoring and Reporting](#8-monitoring-and-reporting)
9. [Maintenance](#9-maintenance)
10. [Troubleshooting](#10-troubleshooting)

---

## 1. Overview

### Admin Responsibilities

As a Salesforce admin or Sales Ops lead, you are responsible for the following MarginArc-related activities:

| Responsibility                       | Frequency                 | Effort                                |
| ------------------------------------ | ------------------------- | ------------------------------------- |
| Initial deployment and configuration | One-time                  | 2-3 days                              |
| Field-level security and permissions | One-time + as needed      | 1-2 hours                             |
| OEM record management                | Quarterly review          | 1-2 hours/quarter                     |
| Competitor record management         | Quarterly review          | 1-2 hours/quarter                     |
| Account segment/relationship setup   | One-time + ongoing        | 2-4 hours initial, 15 min/new account |
| User training                        | One-time + new hires      | 45 min/session                        |
| Reporting and dashboards             | One-time + monthly review | 4-6 hours initial, 30 min/month       |
| Troubleshooting                      | As needed                 | Varies                                |

### What MarginArc Manages Automatically

You do **not** need to manage these -- MarginArc handles them:

- ML model training and updates
- Win probability calculations
- Deal Score computations
- AI analysis generation (Gemini integration)
- Network intelligence aggregation
- Signal processing and feature engineering
- API endpoint availability and performance
- Historical pattern analysis

### What You Manage

- Salesforce component deployment (LWC, Apex, custom fields, custom objects)
- Field-level security and user permissions
- OEM reference data (base margins, boosts)
- Competitor reference data (profiles, strategies)
- Account-level classifications (segment, relationship)
- Page layout configuration
- CSP and Remote Site settings
- User training and enablement
- Reporting and monitoring

---

## 2. Initial Setup

### 2a. Package Installation (Component Deployment)

MarginArc is deployed as a set of Salesforce metadata components, not a managed package. This gives you full visibility and control over all code and configuration.

#### Components Included

| Type                         | Components                                                                                |
| ---------------------------- | ----------------------------------------------------------------------------------------- |
| **Lightning Web Components** | `fulcrumMarginAdvisor`, `fulcrumBomTable`, `fulcrumDealInsights`, `fulcrumWhatIf`, `fulcrumCompetitiveIntel`, `fulcrumManagerDashboard`, `fulcrumPoolConfig` |
| **Apex Classes**             | `FulcrumController`, `FulcrumCompetitiveController`, `FulcrumManagerController`, `FulcrumBatchAnalyzer` + 4 test classes (43 methods) |
| **Custom Fields**            | 22 fields on Opportunity (all prefixed with `Fulcrum_`)                                   |
| **Custom Objects**           | `Fulcrum_OEM__c`, `Fulcrum_Competitor__c`                                                 |
| **Static Resources**         | CSS, icons, chart libraries                                                               |

#### Deployment Command

Using Salesforce CLI from the project root:

```bash
SF_USE_GENERIC_UNIX_KEYCHAIN=true sf project deploy start --target-org <your-org-alias>
```

Verify deployment:

```bash
SF_USE_GENERIC_UNIX_KEYCHAIN=true sf project deploy report --target-org <your-org-alias>
```

#### Post-Deployment Verification

1. Navigate to **Setup > Object Manager > Opportunity > Fields & Relationships**. Confirm all 22 MarginArc fields are present (see field list in section 2b).
2. Navigate to **Setup > Object Manager** and confirm `Fulcrum_OEM__c` and `Fulcrum_Competitor__c` objects exist.
3. Open the Developer Console and verify the Apex classes compiled without errors.
4. Navigate to any Opportunity record and confirm the Lightning page editor shows the four MarginArc LWC components available for placement.

### 2b. Custom Field Verification

Verify all 22 custom fields exist on the Opportunity object with the correct types:

| API Name                           | Label                  | Type                     | Values / Notes                                                    |
| ---------------------------------- | ---------------------- | ------------------------ | ----------------------------------------------------------------- |
| `Fulcrum_AI_Confidence__c`         | AI Confidence          | Percent                  | Written by Apply Recommendation                                   |
| `Fulcrum_Competitor_Names__c`      | Competitor Names       | Multi-Select Picklist    | CDW, SHI, Insight, Connection, Presidio, WWT, Zones, Trace3, etc. |
| `Fulcrum_Competitors__c`           | Competitors            | Picklist                 | 0, 1, 2, 3+                                                       |
| `Fulcrum_Cost__c`                  | Cost                   | Currency                 | Deal cost basis                                                   |
| `Fulcrum_Customer_Segment__c`      | Customer Segment       | Picklist                 | SMB, Mid-Market, Enterprise, Public Sector                        |
| `Fulcrum_Deal_Reg_Type__c`         | Deal Registration Type | Picklist                 | NotRegistered, Standard, PremiumHunting                           |
| `Fulcrum_Deal_Type__c`             | Deal Type              | Text                     | Displacement indicator                                            |
| `Fulcrum_GP_Percent__c`            | GP Percent             | Percent                  | Calculated gross profit %                                         |
| `Fulcrum_Loss_Reason__c`           | Loss Reason            | Text                     | Populated on closed-lost deals                                    |
| `Fulcrum_Margin__c`                | Margin (Deal Score)    | Number                   | 0-100 composite score                                             |
| `Fulcrum_OEM__c`                   | OEM                    | Lookup(Fulcrum_OEM\_\_c) | Reference to OEM record                                           |
| `Fulcrum_OEM_Cost__c`              | OEM Cost               | Currency                 | OEM-specific cost                                                 |
| `Fulcrum_Planned_Margin__c`        | Planned Margin         | Percent                  | Rep's intended margin                                             |
| `Fulcrum_Product_Category__c`      | Product Category       | Picklist                 | Category classification                                           |
| `Fulcrum_Quarter_End__c`           | Quarter End            | Checkbox                 | True if deal closes in quarter's last 2 weeks                     |
| `Fulcrum_Recommended_Margin__c`    | Recommended Margin     | Percent                  | Written by Apply Recommendation                                   |
| `Fulcrum_Relationship_Strength__c` | Relationship Strength  | Picklist                 | New, Developing, Good, Strategic                                  |
| `Fulcrum_Revenue__c`               | Revenue                | Currency                 | Expected revenue                                                  |
| `Fulcrum_Services_Attached__c`     | Services Attached      | Checkbox                 | True if services included                                         |
| `Fulcrum_Solution_Complexity__c`   | Solution Complexity    | Picklist                 | Single, Multi-vendor                                              |
| `Fulcrum_Value_Add__c`             | Value Add              | Picklist                 | Low, Medium, High                                                 |
| `Fulcrum_Win_Probability__c`       | Win Probability        | Percent                  | Written by Apply Recommendation                                   |

### 2c. Custom Object Setup

#### Fulcrum_OEM\_\_c (OEM Configuration)

This object stores vendor-specific configuration data used by the recommendation engine.

| Field               | Type      | Purpose                                            |
| ------------------- | --------- | -------------------------------------------------- |
| Name                | Text      | OEM vendor name (e.g., "Cisco")                    |
| Base_Margin\_\_c    | Percent   | Industry-standard base margin for this OEM         |
| Deal_Reg_Boost\_\_c | Percent   | Additional margin when deal registration is active |
| Services_Boost\_\_c | Percent   | Additional margin when services are attached       |
| Margin_Floor\_\_c   | Percent   | Minimum viable margin for this OEM                 |
| Margin_Ceiling\_\_c | Percent   | Maximum realistic margin for this OEM              |
| Notes\_\_c          | Long Text | Admin notes about this OEM's pricing dynamics      |

#### Fulcrum_Competitor\_\_c (Competitor Configuration)

This object stores competitor profile data used by the competitive intelligence engine.

| Field                    | Type      | Purpose                                    |
| ------------------------ | --------- | ------------------------------------------ |
| Name                     | Text      | Competitor company name                    |
| Price_Aggression\_\_c    | Number    | 1-10 scale of price aggressiveness         |
| Primary_Strategy\_\_c    | Text      | How this competitor typically competes     |
| Geographic_Strength\_\_c | Text      | Regions where this competitor is strongest |
| Vertical_Focus\_\_c      | Text      | Industries this competitor targets         |
| Tactics\_\_c             | Long Text | Known competitive tactics and patterns     |
| Active\_\_c              | Checkbox  | Whether to include in intelligence queries |

### 2d. Page Layout Configuration

Add the four MarginArc LWC widgets to the Opportunity Lightning Record Page.

#### Steps

1. Navigate to any Opportunity record.
2. Click the **gear icon** in the top-right corner, then select **Edit Page** (this opens Lightning App Builder).
3. In the component palette on the left, search for "fulcrum".
4. You will see four custom components:
   - `fulcrumMarginAdvisor`
   - `fulcrumDealInsights`
   - `fulcrumWhatIf`
   - `fulcrumCompetitiveIntel`
5. Drag each component to the desired position on the page.

#### Recommended Layout

For a standard two-column Opportunity page:

| Position                            | Component                                                                          |
| ----------------------------------- | ---------------------------------------------------------------------------------- |
| Main column, below standard details | `fulcrumMarginAdvisor` (this is the primary widget -- give it prominent placement) |
| Main column, below Margin Advisor   | `fulcrumWhatIf`                                                                    |
| Right sidebar or second tab         | `fulcrumDealInsights`                                                              |
| Right sidebar or second tab         | `fulcrumCompetitiveIntel`                                                          |

Alternatively, use a **tabbed layout** with MarginArc as its own tab:

- Tab 1: Details (standard Opportunity fields)
- Tab 2: MarginArc (all four widgets stacked vertically)
- Tab 3: Activity
- Tab 4: Related

6. Click **Save** and then **Activate** the page.
7. Choose **Assign as Org Default** or assign to specific apps/profiles as needed.

### 2e. CSP Trusted Sites

MarginArc's LWC components make client-side API calls to the MarginArc intelligence engine. You must add the API endpoint as a CSP Trusted Site.

#### Steps

1. Navigate to **Setup > Security > CSP Trusted Sites**.
2. Click **New Trusted Site**.
3. Enter the following:
   - **Trusted Site Name:** `Fulcrum_API`
   - **Trusted Site URL:** `https://api.marginarc.com`
   - **Context:** Select `All` (or at minimum: `Connect src`, `Script src`, `Fetch`)
   - **Active:** Checked
4. Click **Save**.

### 2f. Remote Site Settings

The AI analysis feature uses Google's Gemini API. Add it as a Remote Site.

#### Steps

1. Navigate to **Setup > Security > Remote Site Settings**.
2. Click **New Remote Site**.
3. Enter the following:
   - **Remote Site Name:** `Gemini_API`
   - **Remote Site URL:** `https://generativelanguage.googleapis.com`
   - **Description:** `Google Gemini API for MarginArc AI analysis`
   - **Active:** Checked
4. Click **Save**.

---

## 3. Security Configuration

### 3a. Field-Level Security

Different user profiles require different levels of access to MarginArc fields.

#### Sales Rep Profile

| Field                              | Read | Edit                |
| ---------------------------------- | ---- | ------------------- |
| Fulcrum_AI_Confidence\_\_c         | Yes  | No (system-written) |
| Fulcrum_Competitor_Names\_\_c      | Yes  | Yes                 |
| Fulcrum_Competitors\_\_c           | Yes  | Yes                 |
| Fulcrum_Cost\_\_c                  | Yes  | Yes                 |
| Fulcrum_Customer_Segment\_\_c      | Yes  | No (admin-set)      |
| Fulcrum_Deal_Reg_Type\_\_c         | Yes  | Yes                 |
| Fulcrum_Deal_Type\_\_c             | Yes  | Yes                 |
| Fulcrum_GP_Percent\_\_c            | Yes  | No (calculated)     |
| Fulcrum_Loss_Reason\_\_c           | Yes  | Yes                 |
| Fulcrum_Margin\_\_c                | Yes  | No (system-written) |
| Fulcrum_OEM\_\_c                   | Yes  | Yes                 |
| Fulcrum_OEM_Cost\_\_c              | Yes  | Yes                 |
| Fulcrum_Planned_Margin\_\_c        | Yes  | Yes                 |
| Fulcrum_Product_Category\_\_c      | Yes  | Yes                 |
| Fulcrum_Quarter_End\_\_c           | Yes  | Yes                 |
| Fulcrum_Recommended_Margin\_\_c    | Yes  | No (system-written) |
| Fulcrum_Relationship_Strength\_\_c | Yes  | No (admin-set)      |
| Fulcrum_Revenue\_\_c               | Yes  | Yes                 |
| Fulcrum_Services_Attached\_\_c     | Yes  | Yes                 |
| Fulcrum_Solution_Complexity\_\_c   | Yes  | Yes                 |
| Fulcrum_Value_Add\_\_c             | Yes  | Yes                 |
| Fulcrum_Win_Probability\_\_c       | Yes  | No (system-written) |

#### Sales Manager Profile

Same as Sales Rep, plus:

- Edit access on `Fulcrum_Customer_Segment__c` and `Fulcrum_Relationship_Strength__c`
- Full access to OEM and Competitor custom objects (for reference, not configuration)

#### Sales Ops / Admin Profile

Full read/write on all MarginArc fields and custom objects.

#### Configuration Steps

1. Navigate to **Setup > Object Manager > Opportunity > Fields & Relationships**.
2. Click on each MarginArc field.
3. Click **Set Field-Level Security**.
4. Set Visible and Read-Only checkboxes per the tables above for each profile.
5. Click **Save**.

Repeat for `Fulcrum_OEM__c` and `Fulcrum_Competitor__c` object fields.

### 3b. Permission Sets

Create dedicated permission sets for cleaner management:

#### Fulcrum_User Permission Set

- **Description:** Standard MarginArc access for sales reps
- **Object Permissions:** Read access on `Fulcrum_OEM__c`, `Fulcrum_Competitor__c`
- **Field Permissions:** Per Sales Rep table above
- **Custom Permissions:** None required

#### Fulcrum_Manager Permission Set

- **Description:** Enhanced MarginArc access for sales managers
- **Object Permissions:** Read access on `Fulcrum_OEM__c`, `Fulcrum_Competitor__c`
- **Field Permissions:** Per Sales Manager table above
- **Custom Permissions:** None required

#### Fulcrum_Admin Permission Set

- **Description:** Full MarginArc administration access
- **Object Permissions:** Full CRUD on `Fulcrum_OEM__c`, `Fulcrum_Competitor__c`
- **Field Permissions:** Full read/write on all MarginArc fields
- **Custom Permissions:** None required

#### Assignment

Assign permission sets to users:

1. Navigate to **Setup > Users > Permission Sets**.
2. Click the appropriate permission set.
3. Click **Manage Assignments > Add Assignments**.
4. Select users and click **Assign**.

### 3c. Sharing Rules

#### Opportunity Sharing

MarginArc operates within Salesforce's standard sharing model. Ensure the following:

- Reps can read their own Opportunities (standard behavior).
- Managers can read their team's Opportunities (role hierarchy or sharing rules).
- The Competitive Intel widget aggregates data from closed deals visible to the current user's sharing scope.

#### Competitive Intelligence Visibility

For competitive intelligence to be most valuable, users should be able to see aggregate win/loss data across the organization, not just their own deals. Consider:

- Setting `Fulcrum_Competitor__c` OWD (org-wide default) to **Public Read Only**.
- Setting `Fulcrum_OEM__c` OWD to **Public Read Only**.
- Ensuring Opportunity sharing allows competitive data aggregation at the desired scope (team, division, or company-wide).

If your organization requires restricted competitive data visibility, work with MarginArc support to configure appropriate data boundaries.

### 3d. API Access

MarginArc LWC components make fetch calls to the external API. Ensure:

1. **User profiles have API access enabled.** Under the profile settings, confirm "API Enabled" is checked. This is typically enabled by default for standard Sales profiles.
2. **Session settings allow API calls.** Navigate to **Setup > Session Settings** and verify that session security settings do not block Lightning component API calls.
3. **CSP Trusted Sites are configured** (see section 2e).
4. **No IP restrictions** block outbound calls from Salesforce to `api.marginarc.com`.

---

## 4. OEM Configuration

### 4a. Managing Fulcrum_OEM\_\_c Records

OEM records are the foundation of MarginArc's margin recommendations. Each record represents a technology vendor and contains the pricing parameters the model uses as baseline inputs.

#### Viewing OEM Records

1. Navigate to **App Launcher** (the 9-dot grid icon).
2. Search for "MarginArc OEMs" or navigate to the `Fulcrum_OEM__c` tab.
3. Select the list view "All MarginArc OEMs".

#### Creating an OEM Record

1. Click **New**.
2. Fill in all fields:
   - **Name:** The vendor name exactly as it should appear in the OEM lookup field (e.g., "Cisco").
   - **Base Margin:** The industry-standard margin for this OEM's products (e.g., 15%).
   - **Deal Reg Boost:** The typical margin uplift when deal registration is active (e.g., 5%).
   - **Services Boost:** The typical margin uplift when services are attached (e.g., 3%).
   - **Margin Floor:** The minimum realistic margin for deals with this OEM (e.g., 5%).
   - **Margin Ceiling:** The maximum realistic margin for deals with this OEM (e.g., 35%).
   - **Notes:** Any relevant context about this OEM's pricing dynamics.
3. Click **Save**.

#### Editing an OEM Record

Click into the OEM record and update fields as needed. Changes take effect on the next scoring event for any Opportunity using this OEM.

### 4b. Adding New OEM Vendors

When your organization begins selling a new vendor's products:

1. Create the `Fulcrum_OEM__c` record with the best available margin data.
2. If the OEM lookup picklist on Opportunity is a custom picklist (not a lookup), add the new value.
3. Update the Deal Insights configuration if OEM-specific tips are applicable.
4. Communicate the addition to the sales team.

#### Sourcing Margin Data for New OEMs

- Check the vendor's partner portal for published margin guidelines.
- Analyze historical deals with this vendor (if any exist).
- Consult with your purchasing/procurement team.
- Use industry benchmarks from peer VARs (MarginArc network intelligence will refine over time).

### 4c. Updating Base Margins, Deal Reg Boosts, Services Boosts

OEM pricing changes over time. Review and update these values quarterly.

#### When to Update

- OEM announces new partner program terms.
- You observe a sustained shift in achievable margins (up or down) for a vendor.
- New deal registration programs are introduced or existing ones are modified.
- Services margin structures change.

#### How to Update

1. Open the `Fulcrum_OEM__c` record.
2. Update the relevant fields.
3. Add a note in the Notes field documenting the change and reason (e.g., "Updated Base Margin from 15% to 13% per Cisco FY26 partner program changes - Feb 2026").
4. Save.

Changes propagate immediately to the next scoring event. Historical scores are not retroactively recalculated.

### 4d. Sample OEM Records

Use these as starting points and adjust based on your organization's actual experience:

| OEM                | Base Margin | Deal Reg Boost | Services Boost | Floor | Ceiling |
| ------------------ | ----------- | -------------- | -------------- | ----- | ------- |
| Cisco              | 14%         | 6%             | 3%             | 4%    | 30%     |
| Palo Alto Networks | 18%         | 5%             | 4%             | 8%    | 35%     |
| HPE                | 12%         | 5%             | 3%             | 3%    | 28%     |
| Dell Technologies  | 10%         | 4%             | 3%             | 2%    | 25%     |
| Fortinet           | 20%         | 5%             | 4%             | 10%   | 38%     |
| VMware             | 16%         | 4%             | 3%             | 6%    | 32%     |
| Microsoft          | 8%          | 3%             | 4%             | 2%    | 22%     |
| Juniper Networks   | 16%         | 5%             | 3%             | 6%    | 30%     |
| Aruba              | 15%         | 5%             | 3%             | 5%    | 28%     |
| NetApp             | 18%         | 6%             | 4%             | 8%    | 35%     |

These figures represent typical IT VAR channel margins. Your actual margins may vary based on partner tier, volume commitments, and regional pricing.

---

## 5. Competitor Configuration

### 5a. Managing Fulcrum_Competitor\_\_c Records

Competitor records power the Competitive Intelligence widget and influence margin recommendations when competitors are identified on a deal.

#### Viewing Competitor Records

1. Navigate to **App Launcher**.
2. Search for "MarginArc Competitors" or navigate to the `Fulcrum_Competitor__c` tab.
3. Select the list view "All MarginArc Competitors".

#### Creating a Competitor Record

1. Click **New**.
2. Fill in all fields:
   - **Name:** Competitor company name (e.g., "CDW").
   - **Price Aggression:** 1-10 scale (1 = value-focused, 10 = extremely price-aggressive).
   - **Primary Strategy:** One-line description of how they typically compete.
   - **Geographic Strength:** Regions where they are strongest.
   - **Vertical Focus:** Industries they target most.
   - **Tactics:** Detailed notes on competitive patterns and known behaviors.
   - **Active:** Check to include in intelligence queries.
3. Click **Save**.

### 5b. Adding Competitor Profiles

When a new competitor is encountered:

1. Create the `Fulcrum_Competitor__c` record.
2. Add the competitor name to the `Fulcrum_Competitor_Names__c` multi-select picklist (see section 5d).
3. Gather initial intelligence from reps who have encountered this competitor.
4. Set an initial Price Aggression score based on available data.

#### Intelligence Gathering Tips

- Debrief with reps after wins and losses against this competitor.
- Check industry analyst reports.
- Review publicly available pricing information.
- Monitor partner community forums.
- Track over time and refine as data accumulates.

### 5c. Updating Price Aggression Scores and Strategies

Review competitor profiles quarterly and update based on recent competitive encounters.

#### Price Aggression Scale Guide

| Score | Description                                              | Example                                 |
| ----- | -------------------------------------------------------- | --------------------------------------- |
| 1-2   | Value-focused; rarely competes on price                  | Boutique VARs with deep specialization  |
| 3-4   | Moderate; price-competitive but not aggressive           | Mid-market VARs with good relationships |
| 5-6   | Competitive; will match or slightly undercut             | Large national VARs (standard behavior) |
| 7-8   | Aggressive; frequently leads with price                  | VARs using loss-leader strategies       |
| 9-10  | Extremely aggressive; will price at or below cost to win | VARs in market-share acquisition mode   |

#### Updating Strategy Fields

When updating competitor strategies, focus on actionable intelligence:

**Good example:**

> "CDW leads with price on commodity deals but struggles with complex multi-vendor solutions. Counter by emphasizing integration expertise and post-sale support. They are weakest in Q1 when their fiscal year resets."

**Poor example:**

> "CDW is a competitor."

The strategy field is displayed to reps in the Competitive Intel widget. Write it for a sales audience.

### 5d. Multi-Select Picklist Maintenance

The `Fulcrum_Competitor_Names__c` field on Opportunity is a multi-select picklist. Its values must be maintained manually.

#### Adding a New Picklist Value

1. Navigate to **Setup > Object Manager > Opportunity > Fields & Relationships**.
2. Click on `Fulcrum_Competitor_Names__c`.
3. Scroll to the **Values** section.
4. Click **New**.
5. Enter the competitor name exactly as it appears in the `Fulcrum_Competitor__c` record Name field.
6. Click **Save**.

#### Deactivating a Picklist Value

If a competitor is acquired, goes out of business, or is no longer relevant:

1. Navigate to the picklist field settings.
2. Click **Deactivate** next to the value (do not delete -- this preserves historical data).
3. Set the `Active__c` checkbox to false on the corresponding `Fulcrum_Competitor__c` record.

#### Naming Consistency

The competitor name in the multi-select picklist **must match** the Name field on the `Fulcrum_Competitor__c` record exactly. If they do not match, the Competitive Intel widget will not be able to correlate deal data with competitor profiles. Use the same casing, spacing, and abbreviations.

---

## 6. Account Setup

### 6a. Setting Customer Segment per Account

Customer Segment is an account-level classification that influences margin recommendations. It should be set once per account and reviewed periodically.

#### Segment Definitions

| Segment           | Typical Characteristics                                                       | Margin Implication                         |
| ----------------- | ----------------------------------------------------------------------------- | ------------------------------------------ |
| **SMB**           | <500 employees, <$1M annual IT spend, price-sensitive, simpler requirements   | Lower margins; more price competition      |
| **Mid-Market**    | 500-5,000 employees, $1M-$10M IT spend, moderate complexity                   | Moderate margins; balanced value/price     |
| **Enterprise**    | 5,000+ employees, $10M+ IT spend, complex requirements, procurement processes | Higher margins; value-focused buying       |
| **Public Sector** | Government, education, healthcare; formal procurement, contract vehicles      | Variable margins; often contract-dependent |

#### Bulk Update Guide

For initial setup, you likely need to classify hundreds or thousands of accounts. Use Data Loader or a similar tool:

1. **Export accounts:**

   ```
   SELECT Id, Name, NumberOfEmployees, AnnualRevenue, Industry FROM Account WHERE Fulcrum_Customer_Segment__c = null
   ```

2. **Classify in a spreadsheet:**
   - Use employee count and annual revenue as primary classifiers.
   - Apply overrides for known accounts.
   - Save as CSV with columns: `Id`, `Fulcrum_Customer_Segment__c`.

3. **Import with Data Loader:**
   - Open Salesforce Data Loader.
   - Select **Update** operation.
   - Choose the Account object.
   - Map `Id` and `Fulcrum_Customer_Segment__c`.
   - Execute the update.

4. **Verify:** Run a report to confirm segment distribution looks reasonable.

#### Ongoing Maintenance

- Classify new accounts at creation (consider adding to your account creation flow or validation rule).
- Review segment assignments annually or when accounts undergo significant changes (acquisition, growth, restructuring).

### 6b. Setting Relationship Strength per Account

Relationship Strength captures the depth of your organization's relationship with the customer. This is a subjective assessment but should be grounded in observable indicators.

#### Strength Definitions

| Strength       | Indicators                                                                  | Margin Implication                     |
| -------------- | --------------------------------------------------------------------------- | -------------------------------------- |
| **New**        | First engagement, no history, no established contacts                       | Lowest margin support; must earn trust |
| **Developing** | 1-3 closed deals, some contacts, early-stage relationship                   | Modest margin support                  |
| **Good**       | 4-10 closed deals, reliable contacts, repeat business, invited to RFPs      | Solid margin support                   |
| **Strategic**  | 10+ deals, executive relationships, preferred vendor status, joint planning | Strongest margin support               |

#### Setting Relationship Strength

Option 1: **Manual per account**

- Open the Account record.
- Set the `Fulcrum_Relationship_Strength__c` picklist value.
- Save.

Option 2: **Bulk update using deal count logic**

```sql
SELECT Id, Name,
  (SELECT COUNT() FROM Opportunities WHERE StageName = 'Closed Won') as WonCount
FROM Account
```

Apply classification:

- 0 won deals: New
- 1-3 won deals: Developing
- 4-10 won deals: Good
- 10+ won deals: Strategic

Then bulk update via Data Loader as described above.

#### Best Practices

- Let the account owner validate the classification -- the rep often knows the relationship better than the data shows.
- Review quarterly during account planning sessions.
- Do not inflate relationship strength -- the model uses this to adjust margin recommendations upward, so overclassifying leads to overly aggressive pricing suggestions.

### 6c. Segment Classification Best Practices

1. **Use consistent criteria.** Define your segment boundaries clearly (e.g., "Enterprise = 5,000+ employees OR $50M+ revenue") and apply them uniformly.
2. **Account for industry variations.** A 1,000-person law firm may buy like an Enterprise customer. Use your judgment.
3. **Err toward the lower segment when uncertain.** It is better to recommend a slightly lower margin than to recommend an unrealistically high one.
4. **Document your criteria.** Write down your classification rules so they can be applied consistently by anyone on the team.
5. **Review the distribution.** After bulk classification, check: does the segment distribution match your business reality? If 90% of accounts are "Enterprise," your criteria may be too loose.

---

## 7. User Training

### 7a. Training Session Outline (45 Minutes)

#### Agenda

| Time      | Topic        | Activities                                                    |
| --------- | ------------ | ------------------------------------------------------------- |
| 0-5 min   | Introduction | What is MarginArc, why we are using it, what it does for reps   |
| 5-15 min  | Live Demo    | Score a real deal, walk through results, explain each section |
| 15-25 min | Hands-On     | Each participant scores one of their own deals                |
| 25-35 min | Deep Dive    | What-If scenarios, Competitive Intel, Deal Insights           |
| 35-40 min | Q&A          | Address questions and concerns                                |
| 40-45 min | Next Steps   | Expectations, support resources, follow-up plan               |

#### Pre-Session Preparation

- Identify 2-3 sample Opportunities to use in the demo (preferably real deals in the current pipeline).
- Ensure all participants have the MarginArc permission set assigned.
- Verify that OEM and Competitor records are populated.
- Test scoring on the sample Opportunities yourself before the session.
- Print or distribute the Quick Start section of the User Guide.

### 7b. Key Points to Cover per Persona

#### For Sales Reps

- MarginArc is here to help you, not to police you. It is pricing GPS, not pricing mandate.
- Fill in the six rep fields for the best recommendations. Partial data = partial accuracy.
- Score early and often. The recommendation changes as you learn more about the deal.
- Apply Recommendation does not change your planned margin. It writes the recommendation alongside your plan so both are visible.
- The Deal Score is not a grade of your performance -- it is a health check for the deal's pricing.

#### For Sales Managers

- Use Deal Scores and recommendations in every deal review and 1:1.
- Focus on the comparison table: are your reps' plans aligned with the data?
- MarginArc lets you coach with data instead of opinions.
- Track the delta between planned and recommended margins across your team.
- Lead by example: ask MarginArc data in every forecast call.

#### For Executives

- MarginArc provides aggregate metrics on pricing health across the organization.
- The intelligence compounds over time -- every deal makes the model smarter.
- Adoption rate and compliance rate are your key leading indicators.
- Expect measurable margin improvement within 90 days of full adoption.

### 7c. Common Objections and How to Address Them

| Objection                                                      | Response                                                                                                                                                                                      |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "I know my customers better than an algorithm."                | "MarginArc does not replace your knowledge. It adds data from hundreds of deals to complement your experience. You always make the final call."                                                 |
| "This is just a way for management to micromanage my pricing." | "The goal is to give you better tools, not more oversight. Reps who use MarginArc typically achieve higher margins and more wins -- it helps you make more money."                              |
| "It takes too long to fill in all those fields."               | "Six fields, 60 seconds. And each one makes the recommendation significantly more accurate. The ROI on that minute is potentially thousands in GP."                                           |
| "The recommendation is too high/low for my deal."              | "Check the Key Drivers to understand why. If the inputs are wrong, fix them and re-score. If the inputs are right, the recommendation is reflecting real market dynamics."                    |
| "I do not trust AI."                                           | "The core engine is statistical modeling, not generative AI. It is finding deals similar to yours and telling you what worked. The AI component only generates the text explanation."         |
| "This is one more thing I have to do."                         | "Scoring takes 3 seconds. Reading results takes 30 seconds. The alternative is pricing blind. Which costs more time -- 33 seconds of data, or a month of pursuing a deal at the wrong price?" |

---

## 8. Monitoring and Reporting

### 8a. Key Reports to Create

#### Report 1: Deal Score Distribution

- **Type:** Opportunities report
- **Filters:** Created Date = current quarter, Fulcrum_Margin\_\_c not null
- **Group By:** Fulcrum_Margin\_\_c (bucket into ranges: 0-19, 20-39, 40-59, 60-79, 80-100)
- **Purpose:** Shows the overall pricing health of the pipeline. Ideally, the distribution shifts rightward over time.

#### Report 2: Recommendation Compliance

- **Type:** Opportunities report
- **Filters:** Fulcrum_Recommended_Margin\_\_c not null, Stage = Closed Won or Closed Lost
- **Formula Column:** `ABS(Fulcrum_Planned_Margin__c - Fulcrum_Recommended_Margin__c)` (the delta)
- **Group By:** Owner
- **Purpose:** Identifies which reps follow recommendations and which consistently diverge.

#### Report 3: Margin Improvement Trend

- **Type:** Opportunities report
- **Filters:** Stage = Closed Won, Created Date within last 12 months
- **Group By:** Close Date (by month)
- **Summary:** Average `Fulcrum_GP_Percent__c` per month
- **Purpose:** Tracks whether margins are improving over time as MarginArc adoption increases.

#### Report 4: Adoption Rate

- **Type:** Opportunities report
- **Filters:** Created Date = current month
- **Formula Column:** Count of Opps with `Fulcrum_Margin__c` not null / Total Opp count
- **Purpose:** Measures what percentage of deals are being scored.

#### Report 5: Data Completeness

- **Type:** Opportunities report
- **Filters:** Fulcrum_Margin\_\_c not null (scored deals only)
- **Columns:** Count where each rep field is populated vs. total
- **Purpose:** Identifies data quality gaps that reduce recommendation accuracy.

#### Report 6: MarginArc Impact Analysis

- **Type:** Opportunities report
- **Filters:** Stage = Closed Won, Fulcrum_Recommended_Margin\_\_c not null
- **Columns:**
  - Sum of actual GP (at Planned Margin)
  - Sum of recommended GP (at Recommended Margin)
  - Delta
- **Purpose:** Quantifies the dollar value of margin left on the table (or gained) by following/not following recommendations.

### 8b. Dashboard Recommendations

Create a Salesforce dashboard with the following components:

| Component               | Chart Type     | Data Source |
| ----------------------- | -------------- | ----------- |
| Deal Score Distribution | Histogram      | Report 1    |
| Compliance by Rep       | Horizontal bar | Report 2    |
| Margin Trend            | Line chart     | Report 3    |
| Adoption Rate           | Gauge          | Report 4    |
| Data Completeness       | Stacked bar    | Report 5    |
| GP Impact               | KPI tile       | Report 6    |

Schedule the dashboard to refresh daily and email it to sales leadership weekly.

### 8c. Tracking Adoption Rate

Adoption has two dimensions:

1. **Scoring adoption:** Are reps clicking Score My Deal?
   - Metric: % of Opportunities with `Fulcrum_Margin__c` populated
   - Target: >80% within 30 days of launch

2. **Data quality adoption:** Are reps filling in the six rep fields?
   - Metric: Average number of rep fields populated on scored Opportunities
   - Target: >4 of 6 fields populated on average within 60 days

3. **Recommendation adoption:** Are reps applying recommendations?
   - Metric: % of scored Opportunities with `Fulcrum_Recommended_Margin__c` populated
   - Target: >60% within 60 days

Track all three weekly for the first quarter, then monthly.

### 8d. Alerting on Data Quality Issues

Set up the following alerts using Salesforce Flow or Process Builder:

#### Alert 1: Opportunity Scored Without Competitor Data

- **Trigger:** `Fulcrum_Margin__c` is updated AND `Fulcrum_Competitors__c` is null
- **Action:** Task assigned to Opportunity Owner: "Add competitor information for a more accurate MarginArc recommendation"

#### Alert 2: Large Deal Without Score

- **Trigger:** Opportunity Amount > $100K AND Stage is "Proposal" or later AND `Fulcrum_Margin__c` is null
- **Action:** Task assigned to Opportunity Owner: "Score this deal with MarginArc before proceeding"

#### Alert 3: Significant Margin Delta

- **Trigger:** `ABS(Fulcrum_Planned_Margin__c - Fulcrum_Recommended_Margin__c) > 8`
- **Action:** Notification to Opportunity Owner's manager: "Review pricing on [Opportunity Name] -- significant gap between planned and recommended margin"

---

## 8b. Batch Analyzer (Nightly Scheduled Job)

### Overview

`FulcrumBatchAnalyzer` is a Salesforce Scheduled Batch Apex job that automatically analyzes all open Opportunities via the MarginArc Lambda API every night at 2 AM. This ensures the Manager Dashboard always has up-to-date margin recommendations, even for deals that reps haven't manually scored.

### How It Works

- **Incremental mode (Mon-Sat):** Only processes Opportunities where `Fulcrum_Recommended_Margin__c IS NULL` (new/unanalyzed deals).
- **Full refresh (Sunday):** Re-analyzes ALL open Opportunities to pick up any deal parameter changes.
- **Batch size:** 10 records per batch execution (to stay within Salesforce's callout governor limits).
- **Fields written:** `Fulcrum_Recommended_Margin__c`, `Fulcrum_AI_Confidence__c`, `Fulcrum_Win_Probability__c`.

### Scheduling

The job is already scheduled. To verify or re-schedule:

```bash
# Check existing scheduled jobs
SF_USE_GENERIC_UNIX_KEYCHAIN=true sf apex run --target-org matt.542a9844149e@agentforce.com -f <(echo "
  for (CronTrigger ct : [SELECT Id, CronExpression, CronJobDetail.Name, State, NextFireTime
                          FROM CronTrigger WHERE CronJobDetail.Name LIKE '%Fulcrum%']) {
    System.debug(ct.CronJobDetail.Name + ' | State: ' + ct.State + ' | Next: ' + ct.NextFireTime);
  }
")
```

To re-schedule if needed:

```apex
// Schedule nightly at 2 AM
System.schedule('Fulcrum Nightly Analyzer', '0 0 2 * * ?', new FulcrumBatchAnalyzer());
```

### On-Demand Backfill

To force a full re-analysis of all open deals (e.g., after a Lambda algorithm update):

```apex
Database.executeBatch(new FulcrumBatchAnalyzer(true), 10);
```

### Monitoring

Check batch job status in **Setup > Environments > Jobs > Apex Jobs**. Look for:

- **Status:** Completed (success), Failed (errors), or Processing (in progress)
- **Total Batches / Batches Processed:** Should match (e.g., 37/37 for ~361 deals at batch size 10)
- **Failures:** Any failures are logged; individual deal failures don't stop the batch

### Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Job not running | Schedule expired or was deleted | Re-schedule (see above) |
| Partial failures | Individual API callout timeouts | Re-run; transient failures resolve on next nightly run |
| All batches failing | Lambda API down or Remote Site expired | Check `api.marginarc.com` accessibility; verify Remote Site Setting is active |
| "Too many callouts" error | Batch size too large | Ensure batch size is 10 (not higher) |

---

## 9. Maintenance

### 9a. Quarterly OEM Data Review

Every quarter, review all `Fulcrum_OEM__c` records:

#### Review Checklist

- [ ] Base margins still accurate per current partner programs?
- [ ] Deal registration boost values reflect current OEM incentives?
- [ ] Services boost values aligned with current pricing structures?
- [ ] Margin floor and ceiling still realistic?
- [ ] Any new OEMs to add?
- [ ] Any OEMs to deactivate?

#### How to Validate

1. Pull a report of Closed Won Opportunities from the last quarter, grouped by OEM.
2. Compare average achieved margins to the Base Margin in each OEM record.
3. If the average achieved margin is consistently 3%+ above or below the Base Margin, investigate and adjust.

### 9b. Competitor Profile Updates

Every quarter, review all active `Fulcrum_Competitor__c` records:

#### Review Checklist

- [ ] Price aggression scores still accurate?
- [ ] Primary strategy descriptions current?
- [ ] Any new competitive tactics observed?
- [ ] Any competitors to add or deactivate?
- [ ] Geographic and vertical focus still valid?

#### How to Validate

1. Debrief with top reps about recent competitive encounters.
2. Review closed-lost deals -- which competitors are appearing most frequently?
3. Cross-reference with head-to-head data in the Competitive Intel widget.

### 9c. Picklist Value Maintenance

Periodically audit picklist values for consistency:

- `Fulcrum_Competitor_Names__c` values must match `Fulcrum_Competitor__c` record names exactly.
- `Fulcrum_Competitors__c` values (0, 1, 2, 3+) are fixed and should not change.
- `Fulcrum_Customer_Segment__c` values (SMB, Mid-Market, Enterprise, Public Sector) are fixed.
- `Fulcrum_Deal_Reg_Type__c` values (NotRegistered, Standard, PremiumHunting) should only change if your OEM partners change their registration programs.
- `Fulcrum_Relationship_Strength__c` values (New, Developing, Good, Strategic) are fixed.
- `Fulcrum_Solution_Complexity__c` values (Single, Multi-vendor) are fixed.
- `Fulcrum_Value_Add__c` values (Low, Medium, High) are fixed.

### 9d. Handling Salesforce Upgrades

When Salesforce releases major platform updates (three times per year):

1. **Pre-release sandbox testing.** Deploy MarginArc to a sandbox on the pre-release version and run through the core workflows: scoring, What-If, Competitive Intel, Apply Recommendation.
2. **Check LWC compatibility.** Review Salesforce release notes for any breaking changes to the Lightning Web Component framework.
3. **Test CSP and Remote Site settings.** Verify that external API calls still function after the upgrade.
4. **Monitor post-upgrade.** After the production upgrade, test scoring on a few deals and monitor for errors.

### 9e. CI/CD Pipeline (GitHub Actions Auto-Deploy)

MarginArc uses a GitHub Actions CI/CD pipeline for automated deployment:

#### Pipeline Overview

1. Code changes are pushed to the GitHub repository.
2. GitHub Actions runs automated tests (Apex test classes, LWC Jest tests).
3. On merge to the `main` branch, the pipeline automatically deploys to the target Salesforce org.
4. Deployment status is reported back to the pull request / commit.

#### Admin Responsibilities

- Do not manually deploy components that are managed by CI/CD -- changes will be overwritten on next deployment.
- If you need to make a configuration change (e.g., update an OEM record), make it directly in Salesforce -- these are data, not metadata, and are not affected by CI/CD.
- If you need to modify metadata (e.g., add a new picklist value to a field), coordinate with the development team to ensure the change is captured in the repository.
- Monitor deployment notifications for failures and escalate to the development team.

#### Emergency Hotfix Process

If a critical issue is discovered in production:

1. Report the issue to the development team.
2. The team will create a hotfix branch, make the fix, and push it through the CI/CD pipeline.
3. Emergency deployments typically complete within 30 minutes of the fix being merged.
4. If the CI/CD pipeline is unavailable, a manual deployment can be performed using `sf project deploy start`.

---

## 10. Troubleshooting

### 10a. Common Admin Issues and Fixes

#### Issue: MarginArc widgets not visible on Opportunity page

**Symptoms:** Users report they cannot see MarginArc components on the Opportunity record page.

**Diagnosis:**

1. Check if the Lightning Record Page has the MarginArc components added (Edit Page in App Builder).
2. Check if the page is activated and assigned to the correct profiles/apps.
3. Verify the user's profile has visibility to the custom components.

**Fix:**

- If components are not on the page, add them (see section 2d).
- If the page is not activated, activate and assign it.
- If it is a profile visibility issue, update the profile or assign the correct permission set.

---

#### Issue: "Score My Deal" returns an error

**Symptoms:** User clicks Score My Deal and receives an error message instead of results.

**Diagnosis:**

1. Check the browser console (F12 > Console) for error details.
2. Common error types:
   - **CSP violation:** Blocked by Content Security Policy
   - **Network error:** Failed to fetch
   - **Apex error:** An error occurred in the Apex controller

**Fix by error type:**

| Error                           | Cause                       | Fix                                                                               |
| ------------------------------- | --------------------------- | --------------------------------------------------------------------------------- |
| CSP violation                   | Trusted Site not configured | Add `api.marginarc.com` to CSP Trusted Sites (section 2e)                     |
| Failed to fetch / Network error | API endpoint unreachable    | Verify internet connectivity; check if `api.marginarc.com` is accessible      |
| Apex error                      | Permission or data issue    | Check Apex error logs in Setup > Debug Logs; common cause is field-level security |
| 401 Unauthorized                | API authentication failure  | Verify API credentials in the Apex configuration                                  |
| 500 Internal Server Error       | API-side issue              | Check MarginArc API health; retry in a few minutes; escalate if persistent          |

---

#### Issue: AI Analysis not generating

**Symptoms:** Scoring works but the AI Analysis section shows an error or is blank.

**Diagnosis:**

1. Verify the Remote Site Setting for `generativelanguage.googleapis.com` is active (section 2f).
2. Check if the Gemini API key is valid and has not exceeded quota.
3. Review the browser console for specific API errors.

**Fix:**

- Add or correct the Remote Site Setting.
- Verify API key configuration in the Apex service class.
- If quota is exceeded, the analysis will regenerate on the next scoring attempt (there is a daily quota reset).

---

#### Issue: Fields not editable by reps

**Symptoms:** Reps report they cannot edit MarginArc fields that they should be able to edit (e.g., Competitor Names, Deal Reg Type).

**Diagnosis:**

1. Check Field-Level Security for the user's profile (section 3a).
2. Check if a Permission Set override is needed.
3. Verify the field is on the page layout (a field can have edit permission but not be on the layout).

**Fix:**

- Update Field-Level Security to grant edit access.
- Assign the `Fulcrum_User` permission set.
- Add the field to the Opportunity page layout.

---

#### Issue: Competitive Intel shows no data

**Symptoms:** The Competitive Intel widget loads but shows "No data available" or empty charts.

**Diagnosis:**

1. Check if `Fulcrum_Competitor_Names__c` is populated on the current Opportunity.
2. Check if there are enough historical closed deals with the same competitor to generate intelligence.
3. Verify that `Fulcrum_Competitor__c` records exist and are marked Active.
4. Confirm the user has read access to the `Fulcrum_Competitor__c` object.

**Fix:**

- Ensure competitors are entered on the deal.
- If this is a new competitor with limited data, the widget will populate as more deals close with this competitor tracked.
- Verify object permissions and sharing rules.

---

#### Issue: OEM lookup field shows no values

**Symptoms:** The OEM field on Opportunity shows no records in the lookup search.

**Diagnosis:**

1. Check if `Fulcrum_OEM__c` records exist.
2. Verify the user has read access to the `Fulcrum_OEM__c` object.
3. Check if the lookup field is configured correctly (points to `Fulcrum_OEM__c`).

**Fix:**

- Create OEM records (section 4a).
- Grant read access via Field-Level Security or permission set.
- Verify the field configuration in Object Manager.

---

#### Issue: Deal Score seems wrong or unexpected

**Symptoms:** The Deal Score does not match what the user expects based on the deal characteristics.

**Diagnosis:**

1. Check all input fields -- are they filled in correctly?
2. Review the Key Drivers chart -- do the drivers match the known deal characteristics?
3. Check the comparison table -- is the planned margin realistic?
4. Verify OEM record data -- are base margins, boosts, and floors/ceilings accurate?

**Fix:**

- Correct any inaccurate input data and re-score.
- If OEM data is the issue, update the `Fulcrum_OEM__c` record and re-score.
- If the score still seems off after data correction, document the specifics and escalate to the development team for model review.

### 10b. Escalation Path

When you encounter an issue you cannot resolve:

| Level                         | Contact                              | Response Time     | Scope                                                    |
| ----------------------------- | ------------------------------------ | ----------------- | -------------------------------------------------------- |
| **Level 1: Self-Service**     | This Admin Guide + User Guide        | Immediate         | Configuration, permissions, data issues                  |
| **Level 2: Internal**         | Sales Ops lead or senior admin       | Same day          | Complex configuration, training questions, report design |
| **Level 3: Development Team** | GitHub Issues or development contact | 1-2 business days | Bug reports, feature requests, model accuracy concerns   |
| **Level 4: Emergency**        | Direct contact with development lead | 2-4 hours         | Production outage, data loss, security concerns          |

When escalating, include:

- Screenshots of the issue
- Browser console output (F12 > Console)
- Steps to reproduce
- User profile and permission set assignments
- Relevant Opportunity ID(s)

---

_MarginArc Admin Guide v1.0 -- Last updated February 2026_
