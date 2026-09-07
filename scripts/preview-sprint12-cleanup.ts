/**
 * Sprint 12 — Preview & execute production data cleanup.
 *
 * Run with:
 *   PROD_ADMIN_EMAIL=... PROD_ADMIN_PASSWORD=... npx tsx scripts/preview-sprint12-cleanup.ts
 *   PROD_ADMIN_EMAIL=... PROD_ADMIN_PASSWORD=... npx tsx scripts/preview-sprint12-cleanup.ts --execute
 */

import { db } from '../lib/db'
import { previewDataManagement, executeDataCleanup } from '../features/data-management/service'

async function main() {
  const args = process.argv.slice(2)
  const isExecute = args.includes('--execute')
  if (isExecute) {
    console.log('=== EXECUTE MODE ===')
  } else {
    console.log('=== PREVIEW MODE (dry run, no changes) ===')
  }
  const db = (await import('../lib/db')).db
  const org = await db.organization.findFirst({ where: { slug: 'acme-talent' } })
  if (!org) {
    console.error('Acme Talent org not found')
    process.exit(1)
  }
  const admin = await db.user.findFirst({ where: { organizationId: org.id, role: 'ADMIN', status: 'ACTIVE' } })
  if (!admin) {
    console.error('Active ADMIN not found')
    process.exit(1)
  }
  const ctx = { organizationId: org.id, userId: admin.id, role: 'ADMIN' as any }
  console.log(`Using org: ${org.name} (${org.id})`)
  console.log(`Using admin: ${admin.email} (${admin.id})`)

  const preview = await previewDataManagement(ctx)
  if (!preview.ok) {
    console.error('Preview failed:', preview.error)
    process.exit(1)
  }
  console.log('\n=== PREVIEW ===')
  console.log(JSON.stringify(preview.data, null, 2))

  if (isExecute) {
    console.log('\n=== EXECUTING ===')
    const result = await executeDataCleanup(ctx, 'CLEAN DEMO DATA')
    if (!result.ok) {
      console.error('Cleanup failed:', result.error)
      process.exit(1)
    }
    console.log(JSON.stringify(result.data, null, 2))
  }
  await db.$disconnect()
}

main().catch(e => { console.error(e); process.exit(1) })
