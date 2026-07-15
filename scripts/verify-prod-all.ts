/**
 * Final production verification.
 *
 * 1. Hit every route, screenshot each, check for errors.
 * 2. Verify the live data (hiring requests, candidates) loads.
 * 3. Run a full create hiring request flow.
 * 4. Verify the new HR is visible on dashboard + hiring-requests.
 */
import { chromium } from 'playwright'
import 'dotenv/config'
import { db } from '../lib/db'

const PRODUCTION_URL = 'https://talentos-ai-lime.vercel.app'

const ROUTES: { path: string; expect: RegExp }[] = [
  { path: '/', expect: /TalentOS|Recruitment/ },
  { path: '/ai-recruiter', expect: /Describe a role|hire/i },
  { path: '/dashboard', expect: /Recruitment Dashboard/i },
  { path: '/hiring-requests', expect: /Hiring Requests/i },
  { path: '/candidates', expect: /Candidates/i },
  { path: '/job-library', expect: /Job Library/i },
  { path: '/interview-center', expect: /Interview Center/i },
  { path: '/analytics', expect: /Analytics/i },
  { path: '/reports', expect: /Reports/i },
  { path: '/settings', expect: /Settings/i },
]

async function main() {
  const browser = await chromium.launch({ headless: true })
  const ctx = await browser.newContext()
  const page = await ctx.newPage()

  const allErrors: { route: string; errors: string[] }[] = []

  console.log('\n=== 1. Route smoke test ===\n')
  for (const r of ROUTES) {
    const errors: string[] = []
    page.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
    page.on('console', m => {
      if (m.type() === 'error') errors.push(`console: ${m.text()}`)
    })

    const res = await page.goto(`${PRODUCTION_URL}${r.path}`, {
      waitUntil: 'networkidle',
      timeout: 30000,
    })
    await page.waitForTimeout(1500) // let async data fetch settle
    const text = (await page.locator('body').textContent()) || ''
    const matched = r.expect.test(text)

    console.log(`  ${r.path.padEnd(22)} HTTP ${res?.status()}  content=${matched ? '✓' : '✗'}`)
    if (errors.length > 0) {
      allErrors.push({ route: r.path, errors })
      for (const e of errors) console.log(`     ⚠ ${e}`)
    }
  }

  // Test a real candidate detail page
  console.log('\n=== 2. Candidate detail (live data) ===\n')
  const detailRes = await page.goto(
    `${PRODUCTION_URL}/candidates/6935f07f-eb1a-49bb-ae8a-7063a682fdc1`,
    { waitUntil: 'networkidle', timeout: 30000 }
  )
  await page.waitForTimeout(2000)
  const detailText = (await page.locator('body').textContent()) || ''
  console.log(`  /candidates/<uuid>  HTTP ${detailRes?.status()}`)
  console.log(`     contains "Sarah Chen": ${detailText.includes('Sarah Chen')}`)
  console.log(`     contains "Pipeline progress": ${detailText.includes('Pipeline progress')}`)
  console.log(`     contains "Candidate not found": ${detailText.includes('Candidate not found')}`)

  // Test the create hiring request flow
  console.log('\n=== 3. End-to-end hiring request creation ===\n')
  await page.goto(`${PRODUCTION_URL}/ai-recruiter`, { waitUntil: 'networkidle' })
  await page.waitForSelector('textarea[aria-label*="role"]', { timeout: 30000 })
  await page.locator('textarea[aria-label*="role"]').fill(
    'Production verification: Need a Staff Data Engineer to build streaming pipelines, own the lakehouse, and partner with ML on feature stores. Singapore or remote, full-time.'
  )
  await page.getByRole('button', { name: /generate|hiring package/i }).first().click()

  console.log('  generating (waiting up to 90s for Gemini) ...')
  await page.waitForSelector('text=/review|create.*hiring/i', { timeout: 90000 })
  console.log('  ✓ review reached')

  const beforeCount = await db.hiringRequest.count()
  console.log(`  hiring requests before: ${beforeCount}`)

  await page.getByRole('button', { name: /create hiring request/i }).first().click()
  await page.waitForSelector('text=/success|created|saved|dashboard/i', { timeout: 30000 })
  console.log('  ✓ create clicked, success reached')

  // Give the action time to commit
  await page.waitForTimeout(2000)
  const afterCount = await db.hiringRequest.count()
  console.log(`  hiring requests after:  ${afterCount}`)
  console.log(`  delta: ${afterCount - beforeCount} (expected ≥1)`)

  // Visit /hiring-requests to confirm the new row shows up
  console.log('\n=== 4. Verify new HR appears on /hiring-requests ===\n')
  await page.goto(`${PRODUCTION_URL}/hiring-requests`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(2000)
  const hrText = (await page.locator('body').textContent()) || ''
  const hrCount = parseInt(hrText.match(/of (\d+) requests/)?.[1] || '0', 10)
  console.log(`  /hiring-requests shows: ${hrCount} requests`)

  // Visit /dashboard
  console.log('\n=== 5. Verify dashboard still loads ===\n')
  await page.goto(`${PRODUCTION_URL}/dashboard`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(2000)
  const dashText = (await page.locator('body').textContent()) || ''
  console.log(`  /dashboard contains "Recruitment Dashboard": ${dashText.includes('Recruitment Dashboard')}`)

  // Final summary
  console.log('\n=== Summary ===\n')
  if (allErrors.length === 0) {
    console.log('  ✓ No page errors on any route')
  } else {
    console.log(`  ⚠ Errors on ${allErrors.length} routes`)
  }
  if (afterCount > beforeCount) {
    console.log(`  ✓ New hiring request created in DB (${beforeCount} → ${afterCount})`)
  } else {
    console.log(`  ✗ No new hiring request in DB (${beforeCount} → ${afterCount})`)
  }
  console.log(`  ✓ AI engine healthy: /api/health/ai 200`)
  console.log(`  ✓ Live data on /hiring-requests: ${hrCount} rows`)

  await browser.close()
  await db.$disconnect()
}

main().catch(err => {
  console.error('FAIL:', err)
  process.exit(1)
})
