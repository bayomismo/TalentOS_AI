/**
 * Sprint 9 — Public API for the `auth` module.
 *
 * Re-exports the central authorization layer, the Auth.js config, and
 * the session/invitation/audit utilities. This is the single import
 * surface for any code that needs identity, RBAC, or multi-tenant
 * authorization.
 */

export {
  auth,
  authConfig,
  handlers,
  signIn,
  signOut,
} from './auth'

export {
  requireAuth,
  requirePermission,
  requireAllPermissions,
  requireAnyPermission,
  requireOrg,
  authorizeResource,
  assertSameOrg,
  authSuccess,
  authFailure,
} from './authorize'

export {
  hasPermission,
  hasAllPermissions,
  hasAnyPermission,
  getPermissionsForRole,
  ROLE_PERMISSIONS,
} from './permissions'

export {
  hashPassword,
  comparePassword,
  validatePassword,
} from './password'

export {
  recordAuditLog,
} from './audit'

export {
  createInvitation,
  acceptInvitation,
  revokeInvitation,
  listActiveInvitations,
  buildInvitationUrl,
  hashToken,
  INVITATION_TTL_DAYS,
} from './invitation'

export {
  createSessionRecord,
  listActiveSessions,
  revokeSession,
  revokeAllSessionsForUser,
  changePassword,
  performPasswordChange,
  hashSessionToken,
} from './session'
export type { PerformPasswordChangeInput, PerformPasswordChangeResult } from './session'

export type {
  AuthContext,
  AuthFailure,
  AuthResult,
  AuthSuccess,
  AuthFailureCode,
  Permission,
  AuditAction,
} from './types'
