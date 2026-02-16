@isTest
private class FulcrumManagerControllerTest {
  @TestSetup
  static void setupTestData() {
    // Assign Fulcrum_Admin permission set for FLS + permission checks in scratch orgs
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

    Account acc1 = new Account(
      Name = 'Enterprise Corp',
      Industry = 'Technology'
    );
    Account acc2 = new Account(Name = 'MidMarket Inc', Industry = 'Healthcare');
    insert new List<Account>{ acc1, acc2 };

    List<Opportunity> opps = new List<Opportunity>();

    // Open pipeline deals
    opps.add(
      new Opportunity(
        Name = 'Enterprise Cisco Refresh',
        AccountId = acc1.Id,
        Amount = 500000,
        StageName = 'Negotiation/Review',
        CloseDate = Date.today().addDays(30),
        Fulcrum_OEM__c = 'Cisco',
        Fulcrum_OEM_Cost__c = 400000,
        Fulcrum_Planned_Margin__c = 20,
        Fulcrum_Recommended_Margin__c = 22,
        Fulcrum_Win_Probability__c = 65,
        Fulcrum_AI_Confidence__c = 80,
        Fulcrum_Customer_Segment__c = 'Enterprise',
        Fulcrum_Deal_Reg_Type__c = 'StandardApproved',
        Fulcrum_Competitors__c = '1',
        Fulcrum_Competitor_Names__c = 'CDW',
        Fulcrum_Solution_Complexity__c = 'High',
        Fulcrum_Relationship_Strength__c = 'Strategic',
        Fulcrum_Value_Add__c = 'High',
        Fulcrum_Services_Attached__c = true
      )
    );

    // Under-priced deal (triggers margin alert)
    opps.add(
      new Opportunity(
        Name = 'MidMarket Palo Alto Security',
        AccountId = acc2.Id,
        Amount = 150000,
        StageName = 'Proposal/Price Quote',
        CloseDate = Date.today().addDays(45),
        Fulcrum_OEM__c = 'Palo Alto',
        Fulcrum_OEM_Cost__c = 120000,
        Fulcrum_Planned_Margin__c = 10,
        Fulcrum_Recommended_Margin__c = 18,
        Fulcrum_Win_Probability__c = 45,
        Fulcrum_Customer_Segment__c = 'MidMarket',
        Fulcrum_Deal_Reg_Type__c = 'NotRegistered',
        Fulcrum_Competitors__c = '3+',
        Fulcrum_Competitor_Names__c = 'CDW;SHI;Optiv',
        Fulcrum_Solution_Complexity__c = 'Medium',
        Fulcrum_Relationship_Strength__c = 'Good',
        Fulcrum_Value_Add__c = 'Medium'
      )
    );

    // Open deal with null margins
    opps.add(
      new Opportunity(
        Name = 'No Margin Deal',
        AccountId = acc1.Id,
        Amount = 75000,
        StageName = 'Prospecting',
        CloseDate = Date.today().addDays(90)
      )
    );

    // Closed Won deals
    for (Integer i = 0; i < 5; i++) {
      opps.add(
        new Opportunity(
          Name = 'Won Deal ' + i,
          AccountId = acc1.Id,
          Amount = 200000 + (i * 50000),
          StageName = 'Closed Won',
          CloseDate = Date.today().addDays(-10 * (i + 1)),
          Fulcrum_OEM__c = 'Cisco',
          Fulcrum_Planned_Margin__c = 18 + i,
          Fulcrum_Recommended_Margin__c = 20,
          Fulcrum_GP_Percent__c = 18 + i,
          Fulcrum_Competitor_Names__c = 'CDW;SHI',
          Fulcrum_Services_Attached__c = true,
          Fulcrum_Win_Probability__c = 60 + i * 5
        )
      );
    }

    // Closed Lost deals
    for (Integer i = 0; i < 3; i++) {
      opps.add(
        new Opportunity(
          Name = 'Lost Deal ' + i,
          AccountId = acc2.Id,
          Amount = 100000,
          StageName = 'Closed Lost',
          CloseDate = Date.today().addDays(-20 * (i + 1)),
          Fulcrum_OEM__c = 'Palo Alto',
          Fulcrum_Planned_Margin__c = 12,
          Fulcrum_Recommended_Margin__c = 18,
          Fulcrum_GP_Percent__c = 12,
          Fulcrum_Competitor_Names__c = 'CDW',
          Fulcrum_Loss_Reason__c = 'Price'
        )
      );
    }

    // Old closed deal (outside 30d but inside 12m)
    opps.add(
      new Opportunity(
        Name = 'Old Won Deal',
        AccountId = acc1.Id,
        Amount = 300000,
        StageName = 'Closed Won',
        CloseDate = Date.today().addDays(-200),
        Fulcrum_Planned_Margin__c = 22,
        Fulcrum_Recommended_Margin__c = 22,
        Fulcrum_GP_Percent__c = 22,
        Fulcrum_Competitor_Names__c = 'Presidio'
      )
    );

    insert opps;
  }

  @isTest
  static void testGetPipelineSummaryReturnsDeals() {
    Test.startTest();
    Map<String, Object> result = FulcrumManagerController.getPipelineSummary(
      null
    );
    Test.stopTest();

    System.assertNotEquals(null, result, 'Result should not be null');
    List<Object> deals = (List<Object>) result.get('deals');
    System.assert(deals.size() >= 3, 'Should return at least 3 open deals');

    Map<String, Object> kpis = (Map<String, Object>) result.get('kpis');
    System.assert(
      (Decimal) kpis.get('totalPipeline') > 0,
      'Pipeline value should be > 0'
    );
  }

  @isTest
  static void testGetPipelineSummaryKpis() {
    Test.startTest();
    Map<String, Object> result = FulcrumManagerController.getPipelineSummary(
      null
    );
    Test.stopTest();

    Map<String, Object> kpis = (Map<String, Object>) result.get('kpis');
    System.assertNotEquals(
      null,
      kpis.get('avgMarginGap'),
      'Should have avg margin gap'
    );
    System.assertNotEquals(
      null,
      kpis.get('complianceRate'),
      'Should have compliance rate'
    );
  }

  @isTest
  static void testGetPipelineSummaryAlerts() {
    User u = [SELECT Id FROM User WHERE Id = :UserInfo.getUserId()];
    System.runAs(u) {
      Test.startTest();
      Map<String, Object> result = FulcrumManagerController.getPipelineSummary(
        null
      );
      Test.stopTest();

      List<Object> alerts = (List<Object>) result.get('alerts');
      System.assert(alerts.size() >= 1, 'Should have at least 1 margin alert');

      Map<String, Object> alert = (Map<String, Object>) alerts[0];
      System.assert(
        ((Decimal) alert.get('gap')) < -3,
        'Alert gap should be < -3'
      );
    }
  }

  @isTest
  static void testGetPipelineSummaryDealScores() {
    Test.startTest();
    Map<String, Object> result = FulcrumManagerController.getPipelineSummary(
      null
    );
    Test.stopTest();

    List<Object> deals = (List<Object>) result.get('deals');
    for (Object d : deals) {
      Map<String, Object> deal = (Map<String, Object>) d;
      Integer score = (Integer) deal.get('dealScore');
      System.assert(
        score >= 0 && score <= 100,
        'Deal score should be 0-100, got: ' + score
      );
      String label = (String) deal.get('dealScoreLabel');
      System.assert(
        label == 'Good' || label == 'Fair' || label == 'Needs Work',
        'Deal score label should be valid, got: ' + label
      );
    }
  }

  @isTest
  static void testGetHistoricalPerformance30d() {
    Test.startTest();
    Map<String, Object> result = FulcrumManagerController.getHistoricalPerformance(
      '30d',
      null
    );
    Test.stopTest();

    System.assertNotEquals(null, result, 'Result should not be null');
    List<Object> repPerf = (List<Object>) result.get('repPerformance');
    System.assert(repPerf.size() >= 1, 'Should have at least 1 rep');
  }

  @isTest
  static void testGetHistoricalPerformance90d() {
    User u = [SELECT Id FROM User WHERE Id = :UserInfo.getUserId()];
    System.runAs(u) {
      Test.startTest();
      Map<String, Object> result = FulcrumManagerController.getHistoricalPerformance(
        '90d',
        null
      );
      Test.stopTest();

      List<Object> competitorData = (List<Object>) result.get('competitorData');
      System.assertNotEquals(
        null,
        competitorData,
        'Should have competitor data'
      );
      Boolean foundCdw = false;
      for (Object c : competitorData) {
        Map<String, Object> comp = (Map<String, Object>) c;
        if (comp.get('name') == 'CDW') {
          foundCdw = true;
          System.assert((Integer) comp.get('wins') > 0, 'CDW should have wins');
        }
      }
      System.assert(foundCdw, 'CDW should be in competitor data');
    }
  }

  @isTest
  static void testGetHistoricalPerformanceAll() {
    Test.startTest();
    Map<String, Object> result = FulcrumManagerController.getHistoricalPerformance(
      'all',
      null
    );
    Test.stopTest();

    System.assert(
      (Integer) result.get('totalClosed') >= 9,
      'All range should include all 9 closed deals'
    );
  }

  @isTest
  static void testGetHistoricalPerformanceMarginOpportunity() {
    User u = [SELECT Id FROM User WHERE Id = :UserInfo.getUserId()];
    System.runAs(u) {
      Test.startTest();
      Map<String, Object> result = FulcrumManagerController.getHistoricalPerformance(
        'all',
        null
      );
      Test.stopTest();

      Map<String, Object> marginOpp = (Map<String, Object>) result.get(
        'marginOpportunity'
      );
      System.assertNotEquals(null, marginOpp, 'Should have margin opportunity');
      System.assert(
        (Decimal) marginOpp.get('potentialGP') > 0,
        'Potential GP should be > 0'
      );
      System.assert(
        (Decimal) marginOpp.get('currentGP') > 0,
        'Current GP should be > 0'
      );
    }
  }

  @isTest
  static void testGetHistoricalPerformanceRepCompliance() {
    Test.startTest();
    Map<String, Object> result = FulcrumManagerController.getHistoricalPerformance(
      'all',
      null
    );
    Test.stopTest();

    List<Object> reps = (List<Object>) result.get('repPerformance');
    for (Object r : reps) {
      Map<String, Object> rep = (Map<String, Object>) r;
      Decimal compRate = (Decimal) rep.get('complianceRate');
      System.assert(
        compRate >= 0 && compRate <= 100,
        'Compliance rate should be 0-100'
      );
    }
  }

  @isTest
  static void testGetHistoricalPerformanceWinRate() {
    Test.startTest();
    Map<String, Object> result = FulcrumManagerController.getHistoricalPerformance(
      'all',
      null
    );
    Test.stopTest();

    Decimal winRate = (Decimal) result.get('winRate');
    System.assert(winRate > 0, 'Win rate should be > 0');
    System.assert(winRate < 100, 'Win rate should be < 100');
  }

  @isTest
  static void testGetPipelineSummaryRAGP() {
    User u = [SELECT Id FROM User WHERE Id = :UserInfo.getUserId()];
    System.runAs(u) {
      Test.startTest();
      Map<String, Object> result = FulcrumManagerController.getPipelineSummary(
        null
      );
      Test.stopTest();

      Map<String, Object> kpis = (Map<String, Object>) result.get('kpis');
      System.assertNotEquals(
        null,
        kpis.get('ragpDelta'),
        'Should have RAGP delta KPI'
      );
      System.assertNotEquals(
        null,
        kpis.get('adoptionRate'),
        'Should have adoption rate KPI'
      );

      // Check that deals have RAGP fields
      List<Object> deals = (List<Object>) result.get('deals');
      Boolean foundRAGP = false;
      for (Object d : deals) {
        Map<String, Object> deal = (Map<String, Object>) d;
        if (deal.get('plannedRAGP') != null) {
          foundRAGP = true;
          System.assert(
            (Decimal) deal.get('plannedRAGP') > 0,
            'Planned RAGP should be positive'
          );
          System.assertNotEquals(
            null,
            deal.get('recRAGP'),
            'Rec RAGP should exist when planned RAGP exists'
          );
        }
      }
      System.assert(foundRAGP, 'At least one deal should have RAGP');
    }
  }

  @isTest
  static void testGetHistoricalComplianceCohorts() {
    User u = [SELECT Id FROM User WHERE Id = :UserInfo.getUserId()];
    System.runAs(u) {
      Test.startTest();
      Map<String, Object> result = FulcrumManagerController.getHistoricalPerformance(
        'all',
        null
      );
      Test.stopTest();

      Map<String, Object> cohorts = (Map<String, Object>) result.get(
        'complianceCohorts'
      );
      System.assertNotEquals(null, cohorts, 'Should have compliance cohorts');

      Integer alignedDeals = (Integer) cohorts.get('alignedDeals');
      Integer divergedDeals = (Integer) cohorts.get('divergedDeals');
      System.assert(
        alignedDeals + divergedDeals > 0,
        'Should have deals in at least one cohort'
      );

      Decimal alignedWinRate = (Decimal) cohorts.get('alignedWinRate');
      Decimal divergedWinRate = (Decimal) cohorts.get('divergedWinRate');
      System.assert(
        alignedWinRate >= 0 && alignedWinRate <= 100,
        'Aligned win rate should be 0-100'
      );
      System.assert(
        divergedWinRate >= 0 && divergedWinRate <= 100,
        'Diverged win rate should be 0-100'
      );
    }
  }

  @isTest
  static void testGetHistoricalRAGPMarginOpportunity() {
    User u = [SELECT Id FROM User WHERE Id = :UserInfo.getUserId()];
    System.runAs(u) {
      Test.startTest();
      Map<String, Object> result = FulcrumManagerController.getHistoricalPerformance(
        'all',
        null
      );
      Test.stopTest();

      Map<String, Object> marginOpp = (Map<String, Object>) result.get(
        'marginOpportunity'
      );
      System.assertNotEquals(
        null,
        marginOpp.get('totalPlannedRAGP'),
        'Should have planned RAGP'
      );
      System.assertNotEquals(
        null,
        marginOpp.get('totalRecRAGP'),
        'Should have recommended RAGP'
      );
      System.assertNotEquals(
        null,
        marginOpp.get('ragpDelta'),
        'Should have RAGP delta'
      );
      System.assert(
        (Integer) marginOpp.get('ragpDealCount') > 0,
        'Should have RAGP deal count > 0'
      );
    }
  }

  @isTest
  static void testGetUserContext() {
    Test.startTest();
    Map<String, Object> result = FulcrumManagerController.getUserContext();
    Test.stopTest();

    System.assertNotEquals(null, result, 'Result should not be null');
    System.assertNotEquals(
      null,
      result.get('userId'),
      'userId should not be null'
    );
    System.assertNotEquals(
      null,
      result.get('userName'),
      'userName should not be null'
    );
    // isManager and isAdmin should be boolean values
    Object isManager = result.get('isManager');
    Object isAdmin = result.get('isAdmin');
    System.assert(
      isManager instanceof Boolean,
      'isManager should be a Boolean'
    );
    System.assert(isAdmin instanceof Boolean, 'isAdmin should be a Boolean');
    // directReports and managers should be lists
    List<Object> directReports = (List<Object>) result.get('directReports');
    System.assertNotEquals(
      null,
      directReports,
      'directReports should be a list (possibly empty)'
    );
    List<Object> managers = (List<Object>) result.get('managers');
    System.assertNotEquals(
      null,
      managers,
      'managers should be a list (possibly empty)'
    );
  }

  @isTest
  static void testGetTeamComparison() {
    User u = [SELECT Id FROM User WHERE Id = :UserInfo.getUserId()];
    System.runAs(u) {
      Test.startTest();
      List<Map<String, Object>> result = FulcrumManagerController.getTeamComparison(
        'all'
      );
      Test.stopTest();

      // Should return a list (may be empty since test data has no ManagerId hierarchy)
      System.assertNotEquals(null, result, 'Result should not be null');
      System.assert(result.size() >= 0, 'Result should be a valid list');
    }
  }

  @isTest
  static void testGetRepDetail() {
    Id userId = UserInfo.getUserId();

    User u = [SELECT Id FROM User WHERE Id = :userId];
    System.runAs(u) {
      Test.startTest();
      Map<String, Object> result = FulcrumManagerController.getRepDetail(
        userId,
        'all'
      );
      Test.stopTest();

      System.assertNotEquals(null, result, 'Result should not be null');

      // deals list should exist
      List<Object> deals = (List<Object>) result.get('deals');
      System.assertNotEquals(null, deals, 'deals list should exist');

      // totalDeals should be >= 0
      Integer totalDeals = (Integer) result.get('totalDeals');
      System.assert(totalDeals >= 0, 'totalDeals should be >= 0');

      // winRate should be between 0 and 100
      Decimal winRate = (Decimal) result.get('winRate');
      System.assert(
        winRate >= 0 && winRate <= 100,
        'winRate should be 0-100, got: ' + winRate
      );
    }
  }

  @isTest
  static void testGetPipelineSummaryWithNullTeamFilter() {
    Test.startTest();
    Map<String, Object> result = FulcrumManagerController.getPipelineSummary(
      null
    );
    Test.stopTest();

    System.assertNotEquals(null, result, 'Result should not be null');
    List<Object> deals = (List<Object>) result.get('deals');
    System.assertNotEquals(null, deals, 'deals should not be null');
    System.assert(
      deals.size() > 0,
      'Should return deals with null team filter'
    );

    Map<String, Object> kpis = (Map<String, Object>) result.get('kpis');
    System.assertNotEquals(null, kpis, 'kpis should not be null');
  }

  @isTest
  static void testGetPipelineSummaryPredictionQuality() {
    Test.startTest();
    Map<String, Object> result = FulcrumManagerController.getPipelineSummary(
      null
    );
    Test.stopTest();

    // Verify deals have predictionQuality field
    List<Object> deals = (List<Object>) result.get('deals');
    Boolean foundQuality = false;
    for (Object d : deals) {
      Map<String, Object> deal = (Map<String, Object>) d;
      Integer quality = (Integer) deal.get('predictionQuality');
      System.assertNotEquals(
        null,
        quality,
        'Each deal should have a predictionQuality field'
      );
      System.assert(
        quality >= 0 && quality <= 100,
        'Prediction quality should be 0-100, got: ' + quality
      );
      if (quality > 0) {
        foundQuality = true;
      }
    }
    System.assert(
      foundQuality,
      'At least one deal should have predictionQuality > 0'
    );

    // Verify KPI includes avgPredictionQuality
    Map<String, Object> kpis = (Map<String, Object>) result.get('kpis');
    System.assertNotEquals(
      null,
      kpis.get('avgPredictionQuality'),
      'Should have avgPredictionQuality KPI'
    );
    Long avgQuality = (Long) kpis.get('avgPredictionQuality');
    System.assert(
      avgQuality >= 0 && avgQuality <= 100,
      'Avg prediction quality should be 0-100, got: ' + avgQuality
    );
  }

  @isTest
  static void testGetHistoricalPerformanceWithNullTeamFilter() {
    Test.startTest();
    Map<String, Object> result = FulcrumManagerController.getHistoricalPerformance(
      'all',
      null
    );
    Test.stopTest();

    System.assertNotEquals(null, result, 'Result should not be null');
    System.assertNotEquals(
      null,
      result.get('totalClosed'),
      'Should have totalClosed'
    );
    System.assertNotEquals(null, result.get('winRate'), 'Should have winRate');
    List<Object> repPerf = (List<Object>) result.get('repPerformance');
    System.assertNotEquals(null, repPerf, 'Should have repPerformance');
  }
}
