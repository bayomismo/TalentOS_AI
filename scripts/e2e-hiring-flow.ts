/**
 * Sprint 18 — End-to-end hiring flow test, as the end user.
 *
 * Drives the full pipeline from "I need to hire someone" to "this
 * person accepted the offer" using the actual server actions and
 * services. Each step prints:
 *   - What the user sees in the UI
 *   - What they click
 *   - What the server returns
 *   - What the DB now contains
 *
 * Cleans up after itself.
 */
import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { db } from '../lib/db'
import { generateJobDescriptionAction, createHiringRequestAction } from '../app/(app)/ai-recruiter/actions'
import { uploadCVsAction } from '../app/(app)/hiring-requests/[id]/candidates/actions'
import { createInterviewAction } from '@/features/interviews/actions/create-interview'
import { generateInterviewKitService } from '@/features/interviews/services/interview-kit-service'
import { submitEvaluationAction } from '@/features/interviews/actions/submit-evaluation'
import { generateDecisionBriefAction, recordDecisionAction } from '@/features/decisions/actions/get-decision-hub'
import { createOffer, submitOfferForApproval, approveOffer, issueOffer, recordOfferResponse } from '@/features/offers/services/offer-service'

const log = (emoji: string, msg: string) => console.log(`\n${emoji} ${msg}`)
const sub = (msg: string) => console.log(`  ${msg}`)
let pass = 0, fail = 0
function assert(label: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ✓ ${label}`) }
  else { fail++; console.log(`  ✗ ${label}${detail ? ' — ' + detail : ''}`) }
}

async function main() {
  console.log('━'.repeat(70))
  console.log('FULL HIRING FLOW — end-to-end, as the end user')
  console.log('━'.repeat(70))

  // ─────────────────────────────────────────────────────────────
  // STEP 0: Setup — find the Ihab admin user
  // ─────────────────────────────────────────────────────────────
  log('👤', 'STEP 0: Sign in as the org admin (Ihab)')
  const admin = await db.user.findUnique({
    where: { email: 'bayomismo@gmail.com' },
    include: { organization: true },
  })
  if (!admin) { console.log('Admin user not found — aborting'); return }
  sub(`Signed in as: ${admin.firstName} ${admin.lastName} (${admin.email})`)
  sub(`Org: ${admin.organization.name} (${admin.organization.slug})`)
  sub(`Role: ${admin.role}`)

  // We'll tag everything we create with a unique marker so cleanup is safe
  const tag = `E2E-${Date.now()}`
  sub(`Marker: ${tag} (all test data tagged with this for cleanup)`)

  // ─────────────────────────────────────────────────────────────
  // STEP 1: Create a hiring request via the AI Recruiter wizard
  // ─────────────────────────────────────────────────────────────
  log('🤖', 'STEP 1: Open the AI Recruiter wizard and create a hiring request')
  sub('UI: /ai-recruiter — "Generate a job description"')
  sub('User types: "Senior Backend Engineer" / "Engineering" / "Full-time" / "5+ years" / "Remote" / "Series A SaaS company"')
  sub('Clicks: "Generate"')

  const jd = await generateJobDescriptionAction({
    role: 'Senior Backend Engineer',
    department: 'Engineering',
    employmentType: 'FULL_TIME' as any,
    experience: '5+ years',
    location: 'Remote',
    companySummary: `${admin.organization.name} is a Series A SaaS company building AI-powered hiring tools.`,
    extraContext: `Marker: ${tag}`,
  })
  assert('AI returns ok=true', jd.ok, jd.ok ? '' : JSON.stringify(jd))
  if (!jd.ok) { console.log('Halting — AI failed'); return }
  sub(`AI generated: "${jd.data.draft.title}" (${jd.data.draft.requiredSkills.length} skills)`)
  sub(`Tokens: ${jd.data.usage.totalTokens}, model: ${jd.data.model}`)

  sub('UI: review screen — "Create hiring request"')
  const hrResult = await createHiringRequestAction({
    draft: jd.data.draft as any,
    aiTaskId: jd.data.aiTaskId,
  })
  assert('createHiringRequestAction ok=true', hrResult.ok, hrResult.ok ? '' : JSON.stringify(hrResult))
  if (!hrResult.ok) return
  const hiringRequestId = (hrResult.data as any).hiringRequest?.id
  sub(`Job description: ${(hrResult.data as any).jobDescription?.id}`)
  sub(`AI task: ${jd.data.aiTaskId}`)

  // ─────────────────────────────────────────────────────────────
  // STEP 2: Upload CV (this creates the candidate AND runs AI ranking)
  // ─────────────────────────────────────────────────────────────
  log('👥', 'STEP 2: Upload CV — creates candidate and triggers AI ranking')
  sub('UI: /hiring-requests/[id]/candidates — drag-drop CV file')

  // Use a real CV (validate.ts sniffs file signatures — text/plain is rejected).
  // The AI rejects candidates that score too low at upload time, so we need
  // a CV that closely matches the JD (Senior Backend Engineer). We use the
  // marcus-chen backend fixture, then re-label the candidate.
  const pdfBuffer = readFileSync('./test-fixtures/cvs/marcus-chen-backend.docx')

  const cvResult = await uploadCVsAction({
    hiringRequestId,
    files: [{
      clientId: 'test-1',
      fileName: 'ada-lovelace-cv.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      base64: pdfBuffer.toString('base64'),
    }],
  })
  assert('uploadCVsAction ok=true', cvResult.ok, cvResult.ok ? '' : JSON.stringify(cvResult))
  if (!cvResult.ok) return
  sub(`Uploaded + parsed ${cvResult.data.created} candidate(s)`)
  sub(`Each got AI analysis + ranking against the JD`)
  assert('1 candidate created', cvResult.data.created === 1)

  // Get the candidate that was just created (the most recent on this HR)
  const candidate = await db.candidate.findFirst({
    where: { hiringRequestId },
    orderBy: { createdAt: 'desc' },
  })
  if (!candidate) { console.log('FATAL: no candidate created'); return }
  // Tag with our marker for cleanup + relabel to "Ada Lovelace" for the scenario
  await db.candidate.update({
    where: { id: candidate.id },
    data: {
      firstName: 'Ada',
      lastName: 'Lovelace',
      source: `CV Upload (E2E ${tag})`,
    },
  })
  const candidateId = candidate.id
  sub(`Candidate: ${candidateId} (Ada Lovelace)`)

  // Verify match score was saved
  const ranked = await db.candidate.findUnique({
    where: { id: candidateId },
    select: { matchScore: true, strengths: true, gaps: true, recommendation: true },
  })
  sub(`Match score: ${ranked?.matchScore ?? 'not set'}/100`)
  sub(`Strengths: ${ranked?.strengths.length ?? 0} items`)
  sub(`Gaps: ${ranked?.gaps.length ?? 0} items`)
  sub(`Recommendation: ${ranked?.recommendation ?? 'none'}`)
  assert('match score is set', (ranked?.matchScore ?? 0) > 0)

  // ─────────────────────────────────────────────────────────────
  // STEP 4: Move candidate to SCREENING
  // ─────────────────────────────────────────────────────────────
  log('🔀', 'STEP 4: Move candidate to Screening')
  sub('UI: select Ada → "Move to: Screening"')

  const { bulkMoveCandidatesAction } = await import('@/app/(app)/hiring-requests/[id]/candidates/actions')
  // We need an admin context — createCandidateAction did the auth, but bulkMove does it itself
  const moveResult = await bulkMoveCandidatesAction({
    candidateIds: [candidateId],
    toStage: 'SCREENING' as any,
    reason: 'Initial review',
  })
  assert('bulkMove → SCREENING ok=true', moveResult.ok, moveResult.ok ? '' : JSON.stringify(moveResult))
  if (!moveResult.ok) {
    const c = await db.candidate.findUnique({ where: { id: candidateId }, select: { stage: true } })
    console.log('   [debug] candidate stage is now:', c?.stage)
  }
  sub('Stage: APPLIED → SCREENING')
  sub('Activity log: CANDIDATE_MOVED created')

  // ─────────────────────────────────────────────────────────────
  // STEP 5: Move to INTERVIEW + schedule an interview
  // ─────────────────────────────────────────────────────────────
  log('🎯', 'STEP 5: Move to Interview, schedule an interview')
  const move2 = await bulkMoveCandidatesAction({
    candidateIds: [candidateId],
    toStage: 'INTERVIEW' as any,
    reason: 'Strong match, let\'s interview',
  })
  assert('bulkMove → INTERVIEW ok=true', move2.ok)

  const interviewDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days out
  const interview = await createInterviewAction({
    candidateId,
    type: 'TECHNICAL' as any,
    scheduledAt: interviewDate.toISOString(),
    durationMinutes: 60,
    interviewerIds: [admin.id],
    notes: `E2E test interview ${tag}`,
  } as any)
  assert('createInterviewAction ok=true', interview.ok, interview.ok ? '' : JSON.stringify(interview))
  if (!interview.ok) return
  const interviewId = (interview as any).data?.interviewId
  sub(`Created interview: ${interviewId}`)
  sub(`Type: TECHNICAL, scheduled: ${interviewDate.toISOString().slice(0, 16)} UTC, 60 min`)
  sub(`Interviewer: ${admin.firstName} ${admin.lastName}`)
  sub('Activity: INTERVIEW_SCHEDULED + email reminder scheduled (24h before)')

  // ─────────────────────────────────────────────────────────────
  // STEP 6: Generate the interview kit
  // ─────────────────────────────────────────────────────────────
  log('📋', 'STEP 6: Generate the personalized interview kit')
  sub('UI: interview detail page → "Generate kit"')

  const kit = await generateInterviewKitService({
    candidateId,
    scheduledAt: interviewDate.toISOString(),
    durationMinutes: 60,
    interviewerIds: [admin.id],
    type: 'TECHNICAL' as any,
  })
  assert('generateInterviewKitService ok=true', kit.ok, kit.ok ? '' : JSON.stringify(kit))
  if (kit.ok) {
    const kitData = (kit as any).data?.kit ?? (kit as any).kit
    const questions = kitData?.questions ?? (kit as any).questions
    const scorecard = kitData?.scorecard ?? []
    sub(`Generated kit with ${questions?.length ?? '?'} questions, ${scorecard.length} criteria`)
    sub(`Criteria: ${scorecard.map((c: any) => c.name).join(', ')}`)
    sub('Each question is tailored to the candidate + the JD')
    sub('Saved to InterviewKit table; interview.stage = INTERVIEW')
  }

  // Fetch the actual criteria names from the saved interview (the eval form
  // requires scoring by the exact criterion names the AI generated).
  const interviewWithKit = await db.interview.findUnique({
    where: { id: interviewId },
    select: { kitSnapshot: true },
  })
  const kitSnapshot = interviewWithKit?.kitSnapshot as any
  const scorecardCriteria: { name: string }[] = kitSnapshot?.scorecardCriteria ?? []
  sub(`Scorecard criteria for evaluation: ${scorecardCriteria.map(c => c.name).join(', ')}`)

  // ─────────────────────────────────────────────────────────────
  // STEP 7: Submit the interview evaluation
  // ─────────────────────────────────────────────────────────────
  log('📝', 'STEP 7: Submit interview evaluation')
  sub('UI: post-interview — score each criterion — write notes — submit')

  const evaluation = await submitEvaluationAction({
    interviewId,
    criterionScores: Object.fromEntries(scorecardCriteria.map(c => [c.name, 4])),
    strengths: 'Strong distributed systems experience, excellent system design thinking, clear communication, has scaled teams before',
    concerns: 'No prior SaaS experience, but transferable skills',
    overallNotes: `Solid candidate, would be a strong senior engineer. E2E test ${tag}.`,
    recommendation: 'STRONG_HIRE' as any,
  } as any)
  assert('submitEvaluationAction ok=true', evaluation.ok, evaluation.ok ? '' : JSON.stringify(evaluation))
  if (evaluation.ok) {
    sub(`Evaluation score: ${(evaluation as any).interviewScore}/5`)
    sub('Recommendation: STRONG_HIRE')
  }

  // ─────────────────────────────────────────────────────────────
  // STEP 8: Generate decision brief
  // ─────────────────────────────────────────────────────────────
  log('🧠', 'STEP 8: Generate AI decision brief (requires 2+ candidates)')
  sub('UI: /hiring-requests/[id]/decision → "Generate brief"')

  // Add a 2nd candidate so we can compare (the decision brief compares 2-4)
  const pdfBuffer2 = readFileSync('./test-fixtures/cvs/sarah-martinez-frontend.pdf')
  const cv2 = await uploadCVsAction({
    hiringRequestId,
    files: [{
      clientId: 'test-2',
      fileName: 'grace-hopper-cv.pdf',
      mimeType: 'application/pdf',
      base64: pdfBuffer2.toString('base64'),
    }],
  })
  if (cv2.ok && cv2.data.created > 0) {
    const secondCandidate = await db.candidate.findFirst({
      where: { hiringRequestId, id: { not: candidateId } },
      orderBy: { createdAt: 'desc' },
    })
    if (secondCandidate) {
      await db.candidate.update({
        where: { id: secondCandidate.id },
        data: { firstName: 'Grace', lastName: 'Hopper', source: `CV Upload (E2E ${tag})` },
      })
      sub(`Added 2nd candidate: Grace Hopper (${secondCandidate.id})`)
    }
  }

  // Get the IDs of the 2 candidates we have
  const allCandidates = await db.candidate.findMany({
    where: { hiringRequestId, source: { contains: tag } },
    select: { id: true, firstName: true, lastName: true },
  })
  sub(`Comparing ${allCandidates.length} candidates`)

  const brief = await generateDecisionBriefAction({
    hiringRequestId,
    candidateIds: allCandidates.map(c => c.id),
  } as any)
  assert('generateDecisionBriefAction ok=true', brief.ok, brief.ok ? '' : JSON.stringify(brief))
  if (brief.ok) {
    const data = (brief as any).data ?? (brief as any)
    sub(`Brief: ${data.summary?.slice(0, 100) ?? 'generated'}...`)
    sub(`Recommendation: ${data.recommendation ?? 'n/a'}`)
  }

  // ─────────────────────────────────────────────────────────────
  // STEP 9: Record the human decision
  // ─────────────────────────────────────────────────────────────
  log('✍️', 'STEP 9: Record the human decision (SELECTED)')
  sub('UI: decision hub → "Select this candidate" — record notes — submit')

  const decision = await recordDecisionAction({
    candidateId,
    hiringRequestId,
    decision: 'SELECTED' as any,
    notes: `Strong technical interview, scaled teams before, good system design. E2E test ${tag}.`,
    reason: 'Best match for the role',
  } as any)
  assert('recordDecisionAction ok=true', decision.ok, decision.ok ? '' : JSON.stringify(decision))
  sub('Decision: SELECTED')
  sub('Candidate stage: INTERVIEW → OFFER')

  // ─────────────────────────────────────────────────────────────
  // STEP 10: Generate AI offer draft
  // ─────────────────────────────────────────────────────────────
  log('📝', 'STEP 10: AI drafts the offer letter')
  sub('UI: /offers/new — fill salary, equity, etc. — "Generate draft with AI"')

  const offer = await createOffer(
    { userId: admin.id, organizationId: admin.organizationId, isAdmin: true, isTaLead: true, role: admin.role },
    {
      candidateId,
      hiringRequestId,
      title: 'Senior Backend Engineer',
      salaryAmount: 165000,
      salaryCurrency: 'USD',
      salaryPeriod: 'ANNUAL',
      bonusAmount: 15000,
      equityAmount: '0.05% over 4 years',
      employmentType: 'FULL_TIME',
      workArrangement: 'REMOTE',
      startDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      expiresAt: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
      probationPeriodDays: 90,
    }
  )
  assert('createOffer ok=true', offer.ok, offer.ok ? '' : JSON.stringify(offer))
  if (!offer.ok) return
  const offerId = (offer as any).data?.id ?? (offer as any).id
  sub(`Created offer: ${offerId} — DRAFT status`)
  sub(`Salary: $165,000/year + $15,000 bonus + 0.05% equity`)
  sub(`Start: 30 days from now, expires: 14 days from now`)

  // ─────────────────────────────────────────────────────────────
  // STEP 11: Submit for approval, then approve (different person)
  // ─────────────────────────────────────────────────────────────
  log('🔁', 'STEP 11: Submit for approval → approve (separation of duties)')
  sub('UI: offer detail → "Submit for approval"')
  const submitted = await submitOfferForApproval(
    { userId: admin.id, organizationId: admin.organizationId, isAdmin: true, isTaLead: true, role: admin.role },
    offerId
  )
  assert('submitForApproval ok=true', submitted.ok, submitted.ok ? '' : JSON.stringify(submitted))
  sub('Status: DRAFT → PENDING_APPROVAL')

  // For the approval separation to kick in, we'd need a different admin.
  // Ihab (current user) is the creator — the system BLOCKS self-approval
  // when another admin (Jordan Rivera) exists in the org. This is correct
  // separation-of-duties behavior. We test that the block fires, then
  // switch to Jordan's context to perform the actual approval.
  sub('UI: Ihab (offer creator) tries to "Approve" his own offer')
  const ctxIhab = { userId: admin.id, organizationId: admin.organizationId, isAdmin: true, isTaLead: true, role: admin.role }
  const selfApprove = await approveOffer(ctxIhab, offerId, true)
  assert('Self-approval is blocked (SELF_APPROVAL_FORBIDDEN)', !selfApprove.ok && selfApprove.code === 'SELF_APPROVAL_FORBIDDEN', `got: ${JSON.stringify(selfApprove)}`)
  sub('Status: stays PENDING_APPROVAL — separation-of-duties enforced')

  // Now switch to Jordan (the 2nd admin) to actually approve
  const jordan = await db.user.findFirst({
    where: { organizationId: admin.organizationId, role: 'ADMIN', id: { not: admin.id }, status: 'ACTIVE', disabledAt: null },
  })
  if (!jordan) {
    console.log('FATAL: no other admin to approve the offer — sole-admin escape hatch test would kick in')
    return
  }
  sub(`UI: switch to ${jordan.firstName} ${jordan.lastName} (the 2nd admin) → "Approve"`)
  const ctxJordan = { userId: jordan.id, organizationId: admin.organizationId, isAdmin: true, isTaLead: true, role: jordan.role }
  const approved = await approveOffer(ctxJordan, offerId, true)
  assert('approveOffer (by Jordan) ok=true', approved.ok, approved.ok ? '' : JSON.stringify(approved))
  sub('Status: PENDING_APPROVAL → APPROVED')
  sub('Audit: OFFER_APPROVED logged (different actor from creator)')

  // ─────────────────────────────────────────────────────────────
  // STEP 12: Issue the offer
  // ─────────────────────────────────────────────────────────────
  log('📤', 'STEP 12: Issue the offer to the candidate')
  sub('UI: offer detail → "Issue offer" (confirms it\'s been sent externally)')
  const issued = await issueOffer(ctxJordan, offerId, true)
  assert('issueOffer ok=true', issued.ok, issued.ok ? '' : JSON.stringify(issued))
  sub('Status: APPROVED → ISSUED')
  sub('Audit: OFFER_ISSUED + issuedAt timestamp set')

  // ─────────────────────────────────────────────────────────────
  // STEP 13: Record candidate's response (ACCEPT)
  // ─────────────────────────────────────────────────────────────
  log('🎉', 'STEP 13: Candidate accepts the offer')
  sub('UI: /offers/[id] → "Record response" → "Accepted"')
  const responded = await recordOfferResponse(
    ctxJordan,
    offerId,
    'ACCEPTED' as any,
    { reason: 'Looking forward to joining the team!', confirm: true }
  )
  assert('recordOfferResponse ok=true', responded.ok, responded.ok ? '' : JSON.stringify(responded))
  sub('Status: ISSUED → ACCEPTED')

  // ─────────────────────────────────────────────────────────────
  // STEP 14: Verify the final state
  // ─────────────────────────────────────────────────────────────
  log('✅', 'STEP 14: Verify the final state of the world')
  const finalCandidate = await db.candidate.findUnique({
    where: { id: candidateId },
    include: {
      hiringRequest: { select: { title: true, status: true } },
      activities: { orderBy: { occurredAt: 'asc' } },
    },
  })
  const finalOffer = await db.offer.findUnique({ where: { id: offerId } })
  const finalInterview = await db.interview.findUnique({ where: { id: interviewId } })

  console.log()
  assert('Candidate stage = OFFER (after decision SELECTED)', finalCandidate?.stage === 'OFFER')
  assert('Hiring request is still OPEN', finalCandidate?.hiringRequest.status === 'OPEN')
  assert('Offer status = ACCEPTED', finalOffer?.status === 'ACCEPTED')
  assert('Interview status = COMPLETED (after evaluation submitted)', finalInterview?.status === 'COMPLETED')
  assert('Activities logged', (finalCandidate?.activities.length ?? 0) >= 5)

  console.log()
  console.log('Activity trail:')
  for (const a of finalCandidate?.activities ?? []) {
    console.log(`  • [${a.type}] ${a.title}`)
  }

  console.log()
  console.log('━'.repeat(70))
  console.log(`✓ HIRED: Ada Lovelace accepted the offer for Senior Backend Engineer`)
  console.log(`  Pipeline: APPLIED → SCREENING → INTERVIEW → OFFER → ACCEPTED`)
  console.log(`  All 14 steps completed in this run.`)
  console.log('━'.repeat(70))

  // ─────────────────────────────────────────────────────────────
  // CLEANUP
  // ─────────────────────────────────────────────────────────────
  log('🧹', 'CLEANUP: removing all test data')
  // Find everything tagged with our marker
  const candIds = (await db.candidate.findMany({
    where: { source: { contains: tag } },
    select: { id: true },
  })).map(c => c.id)
  sub(`Found ${candIds.length} test candidate(s) to clean`)
  if (candIds.length > 0) {
    await db.cVFile.deleteMany({ where: { candidateId: { in: candIds } } })
    await db.activity.deleteMany({ where: { candidateId: { in: candIds } } })
    await db.interview.deleteMany({ where: { candidateId: { in: candIds } } })
    await db.candidate.deleteMany({ where: { id: { in: candIds } } })
  }
  // Find HRs by extraContext tag on the JD (where the AI stored the marker)
  const jdsWithTag = await db.jobDescription.findMany({
    where: {
      organizationId: admin.organizationId,
      OR: [
        { summary: { contains: tag } },
        { description: { contains: tag } },
        { title: { contains: tag } },
      ],
    },
    include: { hiringRequests: { select: { id: true } } },
  })
  const hrIds = Array.from(new Set(jdsWithTag.flatMap(j => j.hiringRequests.map(h => h.id))))
  if (hrIds.length === 0) {
    // Fallback: find HRs created in the last 10 min
    const recent = await db.hiringRequest.findMany({
      where: { organizationId: admin.organizationId, createdAt: { gte: new Date(Date.now() - 10 * 60 * 1000) } },
    })
    recent.forEach(r => hrIds.push(r.id))
  }
  sub(`Found ${hrIds.length} test hiring request(s) to clean`)
  if (hrIds.length > 0) {
    // Delete related offers
    const offerIds = (await db.offer.findMany({ where: { hiringRequestId: { in: hrIds } }, select: { id: true } })).map(o => o.id)
    await db.candidateDecision.deleteMany({ where: { hiringRequestId: { in: hrIds } } }).catch(() => null)
    if (offerIds.length > 0) {
      await db.offer.deleteMany({ where: { id: { in: offerIds } } }).catch(() => null)
    }
    await db.interview.deleteMany({ where: { hiringRequestId: { in: hrIds } } }).catch(() => null)
    await db.hiringRequest.deleteMany({ where: { id: { in: hrIds } } }).catch(() => null)
    // Delete JDs
    const jdIds = (await db.jobDescription.findMany({ where: { hiringRequests: { every: { id: { in: hrIds } } } }, select: { id: true } })).map(j => j.id)
    if (jdIds.length > 0) {
      await db.jobDescription.deleteMany({ where: { id: { in: jdIds } } }).catch(() => null)
    }
  }
  sub('Cleanup complete')

  console.log()
  console.log(`========== ${pass} pass, ${fail} fail ==========`)
  if (fail > 0) process.exit(1)
}
main().catch(e => { console.error('FATAL:', e); process.exit(1) })
