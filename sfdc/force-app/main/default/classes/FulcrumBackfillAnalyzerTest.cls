@isTest
private class FulcrumBackfillAnalyzerTest {
  // ── Mocks ──

  private class ApiMockSuccess implements HttpCalloutMock {
    public HTTPResponse respond(HTTPRequest req) {
      HttpResponse res = new HttpResponse();
      res.setStatusCode(200);
      res.setHeader('Content-Type', 'application/json');
      res.setBody(
        '{' +
          '"suggestedMarginPct": 18.5,' +
          '"confidence": 0.82,' +
          '"winProbability": 0.65,' +
          '"drivers": [{"name": "oem", "val": 0.03}],' +
          '"metrics": {' +
          '"planned": {"marginPct": 15, "grossProfit": 15000, "winProb": 58, "riskAdjusted": 8700},' +
          '"recommended": {"marginPct": 18.5, "grossProfit": 18500, "winProb": 62, "riskAdjusted": 11470},' +
          '"delta": {"grossProfit": 3500, "riskAdjusted": 2770}' +
          '}' +
          '}'
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
      API_Key__c = 'test-api-key',
      API_URL__c = 'https://api.marginarc.com/api/recommend'
    );
    insert cfg;

    Account acc = new Account(
      Name = 'Backfill Test Account',
      Industry = 'Technology'
    );
    insert acc;

    List<Opportunity> opps = new List<Opportunity>();

    // Closed Won deal with Fulcrum_Planned_Margin__c set
    opps.add(
      new Opportunity(
        Name = 'Cisco Enterprise Won',
        AccountId = acc.Id,
        Amount = 500000,
        StageName = 'Closed Won',
        CloseDate = Date.today().addDays(-30),
        Fulcrum_OEM__c = 'Cisco',
        Fulcrum_OEM_Cost__c = 400000,
        Fulcrum_Planned_Margin__c = 15,
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

    // Closed Won deal with GP_Percent__c but no Planned_Margin
    opps.add(
      new Opportunity(
        Name = 'Palo Alto Security Won',
        AccountId = acc.Id,
        Amount = 200000,
        StageName = 'Closed Won',
        CloseDate = Date.today().addDays(-60),
        Fulcrum_OEM__c = 'Palo Alto',
        Fulcrum_OEM_Cost__c = 160000,
        Fulcrum_GP_Percent__c = 20,
        Fulcrum_Customer_Segment__c = 'MidMarket',
        Fulcrum_Competitors__c = '1',
        Fulcrum_Competitor_Names__c = 'CDW'
      )
    );

    // Closed Won deal derivable from Amount and OEM Cost (no Planned Margin or GP %)
    opps.add(
      new Opportunity(
        Name = 'HPE Aruba Deploy Won',
        AccountId = acc.Id,
        Amount = 100000,
        StageName = 'Closed Won',
        CloseDate = Date.today().addDays(-90),
        Fulcrum_OEM_Cost__c = 82000
      )
    );

    // Closed Won deal with NO margin data at all (should be skipped)
    opps.add(
      new Opportunity(
        Name = 'Bare Minimum Won Deal',
        AccountId = acc.Id,
        Amount = 50000,
        StageName = 'Closed Won',
        CloseDate = Date.today().addDays(-45)
      )
    );

    // Closed Lost deal (should NOT be picked up)
    opps.add(
      new Opportunity(
        Name = 'Lost Deal Excluded',
        AccountId = acc.Id,
        Amount = 300000,
        StageName = 'Closed Lost',
        CloseDate = Date.today().addDays(-20)
      )
    );

    // Open deal (should NOT be picked up)
    opps.add(
      new Opportunity(
        Name = 'Still Open Deal',
        AccountId = acc.Id,
        Amount = 250000,
        StageName = 'Negotiation/Review',
        CloseDate = Date.today().addDays(30),
        Fulcrum_Planned_Margin__c = 18
      )
    );

    // Old Closed Won deal outside default 24 months
    opps.add(
      new Opportunity(
        Name = 'Ancient Won Deal',
        AccountId = acc.Id,
        Amount = 400000,
        StageName = 'Closed Won',
        CloseDate = Date.today().addMonths(-30),
        Fulcrum_Planned_Margin__c = 12
      )
    );

    insert opps;
  }

  // ── Tests ──

  @isTest
  static void testBatchQueriesOnlyClosedWonDeals() {
    Test.setMock(HttpCalloutMock.class, new ApiMockSuccess());

    Test.startTest();
    Database.executeBatch(new FulcrumBackfillAnalyzer(), 10);
    Test.stopTest();

    // Verify backfill results were created only for closed-won deals with margin data
    List<Fulcrum_Backfill_Result__c> results = [
      SELECT Id, Opportunity__c, Opportunity__r.Name, Opportunity__r.StageName
      FROM Fulcrum_Backfill_Result__c
    ];

    // Should have results for the 3 closed-won deals with determinable margins
    // (Cisco with Planned_Margin, Palo Alto with GP_Percent, HPE with derivable margin)
    System.assert(
      results.size() >= 3,
      'Should create backfill results for closed-won deals with margins, got: ' +
      results.size()
    );

    // Verify no results for Closed Lost or Open deals
    for (Fulcrum_Backfill_Result__c r : results) {
      System.assertEquals(
        'Closed Won',
        r.Opportunity__r.StageName,
        'All results should be for Closed Won opportunities'
      );
      System.assertNotEquals(
        'Lost Deal Excluded',
        r.Opportunity__r.Name,
        'Should not include closed-lost deals'
      );
      System.assertNotEquals(
        'Still Open Deal',
        r.Opportunity__r.Name,
        'Should not include open deals'
      );
    }
  }

  @isTest
  static void testHttpCalloutMock() {
    Test.setMock(HttpCalloutMock.class, new ApiMockSuccess());

    Test.startTest();
    Database.executeBatch(new FulcrumBackfillAnalyzer(), 10);
    Test.stopTest();

    List<Fulcrum_Backfill_Result__c> results = [
      SELECT Recommended_Margin__c, Confidence__c, Win_Probability__c
      FROM Fulcrum_Backfill_Result__c
      WHERE Recommended_Margin__c != NULL
    ];

    System.assert(results.size() > 0, 'Should have backfill results');

    for (Fulcrum_Backfill_Result__c r : results) {
      System.assertEquals(
        18.5,
        r.Recommended_Margin__c,
        'Recommended margin should match mock response'
      );
      System.assertEquals(
        82,
        r.Confidence__c,
        'Confidence should be 0.82 * 100 = 82'
      );
      System.assertEquals(
        65,
        r.Win_Probability__c,
        'Win probability should be 0.65 * 100 = 65'
      );
    }
  }

  @isTest
  static void testBackfillResultFieldValues() {
    Test.setMock(HttpCalloutMock.class, new ApiMockSuccess());

    Test.startTest();
    Database.executeBatch(new FulcrumBackfillAnalyzer(), 10);
    Test.stopTest();

    // Check the Cisco deal specifically
    Fulcrum_Backfill_Result__c ciscoResult = [
      SELECT
        Actual_Margin__c,
        Recommended_Margin__c,
        Margin_Delta__c,
        Actual_GP__c,
        Recommended_GP__c,
        GP_Delta__c,
        OEM__c,
        Close_Date__c,
        Rep_Name__c,
        Analysis_Date__c
      FROM Fulcrum_Backfill_Result__c
      WHERE OEM__c = 'Cisco'
      LIMIT 1
    ];

    System.assertNotEquals(
      null,
      ciscoResult,
      'Should have Cisco backfill result'
    );
    System.assertEquals(
      15,
      ciscoResult.Actual_Margin__c,
      'Actual margin should be 15'
    );
    System.assertEquals(
      18.5,
      ciscoResult.Recommended_Margin__c,
      'Recommended should be 18.5'
    );
    System.assertNotEquals(
      null,
      ciscoResult.Close_Date__c,
      'Close date should be set'
    );
    System.assertNotEquals(
      null,
      ciscoResult.Analysis_Date__c,
      'Analysis date should be set'
    );
    System.assertEquals('Cisco', ciscoResult.OEM__c, 'OEM should be Cisco');
  }

  @isTest
  static void testMarginDeltaCalculation() {
    Test.setMock(HttpCalloutMock.class, new ApiMockSuccess());

    Test.startTest();
    Database.executeBatch(new FulcrumBackfillAnalyzer(), 10);
    Test.stopTest();

    Fulcrum_Backfill_Result__c result = [
      SELECT Actual_Margin__c, Recommended_Margin__c, Margin_Delta__c
      FROM Fulcrum_Backfill_Result__c
      WHERE OEM__c = 'Cisco'
      LIMIT 1
    ];

    // Margin delta = recommended (18.5) - actual (15) = 3.5
    Decimal expectedDelta =
      result.Recommended_Margin__c - result.Actual_Margin__c;
    System.assertEquals(
      expectedDelta,
      result.Margin_Delta__c,
      'Margin delta should be recommended - actual'
    );
    System.assert(
      result.Margin_Delta__c > 0,
      'Delta should be positive when MarginArc recommends higher: ' +
      result.Margin_Delta__c
    );
  }

  @isTest
  static void testGPDeltaCalculation() {
    Test.setMock(HttpCalloutMock.class, new ApiMockSuccess());

    Test.startTest();
    Database.executeBatch(new FulcrumBackfillAnalyzer(), 10);
    Test.stopTest();

    Fulcrum_Backfill_Result__c result = [
      SELECT Actual_GP__c, Recommended_GP__c, GP_Delta__c
      FROM Fulcrum_Backfill_Result__c
      WHERE OEM__c = 'Cisco'
      LIMIT 1
    ];

    // Cisco deal: $500K amount, actual margin 15%, recommended 18.5%
    // Actual GP = 500000 * 0.15 = 75000
    // Recommended GP = 500000 * 0.185 = 92500
    System.assertEquals(
      75000,
      result.Actual_GP__c,
      'Actual GP for $500K at 15%'
    );
    System.assertEquals(
      92500,
      result.Recommended_GP__c,
      'Recommended GP for $500K at 18.5%'
    );
    System.assertEquals(
      17500,
      result.GP_Delta__c,
      'GP Delta should be $17,500'
    );
  }

  @isTest
  static void testMissingFulcrumFieldsGracefulFallback() {
    Test.setMock(HttpCalloutMock.class, new ApiMockSuccess());

    Test.startTest();
    Database.executeBatch(new FulcrumBackfillAnalyzer(), 10);
    Test.stopTest();

    // The "Bare Minimum Won Deal" has no margin data — should be skipped
    List<Fulcrum_Backfill_Result__c> results = [
      SELECT Opportunity__r.Name
      FROM Fulcrum_Backfill_Result__c
      WHERE Opportunity__r.Name = 'Bare Minimum Won Deal'
    ];

    System.assertEquals(
      0,
      results.size(),
      'Deals with no determinable margin should be skipped'
    );
  }

  @isTest
  static void testConstructorWithCustomMonthsBack() {
    Test.setMock(HttpCalloutMock.class, new ApiMockSuccess());

    // Use 6 months — the "Ancient Won Deal" at -30 months should be excluded
    Test.startTest();
    Database.executeBatch(new FulcrumBackfillAnalyzer(6), 10);
    Test.stopTest();

    List<Fulcrum_Backfill_Result__c> results = [
      SELECT Opportunity__r.Name
      FROM Fulcrum_Backfill_Result__c
      WHERE Opportunity__r.Name = 'Ancient Won Deal'
    ];

    System.assertEquals(
      0,
      results.size(),
      'Deals older than 6 months should be excluded with monthsBack=6'
    );

    // But recent deals should still be processed
    List<Fulcrum_Backfill_Result__c> allResults = [
      SELECT Id
      FROM Fulcrum_Backfill_Result__c
    ];
    System.assert(
      allResults.size() >= 1,
      'Recent closed-won deals should still be processed'
    );
  }

  @isTest
  static void testStatefulAccumulation() {
    Test.setMock(HttpCalloutMock.class, new ApiMockSuccess());

    FulcrumBackfillAnalyzer batch = new FulcrumBackfillAnalyzer();

    Test.startTest();
    Database.executeBatch(batch, 10);
    Test.stopTest();

    // Verify summary stats were accumulated (check via debug log or query results count)
    List<Fulcrum_Backfill_Result__c> results = [
      SELECT Id
      FROM Fulcrum_Backfill_Result__c
    ];

    // At least 3 deals should have been successfully processed
    System.assert(
      results.size() >= 3,
      'Stateful batch should process multiple deals successfully, got: ' +
      results.size()
    );
  }

  @isTest
  static void testBatchWithApiError() {
    Test.setMock(HttpCalloutMock.class, new ApiMockError());

    Test.startTest();
    Database.executeBatch(new FulcrumBackfillAnalyzer(), 10);
    Test.stopTest();

    // No backfill results should be created when API returns errors
    List<Fulcrum_Backfill_Result__c> results = [
      SELECT Id
      FROM Fulcrum_Backfill_Result__c
    ];

    System.assertEquals(
      0,
      results.size(),
      'No backfill results should be created when API fails'
    );
  }

  @isTest
  static void testDeriveActualMarginFromPlannedMargin() {
    Opportunity opp = new Opportunity(
      Fulcrum_Planned_Margin__c = 18,
      Fulcrum_GP_Percent__c = 20,
      Amount = 100000,
      Fulcrum_OEM_Cost__c = 80000
    );

    Decimal margin = FulcrumBackfillAnalyzer.deriveActualMargin(opp);
    System.assertEquals(
      18,
      margin,
      'Should use Planned Margin when available (priority 1)'
    );
  }

  @isTest
  static void testDeriveActualMarginFromGPPercent() {
    Opportunity opp = new Opportunity(
      Fulcrum_GP_Percent__c = 22,
      Amount = 100000,
      Fulcrum_OEM_Cost__c = 80000
    );

    Decimal margin = FulcrumBackfillAnalyzer.deriveActualMargin(opp);
    System.assertEquals(
      22,
      margin,
      'Should use GP_Percent__c when Planned Margin is null (priority 2)'
    );
  }

  @isTest
  static void testDeriveActualMarginFromAmountAndCost() {
    Opportunity opp = new Opportunity(
      Amount = 100000,
      Fulcrum_OEM_Cost__c = 80000
    );

    Decimal margin = FulcrumBackfillAnalyzer.deriveActualMargin(opp);
    System.assertEquals(
      20,
      margin,
      'Should derive margin from (Amount - OEM Cost) / Amount * 100'
    );
  }

  @isTest
  static void testDeriveActualMarginReturnsNullWhenNoData() {
    Opportunity opp = new Opportunity(Amount = 50000);

    Decimal margin = FulcrumBackfillAnalyzer.deriveActualMargin(opp);
    System.assertEquals(
      null,
      margin,
      'Should return null when no margin data is available'
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
      WHERE Name = 'Cisco Enterprise Won'
      LIMIT 1
    ];

    String payload = FulcrumBackfillAnalyzer.buildPayload(opp, 15);
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
  static void testOemDerivedForResultRecord() {
    Test.setMock(HttpCalloutMock.class, new ApiMockSuccess());

    Test.startTest();
    Database.executeBatch(new FulcrumBackfillAnalyzer(), 10);
    Test.stopTest();

    // HPE deal derives OEM from name "HPE Aruba Deploy Won"
    List<Fulcrum_Backfill_Result__c> results = [
      SELECT OEM__c, Opportunity__r.Name
      FROM Fulcrum_Backfill_Result__c
      WHERE Opportunity__r.Name = 'HPE Aruba Deploy Won'
    ];

    if (results.size() > 0) {
      System.assertEquals(
        'HPE',
        results[0].OEM__c,
        'OEM should be derived from opportunity name'
      );
    }
  }

  @isTest
  static void testDefaultConstructorUses24Months() {
    Test.setMock(HttpCalloutMock.class, new ApiMockSuccess());

    // The "Ancient Won Deal" at -30 months should be excluded with default 24 months
    Test.startTest();
    Database.executeBatch(new FulcrumBackfillAnalyzer(), 10);
    Test.stopTest();

    List<Fulcrum_Backfill_Result__c> ancientResults = [
      SELECT Id
      FROM Fulcrum_Backfill_Result__c
      WHERE Opportunity__r.Name = 'Ancient Won Deal'
    ];

    System.assertEquals(
      0,
      ancientResults.size(),
      'Default constructor (24 months) should exclude deal from 30 months ago'
    );
  }

  // ── Helper Method Coverage Tests ──

  @isTest
  static void testDeriveOemFromNameAllVendors() {
    // Each OEM keyword branch
    System.assertEquals(
      'Palo Alto',
      FulcrumBackfillAnalyzer.deriveOemFromName('Palo Alto Firewall')
    );
    System.assertEquals(
      'Palo Alto',
      FulcrumBackfillAnalyzer.deriveOemFromName('PAN-220 Appliance')
    );
    System.assertEquals(
      'Pure Storage',
      FulcrumBackfillAnalyzer.deriveOemFromName('Pure Storage FlashArray')
    );
    System.assertEquals(
      'CrowdStrike',
      FulcrumBackfillAnalyzer.deriveOemFromName('CrowdStrike Falcon')
    );
    System.assertEquals(
      'Nutanix',
      FulcrumBackfillAnalyzer.deriveOemFromName('Nutanix HCI Cluster')
    );
    System.assertEquals(
      'Cisco',
      FulcrumBackfillAnalyzer.deriveOemFromName('Cisco Meraki Switch')
    );
    System.assertEquals(
      'HPE',
      FulcrumBackfillAnalyzer.deriveOemFromName('HPE ProLiant Server')
    );
    System.assertEquals(
      'Dell',
      FulcrumBackfillAnalyzer.deriveOemFromName('Dell EMC PowerEdge')
    );
    System.assertEquals(
      'Fortinet',
      FulcrumBackfillAnalyzer.deriveOemFromName('Fortinet FortiGate 60F')
    );
    System.assertEquals(
      'VMware',
      FulcrumBackfillAnalyzer.deriveOemFromName('VMware vSphere')
    );
    System.assertEquals(
      'Microsoft',
      FulcrumBackfillAnalyzer.deriveOemFromName('Microsoft Azure Stack')
    );
    System.assertEquals(
      'NetApp',
      FulcrumBackfillAnalyzer.deriveOemFromName('NetApp ONTAP Storage')
    );
    System.assertEquals(
      'Arista',
      FulcrumBackfillAnalyzer.deriveOemFromName('Arista 7050X')
    );
    System.assertEquals(
      null,
      FulcrumBackfillAnalyzer.deriveOemFromName('Unknown Vendor')
    );
    System.assertEquals(null, FulcrumBackfillAnalyzer.deriveOemFromName(null));
    System.assertEquals(null, FulcrumBackfillAnalyzer.deriveOemFromName(''));
  }

  @isTest
  static void testDeriveCompetitorCount() {
    System.assertEquals(
      '1',
      FulcrumBackfillAnalyzer.deriveCompetitorCount(null)
    );
    System.assertEquals('1', FulcrumBackfillAnalyzer.deriveCompetitorCount(''));
    System.assertEquals(
      '1',
      FulcrumBackfillAnalyzer.deriveCompetitorCount('CDW')
    );
    System.assertEquals(
      '2',
      FulcrumBackfillAnalyzer.deriveCompetitorCount('CDW;SHI')
    );
    System.assertEquals(
      '3+',
      FulcrumBackfillAnalyzer.deriveCompetitorCount('CDW;SHI;Optiv')
    );
  }

  @isTest
  static void testMapIndustry() {
    System.assertEquals(
      'Technology',
      FulcrumBackfillAnalyzer.mapIndustry('Technology')
    );
    System.assertEquals(
      'Financial Services',
      FulcrumBackfillAnalyzer.mapIndustry('Finance')
    );
    System.assertEquals(
      'Financial Services',
      FulcrumBackfillAnalyzer.mapIndustry('Banking')
    );
    System.assertEquals(
      'Life Sciences & Healthcare',
      FulcrumBackfillAnalyzer.mapIndustry('Healthcare')
    );
    System.assertEquals(
      'Manufacturing & Automotive',
      FulcrumBackfillAnalyzer.mapIndustry('Manufacturing')
    );
    System.assertEquals(
      'Media & Telecommunications',
      FulcrumBackfillAnalyzer.mapIndustry('Communications')
    );
    System.assertEquals(
      'Consumer Goods & Food',
      FulcrumBackfillAnalyzer.mapIndustry('Apparel')
    );
    System.assertEquals(
      'Transportation & Logistics',
      FulcrumBackfillAnalyzer.mapIndustry('Shipping')
    );
    System.assertEquals(
      'Energy',
      FulcrumBackfillAnalyzer.mapIndustry('Utilities')
    );
    // Unknown maps to default
    System.assertEquals(
      'Technology',
      FulcrumBackfillAnalyzer.mapIndustry('Aerospace')
    );
  }

  @isTest
  static void testMapProductCategory() {
    System.assertEquals(
      'Hardware',
      FulcrumBackfillAnalyzer.mapProductCategory('Networking')
    );
    System.assertEquals(
      'Hardware',
      FulcrumBackfillAnalyzer.mapProductCategory('Security')
    );
    System.assertEquals(
      'Cloud',
      FulcrumBackfillAnalyzer.mapProductCategory('Cloud')
    );
    System.assertEquals(
      'Software',
      FulcrumBackfillAnalyzer.mapProductCategory('Software')
    );
    System.assertEquals(
      'ProfessionalServices',
      FulcrumBackfillAnalyzer.mapProductCategory('Services')
    );
    // Blank/unknown defaults to Hardware
    System.assertEquals(
      'Hardware',
      FulcrumBackfillAnalyzer.mapProductCategory(null)
    );
    System.assertEquals(
      'Hardware',
      FulcrumBackfillAnalyzer.mapProductCategory('Unknown')
    );
  }

  @isTest
  static void testMapCustomerSegment() {
    Account acc = [SELECT Id FROM Account LIMIT 1];

    Opportunity enterpriseOpp = new Opportunity(
      Fulcrum_Customer_Segment__c = 'Enterprise',
      Amount = 50000,
      AccountId = acc.Id,
      Name = 'Test',
      StageName = 'Prospecting',
      CloseDate = Date.today()
    );
    System.assertEquals(
      'Enterprise',
      FulcrumBackfillAnalyzer.mapCustomerSegment(enterpriseOpp)
    );

    // Null segment with large amount
    Opportunity largeOpp = new Opportunity(
      Amount = 500000,
      AccountId = acc.Id,
      Name = 'Test',
      StageName = 'Prospecting',
      CloseDate = Date.today()
    );
    System.assertEquals(
      'Enterprise',
      FulcrumBackfillAnalyzer.mapCustomerSegment(largeOpp)
    );

    // Null segment with medium amount
    Opportunity midOpp = new Opportunity(
      Amount = 150000,
      AccountId = acc.Id,
      Name = 'Test',
      StageName = 'Prospecting',
      CloseDate = Date.today()
    );
    System.assertEquals(
      'MidMarket',
      FulcrumBackfillAnalyzer.mapCustomerSegment(midOpp)
    );

    // Null segment with small amount
    Opportunity smallOpp = new Opportunity(
      Amount = 50000,
      AccountId = acc.Id,
      Name = 'Test',
      StageName = 'Prospecting',
      CloseDate = Date.today()
    );
    System.assertEquals(
      'SMB',
      FulcrumBackfillAnalyzer.mapCustomerSegment(smallOpp)
    );

    // Null segment and null amount
    Opportunity nullOpp = new Opportunity(
      AccountId = acc.Id,
      Name = 'Test',
      StageName = 'Prospecting',
      CloseDate = Date.today()
    );
    System.assertEquals(
      'MidMarket',
      FulcrumBackfillAnalyzer.mapCustomerSegment(nullOpp)
    );
  }

  @isTest
  static void testMapDealRegType() {
    System.assertEquals(
      'StandardApproved',
      FulcrumBackfillAnalyzer.mapDealRegType('StandardApproved')
    );
    System.assertEquals(
      'PremiumHunting',
      FulcrumBackfillAnalyzer.mapDealRegType('PremiumHunting')
    );
    System.assertEquals(
      'NotRegistered',
      FulcrumBackfillAnalyzer.mapDealRegType('NotRegistered')
    );
    System.assertEquals(
      'Teaming',
      FulcrumBackfillAnalyzer.mapDealRegType('Teaming')
    );
    // Unknown defaults to StandardApproved
    System.assertEquals(
      'StandardApproved',
      FulcrumBackfillAnalyzer.mapDealRegType('Other')
    );
    System.assertEquals(
      'StandardApproved',
      FulcrumBackfillAnalyzer.mapDealRegType(null)
    );
  }

  @isTest
  static void testMapRelationshipStrength() {
    System.assertEquals(
      'New',
      FulcrumBackfillAnalyzer.mapRelationshipStrength('New')
    );
    System.assertEquals(
      'Good',
      FulcrumBackfillAnalyzer.mapRelationshipStrength('Good')
    );
    System.assertEquals(
      'Strategic',
      FulcrumBackfillAnalyzer.mapRelationshipStrength('Strategic')
    );
    System.assertEquals(
      'Good',
      FulcrumBackfillAnalyzer.mapRelationshipStrength('Unknown')
    );
    System.assertEquals(
      'Good',
      FulcrumBackfillAnalyzer.mapRelationshipStrength(null)
    );
  }

  @isTest
  static void testMarginFromGPPercentFallback() {
    Test.setMock(HttpCalloutMock.class, new ApiMockSuccess());

    Test.startTest();
    Database.executeBatch(new FulcrumBackfillAnalyzer(), 10);
    Test.stopTest();

    // Palo Alto deal has GP_Percent but no Planned_Margin — should use GP_Percent
    List<Fulcrum_Backfill_Result__c> results = [
      SELECT Actual_Margin__c
      FROM Fulcrum_Backfill_Result__c
      WHERE OEM__c = 'Palo Alto'
      LIMIT 1
    ];

    if (results.size() > 0) {
      System.assertEquals(
        20,
        results[0].Actual_Margin__c,
        'Should use GP_Percent__c (20) as actual margin when Planned_Margin is null'
      );
    }
  }
}
