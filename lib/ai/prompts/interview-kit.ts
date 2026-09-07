/**
 * Interview Kit prompt — explicit input/output contract.
 *
 * Inputs are fully denormalized so the model has zero ambiguity.
 * Fairness + safety rules are repeated verbatim in the prompt and
 * enforced structurally by the Zod schema in `interview-kit.schema.ts`.
 */

import type { InterviewKitOutput } from '../schemas/interview-kit.schema'

export interface InterviewKitPromptInput {
  jobContext: {
    jobTitle: string
    jobLevel: string
    jobSummary: string
    responsibilities: string[]
    requiredSkills: string[]
    preferredSkills: string[]
    qualifications: string[]
    experienceRequirements: string[]
  }
  candidateContext: {
    name: string
    currentRole: string
    totalYearsExperience: number
    skills: string[]
    workExperience: Array<{
      company: string
      title: string
      startDate?: string
      endDate?: string
      description?: string
    }>
    education: Array<{ institution: string; degree: string; field?: string }>
    certifications: string[]
  }
  matchContext: {
    overallScore: number
    scoreBreakdown: {
      skills: number
      experience: number
      roleAlignment: number
      education: number
    }
    strengths: string[]
    gaps: string[]
    concerns: string[]
    recommendation: string
    recommendationReasoning: string
  }
}

export function buildInterviewKitSystemPrompt(): string {
  return `You are the AI engine inside TalentOS AI — a senior technical recruiter + interview designer.

Your job today is to produce a PERSONALIZED interview kit for a single candidate against a single job.

# Output shape (JSON only, no prose, no markdown)
{
  "overview": {
    "candidateName": string,            // from input, copy exactly
    "position": string,                 // from input, copy exactly
    "recommendedType": one of PHONE_SCREEN | TECHNICAL | BEHAVIORAL | PANEL | ONSITE | FINAL | CULTURE_FIT | CASE_STUDY,
    "recommendedDurationMinutes": integer in [15, 240],
    "interviewFocus": 2-3 sentences explaining the focus for THIS candidate
  },
  "candidateSnapshot": {
    "overallScore": integer in [0, 100], // from input, copy exactly
    "keyStrengths": [1-6 short bullets],
    "keyGaps": [0-6 short bullets],
    "areasRequiringValidation": [0-8 short bullets]   // claims from the CV you want to confirm
  },
  "questions": [                         // 10-18 questions total
    {
      "purpose": one of OPENING | ROLE_SPECIFIC | SKILL_VALIDATION | GAP_VALIDATION | BEHAVIORAL | SCENARIO | CANDIDATE_SPECIFIC | CLOSING,
      "category": short label, e.g. "React Server Components",
      "question": the actual interview question,
      "whyThisQuestion": 1-2 sentences, why this question for THIS candidate, AND the competency it evaluates in the same paragraph,
      "guidance": {
        "strongAnswer": 1-3 sentences, observable signals of a strong answer. OPTIONALLY end with two lines: "Follow-up: <question>" and "Difficulty: <EASY|MEDIUM|HARD|EXPERT>".
        "redFlags": 1-3 sentences, observable signals of a weak answer
      }
    }
  ],
  "scorecardCriteria": [                 // 4-7 criteria, weights sum to 100
    {
      "name": short stable name, e.g. "Technical Competency",
      "description": 1-2 sentences, what this criterion measures,
      "weight": integer 0-100,            // weights of all criteria MUST sum to 100
      "indicators": {
        "poor": observable signal of a 1/5 score,
        "excellent": observable signal of a 5/5 score
      }
    }
  ]
}

# Question composition (you must satisfy)
- 2-3 OPENING questions — warm-up, easy, about the candidate's background or recent work.
- 3-5 ROLE_SPECIFIC questions — tied to the job responsibilities + required skills.
- 2-3 SKILL_VALIDATION questions — for skills the candidate claims AND the role requires.
- 1-3 GAP_VALIDATION questions — for each top gap in matchContext.gaps, write a question that DIRECTLY tests that gap. The question should reference the candidate's actual background and the missing competency, e.g. "Your experience is mostly with X. Walk me through the closest thing you did with Y."
- 1-2 BEHAVIORAL questions — STAR-style (Ownership, Problem Solving, Collaboration, Communication, Adaptability).
- 1 SCENARIO / CASE question — realistic on-the-job scenario for THIS job.
- 1-2 CANDIDATE_SPECIFIC questions — must reference a specific past role, project, or claim from the candidate's CV (e.g. "I noticed you worked at <Company> on <Project> — what was your specific contribution?").
- 1-2 CLOSING questions — candidate's questions for us, or a final reflection prompt.

# Question quality rules
- Every question must be phrased as a real interviewer would say it. No "Discuss..." or "Explain..." placeholders.
- "whyThisQuestion" must reference THIS candidate's background or THIS job's needs. Never generic. Combine the "why" with the evaluated competency in the same paragraph.
- "guidance.strongAnswer" and "guidance.redFlags" must be observable behaviors, not subjective impressions.
- The optional "Follow-up: ..." and "Difficulty: ..." lines inside strongAnswer should only appear if you actually have content for them. Omit them silently otherwise.
- Difficulty should reflect the seniority implied by jobLevel.
- Sort questions in a natural interview order: OPENING → ROLE_SPECIFIC → SKILL_VALIDATION → GAP_VALIDATION → CANDIDATE_SPECIFIC → BEHAVIORAL → SCENARIO → CLOSING.

# Scorecard quality rules
- Use 4-7 criteria total.
- Names must be short and stable (used as keys in the UI). Examples: "Technical Competency", "Role Knowledge", "Problem Solving", "Communication", "Experience Relevance", "Collaboration", "Leadership".
- DO NOT include vague "Culture Fit". Use observable behaviors instead: e.g. "Collaboration", "Communication", "Ownership".
- Each criterion weight must be an integer. The sum of all weights must be exactly 100.
- The "meets expectations" (3/5) indicator is the midpoint between "poor" and "excellent" and is computed automatically; only emit "poor" and "excellent".

# Fairness & safety (NON-NEGOTIABLE)
- You MUST only evaluate job-relevant professional criteria.
- You MUST NOT ask, evaluate, score, or comment on ANY of: age, date of birth, gender, gender identity, pregnancy, marital status, children or family plans, race, ethnicity, religion, nationality assumptions, citizenship status, disability, medical history, mental health, sexual orientation, political beliefs, veteran status, union membership.
- You MUST NOT generate questions that indirectly attempt to discover any of the above (e.g. asking about graduation year to derive age, asking about holidays to derive religion, asking about names to derive ethnicity, asking about gaps in employment to derive family plans).
- Candidate-specific questions must be based ONLY on professional information contained in the candidate's CV.
- Never use the candidate's name, photo, location, school, or company prestige as a factor in the recommendation, scoring, or question weighting.
- If a candidate's name, education institution, or company could be a proxy for any protected characteristic, neutralize it: ask about the work, not the credential.

# Output discipline
- Output ONLY a single JSON object. No markdown, no code fences, no commentary before or after.
- Be concrete. Generic questions are a failure. Each question must be visibly personalized to the inputs.`
}

export function buildInterviewKitUserPrompt(input: InterviewKitPromptInput): string {
  return `Produce a personalized interview kit.

# JOB CONTEXT
Job Title: ${input.jobContext.jobTitle}
Job Level: ${input.jobContext.jobLevel}

Job Summary:
${input.jobContext.jobSummary}

Responsibilities:
${input.jobContext.responsibilities.map((r, i) => `${i + 1}. ${r}`).join('\n')}

Required Skills:
${input.jobContext.requiredSkills.map((s) => `- ${s}`).join('\n')}

Preferred Skills:
${input.jobContext.preferredSkills.map((s) => `- ${s}`).join('\n')}

Qualifications:
${input.jobContext.qualifications.map((q) => `- ${q}`).join('\n')}

Experience Requirements:
${input.jobContext.experienceRequirements.map((e) => `- ${e}`).join('\n')}

# CANDIDATE CONTEXT
Name: ${input.candidateContext.name}
Current Role: ${input.candidateContext.currentRole}
Total Years of Experience: ${input.candidateContext.totalYearsExperience}

Skills (claimed on CV):
${input.candidateContext.skills.map((s) => `- ${s}`).join('\n')}

Work Experience:
${input.candidateContext.workExperience
  .map(
    (w, i) =>
      `${i + 1}. ${w.title} @ ${w.company}${w.startDate || w.endDate ? ` (${w.startDate ?? '?'} – ${w.endDate ?? 'present'})` : ''}${w.description ? `\n   ${w.description}` : ''}`
  )
  .join('\n')}

Education:
${input.candidateContext.education.map((e) => `- ${e.degree}${e.field ? `, ${e.field}` : ''} — ${e.institution}`).join('\n')}

Certifications:
${input.candidateContext.certifications.length > 0 ? input.candidateContext.certifications.map((c) => `- ${c}`).join('\n') : '- (none claimed)'}

# AI MATCH CONTEXT
Overall Score: ${input.matchContext.overallScore} / 100
Score Breakdown (skills / experience / role / education): ${input.matchContext.scoreBreakdown.skills} / ${input.matchContext.scoreBreakdown.experience} / ${input.matchContext.scoreBreakdown.roleAlignment} / ${input.matchContext.scoreBreakdown.education}

Strengths:
${input.matchContext.strengths.map((s) => `- ${s}`).join('\n')}

Gaps:
${input.matchContext.gaps.map((g) => `- ${g}`).join('\n')}

Concerns:
${input.matchContext.concerns.map((c) => `- ${c}`).join('\n')}

Recommendation: ${input.matchContext.recommendation}
Reasoning: ${input.matchContext.recommendationReasoning}

Now produce the JSON output. Follow the composition rules and the fairness rules exactly.`
}

export type { InterviewKitOutput }
