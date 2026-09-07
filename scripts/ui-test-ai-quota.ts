import { chromium } from 'playwright'
import 'dotenv/config'

async function main() {
  let pass = 0, fail = 0
  const ok = (label: string, cond: boolean, detail?: string) => {
    if (cond) { pass++; console.log(`  ✓ ${label}`) }
    else { fail++; console.log(`  ✗ ${label}${detail ? ' — ' + detail : ''}`) }
  }

  const browser = await chromium.launch({
    headless: true,
    executablePath: '/root/.cache/ms-playwright/chromium-1223/chrome-linux/chrome',
    args: ['--no-sandbox'],
  })
  const page = await browser.newContext({ viewport: { width: 1440, height: 900 } }).then(c => c.newPage())

  // Login
  await page.goto('http://localhost:3001/login')
  await page.waitForLoadState('domcontentloaded')
  await page.waitForTimeout(1000)
  await page.fill('input[type="email"]', 'bayomismo@gmail.com')
  await page.fill('input[type="password"]', 'AuditTest1!!')
  await page.click('button[type="submit"]')
  await page.waitForTimeout(5000)
  console.log('  After login URL:', page.url())

  await page.goto('http://localhost:3001/settings')
  await page.waitForLoadState('networkidle').catch(() => null)
  await page.waitForTimeout(3000)
  console.log('  Settings URL:', page.url())

  // List the sidebar buttons
  const buttons = await page.locator('aside button').allTextContents()
  console.log('  Sidebar buttons:', buttons)

  const aiUsageLink = page.locator('button:has-text("AI Usage")')
  ok('AI Usage section visible in sidebar', await aiUsageLink.isVisible().catch(() => false))
  if (!(await aiUsageLink.isVisible().catch(() => false))) {
    await page.screenshot({ path: '/tmp/settings-fail.png' })
    await browser.close()
    console.log(`\n========== ${pass} pass, ${fail} fail ==========`)
    return
  }
  await aiUsageLink.click()
  await page.waitForTimeout(2000)

  const usageTitle = page.locator('h3:has-text("AI Usage")')
  ok('AI Usage card title visible', await usageTitle.isVisible().catch(() => false))

  const resetText = page.locator('text=resets')
  ok('Reset date text visible', await resetText.isVisible().catch(() => false))

  await page.screenshot({ path: '/tmp/ai-usage.png' })
  await browser.close()
  console.log(`\n========== ${pass} pass, ${fail} fail ==========`)
}
main().catch(e => { console.error('FATAL:', e); process.exit(1) })
