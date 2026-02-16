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
}
