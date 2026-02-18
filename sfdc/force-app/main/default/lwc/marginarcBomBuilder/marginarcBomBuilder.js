import { LightningElement, api, track, wire } from "lwc";
import { getRecord } from "lightning/uiRecordApi";
import { ShowToastEvent } from "lightning/platformShowToastEvent";
import searchBomCatalog from "@salesforce/apex/MarginArcController.searchBomCatalog";
import analyzeBom from "@salesforce/apex/MarginArcController.analyzeBom";
import saveBomLines from "@salesforce/apex/MarginArcController.saveBomLines";
import getBomLines from "@salesforce/apex/MarginArcController.getBomLines";

const OPP_FIELDS = [
  "Opportunity.Name",
  "Opportunity.Amount",
  "Opportunity.Fulcrum_OEM__c",
  "Opportunity.Fulcrum_OEM_Cost__c",
  "Opportunity.Fulcrum_Customer_Segment__c",
  "Opportunity.Fulcrum_Deal_Reg_Type__c",
  "Opportunity.Fulcrum_Competitors__c",
  "Opportunity.Fulcrum_Solution_Complexity__c",
  "Opportunity.Fulcrum_Relationship_Strength__c",
  "Opportunity.Fulcrum_Value_Add__c"
];

const MANUFACTURERS = [
  "All",
  "Cisco",
  "HPE",
  "Juniper",
  "Palo Alto Networks",
  "Fortinet",
  "VMware"
];
const CATEGORIES = [
  "All",
  "Hardware",
  "Software",
  "Services",
  "Support",
  "Cloud",
  "Subscription",
  "Switches",
  "Routers",
  "Security",
  "Wireless",
  "Firewalls",
  "Accessories"
];

function n(v) {
  return v == null ? 0 : Number(v) || 0;
}
function fmt$(v) {
  return (
    "$" +
    n(v).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })
  );
}
function fmtPct(v) {
  return n(v).toFixed(1) + "%";
}

let _lineId = 0;

export default class MarginarcBomBuilder extends LightningElement {
  @api recordId;

  // Opportunity data
  _oem = "Unknown";
  _segment = "MidMarket";
  _dealRegType = "None";
  _competitors = "0";
  _complexity = "Medium";
  _relationship = "Good";
  _valueAdd = "Medium";

  // Search state
  @track searchQuery = "";
  @track searchManufacturer = "All";
  @track searchCategory = "All";
  @track searchResults = [];
  @track isSearching = false;
  @track showSearchResults = false;
  _searchTimeout = null;

  // BOM state
  @track bomLines = [];
  @track isDirty = false;
  @track isSaving = false;

  // Analysis state
  @track analysis = null;
  @track isAnalyzing = false;

  // Filter options
  get manufacturerOptions() {
    return MANUFACTURERS.map((m) => ({ label: m, value: m }));
  }
  get categoryOptions() {
    return CATEGORIES.map((c) => ({ label: c, value: c }));
  }

  // Wire opportunity data
  @wire(getRecord, { recordId: "$recordId", fields: OPP_FIELDS })
  wiredOpportunity({ data, error }) {
    if (data) {
      const f = data.fields;
      this._oem = f.Fulcrum_OEM__c?.value || "Unknown";
      this._segment = f.Fulcrum_Customer_Segment__c?.value || "MidMarket";
      this._dealRegType = f.Fulcrum_Deal_Reg_Type__c?.value || "None";
      this._competitors = f.Fulcrum_Competitors__c?.value || "0";
      this._complexity = f.Fulcrum_Solution_Complexity__c?.value || "Medium";
      this._relationship = f.Fulcrum_Relationship_Strength__c?.value || "Good";
      this._valueAdd = f.Fulcrum_Value_Add__c?.value || "Medium";
    }
    if (error) {
      // Custom fields may not exist — use defaults
    }
  }

  // Load saved BOM lines on init
  connectedCallback() {
    this.loadSavedBom();
  }

  async loadSavedBom() {
    try {
      const lines = await getBomLines({ opportunityId: this.recordId });
      if (lines && lines.length > 0) {
        this.bomLines = lines.map((l) => ({
          id: ++_lineId,
          partNumber: l.Product_Number__c || "",
          manufacturer: l.Vendor__c || "",
          description: l.Description__c || "",
          category: l.Category__c || "Hardware",
          quantity: n(l.Quantity__c) || 1,
          unitCost: n(l.Unit_Cost__c),
          marginPct: n(l.Margin_Pct__c),
          recommendedMarginPct:
            l.Recommended_Margin_Pct__c != null
              ? n(l.Recommended_Margin_Pct__c)
              : null,
          listPrice: n(l.List_Price__c),
          family: ""
        }));
        this.isDirty = false;
      }
      // eslint-disable-next-line no-unused-vars
    } catch (err) {
      // No saved lines — start empty
    }
  }

  // ---- Computed getters ----

  get hasBomLines() {
    return this.bomLines.length > 0;
  }
  get isEmpty() {
    return this.bomLines.length === 0;
  }
  get showEmptyState() {
    return this.bomLines.length === 0;
  }
  get lineCount() {
    return this.bomLines.length;
  }
  get hasAnalysis() {
    return this.analysis != null;
  }
  get hasAnalysisWithRecs() {
    return (
      this.analysis != null &&
      this.analysis.lines &&
      this.analysis.lines.length > 0
    );
  }
  get categoryEditOptions() {
    return CATEGORIES.filter((c) => c !== "All").map((c) => ({
      label: c,
      value: c
    }));
  }

  get showRecColumn() {
    return this.bomLines.some((line) => line.recommendedMarginPct != null);
  }

  get tableRows() {
    return this.bomLines.map((line) => {
      const unitPrice =
        line.marginPct >= 100
          ? line.unitCost * 10
          : line.unitCost / (1 - line.marginPct / 100);
      const extCost = line.unitCost * line.quantity;
      const extPrice = unitPrice * line.quantity;
      const gp = extPrice - extCost;
      const recMgn = line.recommendedMarginPct;
      const delta = recMgn != null ? recMgn - line.marginPct : null;
      const hasDelta = delta != null;
      const recDeltaDisplay = hasDelta
        ? (delta >= 0 ? "+" : "") + delta.toFixed(1)
        : "";
      const recDeltaClass = !hasDelta
        ? "delta-badge neutral"
        : delta > 0.5
          ? "delta-badge positive"
          : delta < -0.5
            ? "delta-badge negative"
            : "delta-badge neutral";
      const isBlank = !line.partNumber;
      return {
        ...line,
        unitPriceDisplay: fmt$(unitPrice),
        extCostDisplay: fmt$(extCost),
        extPriceDisplay: fmt$(extPrice),
        gpDisplay: fmt$(gp),
        marginDisplay: fmtPct(line.marginPct),
        recMarginDisplay: recMgn != null ? fmtPct(recMgn) : "\u2014",
        hasDelta,
        recDeltaDisplay,
        recDeltaClass,
        isBlank,
        hasCategory: !isBlank && !!line.category,
        deltaDisplay:
          delta != null
            ? (delta >= 0 ? "+" : "") + delta.toFixed(1) + "%"
            : "\u2014",
        deltaClass:
          delta == null
            ? "delta neutral"
            : delta > 0.5
              ? "delta positive"
              : delta < -0.5
                ? "delta negative"
                : "delta neutral",
        marginHealthClass:
          delta == null
            ? ""
            : delta > 2
              ? "health-red"
              : delta > 0
                ? "health-yellow"
                : "health-green",
        categoryClass:
          "cat-badge cat-" +
          (line.category || "Hardware").toLowerCase().replace(/\s+/g, "-")
      };
    });
  }

  get totalCost() {
    return this.bomLines.reduce((s, l) => s + l.unitCost * l.quantity, 0);
  }
  get totalPrice() {
    return this.bomLines.reduce((s, l) => {
      const up =
        l.marginPct >= 100
          ? l.unitCost * 10
          : l.unitCost / (1 - l.marginPct / 100);
      return s + up * l.quantity;
    }, 0);
  }
  get totalGP() {
    return this.totalPrice - this.totalCost;
  }
  get blendedMarginPct() {
    return this.totalPrice > 0
      ? ((this.totalPrice - this.totalCost) / this.totalPrice) * 100
      : 0;
  }
  get totalCostDisplay() {
    return fmt$(this.totalCost);
  }
  get totalPriceDisplay() {
    return fmt$(this.totalPrice);
  }
  get totalGPDisplay() {
    return fmt$(this.totalGP);
  }
  get blendedMarginDisplay() {
    return fmtPct(this.blendedMarginPct);
  }

  get healthScoreClass() {
    if (!this.analysis) return "";
    const s = this.analysis.recommendations.healthScore;
    if (s >= 80) return "health-score good";
    if (s >= 50) return "health-score warning";
    return "health-score critical";
  }

  get healthScoreLabel() {
    if (!this.analysis) return "";
    const s = this.analysis.recommendations.healthScore;
    if (s >= 80) return "Healthy";
    if (s >= 50) return "Needs Attention";
    return "Critical";
  }

  get insights() {
    return this.analysis?.recommendations?.insights || [];
  }

  get formattedInsights() {
    const raw =
      this.analysisResult?.insights ||
      this.analysis?.recommendations?.insights ||
      [];
    if (!raw || raw.length === 0) return [];

    return raw.map((insight, idx) => {
      // Handle both old string format and new {type, text} object format
      if (typeof insight === "string") {
        return {
          id: `insight-${idx}`,
          type: "info",
          text: insight,
          iconClass: "insight-icon insight-icon-info",
          containerClass: "insight-item insight-item-info",
          isWarning: false,
          isOpportunity: false,
          isInfo: true
        };
      }
      const type = insight.type || "info";
      return {
        id: `insight-${idx}`,
        type: type,
        text: insight.text || insight.message || "",
        iconClass: `insight-icon insight-icon-${type}`,
        containerClass: `insight-item insight-item-${type}`,
        isWarning: type === "warning",
        isOpportunity: type === "opportunity",
        isInfo: type === "info"
      };
    });
  }

  get hasFormattedInsights() {
    return this.formattedInsights.length > 0;
  }

  get suggestedBlendedMargin() {
    return this.analysis?.recommendations?.suggestedBlendedMargin;
  }

  get marginGap() {
    if (!this.analysis) return null;
    return (
      this.analysis.recommendations.suggestedBlendedMargin -
      this.blendedMarginPct
    );
  }

  get marginGapDisplay() {
    const gap = this.marginGap;
    if (gap == null) return "";
    return (gap >= 0 ? "+" : "") + gap.toFixed(1) + "%";
  }

  // ---- Search handlers ----

  handleSearchInput(e) {
    this.searchQuery = e.target.value;
    clearTimeout(this._searchTimeout);
    if (this.searchQuery.length >= 2) {
      this._searchTimeout = setTimeout(() => this.doSearch(), 300); // eslint-disable-line @lwc/lwc/no-async-operation
    } else {
      this.searchResults = [];
      this.showSearchResults = false;
    }
  }

  handleManufacturerChange(e) {
    this.searchManufacturer = e.detail.value;
    if (this.searchQuery.length >= 2) this.doSearch();
  }

  handleCategoryChange(e) {
    this.searchCategory = e.detail.value;
    if (this.searchQuery.length >= 2) this.doSearch();
  }

  async doSearch() {
    this.isSearching = true;
    try {
      const mfg =
        this.searchManufacturer === "All" ? null : this.searchManufacturer;
      const cat = this.searchCategory === "All" ? null : this.searchCategory;
      const json = await searchBomCatalog({
        query: this.searchQuery,
        manufacturer: mfg,
        category: cat
      });
      const data = JSON.parse(json);
      this.searchResults = (data.results || []).map((r) => ({
        ...r,
        priceDisplay: r.listPrice ? fmt$(r.listPrice) : "—",
        label: r.partNumber + " — " + (r.description || r.family || r.category)
      }));
      this.showSearchResults = this.searchResults.length > 0;
      // eslint-disable-next-line no-unused-vars
    } catch (err) {
      this.showSearchResults = false;
    }
    this.isSearching = false;
  }

  handleSelectProduct(e) {
    const partNumber = e.currentTarget.dataset.part;
    const product = this.searchResults.find((r) => r.partNumber === partNumber);
    if (product) {
      this.bomLines = [
        ...this.bomLines,
        {
          id: ++_lineId,
          partNumber: product.partNumber,
          manufacturer: product.manufacturer,
          description: product.description || "",
          category: product.category || "Hardware",
          quantity: 1,
          unitCost: n(product.listPrice) * 0.65,
          marginPct: 15,
          recommendedMarginPct: null,
          listPrice: n(product.listPrice),
          family: product.family || ""
        }
      ];
      this.isDirty = true;
      this.analysis = null;
      this.dispatchEvent(
        new ShowToastEvent({
          title: "Product Added",
          message: `${product.partNumber} added to BOM`,
          variant: "success"
        })
      );
      // eslint-disable-next-line @lwc/lwc/no-async-operation
      setTimeout(() => {
        const rows = this.template.querySelectorAll(
          '[role="row"]:not(.table-header):not(.table-totals)'
        );
        if (rows.length > 0) {
          rows[rows.length - 1].scrollIntoView({
            behavior: "smooth",
            block: "nearest"
          });
        }
      }, 100);
    }
    this.showSearchResults = false;
    this.searchQuery = "";
  }

  handleSearchBlur() {
    // Delay to allow click on result
    // eslint-disable-next-line @lwc/lwc/no-async-operation
    setTimeout(() => {
      this.showSearchResults = false;
    }, 250);
  }

  // ---- BOM line handlers ----

  handleAddBlankLine() {
    this.bomLines = [
      ...this.bomLines,
      {
        id: ++_lineId,
        partNumber: "",
        manufacturer: "",
        description: "",
        category: "Hardware",
        quantity: 1,
        unitCost: 0,
        marginPct: 15,
        recommendedMarginPct: null,
        listPrice: 0,
        family: ""
      }
    ];
    this.isDirty = true;
    this.analysis = null;
    // eslint-disable-next-line @lwc/lwc/no-async-operation
    setTimeout(() => {
      const rows = this.template.querySelectorAll(
        '[role="row"]:not(.table-header):not(.table-totals)'
      );
      if (rows.length > 0) {
        rows[rows.length - 1].scrollIntoView({
          behavior: "smooth",
          block: "nearest"
        });
      }
    }, 100);
  }

  handleDeleteLine(e) {
    const lineId = parseInt(e.currentTarget.dataset.id, 10);
    this.bomLines = this.bomLines.filter((l) => l.id !== lineId);
    this.isDirty = true;
    this.analysis = null;
  }

  handleFieldChange(e) {
    const lineId = parseInt(e.currentTarget.dataset.id, 10);
    const field = e.currentTarget.dataset.field;
    // lightning-combobox passes value via e.detail.value; native inputs via e.target.value
    let value = e.detail?.value !== undefined ? e.detail.value : e.target.value;
    if (["quantity", "unitCost", "marginPct"].includes(field)) {
      value = parseFloat(value) || 0;
    }
    this.bomLines = this.bomLines.map((l) => {
      if (l.id === lineId) return { ...l, [field]: value };
      return l;
    });
    this.isDirty = true;
    this.analysis = null;
  }

  // ---- Analyze ----

  async handleAnalyze() {
    if (this.bomLines.length === 0) return;
    this.isAnalyzing = true;
    try {
      const lines = this.bomLines.map((l) => ({
        partNumber: l.partNumber || undefined,
        manufacturer: l.manufacturer || undefined,
        description: l.description || undefined,
        category: l.category || undefined,
        quantity: l.quantity,
        unitCost: l.unitCost,
        marginPct: l.marginPct
      }));
      const context = {
        oem: this._oem,
        segment: this._segment,
        dealRegType: this._dealRegType,
        competitors: this._competitors,
        solutionComplexity: this._complexity,
        relationshipStrength: this._relationship,
        valueAdd: this._valueAdd
      };
      const json = await analyzeBom({
        bomLinesJson: JSON.stringify(lines),
        contextJson: JSON.stringify(context)
      });
      this.analysis = JSON.parse(json);

      // Update recommended margins from analysis
      if (this.analysis.lines) {
        this.bomLines = this.bomLines.map((l, i) => {
          const analyzed = this.analysis.lines[i];
          if (analyzed) {
            return {
              ...l,
              recommendedMarginPct: analyzed.recommendedMarginPct
            };
          }
          return l;
        });
      }
    } catch (e) {
      this.dispatchEvent(
        new ShowToastEvent({
          title: "Analysis Error",
          message: e.body?.message || e.message || "Failed to analyze BOM",
          variant: "error"
        })
      );
    }
    this.isAnalyzing = false;
  }

  // ---- Save ----

  async handleSave() {
    if (this.bomLines.length === 0) return;
    this.isSaving = true;
    try {
      const lines = this.bomLines.map((l, i) => ({
        key: "bom-" + i,
        label: l.description || l.partNumber || "Line " + (i + 1),
        category: l.category || "Hardware",
        unit: "ea",
        quantity: l.quantity,
        unitCost: l.unitCost,
        unitPrice:
          l.marginPct >= 100
            ? l.unitCost * 10
            : l.unitCost / (1 - l.marginPct / 100),
        listPrice: l.listPrice || 0,
        extendedCost: l.unitCost * l.quantity,
        extendedPrice:
          (l.marginPct >= 100
            ? l.unitCost * 10
            : l.unitCost / (1 - l.marginPct / 100)) * l.quantity,
        marginPct: l.marginPct / 100,
        recommendedMarginPct:
          l.recommendedMarginPct != null ? l.recommendedMarginPct / 100 : null,
        productNumber: l.partNumber || "",
        vendor: l.manufacturer || "",
        note: l.family || "",
        origin: "bom-builder"
      }));
      await saveBomLines({
        opportunityId: this.recordId,
        bomLinesJson: JSON.stringify(lines)
      });
      this.isDirty = false;
      this.dispatchEvent(
        new ShowToastEvent({
          title: "BOM Saved",
          message:
            this.bomLines.length + " line items saved to this opportunity",
          variant: "success"
        })
      );
    } catch (e) {
      this.dispatchEvent(
        new ShowToastEvent({
          title: "Save Error",
          message: e.body?.message || e.message || "Failed to save BOM",
          variant: "error"
        })
      );
    }
    this.isSaving = false;
  }

  handleClearAll() {
    this.bomLines = [];
    this.analysis = null;
    this.isDirty = true;
  }

  handleFocusSearch() {
    const searchInput = this.template.querySelector(".search-input");
    if (searchInput) searchInput.focus();
  }

  handleApplyRecommended() {
    if (!this.analysis || !this.analysis.lines) return;
    let count = 0;
    this.bomLines = this.bomLines.map((l, i) => {
      const analyzed = this.analysis.lines[i];
      if (analyzed && analyzed.recommendedMarginPct != null) {
        count++;
        return { ...l, marginPct: analyzed.recommendedMarginPct };
      }
      return l;
    });
    this.isDirty = true;
    if (count > 0) {
      this.dispatchEvent(
        new ShowToastEvent({
          title: "Margins Updated",
          message: `Applied recommended margins to ${count} lines`,
          variant: "success"
        })
      );
    }
  }

  // ---- CSV Import ----

  handleCsvImport() {
    this.template.querySelector(".csv-input-hidden").click();
  }

  handleCsvFile(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = reader.result;
        const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
        if (lines.length < 2) {
          this.dispatchEvent(
            new ShowToastEvent({
              title: "CSV Import",
              message: "No data rows found in CSV",
              variant: "warning"
            })
          );
          return;
        }
        const headerLine = lines[0];
        const headers = headerLine.split(",").map((h) =>
          h
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]/g, "")
        );
        const colIndex = (names) => {
          for (const name of names) {
            const idx = headers.indexOf(name);
            if (idx !== -1) return idx;
          }
          return -1;
        };
        const partCol = colIndex([
          "partnumber",
          "partno",
          "part",
          "sku",
          "productnumber"
        ]);
        const descCol = colIndex([
          "description",
          "desc",
          "name",
          "productname"
        ]);
        const qtyCol = colIndex(["qty", "quantity", "count"]);
        const costCol = colIndex(["unitcost", "cost", "price", "unitprice"]);
        const marginCol = colIndex(["margin", "marginpct", "marginpercent"]);
        const catCol = colIndex(["category", "cat", "type", "productcategory"]);
        const mfgCol = colIndex(["manufacturer", "mfg", "vendor", "brand"]);

        const now = Date.now();
        const newLines = [];
        for (let i = 1; i < lines.length; i++) {
          const cols = lines[i]
            .split(",")
            .map((c) => c.trim().replace(/^["']|["']$/g, ""));
          if (cols.length < 2) continue;
          newLines.push({
            id: now + "_" + i,
            partNumber: partCol >= 0 ? cols[partCol] || "" : "",
            manufacturer: mfgCol >= 0 ? cols[mfgCol] || "" : "",
            description: descCol >= 0 ? cols[descCol] || "" : "",
            category: catCol >= 0 ? cols[catCol] || "Hardware" : "Hardware",
            quantity: qtyCol >= 0 ? parseInt(cols[qtyCol], 10) || 1 : 1,
            unitCost: costCol >= 0 ? parseFloat(cols[costCol]) || 0 : 0,
            marginPct: marginCol >= 0 ? parseFloat(cols[marginCol]) || 15 : 15,
            recommendedMarginPct: null,
            listPrice: 0,
            family: ""
          });
        }
        if (newLines.length > 0) {
          this.bomLines = [...this.bomLines, ...newLines];
          this.isDirty = true;
          this.analysis = null;
          this.dispatchEvent(
            new ShowToastEvent({
              title: "CSV Import",
              message: newLines.length + " lines imported from CSV",
              variant: "success"
            })
          );
        } else {
          this.dispatchEvent(
            new ShowToastEvent({
              title: "CSV Import",
              message: "No valid data rows found",
              variant: "warning"
            })
          );
        }
      } catch (err) {
        this.dispatchEvent(
          new ShowToastEvent({
            title: "CSV Import Error",
            message: err.message || "Failed to parse CSV",
            variant: "error"
          })
        );
      }
      // Reset file input so the same file can be re-imported
      event.target.value = "";
    };
    reader.readAsText(file);
  }

  // ---- Batch Margin Edit ----

  handleSetAllMargins(event) {
    const margin = parseFloat(event.currentTarget.dataset.margin);
    if (isNaN(margin)) return;
    this.bomLines = this.bomLines.map((l) => ({ ...l, marginPct: margin }));
    this.isDirty = true;
    this.analysis = null;
  }

  handleCustomBatchMargin(event) {
    const margin = parseFloat(event.target.value);
    if (isNaN(margin) || margin < 0 || margin > 50) return;
    this.bomLines = this.bomLines.map((l) => ({ ...l, marginPct: margin }));
    this.isDirty = true;
    this.analysis = null;
  }
}
