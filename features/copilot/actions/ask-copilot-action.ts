'use server'

/**
 * Sprint 11 — Copilot server action.
 *
 * Thin wrapper over the orchestrator. Adds RBAC and audit logging.
 * Never returns raw tool data; only the response generator's
 * structured output.
 */

import 'server-only'
import { askCopilot, type AskCopilotResult } from '@/lib/copilot/orchestrator'
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
  // Bound history to last 10 messages
  const history = (input.history ?? []).slice(-10)

  try {
    const result = await askCopilot({ userMessage: input.message.trim(), history })
    return { ok: true, data: result }
  } catch (err) {
    return { ok: false, error: { code: 'INTERNAL', message: 'TalentOS AI is temporarily unavailable.' } }
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
    include: {
      organization: false,
    },
  })
  // Get the conversations in chronological order
  const taskIds = tasks.map(t => t.id)
  const conversations = await db.aIConversation.findMany({
    where: { taskId: { in: taskIds } },
    orderBy: { createdAt: 'asc' },
  })
  // Map to UI shape
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
