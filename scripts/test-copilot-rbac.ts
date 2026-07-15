/**
 * Sprint 11 — Copilot RBAC test.
 *
 * Verifies that the Copilot permission gating matches the RBAC matrix.
 * We do this statically by reading the registry file (which doesn't
 * depend on `server-only`) and checking the role/permission matrix
 * in lib/auth/permissions.ts.
 */

import 'dotenv/config'
import { readFileSync } from 'fs'
import { join } from 'path'
import { hasPermission } from '../lib/auth/permissions'

let pass = 0, fail = 0
function check(name: string, cond: boolean, detail?: string) {
  if (cond) { console.log('  ok', name); pass++ }
  else { console.log('  FAIL', name, detail ?? ''); fail++ }
}

async function main() {
  console.log('=== Sprint 11 -- Copilot RBAC ===\n')

  // Parse tool ids + required permissions from the registry source
  const registrySrc = readFileSync(join(__dirname, '..', 'lib', 'copilot', 'registry.ts'), 'utf8')
  const toolNames = Array.from(registrySrc.matchAll(/^  (\w+),?\s*\/\/ (hiring|candidate|interview|offer|attention|summary)/gm)).map(m => m[1])
  // Also catch the ones in the category headers — actually just match all "Tool," and "Tool }" lines
  const toolNamesFromRegistry = Array.from(registrySrc.matchAll(/^  (\w+),?$/gm)).map(m => m[1]).filter(n => n && /Tool$/.test(n))

  // Get the per-tool required permissions by reading each tool file
  const toolsDir = join(__dirname, '..', 'lib', 'copilot', 'tools')
  const toolFiles = ['hiring-request-tools.ts', 'candidate-tools.ts', 'interview-tools.ts', 'offer-tools.ts', 'attention-tools.ts', 'summary-tools.ts']
  const toolPerms: Array<{ id: string; perm: string }> = []
  for (const f of toolFiles) {
    const src = readFileSync(join(toolsDir, f), 'utf8')
    // Match: requiredPermission: '...'
    const permMatch = src.match(/requiredPermission:\s*'([^']+)'/)
    // Match: id: '...'
    const idMatch = src.match(/id:\s*'([^']+)'/)
    // Match all tool exports
    const exports = Array.from(src.matchAll(/^export const (\w+): CopilotTool/gm)).map(m => m[1])
    for (const e of exports) {
      // Find the per-tool block
      const blockRe = new RegExp(`export const ${e}[\\s\\S]*?id:\\s*'([^']+)'[\\s\\S]*?requiredPermission:\\s*'([^']+)'`)
      const m = src.match(blockRe)
      if (m) {
        toolPerms.push({ id: m[1], perm: m[2] })
      }
    }
  }

  check('Tools are registered with permissions', toolPerms.length >= 10, `found ${toolPerms.length} tools`)

  const ROLE_PERMS: Record<string, Set<string>> = {
    ADMIN: new Set([
      'hiring_request.view', 'hiring_request.create', 'hiring_request.edit',
      'candidate.view', 'candidate.create', 'candidate.edit',
      'interview.view', 'interview.create', 'interview.evaluate',
      'offer.view', 'offer.view_compensation', 'offer.create', 'offer.edit', 'offer.approve', 'offer.issue', 'offer.record_response',
      'decision.view', 'decision.create', 'decision.edit',
      'reports.view',
    ]),
    TA_LEAD: new Set([
      'hiring_request.view', 'hiring_request.create', 'hiring_request.edit',
      'candidate.view', 'candidate.create', 'candidate.edit',
      'interview.view', 'interview.create', 'interview.evaluate',
      'offer.view', 'offer.view_compensation', 'offer.create', 'offer.edit', 'offer.approve', 'offer.issue', 'offer.record_response',
      'decision.view', 'decision.create', 'decision.edit',
      'reports.view',
    ]),
    RECRUITER: new Set([
      'hiring_request.view',
      'candidate.view', 'candidate.create', 'candidate.edit',
      'interview.view', 'interview.create',
      'offer.view', 'offer.view_compensation', 'offer.create', 'offer.edit', 'offer.issue', 'offer.record_response',
      'decision.view',
      'reports.view',
    ]),
    HIRING_MANAGER: new Set([
      'hiring_request.view',
      'candidate.view',
      'interview.view', 'interview.evaluate',
      'offer.view', 'offer.view_compensation', 'offer.approve', 'offer.record_response',
      'decision.view',
      'reports.view',
    ]),
    INTERVIEWER: new Set([
      'candidate.view',
      'interview.view', 'interview.evaluate',
    ]),
    VIEWER: new Set([
      'hiring_request.view',
      'candidate.view',
      'interview.view',
      'offer.view',
      'decision.view',
      'reports.view',
    ]),
    CANDIDATE: new Set([]),
  }

  // For every (role, tool) combination, verify the permission check matches expectation
  for (const role of Object.keys(ROLE_PERMS)) {
    for (const t of toolPerms) {
      const expected = ROLE_PERMS[role].has(t.perm)
      const actual = hasPermission(role as any, t.perm as any)
      check(`Role ${role} on tool ${t.id} (${t.perm}) — expect ${expected}`, expected === actual, `got ${actual}`)
    }
  }

  // Special: VIEWER must NOT have offer.view_compensation
  check('VIEWER does NOT have offer.view_compensation', !hasPermission('VIEWER' as any, 'offer.view_compensation' as any))
  check('VIEWER DOES have offer.view (no compensation)', hasPermission('VIEWER' as any, 'offer.view' as any))

  // Special: get_offers_by_status has requiredPermission = offer.view (so VIEWER can call it),
  // but the EXECUTOR checks offer.view_compensation before returning compensation fields.
  // We assert the executor contains that check.
  const offerToolsSrc = readFileSync(join(toolsDir, 'offer-tools.ts'), 'utf8')
  check('get_offers_by_status uses offer.view as requiredPermission', !!toolPerms.find(t => t.id === 'get_offers_by_status' && t.perm === 'offer.view'))
  check('get_offers_by_status executor gates compensation on offer.view_compensation', offerToolsSrc.includes('offer.view_compensation'))

  // Special: INTERVIEWER-scoped tools must be available to INTERVIEWER
  const interviewerTools = toolPerms.filter(t => t.id.startsWith('get_my_') || t.id === 'get_my_attention_items')
  check('INTERVIEWER-scoped tools are available to INTERVIEWER', interviewerTools.length > 0)
  for (const t of interviewerTools) {
    check(`INTERVIEWER has ${t.perm} (for ${t.id})`, hasPermission('INTERVIEWER' as any, t.perm as any))
  }

  console.log(`\nResult: ${pass} pass, ${fail} fail\n`)
  if (fail > 0) process.exit(1)
  process.exit(0)
}

main().catch(err => { console.error(err); process.exit(1) })
