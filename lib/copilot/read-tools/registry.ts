/**
 * Sprint 11 — Copilot Tool Registry.
 *
 * PART 2: the single source of truth for every tool the Copilot can
 * call. Tools are added here, validated at registration time, and
 * looked up by id at runtime.
 *
 * PART 23: a hard read-only check runs at registration time. A tool
 * whose `execute` function contains a forbidden mutation token
 * (create, update, delete, upsert, raw SQL) is REJECTED. This is a
 * belt-and-suspenders check on top of the discipline of writing
 * read-only tool executors.
 */

import { getOpenHiringRequestsTool, getHiringRequestSummaryTool, getDepartmentHiringSummaryTool } from './hiring-request-tools'
import {
  getCandidatesByStageTool,
  getCandidatesAwaitingInterviewTool,
  getCandidatesAwaitingEvaluationTool,
  getCandidateSummaryTool,
  getDecisionReadinessTool,
  getSelectedCandidatesWithoutOfferTool,
} from './candidate-tools'
import { getUpcomingInterviewsTool, getMyUpcomingInterviewsTool, getMyPendingEvaluationsTool } from './interview-tools'
import { getOffersByStatusTool, getOffersPendingApprovalTool, getOffersExpiringSoonTool } from './offer-tools'
import { getMyAttentionItemsTool } from './attention-tools'
import {
  getHiringPipelineSummaryTool,
  getRecentHiringActivityTool,
  getHiringRequestsWithNoCandidatesTool,
} from './summary-tools'
import type { CopilotAuthContext, CopilotTool } from '../types'

// ---------------------------------------------------------------------------
// Forbidden-token scan: reject any tool whose executor references
// known mutation APIs. This is a hard technical guardrail (PART 23).
// ---------------------------------------------------------------------------

const FORBIDDEN_TOKENS = [
  'prisma.user.create', 'prisma.user.update', 'prisma.user.delete', 'prisma.user.upsert',
  'prisma.candidate.create', 'prisma.candidate.update', 'prisma.candidate.delete', 'prisma.candidate.upsert',
  'prisma.hiringRequest.create', 'prisma.hiringRequest.update', 'prisma.hiringRequest.delete',
  'prisma.interview.create', 'prisma.interview.update', 'prisma.interview.delete',
  'prisma.offer.create', 'prisma.offer.update', 'prisma.offer.delete',
  'prisma.candidateDecision.create', 'prisma.candidateDecision.update', 'prisma.candidateDecision.delete',
  'prisma.interviewEvaluation.create', 'prisma.interviewEvaluation.update', 'prisma.interviewEvaluation.delete',
  'prisma.$executeRaw', 'prisma.$queryRaw',
  'createMany', 'updateMany', 'deleteMany',
  'createHiringRequest', 'createCandidate', 'submitEvaluation', 'createOffer',
  'approveOffer', 'issueOffer', 'recordOfferResponse',
]

function assertReadOnly(tool: CopilotTool<any, any>) {
  const src = tool.execute.toString()
  for (const tok of FORBIDDEN_TOKENS) {
    if (src.includes(tok)) {
      throw new Error(`Copilot tool "${tool.id}" contains forbidden token "${tok}". Tools must be read-only.`)
    }
  }
}

// ---------------------------------------------------------------------------
// Tool map. Adding a new tool: implement it in a sibling file under
// lib/copilot/tools/, import it here, and add to the map.
// ---------------------------------------------------------------------------

const tools: CopilotTool<any, any>[] = [
  // Hiring requests
  getOpenHiringRequestsTool,
  getHiringRequestSummaryTool,
  getDepartmentHiringSummaryTool,
  getHiringRequestsWithNoCandidatesTool,
  // Candidates
  getCandidatesByStageTool,
  getCandidatesAwaitingInterviewTool,
  getCandidatesAwaitingEvaluationTool,
  getCandidateSummaryTool,
  getDecisionReadinessTool,
  getSelectedCandidatesWithoutOfferTool,
  // Interviews
  getUpcomingInterviewsTool,
  getMyUpcomingInterviewsTool,
  getMyPendingEvaluationsTool,
  // Offers
  getOffersByStatusTool,
  getOffersPendingApprovalTool,
  getOffersExpiringSoonTool,
  // Attention
  getMyAttentionItemsTool,
  // Summary
  getHiringPipelineSummaryTool,
  getRecentHiringActivityTool,
]

// Run the read-only check on registration
for (const t of tools) assertReadOnly(t)

const toolMap = new Map<string, CopilotTool<any, any>>()
for (const t of tools) {
  if (toolMap.has(t.id)) {
    throw new Error(`Duplicate Copilot tool id: ${t.id}`)
  }
  toolMap.set(t.id, t)
}

export function getRegisteredTools(): ReadonlyArray<CopilotTool<any, any>> {
  return tools
}

export function getToolById(id: string): CopilotTool<any, any> | undefined {
  return toolMap.get(id)
}

export function getRegisteredToolIds(): string[] {
  return Array.from(toolMap.keys())
}

/**
 * Executes a tool by id, validating permissions, tenant scope, and
 * input/output Zod schemas. Returns a typed result.
 */
export async function executeTool(
  ctx: CopilotAuthContext,
  toolId: string,
  rawInput: unknown,
): Promise<{ ok: true; data: unknown; recordHrefs: string[] } | { ok: false; code: 'UNKNOWN_TOOL' | 'ACCESS_DENIED' | 'INVALID_INPUT' | 'INTERNAL'; message: string }> {
  const tool = toolMap.get(toolId)
  if (!tool) {
    return { ok: false, code: 'UNKNOWN_TOOL', message: `Unknown tool: ${toolId}` }
  }
  if (!ctx.hasPermission(tool.requiredPermission)) {
    return { ok: false, code: 'ACCESS_DENIED', message: `Missing permission: ${tool.requiredPermission}` }
  }
  const parsed = tool.inputSchema.safeParse(rawInput)
  if (!parsed.success) {
    return { ok: false, code: 'INVALID_INPUT', message: parsed.error.message }
  }
  try {
    const data = await tool.execute(ctx, parsed.data)
    const validated = tool.outputSchema.safeParse(data)
    if (!validated.success) {
      return { ok: false, code: 'INTERNAL', message: 'Tool output failed schema validation' }
    }
    // Extract record hrefs from the data for the UI to surface
    const recordHrefs = extractRecordHrefs(validated.data, toolId)
    return { ok: true, data: validated.data, recordHrefs }
  } catch (err) {
    return { ok: false, code: 'INTERNAL', message: err instanceof Error ? err.message : 'Tool execution failed' }
  }
}

function extractRecordHrefs(data: any, toolId: string): string[] {
  const hrefs: string[] = []
  const pushIf = (url: string) => { if (url) hrefs.push(url) }
  function walk(v: any) {
    if (!v || typeof v !== 'object') return
    if (Array.isArray(v)) { v.forEach(walk); return }
    for (const [k, val] of Object.entries(v)) {
      if (k === 'id' && typeof val === 'string') {
        const url = hrefForField(toolId, val, v)
        pushIf(url)
      }
    }
  }
  walk(data)
  return hrefs.slice(0, 30)
}

function hrefForField(toolId: string, id: string, ctx: any): string {
  // Most tools return { records: [{ id, ... }] } or { id, ... }
  if (toolId.endsWith('summary') || toolId.includes('candidate_summary') || toolId.includes('selected_candidates_without_offer') || toolId.includes('awaiting') || toolId.includes('decision_readiness')) {
    if (ctx.candidateId) return `/candidates/${ctx.candidateId}`
    if (ctx.candidate?.id) return `/candidates/${ctx.candidate.id}`
    if (ctx.hiringRequestId) return `/hiring-requests/${ctx.hiringRequestId}/candidates`
    if (ctx.id && (toolId.includes('hiring_request') || toolId.includes('open_hiring'))) return `/hiring-requests/${id}/candidates`
  }
  if (toolId.startsWith('get_offers')) return `/offers/${id}`
  if (toolId.startsWith('get_open_hiring') || toolId === 'get_hiring_requests_with_no_candidates') return `/hiring-requests/${id}/candidates`
  if (toolId === 'get_hiring_request_summary' || toolId === 'get_department_hiring_summary') return `/hiring-requests/${id}/candidates`
  if (toolId.startsWith('get_upcoming') || toolId.startsWith('get_my_upcoming') || toolId.startsWith('get_my_pending')) {
    if (ctx.candidateId) return `/candidates/${ctx.candidateId}`
    if (ctx.candidate?.id) return `/candidates/${ctx.candidate.id}`
  }
  return ''
}
