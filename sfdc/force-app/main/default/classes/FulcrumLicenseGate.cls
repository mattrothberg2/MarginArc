/**
 * Centralized license enforcement gate for MarginArc.
 * Checks Fulcrum_License__c org defaults and validates that the license
 * is active, not expired, and not revoked before allowing gated operations.
 *
 * Usage:
 *   - FulcrumLicenseGate.assertActive();   // throws AuraHandledException if invalid
 *   - FulcrumLicenseGate.isActive();        // returns Boolean (non-throwing, for batch)
 *   - FulcrumLicenseGate.checkLicense();    // returns full status map
 */
public with sharing class FulcrumLicenseGate {
  // Cache the result for the transaction to avoid repeated queries
  private static Boolean cachedValid = null;
  private static String cachedMessage = null;
  private static Integer cachedDaysRemaining = null;

  /**
   * Reset the transaction-level cache.
   * Primarily used by tests to re-evaluate license state within a single transaction.
   */
  @TestVisible
  private static void resetCache() {
    cachedValid = null;
    cachedMessage = null;
    cachedDaysRemaining = null;
  }

  /**
   * Check if the license is active. Returns a map with:
   *   valid (Boolean), message (String), daysRemaining (Integer)
   * Caches result for the transaction.
   */
  @AuraEnabled
  public static Map<String, Object> checkLicense() {
    // Return cached result if available
    if (cachedValid != null) {
      Map<String, Object> cached = new Map<String, Object>();
      cached.put('valid', cachedValid);
      cached.put('message', cachedMessage);
      cached.put('daysRemaining', cachedDaysRemaining);
      return cached;
    }

    Map<String, Object> result = new Map<String, Object>();

    Fulcrum_License__c license = Fulcrum_License__c.getOrgDefaults();

    // No license record or blank License_Key
    if (license == null || String.isBlank(license.License_Key__c)) {
      result.put('valid', false);
      result.put(
        'message',
        'No license configured. Go to MarginArc Setup to enter your license key.'
      );
      result.put('daysRemaining', null);
      cacheResult(result);
      return result;
    }

    String status = license.Status__c;

    // Revoked
    if (status == 'revoked') {
      result.put('valid', false);
      result.put('message', 'License has been revoked');
      result.put('daysRemaining', null);
      cacheResult(result);
      return result;
    }

    // Suspended
    if (status == 'suspended') {
      result.put('valid', false);
      result.put('message', 'License suspended');
      result.put('daysRemaining', null);
      cacheResult(result);
      return result;
    }

    // Expired status (explicit)
    if (status == 'expired') {
      result.put('valid', false);
      result.put('message', 'License expired');
      result.put('daysRemaining', null);
      cacheResult(result);
      return result;
    }

    // Pending or blank/null status with a License_Key -> grace period (allow)
    if (status == 'pending' || String.isBlank(status)) {
      result.put('valid', true);
      result.put('message', 'License pending activation');
      result.put('daysRemaining', null);
      cacheResult(result);
      return result;
    }

    // Warning or grace_period status -> allow but log a warning
    if (status == 'warning' || status == 'grace_period') {
      System.debug(
        LoggingLevel.WARN,
        'MarginArc license status is "' +
          status +
          '". Please resolve before the grace period ends.'
      );
      result.put('valid', true);
      result.put(
        'message',
        'License in ' + status + ' state. Please contact your administrator.'
      );
      result.put('daysRemaining', null);
      cacheResult(result);
      return result;
    }

    // Active status - check expiry date
    if (status == 'active') {
      if (license.Expiry_Date__c != null) {
        Integer daysRemaining = Date.today()
          .daysBetween(license.Expiry_Date__c);

        if (daysRemaining < 0) {
          // Expired by date
          result.put('valid', false);
          result.put(
            'message',
            'License expired on ' + license.Expiry_Date__c.format()
          );
          result.put('daysRemaining', daysRemaining);
          cacheResult(result);
          return result;
        }

        if (daysRemaining <= 14) {
          // Expiring soon - allow but warn
          result.put('valid', true);
          result.put(
            'message',
            'License expires in ' +
              daysRemaining +
              ' day' +
              (daysRemaining == 1 ? '' : 's') +
              '. Please renew soon.'
          );
          result.put('daysRemaining', daysRemaining);
          cacheResult(result);
          return result;
        }

        // Active and not expiring soon
        result.put('valid', true);
        result.put('message', 'License active');
        result.put('daysRemaining', daysRemaining);
        cacheResult(result);
        return result;
      }

      // Active with no expiry date set - allow
      result.put('valid', true);
      result.put('message', 'License active');
      result.put('daysRemaining', null);
      cacheResult(result);
      return result;
    }

    // Unknown status - deny by default
    result.put('valid', false);
    result.put('message', 'Unknown license status: ' + status);
    result.put('daysRemaining', null);
    cacheResult(result);
    return result;
  }

  /**
   * Throws AuraHandledException if license is invalid.
   * Call this at the top of @AuraEnabled methods that should be gated.
   */
  public static void assertActive() {
    Map<String, Object> result = checkLicense();
    if (!(Boolean) result.get('valid')) {
      String msg =
        'MarginArc license required: ' + (String) result.get('message');
      AuraHandledException ex = new AuraHandledException(msg);
      ex.setMessage(msg);
      throw ex;
    }
  }

  /**
   * Non-throwing version for batch jobs - returns false instead of throwing.
   */
  public static Boolean isActive() {
    Map<String, Object> result = checkLicense();
    return (Boolean) result.get('valid');
  }

  /**
   * Cache the license check result for the remainder of the transaction.
   */
  private static void cacheResult(Map<String, Object> result) {
    cachedValid = (Boolean) result.get('valid');
    cachedMessage = (String) result.get('message');
    cachedDaysRemaining = (Integer) result.get('daysRemaining');
  }
}
