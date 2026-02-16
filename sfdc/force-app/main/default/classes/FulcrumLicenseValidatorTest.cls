@isTest
private class FulcrumLicenseValidatorTest {
  @TestSetup
  static void setupTestData() {
    // Assign Fulcrum_Admin permission set to avoid FLS issues in scratch org
    User thisUser = [SELECT Id FROM User WHERE Id = :UserInfo.getUserId()];
    System.runAs(thisUser) {
      try {
        PermissionSet ps = [
          SELECT Id
          FROM PermissionSet
          WHERE Name = 'Fulcrum_Admin'
          LIMIT 1
        ];
        PermissionSetAssignment psa = new PermissionSetAssignment(
          PermissionSetId = ps.Id,
          AssigneeId = UserInfo.getUserId()
        );
        insert psa;
      } catch (Exception e) {
        System.debug('Permission set assignment skipped: ' + e.getMessage());
      }
    }

    // Create test license
    Fulcrum_License__c license = new Fulcrum_License__c();
    license.License_Key__c = 'TEST-LICENSE-KEY';
    license.Customer_ID__c = 'test-uuid-12345';
    license.Seats_Licensed__c = 50;
    license.Expiry_Date__c = Date.today().addDays(30);
    license.Status__c = 'active';
    license.Org_ID__c = UserInfo.getOrganizationId();
    license.Mothership_URL__c = 'https://api.marginarc.com';
    license.Last_Validated__c = System.now().addDays(-10);
    upsert license;

    // Create test opportunities for telemetry
    List<Opportunity> opps = new List<Opportunity>();
    for (Integer i = 0; i < 5; i++) {
      Opportunity opp = new Opportunity(
        Name = 'Test Opp ' + i,
        StageName = 'Prospecting',
        CloseDate = Date.today().addDays(30),
        Fulcrum_Recommended_Margin__c = 25.5
      );
      opps.add(opp);
    }
    insert opps;
  }

  @isTest
  static void testValidateLicenseSuccess() {
    Test.setMock(HttpCalloutMock.class, FulcrumLicenseMock.successValidation());

    Test.startTest();
    FulcrumLicenseValidator.validateLicense();
    Test.stopTest();

    Fulcrum_License__c license = Fulcrum_License__c.getOrgDefaults();
    System.assertEquals('active', license.Status__c);
    System.assertNotEquals(null, license.Last_Validated__c);
  }

  @isTest
  static void testValidateLicenseInvalid() {
    Test.setMock(HttpCalloutMock.class, FulcrumLicenseMock.invalidLicense());

    Test.startTest();
    FulcrumLicenseValidator.validateLicense();
    Test.stopTest();

    Fulcrum_License__c license = Fulcrum_License__c.getOrgDefaults();
    System.assertEquals('expired', license.Status__c);
  }

  @isTest
  static void testValidateLicenseRevoked() {
    // Mark license as revoked
    Fulcrum_License__c license = Fulcrum_License__c.getOrgDefaults();
    license.Status__c = 'revoked';
    update license;

    Test.setMock(HttpCalloutMock.class, FulcrumLicenseMock.successValidation());

    Test.startTest();
    FulcrumLicenseValidator.validateLicense();
    Test.stopTest();

    // Should still be revoked (validation skipped)
    license = Fulcrum_License__c.getOrgDefaults();
    System.assertEquals('revoked', license.Status__c);
  }

  @isTest
  static void testValidateLicenseExpiredByDate() {
    // Set expiry date in the past
    Fulcrum_License__c license = Fulcrum_License__c.getOrgDefaults();
    license.Expiry_Date__c = Date.today().addDays(-5);
    update license;

    Test.startTest();
    FulcrumLicenseValidator.validateLicense();
    Test.stopTest();

    license = Fulcrum_License__c.getOrgDefaults();
    System.assertEquals('expired', license.Status__c);
  }

  @isTest
  static void testValidateLicenseGracePeriod60Days() {
    // Set last validated to 65 days ago (beyond grace period)
    Fulcrum_License__c license = Fulcrum_License__c.getOrgDefaults();
    license.Last_Validated__c = System.now().addDays(-65);
    update license;

    // Mock network failure
    Test.setMock(HttpCalloutMock.class, FulcrumLicenseMock.networkError());

    Test.startTest();
    FulcrumLicenseValidator.validateLicense();
    Test.stopTest();

    license = Fulcrum_License__c.getOrgDefaults();
    System.assertEquals(
      'expired',
      license.Status__c,
      'Should expire after 60 days without validation'
    );
  }

  @isTest
  static void testValidateLicenseGracePeriod30Days() {
    // Set last validated to 35 days ago (warning period)
    Fulcrum_License__c license = Fulcrum_License__c.getOrgDefaults();
    license.Last_Validated__c = System.now().addDays(-35);
    update license;

    // Mock network failure
    Test.setMock(HttpCalloutMock.class, FulcrumLicenseMock.networkError());

    Test.startTest();
    FulcrumLicenseValidator.validateLicense();
    Test.stopTest();

    license = Fulcrum_License__c.getOrgDefaults();
    System.assertEquals(
      'active',
      license.Status__c,
      'Should stay active during warning period'
    );
  }

  @isTest
  static void testSendTelemetry() {
    Test.setMock(HttpCalloutMock.class, FulcrumLicenseMock.successTelemetry());

    Test.startTest();
    FulcrumLicenseValidator.sendTelemetry();
    Test.stopTest();

    // No assertions needed - just verify no exceptions
    System.assert(true, 'Telemetry should complete without errors');
  }

  @isTest
  static void testSendTelemetryNoLicense() {
    // Delete the license
    delete [SELECT Id FROM Fulcrum_License__c];

    Test.startTest();
    FulcrumLicenseValidator.sendTelemetry();
    Test.stopTest();

    // Should handle gracefully when no license exists
    System.assert(true, 'Should handle missing license gracefully');
  }

  @isTest
  static void testScheduledValidation() {
    Test.setMock(HttpCalloutMock.class, FulcrumLicenseMock.successValidation());

    Test.startTest();
    FulcrumLicenseValidator validator = new FulcrumLicenseValidator();
    String cronExp = '0 0 2 ? * SUN';
    String jobId = System.schedule(
      'Test Fulcrum License Validator',
      cronExp,
      validator
    );
    Test.stopTest();

    // Verify job was scheduled
    CronTrigger ct = [
      SELECT Id, CronExpression, TimesTriggered, NextFireTime
      FROM CronTrigger
      WHERE Id = :jobId
    ];
    System.assertEquals(cronExp, ct.CronExpression);
    System.assertEquals(0, ct.TimesTriggered);
  }

  @isTest
  static void testValidateLicenseNow() {
    Test.setMock(HttpCalloutMock.class, FulcrumLicenseMock.successValidation());

    Test.startTest();
    Map<String, Object> result = FulcrumLicenseValidator.validateLicenseNow();
    Test.stopTest();

    System.assertEquals(true, result.get('success'));
    System.assert(((String) result.get('message')).contains('started'));
  }
}
