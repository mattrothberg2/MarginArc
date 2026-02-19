/**
 * Apex controller for the MarginArc Margin Advisor LWC
 * Provides opportunity data and handles API interactions
 */
public with sharing class MarginArcController {
  // API configuration
  private static final String GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent';
  private static final String FALLBACK_API_URL = 'https://api.marginarc.com/api/recommend';

  /**
   * Get configuration from Custom Setting with defaults
   */
  private static Fulcrum_Config__c getConfig() {
    Fulcrum_Config__c cfg = Fulcrum_Config__c.getInstance();
    if (cfg == null) {
      cfg = new Fulcrum_Config__c();
    }
    return cfg;
  }

  /**
   * Proxy for MarginArc API calls — routes through Apex to bypass browser CSP/LWS restrictions
   */
  @AuraEnabled
  public static String callMarginArcApi(String payload) {
    MarginArcLicenseGate.assertActive();
    Fulcrum_Config__c cfg = getConfig();
    String apiUrl = String.isNotBlank(cfg.API_URL__c)
      ? cfg.API_URL__c
      : FALLBACK_API_URL;

    Http http = new Http();
    HttpRequest request = new HttpRequest();
    request.setEndpoint(apiUrl);
    request.setMethod('POST');
    request.setHeader('Content-Type', 'application/json');
    if (String.isNotBlank(cfg.API_Key__c)) {
      request.setHeader('x-api-key', cfg.API_Key__c);
    }
    request.setHeader('x-org-id', UserInfo.getOrganizationId());
    request.setTimeout(30000);
    request.setBody(payload);

    HttpResponse response = http.send(request);

    if (response.getStatusCode() == 200) {
      return response.getBody();
    } else {
      String errMsg =
        'MarginArc API error ' +
        response.getStatusCode() +
        ': ' +
        response.getBody();
      AuraHandledException ex = new AuraHandledException(errMsg);
      ex.setMessage(errMsg);
      throw ex;
    }
  }

  /**
   * Query all MarginArc_OEM__c records for LWC consumption.
   * Falls back to Name-only query if custom fields aren't deployed yet.
   */
  @AuraEnabled(cacheable=true)
  public static List<Fulcrum_OEM__c> getOemRecords() {
    try {
      return [
        SELECT
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
      // Custom fields may not exist yet; return Name-only records
      return [SELECT Name FROM Fulcrum_OEM__c ORDER BY Name];
    }
  }

  /**
   * Call Gemini API to generate AI explanation for margin recommendation
   */
  @AuraEnabled
  public static Map<String, String> generateAIExplanation(
    String oem,
    Decimal suggestedMarginPct,
    Decimal winProbability,
    String customerSegment,
    String competitors,
    String dealRegType,
    String solutionComplexity,
    Decimal oemCost,
    List<Map<String, Object>> drivers
  ) {
    MarginArcLicenseGate.assertActive();
    Map<String, String> result = new Map<String, String>();

    try {
      // Build drivers text
      String driversText = '';
      if (drivers != null && !drivers.isEmpty()) {
        List<String> driverStrings = new List<String>();
        for (Map<String, Object> driver : drivers) {
          String name = (String) driver.get('name');
          Decimal val = (Decimal) driver.get('val');
          if (val != null) {
            driverStrings.add(name + ': ' + (val * 100).setScale(1) + '%');
          }
        }
        driversText = String.join(driverStrings, '\n');
      }

      // Build explanation prompt
      String explanationPrompt =
        'You are a pricing assistant for a VAR (Value-Added Reseller). Summarize the quantitative logic behind this margin recommendation.\n\n' +
        'OEM: ' +
        oem +
        '\n' +
        'Recommended margin: ' +
        suggestedMarginPct.setScale(1) +
        '%\n' +
        'Win probability: ' +
        (winProbability * 100).setScale(0) +
        '%\n' +
        'Customer segment: ' +
        customerSegment +
        '\n' +
        'Competitors: ' +
        competitors +
        '\n' +
        'Deal registration: ' +
        dealRegType +
        '\n' +
        'Solution complexity: ' +
        solutionComplexity +
        '\n' +
        'OEM Cost: $' +
        oemCost.setScale(0) +
        '\n\n' +
        'Key drivers with their contribution deltas (% of margin):\n' +
        driversText +
        '\n\n' +
        'Produce a short (2-3 sentence) explanation in a friendly, professional tone, highlighting the most influential factors.';

      // Build qualitative prompt
      String qualitativePrompt =
        'You are crafting a qualitative rationale for an Account Executive at a VAR.\n\n' +
        'Deal context:\n' +
        '- OEM: ' +
        oem +
        '\n' +
        '- Segment: ' +
        customerSegment +
        '\n' +
        '- Competitors: ' +
        competitors +
        '\n' +
        '- Deal Registration: ' +
        dealRegType +
        '\n' +
        '- Solution Complexity: ' +
        solutionComplexity +
        '\n' +
        '- Recommended Margin: ' +
        suggestedMarginPct.setScale(1) +
        '%\n' +
        '- Win Probability: ' +
        (winProbability * 100).setScale(0) +
        '%\n\n' +
        'Write 3-4 sentences explaining why this margin recommendation makes business sense. ' +
        'Focus on win probability, competitive dynamics, and profitability trade-offs. Be specific about the OEM and competitors.';

      // Call Gemini for explanation
      String explanation = callGemini(explanationPrompt);
      result.put('explanation', explanation);

      // Call Gemini for qualitative summary
      String qualitative = callGemini(qualitativePrompt);
      result.put('qualitativeSummary', qualitative);
    } catch (Exception e) {
      System.debug('Gemini API error: ' + e.getMessage());
      result.put('error', e.getMessage());
    }

    return result;
  }

  /**
   * Call Gemini API with a prompt
   */
  private static String callGemini(String prompt) {
    Fulcrum_Config__c cfg = getConfig();
    String geminiKey = cfg.Gemini_API_Key__c;
    if (String.isBlank(geminiKey)) {
      return '';
    }

    Http http = new Http();
    HttpRequest request = new HttpRequest();
    request.setEndpoint(GEMINI_ENDPOINT);
    request.setMethod('POST');
    request.setHeader('Content-Type', 'application/json');
    request.setHeader('x-goog-api-key', geminiKey);
    request.setTimeout(30000);

    // Build request body
    Map<String, Object> requestBody = new Map<String, Object>{
      'contents' => new List<Object>{
        new Map<String, Object>{
          'role' => 'user',
          'parts' => new List<Object>{
            new Map<String, Object>{ 'text' => prompt }
          }
        }
      }
    };

    request.setBody(JSON.serialize(requestBody));

    HttpResponse response = http.send(request);

    if (response.getStatusCode() == 200) {
      Map<String, Object> responseBody = (Map<String, Object>) JSON.deserializeUntyped(
        response.getBody()
      );
      List<Object> candidates = (List<Object>) responseBody.get('candidates');
      if (candidates != null && !candidates.isEmpty()) {
        Map<String, Object> candidate = (Map<String, Object>) candidates[0];
        Map<String, Object> content = (Map<String, Object>) candidate.get(
          'content'
        );
        List<Object> parts = (List<Object>) content.get('parts');
        if (parts != null && !parts.isEmpty()) {
          Map<String, Object> part = (Map<String, Object>) parts[0];
          return (String) part.get('text');
        }
      }
    } else {
      System.debug(
        'Gemini API error: ' +
          response.getStatusCode() +
          ' - ' +
          response.getBody()
      );
    }

    return '';
  }

  /**
   * Get opportunity data formatted for MarginArc API
   * Falls back to standard fields if custom fields don't exist
   */
  @AuraEnabled(cacheable=true)
  public static Map<String, Object> getOpportunityData(Id opportunityId) {
    if (opportunityId == null) {
      return null;
    }

    // Query standard Opportunity fields
    Opportunity opp = [
      SELECT
        Id,
        Name,
        Amount,
        Probability,
        StageName,
        Account.Name,
        Account.Industry
      FROM Opportunity
      WHERE Id = :opportunityId
      WITH SECURITY_ENFORCED
      LIMIT 1
    ];

    // Build response with defaults for custom fields
    Map<String, Object> result = new Map<String, Object>{
      'name' => opp.Name,
      'amount' => opp.Amount != null ? opp.Amount : 10000,
      'probability' => opp.Probability != null ? opp.Probability : 50,
      'stageName' => opp.StageName,
      'accountName' => opp.Account != null ? opp.Account.Name : 'Unknown',
      'industry' => opp.Account != null &&
        opp.Account.Industry != null
        ? opp.Account.Industry
        : 'Technology',
      // Default values for MarginArc fields (will be overridden when custom fields exist)
      'oem' => 'Cisco',
      'oemCost' => opp.Amount != null ? opp.Amount * 0.85 : 10000,
      'plannedMargin' => 15,
      'customerSegment' => mapSegmentFromAmount(opp.Amount),
      'dealRegType' => 'Standard',
      'competitors' => '1',
      'solutionComplexity' => 'Medium',
      'relationshipStrength' => 'Good',
      'valueAdd' => 'Medium'
    };

    // Try to get custom MarginArc fields if they exist
    try {
      result = addCustomFieldsIfExist(opportunityId, result);
    } catch (Exception e) {
      // Custom fields don't exist yet, use defaults
      System.debug(
        'Custom fields not found, using defaults: ' + e.getMessage()
      );
    }

    return result;
  }

  /**
   * Try to query custom MarginArc fields
   */
  private static Map<String, Object> addCustomFieldsIfExist(
    Id opportunityId,
    Map<String, Object> result
  ) {
    // Check if custom fields exist by querying them
    String query = 'SELECT ';
    List<String> customFields = new List<String>{
      'Fulcrum_OEM__c',
      'Fulcrum_OEM_Cost__c',
      'Fulcrum_Planned_Margin__c',
      'Fulcrum_Customer_Segment__c',
      'Fulcrum_Deal_Reg_Type__c',
      'Fulcrum_Competitors__c',
      'Fulcrum_Solution_Complexity__c',
      'Fulcrum_Relationship_Strength__c',
      'Fulcrum_Value_Add__c',
      'Fulcrum_Competitor_Names__c',
      'Fulcrum_Cost__c',
      'Fulcrum_Revenue__c',
      'Fulcrum_GP_Percent__c',
      'Fulcrum_Services_Attached__c',
      'Fulcrum_Deal_Type__c',
      'Fulcrum_Quarter_End__c',
      'Fulcrum_Product_Category__c',
      'Fulcrum_Loss_Reason__c',
      'Fulcrum_Margin__c',
      'Fulcrum_AI_Confidence__c',
      'Fulcrum_Recommended_Margin__c',
      'Fulcrum_Win_Probability__c'
    };

    // Check which fields exist
    Map<String, Schema.SObjectField> fieldMap = Schema.SObjectType.Opportunity.fields.getMap();
    List<String> existingFields = new List<String>();

    for (String fieldName : customFields) {
      if (fieldMap.containsKey(fieldName.toLowerCase())) {
        existingFields.add(fieldName);
      }
    }

    if (existingFields.isEmpty()) {
      return result;
    }

    query +=
      String.join(existingFields, ', ') +
      ' FROM Opportunity WHERE Id = :opportunityId WITH SECURITY_ENFORCED LIMIT 1';

    Opportunity opp = Database.query(query);

    // Map custom field values
    if (
      existingFields.contains('Fulcrum_OEM__c') &&
      opp.get('Fulcrum_OEM__c') != null
    ) {
      result.put('oem', opp.get('Fulcrum_OEM__c'));
    }
    if (
      existingFields.contains('Fulcrum_OEM_Cost__c') &&
      opp.get('Fulcrum_OEM_Cost__c') != null
    ) {
      result.put('oemCost', opp.get('Fulcrum_OEM_Cost__c'));
    }
    if (
      existingFields.contains('Fulcrum_Planned_Margin__c') &&
      opp.get('Fulcrum_Planned_Margin__c') != null
    ) {
      result.put('plannedMargin', opp.get('Fulcrum_Planned_Margin__c'));
    }
    if (
      existingFields.contains('Fulcrum_Customer_Segment__c') &&
      opp.get('Fulcrum_Customer_Segment__c') != null
    ) {
      result.put('customerSegment', opp.get('Fulcrum_Customer_Segment__c'));
    }
    if (
      existingFields.contains('Fulcrum_Deal_Reg_Type__c') &&
      opp.get('Fulcrum_Deal_Reg_Type__c') != null
    ) {
      result.put('dealRegType', opp.get('Fulcrum_Deal_Reg_Type__c'));
    }
    if (
      existingFields.contains('Fulcrum_Competitors__c') &&
      opp.get('Fulcrum_Competitors__c') != null
    ) {
      result.put('competitors', opp.get('Fulcrum_Competitors__c'));
    }
    if (
      existingFields.contains('Fulcrum_Solution_Complexity__c') &&
      opp.get('Fulcrum_Solution_Complexity__c') != null
    ) {
      result.put(
        'solutionComplexity',
        opp.get('Fulcrum_Solution_Complexity__c')
      );
    }
    if (
      existingFields.contains('Fulcrum_Relationship_Strength__c') &&
      opp.get('Fulcrum_Relationship_Strength__c') != null
    ) {
      result.put(
        'relationshipStrength',
        opp.get('Fulcrum_Relationship_Strength__c')
      );
    }
    if (
      existingFields.contains('Fulcrum_Value_Add__c') &&
      opp.get('Fulcrum_Value_Add__c') != null
    ) {
      result.put('valueAdd', opp.get('Fulcrum_Value_Add__c'));
    }
    if (
      existingFields.contains('Fulcrum_Competitor_Names__c') &&
      opp.get('Fulcrum_Competitor_Names__c') != null
    ) {
      result.put('competitorNames', opp.get('Fulcrum_Competitor_Names__c'));
    }
    if (
      existingFields.contains('Fulcrum_Cost__c') &&
      opp.get('Fulcrum_Cost__c') != null
    ) {
      result.put('cost', opp.get('Fulcrum_Cost__c'));
    }
    if (
      existingFields.contains('Fulcrum_Revenue__c') &&
      opp.get('Fulcrum_Revenue__c') != null
    ) {
      result.put('revenue', opp.get('Fulcrum_Revenue__c'));
    }
    if (
      existingFields.contains('Fulcrum_GP_Percent__c') &&
      opp.get('Fulcrum_GP_Percent__c') != null
    ) {
      result.put('gpPercent', opp.get('Fulcrum_GP_Percent__c'));
    }
    if (
      existingFields.contains('Fulcrum_Services_Attached__c') &&
      opp.get('Fulcrum_Services_Attached__c') != null
    ) {
      result.put('servicesAttached', opp.get('Fulcrum_Services_Attached__c'));
    }
    if (
      existingFields.contains('Fulcrum_Deal_Type__c') &&
      opp.get('Fulcrum_Deal_Type__c') != null
    ) {
      result.put('dealType', opp.get('Fulcrum_Deal_Type__c'));
    }
    if (
      existingFields.contains('Fulcrum_Quarter_End__c') &&
      opp.get('Fulcrum_Quarter_End__c') != null
    ) {
      result.put('quarterEnd', opp.get('Fulcrum_Quarter_End__c'));
    }
    if (
      existingFields.contains('Fulcrum_Product_Category__c') &&
      opp.get('Fulcrum_Product_Category__c') != null
    ) {
      result.put('productCategory', opp.get('Fulcrum_Product_Category__c'));
    }
    if (
      existingFields.contains('Fulcrum_Loss_Reason__c') &&
      opp.get('Fulcrum_Loss_Reason__c') != null
    ) {
      result.put('lossReason', opp.get('Fulcrum_Loss_Reason__c'));
    }
    if (
      existingFields.contains('Fulcrum_Margin__c') &&
      opp.get('Fulcrum_Margin__c') != null
    ) {
      result.put('margin', opp.get('Fulcrum_Margin__c'));
    }
    if (
      existingFields.contains('Fulcrum_AI_Confidence__c') &&
      opp.get('Fulcrum_AI_Confidence__c') != null
    ) {
      result.put('aiConfidence', opp.get('Fulcrum_AI_Confidence__c'));
    }
    if (
      existingFields.contains('Fulcrum_Recommended_Margin__c') &&
      opp.get('Fulcrum_Recommended_Margin__c') != null
    ) {
      result.put('recommendedMargin', opp.get('Fulcrum_Recommended_Margin__c'));
    }
    if (
      existingFields.contains('Fulcrum_Win_Probability__c') &&
      opp.get('Fulcrum_Win_Probability__c') != null
    ) {
      result.put('winProbability', opp.get('Fulcrum_Win_Probability__c'));
    }

    return result;
  }

  /**
   * Save BOM line items for an Opportunity (replaces any existing lines)
   */
  @AuraEnabled
  public static void saveBomLines(Id opportunityId, String bomLinesJson) {
    // 1. Delete existing BOM lines for this opportunity
    List<Fulcrum_BOM_Line__c> existing = [
      SELECT Id
      FROM Fulcrum_BOM_Line__c
      WHERE Opportunity__c = :opportunityId
      WITH SECURITY_ENFORCED
    ];
    if (!existing.isEmpty()) {
      delete existing;
    }

    // 2. Parse JSON and insert new lines
    List<Object> lines = (List<Object>) JSON.deserializeUntyped(bomLinesJson);
    List<Fulcrum_BOM_Line__c> newLines = new List<Fulcrum_BOM_Line__c>();

    Integer sortOrder = 0;
    for (Object lineObj : lines) {
      Map<String, Object> line = (Map<String, Object>) lineObj;
      Fulcrum_BOM_Line__c bomLine = new Fulcrum_BOM_Line__c();
      bomLine.Opportunity__c = opportunityId;
      bomLine.Line_Key__c = (String) line.get('key');
      bomLine.Description__c = (String) line.get('label');
      bomLine.Category__c = (String) line.get('category');
      bomLine.Unit__c = (String) line.get('unit');
      bomLine.Quantity__c = toDecimal(line.get('quantity'));
      bomLine.Unit_Cost__c = toDecimal(line.get('unitCost'));
      bomLine.Unit_Price__c = toDecimal(line.get('unitPrice'));
      bomLine.List_Price__c = toDecimal(line.get('listPrice'));
      bomLine.Extended_Cost__c = toDecimal(line.get('extendedCost'));
      bomLine.Extended_Price__c = toDecimal(line.get('extendedPrice'));
      bomLine.Margin_Pct__c = toDecimal(line.get('marginPct')) * 100; // stored as %, API sends decimal
      bomLine.Recommended_Margin_Pct__c = line.get('recommendedMarginPct') !=
        null
        ? toDecimal(line.get('recommendedMarginPct')) * 100
        : null;
      bomLine.Product_Number__c = (String) line.get('productNumber');
      bomLine.Vendor__c = (String) line.get('vendor');
      bomLine.Note__c = (String) line.get('note');
      bomLine.Sort_Order__c = sortOrder++;
      bomLine.BOM_Origin__c = (String) line.get('origin');
      newLines.add(bomLine);
    }

    if (!newLines.isEmpty()) {
      SObjectAccessDecision decision = Security.stripInaccessible(
        AccessType.CREATABLE,
        newLines
      );
      insert decision.getRecords();
    }
  }

  /**
   * Get saved BOM line items for an Opportunity
   */
  @AuraEnabled(cacheable=true)
  public static List<Fulcrum_BOM_Line__c> getBomLines(Id opportunityId) {
    return [
      SELECT
        Id,
        Line_Key__c,
        Description__c,
        Category__c,
        Unit__c,
        Quantity__c,
        Unit_Cost__c,
        Unit_Price__c,
        List_Price__c,
        Extended_Cost__c,
        Extended_Price__c,
        Margin_Pct__c,
        Recommended_Margin_Pct__c,
        Product_Number__c,
        Vendor__c,
        Note__c,
        Sort_Order__c,
        BOM_Origin__c
      FROM Fulcrum_BOM_Line__c
      WHERE Opportunity__c = :opportunityId
      WITH SECURITY_ENFORCED
      ORDER BY Sort_Order__c ASC
    ];
  }

  /**
   * Safely convert an Object to Decimal
   */
  private static Decimal toDecimal(Object val) {
    if (val == null)
      return 0;
    if (val instanceof Decimal)
      return (Decimal) val;
    try {
      return Decimal.valueOf(String.valueOf(val));
    } catch (Exception e) {
      return 0;
    }
  }

  /**
   * Map customer segment based on deal amount
   */
  private static String mapSegmentFromAmount(Decimal amount) {
    if (amount == null)
      return 'MidMarket';
    if (amount >= 500000)
      return 'Enterprise';
    if (amount >= 100000)
      return 'MidMarket';
    return 'SMB';
  }

  /**
   * Log a recommendation history record for audit trail
   */
  @AuraEnabled
  public static Id logRecommendation(
    Id opportunityId,
    Decimal recommendedMargin,
    Decimal aiConfidence,
    Decimal winProbability,
    Decimal plannedMarginAtTime,
    String source,
    Boolean applied
  ) {
    Fulcrum_Recommendation_History__c rec = new Fulcrum_Recommendation_History__c(
      Opportunity__c = opportunityId,
      Recommended_Margin__c = recommendedMargin,
      AI_Confidence__c = aiConfidence,
      Win_Probability__c = winProbability,
      Planned_Margin_At_Time__c = plannedMarginAtTime,
      Source__c = source,
      Applied__c = applied != null ? applied : false,
      Recommendation_Date__c = DateTime.now()
    );
    SObjectAccessDecision decision = Security.stripInaccessible(
      AccessType.CREATABLE,
      new List<Fulcrum_Recommendation_History__c>{ rec }
    );
    insert decision.getRecords();
    return decision.getRecords()[0].Id;
  }

  // -------------------------------------------------------------------------
  // BOM Product Catalog API Methods
  // -------------------------------------------------------------------------

  private static final String FALLBACK_BOM_BASE = 'https://api.marginarc.com';

  /**
   * Derive the base URL for BOM API endpoints from config
   */
  private static String getBomBaseUrl() {
    Fulcrum_Config__c cfg = getConfig();
    if (String.isNotBlank(cfg.API_URL__c)) {
      // Strip /api/recommend to get base URL
      Integer idx = cfg.API_URL__c.indexOf('/api/');
      return idx > 0 ? cfg.API_URL__c.substring(0, idx) : FALLBACK_BOM_BASE;
    }
    return FALLBACK_BOM_BASE;
  }

  /**
   * Internal helper to call BOM API endpoints
   */
  private static String callBomApi(String path, String payload) {
    Fulcrum_Config__c cfg = getConfig();
    String endpoint = getBomBaseUrl() + '/api/bom' + path;

    Http http = new Http();
    HttpRequest request = new HttpRequest();
    request.setEndpoint(endpoint);
    request.setMethod('POST');
    request.setHeader('Content-Type', 'application/json');
    if (String.isNotBlank(cfg.API_Key__c)) {
      request.setHeader('x-api-key', cfg.API_Key__c);
    }
    request.setHeader('x-org-id', UserInfo.getOrganizationId());
    request.setTimeout(30000);
    request.setBody(payload);

    HttpResponse response = http.send(request);
    if (response.getStatusCode() == 200) {
      return response.getBody();
    } else {
      String errMsg =
        'BOM API error ' +
        response.getStatusCode() +
        ': ' +
        response.getBody();
      AuraHandledException ex = new AuraHandledException(errMsg);
      ex.setMessage(errMsg);
      throw ex;
    }
  }

  /**
   * Search the product catalog for BOM builder typeahead
   */
  @AuraEnabled
  public static String searchBomCatalog(
    String query,
    String manufacturer,
    String category
  ) {
    MarginArcLicenseGate.assertActive();
    Map<String, Object> body = new Map<String, Object>();
    if (String.isNotBlank(query))
      body.put('query', query);
    if (String.isNotBlank(manufacturer))
      body.put('manufacturer', manufacturer);
    if (String.isNotBlank(category))
      body.put('category', category);
    body.put('limit', 20);
    return callBomApi('/search', JSON.serialize(body));
  }

  /**
   * Analyze BOM lines for margin intelligence
   */
  @AuraEnabled
  public static String analyzeBom(String bomLinesJson, String contextJson) {
    MarginArcLicenseGate.assertActive();
    Map<String, Object> body = new Map<String, Object>();
    body.put('bomLines', JSON.deserializeUntyped(bomLinesJson));
    if (String.isNotBlank(contextJson)) {
      body.put('context', JSON.deserializeUntyped(contextJson));
    }
    return callBomApi('/analyze', JSON.serialize(body));
  }

  /**
   * Get recommendation history for an opportunity (most recent 10)
   */
  @AuraEnabled(cacheable=true)
  public static List<Map<String, Object>> getRecommendationHistory(
    Id opportunityId
  ) {
    List<Map<String, Object>> history = new List<Map<String, Object>>();
    for (Fulcrum_Recommendation_History__c rec : [
      SELECT
        Id,
        Recommended_Margin__c,
        AI_Confidence__c,
        Win_Probability__c,
        Planned_Margin_At_Time__c,
        Source__c,
        Applied__c,
        Recommendation_Date__c
      FROM Fulcrum_Recommendation_History__c
      WHERE Opportunity__c = :opportunityId
      ORDER BY Recommendation_Date__c DESC
      LIMIT 10
    ]) {
      Map<String, Object> entry = new Map<String, Object>();
      entry.put('id', rec.Id);
      entry.put('recommendedMargin', rec.Recommended_Margin__c);
      entry.put('aiConfidence', rec.AI_Confidence__c);
      entry.put('winProbability', rec.Win_Probability__c);
      entry.put('plannedMarginAtTime', rec.Planned_Margin_At_Time__c);
      entry.put('source', rec.Source__c);
      entry.put('applied', rec.Applied__c);
      entry.put('recommendationDate', rec.Recommendation_Date__c);
      history.add(entry);
    }
    return history;
  }
}
