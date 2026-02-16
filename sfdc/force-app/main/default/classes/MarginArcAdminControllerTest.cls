@isTest
private class MarginArcAdminControllerTest {
  // ── HttpCalloutMock for getConnectionStatus health check ──
  private class HealthCheckMock implements HttpCalloutMock {
    private Integer statusCode;

    HealthCheckMock(Integer statusCode) {
      this.statusCode = statusCode;
    }

    public HttpResponse respond(HttpRequest req) {
      HttpResponse res = new HttpResponse();
      res.setStatusCode(this.statusCode);
      res.setBody('{"status":"ok"}');
      return res;
    }
  }

  @TestSetup
  static void setupTestData() {
    // Assign Fulcrum_Admin permission set for FLS access in scratch orgs
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

    // Create OEM records
    List<Fulcrum_OEM__c> oems = new List<Fulcrum_OEM__c>();
    oems.add(
      new Fulcrum_OEM__c(
        Name = 'Cisco',
        Base_Margin__c = 15,
        Deal_Reg_Margin_Boost__c = 3,
        Services_Margin_Boost__c = 2,
        Quarter_End_Discount__c = 5,
        Product_Category__c = 'Networking'
      )
    );
    oems.add(
      new Fulcrum_OEM__c(
        Name = 'Palo Alto',
        Base_Margin__c = 12,
        Deal_Reg_Margin_Boost__c = 4,
        Services_Margin_Boost__c = 3,
        Quarter_End_Discount__c = 3,
        Product_Category__c = 'Security'
      )
    );
    insert oems;

    // Create Competitor records
    List<Fulcrum_Competitor__c> comps = new List<Fulcrum_Competitor__c>();
    comps.add(
      new Fulcrum_Competitor__c(
        Name = 'CDW',
        Primary_Strength__c = 'Scale',
        Primary_OEMs__c = 'Cisco;Palo Alto',
        Description__c = 'Large national VAR'
      )
    );
    comps.add(
      new Fulcrum_Competitor__c(
        Name = 'SHI',
        Primary_Strength__c = 'Price',
        Primary_OEMs__c = 'Dell;HPE',
        Description__c = 'Price-focused reseller'
      )
    );
    insert comps;

    // Create Opportunities for data health tests
    Account acc = new Account(Name = 'Test Account');
    insert acc;

    List<Opportunity> opps = new List<Opportunity>();
    // Opportunity with all MarginArc fields filled
    opps.add(
      new Opportunity(
        Name = 'Full Data Deal',
        AccountId = acc.Id,
        Amount = 100000,
        StageName = 'Prospecting',
        CloseDate = Date.today().addDays(30),
        Fulcrum_OEM__c = 'Cisco',
        Fulcrum_OEM_Cost__c = 80000,
        Fulcrum_Customer_Segment__c = 'Enterprise',
        Fulcrum_Deal_Reg_Type__c = 'StandardApproved',
        Fulcrum_Competitor_Names__c = 'CDW',
        Fulcrum_Recommended_Margin__c = 18
      )
    );
    // Opportunity with partial fields
    opps.add(
      new Opportunity(
        Name = 'Partial Data Deal',
        AccountId = acc.Id,
        Amount = 50000,
        StageName = 'Prospecting',
        CloseDate = Date.today().addDays(45),
        Fulcrum_OEM__c = 'Palo Alto'
      )
    );
    // Opportunity with no MarginArc fields
    opps.add(
      new Opportunity(
        Name = 'Empty Data Deal',
        AccountId = acc.Id,
        Amount = 25000,
        StageName = 'Prospecting',
        CloseDate = Date.today().addDays(60)
      )
    );
    insert opps;
  }

  @isTest
  static void testGetOemList() {
    Test.startTest();
    List<Fulcrum_OEM__c> oems = MarginArcAdminController.getOemList();
    Test.stopTest();

    System.assert(oems.size() >= 2, 'Should return at least 2 OEM records');
    // Verify sorted by Name
    System.assertEquals(
      'Cisco',
      oems[0].Name,
      'First OEM should be Cisco (sorted)'
    );
    System.assertEquals(
      'Palo Alto',
      oems[1].Name,
      'Second OEM should be Palo Alto (sorted)'
    );
  }

  @isTest
  static void testSaveOemInsert() {
    Test.startTest();
    Fulcrum_OEM__c newOem = new Fulcrum_OEM__c(
      Name = 'Dell',
      Base_Margin__c = 10,
      Deal_Reg_Margin_Boost__c = 2
    );
    Fulcrum_OEM__c result = MarginArcAdminController.saveOem(newOem);
    Test.stopTest();

    System.assertNotEquals(null, result.Id, 'Saved OEM should have an Id');
    System.assertEquals('Dell', result.Name, 'Name should be Dell');

    // Verify it was actually created
    List<Fulcrum_OEM__c> allOems = [
      SELECT Id
      FROM Fulcrum_OEM__c
      WHERE Name = 'Dell'
    ];
    System.assertEquals(1, allOems.size(), 'Should find 1 Dell OEM record');
  }

  @isTest
  static void testSaveOemUpdate() {
    Fulcrum_OEM__c existing = [
      SELECT Id, Name, Base_Margin__c
      FROM Fulcrum_OEM__c
      WHERE Name = 'Cisco'
      LIMIT 1
    ];
    existing.Base_Margin__c = 20;

    User u = [SELECT Id FROM User WHERE Id = :UserInfo.getUserId()];
    System.runAs(u) {
      Test.startTest();
      Fulcrum_OEM__c result = MarginArcAdminController.saveOem(existing);
      Test.stopTest();

      Fulcrum_OEM__c updated = [
        SELECT Base_Margin__c
        FROM Fulcrum_OEM__c
        WHERE Id = :existing.Id
      ];
      System.assertEquals(
        20,
        updated.Base_Margin__c,
        'Base margin should be updated to 20'
      );
    }
  }

  @isTest
  static void testDeleteOem() {
    Fulcrum_OEM__c toDelete = [
      SELECT Id
      FROM Fulcrum_OEM__c
      WHERE Name = 'Palo Alto'
      LIMIT 1
    ];
    Id deleteId = toDelete.Id;

    Test.startTest();
    MarginArcAdminController.deleteOem(deleteId);
    Test.stopTest();

    List<Fulcrum_OEM__c> remaining = [
      SELECT Id
      FROM Fulcrum_OEM__c
      WHERE Id = :deleteId
    ];
    System.assertEquals(
      0,
      remaining.size(),
      'Deleted OEM should no longer exist'
    );
  }

  @isTest
  static void testGetCompetitorList() {
    Test.startTest();
    List<Fulcrum_Competitor__c> comps = MarginArcAdminController.getCompetitorList();
    Test.stopTest();

    System.assert(
      comps.size() >= 2,
      'Should return at least 2 competitor records'
    );
    // Verify sorted by Name
    System.assertEquals(
      'CDW',
      comps[0].Name,
      'First competitor should be CDW (sorted)'
    );
    System.assertEquals(
      'SHI',
      comps[1].Name,
      'Second competitor should be SHI (sorted)'
    );
  }

  @isTest
  static void testSaveCompetitor() {
    User u = [SELECT Id FROM User WHERE Id = :UserInfo.getUserId()];
    System.runAs(u) {
      // Test insert
      Fulcrum_Competitor__c newComp = new Fulcrum_Competitor__c(
        Name = 'Presidio',
        Primary_Strength__c = 'Services',
        Primary_OEMs__c = 'Cisco'
      );

      Test.startTest();
      Fulcrum_Competitor__c inserted = MarginArcAdminController.saveCompetitor(
        newComp
      );
      Test.stopTest();

      System.assertNotEquals(
        null,
        inserted.Id,
        'Inserted competitor should have an Id'
      );

      // Test update
      inserted.Primary_Strength__c = 'Consulting';
      Fulcrum_Competitor__c updated = MarginArcAdminController.saveCompetitor(
        inserted
      );
      Fulcrum_Competitor__c reloaded = [
        SELECT Primary_Strength__c
        FROM Fulcrum_Competitor__c
        WHERE Id = :updated.Id
      ];
      System.assertEquals(
        'Consulting',
        reloaded.Primary_Strength__c,
        'Strength should be updated'
      );
    }
  }

  @isTest
  static void testDeleteCompetitor() {
    Fulcrum_Competitor__c toDelete = [
      SELECT Id
      FROM Fulcrum_Competitor__c
      WHERE Name = 'SHI'
      LIMIT 1
    ];
    Id deleteId = toDelete.Id;

    Test.startTest();
    MarginArcAdminController.deleteCompetitor(deleteId);
    Test.stopTest();

    List<Fulcrum_Competitor__c> remaining = [
      SELECT Id
      FROM Fulcrum_Competitor__c
      WHERE Id = :deleteId
    ];
    System.assertEquals(
      0,
      remaining.size(),
      'Deleted competitor should no longer exist'
    );
  }

  @isTest
  static void testGetDataHealth() {
    Test.startTest();
    Map<String, Object> health = MarginArcAdminController.getDataHealth();
    Test.stopTest();

    System.assertNotEquals(null, health, 'Health data should not be null');
    Integer totalOpps = (Integer) health.get('totalOpportunities');
    System.assert(totalOpps >= 3, 'Should have at least 3 open opportunities');

    // Verify field health data exists
    List<Object> fields = (List<Object>) health.get('fields');
    System.assertNotEquals(null, fields, 'fields list should exist');
    System.assert(fields.size() > 0, 'Should have field health entries');

    // Verify fill rates make sense
    for (Object f : fields) {
      Map<String, Object> field = (Map<String, Object>) f;
      Decimal rate = (Decimal) field.get('rate');
      System.assert(
        rate >= 0 && rate <= 100,
        'Fill rate should be 0-100, got: ' + rate
      );
      Integer filled = (Integer) field.get('filled');
      Integer total = (Integer) field.get('total');
      System.assert(filled <= total, 'Filled should not exceed total');
    }

    // Verify analyzed deals count
    if (health.containsKey('analyzedDeals')) {
      Integer analyzed = (Integer) health.get('analyzedDeals');
      System.assert(analyzed >= 0, 'Analyzed deals should be >= 0');
      Decimal analysisRate = (Decimal) health.get('analysisRate');
      System.assert(
        analysisRate >= 0 && analysisRate <= 100,
        'Analysis rate should be 0-100'
      );
    }
  }

  @isTest
  static void testGetDataHealthEmpty() {
    // Delete all open opportunities
    delete [SELECT Id FROM Opportunity WHERE IsClosed = FALSE];

    Test.startTest();
    Map<String, Object> health = MarginArcAdminController.getDataHealth();
    Test.stopTest();

    System.assertNotEquals(null, health, 'Health data should not be null');
    Integer totalOpps = (Integer) health.get('totalOpportunities');
    System.assertEquals(0, totalOpps, 'Should have 0 open opportunities');
    // fields should not be set when totalOpps is 0
    System.assertEquals(
      null,
      health.get('fields'),
      'fields should be null when no opportunities'
    );
  }

  @isTest
  static void testGetConnectionStatus() {
    // Insert a Fulcrum_Config__c org-default record
    Fulcrum_Config__c cfg = Fulcrum_Config__c.getOrgDefaults();
    cfg.API_URL__c = 'https://api.marginarc.com/api/recommend';
    cfg.API_Key__c = 'test-key-123';
    cfg.Gemini_API_Key__c = 'gemini-key-456';
    upsert cfg;

    Test.setMock(HttpCalloutMock.class, new HealthCheckMock(200));

    Test.startTest();
    Map<String, Object> status = MarginArcAdminController.getConnectionStatus();
    Test.stopTest();

    System.assertEquals(true, status.get('configured'), 'Should be configured');
    System.assertEquals(true, status.get('hasApiUrl'), 'Should have API URL');
    System.assertEquals(true, status.get('hasApiKey'), 'Should have API Key');
    System.assertEquals(
      true,
      status.get('hasGeminiKey'),
      'Should have Gemini Key'
    );
    System.assertEquals(
      true,
      status.get('apiReachable'),
      'API should be reachable'
    );
    System.assertEquals(
      200,
      status.get('apiStatus'),
      'API status should be 200'
    );
  }

  @isTest
  static void testGetConnectionStatusNoConfig() {
    // Ensure no config record exists (default in test context)
    Test.startTest();
    Map<String, Object> status = MarginArcAdminController.getConnectionStatus();
    Test.stopTest();

    System.assertNotEquals(null, status, 'Status should not be null');
    // In test context, getInstance() returns a record with null fields, not null itself
    // So we just verify the keys are present
    Boolean configured = (Boolean) status.get('configured');
    if (configured == false) {
      System.assertNotEquals(
        null,
        status.get('message'),
        'Should have a message when not configured'
      );
    } else {
      // Config exists but with blank fields
      System.assertEquals(
        false,
        status.get('hasApiUrl'),
        'Should not have API URL'
      );
      System.assertEquals(
        false,
        status.get('hasApiKey'),
        'Should not have API Key'
      );
    }
  }
}
