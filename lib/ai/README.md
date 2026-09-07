# TalentOS AI Engine

Provider-agnostic AI layer powering every AI feature in TalentOS.

## Folder layout

```
lib/ai/
├── providers/
│   ├── base-provider.ts        # AIProvider interface
│   ├── gemini-provider.ts      # @google/genai implementation
│   └── provider-factory.ts     # Resolve the active provider
├── prompts/
│   ├── job-description.ts      # v1 — implemented
│   ├── cv-analysis.ts           # v0.1 — stub
│   ├── candidate-ranking.ts     # v0.1 — stub
│   ├── interview-kit.ts         # v0.1 — stub
│   └── offer-letter.ts          # v0.1 — stub
├── schemas/
│   ├── job-description.schema.ts
│   ├── cv-analysis.schema.ts
│   ├── candidate-ranking.schema.ts
│   └── interview-kit.schema.ts
├── service/
│   └── ai-engine.ts            # Public API: getAIEngine()
├── errors/
│   └── ai-engine-error.ts      # AIEngineError + 4 typed subclasses
└── types.ts                    # Provider-agnostic shared types
```

## Architectural principles

1. **Provider-agnostic core.** The engine only talks to the `AIProvider`
   interface. Today only `GeminiProvider` is implemented; tomorrow,
   `OpenAIProvider` / `AnthropicProvider` / `VertexProvider` plug in
   without changing a single line of business code.
2. **One source of truth for prompts.** Every prompt is a versioned
   `PromptDefinition<Input>` with a stable `id`, a schema description,
   and a pure `render()` function. No prompt ever lives inside a React
   component or an API route.
3. **Structured output only.** Every AI response is JSON. The Zod schema
   is the contract. If the provider returns anything that doesn't parse
   or doesn't match the schema, the engine retries **once**, then throws
   a typed `SchemaValidationError`.
4. **Typed errors, no `any`.** Every failure mode has a dedicated
   subclass of `AIEngineError`. Callers can `instanceof`-check and act
   on `code`, `provider`, and `retryable`.
5. **DI-friendly.** `AIEngine` accepts an optional `AIProvider` in its
   constructor so tests and alternative front-ends can swap in fakes.

## Public API

```ts
import { getAIEngine } from '@/lib/ai/service/ai-engine'

const engine = getAIEngine()

// Implemented
const { data, usage, latencyMs } = await engine.generateJobDescription({
  role: 'Senior Frontend Developer',
  department: 'Engineering',
  employmentType: 'FULL_TIME',
  experience: '5+ years',
  location: 'Remote (Europe)',
  companySummary: 'A modern talent acquisition platform.',
})

// Throws NotImplementedError — coming in a later sprint
await engine.analyzeCV(cvText)
await engine.rankCandidate(candidateId, hiringRequestId)
await engine.generateInterviewKit({ role, level, jobDescription })
await engine.generateOfferLetter({ candidateName, role, salary, startDate })
```

## Configuration

| Env var          | Required | Default              | Purpose                                |
| ---------------- | -------- | -------------------- | -------------------------------------- |
| `GEMINI_API_KEY` | yes      | —                    | Google AI Studio / Vertex AI key       |
| `GEMINI_MODEL`   | no       | `gemini-2.0-flash`   | Model identifier                       |
| `AI_PROVIDER`    | no       | `gemini`             | Resolved by `getAIProvider()` factory  |

When `GEMINI_API_KEY` is missing the engine stays in a graceful
`unconfigured` state — calls fail with `ProviderNotConfiguredError`, the
health endpoint returns 503 with `status: "unconfigured"`.

## Health endpoint

```
GET /api/health/ai
```

Returns:

```json
{
  "provider": "gemini",
  "model": "gemini-2.0-flash",
  "status": "healthy | degraded | unhealthy | unconfigured",
  "latencyMs": 123,
  "error": "...",
  "checkedAt": "2026-07-14T19:29:47.027Z"
}
```

HTTP status:
- `200` for `healthy` / `degraded`
- `503` for `unhealthy` / `unconfigured`

The endpoint never throws — every failure is encoded in the payload.

## Verification

```bash
pnpm exec prisma validate    # schema still valid
pnpm exec tsc --noEmit       # strict TypeScript, 0 errors
pnpm run build               # 13 routes, 0 warnings
pnpm exec tsx scripts/ai-smoke.ts   # 22 unit assertions pass
```

## Multi-tenancy

The AI engine is currently **single-tenant by design** (the underlying
provider is shared). When auth lands, the engine will gain an
`organizationId` parameter on every public method so usage can be
attributed, metered, and rate-limited per tenant.
