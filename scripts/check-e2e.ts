import { db } from '../lib/db'

async function main() {
  const c = await db.candidate.findFirst({
    where: { firstName: 'E2E', lastName: 'Test' },
    include: { activities: true },
  })
  console.log('Found E2E candidate:', c ? c.id : 'NOT FOUND')
  if (c) {
    console.log('  source:', c.source)
    console.log('  sourceDetails:', c.sourceDetails)
    console.log('  stage:', c.stage)
    console.log('  activities:', c.activities.length)
    if (c.activities.length > 0) {
      console.log('  activity type:', c.activities[0].type)
      console.log('  activity title:', c.activities[0].title)
    }
    await db.activity.deleteMany({ where: { candidateId: c.id } })
    await db.candidate.delete({ where: { id: c.id } })
    console.log('  (cleaned up)')
  }
}
main().catch(console.error)
