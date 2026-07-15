/**
 * Sprint 11 — Copilot orchestrator.
 *
 * The end-to-end pipeline:
 *   1. resolveCopilotContext
 *   2. routeIntent (deterministic first, Gemini fallback)
 *   3. executeTool for each (max 5)
 *   4. generateCopilotResponse from sanitized tool results
 *   5. persist as AITask + AIConversation
 *   6. return CopilotResponse
 */

import 'server-only'
import { db } from '@/lib/db'
import { resolveCopilotContext } from './context'
import { routeIntent, isPromptInjection } from './intent'
import { executeTool } from './registry'
import { generateCopilotResponse } from './response'
import { recordAuditLog } from '@/lib/auth/audit'
import { MAX_TOOL_CALLS_PER_TURN } from './types'
import type { CopilotResponse } from './response'
import type { IntentResult } from './intent'

export interface AskCopilotArgs {
  userMessage: string
  /** Optional recent conversation (most recent first). */
  history?: Array<{ role: 'USER' | 'ASSISTANT'; content: string }>
}

export interface AskCopilotResult {
  ok: boolean
  response?: CopilotResponse
  blockedReason?: string
  modelUsed?: string
  toolIds?: string[]
  durationMs?: number
}

export async function askCopilot(args: AskCopilotArgs): Promise<AskCopilotResult> {
  const ctx = await resolveCopilotContext()
  const start = Date.now()

  // PART 19: prompt injection defense
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
    return {
      ok: false,
      blockedReason: 'Your question was blocked by a security check. TalentOS AI Copilot does not respond to instructions that attempt to override safety rules, request secrets, or perform mutations.',
    }
  }

  // 1. Intent routing
  const intent = await routeIntent(args.userMessage, { preferDeterministic: true })
  if ('injectionDetected' in intent && (intent as { injectionDetected: true }).injectionDetected) {
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
    return {
      ok: false,
      blockedReason: 'Your question was blocked by a security check.',
    }
  }
  const toolCalls = (intent as IntentResult).tools.slice(0, MAX_TOOL_CALLS_PER_TURN)
  if (toolCalls.length === 0) {
    return {
      ok: true,
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
    }
  }

  // 2. Execute tools
  const toolResults: Array<{ toolId: string; data: unknown; recordHrefs: string[] }> = []
  const executedToolIds: string[] = []
  for (const call of toolCalls) {
    const result = await executeTool(ctx, call.toolId, call.arguments)
    if (result.ok) {
      toolResults.push({ toolId: call.toolId, data: result.data, recordHrefs: result.recordHrefs })
      executedToolIds.push(call.toolId)
    } else if (result.code === 'ACCESS_DENIED') {
      // PART 23: blocked tool, audit
      await recordAuditLog({
        organizationId: ctx.organizationId,
        actorId: ctx.userId,
        action: 'COPILOT_TOOL_BLOCKED',
        targetType: 'copilot',
        targetId: null,
        outcome: 'denied',
        reason: 'missing_permission',
        metadata: { toolId: call.toolId },
      })
      return {
        ok: false,
        blockedReason: `You do not have permission to use the ${call.toolId} tool.`,
      }
    } else {
      // Tool failed: surface a soft error
      toolResults.push({ toolId: call.toolId, data: { error: result.message, code: result.code }, recordHrefs: [] })
      executedToolIds.push(call.toolId)
    }
  }

  // 3. Persist AITask + AIConversation
  const aiTask = await db.aITask.create({
    data: {
      organizationId: ctx.organizationId,
      type: 'COPILOT_QUERY' as never,
      title: 'Copilot query',
      prompt: args.userMessage.slice(0, 4000),
      status: 'COMPLETED' as never,
      createdById: ctx.userId,
      startedAt: new Date(start),
      completedAt: new Date(),
      durationMs: Date.now() - start,
      metadata: { toolIds: executedToolIds } as any,
    },
  })
  await db.aIConversation.create({
    data: {
      taskId: aiTask.id,
      role: 'USER' as never,
      content: args.userMessage.slice(0, 8000),
    },
  })

  // 4. Generate response
  let response: CopilotResponse
  let modelUsed: string | undefined
  try {
    response = await generateCopilotResponse({
      userMessage: args.userMessage,
      toolResults,
      history: args.history,
    })
    modelUsed = process.env.GEMINI_MODEL ?? 'gemini-2.0-flash'
  } catch (err) {
    await db.aITask.update({
      where: { id: aiTask.id },
      data: { errorMessage: err instanceof Error ? err.message : 'Generation failed' },
    }).catch(() => null)
    return {
      ok: false,
      response: {
        answer: 'TalentOS AI is temporarily unavailable. The data was retrieved successfully — please try again or visit the relevant TalentOS page.',
        findings: [],
        records: [],
        suggestedQuestions: [],
        limitations: ['AI response generation failed.'],
      },
    }
  }

  // 5. Persist the assistant response
  await db.aIConversation.create({
    data: {
      taskId: aiTask.id,
      role: 'ASSISTANT' as never,
      content: JSON.stringify(response).slice(0, 16000),
    },
  })
  await db.aITask.update({
    where: { id: aiTask.id },
    data: {
      result: response as any,
      modelUsed,
    },
  })

  // 6. Audit
  await recordAuditLog({
    organizationId: ctx.organizationId,
    actorId: ctx.userId,
    action: 'COPILOT_QUERY_EXECUTED',
    targetType: 'copilot',
    targetId: aiTask.id,
    outcome: 'success',
    metadata: { toolIds: executedToolIds, modelUsed },
  })

  return {
    ok: true,
    response,
    modelUsed,
    toolIds: executedToolIds,
    durationMs: Date.now() - start,
  }
}
