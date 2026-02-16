@isTest
private class MarginArcControllerTest {
  /**
   * Mock HTTP callout for Gemini API - successful response
   */
  private class GeminiMockSuccess implements HttpCalloutMock {
    public HTTPResponse respond(HTTPRequest req) {
      HttpResponse res = new HttpResponse();
      res.setStatusCode(200);
      res.setHeader('Content-Type', 'application/json');
      res.setBody(
        '{"candidates":[{"content":{"parts":[{"text":"Test explanation text from Gemini."}]}}]}'
      );
      return res;
    }
  }

  /**
   * Mock HTTP callout for Gemini API - error response
   */
  private class GeminiMockError implements HttpCalloutMock {
    public HTTPResponse respond(HTTPRequest req) {
      HttpResponse res = new HttpResponse();
      res.setStatusCode(500);
      res.setBody('{"error":"Internal Server Error"}');
      return res;
    }
  }

  /**
   * Mock HTTP callout for MarginArc API - successful response
   */
  private class MarginArcMockSuccess implements HttpCalloutMock {
    public HTTPResponse respond(HTTPRequest req) {
      HttpResponse res = new HttpResponse();
      res.setStatusCode(200);
      res.setHeader('Content-Type', 'application/json');
      res.setBody(
        '{"suggestedMarginPct":22.5,"confidence":0.75,"winProbability":0.65,"drivers":[]}'
      );
      return res;
    }
  }

  /**
   * Mock HTTP callout for BOM search API - successful response
   */
  private class BomSearchMockSuccess implements HttpCalloutMock {
    public HTTPResponse respond(HTTPRequest req) {
      HttpResponse res = new HttpResponse();
      res.setStatusCode(200);
      res.setHeader('Content-Type', 'application/json');
      res.setBody(
        '{"results":[{"partNumber":"C9300-24P-A","manufacturer":"Cisco","description":"Catalyst 9300 24-port PoE+","category":"Switches","family":"Catalyst 9300","listPrice":7312}],"total":1}'
      );
      return res;
    }
  }

  /**
   * Mock HTTP callout for BOM analyze API - successful response
   */
  private class BomAnalyzeMockSuccess implements HttpCalloutMock {
    public HTTPResponse respond(HTTPRequest req) {
      HttpResponse res = new HttpResponse();
      res.setStatusCode(200);
      res.setHeader('Content-Type', 'application/json');
      res.setBody(
        '{"lines":[{"partNumber":"C9300-24P-A","marginPct":15,"recommendedMarginPct":22,"deltaPct":7}],' +
        '"totals":{"cost":54840,"price":64517,"blendedMarginPct":15,"totalGP":9677},' +
        '"recommendations":{"healthScore":72,"insights":["Margins below recommended"],"suggestedBlendedMargin":22}}'
      );
      return res;
    }
  }

  /**
   * Mock HTTP callout for MarginArc API - error response
   */
  private class MarginArcMockError implements HttpCalloutMock {
    public HTTPResponse respond(HTTPRequest req) {
      HttpResponse res = new HttpResponse();
      res.setStatusCode(400);
      res.setBody('{"error":"Validation failed"}');
      return res;
    }
  }

  @TestSetup
  static void setupTestData() {
    // Assign Fulcrum_Admin permission set for FLS access in scratch orgs
    // System.runAs avoids MIXED_DML_OPERATION between setup and non-setup objects
    User thisUser = [SELECT Id FROM User WHERE Id = :UserInfo.getUserId()];
    System.runAs(thisUser) {
      PermissionSet ps = [
        SELECT Id
        FROM PermissionSet
        WHERE Name = 'Fulcrum_Admin'
        LIMIT 1
      ];
      try {
        insert new PermissionSetAssignment(
          AssigneeId = UserInfo.getUserId(),
          PermissionSetId = ps.Id
        );
      } catch (DmlException e) {
        // Already assigned
      }
    }

    // Insert Custom Setting config for tests
    Fulcrum_Config__c cfg = new Fulcrum_Config__c(
      Gemini_API_Key__c = 'test-gemini-key',
      API_Key__c = 'test-api-key',
      API_URL__c = 'https://api.marginarc.com/api/recommend'
    );
    insert cfg;

    // Insert active license so license-gated methods work in tests
    Fulcrum_License__c license = new Fulcrum_License__c(
      License_Key__c = 'TEST-LICENSE-KEY',
      Status__c = 'active',
      Expiry_Date__c = Date.today().addDays(365),
      Org_ID__c = UserInfo.getOrganizationId()
    );
    upsert license;

    Account acc = new Account(Name = 'Test Account', Industry = 'Technology');
    insert acc;

    // Enterprise-level opportunity with MarginArc fields populated
    Opportunity oppEnterprise = new Opportunity(
      Name = 'Enterprise Deal - Cisco',
      AccountId = acc.Id,
      Amount = 750000,
      Probability = 60,
      StageName = 'Prospecting',
      CloseDate = Date.today().addDays(30),
      Fulcrum_OEM__c = 'Cisco',
      Fulcrum_OEM_Cost__c = 600000,
      Fulcrum_Planned_Margin__c = 18,
      Fulcrum_Customer_Segment__c = 'Enterprise',
      Fulcrum_Deal_Reg_Type__c = 'StandardApproved',
      Fulcrum_Competitors__c = '2',
      Fulcrum_Solution_Complexity__c = 'High',
      Fulcrum_Relationship_Strength__c = 'Strategic',
      Fulcrum_Value_Add__c = 'High'
    );
    insert oppEnterprise;

    // SMB-level opportunity with no custom fields
    Opportunity oppSmb = new Opportunity(
      Name = 'Small Deal',
      AccountId = acc.Id,
      Amount = 50000,
      Probability = 30,
      StageName = 'Prospecting',
      CloseDate = Date.today().addDays(60)
    );
    insert oppSmb;

    // Commercial-level opportunity (amount between 100k and 500k)
    Opportunity oppCommercial = new Opportunity(
      Name = 'Mid Deal',
      AccountId = acc.Id,
      Amount = 250000,
      Probability = 50,
      StageName = 'Qualification',
      CloseDate = Date.today().addDays(45)
    );
    insert oppCommercial;

    // Opportunity with null amount
    Opportunity oppNull = new Opportunity(
      Name = 'Null Amount Deal',
      AccountId = acc.Id,
      StageName = 'Prospecting',
      CloseDate = Date.today().addDays(90)
    );
    insert oppNull;
  }

  @isTest
  static void testGetOpportunityDataWithValidId() {
    Opportunity opp = [
      SELECT Id
      FROM Opportunity
      WHERE Name = 'Enterprise Deal - Cisco'
      LIMIT 1
    ];

    Test.startTest();
    Map<String, Object> result = MarginArcController.getOpportunityData(opp.Id);
    Test.stopTest();

    System.assertNotEquals(null, result, 'Result should not be null');

    Map<String, Object> data = result;
    System.assertEquals(
      'Enterprise Deal - Cisco',
      data.get('name'),
      'Name should match'
    );
    System.assertNotEquals(
      null,
      data.get('amount'),
      'Amount should be present'
    );
    System.assertNotEquals(
      null,
      data.get('accountName'),
      'Account name should be present'
    );
    System.assertNotEquals(null, data.get('oem'), 'OEM should be present');
    System.assertNotEquals(
      null,
      data.get('customerSegment'),
      'Customer segment should be present'
    );
    System.assertNotEquals(
      null,
      data.get('dealRegType'),
      'Deal reg type should be present'
    );
    System.assertNotEquals(
      null,
      data.get('solutionComplexity'),
      'Solution complexity should be present'
    );
  }

  @isTest
  static void testGetOpportunityDataWithNullId() {
    Test.startTest();
    Map<String, Object> result = MarginArcController.getOpportunityData(null);
    Test.stopTest();

    System.assertEquals(null, result, 'Result should be null for null Id');
  }

  @isTest
  static void testGetOpportunityDataWithCustomFields() {
    Opportunity opp = [
      SELECT Id
      FROM Opportunity
      WHERE Name = 'Enterprise Deal - Cisco'
      LIMIT 1
    ];

    User u = [SELECT Id FROM User WHERE Id = :UserInfo.getUserId()];
    System.runAs(u) {
      Test.startTest();
      Map<String, Object> result = MarginArcController.getOpportunityData(opp.Id);
      Test.stopTest();

      Map<String, Object> data = result;

      // Custom fields should override defaults
      System.assertEquals('Cisco', data.get('oem'), 'OEM should be Cisco');
      System.assertEquals(
        600000.0,
        (Decimal) data.get('oemCost'),
        'OEM cost should be 600000'
      );
      System.assertEquals(
        18.0,
        (Decimal) data.get('plannedMargin'),
        'Planned margin should be 18'
      );
      System.assertEquals(
        'Enterprise',
        data.get('customerSegment'),
        'Customer segment should be Enterprise'
      );
      System.assertEquals(
        'High',
        data.get('solutionComplexity'),
        'Solution complexity should be High'
      );
      System.assertEquals(
        'Strategic',
        data.get('relationshipStrength'),
        'Relationship strength should be Strategic'
      );
      System.assertEquals(
        'High',
        data.get('valueAdd'),
        'Value add should be High'
      );
    }
  }

  @isTest
  static void testSegmentMappingFromAmount() {
    // Enterprise: >= 500000
    Opportunity oppEnterprise = [
      SELECT Id
      FROM Opportunity
      WHERE Name = 'Enterprise Deal - Cisco'
      LIMIT 1
    ];
    // SMB: < 100000
    Opportunity oppSmb = [
      SELECT Id
      FROM Opportunity
      WHERE Name = 'Small Deal'
      LIMIT 1
    ];
    // Commercial: 100000 - 499999
    Opportunity oppCommercial = [
      SELECT Id
      FROM Opportunity
      WHERE Name = 'Mid Deal'
      LIMIT 1
    ];
    // Null amount -> Commercial default
    Opportunity oppNull = [
      SELECT Id
      FROM Opportunity
      WHERE Name = 'Null Amount Deal'
      LIMIT 1
    ];

    Test.startTest();
    // Enterprise deal has Fulcrum_Customer_Segment__c='Enterprise' set explicitly,
    // so test segment mapping via the SMB, Commercial, and Null deals which use defaults
    Map<String, Object> smbResult = MarginArcController.getOpportunityData(
      oppSmb.Id
    );
    Map<String, Object> commercialResult = MarginArcController.getOpportunityData(
      oppCommercial.Id
    );
    Map<String, Object> nullResult = MarginArcController.getOpportunityData(
      oppNull.Id
    );
    Test.stopTest();

    // Deals without explicit Fulcrum_Customer_Segment__c use amount-based fallback
    System.assertEquals(
      'SMB',
      smbResult.get('customerSegment'),
      'Small deal (<100K) should map to SMB'
    );
    System.assertEquals(
      'MidMarket',
      commercialResult.get('customerSegment'),
      'Mid deal (100K-499K) should map to MidMarket'
    );
    System.assertEquals(
      'MidMarket',
      nullResult.get('customerSegment'),
      'Null amount should default to MidMarket'
    );
  }

  @isTest
  static void testGenerateAIExplanationSuccess() {
    Test.setMock(HttpCalloutMock.class, new GeminiMockSuccess());

    List<Map<String, Object>> drivers = new List<Map<String, Object>>();
    drivers.add(
      new Map<String, Object>{ 'name' => 'OEM Base Margin', 'val' => 0.05 }
    );
    drivers.add(
      new Map<String, Object>{ 'name' => 'Deal Registration', 'val' => 0.03 }
    );

    Test.startTest();
    Map<String, String> result = MarginArcController.generateAIExplanation(
      'Cisco',
      22.5,
      0.65,
      'Enterprise',
      'CDW;SHI',
      'StandardApproved',
      'High',
      600000,
      drivers
    );
    Test.stopTest();

    System.assert(
      result.containsKey('explanation'),
      'Result should contain explanation key'
    );
    System.assert(
      result.containsKey('qualitativeSummary'),
      'Result should contain qualitativeSummary key'
    );
    System.assertEquals(
      'Test explanation text from Gemini.',
      result.get('explanation'),
      'Explanation should match mock'
    );
    System.assertEquals(
      'Test explanation text from Gemini.',
      result.get('qualitativeSummary'),
      'Qualitative summary should match mock'
    );
    System.assert(!result.containsKey('error'), 'Should not contain error key');
  }

  @isTest
  static void testGenerateAIExplanationApiError() {
    Test.setMock(HttpCalloutMock.class, new GeminiMockError());

    Test.startTest();
    Map<String, String> result = MarginArcController.generateAIExplanation(
      'Dell',
      18.0,
      0.50,
      'Commercial',
      'CDW',
      'NotRegistered',
      'Medium',
      100000,
      new List<Map<String, Object>>()
    );
    Test.stopTest();

    // When API returns 500, callGemini returns empty string (not exception)
    // so explanation and qualitativeSummary should be empty strings
    System.assert(
      result.containsKey('explanation'),
      'Result should contain explanation key even on error'
    );
    System.assertEquals(
      '',
      result.get('explanation'),
      'Explanation should be empty on API error'
    );
  }

  @isTest
  static void testCallMarginArcApiSuccess() {
    Test.setMock(HttpCalloutMock.class, new MarginArcMockSuccess());

    String payload = '{"input":{"oemCost":50000,"productCategory":"Hardware","customerSegment":"Enterprise","relationshipStrength":"Good","customerTechSophistication":"Medium","dealRegType":"StandardApproved","competitors":"2","valueAdd":"Medium","solutionComplexity":"Medium","varStrategicImportance":"Medium","customerIndustry":"Technology"},"plannedMarginPct":15}';

    Test.startTest();
    String result = MarginArcController.callMarginArcApi(payload);
    Test.stopTest();

    System.assertNotEquals(null, result, 'Result should not be null');
    System.assert(
      result.contains('suggestedMarginPct'),
      'Result should contain suggestedMarginPct'
    );
  }

  @isTest
  static void testCallMarginArcApiError() {
    Test.setMock(HttpCalloutMock.class, new MarginArcMockError());

    String payload = '{"input":{"oemCost":50000}}';

    Test.startTest();
    try {
      MarginArcController.callMarginArcApi(payload);
      System.assert(false, 'Should have thrown AuraHandledException');
    } catch (AuraHandledException e) {
      System.assert(
        e.getMessage().contains('MarginArc API error'),
        'Error should mention MarginArc API'
      );
    }
    Test.stopTest();
  }

  @isTest
  static void testGetOemRecordsEmpty() {
    Test.startTest();
    List<Fulcrum_OEM__c> results = MarginArcController.getOemRecords();
    Test.stopTest();

    // No OEM records in test context by default
    System.assertNotEquals(null, results, 'Result should not be null');
  }

  @isTest
  static void testGetOemRecordsWithData() {
    // Insert OEM record with Name only (custom fields may not be deployed yet)
    Fulcrum_OEM__c oem = new Fulcrum_OEM__c(Name = 'Cisco');
    insert oem;

    Test.startTest();
    List<Fulcrum_OEM__c> results = MarginArcController.getOemRecords();
    Test.stopTest();

    System.assert(results.size() >= 1, 'Should return at least 1 OEM record');
    Boolean found = false;
    for (Fulcrum_OEM__c rec : results) {
      if (rec.Name == 'Cisco') {
        found = true;
        break;
      }
    }
    System.assert(found, 'Should find Cisco OEM record');
  }

  @isTest
  static void testGenerateAIExplanationWithNullDrivers() {
    Test.setMock(HttpCalloutMock.class, new GeminiMockSuccess());

    Test.startTest();
    Map<String, String> result = MarginArcController.generateAIExplanation(
      'HPE',
      20.0,
      0.55,
      'Enterprise',
      'Presidio',
      'PremiumDealReg',
      'Low',
      200000,
      null
    );
    Test.stopTest();

    System.assert(
      result.containsKey('explanation'),
      'Result should contain explanation with null drivers'
    );
    System.assertNotEquals(
      null,
      result.get('explanation'),
      'Explanation should not be null'
    );
  }

  @isTest
  static void testLogRecommendation() {
    Opportunity opp = [
      SELECT Id
      FROM Opportunity
      WHERE Name = 'Enterprise Deal - Cisco'
      LIMIT 1
    ];

    User u = [SELECT Id FROM User WHERE Id = :UserInfo.getUserId()];
    System.runAs(u) {
      Test.startTest();
      Id recId = MarginArcController.logRecommendation(
        opp.Id,
        22.5,
        85.0,
        70.0,
        18.0,
        'Manual',
        true
      );
      Test.stopTest();

      System.assertNotEquals(null, recId, 'Returned Id should not be null');

      Fulcrum_Recommendation_History__c rec = [
        SELECT
          Opportunity__c,
          Recommended_Margin__c,
          AI_Confidence__c,
          Win_Probability__c,
          Planned_Margin_At_Time__c,
          Source__c,
          Applied__c,
          Recommendation_Date__c
        FROM Fulcrum_Recommendation_History__c
        WHERE Id = :recId
        LIMIT 1
      ];

      System.assertEquals(
        opp.Id,
        rec.Opportunity__c,
        'Opportunity should match'
      );
      System.assertEquals(
        22.5,
        rec.Recommended_Margin__c,
        'Recommended margin should be 22.5'
      );
      System.assertEquals(
        85.0,
        rec.AI_Confidence__c,
        'AI confidence should be 85.0'
      );
      System.assertEquals(
        70.0,
        rec.Win_Probability__c,
        'Win probability should be 70.0'
      );
      System.assertEquals(
        18.0,
        rec.Planned_Margin_At_Time__c,
        'Planned margin at time should be 18.0'
      );
      System.assertEquals('Manual', rec.Source__c, 'Source should be Manual');
      System.assertEquals(true, rec.Applied__c, 'Applied should be true');
      System.assertNotEquals(
        null,
        rec.Recommendation_Date__c,
        'Recommendation date should be set'
      );
    }
  }

  @isTest
  static void testGetRecommendationHistory() {
    Opportunity opp = [
      SELECT Id
      FROM Opportunity
      WHERE Name = 'Enterprise Deal - Cisco'
      LIMIT 1
    ];

    // Insert 2 history records with different dates
    Fulcrum_Recommendation_History__c rec1 = new Fulcrum_Recommendation_History__c(
      Opportunity__c = opp.Id,
      Recommended_Margin__c = 20.0,
      AI_Confidence__c = 80.0,
      Win_Probability__c = 65.0,
      Planned_Margin_At_Time__c = 15.0,
      Source__c = 'API',
      Applied__c = false,
      Recommendation_Date__c = DateTime.now().addHours(-2)
    );
    Fulcrum_Recommendation_History__c rec2 = new Fulcrum_Recommendation_History__c(
      Opportunity__c = opp.Id,
      Recommended_Margin__c = 22.5,
      AI_Confidence__c = 85.0,
      Win_Probability__c = 70.0,
      Planned_Margin_At_Time__c = 18.0,
      Source__c = 'Manual',
      Applied__c = true,
      Recommendation_Date__c = DateTime.now()
    );
    insert new List<Fulcrum_Recommendation_History__c>{ rec1, rec2 };

    Test.startTest();
    List<Map<String, Object>> history = MarginArcController.getRecommendationHistory(
      opp.Id
    );
    Test.stopTest();

    System.assertEquals(2, history.size(), 'Should return 2 history records');
    // Most recent first (rec2 has later date)
    System.assertEquals(
      22.5,
      (Decimal) history[0].get('recommendedMargin'),
      'First record should be most recent'
    );
    System.assertEquals(
      20.0,
      (Decimal) history[1].get('recommendedMargin'),
      'Second record should be older'
    );
  }

  @isTest
  static void testSaveBomLines() {
    Opportunity opp = [SELECT Id FROM Opportunity LIMIT 1];

    String bomJson =
      '[' +
      '{"key":"hw-1","label":"Server","category":"Hardware","unit":"ea",' +
      '"quantity":2,"unitCost":5000,"unitPrice":6500,"listPrice":7000,' +
      '"extendedCost":10000,"extendedPrice":13000,"marginPct":0.23,' +
      '"recommendedMarginPct":0.22,"productNumber":"SRV-001","vendor":"Dell",' +
      '"note":"Primary server","origin":"generated"},' +
      '{"key":"sw-1","label":"OS License","category":"Software","unit":"ea",' +
      '"quantity":2,"unitCost":500,"unitPrice":750,"listPrice":800,' +
      '"extendedCost":1000,"extendedPrice":1500,"marginPct":0.33,' +
      '"recommendedMarginPct":null,"productNumber":"","vendor":"Microsoft",' +
      '"note":"","origin":"generated"}' +
      ']';

    User u = [SELECT Id FROM User WHERE Id = :UserInfo.getUserId()];
    System.runAs(u) {
      Test.startTest();
      MarginArcController.saveBomLines(opp.Id, bomJson);
      Test.stopTest();

      List<Fulcrum_BOM_Line__c> lines = [
        SELECT
          Line_Key__c,
          Description__c,
          Category__c,
          Quantity__c,
          Unit_Cost__c,
          Unit_Price__c,
          Margin_Pct__c,
          Sort_Order__c,
          BOM_Origin__c
        FROM Fulcrum_BOM_Line__c
        WHERE Opportunity__c = :opp.Id
        ORDER BY Sort_Order__c
      ];

      System.assertEquals(2, lines.size(), 'Should have 2 BOM lines');
      System.assertEquals('hw-1', lines[0].Line_Key__c);
      System.assertEquals('Server', lines[0].Description__c);
      System.assertEquals('Hardware', lines[0].Category__c);
      System.assertEquals(2, lines[0].Quantity__c);
      System.assertEquals(5000, lines[0].Unit_Cost__c);
      System.assertEquals(23, lines[0].Margin_Pct__c); // 0.23 * 100
      System.assertEquals(0, lines[0].Sort_Order__c);
      System.assertEquals('generated', lines[0].BOM_Origin__c);
      System.assertEquals('sw-1', lines[1].Line_Key__c);
      System.assertEquals(1, lines[1].Sort_Order__c);
    }
  }

  @isTest
  static void testSaveBomLinesReplacesExisting() {
    Opportunity opp = [SELECT Id FROM Opportunity LIMIT 1];

    User u = [SELECT Id FROM User WHERE Id = :UserInfo.getUserId()];
    System.runAs(u) {
      // Insert initial lines
      String bomJson1 =
        '[{"key":"hw-1","label":"Server","category":"Hardware","unit":"ea",' +
        '"quantity":1,"unitCost":1000,"unitPrice":1300,"listPrice":1500,' +
        '"extendedCost":1000,"extendedPrice":1300,"marginPct":0.23,' +
        '"recommendedMarginPct":0.22,"productNumber":"","vendor":"","note":"","origin":"generated"}]';
      MarginArcController.saveBomLines(opp.Id, bomJson1);

      // Replace with new lines
      String bomJson2 =
        '[{"key":"sw-1","label":"License","category":"Software","unit":"ea",' +
        '"quantity":5,"unitCost":200,"unitPrice":300,"listPrice":350,' +
        '"extendedCost":1000,"extendedPrice":1500,"marginPct":0.33,' +
        '"recommendedMarginPct":null,"productNumber":"","vendor":"","note":"","origin":"manual"}]';

      Test.startTest();
      MarginArcController.saveBomLines(opp.Id, bomJson2);
      Test.stopTest();

      List<Fulcrum_BOM_Line__c> lines = [
        SELECT Line_Key__c
        FROM Fulcrum_BOM_Line__c
        WHERE Opportunity__c = :opp.Id
      ];

      System.assertEquals(1, lines.size(), 'Should replace old lines with new');
      System.assertEquals('sw-1', lines[0].Line_Key__c);
    }
  }

  @isTest
  static void testGetBomLines() {
    Opportunity opp = [SELECT Id FROM Opportunity LIMIT 1];

    User u = [SELECT Id FROM User WHERE Id = :UserInfo.getUserId()];
    System.runAs(u) {
      // Insert test BOM lines directly
      List<Fulcrum_BOM_Line__c> testLines = new List<Fulcrum_BOM_Line__c>();
      testLines.add(
        new Fulcrum_BOM_Line__c(
          Opportunity__c = opp.Id,
          Line_Key__c = 'hw-1',
          Description__c = 'Server',
          Category__c = 'Hardware',
          Unit__c = 'ea',
          Quantity__c = 2,
          Unit_Cost__c = 5000,
          Unit_Price__c = 6500,
          Sort_Order__c = 0
        )
      );
      testLines.add(
        new Fulcrum_BOM_Line__c(
          Opportunity__c = opp.Id,
          Line_Key__c = 'sw-1',
          Description__c = 'License',
          Category__c = 'Software',
          Unit__c = 'ea',
          Quantity__c = 1,
          Unit_Cost__c = 500,
          Unit_Price__c = 750,
          Sort_Order__c = 1
        )
      );
      insert testLines;

      Test.startTest();
      List<Fulcrum_BOM_Line__c> result = MarginArcController.getBomLines(opp.Id);
      Test.stopTest();

      System.assertEquals(2, result.size());
      System.assertEquals('hw-1', result[0].Line_Key__c);
      System.assertEquals('sw-1', result[1].Line_Key__c);
    }
  }

  @isTest
  static void testGetBomLinesEmpty() {
    Opportunity opp = [SELECT Id FROM Opportunity LIMIT 1];

    User u = [SELECT Id FROM User WHERE Id = :UserInfo.getUserId()];
    System.runAs(u) {
      Test.startTest();
      List<Fulcrum_BOM_Line__c> result = MarginArcController.getBomLines(opp.Id);
      Test.stopTest();

      System.assertEquals(0, result.size());
    }
  }

  @isTest
  static void testCallMarginArcApiLicenseExpired() {
    // Set the license to expired
    Fulcrum_License__c license = Fulcrum_License__c.getOrgDefaults();
    license.Status__c = 'active';
    license.Expiry_Date__c = Date.today().addDays(-10);
    upsert license;

    // Reset the license gate cache so the new status takes effect
    MarginArcLicenseGate.resetCache();

    Test.setMock(HttpCalloutMock.class, new MarginArcMockSuccess());

    String payload = '{"input":{"oemCost":50000}}';

    Test.startTest();
    Boolean threw = false;
    try {
      MarginArcController.callMarginArcApi(payload);
    } catch (AuraHandledException e) {
      threw = true;
      System.assert(
        e.getMessage().contains('license'),
        'Exception should mention license, got: ' + e.getMessage()
      );
    }
    Test.stopTest();

    System.assertEquals(
      true,
      threw,
      'callMarginArcApi should throw AuraHandledException when license is expired'
    );
  }

  // -------------------------------------------------------------------------
  // BOM API Tests
  // -------------------------------------------------------------------------

  @isTest
  static void testSearchBomCatalogSuccess() {
    Test.setMock(HttpCalloutMock.class, new BomSearchMockSuccess());

    Test.startTest();
    String result = MarginArcController.searchBomCatalog('C9300', 'Cisco', null);
    Test.stopTest();

    System.assertNotEquals(null, result, 'Result should not be null');
    System.assert(result.contains('C9300-24P-A'), 'Result should contain part number');
    System.assert(result.contains('"total":1'), 'Result should contain total count');
  }

  @isTest
  static void testSearchBomCatalogError() {
    Test.setMock(HttpCalloutMock.class, new MarginArcMockError());

    Test.startTest();
    Boolean threw = false;
    try {
      MarginArcController.searchBomCatalog('C9300', null, null);
    } catch (AuraHandledException e) {
      threw = true;
      System.assert(e.getMessage().contains('BOM API error'), 'Error should mention BOM API');
    }
    Test.stopTest();

    System.assertEquals(true, threw, 'Should throw on API error');
  }

  @isTest
  static void testAnalyzeBomSuccess() {
    Test.setMock(HttpCalloutMock.class, new BomAnalyzeMockSuccess());

    String bomLines = '[{"partNumber":"C9300-24P-A","manufacturer":"Cisco","quantity":10,"unitCost":5484,"marginPct":15}]';
    String context = '{"oem":"Cisco","segment":"MidMarket"}';

    Test.startTest();
    String result = MarginArcController.analyzeBom(bomLines, context);
    Test.stopTest();

    System.assertNotEquals(null, result, 'Result should not be null');
    System.assert(result.contains('healthScore'), 'Result should contain healthScore');
    System.assert(result.contains('recommendations'), 'Result should contain recommendations');
  }

  @isTest
  static void testAnalyzeBomWithNullContext() {
    Test.setMock(HttpCalloutMock.class, new BomAnalyzeMockSuccess());

    String bomLines = '[{"partNumber":"C9300-24P-A","manufacturer":"Cisco","quantity":1,"unitCost":5484,"marginPct":15}]';

    Test.startTest();
    String result = MarginArcController.analyzeBom(bomLines, null);
    Test.stopTest();

    System.assertNotEquals(null, result, 'Result should not be null');
    System.assert(result.contains('lines'), 'Result should contain lines array');
  }

  @isTest
  static void testAnalyzeBomError() {
    Test.setMock(HttpCalloutMock.class, new MarginArcMockError());

    String bomLines = '[{"partNumber":"X","quantity":1,"unitCost":100,"marginPct":10}]';

    Test.startTest();
    Boolean threw = false;
    try {
      MarginArcController.analyzeBom(bomLines, null);
    } catch (AuraHandledException e) {
      threw = true;
      System.assert(e.getMessage().contains('BOM API error'), 'Error should mention BOM API');
    }
    Test.stopTest();

    System.assertEquals(true, threw, 'Should throw on API error');
  }
}
