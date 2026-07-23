import 'dotenv/config'
import { db } from '../lib/db'

async function main() {
  const u = await db.user.findUnique({ where: { email: 'test+demo@gmail.com' } })
  if (u) {
    await db.user.delete({ where: { id: u.id } })
    await db.organization.delete({ where: { id: u.organizationId } })
    console.log('cleaned up')
  } else {
    console.log('not found')
  }
}
main().catch(console.error)
