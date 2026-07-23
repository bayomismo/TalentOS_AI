import 'dotenv/config'
import { db } from '../lib/db'
import { checkAiQuota, recordAiUsage } from '../lib/ai/quota'
import { randomUUID } from 'node:crypto'

async function main() {
  const orgId = randomUUID()
  await db.organization.create({
    data: { id: orgId, name: 'Debug Org', slug: `debug-${randomUUID().slice(0, 4)}`, onboardingStatus: 'COMPLETED', aiMonthlyQuota: 5 },
  })

  for (let i = 0; i < 4; i++) {
    await recordAiUsage({ organizationId: orgId, feature: 'job_description' })
  }
  
  const r = await checkAiQuota(orgId)
  console.log('After 4 uses, quota=5:', JSON.stringify(r, null, 2))
  
  await recordAiUsage({ organizationId: orgId, feature: 'job_description' })
  const r2 = await checkAiQuota(orgId)
  console.log('After 5 uses, quota=5:', JSON.stringify(r2, null, 2))

  await db.aIUsage.deleteMany({ where: { organizationId: orgId } })
  await db.organization.delete({ where: { id: orgId } })
}
main().catch(console.error)
