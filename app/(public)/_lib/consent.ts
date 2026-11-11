/**
 * Sprint 19 — The exact consent scope the public applicant agrees to.
 *
 * Shared between the public apply form (which renders it) and the apply
 * action (which PERSISTS it on the `Application` row). The audit
 * finding P2-07 was that consent was validated and then thrown away —
 * nothing recorded what the applicant agreed to or when.
 *
 * The text is built SERVER-SIDE from the organization name, so the
 * string that is stored is the string that was shown. The client never
 * gets to decide what is written to the consent column.
 */

export function publicConsentText(organizationName: string): string {
  return (
    `I agree to share my information with ${organizationName} for the purpose of this ` +
    `application. I understand that my data will be stored in TalentOS and that the ` +
    `employer may contact me about this or future opportunities.`
  )
}

/** The scope of the consent, stored alongside the text. */
export const PUBLIC_CONSENT_SCOPE = {
  /** What the applicant agreed to. */
  purpose: 'Recruitment — evaluation of this application by the employer.',
  /** How long the employer may keep it. */
  retention: 'Until the hiring process for this role ends, plus the employer\'s legal retention period.',
  /** Who receives it. */
  recipients: 'The hiring team of the employer for this role only.',
  /** Whether it is reused. */
  reuse: 'The employer may contact me about future opportunities.',
} as const
