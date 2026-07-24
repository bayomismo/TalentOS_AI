/**
 * Audit Journey 8: RBAC enforcement.
 *
 * Scans all server actions to find ones that:
 *  - Don't call any auth check at all
 *  - Use requireAuth() but no role/permission check
 *  - Use a hand-rolled role allowlist instead of requirePermission()
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

function* walk(dir: string, exts: string[]): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const s = statSync(p)
    if (s.isDirectory()) {
      if (name === 'node_modules' || name === '.next' || name === '.git') continue
      yield* walk(p, exts)
    } else if (exts.some(e => p.endsWith(e))) {
      yield p
    }
  }
}

async function main() {
  const dir = '/workspace/TalentOS_AI/app'
  const files = [...walk(dir, ['.ts', '.tsx'])]
  const noAuth: string[] = []
  const authOnly: string[] = []
  const allowList: string[] = []
  const proper: string[] = []

  for (const f of files) {
    const content = readFileSync(f, 'utf8')
    // Skip if not a server action file (no 'use server' directive and no exported action)
    const isServerActionFile =
      content.includes("'use server'") ||
      content.includes('"use server"') ||
      /export\s+async\s+function\s+\w+Action/.test(content)
    if (!isServerActionFile) continue

    // Find every exported "XxxAction" function
    const actionMatches = [...content.matchAll(/export\s+async\s+function\s+(\w+Action)\s*\([^)]*\)\s*:\s*Promise<[^>]+>\s*\{/g)]
    for (const m of actionMatches) {
      const name = m[1]
      const start = m.index ?? 0
      // Find the function body end by counting braces
      let depth = 0
      let i = start + m[0].length - 1
      let endIdx = i
      for (; i < content.length; i++) {
        if (content[i] === '{') depth++
        else if (content[i] === '}') {
          depth--
          if (depth === 0) { endIdx = i; break }
        }
      }
      const body = content.slice(start, endIdx + 1)

      const hasRequireAuth = body.includes('requireAuth')
      const hasRequirePermission = body.includes('requirePermission') || body.includes('requireAllPermissions') || body.includes('requireAnyPermission')
      const hasRoleAllowlist = /if\s*\([^)]*role[^)]*includes\(|if\s*\([^)]*allowedRoles/.test(body) || /ADMIN.*TA_LEAD.*RECRUITER/.test(body)

      if (!hasRequireAuth && !hasRequirePermission) {
        noAuth.push(`${f}: ${name}`)
      } else if (hasRequireAuth && !hasRequirePermission && !hasRoleAllowlist) {
        authOnly.push(`${f}: ${name}`)
      } else if (hasRoleAllowlist) {
        allowList.push(`${f}: ${name}`)
      } else {
        proper.push(`${f}: ${name}`)
      }
    }
  }

  console.log('=== RBAC audit (server actions only) ===\n')
  console.log(`Total server actions found: ${noAuth.length + authOnly.length + allowList.length + proper.length}`)
  console.log('')
  console.log(`❌ NO AUTH CHECK: ${noAuth.length}`)
  noAuth.forEach(a => console.log(`  - ${a}`))
  console.log('')
  console.log(`⚠ AUTH ONLY (no role/permission check): ${authOnly.length}`)
  authOnly.forEach(a => console.log(`  - ${a}`))
  console.log('')
  console.log(`⚠ ROLE ALLOWLIST (bypasses permission registry): ${allowList.length}`)
  allowList.forEach(a => console.log(`  - ${a}`))
  console.log('')
  console.log(`✓ PROPER (uses requirePermission/All/Any): ${proper.length}`)
}
main().catch(console.error)
