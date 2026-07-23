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
