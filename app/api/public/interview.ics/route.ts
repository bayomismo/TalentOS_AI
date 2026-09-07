/**
 * Sprint 17 — Public ICS download endpoint.
 *
 * GET /api/public/interview.ics?id=<interviewId>&token=<reminderToken>
 *
 * Returns the interview as an .ics file. No auth required — the
 * reminderToken is a random string the cron job created when it
 * sent the reminder email. Only the person with the link (i.e.
 * the email recipient) can download.
 *
 * The token is checked against the InterviewReminderToken table.
 * Tokens never expire (so a candidate can re-download if they lose
 * the .ics), but they're single-purpose — they only work for the
 * one interview they were generated for.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { buildIcsEvent, icsFilenameFor } from '@/lib/calendar/ics'

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const id = url.searchParams.get('id')
  const token = url.searchParams.get('token')

  if (!id || !token) {
    return NextResponse.json({ error: 'Missing id or token' }, { status: 400 })
  }

  // Look up the interview (token validity below)
  const interview = await db.interview.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      description: true,
      scheduledAt: true,
      durationMinutes: true,
      location: true,
      meetingUrl: true,
      status: true,
      organization: { select: { name: true } },
      candidate: { select: { firstName: true, lastName: true, email: true } },
      scheduledBy: { select: { firstName: true, lastName: true, email: true } },
    },
  })
  if (!interview) {
    return NextResponse.json({ error: 'Interview not found' }, { status: 404 })
  }

  // Validate token
  const tokenRow = await db.interviewReminderToken.findUnique({
    where: { token },
    select: { id: true, interviewId: true },
  })
  if (!tokenRow || tokenRow.interviewId !== interview.id) {
    return NextResponse.json({ error: 'Invalid token' }, { status: 403 })
  }

  if (interview.status === 'CANCELLED') {
    // Send a CANCEL method so the user's calendar removes the event
    const ics = buildIcsEvent({
      uid: `${interview.id}@talentos-ai`,
      summary: `Cancelled: ${interview.title}`,
      startIsoUtc: interview.scheduledAt.toISOString(),
      endIsoUtc: new Date(interview.scheduledAt.getTime() + interview.durationMinutes * 60_000).toISOString(),
      status: 'CANCELLED',
      method: 'CANCEL',
      organizer: interview.scheduledBy?.email
        ? { name: interview.scheduledBy.firstName + ' ' + interview.scheduledBy.lastName, email: interview.scheduledBy.email }
        : undefined,
    })
    return new NextResponse(ics, {
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': `attachment; filename="${icsFilenameFor(interview.title, interview.candidate.firstName + '-' + interview.candidate.lastName)}"`,
        'Cache-Control': 'no-store',
      },
    })
  }

  const candidate = interview.candidate
  const endIsoUtc = new Date(interview.scheduledAt.getTime() + interview.durationMinutes * 60_000).toISOString()

  const description = [
    interview.description,
    `Candidate: ${candidate.firstName} ${candidate.lastName}`,
    `Organization: ${interview.organization.name}`,
  ].filter(Boolean).join('\n')

  const ics = buildIcsEvent({
    uid: `${interview.id}@talentos-ai`,
    summary: `${interview.title} — ${candidate.firstName} ${candidate.lastName}`,
    description,
    location: interview.location ?? undefined,
    url: interview.meetingUrl ?? undefined,
    startIsoUtc: interview.scheduledAt.toISOString(),
    endIsoUtc,
    status: 'CONFIRMED',
    method: 'REQUEST',
    organizer: interview.scheduledBy?.email
      ? { name: interview.scheduledBy.firstName + ' ' + interview.scheduledBy.lastName, email: interview.scheduledBy.email }
      : undefined,
    attendees: [
      { name: `${candidate.firstName} ${candidate.lastName}`, email: candidate.email },
      ...(interview.scheduledBy?.email
        ? [{ name: `${interview.scheduledBy.firstName} ${interview.scheduledBy.lastName}`, email: interview.scheduledBy.email }]
        : []),
    ],
  })

  return new NextResponse(ics, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="${icsFilenameFor(interview.title, candidate.firstName + '-' + candidate.lastName)}"`,
      'Cache-Control': 'no-store',
    },
  })
}
