'use server'

/**
 * Sprint 11.1 — Copilot server actions.
 *
 * Thin wrappers over the orchestrator. Adds RBAC and audit logging.
 * Never returns raw tool data; only the response generator's
 * structured output.
 *
 * Two new actions are added to the existing askCopilotAction:
 *   - executeCopilotActionAction: confirm a prepared action
 *   - cancelCopilotActionAction: cancel a PENDING confirmation
 */

import 'server-only'
import {
  askCopilot as orchestratorAsk,
  executeCopilotAction as orchestratorExecute,
  cancelCopilotAction as orchestratorCancel,
  type AskCopilotResult,
  type ExecuteCopilotActionResult,
} from '@/lib/copilot/orchestration/orchestrator'
import { db } from '@/lib/db'
import type { ActionResult } from '@/lib/auth/action-helpers'

export interface CopilotActionInput {
  message: string
  history?: Array<{ role: 'USER' | 'ASSISTANT'; content: string }>
}

export interface CopilotActionData extends AskCopilotResult {}

export async function askCopilotAction(input: CopilotActionInput): Promise<ActionResult<CopilotActionData>> {
  if (typeof input?.message !== 'string' || input.message.trim().length === 0) {
    return { ok: false, error: { code: 'MISSING_MESSAGE', message: 'Message is required.' } }
  }
  if (input.message.length > 4000) {
    return { ok: false, error: { code: 'MESSAGE_TOO_LONG', message: 'Message is too long (max 4000 chars).' } }
  }
  const history = (input.history ?? []).slice(-10)

  try {
    const result = await orchestratorAsk({ userMessage: input.message.trim(), history })
    return { ok: true, data: result }
  } catch (err) {
    return { ok: false, error: { code: 'INTERNAL', message: 'TalentOS AI is temporarily unavailable.' } }
  }
}

export interface ExecuteCopilotActionInput {
  confirmationId: string
}

export async function executeCopilotActionAction(
  input: ExecuteCopilotActionInput,
): Promise<ActionResult<ExecuteCopilotActionResult>> {
  if (typeof input?.confirmationId !== 'string' || input.confirmationId.length === 0) {
    return { ok: false, error: { code: 'MISSING_CONFIRMATION', message: 'confirmationId is required.' } }
  }
  try {
    const result = await orchestratorExecute({ confirmationId: input.confirmationId })
    return { ok: true, data: result }
  } catch (err) {
    return { ok: false, error: { code: 'INTERNAL', message: 'Action execution failed.' } }
  }
}

export interface CancelCopilotActionInput {
  confirmationId: string
}

export async function cancelCopilotActionAction(
  input: CancelCopilotActionInput,
): Promise<ActionResult<{ ok: boolean; reason?: string }>> {
  if (typeof input?.confirmationId !== 'string' || input.confirmationId.length === 0) {
    return { ok: false, error: { code: 'MISSING_CONFIRMATION', message: 'confirmationId is required.' } }
  }
  try {
    const result = await orchestratorCancel({ confirmationId: input.confirmationId })
    return { ok: true, data: result }
  } catch (err) {
    return { ok: false, error: { code: 'INTERNAL', message: 'Action cancellation failed.' } }
  }
}

/**
 * Recent conversation history for the current user. Used to repopulate
 * the UI on reload.
 */
export async function getRecentCopilotHistoryAction(limit: number = 20): Promise<ActionResult<Array<{
  id: string
  role: 'USER' | 'ASSISTANT'
  content: string
  createdAt: string
}>>> {
  const { requireAuth } = await import('@/lib/auth/authorize')
  const auth = await requireAuth()
  if (!auth.ok) return { ok: false, error: { code: auth.code, message: auth.message } }
  const tasks = await db.aITask.findMany({
    where: { organizationId: auth.data.organizationId, type: 'COPILOT_QUERY' as never, createdById: auth.data.userId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  })
  const taskIds = tasks.map(t => t.id)
  const conversations = await db.aIConversation.findMany({
    where: { taskId: { in: taskIds } },
    orderBy: { createdAt: 'asc' },
  })
  const out = conversations.map(c => {
    let content = c.content
    if (c.role === 'ASSISTANT') {
      try {
        const parsed = JSON.parse(content)
        if (parsed.answer) content = parsed.answer
        else if (parsed.summary) content = parsed.summary
      } catch { /* keep raw */ }
    }
    return {
      id: c.id,
      role: c.role as 'USER' | 'ASSISTANT',
      content,
      createdAt: c.createdAt.toISOString(),
    }
  })
  return { ok: true, data: out }
}
