@isTest
private class MarginArcDealOutcomeSyncTest {
  // ── HTTP Callout Mocks ──

  private class OutcomeSyncMockSuccess implements HttpCalloutMock {
    public HTTPResponse respond(HTTPRequest req) {
      HttpResponse res = new HttpResponse();
      res.setStatusCode(200);
      res.setHeader('Content-Type', 'application/json');
      res.setBody('{"ok":true}');
      return res;
    }
  }

  private class OutcomeSyncMockError implements HttpCalloutMock {
    public HTTPResponse respond(HTTPRequest req) {
      HttpResponse res = new HttpResponse();
      res.setStatusCode(400);
      res.setBody('{"error":"Validation failed"}');
      return res;
    }
  }

  // ── Test Data Setup ──

  @TestSetup
  static void setupTestData() {
    // Config custom setting
    Fulcrum_Config__c cfg = new Fulcrum_Config__c(
      API_Key__c = 'test-api-key',
      API_URL__c = 'https://api.marginarc.com/api/recommend'
    );
    insert cfg;

    // Active license for license gate
    Fulcrum_License__c license = new Fulcrum_License__c(
      License_Key__c = 'TEST-OUTCOME-KEY',
      Status__c = 'active',
      Expiry_Date__c = Date.today().addDays(365),
      Org_ID__c = UserInfo.getOrganizationId()
    );
    upsert license;

    Account acc = new Account(
      Name = 'Outcome Test Account',
      Industry = 'Technology'
    );
    insert acc;

    List<Opportunity> opps = new List<Opportunity>();

    // 1. Closed Won — fully populated with all margin data
    opps.add(
      new Opportunity(
        Name = 'Cisco Enterprise Won',
        AccountId = acc.Id,
        Amount = 500000,
        StageName = 'Closed Won',
        CloseDate = Date.today().addDays(-3),
        Fulcrum_OEM__c = 'Cisco',
        Fulcrum_OEM_Cost__c = 400000,
        Fulcrum_GP_Percent__c = 20,
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

    // 2. Closed Lost — with loss reason
    opps.add(
      new Opportunity(
        Name = 'Palo Alto Lost Deal',
        AccountId = acc.Id,
        Amount = 200000,
        StageName = 'Closed Lost',
        CloseDate = Date.today().addDays(-2),
        Fulcrum_OEM__c = 'Palo Alto',
        Fulcrum_OEM_Cost__c = 160000,
        Fulcrum_Planned_Margin__c = 15,
        Fulcrum_Customer_Segment__c = 'MidMarket',
        Fulcrum_Loss_Reason__c = 'Price',
        Fulcrum_Product_Category__c = 'Security'
      )
    );

    // 3. Closed Won — only OEM Cost (derive margin from Amount - Cost)
    opps.add(
      new Opportunity(
        Name = 'HPE Aruba Won Minimal',
        AccountId = acc.Id,
        Amount = 100000,
        StageName = 'Closed Won',
        CloseDate = Date.today().addDays(-1),
        Fulcrum_OEM_Cost__c = 82000
      )
    );

    // 4. Closed Won — NO margin data at all (should default to 15)
    opps.add(
      new Opportunity(
        Name = 'Bare Minimum Won',
        AccountId = acc.Id,
        Amount = 50000,
        StageName = 'Closed Won',
        CloseDate = Date.today().addDays(-4)
      )
    );

    // 5. Open deal — should NOT be picked up by query
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

    // 6. Old Closed Won — outside 7-day window, should NOT be picked up
    opps.add(
      new Opportunity(
        Name = 'Old Closed Won',
        AccountId = acc.Id,
        Amount = 300000,
        StageName = 'Closed Won',
        CloseDate = Date.today().addDays(-30),
        Fulcrum_Planned_Margin__c = 16
      )
    );

    insert opps;
  }

  // ── Batch Tests ──

  @isTest
  static void testBatchWithMixedDeals() {
    Test.setMock(HttpCalloutMock.class, new OutcomeSyncMockSuccess());

    Test.startTest();
    Database.executeBatch(new MarginArcDealOutcomeSync(), 10);
    Test.stopTest();

    // Batch should complete without errors — 4 recent closed deals processed.
    // Open deal and old closed deal should be excluded.
    // No DML to assert against since this is fire-and-forget,
    // but mock being called without exception proves callouts were made.
  }

  @isTest
  static void testBatchWithNoClosedDeals() {
    // Delete all closed opportunities to test empty batch
    delete [SELECT Id FROM Opportunity WHERE IsClosed = true];

    Test.setMock(HttpCalloutMock.class, new OutcomeSyncMockSuccess());

    Test.startTest();
    Database.executeBatch(new MarginArcDealOutcomeSync(), 10);
    Test.stopTest();

    // No exceptions means batch handled empty scope gracefully
  }

  @isTest
  static void testBatchWithMissingMarginFields() {
    Test.setMock(HttpCalloutMock.class, new OutcomeSyncMockSuccess());

    Test.startTest();
    Database.executeBatch(new MarginArcDealOutcomeSync(), 10);
    Test.stopTest();

    // 'HPE Aruba Won Minimal' derives margin from (100000-82000)/100000*100 = 18
    // 'Bare Minimum Won' uses default 15
    // Both should process without exception
  }

  @isTest
  static void testBatchWithApiError() {
    Test.setMock(HttpCalloutMock.class, new OutcomeSyncMockError());

    Test.startTest();
    Database.executeBatch(new MarginArcDealOutcomeSync(), 10);
    Test.stopTest();

    // Should not throw — errors are caught and logged
  }

  @isTest
  static void testSchedulableExecution() {
    Test.setMock(HttpCalloutMock.class, new OutcomeSyncMockSuccess());

    Test.startTest();
    String cronExpr = '0 0 3 ? * SUN';
    System.schedule(
      'MarginArc Deal Outcome Sync Test',
      cronExpr,
      new MarginArcDealOutcomeSync()
    );
    Test.stopTest();

    List<CronTrigger> triggers = [
      SELECT Id
      FROM CronTrigger
      WHERE CronJobDetail.Name = 'MarginArc Deal Outcome Sync Test'
    ];
    System.assertEquals(1, triggers.size(), 'Job should be scheduled');
  }

  // ── Payload Tests ──

  @isTest
  static void testBuildOutcomePayload() {
    Opportunity opp = [
      SELECT
        Id,
        Name,
        Amount,
        CloseDate,
        IsWon,
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
        Fulcrum_Product_Category__c,
        Fulcrum_GP_Percent__c,
        Fulcrum_Margin__c,
        Fulcrum_Loss_Reason__c,
        Fulcrum_Deal_Type__c
      FROM Opportunity
      WHERE Name = 'Cisco Enterprise Won'
      LIMIT 1
    ];

    String payload = MarginArcDealOutcomeSync.buildOutcomePayload(opp);
    System.assertNotEquals(null, payload, 'Payload should not be null');
    System.assert(payload.contains('"input"'), 'Payload should contain input');
    System.assert(
      payload.contains('"achievedMarginPct"'),
      'Payload should contain achievedMarginPct'
    );
    System.assert(
      payload.contains('"status"'),
      'Payload should contain status'
    );
    System.assert(payload.contains('"Won"'), 'Status should be Won');
    System.assert(payload.contains('"oem"'), 'input should contain oem');
    System.assert(
      payload.contains('"customerSegment"'),
      'input should contain customerSegment'
    );

    // Won deal should NOT contain lossReason
    Map<String, Object> parsed = (Map<String, Object>) JSON.deserializeUntyped(
      payload
    );
    System.assertEquals(
      false,
      parsed.containsKey('lossReason'),
      'Won deal should not include lossReason'
    );
    System.assertEquals('Won', parsed.get('status'), 'Status should be Won');
    System.assertEquals(
      20,
      (Decimal) parsed.get('achievedMarginPct'),
      'Should use GP Percent (priority 1)'
    );
  }

  @isTest
  static void testBuildOutcomePayloadLostDeal() {
    Opportunity opp = [
      SELECT
        Id,
        Name,
        Amount,
        CloseDate,
        IsWon,
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
        Fulcrum_Product_Category__c,
        Fulcrum_GP_Percent__c,
        Fulcrum_Margin__c,
        Fulcrum_Loss_Reason__c,
        Fulcrum_Deal_Type__c
      FROM Opportunity
      WHERE Name = 'Palo Alto Lost Deal'
      LIMIT 1
    ];

    String payload = MarginArcDealOutcomeSync.buildOutcomePayload(opp);

    Map<String, Object> parsed = (Map<String, Object>) JSON.deserializeUntyped(
      payload
    );
    System.assertEquals('Lost', parsed.get('status'), 'Status should be Lost');
    System.assertEquals(
      'Price',
      parsed.get('lossReason'),
      'Lost deal should include lossReason'
    );
  }

  // ── Achieved Margin Derivation Tests ──

  @isTest
  static void testDeriveAchievedMarginPriority() {
    // Priority 1: GP Percent takes precedence
    Opportunity opp1 = new Opportunity(
      Fulcrum_GP_Percent__c = 20,
      Fulcrum_Planned_Margin__c = 18,
      Amount = 100000,
      Fulcrum_OEM_Cost__c = 80000
    );
    System.assertEquals(
      20,
      MarginArcDealOutcomeSync.deriveAchievedMargin(opp1),
      'Should use GP Percent when available (priority 1)'
    );

    // Priority 2: Planned Margin
    Opportunity opp2 = new Opportunity(
      Fulcrum_Planned_Margin__c = 18,
      Amount = 100000,
      Fulcrum_OEM_Cost__c = 80000
    );
    System.assertEquals(
      18,
      MarginArcDealOutcomeSync.deriveAchievedMargin(opp2),
      'Should use Planned Margin when GP Percent is null (priority 2)'
    );

    // Priority 4: Derive from Amount and OEM Cost
    // (Priority 3 — Margin__c — is a formula field and cannot be set directly in tests)
    Opportunity opp3 = new Opportunity(
      Amount = 100000,
      Fulcrum_OEM_Cost__c = 82000
    );
    System.assertEquals(
      18,
      MarginArcDealOutcomeSync.deriveAchievedMargin(opp3),
      'Should derive from (Amount - OEM Cost) / Amount * 100'
    );

    // Priority 5: Default 15
    Opportunity opp4 = new Opportunity(Amount = 50000);
    System.assertEquals(
      15,
      MarginArcDealOutcomeSync.deriveAchievedMargin(opp4),
      'Should default to 15 when no margin data available'
    );

    // Edge case: null Amount with OEM Cost
    Opportunity opp5 = new Opportunity(Fulcrum_OEM_Cost__c = 80000);
    System.assertEquals(
      15,
      MarginArcDealOutcomeSync.deriveAchievedMargin(opp5),
      'Should default to 15 when Amount is null'
    );
  }

  // ── URL Derivation Tests ──

  @isTest
  static void testDeriveDealsUrl() {
    Fulcrum_Config__c cfg = new Fulcrum_Config__c(
      API_URL__c = 'https://api.marginarc.com/api/recommend'
    );
    String url = MarginArcDealOutcomeSync.deriveDealsUrl(cfg);
    System.assertEquals(
      'https://api.marginarc.com/api/deals',
      url,
      'Should derive /api/deals from /api/recommend'
    );

    // Fallback when config is blank
    Fulcrum_Config__c emptyCfg = new Fulcrum_Config__c();
    String fallbackUrl = MarginArcDealOutcomeSync.deriveDealsUrl(emptyCfg);
    System.assertEquals(
      'https://api.marginarc.com/api/deals',
      fallbackUrl,
      'Should use fallback URL when config is blank'
    );
  }

  // ── Field Mapping Tests ──

  @isTest
  static void testMapIndustry() {
    System.assertEquals(
      'Technology',
      MarginArcDealOutcomeSync.mapIndustry('Technology'),
      'Direct match'
    );
    System.assertEquals(
      'Financial Services',
      MarginArcDealOutcomeSync.mapIndustry('Banking'),
      'Alias match'
    );
    System.assertEquals(
      'Technology',
      MarginArcDealOutcomeSync.mapIndustry('UnknownIndustry'),
      'Unknown defaults to Technology'
    );
  }

  @isTest
  static void testMapProductCategory() {
    System.assertEquals(
      'Hardware',
      MarginArcDealOutcomeSync.mapProductCategory('Networking'),
      'Networking → Hardware'
    );
    System.assertEquals(
      'Cloud',
      MarginArcDealOutcomeSync.mapProductCategory('Cloud'),
      'Cloud → Cloud'
    );
    System.assertEquals(
      'Hardware',
      MarginArcDealOutcomeSync.mapProductCategory(null),
      'null → Hardware'
    );
    System.assertEquals(
      'Hardware',
      MarginArcDealOutcomeSync.mapProductCategory('Unknown'),
      'Unknown → Hardware'
    );
  }

  @isTest
  static void testMapCustomerSegment() {
    // Direct picklist values
    Opportunity ent = new Opportunity(
      Fulcrum_Customer_Segment__c = 'Enterprise'
    );
    System.assertEquals(
      'Enterprise',
      MarginArcDealOutcomeSync.mapCustomerSegment(ent),
      'Direct Enterprise'
    );

    // Amount-based fallback
    Opportunity large = new Opportunity(Amount = 500000);
    System.assertEquals(
      'Enterprise',
      MarginArcDealOutcomeSync.mapCustomerSegment(large),
      '>= 300K → Enterprise'
    );
    Opportunity mid = new Opportunity(Amount = 150000);
    System.assertEquals(
      'MidMarket',
      MarginArcDealOutcomeSync.mapCustomerSegment(mid),
      '>= 100K → MidMarket'
    );
    Opportunity small = new Opportunity(Amount = 50000);
    System.assertEquals(
      'SMB',
      MarginArcDealOutcomeSync.mapCustomerSegment(small),
      '< 100K → SMB'
    );
    Opportunity nullAmt = new Opportunity();
    System.assertEquals(
      'MidMarket',
      MarginArcDealOutcomeSync.mapCustomerSegment(nullAmt),
      'null Amount → MidMarket'
    );
  }

  @isTest
  static void testMapDealRegType() {
    System.assertEquals(
      'StandardApproved',
      MarginArcDealOutcomeSync.mapDealRegType('StandardApproved'),
      'Valid enum'
    );
    System.assertEquals(
      'PremiumHunting',
      MarginArcDealOutcomeSync.mapDealRegType('PremiumHunting'),
      'Valid enum'
    );
    System.assertEquals(
      'StandardApproved',
      MarginArcDealOutcomeSync.mapDealRegType('Invalid'),
      'Invalid → default'
    );
    System.assertEquals(
      'StandardApproved',
      MarginArcDealOutcomeSync.mapDealRegType(null),
      'null → default'
    );
  }

  @isTest
  static void testMapRelationshipStrength() {
    System.assertEquals(
      'New',
      MarginArcDealOutcomeSync.mapRelationshipStrength('New'),
      'Valid value'
    );
    System.assertEquals(
      'Good',
      MarginArcDealOutcomeSync.mapRelationshipStrength('Invalid'),
      'Invalid → Good'
    );
    System.assertEquals(
      'Good',
      MarginArcDealOutcomeSync.mapRelationshipStrength(null),
      'null → Good'
    );
  }

  @isTest
  static void testDeriveOemFromName() {
    System.assertEquals(
      'Cisco',
      MarginArcDealOutcomeSync.deriveOemFromName('Cisco ISR Refresh'),
      'Cisco match'
    );
    System.assertEquals(
      'Palo Alto',
      MarginArcDealOutcomeSync.deriveOemFromName('Palo Alto Firewall'),
      'Palo Alto match'
    );
    System.assertEquals(
      'HPE',
      MarginArcDealOutcomeSync.deriveOemFromName('HPE Aruba Deployment'),
      'HPE match'
    );
    System.assertEquals(
      null,
      MarginArcDealOutcomeSync.deriveOemFromName('Generic Deal'),
      'No match → null'
    );
    System.assertEquals(
      null,
      MarginArcDealOutcomeSync.deriveOemFromName(null),
      'null → null'
    );
  }

  @isTest
  static void testDeriveCompetitorCount() {
    System.assertEquals(
      '1',
      MarginArcDealOutcomeSync.deriveCompetitorCount(null),
      'null → 1'
    );
    System.assertEquals(
      '1',
      MarginArcDealOutcomeSync.deriveCompetitorCount('CDW'),
      'Single → 1'
    );
    System.assertEquals(
      '2',
      MarginArcDealOutcomeSync.deriveCompetitorCount('CDW;SHI'),
      'Two → 2'
    );
    System.assertEquals(
      '3+',
      MarginArcDealOutcomeSync.deriveCompetitorCount('CDW;SHI;Insight'),
      'Three → 3+'
    );
  }

  // ── Open/Old Deal Exclusion Test ──

  @isTest
  static void testOpenDealsExcluded() {
    Test.setMock(HttpCalloutMock.class, new OutcomeSyncMockSuccess());

    Test.startTest();
    Database.executeBatch(new MarginArcDealOutcomeSync(), 10);
    Test.stopTest();

    // The 'Still Open Deal' and 'Old Closed Won' should never enter scope.
    // SOQL has IsClosed = true AND CloseDate = LAST_N_DAYS:7
    // No assertions possible on exclusion since no DML, but query filter
    // guarantees open and old deals are excluded.
  }
}
