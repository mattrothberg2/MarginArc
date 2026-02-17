import { LightningElement, api, track } from "lwc";

function n(val) {
  return val == null ? 0 : Number(val);
}

function formatCurrency(val) {
  return "$" + n(val).toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function formatPct(val) {
  return n(val).toFixed(1) + "%";
}

// Read unit cost from either generated BOM (unitCost) or manual BOM (discountedPrice)
function itemUnitCost(item) {
  const uc = n(item.unitCost);
  return uc > 0 ? uc : n(item.discountedPrice);
}

// Read unit price from either generated BOM (unitPrice) or manual BOM (priceAfterMargin)
function itemUnitPrice(item) {
  const up = n(item.unitPrice);
  return up > 0 ? up : n(item.priceAfterMargin);
}

// Get the per-line recommended margin: prefer recommendedMarginPct (set on manual BOMs),
// fall back to marginPct (set on generated BOMs). Both are decimals (0.22 = 22%).
function itemRecMarginPct(item) {
  if (item.recommendedMarginPct != null && item.recommendedMarginPct > 0) {
    return n(item.recommendedMarginPct) * 100;
  }
  return n(item.marginPct) * 100;
}

const CATEGORY_CLASSES = {
  Hardware: "bom-cat bom-cat-hardware",
  Software: "bom-cat bom-cat-software",
  Services: "bom-cat bom-cat-services",
  Support: "bom-cat bom-cat-support",
  Cloud: "bom-cat bom-cat-cloud"
};

export default class MarginarcBomTable extends LightningElement {
  @api bomData;
  @api plannedMarginPct;
  @api oemCost;
  @api isRecalculating = false;

  @track editedMargins = {};
  @track isCollapsed = false;

  // Store original BOM item data (from first generated BOM) so we can reference
  // original rec margins and original field values across recalculations.
  _originalItemsByKey = {};

  // When bomData changes, capture original item data if this is the first (generated) load
  _lastBomOrigin = null;

  get hasBom() {
    return this.bomData && this.bomData.items && this.bomData.items.length > 0;
  }

  get isExpanded() {
    return !this.isCollapsed;
  }

  get bomOrigin() {
    return this.bomData?.origin === "manual" ? "Manual" : "Generated";
  }

  get bomOriginClass() {
    return this.bomData?.origin === "manual"
      ? "bom-origin-badge bom-origin-manual"
      : "bom-origin-badge bom-origin-generated";
  }

  get bomLineCount() {
    return this.bomData?.items?.length || 0;
  }

  get chevronClass() {
    return this.isCollapsed
      ? "bom-chevron bom-chevron-collapsed"
      : "bom-chevron";
  }

  get blendedRecMarginDisplay() {
    // Use original BOM totals margin if we have it, otherwise current
    const origTotals = this._hasOriginal ? this._originalTotals : null;
    const pct = origTotals
      ? n(origTotals.marginPct) * 100
      : n(this.bomData?.totals?.marginPct) * 100;
    return formatPct(pct);
  }

  get isEditing() {
    return Object.keys(this.editedMargins).length > 0;
  }

  get isManualOrigin() {
    return this.bomData?.origin === "manual";
  }

  get showActionBar() {
    return this.isEditing || this.isManualOrigin;
  }

  get _hasOriginal() {
    return Object.keys(this._originalItemsByKey).length > 0;
  }

  _originalTotals = null;

  // Capture original BOM data on first generated load
  _captureOriginalIfNeeded() {
    if (!this.hasBom) return;
    const origin = this.bomData.origin;
    // Capture on first generated BOM; don't overwrite with manual BOMs
    if (origin !== "manual" || !this._hasOriginal) {
      if (origin !== "manual") {
        const map = {};
        for (const item of this.bomData.items) {
          map[item.key] = {
            unitCost: itemUnitCost(item),
            unitPrice: itemUnitPrice(item),
            recMarginPct: n(item.marginPct) * 100,
            category: item.category || "Hardware",
            unit: item.unit || "ea",
            extendedPrice: n(item.extendedPrice)
          };
        }
        this._originalItemsByKey = map;
        this._originalTotals = this.bomData.totals
          ? { ...this.bomData.totals }
          : null;
      }
    }
  }

  get tableRows() {
    if (!this.hasBom) return [];
    this._captureOriginalIfNeeded();
    const planBase = n(this.plannedMarginPct);

    return this.bomData.items.map((item) => {
      const key = item.key;
      const orig = this._originalItemsByKey[key];

      // Use original rec margin if available (survives recalculations)
      const recMarginPct = orig ? orig.recMarginPct : itemRecMarginPct(item);

      const hasEdit = key in this.editedMargins;
      const planMarginPct = hasEdit ? n(this.editedMargins[key]) : planBase;

      // Unit cost: prefer current item, fall back to original
      const unitCost = itemUnitCost(item) || (orig ? orig.unitCost : 0);
      const quantity = n(item.quantity);

      // Plan unit price from plan margin: price = cost / (1 - margin/100)
      const planUnitPrice =
        planMarginPct >= 100
          ? unitCost * 10
          : unitCost / (1 - planMarginPct / 100);
      const planExtPrice = planUnitPrice * quantity;

      // Rec extended price from original or current
      const recExtPrice = orig
        ? orig.extendedPrice
        : n(item.extendedPrice) || n(item.extendedCost);

      const delta = recMarginPct - planMarginPct;

      return {
        key,
        label: item.label || item.key,
        productNumber: item.productNumber || "",
        category: item.category || (orig ? orig.category : "Hardware"),
        categoryClass:
          CATEGORY_CLASSES[
            item.category || (orig ? orig.category : "Hardware")
          ] || CATEGORY_CLASSES.Hardware,
        unit: item.unit || (orig ? orig.unit : "ea"),
        quantity: this.formatQuantity(
          quantity,
          item.unit || (orig ? orig.unit : "ea")
        ),
        unitCostDisplay: formatCurrency(unitCost),
        planMarginPct: planMarginPct.toFixed(1),
        planMarginValue: hasEdit ? this.editedMargins[key] : "",
        planExtPriceDisplay: formatCurrency(planExtPrice),
        recMarginDisplay: formatPct(recMarginPct),
        recExtPriceDisplay: formatCurrency(recExtPrice),
        delta: (delta >= 0 ? "+" : "") + delta.toFixed(1) + "%",
        deltaClass:
          delta > 0.5
            ? "bom-delta bom-delta-pos"
            : delta < -0.5
              ? "bom-delta bom-delta-neg"
              : "bom-delta bom-delta-neutral",
        isEdited: hasEdit,
        inputClass: hasEdit
          ? "bom-margin-input bom-margin-input-edited"
          : "bom-margin-input",
        note: item.note || "",
        ariaLabel: "Plan margin for " + (item.label || item.key)
      };
    });
  }

  get totalCostDisplay() {
    return formatCurrency(this.bomData?.totals?.cost);
  }

  get totalPlanPrice() {
    if (!this.hasBom) return 0;
    const planBase = n(this.plannedMarginPct);
    let total = 0;
    for (const item of this.bomData.items) {
      const key = item.key;
      const hasEdit = key in this.editedMargins;
      const planMarginPct = hasEdit ? n(this.editedMargins[key]) : planBase;
      const orig = this._originalItemsByKey[key];
      const unitCost = itemUnitCost(item) || (orig ? orig.unitCost : 0);
      const quantity = n(item.quantity);
      const planUnitPrice =
        planMarginPct >= 100
          ? unitCost * 10
          : unitCost / (1 - planMarginPct / 100);
      total += planUnitPrice * quantity;
    }
    return total;
  }

  get totalPlanPriceDisplay() {
    return formatCurrency(this.totalPlanPrice);
  }

  get totalRecPriceDisplay() {
    // Use original totals if available
    const origTotals = this._hasOriginal ? this._originalTotals : null;
    const price = origTotals ? origTotals.price : this.bomData?.totals?.price;
    return formatCurrency(price);
  }

  get blendedPlanMarginDisplay() {
    if (!this.hasBom) return "0.0%";
    const totalCost = n(this.bomData?.totals?.cost);
    const totalPrice = this.totalPlanPrice;
    if (totalPrice <= 0) return "0.0%";
    const margin = ((totalPrice - totalCost) / totalPrice) * 100;
    return formatPct(margin);
  }

  get totalDelta() {
    const origTotals = this._hasOriginal ? this._originalTotals : null;
    const recPct = origTotals
      ? n(origTotals.marginPct) * 100
      : n(this.bomData?.totals?.marginPct) * 100;
    const totalCost = n(this.bomData?.totals?.cost);
    const totalPrice = this.totalPlanPrice;
    const planPct =
      totalPrice > 0 ? ((totalPrice - totalCost) / totalPrice) * 100 : 0;
    const d = recPct - planPct;
    return (d >= 0 ? "+" : "") + d.toFixed(1) + "%";
  }

  get totalDeltaClass() {
    const origTotals = this._hasOriginal ? this._originalTotals : null;
    const recPct = origTotals
      ? n(origTotals.marginPct) * 100
      : n(this.bomData?.totals?.marginPct) * 100;
    const totalCost = n(this.bomData?.totals?.cost);
    const totalPrice = this.totalPlanPrice;
    const planPct =
      totalPrice > 0 ? ((totalPrice - totalCost) / totalPrice) * 100 : 0;
    const d = recPct - planPct;
    return d > 0.5
      ? "bom-delta bom-delta-pos"
      : d < -0.5
        ? "bom-delta bom-delta-neg"
        : "bom-delta bom-delta-neutral";
  }

  // --- Handlers ---

  handleToggleCollapse() {
    this.isCollapsed = !this.isCollapsed;
  }

  handleHeaderKeydown(event) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      this.handleToggleCollapse();
    }
  }

  handleMarginChange(event) {
    const key = event.target.dataset.key;
    const val = parseFloat(event.target.value);
    if (key && !isNaN(val) && val >= 0 && val <= 70) {
      this.editedMargins = { ...this.editedMargins, [key]: val };
    }
  }

  handleClearEdits() {
    this.editedMargins = {};
  }

  handleReset() {
    this.editedMargins = {};
    // Reset original item cache so it re-captures from the restored generated BOM
    this._originalItemsByKey = {};
    this._originalTotals = null;
    // Tell parent to restore original recommendation (before BOM recalculations)
    this.dispatchEvent(new CustomEvent("bomreset"));
  }

  handleRecalculate() {
    if (!this.hasBom || this.isRecalculating) return;
    const planBase = n(this.plannedMarginPct);

    const bomLines = this.bomData.items.map((item) => {
      const key = item.key;
      const hasEdit = key in this.editedMargins;
      const marginPct = hasEdit ? n(this.editedMargins[key]) : planBase;
      const orig = this._originalItemsByKey[key];

      // Unit cost: handle both generated (unitCost) and manual (discountedPrice) formats
      const unitCost = itemUnitCost(item) || (orig ? orig.unitCost : 0);
      const unitPrice =
        marginPct >= 100 ? unitCost * 10 : unitCost / (1 - marginPct / 100);

      // Original rec margin to pass through for display after recalculation
      const origRecMarginPct = orig
        ? orig.recMarginPct
        : itemRecMarginPct(item);

      return {
        description: item.label || item.key,
        key: key,
        category: item.category || (orig ? orig.category : "Hardware"),
        unit: item.unit || (orig ? orig.unit : "ea"),
        productNumber: "",
        productId: "",
        vendor: "",
        listPrice: unitCost,
        discountedPrice: unitCost,
        priceAfterMargin: unitPrice,
        quantity: n(item.quantity),
        recommendedMarginPct: origRecMarginPct,
        note: item.note || ""
      };
    });

    this.dispatchEvent(
      new CustomEvent("bomrecalculate", {
        detail: { bomLines }
      })
    );
  }

  // --- Helpers ---

  formatQuantity(qty, unit) {
    if (
      unit === "hrs" ||
      unit === "sessions" ||
      unit === "weeks" ||
      unit === "mo" ||
      unit === "yr"
    ) {
      return Math.round(qty);
    }
    return qty % 1 === 0 ? qty : qty.toFixed(1);
  }
}
