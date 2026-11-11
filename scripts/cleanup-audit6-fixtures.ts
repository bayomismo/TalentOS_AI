import 'dotenv/config'
import { db } from '../lib/db'

/**
 * Removes the LEFTOVER fixtures of the audit-6 gate and its debug
 * scripts (organization slug / name starts with "audit6-" or "a6fix-").
 *
 * Aborted audit runs and debug scripts leak them, and the dev auth
 * fallback in lib/auth/authorize.ts picks the OLDEST active ADMIN — so
 * a leaked fixture admin makes every later audit run abort with
 * "the acting identity is not the fixture admin" or act against the
 * wrong tenant.
 *
 * Only rows whose organization slug/name starts with one of those tags
 * are touched. Production data is never in scope.
 */
const TAGS = ['audit6-', 'a6fix-']

async function main() {
  const orgs = await db.organization.findMany({
    where: { OR: TAGS.flatMap(tag => [{ slug: { startsWith: tag } }, { name: { startsWith: tag } }]) },
    select: { id: true, slug: true },
  })
  console.log('removing', orgs.length, 'audit fixture org(s):', orgs.map(o => o.slug).join(', '))
  for (const org of orgs) {
    await db.organization.delete({ where: { id: org.id } })
  }
  const counts = {
    orgs: await db.organization.count(),
    users: await db.user.count(),
    candidates: await db.candidate.count(),
    hiringRequests: await db.hiringRequest.count(),
    offers: await db.offer.count(),
  }
  console.log('row counts now:', JSON.stringify(counts))
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
