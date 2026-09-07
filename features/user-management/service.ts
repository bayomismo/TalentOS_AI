/**
 * Sprint 12 — User Management service.
 *
 * PART 3 + PART 4 + PART 5: server-side user management operations
 * with full RBAC, tenant isolation, last-ADMIN protection, and
 * audit logging.
 *
 * Every operation enforces:
 *   - requireAuth
 *   - requirePermission ('team.manage' / 'team.invite' / etc.)
 *   - organizationId from the authenticated session
 *   - last-ADMIN guard (cannot disable/demote the last active ADMIN)
 *   - Audit log
 */

import 'server-only'
import { db } from '@/lib/db'
import { recordAuditLog } from '@/lib/auth/audit'
import { hasPermission } from '@/lib/auth/permissions'
import {
  createInvitation,
  revokeInvitation,
  type CreateInvitationInput,
} from '@/lib/auth/invitation'
import { hashPassword } from '@/lib/auth/password'
import { randomUUID } from 'crypto'

export interface ServiceResult<T> {
  ok: boolean
  data?: T
  error?: { code: string; message: string }
}

// -----------------------------------------------------------------------------
// PART 3 — List + search + filter
// -----------------------------------------------------------------------------

export interface ListUsersInput {
  q?: string
  role?: string
  status?: string
}

export interface ListUsersResult {
  users: Array<{
    id: string
    email: string
    firstName: string
    lastName: string
    role: string
    status: string
    departmentId: string | null
    departmentName: string | null
    lastLoginAt: string | null
    createdAt: string
    disabledAt: string | null
  }>
  total: number
}

export async function listUsers(
  ctx: { organizationId: string; userId: string; role: string },
  input: ListUsersInput,
): Promise<ServiceResult<ListUsersResult>> {
  if (!hasPermission(ctx.role as any, 'team.manage' as any)) {
    return { ok: false, error: { code: 'PERMISSION_DENIED', message: 'You do not have permission to manage users.' } }
  }
  const where: any = { organizationId: ctx.organizationId }
  if (input.role) where.role = input.role
  if (input.status) where.status = input.status
  if (input.q) {
    where.OR = [
      { email: { contains: input.q, mode: 'insensitive' } },
      { firstName: { contains: input.q, mode: 'insensitive' } },
      { lastName: { contains: input.q, mode: 'insensitive' } },
    ]
  }
  const users = await db.user.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }],
    take: 200,
    include: { department: { select: { name: true } } },
  })
  return {
    ok: true,
    data: {
      users: users.map(u => ({
        id: u.id,
        email: u.email,
        firstName: u.firstName,
        lastName: u.lastName,
        role: u.role,
        status: u.status,
        departmentId: u.departmentId,
        departmentName: u.department?.name ?? null,
        lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
        createdAt: u.createdAt.toISOString(),
        disabledAt: u.disabledAt?.toISOString() ?? null,
      })),
      total: users.length,
    },
  }
}

// -----------------------------------------------------------------------------
// PART 3 — Change role
// -----------------------------------------------------------------------------

const ALL_ROLES = ['ADMIN', 'TA_LEAD', 'RECRUITER', 'HIRING_MANAGER', 'INTERVIEWER', 'VIEWER'] as const
type Role = (typeof ALL_ROLES)[number]

export interface ChangeRoleInput {
  userId: string
  newRole: Role
}

export async function changeUserRole(
  ctx: { organizationId: string; userId: string; role: string },
  input: ChangeRoleInput,
): Promise<ServiceResult<{ userId: string; newRole: Role }>> {
  if (!hasPermission(ctx.role as any, 'team.manage' as any)) {
    return { ok: false, error: { code: 'PERMISSION_DENIED', message: 'You do not have permission to change user roles.' } }
  }
  if (!ALL_ROLES.includes(input.newRole)) {
    return { ok: false, error: { code: 'INVALID_INPUT', message: 'Invalid role.' } }
  }
  // Tenant-isolated lookup
  const target = await db.user.findFirst({
    where: { id: input.userId, organizationId: ctx.organizationId },
  })
  if (!target) return { ok: false, error: { code: 'NOT_FOUND', message: 'User not found.' } }
  if (target.id === ctx.userId) {
    return { ok: false, error: { code: 'SELF_DEMOTION', message: 'You cannot change your own role. Ask another ADMIN.' } }
  }
  // Last-ADMIN protection: if demoting an ADMIN to a non-ADMIN role,
  // ensure at least one other active ADMIN remains.
  if (target.role === 'ADMIN' && input.newRole !== 'ADMIN') {
    const otherAdmins = await db.user.count({
      where: {
        organizationId: ctx.organizationId,
        role: 'ADMIN',
        status: 'ACTIVE',
        disabledAt: null,
        id: { not: target.id },
      },
    })
    if (otherAdmins < 1) {
      return {
        ok: false,
        error: {
          code: 'LAST_ADMIN',
          message: 'Cannot demote the last active ADMIN. Promote another user to ADMIN first.',
        },
      }
    }
  }
  const oldRole = target.role
  await db.user.update({ where: { id: target.id }, data: { role: input.newRole as any } })
  // PART 5: invalidate any active sessions for this user so they cannot
  // continue using their old role. The auth system requires re-login.
  await db.authSession.deleteMany({ where: { userId: target.id } })
  await recordAuditLog({
    organizationId: ctx.organizationId,
    actorId: ctx.userId,
    action: 'USER_ROLE_CHANGED',
    targetType: 'user',
    targetId: target.id,
    outcome: 'success',
    metadata: { from: oldRole, to: input.newRole, email: target.email },
  })
  return { ok: true, data: { userId: target.id, newRole: input.newRole } }
}

// -----------------------------------------------------------------------------
// PART 3 — Disable / re-enable
// -----------------------------------------------------------------------------

export interface SetUserStatusInput {
  userId: string
  status: 'ACTIVE' | 'DISABLED'
}

export async function setUserStatus(
  ctx: { organizationId: string; userId: string; role: string },
  input: SetUserStatusInput,
): Promise<ServiceResult<{ userId: string; status: 'ACTIVE' | 'DISABLED' }>> {
  if (!hasPermission(ctx.role as any, 'team.manage' as any)) {
    return { ok: false, error: { code: 'PERMISSION_DENIED', message: 'You do not have permission to manage users.' } }
  }
  if (input.status !== 'ACTIVE' && input.status !== 'DISABLED') {
    return { ok: false, error: { code: 'INVALID_INPUT', message: 'Invalid status.' } }
  }
  const target = await db.user.findFirst({
    where: { id: input.userId, organizationId: ctx.organizationId },
  })
  if (!target) return { ok: false, error: { code: 'NOT_FOUND', message: 'User not found.' } }
  if (target.id === ctx.userId && input.status === 'DISABLED') {
    return { ok: false, error: { code: 'SELF_DISABLE', message: 'You cannot disable your own account. Ask another ADMIN.' } }
  }
  // Last-ADMIN protection: disabling an active ADMIN
  if (target.role === 'ADMIN' && target.status === 'ACTIVE' && input.status === 'DISABLED') {
    const otherAdmins = await db.user.count({
      where: {
        organizationId: ctx.organizationId,
        role: 'ADMIN',
        status: 'ACTIVE',
        disabledAt: null,
        id: { not: target.id },
      },
    })
    if (otherAdmins < 1) {
      return {
        ok: false,
        error: {
          code: 'LAST_ADMIN',
          message: 'Cannot disable the last active ADMIN. Promote another user to ADMIN first.',
        },
      }
    }
  }
  // The User.status column is an EmploymentStatus enum
  // (ACTIVE | INACTIVE | ON_LEAVE | TERMINATED). For disabled
  // accounts we use TERMINATED plus disabledAt. Re-enable resets both.
  await db.user.update({
    where: { id: target.id },
    data: {
      status: (input.status === 'DISABLED' ? 'TERMINATED' : 'ACTIVE') as any,
      ...(input.status === 'DISABLED' ? { disabledAt: new Date() } : { disabledAt: null }),
    },
  })
  // Invalidate sessions for disabled users (re-enable does not auto-revoke)
  if (input.status === 'DISABLED') {
    await db.authSession.deleteMany({ where: { userId: target.id } })
  }
  await recordAuditLog({
    organizationId: ctx.organizationId,
    actorId: ctx.userId,
    action: input.status === 'DISABLED' ? 'USER_DISABLED' : 'USER_ENABLED',
    targetType: 'user',
    targetId: target.id,
    outcome: 'success',
    metadata: { email: target.email },
  })
  return { ok: true, data: { userId: target.id, status: input.status } }
}

// -----------------------------------------------------------------------------
// PART 4 — Invitation: create
// -----------------------------------------------------------------------------

export interface CreateUserInvitationInput {
  email: string
  firstName: string
  lastName: string
  role: Role
  departmentId?: string | null
}

export interface CreateUserInvitationResult {
  invitation: {
    id: string
    email: string
    role: string
    status: string
    expiresAt: string
  }
  /** Plaintext token. Only returned once. */
  token: string
  /** Full invitation URL. Only returned once. */
  url: string
}

export async function createUserInvitation(
  ctx: { organizationId: string; userId: string; role: string },
  input: CreateUserInvitationInput,
): Promise<ServiceResult<CreateUserInvitationResult>> {
  if (!hasPermission(ctx.role as any, 'team.invite' as any)) {
    return { ok: false, error: { code: 'PERMISSION_DENIED', message: 'You do not have permission to invite users.' } }
  }
  if (!ALL_ROLES.includes(input.role)) {
    return { ok: false, error: { code: 'INVALID_INPUT', message: 'Invalid role.' } }
  }
  // Validate email format (basic)
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) {
    return { ok: false, error: { code: 'INVALID_INPUT', message: 'Invalid email format.' } }
  }
  // Reject if a user with this email already exists in the org
  const existing = await db.user.findFirst({
    where: { email: input.email.toLowerCase(), organizationId: ctx.organizationId },
  })
  if (existing) {
    return { ok: false, error: { code: 'USER_EXISTS', message: 'A user with this email already exists.' } }
  }
  // Reject if a pending invitation already exists
  const pending = await db.invitation.findFirst({
    where: { email: input.email.toLowerCase(), organizationId: ctx.organizationId, status: 'PENDING' },
  })
  if (pending) {
    return { ok: false, error: { code: 'INVITATION_EXISTS', message: 'A pending invitation already exists for this email.' } }
  }
  try {
    const result = await createInvitation({
      organizationId: ctx.organizationId,
      email: input.email.toLowerCase(),
      firstName: input.firstName,
      lastName: input.lastName,
      role: input.role,
      departmentId: input.departmentId ?? null,
      invitedById: ctx.userId,
    })
    return {
      ok: true,
      data: {
        invitation: {
          id: result.invitation.id,
          email: result.invitation.email,
          role: result.invitation.role,
          status: result.invitation.status,
          expiresAt: result.invitation.expiresAt.toISOString(),
        },
        token: result.token,
        url: result.url,
      },
    }
  } catch (err) {
    return { ok: false, error: { code: 'INTERNAL', message: err instanceof Error ? err.message : 'Failed to create invitation.' } }
  }
}

// -----------------------------------------------------------------------------
// PART 4 — Invitation: list + revoke
// -----------------------------------------------------------------------------

export async function listInvitations(
  ctx: { organizationId: string; userId: string; role: string },
): Promise<ServiceResult<{ invitations: Array<{ id: string; email: string; role: string; status: string; expiresAt: string; createdAt: string; invitedByName: string | null }> }>> {
  if (!hasPermission(ctx.role as any, 'team.invite' as any)) {
    return { ok: false, error: { code: 'PERMISSION_DENIED', message: 'You do not have permission to view invitations.' } }
  }
  const invitations = await db.invitation.findMany({
    where: { organizationId: ctx.organizationId },
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: { invitedBy: { select: { firstName: true, lastName: true } } },
  })
  return {
    ok: true,
    data: {
      invitations: invitations.map(i => ({
        id: i.id,
        email: i.email,
        role: i.role,
        status: i.status,
        expiresAt: i.expiresAt.toISOString(),
        createdAt: i.createdAt.toISOString(),
        invitedByName: i.invitedBy ? `${i.invitedBy.firstName} ${i.invitedBy.lastName}`.trim() : null,
      })),
    },
  }
}

export async function revokeUserInvitation(
  ctx: { organizationId: string; userId: string; role: string },
  invitationId: string,
): Promise<ServiceResult<{ id: string; status: string }>> {
  if (!hasPermission(ctx.role as any, 'team.invite' as any)) {
    return { ok: false, error: { code: 'PERMISSION_DENIED', message: 'You do not have permission to revoke invitations.' } }
  }
  // Tenant-isolated
  const inv = await db.invitation.findFirst({ where: { id: invitationId, organizationId: ctx.organizationId } })
  if (!inv) return { ok: false, error: { code: 'NOT_FOUND', message: 'Invitation not found.' } }
  if (inv.status !== 'PENDING') {
    return { ok: false, error: { code: 'INVALID_STATE', message: `Invitation is ${inv.status.toLowerCase()}.` } }
  }
  const updated = await revokeInvitation(invitationId, ctx.userId)
  return { ok: true, data: { id: updated.id, status: updated.status } }
}
