/**
 * Sprint 17 — Vercel Cron entrypoint for interview reminders.
 *
 * GET /api/cron/interview-reminders
 *
 * Auth: requires `Authorization: Bearer ${CRON_SECRET}` (Vercel Cron
 * sends this header automatically when you set the secret in
 * vercel.json).
 *
 * Idempotent: safe to call as often as you like — the underlying
 * function only sends to interviews where reminderSentAt IS NULL.
 *
 * Vercel config (vercel.json):
 *   { "crons": [{ "path": "/api/cron/interview-reminders", "schedule": "0 9 * * *" }] }
 *
 * Hobby plan runs the cron once per day at 9am UTC. To get per-hour
 * cadence (exact 24h-before reminders), upgrade to Vercel Pro.
 */

import { NextRequest, NextResponse } from 'next/server'
import { sendInterviewReminders } from '@/lib/cron/send-interview-reminders'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const expected = process.env.CRON_SECRET
  // If no CRON_SECRET is set, allow in dev (so the route is callable
  // from a script). In production, Vercel always sends the auth header.
  if (expected) {
    const got = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
    if (got !== expected) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  } else if (process.env.NODE_ENV === 'production') {
    // Production without a secret = misconfigured. Fail closed.
    return NextResponse.json(
      { error: 'CRON_SECRET not set in production' },
      { status: 500 },
    )
  }

  const result = await sendInterviewReminders()
  return NextResponse.json(result)
}
