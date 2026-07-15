import { db } from '../lib/db'
async function main() {
  const logs = await db.auditLog.findMany({
    where: { action: 'COPILOT_ACTION_FAILED' },
    orderBy: { occurredAt: 'desc' },
    take: 3,
  })
  for (const log of logs) {
    console.log('Reason:', log.reason)
    console.log('Metadata:', JSON.stringify(log.metadata, null, 2).slice(0, 1500))
    console.log('---')
  }
  await db.$disconnect()
}
main()
