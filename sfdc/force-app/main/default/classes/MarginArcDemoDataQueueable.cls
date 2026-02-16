/**
 * Queueable class for processing large MarginArc demo data loads in batches.
 * Used by MarginArcDemoDataService for "full" size datasets that may contain
 * thousands of records from the Lambda payload.
 *
 * Processes 200 records per execution and chains to the next batch until
 * all records are inserted.
 */
public with sharing class MarginArcDemoDataQueueable implements Queueable {
  private static final Integer BATCH_SIZE = 200;

  private String dealsJson;
  private Integer offset;

  /**
   * @param dealsJson Serialized JSON array of deal objects from the Lambda payload
   * @param offset    Starting index for this batch (0-based)
   */
  public MarginArcDemoDataQueueable(String dealsJson, Integer offset) {
    this.dealsJson = dealsJson;
    this.offset = offset;
  }

  public void execute(QueueableContext context) {
    List<Object> allDeals = (List<Object>) JSON.deserializeUntyped(dealsJson);

    if (allDeals == null || allDeals.isEmpty() || offset >= allDeals.size()) {
      return;
    }

    // Determine batch range
    Integer endIndex = Math.min(offset + BATCH_SIZE, allDeals.size());
    List<Object> batch = new List<Object>();
    for (Integer i = offset; i < endIndex; i++) {
      batch.add(allDeals[i]);
    }

    // Collect unique account names and create accounts that don't exist yet
    Set<String> accountNames = new Set<String>();
    for (Object dealObj : batch) {
      Map<String, Object> deal = (Map<String, Object>) dealObj;
      String acctName = (String) deal.get('accountName');
      if (String.isNotBlank(acctName)) {
        accountNames.add(acctName);
      }
    }

    // Query existing accounts
    Map<String, Id> accountMap = new Map<String, Id>();
    for (Account a : [
      SELECT Id, Name
      FROM Account
      WHERE Name IN :accountNames
    ]) {
      accountMap.put(a.Name, a.Id);
    }

    // Create missing accounts
    List<Account> newAccounts = new List<Account>();
    for (String name : accountNames) {
      if (!accountMap.containsKey(name)) {
        String suffix = name.contains('(Demo)') ? '' : ' (Demo)';
        Account a = new Account(Name = name + suffix);
        newAccounts.add(a);
      }
    }
    if (!newAccounts.isEmpty()) {
      SObjectAccessDecision acctDecision = Security.stripInaccessible(
        AccessType.CREATABLE,
        newAccounts
      );
      insert acctDecision.getRecords();
      for (Account a : (List<Account>) acctDecision.getRecords()) {
        accountMap.put(a.Name, a.Id);
      }
    }

    // Build opportunities from deal data
    List<Opportunity> opps = new List<Opportunity>();
    for (Object dealObj : batch) {
      Map<String, Object> deal = (Map<String, Object>) dealObj;
      Opportunity opp = mapDealToOpportunity(deal, accountMap);
      if (opp != null) {
        opps.add(opp);
      }
    }

    if (!opps.isEmpty()) {
      SObjectAccessDecision oppDecision = Security.stripInaccessible(
        AccessType.CREATABLE,
        opps
      );
      insert oppDecision.getRecords();

      // Create BOM lines for each inserted Opportunity
      List<Opportunity> insertedOpps = (List<Opportunity>) oppDecision.getRecords();
      MarginArcDemoDataService.insertBomLines(insertedOpps);
    }

    // Chain to next batch if more records remain
    if (endIndex < allDeals.size()) {
      System.enqueueJob(new MarginArcDemoDataQueueable(dealsJson, endIndex));
    }
  }

  /**
   * Maps a deal JSON object to a Salesforce Opportunity record.
   */
  private Opportunity mapDealToOpportunity(
    Map<String, Object> deal,
    Map<String, Id> accountMap
  ) {
    String accountName = (String) deal.get('accountName');
    Id accountId = accountMap.get(accountName);
    if (accountId == null) {
      // Try with (Demo) suffix
      accountId = accountMap.get(accountName + ' (Demo)');
    }

    Opportunity opp = new Opportunity();
    opp.AccountId = accountId;
    opp.Name = deal.containsKey('name')
      ? (String) deal.get('name')
      : 'Demo Deal';
    opp.Amount = toDecimal(deal.get('amount'));
    opp.StageName = deal.containsKey('stageName')
      ? (String) deal.get('stageName')
      : 'Prospecting';
    opp.CloseDate = deal.containsKey('closeDate')
      ? Date.valueOf((String) deal.get('closeDate'))
      : Date.today().addDays(60);

    if (deal.containsKey('probability')) {
      opp.Probability = toDecimal(deal.get('probability'));
    }

    // MarginArc fields
    if (deal.containsKey('oem')) {
      opp.Fulcrum_OEM__c = (String) deal.get('oem');
    }
    if (deal.containsKey('customerSegment')) {
      opp.Fulcrum_Customer_Segment__c = (String) deal.get('customerSegment');
    }
    if (deal.containsKey('dealRegType')) {
      opp.Fulcrum_Deal_Reg_Type__c = (String) deal.get('dealRegType');
    }
    if (deal.containsKey('competitorNames')) {
      opp.Fulcrum_Competitor_Names__c = (String) deal.get('competitorNames');
    }
    if (deal.containsKey('solutionComplexity')) {
      opp.Fulcrum_Solution_Complexity__c = (String) deal.get(
        'solutionComplexity'
      );
    }
    if (deal.containsKey('relationshipStrength')) {
      opp.Fulcrum_Relationship_Strength__c = (String) deal.get(
        'relationshipStrength'
      );
    }
    if (deal.containsKey('servicesAttached')) {
      opp.Fulcrum_Services_Attached__c = (Boolean) deal.get('servicesAttached');
    }
    if (deal.containsKey('productCategory')) {
      opp.Fulcrum_Product_Category__c = (String) deal.get('productCategory');
    }
    if (deal.containsKey('plannedMargin')) {
      opp.Fulcrum_Planned_Margin__c = toDecimal(deal.get('plannedMargin'));
    }
    if (deal.containsKey('oemCost')) {
      opp.Fulcrum_OEM_Cost__c = toDecimal(deal.get('oemCost'));
    }
    if (deal.containsKey('recommendedMargin')) {
      opp.Fulcrum_Recommended_Margin__c = toDecimal(
        deal.get('recommendedMargin')
      );
    }
    if (deal.containsKey('aiConfidence')) {
      opp.Fulcrum_AI_Confidence__c = toDecimal(deal.get('aiConfidence'));
    }
    if (deal.containsKey('winProbability')) {
      opp.Fulcrum_Win_Probability__c = toDecimal(deal.get('winProbability'));
    }
    if (deal.containsKey('lossReason')) {
      opp.Fulcrum_Loss_Reason__c = (String) deal.get('lossReason');
    }

    return opp;
  }

  private static Decimal toDecimal(Object val) {
    if (val == null)
      return 0;
    if (val instanceof Decimal)
      return (Decimal) val;
    try {
      return Decimal.valueOf(String.valueOf(val));
    } catch (Exception e) {
      return 0;
    }
  }
}
