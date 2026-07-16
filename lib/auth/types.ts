/**
 * Sprint 9 — Central authorization types.
 *
 * Every authenticated request resolves to an `AuthContext`. Every
 * authorization check derives its decision from a `Permission` constant.
 * This file is the single source of truth for RBAC vocabulary.
 *
 * RULE: server actions and pages MUST resolve identity via
 * `requireAuth()` / `requirePermission()` from `./authorize.ts` and MUST
 * NOT trust organizationId / userId from the request body.
 */

import type { UserRole } from '@prisma/client'

/** All permissions the application knows about. New permissions MUST be
 * added here and wired into `ROLE_PERMISSIONS` in `./permissions.ts`. */
export const PERMISSIONS = [
  // Organization
  'organization.manage',

  // Team
  'team.view',
  'team.manage',
  'team.invite',
  'team.change_role',
  'team.disable_user',

  // Hiring Requests
  'hiring_request.view',
  'hiring_request.create',
  'hiring_request.edit',
  'hiring_request.close',

  // Candidates
  'candidate.view',
  'candidate.create',
  'candidate.edit',
  'candidate.change_stage',

  // CV
  'cv.upload',
  'cv.view',

  // AI
  'ai.generate_job_description',
  'ai.analyze_candidate',
  'ai.generate_interview_kit',
  'ai.generate_decision_brief',

  // Interviews
  'interview.view',
  'interview.create',
  'interview.schedule',
  'interview.evaluate',

  // Decisions
  'decision.view',
  'decision.compare',
  'decision.record',

  // Offers (Sprint 10)
  'offer.view',
  'offer.view_compensation',
  'offer.create',
  'offer.edit',
  'offer.submit_for_approval',
  'offer.approve',
  'offer.issue',
  'offer.record_response',
  'offer.withdraw',

  // Reports
  'reports.view',

  // Settings
  'settings.view',
  'settings.manage',

  // Audit
  'audit.view',
] as const

export type Permission = (typeof PERMISSIONS)[number]

/** Audit log action constants. Adding new ones: extend this union and the
 * UI badges in `app/(app)/settings/_components/audit-log.tsx`. */
export type AuditAction =
  | 'LOGIN_SUCCESS'
  | 'LOGIN_FAILURE'
  | 'LOGOUT'
  | 'SESSION_REVOKED'
  | 'INVITATION_CREATED'
  | 'INVITATION_ACCEPTED'
  | 'INVITATION_REVOKED'
  | 'INVITATION_EXPIRED'
  | 'INVITATION_RESEND'
  | 'USER_ROLE_CHANGED'
  | 'USER_DISABLED'
  | 'USER_ENABLED'
  | 'PASSWORD_CHANGED'
  | 'PASSWORD_RESET_REQUESTED'
  | 'ACCESS_DENIED'
  | 'CROSS_TENANT_DENIED'
  | 'HUMAN_DECISION_RECORDED'
  | 'HIRING_REQUEST_CREATED'
  | 'HIRING_REQUEST_CLOSED'
  | 'CANDIDATE_STAGE_CHANGED'
  | 'CANDIDATE_CV_UPLOADED'
  | 'CANDIDATE_ANALYZED'
  | 'INTERVIEW_CREATED'
  | 'INTERVIEW_EVALUATED'
  | 'AI_JOB_DESCRIPTION_GENERATED'
  | 'AI_INTERVIEW_KIT_GENERATED'
  | 'AI_DECISION_BRIEF_GENERATED'
  | 'OFFER_CREATED'
  | 'OFFER_EDITED'
  | 'OFFER_DRAFT_GENERATED'
  | 'OFFER_SUBMITTED_FOR_APPROVAL'
  | 'OFFER_RETURNED_FOR_CHANGES'
  | 'OFFER_APPROVED'
  | 'OFFER_SELF_APPROVED_BY_ADMIN'
  | 'OFFER_ISSUED'
  | 'OFFER_ACCEPTED'
  | 'OFFER_DECLINED'
  | 'OFFER_WITHDRAWN'
  | 'OFFER_EXPIRED'
  | 'COPILOT_QUERY_EXECUTED'
  | 'COPILOT_TOOL_BLOCKED'
  | 'COPILOT_PROMPT_INJECTION_BLOCKED'
  | 'COPILOT_ACTION_PREPARED'
  | 'COPILOT_ACTION_EXECUTED'
  | 'COPILOT_ACTION_CANCELLED'
  | 'COPILOT_ACTION_FAILED'
  | 'COPILOT_ACTION_DENIED'
  | 'COPILOT_UNSUPPORTED_ACTION'
  | 'DATA_CLEANUP_EXECUTED'
  | 'DATA_CLEANUP_PREVIEWED'
  | 'DATA_RESET_EXECUTED'
  | 'DATA_RESET_PREVIEWED'

/** Resolved authenticated context. The session is JWT-backed; the
 * `passwordChangedAt` and `disabledAt` fields are re-read on every request
 * from the User table so a password change or disable invalidates existing
 * JWTs without rotating AUTH_SECRET. */
export interface AuthContext {
  userId: string
  organizationId: string
  email: string
  firstName: string
  lastName: string
  role: UserRole
  isAdmin: boolean
  /** True when the user has an HR-scoped view; used to gate recruiter-style
   * org-wide read access. */
  canReadOrgHiringData: boolean
  /** For audit + invalidation checks. */
  passwordChangedAt: Date | null
  disabledAt: Date | null
}

/** Result shape used by server actions for unauthenticated / unauthorized
 * responses. The UI maps this to a redirect or an inline message. */
export type AuthFailureCode =
  | 'UNAUTHENTICATED'
  | 'UNAUTHORIZED'
  | 'USER_DISABLED'
  | 'PASSWORD_CHANGED'
  | 'TENANT_MISMATCH'
  | 'NOT_FOUND'

export interface AuthFailure {
  ok: false
  code: AuthFailureCode
  message: string
}

export interface AuthSuccess<T> {
  ok: true
  data: T
}

export type AuthResult<T> = AuthSuccess<T> | AuthFailure
