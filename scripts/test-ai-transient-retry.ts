/**
 * Regression test for transient AI provider failures.
 *
 * Background: Google's capacity layer answers `503 UNAVAILABLE — "This
 * model is currently experiencing high demand"` and `429
 * RESOURCE_EXHAUSTED` when a request lands while the pool is
 * saturated. Before this fix:
 *
 *   1. the Gemini provider wrapped every failure as
 *      `AIEngineError(..., { retryable: false })`, so a capacity spike
 *      looked identical to a bad API key;
 *   2. the engine threw any `AIEngineError` straight through, so a
 *      transient failure failed the user's CV upload or interview-kit
 *      generation on the very first attempt.
 *
 * The practical effect was that a healthy product failed outright
 * during a provider capacity spike — and the end-to-end hiring-flow
 * test could not reach its business assertions at all.
 *
 * This test locks down both halves: the classification of an upstream
 * failure, and the engine's willingness to retry it.
 */
import { isTransientProviderError } from '../lib/ai/providers/gemini-provider'
import { AIEngineError } from '../lib/ai/errors/ai-engine-error'

let pass = 0
let fail = 0
function ok(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) {
    pass++
    console.log(`  ✓ ${label}: ${a}`)
  } else {
    fail++
    console.log(`  ✗ ${label}: got ${a}, expected ${e}`)
  }
}

console.log('=== transient provider failure test ===\n')
console.log('── 1. Classification ──')

// The exact shape the `@google/genai` client throws for a capacity spike:
// a non-Error object carrying `status`, with the JSON body in `message`.
const capacity503 = {
  status: 503,
  message: JSON.stringify({
    error: {
      code: 503,
      message: 'This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.',
      status: 'UNAVAILABLE',
    },
  }),
}
ok('503 capacity spike is transient', isTransientProviderError(capacity503), true)
ok('429 rate limit is transient', isTransientProviderError({ status: 429, message: 'RESOURCE_EXHAUSTED' }), true)
ok('500 internal error is transient', isTransientProviderError({ status: 500, message: 'Internal' }), true)
ok('502 bad gateway is transient', isTransientProviderError({ status: 502, message: 'Bad Gateway' }), true)
ok('504 gateway timeout is transient', isTransientProviderError({ status: 504, message: 'Gateway Timeout' }), true)
ok('408 request timeout is transient', isTransientProviderError({ status: 408, message: 'Request Timeout' }), true)

// A quota error is NOT transient: retrying it only burns quota.
ok('403 permission/quota is NOT transient', isTransientProviderError({ status: 403, message: 'Permission denied' }), false)
// A malformed request is NOT transient.
ok('400 bad request is NOT transient', isTransientProviderError({ status: 400, message: 'Invalid argument' }), false)
// A bad key is NOT transient.
ok('401 unauthorized is NOT transient', isTransientProviderError({ status: 401, message: 'API key not valid' }), false)

// The status can also arrive only inside the message body.
const statusInMessageOnly = new Error(
  '{"error":{"code":503,"message":"high demand","status":"UNAVAILABLE"}}'
)
ok('status embedded in the message is found', isTransientProviderError(statusInMessageOnly), true)

// A plain error with no status at all is not transient — we cannot know.
ok('error with no status is NOT transient', isTransientProviderError(new Error('boom')), false)
ok('undefined is NOT transient', isTransientProviderError(undefined), false)

console.log('\n── 2. The engine retries a transient failure ──')

// A fake provider that fails transiently twice and then succeeds.
class FlakyProvider {
  attempts = 0
  readonly name = 'flaky'
  async generateStructured() {
    this.attempts++
    if (this.attempts < 3) {
      throw new AIEngineError('PROVIDER_REQUEST_FAILED', 'capacity spike', {
        provider: 'flaky',
        retryable: true,
      })
    }
    // A payload that satisfies `cvAnalysisOutputSchema`, so the test
    // proves the call *completed*, not just that it stopped retrying.
    return {
      data: {
        fullName: 'Ada Lovelace',
        email: 'ada@example.com',
        currentTitle: 'Senior Backend Engineer',
        yearsExperience: 10,
        summary:
          'Backend engineer with a decade of experience building distributed systems and payments infrastructure.',
        topSkills: ['TypeScript', 'PostgreSQL'],
        workExperience: [],
        education: [],
        certifications: [],
        strengths: ['Systems thinking'],
        concerns: [],
        recommendedStage: 'SCREENING',
      },
      raw: '{}',
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    }
  }
  async generate() {
    return { data: '{}', raw: '{}', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } }
  }
  async healthCheck() {
    return { provider: 'flaky', status: 'healthy' as const }
  }
}

async function main() {
// The engine is constructed with a provider; we drive it through the
// public entry point so the test exercises the real retry loop.
const { AIEngine } = await import('../lib/ai/service/ai-engine')
const flaky = new FlakyProvider()
const engine = new AIEngine(flaky as never)

const started = Date.now()
let result: unknown = null
let caught: unknown = null
try {
  result = await (engine as never as { analyzeCV: (i: unknown) => Promise<unknown> }).analyzeCV({
    fullName: 'Ada Lovelace',
    email: 'ada@example.com',
    cvText: 'Engineer with ten years of experience in distributed systems.',
    jobDescription: 'Senior Backend Engineer',
  })
} catch (err) {
  caught = err
}
const elapsed = Date.now() - started

ok('the call eventually succeeded', result !== null, true)
ok('it took 3 attempts', flaky.attempts, 3)
ok('it waited between the retries (>= 4s of backoff)', elapsed >= 4_000, true)
ok('nothing was thrown', caught, null)

console.log(`\n========== ${pass} pass, ${fail} fail ==========`)
if (fail > 0) process.exit(1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
