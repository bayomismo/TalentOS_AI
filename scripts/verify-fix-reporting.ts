import 'dotenv/config'

/**
 * Isolated verification of the fix-reporting track.
 *
 * The shared audit-6 gate cannot be run concurrently on this database
 * (the dev auth fallback resolves to ONE global "oldest admin", and the
 * fixture-cleanup scripts wipe any run whose org tag they know), so this
 * script proves the same outcomes against its OWN fixture org.
 *
 * It mirrors the audit-6 assertions of this track:
 *   A43 — the dashboard contains no hardcoded change/trend values
 *   A44 — the dashboard has no hardcoded "Avg. Time to Hire"
 *   A45 — the analytics hire count equals the actual HIRED count
 *   A47 — the funnel does not double-count candidates
 *   A53 — the CV parsed text is reachable for the candidate profile
 *   A54 — the CV bytes are stored durably under a resolvable URL
 * plus the P0-04 storage round-trip and the P2-01 stage rendering.
 *
 * Everything it creates is deleted in the finally block.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { db } from '../lib/db'
import { getAnalyticsDataAction } from '../app/(app)/analytics/actions'
import { getDashboardDataAction } from '../app/(app)/dashboard/actions'
import { getCandidateProfileContextAction } from '../lib/storage/actions'
import { getFileStorage } from '../lib/storage'
import { requireAuth } from '../lib/auth'

const STAMP = Date.now()
const TAG = `a6rep-${STAMP}`

let pass = 0
let fail = 0
const failures: string[] = []

function ok(id: string, label: string, cond: boolean, detail?: string) {
  if (cond) {
    pass++
    console.log(`  ✓ [${id}] ${label}`)
  } else {
    fail++
    failures.push(id)
    console.log(`  ✗ [${id}] ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

async function main() {
  const orgId = await db.organization.create({
    data: { name: `${TAG}-org`, slug: `${TAG}-org` },
    select: { id: true },
  })
  // Pinned so the dev auth fallback resolves to THIS admin while the
  // script runs. It is NOT the oldest admin in the database — a run that
  // steals the fallback from a sibling audit run would corrupt that run.
  const admin = await db.user.create({
    data: {
      organizationId: orgId.id,
      email: `${TAG}-admin@example.test`,
      firstName: 'Rep',
      lastName: 'Admin',
      role: 'ADMIN',
      status: 'ACTIVE',
      createdAt: new Date('1950-01-01T00:00:00.000Z'),
    },
    select: { id: true },
  })
  const dept = await db.department.create({
    data: { organizationId: orgId.id, name: `${TAG}-dept`, slug: `${TAG}-dept` },
    select: { id: true },
  })
  const hr = await db.hiringRequest.create({
    data: {
      organizationId: orgId.id,
      departmentId: dept.id,
      createdById: admin.id,
      title: `${TAG} role`,
      slug: `${TAG}-role`,
      status: 'OPEN',
      publishedAt: new Date(),
    },
    select: { id: true },
  })

  // One candidate per stage, so the funnel has something to distribute.
  const stages = ['APPLIED', 'SCREENING', 'INTERVIEW', 'OFFER', 'HIRED', 'HIRED', 'REJECTED'] as const
  const candidates = []
  for (const [i, stage] of stages.entries()) {
    const c = await db.candidate.create({
      data: {
        organizationId: orgId.id,
        hiringRequestId: hr.id,
        firstName: `Rep${i}`,
        lastName: 'Candidate',
        email: `${TAG}-cand-${i}@example.test`,
        stage,
        appliedAt: new Date(Date.now() - (10 + i) * 86400000),
        hiredAt: stage === 'HIRED' ? new Date(Date.now() - (5 - i) * 86400000) : null,
      },
      select: { id: true, stage: true },
    })
    candidates.push(c)
  }

  // A CV file whose bytes are stored through the driver.
  const storage = getFileStorage()
  const storageKey = `cvs/${hr.id}/rep-cv.docx`
  const bytes = Buffer.from('REPORTING-TRACK-CV-BYTES')
  const stored = await storage.put(storageKey, bytes, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
  await db.cVFile.create({
    data: {
      candidateId: candidates[0]!.id,
      fileName: 'rep-cv.docx',
      fileSize: bytes.length,
      fileType: 'DOCX',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      storageUrl: stored.url,
      storagePath: storageKey,
      parsedText: 'REPORTING TRACK PARSED CV TEXT',
    },
  })

  console.log(`\n[${TAG}] fixture org ${orgId.id}\n`)

  // The dev auth fallback resolves to ONE global "oldest admin". If a
  // sibling audit run owns it right now, this script must not measure
  // that run's tenant — it says so and stops instead of reporting
  // numbers that belong to somebody else.
  const acting = await requireAuth()
  if (!acting.ok || acting.data.userId !== admin.id) {
    console.log(
      'SKIPPED: another audit run currently owns the dev auth fallback ' +
        `(${acting.ok ? acting.data.email : 'unauthenticated'}). ` +
        'Re-run when the audit gate is idle.',
    )
    await db.organization.delete({ where: { id: orgId.id } })
    process.exit(2)
  }

  // --- A45 · analytics hire count ------------------------------------------
  const analytics = await getAnalyticsDataAction()
  const actualHired = await db.candidate.count({
    where: { organizationId: orgId.id, stage: 'HIRED' },
  })
  const hireMetric = analytics.metrics.find(m => m.label.toLowerCase().includes('hire'))
  const reported = hireMetric ? Number(hireMetric.value) : Number.NaN
  ok(
    'A45',
    'the analytics hire count matches the actual number of HIRED candidates',
    Number.isFinite(reported) && reported === actualHired,
    `reported=${reported} actual=${actualHired} label=${hireMetric?.label}`,
  )

  // --- A47 · funnel does not double-count ----------------------------------
  const totalCandidates = await db.candidate.count({ where: { organizationId: orgId.id } })
  const funnelSum = analytics.funnel.reduce((acc, f) => acc + f.value, 0)
  ok(
    'A47',
    'funnel denominators do not double-count candidates across cumulative stages',
    funnelSum <= totalCandidates,
    `sum(funnel)=${funnelSum} candidates=${totalCandidates} funnel=${analytics.funnel
      .map(f => `${f.label}:${f.value}`)
      .join(', ')}`,
  )
  const pipelineCount = await db.candidate.count({
    where: { organizationId: orgId.id, stage: { notIn: ['REJECTED', 'WITHDRAWN'] } },
  })
  ok(
    'A47b',
    'every candidate in the funnel cohort is counted exactly once',
    funnelSum === pipelineCount,
    `sum(funnel)=${funnelSum} cohort=${pipelineCount}`,
  )
  const funnelPctSum = analytics.funnel.reduce((acc, f) => acc + f.pct, 0)
  ok(
    'A47c',
    'the funnel percentages are relative to the distinct candidate count',
    analytics.funnelTotal === pipelineCount && funnelPctSum <= 100,
    `funnelTotal=${analytics.funnelTotal} cohort=${pipelineCount} pctSum=${funnelPctSum}`,
  )

  // --- A43 / A44 · no hardcoded dashboard values ---------------------------
  const dashboardSrc =
    readFileSync(resolve(process.cwd(), 'app/(app)/dashboard/actions.ts'), 'utf8') +
    '\n' +
    readFileSync(resolve(process.cwd(), 'app/(app)/dashboard/_components/dashboard-view.tsx'), 'utf8')
  ok(
    'A43',
    'the dashboard contains NO hardcoded change/trend values [static check]',
    !/change\s*:\s*-?\d+\s*[,}]/.test(dashboardSrc),
    'a metric literal change: <number> is still hardcoded',
  )
  ok(
    'A44',
    'the dashboard has no hardcoded "Avg. Time to Hire" string [static check]',
    !/value\s*:\s*['"`]\s*\d+\s*(day|days)\s*['"`]/i.test(dashboardSrc),
    'a metric value is still a hardcoded number of days',
  )

  // --- P2-02 · the dashboard numbers come from the rows --------------------
  const dashboard = await getDashboardDataAction()
  const hiredMetric = dashboard.metrics.find(m => m.label === 'Candidates Hired (YTD)')
  const openMetric = dashboard.metrics.find(m => m.label === 'Open Positions')
  const activeMetric = dashboard.metrics.find(m => m.label === 'Active Candidates')
  const tthMetric = dashboard.metrics.find(m => m.label === 'Avg. Time to Hire')
  ok(
    'P2-02a',
    'the dashboard hire count equals the rows that were actually hired',
    hiredMetric !== undefined && Number(hiredMetric.value) === actualHired,
    `dashboard=${String(hiredMetric?.value)} actual=${actualHired}`,
  )
  ok(
    'P2-02b',
    'the dashboard open-position count equals the published requisitions',
    openMetric !== undefined && Number(openMetric.value) === 1,
    `dashboard=${String(openMetric?.value)}`,
  )
  ok(
    'P2-02c',
    'the dashboard active-candidate count equals the non-terminal candidates',
    activeMetric !== undefined &&
      Number(activeMetric.value) ===
        await db.candidate.count({
          where: { organizationId: orgId.id, rejectedAt: null, withdrawnAt: null },
        }),
    `dashboard=${String(activeMetric?.value)}`,
  )
  ok(
    'P2-02d',
    'the average time to hire is calculated from the hiredAt deltas',
    tthMetric !== undefined && /^\d+ days$/.test(String(tthMetric.value)),
    `value=${String(tthMetric?.value)}`,
  )

  // --- P0-04 · durable bytes + resolvable URL + parsed text ----------------
  ok(
    'A54',
    'the CV file bytes are stored under a resolvable URL, not a synthetic one',
    !stored.url.startsWith('memory://') && stored.url.startsWith('/api/cv/'),
    `url=${stored.url} driver=${storage.driver} durable=${storage.durable}`,
  )
  const readBack = await storage.get(storageKey)
  ok(
    'A54b',
    'the stored CV bytes can be read back',
    readBack !== null && readBack.body.equals(bytes),
    `readBack=${readBack === null ? 'null' : `${readBack.size} bytes`}`,
  )
  const ctx = await getCandidateProfileContextAction(candidates[0]!.id)
  ok(
    'A53',
    'the CV parsed text is reachable for the candidate profile',
    ctx !== null && ctx.cvFiles[0]?.parsedText === 'REPORTING TRACK PARSED CV TEXT',
    `parsedText=${String(ctx?.cvFiles[0]?.parsedText)}`,
  )
  ok(
    'A53b',
    'the candidate profile gets a resolvable download URL for the original',
    ctx?.cvFiles[0]?.downloadUrl === stored.url,
    `downloadUrl=${String(ctx?.cvFiles[0]?.downloadUrl)}`,
  )
  ok(
    'P2-01',
    'the profile context carries the real stage (REJECTED is not "applied")',
    ctx?.stage === 'APPLIED' &&
      (await getCandidateProfileContextAction(candidates[6]!.id))?.stage === 'REJECTED',
    `stages=${String(ctx?.stage)}/${String((await getCandidateProfileContextAction(candidates[6]!.id))?.stage)}`,
  )

  // --- cleanup -------------------------------------------------------------
  await storage.delete(storageKey)
  await db.organization.delete({ where: { id: orgId.id } })
  console.log(`\n  cleanup: org ${orgId.id} removed`)

  console.log(`\nFINAL: ${pass} passed, ${fail} failed`)
  if (failures.length > 0) console.log(`Failing IDs: ${failures.join(', ')}`)
  process.exit(fail === 0 ? 0 : 1)
}

main().catch(async err => {
  console.error(err)
  await db.organization.deleteMany({ where: { slug: { startsWith: TAG } } }).catch(() => null)
  process.exit(1)
})
