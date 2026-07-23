import 'dotenv/config'
import { db } from '../lib/db'
import { checkAiQuota, recordAiUsage } from '../lib/ai/quota'
import { randomUUID } from 'node:crypto'

async function main() {
  const orgId = randomUUID()
  await db.organization.create({
    data: { id: orgId, name: 'Test Org 2', slug: `test2-${randomUUID().slice(0, 4)}`, onboardingStatus: 'COMPLETED' },
  })
  await db.organization.update({ where: { id: orgId }, data: { aiMonthlyQuota: 5 } })

  // Sequential with delays
  for (let i = 0; i < 4; i++) {
    await recordAiUsage({ organizationId: orgId, feature: 'job_description' })
  }
  
  // Direct count
  const directCount = await db.aIUsage.count({ where: { organizationId: orgId, success: true } })
  console.log('Direct count:', directCount)
  
  const r = await checkAiQuota(orgId)
  console.log('checkAiQuota:', { allowed: r.allowed, used: r.used, percent: r.percent, warning: r.warning })

  // Cleanup
  await db.aIUsage.deleteMany({ where: { organizationId: orgId } })
  await db.organization.delete({ where: { id: orgId } })
}
main().catch(console.error)
