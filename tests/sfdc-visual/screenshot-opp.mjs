/**
 * SFDC Visual Regression Test — Opportunity Page
 *
 * Takes screenshots of MarginArc components on a real Opportunity record,
 * including clicking "Score My Deal" to verify the full flow.
 *
 * Usage:
 *   node tests/sfdc-visual/screenshot-opp.mjs [--opp-id <ID>] [--click-score] [--out-dir <dir>]
 *
 * Prerequisites:
 *   - sf CLI authenticated to the target org
 *   - Playwright installed (npx playwright install chromium)
 *   - SF_USE_GENERIC_UNIX_KEYCHAIN=true (set automatically)
 */
import { chromium } from 'playwright'
import { execSync } from 'child_process'
import { mkdirSync } from 'fs'
import { resolve } from 'path'

const args = process.argv.slice(2)
function getArg(name, fallback) {
  const idx = args.indexOf(name)
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback
}
const clickScore = args.includes('--click-score')
const outDir = resolve(getArg('--out-dir', 'tests/sfdc-visual/screenshots'))
const targetOrg = getArg('--org', 'matt.542a9844149e@agentforce.com')

mkdirSync(outDir, { recursive: true })

// Get SFDC auth
const orgJson = JSON.parse(
  execSync(
    `SF_USE_GENERIC_UNIX_KEYCHAIN=true sf org display --target-org ${targetOrg} --json 2>/dev/null`
  ).toString()
)
const { instanceUrl, accessToken } = orgJson.result

// Find an Opportunity to test
let oppId = getArg('--opp-id', null)
if (!oppId) {
  const oppJson = JSON.parse(
    execSync(
      `SF_USE_GENERIC_UNIX_KEYCHAIN=true sf data query --query "SELECT Id FROM Opportunity WHERE IsClosed = false ORDER BY Amount DESC LIMIT 1" --target-org ${targetOrg} --json 2>/dev/null`
    ).toString()
  )
  oppId = oppJson.result.records[0]?.Id
  if (!oppId) {
    console.error('No open Opportunities found')
    process.exit(1)
  }
}
console.log(`Testing Opportunity: ${oppId}`)

;(async () => {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 1600, height: 1200 } })
  const page = await context.newPage()
  page.setDefaultTimeout(60000)

  // Login via frontdoor
  console.log('Logging in via frontdoor...')
  await page.goto(`${instanceUrl}/secur/frontdoor.jsp?sid=${accessToken}`, {
    waitUntil: 'domcontentloaded',
    timeout: 60000
  })
  await page.waitForTimeout(5000)
  console.log('Logged in:', page.url())

  // Navigate to Opportunity
  console.log('Navigating to Opportunity...')
  await page.goto(`${instanceUrl}/lightning/r/Opportunity/${oppId}/view`, {
    waitUntil: 'domcontentloaded',
    timeout: 60000
  })
  await page.waitForTimeout(8000)

  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const prefix = `opp-${ts}`

  // Full page screenshot — pre-score
  await page.screenshot({ path: `${outDir}/${prefix}-full.png`, fullPage: true })
  console.log(`Saved: ${prefix}-full.png`)

  // Check for error banners
  const errors = await page.locator('.slds-notify--error, .slds-theme_error').allTextContents()
  if (errors.length > 0) {
    console.error('ERROR BANNERS DETECTED:', errors)
  }

  if (clickScore) {
    const scoreBtn = page.getByText('Score My Deal')
    if ((await scoreBtn.count()) > 0) {
      console.log('Clicking Score My Deal...')
      await scoreBtn.click()
      await page.waitForTimeout(8000)

      await page.screenshot({
        path: `${outDir}/${prefix}-scored.png`,
        fullPage: true
      })
      console.log(`Saved: ${prefix}-scored.png`)

      // Scroll to see score details
      await page.evaluate(() => window.scrollBy(0, 400))
      await page.waitForTimeout(1000)
      await page.screenshot({ path: `${outDir}/${prefix}-scored-scroll.png` })
      console.log(`Saved: ${prefix}-scored-scroll.png`)

      // Check for error toasts after scoring
      const toasts = await page.locator('.slds-notify, .toastMessage').allTextContents()
      if (toasts.length > 0) {
        console.log('TOASTS:', toasts)
      }
    } else {
      console.warn('Score My Deal button not found')
    }
  }

  // Check page title for verification
  const title = await page.title()
  console.log('Page title:', title)

  await browser.close()
  console.log('Done!')
})()
