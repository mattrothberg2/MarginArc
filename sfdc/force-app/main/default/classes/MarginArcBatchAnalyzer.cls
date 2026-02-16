/**
 * Nightly batch analyzer that calls the MarginArc Lambda API to populate
 * margin recommendations on open Opportunity records.
 *
 * Schedule: Runs nightly at 2 AM via Schedulable interface.
 *   - Mon-Sat: Incremental (only changed/new deals)
 *   - Sunday: Full refresh (all open deals)
 *
 * Writes: Fulcrum_Recommended_Margin__c, Fulcrum_AI_Confidence__c,
 *         Fulcrum_Win_Probability__c
 * Does NOT touch: Amount, Fulcrum_Planned_Margin__c, or other rep-set fields.
 */
public without sharing class MarginArcBatchAnalyzer implements Database.Batchable<SObject>, Database.AllowsCallouts, Schedulable {
  // ── Configuration ──
  private static final String FALLBACK_API_URL = 'https://api.marginarc.com/api/recommend';
  @TestVisible
  private static final Integer BATCH_SIZE = 10;
  private static final Integer TIMEOUT_MS = 15000;

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

  // ── Instance state (persists across execute() calls) ──
  private Boolean fullRefresh;
  @TestVisible
  private Integer totalAnalyzed = 0;
  @TestVisible
  private Integer totalFailed = 0;

  // ── Constructors ──
  public MarginArcBatchAnalyzer() {
    this.fullRefresh = false;
  }
  public MarginArcBatchAnalyzer(Boolean fullRefresh) {
    this.fullRefresh = fullRefresh;
  }

  // ── Schedulable ──
  public void execute(SchedulableContext sc) {
    // Sunday = day 7 in ISO week numbering (DateTime.format('u'))
    Boolean isSunday = (DateTime.now().format('u') == '7');
    Database.executeBatch(new MarginArcBatchAnalyzer(isSunday), BATCH_SIZE);
  }

  // ── Batchable: start ──
  public Database.QueryLocator start(Database.BatchableContext bc) {
    String query =
      'SELECT Id, Name, Amount, Account.Name, Account.Industry, ' +
      'Fulcrum_OEM__c, Fulcrum_OEM_Cost__c, Fulcrum_Planned_Margin__c, ' +
      'Fulcrum_Customer_Segment__c, Fulcrum_Deal_Reg_Type__c, ' +
      'Fulcrum_Competitors__c, Fulcrum_Competitor_Names__c, ' +
      'Fulcrum_Solution_Complexity__c, Fulcrum_Relationship_Strength__c, ' +
      'Fulcrum_Value_Add__c, Fulcrum_Services_Attached__c, ' +
      'Fulcrum_Quarter_End__c, Fulcrum_Product_Category__c, ' +
      'Fulcrum_Recommended_Margin__c ' +
      'FROM Opportunity WHERE IsClosed = false';

    if (!fullRefresh) {
      query += ' AND Fulcrum_Recommended_Margin__c = null';
    }

    query += ' ORDER BY Amount DESC NULLS LAST';
    return Database.getQueryLocator(query);
  }

  // ── Batchable: execute ──
  public void execute(Database.BatchableContext bc, List<Opportunity> scope) {
    if (!MarginArcLicenseGate.isActive()) {
      System.debug(
        LoggingLevel.WARN,
        'MarginArc license not active, skipping batch analysis'
      );
      return;
    }

    List<Opportunity> toUpdate = new List<Opportunity>();

    for (Opportunity opp : scope) {
      try {
        String payload = buildPayload(opp);
        Map<String, Object> apiResult = callApi(payload);

        if (apiResult == null) {
          totalFailed++;
          continue;
        }

        Object marginObj = apiResult.get('suggestedMarginPct');
        if (marginObj == null) {
          totalFailed++;
          continue;
        }

        Decimal suggestedMarginPct = toDecimal(marginObj);
        Decimal confidence = toDecimal(apiResult.get('confidence'));
        Decimal winProbability = toDecimal(apiResult.get('winProbability'));

        // Write ONLY recommendation fields
        opp.Fulcrum_Recommended_Margin__c = suggestedMarginPct;
        opp.Fulcrum_AI_Confidence__c = confidence != null
          ? confidence * 100
          : null;
        opp.Fulcrum_Win_Probability__c = winProbability != null
          ? winProbability * 100
          : null;

        toUpdate.add(opp);
        totalAnalyzed++;
      } catch (Exception e) {
        totalFailed++;
        System.debug(
          LoggingLevel.ERROR,
          'MarginArcBatchAnalyzer: Error processing Opp ' +
            opp.Id +
            ' (' +
            opp.Name +
            '): ' +
            e.getMessage()
        );
      }
    }

    if (!toUpdate.isEmpty()) {
      List<Database.SaveResult> results = Database.update(toUpdate, false);
      for (Integer i = 0; i < results.size(); i++) {
        if (!results[i].isSuccess()) {
          totalFailed++;
          totalAnalyzed--;
          System.debug(
            LoggingLevel.ERROR,
            'MarginArcBatchAnalyzer: DML failed for Opp ' +
              toUpdate[i].Id +
              ': ' +
              results[i].getErrors()[0].getMessage()
          );
        }
      }

      // Log recommendation history for successfully updated records
      List<Fulcrum_Recommendation_History__c> historyRecords = new List<Fulcrum_Recommendation_History__c>();
      for (Integer i = 0; i < results.size(); i++) {
        if (results[i].isSuccess()) {
          Opportunity opp = toUpdate[i];
          historyRecords.add(
            new Fulcrum_Recommendation_History__c(
              Opportunity__c = opp.Id,
              Recommended_Margin__c = opp.Fulcrum_Recommended_Margin__c,
              AI_Confidence__c = opp.Fulcrum_AI_Confidence__c,
              Win_Probability__c = opp.Fulcrum_Win_Probability__c,
              Planned_Margin_At_Time__c = opp.Fulcrum_Planned_Margin__c,
              Source__c = 'Batch',
              Applied__c = false,
              Recommendation_Date__c = DateTime.now()
            )
          );
        }
      }
      if (!historyRecords.isEmpty()) {
        Database.insert(historyRecords, false);
      }
    }
  }

  // ── Batchable: finish ──
  public void finish(Database.BatchableContext bc) {
    System.debug(
      LoggingLevel.INFO,
      'MarginArcBatchAnalyzer complete: ' +
        totalAnalyzed +
        ' analyzed, ' +
        totalFailed +
        ' failed. Mode: ' +
        (fullRefresh ? 'FULL REFRESH' : 'INCREMENTAL')
    );
  }

  // ────────────────────────────────────────────────
  // API Callout
  // ────────────────────────────────────────────────

  private static Map<String, Object> callApi(String payload) {
    try {
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
      request.setTimeout(TIMEOUT_MS);
      request.setBody(payload);

      HttpResponse response = http.send(request);

      if (response.getStatusCode() == 200) {
        return (Map<String, Object>) JSON.deserializeUntyped(
          response.getBody()
        );
      } else {
        System.debug(
          LoggingLevel.WARN,
          'MarginArcBatchAnalyzer: API returned ' +
            response.getStatusCode() +
            ': ' +
            response.getBody()
        );
        return null;
      }
    } catch (Exception e) {
      System.debug(
        LoggingLevel.ERROR,
        'MarginArcBatchAnalyzer: Callout failed: ' + e.getMessage()
      );
      return null;
    }
  }

  // ────────────────────────────────────────────────
  // Payload Builder
  // ────────────────────────────────────────────────

  @TestVisible
  private static String buildPayload(Opportunity opp) {
    Map<String, Object> input = new Map<String, Object>();

    // OEM
    String oem = opp.Fulcrum_OEM__c;
    if (String.isBlank(oem)) {
      oem = deriveOemFromName(opp.Name);
    }
    if (String.isBlank(oem)) {
      oem = 'Cisco';
    }
    input.put('oem', oem);

    // OEM Cost (required by Lambda)
    Decimal oemCost = opp.Fulcrum_OEM_Cost__c;
    if (oemCost == null || oemCost <= 0) {
      oemCost = (opp.Amount != null &&
        opp.Amount > 0)
        ? opp.Amount * 0.85
        : 10000;
    }
    input.put('oemCost', oemCost);

    // Customer Segment
    input.put('customerSegment', mapCustomerSegment(opp));

    // Deal Reg Type
    input.put('dealRegType', mapDealRegType(opp.Fulcrum_Deal_Reg_Type__c));

    // Competitors
    String competitors = opp.Fulcrum_Competitors__c;
    if (String.isBlank(competitors)) {
      competitors = deriveCompetitorCount(opp.Fulcrum_Competitor_Names__c);
    }
    input.put('competitors', competitors);

    // Competitor Names
    List<String> competitorNames = new List<String>();
    if (String.isNotBlank(opp.Fulcrum_Competitor_Names__c)) {
      for (String name : opp.Fulcrum_Competitor_Names__c.split(';')) {
        if (String.isNotBlank(name.trim())) {
          competitorNames.add(name.trim());
        }
      }
    }
    input.put('competitorNames', competitorNames);

    // Product Category
    input.put(
      'productCategory',
      mapProductCategory(opp.Fulcrum_Product_Category__c)
    );

    // Direct picklist mappings
    input.put(
      'solutionComplexity',
      safePicklist(opp.Fulcrum_Solution_Complexity__c, 'Medium')
    );
    input.put(
      'relationshipStrength',
      mapRelationshipStrength(opp.Fulcrum_Relationship_Strength__c)
    );
    input.put('valueAdd', safePicklist(opp.Fulcrum_Value_Add__c, 'Medium'));

    // Industry
    String industry = (opp.Account != null &&
      opp.Account.Industry != null)
      ? opp.Account.Industry
      : 'Technology';
    input.put('customerIndustry', mapIndustry(industry));

    // Fixed defaults
    input.put('customerTechSophistication', 'Medium');
    input.put('varStrategicImportance', 'Medium');

    // Boolean fields
    input.put('servicesAttached', opp.Fulcrum_Services_Attached__c == true);
    input.put('quarterEnd', opp.Fulcrum_Quarter_End__c == true);

    // Deal size + account name
    input.put('dealSize', opp.Amount != null ? opp.Amount : 0);
    input.put('accountName', opp.Account != null ? opp.Account.Name : null);

    // Planned margin for comparison metrics
    Decimal plannedMargin = opp.Fulcrum_Planned_Margin__c;
    if (plannedMargin == null) {
      plannedMargin = 15;
    }

    // Outer wrapper
    Map<String, Object> body = new Map<String, Object>();
    body.put('input', input);
    body.put('plannedMarginPct', plannedMargin);

    return JSON.serialize(body);
  }

  // ────────────────────────────────────────────────
  // Field Mapping Methods
  // (Ported from marginarcMarginAdvisor.js:1069-1133, 224-284)
  // ────────────────────────────────────────────────

  // Industry: SF Account.Industry → Lambda customerIndustry
  private static final Map<String, String> INDUSTRY_MAP = new Map<String, String>{
    'Technology' => 'Technology',
    'Financial Services' => 'Financial Services',
    'Life Sciences & Healthcare' => 'Life Sciences & Healthcare',
    'Manufacturing & Automotive' => 'Manufacturing & Automotive',
    'Retail' => 'Retail',
    'Energy' => 'Energy',
    'Media & Telecommunications' => 'Media & Telecommunications',
    'Consumer Goods & Food' => 'Consumer Goods & Food',
    'Transportation & Logistics' => 'Transportation & Logistics',
    'Diversified Conglomerates' => 'Diversified Conglomerates',
    'Finance' => 'Financial Services',
    'Banking' => 'Financial Services',
    'Insurance' => 'Financial Services',
    'Healthcare' => 'Life Sciences & Healthcare',
    'Biotechnology' => 'Life Sciences & Healthcare',
    'Manufacturing' => 'Manufacturing & Automotive',
    'Machinery' => 'Manufacturing & Automotive',
    'Electronics' => 'Manufacturing & Automotive',
    'Education' => 'Technology',
    'Government' => 'Technology',
    'Consulting' => 'Technology',
    'Media' => 'Media & Telecommunications',
    'Communications' => 'Media & Telecommunications',
    'Telecommunications' => 'Media & Telecommunications',
    'Entertainment' => 'Media & Telecommunications',
    'Food & Beverage' => 'Consumer Goods & Food',
    'Apparel' => 'Consumer Goods & Food',
    'Consumer Goods' => 'Consumer Goods & Food',
    'Transportation' => 'Transportation & Logistics',
    'Shipping' => 'Transportation & Logistics',
    'Utilities' => 'Energy',
    'Construction' => 'Manufacturing & Automotive'
  };

  @TestVisible
  private static String mapIndustry(String industry) {
    return INDUSTRY_MAP.containsKey(industry)
      ? INDUSTRY_MAP.get(industry)
      : 'Technology';
  }

  // Product Category: SF picklist → Lambda enum
  private static final Map<String, String> PRODUCT_CATEGORY_MAP = new Map<String, String>{
    'Networking' => 'Hardware',
    'Security' => 'Hardware',
    'Compute' => 'Hardware',
    'Storage' => 'Hardware',
    'Collaboration' => 'Hardware',
    'DataCenter' => 'Hardware',
    'Cloud' => 'Cloud',
    'Software' => 'Software',
    'Services' => 'ProfessionalServices'
  };

  @TestVisible
  private static String mapProductCategory(String category) {
    if (String.isBlank(category))
      return 'Hardware';
    return PRODUCT_CATEGORY_MAP.containsKey(category)
      ? PRODUCT_CATEGORY_MAP.get(category)
      : 'Hardware';
  }

  // Customer Segment: 3 valid Lambda values + amount-based fallback
  @TestVisible
  private static String mapCustomerSegment(Opportunity opp) {
    String segment = opp.Fulcrum_Customer_Segment__c;
    if (segment == 'Enterprise' || segment == 'SMB' || segment == 'MidMarket') {
      return segment;
    }
    if (opp.Amount == null)
      return 'MidMarket';
    if (opp.Amount >= 300000)
      return 'Enterprise';
    if (opp.Amount >= 100000)
      return 'MidMarket';
    return 'SMB';
  }

  // Deal Reg Type: map to Lambda enum
  @TestVisible
  private static String mapDealRegType(String dealReg) {
    if (
      dealReg == 'StandardApproved' ||
      dealReg == 'PremiumHunting' ||
      dealReg == 'NotRegistered' ||
      dealReg == 'Teaming'
    ) {
      return dealReg;
    }
    return 'StandardApproved';
  }

  // Relationship Strength: map to Lambda enum
  @TestVisible
  private static String mapRelationshipStrength(String rel) {
    if (rel == 'New' || rel == 'Good' || rel == 'Strategic')
      return rel;
    return 'Good';
  }

  // Check if a short keyword appears as a standalone word (not embedded in another word)
  private static Boolean containsWord(String text, String word) {
    Integer idx = text.indexOf(word);
    while (idx >= 0) {
      Boolean leftOk = (idx == 0 || !text.substring(idx - 1, idx).isAlpha());
      Integer endIdx = idx + word.length();
      Boolean rightOk = (endIdx >= text.length() ||
      !text.substring(endIdx, endIdx + 1).isAlpha());
      if (leftOk && rightOk)
        return true;
      idx = text.indexOf(word, idx + 1);
    }
    return false;
  }

  // OEM name derivation from Opportunity name
  @TestVisible
  private static String deriveOemFromName(String name) {
    if (String.isBlank(name))
      return null;
    String lower = name.toLowerCase();
    if (
      lower.contains('palo alto') ||
      lower.contains('paloalto') ||
      lower.contains('pan-')
    )
      return 'Palo Alto';
    if (
      lower.contains('pure storage') ||
      lower.contains('purestorage') ||
      lower.contains('flasharray') ||
      lower.contains('flashblade')
    )
      return 'Pure Storage';
    if (
      lower.contains('crowdstrike') ||
      lower.contains('crowd strike') ||
      containsWord(lower, 'falcon')
    )
      return 'CrowdStrike';
    if (lower.contains('nutanix') || containsWord(lower, 'hci'))
      return 'Nutanix';
    if (
      lower.contains('cisco') ||
      lower.contains('meraki') ||
      lower.contains('webex')
    )
      return 'Cisco';
    if (
      lower.contains('hpe') ||
      lower.contains('hewlett') ||
      lower.contains('aruba') ||
      lower.contains('proliant')
    )
      return 'HPE';
    if (
      lower.contains('dell') ||
      lower.contains('emc') ||
      lower.contains('poweredge') ||
      lower.contains('vxrail')
    )
      return 'Dell';
    if (lower.contains('fortinet') || lower.contains('fortigate'))
      return 'Fortinet';
    if (
      lower.contains('vmware') ||
      lower.contains('vsphere') ||
      lower.contains('vsan')
    )
      return 'VMware';
    if (
      lower.contains('microsoft') ||
      lower.contains('azure') ||
      lower.contains('m365') ||
      lower.contains('office 365')
    )
      return 'Microsoft';
    if (lower.contains('netapp') || lower.contains('ontap'))
      return 'NetApp';
    if (lower.contains('arista') || containsWord(lower, 'eos'))
      return 'Arista';
    return null;
  }

  // Competitor count from multi-select picklist
  @TestVisible
  private static String deriveCompetitorCount(String competitorNames) {
    if (String.isBlank(competitorNames))
      return '1';
    Integer count = 0;
    for (String name : competitorNames.split(';')) {
      if (String.isNotBlank(name.trim()))
        count++;
    }
    if (count == 0)
      return '0';
    if (count == 1)
      return '1';
    if (count == 2)
      return '2';
    return '3+';
  }

  // ── Utility ──

  private static String safePicklist(String value, String defaultValue) {
    return String.isNotBlank(value) ? value : defaultValue;
  }

  private static Decimal toDecimal(Object val) {
    if (val == null)
      return null;
    if (val instanceof Decimal)
      return (Decimal) val;
    if (val instanceof Double)
      return Decimal.valueOf((Double) val);
    if (val instanceof Integer)
      return Decimal.valueOf((Integer) val);
    if (val instanceof Long)
      return Decimal.valueOf((Long) val);
    return null;
  }
}
