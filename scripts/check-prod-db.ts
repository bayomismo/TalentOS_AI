import { config as loadEnv } from 'dotenv'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'

loadEnv()
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) })
async function main() {
  const orgs = await db.organization.count()
  const hrs = await db.hiringRequest.count({ where: { status: 'OPEN' } })
  const cands = await db.candidate.count()
  const recent = await db.hiringRequest.findMany({ take: 3, orderBy: { createdAt: 'desc' } })
  console.log('orgs:', orgs, 'open HRs:', hrs, 'candidates:', cands)
  for (const h of recent) console.log('  -', h.id, h.slug, h.status)
}
main().finally(() => db.$disconnect())
