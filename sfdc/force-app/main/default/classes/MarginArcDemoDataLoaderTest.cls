@isTest
private class MarginArcDemoDataLoaderTest {
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
  }

  @isTest
  static void testLoadDemoData() {
    User u = [SELECT Id FROM User WHERE Id = :UserInfo.getUserId()];
    System.runAs(u) {
      Test.startTest();
      Map<String, Object> result = MarginArcDemoDataLoader.loadDemoData();
      Test.stopTest();

      System.assertEquals(true, result.get('success'), 'Should succeed');
      System.assertEquals(
        false,
        result.get('alreadyLoaded'),
        'Should not be already loaded'
      );
      System.assertEquals(
        8,
        result.get('accounts'),
        'Should create 8 accounts'
      );
      System.assertEquals(10, result.get('oems'), 'Should create 10 OEMs');
      System.assertEquals(
        10,
        result.get('competitors'),
        'Should create 10 competitors'
      );

      // Verify opportunity count is around 30
      Integer oppCount = (Integer) result.get('opportunities');
      System.assert(
        oppCount >= 28 && oppCount <= 32,
        'Should create ~30 opportunities, got: ' + oppCount
      );

      // Verify accounts exist
      List<Account> accounts = [
        SELECT Name
        FROM Account
        WHERE Name LIKE '%(Demo)%'
      ];
      System.assertEquals(8, accounts.size(), 'Should find 8 demo accounts');

      // Verify OEMs exist
      List<Fulcrum_OEM__c> oems = [SELECT Name FROM Fulcrum_OEM__c];
      System.assertEquals(10, oems.size(), 'Should find 10 OEMs');

      // Verify competitors exist
      List<Fulcrum_Competitor__c> comps = [
        SELECT Name
        FROM Fulcrum_Competitor__c
      ];
      System.assertEquals(10, comps.size(), 'Should find 10 competitors');

      // Verify mix of stages
      List<Opportunity> openOpps = [
        SELECT Id
        FROM Opportunity
        WHERE IsClosed = FALSE
      ];
      List<Opportunity> wonOpps = [
        SELECT Id
        FROM Opportunity
        WHERE StageName = 'Closed Won'
      ];
      List<Opportunity> lostOpps = [
        SELECT Id
        FROM Opportunity
        WHERE StageName = 'Closed Lost'
      ];
      System.assert(openOpps.size() >= 8, 'Should have at least 8 open deals');
      System.assert(wonOpps.size() >= 10, 'Should have at least 10 won deals');
      System.assert(lostOpps.size() >= 6, 'Should have at least 6 lost deals');
    }
  }

  @isTest
  static void testLoadDemoDataIdempotent() {
    User u = [SELECT Id FROM User WHERE Id = :UserInfo.getUserId()];
    System.runAs(u) {
      // First load
      MarginArcDemoDataLoader.loadDemoData();

      Test.startTest();
      // Second load should detect existing data
      Map<String, Object> result = MarginArcDemoDataLoader.loadDemoData();
      Test.stopTest();

      System.assertEquals(true, result.get('success'), 'Should succeed');
      System.assertEquals(
        true,
        result.get('alreadyLoaded'),
        'Should detect already loaded'
      );

      // Verify no duplicates
      List<Account> accounts = [
        SELECT Name
        FROM Account
        WHERE Name LIKE '%(Demo)%'
      ];
      System.assertEquals(
        8,
        accounts.size(),
        'Should still have only 8 demo accounts'
      );
    }
  }

  @isTest
  static void testLoadDemoDataReturnValues() {
    User u = [SELECT Id FROM User WHERE Id = :UserInfo.getUserId()];
    System.runAs(u) {
      Test.startTest();
      Map<String, Object> result = MarginArcDemoDataLoader.loadDemoData();
      Test.stopTest();

      System.assert(result.containsKey('success'), 'Should have success key');
      System.assert(result.containsKey('message'), 'Should have message key');
      System.assert(
        result.containsKey('accounts'),
        'Should have accounts count'
      );
      System.assert(
        result.containsKey('opportunities'),
        'Should have opportunities count'
      );
      System.assert(result.containsKey('oems'), 'Should have oems count');
      System.assert(
        result.containsKey('competitors'),
        'Should have competitors count'
      );

      String message = (String) result.get('message');
      System.assert(String.isNotBlank(message), 'Message should not be blank');
    }
  }

  @isTest
  static void testClearDemoData() {
    User u = [SELECT Id FROM User WHERE Id = :UserInfo.getUserId()];
    System.runAs(u) {
      // Load demo data first
      MarginArcDemoDataLoader.loadDemoData();

      // Verify data exists
      List<Account> accountsBefore = [
        SELECT Id
        FROM Account
        WHERE Name LIKE '%(Demo)%'
      ];
      System.assert(
        accountsBefore.size() > 0,
        'Should have demo accounts before clear'
      );

      Test.startTest();
      Map<String, Object> result = MarginArcDemoDataLoader.clearDemoData();
      Test.stopTest();

      System.assertEquals(true, result.get('success'), 'Clear should succeed');
      System.assert(
        result.containsKey('accounts'),
        'Should have accounts count'
      );
      System.assert(
        result.containsKey('opportunities'),
        'Should have opportunities count'
      );
      System.assert(result.containsKey('message'), 'Should have message');

      // Verify data is gone
      List<Account> accountsAfter = [
        SELECT Id
        FROM Account
        WHERE Name LIKE '%(Demo)%'
      ];
      System.assertEquals(
        0,
        accountsAfter.size(),
        'Should have no demo accounts after clear'
      );

      List<Opportunity> oppsAfter = [
        SELECT Id
        FROM Opportunity
        WHERE Account.Name LIKE '%(Demo)%'
      ];
      System.assertEquals(
        0,
        oppsAfter.size(),
        'Should have no demo opportunities after clear'
      );

      List<Fulcrum_OEM__c> oemsAfter = [SELECT Id FROM Fulcrum_OEM__c];
      System.assertEquals(
        0,
        oemsAfter.size(),
        'Should have no OEMs after clear'
      );

      List<Fulcrum_Competitor__c> compsAfter = [
        SELECT Id
        FROM Fulcrum_Competitor__c
      ];
      System.assertEquals(
        0,
        compsAfter.size(),
        'Should have no competitors after clear'
      );
    }
  }

  @isTest
  static void testClearDemoDataWhenEmpty() {
    User u = [SELECT Id FROM User WHERE Id = :UserInfo.getUserId()];
    System.runAs(u) {
      Test.startTest();
      Map<String, Object> result = MarginArcDemoDataLoader.clearDemoData();
      Test.stopTest();

      System.assertEquals(
        true,
        result.get('success'),
        'Clear should succeed even when empty'
      );
      System.assertEquals(
        0,
        result.get('accounts'),
        'Should report 0 accounts'
      );
      System.assertEquals(
        0,
        result.get('opportunities'),
        'Should report 0 opportunities'
      );
    }
  }

  @isTest
  static void testLoadScenarioDataInvalidScenario() {
    User u = [SELECT Id FROM User WHERE Id = :UserInfo.getUserId()];
    System.runAs(u) {
      Test.startTest();
      Map<String, Object> result = MarginArcDemoDataLoader.loadScenarioData(
        'invalid-scenario',
        250
      );
      Test.stopTest();

      System.assertEquals(
        false,
        result.get('success'),
        'Should fail for invalid scenario'
      );
      String message = (String) result.get('message');
      System.assert(
        message.contains('Invalid scenario'),
        'Should mention invalid scenario: ' + message
      );
    }
  }

  @isTest
  static void testLoadScenarioDataNoConfig() {
    User u = [SELECT Id FROM User WHERE Id = :UserInfo.getUserId()];
    System.runAs(u) {
      Test.startTest();
      Map<String, Object> result = MarginArcDemoDataLoader.loadScenarioData(
        'networking-var',
        250
      );
      Test.stopTest();

      System.assertEquals(
        false,
        result.get('success'),
        'Should fail when config not set'
      );
      String message = (String) result.get('message');
      System.assert(
        message.contains('API URL'),
        'Should mention API URL not configured: ' + message
      );
    }
  }

  @isTest
  static void testLoadScenarioDataIdempotent() {
    User u = [SELECT Id FROM User WHERE Id = :UserInfo.getUserId()];
    System.runAs(u) {
      // Create a demo account to trigger idempotency check
      insert new Account(Name = 'Test Account (Demo)', Industry = 'Technology');

      Test.startTest();
      Map<String, Object> result = MarginArcDemoDataLoader.loadScenarioData(
        'networking-var',
        100
      );
      Test.stopTest();

      System.assertEquals(true, result.get('success'), 'Should succeed');
      System.assertEquals(
        true,
        result.get('alreadyLoaded'),
        'Should detect existing demo data'
      );
    }
  }

  @isTest
  static void testLoadScenarioDataWithMockCallout() {
    User u = [SELECT Id FROM User WHERE Id = :UserInfo.getUserId()];
    System.runAs(u) {
      // Set up the config custom setting with test values
      Fulcrum_Config__c config = Fulcrum_Config__c.getOrgDefaults();
      config.API_URL__c = 'https://api.marginarc.com';
      config.API_Key__c = 'test-key';
      upsert config;

      // Set up mock HTTP callout
      Test.setMock(HttpCalloutMock.class, new ScenarioDataMock());

      Test.startTest();
      Map<String, Object> result = MarginArcDemoDataLoader.loadScenarioData(
        'networking-var',
        100
      );
      Test.stopTest();

      System.assertEquals(true, result.get('success'), 'Should succeed');
      System.assertEquals(
        false,
        result.get('alreadyLoaded'),
        'Should not be already loaded'
      );
      System.assertEquals(
        'networking-var',
        result.get('scenario'),
        'Should return scenario name'
      );
      System.assert(
        result.containsKey('opportunities'),
        'Should have opportunities count'
      );
      System.assert(
        result.containsKey('jobId'),
        'Should have jobId for queueable'
      );

      // Verify OEMs and competitors were created
      List<Fulcrum_OEM__c> oems = [SELECT Id FROM Fulcrum_OEM__c];
      System.assertEquals(10, oems.size(), 'Should create 10 OEMs');

      List<Fulcrum_Competitor__c> comps = [
        SELECT Id
        FROM Fulcrum_Competitor__c
      ];
      System.assertEquals(10, comps.size(), 'Should create 10 competitors');
    }
  }

  // Mock HTTP callout for scenario data endpoint
  private class ScenarioDataMock implements HttpCalloutMock {
    public HttpResponse respond(HttpRequest req) {
      HttpResponse res = new HttpResponse();
      res.setHeader('Content-Type', 'application/json');
      res.setStatusCode(200);
      res.setBody(
        '{"success":true,"scenario":"networking-var","count":3,"uniqueAccounts":2,"deals":[' +
          '{"name":"Acme - Cisco Q1","accountName":"Acme Corp","accountIndustry":"Technology","stageName":"Closed Won","amount":150000,"closeDate":"2024-01-15","oem":"Cisco","oemCost":120000,"customerSegment":"Enterprise","dealRegType":"StandardApproved","competitorNames":"CDW","solutionComplexity":"Medium","relationshipStrength":"Good","servicesAttached":true,"productCategory":"Networking","plannedMargin":18,"gpPercent":20,"lossReason":null,"dealType":"New Business"},' +
          '{"name":"Beta - Palo Alto Q2","accountName":"Beta Inc","accountIndustry":"Healthcare","stageName":"Negotiation/Review","amount":95000,"closeDate":"2024-06-30","oem":"Palo Alto","oemCost":72000,"customerSegment":"MidMarket","dealRegType":"PremiumHunting","competitorNames":"Optiv","solutionComplexity":"High","relationshipStrength":"New","servicesAttached":false,"productCategory":"Security","plannedMargin":22,"gpPercent":null,"lossReason":null,"dealType":"Expansion"},' +
          '{"name":"Acme - Fortinet Q3","accountName":"Acme Corp","accountIndustry":"Technology","stageName":"Closed Lost","amount":65000,"closeDate":"2024-09-15","oem":"Fortinet","oemCost":50000,"customerSegment":"SMB","dealRegType":"NotRegistered","competitorNames":"Zones","solutionComplexity":"Low","relationshipStrength":"New","servicesAttached":false,"productCategory":"Security","plannedMargin":20,"gpPercent":null,"lossReason":"Price","dealType":"New Business"}' +
          ']}'
      );
      return res;
    }
  }
}
