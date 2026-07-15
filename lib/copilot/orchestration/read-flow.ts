/**
 * Sprint 11.1 — Read-only flow (extracted from Sprint 11 orchestrator).
 *
 * This is the existing Sprint 11 flow: deterministic intent + Gemini
 * fallback + tool execution + structured response. The ActionRegistry
 * is NOT touched here.
 */

import 'server-only'
import { z } from 'zod'
import { db } from '@/lib/db'
import { executeTool, getRegisteredToolIds } from '../read-tools/registry'
import { generateCopilotResponse, type CopilotResponse } from './response'
import type { CopilotAuthContext } from '../types'
import { getAIEngine } from '@/lib/ai/service/ai-engine'

const ToolSelectionSchema = z.object({
  tools: z.array(z.object({
    toolId: z.string(),
    arguments: z.record(z.string(), z.any()).default({}),
    reason: z.string().optional(),
  })).min(1).max(5),
})

export type IntentResult = {
  tools: Array<{ toolId: string; arguments: Record<string, unknown> }>
  rationale?: string
}

// Deterministic intent routing
const DETERMINISTIC: Array<{ tools: string[]; keywords: string[] }> = [
  { tools: ['get_my_attention_items'], keywords: ['attention', 'need my attention', 'what needs'] },
  { tools: ['get_open_hiring_requests'], keywords: ['open positions', 'open hiring', 'open roles', 'open role'] },
  { tools: ['get_hiring_requests_with_no_candidates'], keywords: ['no candidates', 'empty hiring', 'no applicants'] },
  { tools: ['get_candidates_awaiting_interview'], keywords: ['need an interview', 'awaiting interview', 'no interview', 'need interview'] },
  { tools: ['get_candidates_awaiting_evaluation'], keywords: ['awaiting evaluation', 'pending evaluation', 'need evaluation', 'evaluation pending'] },
  { tools: ['get_upcoming_interviews'], keywords: ['upcoming interview', 'scheduled interview', 'interview this week', 'interviews this week'] },
  { tools: ['get_my_upcoming_interviews'], keywords: ['my upcoming interview', 'my interview', 'my scheduled interview'] },
  { tools: ['get_my_pending_evaluations'], keywords: ['my evaluation', 'evaluations to complete', 'evaluations i need'] },
  { tools: ['get_offers_pending_approval'], keywords: ['pending approval', 'offer approval', 'need approval', 'approve offer'] },
  { tools: ['get_offers_expiring_soon'], keywords: ['expiring', 'expiring soon', 'expire soon', 'offer expire'] },
  { tools: ['get_selected_candidates_without_offer'], keywords: ['selected without offer', 'no offer yet', 'without offer', 'selected candidate'] },
  { tools: ['get_hiring_pipeline_summary'], keywords: ['pipeline', 'pipeline summary', 'hiring summary', 'pipeline health'] },
  { tools: ['get_department_hiring_summary'], keywords: ['department', 'by department', 'departments', 'most open'] },
  { tools: ['get_recent_hiring_activity'], keywords: ['recent activity', 'recent hiring', 'recent event', 'what happened', 'latest activity'] },
  { tools: ['get_candidates_by_stage'], keywords: ['candidates by stage', 'how many candidates', 'candidate count', 'stage distribution'] },
]

export function deterministicIntent(message: string): IntentResult | null {
  const lower = message.toLowerCase()
  if (lower.includes('offer') && (lower.includes('how many') || lower.includes('count'))) {
    return { tools: [{ toolId: 'get_offers_by_status', arguments: {} }] }
  }
  if (lower.includes('accepted') && lower.includes('offer')) {
    return { tools: [{ toolId: 'get_offers_by_status', arguments: { statuses: ['ACCEPTED'] } }] }
  }
  if (lower.includes('declined') && lower.includes('offer')) {
    return { tools: [{ toolId: 'get_offers_by_status', arguments: { statuses: ['DECLINED'] } }] }
  }
  for (const entry of DETERMINISTIC) {
    for (const kw of entry.keywords) {
      if (lower.includes(kw)) {
        return { tools: entry.tools.map(t => ({ toolId: t, arguments: {} })) }
      }
    }
  }
  return null
}

export async function routeReadIntent(
  message: string,
  options: { preferDeterministic?: boolean } = {},
): Promise<IntentResult | { injectionDetected: true }> {
  if (options.preferDeterministic !== false) {
    const det = deterministicIntent(message)
    if (det) return det
  }

  const registered = new Set(getRegisteredToolIds())
  const toolListForPrompt = getRegisteredToolIds().map(id => `- ${id}`).join('\n')

  const systemPrompt = `You are the TalentOS AI Copilot read-only intent router.

Your job: read the user's question and select the SINGLE best tool to answer it (or up to 5 if the question requires multiple).

Available tools (you may ONLY select from this list):
${toolListForPrompt}

Output a single JSON object matching the schema below. No markdown fences. No commentary.

{
  "tools": [
    {
      "toolId": string,        // MUST be one of the listed tool ids
      "arguments": object,       // empty object {} if no arguments needed
      "reason": string
    }
  ]
}

Rules:
- Pick at most 5 tools. Prefer 1 if the question is simple.
- If the question is ambiguous or no tool fits, pick the closest tool.
- Do NOT invent tool ids.`

  const userPrompt = `User question: """${message.replace(/"/g, "'").replace(/\n/g, ' ')}"""`

  try {
    const engine = getAIEngine()
    const result = await engine.callCopilotRouter(systemPrompt, userPrompt)
    const raw = (result.data as string).trim()
    const jsonText = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
    const parsed = ToolSelectionSchema.safeParse(JSON.parse(jsonText))
    if (!parsed.success) return { tools: [] }
    const tools = parsed.data.tools
      .filter(t => registered.has(t.toolId))
      .map(t => ({ toolId: t.toolId, arguments: t.arguments ?? {} }))
    return { tools: tools.slice(0, 5) }
  } catch (err) {
    return { tools: [{ toolId: 'get_hiring_pipeline_summary', arguments: {} }] }
  }
}

export async function runReadToolsAndGenerateResponse(args: {
  ctx: CopilotAuthContext
  userMessage: string
  toolCalls: Array<{ toolId: string; arguments: Record<string, unknown> }>
  history?: Array<{ role: 'USER' | 'ASSISTANT'; content: string }>
}): Promise<{
  taskId: string
  response: CopilotResponse
  toolIds: string[]
  modelUsed?: string
}> {
  const { ctx, userMessage, toolCalls, history } = args
  const toolResults: Array<{ toolId: string; data: unknown; recordHrefs: string[] }> = []
  const executedToolIds: string[] = []

  for (const call of toolCalls) {
    const result = await executeTool(ctx, call.toolId, call.arguments)
    if (result.ok) {
      toolResults.push({ toolId: call.toolId, data: result.data, recordHrefs: result.recordHrefs })
      executedToolIds.push(call.toolId)
    } else if (result.code === 'ACCESS_DENIED') {
      await db.copilotActionConfirmation // no-op
      // Audit
      const { recordAuditLog } = await import('@/lib/auth/audit')
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
        taskId: '',
        toolIds: executedToolIds,
        response: {
          answer: `You do not have permission to use the ${call.toolId} tool.`,
          findings: [],
          records: [],
          suggestedQuestions: [],
          limitations: ['Permission denied.'],
        },
      }
    } else {
      toolResults.push({ toolId: call.toolId, data: { error: result.message, code: result.code }, recordHrefs: [] })
      executedToolIds.push(call.toolId)
    }
  }

  // Persist the conversation
  const start = Date.now()
  const aiTask = await db.aITask.create({
    data: {
      organizationId: ctx.organizationId,
      type: 'COPILOT_QUERY' as never,
      title: 'Copilot query',
      prompt: userMessage.slice(0, 4000),
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
      content: userMessage.slice(0, 8000),
    },
  })

  let response: CopilotResponse
  let modelUsed: string | undefined
  try {
    response = await generateCopilotResponse({
      userMessage,
      toolResults,
      history,
    })
    modelUsed = process.env.GEMINI_MODEL ?? 'gemini-2.0-flash'
  } catch (err) {
    await db.aITask.update({
      where: { id: aiTask.id },
      data: { errorMessage: err instanceof Error ? err.message : 'Generation failed' },
    }).catch(() => null)
    response = {
      answer: 'TalentOS AI is temporarily unavailable. The data was retrieved successfully — please try again or visit the relevant TalentOS page.',
      findings: [],
      records: [],
      suggestedQuestions: [],
      limitations: ['AI response generation failed.'],
    }
  }

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

  return { taskId: aiTask.id, response, toolIds: executedToolIds, modelUsed }
}
