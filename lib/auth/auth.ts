/**
 * Sprint 9 — Auth.js v5 configuration.
 *
 * Strategy: Credentials provider (email + password) with bcrypt-hashed
 * passwords. JWT session strategy (stateless). Session token hash is
 * tracked in `AuthSession` so ADMIN can revoke individual sessions and
 * the security settings page can show active sessions.
 *
 * PART 1: Auth.js / NextAuth was selected for compatibility with the
 * existing Next.js 16 + Prisma 7 stack and built-in support for future
 * enterprise SSO providers (Entra, Okta, Google, SAML) without a paid
 * dependency.
 *
 * PART 2: Password hashing is bcryptjs (pure JS — serverless-safe on
 * Vercel). No plaintext passwords are ever stored, logged, or returned
 * to the client.
 *
 * PART 4: Session cookies are HTTPOnly, Secure (in production), and
 * SameSite=Lax. The JWT carries userId, organizationId, role, and the
 * passwordChangedAt timestamp. On every request we re-validate the JWT
 * against the database so password changes and disables take effect
 * within one DB read.
 */

import NextAuth, { type NextAuthConfig } from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import { comparePassword } from './password'
import { db } from '@/lib/db'
import { recordAuditLog } from './audit'
import { createHash } from 'crypto'

declare module 'next-auth' {
  interface Session {
    user: {
      id: string
      organizationId: string
      email: string
      firstName: string
      lastName: string
      role: import('@prisma/client').UserRole
      iat?: number
      exp?: number
      jti?: string
    }
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    userId: string
    organizationId: string
    role: import('@prisma/client').UserRole
    passwordChangedAt: string | null
  }
}

const SESSION_MAX_AGE_SECONDS = 60 * 60 * 8 // 8 hours

export const authConfig: NextAuthConfig = {
  // JWT strategy — stateless sessions. We use `AuthSession` table only as
  // a revocation ledger and an active-session list. The source of truth
  // for "is this session valid" is the JWT signature + the per-request
  // DB re-check in `requireAuth()`.
  session: { strategy: 'jwt', maxAge: SESSION_MAX_AGE_SECONDS },
  trustHost: true,
  secret: process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET,

  // Custom sign-in page (PART 3: /login)
  pages: {
    signIn: '/login',
    error: '/login',
  },

  providers: [
    Credentials({
      name: 'Email and password',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(rawCredentials, request) {
        const email = typeof rawCredentials?.email === 'string' ? rawCredentials.email.trim().toLowerCase() : ''
        const password = typeof rawCredentials?.password === 'string' ? rawCredentials.password : ''
        if (!email || !password) return null

        const ip = extractIpFromRequest(request)
        const userAgent = request?.headers?.get?.('user-agent') ?? null

        const user = await db.user.findUnique({
          where: { email },
          select: {
            id: true,
            organizationId: true,
            email: true,
            firstName: true,
            lastName: true,
            role: true,
            passwordHash: true,
            passwordChangedAt: true,
            disabledAt: true,
            status: true,
          },
        })

        // We do not reveal whether the email exists. We log a single failure
        // audit event with the email hash so brute-force attempts can be
        // detected without leaking which emails are registered.
        if (!user || !user.passwordHash || user.disabledAt || user.status !== 'ACTIVE') {
          await recordAuditLog({
            organizationId: user?.organizationId ?? null,
            actorId: null,
            action: 'LOGIN_FAILURE',
            targetType: 'user',
            targetId: user?.id ?? null,
            outcome: 'failure',
            reason: !user
              ? 'user_not_found'
              : !user.passwordHash
                ? 'password_not_set'
                : user.disabledAt
                  ? 'user_disabled'
                  : 'user_inactive',
            metadata: { emailHash: hashEmail(email), ip, userAgent },
          })
          return null
        }

        const ok = await comparePassword(password, user.passwordHash)
        if (!ok) {
          await recordAuditLog({
            organizationId: user.organizationId,
            actorId: user.id,
            action: 'LOGIN_FAILURE',
            targetType: 'user',
            targetId: user.id,
            outcome: 'failure',
            reason: 'invalid_password',
            metadata: { emailHash: hashEmail(email), ip, userAgent },
          })
          return null
        }

        // Update lastLoginAt
        await db.user.update({
          where: { id: user.id },
          data: { lastLoginAt: new Date() },
        })

        await recordAuditLog({
          organizationId: user.organizationId,
          actorId: user.id,
          action: 'LOGIN_SUCCESS',
          targetType: 'user',
          targetId: user.id,
          outcome: 'success',
          metadata: { ip, userAgent },
        })

        return {
          id: user.id,
          email: user.email,
          name: `${user.firstName} ${user.lastName}`,
          organizationId: user.organizationId,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
          passwordChangedAt: user.passwordChangedAt?.toISOString() ?? null,
        }
      },
    }),
  ],

  callbacks: {
    async jwt({ token, user, trigger }) {
      // First call after sign-in: copy fields from the authorize() result
      // onto the JWT. Subsequent calls: keep the existing token.
      if (user) {
        const u = user as unknown as {
          id: string
          organizationId: string
          role: import('@prisma/client').UserRole
          passwordChangedAt: string | null
        }
        token.userId = u.id
        token.organizationId = u.organizationId
        token.role = u.role
        token.passwordChangedAt = u.passwordChangedAt
      }
      return token
    },

    async session({ session, token }) {
      const tokenAny = token as unknown as { userId?: string; organizationId?: string; role?: import('@prisma/client').UserRole; iat?: number; exp?: number }
      const fullName = (session.user?.name ?? '').trim()
      const firstName = fullName.split(' ')[0] ?? ''
      const lastName = fullName.split(' ').slice(1).join(' ')
      session.user = {
        id: tokenAny.userId ?? '',
        organizationId: tokenAny.organizationId ?? '',
        email: session.user?.email ?? '',
        firstName,
        lastName,
        role: tokenAny.role as import('@prisma/client').UserRole,
        emailVerified: null,
        iat: tokenAny.iat,
        exp: tokenAny.exp,
      }
      return session
    },
  },

  events: {
    async signOut(message) {
      const m = message as unknown as { token?: { userId?: string }; user?: { id?: string } }
      const userId = m.token?.userId ?? m.user?.id ?? null
      if (userId) {
        await recordAuditLog({
          organizationId: null,
          actorId: userId,
          action: 'LOGOUT',
          targetType: 'user',
          targetId: userId,
          outcome: 'success',
        })
      }
    },
  },
}

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig)

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function extractIpFromRequest(request: Request | undefined): string | null {
  if (!request) return null
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0]?.trim() ?? null
  return request.headers.get('x-real-ip') ?? null
}

function hashEmail(email: string): string {
  return createHash('sha256').update(email.toLowerCase().trim()).digest('hex').slice(0, 32)
}
