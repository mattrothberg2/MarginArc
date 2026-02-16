import { LightningElement, wire, track } from "lwc";
import { NavigationMixin } from "lightning/navigation";
import getBackfillSummary from "@salesforce/apex/FulcrumManagerController.getBackfillSummary";
import getBackfillDetails from "@salesforce/apex/FulcrumManagerController.getBackfillDetails";

function n(val) {
  return val == null ? 0 : Number(val);
}
function fmt$(val) {
  const num = n(val);
  const abs = Math.abs(num);
  const prefix = num >= 0 ? "+$" : "-$";
  if (abs >= 1000000) return prefix + (abs / 1000000).toFixed(1) + "M";
  if (abs >= 1000) return prefix + (abs / 1000).toFixed(0) + "K";
  return prefix + abs.toFixed(0);
}
function fmtCurrency(val) {
  const num = n(val);
  const abs = Math.abs(num);
  const prefix = num >= 0 ? "$" : "-$";
  if (abs >= 1000000) return prefix + (abs / 1000000).toFixed(1) + "M";
  if (abs >= 1000) return prefix + (abs / 1000).toFixed(0) + "K";
  return prefix + abs.toFixed(0);
}
function fmtPp(val) {
  const num = n(val);
  const sign = num >= 0 ? "+" : "";
  return sign + num.toFixed(1) + "pp";
}
function fmtPct(val) {
  return n(val).toFixed(1) + "%";
}

export default class FulcrumBackfillReport extends NavigationMixin(
  LightningElement
) {
  @track summaryData = null;
  @track detailsData = null;
  @track loading = true;
  @track error = null;
  @track sortField = "gpDelta";
  @track sortDirection = "desc";
  @track activeTab = "oem";

  @wire(getBackfillSummary)
  wiredSummary({ data, error }) {
    if (data) {
      this.summaryData = data;
      this.loading = false;
    } else if (error) {
      this.error = error.body ? error.body.message : "Failed to load summary";
      this.loading = false;
    }
  }

  @wire(getBackfillDetails)
  wiredDetails({ data }) {
    if (data) {
      this.detailsData = data;
    }
  }

  // ── Tab Navigation ──
  get isOverviewTab() {
    return this.activeTab === "overview";
  }
  get isOemTab() {
    return this.activeTab === "oem";
  }
  get isRepTab() {
    return this.activeTab === "rep";
  }
  get isDealsTab() {
    return this.activeTab === "deals";
  }

  get overviewTabClass() {
    return "tab-btn" + (this.isOverviewTab ? " tab-active" : "");
  }
  get oemTabClass() {
    return "tab-btn" + (this.isOemTab ? " tab-active" : "");
  }
  get repTabClass() {
    return "tab-btn" + (this.isRepTab ? " tab-active" : "");
  }
  get dealsTabClass() {
    return "tab-btn" + (this.isDealsTab ? " tab-active" : "");
  }

  handleTabClick(event) {
    this.activeTab = event.currentTarget.dataset.tab;
  }

  // ── State Getters ──
  get showEmptyState() {
    return !this.loading && !this.hasData && !this.error;
  }

  // ── Summary Getters ──
  get hasData() {
    return this.summaryData && n(this.summaryData.totalCount) > 0;
  }

  get totalDeals() {
    return n(this.summaryData?.totalCount);
  }

  get headlineGPDelta() {
    return fmt$(this.summaryData?.totalGPDelta);
  }

  get headlineGPDeltaPositive() {
    return n(this.summaryData?.totalGPDelta) > 0;
  }

  get headlineGPDeltaClass() {
    return this.headlineGPDeltaPositive
      ? "hero-value hero-positive"
      : "hero-value hero-negative";
  }

  get avgMarginDelta() {
    return fmtPp(this.summaryData?.avgMarginDelta);
  }

  get avgMarginDeltaPositive() {
    return n(this.summaryData?.avgMarginDelta) > 0;
  }

  get avgMarginDeltaClass() {
    return this.avgMarginDeltaPositive
      ? "hero-value hero-positive"
      : "hero-value hero-negative";
  }

  get totalActualGP() {
    return fmtCurrency(this.summaryData?.totalActualGP);
  }

  get totalRecommendedGP() {
    return fmtCurrency(this.summaryData?.totalRecommendedGP);
  }

  get avgActualMargin() {
    return fmtPct(this.summaryData?.avgActualMargin);
  }

  get avgRecommendedMargin() {
    return fmtPct(this.summaryData?.avgRecommendedMargin);
  }

  get lastAnalysisDate() {
    const d = this.summaryData?.lastAnalysisDate;
    return d ? new Date(d).toLocaleDateString() : "N/A";
  }

  // ── OEM Breakdown ──
  get oemRows() {
    const items = this.summaryData?.oemBreakdown || [];
    if (!items.length) return [];
    const maxGP = Math.max(...items.map((o) => Math.abs(n(o.gpDelta))), 1);
    return items.map((o, i) => ({
      key: "oem-" + i,
      oem: o.oem || "Unknown",
      dealCount: n(o.dealCount),
      avgDelta: fmtPp(o.avgDelta),
      avgDeltaClass: n(o.avgDelta) >= 0 ? "value-positive" : "value-negative",
      gpDelta: fmt$(o.gpDelta),
      gpDeltaClass: n(o.gpDelta) >= 0 ? "value-positive" : "value-negative",
      barStyle: "width:" + (Math.abs(n(o.gpDelta)) / maxGP) * 100 + "%",
      barClass:
        n(o.gpDelta) >= 0 ? "bar-fill bar-positive" : "bar-fill bar-negative"
    }));
  }

  get hasOemData() {
    return this.oemRows.length > 0;
  }

  // ── Rep Breakdown ──
  get repRows() {
    const items = this.summaryData?.repBreakdown || [];
    if (!items.length) return [];
    const maxGP = Math.max(...items.map((r) => Math.abs(n(r.gpDelta))), 1);
    return items.map((r, i) => ({
      key: "rep-" + i,
      rep: r.rep || "Unknown",
      dealCount: n(r.dealCount),
      avgActual: fmtPct(r.avgActual),
      avgRecommended: fmtPct(r.avgRecommended),
      avgDelta: fmtPp(r.avgDelta),
      avgDeltaClass: n(r.avgDelta) >= 0 ? "value-positive" : "value-negative",
      gpDelta: fmt$(r.gpDelta),
      gpDeltaClass: n(r.gpDelta) >= 0 ? "value-positive" : "value-negative",
      barStyle: "width:" + (Math.abs(n(r.gpDelta)) / maxGP) * 100 + "%",
      barClass:
        n(r.gpDelta) >= 0 ? "bar-fill bar-positive" : "bar-fill bar-negative"
    }));
  }

  get hasRepData() {
    return this.repRows.length > 0;
  }

  // ── Deal Details ──
  get dealRows() {
    if (!this.detailsData) return [];
    return this.detailsData.map((d, i) => ({
      key: "deal-" + i,
      id: d.id,
      opportunityId: d.opportunityId,
      name: d.opportunityName || "N/A",
      oem: d.oem || "-",
      repName: d.repName || "-",
      actualMargin: fmtPct(d.actualMargin),
      recommendedMargin: fmtPct(d.recommendedMargin),
      marginDelta: fmtPp(d.marginDelta),
      marginDeltaClass:
        n(d.marginDelta) >= 0 ? "value-positive" : "value-negative",
      gpDelta: fmt$(d.gpDelta),
      gpDeltaClass: n(d.gpDelta) >= 0 ? "value-positive" : "value-negative",
      closeDate: d.closeDate ? new Date(d.closeDate).toLocaleDateString() : "-"
    }));
  }

  get hasDealData() {
    return this.dealRows.length > 0;
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
}
