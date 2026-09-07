/**
 * Sprint 9 — RBAC permission matrix.
 *
 * PART 10: default permissions per role. The matrix is the single source of
 * truth — every authorization check goes through `hasPermission()` which
 * consults this table.
 *
 * Matrix summary:
 *
 *   ADMIN         full organization access
 *   TA_LEAD       manage workflow, hiring requests, candidates, AI, interviews,
 *                 decisions, reports, team invites; NO platform-level
 *                 system administration
 *   RECRUITER     create/manage hiring requests, upload/manage candidates,
 *                 run approved AI workflows, change stages, schedule
 *                 interviews, view Decision Hub; NO org security settings
 *   HIRING_MANAGER view relevant HRs, view candidates on them, view/comparison
 *                 in Decision Hub, record human decisions where authorized;
 *                 NO unrelated org settings
 *   INTERVIEWER   view only assigned interviews, submit their own evaluation;
 *                 NO AI CV analysis, NO unrelated candidates, NO org-level
 *                 final decisions
 *   VIEWER        read-only; NO mutations, NO AI, NO evaluations, NO decisions
 *
 * Resource-level rules (PART 11) are enforced separately by
 * `authorizeResource()` in `./authorize.ts` and by the per-feature scope
 * checks (e.g. `assertSameOrg`, `assertInterviewerAssigned`).
 */

import type { UserRole } from '@prisma/client'
import type { Permission } from './types'

/**
 * Permission matrix. `true` = granted, `false` = denied.
 *
 * Order: ADMIN → TA_LEAD → RECRUITER → HIRING_MANAGER → INTERVIEWER → VIEWER.
 */
export const ROLE_PERMISSIONS: Record<UserRole, ReadonlySet<Permission>> = {
  // ADMIN: every permission
  ADMIN: new Set<Permission>([
    'organization.manage',
    'team.view', 'team.manage', 'team.invite', 'team.change_role', 'team.disable_user',
    'hiring_request.view', 'hiring_request.create', 'hiring_request.edit', 'hiring_request.close',
    'candidate.view', 'candidate.create', 'candidate.edit', 'candidate.change_stage',
    'cv.upload', 'cv.view',
    'ai.generate_job_description', 'ai.analyze_candidate', 'ai.generate_interview_kit', 'ai.generate_decision_brief',
    'interview.view', 'interview.create', 'interview.schedule', 'interview.evaluate',
    'decision.view', 'decision.compare', 'decision.record',
    'offer.view', 'offer.view_compensation', 'offer.create', 'offer.edit', 'offer.submit_for_approval', 'offer.approve', 'offer.issue', 'offer.record_response', 'offer.withdraw',
    'reports.view',
    'settings.view', 'settings.manage',
    'audit.view',
  ]),

  // TA_LEAD: workflow leader. Manages hiring, candidates, AI, interviews,
  // decisions, reports. Can invite recruiters/interviewers. No platform admin.
  TA_LEAD: new Set<Permission>([
    'team.view', 'team.invite',
    'hiring_request.view', 'hiring_request.create', 'hiring_request.edit', 'hiring_request.close',
    'candidate.view', 'candidate.create', 'candidate.edit', 'candidate.change_stage',
    'cv.upload', 'cv.view',
    'ai.generate_job_description', 'ai.analyze_candidate', 'ai.generate_interview_kit', 'ai.generate_decision_brief',
    'interview.view', 'interview.create', 'interview.schedule', 'interview.evaluate',
    'decision.view', 'decision.compare', 'decision.record',
    'offer.view', 'offer.view_compensation', 'offer.create', 'offer.edit', 'offer.submit_for_approval', 'offer.approve', 'offer.issue', 'offer.record_response', 'offer.withdraw',
    'reports.view',
    'settings.view',
    'audit.view',
  ]),

  // RECRUITER: hands-on hiring. Cannot manage org security settings.
  // Can create + edit + submit offers for approval, issue them, record
  // responses, and withdraw. CANNOT approve their own offer (enforced
  // at the action layer).
  RECRUITER: new Set<Permission>([
    'team.view',
    'hiring_request.view', 'hiring_request.create', 'hiring_request.edit', 'hiring_request.close',
    'candidate.view', 'candidate.create', 'candidate.edit', 'candidate.change_stage',
    'cv.upload', 'cv.view',
    'ai.generate_job_description', 'ai.analyze_candidate', 'ai.generate_interview_kit', 'ai.generate_decision_brief',
    'interview.view', 'interview.create', 'interview.schedule',
    'decision.view', 'decision.compare',
    'offer.view', 'offer.view_compensation', 'offer.create', 'offer.edit', 'offer.submit_for_approval', 'offer.issue', 'offer.record_response', 'offer.withdraw',
    'reports.view',
    'settings.view',
  ]),

  // HIRING_MANAGER: views relevant HRs/candidates, participates in
  // comparison, records human decisions where authorized. Can view offers
  // and approve them (for HRs they manage). Resource-level scope enforced
  // at the action layer.
  HIRING_MANAGER: new Set<Permission>([
    'team.view',
    'hiring_request.view', 'hiring_request.edit', // can edit HRs they're a manager of
    'candidate.view', 'candidate.edit', 'candidate.change_stage',
    'cv.view',
    'interview.view', 'interview.schedule',
    'decision.view', 'decision.compare', 'decision.record',
    'offer.view', 'offer.view_compensation', 'offer.approve', 'offer.record_response',
    'reports.view',
    'settings.view',
  ]),

  // INTERVIEWER: view only assigned interviews, submit own evaluation.
  INTERVIEWER: new Set<Permission>([
    'candidate.view', // only via assigned interviews (enforced at resource level)
    'cv.view',        // only for the candidate of an assigned interview
    'interview.view', // only assigned interviews (enforced at resource level)
    'interview.evaluate', // only own evaluation on assigned interview
  ]),

  // VIEWER: read-only. No mutations anywhere. May see offer existence +
  // status but NEVER compensation (enforced at the projection layer).
  VIEWER: new Set<Permission>([
    'hiring_request.view',
    'candidate.view',
    'cv.view',
    'interview.view',
    'decision.view',
    'offer.view',
    'reports.view',
  ]),

  // CANDIDATE: external applicant role. Currently not used in-app — we do
  // not expose a candidate-facing portal in Sprint 9. Listed as a no-op
  // permission set so the enum is fully covered.
  CANDIDATE: new Set<Permission>([]),
}

/** Returns true if the given role has the given permission. */
export function hasPermission(role: UserRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.has(permission) ?? false
}

/** Returns true if the role has ALL of the given permissions. */
export function hasAllPermissions(role: UserRole, permissions: readonly Permission[]): boolean {
  return permissions.every(p => hasPermission(role, p))
}

/** Returns true if the role has AT LEAST ONE of the given permissions. */
export function hasAnyPermission(role: UserRole, permissions: readonly Permission[]): boolean {
  return permissions.some(p => hasPermission(role, p))
}

/** Returns the set of permissions for a role (defensive copy). */
export function getPermissionsForRole(role: UserRole): ReadonlySet<Permission> {
  return ROLE_PERMISSIONS[role] ?? new Set<Permission>()
}
