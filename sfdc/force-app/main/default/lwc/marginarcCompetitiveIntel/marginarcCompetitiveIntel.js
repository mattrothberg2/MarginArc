/**
 * MarginArc Competitive Intelligence Widget
 *
 * Shows account-specific competitive data including:
 * - Historical win/loss record against competitors
 * - What strategies work at this account
 * - Recommendations for new sellers
 */
import { LightningElement, api, wire, track } from "lwc";
import { getRecord } from "lightning/uiRecordApi";
import getAccountIntelligence from "@salesforce/apex/MarginArcCompetitiveController.getAccountIntelligence";
import getCompetitorProfile from "@salesforce/apex/MarginArcCompetitiveController.getCompetitorProfile";
// Widget version
const WIDGET_VERSION = "4.0";
const LAST_UPDATED = "2026-02-07";

// Apex Decimal values don't always arrive as JS Number.
// This helper ensures all numeric operations work correctly.
function n(val) {
  return val == null ? 0 : Number(val);
}

// Opportunity fields to query
const OPPORTUNITY_FIELDS = [
  "Opportunity.AccountId",
  "Opportunity.Account.Name",
  "Opportunity.Account.Industry"
];

export default class MarginarcCompetitiveIntel extends LightningElement {
  @api recordId;
  @track accountData = null;
  @track similarAccountData = null;
  @track isLoading = true;
  @track error = null;
  @track hasHistory = false;
  @track message = "";
  @track selectedCompetitor = null;
  @track showCompetitorModal = false;

  accountId = null;
  accountName = "";
  accountIndustry = "";

  /**
   * Wire adapter to get opportunity record
   */
  @wire(getRecord, { recordId: "$recordId", fields: OPPORTUNITY_FIELDS })
  wiredOpportunity({ error, data }) {
    if (data) {
      // Access relationship fields directly from record data structure
      this.accountId = data.fields?.AccountId?.value || null;
      this.accountName = data.fields?.Account?.value?.fields?.Name?.value || "";
      this.accountIndustry =
        data.fields?.Account?.value?.fields?.Industry?.value || "";
      this.loadAccountIntelligence();
    } else if (error) {
      console.error("Wire adapter error:", JSON.stringify(error));
      this.error =
        "Unable to load opportunity data: " +
        (error.body?.message || error.message || "Unknown error");
      this.isLoading = false;
    }
  }

  /**
   * Load competitive intelligence for the account
   */
  async loadAccountIntelligence() {
    this.isLoading = true;
    this.error = null;

    try {
      const result = await getAccountIntelligence({
        accountId: this.accountId,
        accountIndustry: this.accountIndustry
      });

      if (result.error) {
        this.error = result.error;
      } else if (result.hasHistory) {
        this.hasHistory = true;
        this.accountData = this.processAccountData(result.accountData);
      } else {
        this.hasHistory = false;
        this.similarAccountData = result.similarAccounts;
        this.message = result.message;
      }
    } catch (err) {
      console.error("Competitive intel error:", err);
      this.error =
        err.body?.message ||
        err.message ||
        "Error loading competitive intelligence";
    } finally {
      this.isLoading = false;
    }
  }

  /**
   * Process account data for display
   */
  processAccountData(data) {
    if (!data) return null;

    // Process competitor matchups for display
    const matchups = (data.competitorMatchups || []).map((m) => {
      const wr = n(m.winRate);
      const wins = n(m.wins);
      const losses = n(m.losses);
      const total = wins + losses;

      // Build W/L dot indicators (cap at 10 for display, then summarize)
      const dots = [];
      const maxDots = 10;
      if (total <= maxDots) {
        for (let i = 0; i < wins; i++)
          dots.push({ key: `w${i}`, cssClass: "dot dot-win" });
        for (let i = 0; i < losses; i++)
          dots.push({ key: `l${i}`, cssClass: "dot dot-loss" });
      } else {
        // Scale down proportionally
        const scaledWins = Math.round((wins / total) * maxDots);
        const scaledLosses = maxDots - scaledWins;
        for (let i = 0; i < scaledWins; i++)
          dots.push({ key: `w${i}`, cssClass: "dot dot-win" });
        for (let i = 0; i < scaledLosses; i++)
          dots.push({ key: `l${i}`, cssClass: "dot dot-loss" });
      }

      return {
        ...m,
        winRatePercent: Math.round(wr * 100),
        record: `${wins}W – ${losses}L`,
        hasMarginData: m.avgMarginWon != null,
        marginDisplay:
          m.avgMarginWon != null ? `${n(m.avgMarginWon).toFixed(1)}%` : null,
        threatClass:
          m.threat === "High"
            ? "threat-high"
            : m.threat === "Low"
              ? "threat-low"
              : "threat-medium",
        dots: dots,
        totalDeals: total,
        winRateClass:
          wr >= 0.55
            ? "winrate-good"
            : wr >= 0.45
              ? "winrate-neutral"
              : "winrate-bad"
      };
    });

    // Process recent deals
    const recentDeals = (data.recentDeals || []).map((d) => ({
      ...d,
      sizeFormatted: this.formatCurrency(d.size),
      marginDisplay: d.margin != null ? `${n(d.margin).toFixed(1)}%` : "—",
      outcomeClass: d.outcome === "Won" ? "outcome-won" : "outcome-lost",
      dateFormatted: this.formatDate(d.date)
    }));

    // Process what works
    const whatWorks = data.whatWorks || {};
    const strategies = [];

    const swr = n(whatWorks.servicesWinRate);
    if (swr > 0.55 && n(whatWorks.servicesDeals) > 10) {
      strategies.push({
        label: "Services-attached deals",
        winRate: Math.round(swr * 100),
        deals: whatWorks.servicesDeals,
        isGood: true,
        description: `${whatWorks.servicesDeals} deals, ${Math.round(swr * 100)}% win rate`
      });
    }

    const hwr = n(whatWorks.hardwareOnlyWinRate);
    if (hwr && n(whatWorks.hardwareOnlyDeals) > 10) {
      strategies.push({
        label: "Hardware-only deals",
        winRate: Math.round(hwr * 100),
        deals: whatWorks.hardwareOnlyDeals,
        isGood: hwr > 0.5,
        description: `${whatWorks.hardwareOnlyDeals} deals, ${Math.round(hwr * 100)}% win rate`
      });
    }

    const drwr = n(whatWorks.dealRegWinRate);
    if (drwr > 0.55) {
      strategies.push({
        label: "Deal registration",
        winRate: Math.round(drwr * 100),
        isGood: true,
        description: `${Math.round(drwr * 100)}% win rate when registered`
      });
    }

    const towr = n(whatWorks.topOemWinRate);
    if (whatWorks.topOem && towr) {
      strategies.push({
        label: `${whatWorks.topOem} deals`,
        winRate: Math.round(towr * 100),
        isGood: towr > 0.55,
        description: `${Math.round(towr * 100)}% win rate on ${whatWorks.topOem}`
      });
    }

    return {
      ...data,
      revenueFormatted: this.formatCurrency(data.totalRevenue),
      avgDealSizeFormatted: this.formatCurrency(data.avgDealSize),
      winRatePercent: Math.round(n(data.winRate) * 100),
      avgMarginPercent: n(data.avgMargin).toFixed(1),
      competitorMatchups: matchups,
      recentDeals: recentDeals,
      strategies: strategies,
      relationshipClass:
        data.relationship === "Strategic"
          ? "relationship-strategic"
          : data.relationship === "Good"
            ? "relationship-good"
            : "relationship-new"
    };
  }

  /**
   * Format currency for display
   */
  formatCurrency(value) {
    const v = n(value);
    if (!v) return "$0";
    if (v >= 1000000) {
      return `$${(v / 1000000).toFixed(1)}M`;
    } else if (v >= 1000) {
      return `$${(v / 1000).toFixed(0)}K`;
    }
    return `$${v.toFixed(0)}`;
  }

  /**
   * Format date for display
   */
  formatDate(dateStr) {
    if (!dateStr) return "";
    const date = new Date(dateStr);
    return date.toLocaleDateString("en-US", {
      month: "short",
      year: "numeric"
    });
  }

  /**
   * Handle competitor click for more details
   */
  async handleCompetitorClick(event) {
    const competitorName = event.currentTarget.dataset.competitor;
    this.selectedCompetitor = null;
    this.showCompetitorModal = true;

    try {
      const profile = await getCompetitorProfile({ competitorName });
      this.selectedCompetitor = {
        ...profile,
        priceAggressionDisplay:
          "★".repeat(profile.priceAggression) +
          "☆".repeat(5 - profile.priceAggression),
        servicesDisplay:
          "★".repeat(profile.servicesCapability) +
          "☆".repeat(5 - profile.servicesCapability)
      };
    } catch (err) {
      console.error("Error loading competitor profile:", err);
      // Show fallback profile so modal doesn't spin forever
      this.selectedCompetitor = {
        name: competitorName,
        strength: "Unknown",
        priceAggression: 3,
        servicesCapability: 3,
        primaryOems: "Various",
        howToWin: "Focus on services differentiation and technical expertise.",
        typicalDiscount: "N/A",
        priceAggressionDisplay: "★★★☆☆",
        servicesDisplay: "★★★☆☆"
      };
    }
  }

  /**
   * Close competitor modal
   */
  handleModalKeydown(event) {
    if (event.key === "Escape") this.closeCompetitorModal();
  }

  closeCompetitorModal() {
    this.showCompetitorModal = false;
    this.selectedCompetitor = null;
  }

  stopPropagation(event) {
    event.stopPropagation();
  }

  /**
   * Refresh data
   */
  handleRefresh() {
    this.loadAccountIntelligence();
  }

  // =========================================================================
  // Getters for template
  // =========================================================================

  get widgetVersion() {
    return WIDGET_VERSION;
  }

  get lastUpdated() {
    return LAST_UPDATED;
  }

  get hasAccountData() {
    return this.hasHistory && this.accountData;
  }

  get hasSimilarData() {
    return !this.hasHistory && this.similarAccountData;
  }

  get showError() {
    return this.error && !this.isLoading;
  }

  get showContent() {
    return !this.isLoading && !this.error;
  }

  get competitorMatchups() {
    return this.accountData?.competitorMatchups || [];
  }

  get recentDeals() {
    return this.accountData?.recentDeals || [];
  }

  get strategies() {
    return this.accountData?.strategies || [];
  }

  get similarInsights() {
    return this.similarAccountData?.keyInsights || [];
  }

  get similarCompetitors() {
    return this.similarAccountData?.topCompetitors || [];
  }

  get hasStrategies() {
    return this.strategies.length > 0;
  }

  get displayAccountName() {
    return this.accountName || "Unknown Account";
  }
}
