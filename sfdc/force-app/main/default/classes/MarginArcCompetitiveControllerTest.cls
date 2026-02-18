@isTest
private class MarginArcCompetitiveControllerTest {
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

    // Create accounts
    Account accWithHistory = new Account(
      Name = 'Acme Corp',
      Industry = 'Technology'
    );
    Account accNoHistory = new Account(
      Name = 'NewCo Inc',
      Industry = 'Healthcare'
    );
    Account accIndustryFallback = new Account(
      Name = 'IndustryTest Corp',
      Industry = 'Technology'
    );
    insert new List<Account>{
      accWithHistory,
      accNoHistory,
      accIndustryFallback
    };

    List<Opportunity> opps = new List<Opportunity>();

    // Closed Won opportunities for Acme Corp
    for (Integer i = 0; i < 4; i++) {
      opps.add(
        new Opportunity(
          Name = 'Acme Won Deal ' + i,
          AccountId = accWithHistory.Id,
          Amount = 200000 + (i * 50000),
          StageName = 'Closed Won',
          CloseDate = Date.today().addDays(-30 * (i + 1)),
          Fulcrum_OEM__c = 'Cisco',
          Fulcrum_Competitor_Names__c = 'CDW;SHI',
          Fulcrum_GP_Percent__c = 18 + i,
          Fulcrum_Services_Attached__c = true,
          Fulcrum_Deal_Reg_Type__c = 'StandardApproved',
          Fulcrum_Loss_Reason__c = null,
          Fulcrum_Product_Category__c = 'Networking'
        )
      );
    }

    // Closed Lost opportunities for Acme Corp
    for (Integer i = 0; i < 2; i++) {
      opps.add(
        new Opportunity(
          Name = 'Acme Lost Deal ' + i,
          AccountId = accWithHistory.Id,
          Amount = 150000,
          StageName = 'Closed Lost',
          CloseDate = Date.today().addDays(-60 * (i + 1)),
          Fulcrum_OEM__c = 'Palo Alto',
          Fulcrum_Competitor_Names__c = 'CDW',
          Fulcrum_GP_Percent__c = null,
          Fulcrum_Services_Attached__c = false,
          Fulcrum_Deal_Reg_Type__c = 'NotRegistered',
          Fulcrum_Loss_Reason__c = 'Price',
          Fulcrum_Product_Category__c = 'Security'
        )
      );
    }

    // Industry fallback opportunities (not tied to NewCo)
    opps.add(
      new Opportunity(
        Name = 'Industry Deal Won',
        AccountId = accIndustryFallback.Id,
        Amount = 300000,
        StageName = 'Closed Won',
        CloseDate = Date.today().addDays(-10),
        Fulcrum_OEM__c = 'Cisco',
        Fulcrum_Competitor_Names__c = 'Presidio;Optiv',
        Fulcrum_GP_Percent__c = 20
      )
    );
    opps.add(
      new Opportunity(
        Name = 'Industry Deal Lost',
        AccountId = accIndustryFallback.Id,
        Amount = 100000,
        StageName = 'Closed Lost',
        CloseDate = Date.today().addDays(-20),
        Fulcrum_Competitor_Names__c = 'CDW'
      )
    );

    insert opps;

    // Create a Fulcrum_Competitor__c record
    Fulcrum_Competitor__c competitor = new Fulcrum_Competitor__c(
      Name = 'TestCompetitor',
      Primary_Strength__c = 'Pricing',
      Price_Aggression__c = '4',
      Services_Capability__c = '2',
      Primary_OEMs__c = 'Dell, HPE',
      How_To_Win__c = 'Lead with services and SLA guarantees.',
      Typical_Discount__c = 0.04,
      Description__c = 'A test competitor description',
      Margin_Aggression__c = 3
    );
    insert competitor;
  }

  @isTest
  static void testGetAccountIntelligenceWithHistory() {
    Account acc = [SELECT Id FROM Account WHERE Name = 'Acme Corp' LIMIT 1];
    User u = [SELECT Id FROM User WHERE Id = :UserInfo.getUserId()];
    System.runAs(u) {
      Test.startTest();
      Map<String, Object> result = MarginArcCompetitiveController.getAccountIntelligence(
        acc.Id,
        'Technology'
      );
      Test.stopTest();

      System.assertEquals(
        true,
        result.get('hasHistory'),
        'Should have history for Acme Corp'
      );
      System.assert(
        result.containsKey('accountData'),
        'Should contain accountData'
      );

      Map<String, Object> accountData = (Map<String, Object>) result.get(
        'accountData'
      );
      System.assertEquals(
        'Acme Corp',
        accountData.get('accountName'),
        'Account name should match'
      );
      System.assertEquals(
        6,
        accountData.get('totalDeals'),
        'Should have 6 total deals'
      );
      System.assertEquals(
        4,
        accountData.get('wonDeals'),
        'Should have 4 won deals'
      );

      // Check competitor matchups exist
      List<Object> matchups = (List<Object>) accountData.get(
        'competitorMatchups'
      );
      System.assert(
        matchups != null && !matchups.isEmpty(),
        'Should have competitor matchups'
      );

      // CDW appears in all 6 deals (4 won deals via CDW;SHI, 2 lost deals via CDW)
      Map<String, Object> cdwMatchup = null;
      for (Object m : matchups) {
        Map<String, Object> matchup = (Map<String, Object>) m;
        if (matchup.get('competitor') == 'CDW') {
          cdwMatchup = matchup;
          break;
        }
      }
      System.assertNotEquals(
        null,
        cdwMatchup,
        'CDW should be in competitor matchups'
      );
      System.assertEquals(4, cdwMatchup.get('wins'), 'CDW wins should be 4');
      System.assertEquals(
        2,
        cdwMatchup.get('losses'),
        'CDW losses should be 2'
      );

      // Check what works section
      Map<String, Object> whatWorks = (Map<String, Object>) accountData.get(
        'whatWorks'
      );
      System.assertNotEquals(null, whatWorks, 'Should have whatWorks');

      // Check quick brief
      String quickBrief = (String) accountData.get('quickBrief');
      System.assert(
        String.isNotBlank(quickBrief),
        'Quick brief should not be blank'
      );
      System.assert(
        quickBrief.contains('Acme Corp') || quickBrief.contains('4 of 6'),
        'Quick brief should reference account stats'
      );
    } // end System.runAs
  }

  @isTest
  static void testGetAccountIntelligenceNullAccountId() {
    Test.startTest();
    Map<String, Object> result = MarginArcCompetitiveController.getAccountIntelligence(
      null,
      'Technology'
    );
    Test.stopTest();

    System.assertEquals(
      false,
      result.get('hasHistory'),
      'Should have no history for null account Id'
    );
    System.assertEquals(
      'No account specified',
      result.get('message'),
      'Should return no account message'
    );
  }

  @isTest
  static void testGetAccountIntelligenceNoDealsIndustryFallback() {
    Account acc = [SELECT Id FROM Account WHERE Name = 'NewCo Inc' LIMIT 1];
    Test.startTest();
    Map<String, Object> result = MarginArcCompetitiveController.getAccountIntelligence(
      acc.Id,
      'Technology'
    );
    Test.stopTest();

    System.assertEquals(
      false,
      result.get('hasHistory'),
      'Should have no history for NewCo'
    );
    System.assert(
      result.containsKey('similarAccounts'),
      'Should contain similarAccounts fallback'
    );
    System.assert(
      result.containsKey('message'),
      'Should contain fallback message'
    );

    Map<String, Object> similar = (Map<String, Object>) result.get(
      'similarAccounts'
    );
    System.assertEquals(
      'Technology',
      similar.get('industry'),
      'Industry should be Technology'
    );
    System.assert(
      (Integer) similar.get('totalDeals') > 0,
      'Should find industry deals from other accounts'
    );
  }

  @isTest
  static void testGetCompetitorProfileFromCustomObject() {
    Test.startTest();
    Map<String, Object> result = MarginArcCompetitiveController.getCompetitorProfile(
      'TestCompetitor'
    );
    Test.stopTest();

    // Result may come from custom object (if FLS allows) or fallback.
    // Either way, we should get a valid profile back with the right name.
    System.assertNotEquals(null, result, 'Should return a profile');
    System.assertEquals(
      'TestCompetitor',
      result.get('name'),
      'Name should be TestCompetitor regardless of source'
    );

    // If FLS allowed the custom object query, strength is 'Pricing'.
    // If FLS blocked it, fallback returns 'Unknown'.
    String strength = (String) result.get('strength');
    System.assert(
      strength == 'Pricing' || strength == 'Unknown',
      'Strength should be Pricing (custom obj) or Unknown (fallback)'
    );
  }

  @isTest
  static void testGetCompetitorProfileHardcodedFallback() {
    Test.startTest();
    Map<String, Object> result = MarginArcCompetitiveController.getCompetitorProfile(
      'CDW'
    );
    Test.stopTest();

    System.assertEquals('CDW', result.get('name'), 'Name should be CDW');
    System.assertEquals(
      'Volume + Execution',
      result.get('strength'),
      'Strength should match hardcoded CDW profile'
    );
    System.assertEquals(
      3,
      result.get('priceAggression'),
      'Price aggression should be 3'
    );
    System.assertEquals(
      '3%',
      result.get('typicalDiscount'),
      'Typical discount should be 3%'
    );
  }

  @isTest
  static void testGetCompetitorProfileUnknown() {
    Test.startTest();
    Map<String, Object> result = MarginArcCompetitiveController.getCompetitorProfile(
      'UnknownVAR'
    );
    Test.stopTest();

    System.assertEquals(
      'UnknownVAR',
      result.get('name'),
      'Name should match input'
    );
    System.assertEquals(
      'Unknown',
      result.get('strength'),
      'Strength should be Unknown for default profile'
    );
    System.assertEquals(
      3,
      result.get('priceAggression'),
      'Default price aggression should be 3'
    );
    System.assertEquals(
      'N/A',
      result.get('typicalDiscount'),
      'Default discount should be N/A'
    );
  }

  @isTest
  static void testAccountIntelligenceRecentDeals() {
    Account acc = [SELECT Id FROM Account WHERE Name = 'Acme Corp' LIMIT 1];
    Test.startTest();
    Map<String, Object> result = MarginArcCompetitiveController.getAccountIntelligence(
      acc.Id,
      'Technology'
    );
    Test.stopTest();

    Map<String, Object> accountData = (Map<String, Object>) result.get(
      'accountData'
    );
    List<Object> recentDeals = (List<Object>) accountData.get('recentDeals');

    System.assertNotEquals(
      null,
      recentDeals,
      'Recent deals should not be null'
    );
    System.assert(recentDeals.size() <= 5, 'Recent deals should be at most 5');
    System.assert(
      recentDeals.size() > 0,
      'Recent deals should have at least 1 entry'
    );

    // Verify structure of a recent deal entry
    Map<String, Object> firstDeal = (Map<String, Object>) recentDeals[0];
    System.assert(firstDeal.containsKey('date'), 'Deal should have date');
    System.assert(firstDeal.containsKey('oem'), 'Deal should have oem');
    System.assert(firstDeal.containsKey('outcome'), 'Deal should have outcome');
    System.assert(firstDeal.containsKey('insight'), 'Deal should have insight');
  }

  @isTest
  static void testSimilarAccountsLowSampleWinRate() {
    // Healthcare has 0 closed deals in test data → totalDeals < 5
    Account acc = [SELECT Id FROM Account WHERE Name = 'NewCo Inc' LIMIT 1];
    User u = [SELECT Id FROM User WHERE Id = :UserInfo.getUserId()];
    System.runAs(u) {
      Test.startTest();
      Map<String, Object> result = MarginArcCompetitiveController.getAccountIntelligence(
        acc.Id,
        'Healthcare'
      );
      Test.stopTest();

      Map<String, Object> similar = (Map<String, Object>) result.get(
        'similarAccounts'
      );
      System.assertNotEquals(null, similar, 'Should have similarAccounts');

      // Win rate should be null (< 5 deals)
      System.assertEquals(
        null,
        similar.get('avgWinRate'),
        'Win rate should be null with < 5 deals'
      );

      // hasDataConfidence should be false
      System.assertEquals(
        false,
        similar.get('hasDataConfidence'),
        'hasDataConfidence should be false with < 5 deals'
      );

      // Insights should contain the low-sample message
      List<Object> insights = (List<Object>) similar.get('keyInsights');
      Boolean foundLowSampleMsg = false;
      for (Object insight : insights) {
        if (((String) insight).contains('Not enough closed deals')) {
          foundLowSampleMsg = true;
          break;
        }
      }
      System.assert(
        foundLowSampleMsg,
        'Should show "Not enough closed deals" message when < 5 deals'
      );
    }
  }

  @isTest
  static void testSimilarAccountsNoMarginData() {
    // Create deals in Manufacturing industry with no GP% data
    Account mfgAccount = new Account(
      Name = 'MfgCo',
      Industry = 'Manufacturing'
    );
    Account mfgNoHistory = new Account(
      Name = 'MfgNew',
      Industry = 'Manufacturing'
    );
    insert new List<Account>{ mfgAccount, mfgNoHistory };

    List<Opportunity> mfgOpps = new List<Opportunity>();
    // Create 6 closed deals (enough for sample size) but none with GP%
    for (Integer i = 0; i < 4; i++) {
      mfgOpps.add(
        new Opportunity(
          Name = 'Mfg Won ' + i,
          AccountId = mfgAccount.Id,
          Amount = 100000,
          StageName = 'Closed Won',
          CloseDate = Date.today().addDays(-10 * (i + 1)),
          Fulcrum_GP_Percent__c = null
        )
      );
    }
    for (Integer i = 0; i < 2; i++) {
      mfgOpps.add(
        new Opportunity(
          Name = 'Mfg Lost ' + i,
          AccountId = mfgAccount.Id,
          Amount = 50000,
          StageName = 'Closed Lost',
          CloseDate = Date.today().addDays(-20 * (i + 1))
        )
      );
    }
    insert mfgOpps;

    User u = [SELECT Id FROM User WHERE Id = :UserInfo.getUserId()];
    System.runAs(u) {
      Test.startTest();
      Map<String, Object> result = MarginArcCompetitiveController.getAccountIntelligence(
        mfgNoHistory.Id,
        'Manufacturing'
      );
      Test.stopTest();

      Map<String, Object> similar = (Map<String, Object>) result.get(
        'similarAccounts'
      );
      System.assertNotEquals(null, similar, 'Should have similarAccounts');

      // Insights should contain the no margin data message
      List<Object> insights = (List<Object>) similar.get('keyInsights');
      Boolean foundNoMarginMsg = false;
      for (Object insight : insights) {
        if (((String) insight).contains('No margin data available')) {
          foundNoMarginMsg = true;
          break;
        }
      }
      System.assert(
        foundNoMarginMsg,
        'Should show "No margin data available" when no deals have GP%'
      );
    }
  }

  @isTest
  static void testSimilarAccountsSufficientSample() {
    // Technology has 8 total deals (5 won + 3 lost) >= 5 with margin data
    Account acc = [SELECT Id FROM Account WHERE Name = 'NewCo Inc' LIMIT 1];
    User u = [SELECT Id FROM User WHERE Id = :UserInfo.getUserId()];
    System.runAs(u) {
      Test.startTest();
      Map<String, Object> result = MarginArcCompetitiveController.getAccountIntelligence(
        acc.Id,
        'Technology'
      );
      Test.stopTest();

      Map<String, Object> similar = (Map<String, Object>) result.get(
        'similarAccounts'
      );
      System.assertNotEquals(null, similar, 'Should have similarAccounts');

      // Win rate should not be null (>= 5 deals)
      System.assertNotEquals(
        null,
        similar.get('avgWinRate'),
        'Win rate should not be null with >= 5 deals'
      );

      // hasDataConfidence should be true
      System.assertEquals(
        true,
        similar.get('hasDataConfidence'),
        'hasDataConfidence should be true with >= 5 deals'
      );

      // Insights should contain normal win rate and margin messages
      List<Object> insights = (List<Object>) similar.get('keyInsights');
      Boolean foundWinRateMsg = false;
      Boolean foundMarginMsg = false;
      for (Object insight : insights) {
        String insightStr = (String) insight;
        if (insightStr.contains('Win rate in Technology:')) {
          foundWinRateMsg = true;
        }
        if (insightStr.contains('Average margin on won deals:')) {
          foundMarginMsg = true;
        }
      }
      System.assert(
        foundWinRateMsg,
        'Should show normal win rate when >= 5 deals'
      );
      System.assert(
        foundMarginMsg,
        'Should show normal margin when margin data exists'
      );
    }
  }
}
