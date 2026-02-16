# SFDC API Names: Why They Say "Fulcrum"

## Background

MarginArc was originally named "Fulcrum.ai" and rebranded to "MarginArc" in February 2026. The Salesforce 2GP Unlocked Package was created under the original name, and **SFDC API names are immutable once deployed** — they cannot be renamed without recreating the object/field (which destroys all existing data).

## What This Means

All user-facing labels say "MarginArc", but the underlying API names still say "Fulcrum_". This is purely cosmetic — it has no impact on functionality.

## Complete List of Preserved API Names

### Custom Settings
| API Name | Label | Purpose |
|----------|-------|---------|
| `Fulcrum_Config__c` | MarginArc Config | API URL, API Key, Gemini Key |
| `Fulcrum_License__c` | MarginArc License | License key, status, expiry |

### Custom Objects
| API Name | Label |
|----------|-------|
| `Fulcrum_OEM__c` | MarginArc OEM |
| `Fulcrum_Competitor__c` | MarginArc Competitor |
| `Fulcrum_Recommendation_History__c` | MarginArc Recommendation History |
| `Fulcrum_Backfill_Result__c` | MarginArc Backfill Result |
| `Fulcrum_BOM_Line__c` | MarginArc BOM Line |

### Opportunity Custom Fields (22)
| API Name | Label |
|----------|-------|
| `Fulcrum_OEM__c` | OEM Vendor |
| `Fulcrum_OEM_Cost__c` | OEM Cost |
| `Fulcrum_Planned_Margin__c` | Planned Margin % |
| `Fulcrum_Recommended_Margin__c` | Recommended Margin % |
| `Fulcrum_AI_Confidence__c` | AI Confidence |
| `Fulcrum_Win_Probability__c` | Win Probability |
| `Fulcrum_Competitor_Names__c` | Competitor Names |
| `Fulcrum_Competitors__c` | Number of Competitors |
| `Fulcrum_Customer_Segment__c` | Customer Segment |
| `Fulcrum_Deal_Reg_Type__c` | Deal Registration Type |
| `Fulcrum_Product_Category__c` | Product Category |
| `Fulcrum_Solution_Complexity__c` | Solution Complexity |
| `Fulcrum_Relationship_Strength__c` | Relationship Strength |
| `Fulcrum_Value_Add__c` | Value Add Level |
| `Fulcrum_Services_Attached__c` | Services Attached |
| `Fulcrum_Quarter_End__c` | Quarter End Deal |
| `Fulcrum_Cost__c` | Cost |
| `Fulcrum_Margin__c` | Margin |
| `Fulcrum_Revenue__c` | Revenue |
| `Fulcrum_GP_Percent__c` | GP % |
| `Fulcrum_Deal_Type__c` | Deal Type |
| `Fulcrum_Loss_Reason__c` | Loss Reason |

### Permission Sets
| API Name | Label |
|----------|-------|
| `Fulcrum_Admin` | MarginArc Admin |
| `Fulcrum_Manager` | MarginArc Manager |
| `Fulcrum_User` | MarginArc User |

### Tabs
| API Name | Label |
|----------|-------|
| `Fulcrum_Admin` | MarginArc Setup |
| `Fulcrum_Getting_Started` | Getting Started |
| `Fulcrum_Manager_Dashboard` | MarginArc Dashboard |
| `Fulcrum_ROI_Report` | MarginArc ROI Report |

### Other
| Type | API Name | Label |
|------|----------|-------|
| Remote Site | `Fulcrum_API` | MarginArc API |
| Report Folder | `Fulcrum_Reports` | MarginArc Reports |
| License Key Prefix | `FULC-` | (format: FULC-XXXXXX-XXXX) |

## When Referencing in Code

- **Apex SOQL/DML**: Use `Fulcrum_*__c` (the API name)
- **LWC field imports**: Use `Fulcrum_*__c` (e.g., `import FIELD from '@salesforce/schema/Opportunity.Fulcrum_OEM__c'`)
- **Lambda deal ingestion**: Use `Fulcrum_*__c` field names when writing to Salesforce
- **User-facing strings**: Always say "MarginArc", never "Fulcrum"
