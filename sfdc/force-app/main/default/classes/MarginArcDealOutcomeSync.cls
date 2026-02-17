/**
 * Weekly batch that sends closed deal outcomes (Won/Lost) to the MarginArc
 * Lambda API so the kNN algorithm can learn from real results.
 *
 * Schedule: Runs every Sunday at 3 AM via Schedulable interface.
 * Endpoint: POST /api/deals
 *
 * This is fire-and-forget — no Opportunity fields are updated.
 */
public without sharing class MarginArcDealOutcomeSync implements Database.Batchable<SObject>, Database.AllowsCallouts, Database.Stateful, Schedulable {
  // ── Configuration ──
  private static final String FALLBACK_API_URL = 'https://api.marginarc.com/api/deals';
  @TestVisible
  static final Integer BATCH_SIZE = 10;
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

  // ── Instance state (persists across execute() calls via Database.Stateful) ──
  @TestVisible
  private Integer totalSynced = 0;
  @TestVisible
  private Integer totalFailed = 0;

  // ── Schedulable ──
  public void execute(SchedulableContext sc) {
    Database.executeBatch(new MarginArcDealOutcomeSync(), BATCH_SIZE);
  }

  // ── Batchable: start ──
  public Database.QueryLocator start(Database.BatchableContext bc) {
    String query =
      'SELECT Id, Name, Amount, CloseDate, IsWon, ' +
      'Account.Name, Account.Industry, ' +
      'Fulcrum_OEM__c, Fulcrum_OEM_Cost__c, Fulcrum_Planned_Margin__c, ' +
      'Fulcrum_Customer_Segment__c, Fulcrum_Deal_Reg_Type__c, ' +
      'Fulcrum_Competitors__c, Fulcrum_Competitor_Names__c, ' +
      'Fulcrum_Solution_Complexity__c, Fulcrum_Relationship_Strength__c, ' +
      'Fulcrum_Value_Add__c, Fulcrum_Services_Attached__c, ' +
      'Fulcrum_Quarter_End__c, Fulcrum_Product_Category__c, ' +
      'Fulcrum_GP_Percent__c, Fulcrum_Margin__c, ' +
      'Fulcrum_Loss_Reason__c, Fulcrum_Deal_Type__c ' +
      'FROM Opportunity ' +
      'WHERE IsClosed = true AND CloseDate = LAST_N_DAYS:7 ' +
      'ORDER BY CloseDate DESC';
    return Database.getQueryLocator(query);
  }

  // ── Batchable: execute ──
  public void execute(Database.BatchableContext bc, List<Opportunity> scope) {
    if (!MarginArcLicenseGate.isActive()) {
      System.debug(
        LoggingLevel.WARN,
        'MarginArc license not active, skipping deal outcome sync'
      );
      return;
    }

    for (Opportunity opp : scope) {
      try {
        String payload = buildOutcomePayload(opp);
        Boolean success = callDealsApi(payload);
        if (success) {
          totalSynced++;
        } else {
          totalFailed++;
        }
      } catch (Exception e) {
        totalFailed++;
        System.debug(
          LoggingLevel.ERROR,
          'MarginArcDealOutcomeSync: Error processing Opp ' +
            opp.Id +
            ' (' +
            opp.Name +
            '): ' +
            e.getMessage()
        );
      }
    }
  }

  // ── Batchable: finish ──
  public void finish(Database.BatchableContext bc) {
    System.debug(
      LoggingLevel.INFO,
      'MarginArcDealOutcomeSync complete: ' +
        totalSynced +
        ' synced, ' +
        totalFailed +
        ' failed.'
    );
  }

  // ────────────────────────────────────────────────
  // API Callout
  // ────────────────────────────────────────────────

  @TestVisible
  private static Boolean callDealsApi(String payload) {
    try {
      Fulcrum_Config__c cfg = getConfig();
      String apiUrl = deriveDealsUrl(cfg);

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
        return true;
      } else {
        System.debug(
          LoggingLevel.WARN,
          'MarginArcDealOutcomeSync: API returned ' +
            response.getStatusCode() +
            ': ' +
            response.getBody()
        );
        return false;
      }
    } catch (Exception e) {
      System.debug(
        LoggingLevel.ERROR,
        'MarginArcDealOutcomeSync: Callout failed: ' + e.getMessage()
      );
      return false;
    }
  }

  /**
   * Derive /api/deals URL from config (which stores /api/recommend).
   */
  @TestVisible
  private static String deriveDealsUrl(Fulcrum_Config__c cfg) {
    if (String.isNotBlank(cfg.API_URL__c)) {
      Integer idx = cfg.API_URL__c.indexOf('/api/');
      if (idx > 0) {
        return cfg.API_URL__c.substring(0, idx) + '/api/deals';
      }
    }
    return FALLBACK_API_URL;
  }

  // ────────────────────────────────────────────────
  // Payload Builder
  // ────────────────────────────────────────────────

  /**
   * Builds JSON matching the Lambda DealRecord Zod schema:
   * { input: DealInput, achievedMarginPct, status, lossReason? }
   */
  @TestVisible
  private static String buildOutcomePayload(Opportunity opp) {
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

    // OEM Cost (required by Lambda, must be positive)
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

    // Deal type
    if (String.isNotBlank(opp.Fulcrum_Deal_Type__c)) {
      input.put('dealType', opp.Fulcrum_Deal_Type__c);
    }

    // === Outcome-specific fields ===

    String status = opp.IsWon ? 'Won' : 'Lost';
    Decimal achievedMarginPct = deriveAchievedMargin(opp);

    // Outer DealRecord wrapper
    Map<String, Object> body = new Map<String, Object>();
    body.put('input', input);
    body.put('achievedMarginPct', achievedMarginPct);
    body.put('status', status);

    // Loss reason only for Lost deals
    if (!opp.IsWon && String.isNotBlank(opp.Fulcrum_Loss_Reason__c)) {
      body.put('lossReason', opp.Fulcrum_Loss_Reason__c);
    }

    return JSON.serialize(body);
  }

  // ────────────────────────────────────────────────
  // Achieved Margin Derivation
  // ────────────────────────────────────────────────

  /**
   * Derives the achieved margin percentage (0-100) using a priority chain:
   * 1. Fulcrum_GP_Percent__c (actual GP %)
   * 2. Fulcrum_Planned_Margin__c (rep target)
   * 3. Fulcrum_Margin__c / Amount * 100 (dollar margin derived)
   * 4. (Amount - OEM_Cost) / Amount * 100 (cost-based derivation)
   * 5. Default 15
   */
  @TestVisible
  private static Decimal deriveAchievedMargin(Opportunity opp) {
    if (opp.Fulcrum_GP_Percent__c != null) {
      return opp.Fulcrum_GP_Percent__c;
    }
    if (opp.Fulcrum_Planned_Margin__c != null) {
      return opp.Fulcrum_Planned_Margin__c;
    }
    if (opp.Fulcrum_Margin__c != null && opp.Amount != null && opp.Amount > 0) {
      return (opp.Fulcrum_Margin__c / opp.Amount) * 100;
    }
    if (
      opp.Amount != null &&
      opp.Amount > 0 &&
      opp.Fulcrum_OEM_Cost__c != null &&
      opp.Fulcrum_OEM_Cost__c > 0
    ) {
      return ((opp.Amount - opp.Fulcrum_OEM_Cost__c) / opp.Amount) * 100;
    }
    return 15;
  }

  // ────────────────────────────────────────────────
  // Field Mapping Methods
  // (Duplicated from MarginArcBatchAnalyzer to avoid cross-class dependencies)
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

  // Check if a short keyword appears as a standalone word
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
}
