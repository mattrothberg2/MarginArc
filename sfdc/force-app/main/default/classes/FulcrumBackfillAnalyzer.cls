/**
 * Historical backfill batch job that retroactively scores closed-won deals
 * against the MarginArc Lambda API and generates ROI projection data.
 *
 * Purpose: Enables algorithm validation and sales conversation by comparing
 * what MarginArc WOULD have recommended vs what the rep actually did.
 *
 * Pattern: Database.Batchable + AllowsCallouts + Stateful
 * Batch size: 10 (same as FulcrumBatchAnalyzer, to stay within callout limits)
 *
 * Usage:
 *   // Default: last 24 months of closed-won deals
 *   Database.executeBatch(new FulcrumBackfillAnalyzer(), 10);
 *
 *   // Custom time range: last 12 months
 *   Database.executeBatch(new FulcrumBackfillAnalyzer(12), 10);
 */
public without sharing class FulcrumBackfillAnalyzer implements Database.Batchable<SObject>, Database.AllowsCallouts, Database.Stateful {
  // ── Configuration ──
  private static final String FALLBACK_API_URL = 'https://api.marginarc.com/api/recommend';
  @TestVisible
  private static final Integer BATCH_SIZE = 10;
  private static final Integer TIMEOUT_MS = 15000;

  // ── Instance state (persists across execute() calls via Stateful) ──
  private Integer monthsBack;
  @TestVisible
  private Integer totalDeals = 0;
  @TestVisible
  private Integer successCount = 0;
  @TestVisible
  private Integer errorCount = 0;
  @TestVisible
  private Decimal totalActualMargin = 0;
  @TestVisible
  private Decimal totalRecommendedMargin = 0;
  @TestVisible
  private Decimal totalMarginDelta = 0;
  @TestVisible
  private Decimal totalActualGP = 0;
  @TestVisible
  private Decimal totalRecommendedGP = 0;

  // ── Constructors ──
  public FulcrumBackfillAnalyzer() {
    this.monthsBack = 24;
  }

  public FulcrumBackfillAnalyzer(Integer monthsBack) {
    this.monthsBack = monthsBack;
  }

  /**
   * Get configuration from Custom Setting with defaults.
   * (Same pattern as FulcrumBatchAnalyzer)
   */
  private static Fulcrum_Config__c getConfig() {
    Fulcrum_Config__c cfg = Fulcrum_Config__c.getInstance();
    if (cfg == null) {
      cfg = new Fulcrum_Config__c();
    }
    return cfg;
  }

  // ── Batchable: start ──
  public Database.QueryLocator start(Database.BatchableContext bc) {
    Date cutoffDate = Date.today().addMonths(-this.monthsBack);

    String query =
      'SELECT Id, Name, Amount, StageName, CloseDate, Probability, ' +
      'Account.Name, Account.Industry, Owner.Name, ' +
      'Fulcrum_OEM__c, Fulcrum_OEM_Cost__c, Fulcrum_Planned_Margin__c, ' +
      'Fulcrum_Customer_Segment__c, Fulcrum_Deal_Reg_Type__c, ' +
      'Fulcrum_Competitors__c, Fulcrum_Competitor_Names__c, ' +
      'Fulcrum_Solution_Complexity__c, Fulcrum_Relationship_Strength__c, ' +
      'Fulcrum_Value_Add__c, Fulcrum_Services_Attached__c, ' +
      'Fulcrum_Quarter_End__c, Fulcrum_Product_Category__c, ' +
      'Fulcrum_Recommended_Margin__c, Fulcrum_GP_Percent__c ' +
      'FROM Opportunity ' +
      'WHERE IsClosed = true AND IsWon = true AND CloseDate >= :cutoffDate ' +
      'ORDER BY Amount DESC NULLS LAST';

    return Database.getQueryLocator(query);
  }

  // ── Batchable: execute ──
  public void execute(Database.BatchableContext bc, List<Opportunity> scope) {
    List<Fulcrum_Backfill_Result__c> results = new List<Fulcrum_Backfill_Result__c>();

    for (Opportunity opp : scope) {
      totalDeals++;

      try {
        // Determine actual margin the rep achieved
        Decimal actualMargin = deriveActualMargin(opp);
        if (actualMargin == null) {
          errorCount++;
          System.debug(
            LoggingLevel.WARN,
            'FulcrumBackfillAnalyzer: Skipping Opp ' +
              opp.Id +
              ' (' +
              opp.Name +
              '): unable to determine actual margin'
          );
          continue;
        }

        // Build payload and call the API
        String payload = buildPayload(opp, actualMargin);
        Map<String, Object> apiResult = callApi(payload);

        if (apiResult == null) {
          errorCount++;
          continue;
        }

        Object marginObj = apiResult.get('suggestedMarginPct');
        if (marginObj == null) {
          errorCount++;
          continue;
        }

        Decimal recommendedMargin = toDecimal(marginObj);
        Decimal confidence = toDecimal(apiResult.get('confidence'));
        Decimal winProbability = toDecimal(apiResult.get('winProbability'));

        // Calculate GP comparison
        Decimal dealAmount = opp.Amount != null ? opp.Amount : 0;
        Decimal actualGP = dealAmount * (actualMargin / 100);
        Decimal recommendedGP = dealAmount * (recommendedMargin / 100);
        Decimal marginDelta = recommendedMargin - actualMargin;
        Decimal gpDelta = recommendedGP - actualGP;

        // Derive OEM for the result record
        String oem = opp.Fulcrum_OEM__c;
        if (String.isBlank(oem)) {
          oem = deriveOemFromName(opp.Name);
        }

        // Build backfill result record
        Fulcrum_Backfill_Result__c result = new Fulcrum_Backfill_Result__c(
          Opportunity__c = opp.Id,
          Actual_Margin__c = actualMargin,
          Recommended_Margin__c = recommendedMargin,
          Margin_Delta__c = marginDelta,
          Actual_GP__c = actualGP,
          Recommended_GP__c = recommendedGP,
          GP_Delta__c = gpDelta,
          Win_Probability__c = winProbability != null
            ? winProbability * 100
            : null,
          Confidence__c = confidence != null ? confidence * 100 : null,
          OEM__c = oem,
          Close_Date__c = opp.CloseDate,
          Analysis_Date__c = DateTime.now(),
          Rep_Name__c = opp.Owner != null ? opp.Owner.Name : null
        );

        results.add(result);

        // Accumulate stateful summary stats
        successCount++;
        totalActualMargin += actualMargin;
        totalRecommendedMargin += recommendedMargin;
        totalMarginDelta += marginDelta;
        totalActualGP += actualGP;
        totalRecommendedGP += recommendedGP;
      } catch (Exception e) {
        errorCount++;
        System.debug(
          LoggingLevel.ERROR,
          'FulcrumBackfillAnalyzer: Error processing Opp ' +
            opp.Id +
            ' (' +
            opp.Name +
            '): ' +
            e.getMessage()
        );
      }
    }

    // Insert backfill result records
    if (!results.isEmpty()) {
      List<Database.SaveResult> saveResults = Database.insert(results, false);
      for (Integer i = 0; i < saveResults.size(); i++) {
        if (!saveResults[i].isSuccess()) {
          System.debug(
            LoggingLevel.ERROR,
            'FulcrumBackfillAnalyzer: DML failed for result on Opp ' +
              results[i].Opportunity__c +
              ': ' +
              saveResults[i].getErrors()[0].getMessage()
          );
        }
      }
    }
  }

  // ── Batchable: finish ──
  public void finish(Database.BatchableContext bc) {
    Decimal avgMarginDelta = successCount > 0
      ? totalMarginDelta / successCount
      : 0;
    Decimal totalGPOpportunity = totalRecommendedGP - totalActualGP;

    System.debug(
      LoggingLevel.INFO,
      'FulcrumBackfillAnalyzer complete: ' +
        successCount +
        ' scored, ' +
        errorCount +
        ' failed, ' +
        totalDeals +
        ' total. ' +
        'Avg Margin Delta: ' +
        avgMarginDelta.setScale(2) +
        'pp. ' +
        'Total GP Opportunity: $' +
        totalGPOpportunity.setScale(2) +
        '. ' +
        'Months Back: ' +
        monthsBack
    );
  }

  // ────────────────────────────────────────────────
  // Actual Margin Derivation
  // ────────────────────────────────────────────────

  /**
   * Determine the actual margin the rep achieved on the closed-won deal.
   * Priority:
   *   1. Fulcrum_Planned_Margin__c (if set, this is the rep's planned margin)
   *   2. Fulcrum_GP_Percent__c (actual GP percent if captured)
   *   3. Derive from Amount and Fulcrum_OEM_Cost__c
   *   4. Return null if we can't determine it
   */
  @TestVisible
  private static Decimal deriveActualMargin(Opportunity opp) {
    if (opp.Fulcrum_Planned_Margin__c != null) {
      return opp.Fulcrum_Planned_Margin__c;
    }
    if (opp.Fulcrum_GP_Percent__c != null) {
      return opp.Fulcrum_GP_Percent__c;
    }
    if (
      opp.Amount != null &&
      opp.Amount > 0 &&
      opp.Fulcrum_OEM_Cost__c != null &&
      opp.Fulcrum_OEM_Cost__c > 0
    ) {
      return ((opp.Amount - opp.Fulcrum_OEM_Cost__c) / opp.Amount) * 100;
    }
    return null;
  }

  // ────────────────────────────────────────────────
  // API Callout (same pattern as FulcrumBatchAnalyzer)
  // ────────────────────────────────────────────────

  @TestVisible
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
          'FulcrumBackfillAnalyzer: API returned ' +
            response.getStatusCode() +
            ': ' +
            response.getBody()
        );
        return null;
      }
    } catch (Exception e) {
      System.debug(
        LoggingLevel.ERROR,
        'FulcrumBackfillAnalyzer: Callout failed: ' + e.getMessage()
      );
      return null;
    }
  }

  // ────────────────────────────────────────────────
  // Payload Builder (reuses same field mapping as FulcrumBatchAnalyzer)
  // ────────────────────────────────────────────────

  @TestVisible
  private static String buildPayload(Opportunity opp, Decimal actualMargin) {
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

    // OEM Cost
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

    // Outer wrapper — use the actual margin as the planned margin
    Map<String, Object> body = new Map<String, Object>();
    body.put('input', input);
    body.put('plannedMarginPct', actualMargin);

    return JSON.serialize(body);
  }

  // ────────────────────────────────────────────────
  // Field Mapping Methods
  // (Same as FulcrumBatchAnalyzer — duplicated to avoid cross-class dependencies)
  // ────────────────────────────────────────────────

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
