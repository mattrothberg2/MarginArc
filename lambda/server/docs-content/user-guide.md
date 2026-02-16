# MarginArc User Guide

## Table of Contents

1. [Welcome to MarginArc](#1-welcome-to-fulcrum)
2. [Quick Start](#2-quick-start)
3. [For Sales Reps](#3-for-sales-reps)
4. [For Sales Managers](#4-for-sales-managers)
5. [For VP Sales / CRO](#5-for-vp-sales--cro)
6. [FAQ for Users](#6-faq-for-users)
7. [Glossary](#7-glossary)

---

## 1. Welcome to MarginArc

### What is MarginArc?

MarginArc is an AI-powered margin intelligence platform built for IT Value-Added Resellers (VARs). It lives directly inside Salesforce on every Opportunity record page, giving your sales team real-time pricing guidance, competitive intelligence, and deal optimization recommendations without ever leaving the CRM.

### The Problem MarginArc Solves

IT VARs leave millions on the table every year through inconsistent pricing. Reps underprice deals out of fear, overprice deals out of ignorance, or miss competitive dynamics that could swing outcomes. Pricing knowledge lives in spreadsheets, tribal memory, and gut instinct. MarginArc replaces all of that with data-driven intelligence.

### How MarginArc Helps

- **Eliminates guesswork.** Every deal gets a recommended margin backed by machine learning across 31 signals.
- **Improves win rates.** Win probability modeling shows the real tradeoff between margin and likelihood of closing.
- **Builds institutional knowledge.** Network intelligence means every closed deal makes every future recommendation smarter.
- **Levels the playing field.** Junior reps get the same caliber of pricing guidance as your most experienced sellers.
- **Accelerates deal reviews.** Managers can evaluate pricing decisions with objective, data-backed scores instead of anecdotes.

### Where to Find MarginArc

MarginArc appears as four widgets on the **Opportunity record page** in Salesforce Lightning:

| Widget                    | Location            | Purpose                                                                                                        |
| ------------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------- |
| **Margin Advisor**        | Opportunity page    | The main panel. Deal Score, recommended margin, win probability, AI analysis, and one-click apply.             |
| **Deal Insights**         | Opportunity page    | Contextual tips based on OEM, deal stage, industry, and deal characteristics.                                  |
| **What-If Scenarios**     | Opportunity page    | Model different deal configurations and see how they change the recommendation.                                |
| **Competitive Intel**     | Opportunity page    | Head-to-head win/loss records against specific competitors, strategy recommendations, and competitor profiles. |
| **Manager Dashboard**     | MarginArc Dashboard tab | Team-wide pipeline health, rep performance, margin opportunity, and competitive analytics.                     |

You do not need to install anything, open a separate app, or leave Salesforce. If your admin has deployed MarginArc, the widgets are on every Opportunity page and the Manager Dashboard is accessible via the MarginArc Dashboard tab.

---

## 2. Quick Start

**Time required: 5 minutes**

This section walks you through using MarginArc on a deal for the very first time.

### Step 1: Open an Opportunity

Navigate to any Opportunity record in Salesforce. You should see the four MarginArc widgets on the page. The Margin Advisor widget is your starting point.

### Step 2: Check Required Fields

MarginArc works best with complete data. Before scoring, confirm these fields are populated on the Opportunity:

- **Amount** (standard Salesforce field)
- **OEM** (Fulcrum_OEM\_\_c) -- which vendor's product is this deal for?
- **Planned Margin** (Fulcrum_Planned_Margin\_\_c) -- what margin % are you planning to quote?

### Step 3: Click "Score My Deal"

In the Margin Advisor widget, click the **Score My Deal** button. MarginArc sends the deal data to the intelligence engine and returns results in 2-3 seconds.

### Step 4: Read Your Results

You will see:

- **Deal Score** (0-100) -- a composite health score for this deal's pricing
- **Recommended Margin %** -- what MarginArc suggests based on the signals
- **Win Probability** -- estimated likelihood of closing at the recommended margin
- **Comparison Table** -- your plan vs. the recommendation side-by-side
- **Key Drivers** -- what factors are pushing the margin up or down
- **AI Analysis** -- a narrative explanation of the recommendation

### Step 5: Decide and Act

You have three choices:

1. **Apply the recommendation.** Click "Apply Recommendation" to write MarginArc's suggested margin, confidence score, and win probability back to the Opportunity fields.
2. **Adjust and re-score.** Fill in more deal fields (competitors, deal registration, services) and score again for a more accurate result.
3. **Proceed with your plan.** Use MarginArc's data as one input among many. The recommendation is guidance, not a mandate.

That's it. You just used MarginArc for the first time.

---

## 3. For Sales Reps

### 3a. Scoring a Deal

#### When to Score

Score a deal at these key moments:

- **When you first create the Opportunity.** Get an early read on pricing even with limited data.
- **After discovery calls.** As you learn more about competitors, requirements, and budget, re-score with updated fields.
- **Before submitting a quote.** Final validation that your pricing is competitive and defensible.
- **When deal dynamics change.** New competitor enters, deal registration approved, scope changes -- re-score.

#### How to Score

1. Open the Opportunity record.
2. Scroll to the **Margin Advisor** widget.
3. Click **Score My Deal**.
4. Wait 2-3 seconds for results to load.

#### What Happens Behind the Scenes

When you click Score My Deal, MarginArc:

1. Reads all available signals from the Opportunity, Account, and related records.
2. Sends the signal package to the MarginArc intelligence API.
3. The ML model calculates the optimal margin based on historical patterns, competitive dynamics, and network intelligence.
4. Gemini AI generates a human-readable explanation.
5. Results render in the widget -- Deal Score, recommendation, comparison, drivers, and analysis.

The entire round trip takes 2-3 seconds. No data leaves Salesforce except through the secured API connection to the MarginArc engine.

### 3b. Understanding the Deal Score

The Deal Score is a composite number from 0 to 100 that represents the overall health of your deal's pricing strategy.

#### Score Ranges

| Range  | Color        | Meaning                                                                                                 |
| ------ | ------------ | ------------------------------------------------------------------------------------------------------- |
| 80-100 | Green        | Excellent. Pricing is well-optimized for this deal's characteristics.                                   |
| 60-79  | Yellow-Green | Good. Minor adjustments could improve the outcome.                                                      |
| 40-59  | Yellow       | Fair. There are meaningful gaps between your plan and the optimal approach.                             |
| 20-39  | Orange       | Needs Attention. Pricing is significantly off -- either leaving money on the table or risking the deal. |
| 0-19   | Red          | Critical. The pricing strategy has serious issues that need immediate correction.                       |

#### What Makes Up the Score

The Deal Score is a weighted composite of five factors:

| Factor                   | Weight | What It Measures                                                   |
| ------------------------ | ------ | ------------------------------------------------------------------ |
| **Margin Alignment**     | 35%    | How close your planned margin is to the recommended margin.        |
| **Win Probability**      | 25%    | Estimated likelihood of winning at the recommended margin.         |
| **Risk-Adjusted Value**  | 20%    | Expected gross profit weighted by win probability.                 |
| **Deal Structure**       | 10%    | Whether deal registration, services, and value-adds are optimized. |
| **Competitive Position** | 10%    | How well-positioned you are against identified competitors.        |

#### How to Improve Your Score

- **Close the margin gap.** The single biggest lever. If MarginArc recommends 22% and you are planning 14%, your Margin Alignment score suffers.
- **Register the deal.** Deal registration boosts your competitive position and often enables higher margins.
- **Attach services.** Services mix improves Deal Structure and supports higher overall margins.
- **Document competitors.** Filling in competitor fields gives the model more to work with, improving accuracy.
- **Update account data.** Ensure Customer Segment and Relationship Strength are current on the Account.

### 3c. Reading the Recommendation

The **Recommended Margin** is the margin percentage that MarginArc's ML model calculates as optimal for this specific deal, given all available signals.

#### What "Optimal" Means

Optimal does not mean "highest possible margin." It means the margin that maximizes your **risk-adjusted gross profit** -- the expected GP weighted by the probability of actually winning the deal.

Example:

- A 30% margin on a $500K deal = $150K GP, but only 15% chance of winning = $22.5K risk-adjusted GP.
- A 20% margin on the same deal = $100K GP, but 65% chance of winning = $65K risk-adjusted GP.
- MarginArc would recommend closer to 20% because the risk-adjusted outcome is nearly 3x better.

#### When to Follow the Recommendation

Follow the recommendation when:

- You do not have strong contrary information that the model cannot see.
- The deal characteristics are well-captured in the Opportunity fields.
- You are unsure about pricing and want a data-backed starting point.

#### When to Adjust

Adjust the recommendation when:

- You have a verbal commitment or relationship context that the model cannot capture.
- The deal has unusual characteristics not reflected in the standard fields (e.g., a strategic land-and-expand play where you accept lower margin intentionally).
- Your manager has approved a specific pricing strategy for this account.

Even when you adjust, use the recommendation as your baseline and document why you diverged.

### 3d. The Comparison Table

The comparison table shows your current plan side-by-side with MarginArc's recommendation across five dimensions:

| Metric               | Your Plan                            | Recommended                                 |
| -------------------- | ------------------------------------ | ------------------------------------------- |
| **Margin %**         | Your Planned_Margin field value      | MarginArc's recommended margin                |
| **Sell Price**       | Calculated from your margin and cost | Calculated from recommended margin and cost |
| **Gross Profit ($)** | Dollar GP at your margin             | Dollar GP at recommended margin             |
| **Win Probability**  | Estimated win prob at your margin    | Estimated win prob at recommended margin    |
| **Risk-Adjusted GP** | GP x Win Prob at your margin         | GP x Win Prob at recommended margin         |

#### How to Read It

Focus on the **Risk-Adjusted GP** row. This is the number that matters most. It answers: "Given the probability of actually winning, what is the expected dollar value of each pricing approach?"

If MarginArc's Risk-Adjusted GP is significantly higher than yours, that means your current pricing is either:

- **Too aggressive** (high margin, low win probability, lower expected value), or
- **Too conservative** (low margin, high win probability, but leaving money on the table).

### 3e. Key Drivers

The Key Drivers section displays a horizontal bar chart showing which factors are pushing the recommended margin up or down relative to the base margin.

#### Reading the Chart

- **Green bars extending right** = factors pushing the margin **up** (you can charge more).
- **Red bars extending left** = factors pushing the margin **down** (competitive pressure or risk requires lower margin).
- **Bar length** = the magnitude of that factor's influence.

#### Common Drivers

| Driver               | Direction | What It Means                                              |
| -------------------- | --------- | ---------------------------------------------------------- |
| Deal Registration    | Up        | You have deal reg, which protects margin.                  |
| No Deal Registration | Down      | Without deal reg, competitors can undercut freely.         |
| Services Attached    | Up        | Services add value and support premium pricing.            |
| High Competition     | Down      | Multiple competitors are driving price pressure.           |
| Enterprise Segment   | Up        | Enterprise customers tolerate higher margins for value.    |
| SMB Segment          | Down      | SMB customers are more price-sensitive.                    |
| Strong Relationship  | Up        | Deep account relationships support margin.                 |
| New Customer         | Down      | Unproven relationships require competitive entry pricing.  |
| Quarter-End          | Down      | End-of-quarter urgency compresses margins.                 |
| Displacement Deal    | Down      | Displacing an incumbent requires aggressive pricing.       |
| High Value-Add       | Up        | Significant value-add justifies premium margins.           |
| Low Complexity       | Up        | Simpler deals have lower delivery risk, supporting margin. |

#### Using Drivers to Improve

Each driver is actionable. If "No Deal Registration" is dragging your margin down, ask yourself: can I register this deal? If "Low Value-Add" appears, consider whether you can propose additional services or integration work that increases your value story.

### 3f. AI Analysis

Below the drivers chart, MarginArc provides an **AI-generated narrative** powered by Google Gemini. This is a plain-English explanation of the recommendation.

#### What the Analysis Contains

- **Summary** of the key factors influencing this deal's pricing.
- **Explanation** of why the recommended margin is what it is.
- **Risk factors** the rep should be aware of.
- **Actionable suggestions** for improving the deal outcome.

#### How to Use It

- **In deal reviews.** Copy the analysis into your deal notes or share it with your manager for context.
- **In proposals.** Use the competitive positioning insights to strengthen your pitch.
- **For learning.** Read the analysis on every deal. Over time, you will develop better pricing instincts.

The AI analysis is regenerated every time you score a deal, so it always reflects the current state of the Opportunity.

### 3g. Applying the Recommendation

The **Apply Recommendation** button writes MarginArc's outputs back to the Opportunity record.

#### What Gets Written

When you click Apply Recommendation, three fields are updated on the Opportunity:

| Field                           | Value Written                                           |
| ------------------------------- | ------------------------------------------------------- |
| Fulcrum_Recommended_Margin\_\_c | The recommended margin percentage                       |
| Fulcrum_AI_Confidence\_\_c      | The model's confidence level in the recommendation      |
| Fulcrum_Win_Probability\_\_c    | The estimated win probability at the recommended margin |

#### When to Apply

- Apply when you agree with the recommendation and want it recorded on the Opportunity for tracking.
- Apply before deal reviews so your manager can see the MarginArc recommendation alongside your planned margin.
- Apply when you want to track the delta between your plan and the recommendation over time.

#### When Not to Apply

- Do not apply if you are just exploring or running what-if scenarios. Apply only represents a real recommendation you intend to reference.
- Do not apply if the Opportunity data is incomplete and you plan to re-score later with better inputs.

Applying the recommendation does **not** change your Planned Margin. Your plan and MarginArc's recommendation are tracked separately, which is intentional -- it lets you and your manager see where your judgment aligns or diverges from the model.

### 3h. Filling In Deal Fields

MarginArc uses 31 signals to generate recommendations. Seventeen are pulled automatically from CRM data and deal history. Six must be entered by the rep on each deal. The more you fill in, the more accurate the recommendation.

#### The Six Rep Fields

**1. Deal Registration Type** (`Fulcrum_Deal_Reg_Type__c`)

| Value           | When to Select                                                                          |
| --------------- | --------------------------------------------------------------------------------------- |
| Not Registered  | No deal registration filed with the OEM.                                                |
| Standard        | Standard deal registration filed and approved.                                          |
| Premium/Hunting | Premium or hunting registration (typically for new logos or competitive displacements). |

**Why it matters:** Deal registration is one of the strongest margin protectors. Registered deals typically command 3-8% higher margins because the OEM locks out competitor pricing. Always register deals when eligible.

**2. Services Attached** (`Fulcrum_Services_Attached__c`)

This is a checkbox. Check it if the deal includes professional services, managed services, installation, configuration, training, or any non-product deliverables.

**Why it matters:** Services demonstrate value-add and reduce the customer's perception of the deal as a commodity comparison. Deals with services typically achieve 2-5% higher product margins.

**3. Solution Complexity** (`Fulcrum_Solution_Complexity__c`)

| Value        | When to Select                                                             |
| ------------ | -------------------------------------------------------------------------- |
| Single       | Single-vendor, straightforward product sale.                               |
| Multi-vendor | Multi-vendor solution requiring integration, design, or architecture work. |

**Why it matters:** Multi-vendor solutions inherently have more value-add (integration expertise, architecture design) and less direct price comparison. This supports higher margins.

**4. Competitor Count** (`Fulcrum_Competitors__c`)

| Value | When to Select                       |
| ----- | ------------------------------------ |
| 0     | Sole-source or no known competitors. |
| 1     | One known competitor.                |
| 2     | Two known competitors.               |
| 3+    | Three or more known competitors.     |

**Why it matters:** Competitor count is the primary competitive pressure signal. Sole-source deals can hold much higher margins. Every additional competitor typically compresses margin by 2-4%.

**5. Competitor Names** (`Fulcrum_Competitor_Names__c`)

This is a multi-select picklist. Select all competitors you are aware of on this deal. Common values include CDW, SHI, Insight, Connection, Presidio, WWT, Zones, Trace3, and others configured by your admin.

**Why it matters:** Knowing _which_ competitors you face (not just how many) lets MarginArc pull head-to-head historical win/loss data and competitor-specific pricing strategies. Some competitors are consistently aggressive on price; others compete on value. MarginArc adjusts accordingly.

**6. Displacement Deal** (`Fulcrum_Deal_Type__c`)

Indicate whether this deal involves displacing an incumbent solution versus a net-new purchase or renewal.

**Why it matters:** Displacement deals typically require more aggressive pricing to overcome switching costs and inertia. MarginArc adjusts the recommendation downward for displacement scenarios.

#### Best Practice

Fill in all six fields as early as possible in the sales cycle. Even if you are uncertain (e.g., you suspect competitors but do not know who), enter your best estimate. You can always update and re-score. Partial data is better than no data.

### 3i. Using What-If Scenarios

The **What-If** widget lets you model different deal configurations without changing any actual Opportunity data.

#### How It Works

1. Open the What-If widget on the Opportunity page.
2. Adjust any of the following inputs:
   - **Competitors** -- change the number or identity of competitors.
   - **Deal Registration** -- toggle between Not Registered, Standard, and Premium.
   - **Solution Complexity** -- switch between Single and Multi-vendor.
   - **Relationship Strength** -- adjust from New to Strategic.
   - **Value-Add Level** -- change between Low, Medium, and High.
3. Click **Recalculate** (or the results update instantly, depending on your configuration).
4. See the updated recommendation, Deal Score, and win probability.

#### Example Scenarios

**"What if we get deal registration?"**
Change Deal Registration from Not Registered to Standard. See how much margin you gain and how the Deal Score improves. This quantifies the ROI of filing deal reg and can motivate you (or your manager) to push for it.

**"What if a second competitor enters?"**
Increase competitor count from 1 to 2. See how margin compresses and win probability changes. This helps you prepare for competitive scenarios and pre-position your pricing.

**"What if we attach services?"**
Toggle Services Attached on. See the margin impact. Use this to justify proposing services to the customer -- you can show the pricing benefit internally.

**"What if we upgrade the relationship?"**
Change Relationship Strength from Developing to Good. See the margin upside of deeper account engagement. This can inform account strategy discussions.

#### Important Notes

- What-If changes are **temporary**. They do not modify the actual Opportunity record.
- Use What-If in deal strategy sessions with your manager to explore options together.
- What-If is especially valuable early in the sales cycle when deal parameters are still fluid.

### 3j. Competitive Intelligence

The **Competitive Intel** widget provides head-to-head intelligence against specific competitors.

#### What You See

For each competitor identified on the deal, the widget shows:

- **Head-to-Head Record.** Your historical win/loss ratio against this competitor (e.g., "Won 12, Lost 5 against CDW").
- **Average Margin in Wins.** What margin you typically achieve when you beat this competitor.
- **Average Margin in Losses.** What margin you were at when you lost to this competitor.
- **Strategy Recommendation.** Specific tactical advice for competing against this competitor (e.g., "CDW competes primarily on price in SMB. Emphasize value-add and services to differentiate.").
- **Competitor Profile.** Key characteristics: typical pricing aggression, geographic strength, vertical focus, and known tactics.

#### How to Use It

- **Before discovery calls.** Check the competitor profile to anticipate their positioning.
- **In pricing discussions.** Use the margin-in-wins data to set realistic pricing expectations.
- **In proposals.** Incorporate competitive differentiation points from the strategy recommendations.
- **In loss reviews.** Compare the margin-in-losses data to understand whether price was the real issue.

#### Accuracy Note

Competitive intelligence improves with data volume. Early on, you may see limited head-to-head data. As your organization closes more deals with competitor tracking, the intelligence becomes significantly more accurate and actionable. This is one of the key benefits of consistently filling in the Competitor Names field.

### 3k. Deal Insights

The **Deal Insights** widget provides contextual tips and alerts based on the deal's characteristics.

#### Types of Insights

**OEM-Specific Tips**
Tips tailored to the vendor on the deal. Examples:

- "Cisco deal registration typically adds 5-7% margin protection. Ensure registration is filed before quoting."
- "Palo Alto Networks has aggressive Q4 discount programs. Check current promotions before finalizing pricing."

**Stage-Based Alerts**
Guidance triggered by the deal stage:

- "Deal is in Proposal stage without competitor information. Add competitors for a more accurate recommendation."
- "Deal approaching close date. Verify that the recommended margin accounts for any last-minute concessions."

**Industry Notes**
Context based on the customer's industry:

- "Healthcare deals typically require longer procurement cycles. Factor in deal velocity when assessing urgency."
- "Financial services customers prioritize compliance and support. Emphasize these in your value proposition."

**Deal Characteristic Warnings**
Alerts based on field combinations:

- "High competitor count with no deal registration. Margin risk is elevated."
- "Large deal with no services attached. Consider proposing implementation services to protect margin."

#### When Insights Appear

Insights are generated each time you score a deal or when the widget loads if a previous score exists. They update dynamically as you fill in more deal fields. The more complete your data, the more relevant and specific the insights become.

MarginArc supports OEM-specific insights for the following vendors: Cisco, Palo Alto Networks, HPE (Hewlett Packard Enterprise), Dell Technologies, Fortinet, VMware, Microsoft, Juniper Networks, Aruba, and NetApp. Your admin can add additional OEMs as needed.

### 3l. Tips for Better Scores

These are the highest-impact actions you can take to improve your Deal Scores and pricing outcomes.

#### Always Do

1. **Register every eligible deal.** This is the single biggest margin lever. Deal registration can add 3-8% to your margin and significantly boosts your Deal Score.

2. **Attach services wherever possible.** Even basic installation or configuration services add value-add perception and support higher margins.

3. **Document every known competitor.** The model cannot account for competitive pressure it does not know about. Even if you are unsure, enter your best guess and update later.

4. **Fill in all six rep fields.** Each empty field reduces recommendation accuracy. Five minutes of data entry can be worth thousands in GP.

5. **Score early and often.** Score at opportunity creation, after each major milestone, and before every quote. The recommendation evolves as your data evolves.

6. **Use What-If before quoting.** Model the best-case and worst-case scenarios. Enter the quote knowing the range.

7. **Read the AI Analysis.** It takes 30 seconds and often surfaces insights you would not have considered.

#### Avoid

1. **Do not ignore the recommendation without understanding it.** Even if you disagree, understand _why_ MarginArc recommended what it did. The drivers chart tells you exactly what is influencing the number.

2. **Do not leave competitor fields blank.** A deal with 0 competitors and no competitor names scores differently than a deal with unknown competitors. If you do not know, enter your best estimate for count.

3. **Do not wait until close to score.** By then, your pricing is locked. Score early when you can still influence the deal structure.

4. **Do not confuse Planned Margin with Recommended Margin.** They are separate fields tracked independently. Your plan is what you intend to quote. The recommendation is what the model suggests. The delta between them is valuable data.

---

## 4. For Sales Managers

### 4a. Manager Dashboard

The **MarginArc Manager Dashboard** is a standalone Lightning Tab that gives you a real-time, team-wide view of pipeline health, rep performance, margin opportunity, and competitive analytics — all in one place.

#### How to Access

Navigate to the **MarginArc Dashboard** tab in the Salesforce app navigation bar (or search for it in the App Launcher).

#### Dashboard Sections

**KPI Strip**
Four headline metrics at the top:
- **Total Pipeline** — aggregate dollar value of all open deals
- **Avg Margin Gap** — average difference between planned and recommended margins (green = within tolerance, red = significant gap)
- **Win Rate** — closed-won percentage for the selected time range
- **Compliance** — percentage of deals where planned margin is within 3pp of recommendation

**Alert Bar**
A single-line summary of deals with margin >3pp below recommendation, broken down by severity:
- **Critical (>10pp):** Deals with planned margin more than 10 percentage points below recommendation
- **Warning (3-10pp):** Deals with moderate margin gaps

**Pipeline Health Table**
A sortable, filterable, paginated table of all open deals:
- **Filter Pills:** Click to filter by status — All, Critical, Warning, Compliant, or Unanalyzed (each shows a count)
- **Columns:** Score, Deal, Account, Rep, Amount, Stage, Plan %, Rec %, Gap
- **Sorting:** Click any column header to sort ascending/descending
- **Pagination:** 25 deals per page with Prev/Next navigation
- **Click any row** to navigate directly to that Opportunity record

**Rep Performance** (requires historical data)
A table showing each rep's win rate, deal count, average margin, revenue won, and compliance rate for the selected time range (30d / 90d / 6m / 12m / All).

**Margin Opportunity**
A visual comparison showing current blended margin vs. potential margin if all reps followed MarginArc recommendations, with the GP$ uplift quantified.

**Competitive Performance**
Top 5 competitors by encounter frequency, showing win/loss record, win rate bar, and average margins in wins vs. losses.

#### Time Range Selector

Use the dropdown in the top-right corner to change the time range for historical data (Rep Performance, Win Rate KPI, and Competitive Performance). The pipeline table always shows current open deals regardless of time range.

### 4b. Team Deal Score Overview

MarginArc gives you an objective, data-backed view of your team's pricing behavior across the entire pipeline — both via the Manager Dashboard and via Salesforce reports.

#### What to Monitor

- **Average Deal Score by rep.** Identifies who is consistently pricing well and who needs coaching.
- **Deal Score distribution.** A healthy team has most deals in the 60-100 range. A cluster of deals below 40 signals systemic pricing problems.
- **Planned vs. Recommended delta by rep.** Shows which reps consistently diverge from recommendations and in which direction (too aggressive or too conservative).
- **Recommendation compliance rate.** What percentage of scored deals have the recommendation applied?

#### How to Access (Reports)

Work with your Salesforce admin to create a report on Opportunities with MarginArc fields. Key fields to include:

- Fulcrum_Margin\_\_c (Deal Score)
- Fulcrum_Planned_Margin\_\_c
- Fulcrum_Recommended_Margin\_\_c
- Fulcrum_Win_Probability\_\_c
- Fulcrum_AI_Confidence\_\_c
- Owner (rep name)

Group by Owner, summarize with averages, and you have a team pricing dashboard.

### 4c. Coaching with MarginArc

MarginArc is a powerful coaching tool because it replaces subjective pricing debates with objective, data-backed conversations.

#### In 1:1 Deal Reviews

For each deal under discussion:

1. Pull up the Opportunity record.
2. Look at the Deal Score. Is it green, yellow, or red?
3. Compare Planned Margin to Recommended Margin. How big is the gap?
4. Review the Key Drivers. What is pushing margin up or down?
5. Read the AI Analysis together. Does the rep agree with the assessment?

#### Coaching Questions to Ask

- "Your planned margin is 14% but MarginArc recommends 21%. Walk me through why you are pricing below the recommendation."
- "The Deal Score is 38. What can we do to improve it before you send the quote?"
- "The drivers show no deal registration. Is this deal eligible for registration?"
- "The competitive intel shows we win 70% against this competitor at 19% margin. Why are we pricing at 12%?"
- "The What-If shows that adding services would increase your recommended margin by 3%. Have you proposed services to the customer?"

#### Building Pricing Discipline

The goal is not to force reps to blindly follow every recommendation. The goal is to ensure every pricing decision is **informed and intentional**. When a rep diverges from the recommendation, they should be able to articulate why. Over time, this builds a culture of pricing discipline that compounds into significant margin improvement.

### 4d. Identifying Pricing Problems

MarginArc data can reveal systemic pricing issues across your team.

#### Warning Signs

| Pattern                                   | What It Indicates                                         | Action                                                                         |
| ----------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Rep consistently 5%+ below recommendation | Fear-based pricing; discounting to close                  | Coach on value selling; review win rate (often higher than they think)         |
| Rep consistently 5%+ above recommendation | Overpricing; losing winnable deals                        | Review loss rate and loss reasons; compare to peers                            |
| High Deal Scores but low win rate         | Good pricing but poor execution                           | Issue is not pricing -- look at sales process, demo quality, or responsiveness |
| Low Deal Scores but high win rate         | Underpricing; winning on price alone                      | Significant margin upside opportunity; gradual margin coaching                 |
| All deals scored 0 competitors            | Reps not entering competitive data                        | Training issue; mandate competitor field completion                            |
| Deal Scores dropping over time            | Increasing competitive pressure or data quality degrading | Investigate market changes; audit data completeness                            |

#### Using Reports

Create a monthly Salesforce report: Closed-Won Opportunities this month, grouped by Owner, showing:

- Average Planned Margin
- Average Recommended Margin
- Average Deal Score
- Total GP Actual vs. Total GP at Recommended Margin

The last comparison shows the exact dollar value your team left on the table by not following recommendations.

### 4e. Approving Deals

When evaluating deals for pricing approval, use MarginArc data to make faster, better decisions.

#### Quick Approval Checklist

1. **Deal Score above 60?** Pricing is in a reasonable range. Focus your review on deal-specific strategy.
2. **Planned Margin within 3% of Recommended?** The rep's judgment aligns with the model. Lower scrutiny needed.
3. **Key Drivers make sense?** Do the factors pushing margin up/down match what you know about the deal?
4. **AI Analysis flags any red flags?** Read the narrative for risk factors.
5. **Competitive Intel consistent?** Does the head-to-head data support the pricing approach?

If all five check out, approve with confidence. If any are off, dig deeper.

#### Escalation Triggers

- Deal Score below 30 on a deal over $100K
- Planned Margin more than 8% below Recommended
- AI Analysis flags high risk with no documented mitigation
- No competitors entered on a competitive deal

### 4f. Forecasting Impact

MarginArc data improves forecast accuracy in two ways:

**1. Win Probability Refinement**

MarginArc's win probability is based on deal characteristics and historical patterns, not just the rep's gut feeling. Incorporate Fulcrum_Win_Probability\_\_c into your weighted pipeline calculations for a more realistic forecast.

**2. GP Accuracy**

By tracking both Planned Margin and Recommended Margin, you can:

- Forecast GP at planned margins (what reps intend to quote)
- Forecast GP at recommended margins (what the data suggests)
- Forecast GP at risk-adjusted margins (weighted by win probability)

The delta between planned and recommended GP gives you a clear view of upside potential or downside risk in the pipeline.

---

## 5. For VP Sales / CRO

### 5a. Executive Dashboard Metrics

As a sales executive, you do not need to look at individual deals. You need aggregate metrics that tell you whether your organization is pricing effectively and improving over time.

#### Key Metrics to Track

| Metric                             | Definition                                                       | Target      | Cadence   |
| ---------------------------------- | ---------------------------------------------------------------- | ----------- | --------- |
| **Average Deal Score**             | Mean Deal Score across all scored Opportunities                  | >65         | Weekly    |
| **Recommendation Compliance Rate** | % of scored deals where rep applied the recommendation           | >60%        | Monthly   |
| **Margin Delta**                   | Average gap between Planned and Recommended Margin               | <3%         | Monthly   |
| **Win Rate at Recommendation**     | Win rate on deals where the recommendation was followed          | Track trend | Quarterly |
| **Win Rate Off Recommendation**    | Win rate on deals where the rep diverged >5% from recommendation | Track trend | Quarterly |
| **GP Uplift**                      | Incremental GP from recommendation adoption vs. prior quarter    | Positive    | Quarterly |
| **Scoring Adoption**               | % of Opportunities that have been scored at least once           | >80%        | Monthly   |
| **Data Completeness**              | % of scored Opportunities with all 6 rep fields populated        | >70%        | Monthly   |

#### Dashboard Layout

Work with Sales Ops to build a Salesforce dashboard with these components:

1. **Deal Score Distribution** (histogram) -- shows pricing health across the pipeline
2. **Compliance Rate Trend** (line chart) -- tracks whether reps are adopting recommendations over time
3. **Margin Delta by Rep** (bar chart) -- identifies outliers who need coaching
4. **GP Impact** (KPI tile) -- the dollar value of following vs. not following recommendations
5. **Adoption Heatmap** (matrix) -- scoring and data completeness by team/rep

### 5b. Building a Pricing Culture

MarginArc is a tool. The real transformation is cultural. Here is how to drive it.

#### Phase 1: Awareness (Month 1)

- Announce MarginArc at an all-hands or sales kickoff.
- Position it as a tool that helps reps win, not a surveillance system.
- Share an example of a deal where the recommendation would have added significant GP.
- Set the expectation: every deal gets scored, every quote is informed by data.

#### Phase 2: Adoption (Month 2-3)

- Require Deal Scores in all deal reviews and forecast calls.
- Recognize reps with the highest Deal Scores (not just the highest revenue).
- Share weekly stats: team average Deal Score, compliance rate, GP impact.
- Have managers coach with MarginArc data in every 1:1.

#### Phase 3: Accountability (Month 4+)

- Include Deal Score metrics in rep scorecards.
- Track recommendation compliance as a leading indicator alongside quota attainment.
- Establish pricing approval workflows that reference MarginArc data.
- Publish monthly leaderboards: best Deal Scores, highest compliance, most improved.

#### Phase 4: Competitive Advantage (Month 6+)

- As the model matures (Phase 3-4), your recommendations become highly accurate.
- Network intelligence means your pricing strategy improves with every deal, across the entire organization.
- This is an institutional asset that competitors cannot easily replicate.

### 5c. Competitive Moat

MarginArc's intelligence improves over time through four distinct phases of machine learning maturity.

| Phase   | Timeline  | Signals | Accuracy | What Changes                                                                       |
| ------- | --------- | ------- | -------- | ---------------------------------------------------------------------------------- |
| Phase 1 | Day 1     | 15      | 68%      | Bayesian priors from industry data. Good baseline, limited personalization.        |
| Phase 2 | Month 1-3 | 20      | 79%      | Personalized kNN activates. Recommendations adapt to your specific deal patterns.  |
| Phase 3 | Month 3-6 | 27      | 88%      | Ensemble model + network intelligence. Peer data and multi-signal optimization.    |
| Phase 4 | Year 1+   | 31      | 94%      | Online learning. Full signal suite. Continuously improving with every closed deal. |

The competitive moat is this: **every deal your organization closes makes every future recommendation smarter.** A competitor starting from scratch is 6-12 months behind you from day one. The longer you use MarginArc, the wider the gap.

This is why early adoption matters. The organizations that start building their data asset now will have a significant intelligence advantage over those who wait.

---

## 6. FAQ for Users

### General

**Q: Does MarginArc replace my judgment as a sales rep?**
A: No. MarginArc is a decision-support tool that provides data-backed recommendations. You always make the final pricing decision. Think of it as a GPS for pricing -- it shows the recommended route, but you can choose a different path if you have a good reason.

**Q: How long does it take to get a score?**
A: 2-3 seconds after clicking Score My Deal.

**Q: Can I score the same deal multiple times?**
A: Yes, and you should. Re-score whenever deal parameters change -- new competitors, deal registration approved, scope change, stage progression. Each score reflects the latest data.

**Q: Does MarginArc work on all Opportunity types?**
A: MarginArc works on any Opportunity record where the widgets are deployed. It is most accurate for product-centric deals with a known OEM. Pure services-only deals will generate recommendations but with lower confidence.

**Q: What happens if I score a deal with very little data?**
A: MarginArc will still generate a recommendation using whatever signals are available plus industry-wide Bayesian priors. The confidence score will be lower, and the AI Analysis will note the data limitations. You will get a better recommendation by filling in more fields.

### Scoring

**Q: Why did my Deal Score change from yesterday?**
A: Deal Scores are recalculated fresh each time you score. If any Opportunity, Account, or competitive data changed since the last score, the result may differ. Additionally, network intelligence updates as peer deals close, which can shift baseline margins.

**Q: My Deal Score is low but I think my pricing is right. What should I do?**
A: Read the Key Drivers to understand what is pulling the score down. If the factors are real (e.g., high competition, no deal reg), the score is accurately reflecting a challenging deal -- it does not mean you are wrong, just that the deal has pricing headwinds. If the factors seem wrong (e.g., you have deal reg but the field is not checked), update your data and re-score.

**Q: Can I see historical Deal Scores for a deal?**
A: The current score overwrites the previous score on each scoring event. If you need historical tracking, ask your admin to set up a flow that logs each scoring event to a related object.

**Q: What is a "good" Deal Score?**
A: Above 60 is good. Above 80 is excellent. The team average across the industry tends to be 45-55, so anything above 60 means you are pricing better than most.

### Recommendations

**Q: The recommended margin seems too high. Should I trust it?**
A: Check the Key Drivers and AI Analysis to understand why. Common reasons for higher-than-expected recommendations: strong deal registration, sole-source deal, strategic account relationship, high value-add. If these factors are accurate, the higher margin is supported by data. If they are wrong, correct the fields and re-score.

**Q: The recommended margin seems too low. Why?**
A: Common reasons: high competitor count, aggressive competitors identified, no deal registration, new customer relationship, displacement deal. MarginArc prioritizes risk-adjusted GP -- sometimes a lower margin with a higher win probability yields a better expected outcome.

**Q: What does "Apply Recommendation" actually do to my Opportunity?**
A: It writes three fields: Recommended Margin, AI Confidence, and Win Probability. It does **not** change your Planned Margin, Amount, or any other field. Your plan and the recommendation are tracked separately.

**Q: If I apply the recommendation and then re-score, does it overwrite?**
A: The recommendation fields reflect the most recent scoring event. If you re-score and apply again, the new values overwrite the previous ones.

### Competitive Intelligence

**Q: Where does the head-to-head data come from?**
A: From your organization's closed Opportunities where competitors were identified. The more consistently your team enters competitor names, the richer this data becomes.

**Q: I see a competitor in the picklist that is not in the Competitive Intel widget. Why?**
A: The Competitive Intel widget requires a minimum number of historical data points to display meaningful intelligence. If you have very few closed deals against a particular competitor, the widget may not have enough data to show reliable stats yet.

**Q: Can I add a competitor that is not in the picklist?**
A: Ask your Salesforce admin. They manage the multi-select picklist values for Fulcrum_Competitor_Names\_\_c.

### Technical

**Q: MarginArc is not showing on my Opportunity page. What do I do?**
A: Contact your Salesforce admin. They need to add the MarginArc LWC components to the Opportunity Lightning Record Page layout. Also verify that your profile has the necessary field-level security permissions.

**Q: I am getting an error when I click Score My Deal. What should I do?**
A: Check your internet connection first. If the issue persists, report it to your Salesforce admin with the error message. Common causes: CSP Trusted Sites not configured, API connectivity issues, or field permission problems.

**Q: Does MarginArc work on mobile?**
A: MarginArc's LWC components render in the Salesforce mobile app, but the experience is optimized for desktop. The widgets will function on mobile but the charts and comparison tables are best viewed on a larger screen.

**Q: How secure is my deal data?**
A: MarginArc data stays within your Salesforce org. The only external communication is the API call to the MarginArc intelligence engine for scoring and the Gemini API for AI analysis. Both connections use HTTPS encryption. No deal data is stored outside your Salesforce instance.

---

## 7. Glossary

### Deal Score

A composite score from 0-100 that represents the overall health of a deal's pricing strategy. Calculated from five weighted factors: Margin Alignment (35%), Win Probability (25%), Risk-Adjusted Value (20%), Deal Structure (10%), and Competitive Position (10%). Displayed on a red-to-green color spectrum.

### Recommended Margin

The margin percentage that MarginArc's ML model calculates as optimal for a specific deal, given all available signals. "Optimal" means the margin that maximizes risk-adjusted gross profit -- not the highest margin, but the margin that produces the best expected outcome when weighted by win probability.

### Win Probability

The estimated likelihood of winning a deal at a given margin percentage. Calculated using a logistic function: P(win) = 1 / (1 + e^(0.08 x (margin% - 18))), with adjustments based on deal-specific factors (competitors, deal registration, relationship strength, etc.). Expressed as a percentage from 0% to 100%.

### Risk-Adjusted Gross Profit

The expected gross profit of a deal weighted by its win probability. Formula: Risk-Adjusted GP = Gross Profit x Win Probability. This is the key metric MarginArc optimizes for, because it captures both the margin potential and the realistic likelihood of realizing it.

### Planned Margin

The margin percentage the sales rep intends to quote on a deal. This is the rep's planned pricing, entered in Fulcrum_Planned_Margin\_\_c. It is tracked separately from the Recommended Margin to allow comparison between human judgment and model guidance.

### Deal Registration

An agreement with an OEM vendor that protects a specific deal opportunity for a VAR. Deal registration typically provides pricing protection (competitors cannot access the same discounts), additional margin points, and competitive advantage. One of the strongest margin drivers in the MarginArc model.

### Signal

A data point that MarginArc uses to generate recommendations. There are 31 total signals across four categories: AUTO (17 signals synced automatically from CRM), REP (6 signals entered by the sales rep per deal), ACCT (2 signals set by the admin per account), and NET (6 signals provided by MarginArc's network intelligence).

### Feature

In machine learning context, a feature is a processed signal that serves as an input to the model. MarginArc transforms raw signals into features (e.g., normalizing margin percentages, encoding categorical values) before feeding them to the ML algorithm.

### Network Intelligence

Anonymized, aggregated insights derived from deal patterns across the broader MarginArc user base (for multi-tenant deployments) or across an organization's historical data. Network intelligence includes peer win rates, margin bands, deal velocity norms, regional variance, and competitive tactics. It becomes available in Phase 3 (Month 3-6) of the intelligence maturity timeline.

### OEM (Original Equipment Manufacturer)

The technology vendor whose products are being sold through the VAR. Examples: Cisco, Palo Alto Networks, HPE, Dell Technologies. Each OEM has different base margin structures, deal registration programs, and competitive dynamics that MarginArc incorporates into its recommendations.

### VAR (Value-Added Reseller)

A company that resells technology products and adds value through services such as installation, configuration, integration, training, and support. MarginArc is built specifically for the VAR pricing model.

### Bayesian Priors

Statistical baselines derived from industry data that MarginArc uses in Phase 1 (Day 1) before it has enough organization-specific data to personalize recommendations. These priors provide a reasonable starting point for margin recommendations based on general IT VAR deal patterns.

### kNN (k-Nearest Neighbors)

A machine learning algorithm that finds deals most similar to the current one and uses their outcomes to inform the recommendation. MarginArc activates personalized kNN in Phase 2 (Month 1-3) once enough organizational deal data has been collected.

### Ensemble Model

A machine learning approach that combines multiple algorithms to produce more accurate predictions than any single model. MarginArc's ensemble activates in Phase 3 (Month 3-6) and incorporates Bayesian, kNN, and network intelligence signals.

### Online Learning

A machine learning paradigm where the model continuously updates its parameters as new data arrives, rather than being retrained in batches. MarginArc activates online learning in Phase 4 (Year 1+), meaning every closed deal immediately improves future recommendations.

### Margin Alignment

One of the five Deal Score components (35% weight). Measures how closely the rep's planned margin matches MarginArc's recommended margin. Perfect alignment scores 100%; large deviations reduce the score.

### Competitive Position

One of the five Deal Score components (10% weight). Evaluates the deal's competitive landscape: number and identity of competitors, deal registration status, and historical performance against identified competitors.

### Deal Structure

One of the five Deal Score components (10% weight). Assesses whether the deal includes margin-supporting elements: deal registration, services attachment, value-add level, and solution complexity.

### Displacement Deal

A deal where the VAR is attempting to replace an existing incumbent vendor or reseller. Displacement deals typically require more aggressive pricing to overcome switching costs and the customer's inertia, and MarginArc adjusts recommendations accordingly.

### Customer Segment

A classification of the customer's size and buying behavior: SMB (Small/Medium Business), Mid-Market, Enterprise, or Public Sector. Set at the account level by the admin. Each segment has different margin expectations and pricing sensitivity.

### Relationship Strength

A classification of the VAR's relationship depth with the customer: New, Developing, Good, or Strategic. Set at the account level. Stronger relationships support higher margins due to trust, reduced competition, and switching cost dynamics.

---

_MarginArc User Guide v1.0 -- Last updated February 2026_
