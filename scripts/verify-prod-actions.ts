/**
 * Verify the production server actions work against the live Neon DB.
 * This is the same code path Next.js invokes when the page hydrates.
 */
import 'dotenv/config'
import { getHiringRequestsAction, getHiringRequestsAction as _hr } from '../app/(app)/hiring-requests/actions'
import { getCandidatesAction } from '../app/(app)/candidates/actions'
import { getCandidateDetailAction } from '../app/(app)/candidates/[id]/actions'

async function main() {
  console.log('\n=== Production actions smoke test ===\n')

  // Hiring requests
  const hr = await getHiringRequestsAction()
  console.log('Hiring requests:', hr.positions.length, 'rows')
  console.log('  stats:', hr.stats)
  console.log('  first 3:')
  for (const p of hr.positions.slice(0, 3)) {
    console.log('   -', p.title, '·', p.department, '·', p.status)
  }

  // Candidates
  const cands = await getCandidatesAction()
  console.log('\nCandidates:', cands.candidates.length, 'rows')
  for (const c of cands.candidates.slice(0, 3)) {
    console.log('   -', c.name, '·', c.position, '·', c.stage)
  }

  // Candidate detail
  if (cands.candidates[0]) {
    const id = cands.candidates[0].id
    const detail = await getCandidateDetailAction(id)
    console.log('\nCandidate detail for', id, ':')
    console.log('  ', detail ? `${detail.name} · ${detail.position} · ${detail.stage}` : 'NOT FOUND')
  }

  // Bad ID
  const missing = await getCandidateDetailAction('00000000-0000-0000-0000-000000000000')
  console.log('\nMissing candidate: ', missing)

  console.log('\n=== OK ===\n')
}

main().catch(err => {
  console.error('FAIL:', err)
  process.exit(1)
})
