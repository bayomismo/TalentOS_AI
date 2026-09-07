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
  // RFC 5545 §3.3.11: backslash, comma, semicolon, newline.
  return s
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;')
}

function foldLine(line: string): string {
  // Fold at 73 octets per line; we approximate by character count
  // (UTF-8 could push over, but for short fields this is safe).
  if (line.length <= 73) return line
  const out: string[] = []
  let i = 0
  while (i < line.length) {
    if (i === 0) {
      out.push(line.slice(0, 73))
      i = 73
    } else {
      out.push(' ' + line.slice(i, i + 72))
      i += 72
    }
  }
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
  return s
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/;/g, '\\;')
    .replace(/:/g, '\\:')
    .replace(/\r?\n/g, '')
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
    out.push(foldLine(`URL:${input.url}`))
  }
  out.push(foldLine(`STATUS:${input.status ?? 'CONFIRMED'}`))
  if (input.organizer) {
    const name = input.organizer.name ? `;CN=${escapeIcsParamValue(input.organizer.name)}` : ''
    out.push(foldLine(`ORGANIZER${name}:mailto:${input.organizer.email}`))
  }
  if (input.attendees) {
    for (const a of input.attendees) {
      const name = a.name ? `;CN=${escapeIcsParamValue(a.name)}` : ''
      out.push(foldLine(`ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE${name}:mailto:${a.email}`))
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
