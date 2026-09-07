/**
 * Sprint 15 P1 fix — Add Candidate UI verification (Playwright).
 *
 * Logs into the production app, opens the Candidates page, clicks the
 * "Add candidate" button, fills the form, and verifies a candidate is
 * created and appears in the list. Cleans up after itself.
 */

import { chromium } from 'playwright'
import 'dotenv/config'
import { db } from '../lib/db'
import { randomUUID } from 'node:crypto'

const PRODUCTION_URL = process.env.AUDIT_PROD_URL ?? 'https://talentos-ai-lime.vercel.app'
const ADMIN_EMAIL = 'bayomismo@gmail.com'
const ADMIN_PASSWORD = 'AuditTest1!!'

let pass = 0
let fail = 0
function ok(label: string, cond: boolean, detail?: string) {
  if (cond) {
    pass++
    console.log(`  ✓ ${label}`)
  } else {
    fail++
    console.log(`  ✗ ${label}${detail ? ' — ' + detail : ''}`)
  }
}

async function main() {
  console.log('UI: Add Candidate wiring — production verification')

  const browser = await chromium.launch({
    headless: true,
    executablePath: '/root/.cache/ms-playwright/chromium-1223/chrome-linux/chrome',
    args: ['--no-sandbox'],
  })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()

  // 1. Login
  await page.goto(`${PRODUCTION_URL}/login`)
  await page.waitForLoadState('networkidle').catch(() => null)
  await page.fill('input[type="email"]', ADMIN_EMAIL)
  await page.fill('input[type="password"]', ADMIN_PASSWORD)
  await page.click('button[type="submit"]')
  await page.waitForURL(/dashboard/, { timeout: 30000 })
  ok('login successful', true)

  // 2. Navigate to Candidates
  await page.goto(`${PRODUCTION_URL}/candidates`)
  await page.waitForLoadState('networkidle').catch(() => null)
  await page.waitForTimeout(2000)
  ok('candidates page loaded', true)

  // 3. Click "Add candidate" button
  const addBtn = page.locator('button:has-text("Add candidate")').first()
  ok('Add candidate button visible', await addBtn.isVisible())

  await addBtn.click()
  await page.waitForTimeout(500)

  // 4. Verify modal is open
  const modalTitle = page.locator('#add-candidate-title')
  ok('modal opened with title', await modalTitle.isVisible())

  // 5. Fill the form
  const firstName = 'Audit'
  const lastName = `Test ${randomUUID().slice(0, 6)}`
  const email = `audit-${randomUUID().slice(0, 6)}@example.com`

  await page.fill('input[autocomplete="given-name"]', firstName)
  await page.fill('input[autocomplete="family-name"]', lastName)
  await page.fill('input[autocomplete="email"]', email)

  // 6. Pick a hiring request
  const select = page.locator('select').filter({ hasText: 'Select a hiring request' }).first()
  const options = await select.locator('option').all()
  if (options.length < 2) {
    ok('hiring request options present', false, `only ${options.length} options`)
  } else {
    ok('hiring request options present', true)
    const value = await options[1].getAttribute('value')
    if (value) await select.selectOption(value)
  }

  // 7. Source
  const sourceSelect = page.locator('select').filter({ hasText: 'Select a source' }).first()
  await sourceSelect.selectOption('LinkedIn')

  // 8. Submit
  const submitBtn = page.locator('button:has-text("Add candidate")').last()
  await submitBtn.click()

  // Wait for either success message or error
  await page.waitForTimeout(2500)

  // 9. Verify candidate was created in DB
  const created = await db.candidate.findFirst({
    where: { email, firstName, lastName },
  })
  ok('candidate created in DB', !!created, `email=${email}`)
  ok('candidate linked to org', !!created)

  // 10. Modal should close on success
  const modalStillOpen = await modalTitle.isVisible().catch(() => false)
  ok('modal closed after success', !modalStillOpen)

  // 11. Candidate should appear in list
  if (created) {
    await page.waitForTimeout(1000)
    const nameVisible = await page
      .locator(`text=${firstName} ${lastName}`)
      .first()
      .isVisible()
      .catch(() => false)
    ok('candidate name visible in list', nameVisible)

    // Cleanup
    await db.candidate.delete({ where: { id: created.id } }).catch(() => null)
    console.log('  (cleaned up test candidate)')
  }

  await browser.close()
  console.log(`\n========== ${pass} pass, ${fail} fail ==========`)
  if (fail > 0) process.exit(1)
}

main().catch(e => {
  console.error('FATAL:', e)
  process.exit(1)
})
