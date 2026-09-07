/**
 * Sprint 13 — Reserved workspace slugs.
 *
 * These cannot be used as workspace URLs because they collide with
 * application routes or are otherwise reserved.
 */
export const reservedSlugs: Set<string> = new Set([
  'admin',
  'api',
  'app',
  'auth',
  'dashboard',
  'help',
  'login',
  'logout',
  'onboarding',
  'public',
  'root',
  'settings',
  'signup',
  'support',
  'talentos',
  'team',
  'terms',
  'privacy',
  'www',
  // Common reserved words
  'null',
  'undefined',
  'system',
  'internal',
  'console',
  'docs',
  'about',
  'contact',
  'pricing',
  'blog',
])
