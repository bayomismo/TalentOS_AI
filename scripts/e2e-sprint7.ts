/**
 * Sprint 7 — local E2E for the Interview Kit action layer.
 *
 * Flow:
 *   1. Find an analyzed candidate in SCREENING/INTERVIEW.
 *   2. Call generateInterviewKitAction() — expect ok=true and an interviewId.
 *   3. Call getInterviewKitAction() — verify the kit, questions, scorecard.
 *   4. Call getCandidateInterviewsAction() — verify the list.
 *   5. Call markInterviewQuestionAskedAction() for a few questions.
 *   6. Call submitEvaluationAction() with scores → deterministic interviewScore.
 *   7. Verify the candidate was advanced to INTERVIEW (if it was SCREENING).
 *   8. Call submitEvaluationAction() AGAIN — expect ALREADY_SUBMITTED.
 *   9. Call getInterviewCenterAction() — verify the interview appears.
 *  10. Cleanup.
 */

import 'dotenv/config'

import { db } from '../lib/db'
import {
  generateInterviewKitAction,
  getInterviewKitAction,
  getCandidateInterviewsAction,
  getInterviewCenterAction,
  markInterviewQuestionAskedAction,
  submitEvaluationAction,
} from '../app/(app)/candidates/[id]/interview-kit/actions'

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

async function main() {
  console.log('\n=== Sprint 7 local E2E ===\n')

  // Find a candidate in SCREENING or INTERVIEW
  let candidate = await db.candidate.findFirst({
    where: { stage: { in: ['SCREENING', 'INTERVIEW'] }, matchScore: { not: null } },
    include: { hiringRequest: { include: { jobDescription: true } } },
  })
  if (!candidate) {
    // Create one
    const hr = await db.hiringRequest.findFirst({
      where: { status: 'OPEN' },
      include: { jobDescription: true },
    })
    if (!hr || !hr.jobDescription) throw new Error('No OPEN HR with JD')
    // Move an existing candidate to SCREENING if possible
    const c = await db.candidate.findFirst({ where: { hiringRequestId: hr.id } })
    if (!c) throw new Error('No candidate to use')
    candidate = await db.candidate.update({
      where: { id: c.id },
      data: { stage: 'SCREENING' },
      include: { hiringRequest: { include: { jobDescription: true } } },
    })
  }
  if (!candidate) throw new Error('No candidate found')
  const originalStage = candidate.stage
  console.log('  Candidate:', candidate.id, '·', candidate.firstName, candidate.lastName, `(${candidate.stage})`)

  // Clean up any existing interviews for this candidate to keep the test idempotent
  await db.interview.deleteMany({ where: { candidateId: candidate.id } })

  // ---------------------------------------------------------------------
  // 1. generateInterviewKitAction
  // ---------------------------------------------------------------------
  console.log('\n1. generateInterviewKitAction')
  const genRes = await generateInterviewKitAction({ candidateId: candidate.id })
  ok('ok=true', genRes.ok, genRes.ok ? '' : JSON.stringify(genRes.error).slice(0, 200))
  if (!genRes.ok) {
    await db.$disconnect()
    return
  }
  const interviewId = genRes.data.interviewId
  const kit = genRes.data.kit
  ok('interviewId returned', !!interviewId)
  ok('kit.questions length >= 8', kit.questions.length >= 8, `n=${kit.questions.length}`)
  ok('kit.scorecard length in [3, 10]', kit.scorecard.length >= 3 && kit.scorecard.length <= 10, `n=${kit.scorecard.length}`)
  ok(
    'scorecard weights sum to 100',
    kit.scorecard.reduce((a, c) => a + c.weight, 0) === 100,
    `sum=${kit.scorecard.reduce((a, c) => a + c.weight, 0)}`
  )
  ok('overview.candidateName set', !!kit.candidateName)
  ok('overview.recommendedDurationMinutes >= 15', kit.overview.recommendedDurationMinutes >= 15)

  // Check that Interview + InterviewQuestion rows were persisted
  const interview = await db.interview.findUnique({
    where: { id: interviewId },
    include: { questions: true },
  })
  ok('Interview row exists', !!interview)
  ok('Interview.kitSnapshot is set', interview?.kitSnapshot != null)
  ok(`InterviewQuestion rows = ${kit.questions.length}`, (interview?.questions.length ?? 0) === kit.questions.length)
  ok('questions have purpose field', interview?.questions[0]?.purpose != null)

  // Check Activity row
  const activities = await db.activity.findMany({
    where: { interviewId, type: 'INTERVIEW_KIT_GENERATED' },
  })
  ok('Activity row (INTERVIEW_KIT_GENERATED) created', activities.length === 1)

  // ---------------------------------------------------------------------
  // 2. getInterviewKitAction
  // ---------------------------------------------------------------------
  console.log('\n2. getInterviewKitAction')
  const kitRes = await getInterviewKitAction(interviewId)
  ok('ok=true', kitRes.ok)
  if (kitRes.ok) {
    ok('returned interviewId matches', kitRes.data.interviewId === interviewId)
    ok('questions roundtrip', kitRes.data.questions.length === kit.questions.length)
    ok('scorecard roundtrip', kitRes.data.scorecard.length === kit.scorecard.length)
    ok('meetsIndicator computed for each criterion', kitRes.data.scorecard.every(c => c.meetsIndicator.length > 10))
    ok('candidateName set', kitRes.data.candidateName.includes(candidate.firstName))
  }

  // ---------------------------------------------------------------------
  // 3. getCandidateInterviewsAction
  // ---------------------------------------------------------------------
  console.log('\n3. getCandidateInterviewsAction')
  const listRes = await getCandidateInterviewsAction(candidate.id)
  ok('ok=true', listRes.ok)
  if (listRes.ok) {
    ok('list contains the new interview', listRes.data.items.some(i => i.id === interviewId))
  }

  // ---------------------------------------------------------------------
  // 4. markInterviewQuestionAskedAction
  // ---------------------------------------------------------------------
  console.log('\n4. markInterviewQuestionAskedAction')
  if (interview) {
    for (let i = 0; i < Math.min(3, interview.questions.length); i++) {
      const q = interview.questions[i]
      const r = await markInterviewQuestionAskedAction({ questionId: q.id, asked: true, notes: `Note ${i}` })
      ok(`mark asked Q${i}`, r.ok)
    }
  }

  // ---------------------------------------------------------------------
  // 5. submitEvaluationAction
  // ---------------------------------------------------------------------
  console.log('\n5. submitEvaluationAction')
  if (kitRes.ok) {
    const criterionScores: Record<string, number> = {}
    for (const c of kitRes.data.scorecard) {
      // Realistic varied scores
      criterionScores[c.name] = c.name.toLowerCase().includes('communication') ? 4 : 3
    }
    const evalRes = await submitEvaluationAction({
      interviewId,
      criterionScores,
      strengths: 'Strong fundamentals, clear communicator.',
      concerns: 'Limited exposure to system design at scale.',
      overallNotes: 'Solid candidate. Worth advancing.',
      recommendation: 'HIRE',
    })
    ok('ok=true', evalRes.ok, evalRes.ok ? '' : JSON.stringify(evalRes.error).slice(0, 200))
    if (evalRes.ok) {
      const expected = Math.round(
        Object.entries(criterionScores).reduce((a, [name, s]) => {
          const c = kitRes.data.scorecard.find(c => c.name === name)!
          return a + (s / 5) * c.weight
        }, 0)
      )
      ok(`interviewScore deterministic = ${expected}`, evalRes.data.interviewScore === expected, `got=${evalRes.data.interviewScore}`)
    }
  }

  // ---------------------------------------------------------------------
  // 6. submitEvaluationAction AGAIN — expect ALREADY_SUBMITTED
  // ---------------------------------------------------------------------
  console.log('\n6. submitEvaluationAction (again, should fail)')
  if (kitRes.ok) {
    const criterionScores: Record<string, number> = {}
    for (const c of kitRes.data.scorecard) criterionScores[c.name] = 3
    const againRes = await submitEvaluationAction({
      interviewId,
      criterionScores,
      strengths: '',
      concerns: '',
      overallNotes: '',
      recommendation: 'HIRE',
    })
    ok('ok=false on second submission', !againRes.ok)
    if (!againRes.ok) ok('code = ALREADY_SUBMITTED', againRes.error.code === 'ALREADY_SUBMITTED', `code=${againRes.error.code}`)
  }

  // ---------------------------------------------------------------------
  // 7. Interview should be COMPLETED
  // ---------------------------------------------------------------------
  console.log('\n7. Interview status is COMPLETED')
  const afterInterview = await db.interview.findUnique({
    where: { id: interviewId },
    include: { evaluations: true },
  })
  ok('status = COMPLETED', afterInterview?.status === 'COMPLETED')
  ok('completedAt set', afterInterview?.completedAt != null)
  ok('evaluations.length = 1', (afterInterview?.evaluations.length ?? 0) === 1)
  if (afterInterview?.evaluations[0]) {
    ok(
      'evaluation.interviewScore persisted',
      afterInterview.evaluations[0].interviewScore != null,
      `score=${afterInterview.evaluations[0].interviewScore}`
    )
  }

  // ---------------------------------------------------------------------
  // 8. getInterviewCenterAction
  // ---------------------------------------------------------------------
  console.log('\n8. getInterviewCenterAction')
  const icRes = await getInterviewCenterAction()
  ok('ok=true', icRes.ok)
  if (icRes.ok) {
    const ids = new Set([...icRes.data.all, ...icRes.data.completed].map(i => i.id))
    ok('interview appears in Interview Center', ids.has(interviewId))
    ok(
      'completed list has it',
      icRes.data.completed.some(i => i.id === interviewId)
    )
  }

  // ---------------------------------------------------------------------
  // 9. Stage should have been advanced
  // ---------------------------------------------------------------------
  console.log('\n9. Candidate stage advanced')
  const after = await db.candidate.findUnique({ where: { id: candidate.id } })
  if (originalStage === 'SCREENING') {
    ok('stage = INTERVIEW after kit generation', after?.stage === 'INTERVIEW', `stage=${after?.stage}`)
  } else {
    ok(`stage preserved (was ${originalStage})`, after?.stage === originalStage, `stage=${after?.stage}`)
  }

  // ---------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------
  console.log('\n10. Cleanup')
  await db.interview.deleteMany({ where: { candidateId: candidate.id } })
  await db.candidate.update({ where: { id: candidate.id }, data: { stage: originalStage } })
  // Remove activities
  await db.activity.deleteMany({ where: { interviewId } })
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
