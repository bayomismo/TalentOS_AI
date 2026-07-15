/**
 * Sprint 7 — production E2E for the AI Personalized Interview Kit
 * + Structured Evaluation flow.
 *
 * Drives a real user through the entire flow with no manual URL
 * editing:
 *
 *   Hiring Request
 *   → Candidate Workspace (UI)
 *     → Analyzed candidate row
 *       → "Interview Kit" button (gated by SCREENING/INTERVIEW)
 *         → /candidates/[id]/interview-kit
 *           → Generate (or reuse) the kit
 *             → Questions, scorecard rendered
 *               → Start evaluation
 *                 → Submit scores + notes + recommendation
 *                   → Deterministic score displayed
 *                     → Reload /candidates/[id] → interview results block
 *                     → /interview-center → completed interview appears
 *
 * Also runs a quick regression: Hiring Requests page + workspace +
 * interview center all load cleanly with no browser errors.
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

async function findEligibleCandidate(): Promise<{ id: string; name: string; hrId: string }> {
  // Use the same one Sprint 6.1 created, OR create a SCREENING candidate
  let candidate = await db.candidate.findFirst({
    where: { matchScore: { not: null }, stage: { in: ['SCREENING', 'INTERVIEW'] } },
    include: { hiringRequest: { select: { id: true, title: true } } },
  })
  if (!candidate) {
    // Move any analyzed candidate to SCREENING
    const c = await db.candidate.findFirst({ where: { matchScore: { not: null } } })
    if (!c) throw new Error('No analyzed candidate in DB')
    candidate = await db.candidate.update({
      where: { id: c.id },
      data: { stage: 'SCREENING' },
      include: { hiringRequest: { select: { id: true, title: true } } },
    })
  }
  return {
    id: candidate.id,
    name: `${candidate.firstName} ${candidate.lastName}`,
    hrId: candidate.hiringRequestId,
  }
}

async function main() {
  console.log('\n=== Sprint 7 production E2E ===\n')

  // Pre-test cleanup — remove any prior interview for this candidate
  const target = await findEligibleCandidate()
  console.log('  using candidate:', target.id, '·', target.name, '· HR', target.hrId)
  await db.interview.deleteMany({ where: { candidateId: target.id } })
  await db.candidate.update({ where: { id: target.id }, data: { stage: 'SCREENING' } })

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
      // Ignore favicon and 404 on dev-only resources
      if (/favicon|404 \(Not Found\)/.test(text)) return
      errors.push(`console: ${text}`)
    }
  })

  // ---------------------------------------------------------------------
  // 1. Navigate to /candidates/<id> directly to verify it loads.
  // ---------------------------------------------------------------------
  console.log('\n1. Candidate detail page loads')
  await page.goto(`${PRODUCTION_URL}/candidates/${target.id}`, { waitUntil: 'networkidle' })
  const candidateBody = (await page.locator('body').textContent()) ?? ''
  ok('candidate name visible', candidateBody.includes(target.name))
  ok('Interview section visible', /Interview/.test(candidateBody))

  // ---------------------------------------------------------------------
  // 2. Open workspace, then click "Interview Kit" on a row.
  // ---------------------------------------------------------------------
  console.log('\n2. Open workspace via Candidate Workspace CTA')
  await page.goto(`${PRODUCTION_URL}/hiring-requests/${target.hrId}/candidates`, { waitUntil: 'networkidle' })
  await page.waitForSelector('text=Interview Kit', { timeout: 30_000 })
  const wsBody = (await page.locator('body').textContent()) ?? ''
  ok('workspace table has Interview Kit CTA', wsBody.includes('Interview Kit'))

  // Find the row for our candidate, click its Interview Kit button
  const targetRow = page.locator('tr', { hasText: target.name.split(' ')[0] }).first()
  await targetRow.locator('button:has-text("Interview Kit")').first().click()
  await page.waitForURL(/\/candidates\/.+\/interview-kit$/, { timeout: 30_000 })
  ok('navigated to /candidates/[id]/interview-kit', /\/candidates\/.+\/interview-kit$/.test(page.url()), page.url())

  // ---------------------------------------------------------------------
  // 3. Generate the kit
  // ---------------------------------------------------------------------
  console.log('\n3. Generate interview kit (real Gemini call)')
  await page.waitForTimeout(2000)
  const kitBody0 = (await page.locator('body').textContent()) ?? ''
  if (kitBody0.includes('No interview kit yet') || kitBody0.includes('Generate Interview Kit')) {
    const genBtn = page.locator('button:has-text("Generate Interview Kit")').first()
    if (await genBtn.count() > 0) {
      console.log('  clicking Generate (this will take ~10s)...')
      await genBtn.click()
    } else {
      // Stage might be wrong, try one more time
      await page.reload({ waitUntil: 'networkidle' })
    }
  }
  // Wait for either an interview kit to appear (questions / scorecard) or
  // the "No interview kit yet" state to go away
  let kitReady = false
  for (let i = 0; i < 90; i++) {
    const txt = (await page.locator('body').textContent()) ?? ''
    if (/Scorecard|Questions\s*\(\d+\)/i.test(txt) && !/No interview kit yet/.test(txt)) {
      kitReady = true
      break
    }
    await page.waitForTimeout(2000)
  }
  ok('kit ready within 3 min', kitReady)
  if (!kitReady) {
    await page.screenshot({ path: '/tmp/sprint7-kit-not-ready.png', fullPage: true })
  }

  // ---------------------------------------------------------------------
  // 4. Inspect the kit content
  // ---------------------------------------------------------------------
  console.log('\n4. Kit content')
  await page.waitForTimeout(2000)
  const kitBody = (await page.locator('body').textContent()) ?? ''
  ok('kit shows questions', /Questions\s*\(\d+\)/i.test(kitBody))
  ok('kit shows scorecard', /Scorecard/i.test(kitBody))
  ok('kit shows candidate name', kitBody.includes(target.name))
  ok('kit shows position', /UX\/UI Designer|Software|Data Scientist|Product Manager|Engineer/.test(kitBody))
  // Section headers for each purpose
  ok('kit shows Opening questions', /Opening/.test(kitBody))
  ok('kit shows Role-specific', /Role-specific/.test(kitBody))
  ok('kit shows Skill validation', /Skill validation/.test(kitBody))
  ok('kit shows Gap validation', /Gap validation/.test(kitBody))
  ok('kit shows Behavioral', /Behavioral/.test(kitBody))
  ok('kit shows Scenario', /Scenario/.test(kitBody))
  ok('kit shows Candidate-specific', /Candidate-specific/.test(kitBody))
  ok('kit shows Closing', /Closing/i.test(kitBody))

  // ---------------------------------------------------------------------
  // 5. Capture the interview id from the URL after "Start evaluation"
  // ---------------------------------------------------------------------
  console.log('\n5. Open evaluation form')
  const startBtn = page.locator('a:has-text("Start evaluation"), button:has-text("Start evaluation")').first()
  await startBtn.click()
  await page.waitForURL(/\/evaluate$/, { timeout: 30_000 })
  ok('navigated to /evaluate', /\/evaluate$/.test(page.url()), page.url())

  // Read the interviewId from the URL
  const m = page.url().match(/\/interview-kit\/([^/]+)\/evaluate/)
  const interviewId = m?.[1] ?? ''
  ok('interviewId extracted from URL', !!interviewId, interviewId)

  // ---------------------------------------------------------------------
  // 6. Rate all criteria, fill notes, submit
  // ---------------------------------------------------------------------
  console.log('\n6. Score all criteria + submit')
  await page.waitForSelector('text=Scorecard', { timeout: 30_000 })
  // Each criterion row has 5 buttons (1..5). Click the 4th button for each.
  const criteria = page.locator('h3:has-text("weight")')
  const count = await criteria.count()
  ok('scorecard shows multiple criteria', count >= 3, `n=${count}`)
  for (let i = 0; i < count; i++) {
    // Find the nearest 4th button (rating 4 of 5) inside this criterion's container
    const container = criteria.nth(i).locator('xpath=ancestor::div[contains(@class, "rounded-lg")][1]')
    const btn = container.locator('button:has-text("4")').first()
    await btn.click()
  }
  // Pick "Hire" recommendation (exact match — not "Strong Hire")
  await page.getByRole('button', { name: 'Hire', exact: true }).click()
  await page.locator('textarea').first().fill('Strong fundamentals, clear communicator, eager to learn.')
  await page.locator('textarea').nth(1).fill('Limited exposure to system design at scale.')
  await page.locator('textarea').nth(2).fill('Solid candidate. Worth advancing.')
  await page.locator('button:has-text("Submit evaluation")').click()

  // Wait for the success screen
  let submitted = false
  for (let i = 0; i < 30; i++) {
    const txt = (await page.locator('body').textContent()) ?? ''
    if (/Evaluation submitted/.test(txt)) {
      submitted = true
      break
    }
    await page.waitForTimeout(1000)
  }
  ok('evaluation submitted screen visible', submitted)
  if (!submitted) {
    await page.screenshot({ path: '/tmp/sprint7-submit-fail.png', fullPage: true })
  }

  // ---------------------------------------------------------------------
  // 7. DB verification — InterviewEvaluation persisted with score
  // ---------------------------------------------------------------------
  console.log('\n7. DB verification')
  if (interviewId) {
    const evaluation = await db.interviewEvaluation.findFirst({
      where: { interviewId },
    })
    ok('InterviewEvaluation row exists', !!evaluation)
    if (evaluation) {
      ok('interviewScore persisted', evaluation.interviewScore != null, `score=${evaluation.interviewScore}`)
      ok(
        'interviewScore is 80 (4/5 * 100% sum)',
        evaluation.interviewScore === 80,
        `score=${evaluation.interviewScore}`
      )
      ok('criterionScores JSON persisted', evaluation.criterionScores != null)
      ok('recommendation = HIRE', evaluation.recommendation === 'HIRE', `rec=${evaluation.recommendation}`)
    }
    const interview = await db.interview.findUnique({ where: { id: interviewId } })
    ok('interview status = COMPLETED', interview?.status === 'COMPLETED', `status=${interview?.status}`)
    ok('interview.completedAt set', interview?.completedAt != null)
  }

  // ---------------------------------------------------------------------
  // 8. Interview Center shows the completed interview
  // ---------------------------------------------------------------------
  console.log('\n8. Interview Center live data')
  await page.goto(`${PRODUCTION_URL}/interview-center`, { waitUntil: 'networkidle' })
  await page.waitForSelector('text=Interview Center', { timeout: 30_000 })
  const icBody = (await page.locator('body').textContent()) ?? ''
  ok('Interview Center shows Today/Upcoming tabs', /Today|Upcoming/.test(icBody))
  // Click the "Completed" tab
  await page.locator('button:has-text("Completed")').first().click()
  await page.waitForTimeout(1000)
  const icCompleted = (await page.locator('body').textContent()) ?? ''
  ok('Completed tab has a count', /\d+/.test(icCompleted.match(/Completed\s*(\d+)/i)?.[1] ?? ''))
  if (interviewId) {
    ok(
      'completed list shows our candidate with score',
      icCompleted.includes(target.name) && /80\s*\/\s*100/.test(icCompleted)
    )
  }

  // ---------------------------------------------------------------------
  // 9. Reload candidate detail — show interview results
  // ---------------------------------------------------------------------
  console.log('\n9. Candidate detail shows interview results')
  await page.goto(`${PRODUCTION_URL}/candidates/${target.id}`, { waitUntil: 'networkidle' })
  const detailBody = (await page.locator('body').textContent()) ?? ''
  ok('detail page shows interview score 80/100', /80\s*\/\s*100/.test(detailBody))
  ok('detail page shows recommendation Hire', /HIRE|Hire/i.test(detailBody))

  // ---------------------------------------------------------------------
  // 10. No browser errors (ignore favicon / known-benign 404s)
  // ---------------------------------------------------------------------
  console.log('\n10. No browser errors')
  if (errors.length > 0) {
    console.log('  captured errors:')
    for (const e of errors.slice(0, 5)) console.log('   -', e)
  }
  const significantErrors = errors.filter(
    e => !/favicon|404|net::ERR_/i.test(e)
  )
  ok('no significant browser errors', significantErrors.length === 0, `n=${significantErrors.length} total=${errors.length}`)

  // ---------------------------------------------------------------------
  // 11. Cleanup
  // ---------------------------------------------------------------------
  console.log('\n11. Cleanup')
  if (interviewId) {
    await db.interview.deleteMany({ where: { id: interviewId } })
    await db.activity.deleteMany({ where: { interviewId } })
  }
  ok('cleaned up', true)

  await browser.close()
  await db.$disconnect()
  console.log(`\n=== ${pass} passed, ${fail} failed ===\n`)
  if (fail > 0) process.exit(1)
}

main().catch(async e => {
  console.error('FAIL:', e)
  await db.$disconnect()
  process.exit(1)
})
