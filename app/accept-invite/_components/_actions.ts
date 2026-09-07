'use server'

import { z } from 'zod'
import { acceptInvitation } from '@/lib/auth/invitation'
import type { AuthFailure } from '@/lib/auth/types'

const acceptSchema = z.object({
  token: z.string().min(20, 'Token is required'),
  firstName: z.string().min(1, 'First name is required').max(64),
  lastName: z.string().min(1, 'Last name is required').max(64),
  password: z.string().min(10, 'Password must be at least 10 characters').max(128),
})

export async function acceptInvitationAction(input: unknown) {
  const parsed = acceptSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: { code: 'VALIDATION', message: parsed.error.issues[0]?.message ?? 'Invalid input' } } satisfies { ok: false; error: AuthFailure | { code: string; message: string } }
  }
  const result = await acceptInvitation(parsed.data)
  if (!result.ok) {
    return { ok: false, error: { code: 'INVITATION', message: result.reason } }
  }
  return { ok: true as const, data: result }
}
