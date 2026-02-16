# MarginArc -- Pilot Deployment Runbook

**Version:** 1.0
**Last Updated:** February 2026
**Audience:** Salesforce Administrator deploying MarginArc for a pilot team

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Step 1: Install the Package](#step-1-install-the-package)
3. [Step 2: Assign Permission Sets](#step-2-assign-permission-sets)
4. [Step 3: Configure API Connection](#step-3-configure-api-connection)
5. [Step 4: Run the Setup Wizard](#step-4-run-the-setup-wizard)
6. [Step 5: Configure OEM Vendors](#step-5-configure-oem-vendors)
7. [Step 6: Configure Competitors](#step-6-configure-competitors)
8. [Step 7: Run Historical Backfill](#step-7-run-historical-backfill)
9. [Step 8: Add Components to Page Layout](#step-8-add-components-to-page-layout)
10. [Step 9: Verify](#step-9-verify)
11. [Step 10: OEM Cost Data](#step-10-oem-cost-data)
12. [Ongoing Operations](#ongoing-operations)
13. [Troubleshooting](#troubleshooting)
14. [Pilot Success Criteria](#pilot-success-criteria)

---

## Prerequisites

Before beginning the installation, confirm the following:

- **Salesforce Edition:** Enterprise, Unlimited, or Developer Edition. Performance Edition is also supported. Professional Edition is not supported (no Apex execution).
- **API Version:** 62.0 or higher. MarginArc uses Salesforce API v62.0.
- **Admin Access:** You must have System Administrator profile or equivalent permissions to install packages, assign permission sets, and edit page layouts.
- **MarginArc API Key:** Obtain your API key from your MarginArc account representative. This key authenticates your org's connection to the MarginArc margin intelligence backend.
- **MarginArc API URL:** Your MarginArc account representative will provide the API endpoint URL. The standard endpoint is `https://api.marginarc.com/api/recommend`.
- **Network Access:** Your Salesforce org must be able to make outbound HTTPS calls to the MarginArc API domain. The package includes a Remote Site Setting for this, but your org's network policies (IP whitelists, firewall rules) must allow the connection.
- **Opportunity Data:** For best results, your org should have at least 50 open Opportunities with Amount populated. MarginArc derives several input fields automatically, but having real deal data is essential for meaningful recommendations.

---

## Navigation Guide: Tabs and Their Purposes

MarginArc includes **4 custom tabs** accessible via the App Launcher. Understanding which tab does what will help you navigate the runbook:

| Tab Name | Icon | Purpose | Who Uses It |
|----------|------|---------|-------------|
| **MarginArc Getting Started** | Layers | 6-step setup wizard for first-run configuration and maturity tracking | Admins (first-time setup) |
| **MarginArc Setup** | Database | Admin configuration: OEM vendors, competitor profiles, data health monitoring, connection testing | Admins (ongoing config) |
| **MarginArc Dashboard** | Chart | Team-wide pipeline health, rep performance, margin opportunity analysis, competitive win/loss | Managers & Admins |
| **MarginArc ROI Report** | List | Historical backfill results showing margin improvement opportunity across closed deals | Managers & Admins |

**For Sales Reps:** Reps do not use the tabs above. Instead, they interact with MarginArc via **Lightning Web Components** placed on Opportunity record pages:
- **MarginArc Margin Advisor** — Main margin recommendation widget (configured in Step 8)
- **MarginArc Competitive Intel** — Account-level win/loss history and strategy tips

**Navigation Pattern During Setup:**
- Steps 1-2: **Setup > Custom Settings** (for API configuration)
- Step 3: **MarginArc Getting Started** tab (wizard)
- Step 4: **MarginArc Setup** tab (OEM/competitor configuration)
- Step 8: **Lightning App Builder** (add components to Opportunity page)
- Step 9: **MarginArc Dashboard** tab (verify manager view)

---

## Step 1: Install the Package

MarginArc is distributed as a second-generation (2GP) unlocked Salesforce package. Installation takes approximately 2-5 minutes.

1. Open the following URL in your browser while logged in to your Salesforce org as a System Administrator:

   ```
   https://login.salesforce.com/packaging/installPackage.apexp?p0=04tfj000000E6wnAAC
   ```

   If your org uses a custom domain (My Domain), replace `login.salesforce.com` with your domain (e.g., `https://yourcompany.my.salesforce.com/packaging/installPackage.apexp?p0=04tfj000000E6wnAAC`).

2. On the installation screen, select **Install for Admins Only** (recommended for pilot). You will assign access to specific users via permission sets in the next step.

3. If prompted, check **Yes, grant access to these third-party web sites** to approve the Remote Site Setting for the MarginArc API (`https://api.marginarc.com`).

4. Click **Install**. Wait for the installation to complete. You will receive a confirmation email when finished.

**What happens automatically on install:**

The package includes a post-install handler (`FulcrumInstallHandler`) that runs automatically and performs three actions:

- **Creates default configuration:** A `Fulcrum_Config__c` custom setting record is created with the API URL pre-populated. You will add your API Key in Step 3.
- **Schedules the nightly analyzer:** The `FulcrumBatchAnalyzer` batch job is scheduled to run at 2:00 AM daily. This job automatically analyzes open Opportunities on an incremental basis (new deals Mon-Sat, full refresh on Sundays).
- **Sends a welcome email:** On a fresh install (not an upgrade), the installing admin receives an email with next-step instructions.

**What the package installs:**

- 22 custom fields on Opportunity (all prefixed `Fulcrum_`)
- 4 custom objects: `Fulcrum_OEM__c`, `Fulcrum_Competitor__c`, `Fulcrum_Recommendation_History__c`, `Fulcrum_BOM_Line__c`, `Fulcrum_Backfill_Result__c`
- 1 custom setting: `Fulcrum_Config__c`
- 8 Lightning Web Components
- 8 Apex controllers and 1 batch analyzer class
- 3 permission sets: `Fulcrum_Admin`, `Fulcrum_Manager`, `Fulcrum_User`
- 4 custom tabs: MarginArc Dashboard, MarginArc Setup, MarginArc Getting Started, MarginArc ROI Report
- 4 reports in the MarginArc Reports folder
- 1 Remote Site Setting for the MarginArc API

---

## Step 2: Assign Permission Sets

MarginArc uses three permission sets to control access. Each user in the pilot should receive exactly one permission set.

### Permission Set Summary

| Permission Set | Intended For | Access Level |
|---|---|---|
| **Fulcrum_Admin** | Sales Ops / RevOps administrator (1-2 people) | Full CRUD on all MarginArc objects, custom settings, and configuration. All tabs visible (Dashboard, Setup, Getting Started). |
| **Fulcrum_Manager** | VP/Director of Sales, team leads | Read-only on deal input fields, write access to recommendation fields. Dashboard tab visible. View All on Opportunities for team reporting. |
| **Fulcrum_User** | Sales reps in the pilot | Read-only on most MarginArc fields, write access to recommendation output fields (so "Apply Recommendation" works). No admin tabs. |

### Assignment via Setup UI

1. Navigate to **Setup** > **Users** > **Permission Sets**.
2. Click **Fulcrum_Admin** (the permission set).
3. Click **Manage Assignments**.
4. Click **Add Assignment**.
5. Select the Sales Ops / RevOps admin user(s) who will manage MarginArc configuration.
6. Click **Assign**.
7. Repeat for **Fulcrum_Manager** (sales leaders) and **Fulcrum_User** (reps).

### Assignment via Salesforce CLI

If you prefer the command line, assign permission sets with the following commands:

```bash
# Assign Fulcrum_Admin to the configuring admin
sf org assign permset --name Fulcrum_Admin --target-org <your-org-alias>

# Assign Fulcrum_Manager to a specific user
sf org assign permset --name Fulcrum_Manager --onbehalfof user@company.com --target-org <your-org-alias>

# Assign Fulcrum_User to a specific user
sf org assign permset --name Fulcrum_User --onbehalfof rep@company.com --target-org <your-org-alias>
```

**Important:** Assign yourself the `Fulcrum_Admin` permission set before proceeding to Step 3. The admin permission set grants access to the `Fulcrum_Config__c` custom setting, which is required for API configuration.

---

## Step 3: Configure API Connection

The MarginArc API connection must be configured before any margin recommendations can be generated. API credentials are stored in the `Fulcrum_Config__c` custom setting.

### Configure via Custom Settings (Recommended)

1. Navigate to **Setup** (gear icon, top right)
2. In the Quick Find box, type **"Custom Settings"**
3. Click **Custom Settings**
4. Find **Fulcrum_Config** in the list and click **Manage**
5. Click **Edit** next to the org default record (if one exists), or click **New** to create it
6. Enter the following values:
   - **API URL__c:** `https://api.marginarc.com/api/recommend` (this should already be pre-populated by the install handler)
   - **API Key__c:** Paste the API key provided by your MarginArc representative
   - **Gemini API Key__c** (optional): If you have a Google Gemini API key for AI-generated explanations, enter it here
7. Click **Save**

### Verify the Connection

After saving the custom setting, verify the connection works:

1. Navigate to the **MarginArc Setup** tab in the App Launcher
   - Click the App Launcher (grid icon, top left) > search for "MarginArc Setup" > click the tab
2. The **Connection Status** section at the top displays read-only indicators showing:
   - API URL Configured (should show green checkmark)
   - API Key Configured (should show green checkmark)
   - Gemini API Key Configured (optional — green if configured)
   - API Reachable (green checkmark with response latency if successful)
3. Click **Test Connection** to re-verify the live connection

If the connection test fails, see the [Troubleshooting](#troubleshooting) section.

---

## Step 4: Run the Setup Wizard

The Setup Wizard provides a guided experience for completing your MarginArc deployment. It tracks progress across 5 completion milestones and provides actionable guidance at each step.

1. Navigate to the **MarginArc Getting Started** tab in the App Launcher.
   - Click the App Launcher (grid icon, top left) > search for "MarginArc Getting Started" > click the tab.

2. The wizard has 6 steps. Walk through each one:

### Step 1 of 6: Welcome
- Review the value propositions and current setup completion percentage.
- The progress ring shows how many of the 5 setup milestones are complete.
- **Optional: Load Demo Data** — If this is a fresh org or you want to explore MarginArc with sample data before configuring your own, use the **Demo Data** section:
  - Click **"Load Demo Data"** to automatically create:
    - 10 OEM vendors (Cisco, Palo Alto, Dell, HPE, Fortinet, Pure Storage, VMware, NetApp, Arista, Microsoft)
    - 10 competitor profiles (CDW, SHI, Presidio, Optiv, Insight, ePlus, Trace3, Connection, Zones, Converge)
    - 8 demo accounts (Acme Technologies, Meridian Healthcare, Pinnacle Financial, Atlas Manufacturing, Horizon Energy, Velocity Logistics, Crestline Retail, Spectrum Media)
    - ~30 opportunities: 10 open pipeline deals, 12 Closed Won, 8 Closed Lost — all with realistic MarginArc field data
  - The loader is idempotent — it checks for existing demo data and won't create duplicates if run twice.
  - This is **purely optional** and useful for evaluating MarginArc features before importing your production data.
- Click **Next** to continue.

### Step 2 of 6: Connection Check
- This step verifies your API configuration from Step 3.
- You should see green checkmarks for:
  - API URL configured
  - API Key configured
  - API reachable (live connectivity test)
- Gemini AI configuration (optional) enables AI-generated narrative explanations on recommendations. If you have a Gemini API key, enter it in the MarginArc Setup tab under the API Configuration section.
- Click **Next** to continue.

### Step 3 of 6: Data Quality
- This step assesses the fill rate of 5 key Opportunity fields that drive recommendation accuracy:
  - `Fulcrum_OEM__c` (OEM Vendor)
  - `Fulcrum_OEM_Cost__c` (OEM Cost)
  - `Fulcrum_Customer_Segment__c` (Customer Segment)
  - `Fulcrum_Deal_Reg_Type__c` (Deal Registration)
  - `Fulcrum_Competitor_Names__c` (Competitors)
- Each field shows a fill rate bar and an auto-derivation hint (e.g., OEM can be derived from Opportunity Name, Segment from Amount).
- For pilot, do not worry about achieving 100% fill rates. MarginArc applies smart defaults for missing fields. Focus on getting `Fulcrum_OEM__c` populated on the majority of deals, as this is the single most impactful field.
- Click **Next** to continue.

### Step 4 of 6: Configuration
- This step checks whether you have configured OEM vendors and competitor profiles.
- If both show zero records, you will complete these in Steps 5 and 6 of this runbook.
- Click **Next** to continue (you can return to this step later).

### Step 5 of 6: Historical Backfill
- You will trigger this in [Step 7](#step-7-run-historical-backfill) of this runbook after OEMs and competitors are configured.
- Skip for now and click **Next**.

### Step 6 of 6: Intelligence Maturity Model
- This step shows your current maturity level (1 through 5) and what actions will advance you to the next level.
- The 5 levels are:
  1. **Getting Started** -- Basic configuration incomplete
  2. **Foundation** -- Core config complete, improving data quality
  3. **Active** -- Recommendations flowing, building coverage
  4. **Optimizing** -- High data quality, historical backfill complete
  5. **Mastery** -- Full adoption with consistent recommendation usage
- For a successful pilot, target reaching Level 3 (Active) within the first week, and Level 4 (Optimizing) by end of the pilot period.

---

## Step 5: Configure OEM Vendors

OEM vendor profiles tell MarginArc the base margin expectations, deal registration boosts, and other vendor-specific parameters for each OEM your company sells.

**Note:** If you loaded demo data in Step 4 (Setup Wizard Step 1), you already have 10 OEM vendors configured. You can skip this step or edit the demo OEMs to match your actual margin data.

1. Navigate to the **MarginArc Setup** tab in the App Launcher.

2. In the Admin Config panel, locate the **OEM Vendors** section.

3. Click **New OEM** to add a vendor profile.

4. For each OEM vendor your pilot team sells, enter the following:
   - **Name:** The OEM vendor name exactly as it appears in your Opportunity data (e.g., "Cisco", "Palo Alto", "HPE", "Dell", "Fortinet").
   - **Base Margin (%):** Your company's typical gross margin percentage for this vendor's products (e.g., 8.0 for 8%).
   - **Deal Reg Margin Boost (%):** The additional margin percentage gained when deals are registered with this vendor (e.g., 3.0 for 3 additional percentage points).
   - **Services Margin Boost (%):** Additional margin gained when professional services are attached to a deal (e.g., 5.0).
   - **Quarter End Discount (%):** Additional discount typically available at vendor quarter-end (e.g., 2.0).
   - **Product Category:** Primary product category (Hardware, Software, Security, Networking, etc.).
   - **Logo URL** (optional): URL to the vendor's logo image for display in the UI.

5. Click **Save** after each vendor.

6. Repeat for all OEM vendors relevant to your pilot team. For a typical pilot, start with 3-5 top vendors by revenue.

**Tip:** If you are unsure of exact margin values, use estimates. MarginArc's recommendations are most sensitive to relative differences between vendors, so directional accuracy is more important than precision. You can refine values as you learn from pilot results.

---

## Step 6: Configure Competitors

Competitor profiles enable MarginArc's competitive intelligence features and improve margin recommendations by accounting for competitive pressure.

**Note:** If you loaded demo data in Step 4 (Setup Wizard Step 1), you already have 10 competitor profiles configured (CDW, SHI, Presidio, Optiv, Insight, ePlus, Trace3, Connection, Zones, Converge). You can skip this step or customize the profiles with your team's competitive insights.

1. Navigate to the **MarginArc Setup** tab in the App Launcher.

2. In the Admin Config panel, locate the **Competitors** section.

3. Click **New Competitor** to add a competitor VAR profile.

4. For each competitor your team commonly encounters, enter:
   - **Name:** The competitor's company name (e.g., "CDW", "SHI", "Presidio", "Insight").
   - **Primary Strength:** What this competitor is best known for (e.g., "Price", "Services", "Breadth", "Vertical Expertise").
   - **Price Aggression:** How aggressive on price (Low / Medium / High).
   - **Services Capability:** Strength of their services practice (Low / Medium / High).
   - **Primary OEMs:** Comma-separated list of their strongest OEM partnerships (e.g., "Cisco, Dell, HPE").
   - **How To Win:** Free-text coaching notes for reps on how to compete (e.g., "Lead with services wrap and emphasize our Cisco Gold partnership").
   - **Typical Discount (%):** Their typical discount percentage from list price (e.g., 12.0).
   - **Description:** General description of the competitor.
   - **Margin Aggression:** How willing they are to sacrifice margin to win (Low / Medium / High).

5. Click **Save** after each competitor.

6. Repeat for 5-10 top competitors. MarginArc includes hardcoded fallback profiles for common national VARs (CDW, SHI, Presidio, Optiv, Insight, ePlus, Trace3, Connection, Zones, Converge), but custom profiles that reflect your team's actual competitive experience will produce better results.

---

## Step 7: Run Historical Backfill

The historical backfill analyzer scores past closed Opportunities to establish a baseline of "what MarginArc would have recommended." This data powers the Manager Dashboard's margin opportunity analysis and provides proof-of-value for the pilot.

1. Navigate to the **MarginArc Getting Started** tab.

2. Advance to **Step 5: Historical Backfill**.

3. Select the lookback period:
   - **12 months** is recommended for most pilots. This provides enough data for meaningful trends without excessive processing time.
   - 6 months is appropriate if your deal volume is very high (>500 closed deals per quarter).
   - 24 months provides the richest data but takes longer to process.

4. Click **Run Backfill**.

5. The wizard displays a progress bar that polls for job status. The backfill processes deals in batches of 10 (to stay within Salesforce API governor limits). Each batch makes one API callout per deal.

   **Expected duration:**
   - 100 closed deals: approximately 2-3 minutes
   - 500 closed deals: approximately 10-15 minutes
   - 1,000 closed deals: approximately 20-30 minutes

6. You do not need to keep the browser tab open. The batch job runs server-side. You can check status later by returning to this wizard step.

7. When the backfill completes, the wizard shows the number of deals analyzed, any errors encountered, and the completion timestamp.

**What the backfill does:**
- Queries all closed Opportunities within the selected time window.
- For each deal, calls the MarginArc API with the deal's parameters (OEM, amount, competitors, segment, etc.) to generate what the recommended margin would have been.
- Stores the results in `Fulcrum_Backfill_Result__c` records with: actual margin, recommended margin, margin delta, actual gross profit, recommended gross profit, and gross profit delta.
- Does NOT modify any existing Opportunity field values.

---

## Step 8: Add Components to Page Layout

For the pilot, add two MarginArc Lightning Web Components to the Opportunity record page. These are the primary interfaces your sales reps will interact with.

### Recommended Components for Pilot

| Component | Purpose |
|---|---|
| **MarginArc Margin Advisor** (`fulcrumMarginAdvisor`) | AI-powered margin recommendation with confidence gauge, win probability, key drivers, and "Apply Recommendation" button. This is the core MarginArc experience. |
| **MarginArc Competitive Intel** (`fulcrumCompetitiveIntel`) | Account-specific competitive intelligence showing win/loss history, competitor strategies, and coaching tips. |

### Adding Components via Lightning App Builder

1. Navigate to any Opportunity record.

2. Click the **gear icon** (top right) > **Edit Page**. This opens Lightning App Builder.

3. In the left panel, under **Custom - Managed**, locate the MarginArc components. If they do not appear under Managed, check the **Custom** section.

4. Drag **fulcrumMarginAdvisor** onto the page layout. Recommended placement: right sidebar or a new tab in the record detail area. This component works best with a width of at least 380px.

5. Drag **fulcrumCompetitiveIntel** onto the page layout. Recommended placement: below the Margin Advisor in the same column, or in a separate tab.

6. Click **Save**.

7. If prompted, choose the activation scope:
   - **Org Default** to apply this layout to all users.
   - **App Default** or **App, Record Type, and Profile** for more targeted rollout during the pilot.

8. Click **Activate** and then **Back** to return to the record.

### Additional Components (Post-Pilot)

The following components are available but recommended for post-pilot expansion:

- **MarginArc Deal Insights** (`fulcrumDealInsights`) -- Contextual tips based on OEM, stage, and segment.
- **MarginArc What-If** (`fulcrumWhatIf`) -- Scenario modeling for deal parameter changes.
- **MarginArc BOM Table** (`fulcrumBomTable`) -- Automatically embedded within the Margin Advisor; no separate placement needed.

### Manager Dashboard Tab

The Manager Dashboard is accessed as a standalone Lightning Tab, not a record page component.

1. Navigate to the **App Launcher** > search for "MarginArc Dashboard".
2. The tab is automatically visible to users with the `Fulcrum_Admin` or `Fulcrum_Manager` permission set.
3. No page layout changes are needed for the dashboard.

---

## Step 9: Verify

After completing Steps 1-8, verify the deployment with the following checklist.

### Verification Checklist

1. **Permission Set Test**
   - Log in as a user with the `Fulcrum_User` permission set.
   - Navigate to an Opportunity record. Confirm that MarginArc custom fields are visible in the record detail (e.g., `Fulcrum_OEM__c`, `Fulcrum_Planned_Margin__c`).
   - Navigate to the App Launcher. Confirm that "MarginArc Dashboard" does NOT appear (this tab is restricted to Admin and Manager permission sets).

2. **Margin Advisor Widget**
   - Open an Opportunity record that has an Amount populated.
   - Locate the **MarginArc Margin Advisor** component on the page.
   - If the `Fulcrum_OEM__c` field is not populated, set it to one of your configured OEM vendors.
   - Click **Score My Deal**.
   - Verify that a recommendation appears with:
     - Recommended margin percentage
     - AI confidence gauge
     - Win probability estimate
     - Key drivers section
   - Click **Apply Recommendation** and confirm the recommendation fields are written back to the Opportunity.

3. **Competitive Intel Widget**
   - On the same Opportunity, locate the **MarginArc Competitive Intel** component.
   - If the `Fulcrum_Competitor_Names__c` field is populated, verify that competitor matchup data appears.
   - If no account-level history exists, verify that industry-level fallback data is displayed.

4. **Manager Dashboard**
   - Log in as a user with the `Fulcrum_Manager` or `Fulcrum_Admin` permission set.
   - Navigate to the **MarginArc Dashboard** tab via the App Launcher.
   - Verify that KPI cards load (Pipeline Total, RAGP Delta, Win Rate, Adoption Rate).
   - Verify that the pipeline health table shows open Opportunities.

5. **Backfill Results**
   - Navigate to the **MarginArc Getting Started** tab.
   - Advance to Step 5 (Historical Backfill). Confirm the backfill job shows as Completed.
   - Navigate to the **MarginArc Dashboard** tab. The Margin Opportunity section should now show data comparing actual margins to MarginArc's recommended margins across closed deals.

6. **Nightly Analyzer**
   - Navigate to **Setup** > **Environments** > **Jobs** > **Scheduled Jobs**.
   - Confirm that a job named "MarginArc Nightly Analyzer" appears with a Next Scheduled Run time at 2:00 AM.

---

## Step 10: OEM Cost Data

The `Fulcrum_OEM_Cost__c` field on Opportunity represents the total cost from the OEM/distributor for a deal. This field is the foundation for margin calculations. Without it, MarginArc can still provide recommendations using Amount-based estimation, but accuracy improves significantly with actual cost data.

There are three options for populating this field, listed from simplest to most accurate.

### Option A: Manual Entry by Reps (Simplest)

- Add the `Fulcrum_OEM_Cost__c` field to the Opportunity page layout.
  1. Navigate to **Setup** > **Object Manager** > **Opportunity** > **Page Layouts**.
  2. Select your active page layout.
  3. Drag the `Fulcrum_OEM_Cost__c` field from the field palette into the layout.
  4. Click **Save**.
- Train reps to enter the OEM cost when they receive a quote from their distributor.
- **Pros:** No integration needed. Immediate availability.
- **Cons:** Depends on rep compliance. May be inconsistent or delayed.

### Option B: CSV Data Import via Data Import Wizard (Weekly Batch)

- Export cost data from your ERP or distributor portal as a CSV file with columns: `Opportunity ID` (or `Opportunity Name`), `OEM Cost`.
- Navigate to **Setup** > **Data** > **Data Import Wizard**.
- Select **Opportunities** as the object.
- Map the CSV columns to the corresponding Salesforce fields (`Id` and `Fulcrum_OEM_Cost__c`).
- Run the import.
- Schedule this as a weekly process (e.g., every Monday morning) to keep cost data current.
- **Pros:** Batch update. More accurate than manual entry.
- **Cons:** Requires a weekly manual process. Data is up to 7 days stale.

### Option C: ERP/Distributor API Integration (Most Accurate)

- Build middleware (MuleSoft, Workato, custom Lambda, etc.) that reads cost data from your ERP or distributor API and writes to the `Fulcrum_OEM_Cost__c` field via the Salesforce REST API.
- This approach provides near-real-time cost data.
- **Pros:** Most accurate. Fully automated.
- **Cons:** Requires middleware development. Higher implementation effort.

### Recommendation for Pilot

Start with **Option A (manual entry)** combined with **Option B (weekly CSV import)**. This provides a workable data pipeline without integration effort. Reps enter cost data as they receive distributor quotes, and the weekly CSV import catches any gaps. Plan Option C as a post-pilot enhancement if the pilot demonstrates ROI.

---

## Ongoing Operations

Once the pilot is live, the following operations run automatically or require periodic attention.

### Automatic: Nightly Batch Analyzer

- **Schedule:** Runs at 2:00 AM daily.
- **Mon-Sat (Incremental):** Processes only Opportunities where `Fulcrum_Recommended_Margin__c` is null (new or never-analyzed deals).
- **Sunday (Full Refresh):** Re-analyzes all open Opportunities to reflect updated deal parameters.
- **Batch Size:** 10 records per batch execution (to stay within Salesforce callout governor limits).
- **Fields Updated:** `Fulcrum_Recommended_Margin__c`, `Fulcrum_AI_Confidence__c`, `Fulcrum_Win_Probability__c`.
- **Monitoring:** Navigate to **Setup** > **Environments** > **Jobs** > **Apex Jobs** to view recent batch execution history, including items processed, errors, and completion times.

### Weekly: Review Manager Dashboard

- Log in as a user with the Fulcrum_Manager or Fulcrum_Admin permission set.
- Navigate to the **MarginArc Dashboard** tab.
- Review:
  - **Adoption Rate:** Percentage of open deals with MarginArc recommendations. Target >60% for pilot success.
  - **RAGP Delta:** Difference between risk-adjusted gross profit at planned margins vs. recommended margins. Positive values indicate margin uplift opportunity.
  - **Pipeline Health:** Check for critical alerts (deals priced >10pp below recommendation) and warning alerts (3-10pp below).
  - **Competitive Win/Loss:** Monitor win rates by competitor to validate competitive intelligence.

### Weekly: Check Setup Wizard Maturity

- Navigate to the **MarginArc Getting Started** tab.
- Advance to Step 6 (Maturity Model).
- Track your maturity level progression. The wizard provides specific actions to advance to the next level.

### As Needed: Update OEM and Competitor Data

- As you learn from pilot results, refine OEM base margins, deal reg boosts, and competitor profiles in the MarginArc Setup tab.
- Add new OEM vendors or competitors as your team encounters them.

---

## Troubleshooting

### API Connection Failures

**Symptom:** "Test Connection" in MarginArc Setup shows failure, or the Margin Advisor displays "API unreachable."

**Resolution:**
1. Verify the API URL and Key are configured in the custom setting:
   - Navigate to **Setup > Custom Settings > Fulcrum_Config > Manage**
   - Verify `API_URL__c` = `https://api.marginarc.com/api/recommend`
   - Verify `API_Key__c` is populated (not blank)
2. Check Remote Site Settings: Navigate to **Setup** > **Security** > **Remote Site Settings**. Confirm that `Fulcrum_API` is listed and active, pointing to `https://api.marginarc.com`.
3. If your org has IP restrictions or firewall rules, ensure outbound HTTPS (port 443) to `api.marginarc.com` is allowed.
4. Test the API from a browser or curl: `curl -s https://api.marginarc.com/health` should return a 200 response.
5. After correcting the custom setting, return to the **MarginArc Setup** tab and click **Test Connection** to re-verify.

### Empty Recommendations ("No recommendation available")

**Symptom:** The Margin Advisor widget loads but shows no recommendation data.

**Resolution:**
1. Verify the Opportunity has an `Amount` value populated.
2. Verify the `Fulcrum_OEM__c` field is populated with a recognized OEM vendor name. If this field is empty, MarginArc attempts to derive the OEM from the Opportunity Name (e.g., "Cisco Meraki Refresh" auto-detects Cisco). If neither is available, the recommendation engine has insufficient data.
3. Check that at least one OEM vendor profile exists in the MarginArc Setup tab.
4. Check the browser developer console (F12 > Console) for error messages from the LWC component.

### Permission Errors

**Symptom:** Users see "Insufficient Privileges" or cannot view MarginArc fields/tabs.

**Resolution:**
1. Verify the user has one of the three MarginArc permission sets assigned: Navigate to **Setup** > **Users** > select the user > **Permission Set Assignments**.
2. Confirm the permission set is the correct tier for their role (`Fulcrum_User` for reps, `Fulcrum_Manager` for leaders, `Fulcrum_Admin` for admins).
3. If a user needs access to the MarginArc Setup or MarginArc Getting Started tabs, they must have `Fulcrum_Admin` assigned. These tabs are only visible to admins.

### Nightly Analyzer Not Running

**Symptom:** New Opportunities are not receiving automated recommendations overnight.

**Resolution:**
1. Navigate to **Setup** > **Environments** > **Jobs** > **Scheduled Jobs**.
2. Look for "MarginArc Nightly Analyzer" in the list. If it is missing:
   - Navigate to **Setup** > **Developer Console** (or use the MarginArc Getting Started wizard Step 5).
   - Run the nightly analyzer manually from the Setup Wizard to re-trigger scheduling.
3. Check **Setup** > **Environments** > **Jobs** > **Apex Jobs** for recent failures. Common causes: API connection errors (check Remote Site Settings), governor limit errors (reduce concurrent batch jobs).

### Backfill Job Errors

**Symptom:** The backfill job shows errors in the Setup Wizard or Apex Jobs list.

**Resolution:**
1. A small number of errors (< 5% of total) is normal and typically caused by individual Opportunities with unusual data.
2. Navigate to **Setup** > **Environments** > **Jobs** > **Apex Jobs** and find the backfill job. The "Errors" column shows the count.
3. If errors are widespread, verify that the API connection is working (Step 3) and that at least one OEM vendor is configured (Step 5).
4. Re-run the backfill from the Setup Wizard. The backfill is safe to re-run; it creates new result records without modifying existing ones.

### Components Not Visible in Lightning App Builder

**Symptom:** MarginArc components do not appear in the component palette when editing a Lightning page.

**Resolution:**
1. Verify the package installed successfully: Navigate to **Setup** > **Installed Packages** and confirm "MarginArc" is listed.
2. In Lightning App Builder, components appear under the **Custom** section of the component palette. Scroll down or use the search bar to find the MarginArc components.
3. If components still do not appear, try clearing your browser cache and reloading the page.

---

## Pilot Success Criteria

Track the following metrics throughout the pilot period (recommended: 30-60 days) to evaluate MarginArc's impact and determine whether to proceed to full deployment.

### Adoption Metrics

| Metric | Target | How to Measure |
|---|---|---|
| **Adoption Rate** | > 60% of pilot deals have MarginArc recommendations | MarginArc Dashboard > KPI strip > "Adoption Rate" |
| **Apply Rate** | > 30% of scored deals have "Apply Recommendation" clicked | Count of `Fulcrum_Recommendation_History__c` records where `Applied__c = true` vs. total recommendations |
| **Active Users** | > 75% of pilot users have used MarginArc at least once per week | Monitor via MarginArc Dashboard rep performance section |

### Data Quality Metrics

| Metric | Target | How to Measure |
|---|---|---|
| **Field Fill Rate (Top 5 fields)** | > 80% average across OEM, OEM Cost, Segment, Deal Reg, Competitors | MarginArc Getting Started wizard > Step 3 (Data Quality) |
| **OEM Cost Population** | > 50% of pilot deals have `Fulcrum_OEM_Cost__c` populated | Setup Wizard data quality or SOQL query |

### Business Impact Metrics

| Metric | Target | How to Measure |
|---|---|---|
| **Margin Lift** | > 0.3 percentage points vs. control group or pre-MarginArc baseline | Compare average gross margin on MarginArc-guided deals vs. non-guided deals in MarginArc Dashboard |
| **RAGP Uplift** | Positive risk-adjusted gross profit delta | MarginArc Dashboard > RAGP Delta KPI |
| **Win Rate Maintenance** | No decline in win rate (within 2pp of baseline) | MarginArc Dashboard > Historical Performance > Win Rate |

### Qualitative Metrics

| Metric | Target | How to Measure |
|---|---|---|
| **Rep NPS** | > 30 | Survey pilot reps: "How likely are you to recommend MarginArc to a colleague?" (0-10 scale) |
| **Time-to-Quote** | Neutral or improved | Rep self-reported: "Does MarginArc slow down or speed up your quoting process?" |

### Evaluation Cadence

- **Week 1:** Confirm all users have permission sets assigned, components are visible, and at least 10 deals have been scored.
- **Week 2:** Review adoption rate and field fill rates. Identify and address any blockers.
- **Week 4:** Conduct first quantitative review of margin metrics. Gather qualitative rep feedback.
- **End of Pilot (Week 6-8):** Full evaluation against all success criteria. Make go/no-go decision for expanded rollout.

---

*For technical questions about the MarginArc API, data model, or advanced configuration, refer to the [API Reference](api-reference.md), [Data Dictionary](data-dictionary.md), and [Admin Guide](admin-guide.md) in the MarginArc documentation.*
