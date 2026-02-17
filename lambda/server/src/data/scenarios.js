// ---------------------------------------------------------------------------
// POC Scenario Presets — tailored demo-data profiles for different VAR types
// ---------------------------------------------------------------------------
// Each scenario overrides the default distribution parameters in
// generateSyntheticDeals.js so that the generated dataset looks like the
// prospect's actual business mix.
//
// OEM keys must match the short names used by the generator:
//   Cisco, HPE, Dell, Palo Alto, Fortinet, VMware, Microsoft,
//   Pure Storage, NetApp, Arista
// ---------------------------------------------------------------------------

const scenarios = {

  // -------------------------------------------------------------------------
  // Networking VAR — Cisco / Aruba(HPE) / Juniper(Arista) heavy, 60% HW
  // -------------------------------------------------------------------------
  'networking-var': {
    label: 'Networking VAR',
    description: 'Heavy Cisco/Aruba/Juniper mix, 60% hardware, mid-market focus',

    oemWeights: {
      Cisco:          0.35,
      HPE:            0.18,   // Aruba lives under HPE
      Arista:         0.12,   // proxy for Juniper-type networking
      Dell:           0.10,
      Fortinet:       0.08,
      'Palo Alto':    0.05,
      VMware:         0.04,
      Microsoft:      0.04,
      'Pure Storage': 0.02,
      NetApp:         0.02
    },

    // Product category mix  (must sum to 1)
    categoryWeights: {
      Hardware: 0.60,
      Software: 0.15,
      Cloud:    0.10,
      Services: 0.15   // combined professional + managed
    },

    segmentWeights: {
      SMB:        0.25,
      MidMarket:  0.50,
      Enterprise: 0.25
    },

    avgDealSize:       75000,
    dealSizeSd:        0.50,   // log-normal spread factor
    competitorWeights: { '0': 0.10, '1': 0.25, '2': 0.35, '3+': 0.30 },
    winRateBaseline:   0.56,
    marginRange:       [0.12, 0.22],  // typical achieved margin band
    bomLinesAvg:       4,
    bomLinesSd:        1.5
  },

  // -------------------------------------------------------------------------
  // Security VAR — Palo Alto / Fortinet dominant, 40% SW + 30% services
  // -------------------------------------------------------------------------
  'security-var': {
    label: 'Security VAR',
    description: 'Palo Alto/Fortinet dominant, 40% software + 30% services, enterprise-leaning',

    oemWeights: {
      'Palo Alto':    0.30,
      Fortinet:       0.25,
      Cisco:          0.15,
      Microsoft:      0.10,
      VMware:         0.06,
      HPE:            0.04,
      Dell:           0.04,
      'Pure Storage': 0.03,
      NetApp:         0.02,
      Arista:         0.01
    },

    categoryWeights: {
      Hardware: 0.25,
      Software: 0.40,
      Cloud:    0.05,
      Services: 0.30
    },

    segmentWeights: {
      SMB:        0.15,
      MidMarket:  0.40,
      Enterprise: 0.45
    },

    avgDealSize:       120000,
    dealSizeSd:        0.55,
    competitorWeights: { '0': 0.15, '1': 0.40, '2': 0.30, '3+': 0.15 },
    winRateBaseline:   0.54,
    marginRange:       [0.15, 0.28],
    bomLinesAvg:       5,
    bomLinesSd:        2
  },

  // -------------------------------------------------------------------------
  // Cloud VAR — Microsoft / VMware heavy, 50% cloud/software, SMB-heavy
  // -------------------------------------------------------------------------
  'cloud-var': {
    label: 'Cloud VAR',
    description: 'Microsoft/VMware heavy, 50% cloud/software, SMB-heavy',

    oemWeights: {
      Microsoft:      0.30,
      VMware:         0.22,
      Dell:           0.12,
      HPE:            0.10,
      Cisco:          0.08,
      'Palo Alto':    0.05,
      Fortinet:       0.04,
      'Pure Storage': 0.04,
      NetApp:         0.03,
      Arista:         0.02
    },

    categoryWeights: {
      Hardware: 0.20,
      Software: 0.30,
      Cloud:    0.35,
      Services: 0.15
    },

    segmentWeights: {
      SMB:        0.50,
      MidMarket:  0.35,
      Enterprise: 0.15
    },

    avgDealSize:       45000,
    dealSizeSd:        0.50,
    competitorWeights: { '0': 0.20, '1': 0.45, '2': 0.25, '3+': 0.10 },
    winRateBaseline:   0.62,
    marginRange:       [0.10, 0.20],
    bomLinesAvg:       3,
    bomLinesSd:        1
  },

  // -------------------------------------------------------------------------
  // Full-stack VAR — even distribution, all segments (the default)
  // -------------------------------------------------------------------------
  'full-stack-var': {
    label: 'Full-Stack VAR',
    description: 'Even OEM distribution, balanced categories, all segments',

    oemWeights: {
      Cisco:          0.16,
      HPE:            0.12,
      Dell:           0.12,
      'Palo Alto':    0.12,
      Fortinet:       0.10,
      VMware:         0.10,
      Microsoft:      0.10,
      'Pure Storage': 0.08,
      NetApp:         0.05,
      Arista:         0.05
    },

    categoryWeights: {
      Hardware: 0.35,
      Software: 0.25,
      Cloud:    0.20,
      Services: 0.20
    },

    segmentWeights: {
      SMB:        0.30,
      MidMarket:  0.40,
      Enterprise: 0.30
    },

    avgDealSize:       90000,
    dealSizeSd:        0.55,
    competitorWeights: { '0': 0.15, '1': 0.30, '2': 0.35, '3+': 0.20 },
    winRateBaseline:   0.58,
    marginRange:       [0.12, 0.24],
    bomLinesAvg:       4,
    bomLinesSd:        1.5
  },

  // -------------------------------------------------------------------------
  // Services-heavy VAR — any OEM, 50% professional/managed services, enterprise
  // -------------------------------------------------------------------------
  'services-heavy-var': {
    label: 'Services-Heavy VAR',
    description: 'Any OEM, 50% professional/managed services attached, enterprise focus',

    oemWeights: {
      Cisco:          0.15,
      HPE:            0.12,
      Dell:           0.12,
      'Palo Alto':    0.10,
      Fortinet:       0.08,
      VMware:         0.10,
      Microsoft:      0.12,
      'Pure Storage': 0.08,
      NetApp:         0.07,
      Arista:         0.06
    },

    categoryWeights: {
      Hardware: 0.20,
      Software: 0.15,
      Cloud:    0.15,
      Services: 0.50
    },

    segmentWeights: {
      SMB:        0.15,
      MidMarket:  0.35,
      Enterprise: 0.50
    },

    avgDealSize:       150000,
    dealSizeSd:        0.60,
    competitorWeights: { '0': 0.20, '1': 0.35, '2': 0.30, '3+': 0.15 },
    winRateBaseline:   0.55,
    marginRange:       [0.18, 0.32],
    bomLinesAvg:       6,
    bomLinesSd:        2
  }
}

/** List all available scenario keys */
export function listScenarios() {
  return Object.keys(scenarios)
}

/** Get a scenario config by key (returns undefined if not found) */
export function getScenario(key) {
  return scenarios[key] ?? undefined
}

/** Get all scenarios as { key, label, description } summaries */
export function listScenarioSummaries() {
  return Object.entries(scenarios).map(([key, cfg]) => ({
    key,
    label: cfg.label,
    description: cfg.description
  }))
}

export default scenarios
