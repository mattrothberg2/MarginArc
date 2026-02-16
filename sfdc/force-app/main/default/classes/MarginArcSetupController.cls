/**
 * Apex controller for the MarginArc Setup Wizard (Sprint 19).
 * Provides first-run experience methods: setup status, field mapping suggestions,
 * backfill/analyzer triggers, job status polling, and maturity assessment.
 */
public with sharing class MarginArcSetupController {
  private static final List<String> KEY_FIELDS = new List<String>{
    'Fulcrum_OEM__c',
    'Fulcrum_OEM_Cost__c',
    'Fulcrum_Customer_Segment__c',
    'Fulcrum_Deal_Reg_Type__c',
    'Fulcrum_Competitor_Names__c'
  };

  private static final Map<String, String> FIELD_LABELS = new Map<String, String>{
    'Fulcrum_OEM__c' => 'OEM Vendor',
    'Fulcrum_OEM_Cost__c' => 'OEM Cost',
    'Fulcrum_Customer_Segment__c' => 'Customer Segment',
    'Fulcrum_Deal_Reg_Type__c' => 'Deal Registration',
    'Fulcrum_Competitor_Names__c' => 'Competitors'
  };

  /**
   * Comprehensive setup completeness check.
   * Returns all status flags, counts, field fill rates, and completed step count.
   */
  @AuraEnabled
  public static Map<String, Object> getSetupStatus() {
    Map<String, Object> status = new Map<String, Object>();

    Fulcrum_Config__c cfg = Fulcrum_Config__c.getOrgDefaults();

    Boolean apiConfigured =
      cfg != null &&
      String.isNotBlank(cfg.API_URL__c) &&
      String.isNotBlank(cfg.API_Key__c);
    status.put('apiConfigured', apiConfigured);

    Boolean geminiConfigured =
      cfg != null && String.isNotBlank(cfg.Gemini_API_Key__c);
    status.put('geminiConfigured', geminiConfigured);

    Boolean apiReachable = false;
    if (apiConfigured) {
      try {
        Http http = new Http();
        HttpRequest req = new HttpRequest();
        String baseUrl = cfg.API_URL__c.replace('/api/recommend', '');
        req.setEndpoint(baseUrl + '/health');
        req.setMethod('GET');
        req.setTimeout(10000);
        HttpResponse res = http.send(req);
        apiReachable = res.getStatusCode() == 200;
      } catch (Exception e) {
        apiReachable = false;
      }
    }
    status.put('apiReachable', apiReachable);

    Integer oemCount = [
      SELECT COUNT()
      FROM Fulcrum_OEM__c
      WITH SECURITY_ENFORCED
    ];
    status.put('oemCount', oemCount);

    Integer competitorCount = [
      SELECT COUNT()
      FROM Fulcrum_Competitor__c
      WITH SECURITY_ENFORCED
    ];
    status.put('competitorCount', competitorCount);

    Integer totalOpenDeals = [
      SELECT COUNT()
      FROM Opportunity
      WHERE IsClosed = FALSE
      WITH SECURITY_ENFORCED
    ];
    status.put('totalOpenDeals', totalOpenDeals);

    Integer analyzedDeals = 0;
    Map<String, Schema.SObjectField> fieldMap = Schema.SObjectType.Opportunity.fields.getMap();
    if (fieldMap.containsKey('fulcrum_recommended_margin__c')) {
      analyzedDeals = Database.countQuery(
        'SELECT COUNT() FROM Opportunity WHERE IsClosed = false AND Fulcrum_Recommended_Margin__c != null WITH SECURITY_ENFORCED'
      );
    }
    status.put('analyzedDeals', analyzedDeals);

    Integer backfillResultCount = [
      SELECT COUNT()
      FROM Fulcrum_Backfill_Result__c
      WITH SECURITY_ENFORCED
    ];
    status.put('backfillResultCount', backfillResultCount);
    status.put('hasRunBackfill', backfillResultCount > 0);

    List<Map<String, Object>> fieldHealth = new List<Map<String, Object>>();
    Decimal fillRateSum = 0;

    if (totalOpenDeals > 0) {
      for (String fieldName : KEY_FIELDS) {
        if (fieldMap.containsKey(fieldName.toLowerCase())) {
          String countQuery =
            'SELECT COUNT() FROM Opportunity WHERE IsClosed = false AND ' +
            fieldName +
            ' != null WITH SECURITY_ENFORCED';
          Integer filled = Database.countQuery(countQuery);
          Decimal rate =
            (Decimal.valueOf(filled) / Decimal.valueOf(totalOpenDeals)) * 100;
          rate = rate.setScale(1);

          fieldHealth.add(
            new Map<String, Object>{
              'fieldName' => fieldName,
              'label' => FIELD_LABELS.get(fieldName),
              'filled' => filled,
              'total' => totalOpenDeals,
              'rate' => rate
            }
          );

          fillRateSum += rate;
        }
      }
    } else {
      for (String fieldName : KEY_FIELDS) {
        fieldHealth.add(
          new Map<String, Object>{
            'fieldName' => fieldName,
            'label' => FIELD_LABELS.get(fieldName),
            'filled' => 0,
            'total' => 0,
            'rate' => (Decimal) 0.0
          }
        );
      }
    }
    status.put('fields', fieldHealth);

    Decimal avgFillRate = !fieldHealth.isEmpty()
      ? fillRateSum / fieldHealth.size()
      : 0;
    status.put('avgFillRate', avgFillRate.setScale(1));

    Integer completedSteps = 0;
    if (apiConfigured && apiReachable)
      completedSteps++;
    if (oemCount > 0)
      completedSteps++;
    if (competitorCount > 0)
      completedSteps++;
    if (avgFillRate > 50)
      completedSteps++;
    if (backfillResultCount > 0)
      completedSteps++;
    status.put('completedSteps', completedSteps);
    status.put('totalSteps', 5);

    return status;
  }

  /**
   * Analyzes Opportunity fields to suggest how to auto-populate MarginArc fields.
   * Checks standard fields for population and suggests mappings.
   */
  @AuraEnabled
  public static List<Map<String, Object>> getFieldMappingSuggestions() {
    List<Map<String, Object>> suggestions = new List<Map<String, Object>>();

    Integer totalOpen = [
      SELECT COUNT()
      FROM Opportunity
      WHERE IsClosed = FALSE
      WITH SECURITY_ENFORCED
    ];
    if (totalOpen == 0) {
      totalOpen = 1;
    }

    Map<String, Schema.SObjectField> fieldMap = Schema.SObjectType.Opportunity.fields.getMap();

    Integer amountFilled = [
      SELECT COUNT()
      FROM Opportunity
      WHERE IsClosed = FALSE AND Amount != NULL
      WITH SECURITY_ENFORCED
    ];
    Decimal amountRate =
      (Decimal.valueOf(amountFilled) / Decimal.valueOf(totalOpen)) * 100;
    suggestions.add(
      new Map<String, Object>{
        'targetField' => 'Fulcrum_OEM_Cost__c',
        'suggestion' => amountRate >= 50
          ? 'Amount is well populated (' +
            amountRate.setScale(0) +
            '%). OEM Cost can be estimated as ~85% of Amount when not manually entered.'
          : 'Amount is only ' +
            amountRate.setScale(0) +
            '% populated. Encourage reps to enter deal amounts for accurate cost estimation.',
        'autoDerivable' => amountRate >= 50,
        'currentFillRate' => amountRate.setScale(1),
        'icon' => 'standard:currency'
      }
    );

    Integer industryFilled = Database.countQuery(
      'SELECT COUNT() FROM Opportunity WHERE IsClosed = false AND Account.Industry != null WITH SECURITY_ENFORCED'
    );
    Decimal industryRate =
      (Decimal.valueOf(industryFilled) / Decimal.valueOf(totalOpen)) * 100;
    suggestions.add(
      new Map<String, Object>{
        'targetField' => 'Customer Industry (API input)',
        'suggestion' => industryRate >= 50
          ? 'Account.Industry is ' +
            industryRate.setScale(0) +
            '% populated. MarginArc auto-maps this to its industry taxonomy.'
          : 'Account.Industry is only ' +
            industryRate.setScale(0) +
            '% populated. Fill Account industries for better recommendations.',
        'autoDerivable' => industryRate >= 50,
        'currentFillRate' => industryRate.setScale(1),
        'icon' => 'standard:account'
      }
    );

    Integer oemFieldFilled = 0;
    if (fieldMap.containsKey('fulcrum_oem__c')) {
      oemFieldFilled = Database.countQuery(
        'SELECT COUNT() FROM Opportunity WHERE IsClosed = false AND Fulcrum_OEM__c != null WITH SECURITY_ENFORCED'
      );
    }
    Decimal oemRate =
      (Decimal.valueOf(oemFieldFilled) / Decimal.valueOf(totalOpen)) * 100;
    suggestions.add(
      new Map<String, Object>{
        'targetField' => 'Fulcrum_OEM__c',
        'suggestion' => 'MarginArc can derive OEM from Opportunity Name (e.g., "Cisco Meraki Refresh" auto-detects Cisco). Currently ' +
        oemRate.setScale(0) +
        '% manually set.',
        'autoDerivable' => true,
        'currentFillRate' => oemRate.setScale(1),
        'icon' => 'standard:product'
      }
    );

    Integer segmentFilled = 0;
    if (fieldMap.containsKey('fulcrum_customer_segment__c')) {
      segmentFilled = Database.countQuery(
        'SELECT COUNT() FROM Opportunity WHERE IsClosed = false AND Fulcrum_Customer_Segment__c != null WITH SECURITY_ENFORCED'
      );
    }
    Decimal segmentRate =
      (Decimal.valueOf(segmentFilled) / Decimal.valueOf(totalOpen)) * 100;
    suggestions.add(
      new Map<String, Object>{
        'targetField' => 'Fulcrum_Customer_Segment__c',
        'suggestion' => 'When not set, MarginArc derives segment from Amount: >$300K=Enterprise, >$100K=MidMarket, else SMB. Currently ' +
        segmentRate.setScale(0) +
        '% manually set.',
        'autoDerivable' => true,
        'currentFillRate' => segmentRate.setScale(1),
        'icon' => 'standard:groups'
      }
    );

    Integer dealRegFilled = 0;
    if (fieldMap.containsKey('fulcrum_deal_reg_type__c')) {
      dealRegFilled = Database.countQuery(
        'SELECT COUNT() FROM Opportunity WHERE IsClosed = false AND Fulcrum_Deal_Reg_Type__c != null WITH SECURITY_ENFORCED'
      );
    }
    Decimal dealRegRate =
      (Decimal.valueOf(dealRegFilled) / Decimal.valueOf(totalOpen)) * 100;
    suggestions.add(
      new Map<String, Object>{
        'targetField' => 'Fulcrum_Deal_Reg_Type__c',
        'suggestion' => dealRegRate < 30
          ? 'Only ' +
            dealRegRate.setScale(0) +
            '% of deals have Deal Registration set. This significantly impacts margin recommendations. Consider adding to your Opportunity page layout.'
          : 'Deal Registration is ' +
            dealRegRate.setScale(0) +
            '% populated. Good coverage for accurate recommendations.',
        'autoDerivable' => false,
        'currentFillRate' => dealRegRate.setScale(1),
        'icon' => 'standard:record'
      }
    );

    Integer compFilled = 0;
    if (fieldMap.containsKey('fulcrum_competitor_names__c')) {
      compFilled = Database.countQuery(
        'SELECT COUNT() FROM Opportunity WHERE IsClosed = false AND Fulcrum_Competitor_Names__c != null WITH SECURITY_ENFORCED'
      );
    }
    Decimal compRate =
      (Decimal.valueOf(compFilled) / Decimal.valueOf(totalOpen)) * 100;
    suggestions.add(
      new Map<String, Object>{
        'targetField' => 'Fulcrum_Competitor_Names__c',
        'suggestion' => compRate < 30
          ? 'Competitor names are only ' +
            compRate.setScale(0) +
            '% populated. Competitive data is a top driver of recommendation accuracy.'
          : 'Competitor data at ' +
            compRate.setScale(0) +
            '% coverage. Consider enriching further for better competitive intelligence.',
        'autoDerivable' => false,
        'currentFillRate' => compRate.setScale(1),
        'icon' => 'standard:competitors'
      }
    );

    Boolean hasType = fieldMap.containsKey('type');
    if (hasType) {
      Integer typeFilled = Database.countQuery(
        'SELECT COUNT() FROM Opportunity WHERE IsClosed = false AND Type != null WITH SECURITY_ENFORCED'
      );
      Decimal typeRate =
        (Decimal.valueOf(typeFilled) / Decimal.valueOf(totalOpen)) * 100;
      suggestions.add(
        new Map<String, Object>{
          'targetField' => 'Fulcrum_Deal_Type__c',
          'suggestion' => typeRate >= 30
            ? 'Opportunity Type field is ' +
              typeRate.setScale(0) +
              '% populated. Values like "New Business" can auto-map to MarginArc Deal Type (New Logo vs Renewal).'
            : 'Opportunity Type is only ' +
              typeRate.setScale(0) +
              '% populated. Consider mapping it to MarginArc Deal Type for New Logo vs Renewal distinction.',
          'autoDerivable' => typeRate >= 30,
          'currentFillRate' => typeRate.setScale(1),
          'icon' => 'standard:opportunity'
        }
      );
    }

    return suggestions;
  }

  /**
   * Triggers MarginArcBackfillAnalyzer batch job with the specified lookback period.
   * Returns the AsyncApexJob ID for status polling.
   */
  @AuraEnabled
  public static Id runBackfill(Integer monthsBack) {
    Integer months = (monthsBack != null && monthsBack > 0) ? monthsBack : 24;
    Id jobId = Database.executeBatch(new MarginArcBackfillAnalyzer(months), 10);
    return jobId;
  }

  /**
   * Queries AsyncApexJob for the given job ID and returns status details.
   */
  @AuraEnabled
  public static Map<String, Object> getBackfillJobStatus(Id jobId) {
    Map<String, Object> result = new Map<String, Object>();

    if (jobId == null) {
      result.put('status', 'Unknown');
      result.put('jobItemsProcessed', 0);
      result.put('totalJobItems', 0);
      result.put('numberOfErrors', 0);
      result.put('percentComplete', 0);
      result.put('completedDate', null);
      return result;
    }

    List<AsyncApexJob> jobs = [
      SELECT
        Status,
        JobItemsProcessed,
        TotalJobItems,
        NumberOfErrors,
        CompletedDate
      FROM AsyncApexJob
      WHERE Id = :jobId
      WITH SECURITY_ENFORCED
      LIMIT 1
    ];

    if (jobs.isEmpty()) {
      result.put('status', 'Unknown');
      result.put('jobItemsProcessed', 0);
      result.put('totalJobItems', 0);
      result.put('numberOfErrors', 0);
      result.put('percentComplete', 0);
      result.put('completedDate', null);
      return result;
    }

    AsyncApexJob job = jobs[0];
    result.put('status', job.Status);
    result.put('jobItemsProcessed', job.JobItemsProcessed);
    result.put('totalJobItems', job.TotalJobItems);
    result.put('numberOfErrors', job.NumberOfErrors);

    Integer percentComplete = 0;
    if (job.TotalJobItems > 0) {
      percentComplete = (Integer) Math.round(
        (Decimal.valueOf(job.JobItemsProcessed) /
        Decimal.valueOf(job.TotalJobItems)) * 100
      );
    }
    if (job.Status == 'Completed') {
      percentComplete = 100;
    }
    result.put('percentComplete', percentComplete);
    result.put('completedDate', job.CompletedDate);

    return result;
  }

  /**
   * Triggers MarginArcBatchAnalyzer for an immediate one-time full refresh.
   * Returns the AsyncApexJob ID.
   */
  @AuraEnabled
  public static Id runNightlyAnalyzer() {
    Id jobId = Database.executeBatch(new MarginArcBatchAnalyzer(true), 10);
    return jobId;
  }

  /**
   * Calculates the Intelligence Maturity Level (1-5) based on configuration,
   * data quality, analysis coverage, and recommendation adoption.
   */
  @AuraEnabled
  public static Map<String, Object> getMaturityAssessment() {
    Map<String, Object> result = new Map<String, Object>();

    Fulcrum_Config__c cfg = Fulcrum_Config__c.getOrgDefaults();
    Boolean apiConfigured =
      cfg != null &&
      String.isNotBlank(cfg.API_URL__c) &&
      String.isNotBlank(cfg.API_Key__c);

    Integer oemCount = [
      SELECT COUNT()
      FROM Fulcrum_OEM__c
      WITH SECURITY_ENFORCED
    ];
    Integer competitorCount = [
      SELECT COUNT()
      FROM Fulcrum_Competitor__c
      WITH SECURITY_ENFORCED
    ];

    Integer totalOpenDeals = [
      SELECT COUNT()
      FROM Opportunity
      WHERE IsClosed = FALSE
      WITH SECURITY_ENFORCED
    ];
    Integer analyzedDeals = 0;
    Map<String, Schema.SObjectField> fieldMap = Schema.SObjectType.Opportunity.fields.getMap();
    if (fieldMap.containsKey('fulcrum_recommended_margin__c')) {
      analyzedDeals = Database.countQuery(
        'SELECT COUNT() FROM Opportunity WHERE IsClosed = false AND Fulcrum_Recommended_Margin__c != null WITH SECURITY_ENFORCED'
      );
    }

    Decimal avgFillRate = 0;
    if (totalOpenDeals > 0) {
      Decimal fillSum = 0;
      Integer fieldCount = 0;
      for (String fieldName : KEY_FIELDS) {
        if (fieldMap.containsKey(fieldName.toLowerCase())) {
          Integer filled = Database.countQuery(
            'SELECT COUNT() FROM Opportunity WHERE IsClosed = false AND ' +
              fieldName +
              ' != null WITH SECURITY_ENFORCED'
          );
          fillSum +=
            (Decimal.valueOf(filled) / Decimal.valueOf(totalOpenDeals)) * 100;
          fieldCount++;
        }
      }
      if (fieldCount > 0) {
        avgFillRate = fillSum / fieldCount;
      }
    }

    Integer backfillCount = [
      SELECT COUNT()
      FROM Fulcrum_Backfill_Result__c
      WITH SECURITY_ENFORCED
    ];

    Decimal analyzedPct = totalOpenDeals > 0
      ? (Decimal.valueOf(analyzedDeals) / Decimal.valueOf(totalOpenDeals)) * 100
      : 0;

    Integer appliedCount = 0;
    try {
      appliedCount = [
        SELECT COUNT()
        FROM Fulcrum_Recommendation_History__c
        WHERE Applied__c = TRUE
        WITH SECURITY_ENFORCED
      ];
    } catch (Exception e) {
      appliedCount = 0;
    }

    Boolean hasScheduledAnalyzer = false;
    List<CronTrigger> crons = [
      SELECT Id
      FROM CronTrigger
      WHERE CronJobDetail.Name LIKE '%MarginArc%Analyzer%' AND State = 'WAITING'
      WITH SECURITY_ENFORCED
      LIMIT 1
    ];
    if (!crons.isEmpty()) {
      hasScheduledAnalyzer = true;
    }

    Integer level;
    String levelName;
    String levelDescription;
    String nextLevelName;
    List<String> nextLevelActions = new List<String>();

    if (!apiConfigured || oemCount == 0) {
      level = 1;
      levelName = 'Getting Started';
      levelDescription = 'MarginArc needs basic configuration before it can provide margin intelligence.';
      nextLevelName = 'Foundation';
      if (!apiConfigured) {
        nextLevelActions.add(
          'Configure the MarginArc API connection (URL and API Key)'
        );
      }
      if (oemCount == 0) {
        nextLevelActions.add('Add at least one OEM vendor record');
      }
      if (competitorCount == 0) {
        nextLevelActions.add('Add competitor profiles');
      }
    } else if (competitorCount == 0) {
      level = 1;
      levelName = 'Getting Started';
      levelDescription = 'API is connected and OEMs are configured. Add competitor data to reach Foundation level.';
      nextLevelName = 'Foundation';
      nextLevelActions.add('Add at least one competitor profile');
    } else if (avgFillRate <= 50 || !hasScheduledAnalyzer) {
      level = 2;
      levelName = 'Foundation';
      levelDescription = 'Core configuration is complete. Improve data quality and enable automated analysis to advance.';
      nextLevelName = 'Active';
      if (avgFillRate <= 50) {
        nextLevelActions.add(
          'Improve field fill rates above 50% (currently ' +
            avgFillRate.setScale(1) +
            '%)'
        );
      }
      if (!hasScheduledAnalyzer) {
        nextLevelActions.add(
          'Schedule the nightly analyzer job (runs at 2 AM daily)'
        );
      }
    } else if (avgFillRate <= 80 || backfillCount == 0 || analyzedPct <= 60) {
      level = 3;
      levelName = 'Active';
      levelDescription = 'MarginArc is actively providing recommendations. Deepen coverage and run the historical backfill to unlock Optimizing level.';
      nextLevelName = 'Optimizing';
      if (avgFillRate <= 80) {
        nextLevelActions.add(
          'Improve field fill rates above 80% (currently ' +
            avgFillRate.setScale(1) +
            '%)'
        );
      }
      if (backfillCount == 0) {
        nextLevelActions.add(
          'Run the historical backfill analyzer to score past deals'
        );
      }
      if (analyzedPct <= 60) {
        nextLevelActions.add(
          'Increase deal analysis coverage above 60% (currently ' +
            analyzedPct.setScale(1) +
            '%)'
        );
      }
    } else if (appliedCount <= 10) {
      level = 4;
      levelName = 'Optimizing';
      levelDescription = 'Excellent data quality and analysis coverage. Encourage reps to apply recommendations to reach Mastery.';
      nextLevelName = 'Mastery';
      nextLevelActions.add(
        'Apply MarginArc recommendations on at least 10 deals (currently ' +
          appliedCount +
          ' applied)'
      );
      nextLevelActions.add(
        'Train reps to review and act on margin recommendations regularly'
      );
    } else {
      level = 5;
      levelName = 'Mastery';
      levelDescription = 'Full MarginArc adoption with consistent recommendation usage. Continue monitoring and optimizing.';
      nextLevelName = null;
    }

    result.put('level', level);
    result.put('levelName', levelName);
    result.put('levelDescription', levelDescription);
    result.put('nextLevelName', nextLevelName);
    result.put('nextLevelActions', nextLevelActions);

    Map<String, Object> metrics = new Map<String, Object>();
    metrics.put('fieldFillAvg', avgFillRate.setScale(1));
    metrics.put('analyzedPct', analyzedPct.setScale(1));
    metrics.put('backfillCount', backfillCount);
    metrics.put('appliedCount', appliedCount);
    metrics.put('oemCount', oemCount);
    metrics.put('competitorCount', competitorCount);
    metrics.put('totalOpenDeals', totalOpenDeals);
    metrics.put('analyzedDeals', analyzedDeals);
    metrics.put('hasScheduledAnalyzer', hasScheduledAnalyzer);
    result.put('metrics', metrics);

    return result;
  }
}
