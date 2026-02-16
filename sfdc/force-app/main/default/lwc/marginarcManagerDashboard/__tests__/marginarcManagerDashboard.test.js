import { createElement } from "lwc";
import MarginarcManagerDashboard from "c/marginarcManagerDashboard";
import getPipelineSummary from "@salesforce/apex/MarginArcManagerController.getPipelineSummary";
import getHistoricalPerformance from "@salesforce/apex/MarginArcManagerController.getHistoricalPerformance";
// eslint-disable-next-line no-unused-vars
import getUserContext from "@salesforce/apex/MarginArcManagerController.getUserContext";
// eslint-disable-next-line no-unused-vars
import getTeamComparison from "@salesforce/apex/MarginArcManagerController.getTeamComparison";

// Mock Apex wire adapters using createApexTestWireAdapter
jest.mock(
  "@salesforce/apex/MarginArcManagerController.getPipelineSummary",
  () => {
    const { createApexTestWireAdapter } = require("@salesforce/sfdx-lwc-jest");
    return { default: createApexTestWireAdapter(jest.fn()) };
  },
  { virtual: true }
);
jest.mock(
  "@salesforce/apex/MarginArcManagerController.getHistoricalPerformance",
  () => {
    const { createApexTestWireAdapter } = require("@salesforce/sfdx-lwc-jest");
    return { default: createApexTestWireAdapter(jest.fn()) };
  },
  { virtual: true }
);
jest.mock(
  "@salesforce/apex/MarginArcManagerController.getUserContext",
  () => {
    const { createApexTestWireAdapter } = require("@salesforce/sfdx-lwc-jest");
    return { default: createApexTestWireAdapter(jest.fn()) };
  },
  { virtual: true }
);
jest.mock(
  "@salesforce/apex/MarginArcManagerController.getTeamComparison",
  () => {
    const { createApexTestWireAdapter } = require("@salesforce/sfdx-lwc-jest");
    return { default: createApexTestWireAdapter(jest.fn()) };
  },
  { virtual: true }
);
jest.mock(
  "@salesforce/apex/MarginArcManagerController.getRepDetail",
  () => jest.fn(),
  { virtual: true }
);

// ── Test Data ──
const MOCK_PIPELINE = {
  deals: [
    {
      id: "001A",
      name: "Cisco Refresh",
      accountName: "Acme Corp",
      ownerName: "Matt R",
      ownerId: "005A",
      amount: 500000,
      stageName: "Negotiation/Review",
      plannedMargin: 20,
      recommendedMargin: 22,
      winProbability: 65,
      marginGap: -2,
      oem: "Cisco",
      dealScore: 72,
      dealScoreLabel: "Good"
    },
    {
      id: "001B",
      name: "Palo Alto Security",
      accountName: "Beta Inc",
      ownerName: "Jane D",
      ownerId: "005B",
      amount: 150000,
      stageName: "Proposal/Price Quote",
      plannedMargin: 10,
      recommendedMargin: 18,
      winProbability: 45,
      marginGap: -8,
      oem: "Palo Alto",
      dealScore: 35,
      dealScoreLabel: "Needs Work"
    },
    {
      id: "001C",
      name: "HPE Server Build",
      accountName: "Gamma LLC",
      ownerName: "Matt R",
      ownerId: "005A",
      amount: 75000,
      stageName: "Prospecting",
      plannedMargin: null,
      recommendedMargin: null,
      winProbability: null,
      marginGap: null,
      oem: null,
      dealScore: 50,
      dealScoreLabel: "Fair"
    }
  ],
  kpis: {
    totalPipeline: 725000,
    dealCount: 3,
    avgMarginGap: -3.5,
    complianceRate: 33,
    alertCount: 1,
    ragpDelta: 45000,
    adoptionRate: 33
  },
  alerts: [
    {
      dealId: "001B",
      dealName: "Palo Alto Security",
      ownerName: "Jane D",
      plannedMargin: 10,
      recommendedMargin: 18,
      gap: -8,
      amount: 150000
    }
  ]
};

const MOCK_HISTORICAL = {
  repPerformance: [
    {
      ownerId: "005A",
      ownerName: "Matt R",
      totalDeals: 20,
      wonDeals: 12,
      winRate: 60,
      avgMargin: 19.5,
      totalAmount: 2400000,
      complianceRate: 75,
      compliantDeals: 15,
      marginsChecked: 20
    },
    {
      ownerId: "005B",
      ownerName: "Jane D",
      totalDeals: 15,
      wonDeals: 7,
      winRate: 46.7,
      avgMargin: 15.2,
      totalAmount: 800000,
      complianceRate: 40,
      compliantDeals: 6,
      marginsChecked: 15
    }
  ],
  competitorData: [
    {
      name: "CDW",
      wins: 10,
      losses: 5,
      totalDeals: 15,
      winRate: 66.7,
      avgMarginWon: 19.5,
      avgMarginLost: 14.2
    },
    {
      name: "SHI",
      wins: 8,
      losses: 7,
      totalDeals: 15,
      winRate: 53.3,
      avgMarginWon: 20.1,
      avgMarginLost: 12.5
    },
    {
      name: "Presidio",
      wins: 3,
      losses: 8,
      totalDeals: 11,
      winRate: 27.3,
      avgMarginWon: 17.0,
      avgMarginLost: 15.0
    }
  ],
  marginOpportunity: {
    currentBlendedMargin: 17.8,
    potentialBlendedMargin: 21.3,
    currentGP: 890000,
    potentialGP: 1065000,
    gpDelta: 175000,
    dealCount: 25,
    totalPlannedRAGP: 480000,
    totalRecRAGP: 620000,
    ragpDelta: 140000,
    ragpDealCount: 19
  },
  winRate: 54.3,
  totalClosed: 35,
  totalWon: 19
};

// ── Helpers ──
function createComponent() {
  const element = createElement("c-marginarc-manager-dashboard", {
    is: MarginarcManagerDashboard
  });
  document.body.appendChild(element);
  return element;
}

// eslint-disable-next-line @lwc/lwc/no-async-operation
const flushPromises = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("c-marginarc-manager-dashboard", () => {
  afterEach(() => {
    while (document.body.firstChild) {
      document.body.removeChild(document.body.firstChild);
    }
    jest.clearAllMocks();
  });

  // ── Loading State ──
  it("shows loading state initially", () => {
    const element = createComponent();
    return Promise.resolve().then(() => {
      const spinner = element.shadowRoot.querySelector("lightning-spinner");
      expect(spinner).not.toBeNull();
    });
  });

  // ── KPI Formatting ──
  it("formats KPI values correctly after pipeline data loads", async () => {
    const element = createComponent();
    getPipelineSummary.emit(MOCK_PIPELINE);
    await flushPromises();
    const kpiValues = element.shadowRoot.querySelectorAll(".kpi-value");
    expect(kpiValues.length).toBeGreaterThanOrEqual(3);
    // Total pipeline should be formatted as $725K
    const pipelineKpi = kpiValues[0];
    expect(pipelineKpi.textContent).toBe("$725K");
  });

  it("formats million-dollar pipeline correctly", async () => {
    const element = createComponent();
    const bigPipeline = {
      ...MOCK_PIPELINE,
      kpis: { ...MOCK_PIPELINE.kpis, totalPipeline: 12400000 }
    };
    getPipelineSummary.emit(bigPipeline);
    await flushPromises();
    const kpiValues = element.shadowRoot.querySelectorAll(".kpi-value");
    expect(kpiValues[0].textContent).toBe("$12.4M");
  });

  // ── Alert Bar ──
  it("shows alert bar when under-priced deals exist", async () => {
    const element = createComponent();
    getPipelineSummary.emit(MOCK_PIPELINE);
    await flushPromises();
    const alertBar = element.shadowRoot.querySelector(".alert-bar");
    expect(alertBar).not.toBeNull();
    const alertText = element.shadowRoot.querySelector(".alert-text");
    expect(alertText.textContent).toContain(
      "1 deal with margin >3pp below recommendation"
    );
  });

  it("hides alert bar when no alerts exist", async () => {
    const element = createComponent();
    const noAlerts = {
      ...MOCK_PIPELINE,
      alerts: [],
      kpis: { ...MOCK_PIPELINE.kpis, alertCount: 0 }
    };
    getPipelineSummary.emit(noAlerts);
    await flushPromises();
    const alertBar = element.shadowRoot.querySelector(".alert-bar");
    expect(alertBar).toBeNull();
  });

  // ── Pipeline Table ──
  it("renders deal rows with correct data", async () => {
    const element = createComponent();
    getPipelineSummary.emit(MOCK_PIPELINE);
    await flushPromises();
    const rows = element.shadowRoot.querySelectorAll(".table-row");
    expect(rows.length).toBe(3);
  });

  it("applies score-good class for high deal scores", async () => {
    const element = createComponent();
    getPipelineSummary.emit(MOCK_PIPELINE);
    await flushPromises();
    const goodCircles = element.shadowRoot.querySelectorAll(".score-good");
    expect(goodCircles.length).toBe(1);
    expect(goodCircles[0].textContent).toBe("72");
  });

  it("applies gap-alert class for gaps worse than -3pp", async () => {
    const element = createComponent();
    getPipelineSummary.emit(MOCK_PIPELINE);
    await flushPromises();
    const alertGaps = element.shadowRoot.querySelectorAll(".gap-alert");
    expect(alertGaps.length).toBe(1);
    expect(alertGaps[0].textContent).toBe("-8.0pp");
  });

  it("shows -- for null margin fields", async () => {
    const element = createComponent();
    getPipelineSummary.emit(MOCK_PIPELINE);
    await flushPromises();
    const rows = element.shadowRoot.querySelectorAll(".table-row");
    // Sorted by score desc: 72, 50, 35 — HPE Server Build (score 50) is at index 1
    const hpeDeal = rows[1];
    const cells = hpeDeal.querySelectorAll(".cell-plan, .cell-rec");
    cells.forEach((cell) => {
      expect(cell.textContent).toBe("--");
    });
  });

  // ── Sorting ──
  it("sorts deals by score descending by default", async () => {
    const element = createComponent();
    getPipelineSummary.emit(MOCK_PIPELINE);
    await flushPromises();
    const scoreCircles = element.shadowRoot.querySelectorAll(".score-circle");
    const scores = Array.from(scoreCircles).map((el) =>
      parseInt(el.textContent, 10)
    );
    // Should be descending: 72, 50, 35
    expect(scores).toEqual([72, 50, 35]);
  });

  it("toggles sort direction on clicking active column", async () => {
    const element = createComponent();
    getPipelineSummary.emit(MOCK_PIPELINE);
    await flushPromises();
    // Click the score header to toggle to ascending
    const scoreHeader = element.shadowRoot.querySelector(
      '[data-field="dealScore"]'
    );
    scoreHeader.click();
    await flushPromises();
    const scoreCircles = element.shadowRoot.querySelectorAll(".score-circle");
    const scores = Array.from(scoreCircles).map((el) =>
      parseInt(el.textContent, 10)
    );
    // Should now be ascending: 35, 50, 72
    expect(scores).toEqual([35, 50, 72]);
  });

  it("switches sort field when clicking a different column", async () => {
    const element = createComponent();
    getPipelineSummary.emit(MOCK_PIPELINE);
    await flushPromises();
    const amountHeader = element.shadowRoot.querySelector(
      '[data-field="amount"]'
    );
    amountHeader.click();
    await flushPromises();
    const amounts = element.shadowRoot.querySelectorAll(".cell-amount");
    const values = Array.from(amounts).map((el) => el.textContent);
    // Descending by amount: $500K, $150K, $75K
    expect(values).toEqual(["$500K", "$150K", "$75K"]);
  });

  // ── Rep Performance ──
  it("renders rep performance rows after historical data loads", async () => {
    const element = createComponent();
    getPipelineSummary.emit(MOCK_PIPELINE);
    getHistoricalPerformance.emit(MOCK_HISTORICAL);
    await flushPromises();
    const repRows = element.shadowRoot.querySelectorAll(".rep-row");
    expect(repRows.length).toBe(2);
  });

  it("applies compliance-good class for high compliance", async () => {
    const element = createComponent();
    getPipelineSummary.emit(MOCK_PIPELINE);
    getHistoricalPerformance.emit(MOCK_HISTORICAL);
    await flushPromises();
    const good = element.shadowRoot.querySelectorAll(".compliance-good");
    expect(good.length).toBe(1);
  });

  it("applies compliance-poor class for low compliance", async () => {
    const element = createComponent();
    getPipelineSummary.emit(MOCK_PIPELINE);
    getHistoricalPerformance.emit(MOCK_HISTORICAL);
    await flushPromises();
    const poor = element.shadowRoot.querySelectorAll(".compliance-poor");
    expect(poor.length).toBe(1);
  });

  // ── Margin Opportunity ──
  it("renders margin opportunity bars and RAGP cards", async () => {
    const element = createComponent();
    getPipelineSummary.emit(MOCK_PIPELINE);
    getHistoricalPerformance.emit(MOCK_HISTORICAL);
    await flushPromises();
    const barFills = element.shadowRoot.querySelectorAll(".bar-fill");
    expect(barFills.length).toBe(2);
    const ragpCards = element.shadowRoot.querySelectorAll(".ragp-card");
    expect(ragpCards.length).toBe(2);
  });

  it("renders RAGP comparison values correctly", async () => {
    const element = createComponent();
    getPipelineSummary.emit(MOCK_PIPELINE);
    getHistoricalPerformance.emit(MOCK_HISTORICAL);
    await flushPromises();
    const ragpValues = element.shadowRoot.querySelectorAll(".ragp-value");
    // Planned RAGP $480K and Recommended RAGP $620K
    expect(ragpValues.length).toBeGreaterThanOrEqual(2);
    expect(ragpValues[0].textContent).toBe("$480K");
    expect(ragpValues[1].textContent).toBe("$620K");
  });

  // ── Competitive Performance ──
  it("renders competitor rows with win rate bars", async () => {
    const element = createComponent();
    getPipelineSummary.emit(MOCK_PIPELINE);
    getHistoricalPerformance.emit(MOCK_HISTORICAL);
    await flushPromises();
    const compRows = element.shadowRoot.querySelectorAll(".comp-row");
    expect(compRows.length).toBe(3);
    const compBars = element.shadowRoot.querySelectorAll(".comp-bar-fill");
    expect(compBars.length).toBe(3);
  });

  it("applies correct color classes to competitor win rate bars", async () => {
    const element = createComponent();
    getPipelineSummary.emit(MOCK_PIPELINE);
    getHistoricalPerformance.emit(MOCK_HISTORICAL);
    await flushPromises();
    // CDW 66.7% = comp-good, SHI 53.3% = comp-fair, Presidio 27.3% = comp-poor
    expect(element.shadowRoot.querySelectorAll(".comp-good").length).toBe(1);
    expect(element.shadowRoot.querySelectorAll(".comp-fair").length).toBe(1);
    expect(element.shadowRoot.querySelectorAll(".comp-poor").length).toBe(1);
  });

  // ── Section Collapse ──
  it("collapses and expands sections on click", async () => {
    const element = createComponent();
    getPipelineSummary.emit(MOCK_PIPELINE);
    await flushPromises();

    // Pipeline table should be visible
    let table = element.shadowRoot.querySelector(".pipeline-table");
    expect(table).not.toBeNull();

    // Click the pipeline section header to collapse
    const header = element.shadowRoot.querySelector(
      '[data-section="pipeline"]'
    );
    header.click();
    await flushPromises();
    table = element.shadowRoot.querySelector(".pipeline-table");
    expect(table).toBeNull();

    // Click again to expand
    header.click();
    await flushPromises();
    table = element.shadowRoot.querySelector(".pipeline-table");
    expect(table).not.toBeNull();
  });

  // ── Time Range ──
  it("shows time range dropdown on button click", async () => {
    const element = createComponent();
    getPipelineSummary.emit(MOCK_PIPELINE);
    await flushPromises();

    let menu = element.shadowRoot.querySelector(".dropdown-menu");
    expect(menu).toBeNull();

    const btn = element.shadowRoot.querySelector(".btn-time-range");
    btn.click();
    await flushPromises();
    menu = element.shadowRoot.querySelector(".dropdown-menu");
    expect(menu).not.toBeNull();
    const items = menu.querySelectorAll(".dropdown-item");
    expect(items.length).toBe(5);
  });

  // ── Error State ──
  it("shows error state on pipeline error", async () => {
    const element = createComponent();
    getPipelineSummary.error({ message: "Test error" });
    await flushPromises();
    const errorText = element.shadowRoot.querySelector(".error-text");
    expect(errorText).not.toBeNull();
    expect(errorText.textContent).toBe("Test error");
  });

  // ── Filter Pills ──
  it("renders filter pills with correct counts", async () => {
    const element = createComponent();
    getPipelineSummary.emit(MOCK_PIPELINE);
    await flushPromises();
    const pills = element.shadowRoot.querySelectorAll(".filter-pill");
    expect(pills.length).toBe(5);
    // All (3)
    expect(pills[0].textContent).toContain("All (3)");
  });

  it("filters pipeline table when clicking a filter pill", async () => {
    const element = createComponent();
    getPipelineSummary.emit(MOCK_PIPELINE);
    await flushPromises();
    // Click "Warning" pill — deal 001B has gap -8 (warning: -10 <= gap < -3)
    const pills = element.shadowRoot.querySelectorAll(".filter-pill");
    const warningPill = Array.from(pills).find(
      (p) => p.dataset.filter === "warning"
    );
    warningPill.click();
    await flushPromises();
    const rows = element.shadowRoot.querySelectorAll(".table-row");
    expect(rows.length).toBe(1);
  });

  it("shows severity breakdown in alert bar", async () => {
    const element = createComponent();
    getPipelineSummary.emit(MOCK_PIPELINE);
    await flushPromises();
    const alertText = element.shadowRoot.querySelector(".alert-text");
    expect(alertText.textContent).toContain("1 warning");
  });

  it("shows pagination when deals exceed page size", async () => {
    const element = createComponent();
    const manyDeals = [];
    for (let i = 0; i < 30; i++) {
      manyDeals.push({
        id: "001" + String(i).padStart(2, "0"),
        name: "Deal " + i,
        accountName: "Account " + i,
        ownerName: "Rep",
        ownerId: "005A",
        amount: 100000,
        stageName: "Negotiation/Review",
        plannedMargin: 20,
        recommendedMargin: 22,
        winProbability: 60,
        marginGap: -2,
        oem: "Cisco",
        dealScore: 70,
        dealScoreLabel: "Good"
      });
    }
    const bigPipeline = {
      deals: manyDeals,
      kpis: { ...MOCK_PIPELINE.kpis, dealCount: 30 },
      alerts: []
    };
    getPipelineSummary.emit(bigPipeline);
    await flushPromises();
    const rows = element.shadowRoot.querySelectorAll(".table-row");
    expect(rows.length).toBe(25);
    const pageIndicator = element.shadowRoot.querySelector(".page-indicator");
    expect(pageIndicator.textContent).toContain("Page 1 of 2");
  });

  // ── KPI Classes ──
  it("applies correct CSS class for positive RAGP delta", async () => {
    const element = createComponent();
    getPipelineSummary.emit(MOCK_PIPELINE);
    await flushPromises();
    const kpiValues = element.shadowRoot.querySelectorAll(".kpi-value");
    // ragpDelta is 45000 (positive), should have kpi-positive class
    const ragpKpi = kpiValues[1];
    expect(ragpKpi.classList.contains("kpi-positive")).toBe(true);
  });

  it("applies correct CSS class for low adoption rate", async () => {
    const element = createComponent();
    getPipelineSummary.emit(MOCK_PIPELINE);
    await flushPromises();
    const kpiValues = element.shadowRoot.querySelectorAll(".kpi-value");
    // adoptionRate is 33% (<50), should have kpi-negative class
    const adoptionKpi = kpiValues[3];
    expect(adoptionKpi.classList.contains("kpi-negative")).toBe(true);
  });
});
