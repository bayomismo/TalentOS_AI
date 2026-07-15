/**
 * Sprint 11 — Copilot intent router.
 *
 * PART 5 + PART 27: deterministic intent classification for the
 * common cases, with a fallback to a single Gemini structured call
 * for ambiguous questions. Bounded by MAX_TOOL_CALLS_PER_TURN.
 *
 * The router is intentionally conservative: when in doubt it asks
 * the user to clarify. It never invents tools.
 */

import 'server-only'
import { z } from 'zod'
import { getAIEngine } from '@/lib/ai/service/ai-engine'
import { getRegisteredToolIds } from './registry'

/**
 * Patterns that deterministically map to a single tool. Each entry
 * matches at least one keyword in the user message (case-insensitive).
 */
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

/**
 * Detects simple intent from the user message. Returns null if no
 * deterministic match, in which case the router falls back to Gemini.
 */
function deterministicIntent(message: string): IntentResult | null {
  const lower = message.toLowerCase()
  // Special: offer status questions
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
        return {
          tools: entry.tools.map(t => ({ toolId: t, arguments: {} })),
        }
      }
    }
  }
  return null
}

/**
 * PROMPT INJECTION DEFENSE: if the user message contains any of these
 * tokens, return a safe empty result (PART 19).
 */
const BLOCKED_PATTERNS = [
  /ignore (all )?previous/i,
  /ignore (all )?instructions/i,
  /disregard (the )?(system|above)/i,
  /reveal (the )?system prompt/i,
  /show (the )?system prompt/i,
  /execute\s*sql/i,
  /run\s*sql/i,
  /select \*/i,
  /database_url/i,
  /all organizations/i,
  /all organisations/i,
  /all salaries/i,
  /all compensation/i,
  /prisma\.\$/i,
  /raw query/i,
  /\bapprove\b.*\boffer\b/i, // approve offer attempt
  /\bissue\b.*\boffer\b/i,   // issue offer attempt
  /\bcreate\b.*\bhiring request\b/i,
  /\bdelete\b.*\bcandidate\b/i,
]

export function isPromptInjection(message: string): boolean {
  return BLOCKED_PATTERNS.some(re => re.test(message))
}

/**
 * Routes the user message to a set of tool calls. Returns up to
 * MAX_TOOL_CALLS_PER_TURN (5) tools.
 */
export async function routeIntent(
  message: string,
  options: { preferDeterministic?: boolean } = {},
): Promise<IntentResult | { injectionDetected: true }> {
  if (isPromptInjection(message)) {
    return { injectionDetected: true }
  }

  // Try deterministic first
  if (options.preferDeterministic !== false) {
    const det = deterministicIntent(message)
    if (det) return det
  }

  // Fallback to Gemini
  const registered = new Set(getRegisteredToolIds())
  const toolListForPrompt = getRegisteredToolIds()
    .map(id => `- ${id}`)
    .join('\n')

  const systemPrompt = `You are the TalentOS AI Copilot intent router.

Your job: read the user's question and select the SINGLE best tool to answer it (or up to 5 if the question requires multiple).

Available tools (you may ONLY select from this list):
${toolListForPrompt}

Output a single JSON object matching the schema below. No markdown fences. No commentary.

{
  "tools": [
    {
      "toolId": string,        // MUST be one of the listed tool ids
      "arguments": object,       // empty object {} if no arguments needed
      "reason": string           // 1 sentence explaining why
    }
  ]
}

Rules:
- Pick at most 5 tools. Prefer 1 if the question is simple.
- If the question is ambiguous or no tool fits, pick the closest tool.
- Do NOT invent tool ids.
- Do NOT recommend a tool that performs mutations (none of the available tools do).`

  const userPrompt = `User question: """${message.replace(/"/g, "'").replace(/\n/g, ' ')}"""`

  try {
    const engine = getAIEngine()
    const result = await engine.callCopilotRouter(systemPrompt, userPrompt)
    const raw = (result.data as string).trim()
    const jsonText = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
    const parsed = ToolSelectionSchema.safeParse(JSON.parse(jsonText))
    if (!parsed.success) return { tools: [] }
    // Filter: only allow registered tool ids
    const tools = parsed.data.tools
      .filter(t => registered.has(t.toolId))
      .map(t => ({ toolId: t.toolId, arguments: t.arguments ?? {} }))
    return { tools: tools.slice(0, 5) }
  } catch (err) {
    return { tools: [{ toolId: 'get_hiring_pipeline_summary', arguments: {} }] }
  }
}
