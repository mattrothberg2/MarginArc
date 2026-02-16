public with sharing class FulcrumLicenseActivator {
  private static final String DEFAULT_MOTHERSHIP_URL = 'https://api.marginarc.com';

  @AuraEnabled
  public static Map<String, Object> activateLicense(String licenseKey) {
    Map<String, Object> result = new Map<String, Object>();

    try {
      // 1. Validate input
      if (String.isBlank(licenseKey)) {
        result.put('success', false);
        result.put('message', 'License key is required');
        return result;
      }

      // 2. Get mothership URL from Fulcrum_License__c or default
      Fulcrum_License__c existingLicense = Fulcrum_License__c.getOrgDefaults();
      String mothershipUrl = DEFAULT_MOTHERSHIP_URL;
      if (
        existingLicense != null &&
        String.isNotBlank(existingLicense.Mothership_URL__c)
      ) {
        mothershipUrl = existingLicense.Mothership_URL__c;
      }

      // 3. Make HTTP POST to /api/v1/license/activate
      String orgId = UserInfo.getOrganizationId();
      Map<String, Object> requestBody = new Map<String, Object>{
        'license_key' => licenseKey,
        'org_id' => orgId
      };

      HttpRequest req = new HttpRequest();
      req.setEndpoint(mothershipUrl + '/api/v1/license/activate');
      req.setMethod('POST');
      req.setHeader('Content-Type', 'application/json');
      req.setBody(JSON.serialize(requestBody));
      req.setTimeout(30000); // 30 second timeout

      Http http = new Http();
      HttpResponse res = http.send(req);

      if (res.getStatusCode() == 200) {
        // 4. Parse config response
        Map<String, Object> responseData = (Map<String, Object>) JSON.deserializeUntyped(
          res.getBody()
        );
        Boolean success = (Boolean) responseData.get('success');

        if (success == true) {
          Map<String, Object> config = (Map<String, Object>) responseData.get(
            'config'
          );

          // 5. Store in Fulcrum_License__c
          Fulcrum_License__c license = new Fulcrum_License__c();
          license.License_Key__c = licenseKey;
          license.Customer_ID__c = (String) config.get('customer_id');
          license.Seats_Licensed__c = (Decimal) config.get('seats_licensed');
          license.Expiry_Date__c = Date.valueOf(
            (String) config.get('expiry_date')
          );
          license.Status__c = (String) config.get('status');
          license.Org_ID__c = orgId;
          license.Mothership_URL__c = mothershipUrl;
          license.Last_Validated__c = System.now();

          Decimal phoneHomeInterval = (Decimal) config.get(
            'phone_home_interval_days'
          );
          license.Phone_Home_Interval__c = phoneHomeInterval != null
            ? phoneHomeInterval
            : 7;

          // Use stripInaccessible for security
          SObjectAccessDecision decision = Security.stripInaccessible(
            AccessType.CREATABLE,
            new List<Fulcrum_License__c>{ license }
          );
          upsert decision.getRecords();

          // 6. Update Fulcrum_Config__c with API credentials
          String geminiApiKey = (String) config.get('gemini_api_key');
          String fulcrumApiUrl = (String) config.get('fulcrum_api_url');

          if (
            String.isNotBlank(geminiApiKey) || String.isNotBlank(fulcrumApiUrl)
          ) {
            Fulcrum_Config__c configSetting = Fulcrum_Config__c.getOrgDefaults();
            if (configSetting == null) {
              configSetting = new Fulcrum_Config__c();
            }

            if (String.isNotBlank(geminiApiKey)) {
              configSetting.Gemini_API_Key__c = geminiApiKey;
            }
            if (String.isNotBlank(fulcrumApiUrl)) {
              configSetting.API_URL__c = fulcrumApiUrl;
            }

            SObjectAccessDecision configDecision = Security.stripInaccessible(
              AccessType.UPSERTABLE,
              new List<Fulcrum_Config__c>{ configSetting }
            );
            upsert configDecision.getRecords();
          }

          // 7. Schedule FulcrumLicenseValidator job
          scheduleValidator();

          // 8. Return success
          String expiryDateStr = license.Expiry_Date__c.format();
          Integer seats = Integer.valueOf(license.Seats_Licensed__c);
          result.put('success', true);
          result.put(
            'message',
            'License activated! Expires: ' + expiryDateStr + ', Seats: ' + seats
          );
        } else {
          result.put('success', false);
          result.put(
            'message',
            'Activation failed: ' + responseData.get('message')
          );
        }
      } else {
        result.put('success', false);
        result.put(
          'message',
          'HTTP error ' + res.getStatusCode() + ': ' + res.getStatus()
        );
      }
    } catch (System.CalloutException e) {
      result.put('success', false);
      result.put(
        'message',
        'Network error: Unable to reach mothership. Please check your connection.'
      );
    } catch (Exception e) {
      result.put('success', false);
      result.put('message', 'Error: ' + e.getMessage());
    }

    return result;
  }

  @AuraEnabled(cacheable=false)
  public static Map<String, Object> getLicenseStatus() {
    Map<String, Object> status = new Map<String, Object>();

    Fulcrum_License__c license = Fulcrum_License__c.getOrgDefaults();

    if (license != null && String.isNotBlank(license.License_Key__c)) {
      status.put('hasLicense', true);
      status.put('status', license.Status__c);
      status.put('expiryDate', license.Expiry_Date__c);
      status.put('seatsLicensed', license.Seats_Licensed__c);
      status.put('lastValidated', license.Last_Validated__c);
      status.put('customerID', license.Customer_ID__c);

      // Check if validation is overdue
      if (license.Last_Validated__c != null) {
        Integer daysSinceValidation = license.Last_Validated__c.date()
          .daysBetween(Date.today());
        status.put('daysSinceValidation', daysSinceValidation);
        status.put('validationOverdue', daysSinceValidation > 30);
      }

      // Check if expired
      if (license.Expiry_Date__c != null) {
        status.put('isExpired', license.Expiry_Date__c < Date.today());
      }
    } else {
      status.put('hasLicense', false);
    }

    return status;
  }

  private static void scheduleValidator() {
    // Remove existing scheduled job if present
    List<CronTrigger> existingJobs = [
      SELECT Id, CronJobDetail.Name
      FROM CronTrigger
      WHERE CronJobDetail.Name = 'Fulcrum License Validator'
      LIMIT 1
    ];

    if (!existingJobs.isEmpty()) {
      System.abortJob(existingJobs[0].Id);
    }

    // Schedule weekly validation (Sundays at 2 AM)
    String cronExp = '0 0 2 ? * SUN';
    System.schedule(
      'Fulcrum License Validator',
      cronExp,
      new FulcrumLicenseValidator()
    );
  }
}
