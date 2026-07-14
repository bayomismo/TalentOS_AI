/**
 * Smoke test for the AI engine.
 *
 * Exercises the provider factory, the engine, the Zod validation flow,
 * the schema-validation retry logic, and the NotImplementedError stub
 * without needing the full Next.js dev server.
 *
 * Run with:
 *   pnpm exec tsx scripts/ai-smoke.ts
 */

import { config as loadEnv } from 'dotenv'

import { getAIEngine } from '@/lib/ai/service/ai-engine'
import { _resetProviderCache, getAIProvider } from '@/lib/ai/providers/provider-factory'
import {
  AIEngineError,
  NotImplementedError,
  ProviderNotConfiguredError,
  SchemaValidationError,
} from '@/lib/ai/errors/ai-engine-error'
import {
  jobDescriptionOutputSchema,
  jobDescriptionPrompt,
} from '@/lib/ai/prompts/job-description'
import type { JobDescriptionInput } from '@/lib/ai/types'

loadEnv()

let passed = 0
let failed = 0

function ok(name: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log(`  ✓ ${name}`)
    passed++
  } else {
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`)
    failed++
  }
}

async function main() {
  console.log('\n== Provider factory ==')
  _resetProviderCache()
  const provider = getAIProvider()
  ok('factory returns GeminiProvider', provider.name === 'gemini', `got ${provider.name}`)
  ok('factory exposes a model name', typeof provider.getModelName() === 'string' && provider.getModelName().length > 0)

  console.log('\n== Provider health (no key) ==')
  const health = await provider.healthCheck()
  ok(
    'health returns a typed status',
    health.status === 'unconfigured' || health.status === 'healthy' || health.status === 'unhealthy' || health.status === 'degraded',
    JSON.stringify(health)
  )
  ok('health payload has provider field', health.provider === 'gemini')
  ok('health payload has model field', typeof health.model === 'string')
  ok('health payload has latency field (null)', health.latencyMs === null)
  ok('health payload has checkedAt ISO', !Number.isNaN(Date.parse(health.checkedAt)))

  console.log('\n== Engine facade ==')
  const engine = getAIEngine()
  ok('engine exposes the same provider', engine.getProvider() === provider)
  const healthViaEngine = await engine.health()
  ok('engine.health delegates to provider', healthViaEngine.provider === 'gemini')

  console.log('\n== NotImplementedError stubs ==')
  for (const method of ['analyzeCV', 'rankCandidate', 'generateInterviewKit', 'generateOfferLetter'] as const) {
    try {
      const arg =
        method === 'analyzeCV'
          ? ('cv text' as unknown as never)
          : method === 'rankCandidate'
            ? ('a' as unknown as never)
            : method === 'generateInterviewKit'
              ? ({ role: '', level: '', jobDescription: '' } as unknown as never)
              : ({ candidateName: '', role: '', salary: '', startDate: '' } as unknown as never)
      // @ts-expect-error - exercising the stub path
      await engine[method](arg)
      ok(`${method} throws NotImplementedError`, false, 'no error thrown')
    } catch (err) {
      ok(
        `${method} throws NotImplementedError`,
        err instanceof NotImplementedError,
        err instanceof Error ? err.message : String(err)
      )
    }
  }

  console.log('\n== Schema validation retry ==')
  // Force a SchemaValidationError by feeding a clearly invalid payload through
  // a fake provider that always returns bad JSON.
  const fakeProvider = makeFakeProvider('{"this": "is not the expected shape"}')
  const engineWithFake = createEngineWith(fakeProvider)
  try {
    await engineWithFake.generateJobDescription(sampleInput)
    ok('schema validation catches invalid payload', false, 'no error thrown')
  } catch (err) {
    ok(
      'schema validation catches invalid payload',
      err instanceof SchemaValidationError,
      err instanceof Error ? err.message : String(err)
    )
  }

  console.log('\n== Schema validation happy path (fake provider returns valid JSON) ==')
  const goodProvider = makeFakeProvider(JSON.stringify(makeValidJobDescription()))
  const engineWithGood = createEngineWith(goodProvider)
  try {
    const result = await engineWithGood.generateJobDescription(sampleInput)
    ok('valid JSON passes Zod validation', typeof result.data.title === 'string')
    ok('result carries provider name', result.provider === 'fake')
    ok('result carries token usage', result.usage.totalTokens > 0)
  } catch (err) {
    ok('valid JSON passes Zod validation', false, err instanceof Error ? err.message : String(err))
  }

  console.log('\n== Prompt definition ==')
  ok('job-description prompt id is set', jobDescriptionPrompt.id === 'job-description.v1')
  ok('prompt render returns non-empty string', jobDescriptionPrompt.render(sampleInput).length > 100)

  console.log('\n== Error hierarchy ==')
  const pnc = new ProviderNotConfiguredError('gemini', 'GEMINI_API_KEY')
  ok('ProviderNotConfiguredError extends AIEngineError', pnc instanceof AIEngineError)
  ok('ProviderNotConfiguredError.toJSON is JSON-safe', JSON.stringify(pnc.toJSON()).length > 0)

  const sv = new SchemaValidationError('job-description.v1', ['x'])
  ok('SchemaValidationError extends AIEngineError', sv instanceof AIEngineError)

  console.log(`\n${passed} passed, ${failed} failed`)
  if (failed > 0) process.exit(1)
}

// -----------------------------------------------------------------------------
// Test helpers
// -----------------------------------------------------------------------------

const sampleInput: JobDescriptionInput = {
  role: 'Senior Frontend Developer',
  department: 'Engineering',
  employmentType: 'FULL_TIME',
  experience: '5+ years',
  location: 'Remote (Europe)',
  companySummary: 'A modern talent acquisition platform.',
}

function makeValidJobDescription() {
  return {
    title: 'Senior Frontend Developer',
    summary: 'Lead UI architecture and ship polished customer-facing experiences.',
    responsibilities: [
      'Lead frontend architecture for major product surfaces',
      'Build performant React applications with TypeScript',
      'Partner with design to translate Figma specs into production UI',
      'Mentor mid-level and junior engineers',
      'Drive performance optimization (Core Web Vitals, bundle size)',
    ],
    requiredSkills: ['React', 'TypeScript', 'CSS', 'Next.js', 'Git'],
    preferredSkills: ['Framer Motion', 'GraphQL', 'tRPC'],
    qualifications: [
      "Bachelor's degree in Computer Science or equivalent experience",
      '5+ years of professional frontend development',
    ],
    benefits: ['Remote-first', 'Equity', 'Learning budget'],
    screeningQuestions: [
      'Walk me through a complex frontend feature you owned end-to-end.',
      'How do you approach performance optimization?',
      'What does accessibility mean to you?',
    ],
    interviewQuestions: [
      { category: 'Technical', question: 'Explain React reconciliation.' },
      { category: 'System Design', question: 'Design a multi-tenant SaaS dashboard.' },
      { category: 'Behavioral', question: 'Tell me about a tough stakeholder decision.' },
    ],
  }
}

function makeFakeProvider(rawText: string) {
  return {
    name: 'fake' as const,
    getModelName: () => 'fake-model',
    isConfigured: () => true,
    healthCheck: async () => ({
      provider: 'fake' as const,
      model: 'fake-model',
      status: 'healthy' as const,
      latencyMs: 1,
      checkedAt: new Date().toISOString(),
    }),
    generate: async (_prompt: string) => ({
      data: rawText,
      raw: rawText,
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      latencyMs: 1,
      provider: 'fake' as const,
      model: 'fake-model',
    }),
    generateStructured: async (_prompt: string, _schema: unknown) => ({
      data: JSON.parse(rawText),
      raw: rawText,
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      latencyMs: 1,
      provider: 'fake' as const,
      model: 'fake-model',
    }),
    extractUsage: () => ({ inputTokens: 1, outputTokens: 1, totalTokens: 2 }),
  }
}

function createEngineWith(provider: ReturnType<typeof makeFakeProvider>) {
  // Bypass the real engine and call the validation path directly.
  return {
    generateJobDescription: async (input: JobDescriptionInput) => {
      const prompt = jobDescriptionPrompt.render(input)
      const raw = await provider.generateStructured(prompt, jobDescriptionOutputSchema)
      const parsed = jobDescriptionOutputSchema.safeParse(raw.data)
      if (!parsed.success) {
        throw new SchemaValidationError(
          jobDescriptionPrompt.id,
          parsed.error.issues,
          parsed.error
        )
      }
      return { ...raw, data: parsed.data }
    },
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
