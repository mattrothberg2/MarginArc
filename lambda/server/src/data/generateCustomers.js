#!/usr/bin/env node
/**
 * generateCustomers.js
 *
 * Generates ~250 realistic customer accounts for a mid-sized IT VAR.
 * Outputs customers.json with the full schema needed by Lambda + deal generator.
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// ---------------------------------------------------------------------------
// Curated company names by industry (mix of recognizable + realistic)
// ---------------------------------------------------------------------------

const COMPANIES = {
  'Technology': [
    'Salesforce', 'ServiceNow', 'Workday', 'Snowflake', 'Datadog',
    'Zscaler', 'Okta', 'Twilio', 'Splunk', 'MongoDB',
    'HashiCorp', 'Confluent', 'Elastic', 'PagerDuty', 'Cloudflare',
    'DigitalOcean', 'Fastly', 'Nutanix', 'Box', 'Dropbox',
    'HubSpot', 'Zendesk', 'Atlassian', 'Asana', 'Monday.com',
    'DocuSign', 'RingCentral', 'Zoom Video', 'Palantir', 'Unity Technologies',
    'Roblox', 'Stripe', 'Plaid', 'Akamai Technologies', 'Teradata'
  ],
  'Financial Services': [
    'JPMorgan Chase', 'Bank of America', 'Goldman Sachs', 'Morgan Stanley', 'Wells Fargo',
    'Citigroup', 'Charles Schwab', 'BlackRock', 'State Street', 'BNY Mellon',
    'Capital One', 'American Express', 'Discover Financial', 'Synchrony Financial', 'Ally Financial',
    'Raymond James', 'Edward Jones', 'T. Rowe Price', 'Franklin Templeton', 'Invesco',
    'Fidelity National', 'Moody\'s', 'S&P Global', 'MarketAxess', 'MSCI',
    'Northern Trust', 'KeyCorp', 'Regions Financial', 'M&T Bank', 'Citizens Financial',
    'Huntington Bancshares', 'Fifth Third Bancorp', 'Zions Bancorporation', 'SVB Financial', 'First Republic'
  ],
  'Life Sciences & Healthcare': [
    'UnitedHealth Group', 'CVS Health', 'McKesson', 'Cardinal Health', 'Elevance Health',
    'Centene', 'Humana', 'Cigna Group', 'Molina Healthcare', 'HCA Healthcare',
    'Johnson & Johnson', 'Abbott Laboratories', 'Pfizer', 'Merck', 'Bristol-Myers Squibb',
    'Eli Lilly', 'Amgen', 'Gilead Sciences', 'Regeneron', 'Vertex Pharmaceuticals',
    'Medtronic', 'Stryker', 'Boston Scientific', 'Edwards Lifesciences', 'Intuitive Surgical',
    'Danaher', 'Thermo Fisher Scientific', 'Agilent Technologies', 'Bio-Rad Laboratories', 'Quest Diagnostics'
  ],
  'Manufacturing & Automotive': [
    'General Motors', 'Ford Motor', 'Tesla', 'Toyota North America', 'Honda North America',
    'Caterpillar', 'John Deere', 'Illinois Tool Works', 'Parker Hannifin', 'Emerson Electric',
    'Honeywell', '3M Company', 'General Electric', 'Raytheon Technologies', 'Lockheed Martin',
    'Northrop Grumman', 'L3Harris Technologies', 'Textron', 'Cummins', 'PACCAR',
    'Rockwell Automation', 'Dover Corporation', 'Eaton Corporation', 'A.O. Smith', 'Roper Technologies',
    'Xylem', 'Watts Water Technologies', 'SPX Technologies', 'Lincoln Electric', 'Snap-on'
  ],
  'Retail': [
    'Walmart', 'Amazon', 'Costco Wholesale', 'Home Depot', 'Target',
    'Kroger', 'Walgreens Boots Alliance', 'Lowe\'s', 'Best Buy', 'Macy\'s',
    'Nordstrom', 'Gap', 'TJX Companies', 'Ross Stores', 'Dollar General',
    'Dollar Tree', 'AutoZone', 'O\'Reilly Automotive', 'Tractor Supply', 'Ulta Beauty',
    'Bath & Body Works', 'Williams-Sonoma', 'Etsy', 'Wayfair', 'Chewy'
  ],
  'Energy': [
    'Exxon Mobil', 'Chevron', 'ConocoPhillips', 'EOG Resources', 'Pioneer Natural Resources',
    'Phillips 66', 'Marathon Petroleum', 'Valero Energy', 'Schlumberger', 'Halliburton',
    'Baker Hughes', 'Kinder Morgan', 'Williams Companies', 'ONEOK', 'Enbridge North America',
    'NextEra Energy', 'Duke Energy', 'Southern Company', 'Dominion Energy', 'AES Corporation'
  ],
  'Media & Telecommunications': [
    'AT&T', 'Verizon Communications', 'Comcast', 'Walt Disney', 'Netflix',
    'Charter Communications', 'T-Mobile', 'Fox Corporation', 'Paramount Global', 'Warner Bros. Discovery',
    'Lumen Technologies', 'Frontier Communications', 'Dish Network', 'Sirius XM', 'iHeartMedia',
    'Roku', 'Spotify Technology', 'Trade Desk', 'Live Nation Entertainment', 'Activision Blizzard',
    'Electronic Arts', 'Take-Two Interactive', 'Regal Rexnord', 'Interpublic Group', 'Omnicom Group'
  ],
  'Consumer Goods & Food': [
    'PepsiCo', 'Coca-Cola', 'Procter & Gamble', 'Unilever North America', 'Mondelez International',
    'Kraft Heinz', 'General Mills', 'Kellogg', 'Hershey', 'McCormick',
    'Tyson Foods', 'Archer Daniels Midland', 'Conagra Brands', 'Hormel Foods', 'Lamb Weston',
    'Church & Dwight', 'Clorox', 'Colgate-Palmolive', 'Estee Lauder', 'Kimberly-Clark'
  ],
  'Transportation & Logistics': [
    'UPS', 'FedEx', 'XPO Logistics', 'J.B. Hunt Transport', 'Old Dominion Freight Line',
    'C.H. Robinson', 'Expeditors International', 'Ryder System', 'Werner Enterprises', 'Landstar System',
    'Knight-Swift Transportation', 'Saia', 'ArcBest Corporation', 'Heartland Express', 'TFI International'
  ],
  'Diversified Conglomerates': [
    'Berkshire Hathaway', 'Danaher Corporation', '3M Company', 'General Electric', 'Honeywell International',
    'Siemens USA', 'ABB Inc', 'Hitachi America', 'Mitsubishi America', 'Samsung Electronics America',
    'LG Electronics USA', 'Toshiba America', 'Panasonic North America', 'Bosch North America', 'Schneider Electric NA'
  ]
}

// ---------------------------------------------------------------------------
// Attribute distributions by tier
// ---------------------------------------------------------------------------

const TIERS = ['whale', 'large', 'medium', 'small', 'tiny']

function assignTier(idx, totalInIndustry) {
  const pct = idx / totalInIndustry
  if (pct < 0.06) return 'whale'      // top 6% = whales
  if (pct < 0.20) return 'large'      // next 14%
  if (pct < 0.50) return 'medium'     // next 30%
  if (pct < 0.80) return 'small'      // next 30%
  return 'tiny'                        // bottom 20%
}

function tierToRelationship(tier) {
  const roll = Math.random()
  switch (tier) {
    case 'whale': return 'Strategic'
    case 'large': return roll < 0.6 ? 'Strategic' : 'Good'
    case 'medium': return roll < 0.3 ? 'Strategic' : roll < 0.8 ? 'Good' : 'New'
    case 'small': return roll < 0.1 ? 'Strategic' : roll < 0.5 ? 'Good' : 'New'
    case 'tiny': return roll < 0.2 ? 'Good' : 'New'
  }
}

function tierToTechSoph(tier) {
  const roll = Math.random()
  switch (tier) {
    case 'whale': return roll < 0.5 ? 'High' : 'Medium'
    case 'large': return roll < 0.3 ? 'High' : roll < 0.8 ? 'Medium' : 'Low'
    case 'medium': return roll < 0.2 ? 'High' : roll < 0.7 ? 'Medium' : 'Low'
    case 'small': return roll < 0.1 ? 'High' : roll < 0.5 ? 'Medium' : 'Low'
    case 'tiny': return roll < 0.3 ? 'Medium' : 'Low'
  }
}

function tierToRelStage(tier) {
  const roll = Math.random()
  switch (tier) {
    case 'whale': return 'Mature'
    case 'large': return roll < 0.6 ? 'Mature' : 'Expansion'
    case 'medium': return roll < 0.3 ? 'Mature' : roll < 0.8 ? 'Expansion' : 'Prospecting'
    case 'small': return roll < 0.5 ? 'Expansion' : 'Prospecting'
    case 'tiny': return roll < 0.2 ? 'Expansion' : 'Prospecting'
  }
}

function tierToValueAddExpect(tier) {
  const roll = Math.random()
  switch (tier) {
    case 'whale': return roll < 0.7 ? 'High' : 'Medium'
    case 'large': return roll < 0.5 ? 'High' : roll < 0.9 ? 'Medium' : 'Low'
    case 'medium': return roll < 0.3 ? 'High' : roll < 0.7 ? 'Medium' : 'Low'
    case 'small': return roll < 0.15 ? 'High' : roll < 0.6 ? 'Medium' : 'Low'
    case 'tiny': return roll < 0.3 ? 'Medium' : 'Low'
  }
}

function industryAvgDealSize(industry, tier) {
  const base = {
    'Technology': 65000,
    'Financial Services': 55000,
    'Life Sciences & Healthcare': 50000,
    'Manufacturing & Automotive': 60000,
    'Retail': 40000,
    'Energy': 55000,
    'Media & Telecommunications': 50000,
    'Consumer Goods & Food': 38000,
    'Transportation & Logistics': 45000,
    'Diversified Conglomerates': 60000
  }[industry] || 50000

  const multiplier = {
    whale: 2.0 + Math.random() * 1.5,
    large: 1.3 + Math.random() * 0.7,
    medium: 0.8 + Math.random() * 0.4,
    small: 0.4 + Math.random() * 0.4,
    tiny: 0.2 + Math.random() * 0.3
  }[tier]

  return Math.round(base * multiplier / 1000) * 1000
}

function industrySegment(industry) {
  const map = {
    'Technology': 'Information Technology',
    'Financial Services': 'Financials',
    'Life Sciences & Healthcare': 'Health Care',
    'Manufacturing & Automotive': 'Industrials',
    'Retail': 'Consumer Discretionary',
    'Energy': 'Energy',
    'Media & Telecommunications': 'Communication Services',
    'Consumer Goods & Food': 'Consumer Staples',
    'Transportation & Logistics': 'Transportation',
    'Diversified Conglomerates': 'Industrials'
  }
  return map[industry] || 'Industrials'
}

// ---------------------------------------------------------------------------
// Generate customers
// ---------------------------------------------------------------------------

function generateCustomers() {
  const customers = []

  for (const [industry, names] of Object.entries(COMPANIES)) {
    // Shuffle names within each industry for tier assignment variety
    const shuffled = [...names].sort(() => Math.random() - 0.5)

    for (let i = 0; i < shuffled.length; i++) {
      const tier = assignTier(i, shuffled.length)
      customers.push({
        name: shuffled[i],
        segment: industrySegment(industry),
        relationshipStrength: tierToRelationship(tier),
        customerTechSophistication: tierToTechSoph(tier),
        relationshipStage: tierToRelStage(tier),
        valueAddExpectation: tierToValueAddExpect(tier),
        avgDealSize: industryAvgDealSize(industry, tier),
        industry,
        _tier: tier // internal, for deal generator
      })
    }
  }

  // Final shuffle
  customers.sort(() => Math.random() - 0.5)

  return customers
}

const customers = generateCustomers()

// Write without _tier field for Lambda consumption
const output = customers.map(({ _tier, ...rest }) => rest)
fs.writeFileSync(path.join(__dirname, 'customers.json'), JSON.stringify(output, null, 2))

console.log(`Generated ${customers.length} customers -> customers.json`)

// Stats
const byIndustry = {}
const byTier = {}
for (const c of customers) {
  byIndustry[c.industry] = (byIndustry[c.industry] || 0) + 1
  byTier[c._tier] = (byTier[c._tier] || 0) + 1
}
console.log('\nBy industry:')
for (const [k, v] of Object.entries(byIndustry).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k}: ${v}`)
}
console.log('\nBy tier:')
for (const [k, v] of Object.entries(byTier).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k}: ${v}`)
}
console.log('\nBy relationship:')
const byRel = {}
for (const c of customers) {
  byRel[c.relationshipStrength] = (byRel[c.relationshipStrength] || 0) + 1
}
for (const [k, v] of Object.entries(byRel)) {
  console.log(`  ${k}: ${v}`)
}
