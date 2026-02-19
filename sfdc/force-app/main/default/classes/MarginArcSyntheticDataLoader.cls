/**
 * Synthetic deal data generator for MarginArc demo org.
 * Creates 500-600 realistic Closed Won/Lost Opportunities that mimic
 * a mid-market IT VAR's deal history over 18-24 months.
 *
 * Architecture:
 *   - Entry point: loadSyntheticData() creates Accounts then enqueues
 *     SyntheticDealQueueable to insert Opportunities in batches of 200.
 *   - clearSyntheticData() removes everything created by this loader.
 *   - Idempotent: checks for sentinel Account "Regeneron Pharmaceuticals (Synthetic)"
 *     before inserting anything.
 *
 * Accounts (5):
 *   Regeneron Pharmaceuticals, Hudson Valley Credit Union,
 *   Westchester Medical Center, SUNY Purchase, Entergy Northeast
 *
 * OEMs: Cisco, HPE, Palo Alto
 * Competitors: CDW, SHI, Insight
 * Date range: Jan 2024 - Feb 2026
 */
public with sharing class MarginArcSyntheticDataLoader {

  // ---------------------------------------------------------------
  // Constants
  // ---------------------------------------------------------------

  private static final String SENTINEL = 'Regeneron Pharmaceuticals (Synthetic)';
  private static final Integer TARGET_DEAL_COUNT = 550;

  // Competitor pool
  private static final List<String> COMPETITOR_POOL = new List<String>{
    'CDW', 'SHI', 'Insight'
  };

  // Loss reasons weighted toward Price (most common for VARs)
  private static final List<String> LOSS_REASONS = new List<String>{
    'Price', 'Price', 'Price', 'Relationship', 'Technical',
    'Timing', 'Budget', 'NoDecision'
  };

  // ---------------------------------------------------------------
  // Account archetypes
  // ---------------------------------------------------------------

  private class AccountArchetype {
    String name;
    String industry;
    Decimal annualRevenue;
    Integer dealCount;         // target deals
    String primarySegment;     // most common segment for this account
    String relationship;       // default relationship strength
    List<String> primaryOems;  // weighted OEM list (duplicates = weight)
    List<String> primaryCategories;  // matching product categories
    Decimal avgDealSize;       // geometric mean of deal size
    Boolean servicesHeavy;     // tends to buy services

    AccountArchetype(
      String n, String ind, Decimal rev, Integer dc, String seg,
      String rel, List<String> oems, List<String> cats,
      Decimal avgSize, Boolean svcHeavy
    ) {
      this.name = n;
      this.industry = ind;
      this.annualRevenue = rev;
      this.dealCount = dc;
      this.primarySegment = seg;
      this.relationship = rel;
      this.primaryOems = oems;
      this.primaryCategories = cats;
      this.avgDealSize = avgSize;
      this.servicesHeavy = svcHeavy;
    }
  }

  private static List<AccountArchetype> getArchetypes() {
    return new List<AccountArchetype>{
      // Regeneron: Enterprise pharma, heavy Cisco + Palo Alto, strategic
      new AccountArchetype(
        'Regeneron Pharmaceuticals (Synthetic)', 'Biotechnology', 13000000000.0, 420,
        'Enterprise', 'Strategic',
        new List<String>{
          'Cisco','Cisco','Cisco','Cisco','Cisco',
          'Palo Alto','Palo Alto','Palo Alto',
          'HPE','HPE'
        },
        new List<String>{
          'Networking','Networking','Networking','Networking','Networking',
          'Security','Security','Security',
          'Compute','Compute'
        },
        95000, true
      ),
      // HVCU: Mid-market financial, HPE compute + Cisco networking, price-sensitive
      new AccountArchetype(
        'Hudson Valley Credit Union (Synthetic)', 'Finance', 950000000.0, 260,
        'MidMarket', 'Good',
        new List<String>{
          'HPE','HPE','HPE','HPE',
          'Cisco','Cisco','Cisco',
          'Palo Alto','Palo Alto',
          'HPE'
        },
        new List<String>{
          'Compute','Compute','Compute','Compute',
          'Networking','Networking','Networking',
          'Security','Security',
          'Storage'
        },
        65000, false
      ),
      // Westchester Medical: Enterprise healthcare, Cisco + HPE + Palo Alto, services-heavy
      new AccountArchetype(
        'Westchester Medical Center (Synthetic)', 'Healthcare', 2500000000.0, 200,
        'Enterprise', 'Good',
        new List<String>{
          'Cisco','Cisco','Cisco',
          'HPE','HPE','HPE',
          'Palo Alto','Palo Alto',
          'Cisco','HPE'
        },
        new List<String>{
          'Networking','Networking','Networking',
          'Compute','Compute','Storage',
          'Security','Security',
          'Networking','Compute'
        },
        85000, true
      ),
      // SUNY Purchase: SMB/Mid education, mostly Cisco, budget-constrained
      new AccountArchetype(
        'SUNY Purchase (Synthetic)', 'Education', 180000000.0, 170,
        'SMB', 'Good',
        new List<String>{
          'Cisco','Cisco','Cisco','Cisco','Cisco','Cisco',
          'HPE','HPE',
          'Palo Alto','Palo Alto'
        },
        new List<String>{
          'Networking','Networking','Networking','Networking','Networking','Networking',
          'Compute','Compute',
          'Security','Security'
        },
        42000, false
      ),
      // Entergy: Enterprise energy, HPE storage + Palo Alto, high security
      new AccountArchetype(
        'Entergy Northeast (Synthetic)', 'Energy', 12000000000.0, 150,
        'Enterprise', 'Good',
        new List<String>{
          'HPE','HPE','HPE','HPE',
          'Palo Alto','Palo Alto','Palo Alto',
          'Cisco','Cisco','Cisco'
        },
        new List<String>{
          'Storage','Storage','Compute','Compute',
          'Security','Security','Security',
          'Networking','Networking','Networking'
        },
        110000, true
      )
    };
  }

  // ---------------------------------------------------------------
  // OEM margin profiles
  // ---------------------------------------------------------------

  private class OemMarginProfile {
    String oem;
    String category;
    Decimal baseMeanMargin;   // mean margin % for won deals
    Decimal marginStdDev;     // standard deviation
    Decimal dealRegBoost;     // pp boost for deal registration
    Decimal servicesBoost;    // pp boost for services attached
    Decimal quarterEndBoost;  // pp boost for quarter-end vendor incentives

    OemMarginProfile(
      String o, String c, Decimal mean, Decimal sd,
      Decimal drb, Decimal sb, Decimal qeb
    ) {
      this.oem = o;
      this.category = c;
      this.baseMeanMargin = mean;
      this.marginStdDev = sd;
      this.dealRegBoost = drb;
      this.servicesBoost = sb;
      this.quarterEndBoost = qeb;
    }
  }

  // Key: "OEM|Category"
  private static Map<String, OemMarginProfile> getMarginProfiles() {
    List<OemMarginProfile> profiles = new List<OemMarginProfile>{
      new OemMarginProfile('Cisco', 'Networking', 19.0, 2.5, 2.5, 3.5, 1.5),
      new OemMarginProfile('Cisco', 'Security',   24.0, 3.0, 3.0, 4.0, 1.5),
      new OemMarginProfile('HPE',   'Compute',    15.0, 2.0, 2.0, 3.0, 1.0),
      new OemMarginProfile('HPE',   'Storage',    21.0, 2.5, 2.5, 3.5, 1.5),
      new OemMarginProfile('Palo Alto', 'Security', 26.0, 3.0, 3.5, 4.0, 2.0)
    };
    Map<String, OemMarginProfile> m = new Map<String, OemMarginProfile>();
    for (OemMarginProfile p : profiles) {
      m.put(p.oem + '|' + p.category, p);
    }
    return m;
  }

  // ---------------------------------------------------------------
  // Entry point: loadSyntheticData
  // ---------------------------------------------------------------

  @AuraEnabled
  public static Map<String, Object> loadSyntheticData() {
    Map<String, Object> result = new Map<String, Object>();

    // Idempotency check
    List<Account> existing = [
      SELECT Id FROM Account WHERE Name = :SENTINEL LIMIT 1
    ];
    if (!existing.isEmpty()) {
      result.put('success', true);
      result.put('alreadyLoaded', true);
      result.put('message', 'Synthetic data has already been loaded.');
      return result;
    }

    try {
      // 1. Create Accounts
      List<AccountArchetype> archetypes = getArchetypes();
      List<Account> accounts = new List<Account>();
      for (AccountArchetype a : archetypes) {
        accounts.add(new Account(
          Name = a.name,
          Industry = a.industry,
          AnnualRevenue = a.annualRevenue
        ));
      }
      SObjectAccessDecision acctDecision = Security.stripInaccessible(
        AccessType.CREATABLE, accounts
      );
      insert acctDecision.getRecords();
      List<Account> insertedAccounts = (List<Account>) acctDecision.getRecords();

      // Build account map
      Map<String, Id> accountMap = new Map<String, Id>();
      for (Account a : insertedAccounts) {
        accountMap.put(a.Name, a.Id);
      }

      // 2. Generate all deal data as serializable list
      List<Map<String, Object>> allDeals = generateAllDeals(archetypes, accountMap);

      // 3. Enqueue batch insertion (200 per job)
      String dealsJson = JSON.serialize(allDeals);
      Id jobId = System.enqueueJob(
        new SyntheticDealQueueable(dealsJson, 0)
      );

      result.put('success', true);
      result.put('alreadyLoaded', false);
      result.put('accounts', insertedAccounts.size());
      result.put('opportunities', allDeals.size());
      result.put('jobId', jobId);
      result.put('message',
        'Creating ' + allDeals.size() + ' synthetic opportunities across ' +
        insertedAccounts.size() + ' accounts. Inserting in background...');
    } catch (Exception e) {
      result.put('success', false);
      result.put('message', 'Error loading synthetic data: ' + e.getMessage());
    }

    return result;
  }

  // ---------------------------------------------------------------
  // Entry point: clearSyntheticData
  // ---------------------------------------------------------------

  @AuraEnabled
  public static Map<String, Object> clearSyntheticData() {
    Map<String, Object> result = new Map<String, Object>();

    try {
      // Find synthetic opportunities
      List<Opportunity> opps = [
        SELECT Id FROM Opportunity
        WHERE Account.Name LIKE '%(Synthetic)%'
      ];
      Integer oppCount = opps.size();
      if (!opps.isEmpty()) {
        delete opps;
      }

      // Find synthetic accounts
      List<Account> accts = [
        SELECT Id FROM Account
        WHERE Name LIKE '%(Synthetic)%'
      ];
      Integer acctCount = accts.size();
      if (!accts.isEmpty()) {
        delete accts;
      }

      result.put('success', true);
      result.put('accounts', acctCount);
      result.put('opportunities', oppCount);
      result.put('message',
        'Cleared ' + oppCount + ' opportunities and ' + acctCount + ' accounts.');
    } catch (Exception e) {
      result.put('success', false);
      result.put('message', 'Error clearing synthetic data: ' + e.getMessage());
    }

    return result;
  }

  // ---------------------------------------------------------------
  // Deal generation engine
  // ---------------------------------------------------------------

  private static List<Map<String, Object>> generateAllDeals(
    List<AccountArchetype> archetypes, Map<String, Id> accountMap
  ) {
    List<Map<String, Object>> allDeals = new List<Map<String, Object>>();
    Map<String, OemMarginProfile> profiles = getMarginProfiles();

    // Date range: Jan 1, 2024 through Feb 15, 2026 (approx 775 days)
    Date startDate = Date.newInstance(2024, 1, 1);
    Date endDate   = Date.newInstance(2026, 2, 15);
    Integer totalDays = startDate.daysBetween(endDate);

    // Track sequential numbers per account
    Map<String, Integer> seqCounter = new Map<String, Integer>();

    for (AccountArchetype arch : archetypes) {
      String acctId = accountMap.get(arch.name);
      String shortName = arch.name.replace(' (Synthetic)', '');
      Integer seq = 0;

      for (Integer i = 0; i < arch.dealCount; i++) {
        seq++;
        Map<String, Object> deal = new Map<String, Object>();

        // -- Close Date: spread across the date range with quarter-end clustering --
        Date closeDate = generateCloseDate(startDate, totalDays);
        Integer closeMonth = closeDate.month();
        Boolean isQuarterEnd = (closeMonth == 3 || closeMonth == 6 ||
                                closeMonth == 9 || closeMonth == 12);

        // Determine quarter and year for naming
        Integer qtr = ((closeMonth - 1) / 3) + 1;
        Integer yr = closeDate.year();

        // -- Pick OEM and Category from archetype's weighted list --
        Integer oemIdx = randomInt(0, arch.primaryOems.size() - 1);
        String oem = arch.primaryOems[oemIdx];
        String category = arch.primaryCategories[oemIdx];

        // -- Customer Segment --
        String segment = determineSegment(arch.primarySegment);

        // -- Deal Size (log-normal distribution) --
        Decimal dealSize = generateDealSize(arch.avgDealSize, segment);

        // -- Competitors --
        Integer numCompetitors = generateCompetitorCount(segment, dealSize);
        String competitorCountStr;
        if (numCompetitors == 0) {
          competitorCountStr = '0';
        } else if (numCompetitors == 1) {
          competitorCountStr = '1';
        } else if (numCompetitors == 2) {
          competitorCountStr = '2';
        } else {
          competitorCountStr = '3+';
        }
        String competitorNames = pickCompetitorNames(numCompetitors);

        // -- Deal Registration --
        String dealRegType = generateDealRegType(segment, numCompetitors);
        Boolean isRegistered = (dealRegType == 'StandardApproved' || dealRegType == 'PremiumHunting');

        // -- Services Attached --
        Boolean servicesAttached = generateServicesAttached(arch.servicesHeavy, segment);

        // -- Solution Complexity --
        String complexity = generateComplexity(dealSize, servicesAttached);

        // -- Relationship Strength --
        String relationship = arch.relationship;
        // ~20% of deals are new logos
        Boolean isNewLogo = (Math.random() < 0.20);
        if (isNewLogo) {
          relationship = 'New';
        }

        // -- Deal Type --
        String dealType;
        if (isNewLogo) {
          dealType = 'New Business';
        } else {
          // Existing customer: mix of Renewal, Expansion, Refresh, Run Rate
          Decimal dtRand = Math.random();
          if (dtRand < 0.30) {
            dealType = 'Renewal';
          } else if (dtRand < 0.55) {
            dealType = 'Expansion';
          } else if (dtRand < 0.80) {
            dealType = 'Refresh';
          } else {
            dealType = 'Run Rate';
          }
        }

        // -- Margin Calculation --
        String profileKey = oem + '|' + category;
        OemMarginProfile mp = profiles.get(profileKey);
        // Fallback if combo not in profiles (shouldn't happen with our data)
        if (mp == null) {
          mp = new OemMarginProfile(oem, category, 20.0, 3.0, 2.5, 3.5, 1.5);
        }

        Decimal baseMargin = mp.baseMeanMargin;

        // Apply correlations
        // Bigger deals: compress margins
        if (dealSize > 200000) {
          baseMargin -= 2.5;
        } else if (dealSize > 100000) {
          baseMargin -= 1.0;
        } else if (dealSize < 40000) {
          baseMargin += 1.5;
        }

        // Segment effect
        if (segment == 'SMB') {
          baseMargin += 2.0;
        } else if (segment == 'Enterprise') {
          baseMargin -= 1.5;
        }

        // More competitors: lower margins
        if (numCompetitors >= 3) {
          baseMargin -= 3.0;
        } else if (numCompetitors == 2) {
          baseMargin -= 1.5;
        } else if (numCompetitors == 0) {
          baseMargin += 2.0;
        }

        // Deal registration: boost
        if (dealRegType == 'PremiumHunting') {
          baseMargin += mp.dealRegBoost;
        } else if (dealRegType == 'StandardApproved') {
          baseMargin += mp.dealRegBoost * 0.6;
        }

        // Services: boost
        if (servicesAttached) {
          baseMargin += mp.servicesBoost;
        }

        // Quarter-end: vendor incentives
        if (isQuarterEnd) {
          baseMargin += mp.quarterEndBoost;
        }

        // New logo: concession pricing
        if (isNewLogo) {
          baseMargin -= 2.5;
        }

        // Add noise (normal-ish distribution via Box-Muller approximation)
        Decimal noise = boxMullerApprox() * mp.marginStdDev;
        Decimal plannedMargin = baseMargin + noise;

        // Clamp to realistic range
        plannedMargin = Math.max(8.0, Math.min(35.0, plannedMargin));
        // Round to 1 decimal
        plannedMargin = (Math.round(plannedMargin * 10.0)) / 10.0;

        // -- Win/Loss determination --
        Decimal winProb = calculateWinProbability(
          numCompetitors, isRegistered, relationship, segment,
          dealSize, servicesAttached, isNewLogo
        );
        Boolean isWon = (Math.random() < winProb);

        String stageName;
        Integer probability;
        Decimal actualMargin;
        String lossReason = null;

        if (isWon) {
          stageName = 'Closed Won';
          probability = 100;
          // Actual margin is close to planned for won deals (slight improvement typically)
          Decimal marginDelta = (Math.random() * 3.0) - 1.0; // -1 to +2
          actualMargin = plannedMargin + marginDelta;
          actualMargin = Math.max(6.0, Math.min(35.0, actualMargin));
          actualMargin = (Math.round(actualMargin * 10.0)) / 10.0;
        } else {
          stageName = 'Closed Lost';
          probability = 0;
          // Lost deals: planned margins were typically 2-5pp higher (they priced too high)
          plannedMargin += 2.0 + (Math.random() * 3.0);
          plannedMargin = Math.min(35.0, plannedMargin);
          plannedMargin = (Math.round(plannedMargin * 10.0)) / 10.0;
          actualMargin = null;
          lossReason = LOSS_REASONS[randomInt(0, LOSS_REASONS.size() - 1)];
        }

        // -- Compute financial fields --
        Decimal oemCost = dealSize; // dealSize IS the cost basis
        Decimal revenue;
        if (isWon && actualMargin != null) {
          revenue = oemCost / (1.0 - (actualMargin / 100.0));
        } else {
          // For lost deals, use planned margin to compute what the revenue would have been
          revenue = oemCost / (1.0 - (plannedMargin / 100.0));
        }
        revenue = revenue.setScale(2, System.RoundingMode.HALF_UP);

        // -- Value-Add Services level --
        String valueAdd;
        if (!servicesAttached) {
          valueAdd = 'None';
        } else if (complexity == 'High') {
          valueAdd = 'High';
        } else if (complexity == 'Medium') {
          valueAdd = Math.random() < 0.6 ? 'Medium' : 'High';
        } else {
          valueAdd = Math.random() < 0.7 ? 'Low' : 'Medium';
        }

        // -- Opportunity Name --
        String oppName = shortName + ' - ' + oem + ' ' + category +
          ' Q' + qtr + ' ' + yr + ' #' + seq;

        // -- Build serializable map --
        deal.put('AccountId', acctId);
        deal.put('Name', oppName);
        deal.put('StageName', stageName);
        deal.put('Probability', probability);
        deal.put('CloseDate', String.valueOf(closeDate));
        deal.put('Amount', revenue);
        deal.put('Fulcrum_OEM__c', oem);
        deal.put('Fulcrum_OEM_Cost__c', oemCost);
        deal.put('Fulcrum_Planned_Margin__c', plannedMargin);
        deal.put('Fulcrum_Revenue__c', revenue);
        deal.put('Fulcrum_GP_Percent__c', isWon ? actualMargin : plannedMargin);
        deal.put('Fulcrum_Customer_Segment__c', segment);
        deal.put('Fulcrum_Competitors__c', competitorCountStr);
        deal.put('Fulcrum_Competitor_Names__c', competitorNames);
        deal.put('Fulcrum_Deal_Reg_Type__c', dealRegType);
        deal.put('Fulcrum_Solution_Complexity__c', complexity);
        deal.put('Fulcrum_Relationship_Strength__c', relationship);
        deal.put('Fulcrum_Services_Attached__c', servicesAttached);
        deal.put('Fulcrum_Product_Category__c', category);
        deal.put('Fulcrum_Quarter_End__c', isQuarterEnd);
        deal.put('Fulcrum_Deal_Type__c', dealType);
        deal.put('Fulcrum_Value_Add__c', valueAdd);
        if (lossReason != null) {
          deal.put('Fulcrum_Loss_Reason__c', lossReason);
        }

        allDeals.add(deal);
      }
    }

    return allDeals;
  }

  // ---------------------------------------------------------------
  // Date generation with quarter-end clustering
  // ---------------------------------------------------------------

  private static Date generateCloseDate(Date startDate, Integer totalDays) {
    // ~30% of deals close in last month of quarter (March, June, Sept, Dec)
    // Generate a date, then with 30% probability force it to a quarter-end month
    Integer dayOffset = randomInt(0, totalDays - 1);
    Date candidate = startDate.addDays(dayOffset);

    if (Math.random() < 0.30) {
      // Force to quarter-end month
      Integer month = candidate.month();
      Integer year = candidate.year();
      // Find nearest quarter-end month
      Integer qeMonth;
      if (month <= 3) {
        qeMonth = 3;
      } else if (month <= 6) {
        qeMonth = 6;
      } else if (month <= 9) {
        qeMonth = 9;
      } else {
        qeMonth = 12;
      }
      Integer maxDay = Date.daysInMonth(year, qeMonth);
      // Bias toward end of month (last 2 weeks)
      Integer day = randomInt(15, maxDay);
      candidate = Date.newInstance(year, qeMonth, day);
    }

    return candidate;
  }

  // ---------------------------------------------------------------
  // Segment determination (some variance around archetype default)
  // ---------------------------------------------------------------

  private static String determineSegment(String primarySegment) {
    // 70% chance of primary segment, 30% chance of adjacent
    if (Math.random() < 0.70) {
      return primarySegment;
    }
    // Adjacent segments
    if (primarySegment == 'Enterprise') {
      return 'MidMarket';
    } else if (primarySegment == 'SMB') {
      return Math.random() < 0.7 ? 'MidMarket' : 'SMB';
    } else {
      // MidMarket
      return Math.random() < 0.5 ? 'Enterprise' : 'SMB';
    }
  }

  // ---------------------------------------------------------------
  // Deal size: log-normal distribution
  // ---------------------------------------------------------------

  private static Decimal generateDealSize(Decimal geoMean, String segment) {
    // Log-normal: exp(ln(geoMean) + sigma * Z)
    // sigma controls spread; Z is standard normal
    Decimal lnMean = Math.log(Double.valueOf(geoMean));
    Decimal sigma = 0.6; // gives good spread

    // Segment adjustments
    if (segment == 'Enterprise') {
      lnMean += 0.3;  // ~35% larger deals
    } else if (segment == 'SMB') {
      lnMean -= 0.25; // ~22% smaller deals
    }

    Decimal z = boxMullerApprox();
    Decimal lnSize = lnMean + (sigma * z);
    // Apex has no Math.exp(), use Math.pow(e, x)
    Decimal size = Decimal.valueOf(Math.pow((Double)2.718281828459045, Double.valueOf(lnSize)));

    // Clamp to realistic range
    size = Math.max(15000, Math.min(500000, size));

    // Round to nearest $1000
    size = Math.round(size / 1000.0) * 1000;

    return size;
  }

  // ---------------------------------------------------------------
  // Competitor count based on segment and deal size
  // ---------------------------------------------------------------

  private static Integer generateCompetitorCount(String segment, Decimal dealSize) {
    // Enterprise & big deals = more competitors
    Decimal r = Math.random();

    if (segment == 'Enterprise' || dealSize > 200000) {
      // 5% no comp, 25% one, 40% two, 30% three+
      if (r < 0.05) return 0;
      if (r < 0.30) return 1;
      if (r < 0.70) return 2;
      return 3;
    } else if (segment == 'SMB' || dealSize < 40000) {
      // 30% no comp, 40% one, 20% two, 10% three+
      if (r < 0.30) return 0;
      if (r < 0.70) return 1;
      if (r < 0.90) return 2;
      return 3;
    } else {
      // MidMarket
      // 15% no comp, 35% one, 30% two, 20% three+
      if (r < 0.15) return 0;
      if (r < 0.50) return 1;
      if (r < 0.80) return 2;
      return 3;
    }
  }

  // ---------------------------------------------------------------
  // Pick competitor names from pool
  // ---------------------------------------------------------------

  private static String pickCompetitorNames(Integer count) {
    if (count == 0) return '';
    if (count >= 3) {
      // Return all three
      return 'CDW;SHI;Insight';
    }

    // Shuffle and pick
    List<String> pool = new List<String>(COMPETITOR_POOL);
    List<String> picked = new List<String>();
    for (Integer i = 0; i < count && !pool.isEmpty(); i++) {
      Integer idx = randomInt(0, pool.size() - 1);
      picked.add(pool[idx]);
      pool.remove(idx);
    }
    return String.join(picked, ';');
  }

  // ---------------------------------------------------------------
  // Deal registration type
  // ---------------------------------------------------------------

  private static String generateDealRegType(String segment, Integer numCompetitors) {
    // ~60% registered overall, higher for enterprise
    Decimal r = Math.random();

    if (segment == 'Enterprise') {
      // 25% not reg, 40% standard, 25% premium, 10% teaming
      if (r < 0.25) return 'NotRegistered';
      if (r < 0.65) return 'StandardApproved';
      if (r < 0.90) return 'PremiumHunting';
      return 'Teaming';
    } else if (segment == 'SMB') {
      // 50% not reg, 35% standard, 15% premium
      if (r < 0.50) return 'NotRegistered';
      if (r < 0.85) return 'StandardApproved';
      return 'PremiumHunting';
    } else {
      // MidMarket
      // 35% not reg, 40% standard, 20% premium, 5% teaming
      if (r < 0.35) return 'NotRegistered';
      if (r < 0.75) return 'StandardApproved';
      if (r < 0.95) return 'PremiumHunting';
      return 'Teaming';
    }
  }

  // ---------------------------------------------------------------
  // Services attached
  // ---------------------------------------------------------------

  private static Boolean generateServicesAttached(Boolean servicesHeavy, String segment) {
    // ~35% overall, higher for services-heavy accounts and Enterprise
    Decimal baseRate = servicesHeavy ? 0.45 : 0.25;
    if (segment == 'Enterprise') {
      baseRate += 0.10;
    } else if (segment == 'SMB') {
      baseRate -= 0.05;
    }
    return Math.random() < baseRate;
  }

  // ---------------------------------------------------------------
  // Solution complexity
  // ---------------------------------------------------------------

  private static String generateComplexity(Decimal dealSize, Boolean servicesAttached) {
    Decimal r = Math.random();

    if (dealSize > 200000 || servicesAttached) {
      // Bias toward Medium/High
      if (r < 0.15) return 'Low';
      if (r < 0.55) return 'Medium';
      return 'High';
    } else if (dealSize < 40000) {
      // Bias toward Low/Medium
      if (r < 0.50) return 'Low';
      if (r < 0.85) return 'Medium';
      return 'High';
    } else {
      if (r < 0.25) return 'Low';
      if (r < 0.70) return 'Medium';
      return 'High';
    }
  }

  // ---------------------------------------------------------------
  // Win probability calculation
  // ---------------------------------------------------------------

  private static Decimal calculateWinProbability(
    Integer numCompetitors, Boolean isRegistered, String relationship,
    String segment, Decimal dealSize, Boolean servicesAttached,
    Boolean isNewLogo
  ) {
    // Base: 63% win rate
    Decimal prob = 0.63;

    // Competitors: major factor
    if (numCompetitors == 0) {
      prob += 0.15;
    } else if (numCompetitors == 1) {
      prob += 0.03;
    } else if (numCompetitors == 2) {
      prob -= 0.08;
    } else {
      prob -= 0.15;
    }

    // Deal registration helps a lot
    if (isRegistered) {
      prob += 0.10;
    }

    // Relationship
    if (relationship == 'Strategic') {
      prob += 0.10;
    } else if (relationship == 'New') {
      prob -= 0.12;
    }

    // Big deals are harder to win
    if (dealSize > 300000) {
      prob -= 0.05;
    }

    // New logos are harder
    if (isNewLogo) {
      prob -= 0.08;
    }

    // Services attached means deeper engagement = higher win rate
    if (servicesAttached) {
      prob += 0.05;
    }

    // Clamp
    return Math.max(0.20, Math.min(0.90, prob));
  }

  // ---------------------------------------------------------------
  // Utility: Box-Muller approximation for normal distribution
  // Uses 12-sample Central Limit Theorem approach (no trig needed)
  // ---------------------------------------------------------------

  private static Decimal boxMullerApprox() {
    Decimal sum = 0;
    for (Integer i = 0; i < 12; i++) {
      sum += Math.random();
    }
    return sum - 6.0; // Approximately N(0,1)
  }

  // ---------------------------------------------------------------
  // Utility: random integer in range [min, max] inclusive
  // ---------------------------------------------------------------

  private static Integer randomInt(Integer minVal, Integer maxVal) {
    return minVal + (Integer) Math.floor(Math.random() * (maxVal - minVal + 1));
  }

  // ---------------------------------------------------------------
  // Queueable for batch insertion (200 per execution)
  // ---------------------------------------------------------------

  public class SyntheticDealQueueable implements Queueable {
    private String dealsJson;
    private Integer startIdx;
    private final Integer BATCH_SIZE = 400;

    public SyntheticDealQueueable(String json, Integer idx) {
      this.dealsJson = json;
      this.startIdx = idx;
    }

    public void execute(QueueableContext ctx) {
      List<Object> allDeals = (List<Object>) JSON.deserializeUntyped(this.dealsJson);
      Integer endIdx = Math.min(startIdx + BATCH_SIZE, allDeals.size());

      List<Opportunity> batch = new List<Opportunity>();

      for (Integer i = startIdx; i < endIdx; i++) {
        Map<String, Object> d = (Map<String, Object>) allDeals[i];
        Opportunity opp = new Opportunity();
        opp.AccountId = (String) d.get('AccountId');
        opp.Name = (String) d.get('Name');
        opp.StageName = (String) d.get('StageName');
        opp.Probability = (Integer) d.get('Probability');
        opp.CloseDate = Date.valueOf((String) d.get('CloseDate'));
        opp.Amount = toDecimal(d.get('Amount'));
        opp.Fulcrum_OEM__c = (String) d.get('Fulcrum_OEM__c');
        opp.Fulcrum_OEM_Cost__c = toDecimal(d.get('Fulcrum_OEM_Cost__c'));
        opp.Fulcrum_Planned_Margin__c = toDecimal(d.get('Fulcrum_Planned_Margin__c'));
        opp.Fulcrum_Revenue__c = toDecimal(d.get('Fulcrum_Revenue__c'));
        opp.Fulcrum_GP_Percent__c = toDecimal(d.get('Fulcrum_GP_Percent__c'));
        opp.Fulcrum_Customer_Segment__c = (String) d.get('Fulcrum_Customer_Segment__c');
        opp.Fulcrum_Competitors__c = (String) d.get('Fulcrum_Competitors__c');
        opp.Fulcrum_Competitor_Names__c = (String) d.get('Fulcrum_Competitor_Names__c');
        opp.Fulcrum_Deal_Reg_Type__c = (String) d.get('Fulcrum_Deal_Reg_Type__c');
        opp.Fulcrum_Solution_Complexity__c = (String) d.get('Fulcrum_Solution_Complexity__c');
        opp.Fulcrum_Relationship_Strength__c = (String) d.get('Fulcrum_Relationship_Strength__c');
        opp.Fulcrum_Services_Attached__c = (Boolean) d.get('Fulcrum_Services_Attached__c');
        opp.Fulcrum_Product_Category__c = (String) d.get('Fulcrum_Product_Category__c');
        opp.Fulcrum_Quarter_End__c = (Boolean) d.get('Fulcrum_Quarter_End__c');
        opp.Fulcrum_Deal_Type__c = (String) d.get('Fulcrum_Deal_Type__c');
        opp.Fulcrum_Value_Add__c = (String) d.get('Fulcrum_Value_Add__c');
        if (d.containsKey('Fulcrum_Loss_Reason__c')) {
          opp.Fulcrum_Loss_Reason__c = (String) d.get('Fulcrum_Loss_Reason__c');
        }

        batch.add(opp);
      }

      if (!batch.isEmpty()) {
        SObjectAccessDecision decision = Security.stripInaccessible(
          AccessType.CREATABLE, batch
        );
        insert decision.getRecords();
      }

      // Chain next batch if more remain (skip in test context — max depth = 1)
      if (endIdx < allDeals.size() && !Test.isRunningTest()) {
        System.enqueueJob(
          new SyntheticDealQueueable(this.dealsJson, endIdx)
        );
      }
    }

    private Decimal toDecimal(Object val) {
      if (val == null) return null;
      if (val instanceof Decimal) return (Decimal) val;
      if (val instanceof Double) return Decimal.valueOf((Double) val);
      if (val instanceof Integer) return Decimal.valueOf((Integer) val);
      if (val instanceof Long) return Decimal.valueOf((Long) val);
      return Decimal.valueOf(String.valueOf(val));
    }
  }
}
