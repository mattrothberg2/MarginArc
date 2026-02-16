@isTest
private class MarginArcSetupControllerTest {
  // ── HttpCalloutMock for health check and API calls ──

  private class HealthCheckSuccessMock implements HttpCalloutMock {
    public HttpResponse respond(HttpRequest req) {
      HttpResponse res = new HttpResponse();
      res.setStatusCode(200);
      res.setBody('{"status":"ok"}');
      return res;
    }
  }

  private class HealthCheckFailMock implements HttpCalloutMock {
    public HttpResponse respond(HttpRequest req) {
      HttpResponse res = new HttpResponse();
      res.setStatusCode(500);
      res.setBody('{"error":"internal server error"}');
      return res;
    }
  }

  private class ApiMockSuccess implements HttpCalloutMock {
    public HttpResponse respond(HttpRequest req) {
      HttpResponse res = new HttpResponse();
      res.setStatusCode(200);
      res.setHeader('Content-Type', 'application/json');
      res.setBody(
        '{"suggestedMarginPct":22.5,"confidence":0.82,"winProbability":0.65,"drivers":[]}'
      );
      return res;
    }
  }

  // ── Test Setup ──

  @TestSetup
  static void setupTestData() {
    Account acc = new Account(
      Name = 'Setup Test Account',
      Industry = 'Technology'
    );
    insert acc;

    List<Opportunity> opps = new List<Opportunity>();

    opps.add(
      new Opportunity(
        Name = 'Cisco Deal Full',
        AccountId = acc.Id,
        Amount = 500000,
        StageName = 'Negotiation/Review',
        CloseDate = Date.today().addDays(30),
        Fulcrum_OEM__c = 'Cisco',
        Fulcrum_OEM_Cost__c = 400000,
        Fulcrum_Customer_Segment__c = 'Enterprise',
        Fulcrum_Deal_Reg_Type__c = 'StandardApproved',
        Fulcrum_Competitor_Names__c = 'CDW;SHI',
        Fulcrum_Recommended_Margin__c = 18,
        Fulcrum_Planned_Margin__c = 15
      )
    );

    opps.add(
      new Opportunity(
        Name = 'Palo Alto Partial',
        AccountId = acc.Id,
        Amount = 200000,
        StageName = 'Qualification',
        CloseDate = Date.today().addDays(60),
        Fulcrum_OEM__c = 'Palo Alto',
        Fulcrum_OEM_Cost__c = 170000,
        Fulcrum_Customer_Segment__c = 'MidMarket'
      )
    );

    opps.add(
      new Opportunity(
        Name = 'Empty Deal One',
        AccountId = acc.Id,
        Amount = 50000,
        StageName = 'Prospecting',
        CloseDate = Date.today().addDays(90)
      )
    );

    opps.add(
      new Opportunity(
        Name = 'Empty Deal Two',
        AccountId = acc.Id,
        Amount = 75000,
        StageName = 'Prospecting',
        CloseDate = Date.today().addDays(45)
      )
    );

    opps.add(
      new Opportunity(
        Name = 'Cisco Won Historical',
        AccountId = acc.Id,
        Amount = 300000,
        StageName = 'Closed Won',
        CloseDate = Date.today().addDays(-30),
        Fulcrum_OEM__c = 'Cisco',
        Fulcrum_OEM_Cost__c = 240000,
        Fulcrum_Planned_Margin__c = 14
      )
    );

    insert opps;
  }

  // ── 1. testGetSetupStatusEmpty ──

  @isTest
  static void testGetSetupStatusEmpty() {
    delete [SELECT Id FROM Fulcrum_OEM__c];
    delete [SELECT Id FROM Fulcrum_Competitor__c];
    delete [SELECT Id FROM Fulcrum_Backfill_Result__c];

    // Clear MarginArc fields on open opps so avgFillRate is 0
    List<Opportunity> openOpps = [
      SELECT Id
      FROM Opportunity
      WHERE IsClosed = FALSE
    ];
    for (Opportunity opp : openOpps) {
      opp.Fulcrum_OEM__c = null;
      opp.Fulcrum_OEM_Cost__c = null;
      opp.Fulcrum_Customer_Segment__c = null;
      opp.Fulcrum_Deal_Reg_Type__c = null;
      opp.Fulcrum_Competitor_Names__c = null;
      opp.Fulcrum_Recommended_Margin__c = null;
    }
    update openOpps;

    Test.startTest();
    Map<String, Object> status = MarginArcSetupController.getSetupStatus();
    Test.stopTest();

    System.assertEquals(
      false,
      status.get('apiConfigured'),
      'API should not be configured'
    );
    System.assertEquals(
      false,
      status.get('apiReachable'),
      'API should not be reachable'
    );
    System.assertEquals(0, status.get('oemCount'), 'No OEMs');
    System.assertEquals(0, status.get('competitorCount'), 'No competitors');
    System.assertEquals(
      0,
      (Integer) status.get('completedSteps'),
      'No completed steps'
    );
    System.assertEquals(
      5,
      (Integer) status.get('totalSteps'),
      'Total steps should be 5'
    );
    System.assertEquals(
      false,
      status.get('hasRunBackfill'),
      'Backfill not run'
    );
  }

  // ── 2. testGetSetupStatusPartial ──

  @isTest
  static void testGetSetupStatusPartial() {
    Fulcrum_Config__c cfg = Fulcrum_Config__c.getOrgDefaults();
    cfg.API_URL__c = 'https://api.marginarc.com/api/recommend';
    cfg.API_Key__c = 'test-key';
    upsert cfg;

    List<Fulcrum_OEM__c> oems = new List<Fulcrum_OEM__c>();
    oems.add(new Fulcrum_OEM__c(Name = 'Cisco', Base_Margin__c = 15));
    oems.add(new Fulcrum_OEM__c(Name = 'Palo Alto', Base_Margin__c = 12));
    insert oems;

    Test.setMock(HttpCalloutMock.class, new HealthCheckFailMock());

    Test.startTest();
    Map<String, Object> status = MarginArcSetupController.getSetupStatus();
    Test.stopTest();

    System.assertEquals(
      true,
      status.get('apiConfigured'),
      'API should be configured'
    );
    System.assertEquals(
      false,
      status.get('apiReachable'),
      'API should not be reachable (mock 500)'
    );
    System.assertEquals(
      2,
      (Integer) status.get('oemCount'),
      'Should have 2 OEMs'
    );
    System.assertEquals(
      0,
      (Integer) status.get('competitorCount'),
      'No competitors'
    );
    System.assert(
      (Integer) status.get('totalOpenDeals') >= 4,
      'Should have open deals'
    );
    System.assertEquals(
      false,
      status.get('hasRunBackfill'),
      'Backfill not run'
    );

    Integer completedSteps = (Integer) status.get('completedSteps');
    System.assert(
      completedSteps >= 1,
      'Should have at least 1 completed step (OEMs)'
    );
  }

  // ── 3. testGetSetupStatusComplete ──

  @isTest
  static void testGetSetupStatusComplete() {
    Fulcrum_Config__c cfg = Fulcrum_Config__c.getOrgDefaults();
    cfg.API_URL__c = 'https://api.marginarc.com/api/recommend';
    cfg.API_Key__c = 'test-key';
    cfg.Gemini_API_Key__c = 'gemini-key';
    upsert cfg;

    insert new Fulcrum_OEM__c(Name = 'Cisco', Base_Margin__c = 15);
    insert new Fulcrum_Competitor__c(
      Name = 'CDW',
      Primary_Strength__c = 'Scale'
    );

    List<Opportunity> openOpps = [
      SELECT Id
      FROM Opportunity
      WHERE IsClosed = FALSE
    ];
    for (Opportunity opp : openOpps) {
      opp.Fulcrum_OEM__c = 'Cisco';
      opp.Fulcrum_OEM_Cost__c = 80000;
      opp.Fulcrum_Customer_Segment__c = 'Enterprise';
      opp.Fulcrum_Deal_Reg_Type__c = 'StandardApproved';
      opp.Fulcrum_Competitor_Names__c = 'CDW';
      opp.Fulcrum_Recommended_Margin__c = 18;
    }
    update openOpps;

    Opportunity closedOpp = [
      SELECT Id
      FROM Opportunity
      WHERE StageName = 'Closed Won'
      LIMIT 1
    ];
    insert new Fulcrum_Backfill_Result__c(
      Opportunity__c = closedOpp.Id,
      Actual_Margin__c = 14,
      Recommended_Margin__c = 18,
      Margin_Delta__c = 4,
      Actual_GP__c = 42000,
      Recommended_GP__c = 54000,
      GP_Delta__c = 12000,
      OEM__c = 'Cisco',
      Close_Date__c = Date.today().addDays(-30),
      Analysis_Date__c = DateTime.now()
    );

    Test.setMock(HttpCalloutMock.class, new HealthCheckSuccessMock());

    Test.startTest();
    Map<String, Object> status = MarginArcSetupController.getSetupStatus();
    Test.stopTest();

    System.assertEquals(true, status.get('apiConfigured'), 'API configured');
    System.assertEquals(true, status.get('apiReachable'), 'API reachable');
    System.assertEquals(
      true,
      status.get('geminiConfigured'),
      'Gemini configured'
    );
    System.assert((Integer) status.get('oemCount') >= 1, 'Has OEMs');
    System.assert(
      (Integer) status.get('competitorCount') >= 1,
      'Has competitors'
    );
    System.assertEquals(true, status.get('hasRunBackfill'), 'Backfill has run');
    System.assertEquals(
      5,
      (Integer) status.get('completedSteps'),
      'All 5 steps completed'
    );

    List<Object> fields = (List<Object>) status.get('fields');
    System.assertNotEquals(null, fields, 'Field health should be present');
    System.assertEquals(5, fields.size(), 'Should have 5 field health entries');

    for (Object f : fields) {
      Map<String, Object> fMap = (Map<String, Object>) f;
      Decimal rate = (Decimal) fMap.get('rate');
      System.assertEquals(100.0, rate, 'All fields should be 100% filled');
    }
  }

  // ── 4. testGetFieldMappingSuggestions ──

  @isTest
  static void testGetFieldMappingSuggestions() {
    Test.startTest();
    List<Map<String, Object>> suggestions = MarginArcSetupController.getFieldMappingSuggestions();
    Test.stopTest();

    System.assert(
      suggestions.size() >= 7,
      'Should return at least 7 suggestions, got: ' + suggestions.size()
    );

    for (Map<String, Object> suggestion : suggestions) {
      System.assertNotEquals(
        null,
        suggestion.get('targetField'),
        'Each suggestion must have targetField'
      );
      System.assertNotEquals(
        null,
        suggestion.get('suggestion'),
        'Each suggestion must have suggestion text'
      );
      System.assertNotEquals(
        null,
        suggestion.get('icon'),
        'Each suggestion must have icon'
      );
      System.assertNotEquals(
        null,
        suggestion.get('currentFillRate'),
        'Each suggestion must have currentFillRate'
      );
    }
  }

  // ── 5. testGetFieldMappingSuggestionsWithData ──

  @isTest
  static void testGetFieldMappingSuggestionsWithData() {
    List<Opportunity> openOpps = [
      SELECT Id
      FROM Opportunity
      WHERE IsClosed = FALSE
    ];
    for (Opportunity opp : openOpps) {
      opp.Fulcrum_OEM__c = 'Cisco';
      opp.Fulcrum_OEM_Cost__c = 80000;
      opp.Fulcrum_Customer_Segment__c = 'Enterprise';
      opp.Fulcrum_Deal_Reg_Type__c = 'StandardApproved';
      opp.Fulcrum_Competitor_Names__c = 'CDW';
    }
    update openOpps;

    Test.startTest();
    List<Map<String, Object>> suggestions = MarginArcSetupController.getFieldMappingSuggestions();
    Test.stopTest();

    System.assert(
      suggestions.size() >= 7,
      'Should return at least 7 suggestions'
    );

    Boolean foundOem = false;
    Boolean foundCompetitor = false;
    for (Map<String, Object> s : suggestions) {
      String target = (String) s.get('targetField');
      Decimal rate = (Decimal) s.get('currentFillRate');
      if (target == 'Fulcrum_OEM__c') {
        foundOem = true;
        System.assertEquals(100.0, rate, 'OEM fill rate should be 100%');
      }
      if (target == 'Fulcrum_Competitor_Names__c') {
        foundCompetitor = true;
        System.assertEquals(100.0, rate, 'Competitor fill rate should be 100%');
      }
    }
    System.assert(foundOem, 'Should have OEM suggestion');
    System.assert(foundCompetitor, 'Should have Competitor suggestion');
  }

  // ── 6. testRunBackfill ──

  @isTest
  static void testRunBackfill() {
    Fulcrum_Config__c cfg = Fulcrum_Config__c.getOrgDefaults();
    cfg.API_URL__c = 'https://api.marginarc.com/api/recommend';
    cfg.API_Key__c = 'test-key';
    upsert cfg;

    Test.setMock(HttpCalloutMock.class, new ApiMockSuccess());

    Test.startTest();
    Id jobId = MarginArcSetupController.runBackfill(24);
    Test.stopTest();

    System.assertNotEquals(null, jobId, 'Should return a valid job ID');

    List<AsyncApexJob> jobs = [
      SELECT Id, Status
      FROM AsyncApexJob
      WHERE Id = :jobId
    ];
    System.assertEquals(1, jobs.size(), 'Job should exist');
    System.assertEquals(
      'Completed',
      jobs[0].Status,
      'Job should be completed in test context'
    );
  }

  // ── 7. testRunBackfillCustomMonths ──

  @isTest
  static void testRunBackfillCustomMonths() {
    Fulcrum_Config__c cfg = Fulcrum_Config__c.getOrgDefaults();
    cfg.API_URL__c = 'https://api.marginarc.com/api/recommend';
    cfg.API_Key__c = 'test-key';
    upsert cfg;

    Test.setMock(HttpCalloutMock.class, new ApiMockSuccess());

    Test.startTest();
    Id jobId = MarginArcSetupController.runBackfill(12);
    Test.stopTest();

    System.assertNotEquals(
      null,
      jobId,
      'Should return a valid job ID for 12-month backfill'
    );

    List<AsyncApexJob> jobs = [
      SELECT Id, Status
      FROM AsyncApexJob
      WHERE Id = :jobId
    ];
    System.assertEquals(1, jobs.size(), 'Job should exist');
  }

  // ── 8. testGetBackfillJobStatus ──

  @isTest
  static void testGetBackfillJobStatus() {
    Fulcrum_Config__c cfg = Fulcrum_Config__c.getOrgDefaults();
    cfg.API_URL__c = 'https://api.marginarc.com/api/recommend';
    cfg.API_Key__c = 'test-key';
    upsert cfg;

    Test.setMock(HttpCalloutMock.class, new ApiMockSuccess());

    Id jobId;
    Test.startTest();
    jobId = MarginArcSetupController.runBackfill(24);
    Test.stopTest();

    Map<String, Object> jobStatus = MarginArcSetupController.getBackfillJobStatus(
      jobId
    );

    System.assertNotEquals(null, jobStatus, 'Job status should not be null');
    System.assertEquals(
      'Completed',
      jobStatus.get('status'),
      'Job should be Completed'
    );
    System.assertEquals(
      100,
      (Integer) jobStatus.get('percentComplete'),
      'Should be 100% complete'
    );
    System.assertNotEquals(
      null,
      jobStatus.get('completedDate'),
      'Should have a completed date'
    );
  }

  // ── 9. testGetBackfillJobStatusInvalid ──

  @isTest
  static void testGetBackfillJobStatusInvalid() {
    Test.startTest();

    Map<String, Object> nullStatus = MarginArcSetupController.getBackfillJobStatus(
      null
    );
    System.assertEquals(
      'Unknown',
      nullStatus.get('status'),
      'Null ID should return Unknown'
    );
    System.assertEquals(
      0,
      (Integer) nullStatus.get('percentComplete'),
      'Should be 0%'
    );

    Test.stopTest();
  }

  // ── 10. testRunNightlyAnalyzer ──

  @isTest
  static void testRunNightlyAnalyzer() {
    Fulcrum_Config__c cfg = Fulcrum_Config__c.getOrgDefaults();
    cfg.API_URL__c = 'https://api.marginarc.com/api/recommend';
    cfg.API_Key__c = 'test-key';
    upsert cfg;

    Test.setMock(HttpCalloutMock.class, new ApiMockSuccess());

    Test.startTest();
    Id jobId = MarginArcSetupController.runNightlyAnalyzer();
    Test.stopTest();

    System.assertNotEquals(null, jobId, 'Should return a valid job ID');

    List<AsyncApexJob> jobs = [
      SELECT Id, Status
      FROM AsyncApexJob
      WHERE Id = :jobId
    ];
    System.assertEquals(1, jobs.size(), 'Job should exist');
    System.assertEquals(
      'Completed',
      jobs[0].Status,
      'Job should be completed in test context'
    );
  }

  // ── 11. testGetMaturityAssessmentLevel1 ──

  @isTest
  static void testGetMaturityAssessmentLevel1() {
    delete [SELECT Id FROM Fulcrum_OEM__c];
    delete [SELECT Id FROM Fulcrum_Competitor__c];

    Test.startTest();
    Map<String, Object> assessment = MarginArcSetupController.getMaturityAssessment();
    Test.stopTest();

    System.assertEquals(
      1,
      (Integer) assessment.get('level'),
      'Should be Level 1'
    );
    System.assertEquals('Getting Started', assessment.get('levelName'));
    System.assertNotEquals(
      null,
      assessment.get('nextLevelName'),
      'Should have next level'
    );
    System.assertEquals('Foundation', assessment.get('nextLevelName'));

    List<String> actions = (List<String>) assessment.get('nextLevelActions');
    System.assert(actions.size() > 0, 'Should have action items');
  }

  // ── 12. testGetMaturityAssessmentLevel2 ──

  @isTest
  static void testGetMaturityAssessmentLevel2() {
    Fulcrum_Config__c cfg = Fulcrum_Config__c.getOrgDefaults();
    cfg.API_URL__c = 'https://api.marginarc.com/api/recommend';
    cfg.API_Key__c = 'test-key';
    upsert cfg;

    insert new Fulcrum_OEM__c(Name = 'Cisco', Base_Margin__c = 15);
    insert new Fulcrum_Competitor__c(
      Name = 'CDW',
      Primary_Strength__c = 'Scale'
    );

    Test.startTest();
    Map<String, Object> assessment = MarginArcSetupController.getMaturityAssessment();
    Test.stopTest();

    System.assertEquals(
      2,
      (Integer) assessment.get('level'),
      'Should be Level 2'
    );
    System.assertEquals('Foundation', assessment.get('levelName'));
    System.assertEquals('Active', assessment.get('nextLevelName'));

    Map<String, Object> metrics = (Map<String, Object>) assessment.get(
      'metrics'
    );
    System.assertNotEquals(null, metrics, 'Should have metrics');
    System.assert(
      (Integer) metrics.get('oemCount') >= 1,
      'Should have OEM count'
    );
  }

  // ── 13. testGetMaturityAssessmentLevel3 ──

  @isTest
  static void testGetMaturityAssessmentLevel3() {
    Fulcrum_Config__c cfg = Fulcrum_Config__c.getOrgDefaults();
    cfg.API_URL__c = 'https://api.marginarc.com/api/recommend';
    cfg.API_Key__c = 'test-key';
    upsert cfg;

    insert new Fulcrum_OEM__c(Name = 'Cisco', Base_Margin__c = 15);
    insert new Fulcrum_Competitor__c(
      Name = 'CDW',
      Primary_Strength__c = 'Scale'
    );

    List<Opportunity> openOpps = [
      SELECT Id
      FROM Opportunity
      WHERE IsClosed = FALSE
    ];
    for (Opportunity opp : openOpps) {
      opp.Fulcrum_OEM__c = 'Cisco';
      opp.Fulcrum_OEM_Cost__c = 80000;
      opp.Fulcrum_Customer_Segment__c = 'Enterprise';
      opp.Fulcrum_Deal_Reg_Type__c = 'StandardApproved';
      opp.Fulcrum_Competitor_Names__c = 'CDW';
    }
    update openOpps;

    // Schedule a test-only analyzer job so hasScheduledAnalyzer = true
    String testCron = '0 0 3 * * ?';
    System.schedule(
      'MarginArc Test Analyzer L3',
      testCron,
      new MarginArcBatchAnalyzer()
    );

    Test.startTest();
    Map<String, Object> assessment = MarginArcSetupController.getMaturityAssessment();
    Test.stopTest();

    System.assertEquals(
      3,
      (Integer) assessment.get('level'),
      'Should be Level 3'
    );
    System.assertEquals('Active', assessment.get('levelName'));
    System.assertEquals('Optimizing', assessment.get('nextLevelName'));
  }

  // ── 14. testGetMaturityAssessmentLevel4 ──

  @isTest
  static void testGetMaturityAssessmentLevel4() {
    Fulcrum_Config__c cfg = Fulcrum_Config__c.getOrgDefaults();
    cfg.API_URL__c = 'https://api.marginarc.com/api/recommend';
    cfg.API_Key__c = 'test-key';
    upsert cfg;

    insert new Fulcrum_OEM__c(Name = 'Cisco', Base_Margin__c = 15);
    insert new Fulcrum_Competitor__c(
      Name = 'CDW',
      Primary_Strength__c = 'Scale'
    );

    List<Opportunity> openOpps = [
      SELECT Id
      FROM Opportunity
      WHERE IsClosed = FALSE
    ];
    for (Opportunity opp : openOpps) {
      opp.Fulcrum_OEM__c = 'Cisco';
      opp.Fulcrum_OEM_Cost__c = 80000;
      opp.Fulcrum_Customer_Segment__c = 'Enterprise';
      opp.Fulcrum_Deal_Reg_Type__c = 'StandardApproved';
      opp.Fulcrum_Competitor_Names__c = 'CDW';
      opp.Fulcrum_Recommended_Margin__c = 18;
    }
    update openOpps;

    Opportunity closedOpp = [
      SELECT Id
      FROM Opportunity
      WHERE StageName = 'Closed Won'
      LIMIT 1
    ];
    insert new Fulcrum_Backfill_Result__c(
      Opportunity__c = closedOpp.Id,
      Actual_Margin__c = 14,
      Recommended_Margin__c = 18,
      Margin_Delta__c = 4,
      Actual_GP__c = 42000,
      Recommended_GP__c = 54000,
      GP_Delta__c = 12000,
      OEM__c = 'Cisco',
      Close_Date__c = Date.today().addDays(-30),
      Analysis_Date__c = DateTime.now()
    );

    // Schedule a test-only analyzer job so hasScheduledAnalyzer = true
    System.schedule(
      'MarginArc Test Analyzer L4',
      '0 0 3 * * ?',
      new MarginArcBatchAnalyzer()
    );

    Test.startTest();
    Map<String, Object> assessment = MarginArcSetupController.getMaturityAssessment();
    Test.stopTest();

    System.assertEquals(
      4,
      (Integer) assessment.get('level'),
      'Should be Level 4'
    );
    System.assertEquals('Optimizing', assessment.get('levelName'));
    System.assertEquals('Mastery', assessment.get('nextLevelName'));

    List<String> actions = (List<String>) assessment.get('nextLevelActions');
    System.assert(actions.size() > 0, 'Should have actions to reach Mastery');
  }

  // ── 15. testGetMaturityAssessmentLevel5 ──

  @isTest
  static void testGetMaturityAssessmentLevel5() {
    Fulcrum_Config__c cfg = Fulcrum_Config__c.getOrgDefaults();
    cfg.API_URL__c = 'https://api.marginarc.com/api/recommend';
    cfg.API_Key__c = 'test-key';
    upsert cfg;

    insert new Fulcrum_OEM__c(Name = 'Cisco', Base_Margin__c = 15);
    insert new Fulcrum_Competitor__c(
      Name = 'CDW',
      Primary_Strength__c = 'Scale'
    );

    List<Opportunity> openOpps = [
      SELECT Id
      FROM Opportunity
      WHERE IsClosed = FALSE
    ];
    for (Opportunity opp : openOpps) {
      opp.Fulcrum_OEM__c = 'Cisco';
      opp.Fulcrum_OEM_Cost__c = 80000;
      opp.Fulcrum_Customer_Segment__c = 'Enterprise';
      opp.Fulcrum_Deal_Reg_Type__c = 'StandardApproved';
      opp.Fulcrum_Competitor_Names__c = 'CDW';
      opp.Fulcrum_Recommended_Margin__c = 18;
    }
    update openOpps;

    Opportunity closedOpp = [
      SELECT Id
      FROM Opportunity
      WHERE StageName = 'Closed Won'
      LIMIT 1
    ];
    insert new Fulcrum_Backfill_Result__c(
      Opportunity__c = closedOpp.Id,
      Actual_Margin__c = 14,
      Recommended_Margin__c = 18,
      Margin_Delta__c = 4,
      Actual_GP__c = 42000,
      Recommended_GP__c = 54000,
      GP_Delta__c = 12000,
      OEM__c = 'Cisco',
      Close_Date__c = Date.today().addDays(-30),
      Analysis_Date__c = DateTime.now()
    );

    List<Fulcrum_Recommendation_History__c> historyRecords = new List<Fulcrum_Recommendation_History__c>();
    for (Integer i = 0; i < 12; i++) {
      Opportunity opp = openOpps[Math.mod(i, openOpps.size())];
      historyRecords.add(
        new Fulcrum_Recommendation_History__c(
          Opportunity__c = opp.Id,
          Recommended_Margin__c = 18,
          AI_Confidence__c = 82,
          Win_Probability__c = 65,
          Planned_Margin_At_Time__c = 15,
          Source__c = 'Manual',
          Applied__c = true,
          Recommendation_Date__c = DateTime.now().addDays(-i)
        )
      );
    }
    insert historyRecords;

    // Schedule a test-only analyzer job so hasScheduledAnalyzer = true
    System.schedule(
      'MarginArc Test Analyzer L5',
      '0 0 3 * * ?',
      new MarginArcBatchAnalyzer()
    );

    Test.startTest();
    Map<String, Object> assessment = MarginArcSetupController.getMaturityAssessment();
    Test.stopTest();

    System.assertEquals(
      5,
      (Integer) assessment.get('level'),
      'Should be Level 5'
    );
    System.assertEquals('Mastery', assessment.get('levelName'));
    System.assertEquals(
      null,
      assessment.get('nextLevelName'),
      'No next level at Mastery'
    );

    Map<String, Object> metrics = (Map<String, Object>) assessment.get(
      'metrics'
    );
    Integer appliedCount = (Integer) metrics.get('appliedCount');
    System.assert(
      appliedCount >= 11,
      'Should have at least 11 applied recommendations, got: ' + appliedCount
    );
  }
}
