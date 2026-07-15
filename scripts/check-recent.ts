import 'dotenv/config'
import { db } from '../lib/db'

async function main() {
  const recent = await db.hiringRequest.findMany({
    orderBy: { createdAt: 'desc' },
    take: 5,
    select: {
      id: true,
      title: true,
      status: true,
      createdAt: true,
      organizationId: true,
    },
  })
  for (const r of recent) {
    console.log(r.createdAt.toISOString(), '·', r.title, '·', r.status, '·', r.id.slice(0, 8))
  }
  await db.$disconnect()
}
main()
