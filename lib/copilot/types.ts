/**
 * Sprint 11 — Copilot core types.
 *
 * The Copilot is a read-only intelligence layer that answers
 * natural-language questions about authorized TalentOS data.
 *
 * The architecture guarantees that:
 *   - The model has access only to registered, permission-aware,
 *     tenant-scoped read tools.
 *   - All authorization happens in server code, not in prompts.
 *   - Tools never execute arbitrary SQL, Prisma, or model-generated
 *     code.
 *   - Compensation is stripped before data reaches the model.
 */

import type { Permission } from '@/lib/auth/types'

/**
 * A single read-only Copilot tool. Every tool:
 *  - has a stable id
 *  - has a server-side executor
 *  - declares its required permission
 *  - validates its input + output with Zod
 *  - is tenant-scoped (uses ctx.organizationId automatically)
 */
export interface CopilotTool<I, O> {
  id: string
  description: string
  requiredPermission: Permission
  inputSchema: import('zod').ZodType<I>
  outputSchema: import('zod').ZodType<O>
  /**
   * Server-side executor. Receives the authenticated context and
   * validated input. Must NOT receive any database connection, Prisma
   * client reference, or model-generated code. Must enforce tenant
   * scope and resource-level authorization.
   */
  execute: (ctx: CopilotAuthContext, input: I) => Promise<O>
}

export interface CopilotAuthContext {
  userId: string
  organizationId: string
  role: string
  isAdmin: boolean
  /** Cached for tool permission checks. */
  hasPermission: (p: Permission) => boolean
}

/**
 * Result of a tool call. `ok: false` reasons:
 *   - NOT_FOUND: resource does not exist OR belongs to another tenant
 *   - ACCESS_DENIED: caller lacks the required permission
 *   - INVALID_INPUT: input failed Zod validation
 *   - INTERNAL: unexpected error
 */
export type ToolResult<O> =
  | { ok: true; data: O }
  | { ok: false; code: 'NOT_FOUND' | 'ACCESS_DENIED' | 'INVALID_INPUT' | 'INTERNAL'; message: string }

/**
 * Maximum tool executions per Copilot turn (PART 27). Prevents
 * uncontrolled loops and bounds Gemini calls.
 */
export const MAX_TOOL_CALLS_PER_TURN = 5

/**
 * Maximum records returned to Gemini from a single tool (PART 20).
 * Larger datasets are returned as aggregate counts and the user is
 * asked to narrow scope.
 */
export const MAX_RECORDS_PER_TOOL = 50
