import { getAIEngine } from '../lib/ai/service/ai-engine'
import { z } from 'zod'

async function main() {
  const engine = getAIEngine()
  const result = await engine.callCopilotRouter(
    'You are an action argument extractor. Return JSON only with { "arguments": { "title": "..." } }',
    'Create a hiring request draft for a Senior Backend Engineer'
  )
  console.log('Type:', typeof result.data)
  console.log('Length:', (result.data as string).length)
  console.log('First 500:', (result.data as string).slice(0, 500))
}
main()
