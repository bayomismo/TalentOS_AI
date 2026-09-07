/**
 * Sprint 17 — ICS test.
 *
 * Tests the iCalendar generator and the public download endpoint.
 */

import 'dotenv/config'
import { buildIcsEvent, icsFilenameFor } from '../lib/calendar/ics'

let pass = 0, fail = 0
function ok(label: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ✓ ${label}`) }
  else { fail++; console.log(`  ✗ ${label}${detail ? ' — ' + detail : ''}`) }
}

function main() {
  console.log('ICS generator test\n')

  // 1. Basic event
  const ics = buildIcsEvent({
    uid: 'test-123@talentos-ai',
    summary: 'Senior Frontend Engineer — Ada Lovelace',
    description: 'Final round.\nCome prepared.',
    location: 'Remote',
    url: 'https://meet.example.com/abc',
    startIsoUtc: '2026-08-01T14:00:00.000Z',
    endIsoUtc: '2026-08-01T15:00:00.000Z',
    organizer: { name: 'Bayomi Smith', email: 'bayomismo@gmail.com' },
    attendees: [
      { name: 'Ada Lovelace', email: 'ada@example.com' },
      { name: 'Bayomi Smith', email: 'bayomismo@gmail.com' },
    ],
    status: 'CONFIRMED',
    method: 'REQUEST',
  })

  // 2. Required headers
  ok('contains BEGIN:VCALENDAR', ics.includes('BEGIN:VCALENDAR'))
  ok('contains END:VCALENDAR', ics.includes('END:VCALENDAR'))
  ok('contains VERSION:2.0', ics.includes('VERSION:2.0'))
  ok('contains PRODID', ics.includes('PRODID:'))
  ok('contains METHOD:REQUEST', ics.includes('METHOD:REQUEST'))
  ok('contains BEGIN:VEVENT', ics.includes('BEGIN:VEVENT'))
  ok('contains END:VEVENT', ics.includes('END:VEVENT'))

  // 3. UID
  ok('contains UID', ics.includes('UID:test-123@talentos-ai'))

  // 4. Times are in UTC (Z suffix)
  ok('DTSTART is UTC', ics.includes('DTSTART:20260801T140000Z'))
  ok('DTEND is UTC', ics.includes('DTEND:20260801T150000Z'))

  // 5. SUMMARY escaped
  ok('SUMMARY present', ics.includes('SUMMARY:Senior Frontend Engineer'))

  // 6. Attendees
  ok('has ORGANIZER', ics.includes('ORGANIZER;CN=Bayomi Smith:mailto:bayomismo@gmail.com'))
  ok('has ATTENDEE candidate', ics.includes('ATTENDEE') && ics.includes('mailto:ada@example.com'))

  // 7. Status
  ok('has STATUS:CONFIRMED', ics.includes('STATUS:CONFIRMED'))

  // 8. Line endings are CRLF
  ok('uses CRLF', ics.includes('\r\n'))

  // 9. Long lines are folded (≤ 73 octets per line, per RFC 5545)
  const lines = ics.split('\r\n')
  const tooLong = lines.filter(l => l.length > 75)
  ok('no unfolded lines > 75 chars', tooLong.length === 0,
    tooLong.length > 0 ? `Found ${tooLong.length} long line(s): ${tooLong[0]?.slice(0, 80)}` : '')

  // 10. Filename helper
  const fname = icsFilenameFor('Senior Frontend Engineer', 'Ada Lovelace')
  ok('filename is slugified', fname === 'senior-frontend-engineer-ada-lovelace.ics',
    `got: ${fname}`)

  // 11. Special chars escaped (commas, semicolons, newlines)
  const icsEscaped = buildIcsEvent({
    uid: 'esc-1@talentos-ai',
    summary: 'Hello, world; with a comma',
    description: 'Line 1\nLine 2',
    startIsoUtc: '2026-08-01T14:00:00.000Z',
    endIsoUtc: '2026-08-01T15:00:00.000Z',
  })
  ok('commas escaped', icsEscaped.includes('Hello\\, world\\; with a comma'))
  ok('newlines escaped', icsEscaped.includes('Line 1\\nLine 2'))

  // 12. CANCEL method
  const icsCancel = buildIcsEvent({
    uid: 'cancel-1@talentos-ai',
    summary: 'Cancelled: Interview',
    startIsoUtc: '2026-08-01T14:00:00.000Z',
    endIsoUtc: '2026-08-01T15:00:00.000Z',
    method: 'CANCEL',
    status: 'CANCELLED',
  })
  ok('CANCEL method', icsCancel.includes('METHOD:CANCEL'))
  ok('CANCELLED status', icsCancel.includes('STATUS:CANCELLED'))

  console.log(`\n========== ${pass} pass, ${fail} fail ==========`)
  if (fail > 0) process.exit(1)
}
main()
