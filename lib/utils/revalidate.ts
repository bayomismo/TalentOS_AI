/**
 * Sprint 9 — safeRevalidate wrapper.
 *
 * `revalidatePath` from `next/cache` only works inside a Next.js request
 * context. Scripts that call server actions (or the action that calls
 * itself) need a try/catch no-op wrapper. The pattern is the same as
 * Sprint 7: same as `safeRevalidate` from previous sprints, but
 * centralized here for Sprint 9.
 */
import { revalidatePath } from 'next/cache'

export function safeRevalidate(path: string): void {
  try {
    revalidatePath(path)
  } catch {
    // Outside a request context — ignore.
  }
}
