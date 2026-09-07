/**
 * GET /api/health/ai
 *
 * Liveness probe for the AI engine. Returns the active provider, the
 * configured model, the result of a tiny Gemini call, and the latency
 * in milliseconds. Never throws — failures are encoded in the response.
 */

import { NextResponse } from 'next/server'

import { getAIEngine } from '@/lib/ai/service/ai-engine'
import type { ProviderHealth } from '@/lib/ai/types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(): Promise<NextResponse<ProviderHealth>> {
  const engine = getAIEngine()
  const health = await engine.health()
  const status =
    health.status === 'healthy'
      ? 200
      : health.status === 'degraded'
        ? 200
        : health.status === 'unconfigured'
          ? 503
          : 503
  return NextResponse.json(health, { status })
}
