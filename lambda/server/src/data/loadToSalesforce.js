#!/usr/bin/env node
/**
 * loadToSalesforce.js
 *
 * Reads sfdc_seed_data.json and loads it into Salesforce:
 * 1. Creates missing Account records
 * 2. Deletes all existing Opportunities (Bulk API)
 * 3. Inserts new Opportunity records (Bulk API CSV)
 *
 * Uses sf CLI commands via child_process.
 * Requires: SF_USE_GENERIC_UNIX_KEYCHAIN=true
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { execSync } from 'child_process'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const TARGET_ORG = 'matt.542a9844149e@agentforce.com'
const ENV_PREFIX = 'SF_USE_GENERIC_UNIX_KEYCHAIN=true'

function sfQuery(soql) {
  const cmd = `${ENV_PREFIX} sf data query --query "${soql}" --target-org ${TARGET_ORG} --json`
  const result = JSON.parse(execSync(cmd, { maxBuffer: 10 * 1024 * 1024 }).toString())
  return result.result?.records || []
}

function sfApexRun(apexCode) {
  const tmpFile = path.join(__dirname, '_tmp_apex.apex')
  fs.writeFileSync(tmpFile, apexCode)
  try {
    const cmd = `${ENV_PREFIX} sf apex run --file "${tmpFile}" --target-org ${TARGET_ORG} --json`
    const result = execSync(cmd, { maxBuffer: 10 * 1024 * 1024, timeout: 120000 }).toString()
    return JSON.parse(result)
  } catch (e) {
    const stdout = e.stdout ? e.stdout.toString() : ''
    try {
      const parsed = JSON.parse(stdout)
      console.error('Apex error:', parsed.message || parsed.name)
      if (parsed.result) {
        console.error('  compileProblem:', parsed.result.compileProblem)
        console.error('  exceptionMessage:', parsed.result.exceptionMessage)
      }
      return { result: { success: false, compileProblem: parsed.message, exceptionMessage: parsed.result?.exceptionMessage } }
    } catch { console.error('Raw stdout:', stdout.slice(0, 500)) }
    fs.writeFileSync(path.join(__dirname, '_failed_apex.apex'), apexCode)
    return { result: { success: false, compileProblem: 'Unknown error' } }
  } finally {
    try { fs.unlinkSync(tmpFile) } catch {}
  }
}

function escapeApex(str) {
  if (str == null) return 'null'
  return str.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

function escapeCSV(val) {
  if (val == null || val === '') return ''
  const str = String(val)
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return '"' + str.replace(/"/g, '""') + '"'
  }
  return str
}

async function main() {
  console.log('=== MarginArc SFDC Data Loader (Bulk API) ===\n')

  // 1. Read seed data
  const seedFile = path.join(__dirname, 'sfdc_seed_data.json')
  if (!fs.existsSync(seedFile)) {
    console.error('ERROR: sfdc_seed_data.json not found. Run generateSyntheticDeals.js first.')
    process.exit(1)
  }
  const deals = JSON.parse(fs.readFileSync(seedFile, 'utf-8'))
  console.log(`Loaded ${deals.length} deals from sfdc_seed_data.json`)

  // 2. Get unique accounts needed
  const accountMap = new Map()
  for (const deal of deals) {
    if (!accountMap.has(deal.AccountName)) {
      accountMap.set(deal.AccountName, deal.AccountIndustry || 'Technology')
    }
  }
  console.log(`\nUnique accounts needed: ${accountMap.size}`)

  // 3. Query existing accounts
  console.log('Querying existing SFDC accounts...')
  const existingAccounts = sfQuery("SELECT Id, Name FROM Account ORDER BY Name")
  const existingAccountMap = new Map()
  for (const acc of existingAccounts) {
    existingAccountMap.set(acc.Name, acc.Id)
  }
  console.log(`Found ${existingAccounts.length} existing accounts`)

  // 4. Create missing accounts
  const missingAccounts = []
  for (const [name, industry] of accountMap) {
    if (!existingAccountMap.has(name)) {
      missingAccounts.push({ name, industry })
    }
  }

  if (missingAccounts.length > 0) {
    console.log(`\nCreating ${missingAccounts.length} missing accounts...`)
    const batchSize = 50
    for (let i = 0; i < missingAccounts.length; i += batchSize) {
      const batch = missingAccounts.slice(i, i + batchSize)
      const apex = `
List<Account> newAccounts = new List<Account>();
${batch.map(a => `newAccounts.add(new Account(Name='${escapeApex(a.name)}', Industry='${escapeApex(a.industry)}'));`).join('\n')}
insert newAccounts;
System.debug('Created ' + newAccounts.size() + ' accounts');
`
      const result = sfApexRun(apex)
      if (result.result?.success === false) {
        console.error('Account creation failed:', result.result?.compileProblem || result.result?.exceptionMessage)
        process.exit(1)
      }
      console.log(`  Batch ${Math.floor(i / batchSize) + 1}: Created ${batch.length} accounts`)
    }
  } else {
    console.log('All accounts already exist!')
  }

  // 5. Re-query accounts to get all IDs
  console.log('\nRefreshing account ID map...')
  const allAccounts = sfQuery("SELECT Id, Name FROM Account ORDER BY Name")
  const accountIdMap = new Map()
  for (const acc of allAccounts) {
    accountIdMap.set(acc.Name, acc.Id)
  }

  // Verify all needed accounts exist
  let missingCount = 0
  for (const [name] of accountMap) {
    if (!accountIdMap.has(name)) {
      console.error(`  WARNING: Account "${name}" still not found!`)
      missingCount++
    }
  }
  if (missingCount > 0) {
    console.error(`${missingCount} accounts could not be resolved. Proceeding with available accounts.`)
  }

  // 6. Delete all existing Opportunities
  console.log('\nDeleting existing Opportunities...')
  const existingOpps = sfQuery("SELECT Id FROM Opportunity")
  if (existingOpps.length > 0) {
    console.log(`  Found ${existingOpps.length} opportunities to delete`)
    // Delete in batches of 200 via Apex DML
    const deleteBatch = 200
    for (let i = 0; i < existingOpps.length; i += deleteBatch) {
      const batch = existingOpps.slice(i, i + deleteBatch)
      const ids = batch.map(o => `'${o.Id}'`).join(',')
      const apex = `
List<Opportunity> toDelete = [SELECT Id FROM Opportunity WHERE Id IN (${ids})];
delete toDelete;
System.debug('Deleted ' + toDelete.size() + ' opportunities');
`
      const result = sfApexRun(apex)
      if (result.result?.success === false) {
        console.error('Delete failed:', result.result?.compileProblem || result.result?.exceptionMessage)
        process.exit(1)
      }
      console.log(`  Deleted batch ${Math.floor(i / deleteBatch) + 1} (${batch.length} records)`)
    }
  } else {
    console.log('  No existing opportunities to delete')
  }

  // 7. Generate CSV for Bulk API insert
  console.log(`\nPreparing CSV for ${deals.length} opportunities...`)

  const csvHeaders = [
    'Name', 'AccountId', 'StageName', 'CloseDate', 'Amount',
    'Fulcrum_OEM__c', 'Fulcrum_OEM_Cost__c', 'Fulcrum_Customer_Segment__c',
    'Fulcrum_Deal_Reg_Type__c', 'Fulcrum_Competitors__c', 'Fulcrum_Competitor_Names__c',
    'Fulcrum_Solution_Complexity__c', 'Fulcrum_Relationship_Strength__c',
    'Fulcrum_Value_Add__c', 'Fulcrum_Services_Attached__c', 'Fulcrum_Quarter_End__c',
    'Fulcrum_Planned_Margin__c', 'Fulcrum_GP_Percent__c', 'Fulcrum_Product_Category__c',
    'Fulcrum_Deal_Type__c', 'Fulcrum_Loss_Reason__c'
  ]

  const csvLines = [csvHeaders.join(',')]
  let skipped = 0

  for (const deal of deals) {
    const accountId = accountIdMap.get(deal.AccountName)
    if (!accountId) {
      skipped++
      continue
    }

    const row = [
      escapeCSV(deal.Name),
      escapeCSV(accountId),
      escapeCSV(deal.StageName),
      escapeCSV(deal.CloseDate),
      deal.Amount,
      escapeCSV(deal.Fulcrum_OEM__c || ''),
      deal.Fulcrum_OEM_Cost__c ?? '',
      escapeCSV(deal.Fulcrum_Customer_Segment__c || ''),
      escapeCSV(deal.Fulcrum_Deal_Reg_Type__c || ''),
      escapeCSV(deal.Fulcrum_Competitors__c ?? ''),
      escapeCSV(deal.Fulcrum_Competitor_Names__c || ''),
      escapeCSV(deal.Fulcrum_Solution_Complexity__c || ''),
      escapeCSV(deal.Fulcrum_Relationship_Strength__c || ''),
      escapeCSV(deal.Fulcrum_Value_Add__c || ''),
      deal.Fulcrum_Services_Attached__c === true ? 'true' : 'false',
      deal.Fulcrum_Quarter_End__c === true ? 'true' : 'false',
      deal.Fulcrum_Planned_Margin__c ?? '',
      deal.Fulcrum_GP_Percent__c ?? '',
      escapeCSV(deal.Fulcrum_Product_Category__c || ''),
      escapeCSV(deal.Fulcrum_Deal_Type__c || ''),
      escapeCSV(deal.Fulcrum_Loss_Reason__c || '')
    ]

    csvLines.push(row.join(','))
  }

  const csvFile = path.join(__dirname, '_bulk_opps.csv')
  fs.writeFileSync(csvFile, csvLines.join('\n'))
  console.log(`  CSV written: ${csvLines.length - 1} rows (${skipped} skipped)`)

  // 8. Upload via Bulk API 2.0
  console.log('\nUploading via Bulk API 2.0...')
  try {
    const bulkCmd = `${ENV_PREFIX} sf data import bulk --sobject Opportunity --file "${csvFile}" --target-org ${TARGET_ORG} --wait 30 --json`
    const bulkResult = JSON.parse(execSync(bulkCmd, {
      maxBuffer: 50 * 1024 * 1024,
      timeout: 600000 // 10 minute timeout
    }).toString())

    if (bulkResult.status === 0) {
      const jobInfo = bulkResult.result?.jobInfo || bulkResult.result || {}
      console.log(`  Bulk job completed!`)
      console.log(`    Records processed: ${jobInfo.numberRecordsProcessed || 'N/A'}`)
      console.log(`    Records failed: ${jobInfo.numberRecordsFailed || 0}`)

      if (jobInfo.numberRecordsFailed > 0) {
        console.warn(`  WARNING: ${jobInfo.numberRecordsFailed} records failed during bulk insert`)
      }
    } else {
      console.error('  Bulk import returned non-zero status:', JSON.stringify(bulkResult, null, 2).slice(0, 2000))
      console.log('\n  Falling back to Apex anonymous batches...')
      await fallbackApexInsert(deals, accountIdMap)
    }
  } catch (e) {
    const stdout = e.stdout ? e.stdout.toString() : ''
    console.error('  Bulk API error:', stdout.slice(0, 1000))
    console.log('\n  Falling back to Apex anonymous batches...')
    await fallbackApexInsert(deals, accountIdMap)
  } finally {
    try { fs.unlinkSync(csvFile) } catch {}
  }

  // 9. Verify
  console.log('\nVerifying...')
  const finalOpps = sfQuery("SELECT COUNT() FROM Opportunity")
  // COUNT() returns differently
  const countCmd = `${ENV_PREFIX} sf data query --query "SELECT COUNT(Id) cnt FROM Opportunity" --target-org ${TARGET_ORG} --json`
  try {
    const countResult = JSON.parse(execSync(countCmd, { maxBuffer: 10 * 1024 * 1024 }).toString())
    const count = countResult.result?.records?.[0]?.cnt || 'unknown'
    console.log(`  Opportunities in org: ${count}`)
  } catch {
    console.log('  (Could not verify count)')
  }

  console.log(`\n=== Summary ===`)
  console.log(`Accounts: ${accountMap.size} needed, ${missingAccounts.length} created`)
  console.log(`Opportunities: ${csvLines.length - 1} prepared, ${skipped} skipped`)
  console.log(`Done!`)
}

// Fallback: insert via Apex anonymous in small batches (slow but reliable)
async function fallbackApexInsert(deals, accountIdMap) {
  const insertBatch = 10
  let inserted = 0
  let skipped = 0

  for (let i = 0; i < deals.length; i += insertBatch) {
    const batch = deals.slice(i, i + insertBatch)
    const oppLines = []

    for (const deal of batch) {
      const accountId = accountIdMap.get(deal.AccountName)
      if (!accountId) { skipped++; continue }

      const fields = []
      fields.push(`Name='${escapeApex(deal.Name)}'`)
      fields.push(`AccountId='${accountId}'`)
      fields.push(`StageName='${escapeApex(deal.StageName)}'`)
      fields.push(`CloseDate=Date.valueOf('${deal.CloseDate}')`)
      fields.push(`Amount=${deal.Amount}`)
      if (deal.Fulcrum_OEM__c) fields.push(`Fulcrum_OEM__c='${escapeApex(deal.Fulcrum_OEM__c)}'`)
      if (deal.Fulcrum_OEM_Cost__c != null) fields.push(`Fulcrum_OEM_Cost__c=${deal.Fulcrum_OEM_Cost__c}`)
      if (deal.Fulcrum_Customer_Segment__c) fields.push(`Fulcrum_Customer_Segment__c='${escapeApex(deal.Fulcrum_Customer_Segment__c)}'`)
      if (deal.Fulcrum_Deal_Reg_Type__c) fields.push(`Fulcrum_Deal_Reg_Type__c='${escapeApex(deal.Fulcrum_Deal_Reg_Type__c)}'`)
      if (deal.Fulcrum_Competitors__c != null) fields.push(`Fulcrum_Competitors__c='${escapeApex(String(deal.Fulcrum_Competitors__c))}'`)
      if (deal.Fulcrum_Competitor_Names__c) fields.push(`Fulcrum_Competitor_Names__c='${escapeApex(deal.Fulcrum_Competitor_Names__c)}'`)
      if (deal.Fulcrum_Solution_Complexity__c) fields.push(`Fulcrum_Solution_Complexity__c='${escapeApex(deal.Fulcrum_Solution_Complexity__c)}'`)
      if (deal.Fulcrum_Relationship_Strength__c) fields.push(`Fulcrum_Relationship_Strength__c='${escapeApex(deal.Fulcrum_Relationship_Strength__c)}'`)
      if (deal.Fulcrum_Value_Add__c) fields.push(`Fulcrum_Value_Add__c='${escapeApex(deal.Fulcrum_Value_Add__c)}'`)
      if (deal.Fulcrum_Services_Attached__c != null) fields.push(`Fulcrum_Services_Attached__c=${deal.Fulcrum_Services_Attached__c}`)
      if (deal.Fulcrum_Quarter_End__c != null) fields.push(`Fulcrum_Quarter_End__c=${deal.Fulcrum_Quarter_End__c}`)
      if (deal.Fulcrum_Planned_Margin__c != null) fields.push(`Fulcrum_Planned_Margin__c=${deal.Fulcrum_Planned_Margin__c}`)
      if (deal.Fulcrum_GP_Percent__c != null) fields.push(`Fulcrum_GP_Percent__c=${deal.Fulcrum_GP_Percent__c}`)
      if (deal.Fulcrum_Product_Category__c) fields.push(`Fulcrum_Product_Category__c='${escapeApex(deal.Fulcrum_Product_Category__c)}'`)
      if (deal.Fulcrum_Deal_Type__c) fields.push(`Fulcrum_Deal_Type__c='${escapeApex(deal.Fulcrum_Deal_Type__c)}'`)
      if (deal.Fulcrum_Loss_Reason__c) fields.push(`Fulcrum_Loss_Reason__c='${escapeApex(deal.Fulcrum_Loss_Reason__c)}'`)
      oppLines.push(`opps.add(new Opportunity(${fields.join(', ')}));`)
    }

    if (oppLines.length === 0) continue

    const apex = `
List<Opportunity> opps = new List<Opportunity>();
${oppLines.join('\n')}
insert opps;
System.debug('Inserted ' + opps.size() + ' opportunities');
`
    const result = sfApexRun(apex)
    if (result.result?.success === false) {
      console.error(`  Insert batch ${Math.floor(i / insertBatch) + 1} failed:`)
      console.error(result.result?.compileProblem || result.result?.exceptionMessage || JSON.stringify(result.result))
      continue
    }
    inserted += oppLines.length
    if (inserted % 100 === 0 || i + insertBatch >= deals.length) {
      console.log(`  Progress: ${inserted} / ${deals.length} inserted`)
    }
  }

  console.log(`  Apex fallback complete: ${inserted} inserted, ${skipped} skipped`)
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
