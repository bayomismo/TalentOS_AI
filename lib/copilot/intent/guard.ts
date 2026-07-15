/**
 * Sprint 11.1 — Prompt injection + intent guards.
 *
 * PART 17: block known prompt-injection patterns at the entry point.
 * This is the FIRST line of defense. The ActionRegistry and the
 * permission system are the SECOND line.
 */

import 'server-only'

const BLOCKED_PATTERNS = [
  /ignore (all )?previous/i,
  /ignore (all )?instructions/i,
  /disregard (the )?(system|above)/i,
  /reveal (the )?system prompt/i,
  /show (the )?system prompt/i,
  /execute\s*sql/i,
  /run\s*sql/i,
  /select \*/i,
  /database_url/i,
  /all organizations/i,
  /all organisations/i,
  /all salaries/i,
  /all compensation/i,
  /prisma\.\$/i,
  /raw query/i,
  /\bapprove\b.*\boffer\b/i,
  /\bissue\b.*\boffer\b/i,
  /\baccept\b.*\boffer\b/i,
  /\bdecline\b.*\boffer\b/i,
  /\bwithdraw\b.*\boffer\b/i,
  /\breject\b.*\boffer\b/i,
  /\bcreate\b.*\bhiring request\b/i,
  /\bdelete\b.*\bcandidate\b/i,
  /\bskip confirmation\b/i,
  /\bmark confirmation as approved\b/i,
  /\bignore confirmation\b/i,
  /\bcreate an admin user\b/i,
  /\bchange user role\b/i,
  /\binvite user\b/i,
  /\bdisable user\b/i,
  /\bmodify security\b/i,
  /\bmodify organization\b/i,
]

export function isPromptInjection(message: string): boolean {
  return BLOCKED_PATTERNS.some(re => re.test(message))
}
