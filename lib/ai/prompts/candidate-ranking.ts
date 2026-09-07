/**
 * Candidate Ranking prompt.
 *
 * Renders a recruiter-grade request to score a candidate against a job
 * description. Returns per-axis scores, an overall 0-100, a user-facing
 * recommendation, and concise reasoning the HR team can read.
 *
 * Fairness safeguards (model must follow):
 *   - Score ONLY on job-relevant professional criteria.
 *   - Do NOT use: name, gender, age, race, ethnicity, religion,
 *     nationality, marital status, disability, photo.
 *   - Names appear in the input for identification only.
 */

import type { PromptDefinition } from '../types'
import { candidateRankingOutputSchema } from '../schemas/candidate-ranking.schema'

export interface CandidateRankingInput {
  candidateId: string
  hiringRequestId: string
  /** Rendered job description (title + summary + responsibilities + skills). */
  jobDescription: {
    title: string
    summary: string
    responsibilities: string[]
    requiredSkills: string[]
    niceToHaveSkills: string[]
    qualifications: string[]
  }
  /** Rendered candidate profile (extracted from CV). */
  candidateProfile: {
    fullName: string
    currentTitle: string
    yearsExperience: number
    summary: string
    topSkills: string[]
    workExperience: { company: string; title: string; startDate: string; endDate?: string | null; description?: string }[]
    education: { institution: string; degree: string; field: string }[]
  }
}

const SCHEMA_DESCRIPTION = `{
  "candidateId": string,
  "hiringRequestId": string,
  "overallScore": integer 0-100,
  "skillsScore": integer 0-100,
  "experienceScore": integer 0-100,
  "educationScore": integer 0-100,
  "roleScore": integer 0-100,
  "recommendation": "STRONG_MATCH" | "GOOD_MATCH" | "POTENTIAL_MATCH" | "WEAK_MATCH" | "NOT_RECOMMENDED",
  "reasoning": string (40-1200 chars, plain text, no markdown),
  "strengths": string[1..8],
  "gaps": string[0..8],
  "concerns": string[0..6]
}`

export const candidateRankingPrompt: PromptDefinition<CandidateRankingInput> = {
  id: 'candidate-ranking.v1',
  name: 'Candidate Ranking',
  description:
    'Scores a candidate against a job description and returns a per-axis breakdown, overall score, and recommendation.',
  version: {
    version: '1.0.0',
    authoredAt: '2026-07-15',
    changelog: 'Sprint 6: real implementation. Adds fairness safeguards and per-axis breakdown.',
  },
  outputSchemaDescription: SCHEMA_DESCRIPTION,
  render(input: CandidateRankingInput): string {
    const expBlock = input.candidateProfile.workExperience
      .slice(0, 8)
      .map(
        e =>
          `  - ${e.title} @ ${e.company} (${e.startDate} → ${e.endDate ?? 'present'})${
            e.description ? `\n    ${e.description.slice(0, 240)}` : ''
          }`
      )
      .join('\n')

    const eduBlock = input.candidateProfile.education
      .slice(0, 4)
      .map(e => `  - ${e.degree}, ${e.field} — ${e.institution}`)
      .join('\n')

    return `
You are a senior technical recruiter scoring a candidate for a specific role.
Read the job description and the candidate profile below, then return a
structured score + recommendation.

FAIRNESS SAFEGUARDS (NON-NEGOTIABLE):
- Score ONLY on job-relevant professional criteria.
- NEVER use the candidate's name, gender, age, race, ethnicity, religion,
  nationality, marital status, disability, photo, or any characteristic
  that is not a verifiable professional qualification.
- The candidate's name appears in the input for identification only.
  It MUST NOT influence any score, recommendation, or reasoning.
- If two candidates have identical professional profiles, their scores
  MUST be identical.

SCORING (each axis 0-100):
- skillsScore: how well the candidate's top skills cover the required skills.
  - 90-100: all required skills present and at advanced/expert level.
  - 70-89: most required skills present, some gaps.
  - 40-69: significant gaps in required skills.
  - 0-39: most required skills missing.
- experienceScore: how well the candidate's years of experience and
  seniority match the level implied by the role title (entry, mid,
  senior, staff, principal).
- educationScore: how well the candidate's education matches the
  qualifications the job requires. If the role doesn't list education
  requirements, return 75 as a neutral baseline.
- roleScore: how well the candidate's prior roles (titles, companies,
  domain) match the responsibilities of the role.

overallScore = round(0.45*skillsScore + 0.30*experienceScore + 0.15*roleScore + 0.10*educationScore)

RECOMMENDATION (overallScore bands):
- STRONG_MATCH:        85-100
- GOOD_MATCH:          70-84
- POTENTIAL_MATCH:     55-69
- WEAK_MATCH:          40-54
- NOT_RECOMMENDED:     0-39

REASONING:
- Plain text, 2-4 sentences, no markdown, no bullet points.
- Mention the top 1-2 reasons the candidate is a strong or weak match
  based on the job context.

JOB DESCRIPTION:
- Title: ${input.jobDescription.title}
- Summary: ${input.jobDescription.summary}
- Responsibilities:
${input.jobDescription.responsibilities.slice(0, 10).map(r => `  - ${r}`).join('\n')}
- Required skills: ${input.jobDescription.requiredSkills.join(', ') || '(none)'}
- Nice-to-have skills: ${input.jobDescription.niceToHaveSkills.join(', ') || '(none)'}
- Qualifications: ${input.jobDescription.qualifications.join('; ') || '(none)'}

CANDIDATE PROFILE:
- Name (identification only — DO NOT use to score): ${input.candidateProfile.fullName}
- Current title: ${input.candidateProfile.currentTitle}
- Years of experience: ${input.candidateProfile.yearsExperience}
- Summary: ${input.candidateProfile.summary.slice(0, 600)}
- Top skills: ${input.candidateProfile.topSkills.join(', ')}
- Work experience:
${expBlock || '  (none recorded)'}
- Education:
${eduBlock || '  (none recorded)'}

Return ONLY the JSON object described by the schema. No prose, no markdown
fences, no commentary. The output must be valid JSON.
`.trim()
  },
}

export { candidateRankingOutputSchema }
