import { getActionById } from '../lib/copilot/actions/registry'
import { describeInputShape } from '../lib/copilot/orchestration/orchestrator'
const action = getActionById('CREATE_HIRING_REQUEST_DRAFT')!
if (!action) throw new Error('action not found')
const desc = describeInputShape(action.inputSchema)
console.log('Input shape length:', desc.length)
console.log('Input shape:', desc)
