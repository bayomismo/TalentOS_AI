/**
 * Sprint 17 — iCalendar (RFC 5545) generator.
 *
 * Tiny, dependency-free. Produces a valid VCALENDAR/VEVENT pair
 * for a single interview. The output works in:
 *   - Google Calendar
 *   - Apple Calendar
 *   - Microsoft Outlook
 *   - Mozilla Thunderbird
 *   - Fastmail / ProtonMail / any iCalendar-compliant app
 *
 * Field reference (most important for our use case):
 *   SUMMARY          — event title
 *   DESCRIPTION      — body
 *   LOCATION         — physical location
 *   URL              — meeting URL (Zoom/Meet/Teams)
 *   DTSTART/DTEND    — start/end in UTC (Z suffix = UTC)
 *   UID              — globally unique id; must be stable so updates
 *                       to the same interview replace the old event
 *   ORGANIZER        — the TalentOS user who scheduled it
 *   ATTENDEE         — interviewer + candidate
 *   STATUS           — CONFIRMED / TENTATIVE / CANCELLED
 *   METHOD           — REQUEST (initial invite) / CANCEL (cancellation)
 *
 * Line folding (RFC 5545 §3.1): any line > 75 octets must be folded
 * with CRLF + space. We fold at 73 chars to be safe with UTF-8.
 */

export interface IcsEventInput {
  /** Stable UID — use the interview id + '@talentos-ai' so re-renders
   *  replace the existing event in the user's calendar. */
  uid: string
  summary: string
  description?: string
  location?: string
  url?: string
  /** ISO 8601 UTC string. */
  startIsoUtc: string
  /** ISO 8601 UTC string. */
  endIsoUtc: string
  organizer?: { name: string; email: string }
  attendees?: { name?: string; email: string }[]
  status?: 'CONFIRMED' | 'TENTATIVE' | 'CANCELLED'
  /** 'REQUEST' for initial invite, 'CANCEL' for cancellations. */
  method?: 'REQUEST' | 'CANCEL'
}

function escapeIcsText(s: string): string {
  // RFC 5545 §3.3.11: escape backslash, comma, semicolon, and newline.
  // Every flavour of line break (CRLF, lone CR, lone LF) collapses to the
  // literal "\n" escape so a value can never inject a new content line.
  return s
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;')
}

/**
 * Strip anything that could break the line structure out of a value that
 * is emitted WITHOUT text escaping (URI values, mailto: addresses).
 * Removes CR, LF, NUL and other C0 control characters.
 */
function stripIcsControlChars(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u001F\u007F]/g, '')
}

const ICS_MAX_OCTETS = 75 // RFC 5545 §3.1: lines are limited to 75 octets, excluding CRLF.
const icsTextEncoder = new TextEncoder()

function foldLine(line: string): string {
  // RFC 5545 §3.1: fold so no content line exceeds 75 octets (excluding
  // CRLF); continuation lines begin with a single space. We iterate by
  // Unicode code point so a multi-byte UTF-8 sequence is never split, and
  // we count real UTF-8 octets rather than UTF-16 code units.
  if (icsTextEncoder.encode(line).length <= ICS_MAX_OCTETS) return line
  const out: string[] = []
  let cur = ''
  let curOctets = 0
  let isFirst = true
  for (const ch of line) {
    const chOctets = icsTextEncoder.encode(ch).length
    // Continuation lines spend one octet on the leading space.
    const limit = isFirst ? ICS_MAX_OCTETS : ICS_MAX_OCTETS - 1
    if (curOctets + chOctets > limit && cur.length > 0) {
      out.push(isFirst ? cur : ' ' + cur)
      isFirst = false
      cur = ch
      curOctets = chOctets
    } else {
      cur += ch
      curOctets += chOctets
    }
  }
  out.push(isFirst ? cur : ' ' + cur)
  return out.join('\r\n')
}

function toIcsDate(iso: string): string {
  // Convert to UTC and format YYYYMMDDTHHMMSSZ
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    d.getUTCFullYear().toString() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    'T' +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    'Z'
  )
}

function escapeIcsParamValue(s: string): string {
  // §3.1.1: in parameter values, also escape colon and double-quote.
  // Drop every control char (incl. lone CR) so a CN= name can't inject.
  return stripIcsControlChars(s)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/;/g, '\\;')
    .replace(/:/g, '\\:')
}

export function buildIcsEvent(input: IcsEventInput): string {
  const now = toIcsDate(new Date().toISOString())
  const lines: string[] = []
  const method = input.method ?? 'REQUEST'

  // Push the header (must NOT be folded, per RFC 5545 §3.4)
  const out: string[] = []
  out.push('BEGIN:VCALENDAR')
  out.push('VERSION:2.0')
  out.push('PRODID:-//TalentOS AI//Interview//EN')
  out.push('CALSCALE:GREGORIAN')
  out.push(`METHOD:${method}`)

  // VEVENT block — every line gets folded (RFC 5545 §3.1)
  out.push('BEGIN:VEVENT')
  out.push(foldLine(`UID:${input.uid}`))
  out.push(foldLine(`DTSTAMP:${now}`))
  out.push(foldLine(`DTSTART:${toIcsDate(input.startIsoUtc)}`))
  out.push(foldLine(`DTEND:${toIcsDate(input.endIsoUtc)}`))
  out.push(foldLine(`SUMMARY:${escapeIcsText(input.summary)}`))
  if (input.description) {
    out.push(foldLine(`DESCRIPTION:${escapeIcsText(input.description)}`))
  }
  if (input.location) {
    out.push(foldLine(`LOCATION:${escapeIcsText(input.location)}`))
  }
  if (input.url) {
    // URI value type (§3.3.13): not text-escaped, but must never contain
    // CR/LF/control chars that would break the line structure.
    const safeUrl = stripIcsControlChars(input.url)
    if (safeUrl) out.push(foldLine(`URL:${safeUrl}`))
  }
  out.push(foldLine(`STATUS:${input.status ?? 'CONFIRMED'}`))
  if (input.organizer) {
    const name = input.organizer.name ? `;CN=${escapeIcsParamValue(input.organizer.name)}` : ''
    out.push(foldLine(`ORGANIZER${name}:mailto:${stripIcsControlChars(input.organizer.email)}`))
  }
  if (input.attendees) {
    for (const a of input.attendees) {
      const name = a.name ? `;CN=${escapeIcsParamValue(a.name)}` : ''
      out.push(foldLine(`ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE${name}:mailto:${stripIcsControlChars(a.email)}`))
    }
  }
  out.push('END:VEVENT')
  out.push('END:VCALENDAR')
  return out.join('\r\n')
}

/**
 * Pretty filename for the download. The user's calendar app will
 * usually display the event title, but a clean filename helps in
 * the file picker and email attachment.
 */
export function icsFilenameFor(interviewTitle: string, candidateName: string): string {
  const slug = `${interviewTitle}-${candidateName}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)
  return `${slug || 'interview'}.ics`
}
