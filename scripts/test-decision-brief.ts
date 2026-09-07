/**
 * Local sanity test for AIEngine.generateDecisionBrief().
 *
 * Self-seeds by reusing the first analyzed candidate + the first OPEN
 * hiring request, then asks the engine to build a Decision Brief for
 * 2 candidates. Verifies the Zod-valid output, the no-winner rule, the
 * evidence-source attribution, the cross-candidate comparison block
 * count, and the fairness clause.
 */

import 'dotenv/config'
import { readFileSync } from 'fs'

import { db } from '../lib/db'
import { getAIEngine } from '../lib/ai/service/ai-engine'
import { decisionBriefOutputSchema } from '../lib/ai/schemas/decision-brief.schema'
import { uploadCVsAction } from '../app/(app)/hiring-requests/[id]/candidates/actions'

let pass = 0
let fail = 0

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
  console.log('\n=== AIEngine.generateDecisionBrief local test ===\n')

  const hr = await db.hiringRequest.findFirst({
    where: { status: 'OPEN' },
    include: { jobDescription: true },
  })
  if (!hr || !hr.jobDescription) throw new Error('No OPEN HR with JD')
  const jd = hr.jobDescription
  console.log('  HR:', hr.id, '·', hr.title)

  // Self-seed: ensure 2 analyzed candidates exist
  let candidates = await db.candidate.findMany({
    where: { hiringRequestId: hr.id, matchScore: { not: null } },
    include: { skills: true, experiences: { orderBy: { startDate: 'desc' } }, educations: true, certifications: true },
    orderBy: { matchScore: 'desc' },
    take: 2,
  })
  if (candidates.length < 2) {
    console.log('  not enough candidates — uploading 2 CVs...')
    for (const name of ['sarah-martinez-frontend.pdf', 'priya-nair-data-scientist.pdf']) {
      const buf = readFileSync(`test-fixtures/cvs/${name}`)
      const base64 = buf.toString('base64')
      const r = await uploadCVsAction({
        hiringRequestId: hr.id,
        files: [{ clientId: 't-' + Date.now(), fileName: name, mimeType: 'application/pdf', base64 }],
      })
      if (!r.ok) throw new Error('upload failed: ' + JSON.stringify(r.error))
    }
    candidates = await db.candidate.findMany({
      where: { hiringRequestId: hr.id, matchScore: { not: null } },
      include: { skills: true, experiences: true, educations: true, certifications: true },
      orderBy: { matchScore: 'desc' },
      take: 2,
    })
  }
  if (candidates.length < 2) throw new Error('still not enough candidates')
  console.log('  candidates:', candidates.length)

  const org = await db.organization.findUnique({ where: { id: hr.organizationId } })
  const mgr = hr.hiringManagerId
    ? await db.user.findUnique({ where: { id: hr.hiringManagerId }, select: { firstName: true, lastName: true } })
    : null

  const input = {
    jobContext: {
      jobTitle: hr.title,
      jobLevel: hr.level,
      jobSummary: jd.summary ?? jd.description,
      responsibilities: jd.responsibilities,
      requiredSkills: jd.requiredSkills,
      preferredSkills: jd.niceToHave,
      qualifications: jd.requiredSkills,
      experienceRequirements: jd.responsibilities,
    },
    hiringContext: {
      openings: hr.openings,
      filled: hr.filled,
      department: org?.name ?? '—',
      location: hr.location,
      hiringManager: mgr ? `${mgr.firstName} ${mgr.lastName}` : null,
    },
    candidates: candidates.map(c => ({
      candidateId: c.id,
      candidateName: `${c.firstName} ${c.lastName}`,
      professionalProfile: {
        currentRole: c.currentTitle ?? 'Unknown',
        yearsExperience: c.yearsExperience ?? 0,
        topSkills: c.skills.map(s => s.name),
        summary: c.summary ?? undefined,
      },
      cvMatchAnalysis: {
        overallScore: c.matchScore ?? 0,
        skillsScore: (c.matchScoreBreakdown as { skills: number; experience: number; roleAlignment: number; education: number } | null)?.skills ?? 0,
        experienceScore: (c.matchScoreBreakdown as { skills: number; experience: number; roleAlignment: number; education: number } | null)?.experience ?? 0,
        educationScore: (c.matchScoreBreakdown as { skills: number; experience: number; roleAlignment: number; education: number } | null)?.education ?? 0,
        roleScore: (c.matchScoreBreakdown as { skills: number; experience: number; roleAlignment: number; education: number } | null)?.roleAlignment ?? 0,
        recommendation: c.recommendation ?? 'POTENTIAL_MATCH',
        reasoning: c.recommendationReasoning ?? '',
        strengths: c.strengths,
        gaps: c.gaps,
        concerns: c.concerns,
      },
      interview: {
        hasInterview: false,
        hasEvaluation: false,
        interviewScore: null,
        recommendation: null,
        overallScore: null,
      },
    })),
  }

  console.log('\n  calling AIEngine.generateDecisionBrief()...')
  const result = await getAIEngine().generateDecisionBrief(input)
  console.log('  latency:', result.latencyMs, 'ms')

  const parsed = decisionBriefOutputSchema.safeParse(result.data)
  ok('output validates against Zod schema', parsed.success, parsed.success ? '' : JSON.stringify(parsed.error.issues).slice(0, 200))

  const brief = result.data
  ok('executiveSummary non-trivial', brief.executiveSummary.length >= 40)
  ok(`candidates length = ${input.candidates.length}`, brief.candidates.length === input.candidates.length)
  ok('candidates have keyAdvantages', brief.candidates.every(c => c.keyAdvantages.length >= 1))
  ok('candidates have roleAlignment', brief.candidates.every(c => c.roleAlignment.length >= 10))
  ok('candidates have interviewEvidenceSummary', brief.candidates.every(c => c.interviewEvidenceSummary.length >= 5))

  // Pairwise comparison: n*(n-1)/2 blocks for n candidates
  const n = input.candidates.length
  const expectedPairs = (n * (n - 1)) / 2
  ok(`crossCandidateComparison has ${expectedPairs} pair(s)`, brief.crossCandidateComparison.length === expectedPairs, `got=${brief.crossCandidateComparison.length}`)

  // No winner / hire / reject language
  const text = JSON.stringify(brief).toLowerCase()
  const forbidden = [
    /\bwe recommend\b/,
    /\brecommended hire\b/,
    /\bbest candidate\b/,
    /\bwinner\b/,
    /\bselect candidate\b/,
    /\breject candidate\b/,
  ]
  const violated = forbidden.filter(rx => rx.test(text))
  ok('no autonomous hiring language', violated.length === 0, `violated=${violated.map(r => r.source).join(',')}`)

  // Evidence source attribution: at least one of each candidate has at least one evidence item
  ok('candidates have evidence attribution', brief.candidates.some(c => c.evidenceSupportingCandidacy.length > 0))

  // Fairness: no protected characteristics mentioned
  const fair = ['age', 'gender', 'race', 'ethnicity', 'religion', 'nationality', 'marital', 'pregnant', 'disability', 'sexual orientation']
  const all = brief.executiveSummary + ' ' + brief.candidates.map(c => c.roleAlignment + c.keyAdvantages.join(' ') + c.keyTradeoffs.join(' ') + c.interviewEvidenceSummary).join(' ')
  const wordBoundary = (w: string) => new RegExp(`\\b${w}\\b`, 'i')
  const fairViolations = fair.filter(w => wordBoundary(w).test(all))
  ok('no protected characteristics in output', fairViolations.length === 0, `violations=${fairViolations.join(',')}`)

  // next steps + open questions + missing evidence + recommended next steps
  ok('recommendedNextSteps length >= 1', brief.recommendedNextSteps.length >= 1)

  console.log('\n  executiveSummary:')
  console.log('   ', brief.executiveSummary.slice(0, 200), '...')

  await db.$disconnect()
  console.log(`\n=== ${pass} passed, ${fail} failed ===\n`)
  if (fail > 0) process.exit(1)
}

main().catch(async e => {
  console.error('FAIL:', e)
  await db.$disconnect()
  process.exit(1)
})
