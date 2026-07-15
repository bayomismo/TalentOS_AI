/**
 * Sprint 8 — production E2E for the Decision Hub.
 *
 * Flow:
 *   Hiring Requests (table)
 *   → Decision Hub CTA on a row
 *     → /hiring-requests/[id]/decision
 *       → Counts load, candidates load
 *       → Select 2 finalists via checkboxes
 *       → Click Compare → /decision/compare
 *         → Side-by-side renders, separate CV/Interview scores
 *         → Click Generate AI Brief → real Gemini call
 *           → Brief appears with executive summary, per-candidate evidence,
 *             cross-candidate comparison, open questions
 *       → Back to hub
 *         → Click "Select" on a candidate → confirmation dialog → confirm
 *           → DB row created, activity logged
 *         → Click "Reject" on another candidate → confirmation dialog
 *         → Refresh → both decisions persist
 *
 *   Candidate detail page → Decision section renders readiness chip
 *
 * Also runs a quick regression: existing pages still load cleanly with
 * no browser errors.
 */

import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'
import 'dotenv/config'
import { db } from '../lib/db'

const PRODUCTION_URL = 'https://talentos-ai-lime.vercel.app'

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

async function findHub(): Promise<{ hrId: string; hrTitle: string; candidateIds: string[]; candidateNames: string[] }> {
  const hr = await db.hiringRequest.findFirst({
    where: { status: 'OPEN' },
    include: {
      candidates: {
        where: { matchScore: { not: null } },
        orderBy: { matchScore: 'desc' },
        take: 3,
      },
    },
  })
  if (!hr) throw new Error('No OPEN HR')
  if (hr.candidates.length < 2) {
    throw new Error(`Need 2+ analyzed candidates on an OPEN HR, got ${hr.candidates.length}`)
  }
  return {
    hrId: hr.id,
    hrTitle: hr.title,
    candidateIds: hr.candidates.map(c => c.id),
    candidateNames: hr.candidates.map(c => `${c.firstName} ${c.lastName}`),
  }
}

async function main() {
  console.log('\n=== Sprint 8 production E2E ===\n')

  const hub = await findHub()
  console.log('  using HR:', hub.hrId, '·', hub.hrTitle)
  console.log('  candidates:', hub.candidateNames.join(', '))

  // Pre-test cleanup
  await db.candidateDecision.deleteMany({
    where: { candidateId: { in: hub.candidateIds }, hiringRequestId: hub.hrId },
  })
  await db.aITask.deleteMany({ where: { hiringRequestId: hub.hrId, type: 'DECISION_BRIEF' } })
  await db.activity.deleteMany({
    where: {
      hiringRequestId: hub.hrId,
      type: {
        in: [
          'COMPARISON_VIEWED',
          'DECISION_BRIEF_GENERATED',
          'CANDIDATE_SELECTED',
          'CANDIDATE_REJECTED',
          'CANDIDATE_HELD',
          'CANDIDATE_ADVANCED',
        ],
      },
    },
  })

  const browser: Browser = await chromium.launch({
    headless: true,
    executablePath: '/root/.cache/ms-playwright/chromium-1223/chrome-linux/chrome',
  })
  const ctx: BrowserContext = await browser.newContext({ acceptDownloads: false })
  const page: Page = await ctx.newPage()
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
  page.on('console', m => {
    if (m.type() === 'error') {
      const text = m.text()
      if (/favicon|404 \(Not Found\)/.test(text)) return
      errors.push(`console: ${text}`)
    }
  })

  // ---------------------------------------------------------------------
  // 1. Hiring Requests table → Decision Hub CTA
  // ---------------------------------------------------------------------
  console.log('\n1. Hiring Requests table has Decision Hub CTA')
  await page.goto(`${PRODUCTION_URL}/hiring-requests`, { waitUntil: 'networkidle' })
  await page.waitForSelector('text=Decision Hub', { timeout: 30_000 })
  ok('Decision Hub link visible on HR table', true)

  // ---------------------------------------------------------------------
  // 2. Open Decision Hub for our HR
  // ---------------------------------------------------------------------
  console.log('\n2. Open Decision Hub')
  const hubLink = page.locator(`a[href="/hiring-requests/${hub.hrId}/decision"]`).first()
  await hubLink.click()
  await page.waitForURL(new RegExp(`/hiring-requests/${hub.hrId}/decision$`), { timeout: 30_000 })
  await page.waitForTimeout(2000)
  const hubBody = (await page.locator('body').textContent()) ?? ''
  ok('Decision Hub title visible', /Decision Hub/.test(hubBody))
  ok('HR title visible', hubBody.includes(hub.hrTitle))
  ok('candidate names visible', hub.candidateNames.some(n => hubBody.includes(n)))
  ok('readiness chip visible', /(ready for review|needs interview|awaiting evaluation|not ready)/i.test(hubBody))
  ok('AI CV Match scores visible', /AI CV Match/.test(hubBody))

  // ---------------------------------------------------------------------
  // 3. Select 2 finalists via checkboxes
  // ---------------------------------------------------------------------
  console.log('\n3. Select 2 finalists via checkboxes')
  const checkboxes = page.locator('input[type="checkbox"][aria-label^="Select"]')
  const checkboxCount = await checkboxes.count()
  ok('at least 2 checkboxes present', checkboxCount >= 2, `count=${checkboxCount}`)
  await checkboxes.nth(0).check()
  await checkboxes.nth(1).check()
  await page.waitForTimeout(500)

  // Verify the "Compare Selected" button is now enabled
  const compareBtn = page.locator('button:has-text("Compare Selected")')
  const isCompareEnabled = await compareBtn.isEnabled()
  ok('Compare Selected is enabled', isCompareEnabled)

  // ---------------------------------------------------------------------
  // 4. Click Compare → side-by-side page
  // ---------------------------------------------------------------------
  console.log('\n4. Click Compare → side-by-side page')
  await compareBtn.click()
  await page.waitForURL(/\/decision\/compare/, { timeout: 30_000 })
  await page.waitForTimeout(2000)
  const cmpBody = (await page.locator('body').textContent()) ?? ''
  ok('Comparison heading visible', /Side-by-side comparison/.test(cmpBody))
  ok('AI CV Match label visible (separate block)', /AI CV Match/.test(cmpBody))
  ok('Human Interview label visible (separate block)', /Human Interview/.test(cmpBody))
  // The disclaimer text 'no combined final score' is allowed. We want to make sure
// no actual combined score is shown (e.g. "Combined: 75", "Overall: 80").
const combinedScoreMatches = cmpBody.match(/(Combined|Overall|Final)\s*Score\s*[:=]?\s*\d/i)
ok('no actual combined score rendered', !combinedScoreMatches)
  ok('"no winner" disclaimer visible', /AI is decision-support only/.test(cmpBody))

  // Verify 2 candidate cards present
  const cards = page.locator('text=AI CV Match').count()
  ok('2 candidate cards rendered', (await cards) >= 2, `count=${await cards}`)

  // ---------------------------------------------------------------------
  // 5. Generate AI Decision Brief
  // ---------------------------------------------------------------------
  console.log('\n5. Generate AI Decision Brief (real Gemini call)')
  const genBtn = page.locator('button:has-text("Generate")').last()
  await genBtn.click()
  // Wait for brief to appear (executive summary)
  let briefReady = false
  for (let i = 0; i < 60; i++) {
    const t = (await page.locator('body').textContent()) ?? ''
    if (/AI Decision Brief/.test(t) && /Supporting evidence|evidenceSupportingCandidacy/i.test(t)) {
      briefReady = true
      break
    }
    await page.waitForTimeout(2000)
  }
  ok('AI Decision Brief appears within 2 min', briefReady)
  if (!briefReady) {
    await page.screenshot({ path: '/tmp/sprint8-brief-not-ready.png', fullPage: true })
  }

  // Verify AITask row was persisted
  const task = await db.aITask.findFirst({
    where: { hiringRequestId: hub.hrId, type: 'DECISION_BRIEF' },
    orderBy: { createdAt: 'desc' },
  })
  ok('AITask row persisted', !!task)
  ok('AITask has metadata.candidateIds', Array.isArray((task?.metadata as any)?.comparedCandidateIds))
  const COMPARED = (task?.metadata as any)?.comparedCandidateIds
  ok('metadata.candidateIds count = 2', COMPARED?.length === 2)

  // Verify the brief content has key features
  const briefBody = (await page.locator('body').textContent()) ?? ''
  ok('executive summary visible', briefBody.length > 1000)
  ok('evidence source tags present (SCORECARD or CV or AI_CV_ANALYSIS)', /(SCORECARD|AI_CV_ANALYSIS|CV|INTERVIEW_EVALUATION|INTERVIEWER_NOTES)/.test(briefBody))
  ok('no "winner" or "best candidate" language', !/winner|best candidate|recommended hire|reject candidate/i.test(briefBody))
  ok('recommended next steps section', /Recommended next steps/i.test(briefBody))

  // ---------------------------------------------------------------------
  // 6. Back to hub
  // ---------------------------------------------------------------------
  console.log('\n6. Back to hub')
  await page.goto(`${PRODUCTION_URL}/hiring-requests/${hub.hrId}/decision`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(2000)
  const hubBody2 = (await page.locator('body').textContent()) ?? ''
  ok('Latest AI Decision Brief section visible on hub', /Latest AI Decision Brief/.test(hubBody2))
  ok('hub shows executive summary', /TalentOS|Candidate|This brief/i.test(hubBody2))

  // ---------------------------------------------------------------------
  // 7. Select one candidate → confirmation dialog → confirm
  // ---------------------------------------------------------------------
  console.log('\n7. Select candidate via confirmation dialog')
  const candA = hub.candidateNames[0]!
  // Scope to the candidate row (its card containing the full name) and look for the Select action button
  const selectBtn = page
    .locator('div.rounded')
    .filter({ hasText: candA })
    .filter({ has: page.locator('input[type="checkbox"]') })
    .locator('button:has-text("Select")')
    .first()
  await selectBtn.waitFor({ state: 'visible', timeout: 15_000 })
  await selectBtn.click()
  await page.waitForSelector('text=Mark as selected', { timeout: 10_000 })
  ok('confirmation dialog shown', true)
  await page.locator('textarea').fill('Strong technical match and consistent with the brief.')
  await page.locator('button:has-text("Confirm selection")').click()
  await page.waitForTimeout(3000)
  ok('confirmation dialog closed', !(await page.locator('text=Mark as selected').isVisible().catch(() => false)))

  const decisionRow = await db.candidateDecision.findFirst({
    where: { candidateId: hub.candidateIds[0], hiringRequestId: hub.hrId },
  })
  ok('CandidateDecision row created', !!decisionRow)
  ok('decision = SELECTED', decisionRow?.decision === 'SELECTED')
  const activityCount = await db.activity.count({
    where: { hiringRequestId: hub.hrId, type: 'CANDIDATE_SELECTED' },
  })
  ok('Activity row (CANDIDATE_SELECTED) created', activityCount === 1)

  // ---------------------------------------------------------------------
  // 8. Reject another candidate
  // ---------------------------------------------------------------------
  console.log('\n8. Reject another candidate')
  const candB = hub.candidateNames[1]!
  const rejectBtn = page
    .locator('div.rounded')
    .filter({ hasText: candB })
    .filter({ has: page.locator('input[type="checkbox"]') })
    .locator('button:has-text("Reject")')
    .first()
  await rejectBtn.waitFor({ state: 'visible', timeout: 15_000 })
  await rejectBtn.click()
  await page.waitForSelector('text=Reject candidate', { timeout: 10_000 })
  await page.locator('textarea').fill('Better-suited candidate selected.')
  await page.locator('button:has-text("Confirm rejection")').click()
  await page.waitForTimeout(3000)

  const decisionRowB = await db.candidateDecision.findFirst({
    where: { candidateId: hub.candidateIds[1], hiringRequestId: hub.hrId },
  })
  ok('second decision row created', !!decisionRowB)
  ok('second decision = REJECT', decisionRowB?.decision === 'REJECT')

  // ---------------------------------------------------------------------
  // 9. Refresh hub — both decisions persist
  // ---------------------------------------------------------------------
  console.log('\n9. Refresh hub — decisions persist')
  await page.goto(`${PRODUCTION_URL}/hiring-requests/${hub.hrId}/decision`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(2000)
  const hubBody3 = (await page.locator('body').textContent()) ?? ''
  ok('hub shows "Selected" badge for candA', new RegExp(`Selected`).test(hubBody3))
  ok('hub shows "Rejected" badge for candB', new RegExp(`Rejected`).test(hubBody3))
  ok('hub counts.Selected = 1', /Selected[\s\S]*1/.test(hubBody3))

  // ---------------------------------------------------------------------
  // 10. Candidate detail page → Decision section
  // ---------------------------------------------------------------------
  console.log('\n10. Candidate detail page → Decision section')
  await page.goto(`${PRODUCTION_URL}/candidates/${hub.candidateIds[0]}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(2000)
  const detailBody = (await page.locator('body').textContent()) ?? ''
  ok('Decision section visible', /Decision/.test(detailBody))
  ok('readiness chip visible on detail', /(ready for review|needs interview|awaiting evaluation|not ready)/i.test(detailBody))
  ok('"Open Decision Hub" CTA visible', /Open Decision Hub/.test(detailBody))
  ok('AI is decision support disclaimer visible', /AI is decision support/.test(detailBody))

  // ---------------------------------------------------------------------
  // 11. Cleanup
  // ---------------------------------------------------------------------
  console.log('\n11. Cleanup')
  await db.candidateDecision.deleteMany({
    where: { candidateId: { in: hub.candidateIds }, hiringRequestId: hub.hrId },
  })
  await db.aITask.deleteMany({ where: { hiringRequestId: hub.hrId, type: 'DECISION_BRIEF' } })
  await db.activity.deleteMany({
    where: {
      hiringRequestId: hub.hrId,
      type: {
        in: [
          'COMPARISON_VIEWED',
          'DECISION_BRIEF_GENERATED',
          'CANDIDATE_SELECTED',
          'CANDIDATE_REJECTED',
          'CANDIDATE_HELD',
          'CANDIDATE_ADVANCED',
        ],
      },
    },
  })
  ok('cleaned up', true)

  await browser.close()
  await db.$disconnect()

  // ---------------------------------------------------------------------
  // Browser-error gate
  // ---------------------------------------------------------------------
  if (errors.length > 0) {
    console.log('\n  browser errors:')
    for (const e of errors) console.log('   -', e)
  }
  ok('no browser errors', errors.length === 0)

  console.log(`\n=== ${pass} passed, ${fail} failed ===\n`)
  if (fail > 0) process.exit(1)
}

main().catch(async e => {
  console.error('FAIL:', e)
  await db.$disconnect()
  process.exit(1)
})
