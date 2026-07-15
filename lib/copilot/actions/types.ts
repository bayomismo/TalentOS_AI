/**
 * Sprint 11.1 — Copilot Action contract.
 *
 * PART 3: every Action in the ActionRegistry implements this contract.
 * The AI may help produce the action id and candidate arguments, but
 * the server owns authentication, authorization, validation, preview
 * generation, and execution.
 *
 * The two-phase model (PART 4) is mandatory:
 *   - prepare(): no mutation. Returns a confirmationId + preview.
 *   - execute(): re-checks auth, loads the confirmation, calls the
 *     domain service, marks the confirmation consumed.
 */

import 'server-only'
import type { z } from 'zod'
import type { CopilotAuthContext } from '../types'

/**
 * The lifecycle states a confirmation can be in.
 * Mirrors `CopilotActionStatus` in the Prisma schema.
 */
export type ConfirmationStatus = 'PENDING' | 'EXECUTED' | 'EXPIRED' | 'CANCELLED' | 'FAILED'

/**
 * The three allowed actions. Hard whitelist — see Sprint 11.1 spec.
 * Mirrors `CopilotActionType` in the Prisma schema.
 */
export type AllowedActionType =
  | 'CREATE_HIRING_REQUEST_DRAFT'
  | 'SCHEDULE_INTERVIEW'
  | 'CREATE_OFFER_DRAFT'

/**
 * The canonical id used in the AI catalog and the database.
 * Must equal one of the AllowedActionType values.
 */
export type ActionId = AllowedActionType

/**
 * Server-controlled context for a confirmation row. Captured at PREPARE
 * time and re-checked at CONFIRM time. The browser cannot influence
 * any of these fields.
 */
export interface ActionContextSnapshot {
  userId: string
  organizationId: string
  userRole: string
  isAdmin: boolean
  isTaLead: boolean
}

/**
 * Result of a successful action execution. The domain service returns
 * the canonical resource id + a deterministic label that the UI can
 * render without trusting the model.
 */
export interface ActionExecutionResult {
  resourceId: string
  resourceType: 'HiringRequest' | 'Interview' | 'Offer'
  canonicalUrl: string
  label: string
}

/**
 * Failure shape returned by prepare/execute. The orchestrator converts
 * this to a structured response for the UI.
 */
export interface ActionFailure {
  code:
    | 'INPUT_INVALID'
    | 'PERMISSION_DENIED'
    | 'RESOURCE_NOT_FOUND'
    | 'BUSINESS_STATE_INVALID'
    | 'EXPIRED'
    | 'ALREADY_CONSUMED'
    | 'CONCURRENCY_CONFLICT'
    | 'INTERNAL'
  message: string
  /** Safe details that can be shown to the user (no secrets). */
  details?: Record<string, unknown>
}

/**
 * The Action contract. Each Action implementation is a thin object
 * with three function references:
 *   - prepare: build a preview and persist a confirmation row
 *   - execute: re-validate everything and call the domain service
 *
 * NO Action has a generic `execute` or `run` method. The Action
 * contract is typed at the language level so Gemini cannot invent
 * a generic mutator.
 */
export interface CopilotActionDefinition<I, P, R = ActionExecutionResult> {
  /** Stable, hard-coded id. Used by the AI catalog and the DB. */
  id: ActionId
  /** Human-readable description. Used in the AI catalog. */
  description: string
  /** Zod schema for the AI's candidate arguments. */
  inputSchema: z.ZodType<I>
  /** Zod schema for the server-generated preview. */
  previewSchema: z.ZodType<P>
  /** Strongly-typed result schema (validated post-execution). */
  resultSchema: z.ZodType<R>
  /** Permissions required to PREPARE the action. */
  requiredPermissions: string[]
  /**
   * PHASE 1: validate input, build a preview, persist a confirmation
   * row. NO business mutation occurs.
   */
  prepare(ctx: CopilotAuthContext, input: I): Promise<
    | { ok: true; confirmationId: string; preview: P; expiresAt: Date }
    | { ok: false; failure: ActionFailure }
  >
  /**
   * PHASE 2: load the confirmation by id, re-check everything, and
   * call the domain service. Marks the confirmation consumed.
   *
   * The server reconstructs the payload from the confirmation row —
   * the browser cannot influence what gets executed.
   */
  execute(
    ctx: CopilotAuthContext,
    confirmationId: string,
  ): Promise<
    | { ok: true; result: R; confirmationId: string }
    | { ok: false; failure: ActionFailure }
  >
}

/**
 * Discriminated union of the preview types. The UI uses this to render
 * the right confirmation card.
 */
export type AnyActionPreview = {
  actionId: ActionId
  title: string
  summary: string
  bullets: string[]
  warnings?: string[]
  fields: Array<{ label: string; value: string; sensitive?: boolean }>
  canonicalUrlAfterExecute?: string
}
