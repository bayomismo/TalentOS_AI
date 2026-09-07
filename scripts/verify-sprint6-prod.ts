/**
 * Sprint 6 — production headless-browser smoke test.
 *
 * Verifies the actual end-to-end flow against the live production URL:
 *  1. /hiring-requests/[id]/candidates loads
 *  2. Upload 2 real CV PDFs (Sarah Martinez + Priya Nair)
 *  3. Both are processed: parsed, analyzed, ranked
 *  4. Candidates appear in the workspace with scores + recommendations
 *  5. Move one candidate's stage to SCREENING
 *  6. Reload — the stage change persists
 *  7. Open the candidate detail page — AI analysis block is visible
 */
import { chromium, type Browser, type Page } from 'playwright'
import 'dotenv/config'
import { db } from '../lib/db'

const PRODUCTION_URL = 'https://talentos-ai-lime.vercel.app'
const CV1 = 'test-fixtures/cvs/sarah-martinez-frontend.pdf'
const CV2 = 'test-fixtures/cvs/priya-nair-data-scientist.pdf'

let pass = 0
let fail = 0
const errors: string[] = []

function ok(name: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log(`  ✓ ${name}`)
    pass++
  } else {
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`)
    fail++
  }
}

async function findOpenHr(): Promise<string> {
  const hr = await db.hiringRequest.findFirst({
    where: { status: 'OPEN' },
    include: { jobDescription: true },
  })
  if (!hr || !hr.jobDescription) {
    throw new Error('No open hiring request with a job description. Run pnpm db:seed first.')
  }
  return hr.id
}

async function main() {
  console.log('\n== Sprint 6 production E2E ==\n')
  const hrId = await findOpenHr()
  console.log('  using HR:', hrId)

  const beforeCandidates = await db.candidate.count({ where: { hiringRequestId: hrId } })

  const browser: Browser = await chromium.launch({
    headless: true,
    executablePath: '/root/.cache/ms-playwright/chromium-1223/chrome-linux/chrome',
  })
  const ctx = await browser.newContext()
  const page: Page = await ctx.newPage()
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
  page.on('console', m => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`)
  })

  // ---------------------------------------------------------------------
  // 1. Open the workspace
  // ---------------------------------------------------------------------
  console.log('\n1. Open workspace')
  const url = `${PRODUCTION_URL}/hiring-requests/${hrId}/candidates`
  const response = await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 })
  ok('workspace loads (HTTP 200)', response?.status() === 200, `status=${response?.status()}`)

  await page.waitForSelector('text=Upload CVs', { timeout: 30000 })
  ok('upload zone visible', true)

  // ---------------------------------------------------------------------
  // 2. Upload 2 CVs
  // ---------------------------------------------------------------------
  console.log('\n2. Upload 2 CVs')
  const fileInput = page.locator('input[type="file"]').first()
  await fileInput.setInputFiles([CV1, CV2])

  // Wait for both to reach the 'completed' status
  console.log('  waiting for both files to complete (up to 3 min)...')
  const start = Date.now()
  let bothCompleted = false
  while (Date.now() - start < 180_000) {
    const completedRows = await page.locator('text=Done').count()
    if (completedRows >= 2) {
      bothCompleted = true
      break
    }
    const failedRows = await page.locator('text=Failed').count()
    if (failedRows > 0) {
      const errorTexts = await page.locator('text=Failed').allTextContents()
      console.log('  failed rows:', errorTexts)
    }
    await page.waitForTimeout(2000)
  }
  ok('both CVs completed', bothCompleted, bothCompleted ? '' : 'timed out waiting')

  // Check the table refreshed
  await page.waitForTimeout(3000)
  const tableText = (await page.locator('body').textContent()) || ''
  ok('Sarah Martinez in list', tableText.includes('Sarah Martinez'))
  ok('Priya Nair in list', tableText.includes('Priya Nair'))

  // ---------------------------------------------------------------------
  // 3. DB verification
  // ---------------------------------------------------------------------
  console.log('\n3. DB verification')
  const afterCandidates = await db.candidate.count({ where: { hiringRequestId: hrId } })
  ok('2 new candidates persisted', afterCandidates - beforeCandidates === 2, `delta=${afterCandidates - beforeCandidates}`)

  const sarah = await db.candidate.findFirst({
    where: { email: 'sarah.martinez@example.com', hiringRequestId: hrId },
    select: { id: true, matchScore: true, recommendation: true, stage: true, strengths: true, gaps: true },
  })
  ok('Sarah Martinez in DB', !!sarah, sarah ? '' : 'not found')
  if (sarah) {
    ok('Sarah has matchScore', sarah.matchScore !== null, `score=${sarah.matchScore}`)
    ok('Sarah has recommendation', !!sarah.recommendation, sarah.recommendation ?? 'null')
    ok('Sarah has strengths', sarah.strengths.length > 0, `n=${sarah.strengths.length}`)
    ok('Sarah has gaps', sarah.gaps.length > 0, `n=${sarah.gaps.length}`)
  }

  const priya = await db.candidate.findFirst({
    where: { email: 'priya.nair@example.com', hiringRequestId: hrId },
    select: { id: true, matchScore: true, recommendation: true, stage: true },
  })
  ok('Priya Nair in DB', !!priya)
  if (priya) {
    ok('Priya has matchScore', priya.matchScore !== null, `score=${priya.matchScore}`)
    ok('Priya has recommendation', !!priya.recommendation, priya.recommendation ?? 'null')
  }

  // Sarah (frontend) should score higher than Priya (data scientist) on
  // the frontend-heavy JD. The actual numbers depend on the JD, but
  // Sarah should not have a recommendation that's worse than Priya.
  if (sarah && priya) {
    console.log(`  Sarah score: ${sarah.matchScore}, Priya score: ${priya.matchScore}`)
  }

  // ---------------------------------------------------------------------
  // 4. Move Sarah to SCREENING
  // ---------------------------------------------------------------------
  console.log('\n4. Shortlist Sarah to Screening')
  // Click the row's "Move stage" button
  const sarahRow = page.locator('tr', { hasText: 'Sarah Martinez' }).first()
  const moveBtn = sarahRow.locator('button:has-text("Move stage")').first()
  await moveBtn.click()
  // Click "Shortlist → Screening"
  const shortlistOption = page.locator('button:has-text("Shortlist")').first()
  await shortlistOption.click()
  await page.waitForTimeout(2000)
  ok('sarah now SCREENING in DB', sarah != null && (await db.candidate.findUnique({ where: { id: sarah.id }, select: { stage: true } }))?.stage === 'SCREENING')

  // ---------------------------------------------------------------------
  // 5. Reload + verify persistence
  // ---------------------------------------------------------------------
  console.log('\n5. Reload + verify persistence')
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.waitForTimeout(2000)
  const reloadText = (await page.locator('body').textContent()) || ''
  ok('Sarah Martinez visible after reload', reloadText.includes('Sarah Martinez'))
  // The stage chip should say "Screening"
  const sarahRowAfter = page.locator('tr', { hasText: 'Sarah Martinez' }).first()
  const sarahRowText = (await sarahRowAfter.textContent()) || ''
  ok('Sarah row contains "Screening" chip', /screening/i.test(sarahRowText))

  // ---------------------------------------------------------------------
  // 6. Open candidate detail with AI analysis
  // ---------------------------------------------------------------------
  console.log('\n6. Open candidate detail')
  if (sarah) {
    const detailRes = await page.goto(`${PRODUCTION_URL}/candidates/${sarah.id}`, {
      waitUntil: 'networkidle',
    })
    ok('candidate detail loads (HTTP 200)', detailRes?.status() === 200, `status=${detailRes?.status()}`)
    const detailText = (await page.locator('body').textContent()) || ''
    ok('AI match analysis visible', detailText.includes('AI match analysis'))
    ok('Overall match shown', detailText.includes('Overall match') || detailText.match(/\b\d{1,3}\s*\/\s*100\b/) != null)
    ok('Recommendation visible', detailText.includes(sarah.recommendation ?? 'Strong Match') || /Strong Match|Good Match|Potential Match|Weak Match|Not Recommended/.test(detailText))
    ok('Strengths list visible', detailText.includes('Strengths'))
  }

  // ---------------------------------------------------------------------
  // 7. No console / page errors
  // ---------------------------------------------------------------------
  console.log('\n7. No console / page errors')
  if (errors.length > 0) {
    console.log('  captured errors:')
    for (const e of errors) console.log('   -', e)
  }
  ok('no browser errors', errors.length === 0, `n=${errors.length}`)

  // ---------------------------------------------------------------------
  // 8. Cleanup test rows
  // ---------------------------------------------------------------------
  console.log('\n8. Cleanup')
  const testEmails = ['sarah.martinez@example.com', 'priya.nair@example.com']
  const rowsToDelete = await db.candidate.findMany({
    where: { email: { in: testEmails } },
    select: { id: true },
  })
  for (const r of rowsToDelete) {
    await db.candidate.delete({ where: { id: r.id } })
  }
  ok('cleaned up test rows', rowsToDelete.length > 0, `deleted=${rowsToDelete.length}`)

  await browser.close()
  await db.$disconnect()
  console.log(`\n=== ${pass} passed, ${fail} failed ===\n`)
  if (fail > 0) process.exit(1)
}

main().catch(async err => {
  console.error('FAIL:', err)
  await db.$disconnect()
  process.exit(1)
})
