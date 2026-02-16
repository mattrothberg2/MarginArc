import { LightningElement, track } from "lwc";
import { NavigationMixin } from "lightning/navigation";
import { ShowToastEvent } from "lightning/platformShowToastEvent";
import getSetupStatus from "@salesforce/apex/MarginArcSetupController.getSetupStatus";
import getFieldMappingSuggestions from "@salesforce/apex/MarginArcSetupController.getFieldMappingSuggestions";
import runBackfill from "@salesforce/apex/MarginArcSetupController.runBackfill";
import getBackfillJobStatus from "@salesforce/apex/MarginArcSetupController.getBackfillJobStatus";
import runNightlyAnalyzer from "@salesforce/apex/MarginArcSetupController.runNightlyAnalyzer";
import getMaturityAssessment from "@salesforce/apex/MarginArcSetupController.getMaturityAssessment";
import loadDemoData from "@salesforce/apex/MarginArcDemoDataLoader.loadDemoData";

function n(val) {
  return val == null ? 0 : Number(val);
}

const STEP_LABELS = [
  "Welcome",
  "Connection",
  "Data Quality",
  "Configuration",
  "Backfill",
  "Complete"
];

const MATURITY_NAMES = [
  "Initial",
  "Connected",
  "Populated",
  "Operational",
  "Optimized"
];

const BACKFILL_POLL_INTERVAL_MS = 3000;

export default class MarginarcSetupWizard extends NavigationMixin(
  LightningElement
) {
  // ── Wizard State ──
  @track currentStep = 1;
  @track setupStatus = null;
  @track isLoadingStatus = false;
  @track fieldSuggestions = [];
  @track maturityData = null;
  @track isLoadingMaturity = false;

  // ── Demo Data State ──
  @track isLoadingDemo = false;
  @track demoDataLoaded = false;
  @track demoDataMessage = "";
  @track demoDataCounts = null;

  // ── Backfill State ──
  @track selectedMonths = 12;
  @track backfillJobId = null;
  @track backfillJobStatus = null;
  @track isBackfillRunning = false;
  @track isNightlyRunning = false;
  @track nightlyJobComplete = false;

  // ── Poll interval ref ──
  _backfillPollInterval = null;

  // ═══════════════════════════════════════════
  // LIFECYCLE
  // ═══════════════════════════════════════════

  connectedCallback() {
    this.loadSetupStatus();
  }

  disconnectedCallback() {
    this.clearBackfillPoll();
  }

  // ═══════════════════════════════════════════
  // STEP NAVIGATION
  // ═══════════════════════════════════════════

  get totalWizardSteps() {
    return 6;
  }

  get totalChecks() {
    return this.setupStatus ? n(this.setupStatus.totalSteps) : 5;
  }

  get isStep1() {
    return this.currentStep === 1;
  }

  get isStep2() {
    return this.currentStep === 2;
  }

  get isStep3() {
    return this.currentStep === 3;
  }

  get isStep4() {
    return this.currentStep === 4;
  }

  get isStep5() {
    return this.currentStep === 5;
  }

  get isStep6() {
    return this.currentStep === 6;
  }

  get showPrevButton() {
    return this.currentStep > 1;
  }

  get showNextButton() {
    return this.currentStep < 6;
  }

  handlePrevStep() {
    if (this.currentStep > 1) {
      this.currentStep--;
      this.onStepChange();
    }
  }

  handleNextStep() {
    if (this.currentStep < 6) {
      this.currentStep++;
      this.onStepChange();
    }
  }

  onStepChange() {
    if (
      this.currentStep === 2 ||
      this.currentStep === 3 ||
      this.currentStep === 4 ||
      this.currentStep === 5
    ) {
      if (!this.setupStatus) {
        this.loadSetupStatus();
      }
    }
    if (this.currentStep === 3 && this.fieldSuggestions.length === 0) {
      this.loadFieldSuggestions();
    }
    if (this.currentStep === 6) {
      this.loadMaturityAssessment();
    }
  }

  // ═══════════════════════════════════════════
  // STEP INDICATOR
  // ═══════════════════════════════════════════

  get stepIndicators() {
    return STEP_LABELS.map((label, idx) => {
      const stepNum = idx + 1;
      const isCompleted = stepNum < this.currentStep;
      const isCurrent = stepNum === this.currentStep;
      const isUpcoming = stepNum > this.currentStep;
      const hasConnector = stepNum < STEP_LABELS.length;

      let circleClass = "step-circle";
      let labelClass = "step-label";
      let connectorClass = "step-connector";

      if (isCompleted) {
        circleClass += " step-circle-completed";
        labelClass += " step-label-completed";
        connectorClass += " step-connector-completed";
      } else if (isCurrent) {
        circleClass += " step-circle-current";
        labelClass += " step-label-current";
        connectorClass += " step-connector-active";
      } else {
        circleClass += " step-circle-upcoming";
        labelClass += " step-label-upcoming";
        connectorClass += " step-connector-upcoming";
      }

      return {
        number: stepNum,
        label,
        isCompleted,
        isCurrent,
        isUpcoming,
        hasConnector,
        circleClass,
        labelClass,
        connectorClass,
        containerClass: "step-indicator"
      };
    });
  }

  // ═══════════════════════════════════════════
  // SETUP STATUS (shared across steps)
  // ═══════════════════════════════════════════

  loadSetupStatus() {
    this.isLoadingStatus = true;
    getSetupStatus()
      .then((data) => {
        this.setupStatus = data;
      })
      .catch((error) => {
        this.showError("Failed to load setup status", error);
      })
      .finally(() => {
        this.isLoadingStatus = false;
      });
  }

  get hasSetupStatus() {
    return this.setupStatus != null && !this.isLoadingStatus;
  }

  get completedSteps() {
    return this.setupStatus ? n(this.setupStatus.completedSteps) : 0;
  }

  get overallProgressPct() {
    if (!this.setupStatus) return 0;
    const completed = n(this.setupStatus.completedSteps);
    const total = n(this.setupStatus.totalSteps);
    if (total === 0) return 0;
    return Math.round((completed / total) * 100);
  }

  get progressRingStyle() {
    const circumference = 2 * Math.PI * 34;
    const offset =
      circumference - (this.overallProgressPct / 100) * circumference;
    return (
      "stroke-dasharray: " +
      circumference.toFixed(1) +
      "; stroke-dashoffset: " +
      offset.toFixed(1)
    );
  }

  // ═══════════════════════════════════════════
  // STEP 2: CONNECTION
  // ═══════════════════════════════════════════

  handleTestConnection() {
    this.loadSetupStatus();
  }

  get apiUrlDotClass() {
    if (!this.setupStatus) return "status-dot status-dot-unknown";
    return (
      "status-dot status-dot-" +
      (this.setupStatus.apiConfigured ? "connected" : "disconnected")
    );
  }

  get apiKeyDotClass() {
    if (!this.setupStatus) return "status-dot status-dot-unknown";
    return (
      "status-dot status-dot-" +
      (this.setupStatus.apiConfigured ? "connected" : "disconnected")
    );
  }

  get geminiKeyDotClass() {
    if (!this.setupStatus) return "status-dot status-dot-unknown";
    return (
      "status-dot status-dot-" +
      (this.setupStatus.geminiConfigured ? "connected" : "disconnected")
    );
  }

  get apiReachableDotClass() {
    if (!this.setupStatus) return "status-dot status-dot-unknown";
    return (
      "status-dot status-dot-" +
      (this.setupStatus.apiReachable ? "connected" : "disconnected")
    );
  }

  get connectionWarning() {
    if (!this.setupStatus) return "";
    if (!this.setupStatus.apiConfigured) {
      return "Configure your API settings in MarginArc Config custom setting. Go to Setup > Custom Settings > MarginArc Config to set the API URL and API Key.";
    }
    if (!this.setupStatus.apiReachable) {
      return "API is configured but not reachable. Check your API endpoint and network connectivity.";
    }
    return "";
  }

  // ═══════════════════════════════════════════
  // STEP 3: DATA QUALITY
  // ═══════════════════════════════════════════

  loadFieldSuggestions() {
    getFieldMappingSuggestions()
      .then((data) => {
        this.fieldSuggestions = data || [];
      })
      .catch(() => {
        this.fieldSuggestions = [];
      });
  }

  get overallFillRate() {
    if (!this.setupStatus) return 0;
    const fields = this.fieldFillRates;
    if (fields.length === 0) return 0;
    const sum = fields.reduce((acc, f) => acc + f.rateNum, 0);
    return Math.round(sum / fields.length);
  }

  get fieldFillRates() {
    if (!this.setupStatus) return [];
    const fieldKeys = [
      { key: "oemFillRate", label: "OEM Vendor", name: "oem" },
      { key: "oemCostFillRate", label: "OEM Cost", name: "oemCost" },
      { key: "segmentFillRate", label: "Customer Segment", name: "segment" },
      { key: "dealRegFillRate", label: "Deal Registration", name: "dealReg" },
      { key: "competitorFillRate", label: "Competitors", name: "competitor" }
    ];
    return fieldKeys.map((f) => {
      const rate = Math.round(n(this.setupStatus[f.key]));
      let barClass = "field-bar-fill";
      let rateClass = "";
      if (rate >= 80) {
        barClass += " field-bar-good";
        rateClass = "rate-good";
      } else if (rate >= 50) {
        barClass += " field-bar-warn";
        rateClass = "rate-warn";
      } else {
        barClass += " field-bar-poor";
        rateClass = "rate-poor";
      }
      return {
        name: f.name,
        label: f.label,
        rate,
        rateNum: rate,
        barStyle: "width: " + rate + "%",
        barClass,
        rateClass
      };
    });
  }

  get qualityRingStyle() {
    const circumference = 2 * Math.PI * 52;
    const offset = circumference - (this.overallFillRate / 100) * circumference;
    return (
      "stroke-dasharray: " +
      circumference.toFixed(1) +
      "; stroke-dashoffset: " +
      offset.toFixed(1)
    );
  }

  get qualityRingFillClass() {
    const rate = this.overallFillRate;
    if (rate >= 80) return "quality-ring-fill quality-ring-good";
    if (rate >= 50) return "quality-ring-fill quality-ring-warn";
    return "quality-ring-fill quality-ring-poor";
  }

  get qualityRatingMessage() {
    const rate = this.overallFillRate;
    if (rate >= 80) return "Your data quality is Excellent";
    if (rate >= 60) return "Your data quality is Good";
    if (rate >= 40) return "Your data quality Needs Attention";
    return "Your data quality is Poor";
  }

  get qualityRatingIcon() {
    const rate = this.overallFillRate;
    if (rate >= 80) return "\u2713";
    if (rate >= 60) return "\u2713";
    if (rate >= 40) return "!";
    return "!";
  }

  get qualityRatingClass() {
    const rate = this.overallFillRate;
    if (rate >= 80) return "quality-rating quality-rating-good";
    if (rate >= 60) return "quality-rating quality-rating-good";
    if (rate >= 40) return "quality-rating quality-rating-fair";
    return "quality-rating quality-rating-poor";
  }

  get hasFieldSuggestions() {
    return this.fieldSuggestions && this.fieldSuggestions.length > 0;
  }

  // ═══════════════════════════════════════════
  // STEP 4: CONFIGURATION CHECK
  // ═══════════════════════════════════════════

  get hasOems() {
    return this.setupStatus && n(this.setupStatus.oemCount) > 0;
  }

  get hasCompetitors() {
    return this.setupStatus && n(this.setupStatus.competitorCount) > 0;
  }

  get oemStatusText() {
    if (!this.setupStatus) return "";
    const count = n(this.setupStatus.oemCount);
    if (count > 0) {
      return count + " OEM vendor" + (count !== 1 ? "s" : "") + " configured";
    }
    return "No OEM vendors configured";
  }

  get oemStatusHint() {
    if (this.hasOems) {
      return "OEM vendor data enables vendor-specific margin recommendations";
    }
    return "Add OEM vendors in MarginArc Admin to improve margin accuracy";
  }

  get competitorStatusText() {
    if (!this.setupStatus) return "";
    const count = n(this.setupStatus.competitorCount);
    if (count > 0) {
      return count + " competitor" + (count !== 1 ? "s" : "") + " configured";
    }
    return "No competitors configured";
  }

  get competitorStatusHint() {
    if (this.hasCompetitors) {
      return "Competitor profiles enhance competitive intelligence and win strategy";
    }
    return "Add competitor profiles in MarginArc Admin for competitive insights";
  }

  get oemCheckClass() {
    return (
      "config-check " +
      (this.hasOems ? "config-check-good" : "config-check-warn")
    );
  }

  get competitorCheckClass() {
    return (
      "config-check " +
      (this.hasCompetitors ? "config-check-good" : "config-check-warn")
    );
  }

  handleGoToAdmin() {
    this[NavigationMixin.Navigate]({
      type: "standard__navItemPage",
      attributes: {
        apiName: "Fulcrum_Admin"
      }
    });
  }

  // ═══════════════════════════════════════════
  // STEP 5: HISTORICAL BACKFILL
  // ═══════════════════════════════════════════

  get backfillAlreadyRun() {
    return this.setupStatus && this.setupStatus.hasRunBackfill === true;
  }

  get backfillResultCount() {
    if (!this.setupStatus) return 0;
    return n(this.setupStatus.backfillResultCount);
  }

  get showBackfillControls() {
    return !this.isBackfillRunning;
  }

  get months6Class() {
    return this.selectedMonths === 6 ? "segment-active" : "";
  }

  get months12Class() {
    return this.selectedMonths === 12 ? "segment-active" : "";
  }

  get months24Class() {
    return this.selectedMonths === 24 ? "segment-active" : "";
  }

  handleMonthsChange(event) {
    this.selectedMonths = parseInt(event.currentTarget.dataset.months, 10);
  }

  handleRunBackfill() {
    this.isBackfillRunning = true;
    this.backfillJobStatus = null;
    runBackfill({ monthsBack: this.selectedMonths })
      .then((jobId) => {
        this.backfillJobId = jobId;
        this.startBackfillPolling();
      })
      .catch((error) => {
        this.isBackfillRunning = false;
        this.showError("Failed to start backfill", error);
      });
  }

  startBackfillPolling() {
    this.clearBackfillPoll();
    // eslint-disable-next-line @lwc/lwc/no-async-operation
    this._backfillPollInterval = setInterval(() => {
      this.pollBackfillStatus();
    }, BACKFILL_POLL_INTERVAL_MS);
  }

  pollBackfillStatus() {
    if (!this.backfillJobId) {
      this.clearBackfillPoll();
      return;
    }
    getBackfillJobStatus({ jobId: this.backfillJobId })
      .then((status) => {
        this.backfillJobStatus = status;
        if (
          status.status === "Completed" ||
          status.status === "Failed" ||
          status.status === "Aborted"
        ) {
          this.clearBackfillPoll();
          this.isBackfillRunning = false;
          if (status.status === "Completed") {
            this.showSuccess("Backfill analysis complete");
            this.loadSetupStatus();
          } else {
            this.showError("Backfill job " + status.status.toLowerCase());
          }
        }
      })
      .catch(() => {
        this.clearBackfillPoll();
        this.isBackfillRunning = false;
      });
  }

  clearBackfillPoll() {
    if (this._backfillPollInterval) {
      clearInterval(this._backfillPollInterval);
      this._backfillPollInterval = null;
    }
  }

  get backfillProgressPct() {
    if (!this.backfillJobStatus) return 0;
    return Math.round(n(this.backfillJobStatus.percentComplete));
  }

  get backfillProgressStyle() {
    return "width: " + this.backfillProgressPct + "%";
  }

  get backfillStatusText() {
    if (!this.backfillJobStatus) return "Starting...";
    const processed = n(this.backfillJobStatus.jobItemsProcessed);
    const total = n(this.backfillJobStatus.totalJobItems);
    const errors = n(this.backfillJobStatus.numberOfErrors);
    let text = processed + " of " + total + " batches processed";
    if (errors > 0) {
      text += " (" + errors + " error" + (errors !== 1 ? "s" : "") + ")";
    }
    return text;
  }

  handleRunNightly() {
    this.isNightlyRunning = true;
    this.nightlyJobComplete = false;
    runNightlyAnalyzer()
      .then(() => {
        this.nightlyJobComplete = true;
        this.showSuccess("Nightly analyzer started");
      })
      .catch((error) => {
        this.showError("Failed to start nightly analyzer", error);
      })
      .finally(() => {
        this.isNightlyRunning = false;
      });
  }

  // ═══════════════════════════════════════════
  // STEP 6: INTELLIGENCE MATURITY
  // ═══════════════════════════════════════════

  loadMaturityAssessment() {
    this.isLoadingMaturity = true;
    getMaturityAssessment()
      .then((data) => {
        this.maturityData = data;
      })
      .catch((error) => {
        this.showError("Failed to load maturity assessment", error);
      })
      .finally(() => {
        this.isLoadingMaturity = false;
      });
  }

  get hasMaturityData() {
    return this.maturityData != null && !this.isLoadingMaturity;
  }

  get maturityLevels() {
    if (!this.maturityData) return [];
    const currentLevel = n(this.maturityData.level);
    return MATURITY_NAMES.map((name, idx) => {
      const levelNum = idx + 1;
      const isReached = levelNum < currentLevel;
      const isActive = levelNum === currentLevel;
      const isInactive = levelNum > currentLevel;

      let dotClass = "maturity-dot";
      let nameClass = "maturity-name";
      let containerClass = "maturity-level";

      if (isReached) {
        dotClass += " maturity-dot-reached";
        nameClass += " maturity-name-reached";
      } else if (isActive) {
        dotClass += " maturity-dot-active";
        nameClass += " maturity-name-active";
      } else {
        dotClass += " maturity-dot-inactive";
        nameClass += " maturity-name-inactive";
      }

      return {
        number: levelNum,
        name,
        isReached,
        isActive,
        isInactive,
        dotClass,
        nameClass,
        containerClass
      };
    });
  }

  get showCongrats() {
    return this.maturityData && n(this.maturityData.level) >= 3;
  }

  get hasNextActions() {
    return (
      this.maturityData &&
      this.maturityData.nextLevelActions &&
      this.maturityData.nextLevelActions.length > 0 &&
      this.maturityData.nextLevelName
    );
  }

  get nextActionItems() {
    if (!this.hasNextActions) return [];
    return this.maturityData.nextLevelActions.map((text, idx) => ({
      text,
      key: "action-" + idx
    }));
  }

  get summaryDealsAnalyzed() {
    if (!this.setupStatus) return 0;
    return n(this.setupStatus.analyzedDeals);
  }

  get summaryFillRate() {
    return this.overallFillRate;
  }

  get summaryOemCount() {
    if (!this.setupStatus) return 0;
    return n(this.setupStatus.oemCount);
  }

  get summaryCompetitorCount() {
    if (!this.setupStatus) return 0;
    return n(this.setupStatus.competitorCount);
  }

  handleGoToDashboard() {
    this[NavigationMixin.Navigate]({
      type: "standard__navItemPage",
      attributes: {
        apiName: "Fulcrum_Manager_Dashboard"
      }
    });
  }

  // ═══════════════════════════════════════════
  // DEMO DATA
  // ═══════════════════════════════════════════

  handleLoadDemoData() {
    this.isLoadingDemo = true;
    this.demoDataMessage = "";
    loadDemoData()
      .then((result) => {
        this.isLoadingDemo = false;
        if (result.success) {
          this.demoDataLoaded = true;
          if (result.alreadyLoaded) {
            this.demoDataMessage = "Demo data was previously loaded.";
          } else {
            this.demoDataCounts = result;
            this.demoDataMessage = `Loaded ${result.accounts} accounts, ${result.opportunities} opportunities, ${result.oems} OEM vendors, and ${result.competitors} competitor profiles.`;
            // Refresh setup status to reflect new data
            this.loadSetupStatus();
          }
          this.dispatchEvent(
            new ShowToastEvent({
              title: "Demo Data Loaded",
              message: this.demoDataMessage,
              variant: "success"
            })
          );
        } else {
          this.demoDataMessage = result.message || "Failed to load demo data.";
          this.dispatchEvent(
            new ShowToastEvent({
              title: "Error",
              message: this.demoDataMessage,
              variant: "error"
            })
          );
        }
      })
      .catch((error) => {
        this.isLoadingDemo = false;
        this.demoDataMessage = error.body
          ? error.body.message
          : "An unexpected error occurred.";
        this.dispatchEvent(
          new ShowToastEvent({
            title: "Error",
            message: this.demoDataMessage,
            variant: "error"
          })
        );
      });
  }

  get isDemoButtonDisabled() {
    return this.isLoadingDemo || this.demoDataLoaded;
  }

  // ═══════════════════════════════════════════
  // TOAST HELPERS
  // ═══════════════════════════════════════════

  showSuccess(message) {
    this.dispatchEvent(
      new ShowToastEvent({
        title: "Success",
        message,
        variant: "success"
      })
    );
  }

  showError(message, error) {
    const detail = error
      ? error.body?.message || error.message || JSON.stringify(error)
      : "";
    this.dispatchEvent(
      new ShowToastEvent({
        title: message,
        message: detail,
        variant: "error"
      })
    );
  }
}
