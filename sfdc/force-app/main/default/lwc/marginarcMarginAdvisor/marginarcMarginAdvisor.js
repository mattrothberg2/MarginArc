import { LightningElement, api, wire, track } from "lwc";
import { getRecord, updateRecord } from "lightning/uiRecordApi";
import { ShowToastEvent } from "lightning/platformShowToastEvent";
import { refreshApex } from "@salesforce/apex";
import generateAIExplanation from "@salesforce/apex/MarginArcController.generateAIExplanation";
import callMarginArcApi from "@salesforce/apex/MarginArcController.callMarginArcApi";
import getOemRecords from "@salesforce/apex/MarginArcController.getOemRecords";
import getRecommendationHistory from "@salesforce/apex/MarginArcController.getRecommendationHistory";
import logRecommendation from "@salesforce/apex/MarginArcController.logRecommendation";
import saveBomLines from "@salesforce/apex/MarginArcController.saveBomLines";
import getBomLines from "@salesforce/apex/MarginArcController.getBomLines";
import getCompetitorRecords from "@salesforce/apex/MarginArcAdminController.getCompetitorList";
// Widget version
const WIDGET_VERSION = "4.1";
const LAST_UPDATED = "2026-02-09";

// Field imports for updateRecord
import ID_FIELD from "@salesforce/schema/Opportunity.Id";
import AMOUNT_FIELD from "@salesforce/schema/Opportunity.Amount";
import RECOMMENDED_MARGIN_FIELD from "@salesforce/schema/Opportunity.Fulcrum_Recommended_Margin__c";
import AI_CONFIDENCE_FIELD from "@salesforce/schema/Opportunity.Fulcrum_AI_Confidence__c";
import WIN_PROBABILITY_FIELD from "@salesforce/schema/Opportunity.Fulcrum_Win_Probability__c";
import PLANNED_MARGIN_FIELD from "@salesforce/schema/Opportunity.Fulcrum_Planned_Margin__c";
// Fulcrum_Margin__c is a formula field (Revenue * GP%) — not imported for writes
import REVENUE_FIELD from "@salesforce/schema/Opportunity.Fulcrum_Revenue__c";
import GP_PERCENT_FIELD from "@salesforce/schema/Opportunity.Fulcrum_GP_Percent__c";
// eslint-disable-next-line no-unused-vars
import OEM_COST_FIELD from "@salesforce/schema/Opportunity.Fulcrum_OEM_Cost__c";

// Field mappings for Opportunity - including MarginArc custom fields
const OPPORTUNITY_FIELDS = [
  "Opportunity.Name",
  "Opportunity.Amount",
  "Opportunity.Probability",
  "Opportunity.StageName",
  "Opportunity.Account.Name",
  "Opportunity.Account.Industry",
  "Opportunity.Fulcrum_OEM__c",
  "Opportunity.Fulcrum_Competitor_Names__c",
  "Opportunity.Fulcrum_OEM_Cost__c",
  "Opportunity.Fulcrum_Planned_Margin__c",
  "Opportunity.Fulcrum_Recommended_Margin__c",
  "Opportunity.Fulcrum_AI_Confidence__c",
  "Opportunity.Fulcrum_Win_Probability__c",
  "Opportunity.Fulcrum_Customer_Segment__c",
  "Opportunity.Fulcrum_Deal_Reg_Type__c",
  "Opportunity.Fulcrum_Solution_Complexity__c",
  "Opportunity.Fulcrum_Relationship_Strength__c",
  "Opportunity.Fulcrum_Value_Add__c",
  "Opportunity.Fulcrum_Competitors__c",
  "Opportunity.Fulcrum_Services_Attached__c",
  "Opportunity.Fulcrum_Deal_Type__c",
  "Opportunity.Fulcrum_Quarter_End__c",
  "Opportunity.Fulcrum_Product_Category__c"
];

export default class MarginarcMarginAdvisor extends LightningElement {
  @api recordId;
  @track isLoading = false;
  @track error = null;
  @track recommendation = null;
  @track opportunityData = null;

  // State tracking
  @track degradationLevel = 0; // 0=full, 1=AI unavail, 2=network unavail, 3=API unavail, 4=offline
  @track _lastApiError = ""; // Diagnostic: captures actual error for debugging
  @track historyData = null;
  @track collapsedSections = {};
  @track showConfirmDialog = false;
  @track savedBomData = null;
  hasCalculated = false;
  wiredOpportunityResult; // Store for refreshApex
  _oemDataMap = {}; // OEM Name → { baseMargin, dealRegBoost, ... } from Fulcrum_OEM__c
  _competitorDataMap = {}; // Competitor Name → { priceAggression, marginAggression, ... } from Fulcrum_Competitor__c

  // Wire OEM reference data from Fulcrum_OEM__c custom object
  @wire(getOemRecords)
  wiredOemRecords({ data, error }) {
    if (data && data.length > 0) {
      const map = {};
      for (const rec of data) {
        map[rec.Name] = {
          baseMargin: rec.Base_Margin__c || 15,
          dealRegBoost: rec.Deal_Reg_Margin_Boost__c || 3,
          productCategory: rec.Product_Category__c || null,
          quarterEndDiscount: rec.Quarter_End_Discount__c || 0,
          servicesBoost: rec.Services_Margin_Boost__c || 0
        };
      }
      this._oemDataMap = map;
      console.log(
        "OEM data loaded from Fulcrum_OEM__c:",
        Object.keys(map).length,
        "records"
      );
    } else if (error) {
      console.warn("OEM data query failed, using hardcoded fallback:", error);
    }
  }

  // Wire competitor reference data from Fulcrum_Competitor__c custom object
  @wire(getCompetitorRecords)
  wiredCompetitorRecords({ data, error }) {
    if (data && data.length > 0) {
      const map = {};
      for (const rec of data) {
        map[rec.Name] = {
          priceAggression: Number(rec.Price_Aggression__c) || 3,
          marginAggression: Number(rec.Margin_Aggression__c) || 0,
          typicalDiscount: Number(rec.Typical_Discount__c) || 0,
          servicesCapability: Number(rec.Services_Capability__c) || 3,
          primaryOems: rec.Primary_OEMs__c || "",
          primaryStrength: rec.Primary_Strength__c || ""
        };
      }
      this._competitorDataMap = map;
      console.log(
        "Competitor data loaded:",
        Object.keys(map).length,
        "records"
      );
    } else if (error) {
      console.warn("Competitor data query failed:", error);
    }
  }

  // Wire recommendation history
  _wiredHistoryResult;
  @wire(getRecommendationHistory, { opportunityId: "$recordId" })
  wiredHistory(result) {
    this._wiredHistoryResult = result;
    if (result.data) {
      this.historyData = result.data;
    } else if (result.error) {
      this.historyData = null;
    }
  }

  // Wire the opportunity record
  @wire(getRecord, { recordId: "$recordId", fields: OPPORTUNITY_FIELDS })
  wiredOpportunity(result) {
    this.wiredOpportunityResult = result; // Store for refresh
    const { error, data } = result;
    console.log("Wire adapter result:", {
      error,
      data,
      recordId: this.recordId
    });
    if (data) {
      this.opportunityData = this.mapOpportunityData(data);
      console.log("Mapped opportunity data:", this.opportunityData);
      this.error = null;
    } else if (error) {
      console.error("Wire error, using fallback:", error);
      // Use fallback with recordId
      this.loadOpportunityFallback();
    }
  }

  loadOpportunityFallback() {
    // For POC, create mock data based on the record context
    // In production, this would use an Apex controller
    this.opportunityData = {
      name: "Loading...",
      amount: 100000,
      probability: 50,
      stageName: "Proposal",
      accountName: "Demo Account",
      industry: "Technology",
      oem: null, // Will show as "Unknown Vendor" until real data loads
      oemCost: 85000,
      plannedMargin: 15,
      customerSegment: "MidMarket",
      dealRegType: "StandardApproved",
      competitors: "1",
      solutionComplexity: "Medium",
      relationshipStrength: "Good",
      valueAdd: "Medium"
    };
  }

  mapOpportunityData(data) {
    const fields = data.fields;
    const name = fields.Name?.value || "";
    const amount = fields.Amount?.value || 0;

    // Use MarginArc custom field for OEM if available, otherwise derive from name
    const marginarcOem = fields.Fulcrum_OEM__c?.value;
    const oem = marginarcOem || this.deriveOemFromName(name);

    // Parse competitor names from multi-select picklist (semicolon-separated)
    const competitorNamesRaw = fields.Fulcrum_Competitor_Names__c?.value || "";
    const competitorNames = competitorNamesRaw
      ? competitorNamesRaw.split(";").filter((c) => c.trim())
      : [];

    // Derive competitor count from actual competitors
    const competitorCount =
      competitorNames.length === 0
        ? "0"
        : competitorNames.length === 1
          ? "1"
          : competitorNames.length === 2
            ? "2"
            : "3+";

    // Use actual custom field values if available
    const oemCost = fields.Fulcrum_OEM_Cost__c?.value || amount * 0.85;
    const plannedMargin = fields.Fulcrum_Planned_Margin__c?.value || 15;
    const recommendedMargin =
      fields.Fulcrum_Recommended_Margin__c?.value || null;
    const aiConfidence = fields.Fulcrum_AI_Confidence__c?.value || null;
    const winProbability = fields.Fulcrum_Win_Probability__c?.value || null;

    // Use MarginArc field for customer segment, fallback to derivation from amount
    const customerSegment =
      fields.Fulcrum_Customer_Segment__c?.value ||
      (amount >= 300000
        ? "Enterprise"
        : amount >= 100000
          ? "MidMarket"
          : "SMB");

    // Derive complexity from amount and stage
    const stageName = fields.StageName?.value || "";
    const solutionComplexity =
      fields.Fulcrum_Solution_Complexity__c?.value ||
      (amount >= 200000 ? "High" : amount >= 75000 ? "Medium" : "Low");

    return {
      name: name,
      amount: amount,
      probability: fields.Probability?.value || 50,
      stageName: stageName,
      accountName: fields.Account?.value?.fields?.Name?.value || "Unknown",
      industry: fields.Account?.value?.fields?.Industry?.value || "Technology",
      oem: oem,
      competitorNames: competitorNames,
      oemCost: oemCost,
      plannedMargin: plannedMargin,
      recommendedMargin: recommendedMargin,
      aiConfidence: aiConfidence,
      winProbability: winProbability,
      customerSegment: customerSegment,
      dealRegType:
        fields.Fulcrum_Deal_Reg_Type__c?.value ||
        (amount >= 200000 ? "PremiumHunting" : "StandardApproved"),
      competitors: fields.Fulcrum_Competitors__c?.value || competitorCount,
      solutionComplexity: solutionComplexity,
      relationshipStrength:
        fields.Fulcrum_Relationship_Strength__c?.value ||
        (stageName.includes("Negotiat") ? "Strategic" : "Good"),
      valueAdd:
        fields.Fulcrum_Value_Add__c?.value ||
        (solutionComplexity === "High" ? "High" : "Medium"),
      servicesAttached: fields.Fulcrum_Services_Attached__c?.value || false,
      dealType: fields.Fulcrum_Deal_Type__c?.value || null,
      quarterEnd: fields.Fulcrum_Quarter_End__c?.value || false,
      productCategory: fields.Fulcrum_Product_Category__c?.value || null
    };
  }

  deriveOemFromName(name) {
    const nameLower = name.toLowerCase();
    // Check for specific OEM patterns in opportunity name
    if (
      nameLower.includes("palo alto") ||
      nameLower.includes("paloalto") ||
      nameLower.includes("pan-")
    )
      return "Palo Alto";
    if (
      nameLower.includes("pure storage") ||
      nameLower.includes("purestorage") ||
      nameLower.includes("flasharray") ||
      nameLower.includes("flashblade")
    )
      return "Pure Storage";
    if (
      nameLower.includes("crowdstrike") ||
      nameLower.includes("crowd strike") ||
      nameLower.includes("falcon")
    )
      return "CrowdStrike";
    if (nameLower.includes("nutanix") || nameLower.includes("hci"))
      return "Nutanix";
    if (
      nameLower.includes("cisco") ||
      nameLower.includes("meraki") ||
      nameLower.includes("webex")
    )
      return "Cisco";
    if (
      nameLower.includes("hpe") ||
      nameLower.includes("hewlett") ||
      nameLower.includes("aruba") ||
      nameLower.includes("proliant")
    )
      return "HPE";
    if (
      nameLower.includes("dell") ||
      nameLower.includes("emc") ||
      nameLower.includes("poweredge") ||
      nameLower.includes("vxrail")
    )
      return "Dell";
    if (nameLower.includes("fortinet") || nameLower.includes("fortigate"))
      return "Fortinet";
    if (
      nameLower.includes("vmware") ||
      nameLower.includes("vsphere") ||
      nameLower.includes("vsan")
    )
      return "VMware";
    if (
      nameLower.includes("microsoft") ||
      nameLower.includes("azure") ||
      nameLower.includes("m365") ||
      nameLower.includes("office 365")
    )
      return "Microsoft";
    if (nameLower.includes("netapp") || nameLower.includes("ontap"))
      return "NetApp";
    if (nameLower.includes("arista") || nameLower.includes("eos"))
      return "Arista";
    if (nameLower.includes("splunk")) return "Splunk";
    if (nameLower.includes("servicenow")) return "ServiceNow";
    if (nameLower.includes("zscaler")) return "Zscaler";
    // If no match, return null to indicate unknown - detectedOem getter will handle display
    return null;
  }

  // Computed properties for UI states
  get widgetVersion() {
    return WIDGET_VERSION;
  }

  get lastUpdated() {
    return LAST_UPDATED;
  }

  get noOpportunity() {
    return !this.recordId && !this.isLoading && !this.error;
  }

  get hasRecommendation() {
    return this.recommendation !== null && !this.isLoading && !this.error;
  }

  get showCalculateButton() {
    return (
      this.recordId &&
      !this.hasCalculated &&
      !this.isLoading &&
      !this.error &&
      !this.recommendation
    );
  }

  // Deal info for initial state
  get detectedOem() {
    return this.opportunityData?.oem || "Unknown Vendor";
  }

  get detectedSegment() {
    return this.opportunityData?.customerSegment || "Commercial";
  }

  get formattedAmount() {
    const amount = this.opportunityData?.amount || 0;
    if (amount >= 1000000) return `$${(amount / 1000000).toFixed(1)}M`;
    if (amount >= 1000) return `$${(amount / 1000).toFixed(0)}K`;
    return `$${amount}`;
  }

  // Current deal basics for top section
  get currentRevenue() {
    const amount = this.opportunityData?.amount || 0;
    return (
      "$" +
      amount.toLocaleString(undefined, {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
      })
    );
  }

  get currentCost() {
    const cost = this.opportunityData?.oemCost || 0;
    return (
      "$" +
      cost.toLocaleString(undefined, {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
      })
    );
  }

  get currentMarginDisplay() {
    // Calculate actual margin from revenue and cost
    const revenue = this.opportunityData?.amount || 0;
    const cost = this.opportunityData?.oemCost || 0;
    if (revenue <= 0) return "0%";
    const margin = ((revenue - cost) / revenue) * 100;
    return margin.toFixed(1) + "%";
  }

  get currentGrossProfit() {
    const revenue = this.opportunityData?.amount || 0;
    const cost = this.opportunityData?.oemCost || 0;
    const gp = revenue - cost;
    return (
      "$" +
      gp.toLocaleString(undefined, {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
      })
    );
  }

  // Recommendation display properties
  get recommendedMargin() {
    return this.recommendation?.suggestedMarginPct?.toFixed(1) || "0.0";
  }

  get currentMargin() {
    return this.opportunityData?.plannedMargin?.toFixed(1) || "15.0";
  }

  get marginDelta() {
    const delta =
      (this.recommendation?.suggestedMarginPct || 0) -
      (this.opportunityData?.plannedMargin || 15);
    return Math.abs(delta).toFixed(1);
  }

  get marginIncrease() {
    return (
      (this.recommendation?.suggestedMarginPct || 0) >
      (this.opportunityData?.plannedMargin || 15)
    );
  }

  get marginDecrease() {
    return (
      (this.recommendation?.suggestedMarginPct || 0) <
      (this.opportunityData?.plannedMargin || 15)
    );
  }

  get confidencePercent() {
    return Math.round((this.recommendation?.confidence || 0) * 100);
  }

  get confidenceLabel() {
    const conf = this.confidencePercent;
    if (conf >= 80) return "High";
    if (conf >= 60) return "Medium";
    return "Low";
  }

  get confidenceClass() {
    const conf = this.confidencePercent;
    if (conf >= 80) return "confidence-high";
    if (conf >= 60) return "confidence-medium";
    return "confidence-low";
  }

  get circleClass() {
    const conf = this.confidencePercent;
    if (conf >= 80) return "circle circle-high";
    if (conf >= 60) return "circle circle-medium";
    return "circle circle-low";
  }

  get confidenceDash() {
    return `${this.confidencePercent}, 100`;
  }

  get winProbability() {
    return Math.round((this.recommendation?.winProbability || 0.5) * 100);
  }

  get winBarStyle() {
    return `width: ${this.winProbability}%`;
  }

  get plannedWinProbability() {
    const m = this.recommendation?.metrics;
    if (m?.planned?.winProb != null) return Math.round(m.planned.winProb);
    // Fallback: use algorithm locally
    const data = this.opportunityData || {};
    const plannedMargin = data.plannedMargin || 15;
    const competitors = data.competitors || "1";
    const compBase =
      competitors === "0"
        ? 0.68
        : competitors === "1"
          ? 0.58
          : competitors === "2"
            ? 0.43
            : 0.32;
    const regBonus =
      data.dealRegType === "PremiumHunting"
        ? 0.12
        : data.dealRegType === "StandardApproved" ||
            data.dealRegType === "Teaming"
          ? 0.06
          : 0;
    const segPenalty = data.customerSegment === "Enterprise" ? 0.04 : 0;
    const wpBase = compBase + regBonus - segPenalty;
    const logistic = 1 / (1 + Math.exp(0.08 * (plannedMargin - 18)));
    const wp = Math.max(0.05, Math.min(0.95, 0.6 * wpBase + 0.4 * logistic));
    return Math.round(wp * 100);
  }

  get winProbDelta() {
    const delta = this.winProbability - this.plannedWinProbability;
    const sign = delta >= 0 ? "+" : "";
    return sign + Math.abs(delta);
  }

  get winProbDeltaPositive() {
    return this.winProbability >= this.plannedWinProbability;
  }

  get plannedProfit() {
    const m = this.recommendation?.metrics;
    if (m?.planned?.riskAdjusted != null) {
      return Math.round(m.planned.riskAdjusted).toLocaleString(undefined, {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
      });
    }
    const cost = this.opportunityData?.oemCost || 10000;
    const margin = (this.opportunityData?.plannedMargin || 15) / 100;
    const winProb = this.plannedWinProbability / 100;
    const profit = cost * margin * winProb;
    return Math.round(profit).toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    });
  }

  get recommendedProfit() {
    const m = this.recommendation?.metrics;
    if (m?.recommended?.riskAdjusted != null) {
      return Math.round(m.recommended.riskAdjusted).toLocaleString(undefined, {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
      });
    }
    const cost = this.opportunityData?.oemCost || 10000;
    const margin = (this.recommendation?.suggestedMarginPct || 15) / 100;
    const winProb = this.recommendation?.winProbability || 0.5;
    const profit = cost * margin * winProb;
    return Math.round(profit).toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    });
  }

  get riskAdjDelta() {
    const m = this.recommendation?.metrics;
    let delta;
    if (m?.delta?.riskAdjusted != null) {
      delta = m.delta.riskAdjusted;
    } else {
      // Parse from planned/recommended profit strings
      const planned = parseFloat(this.plannedProfit.replace(/,/g, ""));
      const recommended = parseFloat(this.recommendedProfit.replace(/,/g, ""));
      delta = recommended - planned;
    }
    const sign = delta >= 0 ? "+" : "-";
    return (
      sign +
      "$" +
      Math.abs(Math.round(delta)).toLocaleString(undefined, {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
      })
    );
  }

  get riskAdjDeltaPositive() {
    const m = this.recommendation?.metrics;
    if (m?.delta?.riskAdjusted != null) return m.delta.riskAdjusted >= 0;
    const planned = parseFloat(this.plannedProfit.replace(/,/g, ""));
    const recommended = parseFloat(this.recommendedProfit.replace(/,/g, ""));
    return recommended >= planned;
  }

  // Deal Context computed properties
  get dealContextOemCost() {
    const cost = this.opportunityData?.oemCost || 0;
    return (
      "$" +
      cost.toLocaleString(undefined, {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
      })
    );
  }

  get dealContextSellPrice() {
    const cost = this.opportunityData?.oemCost || 0;
    const margin = (this.opportunityData?.plannedMargin || 15) / 100;
    const price = cost / (1 - margin);
    return (
      "$" +
      price.toLocaleString(undefined, {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
      })
    );
  }

  get dealContextGrossProfit() {
    const cost = this.opportunityData?.oemCost || 0;
    const margin = (this.opportunityData?.plannedMargin || 15) / 100;
    const price = cost / (1 - margin);
    const gp = price - cost;
    return (
      "$" +
      gp.toLocaleString(undefined, {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
      })
    );
  }

  get dealContextPlannedMargin() {
    return (this.opportunityData?.plannedMargin || 15).toFixed(1) + "%";
  }

  get dealContextComplexity() {
    return this.opportunityData?.solutionComplexity || "Medium";
  }

  get dealContextIndustry() {
    return this.opportunityData?.industry || "Technology";
  }

  get dealContextCompetitors() {
    return this.opportunityData?.competitors || "1";
  }

  get dealContextDealReg() {
    const reg = this.opportunityData?.dealRegType || "StandardApproved";
    const labels = {
      NotRegistered: "Not Registered",
      StandardApproved: "Standard",
      StandardDealReg: "Standard",
      PremiumHunting: "Premium",
      Teaming: "Teaming"
    };
    return labels[reg] || reg;
  }

  get dealContextRelationship() {
    return this.opportunityData?.relationshipStrength || "Good";
  }

  // Recommended deal metrics
  get recommendedSellPrice() {
    const cost = this.opportunityData?.oemCost || 0;
    const margin = (this.recommendation?.suggestedMarginPct || 15) / 100;
    const price = cost / (1 - margin);
    return (
      "$" +
      price.toLocaleString(undefined, {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
      })
    );
  }

  get recommendedGrossProfit() {
    const cost = this.opportunityData?.oemCost || 0;
    const margin = (this.recommendation?.suggestedMarginPct || 15) / 100;
    const price = cost / (1 - margin);
    const gp = price - cost;
    return (
      "$" +
      gp.toLocaleString(undefined, {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
      })
    );
  }

  get priceDelta() {
    const cost = this.opportunityData?.oemCost || 0;
    const plannedMargin = (this.opportunityData?.plannedMargin || 15) / 100;
    const recMargin = (this.recommendation?.suggestedMarginPct || 15) / 100;
    const plannedPrice = cost / (1 - plannedMargin);
    const recPrice = cost / (1 - recMargin);
    const delta = recPrice - plannedPrice;
    const sign = delta >= 0 ? "+" : "";
    return (
      sign +
      "$" +
      Math.abs(delta).toLocaleString(undefined, {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
      })
    );
  }

  get priceDeltaPositive() {
    const cost = this.opportunityData?.oemCost || 0;
    const plannedMargin = (this.opportunityData?.plannedMargin || 15) / 100;
    const recMargin = (this.recommendation?.suggestedMarginPct || 15) / 100;
    const plannedPrice = cost / (1 - plannedMargin);
    const recPrice = cost / (1 - recMargin);
    return recPrice >= plannedPrice;
  }

  get gpDelta() {
    const cost = this.opportunityData?.oemCost || 0;
    const plannedMargin = (this.opportunityData?.plannedMargin || 15) / 100;
    const recMargin = (this.recommendation?.suggestedMarginPct || 15) / 100;
    const plannedGP = cost / (1 - plannedMargin) - cost;
    const recGP = cost / (1 - recMargin) - cost;
    const delta = recGP - plannedGP;
    const sign = delta >= 0 ? "+" : "";
    return (
      sign +
      "$" +
      Math.abs(delta).toLocaleString(undefined, {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
      })
    );
  }

  get gpDeltaPositive() {
    const cost = this.opportunityData?.oemCost || 0;
    const plannedMargin = (this.opportunityData?.plannedMargin || 15) / 100;
    const recMargin = (this.recommendation?.suggestedMarginPct || 15) / 100;
    const plannedGP = cost / (1 - plannedMargin) - cost;
    const recGP = cost / (1 - recMargin) - cost;
    return recGP >= plannedGP;
  }

  get hasDrivers() {
    return this.topDrivers && this.topDrivers.length > 0;
  }

  get driverCount() {
    return this.topDrivers?.length || 0;
  }

  // AI Explanation getters
  get hasExplanation() {
    return (
      this.recommendation?.explanation ||
      this.recommendation?.qualitativeSummary
    );
  }

  get aiExplanation() {
    return this.recommendation?.explanation || "";
  }

  get hasQualitativeSummary() {
    return !!this.recommendation?.qualitativeSummary;
  }

  get qualitativeSummary() {
    return this.recommendation?.qualitativeSummary || "";
  }

  // Recommendation History getters
  get hasHistory() {
    return this.historyData && this.historyData.length > 0;
  }

  get historyItems() {
    if (!this.historyData) return [];
    return this.historyData.map((item) => {
      const d = new Date(item.recommendationDate);
      const dateStr = d.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric"
      });
      const timeStr = d.toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit"
      });
      const margin =
        item.recommendedMargin != null
          ? Number(item.recommendedMargin).toFixed(1) + "%"
          : "--";
      const confidence =
        item.aiConfidence != null
          ? Number(item.aiConfidence).toFixed(0) + "%"
          : "--";
      const winProb =
        item.winProbability != null
          ? Number(item.winProbability).toFixed(0) + "%"
          : "--";
      const planned =
        item.plannedMarginAtTime != null
          ? Number(item.plannedMarginAtTime).toFixed(1) + "%"
          : "--";
      const gap =
        item.recommendedMargin != null && item.plannedMarginAtTime != null
          ? Number(item.recommendedMargin - item.plannedMarginAtTime).toFixed(1)
          : null;
      const gapStr = gap != null ? (gap >= 0 ? "+" : "") + gap + "pp" : "--";
      const gapClass =
        gap == null ? "" : gap >= 0 ? "hist-gap-positive" : "hist-gap-negative";
      return {
        id: item.id,
        dateStr,
        timeStr,
        margin,
        confidence,
        winProb,
        planned,
        gapStr,
        gapClass,
        source: item.source || "API",
        sourceClass:
          "hist-source hist-source-" + (item.source || "API").toLowerCase(),
        applied: item.applied,
        appliedLabel: item.applied ? "Applied" : "Not Applied",
        appliedClass: item.applied ? "hist-applied-yes" : "hist-applied-no"
      };
    });
  }

  get showHistory() {
    return !this.collapsedSections?.history;
  }

  get historyChevron() {
    return this.showHistory ? "\u25BE" : "\u25B8";
  }

  toggleHistory() {
    this.collapsedSections = {
      ...this.collapsedSections,
      history: !this.collapsedSections?.history
    };
  }

  get topDrivers() {
    if (!this.recommendation?.drivers) return [];

    // Handle both array format (from ML model) and object format (from legacy)
    let driversArray = [];
    if (Array.isArray(this.recommendation.drivers)) {
      driversArray = this.recommendation.drivers;
    } else {
      driversArray = Object.entries(this.recommendation.drivers).map(
        ([name, val]) => ({ name, val })
      );
    }

    // Friendly labels for driver names
    const friendlyLabels = {
      oem: `${this.opportunityData?.oem || "OEM"} typical margins`,
      customerSegment: "Customer segment",
      dealRegType: "Deal registration",
      competitors: "Competitive pressure",
      solutionComplexity: "Solution complexity",
      valueAdd: "Value-add services",
      relationship: "Customer relationship"
    };

    return driversArray.slice(0, 5).map((driver) => {
      // Detect format: if abs(val) > 1, it's already percentage points, not decimal
      let value = driver.val;
      if (Math.abs(value) <= 1) {
        value = value * 100; // Convert decimal to percentage
      }
      // Now value is in percentage points (e.g., 3 means 3%)

      const absValue = Math.abs(value);
      const barWidth = Math.min(absValue * 8, 100); // Scale for visibility
      const label = friendlyLabels[driver.name] || driver.name;

      return {
        name: driver.name,
        label: label,
        impact: value > 0 ? `+${value.toFixed(1)}%` : `${value.toFixed(1)}%`,
        impactClass: value >= 0 ? "driver-positive" : "driver-negative",
        isPositive: value >= 0,
        isNegative: value < 0,
        barStyle: `width: ${barWidth}%`
      };
    });
  }

  // Competitor display
  get hasCompetitors() {
    return this.opportunityData?.competitorNames?.length > 0;
  }

  get competitorList() {
    return this.opportunityData?.competitorNames?.join(", ") || "None";
  }

  get competitorCount() {
    return this.opportunityData?.competitorNames?.length || 0;
  }

  // Confirmation dialog getters
  get confirmNewAmount() {
    if (!this.recommendation || !this.opportunityData) return "$0";
    const oemCost = Number(this.opportunityData.oemCost) || 0;
    const marginPct = Number(this.recommendation.suggestedMarginPct) / 100;
    const newAmount = oemCost / (1 - marginPct);
    return this.formatCurrency(newAmount);
  }

  get confirmMarginPct() {
    if (!this.recommendation) return "0.0";
    return Number(this.recommendation.suggestedMarginPct).toFixed(1);
  }

  get confirmCurrentPlannedMargin() {
    return (this.opportunityData?.plannedMargin || 15).toFixed(1);
  }

  get confirmWinProb() {
    if (!this.recommendation) return "0";
    return (Number(this.recommendation.winProbability) * 100).toFixed(0);
  }

  // BOM data getter: returns API BOM if available, else saved BOM from SFDC
  get activeBomData() {
    if (this.recommendation?.bom?.items?.length) {
      return this.recommendation.bom;
    }
    return this.savedBomData;
  }

  get confirmHasBom() {
    return this.activeBomData?.items?.length > 0;
  }

  get confirmBomLineCount() {
    return this.activeBomData?.items?.length || 0;
  }

  // BOM summary getters (compact display — full editing in standalone BOM Builder)
  get hasBomSummary() {
    return this.activeBomData?.items?.length > 0;
  }

  get bomLineCount() {
    return this.activeBomData?.items?.length || 0;
  }

  get bomTotalCost() {
    const cost = this.activeBomData?.totals?.cost || 0;
    return this.formatCurrency(cost);
  }

  get bomTotalPrice() {
    const price = this.activeBomData?.totals?.price || 0;
    return this.formatCurrency(price);
  }

  get bomBlendedMargin() {
    const pct = this.activeBomData?.totals?.marginPct;
    if (pct == null) return '—';
    return (pct * 100).toFixed(1) + '%';
  }

  async loadSavedBom() {
    try {
      const lines = await getBomLines({ opportunityId: this.recordId });
      if (lines && lines.length > 0) {
        const items = lines.map((line) => ({
          key: line.Line_Key__c,
          label: line.Description__c,
          category: line.Category__c || "Hardware",
          unit: line.Unit__c || "ea",
          quantity: Number(line.Quantity__c) || 1,
          unitCost: Number(line.Unit_Cost__c) || 0,
          unitPrice: Number(line.Unit_Price__c) || 0,
          listPrice: Number(line.List_Price__c) || 0,
          discountedPrice: Number(line.Unit_Cost__c) || 0,
          priceAfterMargin: Number(line.Unit_Price__c) || 0,
          extendedCost: Number(line.Extended_Cost__c) || 0,
          extendedPrice: Number(line.Extended_Price__c) || 0,
          marginPct: (Number(line.Margin_Pct__c) || 0) / 100,
          recommendedMarginPct:
            line.Recommended_Margin_Pct__c != null
              ? (Number(line.Recommended_Margin_Pct__c) || 0) / 100
              : null,
          productNumber: line.Product_Number__c || "",
          vendor: line.Vendor__c || "",
          note: line.Note__c || ""
        }));

        let totalCost = 0;
        let totalPrice = 0;
        items.forEach((item) => {
          totalCost += item.extendedCost;
          totalPrice += item.extendedPrice;
        });
        const blendedMarginPct =
          totalPrice > 0 ? (totalPrice - totalCost) / totalPrice : 0;

        this.savedBomData = {
          origin: lines[0].BOM_Origin__c || "generated",
          items,
          totals: {
            cost: totalCost,
            price: totalPrice,
            marginPct: blendedMarginPct
          },
          summary: `Saved BOM with ${items.length} line items. Blended margin: ${(blendedMarginPct * 100).toFixed(1)}%`,
          stats: {
            lineCount: items.length,
            avgMarginPct:
              items.reduce((sum, i) => sum + i.marginPct, 0) / items.length,
            blendedMarginPct,
            manual: lines[0].BOM_Origin__c === "manual"
          }
        };
      }
    } catch (err) {
      console.warn("Failed to load saved BOM lines:", err);
    }
  }

  // Event handlers
  async handleCalculate() {
    await this.fetchRecommendation();
  }

  async handleRefresh() {
    await this.fetchRecommendation();
  }

  handleApply() {
    if (!this.recommendation || !this.recordId) return;
    this.showConfirmDialog = true;
    // Auto-focus the Cancel button when dialog opens
    // eslint-disable-next-line @lwc/lwc/no-async-operation
    setTimeout(() => {
      const cancelBtn = this.template.querySelector(
        ".confirm-footer .btn-secondary"
      );
      if (cancelBtn) cancelBtn.focus();
    }, 0);
  }

  handleCancelApply() {
    this.showConfirmDialog = false;
  }

  handleConfirmKeydown(event) {
    if (event.key === "Escape") {
      this.handleCancelApply();
      return;
    }
    // Focus trap: cycle Tab between Cancel and Apply buttons
    if (event.key === "Tab") {
      const buttons = this.template.querySelectorAll(".confirm-footer button");
      if (buttons.length < 2) return;
      const first = buttons[0];
      const last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  }

  stopPropagation(event) {
    event.stopPropagation();
  }

  async handleConfirmApply() {
    if (!this.recommendation || !this.recordId) return;

    this.showConfirmDialog = false;
    this.isLoading = true;

    try {
      const oemCost = Number(this.opportunityData?.oemCost) || 0;
      const appliedMarginPct = Number(this.recommendation.suggestedMarginPct);

      // Determine if we have BOM data to persist
      const bomData = this.activeBomData;
      const hasBom = bomData?.items?.length > 0;

      // Re-call Lambda API with the applied margin to get definitive fresh scores
      let freshRec = this.recommendation;
      try {
        const inputPayload = this.buildInputPayload();
        const apiPayload = {
          input: inputPayload,
          plannedMarginPct: appliedMarginPct
        };

        // If we have BOM lines, include them so Lambda computes correct blended scores
        if (hasBom) {
          apiPayload.bomLines = bomData.items.map((item) => ({
            key: item.key,
            description: item.label,
            category: item.category || "Hardware",
            unit: item.unit || "ea",
            quantity: item.quantity || 1,
            listPrice: item.listPrice || item.unitCost || 0,
            discountedPrice: item.unitCost || item.discountedPrice || 0,
            priceAfterMargin: item.unitPrice || item.priceAfterMargin || 0,
            recommendedMarginPct:
              item.recommendedMarginPct != null
                ? item.recommendedMarginPct * 100
                : null,
            productNumber: item.productNumber || "",
            vendor: item.vendor || "",
            note: item.note || ""
          }));
        }

        const resultJson = await callMarginArcApi({
          payload: JSON.stringify(apiPayload)
        });
        freshRec = JSON.parse(resultJson);
        console.log("Fresh scores from API for apply:", freshRec);
      } catch (apiErr) {
        console.warn(
          "Could not refresh scores on apply, using existing:",
          apiErr
        );
        // Fall back to existing recommendation scores — still apply
      }

      // Calculate financials
      // If we have BOM totals, use those (more accurate). Otherwise compute from top-level.
      let newAmount;
      if (hasBom && bomData.totals?.price > 0) {
        newAmount = bomData.totals.price;
      } else {
        const marginDec = appliedMarginPct / 100;
        newAmount = marginDec >= 1 ? oemCost * 10 : oemCost / (1 - marginDec);
      }

      // Use fresh scores
      const confidence = Number(
        freshRec.confidence || this.recommendation.confidence || 0
      );
      const winProbability = Number(
        freshRec.winProbability || this.recommendation.winProbability || 0.5
      );
      const finalMarginPct =
        hasBom && freshRec.suggestedMarginPct != null
          ? Number(freshRec.suggestedMarginPct)
          : appliedMarginPct;

      // Build the record update
      const fields = {};
      fields[ID_FIELD.fieldApiName] = this.recordId;
      fields[AMOUNT_FIELD.fieldApiName] = Math.round(newAmount);
      fields[RECOMMENDED_MARGIN_FIELD.fieldApiName] = finalMarginPct;
      fields[AI_CONFIDENCE_FIELD.fieldApiName] = confidence * 100;
      fields[WIN_PROBABILITY_FIELD.fieldApiName] = winProbability * 100;
      fields[PLANNED_MARGIN_FIELD.fieldApiName] = finalMarginPct;
      fields[REVENUE_FIELD.fieldApiName] = Math.round(newAmount);
      if (newAmount > 0) {
        const gpPct =
          hasBom && bomData.totals?.cost != null
            ? ((newAmount - bomData.totals.cost) / newAmount) * 100
            : ((newAmount - oemCost) / newAmount) * 100;
        fields[GP_PERCENT_FIELD.fieldApiName] = gpPct;
      }

      const recordInput = { fields };
      await updateRecord(recordInput);

      // Save BOM lines to SFDC
      if (hasBom) {
        try {
          const bomItems = bomData.items.map((item) => ({
            key: item.key,
            label: item.label,
            category: item.category || "Hardware",
            unit: item.unit || "ea",
            quantity: item.quantity || 1,
            unitCost: item.unitCost || item.discountedPrice || 0,
            unitPrice: item.unitPrice || item.priceAfterMargin || 0,
            listPrice: item.listPrice || 0,
            extendedCost: item.extendedCost || 0,
            extendedPrice: item.extendedPrice || 0,
            marginPct: item.marginPct || 0,
            recommendedMarginPct: item.recommendedMarginPct,
            productNumber: item.productNumber || "",
            vendor: item.vendor || "",
            note: item.note || "",
            origin: bomData.origin || "generated"
          }));
          await saveBomLines({
            opportunityId: this.recordId,
            bomLinesJson: JSON.stringify(bomItems)
          });
          console.log("BOM lines saved to SFDC");
        } catch (bomErr) {
          console.warn("Failed to save BOM lines:", bomErr);
          // Non-fatal — Opportunity fields were already updated
        }
      }

      // Refresh the wire to get updated data
      await refreshApex(this.wiredOpportunityResult);

      // Update saved BOM data for immediate display
      if (hasBom) {
        this.savedBomData = bomData;
      }

      this.dispatchEvent(
        new ShowToastEvent({
          title: "Recommendation Applied",
          message:
            `Updated Amount to ${this.formatCurrency(newAmount)} with ${finalMarginPct.toFixed(1)}% margin` +
            (hasBom ? ` (${bomData.items.length} BOM lines saved)` : ""),
          variant: "success"
        })
      );

      // Log recommendation history
      try {
        await logRecommendation({
          opportunityId: this.recordId,
          recommendedMargin: finalMarginPct,
          aiConfidence: confidence * 100,
          winProbability: winProbability * 100,
          plannedMarginAtTime:
            Number(this.opportunityData?.plannedMargin) || 15,
          source: "Manual",
          applied: true
        });
        if (this._wiredHistoryResult) {
          await refreshApex(this._wiredHistoryResult);
        }
      } catch (histErr) {
        console.warn("Failed to log recommendation history:", histErr);
      }
    } catch (error) {
      console.error("Error applying recommendation:", error);
      this.dispatchEvent(
        new ShowToastEvent({
          title: "Error Applying Recommendation",
          message: error.body?.message || error.message || "Unknown error",
          variant: "error"
        })
      );
    } finally {
      this.isLoading = false;
    }
  }

  formatCurrency(value) {
    return (
      "$" +
      value.toLocaleString(undefined, {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
      })
    );
  }

  async fetchRecommendation() {
    if (!this.opportunityData) {
      this.error = "No opportunity data available";
      return;
    }

    this.isLoading = true;
    this.error = null;
    this.hasCalculated = true;
    this.degradationLevel = 0;

    try {
      // Load saved BOM lines early so they can be included in the API call
      try {
        await this.loadSavedBom();
      } catch (bomLoadErr) {
        console.warn("Failed to load saved BOM before API call:", bomLoadErr);
        // Non-fatal — continue without BOM data
      }

      const inputPayload = this.buildInputPayload();

      console.log("Sending to MarginArc API via Apex:", inputPayload);

      let recommendation;
      try {
        const apiPayloadObj = {
          input: inputPayload,
          plannedMarginPct: this.opportunityData.plannedMargin || 15
        };

        // If we have saved BOM lines, include them so the API computes blended scores
        if (this.savedBomData?.items?.length > 0) {
          apiPayloadObj.bomLines = this.savedBomData.items.map((item) => ({
            key: item.key,
            description: item.label,
            category: item.category || "Hardware",
            unit: item.unit || "ea",
            quantity: item.quantity || 1,
            listPrice: item.listPrice || item.unitCost || 0,
            discountedPrice: item.unitCost || item.discountedPrice || 0,
            priceAfterMargin: item.unitPrice || item.priceAfterMargin || 0,
            recommendedMarginPct:
              item.recommendedMarginPct != null
                ? item.recommendedMarginPct * 100
                : null,
            productNumber: item.productNumber || "",
            vendor: item.vendor || "",
            note: item.note || ""
          }));
        }

        const apiPayload = JSON.stringify(apiPayloadObj);
        const resultJson = await callMarginArcApi({ payload: apiPayload });
        recommendation = JSON.parse(resultJson);
        console.log("MarginArc API response:", recommendation);
      } catch (apiErr) {
        console.error("MarginArc API error, using mock:", apiErr);
        const errMsg =
          apiErr?.body?.message || apiErr?.message || String(apiErr);
        this._lastApiError = errMsg;
        this.degradationLevel = 3;
        recommendation = this.generateMockRecommendation();
      }

      // Call Gemini API via Apex for AI explanation
      try {
        console.log("Calling Gemini API for AI explanation...");
        const aiResult = await generateAIExplanation({
          oem: inputPayload.oem,
          suggestedMarginPct: recommendation.suggestedMarginPct,
          winProbability: recommendation.winProbability,
          customerSegment: inputPayload.customerSegment,
          competitors: inputPayload.competitors,
          dealRegType: inputPayload.dealRegType,
          solutionComplexity: inputPayload.solutionComplexity,
          oemCost: inputPayload.oemCost,
          drivers: recommendation.drivers || []
        });

        if (aiResult && !aiResult.error) {
          recommendation.explanation =
            aiResult.explanation || recommendation.explanation;
          recommendation.qualitativeSummary =
            aiResult.qualitativeSummary || recommendation.qualitativeSummary;
          console.log("Gemini AI explanation received:", aiResult);
        }
      } catch (geminiErr) {
        console.error("Gemini API error:", geminiErr);
        if (this.degradationLevel === 0) {
          this.degradationLevel = 1;
        }
        // Template-based explanation as fallback
        if (!recommendation.explanation) {
          recommendation.explanation = this.generateTemplateExplanation();
        }
        if (!recommendation.qualitativeSummary) {
          recommendation.qualitativeSummary =
            this.generateTemplateExplanation();
        }
      }

      this.recommendation = recommendation;
    } catch (err) {
      console.error("Recommendation error:", err);
      this._lastApiError = `outer: ${err.message || err}`;
      this.degradationLevel = 3;
      this.recommendation = this.generateMockRecommendation();
      this.dispatchEvent(
        new ShowToastEvent({
          title: "Using Estimated Data",
          message:
            "Could not reach MarginArc API. Showing estimated recommendation based on deal parameters.",
          variant: "warning"
        })
      );
    } finally {
      this.isLoading = false;
    }
  }

  // Build API input payload from opportunity data
  buildInputPayload() {
    const oemName = this.opportunityData.oem || "Unknown";
    const oemProfile = this._oemDataMap[oemName] || null;
    const competitorNames = this.opportunityData.competitorNames || [];

    // Enrich competitor names with admin-configured profile data
    const competitorProfiles = competitorNames
      .map((name) => {
        const profile = this._competitorDataMap[name];
        return profile ? { name, ...profile } : { name };
      })
      .filter(Boolean);

    return {
      oem: oemName,
      oemProfile: oemProfile
        ? {
            baseMargin: oemProfile.baseMargin,
            dealRegBoost: oemProfile.dealRegBoost,
            quarterEndDiscount: oemProfile.quarterEndDiscount,
            servicesBoost: oemProfile.servicesBoost,
            productCategory: oemProfile.productCategory
          }
        : null,
      oemCost:
        this.opportunityData.oemCost || this.opportunityData.amount || 10000,
      competitors: this.opportunityData.competitors || "1",
      competitorNames: competitorNames,
      competitorProfiles:
        competitorProfiles.length > 0 ? competitorProfiles : null,
      dealRegType: this.opportunityData.dealRegType || "StandardApproved",
      customerSegment: this.mapCustomerSegment(
        this.opportunityData.customerSegment
      ),
      solutionComplexity: this.opportunityData.solutionComplexity || "Medium",
      relationshipStrength: this.opportunityData.relationshipStrength || "Good",
      valueAdd: this.opportunityData.valueAdd || "Medium",
      customerIndustry: this.mapIndustry(this.opportunityData.industry),
      customerTechSophistication: "Medium",
      varStrategicImportance: "Medium",
      productCategory: this.mapProductCategory(
        this.opportunityData.productCategory
      ),
      servicesAttached: this.opportunityData.servicesAttached || false,
      quarterEnd: this.opportunityData.quarterEnd || false,
      dealSize: this.opportunityData.amount || 0,
      dealType: this.opportunityData.dealType || null,
      accountName: this.opportunityData.accountName || null
    };
  }

  // Helper methods
  mapCustomerSegment(segment) {
    const mapping = {
      Enterprise: "Enterprise",
      MidMarket: "MidMarket",
      SMB: "SMB"
    };
    return mapping[segment] || "MidMarket";
  }

  mapIndustry(industry) {
    // Must match exact values from Lambda customers.json
    const mapping = {
      // Direct passthrough for Lambda industry values
      Technology: "Technology",
      "Financial Services": "Financial Services",
      "Life Sciences & Healthcare": "Life Sciences & Healthcare",
      "Manufacturing & Automotive": "Manufacturing & Automotive",
      Retail: "Retail",
      Energy: "Energy",
      "Media & Telecommunications": "Media & Telecommunications",
      "Consumer Goods & Food": "Consumer Goods & Food",
      "Transportation & Logistics": "Transportation & Logistics",
      "Diversified Conglomerates": "Diversified Conglomerates",
      // Salesforce standard picklist → Lambda mapping
      Finance: "Financial Services",
      Banking: "Financial Services",
      Insurance: "Financial Services",
      Healthcare: "Life Sciences & Healthcare",
      Biotechnology: "Life Sciences & Healthcare",
      Manufacturing: "Manufacturing & Automotive",
      Machinery: "Manufacturing & Automotive",
      Electronics: "Manufacturing & Automotive",
      Education: "Technology",
      Government: "Technology",
      Consulting: "Technology",
      Media: "Media & Telecommunications",
      Communications: "Media & Telecommunications",
      Telecommunications: "Media & Telecommunications",
      Entertainment: "Media & Telecommunications",
      "Food & Beverage": "Consumer Goods & Food",
      Apparel: "Consumer Goods & Food",
      "Consumer Goods": "Consumer Goods & Food",
      Transportation: "Transportation & Logistics",
      Shipping: "Transportation & Logistics",
      Utilities: "Energy",
      Construction: "Manufacturing & Automotive"
    };
    return mapping[industry] || "Technology";
  }

  mapProductCategory(category) {
    // Map Salesforce picklist values to Lambda enum values
    const mapping = {
      Networking: "Hardware",
      Security: "Hardware",
      Compute: "Hardware",
      Storage: "Hardware",
      Collaboration: "Hardware",
      DataCenter: "Hardware",
      Cloud: "Cloud",
      Software: "Software",
      Services: "ProfessionalServices"
    };
    return mapping[category] || "Hardware";
  }

  mapDealSize(amount) {
    if (amount >= 500000) return "Enterprise";
    if (amount >= 100000) return "Large";
    if (amount >= 25000) return "Medium";
    return "Small";
  }

  getCurrentQuarter() {
    const month = new Date().getMonth();
    if (month <= 2) return "Q1";
    if (month <= 5) return "Q2";
    if (month <= 8) return "Q3";
    return "Q4";
  }

  // =========================================================================
  // Deal Score (Dynamic Deal Scoring)
  // =========================================================================

  computeDealScore() {
    if (!this.recommendation || !this.opportunityData) return null;

    const data = this.opportunityData;
    const rec = this.recommendation;
    const plannedMargin = Number(data.plannedMargin) || 15;
    const recommendedMargin = Number(rec.suggestedMarginPct) || 15;
    const factors = [];

    // 1. Margin Alignment (35% weight) — how close planned is to recommended
    const gap = Math.abs(plannedMargin - recommendedMargin);
    const alignmentScore = Math.max(0, 100 - gap * 15);
    if (gap <= 2) {
      factors.push({
        name: "Margin aligned with recommendation",
        impact: "+" + Math.round(alignmentScore * 0.35),
        direction: "positive"
      });
    } else {
      const dir = plannedMargin < recommendedMargin ? "below" : "above";
      factors.push({
        name: `Margin ${gap.toFixed(1)}% ${dir} optimal`,
        impact: "-" + Math.round((100 - alignmentScore) * 0.35),
        direction: "negative"
      });
    }

    // 2. Win Probability (25% weight) — based on planned margin
    const winProbScore = this.plannedWinProbability;
    if (winProbScore >= 60) {
      factors.push({
        name: "Strong win probability",
        impact: "+" + Math.round(winProbScore * 0.25),
        direction: "positive"
      });
    } else {
      factors.push({
        name: "Low win probability at current margin",
        impact: "-" + Math.round((100 - winProbScore) * 0.25),
        direction: "negative"
      });
    }

    // 3. Risk-Adjusted Value (20% weight)
    const cost = Number(data.oemCost) || 10000;
    const plannedGP = cost * (plannedMargin / 100);
    const recGP = cost * (recommendedMargin / 100);
    const plannedRA = (plannedGP * this.plannedWinProbability) / 100;
    const recRA = (recGP * this.winProbability) / 100;
    const valueScore =
      recRA > 0 ? Math.min(100, (plannedRA / recRA) * 100) : 50;

    // 4. Deal Structure (10% weight)
    let structureScore = 40;
    const dealReg = data.dealRegType || "NotRegistered";
    const relationship = data.relationshipStrength || "Good";
    const valueAdd = data.valueAdd || "Medium";

    if (dealReg !== "NotRegistered") {
      structureScore += 20;
      factors.push({
        name: "Deal registration",
        impact: "+",
        direction: "positive"
      });
    } else {
      factors.push({
        name: "No deal registration",
        impact: "-",
        direction: "negative"
      });
    }
    if (dealReg === "PremiumHunting") structureScore += 15;
    if (relationship === "Strategic") {
      structureScore += 15;
      factors.push({
        name: "Strategic relationship",
        impact: "+",
        direction: "positive"
      });
    } else if (relationship === "Good") {
      structureScore += 8;
    }
    if (valueAdd === "High") {
      structureScore += 10;
      factors.push({
        name: "High value-add",
        impact: "+",
        direction: "positive"
      });
    } else if (valueAdd === "Medium") {
      structureScore += 5;
    }
    structureScore = Math.min(100, structureScore);

    // 5. Competitive Position (10% weight)
    const competitors = data.competitors || "1";
    const compMap = { 0: 100, 1: 75, 2: 45, "3+": 25 };
    const compScore = compMap[competitors] || 50;
    if (competitors === "3+" || competitors === "2") {
      factors.push({
        name: `${competitors} competitors`,
        impact: "-",
        direction: "negative"
      });
    } else if (competitors === "0") {
      factors.push({
        name: "No competition",
        impact: "+",
        direction: "positive"
      });
    }

    // Weighted composite
    const score = Math.round(
      alignmentScore * 0.35 +
        winProbScore * 0.25 +
        valueScore * 0.2 +
        structureScore * 0.1 +
        compScore * 0.1
    );
    const clampedScore = Math.max(0, Math.min(100, score));

    let label, color;
    if (clampedScore >= 70) {
      label = "Good";
      color = "#22C55E";
    } else if (clampedScore >= 40) {
      label = "Fair";
      color = "#F59E0B";
    } else {
      label = "Needs Work";
      color = "#EF4444";
    }

    return {
      score: clampedScore,
      label,
      color,
      factors: factors.slice(0, 6),
      breakdown: {
        alignment: Math.round(alignmentScore),
        winProb: winProbScore,
        value: Math.round(valueScore),
        structure: Math.round(structureScore),
        competition: compScore
      }
    };
  }

  get dealScoreData() {
    return this.computeDealScore();
  }

  get dealScore() {
    return this.dealScoreData?.score || 0;
  }

  get dealScoreLabel() {
    return this.dealScoreData?.label || "";
  }

  get dealScoreColor() {
    return this.dealScoreData?.color || "#64748b";
  }

  get dealScoreStyle() {
    return `color: ${this.dealScoreColor}`;
  }

  get scoreMarkerStyle() {
    return `left: ${this.dealScore}%`;
  }

  get dealScoreFactors() {
    return (this.dealScoreData?.factors || []).map((f) => ({
      ...f,
      pillClass:
        f.direction === "positive"
          ? "score-factor score-factor-positive"
          : "score-factor score-factor-negative"
    }));
  }

  get hasDealScore() {
    return this.dealScoreData !== null;
  }

  get marginDeltaDisplay() {
    const delta =
      (this.recommendation?.suggestedMarginPct || 0) -
      (this.opportunityData?.plannedMargin || 15);
    const sign = delta >= 0 ? "+" : "";
    return sign + delta.toFixed(1) + "%";
  }

  get marginDeltaIsPositive() {
    return (
      (this.recommendation?.suggestedMarginPct || 0) >=
      (this.opportunityData?.plannedMargin || 15)
    );
  }

  get marginDeltaClass() {
    return this.marginDeltaIsPositive
      ? "rec-margin-delta-value delta-positive"
      : "rec-margin-delta-value delta-negative";
  }

  // =========================================================================
  // Graceful Degradation
  // =========================================================================

  get isFallbackMode() {
    return this.degradationLevel >= 3;
  }

  get isAIUnavailable() {
    return this.degradationLevel >= 1;
  }

  get degradationMessage() {
    if (this.degradationLevel >= 3) {
      return "Using local estimation — API unavailable";
    }
    if (this.degradationLevel >= 1) {
      return "AI narrative unavailable — using template analysis";
    }
    return "";
  }

  get showDegradationBadge() {
    return this.degradationLevel > 0 && this.hasRecommendation;
  }

  generateTemplateExplanation() {
    const data = this.opportunityData || {};
    const oem = data.oem || "the vendor";
    const segment = data.customerSegment || "this segment";
    const competitors = data.competitors || "1";
    const margin = this.recommendation?.suggestedMarginPct || 15;

    const compText =
      competitors === "0"
        ? "no direct competition"
        : competitors === "1"
          ? "one competitor"
          : `${competitors} competitors`;

    return `Based on ${oem} pricing benchmarks for ${segment.toLowerCase()} deals with ${compText}, a ${Number(margin).toFixed(1)}% margin balances competitiveness with profitability. This analysis uses local calculation models.`;
  }

  generateMockRecommendation() {
    const data = this.opportunityData || {};
    const amount = data.amount || 100000;
    const oem = data.oem || "Cisco";
    const segment = data.customerSegment || "Commercial";
    const complexity = data.solutionComplexity || "Medium";
    const competitors = data.competitors || "1";
    const competitorNames = data.competitorNames || [];

    // OEM-based margin: prefer Fulcrum_OEM__c data, fall back to hardcoded
    const HARDCODED_OEM_MARGINS = {
      Cisco: 18,
      HPE: 14,
      Dell: 12,
      "Palo Alto": 22,
      Fortinet: 20,
      VMware: 16,
      Microsoft: 15,
      "Pure Storage": 24,
      NetApp: 17,
      Arista: 21,
      CrowdStrike: 28,
      Nutanix: 22
    };
    const oemRec = this._oemDataMap[oem];
    const baseMargin = oemRec
      ? oemRec.baseMargin
      : HARDCODED_OEM_MARGINS[oem] || 15;

    // Segment adjustment
    const segmentAdj =
      segment === "Enterprise" ? 2 : segment === "SMB" ? -2 : 0;

    // Complexity adjustment
    const complexityAdj =
      complexity === "High" ? 3 : complexity === "Low" ? -1 : 0;

    // Competition adjustment
    const compAdj =
      competitors === "0"
        ? 3
        : competitors === "3+"
          ? -3
          : competitors === "2"
            ? -1
            : 0;

    const suggestedMargin = baseMargin + segmentAdj + complexityAdj + compAdj;

    // Win probability: logistic function where higher margin = lower win probability
    // Mirrors backend winprob.js algorithm
    const compBase =
      competitors === "0"
        ? 0.68
        : competitors === "1"
          ? 0.58
          : competitors === "2"
            ? 0.43
            : 0.32;
    const regBonus =
      data.dealRegType === "PremiumHunting"
        ? 0.12
        : data.dealRegType === "StandardApproved" ||
            data.dealRegType === "Teaming"
          ? 0.06
          : 0;
    const segPenalty = segment === "Enterprise" ? 0.04 : 0;
    const wpBase = compBase + regBonus - segPenalty;
    const knee = 18;
    const slope = 0.08;
    const logistic = 1 / (1 + Math.exp(slope * (suggestedMargin - knee)));
    const winProb = Math.max(
      0.05,
      Math.min(0.95, 0.6 * wpBase + 0.4 * logistic)
    );

    // Build drivers array with friendly names
    const drivers = [
      { name: `${oem} typical margins`, val: (baseMargin - 15) / 100 },
      {
        name:
          segment === "Enterprise"
            ? "Enterprise segment premium"
            : segment === "SMB"
              ? "SMB pricing pressure"
              : "Mid-market positioning",
        val: segmentAdj / 100
      },
      {
        name:
          data.dealRegType === "PremiumHunting"
            ? "Premium deal registration"
            : "Standard registration",
        val: (data.dealRegType === "PremiumHunting" ? 2.5 : 0.5) / 100
      },
      {
        name:
          competitors === "0"
            ? "No direct competition"
            : `${competitors} competitor${competitors === "1" ? "" : "s"} in deal`,
        val: compAdj / 100
      },
      {
        name:
          complexity === "High"
            ? "Complex solution justifies premium"
            : "Solution complexity",
        val: complexityAdj / 100
      }
    ].filter((d) => Math.abs(d.val) > 0.001);

    // Generate AI explanation
    const competitorText =
      competitorNames.length > 0
        ? `With ${competitorNames.join(" and ")} competing, `
        : competitors !== "0"
          ? `With ${competitors} competitor${competitors === "1" ? "" : "s"}, `
          : "";

    const explanation = `The ${suggestedMargin.toFixed(1)}% margin recommendation balances ${oem}'s typical pricing power with competitive dynamics. ${competitorText}this ${segment.toLowerCase()} deal warrants ${suggestedMargin > 20 ? "premium" : "competitive"} positioning.`;

    const qualitativeSummary = `${oem} deals in the ${segment.toLowerCase()} segment typically achieve ${baseMargin}% margins. ${complexity === "High" ? "The high solution complexity supports value-based pricing. " : ""}${competitors === "0" ? "With no direct competition, there's room for margin optimization. " : competitors === "3+" ? "Multiple competitors suggest price sensitivity - balancing win probability against margin is critical. " : ""}The recommended ${suggestedMargin.toFixed(1)}% margin targets a ${Math.round(winProb * 100)}% win probability while maintaining profitability.`;

    console.log("Mock recommendation using:", {
      oem,
      amount,
      segment,
      complexity,
      suggestedMargin
    });

    // Build metrics object matching backend structure
    const oemCost = data.oemCost || amount * 0.85;
    const plannedMarginPct = data.plannedMargin || 15;
    const recMarginPct = Math.max(8, Math.min(35, suggestedMargin));
    const plannedGP = oemCost * (plannedMarginPct / 100);
    const recGP = oemCost * (recMarginPct / 100);

    // Planned win probability using same logistic
    const plannedLogistic =
      1 / (1 + Math.exp(slope * (plannedMarginPct - knee)));
    const plannedWinProb = Math.max(
      0.05,
      Math.min(0.95, 0.6 * wpBase + 0.4 * plannedLogistic)
    );
    const plannedWinProbPct = Math.round(plannedWinProb * 100);
    const recWinProbPct = Math.round(winProb * 100);

    const plannedRiskAdj = (plannedGP * plannedWinProbPct) / 100;
    const recRiskAdj = (recGP * recWinProbPct) / 100;

    const metrics = {
      planned: {
        marginPct: plannedMarginPct,
        price: oemCost * (1 + plannedMarginPct / 100),
        grossProfit: plannedGP,
        winProb: plannedWinProbPct,
        riskAdjusted: plannedRiskAdj
      },
      recommended: {
        marginPct: recMarginPct,
        price: oemCost * (1 + recMarginPct / 100),
        grossProfit: recGP,
        winProb: recWinProbPct,
        riskAdjusted: recRiskAdj
      },
      delta: {
        grossProfit: recGP - plannedGP,
        riskAdjusted: recRiskAdj - plannedRiskAdj
      }
    };

    return {
      suggestedMarginPct: recMarginPct,
      confidence: amount >= 200000 ? 0.85 : amount >= 100000 ? 0.78 : 0.72,
      winProbability: winProb,
      drivers: drivers,
      explanation: explanation,
      qualitativeSummary: qualitativeSummary,
      metrics: metrics
    };
  }
}
