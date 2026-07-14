// Prisma Client singleton for the TalentOS app.
//
// We use the standard "globalThis" trick so Next.js (which hot-reloads in dev)
// doesn't open a new connection pool on every file change.
//
// Usage:
//   import { db } from '@/lib/db'
//   const users = await db.user.findMany()
//
// In serverless / production, prefer a single PrismaClient per process.
// In dev, we cache it on globalThis to survive HMR.

import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'

declare global {
  // eslint-disable-next-line no-var
  var __prismaClient: PrismaClient | undefined
}

function createPrismaClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set')
  }
  const adapter = new PrismaPg({ connectionString })
  return new PrismaClient({
    adapter,
    log:
      process.env.NODE_ENV === 'development'
        ? ['query', 'error', 'warn']
        : ['error'],
  })
}

export const db: PrismaClient =
  globalThis.__prismaClient ?? createPrismaClient()

if (process.env.NODE_ENV !== 'production') {
  globalThis.__prismaClient = db
}
