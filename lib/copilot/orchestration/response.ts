/**
 * Sprint 11 — Copilot response generator.
 *
 * PART 6 + PART 7: builds a sanitized context from tool results and
 * asks Gemini to produce a structured response. All
 * href values are generated server-side; Gemini cannot create
 * arbitrary external URLs.
 */

import 'server-only'
import { z } from 'zod'
import { getAIEngine } from '@/lib/ai/service/ai-engine'
import { enforceAiQuota, recordAiUsage } from '@/lib/ai/quota'

const ResponseSchema = z.object({
  answer: z.string().min(1),
  summary: z.string().optional(),
  findings: z.array(z.object({
    label: z.string(),
    value: z.string(),
  })).default([]),
  records: z.array(z.object({
    type: z.string(),
    id: z.string(),
    label: z.string(),
    href: z.string(),
  })).default([]),
  suggestedQuestions: z.array(z.string()).default([]),
  limitations: z.array(z.string()).default([]),
})

export type CopilotResponse = z.infer<typeof ResponseSchema>

export interface GenerateArgs {
  userMessage: string
  toolResults: Array<{ toolId: string; data: unknown; recordHrefs: string[] }>
  /** Optional recent conversation for context (PART 11). */
  history?: Array<{ role: 'USER' | 'ASSISTANT'; content: string }>
  /** Sprint 16 — org context for AI quota. */
  organizationId: string
}

const SYSTEM_PROMPT = `You are TalentOS AI Copilot, a read-only intelligence layer.

Your job: answer the user's question using ONLY the supplied tool results. Do not invent.

HARD RULES:
- If the tool results do not contain the answer, say so explicitly.
- Do not make up candidate names, scores, dates, salary values, or counts.
- Do not provide compensation unless the tool result included it.
- Keep the answer concise and grounded in the data.
- The "records" array must reference records that appear in the tool results.
- The "href" values must be one of the recordHrefs provided; do not invent new ones.
- If the user asks for an action (create, update, delete, approve, issue, accept, decline), explain that you cannot perform actions in this version and that they should use the relevant TalentOS page.

Return a single JSON object with this exact shape:
{
  "answer": string,                 // 1-3 sentence answer grounded in the data
  "summary"?: string,               // optional 1-sentence top-line
  "findings": [{ "label": string, "value": string }],   // up to 8 key-value highlights
  "records": [{ "type": string, "id": string, "label": string, "href": string }],   // up to 8 referenced records
  "suggestedQuestions": [string],   // 1-3 follow-up questions
  "limitations": [string]           // any caveats the user should know
}

Do not wrap in markdown. Emit JSON only.`

export async function generateCopilotResponse(args: GenerateArgs): Promise<CopilotResponse> {
  // Sanitize the user message: just pass it as-is. The model must not
  // execute instructions that override the system prompt.
  const context = JSON.stringify(
    {
      toolResults: args.toolResults.map(t => ({ toolId: t.toolId, data: t.data, recordHrefs: t.recordHrefs })),
    },
    null,
    2,
  )

  const historyBlock = args.history && args.history.length > 0
    ? `\n\n# CONVERSATION HISTORY (most recent ${args.history.length} messages)\n` + args.history.map(m => `${m.role}: ${m.content.slice(0, 400)}`).join('\n')
    : ''

  const userPrompt = `# USER QUESTION\n${args.userMessage}${historyBlock}\n\n# TOOL RESULTS (grounded facts)\n${context}\n\n# REMINDER\nReturn JSON only. Do not invent data. Do not create external URLs. Do not perform actions.`

  // Sprint 16 — per-org AI quota. Refuse if over limit.
  const quotaCheck = await enforceAiQuota(args.organizationId, 'copilot')
  if (!quotaCheck.allowed) {
    return {
      answer: quotaCheck.message ?? 'AI limit reached for this month.',
      findings: [],
      records: [],
      suggestedQuestions: [],
      limitations: ['AI monthly limit reached. The limit resets on ' + quotaCheck.resetAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + '.'],
    }
  }

  const engine = getAIEngine()
  const result = await engine.callCopilotRouter(SYSTEM_PROMPT, userPrompt)
  await recordAiUsage({
    organizationId: args.organizationId,
    feature: 'copilot',
    tokensIn: result.usage?.inputTokens,
    tokensOut: result.usage?.outputTokens,
  })
  const raw = (result.data as string).trim()
  const jsonText = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
  let parsed: CopilotResponse
  try {
    parsed = ResponseSchema.parse(JSON.parse(jsonText))
  } catch (err) {
    // PART 22: graceful failure
    return {
      answer: 'I gathered the data but could not produce a structured answer. Please try a more specific question.',
      findings: [],
      records: [],
      suggestedQuestions: [],
      limitations: ['TalentOS AI Copilot could not format the response. The underlying data was retrieved successfully.'],
    }
  }
  // PART 6: only allow href values from recordHrefs
  const allowedHrefs = new Set(args.toolResults.flatMap(t => t.recordHrefs))
  parsed.records = parsed.records.filter(r => allowedHrefs.has(r.href))
  return parsed
}
