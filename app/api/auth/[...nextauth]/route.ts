/**
 * Sprint 9 — Auth.js route handler.
 * Re-exports the HTTP handlers from lib/auth/auth.ts.
 */
import { handlers } from '@/lib/auth'
export const { GET, POST } = handlers
