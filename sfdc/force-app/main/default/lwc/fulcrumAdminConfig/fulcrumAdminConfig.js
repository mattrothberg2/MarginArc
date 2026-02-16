import { LightningElement, wire, track } from "lwc";
import { refreshApex } from "@salesforce/apex";
import { ShowToastEvent } from "lightning/platformShowToastEvent";
import getOemList from "@salesforce/apex/FulcrumAdminController.getOemList";
import saveOem from "@salesforce/apex/FulcrumAdminController.saveOem";
import deleteOem from "@salesforce/apex/FulcrumAdminController.deleteOem";
import getCompetitorList from "@salesforce/apex/FulcrumAdminController.getCompetitorList";
import saveCompetitor from "@salesforce/apex/FulcrumAdminController.saveCompetitor";
import deleteCompetitor from "@salesforce/apex/FulcrumAdminController.deleteCompetitor";
import getDataHealth from "@salesforce/apex/FulcrumAdminController.getDataHealth";
import getConnectionStatus from "@salesforce/apex/FulcrumAdminController.getConnectionStatus";
import activateLicense from "@salesforce/apex/FulcrumLicenseActivator.activateLicense";
import getLicenseStatus from "@salesforce/apex/FulcrumLicenseActivator.getLicenseStatus";
import validateLicenseNow from "@salesforce/apex/FulcrumLicenseValidator.validateLicenseNow";

function n(val) {
  return val == null ? 0 : Number(val);
}

export default class FulcrumAdminConfig extends LightningElement {
  // ── License Management ──
  @track licenseStatus = null;
  @track licenseKey = "";
  @track isActivating = false;
  @track isRevalidating = false;
  @track activationMessage = "";
  @track activationSuccess = false;

  // ── Connection Status ──
  @track connectionStatus = null;
  @track isTestingConnection = false;

  // ── Data Health ──
  @track healthData = null;
  @track isLoadingHealth = false;

  // ── OEM Management ──
  @track oemList = [];
  @track editingOemId = null;
  @track editingOem = {};
  @track isAddingOem = false;
  @track newOem = {
    Name: "",
    Base_Margin__c: 15,
    Deal_Reg_Margin_Boost__c: 3,
    Services_Margin_Boost__c: 2,
    Quarter_End_Discount__c: 5,
    Product_Category__c: ""
  };
  @track isSavingOem = false;

  // ── Competitor Management ──
  @track competitorList = [];
  @track editingCompId = null;
  @track editingComp = {};
  @track isAddingComp = false;
  @track newComp = {
    Name: "",
    Primary_Strength__c: "",
    Primary_OEMs__c: "",
    Description__c: ""
  };
  @track isSavingComp = false;

  // ── Delete confirmation ──
  @track pendingDeleteId = null;
  @track pendingDeleteType = null;
  @track pendingDeleteName = "";

  // Wired result refs for refreshApex
  _wiredOemResult;
  _wiredCompResult;

  // ── Wire adapters ──
  @wire(getOemList)
  wiredOems(result) {
    this._wiredOemResult = result;
    if (result.data) {
      this.oemList = result.data;
    } else if (result.error) {
      this.showError("Failed to load OEM list", result.error);
    }
  }

  @wire(getCompetitorList)
  wiredComps(result) {
    this._wiredCompResult = result;
    if (result.data) {
      this.competitorList = result.data;
    } else if (result.error) {
      this.showError("Failed to load competitor list", result.error);
    }
  }

  connectedCallback() {
    this.loadLicenseStatus();
    this.loadDataHealth();
    this.testConnection();
  }

  // ═══════════════════════════════════════════
  // LICENSE MANAGEMENT
  // ═══════════════════════════════════════════

  loadLicenseStatus() {
    getLicenseStatus()
      .then((data) => {
        this.licenseStatus = data;
      })
      .catch((error) => {
        console.error("Failed to load license status", error);
      });
  }

  get hasLicense() {
    return this.licenseStatus && this.licenseStatus.hasLicense === true;
  }

  get showLicenseActivation() {
    return (
      !this.hasLicense ||
      this.licenseStatus?.status === "pending" ||
      this.licenseStatus?.status === "expired"
    );
  }

  get licenseStatusText() {
    if (!this.licenseStatus) return "Unknown";
    return this.licenseStatus.status || "Unknown";
  }

  get licenseStatusBadgeClass() {
    const status = this.licenseStatus?.status;
    let cls = "license-status-badge";
    if (status === "active") cls += " license-badge-active";
    else if (status === "expired") cls += " license-badge-expired";
    else if (status === "revoked") cls += " license-badge-revoked";
    else cls += " license-badge-pending";
    return cls;
  }

  get expiryDateFormatted() {
    if (!this.licenseStatus || !this.licenseStatus.expiryDate) return "--";
    const date = new Date(this.licenseStatus.expiryDate);
    return date.toLocaleDateString();
  }

  get seatsLicensed() {
    return this.licenseStatus?.seatsLicensed || "--";
  }

  get lastValidatedFormatted() {
    if (!this.licenseStatus || !this.licenseStatus.lastValidated) return "--";
    const date = new Date(this.licenseStatus.lastValidated);
    return date.toLocaleDateString() + " " + date.toLocaleTimeString();
  }

  get showLicenseWarning() {
    if (!this.licenseStatus) return false;
    return (
      this.licenseStatus.status === "expired" ||
      this.licenseStatus.validationOverdue === true ||
      this.licenseStatus.isExpired === true
    );
  }

  get licenseWarningMessage() {
    if (!this.licenseStatus) return "";
    if (this.licenseStatus.status === "expired") {
      return "License is expired. Please contact MarginArc support to renew.";
    }
    if (this.licenseStatus.isExpired === true) {
      return "License expiration date has passed. Please renew your license.";
    }
    if (this.licenseStatus.validationOverdue === true) {
      const days = this.licenseStatus.daysSinceValidation || 0;
      return `License validation is overdue (${days} days since last check). Connection to mothership may be required.`;
    }
    return "";
  }

  get activationMessageClass() {
    return this.activationSuccess
      ? "activation-message activation-success"
      : "activation-message activation-error";
  }

  handleLicenseKeyChange(event) {
    this.licenseKey = event.target.value;
    this.activationMessage = "";
  }

  handleActivateLicense() {
    if (!this.licenseKey || !this.licenseKey.trim()) {
      this.activationMessage = "Please enter a license key";
      this.activationSuccess = false;
      return;
    }

    this.isActivating = true;
    this.activationMessage = "";

    activateLicense({ licenseKey: this.licenseKey.trim() })
      .then((result) => {
        if (result.success) {
          this.activationSuccess = true;
          this.activationMessage = result.message;
          this.showSuccess("License Activated", result.message);
          this.licenseKey = "";
          // Reload license status and connection status
          this.loadLicenseStatus();
          this.testConnection();
        } else {
          this.activationSuccess = false;
          this.activationMessage = result.message;
        }
      })
      .catch((error) => {
        this.activationSuccess = false;
        this.activationMessage =
          error.body?.message || error.message || "Failed to activate license";
        this.showError("Activation Failed", error);
      })
      .finally(() => {
        this.isActivating = false;
      });
  }

  handleRevalidateLicense() {
    this.isRevalidating = true;
    validateLicenseNow()
      .then((result) => {
        if (result.success) {
          this.showSuccess("Validation Started", result.message);
          // Wait a moment then reload status
          // eslint-disable-next-line @lwc/lwc/no-async-operation
          setTimeout(() => {
            this.loadLicenseStatus();
          }, 2000);
        } else {
          this.showError("Validation Failed", result.message);
        }
      })
      .catch((error) => {
        this.showError("Validation Error", error);
      })
      .finally(() => {
        this.isRevalidating = false;
      });
  }

  // ═══════════════════════════════════════════
  // CONNECTION STATUS
  // ═══════════════════════════════════════════

  testConnection() {
    this.isTestingConnection = true;
    getConnectionStatus()
      .then((data) => {
        this.connectionStatus = data;
      })
      .catch((error) => {
        this.connectionStatus = {
          configured: false,
          message:
            "Error checking connection: " +
            (error.body?.message || error.message || "Unknown error")
        };
      })
      .finally(() => {
        this.isTestingConnection = false;
      });
  }

  handleTestConnection() {
    this.testConnection();
  }

  get isConfigured() {
    return this.connectionStatus && this.connectionStatus.configured === true;
  }

  get apiUrlStatus() {
    if (!this.connectionStatus) return "unknown";
    return this.connectionStatus.hasApiUrl ? "connected" : "disconnected";
  }

  get apiKeyStatus() {
    if (!this.connectionStatus) return "unknown";
    return this.connectionStatus.hasApiKey ? "connected" : "disconnected";
  }

  get geminiKeyStatus() {
    if (!this.connectionStatus) return "unknown";
    return this.connectionStatus.hasGeminiKey ? "connected" : "disconnected";
  }

  get apiReachableStatus() {
    if (!this.connectionStatus) return "unknown";
    if (!this.connectionStatus.hasApiUrl) return "disconnected";
    return this.connectionStatus.apiReachable ? "connected" : "disconnected";
  }

  get apiUrlDotClass() {
    return "status-dot status-dot-" + this.apiUrlStatus;
  }

  get apiKeyDotClass() {
    return "status-dot status-dot-" + this.apiKeyStatus;
  }

  get geminiKeyDotClass() {
    return "status-dot status-dot-" + this.geminiKeyStatus;
  }

  get apiReachableDotClass() {
    return "status-dot status-dot-" + this.apiReachableStatus;
  }

  get connectionMessage() {
    if (!this.connectionStatus) return "";
    if (!this.connectionStatus.configured)
      return this.connectionStatus.message || "";
    return "";
  }

  // ═══════════════════════════════════════════
  // DATA HEALTH
  // ═══════════════════════════════════════════

  loadDataHealth() {
    this.isLoadingHealth = true;
    getDataHealth()
      .then((data) => {
        this.healthData = data;
      })
      .catch((error) => {
        this.showError("Failed to load data health", error);
      })
      .finally(() => {
        this.isLoadingHealth = false;
      });
  }

  handleRefreshHealth() {
    this.loadDataHealth();
  }

  get totalOpportunities() {
    return this.healthData ? n(this.healthData.totalOpportunities) : 0;
  }

  get hasHealthData() {
    return this.healthData && this.totalOpportunities > 0;
  }

  get healthFields() {
    if (!this.healthData || !this.healthData.fields) return [];
    return this.healthData.fields.map((f) => {
      const rate = n(f.rate);
      let barClass = "health-bar-fill";
      let statusClass = "health-status";
      if (rate >= 80) {
        barClass += " health-bar-good";
        statusClass += " health-good";
      } else if (rate >= 50) {
        barClass += " health-bar-warn";
        statusClass += " health-warn";
      } else {
        barClass += " health-bar-poor";
        statusClass += " health-poor";
      }
      return {
        fieldName: f.fieldName,
        label: f.label,
        filled: n(f.filled),
        total: n(f.total),
        rate: rate.toFixed(1),
        barStyle: "width: " + rate.toFixed(0) + "%",
        barClass,
        statusClass
      };
    });
  }

  get analyzedDeals() {
    return this.healthData ? n(this.healthData.analyzedDeals) : 0;
  }

  get analysisRate() {
    return this.healthData && this.healthData.analysisRate != null
      ? n(this.healthData.analysisRate).toFixed(1)
      : "0.0";
  }

  get analysisBarStyle() {
    return "width: " + this.analysisRate + "%";
  }

  get analysisBarClass() {
    const rate = n(this.analysisRate);
    let cls = "health-bar-fill";
    if (rate >= 80) cls += " health-bar-good";
    else if (rate >= 50) cls += " health-bar-warn";
    else cls += " health-bar-poor";
    return cls;
  }

  // ═══════════════════════════════════════════
  // OEM MANAGEMENT
  // ═══════════════════════════════════════════

  get hasOems() {
    return this.oemList.length > 0;
  }

  get oemCount() {
    return (
      this.oemList.length + " vendor" + (this.oemList.length !== 1 ? "s" : "")
    );
  }

  get oemRows() {
    return this.oemList.map((oem) => ({
      ...oem,
      isEditing: this.editingOemId === oem.Id,
      basePct:
        oem.Base_Margin__c != null
          ? n(oem.Base_Margin__c).toFixed(1) + "%"
          : "--",
      dealRegPct:
        oem.Deal_Reg_Margin_Boost__c != null
          ? "+" + n(oem.Deal_Reg_Margin_Boost__c).toFixed(1) + "%"
          : "--",
      servicesPct:
        oem.Services_Margin_Boost__c != null
          ? "+" + n(oem.Services_Margin_Boost__c).toFixed(1) + "%"
          : "--",
      qeDiscount:
        oem.Quarter_End_Discount__c != null
          ? n(oem.Quarter_End_Discount__c).toFixed(1) + "%"
          : "--",
      category: oem.Product_Category__c || "--"
    }));
  }

  handleAddOem() {
    this.isAddingOem = true;
    this.editingOemId = null;
    this.newOem = {
      Name: "",
      Base_Margin__c: 15,
      Deal_Reg_Margin_Boost__c: 3,
      Services_Margin_Boost__c: 2,
      Quarter_End_Discount__c: 5,
      Product_Category__c: ""
    };
  }

  handleEditOem(event) {
    const oemId = event.currentTarget.dataset.id;
    const oem = this.oemList.find((o) => o.Id === oemId);
    if (!oem) return;

    this.editingOemId = oemId;
    this.isAddingOem = false;
    this.editingOem = {
      Id: oem.Id,
      Name: oem.Name,
      Base_Margin__c: oem.Base_Margin__c,
      Deal_Reg_Margin_Boost__c: oem.Deal_Reg_Margin_Boost__c,
      Services_Margin_Boost__c: oem.Services_Margin_Boost__c,
      Quarter_End_Discount__c: oem.Quarter_End_Discount__c,
      Product_Category__c: oem.Product_Category__c
    };
  }

  handleCancelOemEdit() {
    this.editingOemId = null;
    this.isAddingOem = false;
  }

  handleNewOemChange(event) {
    const field = event.currentTarget.dataset.field;
    const value = event.currentTarget.value;
    this.newOem = {
      ...this.newOem,
      [field]:
        field === "Name" || field === "Product_Category__c"
          ? value
          : Number(value)
    };
  }

  handleEditOemChange(event) {
    const field = event.currentTarget.dataset.field;
    const value = event.currentTarget.value;
    this.editingOem = {
      ...this.editingOem,
      [field]:
        field === "Name" || field === "Product_Category__c"
          ? value
          : Number(value)
    };
  }

  handleSaveNewOem() {
    if (!this.newOem.Name || !this.newOem.Name.trim()) {
      this.showError("OEM name is required");
      return;
    }
    this.isSavingOem = true;
    const record = {
      Name: this.newOem.Name.trim(),
      Base_Margin__c: this.newOem.Base_Margin__c,
      Deal_Reg_Margin_Boost__c: this.newOem.Deal_Reg_Margin_Boost__c,
      Services_Margin_Boost__c: this.newOem.Services_Margin_Boost__c,
      Quarter_End_Discount__c: this.newOem.Quarter_End_Discount__c,
      Product_Category__c: this.newOem.Product_Category__c
    };
    saveOem({ oem: record })
      .then(() => {
        this.showSuccess("OEM vendor created successfully");
        this.isAddingOem = false;
        return refreshApex(this._wiredOemResult);
      })
      .catch((error) => {
        this.showError("Failed to save OEM", error);
      })
      .finally(() => {
        this.isSavingOem = false;
      });
  }

  handleSaveEditOem() {
    if (!this.editingOem.Name || !this.editingOem.Name.trim()) {
      this.showError("OEM name is required");
      return;
    }
    this.isSavingOem = true;
    saveOem({ oem: { ...this.editingOem } })
      .then(() => {
        this.showSuccess("OEM vendor updated successfully");
        this.editingOemId = null;
        return refreshApex(this._wiredOemResult);
      })
      .catch((error) => {
        this.showError("Failed to update OEM", error);
      })
      .finally(() => {
        this.isSavingOem = false;
      });
  }

  handleDeleteOem(event) {
    const oemId = event.currentTarget.dataset.id;
    const oem = this.oemList.find((o) => o.Id === oemId);
    this.pendingDeleteId = oemId;
    this.pendingDeleteType = "oem";
    this.pendingDeleteName = oem ? oem.Name : "this record";
  }

  // ═══════════════════════════════════════════
  // COMPETITOR MANAGEMENT
  // ═══════════════════════════════════════════

  get hasCompetitors() {
    return this.competitorList.length > 0;
  }

  get competitorCount() {
    return (
      this.competitorList.length +
      " competitor" +
      (this.competitorList.length !== 1 ? "s" : "")
    );
  }

  get competitorRows() {
    return this.competitorList.map((comp) => ({
      ...comp,
      isEditing: this.editingCompId === comp.Id,
      strengthDisplay: comp.Primary_Strength__c || "--",
      aggressionDisplay: comp.Price_Aggression__c || "--",
      servicesDisplay: comp.Services_Capability__c || "--",
      oemsDisplay: comp.Primary_OEMs__c || "--"
    }));
  }

  handleAddComp() {
    this.isAddingComp = true;
    this.editingCompId = null;
    this.newComp = {
      Name: "",
      Primary_Strength__c: "",
      Primary_OEMs__c: "",
      Price_Aggression__c: "",
      Services_Capability__c: "",
      Description__c: ""
    };
  }

  handleEditComp(event) {
    const compId = event.currentTarget.dataset.id;
    const comp = this.competitorList.find((c) => c.Id === compId);
    if (!comp) return;

    this.editingCompId = compId;
    this.isAddingComp = false;
    this.editingComp = {
      Id: comp.Id,
      Name: comp.Name,
      Primary_Strength__c: comp.Primary_Strength__c,
      Primary_OEMs__c: comp.Primary_OEMs__c,
      Price_Aggression__c: comp.Price_Aggression__c,
      Services_Capability__c: comp.Services_Capability__c,
      Description__c: comp.Description__c
    };
  }

  handleCancelCompEdit() {
    this.editingCompId = null;
    this.isAddingComp = false;
  }

  handleNewCompChange(event) {
    const field = event.currentTarget.dataset.field;
    this.newComp = { ...this.newComp, [field]: event.currentTarget.value };
  }

  handleEditCompChange(event) {
    const field = event.currentTarget.dataset.field;
    this.editingComp = {
      ...this.editingComp,
      [field]: event.currentTarget.value
    };
  }

  handleSaveNewComp() {
    if (!this.newComp.Name || !this.newComp.Name.trim()) {
      this.showError("Competitor name is required");
      return;
    }
    this.isSavingComp = true;
    const record = {
      Name: this.newComp.Name.trim(),
      Primary_Strength__c: this.newComp.Primary_Strength__c,
      Primary_OEMs__c: this.newComp.Primary_OEMs__c,
      Price_Aggression__c: this.newComp.Price_Aggression__c,
      Services_Capability__c: this.newComp.Services_Capability__c,
      Description__c: this.newComp.Description__c
    };
    saveCompetitor({ comp: record })
      .then(() => {
        this.showSuccess("Competitor created successfully");
        this.isAddingComp = false;
        return refreshApex(this._wiredCompResult);
      })
      .catch((error) => {
        this.showError("Failed to save competitor", error);
      })
      .finally(() => {
        this.isSavingComp = false;
      });
  }

  handleSaveEditComp() {
    if (!this.editingComp.Name || !this.editingComp.Name.trim()) {
      this.showError("Competitor name is required");
      return;
    }
    this.isSavingComp = true;
    saveCompetitor({ comp: { ...this.editingComp } })
      .then(() => {
        this.showSuccess("Competitor updated successfully");
        this.editingCompId = null;
        return refreshApex(this._wiredCompResult);
      })
      .catch((error) => {
        this.showError("Failed to update competitor", error);
      })
      .finally(() => {
        this.isSavingComp = false;
      });
  }

  handleDeleteComp(event) {
    const compId = event.currentTarget.dataset.id;
    const comp = this.competitorList.find((c) => c.Id === compId);
    this.pendingDeleteId = compId;
    this.pendingDeleteType = "comp";
    this.pendingDeleteName = comp ? comp.Name : "this record";
  }

  // ═══════════════════════════════════════════
  // DELETE CONFIRMATION
  // ═══════════════════════════════════════════

  get showDeleteConfirm() {
    return this.pendingDeleteId != null;
  }

  get deleteConfirmMessage() {
    return (
      'Are you sure you want to delete "' +
      this.pendingDeleteName +
      '"? This cannot be undone.'
    );
  }

  handleConfirmDelete() {
    const id = this.pendingDeleteId;
    const type = this.pendingDeleteType;
    this.pendingDeleteId = null;
    this.pendingDeleteType = null;
    this.pendingDeleteName = "";

    if (type === "oem") {
      deleteOem({ oemId: id })
        .then(() => {
          this.showSuccess("OEM vendor deleted");
          return refreshApex(this._wiredOemResult);
        })
        .catch((error) => {
          this.showError("Failed to delete OEM", error);
        });
    } else if (type === "comp") {
      deleteCompetitor({ compId: id })
        .then(() => {
          this.showSuccess("Competitor deleted");
          return refreshApex(this._wiredCompResult);
        })
        .catch((error) => {
          this.showError("Failed to delete competitor", error);
        });
    }
  }

  handleDeleteKeydown(event) {
    if (event.key === "Escape") this.handleCancelDelete();
  }

  handleCancelDelete() {
    this.pendingDeleteId = null;
    this.pendingDeleteType = null;
    this.pendingDeleteName = "";
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

  stopPropagation(event) {
    event.stopPropagation();
  }
}
