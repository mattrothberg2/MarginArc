@isTest
private class FulcrumBatchAnalyzerTest {
  // ── Mocks ──

  private class ApiMockSuccess implements HttpCalloutMock {
    public HTTPResponse respond(HTTPRequest req) {
      HttpResponse res = new HttpResponse();
      res.setStatusCode(200);
      res.setHeader('Content-Type', 'application/json');
      res.setBody(
        '{"suggestedMarginPct":22.5,"confidence":0.82,"winProbability":0.65,"drivers":[]}'
      );
      return res;
    }
  }

  private class ApiMockError implements HttpCalloutMock {
    public HTTPResponse respond(HTTPRequest req) {
      HttpResponse res = new HttpResponse();
      res.setStatusCode(400);
      res.setBody('{"error":"Validation failed"}');
      return res;
    }
  }

  // ── Test Setup ──

  @TestSetup
  static void setupTestData() {
    // Insert Custom Setting config for tests
    Fulcrum_Config__c cfg = new Fulcrum_Config__c(
      Gemini_API_Key__c = 'test-gemini-key',
      API_Key__c = 'test-api-key',
      API_URL__c = 'https://api.marginarc.com/api/recommend'
    );
    insert cfg;

    // Insert active license so license-gated batch execute() works in tests
    Fulcrum_License__c license = new Fulcrum_License__c(
      License_Key__c = 'TEST-LICENSE-KEY',
      Status__c = 'active',
      Expiry_Date__c = Date.today().addDays(365),
      Org_ID__c = UserInfo.getOrganizationId()
    );
    upsert license;

    Account acc = new Account(Name = 'Test Account', Industry = 'Technology');
    insert acc;

    List<Opportunity> opps = new List<Opportunity>();

    // Fully populated deal
    opps.add(
      new Opportunity(
        Name = 'Cisco Enterprise Refresh',
        AccountId = acc.Id,
        Amount = 500000,
        StageName = 'Negotiation/Review',
        CloseDate = Date.today().addDays(30),
        Fulcrum_OEM__c = 'Cisco',
        Fulcrum_OEM_Cost__c = 400000,
        Fulcrum_Planned_Margin__c = 18,
        Fulcrum_Customer_Segment__c = 'Enterprise',
        Fulcrum_Deal_Reg_Type__c = 'StandardApproved',
        Fulcrum_Competitors__c = '2',
        Fulcrum_Competitor_Names__c = 'CDW;SHI',
        Fulcrum_Solution_Complexity__c = 'High',
        Fulcrum_Relationship_Strength__c = 'Strategic',
        Fulcrum_Value_Add__c = 'High',
        Fulcrum_Services_Attached__c = true,
        Fulcrum_Product_Category__c = 'Networking'
      )
    );

    // Minimal deal (tests fallback/default paths)
    opps.add(
      new Opportunity(
        Name = 'Bare Minimum Deal',
        AccountId = acc.Id,
        Amount = 50000,
        StageName = 'Prospecting',
        CloseDate = Date.today().addDays(90)
      )
    );

    // Deal with OEM in name but no custom field
    opps.add(
      new Opportunity(
        Name = 'Palo Alto Firewall Deployment',
        AccountId = acc.Id,
        Amount = 200000,
        StageName = 'Qualification',
        CloseDate = Date.today().addDays(60)
      )
    );

    // Already-analyzed deal (should be skipped in incremental mode)
    opps.add(
      new Opportunity(
        Name = 'Already Analyzed Deal',
        AccountId = acc.Id,
        Amount = 100000,
        StageName = 'Proposal/Price Quote',
        CloseDate = Date.today().addDays(45),
        Fulcrum_OEM__c = 'HPE',
        Fulcrum_Recommended_Margin__c = 20
      )
    );

    // Closed deal (should never be picked up)
    opps.add(
      new Opportunity(
        Name = 'Closed Won Deal',
        AccountId = acc.Id,
        Amount = 300000,
        StageName = 'Closed Won',
        CloseDate = Date.today().addDays(-10),
        Fulcrum_OEM__c = 'Dell'
      )
    );

    insert opps;
  }

  // ── Tests ──

  @isTest
  static void testIncrementalBatchSuccess() {
    Test.setMock(HttpCalloutMock.class, new ApiMockSuccess());

    Test.startTest();
    Database.executeBatch(new FulcrumBatchAnalyzer(false), 10);
    Test.stopTest();

    // 3 open deals without Fulcrum_Recommended_Margin__c should be analyzed
    // "Already Analyzed" is skipped (already has Recommended Margin)
    List<Opportunity> analyzed = [
      SELECT
        Fulcrum_Recommended_Margin__c,
        Fulcrum_AI_Confidence__c,
        Fulcrum_Win_Probability__c
      FROM Opportunity
      WHERE
        IsClosed = FALSE
        AND Name != 'Already Analyzed Deal'
        AND Fulcrum_Recommended_Margin__c != NULL
    ];

    System.assert(analyzed.size() >= 3, 'Should analyze at least 3 deals');

    for (Opportunity opp : analyzed) {
      System.assertEquals(
        22.5,
        opp.Fulcrum_Recommended_Margin__c,
        'Should set recommended margin'
      );
      System.assertEquals(
        82,
        opp.Fulcrum_AI_Confidence__c,
        'Should set AI confidence (0.82 * 100)'
      );
      System.assertEquals(
        65,
        opp.Fulcrum_Win_Probability__c,
        'Should set win probability (0.65 * 100)'
      );
    }
  }

  @isTest
  static void testFullRefreshBatch() {
    Test.setMock(HttpCalloutMock.class, new ApiMockSuccess());

    Test.startTest();
    Database.executeBatch(new FulcrumBatchAnalyzer(true), 10);
    Test.stopTest();

    // Full refresh should include ALL open deals including already-analyzed
    List<Opportunity> analyzed = [
      SELECT Fulcrum_Recommended_Margin__c
      FROM Opportunity
      WHERE IsClosed = FALSE AND Fulcrum_Recommended_Margin__c = 22.5
    ];
    System.assert(
      analyzed.size() >= 4,
      'Full refresh should analyze all open deals'
    );
  }

  @isTest
  static void testBatchWithApiError() {
    Test.setMock(HttpCalloutMock.class, new ApiMockError());

    Test.startTest();
    Database.executeBatch(new FulcrumBatchAnalyzer(false), 10);
    Test.stopTest();

    // No new recommendations when API returns errors
    Opportunity cisco = [
      SELECT Fulcrum_Recommended_Margin__c
      FROM Opportunity
      WHERE Name = 'Cisco Enterprise Refresh'
      LIMIT 1
    ];
    System.assertEquals(
      null,
      cisco.Fulcrum_Recommended_Margin__c,
      'Should not set recommended margin when API fails'
    );
  }

  @isTest
  static void testClosedDealsExcluded() {
    Test.setMock(HttpCalloutMock.class, new ApiMockSuccess());

    Test.startTest();
    Database.executeBatch(new FulcrumBatchAnalyzer(true), 10);
    Test.stopTest();

    Opportunity closedDeal = [
      SELECT Fulcrum_Recommended_Margin__c
      FROM Opportunity
      WHERE Name = 'Closed Won Deal'
      LIMIT 1
    ];
    System.assertEquals(
      null,
      closedDeal.Fulcrum_Recommended_Margin__c,
      'Closed deal should not be analyzed'
    );
  }

  @isTest
  static void testSchedulableExecution() {
    Test.setMock(HttpCalloutMock.class, new ApiMockSuccess());

    Test.startTest();
    String cronExpr = '0 0 2 * * ?';
    System.schedule(
      'FulcrumBatchAnalyzerTest',
      cronExpr,
      new FulcrumBatchAnalyzer()
    );
    Test.stopTest();

    List<CronTrigger> triggers = [
      SELECT Id
      FROM CronTrigger
      WHERE CronJobDetail.Name = 'FulcrumBatchAnalyzerTest'
    ];
    System.assertEquals(1, triggers.size(), 'Job should be scheduled');
  }

  @isTest
  static void testOemDerivedFromName() {
    Test.setMock(HttpCalloutMock.class, new ApiMockSuccess());

    Test.startTest();
    Database.executeBatch(new FulcrumBatchAnalyzer(false), 10);
    Test.stopTest();

    // Palo Alto deal has no Fulcrum_OEM__c but OEM should be derived from name
    Opportunity paDeal = [
      SELECT Fulcrum_Recommended_Margin__c
      FROM Opportunity
      WHERE Name = 'Palo Alto Firewall Deployment'
      LIMIT 1
    ];
    System.assertNotEquals(
      null,
      paDeal.Fulcrum_Recommended_Margin__c,
      'Deal with OEM in name should be analyzed'
    );
  }

  @isTest
  static void testMapIndustry() {
    System.assertEquals(
      'Financial Services',
      FulcrumBatchAnalyzer.mapIndustry('Finance'),
      'Finance should map to Financial Services'
    );
    System.assertEquals(
      'Technology',
      FulcrumBatchAnalyzer.mapIndustry('Technology'),
      'Technology should map directly'
    );
    System.assertEquals(
      'Technology',
      FulcrumBatchAnalyzer.mapIndustry('Unknown Industry'),
      'Unknown industry should default to Technology'
    );
    System.assertEquals(
      'Life Sciences & Healthcare',
      FulcrumBatchAnalyzer.mapIndustry('Healthcare'),
      'Healthcare should map to Life Sciences & Healthcare'
    );
    System.assertEquals(
      'Manufacturing & Automotive',
      FulcrumBatchAnalyzer.mapIndustry('Manufacturing'),
      'Manufacturing should map correctly'
    );
    System.assertEquals(
      'Media & Telecommunications',
      FulcrumBatchAnalyzer.mapIndustry('Telecommunications'),
      'Telecom should map correctly'
    );
  }

  @isTest
  static void testMapProductCategory() {
    System.assertEquals(
      'Hardware',
      FulcrumBatchAnalyzer.mapProductCategory('Networking'),
      'Networking → Hardware'
    );
    System.assertEquals(
      'Cloud',
      FulcrumBatchAnalyzer.mapProductCategory('Cloud'),
      'Cloud → Cloud'
    );
    System.assertEquals(
      'Software',
      FulcrumBatchAnalyzer.mapProductCategory('Software'),
      'Software → Software'
    );
    System.assertEquals(
      'ProfessionalServices',
      FulcrumBatchAnalyzer.mapProductCategory('Services'),
      'Services → ProfessionalServices'
    );
    System.assertEquals(
      'Hardware',
      FulcrumBatchAnalyzer.mapProductCategory(null),
      'null → Hardware'
    );
    System.assertEquals(
      'Hardware',
      FulcrumBatchAnalyzer.mapProductCategory('Unknown'),
      'Unknown → Hardware'
    );
  }

  @isTest
  static void testMapCustomerSegment() {
    Opportunity enterprise = new Opportunity(
      Fulcrum_Customer_Segment__c = 'Enterprise',
      Amount = 10000
    );
    System.assertEquals(
      'Enterprise',
      FulcrumBatchAnalyzer.mapCustomerSegment(enterprise),
      'Direct Enterprise mapping'
    );

    Opportunity smb = new Opportunity(
      Fulcrum_Customer_Segment__c = 'SMB',
      Amount = 500000
    );
    System.assertEquals(
      'SMB',
      FulcrumBatchAnalyzer.mapCustomerSegment(smb),
      'Direct SMB mapping'
    );

    // Amount-based fallback
    Opportunity bigDeal = new Opportunity(Amount = 500000);
    System.assertEquals(
      'Enterprise',
      FulcrumBatchAnalyzer.mapCustomerSegment(bigDeal),
      '500K → Enterprise'
    );

    Opportunity midDeal = new Opportunity(Amount = 150000);
    System.assertEquals(
      'MidMarket',
      FulcrumBatchAnalyzer.mapCustomerSegment(midDeal),
      '150K → MidMarket'
    );

    Opportunity smallDeal = new Opportunity(Amount = 50000);
    System.assertEquals(
      'SMB',
      FulcrumBatchAnalyzer.mapCustomerSegment(smallDeal),
      '50K → SMB'
    );

    Opportunity nullAmount = new Opportunity();
    System.assertEquals(
      'MidMarket',
      FulcrumBatchAnalyzer.mapCustomerSegment(nullAmount),
      'null amount → MidMarket'
    );
  }

  @isTest
  static void testMapDealRegType() {
    System.assertEquals(
      'StandardApproved',
      FulcrumBatchAnalyzer.mapDealRegType('StandardApproved')
    );
    System.assertEquals(
      'PremiumHunting',
      FulcrumBatchAnalyzer.mapDealRegType('PremiumHunting')
    );
    System.assertEquals(
      'NotRegistered',
      FulcrumBatchAnalyzer.mapDealRegType('NotRegistered')
    );
    System.assertEquals(
      'Teaming',
      FulcrumBatchAnalyzer.mapDealRegType('Teaming')
    );
    System.assertEquals(
      'StandardApproved',
      FulcrumBatchAnalyzer.mapDealRegType('InvalidValue'),
      'Invalid → StandardApproved'
    );
    System.assertEquals(
      'StandardApproved',
      FulcrumBatchAnalyzer.mapDealRegType(null),
      'null → StandardApproved'
    );
  }

  @isTest
  static void testMapRelationshipStrength() {
    System.assertEquals(
      'New',
      FulcrumBatchAnalyzer.mapRelationshipStrength('New')
    );
    System.assertEquals(
      'Good',
      FulcrumBatchAnalyzer.mapRelationshipStrength('Good')
    );
    System.assertEquals(
      'Strategic',
      FulcrumBatchAnalyzer.mapRelationshipStrength('Strategic')
    );
    System.assertEquals(
      'Good',
      FulcrumBatchAnalyzer.mapRelationshipStrength('InvalidValue'),
      'Invalid → Good'
    );
  }

  @isTest
  static void testDeriveOemFromName() {
    System.assertEquals(
      'Palo Alto',
      FulcrumBatchAnalyzer.deriveOemFromName('Palo Alto Firewall Refresh')
    );
    System.assertEquals(
      'Cisco',
      FulcrumBatchAnalyzer.deriveOemFromName('Cisco Meraki Deployment')
    );
    System.assertEquals(
      'HPE',
      FulcrumBatchAnalyzer.deriveOemFromName('HPE Aruba Wireless')
    );
    System.assertEquals(
      'Dell',
      FulcrumBatchAnalyzer.deriveOemFromName('Dell EMC Storage')
    );
    System.assertEquals(
      'Fortinet',
      FulcrumBatchAnalyzer.deriveOemFromName('Fortinet FortiGate Install')
    );
    System.assertEquals(
      'VMware',
      FulcrumBatchAnalyzer.deriveOemFromName('VMware vSphere Upgrade')
    );
    System.assertEquals(
      'Microsoft',
      FulcrumBatchAnalyzer.deriveOemFromName('Microsoft Azure Migration')
    );
    System.assertEquals(
      'Pure Storage',
      FulcrumBatchAnalyzer.deriveOemFromName('Pure Storage FlashArray')
    );
    System.assertEquals(
      'CrowdStrike',
      FulcrumBatchAnalyzer.deriveOemFromName('CrowdStrike Falcon Deploy')
    );
    System.assertEquals(
      'Nutanix',
      FulcrumBatchAnalyzer.deriveOemFromName('Nutanix HCI Cluster')
    );
    System.assertEquals(
      'NetApp',
      FulcrumBatchAnalyzer.deriveOemFromName('NetApp ONTAP Upgrade')
    );
    System.assertEquals(
      'Arista',
      FulcrumBatchAnalyzer.deriveOemFromName('Arista EOS Switch')
    );
    System.assertEquals(
      null,
      FulcrumBatchAnalyzer.deriveOemFromName('Generic IT Project'),
      'No match → null'
    );
    System.assertEquals(
      null,
      FulcrumBatchAnalyzer.deriveOemFromName(null),
      'null → null'
    );
  }

  @isTest
  static void testDeriveCompetitorCount() {
    System.assertEquals(
      '1',
      FulcrumBatchAnalyzer.deriveCompetitorCount(null),
      'null → 1'
    );
    System.assertEquals(
      '1',
      FulcrumBatchAnalyzer.deriveCompetitorCount('CDW'),
      'Single → 1'
    );
    System.assertEquals(
      '2',
      FulcrumBatchAnalyzer.deriveCompetitorCount('CDW;SHI'),
      'Two → 2'
    );
    System.assertEquals(
      '3+',
      FulcrumBatchAnalyzer.deriveCompetitorCount('CDW;SHI;Presidio'),
      'Three → 3+'
    );
  }

  @isTest
  static void testBuildPayload() {
    Account acc = [SELECT Id FROM Account LIMIT 1];
    Opportunity opp = [
      SELECT
        Id,
        Name,
        Amount,
        Account.Name,
        Account.Industry,
        Fulcrum_OEM__c,
        Fulcrum_OEM_Cost__c,
        Fulcrum_Planned_Margin__c,
        Fulcrum_Customer_Segment__c,
        Fulcrum_Deal_Reg_Type__c,
        Fulcrum_Competitors__c,
        Fulcrum_Competitor_Names__c,
        Fulcrum_Solution_Complexity__c,
        Fulcrum_Relationship_Strength__c,
        Fulcrum_Value_Add__c,
        Fulcrum_Services_Attached__c,
        Fulcrum_Quarter_End__c,
        Fulcrum_Product_Category__c
      FROM Opportunity
      WHERE Name = 'Cisco Enterprise Refresh'
      LIMIT 1
    ];

    String payload = FulcrumBatchAnalyzer.buildPayload(opp);
    System.assertNotEquals(null, payload, 'Payload should not be null');
    System.assert(payload.contains('"oem"'), 'Payload should contain oem');
    System.assert(
      payload.contains('"customerSegment"'),
      'Payload should contain customerSegment'
    );
    System.assert(
      payload.contains('"plannedMarginPct"'),
      'Payload should contain plannedMarginPct'
    );
    System.assert(
      payload.contains('"customerIndustry"'),
      'Payload should contain customerIndustry'
    );
  }

  @isTest
  static void testAmountAndPlannedMarginUnchanged() {
    Test.setMock(HttpCalloutMock.class, new ApiMockSuccess());

    Opportunity before = [
      SELECT Amount, Fulcrum_Planned_Margin__c
      FROM Opportunity
      WHERE Name = 'Cisco Enterprise Refresh'
      LIMIT 1
    ];

    Test.startTest();
    Database.executeBatch(new FulcrumBatchAnalyzer(false), 10);
    Test.stopTest();

    Opportunity after = [
      SELECT Amount, Fulcrum_Planned_Margin__c
      FROM Opportunity
      WHERE Name = 'Cisco Enterprise Refresh'
      LIMIT 1
    ];

    System.assertEquals(
      before.Amount,
      after.Amount,
      'Batch must NOT change Amount'
    );
    System.assertEquals(
      before.Fulcrum_Planned_Margin__c,
      after.Fulcrum_Planned_Margin__c,
      'Batch must NOT change Planned Margin'
    );
  }

  @isTest
  static void testBatchCreatesHistoryRecords() {
    Test.setMock(HttpCalloutMock.class, new ApiMockSuccess());

    Test.startTest();
    Database.executeBatch(new FulcrumBatchAnalyzer(false), 10);
    Test.stopTest();

    // Incremental batch should create history records for the 3 open deals
    // that didn't already have Fulcrum_Recommended_Margin__c
    List<Fulcrum_Recommendation_History__c> historyRecords = [
      SELECT
        Id,
        Opportunity__c,
        Recommended_Margin__c,
        AI_Confidence__c,
        Win_Probability__c,
        Source__c,
        Applied__c,
        Recommendation_Date__c
      FROM Fulcrum_Recommendation_History__c
      WHERE Source__c = 'Batch'
    ];

    System.assert(
      historyRecords.size() >= 3,
      'Should create history records for successfully analyzed deals, got: ' +
      historyRecords.size()
    );

    for (Fulcrum_Recommendation_History__c rec : historyRecords) {
      System.assertEquals('Batch', rec.Source__c, 'Source should be Batch');
      System.assertEquals(false, rec.Applied__c, 'Applied should be false');
      System.assertNotEquals(
        null,
        rec.Recommendation_Date__c,
        'Recommendation date should be set'
      );
      System.assertNotEquals(
        null,
        rec.Recommended_Margin__c,
        'Recommended margin should be set'
      );
    }
  }
}
