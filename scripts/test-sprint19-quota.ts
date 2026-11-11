/**
 * Sprint 19 — atomic AI quota reservation tests. DB-backed.
 *
 * GATED:
 *   - Runs ONLY with RUN_DB_TESTS=1.
 *   - REFUSES to run when NODE_ENV=production.
 *
 * Isolation:
 *   - Creates two throwaway organizations with random UUIDs.
 *   - Cleans them up (and their AIUsage/User rows) in `finally`.
 *   - Never reads or writes any pre-existing organization.
 *
 *   RUN_DB_TESTS=1 npx tsx scripts/test-sprint19-quota.ts
 */
import 'dotenv/config'
import { randomUUID } from 'node:crypto'
import { db } from '../lib/db'
import {
  checkAiQuota,
  enforceAiQuota,
  recordAiUsage,
  releaseAiQuota,
  runWithAiReservation,
} from '../lib/ai/quota'

if (process.env.RUN_DB_TESTS !== '1') {
  console.log('SKIP: set RUN_DB_TESTS=1 to run the DB-backed quota tests.')
  process.exit(0)
}
if (process.env.NODE_ENV === 'production') {
  console.error('REFUSING: this test must not run with NODE_ENV=production.')
  process.exit(1)
}

let pass = 0
let fail = 0
function ok(label: string, cond: boolean, detail?: string) {
  if (cond) {
    pass++
    console.log(`  ✓ ${label}`)
  } else {
    fail++
    console.log(`  ✗ ${label}${detail ? ' — ' + detail : ''}`)
  }
}

const cycleStart = () => {
  const n = new Date()
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), 1, 0, 0, 0, 0))
}
const countUsed = (organizationId: string) =>
  db.aIUsage.count({
    where: { organizationId, success: true, createdAt: { gte: cycleStart() } },
  })
const wipe = (organizationId: string) =>
  db.aIUsage.deleteMany({ where: { organizationId } })
async function seed(organizationId: string, feature: 'copilot', n: number) {
  for (let i = 0; i < n; i++) await recordAiUsage({ organizationId, feature })
}

async function main() {
  const orgA = randomUUID()
  const orgB = randomUUID()
  try {
    await db.organization.create({
      data: { id: orgA, name: 'S19 Quota A', slug: `s19-quota-a-${randomUUID().slice(0, 8)}`, onboardingStatus: 'COMPLETED', aiMonthlyQuota: 10 },
    })
    await db.organization.create({
      data: { id: orgB, name: 'S19 Quota B', slug: `s19-quota-b-${randomUUID().slice(0, 8)}`, onboardingStatus: 'COMPLETED', aiMonthlyQuota: 10 },
    })

    console.log('\n1. organization not found')
    const nf = await enforceAiQuota(randomUUID(), 'copilot')
    ok('denied, reason ORG_NOT_FOUND, no usageId', !nf.allowed && nf.reason === 'ORG_NOT_FOUND' && !nf.usageId)

    console.log('\n2. unlimited quota (-1)')
    await db.organization.update({ where: { id: orgA }, data: { aiMonthlyQuota: -1 } })
    const u = await enforceAiQuota(orgA, 'copilot')
    ok('allowed with a usageId', u.allowed && !!u.usageId)
    await recordAiUsage({ usageId: u.usageId, tokensIn: 3, tokensOut: 7 })
    ok('exactly ONE row after reserve + finalize (no double count)', (await db.aIUsage.count({ where: { organizationId: orgA } })) === 1)
    await db.organization.update({ where: { id: orgA }, data: { aiMonthlyQuota: 10 } })
    await wipe(orgA)

    console.log('\n3. quota exhaustion')
    await seed(orgA, 'copilot', 10)
    const ex = await enforceAiQuota(orgA, 'copilot')
    ok('11th reserve denied, LIMIT_REACHED, no usageId', !ex.allowed && ex.reason === 'LIMIT_REACHED' && !ex.usageId)
    ok('count stays 10 (denied attempt logged as success:false)', (await countUsed(orgA)) === 10)
    await wipe(orgA)

    console.log('\n4. concurrent requests at the boundary (3 slots, 8 racers)')
    await seed(orgA, 'copilot', 7)
    const race = await Promise.all(Array.from({ length: 8 }, () => enforceAiQuota(orgA, 'copilot')))
    const allowed = race.filter((r) => r.allowed)
    ok('exactly 3 of 8 allowed', allowed.length === 3, `got ${allowed.length}`)
    ok('5 denied', race.filter((r) => !r.allowed).length === 5)
    ok('count == quota (10) exactly, never over', (await countUsed(orgA)) === 10)
    ok('the 3 allowed have distinct usageIds', new Set(allowed.map((r) => r.usageId)).size === 3)
    await wipe(orgA)

    console.log('\n5. successful finalization')
    const f = await enforceAiQuota(orgA, 'copilot')
    await recordAiUsage({ usageId: f.usageId, tokensIn: 11, tokensOut: 22 })
    const frow = await db.aIUsage.findUnique({ where: { id: f.usageId! } })
    ok('same row updated: tokensIn=11, tokensOut=22, success still true', frow?.tokensIn === 11 && frow?.tokensOut === 22 && frow?.success === true)
    ok('still counted (used = 1)', (await countUsed(orgA)) === 1)
    await wipe(orgA)

    console.log('\n6. failed operation → release frees the slot')
    const rel = await enforceAiQuota(orgA, 'copilot')
    ok('reserved → used = 1', (await countUsed(orgA)) === 1)
    await releaseAiQuota(rel.usageId)
    const relRow = await db.aIUsage.findUnique({ where: { id: rel.usageId! } })
    ok('row flipped to success:false, tokensIn still NULL', relRow?.success === false && relRow?.tokensIn === null)
    ok('used back to 0 — slot reusable', (await countUsed(orgA)) === 0)
    const fin = await enforceAiQuota(orgA, 'copilot')
    await recordAiUsage({ usageId: fin.usageId, tokensIn: 1, tokensOut: 1 })
    await releaseAiQuota(fin.usageId) // must be a no-op: tokensIn is not NULL
    ok('release is a no-op on an already-finalized row', (await db.aIUsage.findUnique({ where: { id: fin.usageId! } }))?.success === true)
    await wipe(orgA)

    console.log('\n7. runWithAiReservation (finalize + release)')
    const good = await enforceAiQuota(orgA, 'copilot')
    const out = await runWithAiReservation(
      good,
      async () => ({ v: 42, usage: { i: 5, o: 6 } }),
      (r) => ({ tokensIn: r.usage.i, tokensOut: r.usage.o }),
    )
    ok('returns the call result', out.v === 42)
    ok('finalized (tokensIn = 5)', (await db.aIUsage.findUnique({ where: { id: good.usageId! } }))?.tokensIn === 5)
    const bad = await enforceAiQuota(orgA, 'copilot')
    let threw = false
    try {
      await runWithAiReservation(bad, async () => {
        throw new Error('boom')
      })
    } catch {
      threw = true
    }
    ok('rethrows on failure', threw)
    ok('released on failure (success:false)', (await db.aIUsage.findUnique({ where: { id: bad.usageId! } }))?.success === false)
    await wipe(orgA)

    console.log('\n8. organization isolation')
    await seed(orgA, 'copilot', 10) // org A exhausted
    const aDenied = await enforceAiQuota(orgA, 'copilot')
    const bAllowed = await enforceAiQuota(orgB, 'copilot')
    ok('org A denied (its own limit)', !aDenied.allowed)
    ok('org B still allowed', bAllowed.allowed && !!bAllowed.usageId)
    ok('org B count = 1, unaffected by org A', (await countUsed(orgB)) === 1)
    ok('org A count still 10', (await countUsed(orgA)) === 10)
  } catch (err) {
    fail++
    console.error('\nUNCAUGHT:', err instanceof Error ? err.stack : err)
  } finally {
    await db.aIUsage.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } }).catch(() => {})
    await db.user.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } }).catch(() => {})
    await db.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } }).catch(() => {})
    await db.$disconnect().catch(() => {})
  }

  console.log(`\n${'='.repeat(50)}\n${pass} passed, ${fail} failed`)
  process.exit(fail === 0 ? 0 : 1)
}

void main()
