@isTest
private class MarginArcLicenseGateTest {
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

  /**
   * Helper to create and upsert a license with given parameters.
   */
  private static void upsertLicense(
    String licenseKey,
    String status,
    Date expiryDate
  ) {
    Fulcrum_License__c license = new Fulcrum_License__c();
    license.License_Key__c = licenseKey;
    license.Status__c = status;
    license.Expiry_Date__c = expiryDate;
    license.Org_ID__c = UserInfo.getOrganizationId();
    license.Mothership_URL__c = 'https://api.marginarc.com';
    upsert license;
  }

  @isTest
  static void testLicenseActive() {
    upsertLicense('TEST-KEY-001', 'active', Date.today().addDays(90));

    Test.startTest();
    Boolean active = MarginArcLicenseGate.isActive();
    Test.stopTest();

    System.assertEquals(
      true,
      active,
      'Active license with future expiry should be valid'
    );
  }

  @isTest
  static void testLicenseExpired() {
    upsertLicense('TEST-KEY-002', 'active', Date.today().addDays(-5));

    Test.startTest();
    Boolean active = MarginArcLicenseGate.isActive();
    Test.stopTest();

    System.assertEquals(
      false,
      active,
      'License with past expiry should be invalid'
    );

    Map<String, Object> result = MarginArcLicenseGate.checkLicense();
    String message = (String) result.get('message');
    System.assert(
      message.contains('expired on'),
      'Message should mention expiry date, got: ' + message
    );
  }

  @isTest
  static void testLicenseExpiredStatus() {
    upsertLicense('TEST-KEY-003', 'expired', Date.today().addDays(30));

    Test.startTest();
    Boolean active = MarginArcLicenseGate.isActive();
    Test.stopTest();

    System.assertEquals(
      false,
      active,
      'License with expired status should be invalid even with future expiry date'
    );
  }

  @isTest
  static void testLicenseRevoked() {
    upsertLicense('TEST-KEY-004', 'revoked', Date.today().addDays(90));

    Test.startTest();
    Boolean active = MarginArcLicenseGate.isActive();
    Test.stopTest();

    System.assertEquals(false, active, 'Revoked license should be invalid');

    Map<String, Object> result = MarginArcLicenseGate.checkLicense();
    String message = (String) result.get('message');
    System.assert(
      message.contains('revoked'),
      'Message should mention revoked status, got: ' + message
    );
  }

  @isTest
  static void testLicenseSuspended() {
    upsertLicense('TEST-KEY-005', 'suspended', Date.today().addDays(90));

    Test.startTest();
    Boolean active = MarginArcLicenseGate.isActive();
    Test.stopTest();

    System.assertEquals(false, active, 'Suspended license should be invalid');

    Map<String, Object> result = MarginArcLicenseGate.checkLicense();
    String message = (String) result.get('message');
    System.assert(
      message.contains('suspended'),
      'Message should mention suspended status, got: ' + message
    );
  }

  @isTest
  static void testNoLicense() {
    // Don't create any license record — start with a clean slate
    // Delete any that might exist from org defaults
    Fulcrum_License__c existing = Fulcrum_License__c.getOrgDefaults();
    if (existing != null && existing.Id != null) {
      existing.License_Key__c = null;
      existing.Status__c = null;
      update existing;
    }

    Test.startTest();
    MarginArcLicenseGate.resetCache();
    Boolean active = MarginArcLicenseGate.isActive();
    Test.stopTest();

    System.assertEquals(false, active, 'No license should be invalid');

    Map<String, Object> result = MarginArcLicenseGate.checkLicense();
    String message = (String) result.get('message');
    System.assert(
      message.contains('No license configured'),
      'Message should indicate no license configured, got: ' + message
    );
  }

  @isTest
  static void testPendingLicense() {
    // Pending status with a license key = grace period (allow)
    upsertLicense('TEST-KEY-006', 'pending', null);

    Test.startTest();
    Boolean active = MarginArcLicenseGate.isActive();
    Test.stopTest();

    System.assertEquals(
      true,
      active,
      'Pending license with key should be valid (grace period)'
    );
  }

  @isTest
  static void testBlankStatusWithKey() {
    // Blank/null status with a license key = grace period (allow)
    upsertLicense('TEST-KEY-007', null, null);

    Test.startTest();
    Boolean active = MarginArcLicenseGate.isActive();
    Test.stopTest();

    System.assertEquals(
      true,
      active,
      'Blank status with license key should be valid (grace period)'
    );
  }

  @isTest
  static void testExpiringLicense() {
    // License expiring in 7 days - should be valid with warning
    upsertLicense('TEST-KEY-008', 'active', Date.today().addDays(7));

    Test.startTest();
    Map<String, Object> result = MarginArcLicenseGate.checkLicense();
    Test.stopTest();

    System.assertEquals(
      true,
      (Boolean) result.get('valid'),
      'Expiring license should still be valid'
    );
    System.assertEquals(
      7,
      (Integer) result.get('daysRemaining'),
      'Days remaining should be 7'
    );

    String message = (String) result.get('message');
    System.assert(
      message.contains('expires in'),
      'Message should contain expiry warning, got: ' + message
    );
    System.assert(
      message.contains('renew'),
      'Message should suggest renewal, got: ' + message
    );
  }

  @isTest
  static void testExpiringLicenseOneDayLeft() {
    // License expiring tomorrow - singular "day"
    upsertLicense('TEST-KEY-009', 'active', Date.today().addDays(1));

    Test.startTest();
    Map<String, Object> result = MarginArcLicenseGate.checkLicense();
    Test.stopTest();

    System.assertEquals(true, (Boolean) result.get('valid'));
    String message = (String) result.get('message');
    System.assert(
      message.contains('1 day'),
      'Message should say "1 day" (singular), got: ' + message
    );
  }

  @isTest
  static void testAssertActiveThrows() {
    upsertLicense('TEST-KEY-010', 'revoked', null);

    Test.startTest();
    Boolean threw = false;
    try {
      MarginArcLicenseGate.assertActive();
    } catch (AuraHandledException e) {
      threw = true;
      System.assert(
        e.getMessage().contains('MarginArc license required'),
        'Exception message should contain license required prefix, got: ' +
        e.getMessage()
      );
    }
    Test.stopTest();

    System.assertEquals(
      true,
      threw,
      'assertActive() should throw AuraHandledException for invalid license'
    );
  }

  @isTest
  static void testAssertActiveDoesNotThrowForValid() {
    upsertLicense('TEST-KEY-011', 'active', Date.today().addDays(90));

    Test.startTest();
    Boolean threw = false;
    try {
      MarginArcLicenseGate.assertActive();
    } catch (AuraHandledException e) {
      threw = true;
    }
    Test.stopTest();

    System.assertEquals(
      false,
      threw,
      'assertActive() should not throw for valid license'
    );
  }

  @isTest
  static void testCachingBehavior() {
    upsertLicense('TEST-KEY-012', 'active', Date.today().addDays(90));

    Test.startTest();
    // First call - queries the custom setting
    Map<String, Object> result1 = MarginArcLicenseGate.checkLicense();
    // Second call - should use cache (no additional query)
    Map<String, Object> result2 = MarginArcLicenseGate.checkLicense();
    Test.stopTest();

    // Both results should be identical
    System.assertEquals(
      result1.get('valid'),
      result2.get('valid'),
      'Cached result should match first result'
    );
    System.assertEquals(
      result1.get('message'),
      result2.get('message'),
      'Cached message should match first message'
    );
    System.assertEquals(
      result1.get('daysRemaining'),
      result2.get('daysRemaining'),
      'Cached daysRemaining should match'
    );
  }

  @isTest
  static void testActiveNoExpiryDate() {
    // Active license with no expiry date set - should still be valid
    upsertLicense('TEST-KEY-013', 'active', null);

    Test.startTest();
    Map<String, Object> result = MarginArcLicenseGate.checkLicense();
    Test.stopTest();

    System.assertEquals(
      true,
      (Boolean) result.get('valid'),
      'Active license with no expiry should be valid'
    );
    System.assertEquals(
      'License active',
      (String) result.get('message'),
      'Message should indicate active'
    );
  }

  @isTest
  static void testCheckLicenseAuraEnabled() {
    // Verify checkLicense() works as @AuraEnabled (callable from LWC)
    upsertLicense('TEST-KEY-014', 'active', Date.today().addDays(60));

    Test.startTest();
    Map<String, Object> result = MarginArcLicenseGate.checkLicense();
    Test.stopTest();

    System.assertNotEquals(null, result, 'Result should not be null');
    System.assertEquals(true, (Boolean) result.get('valid'));
    System.assert(result.containsKey('daysRemaining'));
    System.assert(result.containsKey('message'));
  }

  @isTest
  static void testWarningStatus() {
    // Warning status should be valid (grace period) but message should indicate warning
    upsertLicense('TEST-KEY-015', 'warning', Date.today().addDays(30));

    Test.startTest();
    Boolean active = MarginArcLicenseGate.isActive();
    Test.stopTest();

    System.assertEquals(
      true,
      active,
      'Warning status should be valid (grace period)'
    );

    Map<String, Object> result = MarginArcLicenseGate.checkLicense();
    String message = (String) result.get('message');
    System.assert(
      message.contains('warning'),
      'Message should reference warning state, got: ' + message
    );
  }

  @isTest
  static void testGracePeriodStatus() {
    // grace_period status should be valid but message should indicate grace period
    upsertLicense('TEST-KEY-016', 'grace_period', Date.today().addDays(30));

    Test.startTest();
    Boolean active = MarginArcLicenseGate.isActive();
    Test.stopTest();

    System.assertEquals(true, active, 'grace_period status should be valid');

    Map<String, Object> result = MarginArcLicenseGate.checkLicense();
    String message = (String) result.get('message');
    System.assert(
      message.contains('grace_period'),
      'Message should reference grace_period state, got: ' + message
    );
  }
}
