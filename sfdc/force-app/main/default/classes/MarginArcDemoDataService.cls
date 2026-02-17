/**
 * REST API service for creating, querying, and removing MarginArc demo data.
 * Used by the MarginArc admin portal to populate customer Salesforce orgs
 * with realistic sample data for product demos and evaluations.
 *
 * Endpoints:
 *   POST   /services/apexrest/marginarc/demo-data  — Create demo data
 *   GET    /services/apexrest/marginarc/demo-data  — Check demo data status
 *   DELETE /services/apexrest/marginarc/demo-data  — Remove all demo data
 */
@RestResource(urlMapping='/marginarc/demo-data/*')
global with sharing class MarginArcDemoDataService {
  // ────────────────────────────────────────────────
  // HTTP POST — Create demo data
  // ────────────────────────────────────────────────

  @HttpPost
  global static void doPost() {
    RestResponse res = RestContext.response;
    res.addHeader('Content-Type', 'application/json');

    try {
      String body = RestContext.request.requestBody.toString();
      Map<String, Object> params = (Map<String, Object>) JSON.deserializeUntyped(
        body
      );

      String size = (String) params.get('size');
      if (String.isBlank(size)) {
        size = 'small';
      }
      Boolean includeOems = params.get('includeOems') != null
        ? (Boolean) params.get('includeOems')
        : true;
      Boolean includeCompetitors = params.get('includeCompetitors') != null
        ? (Boolean) params.get('includeCompetitors')
        : true;
      Boolean includeHistorical = params.get('includeHistorical') != null
        ? (Boolean) params.get('includeHistorical')
        : true;

      // Idempotency check
      List<Account> existing = [
        SELECT Id
        FROM Account
        WHERE Name LIKE '%(Demo)%'
        LIMIT 1
      ];
      if (!existing.isEmpty()) {
        res.statusCode = 200;
        res.responseBody = Blob.valueOf(
          JSON.serialize(
            new Map<String, Object>{
              'success' => false,
              'alreadyLoaded' => true,
              'message' => 'Demo data already exists. Remove it first before reloading.'
            }
          )
        );
        return;
      }

      if (size == 'full') {
        // Full size: accept deal data from Lambda payload, process via Queueable chain
        List<Object> deals = params.containsKey('deals')
          ? (List<Object>) params.get('deals')
          : new List<Object>();

        // Create OEMs and competitors inline even for full size
        Integer oemCount = 0;
        Integer compCount = 0;
        if (includeOems) {
          oemCount = insertOems();
        }
        if (includeCompetitors) {
          compCount = insertCompetitors();
        }

        // Enqueue Queueable for bulk deal insertion
        String dealsJson = JSON.serialize(deals);
        Id jobId = System.enqueueJob(
          new MarginArcDemoDataQueueable(dealsJson, 0)
        );

        res.statusCode = 200;
        res.responseBody = Blob.valueOf(
          JSON.serialize(
            new Map<String, Object>{
              'success' => true,
              'message' => 'Demo data load started. Large dataset will be processed in background.',
              'counts' => new Map<String, Object>{
                'oems' => oemCount,
                'competitors' => compCount,
                'accounts' => 0,
                'opportunities' => 0
              },
              'jobId' => jobId
            }
          )
        );
        return;
      }

      // Small or medium size: generate data inline
      Integer oemCount = 0;
      Integer compCount = 0;

      if (includeOems) {
        oemCount = insertOems();
      }
      if (includeCompetitors) {
        compCount = insertCompetitors();
      }

      // Create accounts
      List<Account> accounts = createAccounts(size);
      SObjectAccessDecision acctDecision = Security.stripInaccessible(
        AccessType.CREATABLE,
        accounts
      );
      insert acctDecision.getRecords();
      List<Account> insertedAccounts = (List<Account>) acctDecision.getRecords();

      // Build account map by name
      Map<String, Id> accountMap = new Map<String, Id>();
      for (Account a : insertedAccounts) {
        accountMap.put(a.Name, a.Id);
      }

      // Create opportunities
      List<Opportunity> opps = new List<Opportunity>();
      opps.addAll(createOpenDeals(accountMap, size));
      if (includeHistorical) {
        opps.addAll(createClosedWonDeals(accountMap, size));
        opps.addAll(createClosedLostDeals(accountMap, size));
      }

      SObjectAccessDecision oppDecision = Security.stripInaccessible(
        AccessType.CREATABLE,
        opps
      );
      insert oppDecision.getRecords();
      List<Opportunity> insertedOpps = (List<Opportunity>) oppDecision.getRecords();

      // Create BOM lines for each opportunity
      Integer bomCount = insertBomLines(insertedOpps);

      res.statusCode = 200;
      res.responseBody = Blob.valueOf(
        JSON.serialize(
          new Map<String, Object>{
            'success' => true,
            'message' => 'Demo data created successfully.',
            'counts' => new Map<String, Object>{
              'accounts' => insertedAccounts.size(),
              'opportunities' => insertedOpps.size(),
              'oems' => oemCount,
              'competitors' => compCount,
              'bomLines' => bomCount
            },
            'jobId' => null
          }
        )
      );
    } catch (Exception e) {
      res.statusCode = 500;
      res.responseBody = Blob.valueOf(
        JSON.serialize(
          new Map<String, Object>{
            'success' => false,
            'message' => 'Error creating demo data: ' + e.getMessage()
          }
        )
      );
    }
  }

  // ────────────────────────────────────────────────
  // HTTP GET — Check demo data status
  // ────────────────────────────────────────────────

  @HttpGet
  global static void doGet() {
    RestResponse res = RestContext.response;
    res.addHeader('Content-Type', 'application/json');

    try {
      Integer acctCount = [
        SELECT COUNT()
        FROM Account
        WHERE Name LIKE '%(Demo)%'
      ];
      Integer oppCount = [
        SELECT COUNT()
        FROM Opportunity
        WHERE Account.Name LIKE '%(Demo)%'
      ];
      Integer oemCount = [SELECT COUNT() FROM Fulcrum_OEM__c];
      Integer compCount = [SELECT COUNT() FROM Fulcrum_Competitor__c];

      // Check for any running Queueable jobs
      List<AsyncApexJob> jobs = [
        SELECT Id, Status, JobItemsProcessed, TotalJobItems
        FROM AsyncApexJob
        WHERE
          ApexClass.Name = 'MarginArcDemoDataQueueable'
          AND Status IN ('Queued', 'Preparing', 'Processing')
        ORDER BY CreatedDate DESC
        LIMIT 1
      ];

      String jobStatus = null;
      if (!jobs.isEmpty()) {
        jobStatus = jobs[0].Status;
      }

      res.statusCode = 200;
      res.responseBody = Blob.valueOf(
        JSON.serialize(
          new Map<String, Object>{
            'hasData' => (acctCount > 0 ||
            oemCount > 0 ||
            compCount > 0),
            'counts' => new Map<String, Object>{
              'accounts' => acctCount,
              'opportunities' => oppCount,
              'oems' => oemCount,
              'competitors' => compCount
            },
            'jobStatus' => jobStatus
          }
        )
      );
    } catch (Exception e) {
      res.statusCode = 500;
      res.responseBody = Blob.valueOf(
        JSON.serialize(
          new Map<String, Object>{
            'success' => false,
            'message' => 'Error checking demo data status: ' + e.getMessage()
          }
        )
      );
    }
  }

  // ────────────────────────────────────────────────
  // HTTP DELETE — Remove all demo data
  // ────────────────────────────────────────────────

  @HttpDelete
  global static void doDelete() {
    RestResponse res = RestContext.response;
    res.addHeader('Content-Type', 'application/json');

    try {
      // Delete BOM lines belonging to demo opportunities first
      List<Opportunity> demoOppsForBom = [
        SELECT Id
        FROM Opportunity
        WHERE Account.Name LIKE '%(Demo)%'
      ];
      if (!demoOppsForBom.isEmpty()) {
        Set<Id> oppIds = new Set<Id>();
        for (Opportunity o : demoOppsForBom) {
          oppIds.add(o.Id);
        }
        List<Fulcrum_BOM_Line__c> demoBomLines = [
          SELECT Id
          FROM Fulcrum_BOM_Line__c
          WHERE Opportunity__c IN :oppIds
        ];
        if (!demoBomLines.isEmpty()) {
          delete demoBomLines;
        }
      }

      // Delete demo opportunities (Salesforce blocks Account delete
      // when closed-won Opportunities exist)
      List<Opportunity> demoOpps = [
        SELECT Id
        FROM Opportunity
        WHERE Account.Name LIKE '%(Demo)%'
      ];
      Integer oppCount = demoOpps.size();
      if (!demoOpps.isEmpty()) {
        delete demoOpps;
      }

      // Now delete demo accounts
      List<Account> demoAccounts = [
        SELECT Id
        FROM Account
        WHERE Name LIKE '%(Demo)%'
      ];
      Integer acctCount = demoAccounts.size();
      if (!demoAccounts.isEmpty()) {
        delete demoAccounts;
      }

      // Delete all OEMs
      List<Fulcrum_OEM__c> oems = [SELECT Id FROM Fulcrum_OEM__c];
      Integer oemCount = oems.size();
      if (!oems.isEmpty()) {
        delete oems;
      }

      // Delete all competitors
      List<Fulcrum_Competitor__c> comps = [
        SELECT Id
        FROM Fulcrum_Competitor__c
      ];
      Integer compCount = comps.size();
      if (!comps.isEmpty()) {
        delete comps;
      }

      res.statusCode = 200;
      res.responseBody = Blob.valueOf(
        JSON.serialize(
          new Map<String, Object>{
            'success' => true,
            'message' => 'Demo data removed successfully.',
            'counts' => new Map<String, Object>{
              'accounts' => acctCount,
              'opportunities' => oppCount,
              'oems' => oemCount,
              'competitors' => compCount
            }
          }
        )
      );
    } catch (Exception e) {
      res.statusCode = 500;
      res.responseBody = Blob.valueOf(
        JSON.serialize(
          new Map<String, Object>{
            'success' => false,
            'message' => 'Error removing demo data: ' + e.getMessage()
          }
        )
      );
    }
  }

  // ────────────────────────────────────────────────
  // OEM insertion
  // ────────────────────────────────────────────────

  @TestVisible
  private static Integer insertOems() {
    List<Fulcrum_OEM__c> oems = new List<Fulcrum_OEM__c>{
      newOem('Cisco', 12, 4, 8, 3, 'Networking'),
      newOem('Palo Alto', 14, 5, 10, 2, 'Security'),
      newOem('Dell', 10, 3, 6, 4, 'Compute'),
      newOem('HPE', 11, 4, 7, 3, 'Compute'),
      newOem('Fortinet', 15, 5, 8, 2, 'Security'),
      newOem('Pure Storage', 16, 6, 12, 3, 'Storage'),
      newOem('VMware', 18, 3, 5, 2, 'Software'),
      newOem('NetApp', 14, 5, 9, 3, 'Storage'),
      newOem('Arista', 13, 4, 7, 2, 'Networking'),
      newOem('Microsoft', 20, 2, 4, 1, 'Software')
    };

    SObjectAccessDecision decision = Security.stripInaccessible(
      AccessType.CREATABLE,
      oems
    );
    insert decision.getRecords();
    return decision.getRecords().size();
  }

  private static Fulcrum_OEM__c newOem(
    String name,
    Decimal baseMargin,
    Decimal dealRegBoost,
    Decimal servicesBoost,
    Decimal quarterEndDiscount,
    String category
  ) {
    return new Fulcrum_OEM__c(
      Name = name,
      Base_Margin__c = baseMargin,
      Deal_Reg_Margin_Boost__c = dealRegBoost,
      Services_Margin_Boost__c = servicesBoost,
      Quarter_End_Discount__c = quarterEndDiscount,
      Product_Category__c = category
    );
  }

  // ────────────────────────────────────────────────
  // Competitor insertion
  // ────────────────────────────────────────────────

  @TestVisible
  private static Integer insertCompetitors() {
    // Price_Aggression__c and Services_Capability__c are picklists with values '1'-'5'
    // Margin_Aggression__c is a Number field
    List<Fulcrum_Competitor__c> comps = new List<Fulcrum_Competitor__c>{
      newCompetitor('CDW', 'Scale & Breadth', '4', '3', 0.08, 4),
      newCompetitor('SHI', 'Volume & Licensing', '5', '1', 0.10, 5),
      newCompetitor('Presidio', 'Services & Integration', '3', '5', 0.05, 2),
      newCompetitor('Optiv', 'Security Focus', '3', '5', 0.06, 2),
      newCompetitor('Insight', 'Cloud & Software', '4', '3', 0.07, 4),
      newCompetitor('ePlus', 'Technical Depth', '2', '4', 0.04, 2),
      newCompetitor('Trace3', 'Innovation & Emerging Tech', '2', '3', 0.03, 2),
      newCompetitor('Connection', 'Government & Education', '3', '2', 0.06, 3),
      newCompetitor('Zones', 'SMB & Mid-Market', '4', '1', 0.09, 4),
      newCompetitor('Converge', 'Canadian Market', '3', '3', 0.05, 3)
    };

    SObjectAccessDecision decision = Security.stripInaccessible(
      AccessType.CREATABLE,
      comps
    );
    insert decision.getRecords();
    return decision.getRecords().size();
  }

  private static Fulcrum_Competitor__c newCompetitor(
    String name,
    String primaryStrength,
    String priceAggression,
    String servicesCapability,
    Decimal typicalDiscount,
    Integer marginAggression
  ) {
    return new Fulcrum_Competitor__c(
      Name = name,
      Primary_Strength__c = primaryStrength,
      Price_Aggression__c = priceAggression,
      Services_Capability__c = servicesCapability,
      Typical_Discount__c = typicalDiscount,
      Margin_Aggression__c = marginAggression
    );
  }

  // ────────────────────────────────────────────────
  // Account creation
  // ────────────────────────────────────────────────

  @TestVisible
  private static List<Account> createAccounts(String size) {
    List<Account> accounts = new List<Account>{
      new Account(Name = 'Acme Technologies (Demo)', Industry = 'Technology'),
      new Account(Name = 'Meridian Healthcare (Demo)', Industry = 'Healthcare'),
      new Account(
        Name = 'Pinnacle Financial Group (Demo)',
        Industry = 'Finance'
      ),
      new Account(
        Name = 'Atlas Manufacturing (Demo)',
        Industry = 'Manufacturing'
      ),
      new Account(Name = 'Horizon Energy (Demo)', Industry = 'Energy'),
      new Account(
        Name = 'Velocity Logistics (Demo)',
        Industry = 'Transportation'
      ),
      new Account(Name = 'Crestline Retail (Demo)', Industry = 'Retail'),
      new Account(Name = 'Spectrum Media (Demo)', Industry = 'Communications')
    };

    if (size == 'medium') {
      accounts.addAll(
        new List<Account>{
          new Account(
            Name = 'Nexus Pharmaceuticals (Demo)',
            Industry = 'Healthcare'
          ),
          new Account(Name = 'Ironclad Insurance (Demo)', Industry = 'Finance'),
          new Account(
            Name = 'Brightpath Education (Demo)',
            Industry = 'Education'
          ),
          new Account(
            Name = 'Coastal Shipping (Demo)',
            Industry = 'Transportation'
          ),
          new Account(
            Name = 'Summit Consulting (Demo)',
            Industry = 'Consulting'
          ),
          new Account(
            Name = 'Redwood Technologies (Demo)',
            Industry = 'Technology'
          ),
          new Account(
            Name = 'Granite Construction (Demo)',
            Industry = 'Construction'
          ),
          new Account(
            Name = 'Bluewave Telecom (Demo)',
            Industry = 'Communications'
          ),
          new Account(Name = 'Apex Defense (Demo)', Industry = 'Government'),
          new Account(
            Name = 'Evergreen Agriculture (Demo)',
            Industry = 'Agriculture'
          ),
          new Account(
            Name = 'Pacific Biotech (Demo)',
            Industry = 'Biotechnology'
          ),
          new Account(
            Name = 'Sterling Hospitality (Demo)',
            Industry = 'Hospitality'
          ),
          new Account(
            Name = 'Vanguard Aerospace (Demo)',
            Industry = 'Technology'
          ),
          new Account(
            Name = 'Prairie Utilities (Demo)',
            Industry = 'Utilities'
          ),
          new Account(Name = 'Metro Real Estate (Demo)', Industry = 'Finance'),
          new Account(
            Name = 'Falcon Automotive (Demo)',
            Industry = 'Manufacturing'
          ),
          new Account(
            Name = 'Trident Legal (Demo)',
            Industry = 'Not For Profit'
          )
        }
      );
    }

    return accounts;
  }

  // ────────────────────────────────────────────────
  // Open Opportunity creation
  // ────────────────────────────────────────────────

  @TestVisible
  private static List<Opportunity> createOpenDeals(
    Map<String, Id> acctMap,
    String size
  ) {
    List<Opportunity> opps = new List<Opportunity>();

    // 10 open deals for small
    opps.add(
      buildOpp(
        acctMap,
        'Acme Technologies (Demo)',
        'Cisco Network Refresh',
        475000,
        'Negotiation/Review',
        75,
        Date.today().addDays(35),
        'Cisco',
        'Enterprise',
        'StandardApproved',
        'CDW;SHI',
        'Medium',
        'Strategic',
        true,
        'Networking',
        18,
        475000 * 0.82,
        null,
        null,
        null,
        null
      )
    );

    opps.add(
      buildOpp(
        acctMap,
        'Acme Technologies (Demo)',
        'Palo Alto Firewall Deployment',
        185000,
        'Proposal/Price Quote',
        50,
        Date.today().addDays(55),
        'Palo Alto',
        'MidMarket',
        'PremiumHunting',
        'Presidio;Optiv',
        'High',
        'Good',
        true,
        'Security',
        22,
        185000 * 0.80,
        null,
        null,
        null,
        null
      )
    );

    opps.add(
      buildOpp(
        acctMap,
        'Meridian Healthcare (Demo)',
        'HPE Server Expansion',
        320000,
        'Qualification',
        25,
        Date.today().addDays(75),
        'HPE',
        'Enterprise',
        'NotRegistered',
        'CDW',
        'Low',
        'New',
        false,
        'Compute',
        null,
        null,
        null,
        null,
        null,
        null
      )
    );

    opps.add(
      buildOpp(
        acctMap,
        'Pinnacle Financial Group (Demo)',
        'Dell VxRail HCI Deployment',
        540000,
        'Negotiation/Review',
        75,
        Date.today().addDays(30),
        'Dell',
        'Enterprise',
        'StandardApproved',
        'CDW;Insight',
        'High',
        'Strategic',
        true,
        'Compute',
        15,
        540000 * 0.85,
        null,
        null,
        null,
        null
      )
    );

    opps.add(
      buildOpp(
        acctMap,
        'Atlas Manufacturing (Demo)',
        'Cisco SD-WAN Rollout',
        165000,
        'Proposal/Price Quote',
        50,
        Date.today().addDays(60),
        'Cisco',
        'MidMarket',
        'StandardApproved',
        'Connection;Zones',
        'Medium',
        'Good',
        false,
        'Networking',
        20,
        null,
        null,
        null,
        null,
        null
      )
    );

    opps.add(
      buildOpp(
        acctMap,
        'Horizon Energy (Demo)',
        'Fortinet Security Suite',
        95000,
        'Prospecting',
        10,
        Date.today().addDays(90),
        'Fortinet',
        'SMB',
        'NotRegistered',
        null,
        'Low',
        'New',
        false,
        'Security',
        null,
        null,
        null,
        null,
        null,
        null
      )
    );

    opps.add(
      buildOpp(
        acctMap,
        'Velocity Logistics (Demo)',
        'Pure Storage FlashArray',
        280000,
        'Qualification',
        25,
        Date.today().addDays(65),
        'Pure Storage',
        'MidMarket',
        'PremiumHunting',
        'CDW;ePlus',
        'Medium',
        'Good',
        false,
        'Storage',
        null,
        null,
        null,
        null,
        null,
        null
      )
    );

    opps.add(
      buildOpp(
        acctMap,
        'Crestline Retail (Demo)',
        'Microsoft 365 Migration',
        75000,
        'Proposal/Price Quote',
        50,
        Date.today().addDays(45),
        'Microsoft',
        'SMB',
        'NotRegistered',
        'SHI',
        'Low',
        'New',
        false,
        'Software',
        16,
        75000 * 0.86,
        null,
        null,
        null,
        null
      )
    );

    opps.add(
      buildOpp(
        acctMap,
        'Spectrum Media (Demo)',
        'Arista Data Center Switching',
        410000,
        'Negotiation/Review',
        75,
        Date.today().addDays(40),
        'Arista',
        'Enterprise',
        'Teaming',
        'Presidio',
        'High',
        'Strategic',
        true,
        'Networking',
        21,
        410000 * 0.79,
        null,
        null,
        null,
        null
      )
    );

    opps.add(
      buildOpp(
        acctMap,
        'Acme Technologies (Demo)',
        'VMware Cloud Foundation',
        225000,
        'Qualification',
        25,
        Date.today().addDays(70),
        'VMware',
        'MidMarket',
        'NotRegistered',
        'Trace3;CDW',
        'Medium',
        'Good',
        false,
        'Software',
        null,
        null,
        null,
        null,
        null,
        null
      )
    );

    if (size == 'medium') {
      opps.addAll(createMediumOpenDeals(acctMap));
    }

    return opps;
  }

  private static List<Opportunity> createMediumOpenDeals(
    Map<String, Id> acctMap
  ) {
    List<Opportunity> opps = new List<Opportunity>();

    opps.add(
      buildOpp(
        acctMap,
        'Nexus Pharmaceuticals (Demo)',
        'Cisco Catalyst Campus Network',
        620000,
        'Negotiation/Review',
        75,
        Date.today().addDays(25),
        'Cisco',
        'Enterprise',
        'StandardApproved',
        'CDW;Presidio',
        'High',
        'Strategic',
        true,
        'Networking',
        17,
        620000 * 0.83,
        null,
        null,
        null,
        null
      )
    );

    opps.add(
      buildOpp(
        acctMap,
        'Ironclad Insurance (Demo)',
        'Palo Alto Prisma SASE',
        340000,
        'Proposal/Price Quote',
        50,
        Date.today().addDays(50),
        'Palo Alto',
        'Enterprise',
        'PremiumHunting',
        'Optiv;CDW',
        'High',
        'Good',
        true,
        'Security',
        20,
        340000 * 0.80,
        null,
        null,
        null,
        null
      )
    );

    opps.add(
      buildOpp(
        acctMap,
        'Brightpath Education (Demo)',
        'Dell PowerEdge Servers',
        155000,
        'Qualification',
        25,
        Date.today().addDays(80),
        'Dell',
        'MidMarket',
        'NotRegistered',
        'SHI',
        'Low',
        'New',
        false,
        'Compute',
        null,
        null,
        null,
        null,
        null,
        null
      )
    );

    opps.add(
      buildOpp(
        acctMap,
        'Coastal Shipping (Demo)',
        'HPE Aruba Wireless',
        210000,
        'Proposal/Price Quote',
        50,
        Date.today().addDays(45),
        'HPE',
        'MidMarket',
        'StandardApproved',
        'Connection',
        'Medium',
        'Good',
        false,
        'Networking',
        19,
        210000 * 0.81,
        null,
        null,
        null,
        null
      )
    );

    opps.add(
      buildOpp(
        acctMap,
        'Summit Consulting (Demo)',
        'Fortinet FortiGate NGFW',
        125000,
        'Prospecting',
        10,
        Date.today().addDays(95),
        'Fortinet',
        'SMB',
        'NotRegistered',
        null,
        'Low',
        'New',
        false,
        'Security',
        null,
        null,
        null,
        null,
        null,
        null
      )
    );

    opps.add(
      buildOpp(
        acctMap,
        'Redwood Technologies (Demo)',
        'Pure Storage FlashBlade',
        520000,
        'Negotiation/Review',
        75,
        Date.today().addDays(28),
        'Pure Storage',
        'Enterprise',
        'PremiumHunting',
        'CDW;ePlus',
        'High',
        'Strategic',
        true,
        'Storage',
        19,
        520000 * 0.81,
        null,
        null,
        null,
        null
      )
    );

    opps.add(
      buildOpp(
        acctMap,
        'Granite Construction (Demo)',
        'Microsoft Azure Migration',
        185000,
        'Qualification',
        25,
        Date.today().addDays(70),
        'Microsoft',
        'MidMarket',
        'NotRegistered',
        'Insight;SHI',
        'Medium',
        'Good',
        false,
        'Software',
        null,
        null,
        null,
        null,
        null,
        null
      )
    );

    opps.add(
      buildOpp(
        acctMap,
        'Bluewave Telecom (Demo)',
        'Arista 7280R3 Upgrade',
        890000,
        'Proposal/Price Quote',
        50,
        Date.today().addDays(55),
        'Arista',
        'Enterprise',
        'Teaming',
        'Presidio',
        'High',
        'Strategic',
        true,
        'Networking',
        16,
        890000 * 0.84,
        null,
        null,
        null,
        null
      )
    );

    opps.add(
      buildOpp(
        acctMap,
        'Apex Defense (Demo)',
        'Cisco Secure Firewall',
        275000,
        'Proposal/Price Quote',
        50,
        Date.today().addDays(60),
        'Cisco',
        'Enterprise',
        'StandardApproved',
        'ePlus;Converge',
        'Medium',
        'Good',
        true,
        'Security',
        18,
        275000 * 0.82,
        null,
        null,
        null,
        null
      )
    );

    opps.add(
      buildOpp(
        acctMap,
        'Evergreen Agriculture (Demo)',
        'VMware vSAN Cluster',
        145000,
        'Prospecting',
        10,
        Date.today().addDays(85),
        'VMware',
        'SMB',
        'NotRegistered',
        'Trace3',
        'Low',
        'New',
        false,
        'Software',
        null,
        null,
        null,
        null,
        null,
        null
      )
    );

    opps.add(
      buildOpp(
        acctMap,
        'Pacific Biotech (Demo)',
        'NetApp ONTAP Refresh',
        380000,
        'Negotiation/Review',
        75,
        Date.today().addDays(32),
        'NetApp',
        'Enterprise',
        'StandardApproved',
        'CDW',
        'Medium',
        'Good',
        true,
        'Storage',
        17,
        380000 * 0.83,
        null,
        null,
        null,
        null
      )
    );

    opps.add(
      buildOpp(
        acctMap,
        'Sterling Hospitality (Demo)',
        'Fortinet SD-WAN',
        195000,
        'Qualification',
        25,
        Date.today().addDays(65),
        'Fortinet',
        'MidMarket',
        'StandardApproved',
        'Zones;Connection',
        'Medium',
        'Good',
        false,
        'Networking',
        21,
        null,
        null,
        null,
        null,
        null
      )
    );

    opps.add(
      buildOpp(
        acctMap,
        'Vanguard Aerospace (Demo)',
        'Palo Alto Cortex XDR',
        440000,
        'Proposal/Price Quote',
        50,
        Date.today().addDays(48),
        'Palo Alto',
        'Enterprise',
        'PremiumHunting',
        'Optiv;Presidio',
        'High',
        'Strategic',
        true,
        'Security',
        23,
        440000 * 0.77,
        null,
        null,
        null,
        null
      )
    );

    opps.add(
      buildOpp(
        acctMap,
        'Prairie Utilities (Demo)',
        'HPE ProLiant Servers',
        110000,
        'Prospecting',
        10,
        Date.today().addDays(90),
        'HPE',
        'SMB',
        'NotRegistered',
        null,
        'Low',
        'New',
        false,
        'Compute',
        null,
        null,
        null,
        null,
        null,
        null
      )
    );

    opps.add(
      buildOpp(
        acctMap,
        'Metro Real Estate (Demo)',
        'Dell PowerStore Array',
        310000,
        'Qualification',
        25,
        Date.today().addDays(72),
        'Dell',
        'MidMarket',
        'StandardApproved',
        'CDW;Insight',
        'Medium',
        'Good',
        false,
        'Storage',
        14,
        310000 * 0.86,
        null,
        null,
        null,
        null
      )
    );

    opps.add(
      buildOpp(
        acctMap,
        'Falcon Automotive (Demo)',
        'Cisco Meraki Wireless',
        88000,
        'Proposal/Price Quote',
        50,
        Date.today().addDays(42),
        'Cisco',
        'SMB',
        'NotRegistered',
        'SHI;Zones',
        'Low',
        'New',
        false,
        'Networking',
        15,
        88000 * 0.85,
        null,
        null,
        null,
        null
      )
    );

    opps.add(
      buildOpp(
        acctMap,
        'Trident Legal (Demo)',
        'Microsoft E5 Security',
        65000,
        'Negotiation/Review',
        75,
        Date.today().addDays(20),
        'Microsoft',
        'SMB',
        'NotRegistered',
        'SHI',
        'Low',
        'Good',
        false,
        'Software',
        18,
        65000 * 0.84,
        null,
        null,
        null,
        null
      )
    );

    opps.add(
      buildOpp(
        acctMap,
        'Acme Technologies (Demo)',
        'NetApp StorageGRID Object',
        295000,
        'Proposal/Price Quote',
        50,
        Date.today().addDays(52),
        'NetApp',
        'Enterprise',
        'PremiumHunting',
        'CDW;Trace3',
        'Medium',
        'Strategic',
        true,
        'Storage',
        18,
        295000 * 0.82,
        null,
        null,
        null,
        null
      )
    );

    opps.add(
      buildOpp(
        acctMap,
        'Meridian Healthcare (Demo)',
        'Fortinet FortiManager',
        175000,
        'Qualification',
        25,
        Date.today().addDays(68),
        'Fortinet',
        'MidMarket',
        'StandardApproved',
        'Optiv',
        'Medium',
        'Good',
        true,
        'Security',
        22,
        175000 * 0.78,
        null,
        null,
        null,
        null
      )
    );

    opps.add(
      buildOpp(
        acctMap,
        'Pinnacle Financial Group (Demo)',
        'Pure Storage Portworx',
        260000,
        'Negotiation/Review',
        75,
        Date.today().addDays(22),
        'Pure Storage',
        'Enterprise',
        'StandardApproved',
        'ePlus',
        'High',
        'Strategic',
        true,
        'Storage',
        20,
        260000 * 0.80,
        null,
        null,
        null,
        null
      )
    );

    return opps;
  }

  // ────────────────────────────────────────────────
  // Closed Won Opportunity creation
  // ────────────────────────────────────────────────

  @TestVisible
  private static List<Opportunity> createClosedWonDeals(
    Map<String, Id> acctMap,
    String size
  ) {
    List<Opportunity> opps = new List<Opportunity>();

    // 12 closed won deals for small
    opps.add(
      buildOpp(
        acctMap,
        'Acme Technologies (Demo)',
        'Cisco Campus Upgrade',
        350000,
        'Closed Won',
        100,
        Date.today().addMonths(-1),
        'Cisco',
        'Enterprise',
        'StandardApproved',
        'CDW;SHI',
        'Medium',
        'Strategic',
        true,
        'Networking',
        18,
        350000 * 0.81,
        19,
        85,
        72,
        null
      )
    );

    opps.add(
      buildOpp(
        acctMap,
        'Meridian Healthcare (Demo)',
        'Palo Alto NGFW Deployment',
        180000,
        'Closed Won',
        100,
        Date.today().addMonths(-2),
        'Palo Alto',
        'MidMarket',
        'PremiumHunting',
        'Optiv',
        'High',
        'Good',
        true,
        'Security',
        22,
        180000 * 0.78,
        24,
        88,
        68,
        null
      )
    );

    opps.add(
      buildOpp(
        acctMap,
        'Pinnacle Financial Group (Demo)',
        'Dell PowerEdge Server Farm',
        290000,
        'Closed Won',
        100,
        Date.today().addMonths(-3),
        'Dell',
        'Enterprise',
        'NotRegistered',
        'CDW',
        'Medium',
        'Good',
        false,
        'Compute',
        14,
        290000 * 0.85,
        15,
        78,
        60,
        null
      )
    );

    opps.add(
      buildOpp(
        acctMap,
        'Atlas Manufacturing (Demo)',
        'HPE Nimble Storage Expansion',
        210000,
        'Closed Won',
        100,
        Date.today().addMonths(-4),
        'HPE',
        'MidMarket',
        'StandardApproved',
        'ePlus;Connection',
        'Medium',
        'Good',
        true,
        'Storage',
        16,
        210000 * 0.83,
        17,
        82,
        65,
        null
      )
    );

    opps.add(
      buildOpp(
        acctMap,
        'Horizon Energy (Demo)',
        'Fortinet UTM Deployment',
        85000,
        'Closed Won',
        100,
        Date.today().addMonths(-5),
        'Fortinet',
        'SMB',
        'NotRegistered',
        'Zones',
        'Low',
        'New',
        false,
        'Security',
        20,
        85000 * 0.80,
        22,
        75,
        58,
        null
      )
    );

    opps.add(
      buildOpp(
        acctMap,
        'Velocity Logistics (Demo)',
        'Cisco Meraki SD-WAN',
        125000,
        'Closed Won',
        100,
        Date.today().addMonths(-6),
        'Cisco',
        'MidMarket',
        'StandardApproved',
        'SHI',
        'Medium',
        'Good',
        true,
        'Networking',
        19,
        125000 * 0.82,
        20,
        80,
        70,
        null
      )
    );

    opps.add(
      buildOpp(
        acctMap,
        'Crestline Retail (Demo)',
        'NetApp AFF All-Flash Array',
        195000,
        'Closed Won',
        100,
        Date.today().addMonths(-7),
        'NetApp',
        'MidMarket',
        'PremiumHunting',
        'CDW;Trace3',
        'Medium',
        'Good',
        false,
        'Storage',
        17,
        195000 * 0.82,
        18,
        79,
        62,
        null
      )
    );

    opps.add(
      buildOpp(
        acctMap,
        'Spectrum Media (Demo)',
        'Arista Spine-Leaf Architecture',
        380000,
        'Closed Won',
        100,
        Date.today().addMonths(-8),
        'Arista',
        'Enterprise',
        'Teaming',
        'Presidio',
        'High',
        'Strategic',
        true,
        'Networking',
        20,
        380000 * 0.79,
        21,
        86,
        74,
        null
      )
    );

    opps.add(
      buildOpp(
        acctMap,
        'Acme Technologies (Demo)',
        'Pure Storage FlashBlade',
        425000,
        'Closed Won',
        100,
        Date.today().addMonths(-9),
        'Pure Storage',
        'Enterprise',
        'StandardApproved',
        'CDW;ePlus',
        'High',
        'Strategic',
        true,
        'Storage',
        18,
        425000 * 0.81,
        19,
        84,
        71,
        null
      )
    );

    opps.add(
      buildOpp(
        acctMap,
        'Pinnacle Financial Group (Demo)',
        'VMware vSphere Licensing',
        155000,
        'Closed Won',
        100,
        Date.today().addMonths(-10),
        'VMware',
        'MidMarket',
        'NotRegistered',
        'Insight',
        'Low',
        'Good',
        false,
        'Software',
        24,
        155000 * 0.78,
        26,
        90,
        66,
        null
      )
    );

    opps.add(
      buildOpp(
        acctMap,
        'Meridian Healthcare (Demo)',
        'Microsoft Azure Stack HCI',
        275000,
        'Closed Won',
        100,
        Date.today().addMonths(-11),
        'Microsoft',
        'Enterprise',
        'StandardApproved',
        'SHI;CDW',
        'High',
        'Good',
        true,
        'Software',
        15,
        275000 * 0.84,
        16,
        77,
        63,
        null
      )
    );

    opps.add(
      buildOpp(
        acctMap,
        'Atlas Manufacturing (Demo)',
        'Cisco ISE Network Access Control',
        145000,
        'Closed Won',
        100,
        Date.today().addMonths(-12),
        'Cisco',
        'MidMarket',
        'PremiumHunting',
        'Converge',
        'High',
        'Good',
        true,
        'Security',
        21,
        145000 * 0.79,
        23,
        87,
        69,
        null
      )
    );

    if (size == 'medium') {
      opps.addAll(createMediumClosedWonDeals(acctMap));
    }

    return opps;
  }

  private static List<Opportunity> createMediumClosedWonDeals(
    Map<String, Id> acctMap
  ) {
    List<Opportunity> opps = new List<Opportunity>();

    opps.add(
      buildOpp(
        acctMap,
        'Nexus Pharmaceuticals (Demo)',
        'Cisco DNA Center',
        520000,
        'Closed Won',
        100,
        Date.today().addMonths(-1),
        'Cisco',
        'Enterprise',
        'PremiumHunting',
        'CDW;Presidio',
        'High',
        'Strategic',
        true,
        'Networking',
        17,
        520000 * 0.83,
        19,
        86,
        73,
        null
      )
    );

    opps.add(
      buildOpp(
        acctMap,
        'Ironclad Insurance (Demo)',
        'Palo Alto XSIAM Platform',
        680000,
        'Closed Won',
        100,
        Date.today().addMonths(-2),
        'Palo Alto',
        'Enterprise',
        'PremiumHunting',
        'Optiv;CDW',
        'High',
        'Strategic',
        true,
        'Security',
        21,
        680000 * 0.79,
        23,
        89,
        75,
        null
      )
    );

    opps.add(
      buildOpp(
        acctMap,
        'Brightpath Education (Demo)',
        'Dell Latitude Fleet',
        92000,
        'Closed Won',
        100,
        Date.today().addMonths(-3),
        'Dell',
        'SMB',
        'NotRegistered',
        'SHI;Connection',
        'Low',
        'Good',
        false,
        'Compute',
        12,
        92000 * 0.88,
        14,
        72,
        55,
        null
      )
    );

    opps.add(
      buildOpp(
        acctMap,
        'Coastal Shipping (Demo)',
        'HPE SimpliVity HCI',
        330000,
        'Closed Won',
        100,
        Date.today().addMonths(-3),
        'HPE',
        'MidMarket',
        'StandardApproved',
        'CDW',
        'Medium',
        'Good',
        true,
        'Compute',
        16,
        330000 * 0.84,
        17,
        80,
        64,
        null
      )
    );

    opps.add(
      buildOpp(
        acctMap,
        'Summit Consulting (Demo)',
        'Fortinet FortiSASE',
        155000,
        'Closed Won',
        100,
        Date.today().addMonths(-4),
        'Fortinet',
        'MidMarket',
        'StandardApproved',
        'Zones',
        'Medium',
        'Good',
        false,
        'Security',
        20,
        155000 * 0.80,
        22,
        83,
        67,
        null
      )
    );

    opps.add(
      buildOpp(
        acctMap,
        'Redwood Technologies (Demo)',
        'Pure Storage Portworx',
        410000,
        'Closed Won',
        100,
        Date.today().addMonths(-4),
        'Pure Storage',
        'Enterprise',
        'PremiumHunting',
        'ePlus;CDW',
        'High',
        'Strategic',
        true,
        'Storage',
        18,
        410000 * 0.82,
        20,
        85,
        72,
        null
      )
    );

    opps.add(
      buildOpp(
        acctMap,
        'Granite Construction (Demo)',
        'Microsoft Teams Phone',
        78000,
        'Closed Won',
        100,
        Date.today().addMonths(-5),
        'Microsoft',
        'SMB',
        'NotRegistered',
        'SHI',
        'Low',
        'New',
        false,
        'Software',
        14,
        78000 * 0.86,
        16,
        74,
        56,
        null
      )
    );

    opps.add(
      buildOpp(
        acctMap,
        'Bluewave Telecom (Demo)',
        'Arista 7050X4 Spine',
        1250000,
        'Closed Won',
        100,
        Date.today().addMonths(-5),
        'Arista',
        'Enterprise',
        'Teaming',
        'Presidio',
        'High',
        'Strategic',
        true,
        'Networking',
        15,
        1250000 * 0.85,
        17,
        82,
        70,
        null
      )
    );

    opps.add(
      buildOpp(
        acctMap,
        'Apex Defense (Demo)',
        'Cisco Secure Endpoint',
        190000,
        'Closed Won',
        100,
        Date.today().addMonths(-6),
        'Cisco',
        'Enterprise',
        'StandardApproved',
        'ePlus',
        'Medium',
        'Good',
        true,
        'Security',
        19,
        190000 * 0.81,
        21,
        84,
        68,
        null
      )
    );

    opps.add(
      buildOpp(
        acctMap,
        'Evergreen Agriculture (Demo)',
        'VMware Horizon VDI',
        115000,
        'Closed Won',
        100,
        Date.today().addMonths(-7),
        'VMware',
        'SMB',
        'NotRegistered',
        'Trace3',
        'Medium',
        'Good',
        false,
        'Software',
        22,
        115000 * 0.78,
        25,
        88,
        64,
        null
      )
    );

    opps.add(
      buildOpp(
        acctMap,
        'Pacific Biotech (Demo)',
        'NetApp Cloud Volumes',
        445000,
        'Closed Won',
        100,
        Date.today().addMonths(-7),
        'NetApp',
        'Enterprise',
        'StandardApproved',
        'CDW',
        'Medium',
        'Strategic',
        true,
        'Storage',
        17,
        445000 * 0.83,
        18,
        81,
        69,
        null
      )
    );

    opps.add(
      buildOpp(
        acctMap,
        'Sterling Hospitality (Demo)',
        'Fortinet FortiAP Wireless',
        68000,
        'Closed Won',
        100,
        Date.today().addMonths(-8),
        'Fortinet',
        'SMB',
        'NotRegistered',
        'Zones;Connection',
        'Low',
        'New',
        false,
        'Networking',
        23,
        68000 * 0.77,
        25,
        76,
        57,
        null
      )
    );

    opps.add(
      buildOpp(
        acctMap,
        'Vanguard Aerospace (Demo)',
        'Palo Alto Strata NGFW',
        560000,
        'Closed Won',
        100,
        Date.today().addMonths(-8),
        'Palo Alto',
        'Enterprise',
        'PremiumHunting',
        'Optiv;Presidio',
        'High',
        'Strategic',
        true,
        'Security',
        22,
        560000 * 0.78,
        24,
        91,
        76,
        null
      )
    );

    opps.add(
      buildOpp(
        acctMap,
        'Prairie Utilities (Demo)',
        'HPE ProLiant DL380',
        140000,
        'Closed Won',
        100,
        Date.today().addMonths(-9),
        'HPE',
        'MidMarket',
        'StandardApproved',
        'CDW',
        'Low',
        'Good',
        false,
        'Compute',
        15,
        140000 * 0.85,
        16,
        78,
        61,
        null
      )
    );

    opps.add(
      buildOpp(
        acctMap,
        'Metro Real Estate (Demo)',
        'Dell EMC Unity XT',
        265000,
        'Closed Won',
        100,
        Date.today().addMonths(-9),
        'Dell',
        'MidMarket',
        'StandardApproved',
        'CDW;Insight',
        'Medium',
        'Good',
        true,
        'Storage',
        14,
        265000 * 0.86,
        16,
        79,
        63,
        null
      )
    );

    opps.add(
      buildOpp(
        acctMap,
        'Falcon Automotive (Demo)',
        'Cisco Catalyst 9K',
        175000,
        'Closed Won',
        100,
        Date.today().addMonths(-10),
        'Cisco',
        'MidMarket',
        'StandardApproved',
        'SHI',
        'Medium',
        'Good',
        true,
        'Networking',
        18,
        175000 * 0.82,
        20,
        83,
        67,
        null
      )
    );

    opps.add(
      buildOpp(
        acctMap,
        'Trident Legal (Demo)',
        'Microsoft 365 E5',
        52000,
        'Closed Won',
        100,
        Date.today().addMonths(-10),
        'Microsoft',
        'SMB',
        'NotRegistered',
        'SHI',
        'Low',
        'Good',
        false,
        'Software',
        16,
        52000 * 0.84,
        18,
        75,
        58,
        null
      )
    );

    opps.add(
      buildOpp(
        acctMap,
        'Nexus Pharmaceuticals (Demo)',
        'Pure Storage FlashArray//C',
        310000,
        'Closed Won',
        100,
        Date.today().addMonths(-11),
        'Pure Storage',
        'Enterprise',
        'StandardApproved',
        'CDW;ePlus',
        'Medium',
        'Strategic',
        true,
        'Storage',
        17,
        310000 * 0.83,
        19,
        83,
        70,
        null
      )
    );

    opps.add(
      buildOpp(
        acctMap,
        'Ironclad Insurance (Demo)',
        'Arista 7280R Router',
        490000,
        'Closed Won',
        100,
        Date.today().addMonths(-11),
        'Arista',
        'Enterprise',
        'Teaming',
        'Presidio',
        'High',
        'Strategic',
        true,
        'Networking',
        16,
        490000 * 0.84,
        18,
        84,
        71,
        null
      )
    );

    opps.add(
      buildOpp(
        acctMap,
        'Brightpath Education (Demo)',
        'VMware Workspace ONE',
        95000,
        'Closed Won',
        100,
        Date.today().addMonths(-12),
        'VMware',
        'SMB',
        'NotRegistered',
        'Insight',
        'Low',
        'Good',
        false,
        'Software',
        21,
        95000 * 0.79,
        24,
        87,
        63,
        null
      )
    );

    opps.add(
      buildOpp(
        acctMap,
        'Coastal Shipping (Demo)',
        'NetApp FAS Expansion',
        230000,
        'Closed Won',
        100,
        Date.today().addMonths(-12),
        'NetApp',
        'MidMarket',
        'StandardApproved',
        'CDW',
        'Medium',
        'Good',
        true,
        'Storage',
        16,
        230000 * 0.84,
        18,
        80,
        65,
        null
      )
    );

    opps.add(
      buildOpp(
        acctMap,
        'Redwood Technologies (Demo)',
        'Cisco ThousandEyes',
        135000,
        'Closed Won',
        100,
        Date.today().addMonths(-2),
        'Cisco',
        'Enterprise',
        'StandardApproved',
        'CDW',
        'Medium',
        'Strategic',
        true,
        'Software',
        20,
        135000 * 0.80,
        22,
        85,
        72,
        null
      )
    );

    opps.add(
      buildOpp(
        acctMap,
        'Apex Defense (Demo)',
        'Fortinet FortiGate 600F',
        225000,
        'Closed Won',
        100,
        Date.today().addMonths(-6),
        'Fortinet',
        'Enterprise',
        'StandardApproved',
        'ePlus;Converge',
        'Medium',
        'Good',
        true,
        'Security',
        19,
        225000 * 0.81,
        21,
        82,
        66,
        null
      )
    );

    opps.add(
      buildOpp(
        acctMap,
        'Pacific Biotech (Demo)',
        'HPE GreenLake',
        580000,
        'Closed Won',
        100,
        Date.today().addMonths(-3),
        'HPE',
        'Enterprise',
        'PremiumHunting',
        'CDW;Insight',
        'High',
        'Strategic',
        true,
        'Compute',
        14,
        580000 * 0.86,
        16,
        79,
        64,
        null
      )
    );

    return opps;
  }

  // ────────────────────────────────────────────────
  // Closed Lost Opportunity creation
  // ────────────────────────────────────────────────

  @TestVisible
  private static List<Opportunity> createClosedLostDeals(
    Map<String, Id> acctMap,
    String size
  ) {
    List<Opportunity> opps = new List<Opportunity>();

    // 8 closed lost deals for small
    opps.add(
      buildOpp(
        acctMap,
        'Acme Technologies (Demo)',
        'Dell Storage Refresh',
        200000,
        'Closed Lost',
        0,
        Date.today().addMonths(-2),
        'Dell',
        'Enterprise',
        'StandardApproved',
        'CDW',
        'Medium',
        'Good',
        false,
        'Storage',
        null,
        null,
        null,
        null,
        null,
        'Price'
      )
    );

    opps.add(
      buildOpp(
        acctMap,
        'Meridian Healthcare (Demo)',
        'Cisco Catalyst Switching',
        310000,
        'Closed Lost',
        0,
        Date.today().addMonths(-3),
        'Cisco',
        'Enterprise',
        'StandardApproved',
        'Presidio;CDW',
        'High',
        'New',
        false,
        'Networking',
        null,
        null,
        null,
        null,
        null,
        'Technical'
      )
    );

    opps.add(
      buildOpp(
        acctMap,
        'Pinnacle Financial Group (Demo)',
        'Palo Alto Prisma Cloud',
        175000,
        'Closed Lost',
        0,
        Date.today().addMonths(-5),
        'Palo Alto',
        'MidMarket',
        'NotRegistered',
        'Optiv',
        'Medium',
        'Good',
        false,
        'Security',
        null,
        null,
        null,
        null,
        null,
        'Budget'
      )
    );

    opps.add(
      buildOpp(
        acctMap,
        'Atlas Manufacturing (Demo)',
        'HPE Synergy Composable',
        450000,
        'Closed Lost',
        0,
        Date.today().addMonths(-4),
        'HPE',
        'Enterprise',
        'StandardApproved',
        'SHI;ePlus',
        'High',
        'Good',
        false,
        'Compute',
        null,
        null,
        null,
        null,
        null,
        'Price'
      )
    );

    opps.add(
      buildOpp(
        acctMap,
        'Horizon Energy (Demo)',
        'Fortinet FortiGate Upgrade',
        110000,
        'Closed Lost',
        0,
        Date.today().addMonths(-6),
        'Fortinet',
        'SMB',
        'NotRegistered',
        'Zones',
        'Low',
        'New',
        false,
        'Security',
        null,
        null,
        null,
        null,
        null,
        'Relationship'
      )
    );

    opps.add(
      buildOpp(
        acctMap,
        'Velocity Logistics (Demo)',
        'Pure Storage FlashArray Expansion',
        240000,
        'Closed Lost',
        0,
        Date.today().addMonths(-7),
        'Pure Storage',
        'MidMarket',
        'PremiumHunting',
        'CDW;Trace3',
        'Medium',
        'Good',
        false,
        'Storage',
        null,
        null,
        null,
        null,
        null,
        'Price'
      )
    );

    opps.add(
      buildOpp(
        acctMap,
        'Crestline Retail (Demo)',
        'Arista Campus Switching',
        130000,
        'Closed Lost',
        0,
        Date.today().addMonths(-9),
        'Arista',
        'MidMarket',
        'NotRegistered',
        'Connection',
        'Low',
        'New',
        false,
        'Networking',
        null,
        null,
        null,
        null,
        null,
        'Price'
      )
    );

    opps.add(
      buildOpp(
        acctMap,
        'Spectrum Media (Demo)',
        'Dell VxRail Refresh',
        350000,
        'Closed Lost',
        0,
        Date.today().addMonths(-10),
        'Dell',
        'Enterprise',
        'StandardApproved',
        'Insight;CDW',
        'High',
        'Good',
        false,
        'Compute',
        null,
        null,
        null,
        null,
        null,
        'Technical'
      )
    );

    if (size == 'medium') {
      opps.addAll(createMediumClosedLostDeals(acctMap));
    }

    return opps;
  }

  private static List<Opportunity> createMediumClosedLostDeals(
    Map<String, Id> acctMap
  ) {
    List<Opportunity> opps = new List<Opportunity>();

    opps.add(
      buildOpp(
        acctMap,
        'Nexus Pharmaceuticals (Demo)',
        'VMware NSX Microsegmentation',
        420000,
        'Closed Lost',
        0,
        Date.today().addMonths(-2),
        'VMware',
        'Enterprise',
        'NotRegistered',
        'Trace3;CDW',
        'High',
        'Good',
        false,
        'Software',
        null,
        null,
        null,
        null,
        null,
        'Technical'
      )
    );

    opps.add(
      buildOpp(
        acctMap,
        'Ironclad Insurance (Demo)',
        'NetApp AFF A400',
        290000,
        'Closed Lost',
        0,
        Date.today().addMonths(-3),
        'NetApp',
        'Enterprise',
        'StandardApproved',
        'CDW',
        'Medium',
        'Good',
        false,
        'Storage',
        null,
        null,
        null,
        null,
        null,
        'Price'
      )
    );

    opps.add(
      buildOpp(
        acctMap,
        'Brightpath Education (Demo)',
        'Cisco Webex Suite',
        55000,
        'Closed Lost',
        0,
        Date.today().addMonths(-4),
        'Cisco',
        'SMB',
        'NotRegistered',
        'SHI;Connection',
        'Low',
        'New',
        false,
        'Software',
        null,
        null,
        null,
        null,
        null,
        'Budget'
      )
    );

    opps.add(
      buildOpp(
        acctMap,
        'Coastal Shipping (Demo)',
        'Palo Alto VM-Series',
        165000,
        'Closed Lost',
        0,
        Date.today().addMonths(-5),
        'Palo Alto',
        'MidMarket',
        'NotRegistered',
        'Optiv',
        'Medium',
        'Good',
        false,
        'Security',
        null,
        null,
        null,
        null,
        null,
        'Relationship'
      )
    );

    opps.add(
      buildOpp(
        acctMap,
        'Summit Consulting (Demo)',
        'Dell PowerEdge R760',
        125000,
        'Closed Lost',
        0,
        Date.today().addMonths(-5),
        'Dell',
        'MidMarket',
        'NotRegistered',
        'CDW;SHI',
        'Low',
        'New',
        false,
        'Compute',
        null,
        null,
        null,
        null,
        null,
        'Price'
      )
    );

    opps.add(
      buildOpp(
        acctMap,
        'Redwood Technologies (Demo)',
        'HPE Alletra 6000',
        380000,
        'Closed Lost',
        0,
        Date.today().addMonths(-6),
        'HPE',
        'Enterprise',
        'StandardApproved',
        'CDW;ePlus',
        'High',
        'Good',
        false,
        'Storage',
        null,
        null,
        null,
        null,
        null,
        'Technical'
      )
    );

    opps.add(
      buildOpp(
        acctMap,
        'Granite Construction (Demo)',
        'Fortinet FortiSwitch',
        72000,
        'Closed Lost',
        0,
        Date.today().addMonths(-7),
        'Fortinet',
        'SMB',
        'NotRegistered',
        'Zones',
        'Low',
        'New',
        false,
        'Networking',
        null,
        null,
        null,
        null,
        null,
        'Budget'
      )
    );

    opps.add(
      buildOpp(
        acctMap,
        'Bluewave Telecom (Demo)',
        'Pure Storage FlashArray//X',
        550000,
        'Closed Lost',
        0,
        Date.today().addMonths(-8),
        'Pure Storage',
        'Enterprise',
        'PremiumHunting',
        'CDW;ePlus',
        'High',
        'Strategic',
        false,
        'Storage',
        null,
        null,
        null,
        null,
        null,
        'Price'
      )
    );

    opps.add(
      buildOpp(
        acctMap,
        'Apex Defense (Demo)',
        'Arista 7500R3 Series',
        780000,
        'Closed Lost',
        0,
        Date.today().addMonths(-8),
        'Arista',
        'Enterprise',
        'Teaming',
        'Presidio',
        'High',
        'Good',
        false,
        'Networking',
        null,
        null,
        null,
        null,
        null,
        'Relationship'
      )
    );

    opps.add(
      buildOpp(
        acctMap,
        'Evergreen Agriculture (Demo)',
        'Microsoft Intune',
        48000,
        'Closed Lost',
        0,
        Date.today().addMonths(-9),
        'Microsoft',
        'SMB',
        'NotRegistered',
        'SHI',
        'Low',
        'New',
        false,
        'Software',
        null,
        null,
        null,
        null,
        null,
        'Budget'
      )
    );

    opps.add(
      buildOpp(
        acctMap,
        'Pacific Biotech (Demo)',
        'Cisco Catalyst 9400',
        420000,
        'Closed Lost',
        0,
        Date.today().addMonths(-10),
        'Cisco',
        'Enterprise',
        'StandardApproved',
        'CDW;Presidio',
        'High',
        'Good',
        false,
        'Networking',
        null,
        null,
        null,
        null,
        null,
        'Price'
      )
    );

    opps.add(
      buildOpp(
        acctMap,
        'Sterling Hospitality (Demo)',
        'Dell PowerStore 1200',
        185000,
        'Closed Lost',
        0,
        Date.today().addMonths(-10),
        'Dell',
        'MidMarket',
        'NotRegistered',
        'Insight;CDW',
        'Medium',
        'New',
        false,
        'Storage',
        null,
        null,
        null,
        null,
        null,
        'Technical'
      )
    );

    opps.add(
      buildOpp(
        acctMap,
        'Vanguard Aerospace (Demo)',
        'NetApp ONTAP Select',
        310000,
        'Closed Lost',
        0,
        Date.today().addMonths(-11),
        'NetApp',
        'Enterprise',
        'StandardApproved',
        'CDW',
        'Medium',
        'Good',
        false,
        'Storage',
        null,
        null,
        null,
        null,
        null,
        'Price'
      )
    );

    opps.add(
      buildOpp(
        acctMap,
        'Prairie Utilities (Demo)',
        'VMware Cloud Foundation',
        195000,
        'Closed Lost',
        0,
        Date.today().addMonths(-11),
        'VMware',
        'MidMarket',
        'NotRegistered',
        'Trace3;Insight',
        'Medium',
        'Good',
        false,
        'Software',
        null,
        null,
        null,
        null,
        null,
        'Relationship'
      )
    );

    opps.add(
      buildOpp(
        acctMap,
        'Metro Real Estate (Demo)',
        'Fortinet FortiNAC',
        88000,
        'Closed Lost',
        0,
        Date.today().addMonths(-12),
        'Fortinet',
        'SMB',
        'NotRegistered',
        'Zones;Connection',
        'Low',
        'New',
        false,
        'Security',
        null,
        null,
        null,
        null,
        null,
        'Price'
      )
    );

    opps.add(
      buildOpp(
        acctMap,
        'Falcon Automotive (Demo)',
        'HPE ProLiant DL360',
        105000,
        'Closed Lost',
        0,
        Date.today().addMonths(-12),
        'HPE',
        'MidMarket',
        'NotRegistered',
        'SHI;CDW',
        'Low',
        'New',
        false,
        'Compute',
        null,
        null,
        null,
        null,
        null,
        'Budget'
      )
    );

    return opps;
  }

  // ────────────────────────────────────────────────
  // Opportunity builder helper
  // ────────────────────────────────────────────────

  @TestVisible
  private static Opportunity buildOpp(
    Map<String, Id> acctMap,
    String accountName,
    String dealName,
    Decimal amount,
    String stage,
    Integer probability,
    Date closeDate,
    String oem,
    String segment,
    String dealRegType,
    String competitors,
    String complexity,
    String relationship,
    Boolean servicesAttached,
    String productCategory,
    Decimal plannedMargin,
    Decimal oemCost,
    Decimal recommendedMargin,
    Decimal aiConfidence,
    Decimal winProbability,
    String lossReason
  ) {
    Opportunity opp = new Opportunity();
    opp.AccountId = acctMap.get(accountName);
    opp.Name = accountName.replace(' (Demo)', '') + ' - ' + dealName;
    opp.Amount = amount;
    opp.StageName = stage;
    opp.Probability = probability;
    opp.CloseDate = closeDate;

    // MarginArc custom fields
    opp.Fulcrum_OEM__c = oem;
    opp.Fulcrum_Customer_Segment__c = segment;
    opp.Fulcrum_Deal_Reg_Type__c = dealRegType;
    opp.Fulcrum_Competitor_Names__c = competitors;
    opp.Fulcrum_Solution_Complexity__c = complexity;
    opp.Fulcrum_Relationship_Strength__c = relationship;
    opp.Fulcrum_Services_Attached__c = servicesAttached;
    opp.Fulcrum_Product_Category__c = productCategory;

    if (plannedMargin != null) {
      opp.Fulcrum_Planned_Margin__c = plannedMargin;
    }
    if (oemCost != null) {
      opp.Fulcrum_OEM_Cost__c = oemCost;
    }
    if (recommendedMargin != null) {
      opp.Fulcrum_Recommended_Margin__c = recommendedMargin;
    }
    if (aiConfidence != null) {
      opp.Fulcrum_AI_Confidence__c = aiConfidence;
    }
    if (winProbability != null) {
      opp.Fulcrum_Win_Probability__c = winProbability;
    }
    if (String.isNotBlank(lossReason)) {
      opp.Fulcrum_Loss_Reason__c = lossReason;
    }

    return opp;
  }

  // ────────────────────────────────────────────────
  // BOM Line creation
  // ────────────────────────────────────────────────

  /**
   * Inner class representing a BOM line template for demo data generation.
   */
  public class BomTemplate {
    public String productNumber;
    public String description;
    public String category;
    public String unit;
    public Decimal costPctOfTotal; // fraction of OEM cost this line represents
    public Decimal marginPctLow; // low end of margin range (whole number, e.g. 12)
    public Decimal marginPctHigh; // high end of margin range (whole number, e.g. 18)

    public BomTemplate(
      String productNumber,
      String description,
      String category,
      String unit,
      Decimal costPctOfTotal,
      Decimal marginPctLow,
      Decimal marginPctHigh
    ) {
      this.productNumber = productNumber;
      this.description = description;
      this.category = category;
      this.unit = unit;
      this.costPctOfTotal = costPctOfTotal;
      this.marginPctLow = marginPctLow;
      this.marginPctHigh = marginPctHigh;
    }
  }

  /**
   * Returns BOM templates keyed by OEM name. Each OEM has 4 line items
   * with realistic product numbers, categories, and cost allocation.
   */
  @TestVisible
  private static Map<String, List<BomTemplate>> getBomTemplates() {
    Map<String, List<BomTemplate>> templates = new Map<String, List<BomTemplate>>();

    templates.put(
      'Cisco',
      new List<BomTemplate>{
        new BomTemplate(
          'C9300-48P-A',
          'Catalyst 9300 48-Port PoE+',
          'Hardware',
          'ea',
          0.43,
          12,
          18
        ),
        new BomTemplate(
          'C9300-DNA-E',
          'DNA Essentials License',
          'Software',
          'ea',
          0.17,
          20,
          30
        ),
        new BomTemplate(
          'CON-SNT-C93004P',
          'Cisco SmartNet 8x5xNBD',
          'Support',
          'yr',
          0.15,
          25,
          35
        ),
        new BomTemplate(
          'SVC-IMPL-CISCO',
          'Implementation Services',
          'Services',
          'hr',
          0.25,
          30,
          45
        )
      }
    );

    templates.put(
      'Palo Alto',
      new List<BomTemplate>{
        new BomTemplate(
          'PA-450',
          'PA-450 Next-Gen Firewall',
          'Hardware',
          'ea',
          0.42,
          14,
          18
        ),
        new BomTemplate(
          'PAN-PA-450-TP',
          'PAN-OS Threat Prevention License',
          'Software',
          'ea',
          0.18,
          22,
          30
        ),
        new BomTemplate(
          'PAN-SVC-PREM-450',
          'Premium Support Subscription',
          'Support',
          'yr',
          0.15,
          25,
          35
        ),
        new BomTemplate(
          'SVC-DEPLOY-PA',
          'Deployment Services',
          'Services',
          'hr',
          0.25,
          32,
          45
        )
      }
    );

    templates.put(
      'HPE',
      new List<BomTemplate>{
        new BomTemplate(
          'P56959-B21',
          'ProLiant DL380 Gen10 Plus',
          'Hardware',
          'ea',
          0.44,
          12,
          16
        ),
        new BomTemplate(
          'BD505A',
          'iLO Advanced License',
          'Software',
          'ea',
          0.16,
          22,
          28
        ),
        new BomTemplate(
          'H28K5E',
          'HPE Pointnext 24x7 4hr',
          'Support',
          'yr',
          0.15,
          26,
          34
        ),
        new BomTemplate(
          'SVC-MIG-HPE',
          'Migration Services',
          'Services',
          'hr',
          0.25,
          30,
          42
        )
      }
    );

    templates.put(
      'Dell',
      new List<BomTemplate>{
        new BomTemplate(
          'PE-R750XS',
          'PowerEdge R750xs Server',
          'Hardware',
          'ea',
          0.43,
          12,
          17
        ),
        new BomTemplate(
          'OME-ADV',
          'OpenManage Enterprise Advanced',
          'Software',
          'ea',
          0.17,
          20,
          28
        ),
        new BomTemplate(
          'PS-PLUS-R750',
          'ProSupport Plus 24x7',
          'Support',
          'yr',
          0.15,
          25,
          33
        ),
        new BomTemplate(
          'SVC-DEPLOY-DELL',
          'Deployment Services',
          'Services',
          'hr',
          0.25,
          32,
          44
        )
      }
    );

    templates.put(
      'Fortinet',
      new List<BomTemplate>{
        new BomTemplate(
          'FG-100F',
          'FortiGate 100F Firewall',
          'Hardware',
          'ea',
          0.40,
          14,
          18
        ),
        new BomTemplate(
          'FC-10-F100F-950',
          'FortiGuard UTM Bundle',
          'Software',
          'ea',
          0.20,
          22,
          30
        ),
        new BomTemplate(
          'FC-10-F100F-247',
          'FortiCare Premium 24x7',
          'Support',
          'yr',
          0.15,
          26,
          34
        ),
        new BomTemplate(
          'SVC-PROF-FTNT',
          'Professional Services',
          'Services',
          'hr',
          0.25,
          30,
          45
        )
      }
    );

    templates.put(
      'VMware',
      new List<BomTemplate>{
        new BomTemplate(
          'VS8-ENT-C',
          'vSphere 8 Enterprise Plus',
          'Software',
          'ea',
          0.40,
          20,
          28
        ),
        new BomTemplate(
          'VS-VSAN8-A',
          'vSAN 8 Advanced',
          'Software',
          'ea',
          0.20,
          22,
          30
        ),
        new BomTemplate(
          'VS-PROD-SUP',
          'Production Support 24x7',
          'Support',
          'yr',
          0.15,
          28,
          35
        ),
        new BomTemplate(
          'SVC-IMPL-VMW',
          'Implementation Services',
          'Services',
          'hr',
          0.25,
          32,
          44
        )
      }
    );

    templates.put(
      'Microsoft',
      new List<BomTemplate>{
        new BomTemplate(
          'AAA-35638',
          'Microsoft 365 E5 Subscription',
          'Software',
          'ea',
          0.40,
          20,
          28
        ),
        new BomTemplate(
          'DZH318Z09V2C',
          'Azure Reserved Instances',
          'Cloud',
          'mo',
          0.20,
          18,
          26
        ),
        new BomTemplate(
          '9EA-00006',
          'Premier Support Contract',
          'Support',
          'yr',
          0.15,
          26,
          35
        ),
        new BomTemplate(
          'SVC-MIG-MSFT',
          'Migration Services',
          'Services',
          'hr',
          0.25,
          30,
          42
        )
      }
    );

    templates.put(
      'Pure Storage',
      new List<BomTemplate>{
        new BomTemplate(
          'FA-X20R3',
          'FlashArray//X20 R3',
          'Hardware',
          'ea',
          0.45,
          14,
          18
        ),
        new BomTemplate(
          'PURE1-BASE',
          'Pure1 Management License',
          'Software',
          'ea',
          0.15,
          22,
          30
        ),
        new BomTemplate(
          'ES-4HR-FA',
          'Evergreen//Forever Support',
          'Support',
          'yr',
          0.15,
          28,
          35
        ),
        new BomTemplate(
          'SVC-DATA-MIG',
          'Data Migration Services',
          'Services',
          'hr',
          0.25,
          30,
          44
        )
      }
    );

    templates.put(
      'NetApp',
      new List<BomTemplate>{
        new BomTemplate(
          'AFF-A250',
          'AFF A250 All-Flash Array',
          'Hardware',
          'ea',
          0.44,
          13,
          18
        ),
        new BomTemplate(
          'SW-ONTAP-PREM',
          'ONTAP Data Management License',
          'Software',
          'ea',
          0.16,
          22,
          28
        ),
        new BomTemplate(
          'CS-A2-PREM',
          'SupportEdge Premium 24x7',
          'Support',
          'yr',
          0.15,
          26,
          34
        ),
        new BomTemplate(
          'SVC-PROF-NTAP',
          'Professional Services',
          'Services',
          'hr',
          0.25,
          30,
          42
        )
      }
    );

    templates.put(
      'Arista',
      new List<BomTemplate>{
        new BomTemplate(
          'DCS-7050X3-48YC12',
          '7050X3 48-Port Switch',
          'Hardware',
          'ea',
          0.43,
          13,
          17
        ),
        new BomTemplate(
          'CV-BASE',
          'CloudVision Platform License',
          'Software',
          'ea',
          0.17,
          22,
          30
        ),
        new BomTemplate(
          'AR-SUP-7050',
          'Arista Support 24x7',
          'Support',
          'yr',
          0.15,
          26,
          34
        ),
        new BomTemplate(
          'SVC-NET-ARISTA',
          'Network Services',
          'Services',
          'hr',
          0.25,
          30,
          44
        )
      }
    );

    // Default fallback for any OEM not listed
    templates.put(
      'Default',
      new List<BomTemplate>{
        new BomTemplate(
          'HW-GEN-001',
          'Generic Hardware',
          'Hardware',
          'ea',
          0.43,
          12,
          18
        ),
        new BomTemplate(
          'SW-GEN-001',
          'Software License',
          'Software',
          'ea',
          0.17,
          20,
          30
        ),
        new BomTemplate(
          'SUP-GEN-001',
          'Support Contract',
          'Support',
          'yr',
          0.15,
          25,
          35
        ),
        new BomTemplate(
          'SVC-GEN-001',
          'Professional Services',
          'Services',
          'hr',
          0.25,
          30,
          45
        )
      }
    );

    return templates;
  }

  /**
   * Creates BOM line records for each Opportunity.
   * Each Opportunity gets 4 BOM lines based on OEM-specific templates.
   * Costs are proportional to Fulcrum_OEM_Cost__c (or Amount if cost not set).
   *
   * @param opps  List of inserted Opportunities (must have Ids)
   * @return      Number of BOM lines created
   */
  @TestVisible
  public static Integer insertBomLines(List<Opportunity> opps) {
    if (opps == null || opps.isEmpty()) {
      return 0;
    }

    // Gather Opp Ids and query back fields we need for BOM generation
    Set<Id> oppIds = new Set<Id>();
    for (Opportunity o : opps) {
      oppIds.add(o.Id);
    }

    Map<Id, Opportunity> oppMap = new Map<Id, Opportunity>(
      [
        SELECT Id, Fulcrum_OEM__c, Fulcrum_OEM_Cost__c, Amount
        FROM Opportunity
        WHERE Id IN :oppIds
      ]
    );

    Map<String, List<BomTemplate>> allTemplates = getBomTemplates();
    List<Fulcrum_BOM_Line__c> bomLines = new List<Fulcrum_BOM_Line__c>();

    // Use a seed based on the number of opps for deterministic-ish variation
    Integer seed = opps.size();

    for (Opportunity rawOpp : opps) {
      Opportunity opp = oppMap.get(rawOpp.Id);
      if (opp == null) {
        continue;
      }

      String oemName = opp.Fulcrum_OEM__c;
      Decimal totalCost = opp.Fulcrum_OEM_Cost__c != null
        ? opp.Fulcrum_OEM_Cost__c
        : (opp.Amount != null ? opp.Amount * 0.82 : 100000);

      List<BomTemplate> templates = allTemplates.containsKey(oemName)
        ? allTemplates.get(oemName)
        : allTemplates.get('Default');

      Integer sortOrder = 0;
      for (BomTemplate tmpl : templates) {
        // Vary cost allocation slightly per deal (+/- 3%)
        seed++;
        Decimal variation = 1.0 + (Math.mod(seed * 7, 7) - 3) / 100.0;
        Decimal lineCost = totalCost * tmpl.costPctOfTotal * variation;

        // Vary quantity: hardware 1-4, software 1-10, support/services 1-3
        Integer qty;
        if (tmpl.category == 'Hardware') {
          qty = 1 + Math.mod(seed * 3, 4);
        } else if (tmpl.category == 'Software' || tmpl.category == 'Cloud') {
          qty = 1 + Math.mod(seed * 5, 10);
        } else {
          qty = 1 + Math.mod(seed * 11, 3);
        }

        Decimal unitCost = (lineCost / qty)
          .setScale(2, System.RoundingMode.HALF_UP);

        // Pick a margin percentage within the realistic range for this category
        Decimal marginRange = tmpl.marginPctHigh - tmpl.marginPctLow;
        Decimal marginPct =
          tmpl.marginPctLow + (marginRange * Math.mod(seed * 13, 100) / 100.0);
        marginPct = marginPct.setScale(2, System.RoundingMode.HALF_UP);

        // Derived fields
        Decimal unitPrice = (unitCost / (1 - marginPct / 100))
          .setScale(2, System.RoundingMode.HALF_UP);
        Decimal extendedCost = (unitCost * qty)
          .setScale(2, System.RoundingMode.HALF_UP);
        Decimal extendedPrice = (unitPrice * qty)
          .setScale(2, System.RoundingMode.HALF_UP);

        Fulcrum_BOM_Line__c bom = new Fulcrum_BOM_Line__c();
        bom.Opportunity__c = opp.Id;
        bom.Product_Number__c = tmpl.productNumber;
        bom.Description__c = tmpl.description;
        bom.Category__c = tmpl.category;
        bom.Unit__c = tmpl.unit;
        bom.Quantity__c = qty;
        bom.Unit_Cost__c = unitCost;
        bom.Unit_Price__c = unitPrice;
        bom.List_Price__c = (unitPrice * 1.15)
          .setScale(2, System.RoundingMode.HALF_UP); // list price ~15% above sell
        bom.Extended_Cost__c = extendedCost;
        bom.Extended_Price__c = extendedPrice;
        bom.Margin_Pct__c = marginPct;
        bom.Vendor__c = String.isNotBlank(oemName) ? oemName : 'Generic';
        bom.Sort_Order__c = sortOrder++;
        bom.Line_Key__c =
          tmpl.category.toLowerCase() +
          '-' +
          tmpl.productNumber.toLowerCase();
        bom.BOM_Origin__c = 'demo';

        bomLines.add(bom);
      }
    }

    if (!bomLines.isEmpty()) {
      SObjectAccessDecision decision = Security.stripInaccessible(
        AccessType.CREATABLE,
        bomLines
      );
      insert decision.getRecords();
    }

    return bomLines.size();
  }
}
