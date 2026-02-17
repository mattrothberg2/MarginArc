import { LightningElement, track } from "lwc";
import { NavigationMixin } from "lightning/navigation";
import { ShowToastEvent } from "lightning/platformShowToastEvent";
import getSetupStatus from "@salesforce/apex/MarginArcSetupController.getSetupStatus";
import getFieldMappingSuggestions from "@salesforce/apex/MarginArcSetupController.getFieldMappingSuggestions";
import runBackfill from "@salesforce/apex/MarginArcSetupController.runBackfill";
import getBackfillJobStatus from "@salesforce/apex/MarginArcSetupController.getBackfillJobStatus";
import runNightlyAnalyzer from "@salesforce/apex/MarginArcSetupController.runNightlyAnalyzer";
import getMaturityAssessment from "@salesforce/apex/MarginArcSetupController.getMaturityAssessment";
import getAlgorithmPhaseStatus from "@salesforce/apex/MarginArcSetupController.getAlgorithmPhaseStatus";
import enableAlgorithmPhase from "@salesforce/apex/MarginArcSetupController.enableAlgorithmPhase";
import loadDemoData from "@salesforce/apex/MarginArcDemoDataLoader.loadDemoData";
import loadScenarioData from "@salesforce/apex/MarginArcDemoDataLoader.loadScenarioData";
import clearDemoData from "@salesforce/apex/MarginArcDemoDataLoader.clearDemoData";

function n(val) {
  return val == null ? 0 : Number(val);
}

const STEP_LABELS = [
  "Welcome",
  "Connection",
  "Data Quality",
  "Configuration",
  "Backfill",
  "Algorithm Phases",
  "Complete"
];

const MATURITY_NAMES = [
  "Initial",
  "Connected",
  "Populated",
  "Operational",
  "Optimized"
];

const PHASE_DEFINITIONS = [
  {
    number: 1,
    title: "Phase 1: Foundation",
    description:
      "Rule-based margin recommendations using OEM vendor data, deal size, and customer segment."
  },
  {
    number: 2,
    title: "Phase 2: Learning",
    description:
      "Historical win/loss patterns are incorporated. The engine learns from scored deals to calibrate win probability and adjust margins."
  },
  {
    number: 3,
    title: "Phase 3: Advanced",
    description:
      "Full BOM-level analysis with component-level margin optimization, vendor-specific cost modeling, and competitive intelligence."
  }
];

const DEMO_SCENARIOS = [
  {
    id: "networking-var",
    name: "Networking VAR",
    icon: "N",
    description: "Cisco/Aruba heavy, mid-market focus, avg $75K deals"
  },
  {
    id: "security-var",
    name: "Security VAR",
    icon: "S",
    description: "Palo Alto/Fortinet focused, enterprise, avg $120K deals"
  },
  {
    id: "cloud-var",
    name: "Cloud VAR",
    icon: "C",
    description: "VMware/Azure/AWS heavy, mid-market, avg $90K deals"
  },
  {
    id: "full-stack-var",
    name: "Full Stack VAR",
    icon: "F",
    description: "Balanced OEM mix across all segments, avg $95K deals"
  },
  {
    id: "services-heavy-var",
    name: "Services Heavy VAR",
    icon: "V",
    description: "High services attach, consulting-led, avg $110K deals"
  }
];

const DEAL_COUNT_OPTIONS = [100, 250, 500];

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
  @track selectedScenario = null;
  @track selectedDealCount = 250;
  @track isClearingDemo = false;

  // ── Backfill State ──
  @track selectedMonths = 12;
  @track backfillJobId = null;
  @track backfillJobStatus = null;
  @track isBackfillRunning = false;
  @track isNightlyRunning = false;
  @track nightlyJobComplete = false;

  // ── Algorithm Phase State ──
  @track phaseData = null;
  @track isLoadingPhase = false;
  @track phaseErrorMessage = "";
  @track showPhaseConfirmModal = false;
  @track pendingPhase = null;
  @track isEnablingPhase = false;

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
    return 7;
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

  get isStep7() {
    return this.currentStep === 7;
  }

  get showPrevButton() {
    return this.currentStep > 1;
  }

  get showNextButton() {
    return this.currentStep < 7;
  }

  handlePrevStep() {
    if (this.currentStep > 1) {
      this.currentStep--;
      this.onStepChange();
    }
  }

  handleNextStep() {
    if (this.currentStep < 7) {
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
      this.loadAlgorithmPhaseStatus();
    }
    if (this.currentStep === 7) {
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
  // STEP 6: ALGORITHM PHASES
  // ═══════════════════════════════════════════

  loadAlgorithmPhaseStatus() {
    this.isLoadingPhase = true;
    this.phaseErrorMessage = "";
    getAlgorithmPhaseStatus()
      .then((data) => {
        if (data.success) {
          this.phaseData = data;
        } else {
          this.phaseErrorMessage =
            data.message || "Failed to load phase status.";
          this.phaseData = null;
        }
      })
      .catch((error) => {
        this.phaseErrorMessage =
          error.body?.message ||
          error.message ||
          "Failed to load phase status.";
        this.phaseData = null;
      })
      .finally(() => {
        this.isLoadingPhase = false;
      });
  }

  get hasPhaseData() {
    return this.phaseData != null && !this.isLoadingPhase;
  }

  get phaseError() {
    return (
      this.phaseErrorMessage !== "" &&
      !this.isLoadingPhase &&
      this.phaseData == null
    );
  }

  get currentPhaseNumber() {
    return this.phaseData ? n(this.phaseData.currentPhase) : 1;
  }

  get phaseIndicators() {
    const current = this.currentPhaseNumber;
    return PHASE_DEFINITIONS.map((def) => {
      const isCompleted = def.number < current;
      const isCurrent = def.number === current;
      const isUpcoming = def.number > current;
      const hasConnector = def.number < PHASE_DEFINITIONS.length;

      let iconClass = "phase-icon";
      let titleClass = "phase-title";
      let descClass = "phase-desc";
      let connectorClass = "phase-connector";
      let containerClass = "phase-item";

      if (isCompleted) {
        iconClass += " phase-icon-completed";
        titleClass += " phase-title-completed";
        containerClass += " phase-item-completed";
        connectorClass += " phase-connector-completed";
      } else if (isCurrent) {
        iconClass += " phase-icon-current";
        titleClass += " phase-title-current";
        containerClass += " phase-item-current";
        connectorClass += " phase-connector-active";
      } else {
        iconClass += " phase-icon-upcoming";
        titleClass += " phase-title-upcoming";
        containerClass += " phase-item-upcoming";
        connectorClass += " phase-connector-upcoming";
      }

      return {
        number: def.number,
        title: def.title,
        description: def.description,
        isCompleted,
        isCurrent,
        isUpcoming,
        hasConnector,
        iconClass,
        titleClass,
        descClass,
        connectorClass,
        containerClass
      };
    });
  }

  // Phase 2 requirements
  get showPhase2Requirements() {
    return this.hasPhaseData && this.currentPhaseNumber < 2;
  }

  get phase2ScoredDeals() {
    if (!this.phaseData || !this.phaseData.phase2)
      return { required: 50, current: 0 };
    const p2 = this.phaseData.phase2;
    return {
      required: n(p2.scoredDeals?.required || p2.scoredDealsRequired) || 50,
      current: n(p2.scoredDeals?.current || p2.scoredDealsCurrent) || 0
    };
  }

  get phase2ScoredDealsText() {
    const d = this.phase2ScoredDeals;
    return d.current + " of " + d.required + " scored deals";
  }

  get phase2ScoredDealsBarStyle() {
    const d = this.phase2ScoredDeals;
    const pct =
      d.required > 0
        ? Math.min(100, Math.round((d.current / d.required) * 100))
        : 0;
    return "width: " + pct + "%";
  }

  get phase2DataQuality() {
    if (!this.phaseData || !this.phaseData.phase2)
      return { required: 60, current: 0 };
    const p2 = this.phaseData.phase2;
    return {
      required: n(p2.dataQuality?.required || p2.dataQualityRequired) || 60,
      current: n(p2.dataQuality?.current || p2.dataQualityCurrent) || 0
    };
  }

  get phase2DataQualityText() {
    const d = this.phase2DataQuality;
    return d.current + "% of " + d.required + "% data quality";
  }

  get phase2DataQualityBarStyle() {
    const d = this.phase2DataQuality;
    const pct =
      d.required > 0
        ? Math.min(100, Math.round((d.current / d.required) * 100))
        : 0;
    return "width: " + pct + "%";
  }

  get canEnablePhase2() {
    const deals = this.phase2ScoredDeals;
    const quality = this.phase2DataQuality;
    return (
      deals.current >= deals.required && quality.current >= quality.required
    );
  }

  get phase2ScoredDealsBarClass() {
    const d = this.phase2ScoredDeals;
    return d.current >= d.required
      ? "phase-progress-fill phase-progress-met"
      : "phase-progress-fill";
  }

  get phase2DataQualityBarClass() {
    const d = this.phase2DataQuality;
    return d.current >= d.required
      ? "phase-progress-fill phase-progress-met"
      : "phase-progress-fill";
  }

  // Phase 3 requirements
  get showPhase3Requirements() {
    return (
      this.hasPhaseData &&
      this.currentPhaseNumber >= 2 &&
      this.currentPhaseNumber < 3
    );
  }

  get phase2ActiveForPhase3() {
    if (!this.phaseData || !this.phaseData.phase3) return false;
    return this.currentPhaseNumber >= 2;
  }

  get phase2ActiveText() {
    return this.phase2ActiveForPhase3 ? "Active" : "Not active";
  }

  get phase2ActiveStatusClass() {
    return this.phase2ActiveForPhase3
      ? "phase-req-value phase-req-met"
      : "phase-req-value phase-req-unmet";
  }

  get phase3BomDeals() {
    if (!this.phaseData || !this.phaseData.phase3)
      return { required: 20, current: 0 };
    const p3 = this.phaseData.phase3;
    return {
      required: n(p3.bomDeals?.required || p3.bomDealsRequired) || 20,
      current: n(p3.bomDeals?.current || p3.bomDealsCurrent) || 0
    };
  }

  get phase3BomDealsText() {
    const d = this.phase3BomDeals;
    return d.current + " of " + d.required + " deals with BOM data";
  }

  get phase3BomDealsBarStyle() {
    const d = this.phase3BomDeals;
    const pct =
      d.required > 0
        ? Math.min(100, Math.round((d.current / d.required) * 100))
        : 0;
    return "width: " + pct + "%";
  }

  get phase3BomDealsBarClass() {
    const d = this.phase3BomDeals;
    return d.current >= d.required
      ? "phase-progress-fill phase-progress-met"
      : "phase-progress-fill";
  }

  get canEnablePhase3() {
    const bom = this.phase3BomDeals;
    return this.phase2ActiveForPhase3 && bom.current >= bom.required;
  }

  get isPhase3Active() {
    return this.hasPhaseData && this.currentPhaseNumber >= 3;
  }

  get phaseDescriptions() {
    return PHASE_DEFINITIONS;
  }

  // Phase enable handlers
  handleEnablePhase2() {
    this.pendingPhase = 2;
    this.showPhaseConfirmModal = true;
  }

  handleEnablePhase3() {
    this.pendingPhase = 3;
    this.showPhaseConfirmModal = true;
  }

  get phaseConfirmMessage() {
    if (this.pendingPhase === 2) {
      return "Enabling Phase 2 activates the Learning algorithm. Reps will see margin recommendations that incorporate historical win/loss patterns from your scored deals. Recommendations may shift as the engine recalibrates based on your data. This change takes effect immediately.";
    }
    if (this.pendingPhase === 3) {
      return "Enabling Phase 3 activates Advanced BOM-level analysis. Reps will see component-level margin breakdowns and vendor-specific cost recommendations. The Margin Advisor widget will display additional BOM fields. This change takes effect immediately.";
    }
    return "";
  }

  handleClosePhaseModal() {
    this.showPhaseConfirmModal = false;
    this.pendingPhase = null;
  }

  handleModalContentClick(event) {
    event.stopPropagation();
  }

  handleConfirmEnablePhase() {
    if (!this.pendingPhase) return;
    this.isEnablingPhase = true;
    enableAlgorithmPhase({ phase: this.pendingPhase })
      .then((result) => {
        if (result.success) {
          this.showSuccess(
            "Phase " + this.pendingPhase + " enabled successfully"
          );
          this.showPhaseConfirmModal = false;
          this.pendingPhase = null;
          this.loadAlgorithmPhaseStatus();
        } else {
          this.showError("Failed to enable phase", { message: result.message });
        }
      })
      .catch((error) => {
        this.showError("Failed to enable phase", error);
      })
      .finally(() => {
        this.isEnablingPhase = false;
      });
  }

  // ═══════════════════════════════════════════
  // STEP 7: INTELLIGENCE MATURITY
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

  get scenarioCards() {
    return DEMO_SCENARIOS.map((s) => ({
      ...s,
      isSelected: this.selectedScenario === s.id,
      cardClass:
        "scenario-card" +
        (this.selectedScenario === s.id ? " scenario-card-selected" : "")
    }));
  }

  get dealCountButtons() {
    return DEAL_COUNT_OPTIONS.map((count) => ({
      count,
      label: count + " deals",
      isSelected: this.selectedDealCount === count,
      btnClass: this.selectedDealCount === count ? "segment-active" : ""
    }));
  }

  handleSelectScenario(event) {
    this.selectedScenario = event.currentTarget.dataset.scenario;
  }

  handleDealCountChange(event) {
    this.selectedDealCount = parseInt(event.currentTarget.dataset.count, 10);
  }

  get isScenarioSelected() {
    return this.selectedScenario != null;
  }

  get isDemoLoadDisabled() {
    return (
      this.isLoadingDemo || this.demoDataLoaded || this.selectedScenario == null
    );
  }

  handleLoadDemoData() {
    if (this.selectedScenario) {
      this.handleLoadScenarioData();
    } else {
      this.handleLoadBasicDemoData();
    }
  }

  handleLoadBasicDemoData() {
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
            this.demoDataMessage =
              "Loaded " +
              result.accounts +
              " accounts, " +
              result.opportunities +
              " opportunities, " +
              result.oems +
              " OEM vendors, and " +
              result.competitors +
              " competitor profiles.";
            this.loadSetupStatus();
          }
          this.showSuccess(this.demoDataMessage);
        } else {
          this.demoDataMessage = result.message || "Failed to load demo data.";
          this.showError("Demo Data Error", { message: this.demoDataMessage });
        }
      })
      .catch((error) => {
        this.isLoadingDemo = false;
        this.demoDataMessage = error.body
          ? error.body.message
          : "An unexpected error occurred.";
        this.showError("Error", { message: this.demoDataMessage });
      });
  }

  handleLoadScenarioData() {
    this.isLoadingDemo = true;
    this.demoDataMessage = "";
    loadScenarioData({
      scenario: this.selectedScenario,
      dealCount: this.selectedDealCount
    })
      .then((result) => {
        this.isLoadingDemo = false;
        if (result.success) {
          this.demoDataLoaded = true;
          if (result.alreadyLoaded) {
            this.demoDataMessage = result.message;
          } else {
            this.demoDataCounts = result;
            this.demoDataMessage = result.message;
            this.loadSetupStatus();
          }
          this.showSuccess(this.demoDataMessage);
        } else {
          this.demoDataMessage =
            result.message || "Failed to load scenario data.";
          this.showError("Demo Data Error", { message: this.demoDataMessage });
        }
      })
      .catch((error) => {
        this.isLoadingDemo = false;
        this.demoDataMessage = error.body
          ? error.body.message
          : "An unexpected error occurred.";
        this.showError("Error", { message: this.demoDataMessage });
      });
  }

  handleClearDemoData() {
    this.isClearingDemo = true;
    this.demoDataMessage = "";
    clearDemoData()
      .then((result) => {
        this.isClearingDemo = false;
        if (result.success) {
          this.demoDataLoaded = false;
          this.demoDataCounts = null;
          this.demoDataMessage = "";
          this.selectedScenario = null;
          this.loadSetupStatus();
          this.showSuccess(result.message);
        } else {
          this.demoDataMessage = result.message || "Failed to clear demo data.";
          this.showError("Clear Error", { message: this.demoDataMessage });
        }
      })
      .catch((error) => {
        this.isClearingDemo = false;
        this.demoDataMessage = error.body
          ? error.body.message
          : "An unexpected error occurred.";
        this.showError("Error", { message: this.demoDataMessage });
      });
  }

  get isClearDisabled() {
    return this.isClearingDemo || this.isLoadingDemo;
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
