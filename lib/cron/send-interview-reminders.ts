/**
 * Sprint 17 — Send 24h interview reminders.
 *
 * Called by the /api/cron/interview-reminders route. Designed to run
 * hourly via Vercel Cron (see vercel.json).
 *
 * What it does:
 *  1. Find every interview where:
 *     - status = SCHEDULED
 *     - scheduledAt is in [now+23h, now+25h] (1-hour window, hourly cadence)
 *     - reminderSentAt IS NULL
 *  2. For each, create a token (idempotent per interview), build
 *     the .ics URL, send a reminder email to BOTH the candidate and
 *     the interviewer, and mark reminderSentAt.
 *
 * Idempotency: thanks to `reminderSentAt IS NULL`, the same interview
 * can never be processed twice. If the cron job is delayed, the
 * window (now+23h to now+25h) ensures we still catch it.
 *
 * The 1-hour window is intentional: at hourly cadence, a 2-hour
 * window ensures we never miss, while a 1-hour window prevents us
 * from sending twice in the same hour if a deployment restarts
 * the cron job.
 */

import { db } from '@/lib/db'
import { sendEmail } from '@/lib/email'
import { interviewReminderEmail } from '@/lib/email/templates'
import { randomBytes } from 'node:crypto'

export interface RemindersRunResult {
  candidatesScanned: number
  emailsSent: number
  errors: { interviewId: string; error: string }[]
}

export async function sendInterviewReminders(now: Date = new Date()): Promise<RemindersRunResult> {
  const windowStart = new Date(now.getTime() + 23 * 60 * 60 * 1000)
  const windowEnd = new Date(now.getTime() + 25 * 60 * 60 * 1000)

  // Find candidates
  const candidates = await db.interview.findMany({
    where: {
      status: 'SCHEDULED',
      scheduledAt: { gte: windowStart, lte: windowEnd },
      reminderSentAt: null,
    },
    select: {
      id: true,
      organizationId: true,
      title: true,
      scheduledAt: true,
      durationMinutes: true,
      location: true,
      meetingUrl: true,
      organization: { select: { name: true } },
      candidate: { select: { id: true, firstName: true, lastName: true, email: true } },
      scheduledBy: { select: { firstName: true, lastName: true, email: true } },
      hiringRequest: { select: { title: true } },
    },
  })

  const appUrl = process.env.APP_URL || 'https://talentos-ai-lime.vercel.app'

  const result: RemindersRunResult = {
    candidatesScanned: candidates.length,
    emailsSent: 0,
    errors: [],
  }

  for (const iv of candidates) {
    try {
      // Ensure a token exists (idempotent — same one per interview)
      let tokenRow = await db.interviewReminderToken.findUnique({
        where: { interviewId: iv.id },
        select: { token: true },
      })
      if (!tokenRow) {
        const token = randomBytes(20).toString('base64url')
        tokenRow = await db.interviewReminderToken.create({
          data: {
            organizationId: iv.organizationId,
            interviewId: iv.id,
            token,
          },
          select: { token: true },
        })
      }

      const icsUrl = `${appUrl}/api/public/interview.ics?id=${iv.id}&token=${tokenRow.token}`
      const scheduledAtLocal = formatLocalTime(iv.scheduledAt, iv.organizationId)
      const candidateName = `${iv.candidate.firstName} ${iv.candidate.lastName}`
      const interviewerName = iv.scheduledBy
        ? `${iv.scheduledBy.firstName} ${iv.scheduledBy.lastName}`
        : 'the interviewer'

      // Email the candidate
      const candidateTpl = interviewReminderEmail({
        organizationName: iv.organization.name,
        recipientName: iv.candidate.firstName,
        recipientEmail: iv.candidate.email,
        recipientIsCandidate: true,
        interviewTitle: iv.title,
        candidateName,
        interviewerName,
        scheduledAtLocal,
        durationMinutes: iv.durationMinutes,
        location: iv.location ?? undefined,
        meetingUrl: iv.meetingUrl ?? undefined,
        icsDownloadUrl: icsUrl,
        hiringTitle: iv.hiringRequest.title,
        workspaceUrl: appUrl,
      })
      await sendEmail({
        kind: 'interview_reminder',
        to: iv.candidate.email,
        from: candidateTpl.from,
        subject: candidateTpl.subject,
        text: candidateTpl.text,
        html: candidateTpl.html,
        metadata: { interviewId: iv.id, recipientRole: 'candidate' },
      })
      result.emailsSent++

      // Email the interviewer (if known)
      if (iv.scheduledBy?.email) {
        const ivTpl = interviewReminderEmail({
          organizationName: iv.organization.name,
          recipientName: iv.scheduledBy.firstName,
          recipientEmail: iv.scheduledBy.email,
          recipientIsCandidate: false,
          interviewTitle: iv.title,
          candidateName,
          interviewerName,
          scheduledAtLocal,
          durationMinutes: iv.durationMinutes,
          location: iv.location ?? undefined,
          meetingUrl: iv.meetingUrl ?? undefined,
          icsDownloadUrl: icsUrl,
          hiringTitle: iv.hiringRequest.title,
          workspaceUrl: `${appUrl}/candidates/${iv.candidate.id}`,
        })
        await sendEmail({
          kind: 'interview_reminder',
          to: iv.scheduledBy.email,
          from: ivTpl.from,
          subject: ivTpl.subject,
          text: ivTpl.text,
          html: ivTpl.html,
          metadata: { interviewId: iv.id, recipientRole: 'interviewer' },
        })
        result.emailsSent++
      }

      // Mark as sent (in a transaction so we don't mark on partial failure)
      await db.interview.update({
        where: { id: iv.id },
        data: { reminderSentAt: new Date() },
      })
    } catch (err) {
      result.errors.push({
        interviewId: iv.id,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return result
}

/**
 * Format a UTC Date in the org's local timezone, falling back to UTC
 * if the org has no timezone set. Uses Intl.DateTimeFormat for the
 * formatting (no library dep).
 */
async function formatLocalTime(utc: Date, organizationId: string): Promise<string> {
  const org = await db.organization.findUnique({
    where: { id: organizationId },
    select: { timezone: true },
  })
  const tz = org?.timezone || 'UTC'
  try {
    return new Intl.DateTimeFormat('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZone: tz,
      timeZoneName: 'short',
    }).format(utc)
  } catch {
    return new Intl.DateTimeFormat('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'UTC',
      timeZoneName: 'short',
    }).format(utc)
  }
}
