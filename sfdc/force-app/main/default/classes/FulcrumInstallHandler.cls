/**
 * Post-install script for MarginArc package.
 * Runs automatically when the package is installed or upgraded.
 *
 * Responsibilities:
 * - Initialize default Fulcrum_Config__c custom setting
 * - Schedule the nightly batch analyzer (if not already scheduled)
 * - Send welcome email to installing admin
 */
global class FulcrumInstallHandler implements InstallHandler {
  global void onInstall(InstallContext context) {
    try {
      initializeConfig();
      initializeLicenseConfig();
      scheduleNightlyAnalyzer();
      if (context.previousVersion() == null) {
        sendWelcomeEmail(context.installerID());
      }
    } catch (Exception e) {
      System.debug(
        LoggingLevel.ERROR,
        'Fulcrum install handler error: ' + e.getMessage()
      );
    }
  }

  /**
   * Creates default Fulcrum_Config__c org defaults if they don't exist.
   */
  @TestVisible
  private void initializeConfig() {
    Fulcrum_Config__c config = Fulcrum_Config__c.getOrgDefaults();
    if (config.Id == null) {
      config.API_URL__c = 'https://api.marginarc.com/api/recommend';
      upsert config;
    }
  }

  /**
   * Initializes Fulcrum_License__c with mothership URL.
   */
  @TestVisible
  private void initializeLicenseConfig() {
    Fulcrum_License__c license = Fulcrum_License__c.getOrgDefaults();
    if (license.Id == null) {
      license.Mothership_URL__c = 'https://api.marginarc.com';
      license.Status__c = 'pending';
      license.Org_ID__c = UserInfo.getOrganizationId();
      license.Phone_Home_Interval__c = 7;
      upsert license;
    }
  }

  /**
   * Schedules FulcrumBatchAnalyzer at 2 AM daily if not already scheduled.
   */
  @TestVisible
  private void scheduleNightlyAnalyzer() {
    List<CronTrigger> existing = [
      SELECT Id
      FROM CronTrigger
      WHERE CronJobDetail.Name LIKE '%Fulcrum%Analyzer%' AND State = 'WAITING'
      LIMIT 1
    ];
    if (existing.isEmpty()) {
      System.schedule(
        'Fulcrum Nightly Analyzer',
        '0 0 2 * * ?',
        new FulcrumBatchAnalyzer()
      );
    }
  }

  /**
   * Sends a welcome email to the installing admin with setup instructions.
   */
  @TestVisible
  private void sendWelcomeEmail(Id userId) {
    User admin = [
      SELECT Email, FirstName
      FROM User
      WHERE Id = :userId
      LIMIT 1
    ];
    if (admin.Email == null) {
      return;
    }

    Messaging.SingleEmailMessage mail = new Messaging.SingleEmailMessage();
    mail.setToAddresses(new List<String>{ admin.Email });
    mail.setSubject('MarginArc Installed Successfully');
    mail.setPlainTextBody(
      'Hi ' +
        (admin.FirstName != null ? admin.FirstName : 'Admin') +
        ',\n\n' +
        'MarginArc has been installed successfully in your Salesforce org.\n\n' +
        'Next steps:\n' +
        '1. Navigate to the "MarginArc Setup" tab to activate your license\n' +
        '2. Assign the Fulcrum_Admin permission set to yourself\n' +
        '3. Assign Fulcrum_User or Fulcrum_Manager to your team\n' +
        '4. Complete the setup wizard in "Getting Started"\n\n' +
        'The nightly analyzer has been scheduled to run at 2 AM daily.\n\n' +
        'Best,\nMarginArc'
    );
    mail.setSaveAsActivity(false);
    try {
      Messaging.sendEmail(new List<Messaging.SingleEmailMessage>{ mail });
    } catch (Exception e) {
      System.debug(
        LoggingLevel.WARN,
        'Could not send welcome email: ' + e.getMessage()
      );
    }
  }
}
