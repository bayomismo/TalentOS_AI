import 'dotenv/config'
import { checkAiQuota } from '../lib/ai/quota'
import { db } from '../lib/db'

async function main() {
  const orgs = await db.organization.findMany({ take: 1, select: { id: true, aiMonthlyQuota: true } })
  console.log('orgs:', orgs)
  if (orgs.length > 0) {
    const r = await checkAiQuota(orgs[0].id)
    console.log('r:', r)
  }
}
main().catch(console.error)
