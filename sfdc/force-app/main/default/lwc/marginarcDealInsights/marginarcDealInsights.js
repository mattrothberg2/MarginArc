import { LightningElement, api, wire, track } from "lwc";
import { getRecord } from "lightning/uiRecordApi";
import getOemRecords from "@salesforce/apex/MarginArcController.getOemRecords";

const OPPORTUNITY_FIELDS = [
  "Opportunity.Name",
  "Opportunity.Amount",
  "Opportunity.StageName",
  "Opportunity.Account.Industry",
  "Opportunity.Fulcrum_OEM__c",
  "Opportunity.Fulcrum_Planned_Margin__c",
  "Opportunity.Fulcrum_Competitor_Names__c",
  "Opportunity.Fulcrum_Deal_Reg_Type__c",
  "Opportunity.Fulcrum_OEM_Cost__c",
  "Opportunity.Fulcrum_Services_Attached__c",
  "Opportunity.Fulcrum_Solution_Complexity__c"
];

export default class MarginarcDealInsights extends LightningElement {
  @api recordId;
  @track opportunityData = null;
  @track insights = [];
  _oemDataMap = {}; // OEM Name → { baseMargin, ... } from Fulcrum_OEM__c

  @wire(getOemRecords)
  wiredOemRecords({ data, error }) {
    if (data && data.length > 0) {
      const map = {};
      for (const rec of data) {
        map[rec.Name] = {
          baseMargin: rec.Base_Margin__c || 15,
          dealRegBoost: rec.Deal_Reg_Margin_Boost__c || 3,
          servicesBoost: rec.Services_Margin_Boost__c || 0
        };
      }
      this._oemDataMap = map;
      // Re-generate insights if opportunity data already loaded
      if (this.opportunityData) {
        this.generateInsights();
      }
    } else if (error) {
      console.warn("OEM data query failed, using hardcoded fallback:", error);
    }
  }

  @wire(getRecord, { recordId: "$recordId", fields: OPPORTUNITY_FIELDS })
  wiredOpportunity({ error, data }) {
    if (data) {
      this.opportunityData = this.mapOpportunityData(data);
      this.generateInsights();
    } else if (error) {
      this.useFallbackData();
    }
  }

  mapOpportunityData(data) {
    const fields = data.fields;
    const name = fields.Name?.value || "";
    const amount = fields.Amount?.value || 0;
    const marginarcOem = fields.Fulcrum_OEM__c?.value;
    const competitorNamesRaw = fields.Fulcrum_Competitor_Names__c?.value || "";
    const competitorNames = competitorNamesRaw
      ? competitorNamesRaw
          .split(";")
          .map((c) => c.trim())
          .filter(Boolean)
      : [];

    return {
      name: name,
      amount: amount,
      stageName: fields.StageName?.value || "",
      industry: fields.Account?.value?.fields?.Industry?.value || "Technology",
      oem: marginarcOem || this.deriveOemFromName(name),
      segment:
        amount >= 300000
          ? "Enterprise"
          : amount >= 100000
            ? "MidMarket"
            : "SMB",
      plannedMargin: fields.Fulcrum_Planned_Margin__c?.value,
      oemCost: fields.Fulcrum_OEM_Cost__c?.value,
      competitorNames: competitorNames,
      competitorCount: competitorNames.length,
      dealRegType: fields.Fulcrum_Deal_Reg_Type__c?.value || null,
      servicesAttached: fields.Fulcrum_Services_Attached__c?.value === true,
      solutionComplexity: fields.Fulcrum_Solution_Complexity__c?.value || null
    };
  }

  useFallbackData() {
    this.opportunityData = {
      name: "Demo Opportunity",
      amount: 150000,
      stageName: "Proposal",
      industry: "Technology",
      oem: "Cisco",
      segment: "MidMarket",
      plannedMargin: 15,
      oemCost: 127500,
      competitorNames: [],
      competitorCount: 0,
      dealRegType: "StandardApproved",
      servicesAttached: false,
      solutionComplexity: "Medium"
    };
    this.generateInsights();
  }

  deriveOemFromName(name) {
    const nameLower = name.toLowerCase();
    if (nameLower.includes("cisco")) return "Cisco";
    if (nameLower.includes("hpe") || nameLower.includes("hewlett"))
      return "HPE";
    if (nameLower.includes("dell")) return "Dell";
    if (nameLower.includes("palo alto") || nameLower.includes("paloalto"))
      return "Palo Alto";
    if (nameLower.includes("fortinet")) return "Fortinet";
    if (nameLower.includes("vmware")) return "VMware";
    if (nameLower.includes("microsoft") || nameLower.includes("azure"))
      return "Microsoft";
    if (nameLower.includes("pure") || nameLower.includes("flashblade"))
      return "Pure Storage";
    if (nameLower.includes("netapp")) return "NetApp";
    if (nameLower.includes("arista")) return "Arista";
    if (nameLower.includes("crowdstrike")) return "CrowdStrike";
    if (nameLower.includes("nutanix")) return "Nutanix";
    if (nameLower.includes("splunk")) return "Splunk";
    if (nameLower.includes("zscaler")) return "Zscaler";
    return "Cisco";
  }

  generateInsights() {
    if (!this.opportunityData) return;

    const insights = [];
    const data = this.opportunityData;

    // OEM-specific data
    const oemInsights = {
      Cisco: {
        avgMargin: 18,
        tip: "Cisco deals respond well to service attach. Consider bundling SmartNet for margin uplift.",
        marketTrend: "Cisco margins stable with VIP program benefits."
      },
      "Palo Alto": {
        avgMargin: 22,
        tip: "PANW security deals command premium margins. Emphasize threat prevention ROI.",
        marketTrend: "Strong demand driving margin opportunities."
      },
      HPE: {
        avgMargin: 14,
        tip: "HPE deals benefit from GreenLake positioning. Services attach improves margins.",
        marketTrend: "Infrastructure refresh cycle ongoing."
      },
      Dell: {
        avgMargin: 12,
        tip: "Dell volume deals have thin margins. Focus on value-add services.",
        marketTrend: "Competitive pricing pressure in server market."
      },
      Fortinet: {
        avgMargin: 20,
        tip: "Fortinet security fabric bundles improve deal value and margin.",
        marketTrend: "SMB security demand increasing."
      },
      VMware: {
        avgMargin: 16,
        tip: "VMware ELA deals offer better margins than individual SKUs.",
        marketTrend: "Multi-cloud strategy driving expansion."
      },
      Microsoft: {
        avgMargin: 15,
        tip: "Azure consumption deals benefit from CSP partner margins.",
        marketTrend: "Cloud adoption accelerating across segments."
      },
      "Pure Storage": {
        avgMargin: 24,
        tip: "Pure Storage Evergreen subscriptions provide margin stability.",
        marketTrend: "Flash storage demand remains strong."
      },
      NetApp: {
        avgMargin: 17,
        tip: "NetApp hybrid cloud positioning differentiates from competitors.",
        marketTrend: "Data management complexity drives services."
      },
      Arista: {
        avgMargin: 21,
        tip: "Arista cloud networking deals favor technical differentiation. Spine/leaf designs command premium.",
        marketTrend:
          "Data center modernization and 400G adoption driving growth."
      },
      CrowdStrike: {
        avgMargin: 28,
        tip: "CrowdStrike Falcon platform deals have strong margins. Bundle identity protection.",
        marketTrend: "Endpoint security consolidation trend."
      },
      Nutanix: {
        avgMargin: 22,
        tip: "Nutanix HCI deals benefit from infrastructure simplification story.",
        marketTrend: "Hybrid cloud and VDI driving demand."
      }
    };

    const oemData = oemInsights[data.oem] || oemInsights.Cisco;

    // Override avgMargin from Fulcrum_OEM__c if available
    const dynamicOem = this._oemDataMap[data.oem];
    const avgMargin = dynamicOem ? dynamicOem.baseMargin : oemData.avgMargin;

    // 1. OEM Market Average — always show
    insights.push({
      id: "oem-margin",
      type: "info",
      icon: "chart",
      title: `${data.oem} Market Average`,
      description: `Typical ${data.oem} margins range ${avgMargin - 3}%\u2013${avgMargin + 3}% for ${data.segment} deals.`,
      priority: 1
    });

    // 2. Planned margin vs OEM average — deal-specific
    if (data.plannedMargin != null) {
      const diff = data.plannedMargin - avgMargin;
      if (diff < -3) {
        insights.push({
          id: "margin-below",
          type: "warning",
          icon: "warning",
          title: "Margin Below Average",
          description: `Your planned margin of ${Number(data.plannedMargin).toFixed(1)}% is ${Math.abs(diff).toFixed(1)}pp below the ${data.oem} average. Consider whether competitive pressure justifies this discount.`,
          priority: 2
        });
      } else if (diff > 3) {
        insights.push({
          id: "margin-above",
          type: "tip",
          icon: "bulb",
          title: "Strong Margin Position",
          description: `Your planned margin of ${Number(data.plannedMargin).toFixed(1)}% is ${diff.toFixed(1)}pp above the ${data.oem} average. Ensure value justification is clear to protect this position.`,
          priority: 2
        });
      }
    }

    // 3. Competitive pressure — deal-specific
    if (data.competitorCount > 0) {
      const names = data.competitorNames.join(", ");
      if (data.competitorCount >= 3) {
        insights.push({
          id: "competition-heavy",
          type: "warning",
          icon: "warning",
          title: "Crowded Deal",
          description: `${data.competitorCount} competitors in this deal (${names}). Multi-bidder deals compress margins 2\u20134%. Lead with differentiation, not price.`,
          priority: 2
        });
      } else {
        insights.push({
          id: "competition",
          type: "strategy",
          icon: "target",
          title: `Competing Against ${names}`,
          description:
            data.competitorCount === 1
              ? "One competitor gives you room to differentiate on services and technical depth rather than discounting."
              : "Two competitors in play. Focus on unique value-add and customer relationship strength.",
          priority: 3
        });
      }
    } else {
      insights.push({
        id: "no-competition",
        type: "tip",
        icon: "shield",
        title: "Sole Source Opportunity",
        description:
          "No competitors flagged. Protect your margin position \u2014 don\u2019t discount against yourself.",
        priority: 3
      });
    }

    // 4. Deal registration insight — deal-specific
    if (data.dealRegType) {
      if (data.dealRegType === "PremiumHunting") {
        insights.push({
          id: "dealreg-premium",
          type: "action",
          icon: "check",
          title: "Premium Deal Reg Active",
          description: `Premium hunting registration provides 2\u20133% margin protection from ${data.oem}. Leverage this in pricing.`,
          priority: 3
        });
      } else if (data.dealRegType === "NotRegistered") {
        insights.push({
          id: "dealreg-missing",
          type: "warning",
          icon: "warning",
          title: "No Deal Registration",
          description: `This deal is not registered with ${data.oem}. You\u2019re leaving 1\u20133% margin on the table. Register before quoting.`,
          priority: 2
        });
      }
    }

    // 5. Services insight
    if (data.servicesAttached === false && data.amount >= 100000) {
      insights.push({
        id: "services-missing",
        type: "tip",
        icon: "bulb",
        title: "Attach Services",
        description: `${data.oem} deals over $100K with services attached win 15\u201320% more often and carry 3\u20135% higher margins. ${oemInsights[data.oem]?.tip || ""}`,
        priority: 3
      });
    }

    // 6. Industry vertical — always show
    const industryInsights = {
      Technology: {
        note: "Tech buyers understand value and evaluate on TCO. Standard margins apply."
      },
      "Financial Services": {
        note: "Financial services pays premium for security, compliance, and reliability. Expect 1\u20132% margin uplift."
      },
      Finance: {
        note: "Financial services pays premium for security, compliance, and reliability. Expect 1\u20132% margin uplift."
      },
      Healthcare: {
        note: "Healthcare values reliability and HIPAA compliance. Moderate premium possible on compliant solutions."
      },
      Government: {
        note: "Government procurement is price-sensitive with structured bid processes. Margins typically compressed 1\u20132%."
      },
      Education: {
        note: "Education budgets are constrained. Volume and multi-year agreements may offset lower per-unit margin."
      },
      Manufacturing: {
        note: "Manufacturing values uptime and OT security. Services attach well in this vertical."
      },
      Retail: {
        note: "Retail is seasonal and cost-conscious. Time deals around budget cycles for best margins."
      },
      Energy: {
        note: "Energy sector demands ruggedized and compliant solutions. Specialized requirements support premium pricing."
      },
      Telecommunications: {
        note: "Telcos negotiate hard on price but buy at scale. Volume commitments can justify margin concessions."
      },
      Media: {
        note: "Media companies prioritize performance and speed. High-bandwidth solutions command premium."
      }
    };

    const industryData =
      industryInsights[data.industry] || industryInsights.Technology;
    insights.push({
      id: "industry",
      type: "info",
      icon: "building",
      title: `${data.industry} Vertical`,
      description: industryData.note,
      priority: 4
    });

    // 7. Stage-based insight
    if (data.stageName && data.stageName.toLowerCase().includes("negotiat")) {
      insights.push({
        id: "stage-negotiate",
        type: "action",
        icon: "handshake",
        title: "Negotiation Stage",
        description:
          "Customer is price-sensitive at this stage. Have margin justification ready and know your walk-away point.",
        priority: 2
      });
    } else if (
      data.stageName &&
      data.stageName.toLowerCase().includes("proposal")
    ) {
      insights.push({
        id: "stage-proposal",
        type: "strategy",
        icon: "document",
        title: "Proposal Stage",
        description:
          "Lock in your pricing position now. Anchor high \u2014 it\u2019s easier to discount down than to raise later.",
        priority: 4
      });
    }

    // 8. Market trend — always show last
    insights.push({
      id: "market-trend",
      type: "trend",
      icon: "trend",
      title: `${data.oem} Market Trend`,
      description: oemData.marketTrend,
      priority: 5
    });

    // Sort by priority (lower number = higher priority) and cap at 8 cards (PRD §5.2.1)
    insights.sort((a, b) => a.priority - b.priority);

    this.insights = insights.slice(0, 8);
  }

  get hasInsights() {
    return this.insights.length > 0;
  }

  get noInsights() {
    return this.insights.length === 0;
  }

  get formattedInsights() {
    return this.insights.map((insight) => ({
      ...insight,
      cardClass: `insight-card insight-${insight.type}`,
      isChart: insight.icon === "chart",
      isWarning: insight.icon === "warning",
      isBulb: insight.icon === "bulb",
      isTarget: insight.icon === "target",
      isShield: insight.icon === "shield",
      isCheck: insight.icon === "check",
      isBuilding: insight.icon === "building",
      isHandshake: insight.icon === "handshake",
      isDocument: insight.icon === "document",
      isTrend: insight.icon === "trend"
    }));
  }

  get opportunityName() {
    return this.opportunityData?.name || "Opportunity";
  }

  get detectedOem() {
    return this.opportunityData?.oem || "Cisco";
  }

  get detectedSegment() {
    return this.opportunityData?.segment || "MidMarket";
  }

  get insightCount() {
    return this.insights.length;
  }

  get footerText() {
    return `${this.insightCount} insights from your data`;
  }
}
