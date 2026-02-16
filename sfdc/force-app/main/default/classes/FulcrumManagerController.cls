/**
 * Apex controller for the MarginArc Manager Dashboard LWC.
 * Provides team-wide pipeline analytics, rep performance, and competitive data.
 * All queries use WITH SECURITY_ENFORCED for FLS enforcement.
 */
public with sharing class FulcrumManagerController {
  private static final List<String> FULCRUM_FIELDS = new List<String>{
    'Fulcrum_OEM__c',
    'Fulcrum_OEM_Cost__c',
    'Fulcrum_Planned_Margin__c',
    'Fulcrum_Recommended_Margin__c',
    'Fulcrum_AI_Confidence__c',
    'Fulcrum_Win_Probability__c',
    'Fulcrum_Customer_Segment__c',
    'Fulcrum_Deal_Reg_Type__c',
    'Fulcrum_Competitors__c',
    'Fulcrum_Competitor_Names__c',
    'Fulcrum_Solution_Complexity__c',
    'Fulcrum_Relationship_Strength__c',
    'Fulcrum_Value_Add__c',
    'Fulcrum_Services_Attached__c',
    'Fulcrum_Deal_Type__c',
    'Fulcrum_Quarter_End__c',
    'Fulcrum_Product_Category__c',
    'Fulcrum_Revenue__c',
    'Fulcrum_Cost__c',
    'Fulcrum_GP_Percent__c',
    'Fulcrum_Loss_Reason__c',
    'Fulcrum_Margin__c'
  };

  private static final List<String> STANDARD_FIELDS = new List<String>{
    'Id',
    'Name',
    'Amount',
    'StageName',
    'CloseDate',
    'Probability',
    'OwnerId',
    'Owner.Name',
    'Account.Name',
    'Account.Industry'
  };

  /**
   * Return only MarginArc fields that exist and are accessible to the running user.
   */
  private static List<String> getAccessibleFields() {
    Map<String, Schema.SObjectField> fieldMap = Schema.SObjectType.Opportunity.fields.getMap();
    List<String> accessible = new List<String>();
    for (String fieldName : FULCRUM_FIELDS) {
      Schema.SObjectField field = fieldMap.get(fieldName.toLowerCase());
      if (field != null) {
        Schema.DescribeFieldResult dfr = field.getDescribe();
        if (dfr.isAccessible()) {
          accessible.add(fieldName);
        }
      }
    }
    return accessible;
  }

  /**
   * Check if the running user has the Fulcrum_Admin permission set.
   */
  private static Boolean isAdmin() {
    Id userId = UserInfo.getUserId();
    Integer count = [
      SELECT COUNT()
      FROM PermissionSetAssignment
      WHERE AssigneeId = :userId AND PermissionSet.Name = 'Fulcrum_Admin'
    ];
    return count > 0;
  }

  /**
   * Check if the running user has Manager or Admin permission set.
   */
  private static Boolean isManagerOrAdmin() {
    Id userId = UserInfo.getUserId();
    Integer count = [
      SELECT COUNT()
      FROM PermissionSetAssignment
      WHERE
        AssigneeId = :userId
        AND PermissionSet.Name IN ('Fulcrum_Manager', 'Fulcrum_Admin')
    ];
    return count > 0;
  }

  /**
   * Get IDs of the current user's direct reports.
   */
  private static Set<Id> getDirectReportIds() {
    Set<Id> reportIds = new Set<Id>();
    for (User u : [
      SELECT Id
      FROM User
      WHERE ManagerId = :UserInfo.getUserId() AND IsActive = TRUE
    ]) {
      reportIds.add(u.Id);
    }
    return reportIds;
  }

  /**
   * Build owner filter clause based on user's org hierarchy.
   * Admin: sees all (or filtered by teamFilter).
   * Manager/PermSet: sees direct reports + own (or filtered by teamFilter).
   * Rep: own deals only.
   */
  private static String buildOwnerFilter(String teamFilter) {
    Id userId = UserInfo.getUserId();

    // If teamFilter is specified, filter to that manager's direct reports
    if (String.isNotBlank(teamFilter)) {
      // Only admin or manager-permset users can use team filter
      if (isManagerOrAdmin()) {
        Set<Id> teamMemberIds = new Set<Id>();
        Id managerId = Id.valueOf(teamFilter);
        for (User u : [
          SELECT Id
          FROM User
          WHERE ManagerId = :managerId AND IsActive = TRUE
        ]) {
          teamMemberIds.add(u.Id);
        }
        teamMemberIds.add(managerId); // Include the manager's own deals
        if (teamMemberIds.isEmpty())
          return '';
        List<String> quotedIds = new List<String>();
        for (Id mid : teamMemberIds) {
          quotedIds.add('\'' + String.valueOf(mid) + '\'');
        }
        return ' AND OwnerId IN (' + String.join(quotedIds, ',') + ')';
      }
    }

    // Admin sees all
    if (isAdmin())
      return '';

    // Manager with perm set or direct reports: sees reports + own
    Set<Id> reportIds = getDirectReportIds();
    if (isManagerOrAdmin() || !reportIds.isEmpty()) {
      reportIds.add(userId); // Include own deals
      List<String> quotedIds = new List<String>();
      for (Id rid : reportIds) {
        quotedIds.add('\'' + String.valueOf(rid) + '\'');
      }
      return ' AND OwnerId IN (' + String.join(quotedIds, ',') + ')';
    }

    // Rep: own deals only
    return ' AND OwnerId = \'' + userId + '\'';
  }

  /**
   * Return user context for the dashboard: role, direct reports, available teams.
   */
  @AuraEnabled(cacheable=true)
  public static Map<String, Object> getUserContext() {
    Map<String, Object> ctx = new Map<String, Object>();
    Id userId = UserInfo.getUserId();

    Boolean userIsAdmin = isAdmin();
    Set<Id> reportIds = getDirectReportIds();
    Boolean userIsManager =
      userIsAdmin ||
      isManagerOrAdmin() ||
      !reportIds.isEmpty();

    ctx.put('userId', userId);
    ctx.put('userName', UserInfo.getName());
    ctx.put('isAdmin', userIsAdmin);
    ctx.put('isManager', userIsManager);

    // Direct reports list
    List<Map<String, Object>> reportsList = new List<Map<String, Object>>();
    if (!reportIds.isEmpty()) {
      for (User u : [
        SELECT Id, Name
        FROM User
        WHERE Id IN :reportIds
        ORDER BY Name
      ]) {
        reportsList.add(
          new Map<String, Object>{ 'id' => u.Id, 'name' => u.Name }
        );
      }
    }
    ctx.put('directReports', reportsList);

    // For admin: list all managers (users who have direct reports)
    List<Map<String, Object>> managers = new List<Map<String, Object>>();
    if (userIsAdmin) {
      Set<Id> managerIds = new Set<Id>();
      for (User u : [
        SELECT ManagerId
        FROM User
        WHERE ManagerId != NULL AND IsActive = TRUE
      ]) {
        managerIds.add(u.ManagerId);
      }
      if (!managerIds.isEmpty()) {
        for (User m : [
          SELECT Id, Name
          FROM User
          WHERE Id IN :managerIds AND IsActive = TRUE
          ORDER BY Name
        ]) {
          managers.add(
            new Map<String, Object>{ 'id' => m.Id, 'name' => m.Name }
          );
        }
      }
    }
    ctx.put('managers', managers);

    return ctx;
  }

  /**
   * Server-side deal score computation.
   * Mirrors the JS computeDealScore() in fulcrumMarginAdvisor.js exactly.
   */
  private static Integer computeDealScore(
    Decimal plannedMargin,
    Decimal recommendedMargin,
    Decimal winProbability,
    Decimal oemCost,
    String competitors,
    String dealRegType,
    String relationshipStrength,
    String valueAdd
  ) {
    Decimal pm = plannedMargin != null ? plannedMargin : 15;
    Decimal rm = recommendedMargin != null ? recommendedMargin : 15;
    Decimal wp = winProbability != null ? winProbability : 50;
    Decimal cost = oemCost != null ? oemCost : 10000;

    // 1. Margin Alignment (35%)
    Decimal gap = Math.abs(pm - rm);
    Decimal alignmentScore = Math.max(0, 100 - gap * 15);

    // 2. Win Probability (25%)
    Decimal winProbScore = wp;

    // 3. Risk-Adjusted Value (20%)
    Decimal plannedGP = cost * (pm / 100);
    Decimal recGP = cost * (rm / 100);
    Decimal plannedRA = plannedGP * (wp / 100);
    Decimal recRA = recGP * (wp / 100);
    Decimal valueScore = recRA > 0
      ? Math.min(100, (plannedRA / recRA) * 100)
      : 50;

    // 4. Deal Structure (10%)
    Decimal structureScore = 40;
    if (dealRegType != null && dealRegType != 'NotRegistered') {
      structureScore += 20;
    }
    if (dealRegType == 'PremiumHunting')
      structureScore += 15;
    if (relationshipStrength == 'Strategic') {
      structureScore += 15;
    } else if (relationshipStrength == 'Good') {
      structureScore += 8;
    }
    if (valueAdd == 'High') {
      structureScore += 10;
    } else if (valueAdd == 'Medium') {
      structureScore += 5;
    }
    structureScore = Math.min(100, structureScore);

    // 5. Competitive Position (10%)
    Map<String, Decimal> compMap = new Map<String, Decimal>{
      '0' => 100,
      '1' => 75,
      '2' => 45,
      '3+' => 25
    };
    Decimal compScore = compMap.containsKey(competitors)
      ? compMap.get(competitors)
      : 50;

    Decimal score =
      alignmentScore * 0.35 +
      winProbScore * 0.25 +
      valueScore * 0.20 +
      structureScore * 0.10 +
      compScore * 0.10;

    return (Integer) Math.max(0, Math.min(100, Math.round(score)));
  }

  /**
   * Assess how complete the deal data is for making a reliable prediction.
   * Returns 0-100 based on which MarginArc fields are populated on the Opportunity.
   * Higher score = more data = more reliable prediction.
   */
  private static Integer computePredictionQuality(
    Decimal oemCost,
    String customerSegment,
    String competitors,
    String dealRegType,
    String oem,
    String valueAdd,
    Decimal plannedMargin,
    String relationship,
    String productCategory,
    String industry,
    String solutionComplexity,
    String competitorNames,
    Decimal recommendedMargin
  ) {
    Integer score = 0;
    if (oemCost != null && oemCost > 0)
      score += 15;
    if (customerSegment != null)
      score += 10;
    if (competitors != null)
      score += 10;
    if (dealRegType != null)
      score += 10;
    if (String.isNotBlank(oem))
      score += 8;
    if (valueAdd != null)
      score += 8;
    if (plannedMargin != null)
      score += 8;
    if (relationship != null)
      score += 7;
    if (String.isNotBlank(productCategory))
      score += 6;
    if (String.isNotBlank(industry))
      score += 5;
    if (solutionComplexity != null)
      score += 5;
    if (String.isNotBlank(competitorNames))
      score += 4;
    if (recommendedMargin != null)
      score += 4;
    return Math.min(100, score);
  }

  /**
   * Query open pipeline Opportunities with all MarginArc fields.
   * Computes deal scores server-side and returns KPI aggregates + deal list.
   */
  @AuraEnabled(cacheable=true)
  public static Map<String, Object> getPipelineSummary(String teamFilter) {
    Map<String, Object> result = new Map<String, Object>();

    try {
      List<String> accessibleCustomFields = getAccessibleFields();
      List<String> queryFields = new List<String>(STANDARD_FIELDS);
      queryFields.addAll(accessibleCustomFields);

      String ownerFilter = buildOwnerFilter(teamFilter);

      String query =
        'SELECT ' +
        String.join(queryFields, ', ') +
        ' FROM Opportunity' +
        ' WHERE IsClosed = false' +
        ownerFilter +
        ' WITH SECURITY_ENFORCED' +
        ' ORDER BY Amount DESC NULLS LAST' +
        ' LIMIT 2000';

      List<Opportunity> openOpps = Database.query(query);

      List<Map<String, Object>> deals = new List<Map<String, Object>>();
      List<Map<String, Object>> alerts = new List<Map<String, Object>>();

      Decimal totalPipeline = 0;
      Decimal totalGapSum = 0;
      Integer gapCount = 0;
      Integer compliantDeals = 0;
      Integer totalWithMargins = 0;
      Decimal totalPlannedRAGP = 0;
      Decimal totalRecRAGP = 0;
      Integer scoredDeals = 0;
      Integer totalQualitySum = 0;

      for (Opportunity opp : openOpps) {
        Map<String, Object> deal = new Map<String, Object>();
        deal.put('id', opp.Id);
        deal.put('name', opp.Name);
        deal.put('accountName', opp.Account != null ? opp.Account.Name : 'N/A');
        deal.put('ownerName', opp.Owner != null ? opp.Owner.Name : 'N/A');
        deal.put('ownerId', opp.OwnerId);
        deal.put('amount', opp.Amount);
        deal.put('stageName', opp.StageName);
        deal.put('closeDate', opp.CloseDate);

        Decimal plannedMargin = safeDecimal(
          opp,
          'Fulcrum_Planned_Margin__c',
          accessibleCustomFields
        );
        Decimal recommendedMargin = safeDecimal(
          opp,
          'Fulcrum_Recommended_Margin__c',
          accessibleCustomFields
        );
        Decimal winProb = safeDecimal(
          opp,
          'Fulcrum_Win_Probability__c',
          accessibleCustomFields
        );
        Decimal oemCost = safeDecimal(
          opp,
          'Fulcrum_OEM_Cost__c',
          accessibleCustomFields
        );
        String competitors = safeString(
          opp,
          'Fulcrum_Competitors__c',
          accessibleCustomFields
        );
        String dealRegType = safeString(
          opp,
          'Fulcrum_Deal_Reg_Type__c',
          accessibleCustomFields
        );
        String relationship = safeString(
          opp,
          'Fulcrum_Relationship_Strength__c',
          accessibleCustomFields
        );
        String valueAddField = safeString(
          opp,
          'Fulcrum_Value_Add__c',
          accessibleCustomFields
        );
        String customerSegment = safeString(
          opp,
          'Fulcrum_Customer_Segment__c',
          accessibleCustomFields
        );
        String solutionComplexity = safeString(
          opp,
          'Fulcrum_Solution_Complexity__c',
          accessibleCustomFields
        );
        Boolean servicesAttached = safeBoolean(
          opp,
          'Fulcrum_Services_Attached__c',
          accessibleCustomFields
        );
        Boolean quarterEndFlag = safeBoolean(
          opp,
          'Fulcrum_Quarter_End__c',
          accessibleCustomFields
        );
        String dealType = safeString(
          opp,
          'Fulcrum_Deal_Type__c',
          accessibleCustomFields
        );
        Boolean isNewLogo = (dealType == 'New Logo' || dealType == 'New');

        deal.put('plannedMargin', plannedMargin);
        deal.put('recommendedMargin', recommendedMargin);
        deal.put('winProbability', winProb);
        deal.put(
          'oem',
          safeString(opp, 'Fulcrum_OEM__c', accessibleCustomFields)
        );

        Decimal gap = null;
        if (plannedMargin != null && recommendedMargin != null) {
          gap = plannedMargin - recommendedMargin;
          deal.put('marginGap', gap);
          totalGapSum += gap;
          gapCount++;
          totalWithMargins++;

          if (Math.abs(gap) <= 3) {
            compliantDeals++;
          }

          if (gap < -3) {
            alerts.add(
              new Map<String, Object>{
                'dealId' => opp.Id,
                'dealName' => opp.Name,
                'ownerName' => deal.get('ownerName'),
                'plannedMargin' => plannedMargin,
                'recommendedMargin' => recommendedMargin,
                'gap' => gap,
                'amount' => opp.Amount
              }
            );
          }
        }

        // Compute RAGP (Risk-Adjusted Gross Profit)
        Integer plannedWinProb = null;
        Integer recWinProb = null;
        Decimal plannedRAGP = null;
        Decimal recRAGP = null;

        if (plannedMargin != null && opp.Amount != null) {
          plannedWinProb = estimateWinProbability(
            plannedMargin,
            competitors,
            dealRegType,
            customerSegment,
            relationship,
            valueAddField,
            isNewLogo,
            solutionComplexity,
            servicesAttached,
            quarterEndFlag
          );
          plannedRAGP =
            opp.Amount *
            (plannedMargin / 100) *
            (plannedWinProb / 100.0);
        }
        if (recommendedMargin != null && opp.Amount != null) {
          recWinProb = estimateWinProbability(
            recommendedMargin,
            competitors,
            dealRegType,
            customerSegment,
            relationship,
            valueAddField,
            isNewLogo,
            solutionComplexity,
            servicesAttached,
            quarterEndFlag
          );
          recRAGP =
            opp.Amount *
            (recommendedMargin / 100) *
            (recWinProb / 100.0);
        }

        deal.put('plannedWinProb', plannedWinProb);
        deal.put('recWinProb', recWinProb);
        deal.put('plannedRAGP', plannedRAGP);
        deal.put('recRAGP', recRAGP);
        deal.put(
          'ragpDelta',
          (plannedRAGP != null &&
            recRAGP != null)
            ? recRAGP - plannedRAGP
            : null
        );

        if (recommendedMargin != null) {
          scoredDeals++;
        }
        if (plannedRAGP != null) {
          totalPlannedRAGP += plannedRAGP;
        }
        if (recRAGP != null) {
          totalRecRAGP += recRAGP;
        }

        Integer dealScore = computeDealScore(
          plannedMargin,
          recommendedMargin,
          winProb,
          oemCost,
          competitors,
          dealRegType,
          relationship,
          valueAddField
        );
        deal.put('dealScore', dealScore);

        if (dealScore >= 70) {
          deal.put('dealScoreLabel', 'Good');
        } else if (dealScore >= 40) {
          deal.put('dealScoreLabel', 'Fair');
        } else {
          deal.put('dealScoreLabel', 'Needs Work');
        }

        // Prediction Quality
        String productCat = safeString(
          opp,
          'Fulcrum_Product_Category__c',
          accessibleCustomFields
        );
        String compNames = safeString(
          opp,
          'Fulcrum_Competitor_Names__c',
          accessibleCustomFields
        );
        String acctIndustry = opp.Account != null ? opp.Account.Industry : null;

        Integer predictionQuality = computePredictionQuality(
          oemCost,
          customerSegment,
          competitors,
          dealRegType,
          safeString(opp, 'Fulcrum_OEM__c', accessibleCustomFields),
          valueAddField,
          plannedMargin,
          relationship,
          productCat,
          acctIndustry,
          solutionComplexity,
          compNames,
          recommendedMargin
        );
        deal.put('predictionQuality', predictionQuality);
        totalQualitySum += predictionQuality;

        if (opp.Amount != null) {
          totalPipeline += opp.Amount;
        }

        deals.add(deal);
      }

      Map<String, Object> kpis = new Map<String, Object>();
      kpis.put('totalPipeline', totalPipeline);
      kpis.put('dealCount', deals.size());
      kpis.put('avgMarginGap', gapCount > 0 ? (totalGapSum / gapCount) : 0);
      kpis.put(
        'complianceRate',
        totalWithMargins > 0
          ? ((Decimal) compliantDeals / totalWithMargins * 100)
          : 0
      );
      kpis.put('alertCount', alerts.size());
      kpis.put('totalPlannedRAGP', totalPlannedRAGP);
      kpis.put('totalRecRAGP', totalRecRAGP);
      kpis.put('ragpDelta', totalRecRAGP - totalPlannedRAGP);
      kpis.put(
        'adoptionRate',
        deals.size() > 0 ? ((Decimal) scoredDeals / deals.size() * 100) : 0
      );
      kpis.put(
        'avgPredictionQuality',
        deals.size() > 0
          ? Math.round((Decimal) totalQualitySum / deals.size())
          : 0
      );

      result.put('deals', deals);
      result.put('kpis', kpis);
      result.put('alerts', alerts);
    } catch (Exception e) {
      throw new AuraHandledException(
        'Unable to load pipeline data: ' + e.getMessage()
      );
    }

    return result;
  }

  /**
   * Query closed Opportunities by time range for rep performance,
   * competitive analysis, and margin opportunity calculations.
   */
  @AuraEnabled(cacheable=true)
  public static Map<String, Object> getHistoricalPerformance(
    String timeRange,
    String teamFilter
  ) {
    Map<String, Object> result = new Map<String, Object>();

    try {
      Date startDate = getStartDate(timeRange);

      List<String> accessibleCustomFields = getAccessibleFields();
      List<String> queryFields = new List<String>(STANDARD_FIELDS);
      queryFields.addAll(accessibleCustomFields);

      String dateFilter = startDate != null
        ? ' AND CloseDate >= :startDate'
        : '';

      String ownerFilter = buildOwnerFilter(teamFilter);

      String query =
        'SELECT ' +
        String.join(queryFields, ', ') +
        ' FROM Opportunity' +
        ' WHERE StageName IN (\'Closed Won\', \'Closed Lost\')' +
        dateFilter +
        ownerFilter +
        ' WITH SECURITY_ENFORCED' +
        ' ORDER BY CloseDate DESC' +
        ' LIMIT 10000';

      List<Opportunity> closedOpps = Database.query(query);

      Map<Id, Map<String, Object>> repMap = new Map<Id, Map<String, Object>>();
      Map<String, Map<String, Object>> competitorMap = new Map<String, Map<String, Object>>();

      Decimal totalActualGP = 0;
      Decimal totalPotentialGP = 0;
      Decimal totalActualMarginSum = 0;
      Decimal totalRecMarginSum = 0;
      Integer marginPairCount = 0;

      // RAGP-based margin opportunity
      Decimal totalPlannedRAGP = 0;
      Decimal totalRecRAGP = 0;
      Integer ragpPairCount = 0;

      // Compliance cohort analysis
      Integer alignedDeals = 0;
      Integer alignedWon = 0;
      Decimal alignedMarginSum = 0;
      Integer alignedMarginCount = 0;
      Integer divergedDeals = 0;
      Integer divergedWon = 0;
      Decimal divergedMarginSum = 0;
      Integer divergedMarginCount = 0;

      Integer totalWon = 0;
      Integer totalClosed = closedOpps.size();

      for (Opportunity opp : closedOpps) {
        Boolean isWon = opp.StageName == 'Closed Won';
        if (isWon)
          totalWon++;

        // Rep Performance
        Id ownerId = opp.OwnerId;
        if (!repMap.containsKey(ownerId)) {
          repMap.put(
            ownerId,
            new Map<String, Object>{
              'ownerId' => ownerId,
              'ownerName' => opp.Owner != null ? opp.Owner.Name : 'Unknown',
              'totalDeals' => 0,
              'wonDeals' => 0,
              'totalAmount' => (Decimal) 0,
              'marginSum' => (Decimal) 0,
              'marginCount' => 0,
              'compliantDeals' => 0,
              'marginsChecked' => 0
            }
          );
        }
        Map<String, Object> rep = repMap.get(ownerId);
        rep.put('totalDeals', (Integer) rep.get('totalDeals') + 1);
        if (isWon) {
          rep.put('wonDeals', (Integer) rep.get('wonDeals') + 1);
          if (opp.Amount != null) {
            rep.put(
              'totalAmount',
              (Decimal) rep.get('totalAmount') + opp.Amount
            );
          }
        }

        Decimal gpPct = safeDecimal(
          opp,
          'Fulcrum_GP_Percent__c',
          accessibleCustomFields
        );
        if (gpPct != null && isWon) {
          rep.put('marginSum', (Decimal) rep.get('marginSum') + gpPct);
          rep.put('marginCount', (Integer) rep.get('marginCount') + 1);
        }

        String competitors = safeString(
          opp,
          'Fulcrum_Competitors__c',
          accessibleCustomFields
        );
        String dealRegType = safeString(
          opp,
          'Fulcrum_Deal_Reg_Type__c',
          accessibleCustomFields
        );
        String relationship = safeString(
          opp,
          'Fulcrum_Relationship_Strength__c',
          accessibleCustomFields
        );
        String valueAddField = safeString(
          opp,
          'Fulcrum_Value_Add__c',
          accessibleCustomFields
        );
        String customerSegment = safeString(
          opp,
          'Fulcrum_Customer_Segment__c',
          accessibleCustomFields
        );
        String solutionComplexity = safeString(
          opp,
          'Fulcrum_Solution_Complexity__c',
          accessibleCustomFields
        );
        Boolean servicesAttached = safeBoolean(
          opp,
          'Fulcrum_Services_Attached__c',
          accessibleCustomFields
        );
        Boolean quarterEndFlag = safeBoolean(
          opp,
          'Fulcrum_Quarter_End__c',
          accessibleCustomFields
        );
        String dealType = safeString(
          opp,
          'Fulcrum_Deal_Type__c',
          accessibleCustomFields
        );
        Boolean isNewLogo = (dealType == 'New Logo' || dealType == 'New');

        Decimal pm = safeDecimal(
          opp,
          'Fulcrum_Planned_Margin__c',
          accessibleCustomFields
        );
        Decimal rm = safeDecimal(
          opp,
          'Fulcrum_Recommended_Margin__c',
          accessibleCustomFields
        );
        if (pm != null && rm != null) {
          rep.put('marginsChecked', (Integer) rep.get('marginsChecked') + 1);
          if (Math.abs(pm - rm) <= 3) {
            rep.put('compliantDeals', (Integer) rep.get('compliantDeals') + 1);
          }

          // Compliance cohort tracking
          Boolean isAligned = Math.abs(pm - rm) <= 3;
          if (isAligned) {
            alignedDeals++;
            if (isWon)
              alignedWon++;
            if (gpPct != null && isWon) {
              alignedMarginSum += gpPct;
              alignedMarginCount++;
            }
          } else {
            divergedDeals++;
            if (isWon)
              divergedWon++;
            if (gpPct != null && isWon) {
              divergedMarginSum += gpPct;
              divergedMarginCount++;
            }
          }

          // Only calculate margin opportunity for WON deals (actual GP captured)
          if (
            opp.Amount != null &&
            opp.Amount > 0 &&
            opp.StageName == 'Closed Won'
          ) {
            Decimal actualGP = opp.Amount * (pm / 100);
            Decimal potentialGP = opp.Amount * (rm / 100);
            totalActualGP += actualGP;
            totalPotentialGP += potentialGP;
            totalActualMarginSum += pm;
            totalRecMarginSum += rm;
            marginPairCount++;

            // RAGP calculation
            Integer wpAtPlanned = estimateWinProbability(
              pm,
              competitors,
              dealRegType,
              customerSegment,
              relationship,
              valueAddField,
              isNewLogo,
              solutionComplexity,
              servicesAttached,
              quarterEndFlag
            );
            Integer wpAtRec = estimateWinProbability(
              rm,
              competitors,
              dealRegType,
              customerSegment,
              relationship,
              valueAddField,
              isNewLogo,
              solutionComplexity,
              servicesAttached,
              quarterEndFlag
            );
            totalPlannedRAGP += opp.Amount * (pm / 100) * (wpAtPlanned / 100.0);
            totalRecRAGP += opp.Amount * (rm / 100) * (wpAtRec / 100.0);
            ragpPairCount++;
          }
        }

        // Competitive Aggregation (multi-select picklist — manual loop)
        String competitorNamesStr = safeString(
          opp,
          'Fulcrum_Competitor_Names__c',
          accessibleCustomFields
        );
        if (String.isNotBlank(competitorNamesStr)) {
          for (String comp : competitorNamesStr.split(';')) {
            comp = comp.trim();
            if (String.isBlank(comp))
              continue;

            if (!competitorMap.containsKey(comp)) {
              competitorMap.put(
                comp,
                new Map<String, Object>{
                  'name' => comp,
                  'wins' => 0,
                  'losses' => 0,
                  'wonMarginSum' => (Decimal) 0,
                  'wonMarginCount' => 0,
                  'lostMarginSum' => (Decimal) 0,
                  'lostMarginCount' => 0
                }
              );
            }
            Map<String, Object> compData = competitorMap.get(comp);
            if (isWon) {
              compData.put('wins', (Integer) compData.get('wins') + 1);
              if (gpPct != null) {
                compData.put(
                  'wonMarginSum',
                  (Decimal) compData.get('wonMarginSum') + gpPct
                );
                compData.put(
                  'wonMarginCount',
                  (Integer) compData.get('wonMarginCount') + 1
                );
              }
            } else {
              compData.put('losses', (Integer) compData.get('losses') + 1);
              if (gpPct != null) {
                compData.put(
                  'lostMarginSum',
                  (Decimal) compData.get('lostMarginSum') + gpPct
                );
                compData.put(
                  'lostMarginCount',
                  (Integer) compData.get('lostMarginCount') + 1
                );
              }
            }
          }
        }
      }

      // Build rep performance list
      List<Map<String, Object>> repPerformance = new List<Map<String, Object>>();
      for (Map<String, Object> rep : repMap.values()) {
        Integer totalDeals = (Integer) rep.get('totalDeals');
        Integer wonDeals = (Integer) rep.get('wonDeals');
        Integer marginCount = (Integer) rep.get('marginCount');
        Integer marginsChecked = (Integer) rep.get('marginsChecked');
        Integer compliant = (Integer) rep.get('compliantDeals');

        rep.put(
          'winRate',
          totalDeals > 0 ? (Decimal) wonDeals / totalDeals * 100 : 0
        );
        rep.put(
          'avgMargin',
          marginCount > 0 ? (Decimal) rep.get('marginSum') / marginCount : 0
        );
        rep.put(
          'complianceRate',
          marginsChecked > 0 ? (Decimal) compliant / marginsChecked * 100 : 0
        );

        repPerformance.add(rep);
      }
      sortByFieldDesc(repPerformance, 'totalDeals');

      // Build competitor data list (top 10)
      List<Map<String, Object>> competitorData = new List<Map<String, Object>>();
      for (Map<String, Object> comp : competitorMap.values()) {
        Integer wins = (Integer) comp.get('wins');
        Integer losses = (Integer) comp.get('losses');
        Integer total = wins + losses;
        comp.put('totalDeals', total);
        comp.put('winRate', total > 0 ? (Decimal) wins / total * 100 : 0);
        comp.put(
          'avgMarginWon',
          (Integer) comp.get('wonMarginCount') > 0
            ? (Decimal) comp.get('wonMarginSum') /
              (Integer) comp.get('wonMarginCount')
            : null
        );
        comp.put(
          'avgMarginLost',
          (Integer) comp.get('lostMarginCount') > 0
            ? (Decimal) comp.get('lostMarginSum') /
              (Integer) comp.get('lostMarginCount')
            : null
        );
        competitorData.add(comp);
      }
      sortByFieldDesc(competitorData, 'totalDeals');
      if (competitorData.size() > 10) {
        List<Map<String, Object>> trimmed = new List<Map<String, Object>>();
        for (Integer i = 0; i < 10; i++) {
          trimmed.add(competitorData[i]);
        }
        competitorData = trimmed;
      }

      // Margin Opportunity
      Map<String, Object> marginOpportunity = new Map<String, Object>{
        'currentBlendedMargin' => marginPairCount > 0
          ? totalActualMarginSum / marginPairCount
          : 0,
        'potentialBlendedMargin' => marginPairCount > 0
          ? totalRecMarginSum / marginPairCount
          : 0,
        'currentGP' => totalActualGP,
        'potentialGP' => totalPotentialGP,
        'gpDelta' => totalPotentialGP - totalActualGP,
        'dealCount' => marginPairCount
      };
      marginOpportunity.put('totalPlannedRAGP', totalPlannedRAGP);
      marginOpportunity.put('totalRecRAGP', totalRecRAGP);
      marginOpportunity.put('ragpDelta', totalRecRAGP - totalPlannedRAGP);
      marginOpportunity.put('ragpDealCount', ragpPairCount);

      Map<String, Object> complianceCohorts = new Map<String, Object>{
        'alignedDeals' => alignedDeals,
        'alignedWon' => alignedWon,
        'alignedWinRate' => alignedDeals > 0
          ? ((Decimal) alignedWon / alignedDeals * 100)
          : 0,
        'alignedAvgMargin' => alignedMarginCount > 0
          ? alignedMarginSum / alignedMarginCount
          : 0,
        'divergedDeals' => divergedDeals,
        'divergedWon' => divergedWon,
        'divergedWinRate' => divergedDeals > 0
          ? ((Decimal) divergedWon / divergedDeals * 100)
          : 0,
        'divergedAvgMargin' => divergedMarginCount > 0
          ? divergedMarginSum / divergedMarginCount
          : 0
      };

      Decimal overallWinRate = totalClosed > 0
        ? (Decimal) totalWon / totalClosed * 100
        : 0;

      result.put('complianceCohorts', complianceCohorts);
      result.put('repPerformance', repPerformance);
      result.put('competitorData', competitorData);
      result.put('marginOpportunity', marginOpportunity);
      result.put('winRate', overallWinRate);
      result.put('totalClosed', totalClosed);
      result.put('totalWon', totalWon);
    } catch (Exception e) {
      throw new AuraHandledException(
        'Unable to load historical data: ' + e.getMessage()
      );
    }

    return result;
  }

  /**
   * Team comparison for VP/Admin: groups closed deals by owner's manager,
   * returns per-team KPIs (pipeline, win rate, compliance, RAGP delta).
   */
  @AuraEnabled(cacheable=true)
  public static List<Map<String, Object>> getTeamComparison(String timeRange) {
    if (!isManagerOrAdmin()) {
      return new List<Map<String, Object>>();
    }

    Date startDate = getStartDate(timeRange);
    List<String> accessibleCustomFields = getAccessibleFields();

    String dateFilter = startDate != null ? ' AND CloseDate >= :startDate' : '';

    String query =
      'SELECT Id, OwnerId, Owner.Name, Owner.ManagerId, Owner.Manager.Name, ' +
      'StageName, Amount, Fulcrum_Planned_Margin__c, Fulcrum_Recommended_Margin__c, ' +
      'Fulcrum_GP_Percent__c, Fulcrum_Competitors__c, Fulcrum_Deal_Reg_Type__c, ' +
      'Fulcrum_Customer_Segment__c, Fulcrum_Relationship_Strength__c, ' +
      'Fulcrum_Value_Add__c, Fulcrum_Solution_Complexity__c, ' +
      'Fulcrum_Services_Attached__c, Fulcrum_Quarter_End__c' +
      ' FROM Opportunity' +
      ' WHERE StageName IN (\'Closed Won\', \'Closed Lost\')' +
      dateFilter +
      ' WITH SECURITY_ENFORCED' +
      ' ORDER BY CloseDate DESC' +
      ' LIMIT 10000';

    List<Opportunity> opps = Database.query(query);

    // Group by manager
    Map<Id, Map<String, Object>> teamMap = new Map<Id, Map<String, Object>>();

    for (Opportunity opp : opps) {
      Id managerId = opp.Owner != null ? opp.Owner.ManagerId : null;
      String managerName = 'No Manager';
      if (managerId != null && opp.Owner.Manager != null) {
        managerName = opp.Owner.Manager.Name;
      } else if (managerId == null) {
        managerId = opp.OwnerId; // Self-managed / no manager assigned
        managerName =
          (opp.Owner != null ? opp.Owner.Name : 'Unknown') + ' (Direct)';
      }

      if (!teamMap.containsKey(managerId)) {
        teamMap.put(
          managerId,
          new Map<String, Object>{
            'managerId' => managerId,
            'managerName' => managerName,
            'totalDeals' => 0,
            'wonDeals' => 0,
            'totalAmount' => (Decimal) 0,
            'compliantDeals' => 0,
            'marginsChecked' => 0,
            'totalPlannedRAGP' => (Decimal) 0,
            'totalRecRAGP' => (Decimal) 0,
            'ragpPairCount' => 0,
            'repIds' => new Set<Id>()
          }
        );
      }

      Map<String, Object> team = teamMap.get(managerId);
      Boolean isWon = opp.StageName == 'Closed Won';
      team.put('totalDeals', (Integer) team.get('totalDeals') + 1);
      if (isWon) {
        team.put('wonDeals', (Integer) team.get('wonDeals') + 1);
        if (opp.Amount != null) {
          team.put(
            'totalAmount',
            (Decimal) team.get('totalAmount') + opp.Amount
          );
        }
      }

      ((Set<Id>) team.get('repIds')).add(opp.OwnerId);

      Decimal pm = safeDecimal(
        opp,
        'Fulcrum_Planned_Margin__c',
        accessibleCustomFields
      );
      Decimal rm = safeDecimal(
        opp,
        'Fulcrum_Recommended_Margin__c',
        accessibleCustomFields
      );

      if (pm != null && rm != null) {
        team.put('marginsChecked', (Integer) team.get('marginsChecked') + 1);
        if (Math.abs(pm - rm) <= 3) {
          team.put('compliantDeals', (Integer) team.get('compliantDeals') + 1);
        }

        if (isWon && opp.Amount != null && opp.Amount > 0) {
          String competitors = safeString(
            opp,
            'Fulcrum_Competitors__c',
            accessibleCustomFields
          );
          String dealRegType = safeString(
            opp,
            'Fulcrum_Deal_Reg_Type__c',
            accessibleCustomFields
          );
          String segment = safeString(
            opp,
            'Fulcrum_Customer_Segment__c',
            accessibleCustomFields
          );
          String relationship = safeString(
            opp,
            'Fulcrum_Relationship_Strength__c',
            accessibleCustomFields
          );
          String valueAddF = safeString(
            opp,
            'Fulcrum_Value_Add__c',
            accessibleCustomFields
          );
          String complexity = safeString(
            opp,
            'Fulcrum_Solution_Complexity__c',
            accessibleCustomFields
          );
          Boolean services = safeBoolean(
            opp,
            'Fulcrum_Services_Attached__c',
            accessibleCustomFields
          );
          Boolean qEnd = safeBoolean(
            opp,
            'Fulcrum_Quarter_End__c',
            accessibleCustomFields
          );

          Integer wpPlanned = estimateWinProbability(
            pm,
            competitors,
            dealRegType,
            segment,
            relationship,
            valueAddF,
            false,
            complexity,
            services,
            qEnd
          );
          Integer wpRec = estimateWinProbability(
            rm,
            competitors,
            dealRegType,
            segment,
            relationship,
            valueAddF,
            false,
            complexity,
            services,
            qEnd
          );
          team.put(
            'totalPlannedRAGP',
            (Decimal) team.get('totalPlannedRAGP') +
            opp.Amount * (pm / 100) * (wpPlanned / 100.0)
          );
          team.put(
            'totalRecRAGP',
            (Decimal) team.get('totalRecRAGP') +
            opp.Amount * (rm / 100) * (wpRec / 100.0)
          );
          team.put('ragpPairCount', (Integer) team.get('ragpPairCount') + 1);
        }
      }
    }

    // Build output list
    List<Map<String, Object>> teams = new List<Map<String, Object>>();
    for (Map<String, Object> team : teamMap.values()) {
      Integer totalDeals = (Integer) team.get('totalDeals');
      Integer wonDeals = (Integer) team.get('wonDeals');
      Integer marginsChecked = (Integer) team.get('marginsChecked');
      Integer compliant = (Integer) team.get('compliantDeals');

      Map<String, Object> t = new Map<String, Object>();
      t.put('managerId', team.get('managerId'));
      t.put('managerName', team.get('managerName'));
      t.put('repCount', ((Set<Id>) team.get('repIds')).size());
      t.put('totalDeals', totalDeals);
      t.put('wonDeals', wonDeals);
      t.put(
        'winRate',
        totalDeals > 0 ? ((Decimal) wonDeals / totalDeals * 100) : 0
      );
      t.put('totalAmount', team.get('totalAmount'));
      t.put(
        'complianceRate',
        marginsChecked > 0 ? ((Decimal) compliant / marginsChecked * 100) : 0
      );
      Decimal plannedRAGP = (Decimal) team.get('totalPlannedRAGP');
      Decimal recRAGP = (Decimal) team.get('totalRecRAGP');
      t.put('ragpDelta', recRAGP - plannedRAGP);
      teams.add(t);
    }

    // Sort by total deals descending
    for (Integer i = 0; i < teams.size() - 1; i++) {
      for (Integer j = 0; j < teams.size() - i - 1; j++) {
        Integer n1 = (Integer) teams[j].get('totalDeals');
        Integer n2 = (Integer) teams[j + 1].get('totalDeals');
        if (n1 < n2) {
          Map<String, Object> temp = teams[j];
          teams[j] = teams[j + 1];
          teams[j + 1] = temp;
        }
      }
    }

    return teams;
  }

  /**
   * Get detail for a specific rep: last 10 closed deals, adoption metrics.
   * Used by the rep drill-down modal.
   */
  @AuraEnabled(cacheable=true)
  public static Map<String, Object> getRepDetail(Id repId, String timeRange) {
    if (!isManagerOrAdmin()) {
      throw new AuraHandledException('Insufficient permissions');
    }

    Map<String, Object> result = new Map<String, Object>();
    Date startDate = getStartDate(timeRange);
    List<String> accessibleCustomFields = getAccessibleFields();

    String dateFilter = startDate != null ? ' AND CloseDate >= :startDate' : '';

    String query =
      'SELECT Id, Name, Amount, StageName, CloseDate, Account.Name, ' +
      'Fulcrum_Planned_Margin__c, Fulcrum_Recommended_Margin__c, ' +
      'Fulcrum_GP_Percent__c, Fulcrum_OEM__c, Fulcrum_Customer_Segment__c' +
      ' FROM Opportunity' +
      ' WHERE OwnerId = :repId' +
      ' AND StageName IN (\'Closed Won\', \'Closed Lost\')' +
      dateFilter +
      ' WITH SECURITY_ENFORCED' +
      ' ORDER BY CloseDate DESC' +
      ' LIMIT 10';

    List<Opportunity> deals = Database.query(query);

    List<Map<String, Object>> dealList = new List<Map<String, Object>>();
    Integer wonCount = 0;
    Integer totalCount = 0;
    Integer scoredCount = 0;
    Integer compliantCount = 0;
    Integer marginsChecked = 0;
    Map<String, Integer> oemGapCount = new Map<String, Integer>();
    Map<String, Decimal> oemGapSum = new Map<String, Decimal>();

    for (Opportunity opp : deals) {
      Map<String, Object> d = new Map<String, Object>();
      d.put('id', opp.Id);
      d.put('name', opp.Name);
      d.put('accountName', opp.Account != null ? opp.Account.Name : 'N/A');
      d.put('amount', opp.Amount);
      d.put('stageName', opp.StageName);
      d.put('closeDate', opp.CloseDate);

      Decimal pm = safeDecimal(
        opp,
        'Fulcrum_Planned_Margin__c',
        accessibleCustomFields
      );
      Decimal rm = safeDecimal(
        opp,
        'Fulcrum_Recommended_Margin__c',
        accessibleCustomFields
      );
      String oem = safeString(opp, 'Fulcrum_OEM__c', accessibleCustomFields);

      d.put('plannedMargin', pm);
      d.put('recommendedMargin', rm);
      d.put('oem', oem);
      d.put('isWon', opp.StageName == 'Closed Won');

      Boolean isCompliant = false;
      if (pm != null && rm != null) {
        Decimal gap = pm - rm;
        d.put('marginGap', gap);
        isCompliant = Math.abs(gap) <= 3;
        marginsChecked++;
        if (isCompliant)
          compliantCount++;

        // Track per-OEM gap for coaching insights
        if (String.isNotBlank(oem) && gap < -3) {
          if (!oemGapCount.containsKey(oem)) {
            oemGapCount.put(oem, 0);
            oemGapSum.put(oem, (Decimal) 0);
          }
          oemGapCount.put(oem, oemGapCount.get(oem) + 1);
          oemGapSum.put(oem, oemGapSum.get(oem) + gap);
        }
      }
      d.put('isCompliant', isCompliant);

      if (rm != null)
        scoredCount++;
      totalCount++;
      if (opp.StageName == 'Closed Won')
        wonCount++;

      dealList.add(d);
    }

    result.put('deals', dealList);
    result.put('totalDeals', totalCount);
    result.put('wonDeals', wonCount);
    result.put(
      'winRate',
      totalCount > 0 ? ((Decimal) wonCount / totalCount * 100) : 0
    );
    result.put(
      'adoptionRate',
      totalCount > 0 ? ((Decimal) scoredCount / totalCount * 100) : 0
    );
    result.put(
      'complianceRate',
      marginsChecked > 0 ? ((Decimal) compliantCount / marginsChecked * 100) : 0
    );

    // Top coaching area: OEM with most under-priced deals
    String worstOem = null;
    Integer worstCount = 0;
    Decimal worstAvgGap = 0;
    for (String oemKey : oemGapCount.keySet()) {
      Integer cnt = oemGapCount.get(oemKey);
      if (cnt > worstCount) {
        worstCount = cnt;
        worstOem = oemKey;
        worstAvgGap = oemGapSum.get(oemKey) / cnt;
      }
    }
    if (worstOem != null) {
      result.put('coachingOem', worstOem);
      result.put('coachingDealCount', worstCount);
      result.put('coachingAvgGap', worstAvgGap);
    }

    return result;
  }

  private static Date getStartDate(String timeRange) {
    if (timeRange == null || timeRange == 'all')
      return null;
    if (timeRange == '30d')
      return Date.today().addDays(-30);
    if (timeRange == '90d')
      return Date.today().addDays(-90);
    if (timeRange == '6m')
      return Date.today().addMonths(-6);
    if (timeRange == '12m')
      return Date.today().addMonths(-12);
    return null;
  }

  private static Decimal safeDecimal(
    Opportunity opp,
    String fieldName,
    List<String> accessibleFields
  ) {
    try {
      if (!accessibleFields.contains(fieldName))
        return null;
      return (Decimal) opp.get(fieldName);
    } catch (Exception e) {
      return null;
    }
  }

  private static String safeString(
    Opportunity opp,
    String fieldName,
    List<String> accessibleFields
  ) {
    try {
      if (!accessibleFields.contains(fieldName))
        return null;
      return (String) opp.get(fieldName);
    } catch (Exception e) {
      return null;
    }
  }

  private static Boolean safeBoolean(
    Opportunity opp,
    String fieldName,
    List<String> accessibleFields
  ) {
    try {
      if (!accessibleFields.contains(fieldName))
        return null;
      return (Boolean) opp.get(fieldName);
    } catch (Exception e) {
      return null;
    }
  }

  /**
   * Estimate win probability using the same logistic model as winprob.js.
   * Returns integer 0-100.
   */
  private static Integer estimateWinProbability(
    Decimal marginPct,
    String competitors,
    String dealRegType,
    String customerSegment,
    String relationshipStrength,
    String valueAdd,
    Boolean isNewLogo,
    String solutionComplexity,
    Boolean servicesAttached,
    Boolean quarterEnd
  ) {
    // Base probability from competition level
    Decimal base;
    if (competitors == '0') {
      base = 0.68;
    } else if (competitors == '1') {
      base = 0.58;
    } else if (competitors == '2') {
      base = 0.43;
    } else if (competitors == '3+') {
      base = 0.32;
    } else {
      base = 0.50;
    }

    // Deal registration
    if (dealRegType == 'PremiumHunting') {
      base += 0.12;
    } else if (dealRegType == 'StandardApproved' || dealRegType == 'Teaming') {
      base += 0.06;
    }

    // Segment
    if (customerSegment == 'Enterprise') {
      base -= 0.04;
    }

    // Relationship strength
    if (relationshipStrength == 'Strategic') {
      base += 0.06;
    } else if (relationshipStrength == 'Good') {
      base += 0.03;
    } else if (relationshipStrength == 'New') {
      base -= 0.03;
    }

    // Value-add
    if (valueAdd == 'High') {
      base += 0.04;
    } else if (valueAdd == 'Low') {
      base -= 0.02;
    }

    // New logo deals are harder to win
    if (isNewLogo != null && isNewLogo) {
      base -= 0.04;
    }

    // Complex solutions
    if (solutionComplexity == 'High') {
      base -= 0.02;
    } else if (solutionComplexity == 'Low') {
      base += 0.01;
    }

    // Services attached
    if (servicesAttached != null && servicesAttached) {
      base += 0.03;
    }

    // Quarter end
    if (quarterEnd != null && quarterEnd) {
      base += 0.03;
    }

    // Margin-based logistic: higher margin = lower win probability
    Decimal margin = marginPct != null ? marginPct : 15;
    Decimal knee = 18;
    Decimal slope = 0.08;
    Decimal delta = margin - knee;
    Decimal logistic = 1.0 / (1.0 + Math.exp(slope * delta));

    Decimal wp = 0.6 * base + 0.4 * logistic;
    wp = Math.max(0.05, Math.min(0.95, wp));

    return (Integer) Math.round(wp * 100);
  }

  private static void sortByFieldDesc(
    List<Map<String, Object>> items,
    String field
  ) {
    for (Integer i = 0; i < items.size() - 1; i++) {
      for (Integer j = 0; j < items.size() - i - 1; j++) {
        Object val1 = items[j].get(field);
        Object val2 = items[j + 1].get(field);
        Integer n1 = val1 instanceof Integer ? (Integer) val1 : 0;
        Integer n2 = val2 instanceof Integer ? (Integer) val2 : 0;
        if (n1 < n2) {
          Map<String, Object> temp = items[j];
          items[j] = items[j + 1];
          items[j + 1] = temp;
        }
      }
    }
  }

  // ────────────────────────────────────────────────
  // Backfill Summary Methods
  // ────────────────────────────────────────────────

  /**
   * Returns aggregate stats from Fulcrum_Backfill_Result__c for the
   * Historical Backfill Analysis section of the manager dashboard.
   */
  @AuraEnabled(cacheable=true)
  public static Map<String, Object> getBackfillSummary() {
    Map<String, Object> summary = new Map<String, Object>();

    try {
      // Aggregate queries on Fulcrum_Backfill_Result__c
      List<AggregateResult> agg = [
        SELECT
          COUNT(Id) totalCount,
          AVG(Margin_Delta__c) avgMarginDelta,
          SUM(GP_Delta__c) totalGPDelta,
          AVG(Actual_Margin__c) avgActualMargin,
          AVG(Recommended_Margin__c) avgRecommendedMargin,
          SUM(Actual_GP__c) totalActualGP,
          SUM(Recommended_GP__c) totalRecommendedGP,
          MAX(Analysis_Date__c) lastAnalysisDate
        FROM Fulcrum_Backfill_Result__c
        WITH SECURITY_ENFORCED
      ];

      if (agg.isEmpty() || (Integer) agg[0].get('totalCount') == 0) {
        summary.put('totalCount', 0);
        summary.put('avgMarginDelta', 0);
        summary.put('totalGPDelta', 0);
        summary.put('avgActualMargin', 0);
        summary.put('avgRecommendedMargin', 0);
        summary.put('totalActualGP', 0);
        summary.put('totalRecommendedGP', 0);
        summary.put('lastAnalysisDate', null);
        summary.put('oemBreakdown', new List<Map<String, Object>>());
        return summary;
      }

      AggregateResult r = agg[0];
      summary.put('totalCount', (Integer) r.get('totalCount'));
      summary.put('avgMarginDelta', r.get('avgMarginDelta'));
      summary.put('totalGPDelta', r.get('totalGPDelta'));
      summary.put('avgActualMargin', r.get('avgActualMargin'));
      summary.put('avgRecommendedMargin', r.get('avgRecommendedMargin'));
      summary.put('totalActualGP', r.get('totalActualGP'));
      summary.put('totalRecommendedGP', r.get('totalRecommendedGP'));
      summary.put('lastAnalysisDate', r.get('lastAnalysisDate'));

      // OEM breakdown
      List<AggregateResult> oemAgg = [
        SELECT
          OEM__c oem,
          COUNT(Id) dealCount,
          AVG(Margin_Delta__c) avgDelta,
          SUM(GP_Delta__c) gpDelta
        FROM Fulcrum_Backfill_Result__c
        WHERE OEM__c != NULL
        WITH SECURITY_ENFORCED
        GROUP BY OEM__c
        ORDER BY SUM(GP_Delta__c) DESC
        LIMIT 10
      ];

      List<Map<String, Object>> oemBreakdown = new List<Map<String, Object>>();
      for (AggregateResult oemR : oemAgg) {
        oemBreakdown.add(
          new Map<String, Object>{
            'oem' => (String) oemR.get('oem'),
            'dealCount' => (Integer) oemR.get('dealCount'),
            'avgDelta' => oemR.get('avgDelta'),
            'gpDelta' => oemR.get('gpDelta')
          }
        );
      }
      summary.put('oemBreakdown', oemBreakdown);

      // Rep breakdown
      List<AggregateResult> repAgg = [
        SELECT
          Rep_Name__c rep,
          COUNT(Id) dealCount,
          AVG(Margin_Delta__c) avgDelta,
          SUM(GP_Delta__c) gpDelta,
          AVG(Actual_Margin__c) avgActual,
          AVG(Recommended_Margin__c) avgRecommended
        FROM Fulcrum_Backfill_Result__c
        WHERE Rep_Name__c != NULL
        WITH SECURITY_ENFORCED
        GROUP BY Rep_Name__c
        ORDER BY SUM(GP_Delta__c) DESC
        LIMIT 20
      ];

      List<Map<String, Object>> repBreakdown = new List<Map<String, Object>>();
      for (AggregateResult repR : repAgg) {
        repBreakdown.add(
          new Map<String, Object>{
            'rep' => (String) repR.get('rep'),
            'dealCount' => (Integer) repR.get('dealCount'),
            'avgDelta' => repR.get('avgDelta'),
            'gpDelta' => repR.get('gpDelta'),
            'avgActual' => repR.get('avgActual'),
            'avgRecommended' => repR.get('avgRecommended')
          }
        );
      }
      summary.put('repBreakdown', repBreakdown);
    } catch (Exception e) {
      throw new AuraHandledException(
        'Unable to load backfill summary: ' + e.getMessage()
      );
    }

    return summary;
  }

  /**
   * Returns individual backfill records for display in the dashboard table.
   * Ordered by GP_Delta__c descending (highest opportunity first).
   */
  @AuraEnabled(cacheable=true)
  public static List<Map<String, Object>> getBackfillDetails() {
    List<Map<String, Object>> details = new List<Map<String, Object>>();

    try {
      List<Fulcrum_Backfill_Result__c> records = [
        SELECT
          Id,
          Opportunity__c,
          Opportunity__r.Name,
          Actual_Margin__c,
          Recommended_Margin__c,
          Margin_Delta__c,
          Actual_GP__c,
          Recommended_GP__c,
          GP_Delta__c,
          Win_Probability__c,
          Confidence__c,
          OEM__c,
          Close_Date__c,
          Analysis_Date__c,
          Rep_Name__c
        FROM Fulcrum_Backfill_Result__c
        WITH SECURITY_ENFORCED
        ORDER BY GP_Delta__c DESC
        LIMIT 50
      ];

      for (Fulcrum_Backfill_Result__c rec : records) {
        details.add(
          new Map<String, Object>{
            'id' => rec.Id,
            'opportunityId' => rec.Opportunity__c,
            'opportunityName' => rec.Opportunity__r != null
              ? rec.Opportunity__r.Name
              : 'N/A',
            'actualMargin' => rec.Actual_Margin__c,
            'recommendedMargin' => rec.Recommended_Margin__c,
            'marginDelta' => rec.Margin_Delta__c,
            'actualGP' => rec.Actual_GP__c,
            'recommendedGP' => rec.Recommended_GP__c,
            'gpDelta' => rec.GP_Delta__c,
            'winProbability' => rec.Win_Probability__c,
            'confidence' => rec.Confidence__c,
            'oem' => rec.OEM__c,
            'closeDate' => rec.Close_Date__c,
            'analysisDate' => rec.Analysis_Date__c,
            'repName' => rec.Rep_Name__c
          }
        );
      }
    } catch (Exception e) {
      throw new AuraHandledException(
        'Unable to load backfill details: ' + e.getMessage()
      );
    }

    return details;
  }
}
