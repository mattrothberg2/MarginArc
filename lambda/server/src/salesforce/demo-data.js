/**
 * Demo Data routes for MarginArc Admin Portal.
 *
 * Handles loading demo/POV data into customer Salesforce orgs:
 *   - small/medium: Delegates to the Apex REST endpoint in the MarginArc package
 *   - full: Uses pre-generated sfdc_seed_data.json (7K deals) via Composite + Bulk API 2.0
 *
 * Routes:
 *   POST   /api/demo-data/:orgId/load    - Load demo data
 *   GET    /api/demo-data/:orgId/status   - Check demo data status / job progress
 *   DELETE /api/demo-data/:orgId          - Remove demo data
 */

import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { verifyToken } from '../middleware/auth.js';
import { query } from '../licensing/db.js';
import { makeApiCall, makeRawApiCall } from './oauth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// All demo-data routes require admin JWT auth
router.use(verifyToken);

// Salesforce API version
const SF_API = 'v62.0';

// ---------------------------------------------------------------------------
// Seed data loader (lazy, cached)
// ---------------------------------------------------------------------------

let seedDataCache = null;
let customersCache = null;

function loadSeedData() {
  if (seedDataCache) return seedDataCache;
  const seedFile = path.join(__dirname, '..', 'data', 'sfdc_seed_data.json');
  seedDataCache = JSON.parse(fs.readFileSync(seedFile, 'utf-8'));
  console.log(`Loaded ${seedDataCache.length} seed deals`);
  return seedDataCache;
}

function loadCustomers() {
  if (customersCache) return customersCache;
  const custFile = path.join(__dirname, '..', 'data', 'customers.json');
  customersCache = JSON.parse(fs.readFileSync(custFile, 'utf-8'));
  return customersCache;
}

// ---------------------------------------------------------------------------
// Helper: CSV escape for Bulk API
// ---------------------------------------------------------------------------

function escapeCSV(val) {
  if (val == null || val === '') return '';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

// ---------------------------------------------------------------------------
// POST /:orgId/load
// ---------------------------------------------------------------------------

router.post('/:orgId/load', async (req, res) => {
  try {
    const { orgId } = req.params;
    const { size } = req.body || {};

    if (!['small', 'medium', 'full'].includes(size)) {
      return res.status(400).json({
        success: false,
        message: 'size must be one of: small, medium, full'
      });
    }

    // ---------------------
    // small / medium: delegate to Apex REST endpoint
    // ---------------------
    if (size === 'small' || size === 'medium') {
      try {
        const apexResult = await makeApiCall(
          orgId,
          'POST',
          `/services/apexrest/marginarc/demo-data/`,
          { size }
        );
        return res.json({ success: true, source: 'apex', result: apexResult });
      } catch (err) {
        console.error('Apex demo-data endpoint failed:', err.message);
        return res.status(502).json({
          success: false,
          message: `MarginArc Apex endpoint error: ${err.message}`
        });
      }
    }

    // ---------------------
    // full: Use pre-generated seed data via Composite + Bulk API
    // ---------------------

    // Create a job record for progress tracking
    const jobResult = await query(
      `INSERT INTO demo_data_jobs (org_id, status, size, total_records)
       VALUES ($1, 'running', $2, 0) RETURNING id`,
      [orgId, size]
    );
    const jobId = jobResult.rows[0].id;

    // Start the async loading process (don't await — return job ID immediately)
    loadFullDemoData(orgId, jobId).catch(err => {
      console.error(`Demo data job ${jobId} failed:`, err);
      query(
        `UPDATE demo_data_jobs SET status = 'failed', error_message = $1, completed_at = NOW() WHERE id = $2`,
        [err.message.slice(0, 500), jobId]
      ).catch(console.error);
    });

    return res.json({
      success: true,
      source: 'bulk',
      jobId,
      message: 'Full demo data load started. Poll /status for progress.'
    });
  } catch (error) {
    console.error('Error starting demo data load:', error);
    return res.status(500).json({ success: false, message: 'Failed to start demo data load' });
  }
});

// ---------------------------------------------------------------------------
// Full demo data loading (async background task)
// ---------------------------------------------------------------------------

async function loadFullDemoData(orgId, jobId) {
  const seedDeals = loadSeedData();
  const customers = loadCustomers();

  const totalRecords = seedDeals.length;
  await query(
    'UPDATE demo_data_jobs SET total_records = $1 WHERE id = $2',
    [totalRecords, jobId]
  );

  let recordsCreated = 0;

  // --- Step 1: Get unique accounts needed ---
  const accountMap = new Map();
  for (const deal of seedDeals) {
    if (!accountMap.has(deal.AccountName)) {
      accountMap.set(deal.AccountName, deal.AccountIndustry || 'Technology');
    }
  }

  // --- Step 2: Query existing accounts in the org ---
  console.log(`[Job ${jobId}] Querying existing accounts...`);
  const existingAccounts = await makeApiCall(
    orgId, 'GET',
    `/services/data/${SF_API}/query?q=${encodeURIComponent('SELECT Id, Name FROM Account ORDER BY Name LIMIT 2000')}`
  );

  const existingAccountMap = new Map();
  for (const acc of (existingAccounts?.records || [])) {
    existingAccountMap.set(acc.Name, acc.Id);
  }

  // --- Step 3: Create missing accounts via Composite API (batches of 25) ---
  const missingAccounts = [];
  for (const [name, industry] of accountMap) {
    if (!existingAccountMap.has(name)) {
      missingAccounts.push({ Name: name, Industry: industry });
    }
  }

  if (missingAccounts.length > 0) {
    console.log(`[Job ${jobId}] Creating ${missingAccounts.length} missing accounts...`);
    const batchSize = 25;
    for (let i = 0; i < missingAccounts.length; i += batchSize) {
      const batch = missingAccounts.slice(i, i + batchSize);
      const compositeRequest = {
        allOrNone: false,
        compositeRequest: batch.map((acc, idx) => ({
          method: 'POST',
          url: `/services/data/${SF_API}/sobjects/Account`,
          referenceId: `acc_${i + idx}`,
          body: acc
        }))
      };

      const compositeResult = await makeApiCall(
        orgId, 'POST',
        `/services/data/${SF_API}/composite`,
        compositeRequest
      );

      // Collect created IDs
      for (let j = 0; j < (compositeResult?.compositeResponse || []).length; j++) {
        const resp = compositeResult.compositeResponse[j];
        if (resp.httpStatusCode === 201 && resp.body?.id) {
          existingAccountMap.set(batch[j].Name, resp.body.id);
        }
      }
    }
  }

  // Re-query to pick up any we might have missed
  const refreshedAccounts = await makeApiCall(
    orgId, 'GET',
    `/services/data/${SF_API}/query?q=${encodeURIComponent('SELECT Id, Name FROM Account ORDER BY Name LIMIT 2000')}`
  );
  for (const acc of (refreshedAccounts?.records || [])) {
    existingAccountMap.set(acc.Name, acc.Id);
  }

  await query(
    `UPDATE demo_data_jobs SET progress = 5 WHERE id = $1`,
    [jobId]
  );

  // --- Step 4: Build CSV for Bulk API 2.0 Opportunity insert ---
  console.log(`[Job ${jobId}] Building CSV for ${seedDeals.length} opportunities...`);

  const csvHeaders = [
    'Name', 'AccountId', 'StageName', 'CloseDate', 'Amount',
    'Fulcrum_OEM__c', 'Fulcrum_OEM_Cost__c', 'Fulcrum_Customer_Segment__c',
    'Fulcrum_Deal_Reg_Type__c', 'Fulcrum_Competitors__c', 'Fulcrum_Competitor_Names__c',
    'Fulcrum_Solution_Complexity__c', 'Fulcrum_Relationship_Strength__c',
    'Fulcrum_Value_Add__c', 'Fulcrum_Services_Attached__c', 'Fulcrum_Quarter_End__c',
    'Fulcrum_Planned_Margin__c', 'Fulcrum_GP_Percent__c', 'Fulcrum_Product_Category__c',
    'Fulcrum_Deal_Type__c', 'Fulcrum_Loss_Reason__c'
  ];

  const csvLines = [csvHeaders.join(',')];
  let skipped = 0;

  for (const deal of seedDeals) {
    const accountId = existingAccountMap.get(deal.AccountName);
    if (!accountId) { skipped++; continue; }

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
    ];
    csvLines.push(row.join(','));
  }

  const csvData = csvLines.join('\n');
  console.log(`[Job ${jobId}] CSV prepared: ${csvLines.length - 1} rows, ${skipped} skipped`);

  await query(
    `UPDATE demo_data_jobs SET progress = 10, total_records = $1 WHERE id = $2`,
    [csvLines.length - 1, jobId]
  );

  // --- Step 5: Create Bulk API 2.0 ingest job ---
  console.log(`[Job ${jobId}] Creating Bulk API 2.0 ingest job...`);

  const bulkJob = await makeApiCall(
    orgId, 'POST',
    `/services/data/${SF_API}/jobs/ingest`,
    {
      object: 'Opportunity',
      operation: 'insert',
      contentType: 'CSV',
      lineEnding: 'LF'
    }
  );

  const bulkJobId = bulkJob.id;
  console.log(`[Job ${jobId}] Bulk job created: ${bulkJobId}`);

  // --- Step 6: Upload CSV data ---
  const uploadRes = await makeRawApiCall(
    orgId, 'PUT',
    `/services/data/${SF_API}/jobs/ingest/${bulkJobId}/batches`,
    csvData,
    'text/csv'
  );

  if (!uploadRes.ok) {
    const errText = await uploadRes.text();
    throw new Error(`CSV upload failed: ${uploadRes.status} ${errText.slice(0, 200)}`);
  }

  await query('UPDATE demo_data_jobs SET progress = 30 WHERE id = $1', [jobId]);

  // --- Step 7: Close the job to start processing ---
  await makeApiCall(
    orgId, 'PATCH',
    `/services/data/${SF_API}/jobs/ingest/${bulkJobId}`,
    { state: 'UploadComplete' }
  );

  console.log(`[Job ${jobId}] Bulk job ${bulkJobId} upload complete, polling for results...`);

  // --- Step 8: Poll for completion ---
  let attempts = 0;
  const maxAttempts = 60; // 5 minutes at 5s intervals
  let jobInfo;

  while (attempts < maxAttempts) {
    await new Promise(resolve => setTimeout(resolve, 5000));
    attempts++;

    jobInfo = await makeApiCall(
      orgId, 'GET',
      `/services/data/${SF_API}/jobs/ingest/${bulkJobId}`
    );

    const state = jobInfo.state;
    const processed = jobInfo.numberRecordsProcessed || 0;
    const failed = jobInfo.numberRecordsFailed || 0;
    const pctComplete = Math.min(95, 30 + Math.round((processed / Math.max(1, csvLines.length - 1)) * 65));

    await query(
      `UPDATE demo_data_jobs SET progress = $1, records_created = $2 WHERE id = $3`,
      [pctComplete, processed - failed, jobId]
    );

    console.log(`[Job ${jobId}] Bulk poll #${attempts}: state=${state}, processed=${processed}, failed=${failed}`);

    if (state === 'JobComplete' || state === 'Failed' || state === 'Aborted') {
      break;
    }
  }

  // --- Step 9: Finalize ---
  const finalState = jobInfo?.state || 'Unknown';
  const processed = jobInfo?.numberRecordsProcessed || 0;
  const failed = jobInfo?.numberRecordsFailed || 0;
  recordsCreated = processed - failed;

  if (finalState === 'JobComplete') {
    await query(
      `UPDATE demo_data_jobs SET status = 'completed', progress = 100, records_created = $1, completed_at = NOW() WHERE id = $2`,
      [recordsCreated, jobId]
    );
    console.log(`[Job ${jobId}] Completed! ${recordsCreated} records created, ${failed} failed, ${skipped} skipped`);
  } else {
    await query(
      `UPDATE demo_data_jobs SET status = 'failed', error_message = $1, records_created = $2, completed_at = NOW() WHERE id = $3`,
      [`Bulk job ended with state: ${finalState}. Processed: ${processed}, Failed: ${failed}`, recordsCreated, jobId]
    );
    console.error(`[Job ${jobId}] Bulk job ended with state: ${finalState}`);
  }
}

// ---------------------------------------------------------------------------
// GET /:orgId/status
// ---------------------------------------------------------------------------

router.get('/:orgId/status', async (req, res) => {
  try {
    const { orgId } = req.params;

    // Check for active/recent job
    const jobResult = await query(
      `SELECT * FROM demo_data_jobs WHERE org_id = $1 ORDER BY started_at DESC LIMIT 1`,
      [orgId]
    );

    const job = jobResult.rows[0] || null;

    // Query the Apex REST endpoint for current data counts (best-effort)
    let counts = null;
    let hasData = false;
    try {
      const apexResult = await makeApiCall(
        orgId, 'GET',
        `/services/apexrest/marginarc/demo-data/`
      );
      counts = apexResult;
      hasData = (apexResult?.opportunityCount || 0) > 0;
    } catch (err) {
      // Apex endpoint may not exist — fall back to SOQL count
      try {
        const countResult = await makeApiCall(
          orgId, 'GET',
          `/services/data/${SF_API}/query?q=${encodeURIComponent('SELECT COUNT(Id) cnt FROM Opportunity')}`
        );
        const oppCount = countResult?.records?.[0]?.cnt || 0;
        counts = { opportunityCount: oppCount };
        hasData = oppCount > 0;
      } catch (innerErr) {
        console.warn('Could not query demo data counts:', innerErr.message);
      }
    }

    return res.json({
      success: true,
      hasData,
      counts,
      job: job ? {
        id: job.id,
        status: job.status,
        size: job.size,
        progress: job.progress,
        totalRecords: job.total_records,
        recordsCreated: job.records_created,
        errorMessage: job.error_message,
        startedAt: job.started_at,
        completedAt: job.completed_at
      } : null
    });
  } catch (error) {
    console.error('Error checking demo data status:', error);
    return res.status(500).json({ success: false, message: 'Failed to check demo data status' });
  }
});

// ---------------------------------------------------------------------------
// DELETE /:orgId
// ---------------------------------------------------------------------------

router.delete('/:orgId', async (req, res) => {
  try {
    const { orgId } = req.params;

    // Try the Apex REST DELETE endpoint first
    try {
      const apexResult = await makeApiCall(
        orgId, 'DELETE',
        `/services/apexrest/marginarc/demo-data/`
      );
      // Clean up job records
      await query('DELETE FROM demo_data_jobs WHERE org_id = $1', [orgId]);
      return res.json({ success: true, source: 'apex', result: apexResult });
    } catch (err) {
      console.warn('Apex demo-data DELETE endpoint failed, falling back to SOQL delete:', err.message);
    }

    // Fallback: delete all Opportunities via Bulk API 2.0
    // First, get all Opportunity IDs
    let allOppIds = [];
    let queryUrl = `/services/data/${SF_API}/query?q=${encodeURIComponent('SELECT Id FROM Opportunity')}`;

    while (queryUrl) {
      const result = await makeApiCall(orgId, 'GET', queryUrl);
      allOppIds = allOppIds.concat((result?.records || []).map(r => r.Id));
      queryUrl = result?.nextRecordsUrl || null;
    }

    if (allOppIds.length === 0) {
      await query('DELETE FROM demo_data_jobs WHERE org_id = $1', [orgId]);
      return res.json({ success: true, message: 'No opportunities to delete', deleted: 0 });
    }

    console.log(`Deleting ${allOppIds.length} opportunities from org ${orgId} via Bulk API`);

    // Create Bulk delete job
    const bulkJob = await makeApiCall(
      orgId, 'POST',
      `/services/data/${SF_API}/jobs/ingest`,
      {
        object: 'Opportunity',
        operation: 'delete',
        contentType: 'CSV',
        lineEnding: 'LF'
      }
    );

    // Upload CSV with just IDs
    const idCsv = 'Id\n' + allOppIds.join('\n');
    const uploadRes = await makeRawApiCall(
      orgId, 'PUT',
      `/services/data/${SF_API}/jobs/ingest/${bulkJob.id}/batches`,
      idCsv,
      'text/csv'
    );

    if (!uploadRes.ok) {
      throw new Error(`Delete CSV upload failed: ${uploadRes.status}`);
    }

    // Close the job
    await makeApiCall(
      orgId, 'PATCH',
      `/services/data/${SF_API}/jobs/ingest/${bulkJob.id}`,
      { state: 'UploadComplete' }
    );

    // Poll briefly for completion (delete should be fast)
    let deleteInfo;
    for (let i = 0; i < 30; i++) {
      await new Promise(resolve => setTimeout(resolve, 3000));
      deleteInfo = await makeApiCall(
        orgId, 'GET',
        `/services/data/${SF_API}/jobs/ingest/${bulkJob.id}`
      );
      if (['JobComplete', 'Failed', 'Aborted'].includes(deleteInfo.state)) break;
    }

    // Clean up job records
    await query('DELETE FROM demo_data_jobs WHERE org_id = $1', [orgId]);

    return res.json({
      success: true,
      source: 'bulk_delete',
      deleted: deleteInfo?.numberRecordsProcessed || 0,
      failed: deleteInfo?.numberRecordsFailed || 0,
      state: deleteInfo?.state
    });
  } catch (error) {
    console.error('Error deleting demo data:', error);
    return res.status(500).json({ success: false, message: 'Failed to delete demo data' });
  }
});

export default router;
