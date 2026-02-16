public class MarginArcLicenseValidator implements Schedulable, Database.AllowsCallouts {
  public void execute(SchedulableContext sc) {
    validateLicenseAsync();
    sendTelemetryAsync();
  }

  @future(callout=true)
  public static void validateLicenseAsync() {
    validateLicense();
  }

  @future(callout=true)
  public static void sendTelemetryAsync() {
    sendTelemetry();
  }

  @AuraEnabled
  public static Map<String, Object> validateLicenseNow() {
    Map<String, Object> result = new Map<String, Object>();
    try {
      validateLicenseAsync();
      result.put('success', true);
      result.put(
        'message',
        'License validation started. Check back in a moment.'
      );
    } catch (Exception e) {
      result.put('success', false);
      result.put('message', 'Error: ' + e.getMessage());
    }
    return result;
  }

  public static void validateLicense() {
    try {
      // 1. Get Fulcrum_License__c org defaults
      Fulcrum_License__c license = Fulcrum_License__c.getOrgDefaults();

      if (license == null || String.isBlank(license.License_Key__c)) {
        System.debug('No license configured, skipping validation');
        return;
      }

      // 2. If Status__c = 'revoked', skip
      if (license.Status__c == 'revoked') {
        System.debug('License is revoked, skipping validation');
        return;
      }

      // Check if already expired by date
      if (
        license.Expiry_Date__c != null &&
        license.Expiry_Date__c < Date.today()
      ) {
        license.Status__c = 'expired';
        updateLicenseStatus(license);
        return;
      }

      // 3. Make HTTP POST to /api/v1/license/validate
      String mothershipUrl = license.Mothership_URL__c;
      if (String.isBlank(mothershipUrl)) {
        mothershipUrl = 'https://api.marginarc.com';
      }

      Map<String, Object> requestBody = new Map<String, Object>{
        'license_key' => license.License_Key__c,
        'org_id' => license.Org_ID__c
      };

      HttpRequest req = new HttpRequest();
      req.setEndpoint(mothershipUrl + '/api/v1/license/validate');
      req.setMethod('POST');
      req.setHeader('Content-Type', 'application/json');
      req.setBody(JSON.serialize(requestBody));
      req.setTimeout(30000);

      Http http = new Http();
      HttpResponse res = http.send(req);

      if (res.getStatusCode() == 200) {
        Map<String, Object> responseData = (Map<String, Object>) JSON.deserializeUntyped(
          res.getBody()
        );
        Boolean valid = (Boolean) responseData.get('valid');

        if (valid == true) {
          // 4. Update Last_Validated__c and config
          license.Last_Validated__c = System.now();

          Map<String, Object> config = (Map<String, Object>) responseData.get(
            'config'
          );
          if (config != null) {
            // Update license fields from config
            String status = (String) config.get('status');
            if (String.isNotBlank(status)) {
              license.Status__c = status;
            }

            Decimal seats = (Decimal) config.get('seats_licensed');
            if (seats != null) {
              license.Seats_Licensed__c = seats;
            }

            String expiryDateStr = (String) config.get('expiry_date');
            if (String.isNotBlank(expiryDateStr)) {
              license.Expiry_Date__c = Date.valueOf(expiryDateStr);
            }

            // Update Fulcrum_Config__c if keys changed
            String geminiApiKey = (String) config.get('gemini_api_key');
            String marginArcApiUrl = (String) config.get('fulcrum_api_url');

            if (
              String.isNotBlank(geminiApiKey) ||
              String.isNotBlank(marginArcApiUrl)
            ) {
              updateMarginArcConfig(geminiApiKey, marginArcApiUrl);
            }
          }

          updateLicenseStatus(license);
        } else {
          // 5. If response.valid = false, update Status__c
          license.Status__c = 'expired';
          updateLicenseStatus(license);
        }
      } else {
        // Network failure - implement grace period logic
        handleValidationFailure(license);
      }
    } catch (System.CalloutException e) {
      // Network failure - implement grace period logic
      Fulcrum_License__c license = Fulcrum_License__c.getOrgDefaults();
      if (license != null) {
        handleValidationFailure(license);
      }
    } catch (Exception e) {
      System.debug('Validation error: ' + e.getMessage());
    }
  }

  private static void handleValidationFailure(Fulcrum_License__c license) {
    // 6. Implement grace period logic
    if (license.Last_Validated__c != null) {
      Integer daysSinceValidation = license.Last_Validated__c.date()
        .daysBetween(Date.today());

      if (daysSinceValidation > 60) {
        // More than 60 days - expire the license
        license.Status__c = 'expired';
        updateLicenseStatus(license);
        System.debug('License expired: No validation for 60+ days');
      } else if (daysSinceValidation > 30) {
        // 30-60 days - log warning but keep active
        System.debug(
          'Warning: License validation overdue (' +
            daysSinceValidation +
            ' days)'
        );
      }
    }
  }

  public static void sendTelemetry() {
    try {
      Fulcrum_License__c license = Fulcrum_License__c.getOrgDefaults();

      if (license == null || String.isBlank(license.License_Key__c)) {
        return;
      }

      // 1. Collect stats from last week
      Date lastWeek = Date.today().addDays(-7);

      // Count opportunities analyzed in the last 7 days
      Integer oppsAnalyzed = [
        SELECT COUNT()
        FROM Opportunity
        WHERE
          Fulcrum_Recommended_Margin__c != NULL
          AND LastModifiedDate >= :lastWeek
          AND LastModifiedDate <= :System.now()
      ];

      // Count active users (users who logged in during the last 7 days)
      Set<Id> activeUserIds = new Set<Id>();
      for (LoginHistory lh : [
        SELECT UserId
        FROM LoginHistory
        WHERE LoginTime >= :lastWeek AND LoginTime <= :System.now()
      ]) {
        activeUserIds.add(lh.UserId);
      }
      Integer activeUsers = activeUserIds.size();

      // 2. Make HTTP POST to /api/v1/telemetry
      String mothershipUrl = license.Mothership_URL__c;
      if (String.isBlank(mothershipUrl)) {
        mothershipUrl = 'https://api.marginarc.com';
      }

      Map<String, Object> telemetry = new Map<String, Object>{
        'opportunities_analyzed' => oppsAnalyzed,
        'active_users' => activeUsers,
        'collection_date' => System.now().format('yyyy-MM-dd\'T\'HH:mm:ss\'Z\'')
      };

      Map<String, Object> requestBody = new Map<String, Object>{
        'license_key' => license.License_Key__c,
        'org_id' => license.Org_ID__c,
        'telemetry' => telemetry
      };

      HttpRequest req = new HttpRequest();
      req.setEndpoint(mothershipUrl + '/api/v1/telemetry');
      req.setMethod('POST');
      req.setHeader('Content-Type', 'application/json');
      req.setBody(JSON.serialize(requestBody));
      req.setTimeout(30000);

      Http http = new Http();
      HttpResponse res = http.send(req);

      if (res.getStatusCode() == 200) {
        System.debug('Telemetry sent successfully');
      } else {
        System.debug('Telemetry failed: ' + res.getStatusCode());
      }
    } catch (Exception e) {
      System.debug('Telemetry error: ' + e.getMessage());
    }
  }

  private static void updateLicenseStatus(Fulcrum_License__c license) {
    SObjectAccessDecision decision = Security.stripInaccessible(
      AccessType.UPDATABLE,
      new List<Fulcrum_License__c>{ license }
    );
    update decision.getRecords();
  }

  private static void updateMarginArcConfig(
    String geminiApiKey,
    String marginArcApiUrl
  ) {
    Fulcrum_Config__c config = Fulcrum_Config__c.getOrgDefaults();
    if (config == null) {
      config = new Fulcrum_Config__c();
    }

    Boolean updated = false;
    if (String.isNotBlank(geminiApiKey)) {
      config.Gemini_API_Key__c = geminiApiKey;
      updated = true;
    }
    if (String.isNotBlank(marginArcApiUrl)) {
      config.API_URL__c = marginArcApiUrl;
      updated = true;
    }

    if (updated) {
      SObjectAccessDecision decision = Security.stripInaccessible(
        AccessType.UPSERTABLE,
        new List<Fulcrum_Config__c>{ config }
      );
      upsert decision.getRecords();
    }
  }
}
