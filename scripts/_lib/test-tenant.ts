/**
 * Sprint 12 — Test tenant helper.
 *
 * PART 6: production test isolation. Every production E2E script MUST
 * use this helper to create a dedicated test organization in the
 * production database and clean it up at the end of the run.
 *
 * The real production organization is NEVER touched by E2E tests.
 *
 * Usage:
 *
 *   import { withTestTenant } from './_lib/test-tenant'
 *   await withTestTenant(async (ctx) => { ... })
 *
 * - Creates a fresh Organization, Department, ADMIN user.
 * - Returns a context with credentials + organizationId.
 * - On completion (or failure), DELETES the entire org and its
 *   children via ON DELETE CASCADE. The real org is never touched.
 */

import 'dotenv/config'
import { randomUUID } from 'crypto'
import { db } from '../../lib/db'
import { hashPassword } from '../../lib/auth/password'

export interface TestTenantContext {
  organizationId: string
  organizationSlug: string
  organizationName: string
  adminUserId: string
  adminEmail: string
  adminPassword: string
  /** The URL of the running app (e.g. https://talentos-ai-lime.vercel.app) */
  baseUrl: string
}

export const DEFAULT_TEST_PASSWORD = 'TestTenantPwd1!'

export async function createTestTenant(opts: { label: string; baseUrl: string }): Promise<TestTenantContext> {
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`
  const slug = `test-${opts.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${suffix}`
  const name = `Test Tenant (${opts.label}) ${suffix}`

  const org = await db.organization.create({
    data: { name, slug, settings: {} },
  })

  const email = `test-${opts.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${suffix}@test.local`
  const password = DEFAULT_TEST_PASSWORD
  const user = await db.user.create({
    data: {
      organizationId: org.id,
      email,
      firstName: 'Test',
      lastName: opts.label,
      role: 'ADMIN',
      status: 'ACTIVE',
      passwordHash: await hashPassword(password),
      passwordChangedAt: new Date(),
    },
  })

  return {
    organizationId: org.id,
    organizationSlug: slug,
    organizationName: name,
    adminUserId: user.id,
    adminEmail: email,
    adminPassword: password,
    baseUrl: opts.baseUrl,
  }
}

export async function destroyTestTenant(ctx: TestTenantContext): Promise<void> {
  // ON DELETE CASCADE on the Organization row removes all dependent rows:
  // User, Department, HiringRequest, Candidate, Interview, Offer,
  // Activity, AITask, AuditLog, Invitation, AuthSession, etc.
  // The real organization and its data are NOT touched.
  await db.organization.delete({ where: { id: ctx.organizationId } }).catch(() => null)
}

export async function withTestTenant<T>(opts: { label: string; baseUrl: string }, fn: (ctx: TestTenantContext) => Promise<T>): Promise<T> {
  const ctx = await createTestTenant(opts)
  console.log(`  [test-tenant] created ${ctx.organizationSlug}`)
  try {
    return await fn(ctx)
  } finally {
    await destroyTestTenant(ctx)
    console.log(`  [test-tenant] destroyed ${ctx.organizationSlug}`)
  }
}
