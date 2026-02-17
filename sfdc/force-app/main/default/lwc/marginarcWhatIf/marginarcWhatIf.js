import { LightningElement, api, wire, track } from "lwc";
import { getRecord } from "lightning/uiRecordApi";
import { ShowToastEvent } from "lightning/platformShowToastEvent";

const OPPORTUNITY_FIELDS = [
  "Opportunity.Fulcrum_OEM_Cost__c",
  "Opportunity.Fulcrum_Competitors__c",
  "Opportunity.Fulcrum_Deal_Reg_Type__c",
  "Opportunity.Fulcrum_Solution_Complexity__c",
  "Opportunity.Fulcrum_Relationship_Strength__c",
  "Opportunity.Fulcrum_Value_Add__c",
  "Opportunity.Amount"
];

// MarginArc API endpoint (used when scenario API is implemented)
// eslint-disable-next-line no-unused-vars
const MARGINARC_API_URL = "https://api.marginarc.com/api/recommend";

export default class MarginarcWhatIf extends LightningElement {
  @api recordId;
  @track isLoading = false;
  @track scenarios = [];
  @track baseScenario = null;
  @track selectedScenario = null;
  @track oemCostFromRecord = null;

  // Form state
  @track competitors = "1";
  @track dealRegType = "StandardApproved";
  @track solutionComplexity = "Medium";
  @track relationshipStrength = "Good";
  @track valueAdd = "Medium";
  @track marginOverride = null;

  @wire(getRecord, { recordId: "$recordId", fields: OPPORTUNITY_FIELDS })
  wiredOpportunity({ data, error }) {
    if (data) {
      const fields = data.fields;

      // Set OEM cost: prefer Fulcrum_OEM_Cost__c, fallback to 85% of Amount, then 100k
      this.oemCostFromRecord =
        fields.Fulcrum_OEM_Cost__c?.value ||
        (fields.Amount?.value ? fields.Amount.value * 0.85 : null) ||
        100000;

      // Pre-populate form fields from record (only if non-null)
      const competitors = fields.Fulcrum_Competitors__c?.value;
      if (competitors != null) this.competitors = String(competitors);

      const dealReg = fields.Fulcrum_Deal_Reg_Type__c?.value;
      if (dealReg != null) this.dealRegType = dealReg;

      const complexity = fields.Fulcrum_Solution_Complexity__c?.value;
      if (complexity != null) this.solutionComplexity = complexity;

      const relationship = fields.Fulcrum_Relationship_Strength__c?.value;
      if (relationship != null) this.relationshipStrength = relationship;

      const valueAddVal = fields.Fulcrum_Value_Add__c?.value;
      if (valueAddVal != null) this.valueAdd = valueAddVal;
    } else if (error) {
      console.error("Error loading opportunity for what-if:", error);
    }
  }

  // Quick action definitions
  quickActions = [
    {
      id: "fewer-competitors",
      label: "Fewer Competitors",
      icon: "utility:minus",
      apply: (ctx) => ({
        ...ctx,
        competitors: this.stepCompetitors(ctx.competitors, -1)
      }),
      color: "teal"
    },
    {
      id: "premium-reg",
      label: "Premium Registration",
      icon: "utility:ribbon",
      apply: (ctx) => ({ ...ctx, dealRegType: "PremiumHunting" }),
      color: "blue"
    },
    {
      id: "high-complexity",
      label: "High Complexity",
      icon: "utility:layers",
      apply: (ctx) => ({ ...ctx, solutionComplexity: "High" }),
      color: "purple"
    },
    {
      id: "strategic-rel",
      label: "Strategic Relationship",
      icon: "utility:people",
      apply: (ctx) => ({ ...ctx, relationshipStrength: "Strategic" }),
      color: "green"
    },
    {
      id: "high-value",
      label: "High Value-Add",
      icon: "utility:trending",
      apply: (ctx) => ({ ...ctx, valueAdd: "High" }),
      color: "orange"
    }
  ];

  // Picklist options
  get competitorOptions() {
    return [
      { label: "0 competitors", value: "0" },
      { label: "1 competitor", value: "1" },
      { label: "2 competitors", value: "2" },
      { label: "3+ competitors", value: "3+" }
    ];
  }

  get dealRegOptions() {
    return [
      { label: "Not Registered", value: "NotRegistered" },
      { label: "Standard", value: "StandardApproved" },
      { label: "Premium Hunting", value: "PremiumHunting" },
      { label: "Teaming", value: "Teaming" }
    ];
  }

  get complexityOptions() {
    return [
      { label: "Low", value: "Low" },
      { label: "Medium", value: "Medium" },
      { label: "High", value: "High" }
    ];
  }

  get relationshipOptions() {
    return [
      { label: "New", value: "New" },
      { label: "Developing", value: "Developing" },
      { label: "Good", value: "Good" },
      { label: "Strategic", value: "Strategic" }
    ];
  }

  get valueAddOptions() {
    return [
      { label: "Low", value: "Low" },
      { label: "Medium", value: "Medium" },
      { label: "High", value: "High" }
    ];
  }

  // Computed properties
  get hasScenarios() {
    return this.scenarios.length > 0;
  }

  get noScenarios() {
    return this.scenarios.length === 0;
  }

  get scenarioCount() {
    return this.scenarios.length;
  }

  get formattedScenarios() {
    return this.scenarios.map((s, idx) => ({
      ...s,
      index: idx + 1,
      isSelected: this.selectedScenario === idx,
      marginFormatted: s.margin.toFixed(1) + "%",
      winProbFormatted: Math.round(s.winProb * 100) + "%",
      gpFormatted:
        "$" +
        s.grossProfit.toLocaleString(undefined, { maximumFractionDigits: 0 }),
      riskAdjFormatted:
        "$" +
        s.riskAdjusted.toLocaleString(undefined, { maximumFractionDigits: 0 }),
      confidenceFormatted: Math.round(s.confidence * 100) + "%",
      cardClass:
        this.selectedScenario === idx
          ? "scenario-card scenario-card-selected"
          : "scenario-card"
    }));
  }

  get canRunScenario() {
    return !this.isLoading;
  }

  // Helper methods
  stepCompetitors(current, delta) {
    const map = { 0: 0, 1: 1, 2: 2, "3+": 3 };
    const inv = ["0", "1", "2", "3+"];
    const i = map[current] ?? 1;
    const n = Math.max(0, Math.min(3, i + delta));
    return inv[n];
  }

  // Event handlers
  handleCompetitorsChange(event) {
    this.competitors = event.detail.value;
  }

  handleDealRegChange(event) {
    this.dealRegType = event.detail.value;
  }

  handleComplexityChange(event) {
    this.solutionComplexity = event.detail.value;
  }

  handleRelationshipChange(event) {
    this.relationshipStrength = event.detail.value;
  }

  handleValueAddChange(event) {
    this.valueAdd = event.detail.value;
  }

  handleQuickAction(event) {
    const actionId = event.currentTarget.dataset.action;
    const action = this.quickActions.find((a) => a.id === actionId);
    if (action) {
      const currentContext = {
        competitors: this.competitors,
        dealRegType: this.dealRegType,
        solutionComplexity: this.solutionComplexity,
        relationshipStrength: this.relationshipStrength,
        valueAdd: this.valueAdd
      };
      const newContext = action.apply(currentContext);

      this.competitors = newContext.competitors;
      this.dealRegType = newContext.dealRegType;
      this.solutionComplexity = newContext.solutionComplexity;
      this.relationshipStrength = newContext.relationshipStrength;
      this.valueAdd = newContext.valueAdd;

      // Auto-run the scenario
      this.runScenario();
    }
  }

  async runScenario() {
    this.isLoading = true;

    try {
      // Generate scenario locally for now (mock API)
      const scenario = this.generateScenario();
      this.scenarios = [...this.scenarios, scenario];
      this.selectedScenario = this.scenarios.length - 1;

      this.dispatchEvent(
        new ShowToastEvent({
          title: "Scenario Added",
          message: `Scenario ${this.scenarios.length}: ${scenario.margin.toFixed(1)}% margin, ${Math.round(scenario.winProb * 100)}% win probability`,
          variant: "success"
        })
      );
    } catch (err) {
      console.error("Scenario error:", err);
      this.dispatchEvent(
        new ShowToastEvent({
          title: "Error",
          message: "Failed to generate scenario",
          variant: "error"
        })
      );
    } finally {
      this.isLoading = false;
    }
  }

  generateScenario() {
    // Base margin by complexity
    let baseMargin =
      this.solutionComplexity === "High"
        ? 22
        : this.solutionComplexity === "Low"
          ? 12
          : 17;

    // Deal reg adjustment
    if (this.dealRegType === "PremiumHunting") baseMargin += 3;
    else if (this.dealRegType === "NotRegistered") baseMargin -= 2;

    // Relationship adjustment
    if (this.relationshipStrength === "Strategic") baseMargin += 2;
    else if (this.relationshipStrength === "Developing") baseMargin += 0.5;
    else if (this.relationshipStrength === "New") baseMargin -= 1;

    // Value-add adjustment
    if (this.valueAdd === "High") baseMargin += 2;
    else if (this.valueAdd === "Low") baseMargin -= 1;

    // Competition adjustment
    const compAdj =
      this.competitors === "0"
        ? 3
        : this.competitors === "3+"
          ? -4
          : this.competitors === "2"
            ? -2
            : 0;
    baseMargin += compAdj;

    let margin = Math.max(8, Math.min(35, baseMargin));

    // Calculate win probability using logistic model (matches backend winprob.js)
    const compBase =
      this.competitors === "0"
        ? 0.68
        : this.competitors === "1"
          ? 0.58
          : this.competitors === "2"
            ? 0.43
            : 0.32;
    const regBonus =
      this.dealRegType === "PremiumHunting"
        ? 0.12
        : this.dealRegType === "StandardApproved" ||
            this.dealRegType === "Teaming"
          ? 0.06
          : 0;
    const relBonus =
      this.relationshipStrength === "Strategic"
        ? 0.08
        : this.relationshipStrength === "New"
          ? -0.05
          : 0;
    const wpBase = compBase + regBonus + relBonus;
    const logistic = 1 / (1 + Math.exp(0.08 * (margin - 18)));
    const winProb = Math.max(
      0.05,
      Math.min(0.95, 0.6 * wpBase + 0.4 * logistic)
    );

    // Confidence calculation
    const confidence =
      0.45 +
      (this.relationshipStrength === "Strategic" ? 0.1 : 0) +
      (this.dealRegType === "PremiumHunting" ? 0.08 : 0);

    const oemCost = this.oemCostFromRecord || 100000;
    const sellPrice = oemCost / (1 - margin / 100);
    const grossProfit = sellPrice - oemCost;
    const riskAdjusted = grossProfit * winProb;

    return {
      id: Date.now(),
      competitors: this.competitors,
      dealRegType: this.dealRegType,
      solutionComplexity: this.solutionComplexity,
      relationshipStrength: this.relationshipStrength,
      valueAdd: this.valueAdd,
      margin: margin,
      winProb: winProb,
      sellPrice: sellPrice,
      grossProfit: grossProfit,
      riskAdjusted: riskAdjusted,
      confidence: confidence,
      label: this.getScenarioLabel()
    };
  }

  getScenarioLabel() {
    const parts = [];
    if (this.dealRegType === "PremiumHunting") parts.push("Premium");
    if (this.solutionComplexity === "High") parts.push("Complex");
    if (this.relationshipStrength === "Strategic") parts.push("Strategic");
    if (this.competitors === "0") parts.push("No Comp");
    return parts.length > 0 ? parts.join(", ") : "Custom";
  }

  handleSelectScenario(event) {
    const idx = parseInt(event.currentTarget.dataset.index, 10) - 1;
    this.selectedScenario = idx;
  }

  handleRemoveScenario(event) {
    event.stopPropagation();
    const idx = parseInt(event.currentTarget.dataset.index, 10) - 1;
    this.scenarios = this.scenarios.filter((_, i) => i !== idx);
    if (this.selectedScenario >= this.scenarios.length) {
      this.selectedScenario = this.scenarios.length - 1;
    }
  }

  handleClearAll() {
    this.scenarios = [];
    this.selectedScenario = null;
  }
}
