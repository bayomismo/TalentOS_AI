import { config as loadEnv } from 'dotenv'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'

loadEnv()
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) })
async function main() {
  const c = await db.candidate.findMany({ take: 3 })
  for (const x of c) console.log(x.id, x.firstName, x.lastName)
}
main().finally(() => db.$disconnect())
