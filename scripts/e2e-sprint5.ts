/**
 * End-to-end smoke test for Sprint 5.
 *
 * 1. Generate a job description via the AI engine.
 * 2. Persist a HiringRequest + JobDescription + Activity via Prisma.
 * 3. Verify the DB row was created.
 * 4. Verify the event-bus payload schema is correct.
 */

import { config as loadEnv } from 'dotenv'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'

import { getAIEngine } from '@/lib/ai/service/ai-engine'
import { getEventBus, _resetEventBus } from '@/lib/events'

loadEnv()

// We need a DB client for the script. The shared `db` singleton is fine,
// but we also need to ensure env is loaded before the singleton is touched.
const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
})

loadEnv()

async function main() {
  let pass = 0
  let fail = 0
  function ok(name: string, cond: boolean, detail?: string) {
    if (cond) {
      console.log(`  ✓ ${name}`)
      pass++
    } else {
      console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`)
      fail++
    }
  }

  console.log('\n== Step 1: AI engine generateJobDescription ==')
  const engine = getAIEngine()
  const health = await engine.health()
  ok('engine healthy', health.status === 'healthy', JSON.stringify(health))

  const started = Date.now()
  const result = await engine.generateJobDescription({
    role: 'Senior Frontend Developer',
    department: 'Engineering',
    employmentType: 'FULL_TIME',
    experience: '5+ years',
    location: 'Remote (Europe)',
    companySummary: 'A modern talent acquisition platform.',
  })
  const elapsed = Date.now() - started
  console.log(`  · generation took ${elapsed}ms · ${result.usage.inputTokens} in / ${result.usage.outputTokens} out`)

  ok('title is set', typeof result.data.title === 'string' && result.data.title.length > 0)
  ok('summary is set', typeof result.data.summary === 'string' && result.data.summary.length > 20)
  ok('responsibilities >= 3', result.data.responsibilities.length >= 3)
  ok('required skills >= 3', result.data.requiredSkills.length >= 3)
  ok('qualifications >= 2', result.data.qualifications.length >= 2)
  ok('screening questions >= 3', result.data.screeningQuestions.length >= 3)
  ok('interview questions >= 3', result.data.interviewQuestions.length >= 3)

  console.log('\n== Step 2: Persist HiringRequest + JobDescription + Activity ==')
  const orgId = (await db.organization.findFirst({ select: { id: true } }))!.id
  const actor = (await db.user.findFirst({ where: { organizationId: orgId, role: 'ADMIN' } }))!
  const department = (await db.department.findFirst({ where: { organizationId: orgId, slug: 'engineering' } }))!

  // Job description
  const jd = await db.jobDescription.create({
    data: {
      organizationId: orgId,
      title: result.data.title,
      isTemplate: false,
      level: 'SENIOR',
      jobType: 'FULL_TIME',
      summary: result.data.summary,
      description: result.data.summary,
      responsibilities: result.data.responsibilities,
      requiredSkills: result.data.requiredSkills,
      niceToHave: result.data.preferredSkills,
      perks: result.data.benefits,
    },
  })
  ok('JobDescription row created', !!jd.id)

  // AI task
  const aiTask = await db.aITask.create({
    data: {
      organizationId: orgId,
      type: 'JOB_DESCRIPTION',
      title: `Job description — ${result.data.title}`,
      status: 'COMPLETED',
      prompt: 'Senior Frontend Developer',
      result: result.data as object,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      modelUsed: result.model,
      durationMs: result.latencyMs,
      startedAt: new Date(Date.now() - result.latencyMs),
      completedAt: new Date(),
      createdById: actor.id,
      jobDescriptionId: jd.id,
    },
  })
  ok('AITask row created', !!aiTask.id)

  // Hiring request
  const slug = `e2e-test-${Date.now()}`
  const hr = await db.hiringRequest.create({
    data: {
      organizationId: orgId,
      departmentId: department.id,
      createdById: actor.id,
      hiringManagerId: actor.id,
      jobDescriptionId: jd.id,
      title: result.data.title,
      slug,
      status: 'OPEN',
      priority: 'MEDIUM',
      jobType: 'FULL_TIME',
      workArrangement: 'HYBRID',
      level: 'SENIOR',
      openings: 1,
      filled: 0,
      location: 'Remote (Europe)',
      summary: result.data.summary,
      publishedAt: new Date(),
    },
  })
  ok('HiringRequest row created', !!hr.id)
  ok('HiringRequest.status is OPEN', hr.status === 'OPEN')
  ok('HiringRequest has jobDescription link', hr.jobDescriptionId === jd.id)

  // Activity
  const activity = await db.activity.create({
    data: {
      organizationId: orgId,
      type: 'HIRING_REQUEST_CREATED',
      actorId: actor.id,
      hiringRequestId: hr.id,
      title: `New hiring request — ${hr.title}`,
      description: `Created via AI Recruiter E2E test.`,
    },
  })
  ok('Activity row created', !!activity.id)

  // Update AITask with hiringRequestId
  await db.aITask.update({
    where: { id: aiTask.id },
    data: { hiringRequestId: hr.id },
  })
  const updated = await db.aITask.findUnique({ where: { id: aiTask.id } })
  ok('AITask.hiringRequestId linked', updated?.hiringRequestId === hr.id)

  console.log('\n== Step 3: Event bus ==')
  _resetEventBus()
  const bus = getEventBus()

  const received: string[] = []
  bus.subscribe('HiringRequestCreated', () => received.push('HiringRequestCreated'))
  bus.subscribe('ActivityRecorded', () => received.push('ActivityRecorded'))
  bus.subscribe('AITaskCompleted', () => received.push('AITaskCompleted'))

  bus.publish({
    type: 'HiringRequestCreated',
    payload: {
      hiringRequest: {
        id: hr.id,
        title: hr.title,
        status: hr.status as never,
        priority: hr.priority as never,
        department: department.name,
        openings: hr.openings,
        filled: hr.filled,
        location: hr.location,
        jobType: hr.jobType as never,
        workArrangement: hr.workArrangement as never,
        level: hr.level as never,
        salaryMin: null,
        salaryMax: null,
        createdAt: hr.createdAt.toISOString(),
        hiringManagerName: `${actor.firstName} ${actor.lastName}`,
        jobDescriptionSummary: jd.summary,
      },
      jobDescription: {
        id: jd.id,
        title: jd.title,
        summary: jd.summary,
        responsibilities: jd.responsibilities,
        requiredSkills: jd.requiredSkills,
        preferredSkills: jd.niceToHave,
        qualifications: [],
        benefits: jd.perks,
        screeningQuestions: [],
        interviewQuestions: [],
      },
      activity: {
        id: activity.id,
        type: activity.type,
        title: activity.title,
        description: activity.description,
        actorName: `${actor.firstName} ${actor.lastName}`,
        candidateName: null,
        occurredAt: activity.occurredAt.toISOString(),
      },
      aiTask: {
        id: aiTask.id,
        type: aiTask.type,
        title: aiTask.title,
        status: aiTask.status,
        completedAt: aiTask.completedAt?.toISOString() ?? null,
      },
    },
  })
  bus.publish({ type: 'ActivityRecorded', payload: { activity: { id: activity.id, type: activity.type, title: activity.title, description: activity.description, actorName: `${actor.firstName} ${actor.lastName}`, candidateName: null, occurredAt: activity.occurredAt.toISOString() } } })
  bus.publish({ type: 'AITaskCompleted', payload: { aiTask: { id: aiTask.id, type: aiTask.type, title: aiTask.title, status: aiTask.status, completedAt: aiTask.completedAt?.toISOString() ?? null } } })

  ok('HiringRequestCreated received', received.includes('HiringRequestCreated'))
  ok('ActivityRecorded received', received.includes('ActivityRecorded'))
  ok('AITaskCompleted received', received.includes('AITaskCompleted'))

  console.log('\n== Step 4: Dashboard data action ==')
  const org = await db.organization.findFirst({ select: { id: true } })
  const positions = await db.hiringRequest.findMany({ where: { organizationId: org!.id } })
  ok('Dashboard can read new hiring request', positions.some(p => p.id === hr.id))

  console.log(`\n${pass} passed, ${fail} failed`)
  if (fail > 0) process.exit(1)
}

main()
  .catch(err => {
    console.error('E2E failed:', err)
    process.exit(1)
  })
  .finally(async () => {
    await db.$disconnect()
  })
