/**
 * Local sanity test for AIEngine.generateInterviewKit().
 *
 * Self-seeds: uploads Sarah Martinez's CV to an open hiring request,
 * runs the analysis pipeline, then asks the engine to build an
 * interview kit. Asserts Zod-valid output, the question composition
 * (at least one of each purpose), the scorecard (weights sum to 100),
 * and the fairness safeguards.
 *
 * Leaves the candidate in place for downstream E2E use.
 */

import 'dotenv/config'
import { readFileSync } from 'fs'

import { db } from '../lib/db'
import { getAIEngine } from '../lib/ai/service/ai-engine'
import { interviewKitOutputSchema } from '../lib/ai/schemas/interview-kit.schema'
import { uploadCVsAction } from '../app/(app)/hiring-requests/[id]/candidates/actions'

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
  console.log('\n=== AIEngine.generateInterviewKit local test ===\n')

  // 1. Find an OPEN HR + JD
  const hr = await db.hiringRequest.findFirst({
    where: { status: 'OPEN' },
    include: { jobDescription: true, organization: true },
  })
  if (!hr || !hr.jobDescription) throw new Error('No OPEN HR with JD')
  const jd = hr.jobDescription
  console.log('  HR:', hr.id, '·', hr.title)

  // 2. Find an analyzed candidate for this HR. If none, upload one.
  let candidate = await db.candidate.findFirst({
    where: { hiringRequestId: hr.id, matchScore: { not: null } },
    include: {
      skills: true,
      experiences: { orderBy: { startDate: 'desc' } },
      educations: true,
      certifications: true,
    },
    orderBy: { matchScore: 'desc' },
  })

  if (!candidate) {
    console.log('  no analyzed candidate — uploading Sarah Martinez CV...')
    const buf = readFileSync('test-fixtures/cvs/sarah-martinez-frontend.pdf')
    const base64 = buf.toString('base64')
    const result = await uploadCVsAction({
      hiringRequestId: hr.id,
      files: [
        {
          clientId: 'test-' + Date.now(),
          fileName: 'sarah-martinez-frontend.pdf',
          mimeType: 'application/pdf',
          base64,
        },
      ],
    })
    if (!result.ok) throw new Error('uploadCVsAction failed: ' + JSON.stringify(result))
    const first = result.data.results.find(r => r.candidate)
    if (!first || !first.candidate) throw new Error('no candidate created')
    candidate = await db.candidate.findUnique({
      where: { id: first.candidate.id },
      include: {
        skills: true,
        experiences: { orderBy: { startDate: 'desc' } },
        educations: true,
        certifications: true,
      },
    })
    if (!candidate) throw new Error('candidate not found after upload')
  }
  const fullName = `${candidate.firstName} ${candidate.lastName}`
  console.log('  Candidate:', candidate.id, '·', fullName, `(${candidate.matchScore})`)

  // 3. Build engine input
  const input = {
    jobContext: {
      jobTitle: hr.title,
      jobLevel: hr.level,
      jobSummary: jd.summary ?? jd.description,
      responsibilities: jd.responsibilities ?? [],
      requiredSkills: jd.requiredSkills ?? [],
      preferredSkills: jd.niceToHave ?? [],
      qualifications: jd.requiredSkills ?? [],
      experienceRequirements: jd.responsibilities ?? [],
    },
    candidateContext: {
      name: fullName,
      currentRole: candidate.currentTitle ?? 'Unknown',
      totalYearsExperience: candidate.yearsExperience ?? 0,
      skills: candidate.skills.map(s => s.name),
      workExperience: candidate.experiences.map(e => ({
        company: e.company,
        title: e.title,
        startDate: e.startDate ? e.startDate.toISOString().slice(0, 7) : undefined,
        endDate: e.endDate ? e.endDate.toISOString().slice(0, 7) : undefined,
        description: e.description ?? undefined,
      })),
      education: candidate.educations.map(e => ({
        institution: e.institution,
        degree: e.degree,
        field: e.field ?? undefined,
      })),
      certifications: candidate.certifications.map(c => c.name),
    },
    matchContext: {
      overallScore: candidate.matchScore ?? 0,
      scoreBreakdown: (candidate.matchScoreBreakdown as { skills: number; experience: number; roleAlignment: number; education: number }) ?? {
        skills: 0,
        experience: 0,
        roleAlignment: 0,
        education: 0,
      },
      strengths: candidate.strengths,
      gaps: candidate.gaps,
      concerns: candidate.concerns,
      recommendation: candidate.recommendation ?? 'POTENTIAL_MATCH',
      recommendationReasoning: candidate.recommendationReasoning ?? '',
    },
  }

  console.log('\n  calling AIEngine.generateInterviewKit()...')
  const result = await getAIEngine().generateInterviewKit(input)
  console.log('  latency:', result.latencyMs, 'ms')

  // 4. Zod parse
  const parsed = interviewKitOutputSchema.safeParse(result.data)
  ok('output validates against Zod schema', parsed.success, parsed.success ? '' : JSON.stringify(parsed.error.issues).slice(0, 200))

  // 5. Structural checks
  const kit = result.data
  ok('overview.candidateName set', !!kit.overview.candidateName)
  ok('overview.position set', !!kit.overview.position)
  ok('overview.recommendedType valid', !!kit.overview.recommendedType)
  ok('overview.recommendedDurationMinutes in [15, 240]', kit.overview.recommendedDurationMinutes >= 15 && kit.overview.recommendedDurationMinutes <= 240)
  ok('overview.interviewFocus non-trivial', kit.overview.interviewFocus.length >= 20)

  ok('candidateSnapshot.overallScore in [0, 100]', kit.candidateSnapshot.overallScore >= 0 && kit.candidateSnapshot.overallScore <= 100)
  ok('candidateSnapshot.keyStrengths.length >= 1', kit.candidateSnapshot.keyStrengths.length >= 1)

  // Question composition
  const purposes = new Set(kit.questions.map(q => q.purpose))
  console.log('  question purposes:', [...purposes].sort().join(', '))
  ok('has at least one OPENING', purposes.has('OPENING'))
  ok('has at least one ROLE_SPECIFIC', purposes.has('ROLE_SPECIFIC'))
  ok('has at least one SKILL_VALIDATION', purposes.has('SKILL_VALIDATION'))
  ok('has at least one GAP_VALIDATION', purposes.has('GAP_VALIDATION'))
  ok('has at least one BEHAVIORAL', purposes.has('BEHAVIORAL'))
  ok('has at least one SCENARIO', purposes.has('SCENARIO'))
  ok('has at least one CANDIDATE_SPECIFIC', purposes.has('CANDIDATE_SPECIFIC'))
  ok('has at least one CLOSING', purposes.has('CLOSING'))

  ok('questions count in [8, 35]', kit.questions.length >= 8 && kit.questions.length <= 35)

  // Question content
  for (const q of kit.questions) {
    if (q.question.length < 10) errors.push(`question too short: ${q.question}`)
    if (!q.whyThisQuestion || q.whyThisQuestion.length < 10) errors.push(`missing whyThisQuestion: ${q.question}`)
    if (!q.guidance?.strongAnswer || q.guidance.strongAnswer.length < 10) errors.push(`missing strongAnswer: ${q.question}`)
    if (!q.guidance?.redFlags || q.guidance.redFlags.length < 5) errors.push(`missing redFlags: ${q.question}`)
  }
  ok('all questions have whyThisQuestion + guidance.strongAnswer + guidance.redFlags', errors.length === 0, errors[0] ?? '')

  // Fairness check — match on word boundaries to avoid false positives like "stage"
  // containing "age".
  const FORBIDDEN = ['age', 'birthday', 'date of birth', 'gender', 'pregnant', 'marital', 'married', 'children', 'family plan', 'race', 'ethnicity', 'religion', 'nationality', 'citizenship', 'disability', 'medical', 'sexual orientation', 'political', 'veteran', 'union']
  const allText = kit.questions
    .map(q => `${q.question} ${q.whyThisQuestion} ${q.guidance.strongAnswer} ${q.guidance.redFlags}`)
    .join(' ')
  const allTextLower = allText.toLowerCase()
  const wordBoundary = (w: string) => new RegExp(`\\b${w}\\b`, 'i')
  const violated = FORBIDDEN.filter(t => wordBoundary(t).test(allTextLower))
  ok('no forbidden terms in questions', violated.length === 0, `violations=${violated.join(',')}`)

  // Scorecard
  ok('scorecardCriteria.length in [3, 10]', kit.scorecardCriteria.length >= 3 && kit.scorecardCriteria.length <= 10)
  const weightSum = kit.scorecardCriteria.reduce((a, c) => a + c.weight, 0)
  ok('scorecardCriteria weights sum to 100', weightSum === 100, `sum=${weightSum}`)

  const hasCultureFit = kit.scorecardCriteria.some(c => /culture\s*fit/i.test(c.name))
  ok('no "Culture Fit" criterion (vague)', !hasCultureFit)

  // Print a small sample
  console.log('\n  sample questions:')
  for (const q of kit.questions.slice(0, 3)) {
    console.log(`    [${q.purpose}] ${q.question.slice(0, 100)}`)
  }
  console.log('\n  scorecard:')
  for (const c of kit.scorecardCriteria) {
    console.log(`    ${c.name} (${c.weight}%)`)
  }

  // Leave the candidate in place for downstream use — DON'T clean up.
  console.log(`\n  candidate ${candidate.id} left in DB for downstream tests`)

  await db.$disconnect()
  console.log(`\n=== ${pass} passed, ${fail} failed ===\n`)
  if (fail > 0) process.exit(1)
}

main().catch(async e => {
  console.error('FAIL:', e)
  await db.$disconnect()
  process.exit(1)
})
