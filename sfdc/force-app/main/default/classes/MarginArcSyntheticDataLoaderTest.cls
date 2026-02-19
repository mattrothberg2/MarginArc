@isTest
private class MarginArcSyntheticDataLoaderTest {
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
  static void testLoadSyntheticData() {
    User u = [SELECT Id FROM User WHERE Id = :UserInfo.getUserId()];
    System.runAs(u) {
      Test.startTest();
      Map<String, Object> result = MarginArcSyntheticDataLoader.loadSyntheticData();
      Test.stopTest();

      System.assertEquals(true, result.get('success'), 'Should succeed');
      System.assertEquals(
        false,
        result.get('alreadyLoaded'),
        'Should not be already loaded'
      );
      System.assertEquals(
        5,
        result.get('accounts'),
        'Should create 5 accounts'
      );

      // Verify total deals generated
      Integer oppCount = (Integer) result.get('opportunities');
      System.assert(
        oppCount >= 1000 && oppCount <= 1400,
        'Should generate 1000-1400 opportunities, got: ' + oppCount
      );

      // Verify job was enqueued
      System.assert(
        result.containsKey('jobId'),
        'Should have a jobId for the queueable'
      );

      // Verify accounts exist with (Synthetic) suffix
      List<Account> accounts = [
        SELECT Name
        FROM Account
        WHERE Name LIKE '%(Synthetic)%'
      ];
      System.assertEquals(5, accounts.size(), 'Should find 5 synthetic accounts');

      // Verify first batch of opportunities was inserted by the queueable
      // (Test.stopTest() forces synchronous execution of the first queueable)
      List<Opportunity> opps = [
        SELECT Id, StageName, Fulcrum_OEM__c, Fulcrum_Customer_Segment__c,
               Fulcrum_Planned_Margin__c, Fulcrum_OEM_Cost__c
        FROM Opportunity
        WHERE Account.Name LIKE '%(Synthetic)%'
      ];
      System.assert(
        opps.size() > 0,
        'Should have inserted at least one batch of opportunities'
      );

      // Verify opportunities have the required custom fields populated
      for (Opportunity opp : opps) {
        System.assert(
          opp.Fulcrum_OEM__c != null,
          'OEM should be populated for: ' + opp.Id
        );
        System.assert(
          opp.Fulcrum_Customer_Segment__c != null,
          'Customer Segment should be populated for: ' + opp.Id
        );
        System.assert(
          opp.Fulcrum_Planned_Margin__c != null,
          'Planned Margin should be populated for: ' + opp.Id
        );
        System.assert(
          opp.Fulcrum_OEM_Cost__c != null,
          'OEM Cost should be populated for: ' + opp.Id
        );
      }

      // Verify mix of Won and Lost
      List<Opportunity> wonOpps = [
        SELECT Id FROM Opportunity
        WHERE Account.Name LIKE '%(Synthetic)%'
        AND StageName = 'Closed Won'
      ];
      List<Opportunity> lostOpps = [
        SELECT Id FROM Opportunity
        WHERE Account.Name LIKE '%(Synthetic)%'
        AND StageName = 'Closed Lost'
      ];
      System.assert(
        wonOpps.size() > 0,
        'Should have some Closed Won opportunities'
      );
      System.assert(
        lostOpps.size() > 0,
        'Should have some Closed Lost opportunities'
      );
    }
  }

  @isTest
  static void testLoadSyntheticDataIdempotent() {
    User u = [SELECT Id FROM User WHERE Id = :UserInfo.getUserId()];
    System.runAs(u) {
      // Create sentinel account to trigger idempotency
      insert new Account(
        Name = 'Regeneron Pharmaceuticals (Synthetic)',
        Industry = 'Biotechnology'
      );

      Test.startTest();
      Map<String, Object> result = MarginArcSyntheticDataLoader.loadSyntheticData();
      Test.stopTest();

      System.assertEquals(true, result.get('success'), 'Should succeed');
      System.assertEquals(
        true,
        result.get('alreadyLoaded'),
        'Should detect existing synthetic data'
      );

      // Verify no additional accounts were created
      List<Account> accounts = [
        SELECT Id FROM Account
        WHERE Name LIKE '%(Synthetic)%'
      ];
      System.assertEquals(
        1,
        accounts.size(),
        'Should still have only 1 synthetic account'
      );
    }
  }

  @isTest
  static void testClearSyntheticData() {
    User u = [SELECT Id FROM User WHERE Id = :UserInfo.getUserId()];
    System.runAs(u) {
      // First load synthetic data
      Test.startTest();
      MarginArcSyntheticDataLoader.loadSyntheticData();
      Test.stopTest();

      // Verify data exists
      List<Account> accountsBefore = [
        SELECT Id FROM Account
        WHERE Name LIKE '%(Synthetic)%'
      ];
      System.assert(
        accountsBefore.size() > 0,
        'Should have synthetic accounts before clear'
      );

      // Clear
      Map<String, Object> result = MarginArcSyntheticDataLoader.clearSyntheticData();

      System.assertEquals(true, result.get('success'), 'Clear should succeed');
      System.assert(
        result.containsKey('accounts'),
        'Should have accounts count'
      );
      System.assert(
        result.containsKey('opportunities'),
        'Should have opportunities count'
      );

      // Verify data is gone
      List<Account> accountsAfter = [
        SELECT Id FROM Account
        WHERE Name LIKE '%(Synthetic)%'
      ];
      System.assertEquals(
        0,
        accountsAfter.size(),
        'Should have no synthetic accounts after clear'
      );

      List<Opportunity> oppsAfter = [
        SELECT Id FROM Opportunity
        WHERE Account.Name LIKE '%(Synthetic)%'
      ];
      System.assertEquals(
        0,
        oppsAfter.size(),
        'Should have no synthetic opportunities after clear'
      );
    }
  }

  @isTest
  static void testClearSyntheticDataWhenEmpty() {
    User u = [SELECT Id FROM User WHERE Id = :UserInfo.getUserId()];
    System.runAs(u) {
      Test.startTest();
      Map<String, Object> result = MarginArcSyntheticDataLoader.clearSyntheticData();
      Test.stopTest();

      System.assertEquals(
        true,
        result.get('success'),
        'Clear should succeed even when empty'
      );
      System.assertEquals(0, result.get('accounts'), 'Should report 0 accounts');
      System.assertEquals(
        0,
        result.get('opportunities'),
        'Should report 0 opportunities'
      );
    }
  }
}
