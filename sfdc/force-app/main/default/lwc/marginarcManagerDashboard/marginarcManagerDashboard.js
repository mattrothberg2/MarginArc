import { LightningElement, wire, track } from "lwc";
import { NavigationMixin } from "lightning/navigation";
import getPipelineSummary from "@salesforce/apex/MarginArcManagerController.getPipelineSummary";
import getHistoricalPerformance from "@salesforce/apex/MarginArcManagerController.getHistoricalPerformance";
import getUserContext from "@salesforce/apex/MarginArcManagerController.getUserContext";
import getTeamComparison from "@salesforce/apex/MarginArcManagerController.getTeamComparison";
import getRepDetail from "@salesforce/apex/MarginArcManagerController.getRepDetail";
import getBackfillSummary from "@salesforce/apex/MarginArcManagerController.getBackfillSummary";
import getBackfillDetails from "@salesforce/apex/MarginArcManagerController.getBackfillDetails";

const WIDGET_VERSION = "1.0";

// Apex Decimal → JS Number helper
function n(val) {
  return val == null ? 0 : Number(val);
}

function fmt$(val) {
  const v = n(val);
  if (v >= 1000000) return "$" + (v / 1000000).toFixed(1) + "M";
  if (v >= 1000) return "$" + (v / 1000).toFixed(0) + "K";
  return "$" + v.toFixed(0);
}

function fmtPct(val, decimals = 1) {
  return n(val).toFixed(decimals) + "%";
}

function fmtPp(val) {
  const v = n(val);
  const sign = v > 0 ? "+" : "";
  return sign + v.toFixed(1) + "pp";
}

const TIME_RANGE_OPTIONS = [
  { label: "Last 30 Days", value: "30d" },
  { label: "Last 90 Days", value: "90d" },
  { label: "Last 6 Months", value: "6m" },
  { label: "Last 12 Months", value: "12m" },
  { label: "All Time", value: "all" }
];

const SORT_FIELDS = {
  dealScore: "dealScore",
  name: "name",
  amount: "amount",
  plannedMargin: "plannedMargin",
  recommendedMargin: "recommendedMargin",
  marginGap: "marginGap",
  predictionQuality: "predictionQuality"
};

const PAGE_SIZE = 25;

const FILTER_DEFS = [
  { value: "all", label: "All" },
  { value: "critical", label: "Critical" },
  { value: "warning", label: "Warning" },
  { value: "compliant", label: "Aligned" },
  { value: "unanalyzed", label: "Unanalyzed" }
];

export default class MarginarcManagerDashboard extends NavigationMixin(
  LightningElement
) {
  @track pipelineData = null;
  @track historicalData = null;
  @track pipelineError = null;
  @track historicalError = null;
  @track selectedTimeRange = "90d";
  @track sortField = "dealScore";
  @track sortDirection = "desc";
  @track collapsedSections = {};
  @track activeFilter = "all";
  @track currentPage = 1;
  @track selectedTeamFilter = null;
  @track teamComparisonData = null;
  @track showRepModal = false;
  @track repModalData = null;
  @track _userContextData = null;
  @track backfillSummaryData = null;
  @track backfillDetailsData = null;

  _showDropdown = false;
  widgetVersion = WIDGET_VERSION;
  timeRangeOptions = TIME_RANGE_OPTIONS;

  // User context wire
  @wire(getUserContext)
  wiredUserContext({ data, error }) {
    if (data) {
      this._userContextData = data;
    } else if (error) {
      this._userContextData = null;
    }
  }

  // Pipeline wire
  @wire(getPipelineSummary, { teamFilter: "$selectedTeamFilter" })
  wiredPipeline({ data, error }) {
    if (data) {
      this.pipelineData = data;
      this.pipelineError = null;
    } else if (error) {
      this.pipelineError =
        error.body?.message || error.message || "Unable to load pipeline data";
      this.pipelineData = null;
    }
  }

  // Historical wire — reactive on selectedTimeRange and selectedTeamFilter
  @wire(getHistoricalPerformance, {
    timeRange: "$selectedTimeRange",
    teamFilter: "$selectedTeamFilter"
  })
  wiredHistorical({ data, error }) {
    if (data) {
      this.historicalData = data;
      this.historicalError = null;
    } else if (error) {
      this.historicalError =
        error.body?.message ||
        error.message ||
        "Unable to load historical data";
      this.historicalData = null;
    }
  }

  // Team comparison wire — reactive on selectedTimeRange
  @wire(getTeamComparison, { timeRange: "$selectedTimeRange" })
  wiredTeamComparison({ data, error }) {
    if (data) {
      this.teamComparisonData = data;
    } else if (error) {
      this.teamComparisonData = null;
    }
  }

  // Backfill summary wire
  @wire(getBackfillSummary)
  wiredBackfillSummary({ data, error }) {
    if (data) {
      this.backfillSummaryData = data;
    } else if (error) {
      this.backfillSummaryData = null;
    }
  }

  // Backfill details wire
  @wire(getBackfillDetails)
  wiredBackfillDetails({ data, error }) {
    if (data) {
      this.backfillDetailsData = data;
    } else if (error) {
      this.backfillDetailsData = null;
    }
  }

  // ── Loading / Error ──
  get isLoading() {
    return !this.pipelineData && !this.pipelineError;
  }
  get hasError() {
    return this.pipelineError || this.historicalError;
  }
  get errorMessage() {
    return this.pipelineError || this.historicalError;
  }
  get hasPipelineData() {
    return this.pipelineData && !this.pipelineError;
  }
  get hasHistoricalData() {
    return this.historicalData && !this.historicalError;
  }

  // ── KPI Cards ──
  get kpis() {
    if (!this.pipelineData?.kpis) return null;
    const k = this.pipelineData.kpis;
    return {
      totalPipeline: fmt$(k.totalPipeline),
      dealCount: n(k.dealCount),
      avgMarginGap: fmtPp(k.avgMarginGap),
      avgMarginGapClass:
        n(k.avgMarginGap) >= 0
          ? "kpi-value kpi-positive"
          : "kpi-value kpi-negative",
      complianceRate: fmtPct(k.complianceRate, 0),
      complianceClass:
        n(k.complianceRate) >= 70
          ? "kpi-value kpi-positive"
          : n(k.complianceRate) >= 50
            ? "kpi-value kpi-amber"
            : "kpi-value kpi-negative",
      alertCount: n(k.alertCount),
      ragpDelta:
        (n(k.ragpDelta) >= 0 ? "\u25B2 +" : "\u25BC ") + fmt$(k.ragpDelta),
      ragpDeltaClass:
        n(k.ragpDelta) >= 0
          ? "kpi-value kpi-positive"
          : "kpi-value kpi-negative",
      adoptionRate: fmtPct(k.adoptionRate, 0),
      adoptionClass:
        n(k.adoptionRate) >= 70
          ? "kpi-value kpi-positive"
          : n(k.adoptionRate) >= 50
            ? "kpi-value kpi-amber"
            : "kpi-value kpi-negative",
      avgPredictionQuality: n(
        this.pipelineData?.kpis?.avgPredictionQuality
      ).toFixed(0),
      avgPredictionQualityClass:
        n(this.pipelineData?.kpis?.avgPredictionQuality) >= 70
          ? "kpi-value kpi-positive"
          : n(this.pipelineData?.kpis?.avgPredictionQuality) >= 50
            ? "kpi-value kpi-amber"
            : "kpi-value kpi-negative"
    };
  }

  get winRateDisplay() {
    if (!this.historicalData) return "--";
    return fmtPct(this.historicalData.winRate, 0);
  }
  get winRateClass() {
    if (!this.historicalData) return "kpi-value";
    const wr = n(this.historicalData.winRate);
    if (wr >= 55) return "kpi-value kpi-positive";
    if (wr >= 40) return "kpi-value kpi-amber";
    return "kpi-value kpi-negative";
  }

  // ── Alerts ──
  get alertSummary() {
    if (!this.pipelineData?.alerts) return null;
    const alerts = this.pipelineData.alerts;
    if (alerts.length === 0) return null;
    let criticalCount = 0;
    let warningCount = 0;
    for (const a of alerts) {
      if (n(a.gap) < -10) criticalCount++;
      else warningCount++;
    }
    return { total: alerts.length, criticalCount, warningCount };
  }
  get hasAlerts() {
    return this.alertSummary !== null;
  }
  get alertSummaryText() {
    const s = this.alertSummary;
    if (!s) return "";
    let text =
      s.total +
      " deal" +
      (s.total !== 1 ? "s" : "") +
      " with margin >3pp below recommendation";
    const parts = [];
    if (s.criticalCount > 0) parts.push(s.criticalCount + " critical (>10pp)");
    if (s.warningCount > 0) parts.push(s.warningCount + " warning");
    if (parts.length > 0) text += " \u2014 " + parts.join(", ");
    return text;
  }

  // ── Pipeline Deals (sorted → filtered → paginated) ──
  get allSortedDeals() {
    if (!this.pipelineData?.deals) return [];
    const deals = this.pipelineData.deals.map((d) => {
      const gap = d.marginGap;
      const hasGap = gap != null;
      let gapClass = "cell-gap";
      if (hasGap) {
        if (n(gap) < -3) gapClass = "cell-gap gap-alert";
        else if (n(gap) < 0) gapClass = "cell-gap gap-warn";
        else gapClass = "cell-gap gap-ok";
      }

      let scoreClass = "score-circle";
      const score = n(d.dealScore);
      if (score >= 70) scoreClass += " score-good";
      else if (score >= 40) scoreClass += " score-fair";
      else scoreClass += " score-poor";

      let status = "unanalyzed";
      if (hasGap) {
        if (n(gap) < -10) status = "critical";
        else if (n(gap) < -3) status = "warning";
        else status = "compliant";
      }

      // Prediction Quality
      const pq = n(d.predictionQuality);
      let qualityClass = "quality-badge quality-poor";
      let qualityLabel = "Poor";
      if (pq >= 80) {
        qualityClass = "quality-badge quality-excellent";
        qualityLabel = "Excellent";
      } else if (pq >= 60) {
        qualityClass = "quality-badge quality-good";
        qualityLabel = "Good";
      } else if (pq >= 40) {
        qualityClass = "quality-badge quality-fair";
        qualityLabel = "Fair";
      }

      return {
        id: d.id,
        name: d.name,
        accountName: d.accountName || "N/A",
        ownerName: d.ownerName || "N/A",
        amount: fmt$(d.amount),
        amountRaw: n(d.amount),
        stageName: d.stageName,
        plannedMargin: d.plannedMargin != null ? fmtPct(d.plannedMargin) : "--",
        plannedMarginRaw: n(d.plannedMargin),
        recommendedMargin:
          d.recommendedMargin != null ? fmtPct(d.recommendedMargin) : "--",
        recommendedMarginRaw: n(d.recommendedMargin),
        marginGap: hasGap ? fmtPp(gap) : "--",
        marginGapArrow: hasGap
          ? n(gap) < -3
            ? "\u25BC "
            : n(gap) < 0
              ? "\u25BE "
              : "\u25B2 "
          : "",
        marginGapRaw: hasGap ? n(gap) : -999,
        gapClass,
        dealScore: score,
        dealScoreLabel: d.dealScoreLabel,
        scoreClass,
        status,
        predictionQuality: pq,
        qualityClass,
        qualityLabel,
        plannedRAGP: d.plannedRAGP != null ? fmt$(d.plannedRAGP) : "--",
        recRAGP: d.recRAGP != null ? fmt$(d.recRAGP) : "--",
        ragpDelta: d.ragpDelta != null ? fmt$(d.ragpDelta) : "--",
        ragpDeltaClass:
          d.ragpDelta != null
            ? n(d.ragpDelta) >= 0
              ? "cell-ragp ragp-positive"
              : "cell-ragp ragp-negative"
            : "cell-ragp"
      };
    });

    const field = this.sortField;
    const dir = this.sortDirection === "asc" ? 1 : -1;
    deals.sort((a, b) => {
      let va, vb;
      if (
        field === "name" ||
        field === "accountName" ||
        field === "ownerName" ||
        field === "stageName"
      ) {
        va = (a[field] || "").toLowerCase();
        vb = (b[field] || "").toLowerCase();
        return va < vb ? -1 * dir : va > vb ? 1 * dir : 0;
      }
      const numField =
        {
          dealScore: "dealScore",
          amount: "amountRaw",
          plannedMargin: "plannedMarginRaw",
          recommendedMargin: "recommendedMarginRaw",
          marginGap: "marginGapRaw",
          predictionQuality: "predictionQuality"
        }[field] || "dealScore";
      va = a[numField];
      vb = b[numField];
      return (va - vb) * dir;
    });

    return deals;
  }

  get filteredDeals() {
    const all = this.allSortedDeals;
    if (this.activeFilter === "all") return all;
    return all.filter((d) => d.status === this.activeFilter);
  }

  get sortedDeals() {
    const filtered = this.filteredDeals;
    const start = (this.currentPage - 1) * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }

  // ── Filter Pills ──
  get filterPills() {
    const all = this.allSortedDeals;
    const counts = {
      all: all.length,
      critical: 0,
      warning: 0,
      compliant: 0,
      unanalyzed: 0
    };
    for (const d of all) counts[d.status]++;
    return FILTER_DEFS.map((f) => ({
      value: f.value,
      label: f.label + " (" + counts[f.value] + ")",
      pillClass:
        this.activeFilter === f.value
          ? "filter-pill filter-pill-active"
          : "filter-pill"
    }));
  }

  get pipelineFilteredCount() {
    const c = this.filteredDeals.length;
    return c + " deal" + (c !== 1 ? "s" : "");
  }

  // ── Pagination ──
  get totalPages() {
    return Math.max(1, Math.ceil(this.filteredDeals.length / PAGE_SIZE));
  }
  get paginationText() {
    const filtered = this.filteredDeals;
    if (filtered.length === 0) return "0 deals";
    const start = (this.currentPage - 1) * PAGE_SIZE + 1;
    const end = Math.min(this.currentPage * PAGE_SIZE, filtered.length);
    return start + "\u2013" + end + " of " + filtered.length;
  }
  get hasPrevPage() {
    return this.currentPage > 1;
  }
  get hasNextPage() {
    return this.currentPage < this.totalPages;
  }
  get isPrevDisabled() {
    return !this.hasPrevPage;
  }
  get isNextDisabled() {
    return !this.hasNextPage;
  }
  get prevBtnClass() {
    return this.hasPrevPage ? "page-btn" : "page-btn page-btn-disabled";
  }
  get nextBtnClass() {
    return this.hasNextPage ? "page-btn" : "page-btn page-btn-disabled";
  }

  get sortIndicator() {
    return this.sortDirection === "asc" ? " \u25B2" : " \u25BC";
  }
  get scoreSortClass() {
    return this.sortField === "dealScore"
      ? "col-header sortable active"
      : "col-header sortable";
  }
  get nameSortClass() {
    return this.sortField === "name"
      ? "col-header sortable active"
      : "col-header sortable";
  }
  get amountSortClass() {
    return this.sortField === "amount"
      ? "col-header sortable active"
      : "col-header sortable";
  }
  get planSortClass() {
    return this.sortField === "plannedMargin"
      ? "col-header sortable active"
      : "col-header sortable";
  }
  get recSortClass() {
    return this.sortField === "recommendedMargin"
      ? "col-header sortable active"
      : "col-header sortable";
  }
  get gapSortClass() {
    return this.sortField === "marginGap"
      ? "col-header sortable active"
      : "col-header sortable";
  }
  get scoreIndicator() {
    return this.sortField === "dealScore" ? this.sortIndicator : "";
  }
  get nameIndicator() {
    return this.sortField === "name" ? this.sortIndicator : "";
  }
  get amountIndicator() {
    return this.sortField === "amount" ? this.sortIndicator : "";
  }
  get planIndicator() {
    return this.sortField === "plannedMargin" ? this.sortIndicator : "";
  }
  get recIndicator() {
    return this.sortField === "recommendedMargin" ? this.sortIndicator : "";
  }
  get gapIndicator() {
    return this.sortField === "marginGap" ? this.sortIndicator : "";
  }
  get qualitySortClass() {
    return this.sortField === "predictionQuality"
      ? "col-header sortable active"
      : "col-header sortable";
  }
  get qualityIndicator() {
    return this.sortField === "predictionQuality"
      ? this.sortDirection === "asc"
        ? " \u25B2"
        : " \u25BC"
      : "";
  }

  // ── Rep Performance ──
  get repPerformance() {
    if (!this.historicalData?.repPerformance) return [];
    return this.historicalData.repPerformance.map((r) => {
      const compRate = n(r.complianceRate);
      let compClass = "cell-compliance";
      let compSuffix = "";
      if (compRate >= 70) {
        compClass += " compliance-good";
        compSuffix = " \u2713";
      } else if (compRate >= 50) {
        compClass += " compliance-fair";
        compSuffix = " \u2013";
      } else {
        compClass += " compliance-poor";
        compSuffix = " \u2717";
      }

      return {
        ownerId: r.ownerId,
        ownerName: r.ownerName,
        totalDeals: n(r.totalDeals),
        wonDeals: n(r.wonDeals),
        winRate: fmtPct(r.winRate, 0),
        avgMargin: fmtPct(r.avgMargin),
        totalAmount: fmt$(r.totalAmount),
        complianceRate: fmtPct(compRate, 0) + compSuffix,
        compClass
      };
    });
  }
  get hasRepData() {
    return this.repPerformance.length > 0;
  }

  // ── Margin Opportunity ──
  get marginOpportunity() {
    if (!this.historicalData?.marginOpportunity) return null;
    const m = this.historicalData.marginOpportunity;
    const current = n(m.currentBlendedMargin);
    const potential = n(m.potentialBlendedMargin);
    const uplift = potential - current;
    const maxBar = Math.max(current, potential, 1);
    return {
      currentMargin: fmtPct(current),
      potentialMargin: fmtPct(potential),
      uplift: fmtPp(uplift),
      currentGP: fmt$(m.currentGP),
      potentialGP: fmt$(m.potentialGP),
      gpDelta: fmt$(m.gpDelta),
      dealCount: n(m.dealCount),
      currentBarWidth: ((current / maxBar) * 100).toFixed(0) + "%",
      potentialBarWidth: ((potential / maxBar) * 100).toFixed(0) + "%",
      // New RAGP fields
      plannedRAGP: fmt$(m.totalPlannedRAGP),
      recRAGP: fmt$(m.totalRecRAGP),
      ragpDelta: fmt$(m.ragpDelta),
      ragpDealCount: n(m.ragpDealCount),
      ragpPositive: n(m.ragpDelta) >= 0
    };
  }
  get hasMarginOpportunity() {
    return this.marginOpportunity && this.marginOpportunity.dealCount > 0;
  }
  get currentBarStyle() {
    return this.marginOpportunity
      ? "width: " + this.marginOpportunity.currentBarWidth
      : "width: 0%";
  }
  get potentialBarStyle() {
    return this.marginOpportunity
      ? "width: " + this.marginOpportunity.potentialBarWidth
      : "width: 0%";
  }

  // ── Scatter Plot: Margin vs Win Probability ──
  get hasScatterData() {
    return this.pipelineData?.deals?.length > 0;
  }

  get scatterAriaLabel() {
    const deals = this.pipelineData?.deals;
    if (!deals) return "No scatter data";
    return (
      "Scatter plot showing planned margin vs win probability for " +
      deals.length +
      " pipeline deals"
    );
  }

  get scatterYGridLines() {
    const lines = [];
    for (let wp = 0; wp <= 100; wp += 20) {
      const y = this._scatterY(wp);
      lines.push({
        key: "yg-" + wp,
        y: y,
        labelKey: "yl-" + wp,
        labelY: y + 4,
        label: wp + "%"
      });
    }
    return lines;
  }

  get scatterXGridLines() {
    const lines = [];
    for (let m = 0; m <= 40; m += 10) {
      const x = this._scatterX(m);
      lines.push({
        key: "xg-" + m,
        x: x,
        labelKey: "xl-" + m,
        label: m + "%"
      });
    }
    return lines;
  }

  get scatterPoints() {
    const deals = this.pipelineData?.deals;
    if (!deals) return [];
    return deals.map((d, idx) => {
      const margin = n(d.plannedMargin);
      const wp = n(d.winProbability);
      const gap = d.marginGap;
      const hasGap = gap != null;
      const isAligned = hasGap && Math.abs(n(gap)) <= 3;
      const isOffTarget = hasGap && Math.abs(n(gap)) > 3;
      const cx = this._scatterX(margin);
      const cy = this._scatterY(wp);
      const amt = n(d.amount);
      const r = Math.max(4, Math.min(12, 4 + (amt / 500000) * 6));
      const ds = r * 1.2;
      const diamondPoints =
        cx +
        "," +
        (cy - ds) +
        " " +
        (cx + ds) +
        "," +
        cy +
        " " +
        cx +
        "," +
        (cy + ds) +
        " " +
        (cx - ds) +
        "," +
        cy;

      return {
        key: "sp-" + (d.id || idx),
        cx,
        cy,
        r,
        diamondPoints,
        isAligned,
        isOffTarget,
        tooltip:
          (d.name || "Deal") +
          "\nMargin: " +
          margin.toFixed(1) +
          "%  Win Prob: " +
          wp.toFixed(0) +
          "%" +
          (hasGap ? "\nGap: " + fmtPp(gap) : "\nNot yet analyzed")
      };
    });
  }

  _scatterX(margin) {
    const clamped = Math.max(0, Math.min(40, margin));
    return 60 + (clamped / 40) * 520;
  }

  _scatterY(winProb) {
    const clamped = Math.max(0, Math.min(100, winProb));
    return 360 - (clamped / 100) * 340;
  }

  // ── Compliance Cohorts ──
  get complianceCohorts() {
    if (!this.historicalData?.complianceCohorts) return null;
    const c = this.historicalData.complianceCohorts;
    if (n(c.alignedDeals) === 0 && n(c.divergedDeals) === 0) return null;
    return {
      alignedDeals: n(c.alignedDeals),
      alignedWon: n(c.alignedWon),
      alignedWinRate: fmtPct(c.alignedWinRate, 0),
      alignedAvgMargin: fmtPct(c.alignedAvgMargin),
      divergedDeals: n(c.divergedDeals),
      divergedWon: n(c.divergedWon),
      divergedWinRate: fmtPct(c.divergedWinRate, 0),
      divergedAvgMargin: fmtPct(c.divergedAvgMargin),
      winRateLift: fmtPp(n(c.alignedWinRate) - n(c.divergedWinRate)),
      winRateLiftPositive: n(c.alignedWinRate) >= n(c.divergedWinRate)
    };
  }
  get hasComplianceCohorts() {
    return this.complianceCohorts !== null;
  }

  // ── Competitive Performance ──
  get competitorData() {
    if (!this.historicalData?.competitorData) return [];
    return this.historicalData.competitorData.slice(0, 5).map((c) => {
      const wr = n(c.winRate);
      let barClass = "comp-bar-fill";
      if (wr >= 55) barClass += " comp-good";
      else if (wr >= 40) barClass += " comp-fair";
      else barClass += " comp-poor";

      return {
        name: c.name,
        wins: n(c.wins),
        losses: n(c.losses),
        winRate: fmtPct(wr, 0),
        barStyle: "width: " + wr.toFixed(0) + "%",
        barClass,
        avgMarginWon: c.avgMarginWon != null ? fmtPct(c.avgMarginWon) : "--",
        avgMarginLost: c.avgMarginLost != null ? fmtPct(c.avgMarginLost) : "--"
      };
    });
  }
  get hasCompetitorData() {
    return this.competitorData.length > 0;
  }

  // ── Section Collapse ──
  get pipelineChevron() {
    return this.collapsedSections.pipeline ? "\u25B8" : "\u25BE";
  }
  get repChevron() {
    return this.collapsedSections.rep ? "\u25B8" : "\u25BE";
  }
  get marginChevron() {
    return this.collapsedSections.margin ? "\u25B8" : "\u25BE";
  }
  get compChevron() {
    return this.collapsedSections.comp ? "\u25B8" : "\u25BE";
  }
  get cohortsChevron() {
    return this.collapsedSections.cohorts ? "\u25B8" : "\u25BE";
  }
  get showPipeline() {
    return !this.collapsedSections.pipeline;
  }
  get showRep() {
    return !this.collapsedSections.rep;
  }
  get showMargin() {
    return !this.collapsedSections.margin;
  }
  get showComp() {
    return !this.collapsedSections.comp;
  }
  get showCohorts() {
    return !this.collapsedSections.cohorts;
  }
  get teamCompChevron() {
    return this.collapsedSections.teamComp ? "\u25B8" : "\u25BE";
  }
  get showTeamComp() {
    return !this.collapsedSections.teamComp;
  }
  get backfillChevron() {
    return this.collapsedSections.backfill ? "\u25B8" : "\u25BE";
  }
  get showBackfill() {
    return !this.collapsedSections.backfill;
  }

  // ── User Context ──
  get userContext() {
    if (!this._userContextData) {
      return { isAdmin: false, isManager: false, hasTeamSelector: false };
    }
    const ctx = this._userContextData;
    return {
      isAdmin: ctx.isAdmin || false,
      isManager: ctx.isManager || false,
      hasTeamSelector:
        ctx.isAdmin === true && ctx.managers != null && ctx.managers.length > 0,
      userName: ctx.userName,
      userId: ctx.userId,
      directReports: ctx.directReports || [],
      managers: ctx.managers || []
    };
  }

  get teamSelectorOptions() {
    const options = [{ label: "All Teams", value: "" }];
    if (this._userContextData?.managers) {
      for (const m of this._userContextData.managers) {
        options.push({ label: m.name, value: m.id });
      }
    }
    return options;
  }

  get selectedTeamLabel() {
    if (!this.selectedTeamFilter) return "All Teams";
    const opt = this.teamSelectorOptions.find(
      (o) => o.value === this.selectedTeamFilter
    );
    return opt ? opt.label : "All Teams";
  }

  // ── Team Comparison ──
  get teamComparison() {
    if (!this.teamComparisonData || this.teamComparisonData.length === 0)
      return [];
    return this.teamComparisonData.map((t) => {
      const compRate = n(t.complianceRate);
      let compClass = "cell-compliance";
      let compSuffix = "";
      if (compRate >= 70) {
        compClass += " compliance-good";
        compSuffix = " \u2713";
      } else if (compRate >= 50) {
        compClass += " compliance-fair";
        compSuffix = " \u2013";
      } else {
        compClass += " compliance-poor";
        compSuffix = " \u2717";
      }

      const ragp = n(t.ragpDelta);
      let ragpClass = "cell-ragp";
      if (ragp >= 0) ragpClass += " ragp-positive";
      else ragpClass += " ragp-negative";

      return {
        managerId: t.managerId,
        managerName: t.managerName,
        repCount: n(t.repCount),
        totalDeals: n(t.totalDeals),
        wonDeals: n(t.wonDeals),
        winRate: fmtPct(t.winRate, 0),
        totalAmount: fmt$(t.totalAmount),
        complianceRate: fmtPct(compRate, 0) + compSuffix,
        compClass,
        ragpDelta: (ragp >= 0 ? "\u25B2 +" : "\u25BC ") + fmt$(t.ragpDelta),
        ragpClass
      };
    });
  }
  get hasTeamComparison() {
    return this.teamComparison.length > 0;
  }

  // ── Rep Modal ──
  get repModalDeals() {
    if (!this.repModalData?.deals) return [];
    return this.repModalData.deals.map((d) => {
      const hasGap = d.marginGap != null;
      let gapClass = "cell-gap";
      if (hasGap) {
        if (n(d.marginGap) < -3) gapClass = "cell-gap gap-alert";
        else if (n(d.marginGap) < 0) gapClass = "cell-gap gap-warn";
        else gapClass = "cell-gap gap-ok";
      }
      return {
        id: d.id,
        name: d.name,
        accountName: d.accountName || "N/A",
        amount: fmt$(d.amount),
        stageName: d.stageName,
        plannedMargin: d.plannedMargin != null ? fmtPct(d.plannedMargin) : "--",
        recommendedMargin:
          d.recommendedMargin != null ? fmtPct(d.recommendedMargin) : "--",
        marginGap: hasGap ? fmtPp(d.marginGap) : "--",
        gapClass,
        isCompliant: d.isCompliant,
        compliantLabel: d.isCompliant ? "\u2713" : "\u2717",
        compliantClass: d.isCompliant ? "compliant-yes" : "compliant-no",
        isWon: d.isWon,
        stageClass: d.isWon ? "stage-won" : "stage-lost"
      };
    });
  }
  get repModalStats() {
    if (!this.repModalData) return null;
    const d = this.repModalData;
    const wr = n(d.winRate);
    let wrClass = "modal-stat-value";
    if (wr >= 55) wrClass += " stat-good";
    else if (wr >= 40) wrClass += " stat-fair";
    else wrClass += " stat-poor";

    const adopt = n(d.adoptionRate);
    let adoptClass = "modal-stat-value";
    if (adopt >= 70) adoptClass += " stat-good";
    else if (adopt >= 50) adoptClass += " stat-fair";
    else adoptClass += " stat-poor";

    const comp = n(d.complianceRate);
    let compClass = "modal-stat-value";
    if (comp >= 70) compClass += " stat-good";
    else if (comp >= 50) compClass += " stat-fair";
    else compClass += " stat-poor";

    return {
      winRate: fmtPct(wr, 0),
      winRateClass: wrClass,
      adoptionRate: fmtPct(adopt, 0),
      adoptionClass: adoptClass,
      complianceRate: fmtPct(comp, 0),
      complianceClass: compClass,
      totalDeals: n(d.totalDeals),
      wonDeals: n(d.wonDeals)
    };
  }
  get repModalCoaching() {
    if (!this.repModalData?.coachingOem) return null;
    const d = this.repModalData;
    return {
      oem: d.coachingOem,
      dealCount: n(d.coachingDealCount),
      avgGap: fmtPp(d.coachingAvgGap)
    };
  }
  get repModalTitle() {
    return this._repModalName || "Rep Detail";
  }

  // ── Time Range Dropdown ──
  get selectedTimeRangeLabel() {
    const opt = TIME_RANGE_OPTIONS.find(
      (o) => o.value === this.selectedTimeRange
    );
    return opt ? opt.label : "Last 90 Days";
  }
  get showTimeRangeDropdown() {
    return this._showDropdown || false;
  }

  // ── Event Handlers ──
  handleTimeRangeToggle() {
    this._showDropdown = !this._showDropdown;
  }
  handleTimeRangeSelect(event) {
    this.selectedTimeRange = event.currentTarget.dataset.value;
    this._showDropdown = false;
  }
  handleTimeRangeBlur() {
    // eslint-disable-next-line @lwc/lwc/no-async-operation
    setTimeout(() => {
      this._showDropdown = false;
    }, 200);
  }

  handleSort(event) {
    const field = event.currentTarget.dataset.field;
    if (!SORT_FIELDS[field]) return;
    if (this.sortField === field) {
      this.sortDirection = this.sortDirection === "asc" ? "desc" : "asc";
    } else {
      this.sortField = field;
      this.sortDirection = "desc";
    }
    this.currentPage = 1;
  }

  handleFilterChange(event) {
    this.activeFilter = event.currentTarget.dataset.filter;
    this.currentPage = 1;
  }

  handlePrevPage() {
    if (this.currentPage > 1) {
      this.currentPage--;
    }
  }

  handleNextPage() {
    if (this.currentPage < this.totalPages) {
      this.currentPage++;
    }
  }

  handleDealClick(event) {
    const dealId = event.currentTarget.dataset.id;
    if (!dealId) return;
    this[NavigationMixin.Navigate]({
      type: "standard__recordPage",
      attributes: {
        recordId: dealId,
        objectApiName: "Opportunity",
        actionName: "view"
      }
    });
  }

  toggleSection(event) {
    const section = event.currentTarget.dataset.section;
    this.collapsedSections = {
      ...this.collapsedSections,
      [section]: !this.collapsedSections[section]
    };
  }

  handleTeamChange(event) {
    const val = event.currentTarget.dataset.value;
    this.selectedTeamFilter = val || null;
    this._showTeamDropdown = false;
  }

  handleTeamToggle() {
    this._showTeamDropdown = !this._showTeamDropdown;
  }

  handleTeamBlur() {
    // eslint-disable-next-line @lwc/lwc/no-async-operation
    setTimeout(() => {
      this._showTeamDropdown = false;
    }, 200);
  }

  get showTeamDropdown() {
    return this._showTeamDropdown || false;
  }

  handleRepClick(event) {
    event.stopPropagation();
    const repId = event.currentTarget.dataset.repid;
    const repName = event.currentTarget.dataset.repname;
    if (!repId) return;

    this._repModalName = repName || "Rep Detail";
    this.repModalData = null;
    this.showRepModal = true;

    getRepDetail({ repId: repId, timeRange: this.selectedTimeRange })
      .then((data) => {
        this.repModalData = data;
      })
      .catch((error) => {
        console.error("getRepDetail error:", error);
        this.showRepModal = false;
        this.repModalData = null;
      });
  }

  // ── Backfill Analysis ──
  get backfillSummary() {
    if (
      !this.backfillSummaryData ||
      n(this.backfillSummaryData.totalCount) === 0
    )
      return null;
    const s = this.backfillSummaryData;
    return {
      totalCount: n(s.totalCount),
      avgMarginDelta: fmtPp(s.avgMarginDelta),
      avgMarginDeltaClass:
        n(s.avgMarginDelta) >= 0
          ? "backfill-stat-value stat-positive"
          : "backfill-stat-value stat-negative",
      totalGPDelta: fmt$(s.totalGPDelta),
      totalGPDeltaClass:
        n(s.totalGPDelta) >= 0
          ? "backfill-stat-value stat-positive"
          : "backfill-stat-value stat-negative",
      lastAnalysisDate: s.lastAnalysisDate
        ? new Date(s.lastAnalysisDate).toLocaleDateString()
        : "N/A"
    };
  }

  get hasBackfillData() {
    return this.backfillSummary !== null;
  }

  get backfillDeals() {
    if (!this.backfillDetailsData) return [];
    return this.backfillDetailsData.slice(0, 20).map((d) => {
      const delta = n(d.marginDelta);
      let deltaClass = "cell-gap";
      if (delta > 0) deltaClass = "cell-gap gap-ok";
      else if (delta < -3) deltaClass = "cell-gap gap-alert";
      else if (delta < 0) deltaClass = "cell-gap gap-warn";

      const gpd = n(d.gpDelta);
      let gpDeltaClass = "cell-gp-delta";
      if (gpd > 0) gpDeltaClass += " gp-positive";
      else if (gpd < 0) gpDeltaClass += " gp-negative";

      return {
        id: d.id,
        opportunityId: d.opportunityId,
        opportunityName: d.opportunityName || "N/A",
        oem: d.oem || "N/A",
        repName: d.repName || "N/A",
        actualMargin: d.actualMargin != null ? fmtPct(d.actualMargin) : "--",
        recommendedMargin:
          d.recommendedMargin != null ? fmtPct(d.recommendedMargin) : "--",
        marginDelta: d.marginDelta != null ? fmtPp(d.marginDelta) : "--",
        deltaClass,
        gpDelta: fmt$(d.gpDelta),
        gpDeltaClass
      };
    });
  }

  get hasBackfillDeals() {
    return this.backfillDeals.length > 0;
  }

  handleBackfillDealClick(event) {
    const dealId = event.currentTarget.dataset.id;
    if (!dealId) return;
    this[NavigationMixin.Navigate]({
      type: "standard__recordPage",
      attributes: {
        recordId: dealId,
        objectApiName: "Opportunity",
        actionName: "view"
      }
    });
  }

  handleRepModalKeydown(event) {
    if (event.key === "Escape") this.closeRepModal();
  }

  closeRepModal() {
    this.showRepModal = false;
    this.repModalData = null;
    this._repModalName = null;
  }

  stopPropagation(event) {
    event.stopPropagation();
  }

  // ── CSV Export ──
  _generateCsv(headers, rows) {
    const escapeCell = (val) => {
      if (val == null) return "";
      const str = String(val);
      if (str.includes(",") || str.includes('"') || str.includes("\n")) {
        return '"' + str.replace(/"/g, '""') + '"';
      }
      return str;
    };
    const lines = [headers.map(escapeCell).join(",")];
    for (const row of rows) {
      lines.push(row.map(escapeCell).join(","));
    }
    return "\uFEFF" + lines.join("\r\n");
  }

  _downloadCsv(csvContent, filename) {
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  _todayStamp() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + day;
  }

  handleExportPipeline(event) {
    event.stopPropagation();
    const deals = this.filteredDeals;
    if (!deals || deals.length === 0) return;
    const headers = [
      "Opportunity Name",
      "Account",
      "Rep",
      "OEM",
      "Amount",
      "Planned Margin %",
      "Recommended Margin %",
      "Gap (pp)",
      "Win Probability",
      "Deal Score",
      "Status"
    ];
    const rows = deals.map((d) => {
      const raw = this.pipelineData?.deals?.find((rd) => rd.id === d.id);
      return [
        d.name,
        d.accountName,
        d.ownerName,
        raw?.oem || "",
        n(raw?.amount),
        raw?.plannedMargin != null ? n(raw.plannedMargin).toFixed(1) : "",
        raw?.recommendedMargin != null
          ? n(raw.recommendedMargin).toFixed(1)
          : "",
        raw?.marginGap != null ? n(raw.marginGap).toFixed(1) : "",
        raw?.winProbability != null ? n(raw.winProbability).toFixed(1) : "",
        d.dealScore,
        d.status
      ];
    });
    const csv = this._generateCsv(headers, rows);
    this._downloadCsv(csv, "marginarc-pipeline-" + this._todayStamp() + ".csv");
  }

  handleExportPerformance(event) {
    event.stopPropagation();
    const reps = this.historicalData?.repPerformance;
    if (!reps || reps.length === 0) return;
    const headers = [
      "Rep Name",
      "Deals Won",
      "Win Rate",
      "Avg Margin",
      "Avg Recommended Margin",
      "Alignment Rate",
      "GP Upside"
    ];
    const rows = reps.map((r) => [
      r.ownerName,
      n(r.wonDeals),
      n(r.winRate).toFixed(1) + "%",
      n(r.avgMargin).toFixed(1) + "%",
      r.avgRecommendedMargin != null
        ? n(r.avgRecommendedMargin).toFixed(1) + "%"
        : "",
      n(r.complianceRate).toFixed(0) + "%",
      r.ragp != null ? n(r.ragp).toFixed(0) : ""
    ]);
    const csv = this._generateCsv(headers, rows);
    this._downloadCsv(
      csv,
      "marginarc-performance-" + this._todayStamp() + ".csv"
    );
  }
}
