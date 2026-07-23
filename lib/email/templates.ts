/**
 * Sprint 16 — Email templates.
 *
 * Pure functions that return `{ subject, text, html }`. Each template
 * takes only the data it needs and returns the three parts in a shape
 * the providers can consume directly. No React, no template engine —
 * just hand-rolled HTML strings, which keeps the bundle small and
 * the templates diff-friendly.
 *
 * The branding is minimal (TalentOS logo, emerald accent). A future
 * sprint can add per-organization branding (logo, colors) by
 * threading `org` into every template.
 */

import { buildAcceptInviteUrl, buildResetPasswordUrl } from '@/lib/url/canonical'

const FROM_DEFAULT = 'TalentOS AI <noreply@talentos.ai>'
const BRAND_COLOR = '#10b981' // emerald-500

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function wrap(body: string): string {
  return [
    '<!doctype html>',
    '<html><body style="margin:0;padding:0;background:#0f172a;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">',
    '<div style="max-width:560px;margin:0 auto;padding:32px 16px;">',
    `<div style="font-size:14px;font-weight:600;color:${BRAND_COLOR};margin-bottom:24px;">TalentOS AI</div>`,
    '<div style="background:#ffffff;border-radius:12px;padding:32px;border:1px solid #e2e8f0;">',
    body,
    '</div>',
    '<div style="font-size:11px;color:#64748b;margin-top:24px;text-align:center;">You\'re receiving this because you have an account on TalentOS AI.</div>',
    '</div></body></html>',
  ].join('\n')
}

function ctaButton(url: string, label: string): string {
  return `<a href="${escapeHtml(url)}" style="display:inline-block;background:${BRAND_COLOR};color:#ffffff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:8px;margin:16px 0;">${escapeHtml(label)}</a>`
}

// --------------------------------------------------------------------
// Team invitation
// --------------------------------------------------------------------

export interface TeamInvitationInput {
  to: string
  inviterName: string
  inviterEmail: string
  organizationName: string
  role: string
  token: string
  message?: string | null
}

export function teamInvitationEmail(input: TeamInvitationInput) {
  const url = buildAcceptInviteUrl(input.token)
  const subject = `${input.inviterName} invited you to ${input.organizationName} on TalentOS AI`
  const text = [
    `${input.inviterName} (${input.inviterEmail}) invited you to join ${input.organizationName} on TalentOS AI as a ${input.role}.`,
    input.message ? `\nMessage from ${input.inviterName}:\n${input.message}\n` : '',
    `Accept your invitation:\n${url}\n`,
    `This link expires in 7 days and can only be used once.`,
    `If you weren't expecting this, you can safely ignore this email.`,
  ].join('\n')

  const body = [
    `<p style="margin:0 0 12px 0;">Hi,</p>`,
    `<p style="margin:0 0 12px 0;"><strong>${escapeHtml(input.inviterName)}</strong> (${escapeHtml(input.inviterEmail)}) invited you to join <strong>${escapeHtml(input.organizationName)}</strong> on TalentOS AI as a <strong>${escapeHtml(input.role)}</strong>.</p>`,
    input.message
      ? `<div style="background:#f1f5f9;border-left:3px solid ${BRAND_COLOR};padding:12px 16px;border-radius:6px;margin:16px 0;color:#334155;">${escapeHtml(input.message)}</div>`
      : '',
    ctaButton(url, 'Accept invitation'),
    `<p style="font-size:12px;color:#64748b;margin-top:16px;">This link expires in 7 days and can only be used once. If you weren't expecting this, you can safely ignore this email.</p>`,
  ].join('\n')

  return {
    from: FROM_DEFAULT,
    subject,
    text,
    html: wrap(body),
  }
}

export interface PasswordResetInput {
  to: string
  firstName: string
  token: string
  /** Minutes until the link expires. */
  ttlMinutes: number
}

export function passwordResetEmail(input: PasswordResetInput) {
  const url = buildResetPasswordUrl(input.token)
  const subject = 'Reset your TalentOS AI password'
  const text = [
    `Hi ${input.firstName},`,
    '',
    'We received a request to reset the password for your TalentOS AI account.',
    `Reset your password:\n${url}`,
    '',
    `This link expires in ${input.ttlMinutes} minutes and can only be used once.`,
    `If you didn't request this, you can safely ignore this email — your password will not change.`,
  ].join('\n')

  const body = [
    `<p style="margin:0 0 12px 0;">Hi ${escapeHtml(input.firstName)},</p>`,
    `<p style="margin:0 0 12px 0;">We received a request to reset the password for your TalentOS AI account. Click the button below to choose a new password.</p>`,
    ctaButton(url, 'Reset password'),
    `<p style="font-size:12px;color:#64748b;margin-top:16px;">This link expires in ${input.ttlMinutes} minutes and can only be used once. If you didn't request this, you can safely ignore this email — your password will not change.</p>`,
  ].join('\n')

  return {
    from: FROM_DEFAULT,
    subject,
    text,
    html: wrap(body),
  }
}

// --------------------------------------------------------------------
// Offer letter (placeholder for Sprint 18)
// --------------------------------------------------------------------

export interface OfferLetterEmailInput {
  to: string
  candidateFirstName: string
  positionTitle: string
  organizationName: string
  /** Public URL to view the offer (signed token in path). */
  offerUrl: string
  expiresAt: Date
}

export function offerLetterEmail(input: OfferLetterEmailInput) {
  const subject = `Your offer from ${input.organizationName} — ${input.positionTitle}`
  const text = [
    `Hi ${input.candidateFirstName},`,
    '',
    `${input.organizationName} has sent you an offer for the ${input.positionTitle} role.`,
    `View and respond to your offer:\n${input.offerUrl}`,
    '',
    `This offer expires on ${input.expiresAt.toUTCString()}.`,
  ].join('\n')

  const body = [
    `<p style="margin:0 0 12px 0;">Hi ${escapeHtml(input.candidateFirstName)},</p>`,
    `<p style="margin:0 0 12px 0;"><strong>${escapeHtml(input.organizationName)}</strong> has sent you an offer for the <strong>${escapeHtml(input.positionTitle)}</strong> role.</p>`,
    ctaButton(input.offerUrl, 'View offer'),
    `<p style="font-size:12px;color:#64748b;margin-top:16px;">This offer expires on ${escapeHtml(input.expiresAt.toUTCString())}.</p>`,
  ].join('\n')

  return { from: FROM_DEFAULT, subject, text, html: wrap(body) }
}

/**
 * Sprint 17 — 24h interview reminder.
 *
 * Goes to BOTH the candidate and the interviewer. The .ics download
 * link is a tokenized URL the candidate can use without a TalentOS
 * account.
 */
export interface InterviewReminderEmailInput {
  organizationName: string
  recipientName: string
  recipientEmail: string
  recipientIsCandidate: boolean
  interviewTitle: string
  candidateName: string
  interviewerName: string
  scheduledAtLocal: string      // human-readable local time, e.g. "Tue, Jul 24 at 2:00 PM CEST"
  durationMinutes: number
  location?: string
  meetingUrl?: string
  icsDownloadUrl: string        // tokenized URL for .ics download
  hiringTitle: string            // the role being interviewed for
  workspaceUrl: string           // link back into TalentOS
}

export function interviewReminderEmail(input: InterviewReminderEmailInput) {
  const otherParty = input.recipientIsCandidate
    ? `${input.interviewerName} (the interviewer)`
    : `${input.candidateName} (the candidate)`
  const subject = `Reminder: ${input.interviewTitle} on ${input.scheduledAtLocal}`

  const text = [
    `Hi ${input.recipientName},`,
    '',
    `This is a reminder that you have an interview coming up:`,
    ``,
    `  ${input.interviewTitle}`,
    `  ${input.candidateName} × ${input.interviewerName}`,
    `  ${input.scheduledAtLocal}`,
    `  ${input.durationMinutes} minutes`,
    input.location ? `  Location: ${input.location}` : '',
    input.meetingUrl ? `  Meeting link: ${input.meetingUrl}` : '',
    ``,
    `Add to your calendar:`,
    input.icsDownloadUrl,
    ``,
    `Hiring for: ${input.hiringTitle}`,
    `Organization: ${input.organizationName}`,
    ``,
    input.recipientIsCandidate
      ? `If you need to reschedule, reply to this email or contact your recruiter at ${input.workspaceUrl}`
      : `View full details in your workspace: ${input.workspaceUrl}`,
  ].filter(Boolean).join('\n')

  const detailsList = [
    `<li><strong>When:</strong> ${escapeHtml(input.scheduledAtLocal)} (${input.durationMinutes} min)</li>`,
    input.location ? `<li><strong>Location:</strong> ${escapeHtml(input.location)}</li>` : '',
    input.meetingUrl ? `<li><strong>Meeting link:</strong> <a href="${escapeHtml(input.meetingUrl)}">${escapeHtml(input.meetingUrl)}</a></li>` : '',
    `<li><strong>With:</strong> ${escapeHtml(otherParty)}</li>`,
  ].filter(Boolean).join('\n')

  const body = [
    `<p style="margin:0 0 16px 0;">Hi ${escapeHtml(input.recipientName)},</p>`,
    `<p style="margin:0 0 12px 0;">This is a friendly reminder that you have an interview coming up:</p>`,
    `<p style="margin:0 0 4px 0;font-size:18px;font-weight:600;">${escapeHtml(input.interviewTitle)}</p>`,
    `<p style="margin:0 0 16px 0;color:#64748b;">${escapeHtml(input.hiringTitle)} · ${escapeHtml(input.organizationName)}</p>`,
    `<ul style="margin:0 0 16px 0;padding-left:20px;color:#334155;">${detailsList}</ul>`,
    ctaButton(input.icsDownloadUrl, 'Add to your calendar'),
    `<p style="font-size:12px;color:#64748b;margin-top:16px;">The calendar link works with Google Calendar, Apple Calendar, Outlook, and any other calendar app. Works without a TalentOS account.</p>`,
    input.recipientIsCandidate
      ? `<p style="font-size:12px;color:#64748b;margin-top:16px;">Need to reschedule? Reply to this email or contact your recruiter.</p>`
      : `<p style="font-size:12px;color:#64748b;margin-top:16px;">View in your workspace: <a href="${escapeHtml(input.workspaceUrl)}" style="color:${BRAND_COLOR};">${escapeHtml(input.workspaceUrl)}</a></p>`,
  ].join('\n')

  return { from: FROM_DEFAULT, subject, text, html: wrap(body) }
}
