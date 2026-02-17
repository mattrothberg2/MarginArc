@isTest
private class MarginArcDemoDataServiceTest {
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
  }

  @isTest
  static void testCreateDemoDataSmall() {
    User u = [SELECT Id FROM User WHERE Id = :UserInfo.getUserId()];
    System.runAs(u) {
      RestRequest req = new RestRequest();
      req.requestURI = '/services/apexrest/marginarc/demo-data';
      req.httpMethod = 'POST';
      req.requestBody = Blob.valueOf(
        '{"size":"small","includeOems":true,"includeCompetitors":true,"includeHistorical":true}'
      );

      RestResponse res = new RestResponse();
      RestContext.request = req;
      RestContext.response = res;

      Test.startTest();
      MarginArcDemoDataService.doPost();
      Test.stopTest();

      Map<String, Object> result = (Map<String, Object>) JSON.deserializeUntyped(
        res.responseBody.toString()
      );

      System.assertEquals(true, result.get('success'), 'Should succeed');
      System.assertEquals(
        null,
        result.get('alreadyLoaded'),
        'Should not have alreadyLoaded flag'
      );

      Map<String, Object> counts = (Map<String, Object>) result.get('counts');
      System.assertEquals(
        8,
        counts.get('accounts'),
        'Should create 8 accounts'
      );
      System.assertEquals(10, counts.get('oems'), 'Should create 10 OEMs');
      System.assertEquals(
        10,
        counts.get('competitors'),
        'Should create 10 competitors'
      );
      System.assertEquals(
        30,
        counts.get('opportunities'),
        'Should create 30 opportunities'
      );

      // Verify stage distribution
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
      System.assertEquals(10, openOpps.size(), 'Should have 10 open deals');
      System.assertEquals(12, wonOpps.size(), 'Should have 12 won deals');
      System.assertEquals(8, lostOpps.size(), 'Should have 8 lost deals');
    }
  }

  @isTest
  static void testCreateDemoDataMedium() {
    User u = [SELECT Id FROM User WHERE Id = :UserInfo.getUserId()];
    System.runAs(u) {
      RestRequest req = new RestRequest();
      req.requestURI = '/services/apexrest/marginarc/demo-data';
      req.httpMethod = 'POST';
      req.requestBody = Blob.valueOf('{"size":"medium"}');

      RestResponse res = new RestResponse();
      RestContext.request = req;
      RestContext.response = res;

      Test.startTest();
      MarginArcDemoDataService.doPost();
      Test.stopTest();

      Map<String, Object> result = (Map<String, Object>) JSON.deserializeUntyped(
        res.responseBody.toString()
      );

      System.assertEquals(true, result.get('success'), 'Should succeed');

      Map<String, Object> counts = (Map<String, Object>) result.get('counts');
      System.assertEquals(
        25,
        counts.get('accounts'),
        'Should create 25 accounts for medium'
      );

      Integer oppCount = (Integer) counts.get('opportunities');
      System.assert(
        oppCount >= 90,
        'Medium should create many more opportunities, got: ' + oppCount
      );

      // Verify OEMs and competitors
      System.assertEquals(10, counts.get('oems'), 'Should create 10 OEMs');
      System.assertEquals(
        10,
        counts.get('competitors'),
        'Should create 10 competitors'
      );
    }
  }

  @isTest
  static void testGetDemoDataStatus() {
    User u = [SELECT Id FROM User WHERE Id = :UserInfo.getUserId()];
    System.runAs(u) {
      // First create demo data
      RestRequest postReq = new RestRequest();
      postReq.requestURI = '/services/apexrest/marginarc/demo-data';
      postReq.httpMethod = 'POST';
      postReq.requestBody = Blob.valueOf('{"size":"small"}');

      RestResponse postRes = new RestResponse();
      RestContext.request = postReq;
      RestContext.response = postRes;
      MarginArcDemoDataService.doPost();

      // Now check status
      RestRequest getReq = new RestRequest();
      getReq.requestURI = '/services/apexrest/marginarc/demo-data';
      getReq.httpMethod = 'GET';

      RestResponse getRes = new RestResponse();
      RestContext.request = getReq;
      RestContext.response = getRes;

      Test.startTest();
      MarginArcDemoDataService.doGet();
      Test.stopTest();

      Map<String, Object> result = (Map<String, Object>) JSON.deserializeUntyped(
        getRes.responseBody.toString()
      );

      System.assertEquals(true, result.get('hasData'), 'Should have data');

      Map<String, Object> counts = (Map<String, Object>) result.get('counts');
      System.assertEquals(
        8,
        counts.get('accounts'),
        'Should show 8 demo accounts'
      );
      System.assertEquals(
        30,
        counts.get('opportunities'),
        'Should show 30 opportunities'
      );
      System.assertEquals(10, counts.get('oems'), 'Should show 10 OEMs');
      System.assertEquals(
        10,
        counts.get('competitors'),
        'Should show 10 competitors'
      );
    }
  }

  @isTest
  static void testDeleteDemoData() {
    User u = [SELECT Id FROM User WHERE Id = :UserInfo.getUserId()];
    System.runAs(u) {
      // First create demo data
      RestRequest postReq = new RestRequest();
      postReq.requestURI = '/services/apexrest/marginarc/demo-data';
      postReq.httpMethod = 'POST';
      postReq.requestBody = Blob.valueOf('{"size":"small"}');

      RestResponse postRes = new RestResponse();
      RestContext.request = postReq;
      RestContext.response = postRes;
      MarginArcDemoDataService.doPost();

      // Now delete
      RestRequest delReq = new RestRequest();
      delReq.requestURI = '/services/apexrest/marginarc/demo-data';
      delReq.httpMethod = 'DELETE';

      RestResponse delRes = new RestResponse();
      RestContext.request = delReq;
      RestContext.response = delRes;

      Test.startTest();
      MarginArcDemoDataService.doDelete();
      Test.stopTest();

      Map<String, Object> result = (Map<String, Object>) JSON.deserializeUntyped(
        delRes.responseBody.toString()
      );

      System.assertEquals(true, result.get('success'), 'Delete should succeed');

      Map<String, Object> counts = (Map<String, Object>) result.get('counts');
      System.assertEquals(
        8,
        counts.get('accounts'),
        'Should report 8 deleted accounts'
      );
      System.assertEquals(
        10,
        counts.get('oems'),
        'Should report 10 deleted OEMs'
      );
      System.assertEquals(
        10,
        counts.get('competitors'),
        'Should report 10 deleted competitors'
      );

      // Verify data is actually gone
      System.assertEquals(
        0,
        [SELECT COUNT() FROM Account WHERE Name LIKE '%(Demo)%'],
        'No demo accounts should remain'
      );
      System.assertEquals(
        0,
        [SELECT COUNT() FROM Fulcrum_OEM__c],
        'No OEMs should remain'
      );
      System.assertEquals(
        0,
        [SELECT COUNT() FROM Fulcrum_Competitor__c],
        'No competitors should remain'
      );
    }
  }

  @isTest
  static void testIdempotency() {
    User u = [SELECT Id FROM User WHERE Id = :UserInfo.getUserId()];
    System.runAs(u) {
      // First load
      RestRequest req1 = new RestRequest();
      req1.requestURI = '/services/apexrest/marginarc/demo-data';
      req1.httpMethod = 'POST';
      req1.requestBody = Blob.valueOf('{"size":"small"}');

      RestResponse res1 = new RestResponse();
      RestContext.request = req1;
      RestContext.response = res1;
      MarginArcDemoDataService.doPost();

      // Second load should detect existing data
      RestRequest req2 = new RestRequest();
      req2.requestURI = '/services/apexrest/marginarc/demo-data';
      req2.httpMethod = 'POST';
      req2.requestBody = Blob.valueOf('{"size":"small"}');

      RestResponse res2 = new RestResponse();
      RestContext.request = req2;
      RestContext.response = res2;

      Test.startTest();
      MarginArcDemoDataService.doPost();
      Test.stopTest();

      Map<String, Object> result = (Map<String, Object>) JSON.deserializeUntyped(
        res2.responseBody.toString()
      );

      System.assertEquals(
        false,
        result.get('success'),
        'Second load should not succeed'
      );
      System.assertEquals(
        true,
        result.get('alreadyLoaded'),
        'Should detect already loaded'
      );
      System.assert(
        ((String) result.get('message')).contains('already exists'),
        'Message should mention already exists'
      );

      // Verify no duplicates
      System.assertEquals(
        8,
        [SELECT COUNT() FROM Account WHERE Name LIKE '%(Demo)%'],
        'Should still have only 8 demo accounts'
      );
    }
  }

  @isTest
  static void testCreateDemoDataFLSEnforcement() {
    // Test that FLS enforcement is applied via Security.stripInaccessible
    // by verifying the service works correctly with proper permissions
    User u = [SELECT Id FROM User WHERE Id = :UserInfo.getUserId()];
    System.runAs(u) {
      RestRequest req = new RestRequest();
      req.requestURI = '/services/apexrest/marginarc/demo-data';
      req.httpMethod = 'POST';
      req.requestBody = Blob.valueOf(
        '{"size":"small","includeOems":true,"includeCompetitors":true,"includeHistorical":false}'
      );

      RestResponse res = new RestResponse();
      RestContext.request = req;
      RestContext.response = res;

      Test.startTest();
      MarginArcDemoDataService.doPost();
      Test.stopTest();

      Map<String, Object> result = (Map<String, Object>) JSON.deserializeUntyped(
        res.responseBody.toString()
      );

      System.assertEquals(
        true,
        result.get('success'),
        'Should succeed with proper permissions'
      );

      Map<String, Object> counts = (Map<String, Object>) result.get('counts');
      System.assertEquals(
        8,
        counts.get('accounts'),
        'Should create 8 accounts'
      );
      System.assertEquals(10, counts.get('oems'), 'Should create 10 OEMs');
      System.assertEquals(
        10,
        counts.get('competitors'),
        'Should create 10 competitors'
      );
      // Without historical data, only open deals
      System.assertEquals(
        10,
        counts.get('opportunities'),
        'Should create 10 open opportunities (no historical)'
      );
    }
  }

  @isTest
  static void testGetStatusNoData() {
    RestRequest req = new RestRequest();
    req.requestURI = '/services/apexrest/marginarc/demo-data';
    req.httpMethod = 'GET';

    RestResponse res = new RestResponse();
    RestContext.request = req;
    RestContext.response = res;

    Test.startTest();
    MarginArcDemoDataService.doGet();
    Test.stopTest();

    Map<String, Object> result = (Map<String, Object>) JSON.deserializeUntyped(
      res.responseBody.toString()
    );

    System.assertEquals(false, result.get('hasData'), 'Should have no data');
    System.assertEquals(
      null,
      result.get('jobStatus'),
      'No job should be running'
    );
  }

  @isTest
  static void testQueueableChain() {
    User u = [SELECT Id FROM User WHERE Id = :UserInfo.getUserId()];
    System.runAs(u) {
      // Create a small batch of deals for the Queueable
      List<Map<String, Object>> deals = new List<Map<String, Object>>();
      for (Integer i = 0; i < 5; i++) {
        deals.add(
          new Map<String, Object>{
            'accountName' => 'QueueTest Corp (Demo)',
            'name' => 'QueueTest Corp - Test Deal ' + i,
            'amount' => 100000 + (i * 10000),
            'stageName' => 'Prospecting',
            'closeDate' => String.valueOf(Date.today().addDays(60)),
            'oem' => 'Cisco',
            'customerSegment' => 'MidMarket',
            'dealRegType' => 'NotRegistered',
            'solutionComplexity' => 'Medium',
            'relationshipStrength' => 'Good',
            'servicesAttached' => false,
            'productCategory' => 'Networking'
          }
        );
      }

      Test.startTest();
      System.enqueueJob(
        new MarginArcDemoDataQueueable(JSON.serialize(deals), 0)
      );
      Test.stopTest();

      // Verify opportunities were created
      List<Opportunity> opps = [
        SELECT Id, Name
        FROM Opportunity
        WHERE Name LIKE 'QueueTest Corp%'
      ];
      System.assertEquals(
        5,
        opps.size(),
        'Should create 5 opportunities via Queueable'
      );

      // Verify account was created
      List<Account> accts = [
        SELECT Name
        FROM Account
        WHERE Name LIKE 'QueueTest%'
      ];
      System.assertEquals(
        1,
        accts.size(),
        'Should create 1 account via Queueable'
      );
    }
  }

  @isTest
  static void testDeleteNoData() {
    RestRequest req = new RestRequest();
    req.requestURI = '/services/apexrest/marginarc/demo-data';
    req.httpMethod = 'DELETE';

    RestResponse res = new RestResponse();
    RestContext.request = req;
    RestContext.response = res;

    Test.startTest();
    MarginArcDemoDataService.doDelete();
    Test.stopTest();

    Map<String, Object> result = (Map<String, Object>) JSON.deserializeUntyped(
      res.responseBody.toString()
    );

    System.assertEquals(
      true,
      result.get('success'),
      'Delete with no data should succeed'
    );
    Map<String, Object> counts = (Map<String, Object>) result.get('counts');
    System.assertEquals(
      0,
      counts.get('accounts'),
      'Should report 0 deleted accounts'
    );
  }

  @isTest
  static void testBomLineCreation() {
    User u = [SELECT Id FROM User WHERE Id = :UserInfo.getUserId()];
    System.runAs(u) {
      // Create demo data via REST API
      RestRequest req = new RestRequest();
      req.requestURI = '/services/apexrest/marginarc/demo-data';
      req.httpMethod = 'POST';
      req.requestBody = Blob.valueOf(
        '{"size":"small","includeOems":true,"includeCompetitors":true,"includeHistorical":false}'
      );

      RestResponse res = new RestResponse();
      RestContext.request = req;
      RestContext.response = res;

      Test.startTest();
      MarginArcDemoDataService.doPost();
      Test.stopTest();

      Map<String, Object> result = (Map<String, Object>) JSON.deserializeUntyped(
        res.responseBody.toString()
      );
      System.assertEquals(true, result.get('success'), 'Should succeed');

      // Verify BOM lines were created
      List<Opportunity> opps = [
        SELECT
          Id,
          Fulcrum_OEM__c,
          (
            SELECT
              Id,
              Description__c,
              Category__c,
              Unit_Cost__c,
              Unit_Price__c,
              Quantity__c,
              Margin_Pct__c,
              Vendor__c,
              Product_Number__c,
              Sort_Order__c,
              BOM_Origin__c
            FROM BOM_Lines__r
            ORDER BY Sort_Order__c
          )
        FROM Opportunity
        WHERE Account.Name LIKE '%(Demo)%'
      ];

      System.assert(!opps.isEmpty(), 'Should have demo opportunities');

      for (Opportunity opp : opps) {
        System.assertEquals(
          4,
          opp.BOM_Lines__r.size(),
          'Each opportunity should have 4 BOM lines: ' + opp.Id
        );

        for (Fulcrum_BOM_Line__c bom : opp.BOM_Lines__r) {
          System.assertNotEquals(
            null,
            bom.Description__c,
            'BOM Description should be populated'
          );
          System.assertNotEquals(
            null,
            bom.Category__c,
            'BOM Category should be populated'
          );
          System.assertNotEquals(
            null,
            bom.Unit_Cost__c,
            'BOM Unit Cost should be populated'
          );
          System.assertNotEquals(
            null,
            bom.Unit_Price__c,
            'BOM Unit Price should be populated'
          );
          System.assert(bom.Quantity__c > 0, 'BOM Quantity should be > 0');
          System.assertNotEquals(
            null,
            bom.Product_Number__c,
            'BOM Product Number should be populated'
          );
          System.assertEquals(
            'demo',
            bom.BOM_Origin__c,
            'BOM Origin should be demo'
          );
        }
      }

      // Verify total BOM line count (10 opps * 4 lines each = 40)
      Integer totalBomLines = [SELECT COUNT() FROM Fulcrum_BOM_Line__c];
      System.assertEquals(
        opps.size() * 4,
        totalBomLines,
        'Total BOM lines should be 4 per opportunity'
      );
    }
  }

  @isTest
  static void testBomLineCleanup() {
    User u = [SELECT Id FROM User WHERE Id = :UserInfo.getUserId()];
    System.runAs(u) {
      // Create demo data
      RestRequest postReq = new RestRequest();
      postReq.requestURI = '/services/apexrest/marginarc/demo-data';
      postReq.httpMethod = 'POST';
      postReq.requestBody = Blob.valueOf(
        '{"size":"small","includeOems":true,"includeCompetitors":true,"includeHistorical":false}'
      );

      RestResponse postRes = new RestResponse();
      RestContext.request = postReq;
      RestContext.response = postRes;
      MarginArcDemoDataService.doPost();

      // Verify BOM lines exist
      Integer bomCountBefore = [SELECT COUNT() FROM Fulcrum_BOM_Line__c];
      System.assert(bomCountBefore > 0, 'Should have BOM lines before delete');

      // Delete demo data
      RestRequest delReq = new RestRequest();
      delReq.requestURI = '/services/apexrest/marginarc/demo-data';
      delReq.httpMethod = 'DELETE';

      RestResponse delRes = new RestResponse();
      RestContext.request = delReq;
      RestContext.response = delRes;

      Test.startTest();
      MarginArcDemoDataService.doDelete();
      Test.stopTest();

      Map<String, Object> result = (Map<String, Object>) JSON.deserializeUntyped(
        delRes.responseBody.toString()
      );
      System.assertEquals(true, result.get('success'), 'Delete should succeed');

      // Verify BOM lines are gone
      Integer bomCountAfter = [SELECT COUNT() FROM Fulcrum_BOM_Line__c];
      System.assertEquals(
        0,
        bomCountAfter,
        'All BOM lines should be deleted with demo data'
      );

      // Verify opportunities are gone too
      System.assertEquals(
        0,
        [SELECT COUNT() FROM Opportunity WHERE Account.Name LIKE '%(Demo)%'],
        'No demo opportunities should remain'
      );
    }
  }

  @isTest
  static void testBomLineFieldCalculations() {
    User u = [SELECT Id FROM User WHERE Id = :UserInfo.getUserId()];
    System.runAs(u) {
      // Create a single account and opportunity with known OEM cost
      Account testAcct = new Account(Name = 'Calc Test Corp (Demo)');
      insert testAcct;

      Opportunity testOpp = new Opportunity(
        AccountId = testAcct.Id,
        Name = 'Calc Test Corp - BOM Calc Test',
        Amount = 200000,
        StageName = 'Prospecting',
        CloseDate = Date.today().addDays(60),
        Fulcrum_OEM__c = 'Cisco',
        Fulcrum_OEM_Cost__c = 160000
      );
      insert testOpp;

      Test.startTest();
      MarginArcDemoDataService.insertBomLines(new List<Opportunity>{ testOpp });
      Test.stopTest();

      // Query BOM lines and verify calculations
      List<Fulcrum_BOM_Line__c> bomLines = [
        SELECT
          Id,
          Unit_Cost__c,
          Unit_Price__c,
          Quantity__c,
          Extended_Cost__c,
          Extended_Price__c,
          Margin_Pct__c,
          Category__c,
          Description__c
        FROM Fulcrum_BOM_Line__c
        WHERE Opportunity__c = :testOpp.Id
        ORDER BY Sort_Order__c
      ];

      System.assertEquals(4, bomLines.size(), 'Should have 4 BOM lines');

      for (Fulcrum_BOM_Line__c bom : bomLines) {
        // Verify Extended_Cost = Unit_Cost * Quantity
        Decimal expectedExtCost = (bom.Unit_Cost__c * bom.Quantity__c)
          .setScale(2, System.RoundingMode.HALF_UP);
        System.assertEquals(
          expectedExtCost,
          bom.Extended_Cost__c,
          'Extended Cost should equal Unit Cost * Quantity for: ' +
          bom.Description__c
        );

        // Verify Extended_Price = Unit_Price * Quantity
        Decimal expectedExtPrice = (bom.Unit_Price__c * bom.Quantity__c)
          .setScale(2, System.RoundingMode.HALF_UP);
        System.assertEquals(
          expectedExtPrice,
          bom.Extended_Price__c,
          'Extended Price should equal Unit Price * Quantity for: ' +
          bom.Description__c
        );

        // Verify Unit_Price = Unit_Cost / (1 - Margin_Pct/100)
        Decimal expectedUnitPrice = (bom.Unit_Cost__c /
          (1 - bom.Margin_Pct__c / 100))
          .setScale(2, System.RoundingMode.HALF_UP);
        System.assertEquals(
          expectedUnitPrice,
          bom.Unit_Price__c,
          'Unit Price should match margin formula for: ' + bom.Description__c
        );

        // Verify margin is within realistic range
        System.assert(
          bom.Margin_Pct__c >= 10 && bom.Margin_Pct__c <= 50,
          'Margin should be between 10-50%, got ' +
            bom.Margin_Pct__c +
            ' for: ' +
            bom.Description__c
        );

        // Verify Unit_Price > Unit_Cost (positive margin)
        System.assert(
          bom.Unit_Price__c > bom.Unit_Cost__c,
          'Unit Price should exceed Unit Cost for: ' + bom.Description__c
        );
      }
    }
  }
}
