/**
 * Sprint 11 — Copilot read-only integrity test.
 *
 * PART 23: every registered tool must be read-only. We verify
 * by static source-level scan of all tool executor functions. We
 * do NOT need to actually run the tools — we just inspect their
 * source. This avoids pulling in `server-only`.
 */

import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'

const TOOL_DIR = join(__dirname, '..', 'lib', 'copilot', 'tools')

const FORBIDDEN = [
  'prisma.user.create',
  'prisma.user.update',
  'prisma.user.delete',
  'prisma.user.upsert',
  'prisma.candidate.create',
  'prisma.candidate.update',
  'prisma.candidate.delete',
  'prisma.candidate.upsert',
  'prisma.hiringRequest.create',
  'prisma.hiringRequest.update',
  'prisma.hiringRequest.delete',
  'prisma.interview.create',
  'prisma.interview.update',
  'prisma.interview.delete',
  'prisma.offer.create',
  'prisma.offer.update',
  'prisma.offer.delete',
  'prisma.candidateDecision.create',
  'prisma.candidateDecision.update',
  'prisma.candidateDecision.delete',
  'prisma.interviewEvaluation.create',
  'prisma.interviewEvaluation.update',
  'prisma.interviewEvaluation.delete',
  'prisma.$executeRaw',
  'prisma.$queryRaw',
  'createMany',
  'updateMany',
  'deleteMany',
]

const BUSINESS_MUTATIONS = [
  'createHiringRequest',
  'updateHiringRequest',
  'createCandidate',
  'updateCandidate',
  'submitEvaluation',
  'createOffer',
  'updateOffer',
  'approveOffer',
  'issueOffer',
  'recordOfferResponse',
]

let pass = 0
let fail = 0
const failures: string[] = []

function check(name: string, ok: boolean, detail?: string) {
  if (ok) {
    pass++
    console.log(`  ok ${name}`)
  } else {
    fail++
    failures.push(`${name}${detail ? ': ' + detail : ''}`)
    console.log(`  FAIL ${name}${detail ? ' -- ' + detail : ''}`)
  }
}

function stripStrings(src: string): string {
  return src
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(['"`])(?:\\.|(?!\1).)*\1/g, '""')
}

console.log('\n=== Sprint 11 -- Copilot Read-Only Integrity ===\n')

// List all tool files
const toolFiles = readdirSync(TOOL_DIR).filter(f => f.endsWith('-tools.ts'))
check('Tool files exist', toolFiles.length > 0, `${toolFiles.length} tool files in ${TOOL_DIR}`)

// 1. Forbid forbidden Prisma methods in tools
console.log('\n[1] Forbidden Prisma mutation tokens in tool files:')
for (const f of toolFiles) {
  const src = stripStrings(readFileSync(join(TOOL_DIR, f), 'utf8'))
  for (const tok of FORBIDDEN) {
    check(`Tool file ${f} has no "${tok}" in code`, !src.includes(tok))
  }
}

// 2. Each tool file must export a tool
console.log('\n[2] Tool file shape:')
for (const f of toolFiles) {
  const src = readFileSync(join(TOOL_DIR, f), 'utf8')
  const exportCount = (src.match(/^export const \w+Tool/gm) || []).length
  check(`File ${f} exports at least one tool`, exportCount > 0, `found ${exportCount}`)
  check(`File ${f} uses Zod`, src.includes('z.object') || src.includes('z.array'))
  check(`File ${f} has execute() signature`, src.includes('async execute') || src.includes('execute:'))
  check(`File ${f} scopes queries with organizationId`, src.includes('organizationId'))
  check(`File ${f} uses take/limit`, src.includes('take:') || src.includes('limit'))
}

// 3. Orchestrator / registry / intent / response must not perform business mutations
console.log('\n[3] Orchestrator/registry/intent/response read-only:')
const orchestratorSrc = readFileSync(join(__dirname, '..', 'lib', 'copilot', 'orchestrator.ts'), 'utf8')
const registrySrc = readFileSync(join(__dirname, '..', 'lib', 'copilot', 'registry.ts'), 'utf8')
const intentSrc = readFileSync(join(__dirname, '..', 'lib', 'copilot', 'intent.ts'), 'utf8')
const responseSrc = readFileSync(join(__dirname, '..', 'lib', 'copilot', 'response.ts'), 'utf8')

for (const [name, src] of [
  ['orchestrator', orchestratorSrc],
  ['registry', registrySrc],
  ['intent', intentSrc],
  ['response', responseSrc],
] as const) {
  const stripped = stripStrings(src)
  for (const m of BUSINESS_MUTATIONS) {
    check(`Copilot ${name} has no business mutation "${m}"`, !stripped.includes(m))
  }
  for (const tok of FORBIDDEN) {
    // orchestrator persists the conversation via db.aITask.create / db.aIConversation.create. Those are session logs, not business mutations.
    if (name === 'orchestrator' && tok.startsWith('prisma.aITask')) continue
    if (name === 'orchestrator' && tok.startsWith('prisma.aIConversation')) continue
    check(`Copilot ${name} has no business-forbidden token "${tok}"`, !stripped.includes(tok))
  }
}

// 4. Response generator must NOT pass raw tool data to Gemini as is
console.log('\n[4] Response generator safety:')
check('Response generator exports CopilotResponse type', responseSrc.includes('CopilotResponse'))
check('Response generator filters recordHrefs', responseSrc.includes('allowedHrefs') || responseSrc.includes('recordHrefs'))
check('Response generator enforces "do not invent"', responseSrc.toLowerCase().includes('do not invent') || responseSrc.includes('not invent'))
check('Response generator surfaces limitations', responseSrc.includes('limitations'))

// 5. Intent router — known injection patterns must be blocked
console.log('\n[5] Intent router prompt-injection defense:')
const blockedKeywords = [
  'ignore', 'previous', 'system prompt', 'sql', 'all salaries', 'prisma',
  'approve', 'issue', 'reveal', 'disregard',
]
for (const kw of blockedKeywords) {
  check(`Intent router contains keyword ${kw}`, intentSrc.toLowerCase().includes(kw.toLowerCase()))
}
check('Intent router has BLOCKED_PATTERNS array', intentSrc.includes('BLOCKED_PATTERNS'))
check('Intent router exposes isPromptInjection()', intentSrc.includes('isPromptInjection'))

// 6. Constants
console.log('\n[6] Safety constants:')
const typesSrc = readFileSync(join(__dirname, '..', 'lib', 'copilot', 'types.ts'), 'utf8')
check('MAX_TOOL_CALLS_PER_TURN = 5', /MAX_TOOL_CALLS_PER_TURN\s*=\s*5/.test(typesSrc))
check('MAX_RECORDS_PER_TOOL = 50', /MAX_RECORDS_PER_TOOL\s*=\s*50/.test(typesSrc))

console.log(`\nResult: ${pass} pass, ${fail} fail\n`)
if (fail > 0) {
  console.log('Failures:')
  for (const f of failures) console.log('  - ' + f)
  process.exit(1)
}
process.exit(0)
