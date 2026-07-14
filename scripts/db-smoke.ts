// Quick smoke test that the Prisma client can read the seeded data.
import { config as loadEnv } from 'dotenv'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'

loadEnv()

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
})

async function main() {
  const orgs = await prisma.organization.findMany({
    include: {
      departments: true,
      users: { select: { firstName: true, lastName: true, role: true } },
      hiringRequests: { select: { title: true, status: true, openings: true } },
    },
  })

  for (const org of orgs) {
    console.log(`Org: ${org.name} (${org.slug})`)
    console.log(`  Departments: ${org.departments.length}`)
    console.log(`  Users: ${org.users.length}`)
    console.log(`  Hiring requests: ${org.hiringRequests.length}`)
    console.log()

    const candidates = await prisma.candidate.findMany({
      where: { organizationId: org.id },
      include: {
        _count: {
          select: {
            skills: true,
            experiences: true,
            educations: true,
            interviews: true,
          },
        },
      },
    })
    console.log(`  Candidates: ${candidates.length}`)
    for (const c of candidates.slice(0, 3)) {
      console.log(`    · ${c.firstName} ${c.lastName} (${c.stage}) — skills:${c._count.skills} exp:${c._count.experiences} edu:${c._count.educations}`)
    }

    const aiTasks = await prisma.aITask.findMany({
      where: { organizationId: org.id },
      include: { _count: { select: { conversations: true } } },
    })
    console.log(`  AI tasks: ${aiTasks.length}`)
    for (const t of aiTasks) {
      console.log(`    · ${t.title} [${t.status}] — ${t._count.conversations} turns`)
    }
  }
}

main()
  .catch(err => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
