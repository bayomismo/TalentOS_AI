/**
 * Sprint 6 — end-to-end smoke test.
 *
 * Exercises the full pipeline locally against the real Prisma DB:
 *   1. Engine health.
 *   2. PDF parser extracts text.
 *   3. analyzeCV() returns a valid CVAnalysisOutput.
 *   4. rankCandidate() returns a valid CandidateRankingOutput.
 *   5. Parsed CV can be uploaded via the action and creates Candidate +
 *      related rows in Prisma.
 *   6. moveCandidateStageAction persists the stage change + Activity.
 *   7. Rank survives a reload (re-fetch via getCandidateWorkspaceAction).
 */

import { config as loadEnv } from 'dotenv'
import { readFileSync } from 'fs'

import 'dotenv/config'

import { db } from '../lib/db'
import { getAIEngine } from '../lib/ai/service/ai-engine'
import { parseCV } from '../lib/cv'
import {
  getCandidateWorkspaceAction,
  uploadCVsAction,
  moveCandidateStageAction,
} from '../app/(app)/hiring-requests/[id]/candidates/actions'

loadEnv()

async function main() {
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

  // ---------------------------------------------------------------------
  // 1. Engine + parsing
  // ---------------------------------------------------------------------
  console.log('\n== Step 1: AI engine + CV parsing ==')
  const engine = getAIEngine()
  const health = await engine.health()
  ok('engine healthy', health.status === 'healthy', JSON.stringify(health))

  const sarahPDF = readFileSync('test-fixtures/cvs/sarah-martinez-frontend.pdf')
  const priyaPDF = readFileSync('test-fixtures/cvs/priya-nair-data-scientist.pdf')
  const sarahParsed = await parseCV({
    buffer: sarahPDF,
    fileName: 'sarah-martinez-frontend.pdf',
    mimeType: 'application/pdf',
  })
  const priyaParsed = await parseCV({
    buffer: priyaPDF,
    fileName: 'priya-nair-data-scientist.pdf',
    mimeType: 'application/pdf',
  })
  ok('sarah CV parsed', sarahParsed.text.length > 200, `len=${sarahParsed.text.length}`)
  ok('priya CV parsed', priyaParsed.text.length > 200, `len=${priyaParsed.text.length}`)

  // ---------------------------------------------------------------------
  // 2. AI analysis (direct engine call)
  // ---------------------------------------------------------------------
  console.log('\n== Step 2: AI analyzeCV + rankCandidate ==')
  const sarahAnalysis = await engine.analyzeCV({ cvText: sarahParsed.text })
  ok('sarah analyzeCV.ok', sarahAnalysis.data.fullName.toLowerCase().includes('sarah'))
  ok(
    'sarah analyzeCV has skills',
    Array.isArray(sarahAnalysis.data.topSkills) && sarahAnalysis.data.topSkills.length >= 3
  )
  ok(
    'sarah analyzeCV yearsExperience > 0',
    sarahAnalysis.data.yearsExperience > 0,
    `yearsExperience=${sarahAnalysis.data.yearsExperience}`
  )

  // Find an open HR with a JD
  const hr = await db.hiringRequest.findFirst({
    where: { status: 'OPEN' },
    include: { jobDescription: true },
  })
  ok('found open HR with JD', !!hr?.jobDescription, hr ? hr.id : 'no HR')
  if (!hr || !hr.jobDescription) {
    console.log('\n!!! Cannot continue E2E without an open HR + JD. Aborting.')
    process.exit(1)
  }
  const jd = hr.jobDescription

  const rankingSarah = await engine.rankCandidate({
    candidateId: 'sarah-test',
    hiringRequestId: hr.id,
    jobDescription: {
      title: jd.title,
      summary: jd.summary ?? '',
      responsibilities: jd.responsibilities,
      requiredSkills: jd.requiredSkills,
      niceToHaveSkills: jd.niceToHave,
      qualifications: [],
    },
    candidateProfile: {
      fullName: sarahAnalysis.data.fullName,
      currentTitle: sarahAnalysis.data.currentTitle,
      yearsExperience: sarahAnalysis.data.yearsExperience,
      summary: sarahAnalysis.data.summary,
      topSkills: sarahAnalysis.data.topSkills,
      workExperience: sarahAnalysis.data.workExperience.map(w => ({
        company: w.company,
        title: w.title,
        startDate: w.startDate,
        endDate: w.endDate ?? null,
        description: w.description ?? '',
      })),
      education: sarahAnalysis.data.education.map(e => ({
        institution: e.institution,
        degree: e.degree,
        field: e.field,
      })),
    },
  })
  ok(
    'rankCandidate returns score 0-100',
    rankingSarah.data.overallScore >= 0 && rankingSarah.data.overallScore <= 100,
    `score=${rankingSarah.data.overallScore}`
  )
  ok(
    'rankCandidate has strengths',
    Array.isArray(rankingSarah.data.strengths) && rankingSarah.data.strengths.length >= 1
  )
  ok(
    'rankCandidate has reasoning',
    typeof rankingSarah.data.reasoning === 'string' && rankingSarah.data.reasoning.length >= 40
  )

  // ---------------------------------------------------------------------
  // 3. Upload CV via the real server action
  // ---------------------------------------------------------------------
  console.log('\n== Step 3: uploadCVsAction (real server action) ==')

  // Tag this run so we can clean up
  const runId = `sprint6-e2e-${Date.now()}`

  const beforeCandidates = await db.candidate.count({ where: { hiringRequestId: hr.id } })

  const toBase64 = (buf: Buffer) => buf.toString('base64')
  const result = await uploadCVsAction({
    hiringRequestId: hr.id,
    files: [
      {
        clientId: `${runId}-sarah`,
        fileName: 'sarah-martinez-frontend.pdf',
        mimeType: 'application/pdf',
        base64: toBase64(sarahPDF),
      },
      {
        clientId: `${runId}-priya`,
        fileName: 'priya-nair-data-scientist.pdf',
        mimeType: 'application/pdf',
        base64: toBase64(priyaPDF),
      },
    ],
  })

  ok('uploadCVsAction ok', result.ok, result.ok ? '' : JSON.stringify(result))
  if (!result.ok) {
    console.log('\n!!! uploadCVsAction failed. Aborting E2E.')
    process.exit(1)
  }
  ok('two files processed', result.data.results.length === 2)
  ok('two succeeded', result.data.created === 2, `created=${result.data.created} failed=${result.data.failed}`)

  const sarahResult = result.data.results.find(r => r.fileName.includes('sarah'))
  const priyaResult = result.data.results.find(r => r.fileName.includes('priya'))
  ok('sarah candidate created', !!sarahResult?.candidate, sarahResult?.error?.message)
  ok('priya candidate created', !!priyaResult?.candidate, priyaResult?.error?.message)
  ok(
    'sarah has match score',
    sarahResult?.candidate?.matchScore != null,
    `score=${sarahResult?.candidate?.matchScore}`
  )
  ok(
    'priya has match score',
    priyaResult?.candidate?.matchScore != null,
    `score=${priyaResult?.candidate?.matchScore}`
  )
  ok(
    'sarah recommendation set',
    !!sarahResult?.candidate?.recommendation,
    sarahResult?.candidate?.recommendation ?? 'null'
  )
  ok(
    'priya recommendation set',
    !!priyaResult?.candidate?.recommendation,
    priyaResult?.candidate?.recommendation ?? 'null'
  )

  // Persisted Candidate + CVFile + skills rows
  if (sarahResult?.candidate) {
    const sarahRow = await db.candidate.findUnique({
      where: { id: sarahResult.candidate.id },
      include: { skills: true, cvFiles: true },
    })
    ok('sarah persisted in DB', !!sarahRow, `id=${sarahResult.candidate.id}`)
    ok('sarah has CVFile', (sarahRow?.cvFiles.length ?? 0) >= 1)
    ok('sarah has skills', (sarahRow?.skills.length ?? 0) >= 1)
    ok('sarah CVFile has parsedText', (sarahRow?.cvFiles[0]?.parsedText?.length ?? 0) > 200)
    ok(
      'sarah CVFile has parsedData (json)',
      !!sarahRow?.cvFiles[0]?.parsedData
    )
    ok('sarah analyzedAt set', !!sarahRow?.analyzedAt)
    ok('sarah matchScore persisted', sarahRow?.matchScore === sarahResult.candidate.matchScore)
  }

  const afterCandidates = await db.candidate.count({ where: { hiringRequestId: hr.id } })
  ok(
    'candidate count grew by 2',
    afterCandidates - beforeCandidates === 2,
    `before=${beforeCandidates} after=${afterCandidates}`
  )
  if (sarahResult?.candidate) {
    const sarahRow = await db.candidate.findUnique({
      where: { id: sarahResult.candidate.id },
      select: { matchScore: true, source: true, sourceDetails: true, analyzedAt: true },
    })
    ok('sarah source = CV Upload', sarahRow?.source === 'CV Upload', `source=${sarahRow?.source}`)
    ok(
      'sarah sourceDetails = fileName',
      sarahRow?.sourceDetails === 'sarah-martinez-frontend.pdf',
      `sourceDetails=${sarahRow?.sourceDetails}`
    )
    ok('sarah matchScore persisted', sarahRow?.matchScore === sarahResult.candidate.matchScore)
  }

  // ---------------------------------------------------------------------
  // 4. Workspace query
  // ---------------------------------------------------------------------
  console.log('\n== Step 4: getCandidateWorkspaceAction ==')
  const ws = await getCandidateWorkspaceAction(hr.id)
  ok('workspace query ok', ws.ok)
  if (ws.ok) {
    ok(
      'workspace includes the new candidates',
      ws.data.candidates.some(c => c.id === sarahResult?.candidate?.id) &&
        ws.data.candidates.some(c => c.id === priyaResult?.candidate?.id)
    )
    ok(
      'workspace stats: total increased',
      ws.data.stats.total >= 2,
      `total=${ws.data.stats.total}`
    )
    ok(
      'workspace stats: at least 2 analyzed',
      ws.data.stats.analyzed >= 2,
      `analyzed=${ws.data.stats.analyzed}`
    )
    const sarahInWs = ws.data.candidates.find(c => c.id === sarahResult?.candidate?.id)
    ok(
      'sarah has topSkills in workspace payload',
      (sarahInWs?.topSkills.length ?? 0) >= 1,
      `skills=${sarahInWs?.topSkills.join(',')}`
    )
  }

  // ---------------------------------------------------------------------
  // 5. Stage move
  // ---------------------------------------------------------------------
  console.log('\n== Step 5: moveCandidateStageAction ==')
  if (sarahResult?.candidate) {
    const move = await moveCandidateStageAction({
      candidateId: sarahResult.candidate.id,
      toStage: 'SCREENING',
    })
    ok('move stage ok', move.ok, move.ok ? '' : JSON.stringify(move))
    if (move.ok) {
      const sarahAfter = await db.candidate.findUnique({
        where: { id: sarahResult.candidate.id },
        select: { stage: true, lastActivityAt: true },
      })
      ok('sarah stage is SCREENING', sarahAfter?.stage === 'SCREENING', `stage=${sarahAfter?.stage}`)
      const lastActivity = await db.activity.findFirst({
        where: { candidateId: sarahResult.candidate.id },
        orderBy: { occurredAt: 'desc' },
        select: { type: true },
      })
      ok('Activity row created', lastActivity?.type === 'CANDIDATE_MOVED', `type=${lastActivity?.type}`)
    }
  }

  // ---------------------------------------------------------------------
  // 6. Clean up
  // ---------------------------------------------------------------------
  console.log('\n== Step 6: Cleanup ==')
  const candidatesToDelete = await db.candidate.findMany({
    where: { source: 'CV Upload', sourceDetails: { contains: runId.split('-').pop() ?? '___nope___' } },
    select: { id: true },
  })
  // Fallback: delete by email pattern from this test run
  const sarahEmail = sarahResult?.candidate?.email
  const priyaEmail = priyaResult?.candidate?.email
  const testEmails = [sarahEmail, priyaEmail].filter((e): e is string => !!e)
  const allRunRows = await db.candidate.findMany({
    where: { email: { in: testEmails }, source: 'CV Upload' },
    select: { id: true, email: true },
  })
  console.log(`  test created ${candidatesToDelete.length} rows; deleting ${allRunRows.length} for cleanup`)
  for (const row of allRunRows) {
    await db.candidate.delete({ where: { id: row.id } })
  }
  ok('cleaned up test rows', allRunRows.length > 0)

  // ---------------------------------------------------------------------
  console.log(`\n=== ${pass} passed, ${fail} failed ===\n`)
  await db.$disconnect()
  if (fail > 0) process.exit(1)
}

main().catch(async err => {
  console.error('FAIL:', err)
  await db.$disconnect()
  process.exit(1)
})
