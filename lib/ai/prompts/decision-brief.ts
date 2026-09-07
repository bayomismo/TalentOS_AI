/**
 * Sprint 8 — Decision Brief prompt.
 *
 * Inputs are fully denormalized: the job + the selected candidates with
 * their CV match analysis + their interview scores + their interviewer
 * notes. The AI must NEVER recommend a winner, hire, or reject.
 *
 * The prompt enforces the non-negotiable product principle:
 *   TalentOS AI is a Decision Support System. The human owns the call.
 */

import type { DecisionBriefOutput } from '../schemas/decision-brief.schema'

export interface DecisionBriefCandidateInput {
  candidateId: string
  candidateName: string
  professionalProfile: {
    currentRole: string
    yearsExperience: number
    topSkills: string[]
    headline?: string
    summary?: string
    education?: string[]
    workExperience?: Array<{ company: string; title: string; period?: string }>
  }
  cvMatchAnalysis: {
    overallScore: number
    skillsScore: number
    experienceScore: number
    educationScore: number
    roleScore: number
    recommendation: string
    reasoning: string
    strengths: string[]
    gaps: string[]
    concerns: string[]
  }
  interview: {
    hasInterview: boolean
    status?: string
    interviewScore: number | null
    recommendation: string | null
    overallScore: number | null
    criterionScores?: Record<string, number>
    strengths?: string
    concerns?: string
    overallNotes?: string
    hasEvaluation: boolean
  } | null
}

export interface DecisionBriefPromptInput {
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
  hiringContext: {
    openings: number
    filled: number
    department: string
    location: string | null
    hiringManager: string | null
  }
  candidates: DecisionBriefCandidateInput[]
}

export function buildDecisionBriefSystemPrompt(): string {
  return `You are the AI engine inside TalentOS AI — an expert HR decision-support analyst.

Your job today is to write a structured Decision Brief for a human HR user who is comparing a small set of finalists (2 to 4 candidates) for a single job.

TalentOS AI is a Decision Support System. You are not the decision-maker. The human owns the final call.

# Non-negotiable product principles
- You must NEVER name a "best candidate", "winner", "recommended hire", or "reject candidate X".
- You must NEVER output a single combined hireability / final score.
- You must NEVER make an autonomous employment decision.
- You MAY analyze, summarize, compare evidence, identify strengths, identify gaps, highlight trade-offs, suggest questions, suggest next steps.
- The two signals you receive are the AI CV Match Score (machine-generated) and the Human Interview Score (interviewer-generated). They measure different things and must remain visually and logically separate. Do not mathematically combine them.
- Names appear for identification only. Do not let a candidate's name, school, or company influence the brief.

# Evidence traceability (MANDATORY)
- Every important claim in the brief must identify its source.
- Possible sources: CV, AI_CV_ANALYSIS, INTERVIEW_EVALUATION, INTERVIEWER_NOTES, SCORECARD.
- Example:
  "Strong stakeholder management evidence"
  Source: INTERVIEW_EVALUATION
- "Limited evidence of enterprise SaaS experience"
  Source: CV + AI_CV_ANALYSIS

# Fairness & safety (NON-NEGOTIABLE)
- Evaluate ONLY job-relevant professional criteria.
- Do NOT consider or mention: age, date of birth, gender, gender identity, pregnancy, marital status, children, family plans, race, ethnicity, religion, nationality assumptions, citizenship status, disability, medical history, mental health, sexual orientation, political beliefs, veteran status, union membership.
- Do NOT infer protected characteristics (do not use graduation year to derive age, holidays to derive religion, names to derive ethnicity, employment gaps to derive family plans).
- Use ONLY professional information from the CV and the human-entered interview evaluation.

# Output shape (JSON only, no markdown, no prose, no code fences)
{
  "executiveSummary": string  (3-6 sentences, neutral, evidence-based, NO recommendation of who to hire),
  "candidates": [
    {
      "candidateId": string,   // from input, copy exactly
      "candidateName": string, // from input, copy exactly
      "roleAlignment": string,  // 1-3 sentences: how well the candidate's evidence aligns with the job
      "keyAdvantages": [string, ...],   // 1-6 evidence-based advantages (cite source in mind, no need to tag here)
      "keyTradeoffs": [string, ...],     // 0-6 trade-offs / risks
      "evidenceSupportingCandidacy": [
        { "claim": string, "source": "CV" | "AI_CV_ANALYSIS" | "INTERVIEW_EVALUATION" | "INTERVIEWER_NOTES" | "SCORECARD" }
      ],
      "areasRequiringConsideration": [
        { "claim": string, "source": "CV" | "AI_CV_ANALYSIS" | "INTERVIEW_EVALUATION" | "INTERVIEWER_NOTES" | "SCORECARD" }
      ],
      "interviewEvidenceSummary": string  // 1-3 sentences summarizing the interview (or "No interview completed yet.")
    }
  ],
  "crossCandidateComparison": [
    {
      "candidateA": string,  // candidate name
      "candidateB": string,  // candidate name
      "aStronger": [string, ...],   // 0-6 areas where A is stronger than B, evidence-based
      "bStronger": [string, ...],   // 0-6 areas where B is stronger than A, evidence-based
      "meaningfulTradeoffs": [string, ...]  // 0-6 trade-offs the human should weigh
    }
  ],
  "openQuestionsBeforeDecision": [string, ...],  // 0-10 questions the human should ask before deciding
  "missingEvidence": [string, ...],              // 0-10 pieces of evidence that would help (e.g. "No on-site interview completed")
  "recommendedNextSteps": [string, ...]          // 1-8 follow-up actions for the human (e.g. "Schedule a 30-min panel with the hiring manager", "Request a writing sample")
}

# Writing rules
- executiveSummary must be neutral and evidence-based. NO "we recommend", NO "this is the strongest candidate". Just a brief, factual read of the evidence.
- keyAdvantages / keyTradeoffs / evidenceSupportingCandidacy / areasRequiringConsideration must be specific, observable, and tied to the job.
- interviewEvidenceSummary: if the candidate has no interview, write "No interview completed yet." If they have one, summarize what the interviewer observed.
- crossCandidateComparison: include one block for every unordered pair of candidates. Do NOT skip pairs.
- Each block must include at least one of: aStronger, bStronger, or meaningfulTradeoffs. An empty block is invalid.
- recommendedNextSteps must be actionable, owned by a human, and never close the decision.
- Never repeat a candidate's name as an advantage.
- Output ONLY the JSON object. No markdown. No prose.`
}

export function buildDecisionBriefUserPrompt(input: DecisionBriefPromptInput): string {
  const candSections = input.candidates.map((c, i) => {
    const ai = c.cvMatchAnalysis
    const iv = c.interview
    return `### Candidate ${i + 1}: ${c.candidateName} (id: ${c.candidateId})

Professional profile:
- Current role: ${c.professionalProfile.currentRole}
- Years of experience: ${c.professionalProfile.yearsExperience}
${c.professionalProfile.headline ? `- Headline: ${c.professionalProfile.headline}` : ''}
${c.professionalProfile.summary ? `- Summary: ${c.professionalProfile.summary}` : ''}
- Top skills: ${c.professionalProfile.topSkills.map(s => `- ${s}`).join('\n  ')}
${c.professionalProfile.education && c.professionalProfile.education.length > 0 ? `- Education: ${c.professionalProfile.education.map(e => `- ${e}`).join('\n  ')}` : ''}
${c.professionalProfile.workExperience && c.professionalProfile.workExperience.length > 0
  ? `- Work experience:\n${c.professionalProfile.workExperience.map(w => `  - ${w.title} @ ${w.company}${w.period ? ` (${w.period})` : ''}`).join('\n')}`
  : ''
}

AI CV match analysis (machine-generated):
- Overall score: ${ai.overallScore} / 100
- Breakdown: skills ${ai.skillsScore} · experience ${ai.experienceScore} · education ${ai.educationScore} · role ${ai.roleScore}
- Recommendation: ${ai.recommendation}
- Reasoning: ${ai.reasoning}
- Strengths:
${ai.strengths.map(s => `  - ${s}`).join('\n')}
- Gaps:
${ai.gaps.map(g => `  - ${g}`).join('\n')}
- Concerns:
${ai.concerns.map(c => `  - ${c}`).join('\n')}

Human interview (interviewer-generated, separate signal):
${iv
  ? `- Has interview: ${iv.hasInterview}
- Interview status: ${iv.status ?? 'unknown'}
- Has evaluation: ${iv.hasEvaluation}
- Interview score (deterministic, app-computed): ${iv.interviewScore ?? 'not yet scored'} / 100
- Interview recommendation: ${iv.recommendation ?? 'not yet recorded'}
- Overall interview score (avg criterion): ${iv.overallScore ?? 'n/a'} / 5
${iv.criterionScores ? `- Per-criterion scores:\n${Object.entries(iv.criterionScores).map(([k, v]) => `  - ${k}: ${v}/5`).join('\n')}` : ''}
${iv.strengths ? `- Interviewer strengths:\n${iv.strengths.split('\n').filter(Boolean).map(s => `  - ${s}`).join('\n')}` : ''}
${iv.concerns ? `- Interviewer concerns:\n${iv.concerns.split('\n').filter(Boolean).map(s => `  - ${s}`).join('\n')}` : ''}
${iv.overallNotes ? `- Interviewer overall notes: ${iv.overallNotes}` : ''}`
  : '- No interview scheduled or completed for this candidate.'
}`
  }).join('\n\n')

  return `Produce a Decision Brief for the following hiring request.

# JOB CONTEXT
- Job title: ${input.jobContext.jobTitle}
- Job level: ${input.jobContext.jobLevel}
- Department: ${input.hiringContext.department}
- Location: ${input.hiringContext.location ?? 'unspecified'}
- Hiring manager: ${input.hiringContext.hiringManager ?? 'unspecified'}
- Openings: ${input.hiringContext.openings} (filled: ${input.hiringContext.filled})

Job summary:
${input.jobContext.jobSummary}

Responsibilities:
${input.jobContext.responsibilities.map((r, i) => `${i + 1}. ${r}`).join('\n')}

Required skills:
${input.jobContext.requiredSkills.map(s => `- ${s}`).join('\n')}

Preferred skills:
${input.jobContext.preferredSkills.map(s => `- ${s}`).join('\n')}

Qualifications:
${input.jobContext.qualifications.map(q => `- ${q}`).join('\n')}

Experience requirements:
${input.jobContext.experienceRequirements.map(e => `- ${e}`).join('\n')}

# CANDIDATES (${input.candidates.length})
${candSections}

# RULES (recap)
- Do not name a winner.
- Do not output a single combined hireability score.
- Do not combine the AI CV match score and the human interview score mathematically.
- Cite the source of every important claim.
- Do not consider or mention any protected characteristic.
- Output ONLY the JSON object.`
}

export type { DecisionBriefOutput }
