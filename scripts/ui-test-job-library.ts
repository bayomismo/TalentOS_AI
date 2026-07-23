import { chromium } from 'playwright'
import 'dotenv/config'

async function main() {
  let pass = 0, fail = 0
  const ok = (label: string, cond: boolean) => {
    if (cond) { pass++; console.log(`  ✓ ${label}`) }
    else { fail++; console.log(`  ✗ ${label}`) }
  }

  const browser = await chromium.launch({
    headless: true,
    executablePath: '/root/.cache/ms-playwright/chromium-1223/chrome-linux/chrome',
    args: ['--no-sandbox'],
  })
  const page = await browser.newContext({ viewport: { width: 1440, height: 900 } }).then(c => c.newPage())

  // Login via the form
  await page.goto('http://localhost:3001/login')
  await page.fill('input[type="email"]', 'bayomismo@gmail.com')
  await page.fill('input[type="password"]', 'AuditTest1!!')
  await Promise.all([
    page.waitForNavigation({ timeout: 15000 }).catch(() => null),
    page.click('button[type="submit"]'),
  ])
  await page.waitForTimeout(2000)
  console.log('After login URL:', page.url())

  await page.goto('http://localhost:3001/job-library')
  await page.waitForLoadState('networkidle').catch(() => null)
  await page.waitForTimeout(2000)
  console.log('On job library:', page.url())

  // Check buttons enabled
  const importBtn = page.locator('button:has-text("Import from URL")')
  const newTplBtn = page.locator('button:has-text("New template")')
  ok('Import from URL button is enabled', !(await importBtn.isDisabled().catch(() => true)))
  ok('New template button is enabled', !(await newTplBtn.isDisabled().catch(() => true)))

  // Open new template modal
  await newTplBtn.click()
  await page.waitForTimeout(1500)
  const dialog = page.locator('[role="dialog"]')
  ok('New template modal opened', await dialog.isVisible().catch(() => false))
  await page.screenshot({ path: '/tmp/new-tpl-modal.png' })

  if (await dialog.isVisible()) {
    await page.fill('input[placeholder*="Senior Frontend"]', 'UI TEST: Test Template')
    await page.fill('input[placeholder*="one-liner"]', 'A template created by the UI test.')
    await page.fill('textarea[placeholder*="full job description"]', 'This is the full description used in the UI test of the new template modal.')
    await page.fill('input[placeholder*="React, TypeScript"]', 'TypeScript, Playwright, Testing')
    await page.click('button:has-text("Save template")')
    await page.waitForTimeout(3000)
    const success = page.locator('text=Template saved')
    ok('Template created successfully', await success.isVisible().catch(() => false))
  }
  await page.waitForTimeout(1500)

  // Now test the Import URL modal
  await page.goto('http://localhost:3001/job-library')
  await page.waitForLoadState('networkidle').catch(() => null)
  await page.waitForTimeout(2000)
  const importBtn2 = page.locator('button:has-text("Import from URL")')
  await importBtn2.click()
  await page.waitForTimeout(1500)
  const importDialog = page.locator('[role="dialog"]')
  ok('Import URL modal opened', await importDialog.isVisible().catch(() => false))
  await page.screenshot({ path: '/tmp/import-modal.png' })

  // Test the Use template button on a card
  const useTemplateBtn = page.locator('button:has-text("Use template")').first()
  const useDisabled = await useTemplateBtn.isDisabled().catch(() => true)
  ok('Use template button is enabled (not disabled)', !useDisabled)

  // Cleanup
  const { db } = await import('../lib/db')
  await db.jobDescription.deleteMany({ where: { title: { startsWith: 'UI TEST:' } } })
  await db.jobDescription.deleteMany({ where: { title: { in: ['Example Domain', 'Imported from example'] } } })

  await browser.close()
  console.log(`\n========== ${pass} pass, ${fail} fail ==========`)
  if (fail > 0) process.exit(1)
}
main().catch(e => { console.error('FATAL:', e); process.exit(1) })
