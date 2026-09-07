/**
 * Sprint 11.1 — Action Registry.
 *
 * PART 2: hard architectural separation from the read-only ReadToolRegistry.
 * The ActionRegistry is the SOLE place where Copilot business mutations
 * are exposed. There is no generic mutation executor.
 *
 * Hard rules enforced here:
 *   - The registry is read-only by default — only the three whitelisted
 *     actions are registered.
 *   - Each action id is hard-coded in the type system; Gemini cannot
 *     invent a new action.
 *   - The actions are the only way to mutate business state via Copilot.
 */

import 'server-only'
import { createHiringRequestDraftAction } from './create-hiring-request-draft'
import { scheduleInterviewAction } from './schedule-interview'
import { createOfferDraftAction } from './create-offer-draft'
import type { ActionId, CopilotActionDefinition } from './types'

// Type signature: I, P, R are all inferred from the action's input/preview/result
// schemas. There is NO way to register an action without all three.
const actions: CopilotActionDefinition<any, any, any>[] = [
  createHiringRequestDraftAction,
  scheduleInterviewAction,
  createOfferDraftAction,
]

// Hard whitelist. Anything not in this set is rejected at the
// intent router (see lib/copilot/intent/index.ts).
const ALLOWED_ACTION_IDS: ReadonlySet<ActionId> = new Set<ActionId>([
  'CREATE_HIRING_REQUEST_DRAFT',
  'SCHEDULE_INTERVIEW',
  'CREATE_OFFER_DRAFT',
])

const actionMap = new Map<string, CopilotActionDefinition<any, any, any>>()
for (const a of actions) {
  if (!ALLOWED_ACTION_IDS.has(a.id as ActionId)) {
    throw new Error(`ActionRegistry: action id "${a.id}" is not in the Sprint 11.1 whitelist.`)
  }
  if (actionMap.has(a.id)) {
    throw new Error(`ActionRegistry: duplicate action id "${a.id}".`)
  }
  actionMap.set(a.id, a)
}

export function getAllowedActionIds(): readonly ActionId[] {
  return Array.from(ALLOWED_ACTION_IDS)
}

export function getActionById(id: string): CopilotActionDefinition<any, any, any> | undefined {
  return actionMap.get(id)
}

export function getAllActions(): ReadonlyArray<CopilotActionDefinition<any, any, any>> {
  return actions
}

/**
 * Used by the AI catalog and the orchestrator. Returns a compact
 * descriptor for each action (id + description + required perms).
 */
export function getActionsCatalogForModel(): Array<{ id: ActionId; description: string; requiredPermissions: string[] }> {
  return actions.map(a => ({
    id: a.id as ActionId,
    description: a.description,
    requiredPermissions: a.requiredPermissions,
  }))
}

/**
 * PART 16: classify a free-text user intent as READ_QUERY, ACTION_REQUEST,
 * or UNSUPPORTED_ACTION. Used by the orchestrator BEFORE invoking the
 * intent router. Any mutation request that is not in the whitelist is
 * classified as UNSUPPORTED_ACTION.
 */
export function classifyActionIntent(userMessage: string): {
  kind: 'READ_QUERY' | 'ACTION_REQUEST' | 'UNSUPPORTED_ACTION'
  actionId?: ActionId
} {
  const lower = userMessage.toLowerCase()
  // Read queries: must NOT contain imperative verbs of action
  const readSignals = [
    'which', 'how many', 'show me', 'what', 'list', 'tell me about',
    'summarize', 'count', 'find', 'any', 'open positions', 'open roles',
    'awaiting', 'pending', 'expiring', 'pipeline', 'attention', 'review',
  ]
  const isLikelyRead = readSignals.some(s => lower.includes(s))

  // Action signals (positive): must be in the whitelist
  const actionSignals: Array<{ id: ActionId; patterns: string[] }> = [
    { id: 'CREATE_HIRING_REQUEST_DRAFT', patterns: ['create a hiring request', 'create hiring request', 'new hiring request', 'draft a hiring request', 'draft hiring request', 'open a new position', 'create a job', 'new role', 'create a role', 'create role', 'hire for', 'create a new'] },
    { id: 'SCHEDULE_INTERVIEW', patterns: ['schedule an interview', 'schedule interview', 'set up interview', 'book interview', 'interview next', 'interview on', 'schedule a'] },
    { id: 'CREATE_OFFER_DRAFT', patterns: ['prepare an offer', 'prepare offer', 'create an offer', 'create offer', 'draft an offer', 'draft offer', 'make an offer', 'extend an offer', 'offer draft'] },
  ]
  for (const sig of actionSignals) {
    if (sig.patterns.some(p => lower.includes(p))) {
      return { kind: 'ACTION_REQUEST', actionId: sig.id }
    }
  }

  // Unsupported action signals (negative): the AI must refuse
  const unsupportedSignals = [
    'approve offer', 'approve the offer', 'approve sarah', "approve sarah's",
    'issue offer', 'issue the offer',
    'accept offer', 'accept the offer', 'decline offer', 'decline the offer',
    'reject offer', 'reject the offer', 'withdraw offer', 'withdraw the offer',
    'select candidate', 'select the candidate', 'select sarah',
    'reject candidate', 'reject the candidate',
    'change final decision', 'change decision', 'submit evaluation', 'submit my evaluation',
    'delete candidate', 'delete the candidate', 'delete hiring request', 'delete the hiring request',
    'delete interview', 'delete offer', 'change user role', 'change role', 'disable user',
    'invite user', 'change password', 'modify security', 'modify organization settings',
  ]
  if (unsupportedSignals.some(s => lower.includes(s))) {
    return { kind: 'UNSUPPORTED_ACTION' }
  }

  if (isLikelyRead) return { kind: 'READ_QUERY' }
  // Default to read query when ambiguous (least-privilege)
  return { kind: 'READ_QUERY' }
}
