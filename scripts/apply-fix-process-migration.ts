/**
 * One-off applier for the fix-process migration.
 *
 * It applies EXACTLY the statements of
 * prisma/migrations/20261110000001_fix_process_decision_history_and_interview_statuses/migration.sql
 * to the live database and records the migration in `_prisma_migrations`
 * with the same SHA-256 checksum Prisma computes, so `prisma migrate
 * status` / `prisma migrate deploy` stay consistent afterwards.
 *
 * It never touches application rows.
 */
import 'dotenv/config'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { db } from '../lib/db'
import { Prisma } from '@prisma/client'

const MIGRATION_DIR = resolve(
  __dirname,
  '../prisma/migrations/20261110000001_fix_process_decision_history_and_interview_statuses',
)
const MIGRATION_NAME = '20261110000001_fix_process_decision_history_and_interview_statuses'

async function main() {
  const sql = readFileSync(resolve(MIGRATION_DIR, 'migration.sql'), 'utf8')
  const checksum = createHash('sha256').update(sql).digest('hex')

  const existing = await db.$queryRaw<Array<{ migration_name: string }>>(Prisma.sql`
    select migration_name from "_prisma_migrations" where migration_name = ${MIGRATION_NAME}
  `)
  if (existing.length > 0) {
    console.log('already applied — nothing to do')
    return
  }

  // Strip the comments FIRST: a `;` inside a comment would otherwise
  // split a statement in half.
  const withoutComments = sql
    .split('\n')
    .filter(line => !line.trim().startsWith('--'))
    .join('\n')
  const statements = withoutComments
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0)
  for (const statement of statements) {
    console.log('> ', statement.replace(/\s+/g, ' ').slice(0, 120))
    await db.$executeRawUnsafe(statement)
  }

  await db.$executeRawUnsafe(
    `INSERT INTO "_prisma_migrations" (id, checksum, migration_name, logs, started_at, finished_at, applied_steps_count)
     VALUES (gen_random_uuid()::text, $1, $2, $3, now(), now(), 1)`,
    checksum,
    MIGRATION_NAME,
    'Applied by scripts/apply-fix-process-migration.ts',
  )

  console.log('migration applied and recorded')
}

main()
  .then(() => process.exit(0))
  .catch(e => {
    console.error(e)
    process.exit(1)
  })
