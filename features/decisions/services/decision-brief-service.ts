/**
 * Sprint 8 — Decision Brief service.
 *
 * Orchestrates:
 *  - Build the AI input from the persisted candidates + their interviews
 *  - Call the engine
 *  - Persist the result to AITask
 *  - Publish events + activities
 *
 * Server actions are thin wrappers around this service.
 */

import { db } from '@/lib/db'
import { getAIEngine } from '@/lib/ai/service/ai-engine'
import { getEventBus } from '@/lib/events'
import {
  buildDecisionBriefSystemPrompt,
  buildDecisionBriefUserPrompt,
} from '@/lib/ai/prompts/decision-brief'
import {
  persistDecisionBriefTask,
  createDecisionActivity,
} from '../repositories/decision-repository'
import type { ActionResult, DecisionBriefSummary } from '../types'

function safeRevalidate(_path: string): void {
  // no-op; revalidate happens at the action layer
}

function activitySnapshot(a: { id: string; type: string; title: string; description: string | null; occurredAt: Date }) {
  return {
    id: a.id,
    type: a.type,
    title: a.title,
    description: a.description,
    actorName: null,
    candidateName: null,
    occurredAt: a.occurredAt.toISOString(),
  }
}

export async function generateDecisionBriefService(input: {
  hiringRequestId: string
  organizationId: string
  candidateIds: string[]
  actorId: string
}): Promise<ActionResult<DecisionBriefSummary>> {
  const bus = getEventBus()
  try {
    if (input.candidateIds.length < 2) {
      return { ok: false, error: { code: 'TOO_FEW_CANDIDATES', message: 'Decision Brief requires at least 2 candidates.', retryable: false } }
    }
    if (input.candidateIds.length > 4) {
      return { ok: false, error: { code: 'TOO_MANY_CANDIDATES', message: 'Decision Brief accepts at most 4 candidates.', retryable: false } }
    }
    const hr = await db.hiringRequest.findUnique({
      where: { id: input.hiringRequestId },
      include: { department: true, hiringManager: { select: { firstName: true, lastName: true } }, jobDescription: true },
    })
    if (!hr) {
      return { ok: false, error: { code: 'HR_NOT_FOUND', message: 'Hiring request not found.', retryable: false } }
    }
    if (!hr.jobDescription) {
      return { ok: false, error: { code: 'NO_JD', message: 'Hiring request has no job description.', retryable: false } }
    }
    const jd = hr.jobDescription

    const candidates = await db.candidate.findMany({
      where: { id: { in: input.candidateIds }, hiringRequestId: hr.id },
      include: {
        skills: { orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }] },
        experiences: { orderBy: { startDate: 'desc' }, take: 5 },
        educations: { take: 3 },
        certifications: { take: 5 },
        interviews: {
          orderBy: { scheduledAt: 'desc' },
          take: 1,
          include: {
            evaluations: { orderBy: { submittedAt: 'desc' }, take: 1 },
          },
        },
      },
    })
    if (candidates.length !== input.candidateIds.length) {
      return {
        ok: false,
        error: {
          code: 'CANDIDATE_MISMATCH',
          message: 'One or more candidates do not belong to this hiring request.',
          retryable: false,
        },
      }
    }

    const engineInput = {
      jobContext: {
        jobTitle: hr.title,
        jobLevel: hr.level,
        jobSummary: jd.summary ?? jd.description,
        responsibilities: jd.responsibilities,
        requiredSkills: jd.requiredSkills,
        preferredSkills: jd.niceToHave,
        qualifications: jd.requiredSkills,
        experienceRequirements: jd.responsibilities,
      },
      hiringContext: {
        openings: hr.openings,
        filled: hr.filled,
        department: hr.department.name,
        location: hr.location,
        hiringManager: hr.hiringManager ? `${hr.hiringManager.firstName} ${hr.hiringManager.lastName}` : null,
      },
      candidates: candidates.map(c => {
        const latestInterview = c.interviews[0] ?? null
        const evalRow = latestInterview?.evaluations[0] ?? null
        const breakdown = c.matchScoreBreakdown as { skills?: number; experience?: number; roleAlignment?: number; education?: number } | null
        return {
          candidateId: c.id,
          candidateName: `${c.firstName} ${c.lastName}`,
          professionalProfile: {
            currentRole: c.currentTitle ?? 'Unknown',
            yearsExperience: c.yearsExperience ?? 0,
            topSkills: c.skills.map(s => s.name),
            summary: c.summary ?? undefined,
            education: c.educations.map(e => `${e.degree}${e.field ? `, ${e.field}` : ''} — ${e.institution}`),
            workExperience: c.experiences.map(e => ({
              company: e.company,
              title: e.title,
              period: e.endDate
                ? `${e.startDate?.getFullYear() ?? '?'}–${e.endDate.getFullYear() ?? 'present'}`
                : undefined,
            })),
          },
          cvMatchAnalysis: {
            overallScore: c.matchScore ?? 0,
            skillsScore: breakdown?.skills ?? 0,
            experienceScore: breakdown?.experience ?? 0,
            educationScore: breakdown?.education ?? 0,
            roleScore: breakdown?.roleAlignment ?? 0,
            recommendation: c.recommendation ?? 'POTENTIAL_MATCH',
            reasoning: c.recommendationReasoning ?? '',
            strengths: c.strengths,
            gaps: c.gaps,
            concerns: c.concerns,
          },
          interview: latestInterview
            ? {
                hasInterview: true,
                status: latestInterview.status,
                interviewScore: evalRow?.interviewScore ?? null,
                recommendation: evalRow?.recommendation ?? null,
                overallScore: evalRow?.overallScore ?? null,
                criterionScores: (evalRow?.criterionScores as Record<string, number> | null) ?? undefined,
                strengths: evalRow?.strengths ?? undefined,
                concerns: evalRow?.weaknesses ?? undefined,
                overallNotes: evalRow?.overallNotes ?? undefined,
                hasEvaluation: !!evalRow,
              }
            : {
                hasInterview: false,
                hasEvaluation: false,
                interviewScore: null,
                recommendation: null,
                overallScore: null,
              },
        }
      }),
    }

    const systemPrompt = buildDecisionBriefSystemPrompt()
    const userPrompt = buildDecisionBriefUserPrompt(engineInput)
    const fullPrompt = `${systemPrompt}\n\n# USER REQUEST\n${userPrompt}`

    const engineResult = await getAIEngine().generateDecisionBrief(engineInput)
    const output = engineResult.data
    const task = await persistDecisionBriefTask({
      organizationId: hr.organizationId,
      hiringRequestId: hr.id,
      createdById: input.actorId,
      comparedCandidateIds: input.candidateIds,
      output,
      prompt: fullPrompt,
      rawText: engineResult.raw ?? '',
      modelUsed: engineResult.model ?? null,
      inputTokens: engineResult.usage?.inputTokens ?? null,
      outputTokens: engineResult.usage?.outputTokens ?? null,
      durationMs: engineResult.latencyMs ?? null,
    })

    const actorId = task.createdById ?? input.actorId
    const activity = await createDecisionActivity({
      organizationId: hr.organizationId,
      type: 'DECISION_BRIEF_GENERATED',
      actorId,
      candidateId: candidates[0].id, // Brief is HR-scoped, not candidate-scoped; we anchor to the first candidate
      hiringRequestId: hr.id,
      title: `AI Decision Brief generated for ${candidates.length} candidate${candidates.length === 1 ? '' : 's'}`,
      description: `Compared: ${candidates.map(c => `${c.firstName} ${c.lastName}`).join(', ')}`,
      metadata: {
        taskId: task.id,
        candidateIds: input.candidateIds,
        modelUsed: engineResult.model ?? null,
      },
    })
    bus.publish({
      type: 'ActivityRecorded',
      payload: { activity: activitySnapshot({ ...activity, occurredAt: activity.occurredAt }) },
    })
    // Sprint 8 event: dedicated DecisionBriefGenerated
    bus.publish({
      type: 'DecisionBriefGenerated',
      payload: {
        taskId: task.id,
        hiringRequestId: hr.id,
        candidateIds: input.candidateIds,
        generatedAt: (task.completedAt ?? task.createdAt).toISOString(),
        modelUsed: engineResult.model ?? null,
      },
    })

    return {
      ok: true,
      data: {
        id: task.id,
        hiringRequestId: hr.id,
        comparedCandidateIds: input.candidateIds,
        output,
        modelUsed: engineResult.model ?? null,
        createdAt: (task.completedAt ?? task.createdAt).toISOString(),
        createdByName: task.createdBy ? `${task.createdBy.firstName} ${task.createdBy.lastName}` : null,
      },
    }
  } catch (err) {
    return {
      ok: false,
      error: {
        code: 'INTERNAL',
        message: 'Failed to generate Decision Brief.',
        retryable: true,
        details: err instanceof Error ? err.message : String(err),
      },
    }
  }
}
