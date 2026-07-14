# TalentOS — Database

PostgreSQL + Prisma ORM 7. Local dev uses a local Postgres; production targets
[Neon](https://neon.tech) (PostgreSQL connection string).

## Files

- `schema.prisma` — 20-model domain schema, 22 enums, 21 tables (incl. `_prisma_migrations`)
- `seed.ts` — Idempotent demo data covering every entity
- `migrations/` — Versioned migrations, applied via `prisma migrate dev`
- `../prisma.config.ts` — Prisma 7 config (URL lives here, not in `schema.prisma`)
- `../lib/db.ts` — Singleton PrismaClient for the app
- `../.env.example` — Connection-string template

## Quick start

```bash
# 1. Provision a database (Neon) and copy the connection string into .env
cp .env.example .env
# edit DATABASE_URL=...

# 2. Install dependencies (this also runs allowBuilds for prisma engines)
pnpm install

# 3. Apply migrations
pnpm db:migrate

# 4. Seed demo data
pnpm db:seed

# 5. Open Prisma Studio
pnpm db:studio
```

## Entity map

| Entity              | Purpose                                                 | Key relations                                    |
| ------------------- | ------------------------------------------------------- | ------------------------------------------------ |
| `Organization`      | Tenant root. Every business entity is scoped to one.    | has many Departments, Users, HiringRequests, ... |
| `Department`        | A team inside an org (Engineering, Design, …).          | belongs to Organization; head is a User          |
| `User`              | A person who can sign in, run interviews, etc.         | belongs to Organization + optional Department    |
| `HiringRequest`     | An opening. The atomic unit of the hiring funnel.      | dept, hiring manager, creator, optional JD       |
| `JobDescription`    | Either a template or a snapshot of a specific JD.      | reused by many HiringRequests                    |
| `Candidate`         | A person in the pipeline.                               | belongs to one HiringRequest + skills/exp/...    |
| `CandidateSkill`    | Skill, level, years, primary flag.                      | belongs to Candidate                             |
| `CandidateExperience` | Employment history.                                   | belongs to Candidate                             |
| `CandidateEducation`  | University / degree.                                 | belongs to Candidate                             |
| `CandidateCertification` | Industry credentials.                             | belongs to Candidate                             |
| `CVFile`            | Uploaded resume, with parsed text + structured data.    | belongs to Candidate                             |
| `Interview`         | A scheduled (or completed) interview.                   | candidate, hiring request, participants, eval.   |
| `InterviewParticipant` | Join: which Users are on this interview.            | interview + user (with role)                     |
| `InterviewQuestion` | One question on the agenda for an interview.            | belongs to Interview                             |
| `InterviewEvaluation` | Scorecard submitted by an interviewer.               | interview + evaluator                            |
| `Offer`             | A formal offer extended to a candidate.                  | org, hiring request, candidate                   |
| `Activity`          | Append-only event log for the org.                      | optional refs to candidate/HR/interview/offer    |
| `AITask`            | A request to the AI for a generated artifact.           | optional hiring request + creator                |
| `AIConversation`    | A turn in an AI task's conversation.                    | belongs to AITask                                |
| `PromptTemplate`    | Reusable prompt with variables.                         | optional org (null = global)                     |

## Multi-tenancy

The schema is **multi-tenant ready** but isolation is **not** enforced at the
query layer yet. Every business entity carries an `organizationId` FK and the
appropriate compound index. When auth lands, query helpers (e.g. an
`orgScoped(db)` middleware) will plug in here.

## Conventions

- IDs are UUIDs (`@default(dbgenerated("gen_random_uuid()"))`).
- Every entity has `id`, `createdAt`, `updatedAt`.
- Enums are PascalCase to keep them readable in logs and APIs.
- Cascade rules are explicit per relation (`Cascade`, `Restrict`, `SetNull`).
- Search-heavy fields have explicit indexes (see `@@index` on each model).
- `metadata` / `settings` columns are `Json` defaults of `"{}"` for forward-compat.
