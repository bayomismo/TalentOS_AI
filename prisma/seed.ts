/**
 * TalentOS — Database seed script
 *
 * Idempotent: clears the existing data and inserts a fresh demo dataset
 * that's realistic enough to drive every screen in the UI.
 *
 * Run with:
 *   pnpm exec prisma migrate reset
 *   # or directly:
 *   pnpm exec tsx prisma/seed.ts
 */

import {
  Prisma,
  PrismaClient,
  ApplicationStage,
  AITaskStatus,
  AITaskType,
  ActivityType,
  AIConversationRole,
  CandidateStatus,
  DegreeType,
  EmploymentStatus,
  EvaluationRecommendation,
  HiringRequestStatus,
  InterviewStatus,
  InterviewType,
  JobLevel,
  JobType,
  OfferStatus,
  Priority,
  PromptTemplateCategory,
  QuestionDifficulty,
  QuestionType,
  SalaryCurrency,
  SkillLevel,
  UserRole,
  WorkArrangement,
} from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { config as loadEnv } from 'dotenv'

loadEnv()

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  throw new Error('DATABASE_URL is not set')
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
  log: ['error', 'warn'],
})

// -----------------------------------------------------------------------------
// Utilities
// -----------------------------------------------------------------------------

const daysAgo = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000)
const daysFromNow = (days: number) => new Date(Date.now() + days * 24 * 60 * 60 * 1000)

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)] as T
}

function pickMany<T>(arr: readonly T[], count: number): T[] {
  const copy = [...arr]
  const out: T[] = []
  for (let i = 0; i < count && copy.length > 0; i++) {
    const idx = Math.floor(Math.random() * copy.length)
    out.push(copy.splice(idx, 1)[0] as T)
  }
  return out
}

// -----------------------------------------------------------------------------
// Reference data
// -----------------------------------------------------------------------------

const SKILL_LIBRARY = [
  'React',
  'TypeScript',
  'JavaScript',
  'Next.js',
  'Node.js',
  'Python',
  'Go',
  'Rust',
  'GraphQL',
  'PostgreSQL',
  'Redis',
  'AWS',
  'GCP',
  'Kubernetes',
  'Docker',
  'Terraform',
  'CI/CD',
  'System Design',
  'Figma',
  'Design Systems',
  'User Research',
  'Prototyping',
  'Product Strategy',
  'SQL',
  'Tableau',
  'A/B Testing',
  'Coaching',
  'Hiring',
] as const

const COMPANIES = [
  'Stripe',
  'Shopify',
  'Vercel',
  'Linear',
  'Notion',
  'Figma',
  'Datadog',
  'Cloudflare',
  'Anthropic',
  'OpenAI',
  'GitHub',
  'Atlassian',
  'Spotify',
  'Airbnb',
  'Adobe',
  'Webflow',
  'Zapier',
  'Calendly',
] as const

const UNIVERSITIES = [
  'Stanford University',
  'MIT',
  'UC Berkeley',
  'Carnegie Mellon University',
  'ETH Zurich',
  'University of Cambridge',
  'Imperial College London',
  'Universidad Politécnica de Madrid',
  'University of Toronto',
  'IIT Bombay',
] as const

const FIELDS = [
  'Computer Science',
  'Software Engineering',
  'Mathematics',
  'Statistics',
  'Data Science',
  'Design',
  'Human-Computer Interaction',
  'Business Administration',
  'Electrical Engineering',
] as const

const PROMPT_TEMPLATES: {
  name: string
  description: string
  category: PromptTemplateCategory
  body: string
  variables: string[]
}[] = [
  {
    name: 'Job Description Generator',
    description: 'Generate a complete job description from a role and team context.',
    category: PromptTemplateCategory.JOB_DESCRIPTION,
    body: `You are a recruiting copywriter. Write a complete job description for the following role.

Role: {{role}}
Department: {{department}}
Level: {{level}}
Team context: {{team_context}}

Include: summary, responsibilities (6–8 bullets), required skills, nice-to-have, and perks.`,
    variables: ['role', 'department', 'level', 'team_context'],
  },
  {
    name: 'Recruiter Phone Screen',
    description: 'Generate screening questions for a 30-minute recruiter call.',
    category: PromptTemplateCategory.SCREENING,
    body: `Generate 6–8 screening questions for a 30-minute recruiter phone screen.

Role: {{role}}
Key requirements: {{requirements}}
What to validate: motivation, comms, baseline technical signal, comp expectations, notice period.`,
    variables: ['role', 'requirements'],
  },
  {
    name: 'Structured Interview Kit',
    description: 'Build a structured interview question set across categories.',
    category: PromptTemplateCategory.INTERVIEW,
    body: `Create a structured interview kit for a {{role}} role with 4 categories:
1. Technical deep dive
2. System design
3. Behavioral / leadership
4. Culture & values

Each category: 3 questions with difficulty EASY/MEDIUM/HARD.`,
    variables: ['role'],
  },
  {
    name: 'Scorecard Generator',
    description: 'Build a weighted scorecard aligned to a job description.',
    category: PromptTemplateCategory.EVALUATION,
    body: `Build a weighted scorecard (total 100%) for a {{role}} role.

Include 5–7 evaluation criteria with weights and 3 measurable indicators each.`,
    variables: ['role'],
  },
  {
    name: 'Candidate Outreach',
    description: 'Personalized outreach for passive candidates.',
    category: PromptTemplateCategory.OUTREACH,
    body: `Write a 3-paragraph outreach email to a passive candidate.

Role: {{role}}
Candidate background: {{background}}
Hot buttons to highlight: growth, mission, comp range, remote policy.`,
    variables: ['role', 'background'],
  },
]

// -----------------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------------

async function main() {
  console.log('🌱 Seeding TalentOS database…')

  // 1. Wipe existing data in dependency order
  console.log('  · clearing existing data')
  await prisma.aIConversation.deleteMany()
  await prisma.aITask.deleteMany()
  await prisma.promptTemplate.deleteMany()
  await prisma.activity.deleteMany()
  await prisma.interviewEvaluation.deleteMany()
  await prisma.interviewQuestion.deleteMany()
  await prisma.interviewParticipant.deleteMany()
  await prisma.interview.deleteMany()
  await prisma.offer.deleteMany()
  await prisma.cVFile.deleteMany()
  await prisma.candidateCertification.deleteMany()
  await prisma.candidateEducation.deleteMany()
  await prisma.candidateExperience.deleteMany()
  await prisma.candidateSkill.deleteMany()
  await prisma.candidate.deleteMany()
  await prisma.hiringRequest.deleteMany()
  await prisma.jobDescription.deleteMany()
  await prisma.user.deleteMany()
  await prisma.department.deleteMany()
  await prisma.organization.deleteMany()

  // 2. Organization
  console.log('  · organization')
  const org = await prisma.organization.create({
    data: {
      name: 'Acme Talent Co.',
      slug: 'acme-talent',
      domain: 'acmecompany.com',
      website: 'https://acmecompany.com',
      industry: 'SaaS · B2B',
      size: '50–200',
      description:
        'A modern talent acquisition platform that helps companies hire better, faster, and fairer.',
    },
  })

  // 3. Departments
  console.log('  · departments')
  const deptData = [
    { name: 'Engineering', slug: 'engineering', description: 'Product and platform engineering.' },
    { name: 'Product', slug: 'product', description: 'Product management and operations.' },
    { name: 'Design', slug: 'design', description: 'Product design and design systems.' },
    { name: 'Data', slug: 'data', description: 'Data science, analytics, and ML.' },
    { name: 'People', slug: 'people', description: 'People operations and talent.' },
  ] as const

  const departments = await Promise.all(
    deptData.map(d =>
      prisma.department.create({
        data: {
          organizationId: org.id,
          name: d.name,
          slug: d.slug,
          description: d.description,
        },
      })
    )
  )
  const deptByName = Object.fromEntries(departments.map(d => [d.name, d]))

  // 4. Users
  console.log('  · users')
  const userData: {
    firstName: string
    lastName: string
    email: string
    role: UserRole
    departmentName: string
    jobTitle: string
  }[] = [
    { firstName: 'Jordan', lastName: 'Rivera', email: 'jordan.rivera@acmecompany.com', role: UserRole.ADMIN, departmentName: 'People', jobTitle: 'Head of Talent' },
    { firstName: 'Priya', lastName: 'Patel', email: 'priya.patel@acmecompany.com', role: UserRole.RECRUITER, departmentName: 'People', jobTitle: 'Senior Recruiter' },
    { firstName: 'Marcus', lastName: 'Chen', email: 'marcus.chen@acmecompany.com', role: UserRole.HIRING_MANAGER, departmentName: 'Engineering', jobTitle: 'Engineering Manager' },
    { firstName: 'Elena', lastName: 'Rodriguez', email: 'elena.rodriguez@acmecompany.com', role: UserRole.HIRING_MANAGER, departmentName: 'Product', jobTitle: 'Director of Product' },
    { firstName: 'Aiden', lastName: 'Park', email: 'aiden.park@acmecompany.com', role: UserRole.INTERVIEWER, departmentName: 'Engineering', jobTitle: 'Staff Engineer' },
    { firstName: 'Sofia', lastName: 'Martins', email: 'sofia.martins@acmecompany.com', role: UserRole.INTERVIEWER, departmentName: 'Design', jobTitle: 'Principal Designer' },
    { firstName: 'Daniel', lastName: 'Okafor', email: 'daniel.okafor@acmecompany.com', role: UserRole.RECRUITER, departmentName: 'People', jobTitle: 'Talent Partner' },
  ]

  const users = await Promise.all(
    userData.map(u =>
      prisma.user.create({
        data: {
          organizationId: org.id,
          departmentId: deptByName[u.departmentName]!.id,
          email: u.email,
          firstName: u.firstName,
          lastName: u.lastName,
          role: u.role,
          jobTitle: u.jobTitle,
          status: EmploymentStatus.ACTIVE,
          phone: '+34 600 000 000',
          location: 'Madrid, Spain',
          timezone: 'Europe/Madrid',
          emailVerified: daysAgo(30),
          lastLoginAt: daysAgo(1),
        },
      })
    )
  )
  const userByEmail = Object.fromEntries(users.map(u => [u.email, u]))
  const jordan = userByEmail['jordan.rivera@acmecompany.com']!
  const priya = userByEmail['priya.patel@acmecompany.com']!
  const marcus = userByEmail['marcus.chen@acmecompany.com']!
  const elena = userByEmail['elena.rodriguez@acmecompany.com']!
  const aiden = userByEmail['aiden.park@acmecompany.com']!
  const sofia = userByEmail['sofia.martins@acmecompany.com']!

  // Set department heads
  await prisma.department.update({
    where: { id: deptByName['Engineering']!.id },
    data: { headUserId: marcus.id },
  })
  await prisma.department.update({
    where: { id: deptByName['Product']!.id },
    data: { headUserId: elena.id },
  })
  await prisma.department.update({
    where: { id: deptByName['People']!.id },
    data: { headUserId: jordan.id },
  })

  // 5. Job Descriptions (templates + role-specific)
  console.log('  · job descriptions')
  const jdTemplates: { title: string; level: JobLevel; jobType: JobType; description: string; responsibilities: string[]; required: string[]; nice: string[]; perks: string[]; isTemplate: boolean }[] = [
    {
      title: 'Senior Frontend Developer',
      level: JobLevel.SENIOR,
      jobType: JobType.FULL_TIME,
      description:
        "We're looking for a Senior Frontend Developer to lead UI architecture, mentor engineers, and ship polished customer-facing experiences.",
      responsibilities: [
        'Lead frontend architecture for major product surfaces',
        'Build performant, accessible React applications with TypeScript',
        'Partner with design to translate Figma specs into production UI',
        'Establish frontend best practices and code review standards',
        'Mentor mid-level and junior engineers',
        'Drive performance optimization (Core Web Vitals, bundle size)',
      ],
      required: ['React', 'TypeScript', 'CSS', 'Next.js', 'Git'],
      nice: ['Framer Motion', 'Design Systems', 'GraphQL', 'tRPC'],
      perks: ['Remote-first', 'Equity', 'Learning budget', 'Top-tier hardware'],
      isTemplate: true,
    },
    {
      title: 'Backend Engineer',
      level: JobLevel.MID,
      jobType: JobType.FULL_TIME,
      description:
        'Build resilient APIs, services, and data pipelines that power the TalentOS platform for thousands of customers.',
      responsibilities: [
        'Design and ship backend services in Node.js / TypeScript',
        'Own data models, migrations, and query performance in PostgreSQL',
        'Build and maintain CI/CD pipelines and observability tooling',
        'Collaborate with frontend and product on API contracts',
      ],
      required: ['Node.js', 'PostgreSQL', 'AWS', 'Git'],
      nice: ['Kubernetes', 'GraphQL', 'Terraform'],
      perks: ['Remote-first', 'Equity', 'Conference budget'],
      isTemplate: true,
    },
    {
      title: 'Product Manager — Growth',
      level: JobLevel.SENIOR,
      jobType: JobType.FULL_TIME,
      description: 'Own activation, conversion, and retention experiments end-to-end.',
      responsibilities: [
        'Run continuous A/B experiments across the funnel',
        'Partner with engineering and design to ship growth surfaces',
        'Define success metrics and own the growth dashboard',
      ],
      required: ['Product Strategy', 'SQL', 'Analytics', 'Experimentation'],
      nice: ['Mixpanel', 'Amplitude', 'Customer interviews'],
      perks: ['Remote-first', 'Equity', 'Coaching budget'],
      isTemplate: true,
    },
    {
      title: 'Senior Product Designer',
      level: JobLevel.SENIOR,
      jobType: JobType.FULL_TIME,
      description: 'Shape end-to-end experiences and evolve the TalentOS design system.',
      responsibilities: [
        'Lead design for major product surfaces',
        'Maintain and evolve the design system',
        'Run customer research and usability testing',
      ],
      required: ['Figma', 'Design Systems', 'Prototyping', 'User Research'],
      nice: ['Motion design', 'Code (React)'],
      perks: ['Remote-first', 'Top-tier hardware', 'Conference budget'],
      isTemplate: true,
    },
    {
      title: 'Data Scientist',
      level: JobLevel.MID,
      jobType: JobType.FULL_TIME,
      description: 'Partner with product to build models that surface hiring insights and predict outcomes.',
      responsibilities: [
        'Build and validate predictive models',
        'Partner with product to design experiments',
        'Produce insights that shape product direction',
      ],
      required: ['Python', 'SQL', 'Statistics', 'Experimentation'],
      nice: ['PyTorch', 'dbt', 'Snowflake'],
      perks: ['Remote-first', 'Learning budget'],
      isTemplate: true,
    },
  ]

  const jobDescriptions = await Promise.all(
    jdTemplates.map(jd =>
      prisma.jobDescription.create({
        data: {
          organizationId: org.id,
          title: jd.title,
          isTemplate: jd.isTemplate,
          level: jd.level,
          jobType: jd.jobType,
          summary: jd.description.slice(0, 200),
          description: jd.description,
          responsibilities: jd.responsibilities,
          requiredSkills: jd.required,
          niceToHave: jd.nice,
          perks: jd.perks,
        },
      })
    )
  )

  // 6. Hiring Requests
  console.log('  · hiring requests')
  const hrConfigs: {
    title: string
    jdIndex: number
    departmentName: keyof typeof deptByName
    hiringManagerEmail: string
    status: HiringRequestStatus
    openings: number
    filled: number
    priority: Priority
    workArrangement: WorkArrangement
    location: string
    salaryMin: number
    salaryMax: number
    publishedAt: Date | null
    closingDate: Date | null
  }[] = [
    {
      title: 'Senior Software Engineer',
      jdIndex: 0,
      departmentName: 'Engineering',
      hiringManagerEmail: 'marcus.chen@acmecompany.com',
      status: HiringRequestStatus.OPEN,
      openings: 3,
      filled: 1,
      priority: Priority.HIGH,
      workArrangement: WorkArrangement.REMOTE,
      location: 'Remote (Europe)',
      salaryMin: 110000,
      salaryMax: 145000,
      publishedAt: daysAgo(45),
      closingDate: daysFromNow(30),
    },
    {
      title: 'Product Manager',
      jdIndex: 2,
      departmentName: 'Product',
      hiringManagerEmail: 'elena.rodriguez@acmecompany.com',
      status: HiringRequestStatus.OPEN,
      openings: 1,
      filled: 0,
      priority: Priority.MEDIUM,
      workArrangement: WorkArrangement.HYBRID,
      location: 'Madrid, Spain',
      salaryMin: 95000,
      salaryMax: 125000,
      publishedAt: daysAgo(20),
      closingDate: daysFromNow(45),
    },
    {
      title: 'UX/UI Designer',
      jdIndex: 3,
      departmentName: 'Design',
      hiringManagerEmail: 'elena.rodriguez@acmecompany.com',
      status: HiringRequestStatus.OPEN,
      openings: 2,
      filled: 0,
      priority: Priority.MEDIUM,
      workArrangement: WorkArrangement.HYBRID,
      location: 'Madrid, Spain',
      salaryMin: 75000,
      salaryMax: 100000,
      publishedAt: daysAgo(10),
      closingDate: daysFromNow(60),
    },
    {
      title: 'Data Scientist',
      jdIndex: 4,
      departmentName: 'Data',
      hiringManagerEmail: 'marcus.chen@acmecompany.com',
      status: HiringRequestStatus.OPEN,
      openings: 2,
      filled: 1,
      priority: Priority.URGENT,
      workArrangement: WorkArrangement.REMOTE,
      location: 'Remote (Global)',
      salaryMin: 120000,
      salaryMax: 160000,
      publishedAt: daysAgo(60),
      closingDate: daysFromNow(15),
    },
  ]

  const hiringRequests = await Promise.all(
    hrConfigs.map((cfg, idx) =>
      prisma.hiringRequest.create({
        data: {
          organizationId: org.id,
          departmentId: deptByName[cfg.departmentName]!.id,
          createdById: priya.id,
          hiringManagerId: userByEmail[cfg.hiringManagerEmail]!.id,
          jobDescriptionId: jobDescriptions[cfg.jdIndex]!.id,
          title: cfg.title,
          slug: `${cfg.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${idx + 1}`,
          status: cfg.status,
          priority: cfg.priority,
          jobType: JobType.FULL_TIME,
          workArrangement: cfg.workArrangement,
          level: jdTemplates[cfg.jdIndex]!.level,
          openings: cfg.openings,
          filled: cfg.filled,
          location: cfg.location,
          salaryMin: cfg.salaryMin,
          salaryMax: cfg.salaryMax,
          salaryCurrency: SalaryCurrency.EUR,
          summary: jdTemplates[cfg.jdIndex]!.description,
          publishedAt: cfg.publishedAt,
          closingDate: cfg.closingDate,
        },
      })
    )
  )

  // 7. Candidates
  console.log('  · candidates')
  const candidateData: {
    firstName: string
    lastName: string
    email: string
    position: string
    hrIndex: number
    stage: ApplicationStage
    rating: number
    source: string
    appliedDaysAgo: number
    skills: string[]
    currentTitle: string
    currentCompany: string
    yearsExperience: number
    linkedinUrl: string
    summary: string
    avatar: string
  }[] = [
    {
      firstName: 'Sarah',
      lastName: 'Chen',
      email: 'sarah.chen@example.com',
      position: 'Senior Software Engineer',
      hrIndex: 0,
      stage: ApplicationStage.INTERVIEW,
      rating: 5,
      source: 'LinkedIn',
      appliedDaysAgo: 14,
      skills: ['React', 'TypeScript', 'Next.js', 'Node.js', 'GraphQL'],
      currentTitle: 'Senior Frontend Engineer',
      currentCompany: 'Stripe',
      yearsExperience: 7,
      linkedinUrl: 'https://linkedin.com/in/sarahchen',
      summary: 'Senior frontend engineer with deep React, TypeScript, and design-system experience. Shipped the public dashboard for Stripe Capital.',
      avatar: '👩‍💼',
    },
    {
      firstName: 'Marcus',
      lastName: 'Johnson',
      email: 'marcus.j@example.com',
      position: 'Senior Software Engineer',
      hrIndex: 0,
      stage: ApplicationStage.OFFER,
      rating: 4,
      source: 'Referral',
      appliedDaysAgo: 28,
      skills: ['React', 'TypeScript', 'AWS', 'System Design'],
      currentTitle: 'Tech Lead',
      currentCompany: 'Linear',
      yearsExperience: 9,
      linkedinUrl: 'https://linkedin.com/in/marcusjohnson',
      summary: 'Tech lead with a strong product mindset. Built Linear\u2019s real-time collaboration surface.',
      avatar: '👨‍💼',
    },
    {
      firstName: 'Elena',
      lastName: 'Rodriguez',
      email: 'elena.r@example.com',
      position: 'Product Manager',
      hrIndex: 1,
      stage: ApplicationStage.SCREENING,
      rating: 4,
      source: 'Company site',
      appliedDaysAgo: 5,
      skills: ['Product Strategy', 'SQL', 'Analytics', 'Experimentation'],
      currentTitle: 'Senior Product Manager',
      currentCompany: 'Notion',
      yearsExperience: 6,
      linkedinUrl: 'https://linkedin.com/in/elenarodriguez',
      summary: 'Senior PM with a growth background. Led activation experiments that moved weekly active users by 18%.',
      avatar: '👩‍💼',
    },
    {
      firstName: 'James',
      lastName: 'Williams',
      email: 'james.w@example.com',
      position: 'Senior Software Engineer',
      hrIndex: 0,
      stage: ApplicationStage.APPLIED,
      rating: 3,
      source: 'LinkedIn',
      appliedDaysAgo: 2,
      skills: ['JavaScript', 'React', 'CSS'],
      currentTitle: 'Frontend Engineer',
      currentCompany: 'Vercel',
      yearsExperience: 4,
      linkedinUrl: 'https://linkedin.com/in/jameswilliams',
      summary: 'Frontend engineer with a strong design sensibility. Open-source contributor to several popular React libraries.',
      avatar: '👨‍💼',
    },
    {
      firstName: 'Priya',
      lastName: 'Patel',
      email: 'priya.patel@example.com',
      position: 'UX/UI Designer',
      hrIndex: 2,
      stage: ApplicationStage.INTERVIEW,
      rating: 5,
      source: 'Referral',
      appliedDaysAgo: 12,
      skills: ['Figma', 'Design Systems', 'Prototyping', 'User Research'],
      currentTitle: 'Senior Product Designer',
      currentCompany: 'Figma',
      yearsExperience: 8,
      linkedinUrl: 'https://linkedin.com/in/priyapatel',
      summary: 'Senior product designer with deep systems thinking. Owned the Figma design tokens initiative.',
      avatar: '👩‍💼',
    },
    {
      firstName: 'David',
      lastName: 'Kim',
      email: 'david.kim@example.com',
      position: 'Data Scientist',
      hrIndex: 3,
      stage: ApplicationStage.HIRED,
      rating: 5,
      source: 'Referral',
      appliedDaysAgo: 60,
      skills: ['Python', 'SQL', 'PyTorch', 'Statistics'],
      currentTitle: 'Data Scientist',
      currentCompany: 'Datadog',
      yearsExperience: 5,
      linkedinUrl: 'https://linkedin.com/in/davidkim',
      summary: 'Data scientist with strong modeling chops. Built anomaly detection systems for Datadog\u2019s observability product.',
      avatar: '👨‍💼',
    },
    {
      firstName: 'Lisa',
      lastName: 'Anderson',
      email: 'lisa.a@example.com',
      position: 'UX/UI Designer',
      hrIndex: 2,
      stage: ApplicationStage.APPLIED,
      rating: 4,
      source: 'Company site',
      appliedDaysAgo: 4,
      skills: ['Figma', 'Prototyping', 'Motion design'],
      currentTitle: 'Product Designer',
      currentCompany: 'Webflow',
      yearsExperience: 5,
      linkedinUrl: 'https://linkedin.com/in/lisaanderson',
      summary: 'Product designer with a motion and prototyping background. Loves shipping fast.',
      avatar: '👩‍💼',
    },
    {
      firstName: 'Alex',
      lastName: 'Turner',
      email: 'alex.t@example.com',
      position: 'Senior Software Engineer',
      hrIndex: 0,
      stage: ApplicationStage.SCREENING,
      rating: 4,
      source: 'AngelList',
      appliedDaysAgo: 6,
      skills: ['TypeScript', 'Node.js', 'GraphQL', 'PostgreSQL'],
      currentTitle: 'Senior Engineer',
      currentCompany: 'Shopify',
      yearsExperience: 6,
      linkedinUrl: 'https://linkedin.com/in/alexturner',
      summary: 'Senior full-stack engineer with a focus on API design and developer experience.',
      avatar: '👨‍💼',
    },
  ]

  const candidates = []
  for (const c of candidateData) {
    const hr = hiringRequests[c.hrIndex]!
    const created = await prisma.candidate.create({
      data: {
        organizationId: org.id,
        hiringRequestId: hr.id,
        firstName: c.firstName,
        lastName: c.lastName,
        email: c.email,
        phone: '+1 555 0100',
        location: pick(['Madrid, Spain', 'Berlin, Germany', 'London, UK', 'Remote']) as string,
        timezone: 'Europe/Madrid',
        linkedinUrl: c.linkedinUrl,
        headline: `${c.currentTitle} @ ${c.currentCompany}`,
        summary: c.summary,
        currentTitle: c.currentTitle,
        currentCompany: c.currentCompany,
        yearsExperience: c.yearsExperience,
        status: c.stage === ApplicationStage.HIRED ? CandidateStatus.HIRED : CandidateStatus.ACTIVE,
        stage: c.stage,
        rating: c.rating,
        source: c.source,
        appliedAt: daysAgo(c.appliedDaysAgo),
        lastActivityAt: daysAgo(Math.max(0, c.appliedDaysAgo - 2)),
        hiredAt: c.stage === ApplicationStage.HIRED ? daysAgo(2) : null,
      },
    })

    // Skills
    await prisma.candidateSkill.createMany({
      data: c.skills.map((skillName, idx) => ({
        candidateId: created.id,
        name: skillName,
        level: idx === 0 ? SkillLevel.EXPERT : idx < 2 ? SkillLevel.ADVANCED : SkillLevel.INTERMEDIATE,
        yearsOfUse: Math.max(1, c.yearsExperience - idx),
        isPrimary: idx === 0,
      })),
    })

    // Experience: 2 entries
    for (let i = 0; i < 2; i++) {
      const start = new Date()
      start.setFullYear(start.getFullYear() - (i + 1) * Math.max(2, c.yearsExperience - i * 2))
      const end = i === 0 ? null : new Date()
      await prisma.candidateExperience.create({
        data: {
          candidateId: created.id,
          company: i === 0 ? c.currentCompany : pick(COMPANIES.filter(co => co !== c.currentCompany)) as string,
          title: i === 0 ? c.currentTitle : 'Software Engineer',
          startDate: start,
          endDate: end,
          isCurrent: i === 0,
          description: 'Built and shipped core product surfaces, partnered cross-functionally, and led small projects end-to-end.',
        },
      })
    }

    // Education
    await prisma.candidateEducation.create({
      data: {
        candidateId: created.id,
        institution: pick(UNIVERSITIES) as string,
        degree: c.yearsExperience >= 5 ? DegreeType.MASTER : DegreeType.BACHELOR,
        field: pick(FIELDS) as string,
        startDate: daysAgo(c.yearsExperience * 365 + 365 * 4),
        endDate: daysAgo(c.yearsExperience * 365),
        grade: '3.8 GPA',
      },
    })

    // Optional certification
    if (c.skills.includes('AWS') || c.skills.includes('PyTorch')) {
      await prisma.candidateCertification.create({
        data: {
          candidateId: created.id,
          name: c.skills.includes('AWS') ? 'AWS Solutions Architect' : 'Deep Learning Specialization',
          issuer: c.skills.includes('AWS') ? 'Amazon Web Services' : 'Coursera / deeplearning.ai',
          issueDate: daysAgo(400),
        },
      })
    }

    // CV File
    await prisma.cVFile.create({
      data: {
        candidateId: created.id,
        fileType: 'PDF' as never,
        fileName: `${c.firstName}_${c.lastName}_Resume.pdf`,
        fileSize: 180_000 + Math.floor(Math.random() * 200_000),
        storageUrl: `https://storage.example.com/cvs/${created.id}.pdf`,
        storagePath: `cvs/${created.id}.pdf`,
        mimeType: 'application/pdf',
        parsedText: `${c.firstName} ${c.lastName} — ${c.currentTitle} at ${c.currentCompany}. ${c.summary}`,
        parsedData: { skills: c.skills, yearsExperience: c.yearsExperience },
      },
    })

    candidates.push(created)
  }

  // 8. Interviews
  console.log('  · interviews')
  const interviewable = candidates.filter(c =>
    ([
      ApplicationStage.SCREENING,
      ApplicationStage.INTERVIEW,
      ApplicationStage.OFFER,
      ApplicationStage.HIRED,
    ] as ApplicationStage[]).includes(c.stage)
  )

  for (const candidate of interviewable) {
    const hr = hiringRequests.find(h => h.id === candidate.hiringRequestId)!
    const interviewType =
      candidate.stage === ApplicationStage.SCREENING
        ? InterviewType.PHONE_SCREEN
        : candidate.stage === ApplicationStage.OFFER
          ? InterviewType.FINAL
          : InterviewType.TECHNICAL

    const scheduledAt = daysFromNow(Math.floor(Math.random() * 7) + 1)
    const interview = await prisma.interview.create({
      data: {
        organizationId: org.id,
        hiringRequestId: hr.id,
        candidateId: candidate.id,
        scheduledById: priya.id,
        type: interviewType,
        title: `${interviewType.replace(/_/g, ' ').toLowerCase()} — ${candidate.firstName} ${candidate.lastName}`,
        description: 'Structured interview, 60 minutes, 3-question rotation.',
        status: InterviewStatus.SCHEDULED,
        scheduledAt,
        durationMinutes: 60,
        location: interviewType === InterviewType.PHONE_SCREEN ? null : 'Remote · Google Meet',
        meetingUrl: 'https://meet.google.com/abc-defg-hij',
        stage: candidate.stage,
        round: 1,
      },
    })

    // Participants: 1-2 interviewers
    const interviewerPool =
      hr.departmentId === deptByName['Engineering']!.id
        ? [aiden, marcus]
        : hr.departmentId === deptByName['Design']!.id
          ? [sofia, elena]
          : [elena, jordan]

    for (const interviewer of interviewerPool.slice(0, 2)) {
      await prisma.interviewParticipant.create({
        data: {
          interviewId: interview.id,
          userId: interviewer.id,
          role: interviewer === marcus || interviewer === elena ? 'Lead' : 'Shadow',
        },
      })
    }

    // Questions
    const questions = [
      { category: 'Technical', type: QuestionType.TECHNICAL, difficulty: QuestionDifficulty.MEDIUM, question: 'Walk me through how you would architect a real-time collaborative document editor.' },
      { category: 'Behavioral', type: QuestionType.BEHAVIORAL, difficulty: QuestionDifficulty.EASY, question: 'Tell me about a time you had to push back on a stakeholder decision.' },
      { category: 'System Design', type: QuestionType.SYSTEM_DESIGN, difficulty: QuestionDifficulty.HARD, question: 'Design the frontend architecture for a multi-tenant SaaS dashboard with 50+ routes.' },
    ]

    for (let i = 0; i < questions.length; i++) {
      const q = questions[i]!
      await prisma.interviewQuestion.create({
        data: {
          interviewId: interview.id,
          category: q.category,
          type: q.type,
          difficulty: q.difficulty,
          question: q.question,
          expectedAnswer: 'Look for structured thinking, tradeoffs, and concrete examples.',
          order: i,
        },
      })
    }

    // Evaluation (only for some)
    if (candidate.stage === ApplicationStage.OFFER || Math.random() > 0.5) {
      await prisma.interviewEvaluation.create({
        data: {
          interviewId: interview.id,
          evaluatorId: interviewerPool[0]!.id,
          overallScore: 4,
          technicalScore: 4,
          communicationScore: 5,
          cultureFitScore: 4,
          problemSolvingScore: 4,
          strengths: 'Clear communication, structured problem solving, strong product instincts.',
          weaknesses: 'Less hands-on with one of the required frameworks.',
          recommendation:
            candidate.stage === ApplicationStage.OFFER
              ? EvaluationRecommendation.STRONG_HIRE
              : EvaluationRecommendation.HIRE,
          summary: 'Strong candidate, recommend moving forward.',
        },
      })
    }
  }

  // 9. Offers
  console.log('  · offers')
  const offerCandidate = candidates.find(c => c.stage === ApplicationStage.OFFER)
  if (offerCandidate) {
    const hr = hiringRequests.find(h => h.id === offerCandidate.hiringRequestId)!
    await prisma.offer.create({
      data: {
        organizationId: org.id,
        hiringRequestId: hr.id,
        candidateId: offerCandidate.id,
        status: OfferStatus.SENT,
        title: hr.title,
        salaryAmount: 130000,
        salaryCurrency: SalaryCurrency.EUR,
        salaryPeriod: 'annual',
        bonusAmount: 15000,
        equityAmount: '0.05% over 4 years',
        startDate: daysFromNow(30),
        expiresAt: daysFromNow(7),
        sentAt: daysAgo(2),
        documentUrl: 'https://storage.example.com/offers/offer-letter.pdf',
      },
    })
  }

  // 10. Activities
  console.log('  · activities')
  for (const c of candidates) {
    await prisma.activity.create({
      data: {
        organizationId: org.id,
        type: ActivityType.APPLICATION_RECEIVED,
        actorId: priya.id,
        candidateId: c.id,
        hiringRequestId: c.hiringRequestId,
        title: `${c.firstName} ${c.lastName} applied`,
        description: `New application via ${c.source}.`,
        occurredAt: c.appliedAt,
      },
    })

    if (c.stage !== ApplicationStage.APPLIED) {
      await prisma.activity.create({
        data: {
          organizationId: org.id,
          type: ActivityType.CANDIDATE_MOVED,
          actorId: priya.id,
          candidateId: c.id,
          hiringRequestId: c.hiringRequestId,
          title: `${c.firstName} ${c.lastName} moved to ${c.stage.toLowerCase()}`,
          description: `Stage updated to ${c.stage}.`,
          occurredAt: c.lastActivityAt,
        },
      })
    }

    if (c.stage === ApplicationStage.HIRED) {
      await prisma.activity.create({
        data: {
          organizationId: org.id,
          type: ActivityType.HIRED,
          actorId: jordan.id,
          candidateId: c.id,
          hiringRequestId: c.hiringRequestId,
          title: `${c.firstName} ${c.lastName} hired`,
          description: 'Offer accepted. Welcome to the team!',
          occurredAt: c.hiredAt!,
        },
      })
    }
  }

  // 11. AI Tasks + Conversations
  console.log('  · AI tasks')
  const aiTaskConfigs: {
    type: AITaskType
    title: string
    status: AITaskStatus
    prompt: string
    hiringRequestIndex: number
  }[] = [
    { type: AITaskType.JOB_DESCRIPTION, title: 'Senior Frontend Developer JD', status: AITaskStatus.COMPLETED, prompt: 'Hire Senior Frontend Developer', hiringRequestIndex: 0 },
    { type: AITaskType.HIRING_PACKAGE, title: 'DevOps Engineer package', status: AITaskStatus.COMPLETED, prompt: 'Build a hiring package for DevOps Engineer', hiringRequestIndex: 0 },
    { type: AITaskType.SCREENING_QUESTIONS, title: 'PM screening questions', status: AITaskStatus.RUNNING, prompt: 'Screening questions for Product Manager', hiringRequestIndex: 1 },
    { type: AITaskType.SCORECARD, title: 'UX Designer scorecard', status: AITaskStatus.PENDING, prompt: 'Generate scorecard for UX Designer', hiringRequestIndex: 2 },
  ]

  for (const cfg of aiTaskConfigs) {
    const task = await prisma.aITask.create({
      data: {
        organizationId: org.id,
        hiringRequestId: hiringRequests[cfg.hiringRequestIndex]!.id,
        createdById: jordan.id,
        type: cfg.type,
        title: cfg.title,
        status: cfg.status,
        prompt: cfg.prompt,
        result: cfg.status === AITaskStatus.COMPLETED ? { ok: true, sections: 6 } : Prisma.JsonNull,
        startedAt: daysAgo(2),
        completedAt: cfg.status === AITaskStatus.COMPLETED ? daysAgo(2) : null,
        inputTokens: cfg.status === AITaskStatus.COMPLETED ? 1840 : 320,
        outputTokens: cfg.status === AITaskStatus.COMPLETED ? 3140 : null,
        modelUsed: 'gemini-1.5-pro',
        durationMs: cfg.status === AITaskStatus.COMPLETED ? 12000 : null,
      },
    })

    // 2-3 conversation turns per task
    const turns: { role: AIConversationRole; content: string }[] = [
      { role: AIConversationRole.USER, content: cfg.prompt },
      { role: AIConversationRole.ASSISTANT, content: 'Got it. I\u2019ll generate a complete package for that role. Give me a moment.' },
    ]
    if (cfg.status === AITaskStatus.COMPLETED) {
      turns.push({ role: AIConversationRole.ASSISTANT, content: 'Done. The hiring package is ready for review.' })
    }

    for (const turn of turns) {
      await prisma.aIConversation.create({
        data: {
          taskId: task.id,
          role: turn.role,
          content: turn.content,
          tokens: Math.floor(turn.content.length / 4),
        },
      })
    }
  }

  // 12. Prompt templates
  console.log('  · prompt templates')
  for (const t of PROMPT_TEMPLATES) {
    await prisma.promptTemplate.create({
      data: {
        organizationId: org.id,
        name: t.name,
        description: t.description,
        category: t.category,
        body: t.body,
        variables: t.variables,
        isPublic: false,
        version: 1,
      },
    })
  }

  // 13. Final summary
  const counts = {
    organizations: await prisma.organization.count(),
    departments: await prisma.department.count(),
    users: await prisma.user.count(),
    jobDescriptions: await prisma.jobDescription.count(),
    hiringRequests: await prisma.hiringRequest.count(),
    candidates: await prisma.candidate.count(),
    candidateSkills: await prisma.candidateSkill.count(),
    candidateExperiences: await prisma.candidateExperience.count(),
    candidateEducations: await prisma.candidateEducation.count(),
    candidateCertifications: await prisma.candidateCertification.count(),
    cvFiles: await prisma.cVFile.count(),
    interviews: await prisma.interview.count(),
    interviewQuestions: await prisma.interviewQuestion.count(),
    interviewEvaluations: await prisma.interviewEvaluation.count(),
    offers: await prisma.offer.count(),
    activities: await prisma.activity.count(),
    aiTasks: await prisma.aITask.count(),
    aiConversations: await prisma.aIConversation.count(),
    promptTemplates: await prisma.promptTemplate.count(),
  }

  console.log('\n✅ Seed complete\n')
  console.log('Records created:')
  for (const [name, value] of Object.entries(counts)) {
    console.log(`  · ${name.padEnd(28, ' ')} ${value}`)
  }
}

main()
  .catch(err => {
    console.error('Seed failed:', err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
