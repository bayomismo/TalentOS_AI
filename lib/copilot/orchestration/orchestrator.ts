/**
 * Sprint 11.1 — Copilot orchestrator (read-only + actions).
 *
 * The end-to-end pipeline:
 *   1. resolveCopilotContext
 *   2. prompt-injection defense
 *   3. classifyIntent → READ_QUERY | ACTION_REQUEST | UNSUPPORTED_ACTION
 *   4a. READ_QUERY: existing Sprint 11 read-only flow
 *   4b. ACTION_REQUEST: ask the model for {actionId, arguments} then
 *       call action.prepare() — no mutation
 *   4c. UNSUPPORTED_ACTION: refuse + audit
 *   5. Action execution is a SEPARATE entry point (`executeCopilotAction`)
 *      that runs after explicit user confirmation.
 *
 * PART 4 + PART 9 + PART 16.
 */

import 'server-only'
import { db } from '@/lib/db'
import { resolveCopilotContext } from '../context'
import { isPromptInjection } from '../intent/guard'
import { routeReadIntent, runReadToolsAndGenerateResponse } from './read-flow'
import {
  classifyActionIntent,
  getActionById,
  getActionsCatalogForModel,
  getAllowedActionIds,
} from '../actions/registry'
import { recordAuditLog } from '@/lib/auth/audit'
import { MAX_TOOL_CALLS_PER_TURN } from '../types'
import type { CopilotAuthContext } from '../types'
import type { ActionExecutionResult, ActionFailure } from '../actions/types'
import { markCancelled } from '../security/confirmations'
import { getAIEngine } from '@/lib/ai/service/ai-engine'
import { z } from 'zod'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface AskCopilotArgs {
  userMessage: string
  history?: Array<{ role: 'USER' | 'ASSISTANT'; content: string }>
}

export type AskCopilotOutcome =
  | {
      kind: 'read_response'
      response: {
        answer: string
        summary?: string
        findings: Array<{ label: string; value: string }>
        records: Array<{ type: string; id: string; label: string; href: string }>
        suggestedQuestions: string[]
        limitations: string[]
      }
    }
  | {
      kind: 'action_preview'
      actionId: string
      confirmationId: string
      preview: unknown
      expiresAt: string
      proposedArguments: Record<string, unknown>
    }
  | {
      kind: 'action_missing_arguments'
      actionId: string
      missingFields: string[]
      question: string
    }
  | {
      kind: 'unsupported_action'
      message: string
    }
  | {
      kind: 'blocked'
      reason: string
    }
  | {
      kind: 'error'
      message: string
    }

export interface AskCopilotResult {
  ok: boolean
  outcome?: AskCopilotOutcome
  blockedReason?: string
  modelUsed?: string
  toolIds?: string[]
  durationMs?: number
}

export interface ExecuteCopilotActionArgs {
  confirmationId: string
}

export type ExecuteCopilotActionResult =
  | {
      ok: true
      confirmationId: string
      result: ActionExecutionResult
    }
  | {
      ok: false
      failure: ActionFailure
    }

export interface CancelCopilotActionArgs {
  confirmationId: string
}

export interface CancelCopilotActionResult {
  ok: boolean
  reason?: string
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function askCopilot(args: AskCopilotArgs): Promise<AskCopilotResult> {
  const ctx = await resolveCopilotContext()
  const start = Date.now()

  // PART 17: prompt-injection defense
  if (isPromptInjection(args.userMessage)) {
    await recordAuditLog({
      organizationId: ctx.organizationId,
      actorId: ctx.userId,
      action: 'COPILOT_PROMPT_INJECTION_BLOCKED',
      targetType: 'copilot',
      targetId: null,
      outcome: 'denied',
      reason: 'blocked_pattern_matched',
      metadata: { messageLength: args.userMessage.length },
    })
    return { ok: false, blockedReason: 'Your question was blocked by a security check. TalentOS AI Copilot does not respond to instructions that attempt to override safety rules, request secrets, or perform mutations.' }
  }

  // PART 16: intent classification
  const intent = classifyActionIntent(args.userMessage)
  if (intent.kind === 'UNSUPPORTED_ACTION') {
    await recordAuditLog({
      organizationId: ctx.organizationId,
      actorId: ctx.userId,
      action: 'COPILOT_UNSUPPORTED_ACTION',
      targetType: 'copilot',
      targetId: null,
      outcome: 'denied',
      reason: 'unsupported_action',
      metadata: { messageLength: args.userMessage.length },
    })
    return {
      ok: true,
      outcome: {
        kind: 'unsupported_action',
        message: "I can help review the relevant information and navigate you to the appropriate TalentOS workflow, but I can't perform that action. The Copilot can only create a Hiring Request draft, schedule an interview, or create an Offer draft. For approvals, decisions, and other actions, please use the relevant TalentOS page.",
      },
    }
  }

  if (intent.kind === 'ACTION_REQUEST' && intent.actionId) {
    return await handleActionRequest(ctx, intent.actionId, args, start)
  }

  // READ_QUERY: existing Sprint 11 flow
  return await handleReadQuery(ctx, args, start)
}

// ---------------------------------------------------------------------------
// Action request flow
// ---------------------------------------------------------------------------

async function handleActionRequest(
  ctx: CopilotAuthContext,
  actionId: string,
  args: AskCopilotArgs,
  start: number,
): Promise<AskCopilotResult> {
  const action = getActionById(actionId)
  if (!action) {
    return { ok: false, outcome: { kind: 'error', message: 'Action not found in the whitelist.' } }
  }

  // Ask the model to extract the action arguments
  const argExtraction = await extractActionArguments(ctx, actionId, args.userMessage, args.history)
  if (!argExtraction.ok) {
    return { ok: false, outcome: { kind: 'error', message: argExtraction.message } }
  }

  // Validate the proposed arguments against the action's input schema
  const inputParse = action.inputSchema.safeParse(argExtraction.arguments)
  if (!inputParse.success) {
    // PART 6: ask the user to clarify missing fields rather than invent
    const missing = extractMissingFields(action.inputSchema, argExtraction.arguments)
    const question = buildClarificationQuestion(actionId, missing, argExtraction.arguments)
    return {
      ok: true,
      outcome: {
        kind: 'action_missing_arguments',
        actionId,
        missingFields: missing,
        question,
      },
    }
  }

  // PHASE 1: prepare the action. NO business mutation.
  const prepareResult = await action.prepare(ctx, inputParse.data)
  if (!prepareResult.ok) {
    return {
      ok: true,
      outcome: {
        kind: 'error',
        message: prepareResult.failure.message,
      },
    }
  }

  return {
    ok: true,
    outcome: {
      kind: 'action_preview',
      actionId,
      confirmationId: prepareResult.confirmationId,
      preview: prepareResult.preview,
      expiresAt: prepareResult.expiresAt.toISOString(),
      proposedArguments: argExtraction.arguments,
    },
    durationMs: Date.now() - start,
  }
}

// ---------------------------------------------------------------------------
// Action execution (Phase 2)
// ---------------------------------------------------------------------------

export async function executeCopilotAction(
  args: ExecuteCopilotActionArgs,
): Promise<ExecuteCopilotActionResult> {
  const ctx = await resolveCopilotContext()

  // Look up the confirmation to determine the actionId (server-controlled)
  const confirmation = await db.copilotActionConfirmation.findUnique({
    where: { id: args.confirmationId },
    select: { actionId: true, organizationId: true, userId: true },
  })
  if (!confirmation) {
    return { ok: false, failure: { code: 'RESOURCE_NOT_FOUND', message: 'Confirmation not found.' } }
  }
  if (confirmation.organizationId !== ctx.organizationId || confirmation.userId !== ctx.userId) {
    return { ok: false, failure: { code: 'RESOURCE_NOT_FOUND', message: 'Confirmation not found.' } }
  }

  const action = getActionById(confirmation.actionId)
  if (!action) {
    return { ok: false, failure: { code: 'RESOURCE_NOT_FOUND', message: 'Action not found in the registry.' } }
  }

  const result = await action.execute(ctx, args.confirmationId)
  return result
}

// ---------------------------------------------------------------------------
// Cancel
// ---------------------------------------------------------------------------

export async function cancelCopilotAction(
  args: CancelCopilotActionArgs,
): Promise<CancelCopilotActionResult> {
  const ctx = await resolveCopilotContext()
  const confirmation = await db.copilotActionConfirmation.findUnique({
    where: { id: args.confirmationId },
    select: { id: true, organizationId: true, userId: true, status: true },
  })
  if (!confirmation) return { ok: false, reason: 'not_found' }
  if (confirmation.organizationId !== ctx.organizationId || confirmation.userId !== ctx.userId) {
    return { ok: false, reason: 'not_found' }
  }
  if (confirmation.status !== 'PENDING') {
    return { ok: true, reason: 'already_terminal' }
  }
  await markCancelled(args.confirmationId)
  await recordAuditLog({
    organizationId: ctx.organizationId,
    actorId: ctx.userId,
    action: 'COPILOT_ACTION_CANCELLED',
    targetType: 'copilot_action',
    targetId: args.confirmationId,
    outcome: 'success',
    metadata: {},
  })
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Read query (Sprint 11 flow, unchanged)
// ---------------------------------------------------------------------------

async function handleReadQuery(
  ctx: CopilotAuthContext,
  args: AskCopilotArgs,
  start: number,
): Promise<AskCopilotResult> {
  const intent = await routeReadIntent(args.userMessage, { preferDeterministic: true })
  if ('injectionDetected' in intent && intent.injectionDetected) {
    await recordAuditLog({
      organizationId: ctx.organizationId,
      actorId: ctx.userId,
      action: 'COPILOT_PROMPT_INJECTION_BLOCKED',
      targetType: 'copilot',
      targetId: null,
      outcome: 'denied',
      reason: 'intent_router_block',
      metadata: {},
    })
    return { ok: false, blockedReason: 'Your question was blocked by a security check.' }
  }
  const toolCalls = (intent as { tools: Array<{ toolId: string; arguments: Record<string, unknown> }> }).tools.slice(0, MAX_TOOL_CALLS_PER_TURN)
  if (toolCalls.length === 0) {
    return {
      ok: true,
      outcome: {
        kind: 'read_response',
        response: {
          answer: 'I could not determine which tool to use to answer your question. Try rephrasing it more specifically.',
          findings: [],
          records: [],
          suggestedQuestions: [
            'Which positions are currently open?',
            'Which candidates are awaiting evaluation?',
            'Which offers are waiting for approval?',
          ],
          limitations: ['No matching tool for the input.'],
        },
      },
    }
  }

  const r = await runReadToolsAndGenerateResponse({
    ctx,
    userMessage: args.userMessage,
    toolCalls,
    history: args.history,
  })

  await recordAuditLog({
    organizationId: ctx.organizationId,
    actorId: ctx.userId,
    action: 'COPILOT_QUERY_EXECUTED',
    targetType: 'copilot',
    targetId: r.taskId,
    outcome: 'success',
    metadata: { toolIds: r.toolIds, modelUsed: r.modelUsed },
  })

  return {
    ok: true,
    outcome: { kind: 'read_response', response: r.response },
    modelUsed: r.modelUsed,
    toolIds: r.toolIds,
    durationMs: Date.now() - start,
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function extractActionArguments(
  ctx: CopilotAuthContext,
  actionId: string,
  userMessage: string,
  history?: Array<{ role: 'USER' | 'ASSISTANT'; content: string }>,
): Promise<{ ok: true; arguments: Record<string, unknown> } | { ok: false; message: string }> {
  const action = getActionById(actionId)
  if (!action) return { ok: false, message: 'Action not found.' }
  const allowed = getAllowedActionIds()
  const catalog = getActionsCatalogForModel()

  const systemPrompt = `You are the TalentOS AI Copilot action argument extractor.

The user wants to perform the action: ${actionId}

The action expects an input object matching this JSON schema (informal):
${describeInputShape(action.inputSchema)}

CRITICAL RULES:
- Extract ONLY values the user explicitly provided.
- If a value is missing or ambiguous, return a partial object with the fields you can extract. The server will ask the user to confirm the rest.
- DO NOT invent salary amounts, currencies, dates, names, or any specific values.
- If the user mentioned a candidate by name, you may include the literal name string in the "candidateReference" field — the server will resolve it to the canonical record.
- For SCHEDULE_INTERVIEW: do not invent a date or interviewer list. The user must supply them.
- For CREATE_OFFER_DRAFT: salary, currency, and title are REQUIRED. Without these the server will refuse.

Return a single JSON object: { "arguments": { ... } }
Do not wrap in markdown. Emit JSON only.`

  const historyBlock = history && history.length > 0
    ? `\n\n# CONVERSATION HISTORY\n` + history.slice(-6).map(m => `${m.role}: ${m.content.slice(0, 400)}`).join('\n')
    : ''

  const userPrompt = `# USER REQUEST\n${userMessage}${historyBlock}\n\n# ALLOWED ACTIONS (whitelist)\n${allowed.join(', ')}\n\n# REMINDER\nReturn JSON only. Do not invent values.`

  try {
    const engine = getAIEngine()
    const result = await engine.callCopilotRouter(systemPrompt, userPrompt)
    const raw = (result.data as string).trim()
    const jsonText = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
    const parsed = JSON.parse(jsonText) as { arguments?: Record<string, unknown> }
    const args = parsed.arguments ?? {}
    // Strip any keys that are not in the action's input schema
    const allowedKeys = getInputKeys(action.inputSchema)
    const filtered: Record<string, unknown> = {}
    for (const k of Object.keys(args)) {
      if (allowedKeys.has(k)) filtered[k] = args[k]
    }
    return { ok: true, arguments: filtered }
  } catch (err) {
    return { ok: false, message: 'Could not extract action arguments from your request.' }
  }
}

function getInputKeys(schema: z.ZodType<any>): Set<string> {
  const shape = (schema as any)._def?.shape?.() ?? (schema as any)._def?.schema?._def?.shape?.()
  if (shape && typeof shape === 'object') {
    return new Set(Object.keys(shape))
  }
  // Fallback: try the zod object signature
  if ((schema as any).shape) {
    return new Set(Object.keys((schema as any).shape))
  }
  return new Set()
}

function extractMissingFields(schema: z.ZodType<any>, args: Record<string, unknown>): string[] {
  const allowedKeys = getInputKeys(schema)
  const present = new Set(Object.keys(args))
  const missing: string[] = []
  for (const k of allowedKeys) {
    if (!present.has(k)) missing.push(k)
  }
  return missing
}

function describeInputShape(schema: z.ZodType<any>): string {
  const keys = getInputKeys(schema)
  return Array.from(keys).map(k => `- ${k}`).join('\n')
}

function buildClarificationQuestion(actionId: string, missingFields: string[], partial: Record<string, unknown>): string {
  const lines: string[] = []
  lines.push(`I can help prepare a ${actionId.replace(/_/g, ' ').toLowerCase()}, but I need a few more details.`)
  if (missingFields.length > 0) {
    lines.push('')
    lines.push('Missing fields:')
    for (const f of missingFields) {
      lines.push(`- ${f}`)
    }
  }
  return lines.join('\n')
}
