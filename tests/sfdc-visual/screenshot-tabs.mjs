/**
 * SFDC Visual Regression Test — App Tabs
 *
 * Screenshots the main MarginArc tabs: Dashboard, Setup Wizard, Getting Started.
 *
 * Usage:
 *   node tests/sfdc-visual/screenshot-tabs.mjs [--out-dir <dir>]
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
const outDir = resolve(getArg('--out-dir', 'tests/sfdc-visual/screenshots'))
const targetOrg = getArg('--org', 'matt.542a9844149e@agentforce.com')

mkdirSync(outDir, { recursive: true })

const orgJson = JSON.parse(
  execSync(
    `SF_USE_GENERIC_UNIX_KEYCHAIN=true sf org display --target-org ${targetOrg} --json 2>/dev/null`
  ).toString()
)
const { instanceUrl, accessToken } = orgJson.result

const TABS = [
  { name: 'dashboard', path: '/lightning/n/MarginArc_Dashboard' },
  { name: 'setup', path: '/lightning/n/MarginArc_Setup' },
  { name: 'getting-started', path: '/lightning/n/MarginArc_Getting_Started' }
]

;(async () => {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 1600, height: 1200 } })
  const page = await context.newPage()
  page.setDefaultTimeout(60000)

  console.log('Logging in...')
  await page.goto(`${instanceUrl}/secur/frontdoor.jsp?sid=${accessToken}`, {
    waitUntil: 'domcontentloaded',
    timeout: 60000
  })
  await page.waitForTimeout(5000)

  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)

  for (const tab of TABS) {
    console.log(`Navigating to ${tab.name}...`)
    await page.goto(`${instanceUrl}${tab.path}`, {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    })
    await page.waitForTimeout(6000)

    await page.screenshot({
      path: `${outDir}/tab-${tab.name}-${ts}.png`,
      fullPage: true
    })
    console.log(`Saved: tab-${tab.name}-${ts}.png`)

    const errors = await page.locator('.slds-notify--error, .slds-theme_error').allTextContents()
    if (errors.length > 0) {
      console.error(`ERRORS on ${tab.name}:`, errors)
    }
  }

  await browser.close()
  console.log('Done!')
})()
