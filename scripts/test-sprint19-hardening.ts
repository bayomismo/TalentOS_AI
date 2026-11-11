/**
 * Hardening sprint (Sprint 19) — focused pure-function tests.
 *
 * NO database, NO network, NO `server-only` imports. Run with:
 *
 *   npx tsx scripts/test-sprint19-hardening.ts
 *
 * Covers:
 *   1. ICS CRLF injection / escaping / UTF-8 byte folding (lib/calendar/ics.ts)
 *   2. Oversized base64 CV rejection threshold (apply-schema.ts)
 *   3. Public-application structural validation (apply-schema.ts)
 */
import { buildIcsEvent } from '../lib/calendar/ics'
import { applicationSchema, MAX_CV_BASE64_CHARS } from '../app/(public)/jobs/[slug]/apply-schema'
import { MAX_CV_BYTES } from '../lib/cv/validate'

let pass = 0
let fail = 0
function assert(label: string, cond: boolean, detail?: string) {
  if (cond) {
    pass++
    console.log(`  ✓ ${label}`)
  } else {
    fail++
    console.log(`  ✗ ${label}${detail ? ' — ' + detail : ''}`)
  }
}
function section(name: string) {
  console.log(`\n${name}`)
}

/** RFC 5545 §3.1 unfolding: a CRLF followed by a single space/tab is removed. */
function unfold(ics: string): string[] {
  return ics.replace(/\r\n[ \t]/g, '').split('\r\n')
}
const octets = (s: string) => Buffer.byteLength(s, 'utf8')

// ---------------------------------------------------------------------------
section('1. ICS escaping / CRLF injection / folding')
// ---------------------------------------------------------------------------
{
  const evil = 'Interview\r\nX-EVIL-PROP:pwned\r\nSUMMARY:hijacked'
  const ics = buildIcsEvent({
    uid: 'u1@talentos-ai',
    summary: evil,
    description: 'line1\nline2\rline3',
    location: 'Room 5, Floor 2; Building A',
    url: 'https://example.com/meet\r\nX-EVIL:1',
    startIsoUtc: '2026-01-01T10:00:00.000Z',
    endIsoUtc: '2026-01-01T11:00:00.000Z',
    organizer: { name: 'Boss\r\nX-EVIL:1', email: 'boss@example.com\r\nX-EVIL:1' },
    attendees: [{ name: 'Cand', email: 'cand@example.com\r\nRRULE:FREQ=DAILY' }],
  })
  const lines = unfold(ics)

  assert('no injected X-EVIL-PROP line', !lines.includes('X-EVIL-PROP:pwned'))
  assert('no injected X-EVIL:1 line', !lines.some((l) => l === 'X-EVIL:1'))
  assert('no injected RRULE line', !lines.some((l) => l.startsWith('RRULE:')))
  assert('exactly one SUMMARY line', lines.filter((l) => l.startsWith('SUMMARY:')).length === 1)
  assert(
    'SUMMARY newline collapsed to \\n escape',
    lines.find((l) => l.startsWith('SUMMARY:'))?.includes('\\nX-EVIL-PROP:pwned') === true,
  )
  assert('exactly one DESCRIPTION line', lines.filter((l) => l.startsWith('DESCRIPTION:')).length === 1)
  assert(
    'DESCRIPTION collapses \\n and \\r to \\n',
    lines.find((l) => l.startsWith('DESCRIPTION:')) === 'DESCRIPTION:line1\\nline2\\nline3',
  )
  assert(
    'LOCATION escapes comma + semicolon',
    lines.find((l) => l.startsWith('LOCATION:')) === 'LOCATION:Room 5\\, Floor 2\\; Building A',
  )
  const urlLine = lines.find((l) => l.startsWith('URL:'))
  assert('URL line has no CR/LF and drops the injected suffix', urlLine === 'URL:https://example.com/meetX-EVIL:1')
  const orgLine = lines.find((l) => l.startsWith('ORGANIZER'))
  assert('ORGANIZER CN= strips control chars', orgLine === 'ORGANIZER;CN=BossX-EVIL\\:1:mailto:boss@example.comX-EVIL:1')
  const rawLines = ics.split('\r\n')
  assert('every raw content line <= 75 octets', rawLines.every((l) => octets(l) <= 75), rawLines.find((l) => octets(l) > 75))
  assert('no lone \\r or \\n inside a raw line', rawLines.every((l) => !/[\r\n]/.test(l)))
}

{
  // Multi-byte folding: 200 accented chars + emoji, must fold on code-point
  // boundaries and stay <= 75 octets/line, and unfold back to the original.
  const summary = 'é'.repeat(120) + '🎯'.repeat(20)
  const ics = buildIcsEvent({
    uid: 'u2@talentos-ai',
    summary,
    startIsoUtc: '2026-01-01T10:00:00.000Z',
    endIsoUtc: '2026-01-01T11:00:00.000Z',
  })
  const lines = ics.split('\r\n')
  assert('multi-byte: every raw line <= 75 octets', lines.every((l) => octets(l) <= 75), lines.map(octets).join(','))
  const rebuilt = unfold(ics).find((l) => l.startsWith('SUMMARY:'))!.slice('SUMMARY:'.length)
  assert('multi-byte: unfold reconstructs the summary exactly', rebuilt === summary)
  assert('multi-byte: no replacement char (no split code point)', !rebuilt.includes('�'))
}

{
  // Short ASCII summary: behaviour preserved — no folding.
  const ics = buildIcsEvent({
    uid: 'u3@talentos-ai',
    summary: 'Phone screen with Ada Lovelace',
    startIsoUtc: '2026-01-01T10:00:00.000Z',
    endIsoUtc: '2026-01-01T11:00:00.000Z',
  })
  assert('short summary is a single unfolded line', ics.includes('\r\nSUMMARY:Phone screen with Ada Lovelace\r\n'))
}

// ---------------------------------------------------------------------------
section('2. Oversized base64 CV threshold')
// ---------------------------------------------------------------------------
{
  const exactExpansion = Math.ceil((MAX_CV_BYTES * 4) / 3)
  assert('MAX_CV_BASE64_CHARS covers a full-size file', MAX_CV_BASE64_CHARS >= exactExpansion)
  assert('MAX_CV_BASE64_CHARS is a tight bound', MAX_CV_BASE64_CHARS <= exactExpansion + 4)
  // A 4 MB file (under the 5 MB limit) base64-encodes to < the char cap.
  const fourMbB64 = Math.ceil((4 * 1024 * 1024 * 4) / 3)
  assert('4 MB payload is under the char cap', fourMbB64 < MAX_CV_BASE64_CHARS)
  // A 6 MB file (over the limit) base64-encodes to > the char cap → rejected pre-decode.
  const sixMbB64 = Math.ceil((6 * 1024 * 1024 * 4) / 3)
  assert('6 MB payload exceeds the char cap', sixMbB64 > MAX_CV_BASE64_CHARS)
}

// ---------------------------------------------------------------------------
section('3. Public-application structural validation')
// ---------------------------------------------------------------------------
{
  const valid = { jobSlug: 'senior-engineer', firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' }

  assert('valid minimal body passes', applicationSchema.safeParse(valid).success)
  assert('missing jobSlug fails', !applicationSchema.safeParse({ ...valid, jobSlug: undefined }).success)
  assert('empty jobSlug fails', !applicationSchema.safeParse({ ...valid, jobSlug: '' }).success)
  assert('numeric firstName fails', !applicationSchema.safeParse({ ...valid, firstName: 123 }).success)
  assert('object email fails', !applicationSchema.safeParse({ ...valid, email: { x: 1 } }).success)
  assert('array phone fails', !applicationSchema.safeParse({ ...valid, phone: ['x'] }).success)
  assert('null body fails', !applicationSchema.safeParse(null).success)
  assert('string body fails', !applicationSchema.safeParse('nope').success)
  assert('over-long firstName fails', !applicationSchema.safeParse({ ...valid, firstName: 'a'.repeat(401) }).success)
  assert('cv with numeric dataBase64 fails', !applicationSchema.safeParse({ ...valid, cv: { dataBase64: 5, fileName: 'a', mimeType: 'b' } }).success)
  assert('cv with all strings passes', applicationSchema.safeParse({ ...valid, cv: { dataBase64: 'abc', fileName: 'cv.pdf', mimeType: 'application/pdf' } }).success)
  assert('phone: null is allowed', applicationSchema.safeParse({ ...valid, phone: null }).success)

  const stripped = applicationSchema.safeParse({ ...valid, sneaky: 'x', organizationId: 'other-org' })
  assert('unknown keys are stripped, not rejected', stripped.success)
  if (stripped.success) {
    assert('stripped body has no `organizationId`', !('organizationId' in stripped.data))
    assert('stripped body has no `sneaky`', !('sneaky' in stripped.data))
  }
}

// ---------------------------------------------------------------------------
console.log(`\n${'='.repeat(50)}`)
console.log(`${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
