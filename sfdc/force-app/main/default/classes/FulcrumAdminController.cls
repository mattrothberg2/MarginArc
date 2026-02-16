public with sharing class FulcrumAdminController {
  /**
   * Get all OEM records for the admin table
   */
  @AuraEnabled(cacheable=true)
  public static List<Fulcrum_OEM__c> getOemList() {
    try {
      return [
        SELECT
          Id,
          Name,
          Base_Margin__c,
          Deal_Reg_Margin_Boost__c,
          Product_Category__c,
          Quarter_End_Discount__c,
          Services_Margin_Boost__c
        FROM Fulcrum_OEM__c
        WITH SECURITY_ENFORCED
        ORDER BY Name
      ];
    } catch (Exception e) {
      return [
        SELECT Id, Name
        FROM Fulcrum_OEM__c
        WITH SECURITY_ENFORCED
        ORDER BY Name
      ];
    }
  }

  /**
   * Save an OEM record (insert or update)
   */
  @AuraEnabled
  public static Fulcrum_OEM__c saveOem(Fulcrum_OEM__c oem) {
    SObjectAccessDecision decision = Security.stripInaccessible(
      AccessType.UPSERTABLE,
      new List<Fulcrum_OEM__c>{ oem }
    );
    upsert decision.getRecords();
    return (Fulcrum_OEM__c) decision.getRecords()[0];
  }

  /**
   * Delete an OEM record
   */
  @AuraEnabled
  public static void deleteOem(Id oemId) {
    delete [
      SELECT Id
      FROM Fulcrum_OEM__c
      WHERE Id = :oemId
      WITH SECURITY_ENFORCED
    ];
  }

  /**
   * Get all Competitor records
   */
  @AuraEnabled(cacheable=true)
  public static List<Fulcrum_Competitor__c> getCompetitorList() {
    try {
      return [
        SELECT
          Id,
          Name,
          Primary_Strength__c,
          Price_Aggression__c,
          Services_Capability__c,
          Primary_OEMs__c,
          How_To_Win__c,
          Typical_Discount__c,
          Description__c,
          Margin_Aggression__c
        FROM Fulcrum_Competitor__c
        WITH SECURITY_ENFORCED
        ORDER BY Name
      ];
    } catch (Exception e) {
      return [
        SELECT Id, Name
        FROM Fulcrum_Competitor__c
        WITH SECURITY_ENFORCED
        ORDER BY Name
      ];
    }
  }

  /**
   * Save a Competitor record (insert or update)
   */
  @AuraEnabled
  public static Fulcrum_Competitor__c saveCompetitor(
    Fulcrum_Competitor__c comp
  ) {
    SObjectAccessDecision decision = Security.stripInaccessible(
      AccessType.UPSERTABLE,
      new List<Fulcrum_Competitor__c>{ comp }
    );
    upsert decision.getRecords();
    return (Fulcrum_Competitor__c) decision.getRecords()[0];
  }

  /**
   * Delete a Competitor record
   */
  @AuraEnabled
  public static void deleteCompetitor(Id compId) {
    delete [
      SELECT Id
      FROM Fulcrum_Competitor__c
      WHERE Id = :compId
      WITH SECURITY_ENFORCED
    ];
  }

  /**
   * Get data health metrics - field fill rates across Opportunity
   */
  @AuraEnabled
  public static Map<String, Object> getDataHealth() {
    Map<String, Object> health = new Map<String, Object>();

    // Total open opportunities
    Integer totalOpps = [
      SELECT COUNT()
      FROM Opportunity
      WHERE IsClosed = FALSE
      WITH SECURITY_ENFORCED
    ];
    health.put('totalOpportunities', totalOpps);

    if (totalOpps == 0) {
      return health;
    }

    // Check field fill rates for the 5 most important MarginArc fields
    Map<String, Schema.SObjectField> fieldMap = Schema.SObjectType.Opportunity.fields.getMap();

    List<Map<String, Object>> fieldHealth = new List<Map<String, Object>>();
    List<String> fieldsToCheck = new List<String>{
      'Fulcrum_OEM__c',
      'Fulcrum_OEM_Cost__c',
      'Fulcrum_Customer_Segment__c',
      'Fulcrum_Deal_Reg_Type__c',
      'Fulcrum_Competitor_Names__c'
    };

    Map<String, String> fieldLabels = new Map<String, String>{
      'Fulcrum_OEM__c' => 'OEM Vendor',
      'Fulcrum_OEM_Cost__c' => 'OEM Cost',
      'Fulcrum_Customer_Segment__c' => 'Customer Segment',
      'Fulcrum_Deal_Reg_Type__c' => 'Deal Registration',
      'Fulcrum_Competitor_Names__c' => 'Competitors'
    };

    for (String fieldName : fieldsToCheck) {
      if (fieldMap.containsKey(fieldName.toLowerCase())) {
        String countQuery =
          'SELECT COUNT() FROM Opportunity WHERE IsClosed = false AND ' +
          fieldName +
          ' != null WITH SECURITY_ENFORCED';
        Integer filled = Database.countQuery(countQuery);
        Decimal rate = totalOpps > 0
          ? (Decimal.valueOf(filled) / Decimal.valueOf(totalOpps)) * 100
          : 0;

        fieldHealth.add(
          new Map<String, Object>{
            'fieldName' => fieldName,
            'label' => fieldLabels.get(fieldName),
            'filled' => filled,
            'total' => totalOpps,
            'rate' => rate.setScale(1)
          }
        );
      }
    }

    health.put('fields', fieldHealth);

    // Count analyzed deals (have recommendation)
    if (fieldMap.containsKey('fulcrum_recommended_margin__c')) {
      Integer analyzed = Database.countQuery(
        'SELECT COUNT() FROM Opportunity WHERE IsClosed = false AND Fulcrum_Recommended_Margin__c != null WITH SECURITY_ENFORCED'
      );
      health.put('analyzedDeals', analyzed);
      Decimal analysisRate = totalOpps > 0
        ? (Decimal.valueOf(analyzed) / Decimal.valueOf(totalOpps)) * 100
        : 0;
      health.put('analysisRate', analysisRate.setScale(1));
    }

    return health;
  }

  /**
   * Get API connection status
   */
  @AuraEnabled
  public static Map<String, Object> getConnectionStatus() {
    Map<String, Object> status = new Map<String, Object>();

    Fulcrum_Config__c cfg = Fulcrum_Config__c.getInstance();
    if (cfg == null) {
      status.put('configured', false);
      status.put(
        'message',
        'No MarginArc Config found. Create an org-default Custom Setting record.'
      );
      return status;
    }

    status.put('configured', true);
    status.put('hasApiUrl', String.isNotBlank(cfg.API_URL__c));
    status.put('hasApiKey', String.isNotBlank(cfg.API_Key__c));
    status.put('hasGeminiKey', String.isNotBlank(cfg.Gemini_API_Key__c));

    // Test API connection
    if (String.isNotBlank(cfg.API_URL__c)) {
      try {
        Http http = new Http();
        HttpRequest req = new HttpRequest();
        // Use health endpoint (strip /api/recommend and use /health)
        String baseUrl = cfg.API_URL__c.replace('/api/recommend', '');
        req.setEndpoint(baseUrl + '/health');
        req.setMethod('GET');
        req.setTimeout(10000);
        HttpResponse res = http.send(req);
        status.put('apiReachable', res.getStatusCode() == 200);
        status.put('apiStatus', res.getStatusCode());
      } catch (Exception e) {
        status.put('apiReachable', false);
        status.put('apiError', e.getMessage());
      }
    }

    return status;
  }
}
