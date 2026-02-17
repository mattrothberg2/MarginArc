/**
 * Demo data loader for MarginArc.
 * Optionally populates a new installation with sample Accounts, Opportunities,
 * OEM vendors, and Competitor profiles so users can explore the product
 * immediately after install.
 *
 * Idempotent: checks for the sentinel Account "Acme Technologies (Demo)"
 * before inserting anything.
 */
public with sharing class MarginArcDemoDataLoader {
  @AuraEnabled
  public static Map<String, Object> loadDemoData() {
    Map<String, Object> result = new Map<String, Object>();

    // Idempotency check
    List<Account> existing = [
      SELECT Id
      FROM Account
      WHERE Name = 'Acme Technologies (Demo)'
      LIMIT 1
    ];
    if (!existing.isEmpty()) {
      result.put('success', true);
      result.put('alreadyLoaded', true);
      result.put('message', 'Demo data has already been loaded.');
      return result;
    }

    try {
      // 1. Insert OEM Vendors
      List<Fulcrum_OEM__c> oems = createOemRecords();
      SObjectAccessDecision oemDecision = Security.stripInaccessible(
        AccessType.CREATABLE,
        oems
      );
      insert oemDecision.getRecords();

      // 2. Insert Competitor Profiles
      List<Fulcrum_Competitor__c> competitors = createCompetitorRecords();
      SObjectAccessDecision compDecision = Security.stripInaccessible(
        AccessType.CREATABLE,
        competitors
      );
      insert compDecision.getRecords();

      // 3. Insert Accounts
      List<Account> accounts = createAccountRecords();
      SObjectAccessDecision acctDecision = Security.stripInaccessible(
        AccessType.CREATABLE,
        accounts
      );
      insert acctDecision.getRecords();
      List<Account> insertedAccounts = (List<Account>) acctDecision.getRecords();

      // Build account map by name for opportunity assignment
      Map<String, Id> accountMap = new Map<String, Id>();
      for (Account a : insertedAccounts) {
        accountMap.put(a.Name, a.Id);
      }

      // 4. Insert Opportunities
      List<Opportunity> opps = createOpportunityRecords(accountMap);
      SObjectAccessDecision oppDecision = Security.stripInaccessible(
        AccessType.CREATABLE,
        opps
      );
      insert oppDecision.getRecords();

      result.put('success', true);
      result.put('alreadyLoaded', false);
      result.put('accounts', insertedAccounts.size());
      result.put('opportunities', oppDecision.getRecords().size());
      result.put('oems', oemDecision.getRecords().size());
      result.put('competitors', compDecision.getRecords().size());
      result.put('message', 'Demo data loaded successfully.');
    } catch (Exception e) {
      result.put('success', false);
      result.put('message', 'Error loading demo data: ' + e.getMessage());
    }

    return result;
  }

  // ────────────────────────────────────────────────
  // Scenario-Based Demo Data (calls Lambda)
  // ────────────────────────────────────────────────

  @AuraEnabled
  public static Map<String, Object> loadScenarioData(
    String scenario,
    Integer dealCount
  ) {
    Map<String, Object> result = new Map<String, Object>();

    // Idempotency check — look for any demo accounts
    List<Account> existing = [
      SELECT Id
      FROM Account
      WHERE Name LIKE '%(Demo)%'
      LIMIT 1
    ];
    if (!existing.isEmpty()) {
      result.put('success', true);
      result.put('alreadyLoaded', true);
      result.put('message', 'Demo data has already been loaded. Clear it first before loading a new scenario.');
      return result;
    }

    // Validate inputs
    Set<String> validScenarios = new Set<String>{
      'networking-var',
      'security-var',
      'cloud-var',
      'full-stack-var',
      'services-heavy-var'
    };
    if (String.isBlank(scenario) || !validScenarios.contains(scenario)) {
      result.put('success', false);
      result.put('message', 'Invalid scenario: ' + scenario);
      return result;
    }
    if (dealCount == null || (dealCount != 100 && dealCount != 250 && dealCount != 500)) {
      dealCount = 250;
    }

    try {
      // Read API config from custom setting
      Fulcrum_Config__c config = Fulcrum_Config__c.getOrgDefaults();
      String apiUrl = config.API_URL__c;
      String apiKey = config.API_Key__c;

      if (String.isBlank(apiUrl)) {
        result.put('success', false);
        result.put('message', 'API URL not configured. Set it in MarginArc Config custom setting.');
        return result;
      }

      // Call Lambda to get scenario data
      String endpoint =
        apiUrl +
        '/api/demo-data?scenario=' +
        EncodingUtil.urlEncode(scenario, 'UTF-8') +
        '&count=' +
        dealCount;

      HttpRequest req = new HttpRequest();
      req.setEndpoint(endpoint);
      req.setMethod('GET');
      req.setTimeout(60000);
      if (String.isNotBlank(apiKey)) {
        req.setHeader('x-api-key', apiKey);
      }
      req.setHeader('Accept', 'application/json');

      Http http = new Http();
      HttpResponse resp = http.send(req);

      if (resp.getStatusCode() != 200) {
        result.put('success', false);
        result.put(
          'message',
          'Lambda returned status ' +
            resp.getStatusCode() +
            ': ' +
            resp.getBody().left(200)
        );
        return result;
      }

      Map<String, Object> payload = (Map<String, Object>) JSON.deserializeUntyped(
        resp.getBody()
      );

      if (payload.get('success') != true) {
        result.put('success', false);
        result.put(
          'message',
          'Lambda error: ' + String.valueOf(payload.get('error'))
        );
        return result;
      }

      List<Object> deals = (List<Object>) payload.get('deals');
      Integer uniqueAccounts = payload.containsKey('uniqueAccounts')
        ? ((Integer) payload.get('uniqueAccounts'))
        : 0;

      // Insert OEM Vendors
      List<Fulcrum_OEM__c> oems = createOemRecords();
      SObjectAccessDecision oemDecision = Security.stripInaccessible(
        AccessType.CREATABLE,
        oems
      );
      insert oemDecision.getRecords();

      // Insert Competitor Profiles
      List<Fulcrum_Competitor__c> competitors = createCompetitorRecords();
      SObjectAccessDecision compDecision = Security.stripInaccessible(
        AccessType.CREATABLE,
        competitors
      );
      insert compDecision.getRecords();

      // Enqueue the queueable chain for bulk deal + BOM line insertion
      String dealsJson = JSON.serialize(deals);
      Id jobId = System.enqueueJob(
        new MarginArcDemoDataQueueable(dealsJson, 0)
      );

      result.put('success', true);
      result.put('alreadyLoaded', false);
      result.put('scenario', scenario);
      result.put('opportunities', deals.size());
      result.put('accounts', uniqueAccounts);
      result.put('oems', oemDecision.getRecords().size());
      result.put('competitors', compDecision.getRecords().size());
      result.put('jobId', jobId);
      result.put(
        'message',
        'Loaded ' +
          deals.size() +
          ' opportunities across ' +
          uniqueAccounts +
          ' accounts. BOM lines are being generated in the background.'
      );
    } catch (Exception e) {
      result.put('success', false);
      result.put('message', 'Error loading scenario data: ' + e.getMessage());
    }

    return result;
  }

  // ────────────────────────────────────────────────
  // Clear Demo Data
  // ────────────────────────────────────────────────

  @AuraEnabled
  public static Map<String, Object> clearDemoData() {
    Map<String, Object> result = new Map<String, Object>();

    try {
      // 1. Find demo opportunities (via account naming convention)
      List<Opportunity> demoOpps = [
        SELECT Id
        FROM Opportunity
        WHERE Account.Name LIKE '%(Demo)%'
      ];
      Set<Id> oppIds = new Set<Id>();
      for (Opportunity o : demoOpps) {
        oppIds.add(o.Id);
      }

      // 2. Delete BOM lines linked to demo opportunities
      Integer bomCount = 0;
      if (!oppIds.isEmpty()) {
        List<Fulcrum_BOM_Line__c> bomLines = [
          SELECT Id
          FROM Fulcrum_BOM_Line__c
          WHERE Opportunity__c IN :oppIds
        ];
        bomCount = bomLines.size();
        if (!bomLines.isEmpty()) {
          delete bomLines;
        }
      }

      // 3. Delete demo opportunities
      Integer oppCount = demoOpps.size();
      if (!demoOpps.isEmpty()) {
        delete demoOpps;
      }

      // 4. Delete demo accounts
      List<Account> demoAccounts = [
        SELECT Id
        FROM Account
        WHERE Name LIKE '%(Demo)%'
      ];
      Integer acctCount = demoAccounts.size();
      if (!demoAccounts.isEmpty()) {
        delete demoAccounts;
      }

      // 5. Delete all OEM vendors
      List<Fulcrum_OEM__c> oems = [SELECT Id FROM Fulcrum_OEM__c];
      Integer oemCount = oems.size();
      if (!oems.isEmpty()) {
        delete oems;
      }

      // 6. Delete all competitor profiles
      List<Fulcrum_Competitor__c> comps = [
        SELECT Id
        FROM Fulcrum_Competitor__c
      ];
      Integer compCount = comps.size();
      if (!comps.isEmpty()) {
        delete comps;
      }

      result.put('success', true);
      result.put('accounts', acctCount);
      result.put('opportunities', oppCount);
      result.put('bomLines', bomCount);
      result.put('oems', oemCount);
      result.put('competitors', compCount);
      result.put(
        'message',
        'Cleared ' +
          oppCount +
          ' opportunities, ' +
          acctCount +
          ' accounts, ' +
          bomCount +
          ' BOM lines, ' +
          oemCount +
          ' OEM vendors, and ' +
          compCount +
          ' competitor profiles.'
      );
    } catch (Exception e) {
      result.put('success', false);
      result.put('message', 'Error clearing demo data: ' + e.getMessage());
    }

    return result;
  }

  // ────────────────────────────────────────────────
  // OEM Records (10)
  // ────────────────────────────────────────────────

  private static List<Fulcrum_OEM__c> createOemRecords() {
    return new List<Fulcrum_OEM__c>{
      newOem('Cisco', 16, 4, 3, 2, 'Networking'),
      newOem('Palo Alto', 20, 5, 4, 1, 'Security'),
      newOem('Dell', 13, 3, 2, 3, 'Compute'),
      newOem('HPE', 15, 3, 3, 2, 'Compute'),
      newOem('Fortinet', 18, 4, 3, 1, 'Security'),
      newOem('Pure Storage', 17, 4, 3, 2, 'Storage'),
      newOem('VMware', 22, 3, 2, 1, 'Software'),
      newOem('NetApp', 16, 3, 3, 2, 'Storage'),
      newOem('Arista', 19, 4, 2, 1, 'Networking'),
      newOem('Microsoft', 14, 2, 2, 1, 'Software')
    };
  }

  private static Fulcrum_OEM__c newOem(
    String name,
    Decimal baseMargin,
    Decimal dealRegBoost,
    Decimal servicesBoost,
    Decimal quarterEndDiscount,
    String category
  ) {
    return new Fulcrum_OEM__c(
      Name = name,
      Base_Margin__c = baseMargin,
      Deal_Reg_Margin_Boost__c = dealRegBoost,
      Services_Margin_Boost__c = servicesBoost,
      Quarter_End_Discount__c = quarterEndDiscount,
      Product_Category__c = category
    );
  }

  // ────────────────────────────────────────────────
  // Competitor Records (10)
  // ────────────────────────────────────────────────

  private static List<Fulcrum_Competitor__c> createCompetitorRecords() {
    return new List<Fulcrum_Competitor__c>{
      newCompetitor(
        'CDW',
        'Volume + Execution',
        '3',
        '2',
        0.03,
        3,
        'Differentiate on services and custom solutions. CDW wins on volume pricing but struggles with complex implementations. Lead with professional services and SLA guarantees.',
        'Largest US VAR by revenue. Strong in procurement efficiency and vendor relationships.'
      ),
      newCompetitor(
        'SHI International',
        'Price',
        '5',
        '1',
        0.05,
        5,
        'Avoid price wars. SHI will almost always be the lowest price. Win by demonstrating total cost of ownership including implementation, support, and ongoing management.',
        'Known for aggressive pricing. Strong Microsoft licensing practice.'
      ),
      newCompetitor(
        'Presidio',
        'Cisco Expertise',
        '2',
        '4',
        0.01,
        2,
        'Match technical depth on Cisco. Presidio\'s engineers are top-tier. Compete by offering broader multi-vendor solutions and faster response times.',
        'Premier Cisco partner with deep networking expertise.'
      ),
      newCompetitor(
        'Optiv',
        'Security Specialist',
        '2',
        '5',
        0.01,
        2,
        'Broaden scope beyond security. Optiv dominates in pure security deals but struggles when the solution spans networking or compute. Position as a full-stack partner.',
        'Leading security-focused VAR with managed security services.'
      ),
      newCompetitor(
        'Insight Enterprises',
        'Microsoft/Licensing',
        '3',
        '3',
        0.02,
        3,
        'Lead with multi-vendor integration. Insight is strong on Microsoft but weaker on networking infrastructure. Position as the partner who connects the full stack.',
        'Strong Microsoft and cloud practice. Growing services capabilities.'
      ),
      newCompetitor(
        'ePlus',
        'Government/Enterprise',
        '3',
        '3',
        0.02,
        3,
        'Emphasize commercial agility and speed. ePlus excels in government and regulated industries but can be slow in commercial accounts. Lead with rapid deployment and flexible terms.',
        'Strong government and enterprise focus. Good technical depth.'
      ),
      newCompetitor(
        'Trace3',
        'Innovation/Cloud',
        '2',
        '4',
        0.01,
        2,
        'Compete on breadth and established vendor relationships. Trace3 leads with innovation and emerging tech but may lack depth in traditional infrastructure.',
        'Innovation-focused VAR. Strong in cloud, data center, and emerging tech.'
      ),
      newCompetitor(
        'Connection',
        'SMB/Price',
        '4',
        '1',
        0.04,
        4,
        'Lead with services and support. Connection competes on price in the SMB segment but cannot match enterprise-grade services. Differentiate with implementation quality and ongoing support.',
        'SMB-focused VAR with strong e-commerce platform.'
      ),
      newCompetitor(
        'Zones',
        'Price/Volume',
        '4',
        '1',
        0.04,
        4,
        'Emphasize value-add and post-sale support. Zones wins on procurement efficiency but cannot deliver complex solutions. Lead with architecture design and managed services.',
        'IT solutions provider focused on procurement efficiency.'
      ),
      newCompetitor(
        'Converge Technology',
        'Data Center',
        '3',
        '4',
        0.02,
        3,
        'Lead with multi-vendor expertise and hybrid cloud capabilities. Converge is strong in traditional data center but growing in cloud. Position as the modern infrastructure partner.',
        'Data center specialist with growing cloud practice.'
      )
    };
  }

  private static Fulcrum_Competitor__c newCompetitor(
    String name,
    String primaryStrength,
    String priceAggression,
    String servicesCapability,
    Decimal typicalDiscount,
    Integer marginAggression,
    String howToWin,
    String description
  ) {
    return new Fulcrum_Competitor__c(
      Name = name,
      Primary_Strength__c = primaryStrength,
      Price_Aggression__c = priceAggression,
      Services_Capability__c = servicesCapability,
      Typical_Discount__c = typicalDiscount,
      Margin_Aggression__c = marginAggression,
      How_To_Win__c = howToWin,
      Description__c = description
    );
  }

  // ────────────────────────────────────────────────
  // Account Records (8)
  // ────────────────────────────────────────────────

  private static List<Account> createAccountRecords() {
    return new List<Account>{
      new Account(Name = 'Acme Technologies (Demo)', Industry = 'Technology'),
      new Account(Name = 'Meridian Healthcare (Demo)', Industry = 'Healthcare'),
      new Account(Name = 'Pinnacle Financial (Demo)', Industry = 'Finance'),
      new Account(
        Name = 'Atlas Manufacturing (Demo)',
        Industry = 'Manufacturing'
      ),
      new Account(Name = 'Horizon Energy (Demo)', Industry = 'Energy'),
      new Account(
        Name = 'Velocity Logistics (Demo)',
        Industry = 'Transportation'
      ),
      new Account(Name = 'Crestline Retail (Demo)', Industry = 'Retail'),
      new Account(Name = 'Spectrum Media (Demo)', Industry = 'Communications')
    };
  }

  // ────────────────────────────────────────────────
  // Opportunity Records (~30)
  // ────────────────────────────────────────────────

  private static List<Opportunity> createOpportunityRecords(
    Map<String, Id> acctMap
  ) {
    List<Opportunity> opps = new List<Opportunity>();

    // ── Open Deals (10) ──
    opps.addAll(createOpenDeals(acctMap));

    // ── Closed Won Deals (12) ──
    opps.addAll(createClosedWonDeals(acctMap));

    // ── Closed Lost Deals (8) ──
    opps.addAll(createClosedLostDeals(acctMap));

    return opps;
  }

  // ---------- Open Deals ----------

  private static List<Opportunity> createOpenDeals(Map<String, Id> acctMap) {
    List<Opportunity> opps = new List<Opportunity>();

    // 1. Acme Technologies - Cisco Network Refresh
    Opportunity o1 = baseOpp(
      acctMap,
      'Acme Technologies (Demo)',
      'Cisco Network Refresh',
      475000,
      'Negotiation/Review',
      75
    );
    o1.CloseDate = Date.today().addDays(35);
    o1.Fulcrum_OEM__c = 'Cisco';
    o1.Fulcrum_Customer_Segment__c = 'Enterprise';
    o1.Fulcrum_Deal_Reg_Type__c = 'StandardApproved';
    o1.Fulcrum_Competitor_Names__c = 'CDW;SHI';
    o1.Fulcrum_Solution_Complexity__c = 'Medium';
    o1.Fulcrum_Relationship_Strength__c = 'Strategic';
    o1.Fulcrum_Services_Attached__c = true;
    o1.Fulcrum_Product_Category__c = 'Networking';
    o1.Fulcrum_Planned_Margin__c = 18;
    o1.Fulcrum_OEM_Cost__c = 475000 * 0.82;
    opps.add(o1);

    // 2. Acme Technologies - Palo Alto Firewall
    Opportunity o2 = baseOpp(
      acctMap,
      'Acme Technologies (Demo)',
      'Palo Alto Firewall Deployment',
      185000,
      'Proposal/Price Quote',
      50
    );
    o2.CloseDate = Date.today().addDays(55);
    o2.Fulcrum_OEM__c = 'Palo Alto';
    o2.Fulcrum_Customer_Segment__c = 'MidMarket';
    o2.Fulcrum_Deal_Reg_Type__c = 'PremiumHunting';
    o2.Fulcrum_Competitor_Names__c = 'Presidio;Optiv';
    o2.Fulcrum_Solution_Complexity__c = 'High';
    o2.Fulcrum_Relationship_Strength__c = 'Good';
    o2.Fulcrum_Services_Attached__c = true;
    o2.Fulcrum_Product_Category__c = 'Security';
    o2.Fulcrum_Planned_Margin__c = 22;
    o2.Fulcrum_OEM_Cost__c = 185000 * 0.80;
    opps.add(o2);

    // 3. Meridian Healthcare - HPE Server Expansion
    Opportunity o3 = baseOpp(
      acctMap,
      'Meridian Healthcare (Demo)',
      'HPE Server Expansion',
      320000,
      'Qualification',
      25
    );
    o3.CloseDate = Date.today().addDays(75);
    o3.Fulcrum_OEM__c = 'HPE';
    o3.Fulcrum_Customer_Segment__c = 'Enterprise';
    o3.Fulcrum_Deal_Reg_Type__c = 'NotRegistered';
    o3.Fulcrum_Competitor_Names__c = 'CDW';
    o3.Fulcrum_Solution_Complexity__c = 'Low';
    o3.Fulcrum_Relationship_Strength__c = 'New';
    o3.Fulcrum_Services_Attached__c = false;
    o3.Fulcrum_Product_Category__c = 'Compute';
    // No planned margin or OEM cost — data quality gap
    opps.add(o3);

    // 4. Pinnacle Financial - Dell VxRail
    Opportunity o4 = baseOpp(
      acctMap,
      'Pinnacle Financial (Demo)',
      'Dell VxRail HCI Deployment',
      540000,
      'Negotiation/Review',
      75
    );
    o4.CloseDate = Date.today().addDays(30);
    o4.Fulcrum_OEM__c = 'Dell';
    o4.Fulcrum_Customer_Segment__c = 'Enterprise';
    o4.Fulcrum_Deal_Reg_Type__c = 'StandardApproved';
    o4.Fulcrum_Competitor_Names__c = 'CDW;Insight';
    o4.Fulcrum_Solution_Complexity__c = 'High';
    o4.Fulcrum_Relationship_Strength__c = 'Strategic';
    o4.Fulcrum_Services_Attached__c = true;
    o4.Fulcrum_Product_Category__c = 'Compute';
    o4.Fulcrum_Planned_Margin__c = 15;
    o4.Fulcrum_OEM_Cost__c = 540000 * 0.85;
    opps.add(o4);

    // 5. Atlas Manufacturing - Cisco SD-WAN
    Opportunity o5 = baseOpp(
      acctMap,
      'Atlas Manufacturing (Demo)',
      'Cisco SD-WAN Rollout',
      165000,
      'Proposal/Price Quote',
      50
    );
    o5.CloseDate = Date.today().addDays(60);
    o5.Fulcrum_OEM__c = 'Cisco';
    o5.Fulcrum_Customer_Segment__c = 'MidMarket';
    o5.Fulcrum_Deal_Reg_Type__c = 'StandardApproved';
    o5.Fulcrum_Competitor_Names__c = 'Connection;Zones';
    o5.Fulcrum_Solution_Complexity__c = 'Medium';
    o5.Fulcrum_Relationship_Strength__c = 'Good';
    o5.Fulcrum_Services_Attached__c = false;
    o5.Fulcrum_Product_Category__c = 'Networking';
    o5.Fulcrum_Planned_Margin__c = 20;
    // No OEM cost — data quality gap
    opps.add(o5);

    // 6. Horizon Energy - Fortinet Security
    Opportunity o6 = baseOpp(
      acctMap,
      'Horizon Energy (Demo)',
      'Fortinet Security Suite',
      95000,
      'Prospecting',
      10
    );
    o6.CloseDate = Date.today().addDays(90);
    o6.Fulcrum_OEM__c = 'Fortinet';
    o6.Fulcrum_Customer_Segment__c = 'SMB';
    o6.Fulcrum_Deal_Reg_Type__c = 'NotRegistered';
    o6.Fulcrum_Solution_Complexity__c = 'Low';
    o6.Fulcrum_Relationship_Strength__c = 'New';
    o6.Fulcrum_Services_Attached__c = false;
    o6.Fulcrum_Product_Category__c = 'Security';
    // No planned margin, no OEM cost, no competitors — early stage
    opps.add(o6);

    // 7. Velocity Logistics - Pure Storage FlashArray
    Opportunity o7 = baseOpp(
      acctMap,
      'Velocity Logistics (Demo)',
      'Pure Storage FlashArray',
      280000,
      'Qualification',
      25
    );
    o7.CloseDate = Date.today().addDays(65);
    o7.Fulcrum_OEM__c = 'Pure Storage';
    o7.Fulcrum_Customer_Segment__c = 'MidMarket';
    o7.Fulcrum_Deal_Reg_Type__c = 'PremiumHunting';
    o7.Fulcrum_Competitor_Names__c = 'CDW;ePlus';
    o7.Fulcrum_Solution_Complexity__c = 'Medium';
    o7.Fulcrum_Relationship_Strength__c = 'Good';
    o7.Fulcrum_Services_Attached__c = false;
    o7.Fulcrum_Product_Category__c = 'Storage';
    // No planned margin or OEM cost — data quality gap
    opps.add(o7);

    // 8. Crestline Retail - Microsoft 365 Migration
    Opportunity o8 = baseOpp(
      acctMap,
      'Crestline Retail (Demo)',
      'Microsoft 365 Migration',
      75000,
      'Proposal/Price Quote',
      50
    );
    o8.CloseDate = Date.today().addDays(45);
    o8.Fulcrum_OEM__c = 'Microsoft';
    o8.Fulcrum_Customer_Segment__c = 'SMB';
    o8.Fulcrum_Deal_Reg_Type__c = 'NotRegistered';
    o8.Fulcrum_Competitor_Names__c = 'SHI';
    o8.Fulcrum_Solution_Complexity__c = 'Low';
    o8.Fulcrum_Relationship_Strength__c = 'New';
    o8.Fulcrum_Services_Attached__c = false;
    o8.Fulcrum_Product_Category__c = 'Software';
    o8.Fulcrum_Planned_Margin__c = 16;
    o8.Fulcrum_OEM_Cost__c = 75000 * 0.86;
    opps.add(o8);

    // 9. Spectrum Media - Arista Switching
    Opportunity o9 = baseOpp(
      acctMap,
      'Spectrum Media (Demo)',
      'Arista Data Center Switching',
      410000,
      'Negotiation/Review',
      75
    );
    o9.CloseDate = Date.today().addDays(40);
    o9.Fulcrum_OEM__c = 'Arista';
    o9.Fulcrum_Customer_Segment__c = 'Enterprise';
    o9.Fulcrum_Deal_Reg_Type__c = 'Teaming';
    o9.Fulcrum_Competitor_Names__c = 'Presidio';
    o9.Fulcrum_Solution_Complexity__c = 'High';
    o9.Fulcrum_Relationship_Strength__c = 'Strategic';
    o9.Fulcrum_Services_Attached__c = true;
    o9.Fulcrum_Product_Category__c = 'Networking';
    o9.Fulcrum_Planned_Margin__c = 21;
    o9.Fulcrum_OEM_Cost__c = 410000 * 0.79;
    opps.add(o9);

    // 10. Acme Technologies - VMware Cloud
    Opportunity o10 = baseOpp(
      acctMap,
      'Acme Technologies (Demo)',
      'VMware Cloud Foundation',
      225000,
      'Qualification',
      25
    );
    o10.CloseDate = Date.today().addDays(70);
    o10.Fulcrum_OEM__c = 'VMware';
    o10.Fulcrum_Customer_Segment__c = 'MidMarket';
    o10.Fulcrum_Deal_Reg_Type__c = 'NotRegistered';
    o10.Fulcrum_Competitor_Names__c = 'Trace3;CDW';
    o10.Fulcrum_Solution_Complexity__c = 'Medium';
    o10.Fulcrum_Relationship_Strength__c = 'Good';
    o10.Fulcrum_Services_Attached__c = false;
    o10.Fulcrum_Product_Category__c = 'Software';
    // No planned margin or OEM cost — data quality gap
    opps.add(o10);

    return opps;
  }

  // ---------- Closed Won Deals ----------

  private static List<Opportunity> createClosedWonDeals(
    Map<String, Id> acctMap
  ) {
    List<Opportunity> opps = new List<Opportunity>();

    // 1. Acme Technologies - Cisco Campus Upgrade ($350K, GP 19%)
    Opportunity w1 = baseOpp(
      acctMap,
      'Acme Technologies (Demo)',
      'Cisco Campus Upgrade',
      350000,
      'Closed Won',
      100
    );
    w1.CloseDate = Date.today().addMonths(-1);
    w1.Fulcrum_OEM__c = 'Cisco';
    w1.Fulcrum_Customer_Segment__c = 'Enterprise';
    w1.Fulcrum_Deal_Reg_Type__c = 'StandardApproved';
    w1.Fulcrum_Competitor_Names__c = 'CDW;SHI';
    w1.Fulcrum_Solution_Complexity__c = 'Medium';
    w1.Fulcrum_Relationship_Strength__c = 'Strategic';
    w1.Fulcrum_Services_Attached__c = true;
    w1.Fulcrum_Product_Category__c = 'Networking';
    w1.Fulcrum_GP_Percent__c = 19;
    w1.Fulcrum_OEM_Cost__c = 350000 * 0.81;
    w1.Fulcrum_Planned_Margin__c = 18;
    opps.add(w1);

    // 2. Meridian Healthcare - Palo Alto NGFW ($180K, GP 24%)
    Opportunity w2 = baseOpp(
      acctMap,
      'Meridian Healthcare (Demo)',
      'Palo Alto NGFW Deployment',
      180000,
      'Closed Won',
      100
    );
    w2.CloseDate = Date.today().addMonths(-2);
    w2.Fulcrum_OEM__c = 'Palo Alto';
    w2.Fulcrum_Customer_Segment__c = 'MidMarket';
    w2.Fulcrum_Deal_Reg_Type__c = 'PremiumHunting';
    w2.Fulcrum_Competitor_Names__c = 'Optiv';
    w2.Fulcrum_Solution_Complexity__c = 'High';
    w2.Fulcrum_Relationship_Strength__c = 'Good';
    w2.Fulcrum_Services_Attached__c = true;
    w2.Fulcrum_Product_Category__c = 'Security';
    w2.Fulcrum_GP_Percent__c = 24;
    w2.Fulcrum_OEM_Cost__c = 180000 * 0.78;
    w2.Fulcrum_Planned_Margin__c = 22;
    opps.add(w2);

    // 3. Pinnacle Financial - Dell PowerEdge ($290K, GP 15%)
    Opportunity w3 = baseOpp(
      acctMap,
      'Pinnacle Financial (Demo)',
      'Dell PowerEdge Server Farm',
      290000,
      'Closed Won',
      100
    );
    w3.CloseDate = Date.today().addMonths(-3);
    w3.Fulcrum_OEM__c = 'Dell';
    w3.Fulcrum_Customer_Segment__c = 'Enterprise';
    w3.Fulcrum_Deal_Reg_Type__c = 'NotRegistered';
    w3.Fulcrum_Competitor_Names__c = 'CDW';
    w3.Fulcrum_Solution_Complexity__c = 'Medium';
    w3.Fulcrum_Relationship_Strength__c = 'Good';
    w3.Fulcrum_Services_Attached__c = false;
    w3.Fulcrum_Product_Category__c = 'Compute';
    w3.Fulcrum_GP_Percent__c = 15;
    w3.Fulcrum_OEM_Cost__c = 290000 * 0.85;
    w3.Fulcrum_Planned_Margin__c = 14;
    opps.add(w3);

    // 4. Atlas Manufacturing - HPE Storage ($210K, GP 17%)
    Opportunity w4 = baseOpp(
      acctMap,
      'Atlas Manufacturing (Demo)',
      'HPE Nimble Storage Expansion',
      210000,
      'Closed Won',
      100
    );
    w4.CloseDate = Date.today().addMonths(-4);
    w4.Fulcrum_OEM__c = 'HPE';
    w4.Fulcrum_Customer_Segment__c = 'MidMarket';
    w4.Fulcrum_Deal_Reg_Type__c = 'StandardApproved';
    w4.Fulcrum_Competitor_Names__c = 'ePlus;Connection';
    w4.Fulcrum_Solution_Complexity__c = 'Medium';
    w4.Fulcrum_Relationship_Strength__c = 'Good';
    w4.Fulcrum_Services_Attached__c = true;
    w4.Fulcrum_Product_Category__c = 'Storage';
    w4.Fulcrum_GP_Percent__c = 17;
    w4.Fulcrum_OEM_Cost__c = 210000 * 0.83;
    w4.Fulcrum_Planned_Margin__c = 16;
    opps.add(w4);

    // 5. Horizon Energy - Fortinet UTM ($85K, GP 22%)
    Opportunity w5 = baseOpp(
      acctMap,
      'Horizon Energy (Demo)',
      'Fortinet UTM Deployment',
      85000,
      'Closed Won',
      100
    );
    w5.CloseDate = Date.today().addMonths(-5);
    w5.Fulcrum_OEM__c = 'Fortinet';
    w5.Fulcrum_Customer_Segment__c = 'SMB';
    w5.Fulcrum_Deal_Reg_Type__c = 'NotRegistered';
    w5.Fulcrum_Competitor_Names__c = 'Zones';
    w5.Fulcrum_Solution_Complexity__c = 'Low';
    w5.Fulcrum_Relationship_Strength__c = 'New';
    w5.Fulcrum_Services_Attached__c = false;
    w5.Fulcrum_Product_Category__c = 'Security';
    w5.Fulcrum_GP_Percent__c = 22;
    w5.Fulcrum_OEM_Cost__c = 85000 * 0.80;
    w5.Fulcrum_Planned_Margin__c = 20;
    opps.add(w5);

    // 6. Velocity Logistics - Cisco Meraki ($125K, GP 20%)
    Opportunity w6 = baseOpp(
      acctMap,
      'Velocity Logistics (Demo)',
      'Cisco Meraki SD-WAN',
      125000,
      'Closed Won',
      100
    );
    w6.CloseDate = Date.today().addMonths(-6);
    w6.Fulcrum_OEM__c = 'Cisco';
    w6.Fulcrum_Customer_Segment__c = 'MidMarket';
    w6.Fulcrum_Deal_Reg_Type__c = 'StandardApproved';
    w6.Fulcrum_Competitor_Names__c = 'SHI';
    w6.Fulcrum_Solution_Complexity__c = 'Medium';
    w6.Fulcrum_Relationship_Strength__c = 'Good';
    w6.Fulcrum_Services_Attached__c = true;
    w6.Fulcrum_Product_Category__c = 'Networking';
    w6.Fulcrum_GP_Percent__c = 20;
    w6.Fulcrum_OEM_Cost__c = 125000 * 0.82;
    w6.Fulcrum_Planned_Margin__c = 19;
    opps.add(w6);

    // 7. Crestline Retail - NetApp AFF ($195K, GP 18%)
    Opportunity w7 = baseOpp(
      acctMap,
      'Crestline Retail (Demo)',
      'NetApp AFF All-Flash Array',
      195000,
      'Closed Won',
      100
    );
    w7.CloseDate = Date.today().addMonths(-7);
    w7.Fulcrum_OEM__c = 'NetApp';
    w7.Fulcrum_Customer_Segment__c = 'MidMarket';
    w7.Fulcrum_Deal_Reg_Type__c = 'PremiumHunting';
    w7.Fulcrum_Competitor_Names__c = 'CDW;Trace3';
    w7.Fulcrum_Solution_Complexity__c = 'Medium';
    w7.Fulcrum_Relationship_Strength__c = 'Good';
    w7.Fulcrum_Services_Attached__c = false;
    w7.Fulcrum_Product_Category__c = 'Storage';
    w7.Fulcrum_GP_Percent__c = 18;
    w7.Fulcrum_OEM_Cost__c = 195000 * 0.82;
    w7.Fulcrum_Planned_Margin__c = 17;
    opps.add(w7);

    // 8. Spectrum Media - Arista Spine-Leaf ($380K, GP 21%)
    Opportunity w8 = baseOpp(
      acctMap,
      'Spectrum Media (Demo)',
      'Arista Spine-Leaf Architecture',
      380000,
      'Closed Won',
      100
    );
    w8.CloseDate = Date.today().addMonths(-8);
    w8.Fulcrum_OEM__c = 'Arista';
    w8.Fulcrum_Customer_Segment__c = 'Enterprise';
    w8.Fulcrum_Deal_Reg_Type__c = 'Teaming';
    w8.Fulcrum_Competitor_Names__c = 'Presidio';
    w8.Fulcrum_Solution_Complexity__c = 'High';
    w8.Fulcrum_Relationship_Strength__c = 'Strategic';
    w8.Fulcrum_Services_Attached__c = true;
    w8.Fulcrum_Product_Category__c = 'Networking';
    w8.Fulcrum_GP_Percent__c = 21;
    w8.Fulcrum_OEM_Cost__c = 380000 * 0.79;
    w8.Fulcrum_Planned_Margin__c = 20;
    opps.add(w8);

    // 9. Acme Technologies - Pure Storage FlashBlade ($425K, GP 19%)
    Opportunity w9 = baseOpp(
      acctMap,
      'Acme Technologies (Demo)',
      'Pure Storage FlashBlade',
      425000,
      'Closed Won',
      100
    );
    w9.CloseDate = Date.today().addMonths(-9);
    w9.Fulcrum_OEM__c = 'Pure Storage';
    w9.Fulcrum_Customer_Segment__c = 'Enterprise';
    w9.Fulcrum_Deal_Reg_Type__c = 'StandardApproved';
    w9.Fulcrum_Competitor_Names__c = 'CDW;ePlus';
    w9.Fulcrum_Solution_Complexity__c = 'High';
    w9.Fulcrum_Relationship_Strength__c = 'Strategic';
    w9.Fulcrum_Services_Attached__c = true;
    w9.Fulcrum_Product_Category__c = 'Storage';
    w9.Fulcrum_GP_Percent__c = 19;
    w9.Fulcrum_OEM_Cost__c = 425000 * 0.81;
    w9.Fulcrum_Planned_Margin__c = 18;
    opps.add(w9);

    // 10. Pinnacle Financial - VMware vSphere ($155K, GP 26%)
    Opportunity w10 = baseOpp(
      acctMap,
      'Pinnacle Financial (Demo)',
      'VMware vSphere Licensing',
      155000,
      'Closed Won',
      100
    );
    w10.CloseDate = Date.today().addMonths(-10);
    w10.Fulcrum_OEM__c = 'VMware';
    w10.Fulcrum_Customer_Segment__c = 'MidMarket';
    w10.Fulcrum_Deal_Reg_Type__c = 'NotRegistered';
    w10.Fulcrum_Competitor_Names__c = 'Insight';
    w10.Fulcrum_Solution_Complexity__c = 'Low';
    w10.Fulcrum_Relationship_Strength__c = 'Good';
    w10.Fulcrum_Services_Attached__c = false;
    w10.Fulcrum_Product_Category__c = 'Software';
    w10.Fulcrum_GP_Percent__c = 26;
    w10.Fulcrum_OEM_Cost__c = 155000 * 0.78;
    w10.Fulcrum_Planned_Margin__c = 24;
    opps.add(w10);

    // 11. Meridian Healthcare - Microsoft Azure Stack ($275K, GP 16%)
    Opportunity w11 = baseOpp(
      acctMap,
      'Meridian Healthcare (Demo)',
      'Microsoft Azure Stack HCI',
      275000,
      'Closed Won',
      100
    );
    w11.CloseDate = Date.today().addMonths(-11);
    w11.Fulcrum_OEM__c = 'Microsoft';
    w11.Fulcrum_Customer_Segment__c = 'Enterprise';
    w11.Fulcrum_Deal_Reg_Type__c = 'StandardApproved';
    w11.Fulcrum_Competitor_Names__c = 'SHI;CDW';
    w11.Fulcrum_Solution_Complexity__c = 'High';
    w11.Fulcrum_Relationship_Strength__c = 'Good';
    w11.Fulcrum_Services_Attached__c = true;
    w11.Fulcrum_Product_Category__c = 'Software';
    w11.Fulcrum_GP_Percent__c = 16;
    w11.Fulcrum_OEM_Cost__c = 275000 * 0.84;
    w11.Fulcrum_Planned_Margin__c = 15;
    opps.add(w11);

    // 12. Atlas Manufacturing - Cisco ISE ($145K, GP 23%)
    Opportunity w12 = baseOpp(
      acctMap,
      'Atlas Manufacturing (Demo)',
      'Cisco ISE Network Access Control',
      145000,
      'Closed Won',
      100
    );
    w12.CloseDate = Date.today().addMonths(-12);
    w12.Fulcrum_OEM__c = 'Cisco';
    w12.Fulcrum_Customer_Segment__c = 'MidMarket';
    w12.Fulcrum_Deal_Reg_Type__c = 'PremiumHunting';
    w12.Fulcrum_Competitor_Names__c = 'Converge';
    w12.Fulcrum_Solution_Complexity__c = 'High';
    w12.Fulcrum_Relationship_Strength__c = 'Good';
    w12.Fulcrum_Services_Attached__c = true;
    w12.Fulcrum_Product_Category__c = 'Security';
    w12.Fulcrum_GP_Percent__c = 23;
    w12.Fulcrum_OEM_Cost__c = 145000 * 0.79;
    w12.Fulcrum_Planned_Margin__c = 21;
    opps.add(w12);

    return opps;
  }

  // ---------- Closed Lost Deals ----------

  private static List<Opportunity> createClosedLostDeals(
    Map<String, Id> acctMap
  ) {
    List<Opportunity> opps = new List<Opportunity>();

    // 1. Acme Technologies - Dell Storage ($200K, Price)
    Opportunity l1 = baseOpp(
      acctMap,
      'Acme Technologies (Demo)',
      'Dell Storage Refresh',
      200000,
      'Closed Lost',
      0
    );
    l1.CloseDate = Date.today().addMonths(-2);
    l1.Fulcrum_OEM__c = 'Dell';
    l1.Fulcrum_Customer_Segment__c = 'Enterprise';
    l1.Fulcrum_Deal_Reg_Type__c = 'StandardApproved';
    l1.Fulcrum_Competitor_Names__c = 'CDW';
    l1.Fulcrum_Solution_Complexity__c = 'Medium';
    l1.Fulcrum_Relationship_Strength__c = 'Good';
    l1.Fulcrum_Services_Attached__c = false;
    l1.Fulcrum_Product_Category__c = 'Storage';
    l1.Fulcrum_Loss_Reason__c = 'Price';
    opps.add(l1);

    // 2. Meridian Healthcare - Cisco Catalyst ($310K, Technical)
    Opportunity l2 = baseOpp(
      acctMap,
      'Meridian Healthcare (Demo)',
      'Cisco Catalyst Switching',
      310000,
      'Closed Lost',
      0
    );
    l2.CloseDate = Date.today().addMonths(-3);
    l2.Fulcrum_OEM__c = 'Cisco';
    l2.Fulcrum_Customer_Segment__c = 'Enterprise';
    l2.Fulcrum_Deal_Reg_Type__c = 'StandardApproved';
    l2.Fulcrum_Competitor_Names__c = 'Presidio;CDW';
    l2.Fulcrum_Solution_Complexity__c = 'High';
    l2.Fulcrum_Relationship_Strength__c = 'New';
    l2.Fulcrum_Services_Attached__c = false;
    l2.Fulcrum_Product_Category__c = 'Networking';
    l2.Fulcrum_Loss_Reason__c = 'Technical';
    opps.add(l2);

    // 3. Pinnacle Financial - Palo Alto Prisma ($175K, Budget — closest to Feature Gap)
    Opportunity l3 = baseOpp(
      acctMap,
      'Pinnacle Financial (Demo)',
      'Palo Alto Prisma Cloud',
      175000,
      'Closed Lost',
      0
    );
    l3.CloseDate = Date.today().addMonths(-5);
    l3.Fulcrum_OEM__c = 'Palo Alto';
    l3.Fulcrum_Customer_Segment__c = 'MidMarket';
    l3.Fulcrum_Deal_Reg_Type__c = 'NotRegistered';
    l3.Fulcrum_Competitor_Names__c = 'Optiv';
    l3.Fulcrum_Solution_Complexity__c = 'Medium';
    l3.Fulcrum_Relationship_Strength__c = 'Good';
    l3.Fulcrum_Services_Attached__c = false;
    l3.Fulcrum_Product_Category__c = 'Security';
    l3.Fulcrum_Loss_Reason__c = 'Budget';
    opps.add(l3);

    // 4. Atlas Manufacturing - HPE Synergy ($450K, Price)
    Opportunity l4 = baseOpp(
      acctMap,
      'Atlas Manufacturing (Demo)',
      'HPE Synergy Composable',
      450000,
      'Closed Lost',
      0
    );
    l4.CloseDate = Date.today().addMonths(-4);
    l4.Fulcrum_OEM__c = 'HPE';
    l4.Fulcrum_Customer_Segment__c = 'Enterprise';
    l4.Fulcrum_Deal_Reg_Type__c = 'StandardApproved';
    l4.Fulcrum_Competitor_Names__c = 'SHI;ePlus';
    l4.Fulcrum_Solution_Complexity__c = 'High';
    l4.Fulcrum_Relationship_Strength__c = 'Good';
    l4.Fulcrum_Services_Attached__c = false;
    l4.Fulcrum_Product_Category__c = 'Compute';
    l4.Fulcrum_Loss_Reason__c = 'Price';
    opps.add(l4);

    // 5. Horizon Energy - Fortinet FortiGate ($110K, Relationship)
    Opportunity l5 = baseOpp(
      acctMap,
      'Horizon Energy (Demo)',
      'Fortinet FortiGate Upgrade',
      110000,
      'Closed Lost',
      0
    );
    l5.CloseDate = Date.today().addMonths(-6);
    l5.Fulcrum_OEM__c = 'Fortinet';
    l5.Fulcrum_Customer_Segment__c = 'SMB';
    l5.Fulcrum_Deal_Reg_Type__c = 'NotRegistered';
    l5.Fulcrum_Competitor_Names__c = 'Zones';
    l5.Fulcrum_Solution_Complexity__c = 'Low';
    l5.Fulcrum_Relationship_Strength__c = 'New';
    l5.Fulcrum_Services_Attached__c = false;
    l5.Fulcrum_Product_Category__c = 'Security';
    l5.Fulcrum_Loss_Reason__c = 'Relationship';
    opps.add(l5);

    // 6. Velocity Logistics - Pure Storage ($240K, Price)
    Opportunity l6 = baseOpp(
      acctMap,
      'Velocity Logistics (Demo)',
      'Pure Storage FlashArray Expansion',
      240000,
      'Closed Lost',
      0
    );
    l6.CloseDate = Date.today().addMonths(-7);
    l6.Fulcrum_OEM__c = 'Pure Storage';
    l6.Fulcrum_Customer_Segment__c = 'MidMarket';
    l6.Fulcrum_Deal_Reg_Type__c = 'PremiumHunting';
    l6.Fulcrum_Competitor_Names__c = 'CDW;Trace3';
    l6.Fulcrum_Solution_Complexity__c = 'Medium';
    l6.Fulcrum_Relationship_Strength__c = 'Good';
    l6.Fulcrum_Services_Attached__c = false;
    l6.Fulcrum_Product_Category__c = 'Storage';
    l6.Fulcrum_Loss_Reason__c = 'Price';
    opps.add(l6);

    // 7. Crestline Retail - Arista ($130K, Price)
    Opportunity l7 = baseOpp(
      acctMap,
      'Crestline Retail (Demo)',
      'Arista Campus Switching',
      130000,
      'Closed Lost',
      0
    );
    l7.CloseDate = Date.today().addMonths(-9);
    l7.Fulcrum_OEM__c = 'Arista';
    l7.Fulcrum_Customer_Segment__c = 'MidMarket';
    l7.Fulcrum_Deal_Reg_Type__c = 'NotRegistered';
    l7.Fulcrum_Competitor_Names__c = 'Connection';
    l7.Fulcrum_Solution_Complexity__c = 'Low';
    l7.Fulcrum_Relationship_Strength__c = 'New';
    l7.Fulcrum_Services_Attached__c = false;
    l7.Fulcrum_Product_Category__c = 'Networking';
    l7.Fulcrum_Loss_Reason__c = 'Price';
    opps.add(l7);

    // 8. Spectrum Media - Dell VxRail ($350K, Technical)
    Opportunity l8 = baseOpp(
      acctMap,
      'Spectrum Media (Demo)',
      'Dell VxRail Refresh',
      350000,
      'Closed Lost',
      0
    );
    l8.CloseDate = Date.today().addMonths(-10);
    l8.Fulcrum_OEM__c = 'Dell';
    l8.Fulcrum_Customer_Segment__c = 'Enterprise';
    l8.Fulcrum_Deal_Reg_Type__c = 'StandardApproved';
    l8.Fulcrum_Competitor_Names__c = 'Insight;CDW';
    l8.Fulcrum_Solution_Complexity__c = 'High';
    l8.Fulcrum_Relationship_Strength__c = 'Good';
    l8.Fulcrum_Services_Attached__c = false;
    l8.Fulcrum_Product_Category__c = 'Compute';
    l8.Fulcrum_Loss_Reason__c = 'Technical';
    opps.add(l8);

    return opps;
  }

  // ────────────────────────────────────────────────
  // Helpers
  // ────────────────────────────────────────────────

  private static Opportunity baseOpp(
    Map<String, Id> acctMap,
    String accountName,
    String dealName,
    Decimal amount,
    String stage,
    Integer probability
  ) {
    Opportunity opp = new Opportunity();
    opp.AccountId = acctMap.get(accountName);
    opp.Name = accountName.replace(' (Demo)', '') + ' - ' + dealName;
    opp.Amount = amount;
    opp.StageName = stage;
    opp.Probability = probability;
    opp.CloseDate = Date.today().addDays(60); // default, overridden by caller
    return opp;
  }
}
