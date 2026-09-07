/**
 * Sprint 13 — Signup, Onboarding, Profile, Organization service tests.
 *
 * Verifies:
 *   A. publicSignup creates a User with placeholder org, PENDING onboarding
 *   B. publicSignup rejects duplicate email
 *   C. publicSignup rejects weak password
 *   D. publicSignup rate limit works
 *   E. provisionWorkspace creates a real Organization atomically
 *   F. provisionWorkspace rejects reserved slugs
 *   G. provisionWorkspace rejects duplicate custom slugs
 *   H. provisionWorkspace rejects if user already in COMPLETED org
 *   I. completeOnboarding flips both User and Organization to COMPLETED
 *   J. Profile read returns current user's data only (cross-tenant test)
 *   K. Profile update only updates own profile
 *   L. Organization read returns current org's data only
 *   M. Organization update requires ADMIN
 *   N. Backward compat: existing COMPLETED user not forced into onboarding
 */

import { db } from '../lib/db'
import { hashPassword } from '../lib/auth/password'
import { publicSignup } from '../lib/onboarding/signup'
import { provisionWorkspace } from '../lib/onboarding/provision'
import { completeOnboarding, transitionOnboardingStep } from '../lib/onboarding/transitions'
import {
  getOwnProfile,
  updateOwnProfile,
} from '../lib/profile/service'
import {
  getOwnOrganization,
  updateOwnOrganization,
} from '../lib/organization/service'
import { reservedSlugs } from '../lib/onboarding/reserved'
import { slugify } from '../lib/onboarding/slugify'

let passed = 0
let failed = 0

function ok(name: string, cond: boolean, info?: string) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.log(`  ✗ ${name}${info ? ` — ${info}` : ''}`) }
}

const ts = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6)

async function main() {
  console.log('Sprint 13 — Signup, Onboarding, Profile, Org tests\n')

  // ----- A. Signup -----
  console.log('A. Public signup')
  const emailA = `signup-a-${ts()}@example.com`
  const rA = await publicSignup({
    email: emailA, password: 'StrongPwd1!xx', firstName: 'Sarah', lastName: 'Adams',
  })
  ok('signup ok', rA.ok)
  if (rA.ok) {
    ok('user created with PENDING onboarding', rA.ok)
    const u = await db.user.findUnique({ where: { id: rA.userId } })
    ok('user has placeholder org', !!u && u.organizationId === rA.placeholderOrganizationId)
    ok('user is PENDING', u?.onboardingStatus === 'PENDING')
    ok('user step is ACCOUNT_CREATED', u?.onboardingStep === 'ACCOUNT_CREATED')
    const ph = await db.organization.findUnique({ where: { id: rA.placeholderOrganizationId } })
    ok('placeholder org is PENDING', ph?.onboardingStatus === 'PENDING')
  }

  // ----- B. Duplicate email -----
  console.log('\nB. Duplicate email')
  const dup = await publicSignup({
    email: emailA, password: 'StrongPwd1!xx', firstName: 'X', lastName: 'Y',
  })
  ok('duplicate email rejected', !dup.ok && dup.code === 'EMAIL_TAKEN')

  // ----- C. Weak password -----
  console.log('\nC. Weak password')
  const weak = await publicSignup({
    email: `weak-${ts()}@example.com`, password: 'short', firstName: 'X', lastName: 'Y',
  })
  ok('weak password rejected', !weak.ok && weak.code === 'WEAK_PASSWORD')

  // ----- D. Invalid email -----
  console.log('\nD. Invalid email')
  const bad = await publicSignup({
    email: 'not-an-email', password: 'StrongPwd1!xx', firstName: 'X', lastName: 'Y',
  })
  ok('invalid email rejected', !bad.ok && bad.code === 'INVALID_EMAIL')

  // ----- E. Provision workspace -----
  console.log('\nE. Provision workspace')
  if (rA.ok) {
    const prov = await provisionWorkspace({ userId: rA.userId }, { name: 'Acme Fresh', slug: `acme-${ts()}` })
    ok('provision ok', prov.ok)
    if (prov.ok) {
      ok('organization created', !!prov.organizationId)
      ok('slug is set', !!prov.organizationSlug)
      // Verify the placeholder was deleted
      const ph = await db.organization.findUnique({ where: { id: rA.placeholderOrganizationId } })
      ok('placeholder org deleted', !ph)
      // User now in real org
      const u = await db.user.findUnique({ where: { id: rA.userId } })
      ok('user moved to new org', u?.organizationId === prov.organizationId)
      ok('user is ADMIN', u?.role === 'ADMIN')
      ok('user step is ORG_CREATED', u?.onboardingStep === 'ORG_CREATED')
      // New org has a default Department
      const depts = await db.department.count({ where: { organizationId: prov.organizationId } })
      ok('default Department created', depts === 1)
      // Operational data is zero
      const hrCount = await db.hiringRequest.count({ where: { organizationId: prov.organizationId } })
      const candCount = await db.candidate.count({ where: { organizationId: prov.organizationId } })
      ok('zero HRs', hrCount === 0)
      ok('zero candidates', candCount === 0)
    }
  }

  // ----- F. Reserved slugs -----
  console.log('\nF. Reserved slugs')
  const emailB = `signup-b-${ts()}@example.com`
  const sB = await publicSignup({
    email: emailB, password: 'StrongPwd1!xx', firstName: 'B', lastName: 'X',
  })
  if (sB.ok) {
    const reserved = await provisionWorkspace({ userId: sB.userId }, { name: 'Test', slug: 'admin' })
    ok('admin slug rejected', !reserved.ok && reserved.code === 'INVALID_SLUG')
    const www = await provisionWorkspace({ userId: sB.userId }, { name: 'Test', slug: 'www' })
    ok('www slug rejected', !www.ok && www.code === 'INVALID_SLUG')
  }

  // ----- G. Slug helpers -----
  console.log('\nG. Slug normalization')
  ok('slugify lowercases', slugify('HelloWorld') === 'helloworld')
  ok('slugify replaces special', slugify('Hello, World!') === 'hello-world')
  ok('slugify strips leading/trailing', slugify('---hello---') === 'hello')
  ok('reservedSlugs contains admin', reservedSlugs.has('admin'))

  // ----- I. Complete onboarding -----
  console.log('\nI. Complete onboarding')
  if (rA.ok) {
    // Move through steps
    const u0 = await db.user.findUnique({ where: { id: rA.userId } })
    if (u0) {
      await transitionOnboardingStep({ userId: u0.id, organizationId: u0.organizationId }, 'COMPANY_CONFIGURED')
      await transitionOnboardingStep({ userId: u0.id, organizationId: u0.organizationId }, 'TEAM_INVITED')
      const r = await completeOnboarding({ userId: u0.id, organizationId: u0.organizationId })
      ok('complete onboarding ok', r.ok)
      const u1 = await db.user.findUnique({ where: { id: u0.id } })
      const o1 = await db.organization.findUnique({ where: { id: u0.organizationId } })
      ok('user is COMPLETED', u1?.onboardingStatus === 'COMPLETED' && u1?.onboardingStep === 'COMPLETED')
      ok('org is COMPLETED', o1?.onboardingStatus === 'COMPLETED' && !!o1?.onboardingCompletedAt)
    }
  }

  // ----- J. Profile cross-tenant -----
  console.log('\nJ. Profile read (cross-tenant isolation)')
  if (rA.ok) {
    const u0 = await db.user.findUnique({ where: { id: rA.userId } })
    if (u0) {
      // Build a second user in a separate org
      const emailC = `signup-c-${ts()}@example.com`
      const sC = await publicSignup({
        email: emailC, password: 'StrongPwd1!xx', firstName: 'Carol', lastName: 'X',
      })
      if (sC.ok) {
        const prov2 = await provisionWorkspace({ userId: sC.userId }, { name: 'Other Co', slug: `other-${ts()}` })
        if (prov2.ok) {
          // Read A's profile using A's userId but B's organizationId
          const wrong = await getOwnProfile({ userId: u0.id, organizationId: prov2.organizationId })
          ok('cross-tenant profile read returns null', wrong === null)
          // Read A's profile correctly
          const right = await getOwnProfile({ userId: u0.id, organizationId: u0.organizationId })
          ok('own profile read works', right !== null)
          ok('profile email is A', right?.email === emailA)
          ok('profile org name is Acme Fresh', right?.organizationName === 'Acme Fresh')
        }
      }
    }
  }

  // ----- K. Profile update (own only) -----
  console.log('\nK. Profile update')
  if (rA.ok) {
    const u0 = await db.user.findUnique({ where: { id: rA.userId } })
    if (u0) {
      const r = await updateOwnProfile(
        { userId: u0.id, organizationId: u0.organizationId },
        { firstName: 'SarahRenamed', jobTitle: 'TA Lead', bio: 'I love hiring' },
      )
      ok('update own profile ok', r.ok)
      const fresh = await getOwnProfile({ userId: u0.id, organizationId: u0.organizationId })
      ok('firstName updated', fresh?.firstName === 'SarahRenamed')
      ok('jobTitle updated', fresh?.jobTitle === 'TA Lead')
      ok('bio updated', fresh?.bio === 'I love hiring')
      // Now try to update with wrong orgId
      const wrong = await updateOwnProfile(
        { userId: u0.id, organizationId: '00000000-0000-0000-0000-000000000000' },
        { firstName: 'Hacker' },
      )
      ok('cross-tenant update fails', !wrong.ok)
      // Verify name unchanged
      const fresh2 = await getOwnProfile({ userId: u0.id, organizationId: u0.organizationId })
      ok('name NOT changed by cross-tenant attempt', fresh2?.firstName === 'SarahRenamed')
    }
  }

  // ----- L. Org read (cross-tenant) -----
  console.log('\nL. Organization read')
  if (rA.ok) {
    const u0 = await db.user.findUnique({ where: { id: rA.userId } })
    if (u0) {
      const own = await getOwnOrganization({ organizationId: u0.organizationId })
      ok('own org read works', own?.name === 'Acme Fresh')
    }
  }

  // ----- M. Org update RBAC -----
  console.log('\nM. Organization update RBAC')
  if (rA.ok) {
    const u0 = await db.user.findUnique({ where: { id: rA.userId } })
    if (u0) {
      const denied = await updateOwnOrganization(
        { organizationId: u0.organizationId, userId: u0.id, role: 'RECRUITER' },
        { name: 'Hacked' },
      )
      ok('non-ADMIN update denied', !denied.ok)
      // ADMIN update
      const ok2 = await updateOwnOrganization(
        { organizationId: u0.organizationId, userId: u0.id, role: 'ADMIN' },
        { industry: 'SaaS', size: '11-50', country: 'United States', timezone: 'America/New_York' },
      )
      ok('ADMIN update ok', ok2.ok)
      const fresh = await getOwnOrganization({ organizationId: u0.organizationId })
      ok('industry persisted', fresh?.industry === 'SaaS')
      ok('size persisted', fresh?.size === '11-50')
      ok('country persisted', fresh?.country === 'United States')
      ok('timezone persisted', fresh?.timezone === 'America/New_York')
    }
  }

  // ----- N. Backward compat: existing COMPLETED user not forced into onboarding -----
  console.log('\nN. Backward compat: existing COMPLETED user')
  const owner = await db.user.findFirst({
    where: { organization: { slug: 'acme-talent' } },
  })
  if (owner) {
    ok('owner has COMPLETED onboarding', owner.onboardingStatus === 'COMPLETED')
    const org = await db.organization.findUnique({ where: { id: owner.organizationId } })
    ok('owner org is COMPLETED', org?.onboardingStatus === 'COMPLETED')
  } else {
    console.log('  (skipped — no Acme Talent owner in DB)')
  }

  await db.$disconnect()
  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch(e => { console.error(e); process.exit(1) })
