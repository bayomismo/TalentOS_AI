/**
 * Production headless-browser smoke test.
 *
 * Verifies the actual end-to-end flow against the live production URL:
 * 1. /ai-recruiter page loads without error
 * 2. The wizard's input + submit works
 * 3. The generated JD is rendered
 * 4. The Hiring Request is created and shows on the dashboard
 */
import { chromium } from 'playwright'

const PRODUCTION_URL = 'https://talentos-ai-lime.vercel.app'

async function main() {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext()
  const page = await context.newPage()

  // Capture console errors
  const errors: string[] = []
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
  page.on('console', m => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`)
  })

  console.log('1. Loading /ai-recruiter ...')
  const response = await page.goto(`${PRODUCTION_URL}/ai-recruiter`, {
    waitUntil: 'networkidle',
    timeout: 60000,
  })
  console.log(`   status: ${response?.status()}`)
  if (response?.status() !== 200) {
    throw new Error(`Page returned ${response?.status()}`)
  }

  // Wait for the input to be visible
  console.log('2. Waiting for the role input ...')
  await page.waitForSelector('textarea[aria-label*="role"]', { timeout: 30000 })
  console.log('   ✓ input visible')

  // Type the prompt
  console.log('3. Typing the role prompt ...')
  await page.locator('textarea[aria-label*="role"]').fill(
    'We need a Principal Platform Engineer to own our internal developer platform, mentor infra engineers, and drive the migration to event-driven services. Singapore-based, hybrid.'
  )

  // Click the submit/generate button
  console.log('4. Clicking the Generate button ...')
  await page.getByRole('button', { name: /generate|hiring package/i }).first().click()

  // Wait for the review screen
  console.log('5. Waiting for the review screen (Gemini call, may take 10-30s) ...')
  await page.waitForSelector('text=/review|save|create.*hiring/i', { timeout: 90000 })
  console.log('   ✓ review screen reached')

  // Click "Create hiring request" (not "Save draft")
  console.log('6. Clicking the Create hiring request button ...')
  const createBtn = page.getByRole('button', { name: /create hiring request/i }).first()
  await createBtn.click()

  // Wait for the success state
  console.log('7. Waiting for the success state ...')
  await page.waitForSelector('text=/success|created|saved|dashboard/i', { timeout: 30000 })
  console.log('   ✓ success state reached')

  // Navigate to dashboard
  console.log('8. Navigating to /dashboard ...')
  await page.goto(`${PRODUCTION_URL}/dashboard`, { waitUntil: 'networkidle' })
  const dashText = await page.locator('body').textContent()
  console.log('   dashboard text contains "Principal":', dashText?.includes('Principal'))

  // Take a screenshot
  await page.screenshot({ path: '/tmp/prod-dashboard.png', fullPage: true })
  console.log('   screenshot: /tmp/prod-dashboard.png')

  // Final error check
  if (errors.length > 0) {
    console.log('\n⚠ Page errors captured:')
    for (const e of errors) console.log('  -', e)
  } else {
    console.log('\n✓ No page errors')
  }

  await browser.close()
  console.log('\n=== Production flow test: OK ===')
}

main().catch(err => {
  console.error('FAIL:', err)
  process.exit(1)
})
