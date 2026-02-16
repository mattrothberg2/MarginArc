@isTest
private class MarginArcLicenseActivatorTest {
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
        // Permission set already assigned or doesn't exist
        System.debug('Permission set assignment skipped: ' + e.getMessage());
      }
    }
  }

  @isTest
  static void testActivateLicenseSuccess() {
    Test.setMock(HttpCalloutMock.class, MarginArcLicenseMock.successActivation());

    Test.startTest();
    Map<String, Object> result = MarginArcLicenseActivator.activateLicense(
      'TEST-LICENSE-KEY'
    );
    Test.stopTest();

    System.assertEquals(
      true,
      result.get('success'),
      'Activation should succeed'
    );
    System.assert(
      ((String) result.get('message')).contains('activated'),
      'Should contain success message'
    );

    // Verify license was stored
    Fulcrum_License__c license = Fulcrum_License__c.getOrgDefaults();
    System.assertNotEquals(null, license, 'License should be created');
    System.assertEquals('TEST-LICENSE-KEY', license.License_Key__c);
    System.assertEquals('test-uuid-12345', license.Customer_ID__c);
    System.assertEquals(50, license.Seats_Licensed__c);
    System.assertEquals('active', license.Status__c);
    System.assertEquals(UserInfo.getOrganizationId(), license.Org_ID__c);
    System.assertEquals(Date.valueOf('2027-02-11'), license.Expiry_Date__c);

    // Verify config was updated
    Fulcrum_Config__c config = Fulcrum_Config__c.getOrgDefaults();
    System.assertNotEquals(null, config, 'Config should be created');
    System.assertEquals('AIza_test_key_123', config.Gemini_API_Key__c);
    System.assertEquals(
      'https://api.marginarc.com/api/recommend',
      config.API_URL__c
    );
  }

  @isTest
  static void testActivateLicenseBlankKey() {
    Test.startTest();
    Map<String, Object> result = MarginArcLicenseActivator.activateLicense('');
    Test.stopTest();

    System.assertEquals(false, result.get('success'));
    System.assert(((String) result.get('message')).contains('required'));
  }

  @isTest
  static void testActivateLicenseNetworkFailure() {
    Test.setMock(HttpCalloutMock.class, MarginArcLicenseMock.networkError());

    Test.startTest();
    Map<String, Object> result = MarginArcLicenseActivator.activateLicense(
      'TEST-LICENSE-KEY'
    );
    Test.stopTest();

    System.assertEquals(false, result.get('success'));
    System.assert(((String) result.get('message')).contains('HTTP error'));
  }

  @isTest
  static void testGetLicenseStatusWithLicense() {
    // Create a license
    Fulcrum_License__c license = new Fulcrum_License__c();
    license.License_Key__c = 'TEST-KEY';
    license.Status__c = 'active';
    license.Seats_Licensed__c = 50;
    license.Expiry_Date__c = Date.today().addDays(30);
    license.Last_Validated__c = System.now().addDays(-10);
    license.Customer_ID__c = 'test-customer-id';
    upsert license;

    Test.startTest();
    Map<String, Object> status = MarginArcLicenseActivator.getLicenseStatus();
    Test.stopTest();

    System.assertEquals(true, status.get('hasLicense'));
    System.assertEquals('active', status.get('status'));
    System.assertEquals(50, status.get('seatsLicensed'));
    System.assertEquals(false, status.get('isExpired'));
    System.assertEquals(10, status.get('daysSinceValidation'));
    System.assertEquals(false, status.get('validationOverdue'));
  }

  @isTest
  static void testGetLicenseStatusOverdue() {
    // Create a license that's overdue for validation
    Fulcrum_License__c license = new Fulcrum_License__c();
    license.License_Key__c = 'TEST-KEY';
    license.Status__c = 'active';
    license.Seats_Licensed__c = 50;
    license.Expiry_Date__c = Date.today().addDays(30);
    license.Last_Validated__c = System.now().addDays(-35); // 35 days ago
    upsert license;

    Test.startTest();
    Map<String, Object> status = MarginArcLicenseActivator.getLicenseStatus();
    Test.stopTest();

    System.assertEquals(true, status.get('hasLicense'));
    System.assertEquals(35, status.get('daysSinceValidation'));
    System.assertEquals(true, status.get('validationOverdue'));
  }

  @isTest
  static void testGetLicenseStatusExpired() {
    // Create an expired license
    Fulcrum_License__c license = new Fulcrum_License__c();
    license.License_Key__c = 'TEST-KEY';
    license.Status__c = 'expired';
    license.Seats_Licensed__c = 50;
    license.Expiry_Date__c = Date.today().addDays(-5); // Expired 5 days ago
    upsert license;

    Test.startTest();
    Map<String, Object> status = MarginArcLicenseActivator.getLicenseStatus();
    Test.stopTest();

    System.assertEquals(true, status.get('hasLicense'));
    System.assertEquals('expired', status.get('status'));
    System.assertEquals(true, status.get('isExpired'));
  }

  @isTest
  static void testGetLicenseStatusNoLicense() {
    Test.startTest();
    Map<String, Object> status = MarginArcLicenseActivator.getLicenseStatus();
    Test.stopTest();

    System.assertEquals(false, status.get('hasLicense'));
  }
}
