/**
 * Sprint 16 — GET /api/ai-usage
 *
 * Returns the current org's monthly AI usage summary. Used by the
 * meter on /settings.
 *
 * Tenant-scoped: only returns data for the caller's org.
 */

import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth/auth'
import { getAiUsageSummary } from '@/lib/ai/quota'

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 })
  }
  const orgId = (session.user as { organizationId?: string }).organizationId
  if (!orgId) {
    return NextResponse.json({ error: 'No organization' }, { status: 400 })
  }

  const summary = await getAiUsageSummary(orgId)
  return NextResponse.json(summary)
}
