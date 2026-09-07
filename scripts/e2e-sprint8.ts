/**
 * Sprint 8 — local E2E for the Decision Hub action layer.
 *
 * Flow:
 *   1. Find an OPEN HR with 2+ analyzed candidates
 *   2. Call getDecisionHubAction → counts, candidates, latestBrief
 *   3. Call getComparisonAction with 2 candidates
 *   4. Call logComparisonViewedAction
 *   5. Call generateDecisionBriefAction → real Gemini call, persist AITask
 *   6. Call getDecisionHubAction again → latestBrief populated
 *   7. Call recordDecisionAction for candidate A → SELECTED
 *   8. Call getDecisionHubAction → candidate A has finalDecision
 *   9. Call recordDecisionAction for candidate B → REJECTED
 *  10. Cleanup
 */

import 'dotenv/config'
import { readFileSync } from 'fs'

import { db } from '../lib/db'
import {
  getDecisionHubAction,
  getComparisonAction,
  logComparisonViewedAction,
  generateDecisionBriefAction,
  recordDecisionAction,
} from '../features/decisions'

let pass = 0
let fail = 0
const errors: string[] = []

function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { console.log(`  ✓ ${name}`); pass++ }
  else { console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); fail++ }
}

async function ensureCandidates() {
  let hr = await db.hiringRequest.findFirst({
    where: { status: 'OPEN' },
    include: { jobDescription: true },
  })
  if (!hr || !hr.jobDescription) throw new Error('No OPEN HR with JD')
  let candidates = await db.candidate.findMany({
    where: { hiringRequestId: hr.id, matchScore: { not: null } },
    include: { skills: true, interviews: { include: { evaluations: true } } },
    orderBy: { matchScore: 'desc' },
    take: 2,
  })
  if (candidates.length < 2) {
    for (const name of ['sarah-martinez-frontend.pdf', 'priya-nair-data-scientist.pdf']) {
      const buf = readFileSync(`test-fixtures/cvs/${name}`)
      const base64 = buf.toString('base64')
      const r = await (await import('../app/(app)/hiring-requests/[id]/candidates/actions')).uploadCVsAction({
        hiringRequestId: hr.id,
        files: [{ clientId: 't-' + Date.now(), fileName: name, mimeType: 'application/pdf', base64 }],
      })
      if (!r.ok) throw new Error('upload failed: ' + JSON.stringify(r.error))
    }
    candidates = await db.candidate.findMany({
      where: { hiringRequestId: hr.id, matchScore: { not: null } },
      include: { skills: true, interviews: { include: { evaluations: true } } },
      orderBy: { matchScore: 'desc' },
      take: 2,
    })
  }
  return { hr, candidates }
}

async function main() {
  console.log('\n=== Sprint 8 local E2E ===\n')

  const { hr, candidates } = await ensureCandidates()
  if (candidates.length < 2) {
    throw new Error(`need 2 candidates, got ${candidates.length}`)
  }
  console.log('  HR:', hr.id, '·', hr.title)
  console.log('  candidates:', candidates.map(c => `${c.firstName} ${c.lastName} (${c.matchScore})`).join(', '))

  // Clean up any prior decisions / briefs / activities for this HR
  await db.candidateDecision.deleteMany({ where: { hiringRequestId: hr.id } })
  await db.aITask.deleteMany({ where: { hiringRequestId: hr.id, type: 'DECISION_BRIEF' } })
  await db.activity.deleteMany({
    where: {
      hiringRequestId: hr.id,
      type: { in: ['COMPARISON_VIEWED', 'DECISION_BRIEF_GENERATED', 'CANDIDATE_SELECTED', 'CANDIDATE_REJECTED', 'CANDIDATE_HELD', 'CANDIDATE_ADVANCED'] },
    },
  })
  console.log('  cleaned prior test data')

  // ---------------------------------------------------------------------
  // 1. getDecisionHubAction
  // ---------------------------------------------------------------------
  console.log('\n1. getDecisionHubAction')
  const hubRes = await getDecisionHubAction(hr.id)
  ok('ok=true', hubRes.ok, hubRes.ok ? '' : JSON.stringify(hubRes.error).slice(0, 200))
  if (!hubRes.ok) {
    await db.$disconnect()
    return
  }
  const hub = hubRes.data
  ok('hiringRequest.title set', !!hub.hiringRequest.title)
  ok('counts.total >= 2', hub.counts.total >= 2, `total=${hub.counts.total}`)
  ok('candidates length >= 2', hub.candidates.length >= 2)
  ok('recentActivities is an array', Array.isArray(hub.recentActivities))
  ok('latestBrief is null (clean state)', hub.latestBrief === null)

  const candA = hub.candidates[0]
  const candB = hub.candidates[1]
  ok('candidate A has readiness', !!candA.readiness)
  ok('candidate A has matchScoreBreakdown', candA.matchScoreBreakdown !== null)
  ok('candidate A has topSkills', Array.isArray(candA.topSkills) && candA.topSkills.length > 0)
  ok('candidate A has no finalDecision (clean state)', candA.finalDecision === null)

  // ---------------------------------------------------------------------
  // 2. getComparisonAction with 2 candidates
  // ---------------------------------------------------------------------
  console.log('\n2. getComparisonAction (2 candidates)')
  const cmpRes = await getComparisonAction(hr.id, [candA.id, candB.id])
  ok('ok=true', cmpRes.ok, cmpRes.ok ? '' : JSON.stringify(cmpRes.error).slice(0, 200))
  if (cmpRes.ok) {
    ok('candidates length = 2', cmpRes.data.candidates.length === 2)
    ok('brief is null (no brief yet)', cmpRes.data.brief === null)
  }

  // ---------------------------------------------------------------------
  // 3. logComparisonViewedAction
  // ---------------------------------------------------------------------
  console.log('\n3. logComparisonViewedAction')
  const logRes = await logComparisonViewedAction(hr.id, [candA.id, candB.id])
  ok('ok=true', logRes.ok, logRes.ok ? '' : JSON.stringify(logRes.error).slice(0, 200))
  if (logRes.ok) ok('data.logged = true', logRes.data.logged === true)
  const logCount = await db.activity.count({ where: { hiringRequestId: hr.id, type: 'COMPARISON_VIEWED' } })
  ok('Activity row (COMPARISON_VIEWED) created', logCount === 1, `count=${logCount}`)

  // ---------------------------------------------------------------------
  // 4. generateDecisionBriefAction (real Gemini call)
  // ---------------------------------------------------------------------
  console.log('\n4. generateDecisionBriefAction (real Gemini call)')
  const briefRes = await generateDecisionBriefAction({ hiringRequestId: hr.id, candidateIds: [candA.id, candB.id] })
  ok('ok=true', briefRes.ok, briefRes.ok ? '' : JSON.stringify(briefRes.error).slice(0, 200))
  if (!briefRes.ok) {
    await db.$disconnect()
    return
  }
  const brief = briefRes.data
  ok('brief has comparedCandidateIds = 2', brief.comparedCandidateIds.length === 2)
  ok('brief has executiveSummary', brief.output.executiveSummary.length > 50)
  ok('brief has candidates = 2', brief.output.candidates.length === 2)
  ok('brief has crossCandidateComparison = 1', brief.output.crossCandidateComparison.length === 1)
  ok('brief has recommendedNextSteps >= 1', brief.output.recommendedNextSteps.length >= 1)
  ok('brief modelUsed is set', !!brief.modelUsed)

  // Check AITask persisted
  const task = await db.aITask.findUnique({ where: { id: brief.id }, include: { createdBy: true } })
  ok('AITask row exists', !!task)
  ok('AITask type = DECISION_BRIEF', task?.type === 'DECISION_BRIEF')
  ok('AITask status = COMPLETED', task?.status === 'COMPLETED')
  ok('AITask result has executiveSummary', !!(task?.result as any)?.executiveSummary)

  // ---------------------------------------------------------------------
  // 5. getDecisionHubAction again — latestBrief populated
  // ---------------------------------------------------------------------
  console.log('\n5. getDecisionHubAction (latestBrief)')
  const hub2 = await getDecisionHubAction(hr.id)
  ok('ok=true', hub2.ok)
  if (hub2.ok) {
    ok('latestBrief is now set', hub2.data.latestBrief !== null)
    ok('latestBrief.comparedCandidateIds = 2', hub2.data.latestBrief?.comparedCandidateIds.length === 2)
  }

  // ---------------------------------------------------------------------
  // 6. recordDecisionAction (SELECTED for candA)
  // ---------------------------------------------------------------------
  console.log('\n6. recordDecisionAction (SELECTED for candA)')
  const decRes = await recordDecisionAction({
    candidateId: candA.id,
    hiringRequestId: hr.id,
    decision: 'SELECTED',
    notes: 'Strongest match on required skills. Strong stakeholder evidence.',
    reason: 'Best fit',
  })
  ok('ok=true', decRes.ok, decRes.ok ? '' : JSON.stringify(decRes.error).slice(0, 200))
  if (decRes.ok) {
    ok('decisionId set', !!decRes.data.decisionId)
    ok('decision = SELECTED', decRes.data.decision === 'SELECTED')
  }
  const decisionRow = await db.candidateDecision.findUnique({
    where: { candidateId_hiringRequestId: { candidateId: candA.id, hiringRequestId: hr.id } },
  })
  ok('CandidateDecision row persisted', !!decisionRow)
  ok('decision row.decision = SELECTED', decisionRow?.decision === 'SELECTED')
  const selectCount = await db.activity.count({ where: { hiringRequestId: hr.id, type: 'CANDIDATE_SELECTED' } })
  ok('Activity row (CANDIDATE_SELECTED) created', selectCount === 1)

  // ---------------------------------------------------------------------
  // 7. recordDecisionAction (REJECT for candB)
  // ---------------------------------------------------------------------
  console.log('\n7. recordDecisionAction (REJECT for candB)')
  const decRes2 = await recordDecisionAction({
    candidateId: candB.id,
    hiringRequestId: hr.id,
    decision: 'REJECT',
    notes: 'Better fit available. Critical gap in production experience.',
  })
  ok('ok=true', decRes2.ok, decRes2.ok ? '' : JSON.stringify(decRes2.error).slice(0, 200))
  if (decRes2.ok) ok('decision = REJECT', decRes2.data.decision === 'REJECT')

  // ---------------------------------------------------------------------
  // 8. Final hub view shows decisions
  // ---------------------------------------------------------------------
  console.log('\n8. Final hub view')
  const hub3 = await getDecisionHubAction(hr.id)
  ok('ok=true', hub3.ok)
  if (hub3.ok) {
    const cA = hub3.data.candidates.find(c => c.id === candA.id)
    const cB = hub3.data.candidates.find(c => c.id === candB.id)
    ok('candA has finalDecision', cA?.finalDecision?.decision === 'SELECTED')
    ok('candB has finalDecision', cB?.finalDecision?.decision === 'REJECT')
    ok('counts.selected = 1', hub3.data.counts.selected === 1)
    ok('counts.rejected = 1', hub3.data.counts.rejected === 1)
  }

  // ---------------------------------------------------------------------
  // 9. Missing candidate from another HR is rejected
  // ---------------------------------------------------------------------
  console.log('\n9. Candidate from another HR is rejected by comparison')
  const otherCand = await db.candidate.findFirst({ where: { hiringRequestId: { not: hr.id } } })
  if (otherCand) {
    const wrongRes = await getComparisonAction(hr.id, [candA.id, otherCand.id])
    ok('ok=false (mismatched candidate)', !wrongRes.ok)
    if (!wrongRes.ok) ok('code = CANDIDATE_MISMATCH', wrongRes.error.code === 'CANDIDATE_MISMATCH')
  } else {
    console.log('  (no other HR candidate to test)')
  }

  // ---------------------------------------------------------------------
  // 10. Cleanup
  // ---------------------------------------------------------------------
  console.log('\n10. Cleanup')
  await db.candidateDecision.deleteMany({
    where: { candidateId: { in: candidates.map(c => c.id) }, hiringRequestId: hr.id },
  })
  await db.aITask.deleteMany({ where: { hiringRequestId: hr.id, type: 'DECISION_BRIEF' } })
  // Remove activities
  await db.activity.deleteMany({
    where: {
      hiringRequestId: hr.id,
      type: { in: ['COMPARISON_VIEWED', 'DECISION_BRIEF_GENERATED', 'CANDIDATE_SELECTED', 'CANDIDATE_REJECTED', 'CANDIDATE_HELD', 'CANDIDATE_ADVANCED'] },
    },
  })
  ok('cleaned up', true)

  await db.$disconnect()
  console.log(`\n=== ${pass} passed, ${fail} failed ===\n`)
  if (fail > 0) process.exit(1)
}

main().catch(async e => {
  console.error('FAIL:', e)
  await db.$disconnect()
  process.exit(1)
})
