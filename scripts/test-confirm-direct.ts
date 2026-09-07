import 'dotenv/config'
import { db } from '../lib/db'
import { randomUUID } from 'node:crypto'
import { hashPassword } from '../lib/auth/password'

async function main() {
  console.log('Direct test: confirm password reset flow')
  
  const admin = await db.user.findUnique({ where: { email: 'bayomismo@gmail.com' } })
  if (!admin) throw new Error('Admin not found')
  
  // Create test user
  const testEmail = `confirm-test-${randomUUID().slice(0, 6)}@gmail.com`
  const testUser = await db.user.create({
    data: {
      organizationId: admin.organizationId,
      email: testEmail,
      firstName: 'Confirm',
      lastName: 'Test',
      role: 'VIEWER',
      passwordHash: await hashPassword('OriginalPass123!'),
    },
  })
  console.log(`Created test user: ${testUser.email}`)
  
  // Create a reset token
  const { randomBytes, createHash } = await import('node:crypto')
  const token = randomBytes(32).toString('base64url')
  const tokenPrefix = token.slice(0, 8)
  const tokenHash = createHash('sha256').update(token).digest('hex')
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000)
  
  await db.passwordResetToken.create({
    data: {
      userId: testUser.id,
      tokenHash,
      tokenPrefix,
      expiresAt,
    },
  })
  console.log(`Created token: prefix=${tokenPrefix}`)
  
  // Call the action directly
  const { confirmPasswordResetAction } = await import('../app/(auth)/actions')
  const result = await confirmPasswordResetAction({ token, password: 'NewPassword456!' })
  console.log('Result:', JSON.stringify(result))
  
  // Check the DB
  const updated = await db.user.findUnique({ where: { id: testUser.id } })
  console.log(`Password hash changed: ${updated?.passwordHash !== testUser.passwordHash}`)
  
  // Cleanup
  await db.passwordResetToken.deleteMany({ where: { userId: testUser.id } })
  await db.user.delete({ where: { id: testUser.id } })
  console.log('Cleanup done')
}
main().catch(e => { console.error('FATAL:', e); process.exit(1) })
