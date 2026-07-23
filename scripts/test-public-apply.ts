/**
 * Sprint 17.6 — End-to-end test for the public application flow.
 *
 * 1. Find a public-enabled job
 * 2. Submit an application via the action directly
 * 3. Verify a Candidate was created with the right source
 * 4. Verify an ApplicationActivity was logged
 * 5. Verify notification email landed in outbox
 * 6. Test rate limiting (6th call should be blocked)
 * 7. Test honeypot (filled field → silent success)
 * 8. Test duplicate apply (same email + same job → updates existing)
 * 9. Test consent missing → error
 * 10. Test invalid email → error
 * 11. Cleanup
 */

import 'dotenv/config'
import { db } from '../lib/db'
import { submitPublicApplicationAction } from '../app/(public)/jobs/[slug]/apply-action'
import { randomBytes } from 'node:crypto'

let pass = 0, fail = 0
function ok(label: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ✓ ${label}`) }
  else { fail++; console.log(`  ✗ ${label}${detail ? ' — ' + detail : ''}`) }
}

async function main() {
  // 1. Find a public-enabled job
  const job = await db.jobDescription.findFirst({
    where: { publicEnabled: true, publicSlug: { not: null } },
    select: {
      id: true,
      title: true,
      publicSlug: true,
      organizationId: true,
      hiringRequests: {
        where: { status: { in: ['DRAFT', 'OPEN', 'ON_HOLD'] } },
        select: { id: true, status: true },
        take: 1,
      },
    },
  })
  if (!job || !job.publicSlug || !job.hiringRequests[0]) {
    console.log('No public-enabled job with an open hiring request found — skipping test')
    return
  }
  const hiringRequest = job.hiringRequests[0]
  console.log(`Using job: ${job.title} (slug=${job.publicSlug})`)

  const testEmail = `applicant-${randomBytes(4).toString('hex')}@example.com`
  const meta = { ip: '127.0.0.1', userAgent: 'test-script' }

  // 2. Submit a valid application
  console.log('\n[1] Valid application')
  const r1 = await submitPublicApplicationAction(
    {
      jobSlug: job.publicSlug,
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: testEmail,
      phone: '+1-555-0100',
      location: 'London, UK',
      linkedinUrl: 'linkedin.com/in/ada',
      coverLetter: 'I would love to work on this role.',
      consent: 'on',
    },
    meta,
  )
  ok('ok=true', r1.ok)
  if (r1.ok) {
    const candidate = await db.candidate.findUnique({
      where: { id: r1.candidateId },
      include: { cvFiles: true, activities: true },
    })
    ok('candidate exists', !!candidate)
    ok('firstName saved', candidate?.firstName === 'Ada')
    ok('email saved (lowercased)', candidate?.email === testEmail)
    ok('source = Public: <jobTitle>', candidate?.source === `Public: ${job.title}`)
    ok('sourceDetails includes /jobs/...', candidate?.sourceDetails?.includes('/jobs/') ?? false)
    ok('stage = APPLIED', candidate?.stage === 'APPLIED')
    ok('status = ACTIVE', candidate?.status === 'ACTIVE')
    ok('hiringRequestId set', candidate?.hiringRequestId === hiringRequest.id)
    ok('no CV (we did not upload one)', (candidate?.cvFiles.length ?? 0) === 0)
    ok('1 activity logged', (candidate?.activities.length ?? 0) >= 1)
    ok(
      'activity is PUBLIC_APPLICATION',
      candidate?.activities.some((a) => a.type === 'PUBLIC_APPLICATION') ?? false,
    )

    // 3. Email outbox
    const outbox = await db.emailOutbox.findMany({
      where: { kind: 'new_public_application' },
      orderBy: { createdAt: 'desc' },
      take: 5,
    })
    ok('notification email in outbox', outbox.length > 0)
    if (outbox.length > 0) {
      const latest = outbox[0]
      ok('email subject has job title', latest.subject.includes(job.title))
      ok('email subject has candidate name', latest.subject.includes('Ada Lovelace'))
      ok('email to an admin', /@/.test(latest.to))
    }
  }

  // 4. Duplicate application (same email, same job) — should update, not error
  console.log('\n[2] Duplicate application (same email + same job)')
  const r2 = await submitPublicApplicationAction(
    {
      jobSlug: job.publicSlug,
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: testEmail,
      consent: 'on',
    },
    meta,
  )
  ok('ok=true on duplicate', r2.ok)
  if (r1.ok && r2.ok) {
    ok('same candidate reused (not duplicated)', r1.candidateId === r2.candidateId)
  }

  // 5. Missing consent
  console.log('\n[3] Missing consent')
  const r3 = await submitPublicApplicationAction(
    {
      jobSlug: job.publicSlug,
      firstName: 'X',
      lastName: 'Y',
      email: `no-consent-${randomBytes(2).toString('hex')}@example.com`,
      consent: '',
    },
    meta,
  )
  ok('ok=false', !r3.ok)
  if (!r3.ok) {
    ok('code = MISSING_CONSENT', r3.code === 'MISSING_CONSENT')
  }

  // 6. Invalid email
  console.log('\n[4] Invalid email')
  const r4 = await submitPublicApplicationAction(
    {
      jobSlug: job.publicSlug,
      firstName: 'X',
      lastName: 'Y',
      email: 'not-an-email',
      consent: 'on',
    },
    meta,
  )
  ok('ok=false', !r4.ok)
  if (!r4.ok) {
    ok('code = INVALID_EMAIL', r4.code === 'INVALID_EMAIL')
  }

  // 7. Honeypot — filled website field → silent success, no candidate
  console.log('\n[5] Honeypot (bot)')
  const beforeCount = await db.candidate.count({ where: { email: 'bot@spam.com' } })
  const r5 = await submitPublicApplicationAction(
    {
      jobSlug: job.publicSlug,
      firstName: 'Bot',
      lastName: 'Spammer',
      email: 'bot@spam.com',
      consent: 'on',
      website: 'http://spam.example.com', // ← honeypot filled
    },
    meta,
  )
  ok('honeypot returns ok=true (silent)', r5.ok)
  const afterCount = await db.candidate.count({ where: { email: 'bot@spam.com' } })
  ok('honeypot did NOT create a candidate', afterCount === beforeCount)

  // 8. Rate limit — first 4 of the 5 quota are used above
  //    (Test 1, 2, 3, 4 each count one. Test 5 honeypot returns early.)
  //    We need 1 more valid call to hit the limit, then the next is blocked.
  console.log('\n[6] Rate limit (5/hr per IP)')
  // This 5th call succeeds but exhausts the quota
  const r5a = await submitPublicApplicationAction(
    {
      jobSlug: job.publicSlug,
      firstName: 'X',
      lastName: 'Y',
      email: `quota-fill-${randomBytes(2).toString('hex')}@example.com`,
      consent: 'on',
    },
    meta,
  )
  ok('5th call (quota-filler) succeeds', r5a.ok)
  // The 6th should be blocked
  const r6 = await submitPublicApplicationAction(
    {
      jobSlug: job.publicSlug,
      firstName: 'X',
      lastName: 'Y',
      email: `ratelimit-${randomBytes(2).toString('hex')}@example.com`,
      consent: 'on',
    },
    meta,
  )
  ok('6th call blocked (ok=false)', !r6.ok)
  if (!r6.ok) {
    ok('code = RATE_LIMITED', r6.code === 'RATE_LIMITED')
  }

  // 9. Cleanup
  console.log('\n[cleanup]')
  if (r1.ok) {
    await db.activity.deleteMany({ where: { candidateId: r1.candidateId } })
    await db.cVFile.deleteMany({ where: { candidateId: r1.candidateId } })
    await db.candidate.delete({ where: { id: r1.candidateId } })
    console.log('  ✓ deleted test candidate + related rows')
  }
  if (r5a.ok && 'candidateId' in r5a) {
    await db.activity.deleteMany({ where: { candidateId: r5a.candidateId } })
    await db.candidate.delete({ where: { id: r5a.candidateId } })
    console.log('  ✓ deleted quota-filler candidate')
  }
  await db.emailOutbox.deleteMany({ where: { kind: 'new_public_application', to: { contains: '@' }, subject: { contains: 'Ada Lovelace' } } })
  console.log('  ✓ cleaned test outbox emails')

  console.log(`\n========== ${pass} pass, ${fail} fail ==========`)
  if (fail > 0) process.exit(1)
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
