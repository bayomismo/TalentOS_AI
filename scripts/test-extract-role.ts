import { extractRoleFromPrompt } from '../features/ai-recruiter/data/mock-hiring-package'

let pass = 0, fail = 0
function ok(label: string, actual: any, expected: any) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected)
  if (a === e) { pass++; console.log(`  ✓ ${label}: ${a}`) }
  else { fail++; console.log(`  ✗ ${label}: got ${a}, expected ${e}`) }
}

console.log('=== extractRoleFromPrompt test ===\n')

// Verb patterns
ok('"Hire a Customer Success Lead"', extractRoleFromPrompt('Hire a Customer Success Lead'), 'Customer Success Lead')
ok('"Hire a Senior Frontend Developer"', extractRoleFromPrompt('Hire a Senior Frontend Developer'), 'Senior Frontend Developer')
ok('"I want to hire a Senior PM"', extractRoleFromPrompt('I want to hire a Senior PM'), 'Senior Pm')  // capitalize lowercases per-word
ok('"Hiring a Backend Engineer"', extractRoleFromPrompt('Hiring a Backend Engineer'), 'Backend Engineer')
ok('"We need a Designer"', extractRoleFromPrompt('We need a Designer'), 'Designer')
ok('"Create a job for a Data Scientist"', extractRoleFromPrompt('Create a job for a Data Scientist'), 'Data Scientist')
ok('"Hire customer success lead" (no article)', extractRoleFromPrompt('Hire customer success lead'), 'Customer Success Lead')

// Bare role names (the bug fix)
ok('"Customer Success Lead" (bare)', extractRoleFromPrompt('Customer Success Lead'), 'Customer Success Lead')
ok('"Backend Engineer" (bare)', extractRoleFromPrompt('Backend Engineer'), 'Backend Engineer')
ok('"Senior PM" (bare, mixed case)', extractRoleFromPrompt('Senior PM'), 'Senior Pm')  // capitalize lowercases per-word (intentional)

// Empty
ok('"" empty', extractRoleFromPrompt(''), '')
ok('"   " whitespace', extractRoleFromPrompt('   '), '')

// Long free-form (not a role, return empty)
ok('long free-form returns empty',
  extractRoleFromPrompt('We are looking for someone who can help us build out a new team in our European office, ideally based in Berlin or Amsterdam, who is comfortable working in a fast-paced startup environment with 50 people and reports to our CTO.'),
  '')

console.log(`\n========== ${pass} pass, ${fail} fail ==========`)
if (fail > 0) process.exit(1)
