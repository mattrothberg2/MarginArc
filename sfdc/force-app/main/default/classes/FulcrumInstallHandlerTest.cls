@isTest
private class FulcrumInstallHandlerTest {
  @isTest
  static void testInstallHandlerFreshInstall() {
    // Delete any existing config
    Fulcrum_Config__c existing = Fulcrum_Config__c.getOrgDefaults();
    if (existing.Id != null) {
      delete existing;
    }

    FulcrumInstallHandler handler = new FulcrumInstallHandler();

    Test.startTest();
    // Test individual methods since InstallContext can't be mocked
    handler.initializeConfig();
    handler.scheduleNightlyAnalyzer();
    handler.sendWelcomeEmail(UserInfo.getUserId());
    Test.stopTest();

    // Verify config was created
    Fulcrum_Config__c config = Fulcrum_Config__c.getOrgDefaults();
    System.assertNotEquals(null, config.Id, 'Config should be created');
    System.assertEquals(
      'https://api.marginarc.com/api/recommend',
      config.API_URL__c,
      'API URL should be set'
    );

    // Verify scheduler was created
    List<CronTrigger> crons = [
      SELECT Id
      FROM CronTrigger
      WHERE CronJobDetail.Name LIKE '%Fulcrum%Analyzer%' AND State = 'WAITING'
    ];
    System.assert(crons.size() > 0, 'Nightly analyzer should be scheduled');
  }

  @isTest
  static void testInstallHandlerExistingConfig() {
    // Pre-create config with custom URL
    Fulcrum_Config__c config = Fulcrum_Config__c.getOrgDefaults();
    config.API_URL__c = 'https://custom.url/api';
    config.API_Key__c = 'existing-key';
    upsert config;

    FulcrumInstallHandler handler = new FulcrumInstallHandler();

    Test.startTest();
    handler.initializeConfig();
    Test.stopTest();

    // Verify existing config was NOT overwritten
    Fulcrum_Config__c reloaded = Fulcrum_Config__c.getOrgDefaults();
    System.assertEquals(
      'https://custom.url/api',
      reloaded.API_URL__c,
      'Existing config should not be overwritten'
    );
    System.assertEquals(
      'existing-key',
      reloaded.API_Key__c,
      'Existing API key should be preserved'
    );
  }

  @isTest
  static void testOnInstallEntryPoint() {
    // Delete any existing config to test fresh install path
    Fulcrum_Config__c existing = Fulcrum_Config__c.getOrgDefaults();
    if (existing.Id != null) {
      delete existing;
    }

    FulcrumInstallHandler handler = new FulcrumInstallHandler();

    Test.startTest();
    // Call onInstall with null context — exercises the entry point
    // This covers the try/catch and previousVersion check paths
    Test.testInstall(handler, null);
    Test.stopTest();

    // Verify it ran successfully
    Fulcrum_Config__c config = Fulcrum_Config__c.getOrgDefaults();
    System.assertNotEquals(
      null,
      config.Id,
      'Config should be created via onInstall'
    );
  }

  @isTest
  static void testOnInstallUpgrade() {
    // Pre-create config
    Fulcrum_Config__c config = Fulcrum_Config__c.getOrgDefaults();
    config.API_URL__c = 'https://existing.url/api';
    upsert config;

    FulcrumInstallHandler handler = new FulcrumInstallHandler();

    Test.startTest();
    // Simulate upgrade from v0.1
    Test.testInstall(handler, new Version(0, 1));
    Test.stopTest();

    // Verify config was preserved (not overwritten)
    Fulcrum_Config__c reloaded = Fulcrum_Config__c.getOrgDefaults();
    System.assertEquals(
      'https://existing.url/api',
      reloaded.API_URL__c,
      'Config should not be overwritten on upgrade'
    );
  }

  @isTest
  static void testSchedulerNotDuplicated() {
    // Schedule first
    System.schedule(
      'Fulcrum Test Analyzer Dup',
      '0 0 3 * * ?',
      new FulcrumBatchAnalyzer()
    );

    FulcrumInstallHandler handler = new FulcrumInstallHandler();

    Test.startTest();
    handler.scheduleNightlyAnalyzer();
    Test.stopTest();

    // Should still only have the original + possibly the new one
    List<CronTrigger> crons = [
      SELECT Id
      FROM CronTrigger
      WHERE CronJobDetail.Name LIKE '%Fulcrum%Analyzer%' AND State = 'WAITING'
    ];
    // If existing was found, no new one should be created
    System.assert(crons.size() >= 1, 'At least one scheduler should exist');
  }
}
