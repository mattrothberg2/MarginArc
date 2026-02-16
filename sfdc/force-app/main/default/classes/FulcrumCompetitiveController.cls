/**
 * Apex controller for the MarginArc Competitive Intelligence LWC
 * Queries actual Salesforce opportunity data for competitive insights
 */
public with sharing class FulcrumCompetitiveController {
  /**
   * Get competitive intelligence for a specific account
   * Queries actual closed opportunity data from Salesforce
   */
  @AuraEnabled(cacheable=true)
  public static Map<String, Object> getAccountIntelligence(
    Id accountId,
    String accountIndustry
  ) {
    Map<String, Object> result = new Map<String, Object>();

    try {
      if (accountId == null) {
        result.put('hasHistory', false);
        result.put('message', 'No account specified');
        return result;
      }

      // Query the Account name for display purposes
      Account acc = [
        SELECT Name
        FROM Account
        WHERE Id = :accountId
        WITH SECURITY_ENFORCED
        LIMIT 1
      ];
      String accountName = acc.Name;

      // Build dynamic query to handle missing or inaccessible fields
      List<Opportunity> closedOpps;
      try {
        // Check if custom fields exist and are accessible
        Map<String, Schema.SObjectField> oppFields = Schema.SObjectType.Opportunity.fields.getMap();
        List<String> queryFields = new List<String>{
          'Id',
          'Name',
          'Amount',
          'StageName',
          'CloseDate',
          'Probability'
        };

        // Add custom fields if they exist and are accessible
        if (hasFieldAccess(oppFields, 'Fulcrum_OEM__c'))
          queryFields.add('Fulcrum_OEM__c');
        if (hasFieldAccess(oppFields, 'Fulcrum_Competitor_Names__c'))
          queryFields.add('Fulcrum_Competitor_Names__c');
        if (hasFieldAccess(oppFields, 'Fulcrum_Revenue__c'))
          queryFields.add('Fulcrum_Revenue__c');
        if (hasFieldAccess(oppFields, 'Fulcrum_GP_Percent__c'))
          queryFields.add('Fulcrum_GP_Percent__c');
        if (hasFieldAccess(oppFields, 'Fulcrum_Deal_Type__c'))
          queryFields.add('Fulcrum_Deal_Type__c');
        if (hasFieldAccess(oppFields, 'Fulcrum_Services_Attached__c'))
          queryFields.add('Fulcrum_Services_Attached__c');
        if (hasFieldAccess(oppFields, 'Fulcrum_Loss_Reason__c'))
          queryFields.add('Fulcrum_Loss_Reason__c');
        if (hasFieldAccess(oppFields, 'Fulcrum_Product_Category__c'))
          queryFields.add('Fulcrum_Product_Category__c');
        if (hasFieldAccess(oppFields, 'Fulcrum_Deal_Reg_Type__c'))
          queryFields.add('Fulcrum_Deal_Reg_Type__c');

        // Add Account.Industry if accessible
        Map<String, Schema.SObjectField> accountFields = Schema.SObjectType.Account.fields.getMap();
        if (hasFieldAccess(accountFields, 'Industry'))
          queryFields.add('Account.Industry');

        String query =
          'SELECT ' +
          String.join(queryFields, ', ') +
          ' FROM Opportunity' +
          ' WHERE AccountId = :accountId' +
          ' AND StageName IN (\'Closed Won\', \'Closed Lost\')' +
          ' WITH SECURITY_ENFORCED' +
          ' ORDER BY CloseDate DESC' +
          ' LIMIT 500';

        closedOpps = Database.query(query);
      } catch (Exception queryEx) {
        // Query failed - fallback to minimal standard fields only
        System.debug(
          'Query with custom fields failed, using standard fields only: ' +
          queryEx.getMessage()
        );
        closedOpps = [
          SELECT Id, Name, Amount, StageName, CloseDate, Probability
          FROM Opportunity
          WHERE
            AccountId = :accountId
            AND StageName IN ('Closed Won', 'Closed Lost')
          WITH SECURITY_ENFORCED
          ORDER BY CloseDate DESC
          LIMIT 500
        ];
      }

      if (!closedOpps.isEmpty()) {
        result.put('hasHistory', true);
        result.put('accountData', buildAccountData(accountName, closedOpps));
      } else {
        // No direct history - find similar accounts by industry
        result.put('hasHistory', false);
        result.put('similarAccounts', getSimilarAccountData(accountIndustry));
        result.put(
          'message',
          'No deal history with ' +
            accountName +
            '. Showing insights from similar ' +
            accountIndustry +
            ' accounts.'
        );
      }
    } catch (Exception e) {
      System.debug(
        'Error in getAccountIntelligence: ' +
          e.getMessage() +
          ' | ' +
          e.getStackTraceString()
      );
      result.put('error', e.getMessage());
    }

    return result;
  }

  /**
   * Check if a field exists and is accessible
   */
  private static Boolean hasFieldAccess(
    Map<String, Schema.SObjectField> fieldMap,
    String fieldName
  ) {
    Schema.SObjectField field = fieldMap.get(fieldName.toLowerCase());
    if (field == null)
      return false;
    Schema.DescribeFieldResult fieldDescribe = field.getDescribe();
    return fieldDescribe.isAccessible();
  }

  /**
   * Build account intelligence data from opportunities
   */
  private static Map<String, Object> buildAccountData(
    String accountName,
    List<Opportunity> opps
  ) {
    Map<String, Object> data = new Map<String, Object>();

    // Basic stats
    Integer totalDeals = opps.size();
    Integer wonDeals = 0;
    Decimal totalRevenue = 0;
    Decimal totalMargin = 0;
    Integer marginCount = 0;
    Date firstDeal = null;
    Date lastDeal = null;

    // Competitor matchup tracking
    Map<String, Map<String, Integer>> competitorStats = new Map<String, Map<String, Integer>>();
    Map<String, Decimal> competitorMargins = new Map<String, Decimal>();
    Map<String, Integer> competitorMarginCounts = new Map<String, Integer>();

    // Strategy tracking
    Integer servicesDeals = 0;
    Integer servicesWon = 0;
    Integer hardwareOnlyDeals = 0;
    Integer hardwareOnlyWon = 0;
    Integer dealRegDeals = 0;
    Integer dealRegWon = 0;

    // OEM tracking
    Map<String, Integer> oemWins = new Map<String, Integer>();
    Map<String, Integer> oemDeals = new Map<String, Integer>();

    // Recent deals for display
    List<Map<String, Object>> recentDeals = new List<Map<String, Object>>();
    Integer recentCount = 0;

    for (Opportunity opp : opps) {
      Boolean isWon = opp.StageName == 'Closed Won';

      if (isWon) {
        wonDeals++;
        totalRevenue += opp.Amount != null ? opp.Amount : 0;
        // Safe field access for GP Percent
        try {
          Decimal gpPercent = (Decimal) opp.get('Fulcrum_GP_Percent__c');
          if (gpPercent != null) {
            totalMargin += gpPercent;
            marginCount++;
          }
        } catch (Exception e) {
          // Field doesn't exist or not accessible
        }
      }

      // Track date range
      if (opp.CloseDate != null) {
        if (firstDeal == null || opp.CloseDate < firstDeal)
          firstDeal = opp.CloseDate;
        if (lastDeal == null || opp.CloseDate > lastDeal)
          lastDeal = opp.CloseDate;
      }

      // Track competitor matchups - safe field access
      try {
        String competitorNames = (String) opp.get(
          'Fulcrum_Competitor_Names__c'
        );
        if (String.isNotBlank(competitorNames)) {
          for (String comp : competitorNames.split(';')) {
            comp = comp.trim();
            if (String.isNotBlank(comp)) {
              if (!competitorStats.containsKey(comp)) {
                competitorStats.put(
                  comp,
                  new Map<String, Integer>{ 'wins' => 0, 'losses' => 0 }
                );
                competitorMargins.put(comp, 0);
                competitorMarginCounts.put(comp, 0);
              }
              if (isWon) {
                competitorStats.get(comp)
                  .put('wins', competitorStats.get(comp).get('wins') + 1);
                try {
                  Decimal gpPercent = (Decimal) opp.get(
                    'Fulcrum_GP_Percent__c'
                  );
                  if (gpPercent != null) {
                    competitorMargins.put(
                      comp,
                      competitorMargins.get(comp) + gpPercent
                    );
                    competitorMarginCounts.put(
                      comp,
                      competitorMarginCounts.get(comp) + 1
                    );
                  }
                } catch (Exception e) {
                  // Field doesn't exist or not accessible
                }
              } else {
                competitorStats.get(comp)
                  .put('losses', competitorStats.get(comp).get('losses') + 1);
              }
            }
          }
        }
      } catch (Exception e) {
        // Field doesn't exist or not accessible
      }

      // Track services impact - safe field access
      try {
        Boolean servicesAttached = (Boolean) opp.get(
          'Fulcrum_Services_Attached__c'
        );
        if (servicesAttached == true) {
          servicesDeals++;
          if (isWon)
            servicesWon++;
        } else {
          hardwareOnlyDeals++;
          if (isWon)
            hardwareOnlyWon++;
        }
      } catch (Exception e) {
        // Field doesn't exist - count as hardware only
        hardwareOnlyDeals++;
        if (isWon)
          hardwareOnlyWon++;
      }

      // Track deal registration impact - safe field access
      try {
        String dealRegType = (String) opp.get('Fulcrum_Deal_Reg_Type__c');
        if (dealRegType != null && dealRegType != 'NotRegistered') {
          dealRegDeals++;
          if (isWon)
            dealRegWon++;
        }
      } catch (Exception e) {
        // Field doesn't exist or not accessible
      }

      // Track OEM performance - safe field access
      try {
        String oemName = (String) opp.get('Fulcrum_OEM__c');
        if (String.isNotBlank(oemName)) {
          oemDeals.put(
            oemName,
            (oemDeals.get(oemName) == null ? 0 : oemDeals.get(oemName)) + 1
          );
          if (isWon) {
            oemWins.put(
              oemName,
              (oemWins.get(oemName) == null ? 0 : oemWins.get(oemName)) + 1
            );
          }
        }
      } catch (Exception e) {
        // Field doesn't exist or not accessible
      }

      // Build recent deals list (last 5) - safe field access
      if (recentCount < 5) {
        String oemDisplay = 'N/A';
        Decimal marginDisplay = null;
        Boolean servicesAttached = false;
        String lossReason = 'Unknown';

        try {
          oemDisplay = (String) opp.get('Fulcrum_OEM__c');
        } catch (Exception e) {
        }
        try {
          marginDisplay = (Decimal) opp.get('Fulcrum_GP_Percent__c');
        } catch (Exception e) {
        }
        try {
          servicesAttached =
            (Boolean) opp.get('Fulcrum_Services_Attached__c') == true;
        } catch (Exception e) {
        }
        try {
          lossReason = String.isNotBlank(
              (String) opp.get('Fulcrum_Loss_Reason__c')
            )
            ? (String) opp.get('Fulcrum_Loss_Reason__c')
            : 'Unknown';
        } catch (Exception e) {
        }

        recentDeals.add(
          new Map<String, Object>{
            'date' => opp.CloseDate,
            'oem' => oemDisplay,
            'size' => opp.Amount,
            'outcome' => isWon ? 'Won' : 'Lost',
            'margin' => marginDisplay,
            'insight' => isWon
              ? 'Won' + (servicesAttached ? ' with services' : '')
              : 'Lost: ' + lossReason
          }
        );
        recentCount++;
      }
    }

    // Calculate years as customer
    Integer yearsAsCustomer = 1;
    if (firstDeal != null) {
      yearsAsCustomer = Math.max(
        1,
        firstDeal.year() != null ? (Date.today().year() - firstDeal.year()) : 1
      );
    }

    // Determine relationship level
    String relationship;
    Decimal winRate = totalDeals > 0 ? (Decimal) wonDeals / totalDeals : 0;
    if (yearsAsCustomer >= 5 && winRate >= 0.55) {
      relationship = 'Strategic';
    } else if (yearsAsCustomer >= 3 || winRate >= 0.50) {
      relationship = 'Good';
    } else {
      relationship = 'New';
    }

    // Build competitor matchups list
    List<Map<String, Object>> matchups = new List<Map<String, Object>>();
    for (String comp : competitorStats.keySet()) {
      Map<String, Integer> stats = competitorStats.get(comp);
      Integer wins = stats.get('wins');
      Integer losses = stats.get('losses');
      Integer total = wins + losses;
      Decimal compWinRate = total > 0 ? (Decimal) wins / total : 0;

      Decimal avgMargin = null;
      if (competitorMarginCounts.get(comp) > 0) {
        avgMargin =
          competitorMargins.get(comp) / competitorMarginCounts.get(comp);
      }

      String threat = compWinRate >= 0.55
        ? 'Low'
        : (compWinRate >= 0.45 ? 'Medium' : 'High');
      String strategy = getCompetitorStrategy(comp);

      matchups.add(
        new Map<String, Object>{
          'competitor' => comp,
          'wins' => wins,
          'losses' => losses,
          'total' => total,
          'winRate' => compWinRate,
          'avgMarginWon' => avgMargin,
          'threat' => threat,
          'strategy' => strategy
        }
      );
    }

    // Sort by total encounters (descending) - manual bubble sort since Maps aren't Comparable
    for (Integer i = 0; i < matchups.size() - 1; i++) {
      for (Integer j = 0; j < matchups.size() - i - 1; j++) {
        Integer total1 = (Integer) matchups[j].get('total');
        Integer total2 = (Integer) matchups[j + 1].get('total');
        if (total1 < total2) {
          Map<String, Object> temp = matchups[j];
          matchups[j] = matchups[j + 1];
          matchups[j + 1] = temp;
        }
      }
    }

    // Find top OEM
    String topOem = null;
    Decimal topOemWinRate = 0;
    for (String oem : oemDeals.keySet()) {
      if (oemDeals.get(oem) >= 5) {
        Integer ow = oemWins.get(oem) != null ? oemWins.get(oem) : 0;
        Decimal wr = (Decimal) ow / oemDeals.get(oem);
        if (wr > topOemWinRate) {
          topOemWinRate = wr;
          topOem = oem;
        }
      }
    }

    // Build what works section
    Map<String, Object> whatWorks = new Map<String, Object>{
      'servicesWinRate' => servicesDeals > 0
        ? (Decimal) servicesWon / servicesDeals
        : 0,
      'servicesDeals' => servicesDeals,
      'hardwareOnlyWinRate' => hardwareOnlyDeals > 0
        ? (Decimal) hardwareOnlyWon / hardwareOnlyDeals
        : 0,
      'hardwareOnlyDeals' => hardwareOnlyDeals,
      'dealRegWinRate' => dealRegDeals > 0
        ? (Decimal) dealRegWon / dealRegDeals
        : 0,
      'topOem' => topOem,
      'topOemWinRate' => topOemWinRate
    };

    // Build quick brief
    String quickBrief = buildQuickBrief(
      accountName,
      relationship,
      yearsAsCustomer,
      wonDeals,
      totalDeals,
      totalRevenue,
      matchups,
      whatWorks
    );

    // Assemble final data
    data.put('accountName', accountName);
    data.put('relationship', relationship);
    data.put('yearsAsCustomer', yearsAsCustomer);
    data.put('totalDeals', totalDeals);
    data.put('wonDeals', wonDeals);
    data.put('winRate', winRate);
    data.put('totalRevenue', totalRevenue);
    data.put('avgMargin', marginCount > 0 ? totalMargin / marginCount : 0);
    data.put('quickBrief', quickBrief);
    data.put('competitorMatchups', matchups);
    data.put('whatWorks', whatWorks);
    data.put('recentDeals', recentDeals);

    return data;
  }

  /**
   * Get strategy recommendation for a competitor
   */
  private static String getCompetitorStrategy(String competitorName) {
    Map<String, String> strategies = new Map<String, String>{
      'CDW' => 'Beat on services, not price',
      'SHI' => 'Emphasize services and support SLAs',
      'Presidio' => 'Compete on multi-vendor expertise',
      'Optiv' => 'Broader security portfolio',
      'Insight' => 'Lead with infrastructure, not licensing',
      'ePlus' => 'Better technical depth and financing',
      'Trace3' => 'Larger scale and national presence',
      'Connection' => 'Enterprise capabilities',
      'Zones' => 'Technical expertise and services',
      'Converge' => 'Stability and long-term partnership'
    };
    return strategies.containsKey(competitorName)
      ? strategies.get(competitorName)
      : 'Focus on services differentiation';
  }

  /**
   * Build the quick brief summary
   */
  private static String buildQuickBrief(
    String accountName,
    String relationship,
    Integer years,
    Integer won,
    Integer total,
    Decimal revenue,
    List<Map<String, Object>> matchups,
    Map<String, Object> whatWorks
  ) {
    Decimal winRate = total > 0 ? (Decimal) won / total : 0;
    String revenueStr = revenue >= 1000000
      ? '$' + (revenue / 1000000).setScale(1) + 'M'
      : '$' + (revenue / 1000).setScale(0) + 'K';

    String brief =
      relationship +
      ' relationship over ' +
      years +
      ' years. ' +
      won +
      ' of ' +
      total +
      ' deals won (' +
      (winRate * 100).setScale(0) +
      '%), ' +
      revenueStr +
      ' total revenue.';

    // Add top competitor insight
    if (!matchups.isEmpty()) {
      Map<String, Object> topComp = matchups[0];
      String comp = (String) topComp.get('competitor');
      Integer w = (Integer) topComp.get('wins');
      Integer l = (Integer) topComp.get('losses');
      Decimal wr = (Decimal) topComp.get('winRate');
      brief +=
        ' Most frequent competitor: ' +
        comp +
        ' (' +
        w +
        '-' +
        l +
        ' record, ' +
        (wr * 100).setScale(0) +
        '% win rate).';

      if (wr >= 0.55) {
        brief += ' You typically beat ' + comp + ' here.';
      } else if (wr < 0.45) {
        brief += ' ' + comp + ' is tough competition here.';
      }
      brief += ' ' + (String) topComp.get('strategy') + '.';
    }

    // Add services insight
    Decimal servicesWR = (Decimal) whatWorks.get('servicesWinRate');
    Integer servicesDeals = (Integer) whatWorks.get('servicesDeals');
    if (servicesDeals > 5 && servicesWR > 0.55) {
      brief +=
        ' Services-attached deals win ' +
        (servicesWR * 100).setScale(0) +
        '% of the time. Lead with services.';
    }

    return brief;
  }

  /**
   * Get similar account patterns when no direct history exists
   */
  private static Map<String, Object> getSimilarAccountData(String industry) {
    try {
      // Check field accessibility before querying
      Map<String, Schema.SObjectField> oppFields = Schema.SObjectType.Opportunity.fields.getMap();
      Boolean hasMarginField = hasFieldAccess(
        oppFields,
        'Fulcrum_GP_Percent__c'
      );
      Boolean hasCompetitorField = hasFieldAccess(
        oppFields,
        'Fulcrum_Competitor_Names__c'
      );

      // Query aggregate data for accounts in this industry
      String marginQuery = hasMarginField
        ? 'SELECT COUNT(Id) totalDeals, SUM(Amount) totalAmount, AVG(Fulcrum_GP_Percent__c) avgMargin FROM Opportunity WHERE Account.Industry = :industry AND StageName = \'Closed Won\' WITH SECURITY_ENFORCED'
        : 'SELECT COUNT(Id) totalDeals, SUM(Amount) totalAmount FROM Opportunity WHERE Account.Industry = :industry AND StageName = \'Closed Won\' WITH SECURITY_ENFORCED';

      List<AggregateResult> results = Database.query(marginQuery);

      List<AggregateResult> lostResults = [
        SELECT COUNT(Id) lostDeals
        FROM Opportunity
        WHERE Account.Industry = :industry AND StageName = 'Closed Lost'
        WITH SECURITY_ENFORCED
      ];

      Integer wonDeals = results.isEmpty()
        ? 0
        : Integer.valueOf(results[0].get('totalDeals'));
      Integer lostDeals = lostResults.isEmpty()
        ? 0
        : Integer.valueOf(lostResults[0].get('lostDeals'));
      Integer totalDeals = wonDeals + lostDeals;
      Decimal avgMargin = 15.0; // Default margin
      if (
        hasMarginField &&
        !results.isEmpty() &&
        results[0].get('avgMargin') != null
      ) {
        avgMargin = (Decimal) results[0].get('avgMargin');
      }
      Decimal winRate = totalDeals > 0
        ? (Decimal) wonDeals / totalDeals * 100
        : 0;

      // Count accounts in industry
      Integer accountCount = [
        SELECT COUNT()
        FROM Account
        WHERE Industry = :industry
        WITH SECURITY_ENFORCED
      ];

      // Get top competitors in this industry
      // Note: Fulcrum_Competitor_Names__c is a multi-select picklist and cannot be used in GROUP BY
      List<String> topCompetitors = new List<String>();
      if (hasCompetitorField) {
        try {
          Map<String, Integer> competitorCounts = new Map<String, Integer>();
          for (Opportunity opp : [
            SELECT Fulcrum_Competitor_Names__c
            FROM Opportunity
            WHERE
              Account.Industry = :industry
              AND Fulcrum_Competitor_Names__c != NULL
            WITH SECURITY_ENFORCED
            ORDER BY CloseDate DESC
            LIMIT 200
          ]) {
            String compStr = (String) opp.get('Fulcrum_Competitor_Names__c');
            if (String.isNotBlank(compStr)) {
              for (String c : compStr.split(';')) {
                c = c.trim();
                if (String.isNotBlank(c)) {
                  Integer cnt = competitorCounts.get(c);
                  competitorCounts.put(c, cnt == null ? 1 : cnt + 1);
                }
              }
            }
          }
          // Sort by count descending and take top 4
          List<String> allComps = new List<String>(competitorCounts.keySet());
          // Simple selection of top competitors by count
          while (topCompetitors.size() < 4 && !allComps.isEmpty()) {
            String bestComp = null;
            Integer bestCount = 0;
            for (String c : allComps) {
              if (competitorCounts.get(c) > bestCount) {
                bestCount = competitorCounts.get(c);
                bestComp = c;
              }
            }
            if (bestComp != null) {
              topCompetitors.add(bestComp);
              allComps.remove(allComps.indexOf(bestComp));
            } else {
              break;
            }
          }
        } catch (Exception compEx) {
          System.debug('Error querying competitors: ' + compEx.getMessage());
        }
      }

      // Build insights
      List<String> insights = new List<String>();
      insights.add(
        'Win rate in ' + industry + ': ' + winRate.setScale(0) + '%'
      );
      insights.add(
        'Average margin on won deals: ' + avgMargin.setScale(1) + '%'
      );
      insights.add('Services-attached deals typically win more often');
      insights.add('Deal registration is critical for margin protection');

      // Build strategy
      String strategy = 'Lead with services differentiation and technical expertise. ';
      if (!topCompetitors.isEmpty()) {
        strategy +=
          'Watch out for ' +
          topCompetitors[0] +
          ' - they are active in this space.';
      }

      return new Map<String, Object>{
        'industry' => industry,
        'accountsAnalyzed' => accountCount,
        'totalDeals' => totalDeals,
        'avgWinRate' => winRate.setScale(0),
        'avgMargin' => avgMargin.setScale(1),
        'topCompetitors' => topCompetitors,
        'keyInsights' => insights,
        'recommendedStrategy' => strategy
      };
    } catch (Exception e) {
      System.debug('Error in getSimilarAccountData: ' + e.getMessage());
      // Return minimal fallback data
      return new Map<String, Object>{
        'industry' => industry,
        'accountsAnalyzed' => 0,
        'totalDeals' => 0,
        'avgWinRate' => 0,
        'avgMargin' => 15.0,
        'topCompetitors' => new List<String>(),
        'keyInsights' => new List<String>{
          'No historical data available for this industry.'
        },
        'recommendedStrategy' => 'Focus on building relationships and understanding customer needs.'
      };
    }
  }

  /**
   * Get competitor profile
   */
  @AuraEnabled(cacheable=true)
  public static Map<String, Object> getCompetitorProfile(
    String competitorName
  ) {
    // Try to get from custom object first
    try {
      List<Fulcrum_Competitor__c> competitors = [
        SELECT
          Name,
          Primary_Strength__c,
          Price_Aggression__c,
          Services_Capability__c,
          Primary_OEMs__c,
          How_To_Win__c,
          Typical_Discount__c,
          Description__c,
          Margin_Aggression__c
        FROM Fulcrum_Competitor__c
        WHERE Name = :competitorName
        WITH SECURITY_ENFORCED
        LIMIT 1
      ];

      if (!competitors.isEmpty()) {
        Fulcrum_Competitor__c comp = competitors[0];
        return new Map<String, Object>{
          'name' => comp.Name,
          'strength' => comp.Primary_Strength__c,
          'priceAggression' => comp.Price_Aggression__c != null
            ? Integer.valueOf(comp.Price_Aggression__c)
            : 3,
          'servicesCapability' => comp.Services_Capability__c != null
            ? Integer.valueOf(comp.Services_Capability__c)
            : 3,
          'primaryOems' => comp.Primary_OEMs__c,
          'howToWin' => comp.How_To_Win__c,
          'typicalDiscount' => comp.Typical_Discount__c != null
            ? String.valueOf((comp.Typical_Discount__c * 100).setScale(0)) + '%'
            : 'N/A',
          'description' => comp.Description__c,
          'marginAggression' => comp.Margin_Aggression__c
        };
      }
    } catch (System.QueryException e) {
      // FLS check failed — fall through to hardcoded profiles
      System.debug(
        'Competitor query FLS error, using fallback: ' + e.getMessage()
      );
    }

    // Fallback to hardcoded data
    Map<String, Map<String, Object>> defaultProfiles = new Map<String, Map<String, Object>>{
      'CDW' => new Map<String, Object>{
        'name' => 'CDW',
        'strength' => 'Volume + Execution',
        'priceAggression' => 3,
        'servicesCapability' => 2,
        'primaryOems' => 'Microsoft, Dell, Cisco',
        'howToWin' => 'Beat on services, not price. CDW is volume-focused - emphasize technical depth.',
        'typicalDiscount' => '3%'
      },
      'SHI' => new Map<String, Object>{
        'name' => 'SHI International',
        'strength' => 'Price',
        'priceAggression' => 5,
        'servicesCapability' => 1,
        'primaryOems' => 'Microsoft, Dell, HPE',
        'howToWin' => 'Don\'t compete on price - emphasize services, support SLAs, and technical expertise.',
        'typicalDiscount' => '5%'
      },
      'Presidio' => new Map<String, Object>{
        'name' => 'Presidio',
        'strength' => 'Cisco Expertise',
        'priceAggression' => 2,
        'servicesCapability' => 4,
        'primaryOems' => 'Cisco',
        'howToWin' => 'Compete on multi-vendor expertise. Position our broader portfolio.',
        'typicalDiscount' => '1%'
      },
      'Optiv' => new Map<String, Object>{
        'name' => 'Optiv',
        'strength' => 'Security Specialist',
        'priceAggression' => 2,
        'servicesCapability' => 5,
        'primaryOems' => 'Palo Alto, CrowdStrike, Fortinet',
        'howToWin' => 'Position broader portfolio. We offer security + infrastructure integration.',
        'typicalDiscount' => '1%'
      },
      'Insight' => new Map<String, Object>{
        'name' => 'Insight Enterprises',
        'strength' => 'Microsoft/Licensing',
        'priceAggression' => 3,
        'servicesCapability' => 3,
        'primaryOems' => 'Microsoft, Dell',
        'howToWin' => 'Lead with infrastructure, not just licensing. Emphasize integration capabilities.',
        'typicalDiscount' => '2%'
      }
    };

    return defaultProfiles.containsKey(competitorName)
      ? defaultProfiles.get(competitorName)
      : new Map<String, Object>{
          'name' => competitorName,
          'strength' => 'Unknown',
          'priceAggression' => 3,
          'servicesCapability' => 3,
          'primaryOems' => 'Various',
          'howToWin' => 'Focus on services differentiation and technical expertise.',
          'typicalDiscount' => 'N/A'
        };
  }
}
