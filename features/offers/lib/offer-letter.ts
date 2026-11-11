/**
 * Offer letter text helpers.
 *
 * Sprint 19 — these live in their OWN module, not in `offer-service.ts`,
 * for two reasons:
 *
 * 1. `offer-service.ts` is a `'use server'` module. Next.js requires every
 *    export of a server-actions module to be an `async` function, so a
 *    synchronous helper exported from there fails the production build with
 *    "Server Actions must be async functions".
 *
 * 2. The offer detail page used to carry its OWN COPY of the renderer,
 *    with a comment saying it was "kept in sync" with the service. It had
 *    already drifted: the page version pushed any truthy value into the
 *    output, the service version only pushed non-empty strings. One
 *    implementation, one behaviour — the page and the service now render
 *    the letter identically.
 */

/** The order the letter's sections are rendered in. */
export const SECTION_ORDER = [
  'title',
  'opening',
  'roleSummary',
  'compensationSection',
  'benefitsSection',
  'employmentTermsSection',
  'startDateSection',
  'acceptanceInstructions',
  'closing',
] as const

/** The shape of a letter's structured sections. */
export type LetterSections = Record<string, unknown> | null | undefined

/**
 * Renders structured letter sections into the plain text the editor
 * works on. Audit P1-19: the AI output has no `fullText` key, so
 * after a reload the editor was empty even though the header said
 * "AI-generated draft on …" — and the first save destroyed the draft.
 */
export function renderSectionsToText(sections: LetterSections): string {
  if (!sections) return ''
  if (typeof sections === 'string') return sections
  const lines: string[] = []
  for (const key of SECTION_ORDER) {
    const value = sections[key]
    if (typeof value === 'string' && value.trim()) lines.push(`# ${key}\n${value}`)
  }
  const disclaimers = sections.disclaimers
  if (Array.isArray(disclaimers) && disclaimers.length > 0) {
    lines.push(`# disclaimers\n${disclaimers.map((d) => `- ${d}`).join('\n')}`)
  }
  return lines.join('\n\n')
}

/**
 * The inverse of `renderSectionsToText`: parses the plain-text editor
 * content back into the structured sections the letter is stored as.
 *
 * This is the round-trip that audit P1-19 was about — a manual save must
 * preserve the sections, not flatten them into an opaque blob.
 */
export function parseLetterText(text: string): Record<string, unknown> {
  const sections: Record<string, unknown> = {}
  const disclaimers: string[] = []
  const blocks = text.split(/\n\n(?=# )/g)
  for (const block of blocks) {
    const match = block.match(/^# (\w+)\n([\s\S]*)$/)
    if (!match) continue
    const key = match[1]
    const body = match[2].trim()
    if (key === 'disclaimers') {
      disclaimers.push(
        ...body
          .split('\n')
          .map((line) => line.replace(/^-\s*/, '').trim())
          .filter(Boolean),
      )
    } else {
      sections[key] = body
    }
  }
  if (disclaimers.length > 0) sections.disclaimers = disclaimers
  return sections
}
