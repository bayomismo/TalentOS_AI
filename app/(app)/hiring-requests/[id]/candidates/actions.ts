'use server'

/**
 * Sprint 6 — AI Candidate Workspace server actions.
 *
 * 1. `getCandidateWorkspaceAction` — load the Hiring Request + Job
 *    Description + ranked candidate list for the workspace page.
 * 2. `uploadCVsAction` — accept `File` objects (multipart FormData),
 *    parse them, run `analyzeCV` on each, create Candidate + skills +
 *    experiences + educations + CVFile rows, run `rankCandidate` against
 *    the JD, and return the created entities.
 * 3. `reanalyzeCandidateAction` — re-run rankCandidate for a single
 *    candidate (e.g. after the JD changes).
 * 4. `moveCandidateStageAction` — shortlist / reject / move to screening
 *    + Activity record + event bus.
 * 5. `rerankAllAction` — re-rank every candidate for a HR.
 *
 * Errors are typed via `ActionResult` and never leak raw exceptions.
 */

import { revalidatePath } from 'next/cache'

import { db } from '@/lib/db'
import { requireAuth, requirePermission, recordAuditLog } from '@/lib/auth'
import { toActionFailure } from '@/lib/auth/adapter'
import { getAIEngine } from '@/lib/ai/service/ai-engine'
import { enforceAiQuota, recordAiUsage } from '@/lib/ai/quota'
import { getFileStorage } from '@/lib/storage'
import { parseCV, CVError } from '@/lib/cv'
import { getEventBus } from '@/lib/events'
import {
  recommendationToLabel,
  type CandidateRankingOutput,
} from '@/lib/ai/schemas/candidate-ranking.schema'
import type {
  CandidateAnalyzedSnapshot,
  CandidateCreatedSnapshot,
  CandidateRankedSnapshot,
  CandidateStageChangedSnapshot,
  CVParsedSnapshot,
  CVUploadedSnapshot,
  MatchAnalysisSnapshot,
  ActivitySnapshot,
} from '@/lib/events/types'
import type { ApplicationStage, Prisma } from '@prisma/client'

// -----------------------------------------------------------------------------
// Action result helpers (same shape used by Sprint 5)
// -----------------------------------------------------------------------------

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string; retryable: boolean } }

function actionError(err: unknown): { ok: false; error: { code: string; message: string; retryable: boolean } } {
  if (err instanceof CVError) {
    return { ok: false, error: { code: err.code, message: err.message, retryable: false } }
  }
  if (err && typeof err === 'object' && 'code' in err && 'message' in err) {
    const e = err as { code?: string; message?: string; retryable?: boolean }
    return {
      ok: false,
      error: {
        code: e.code ?? 'UNKNOWN_ERROR',
        message: e.message ?? 'An unexpected error occurred.',
        retryable: e.retryable ?? false,
      },
    }
  }
  return { ok: false, error: { code: 'UNKNOWN_ERROR', message: 'An unexpected error occurred.', retryable: false } }
}

// -----------------------------------------------------------------------------
// 1. Get Candidate Workspace
// -----------------------------------------------------------------------------

export interface WorkspaceCandidate {
  id: string
  fullName: string
  email: string
  currentTitle: string | null
  yearsExperience: number | null
  topSkills: string[]
  stage: ApplicationStage
  rating: number
  matchScore: number | null
  recommendation: string | null
  recommendationReasoning: string | null
  strengths: string[]
  gaps: string[]
  concerns: string[]
  appliedAt: string
  analyzedAt: string | null
  avatar: string
  source: string | null
}

export interface WorkspacePayload {
  hiringRequest: {
    id: string
    title: string
    status: string
    department: string
    location: string | null
    openings: number
    filled: number
  }
  jobDescription: {
    id: string | null
    title: string
    summary: string | null
    requiredSkills: string[]
    niceToHave: string[]
    responsibilities: string[]
  } | null
  stats: {
    total: number
    analyzed: number
    shortlisted: number
    averageMatchScore: number | null
  }
  candidates: WorkspaceCandidate[]
}

function avatarFor(name: string): string {
  const letter = name.charAt(0).toLowerCase()
  if ('aeiou'.includes(letter)) return '👩‍💼'
  return '👨‍💼'
}

export async function getCandidateWorkspaceAction(
  hiringRequestId: string
): Promise<ActionResult<WorkspacePayload>> {
  try {
    // Sprint 9 PART 13: candidate.view permission. Tenant-scoped.
    const auth = await requirePermission('candidate.view')
    if (!auth.ok) return toActionFailure(auth)
    const orgId = auth.data.organizationId
    const hr = await db.hiringRequest.findFirst({
      where: { id: hiringRequestId, organizationId: orgId },
      include: {
        department: true,
        jobDescription: true,
        candidates: {
          orderBy: [{ matchScore: 'desc' }, { appliedAt: 'desc' }],
          include: {
            skills: { orderBy: { isPrimary: 'desc' }, take: 8 },
          },
        },
      },
    })

    if (!hr) {
      return {
        ok: false,
        error: { code: 'HR_NOT_FOUND', message: 'Hiring request not found.', retryable: false },
      }
    }

    const candidates: WorkspaceCandidate[] = hr.candidates.map(c => ({
      id: c.id,
      fullName: `${c.firstName} ${c.lastName}`,
      email: c.email,
      currentTitle: c.currentTitle,
      yearsExperience: c.yearsExperience,
      topSkills: c.skills.map(s => s.name),
      stage: c.stage,
      rating: c.rating,
      matchScore: c.matchScore,
      recommendation: c.recommendation,
      recommendationReasoning: c.recommendationReasoning,
      strengths: c.strengths,
      gaps: c.gaps,
      concerns: c.concerns,
      appliedAt: c.appliedAt.toISOString(),
      analyzedAt: c.analyzedAt?.toISOString() ?? null,
      avatar: c.avatarUrl ?? avatarFor(c.firstName),
      source: c.source,
    }))

    const analyzed = candidates.filter(c => c.matchScore !== null)
    const shortlisted = candidates.filter(
      c => c.stage === 'SCREENING' || c.stage === 'INTERVIEW' || c.stage === 'OFFER' || c.stage === 'HIRED'
    ).length
    const averageMatchScore =
      analyzed.length > 0
        ? Math.round(analyzed.reduce((sum, c) => sum + (c.matchScore ?? 0), 0) / analyzed.length)
        : null

    return {
      ok: true,
      data: {
        hiringRequest: {
          id: hr.id,
          title: hr.title,
          status: hr.status,
          department: hr.department.name,
          location: hr.location,
          openings: hr.openings,
          filled: hr.filled,
        },
        jobDescription: hr.jobDescription
          ? {
              id: hr.jobDescription.id,
              title: hr.jobDescription.title,
              summary: hr.jobDescription.summary,
              requiredSkills: hr.jobDescription.requiredSkills,
              niceToHave: hr.jobDescription.niceToHave,
              responsibilities: hr.jobDescription.responsibilities,
            }
          : null,
        stats: {
          total: candidates.length,
          analyzed: analyzed.length,
          shortlisted,
          averageMatchScore,
        },
        candidates,
      },
    }
  } catch (err) {
    return actionError(err)
  }
}

// -----------------------------------------------------------------------------
// 2. Upload CVs and create candidates
// -----------------------------------------------------------------------------

export interface UploadedCVResult {
  clientId: string
  fileName: string
  fileKind: 'PDF' | 'DOCX'
  fileSize: number
  candidate: WorkspaceCandidate | null
  error: { code: string; message: string } | null
}

export interface UploadCVsInput {
  hiringRequestId: string
  files: Array<{
    clientId: string
    fileName: string
    mimeType: string
    /** base64-encoded file bytes. */
    base64: string
  }>
}

export interface UploadCVsSuccess {
  results: UploadedCVResult[]
  created: number
  failed: number
}

/**
 * Accepts an array of base64-encoded files, parses each, runs the AI
 * analysis, creates a Candidate row + related rows (skills,
 * experiences, educations, CVFile), runs the rankCandidate AI call
 * against the JD, and persists the analysis to the candidate.
 *
 * Each file is processed independently. A failure on one file does not
 * stop the others.
 */
export async function uploadCVsAction(
  input: UploadCVsInput
): Promise<ActionResult<UploadCVsSuccess>> {
  try {
    // Sprint 9: requires cv.upload. Tenant-scoped.
    const auth = await requirePermission('cv.upload')
    if (!auth.ok) return toActionFailure(auth)
    const orgId = auth.data.organizationId
    const actorId = auth.data.userId
    const hr = await db.hiringRequest.findFirst({
      where: { id: input.hiringRequestId, organizationId: orgId },
      include: { jobDescription: true, organization: true },
    })
    if (!hr) {
      return { ok: false, error: { code: 'HR_NOT_FOUND', message: 'Hiring request not found.', retryable: false } }
    }
    if (!hr.jobDescription) {
      return {
        ok: false,
        error: {
          code: 'NO_JOB_DESCRIPTION',
          message:
            'This hiring request has no job description yet. Generate one in the AI Recruiter wizard before uploading CVs.',
          retryable: false,
        },
      }
    }

    // orgId and actorId are already in scope from the requirePermission call above.
    const storage = getFileStorage()
    const engine = getAIEngine()
    const bus = getEventBus()

    const results: UploadedCVResult[] = []
    let created = 0
    let failed = 0

    for (const f of input.files) {
      const fileName = f.fileName
      const clientId = f.clientId
      const uploadedAt = new Date()

        try {
            // Publish CVUploaded event
        bus.publish({
          type: 'CVUploaded',
          payload: {
            clientId,
            hiringRequestId: input.hiringRequestId,
            fileName,
            fileSize: Math.ceil((f.base64.length * 3) / 4),
            fileKind: 'PDF',
            uploadedAt: uploadedAt.toISOString(),
          } satisfies CVUploadedSnapshot,
        })

        const buffer = Buffer.from(f.base64, 'base64')
    
        // Parse the CV (validates file, extracts text)
        const parsed = await parseCV({
          buffer,
          fileName,
          mimeType: f.mimeType,
        })
    
        bus.publish({
          type: 'CVParsed',
          payload: {
            clientId,
            hiringRequestId: input.hiringRequestId,
            fileName,
            parsedAt: new Date().toISOString(),
            characterCount: parsed.text.length,
          } satisfies CVParsedSnapshot,
        })

        // Store bytes in memory (for the duration of this Lambda) and
        // persist only the parsed text in CVFile.parsedText.
        const storageKey = `cvs/${hr.id}/${clientId}-${fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`
        const { url: storageUrl } = await storage.put(storageKey, buffer, parsed.mimeType)
    
        // Run AI CV analysis with job context
            // Sprint 16 — per-org AI quota. Refuse if over limit.
            const quotaCheck = await enforceAiQuota(orgId, 'cv_analysis')
            if (!quotaCheck.allowed) {
              return {
                ok: false,
                error: {
                  code: 'AI_LIMIT_REACHED',
                  message: quotaCheck.message ?? 'AI limit reached for this month.',
                  retryable: false,
                },
                meta: { used: quotaCheck.used, quota: quotaCheck.quota, resetAt: quotaCheck.resetAt.toISOString() },
              }
            }
            const analysisResult = await engine.analyzeCV({
          cvText: parsed.text,
          jobContext: {
            title: hr.jobDescription.title,
            summary: hr.jobDescription.summary ?? '',
            requiredSkills: hr.jobDescription.requiredSkills,
            niceToHaveSkills: hr.jobDescription.niceToHave,
          },
        })
            await recordAiUsage({
              organizationId: orgId,
              feature: 'cv_analysis',
              tokensIn: analysisResult.usage.inputTokens,
              tokensOut: analysisResult.usage.outputTokens,
            })

        const profile = analysisResult.data
    
        // Run rank against the JD
            const rankingQuota = await enforceAiQuota(orgId, 'candidate_ranking')
            if (!rankingQuota.allowed) {
              return {
                ok: false,
                error: {
                  code: 'AI_LIMIT_REACHED',
                  message: rankingQuota.message ?? 'AI limit reached for this month.',
                  retryable: false,
                },
                meta: { used: rankingQuota.used, quota: rankingQuota.quota, resetAt: rankingQuota.resetAt.toISOString() },
              }
            }
            const rankingResult = await engine.rankCandidate({
          candidateId: '__pending__', // assigned after create
          hiringRequestId: hr.id,
          jobDescription: {
            title: hr.jobDescription.title,
            summary: hr.jobDescription.summary ?? '',
            responsibilities: hr.jobDescription.responsibilities,
            requiredSkills: hr.jobDescription.requiredSkills,
            niceToHaveSkills: hr.jobDescription.niceToHave,
            qualifications: [],
          },
          candidateProfile: {
            fullName: profile.fullName,
            currentTitle: profile.currentTitle,
            yearsExperience: profile.yearsExperience,
            summary: profile.summary,
            topSkills: profile.topSkills,
            workExperience: profile.workExperience.map(w => ({
              company: w.company,
              title: w.title,
              startDate: w.startDate,
              endDate: w.endDate ?? null,
              description: w.description ?? '',
            })),
            education: profile.education.map(e => ({
              institution: e.institution,
              degree: e.degree,
              field: e.field,
            })),
          },
        })
        const ranking: CandidateRankingOutput = rankingResult.data
        await recordAiUsage({
          organizationId: orgId,
          feature: 'candidate_ranking',
          tokensIn: rankingResult.usage.inputTokens,
          tokensOut: rankingResult.usage.outputTokens,
        })
    
        // Persist candidate + related rows in a single transaction.
        const [nameFirst, ...nameRest] = profile.fullName.trim().split(/\s+/)
        const lastName = nameRest.join(' ') || nameFirst

        // Check for an existing candidate with the same email on this HR.
        // If found, refresh their profile + re-run the analysis.
        const existing = await db.candidate.findUnique({
          where: {
            organizationId_email_hiringRequestId: {
              organizationId: orgId,
              email: profile.email,
              hiringRequestId: hr.id,
            },
          },
          select: { id: true, createdAt: true },
        })
    
        const createdRow = await db.$transaction(async tx => {
                const candidate = existing
            ? await tx.candidate.update({
                where: { id: existing.id },
                data: {
                  firstName: nameFirst!,
                  lastName,
                  phone: profile.phone ?? null,
                  location: profile.location ?? null,
                  headline: profile.currentTitle,
                  currentTitle: profile.currentTitle,
                  yearsExperience: profile.yearsExperience,
                  summary: profile.summary,
                  source: 'CV Upload',
                  sourceDetails: fileName,
                  // Use the AI-recommended stage as the starting point, except
                  // for the rejected case (we still create the row, but flagged).
                  stage: profile.recommendedStage === 'REJECTED' ? 'REJECTED' : 'APPLIED',
                  // AI analysis (Sprint 6)
                  matchScore: ranking.overallScore,
                  matchScoreBreakdown: {
                    skills: ranking.skillsScore,
                    experience: ranking.experienceScore,
                    education: ranking.educationScore,
                    role: ranking.roleScore,
                  } as Prisma.InputJsonValue,
                  recommendation: recommendationToLabel(ranking.recommendation),
                  recommendationReasoning: ranking.reasoning,
                  strengths: ranking.strengths,
                  gaps: ranking.gaps,
                  concerns: ranking.concerns,
                  analyzedAt: new Date(),
                },
              })
            : await tx.candidate.create({
                data: {
                  organizationId: orgId,
                  hiringRequestId: hr.id,
                  firstName: nameFirst!,
                  lastName,
                  email: profile.email,
                  phone: profile.phone ?? null,
                  location: profile.location ?? null,
                  headline: profile.currentTitle,
                  currentTitle: profile.currentTitle,
                  yearsExperience: profile.yearsExperience,
                  summary: profile.summary,
                  source: 'CV Upload',
                  sourceDetails: fileName,
                  stage: profile.recommendedStage === 'REJECTED' ? 'REJECTED' : 'APPLIED',
                  // AI analysis (Sprint 6)
                  matchScore: ranking.overallScore,
                  matchScoreBreakdown: {
                    skills: ranking.skillsScore,
                    experience: ranking.experienceScore,
                    education: ranking.educationScore,
                    role: ranking.roleScore,
                  } as Prisma.InputJsonValue,
                  recommendation: recommendationToLabel(ranking.recommendation),
                  recommendationReasoning: ranking.reasoning,
                  strengths: ranking.strengths,
                  gaps: ranking.gaps,
                  concerns: ranking.concerns,
                  analyzedAt: new Date(),
                  // Use the AI-recommended stage as the starting point, except
                  // for the rejected case (we still create the row, but flagged).
                },
              })
      
          // If re-uploading, wipe the old related rows so the new
          // analysis fully replaces the old profile.
          if (existing) {
            await tx.candidateSkill.deleteMany({ where: { candidateId: candidate.id } })
            await tx.candidateExperience.deleteMany({ where: { candidateId: candidate.id } })
            await tx.candidateEducation.deleteMany({ where: { candidateId: candidate.id } })
            await tx.candidateCertification.deleteMany({ where: { candidateId: candidate.id } })
            // Don't delete CVFiles — keep history.
          }

                // Skills
          if (profile.topSkills.length > 0) {
            await tx.candidateSkill.createMany({
              data: profile.topSkills.map((name, idx) => ({
                candidateId: candidate.id,
                name,
                isPrimary: idx < 5,
                level: 'INTERMEDIATE',
              })),
            })
          }

          // Work experience
          for (const exp of profile.workExperience) {
            const start = parseDateLoose(exp.startDate)
            const end = exp.endDate && exp.endDate.toLowerCase() !== 'present' ? parseDateLoose(exp.endDate) : null
            if (!start) continue
            await tx.candidateExperience.create({
              data: {
                candidateId: candidate.id,
                company: exp.company,
                title: exp.title,
                location: exp.location ?? null,
                startDate: start,
                endDate: end,
                isCurrent: !end,
                description: exp.description ?? null,
              },
            })
          }

          // Education
          for (const ed of profile.education) {
            const start = ed.startYear ? parseDateLoose(ed.startYear) : null
            const end = ed.endYear ? parseDateLoose(ed.endYear) : null
            await tx.candidateEducation.create({
              data: {
                candidateId: candidate.id,
                institution: ed.institution,
                degree: 'OTHER' as const,
                field: ed.field,
                startDate: start,
                endDate: end,
              },
            })
          }

          // Certifications
          for (const cert of profile.certifications) {
            const issueDate = cert.year ? parseDateLoose(cert.year) : null
            await tx.candidateCertification.create({
              data: {
                candidateId: candidate.id,
                name: cert.name,
                issuer: cert.issuer,
                issueDate,
              },
            })
          }

                // CVFile row (text + metadata, no bytes)
          await tx.cVFile.create({
            data: {
              candidateId: candidate.id,
              fileType: parsed.fileKind,
              fileName,
              fileSize: parsed.size,
              storageUrl,
              storagePath: storageKey,
              mimeType: parsed.mimeType,
              parsedText: parsed.text.slice(0, 50_000), // truncate to fit column
              parsedData: profile as unknown as Prisma.InputJsonValue,
            },
          })

                // Activity
                await tx.activity.create({
            data: {
              organizationId: orgId,
              type: 'CANDIDATE_ADDED',
              actorId,
              candidateId: candidate.id,
              hiringRequestId: hr.id,
              title: `New candidate — ${profile.fullName}`,
              description: `Uploaded from ${fileName}. AI score: ${ranking.overallScore} (${recommendationToLabel(ranking.recommendation)}).`,
            },
          })
      
          return candidate
        })
    
            const workspace: WorkspaceCandidate = {
          id: createdRow.id,
          fullName: `${createdRow.firstName} ${createdRow.lastName}`,
          email: createdRow.email,
          currentTitle: createdRow.currentTitle,
          yearsExperience: createdRow.yearsExperience,
          topSkills: profile.topSkills,
          stage: createdRow.stage,
          rating: createdRow.rating,
          matchScore: createdRow.matchScore,
          recommendation: createdRow.recommendation,
          recommendationReasoning: createdRow.recommendationReasoning,
          strengths: createdRow.strengths,
          gaps: createdRow.gaps,
          concerns: createdRow.concerns,
          appliedAt: createdRow.appliedAt.toISOString(),
          analyzedAt: createdRow.analyzedAt?.toISOString() ?? null,
          avatar: createdRow.avatarUrl ?? avatarFor(createdRow.firstName),
          source: createdRow.source,
        }

            bus.publish({
          type: 'CandidateCreated',
          payload: {
            id: createdRow.id,
            hiringRequestId: hr.id,
            fullName: workspace.fullName,
            email: workspace.email,
            currentTitle: workspace.currentTitle ?? '',
            yearsExperience: workspace.yearsExperience ?? 0,
            createdAt: createdRow.createdAt.toISOString(),
          } satisfies CandidateCreatedSnapshot,
        })

        const analysis: MatchAnalysisSnapshot = {
          overallScore: ranking.overallScore,
          skillsScore: ranking.skillsScore,
          experienceScore: ranking.experienceScore,
          educationScore: ranking.educationScore,
          roleScore: ranking.roleScore,
          recommendation: ranking.recommendation,
          recommendationLabel: recommendationToLabel(ranking.recommendation),
          reasoning: ranking.reasoning,
          strengths: ranking.strengths,
          gaps: ranking.gaps,
          concerns: ranking.concerns,
          analyzedAt: createdRow.analyzedAt!.toISOString(),
        }
            bus.publish({
          type: 'CandidateAnalyzed',
          payload: {
            candidateId: createdRow.id,
            hiringRequestId: hr.id,
            fullName: workspace.fullName,
            analysis,
          } satisfies CandidateAnalyzedSnapshot,
        })

            results.push({
          clientId,
          fileName,
          fileKind: parsed.fileKind,
          fileSize: parsed.size,
          candidate: workspace,
          error: null,
        })
        created++
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to process CV.'
        const code =
          err && typeof err === 'object' && 'code' in err
            ? (err as { code?: string }).code ?? 'CV_FAILED'
            : 'CV_FAILED'
        console.error('[uploadCVsAction] per-file error:', fileName, err)
        results.push({
          clientId,
          fileName,
          fileKind: 'PDF',
          fileSize: 0,
          candidate: null,
          error: { code: code ?? 'CV_FAILED', message },
        })
        failed++
      }
    }

    try {
      revalidatePath(`/hiring-requests/${input.hiringRequestId}/candidates`)
      revalidatePath('/hiring-requests')
      revalidatePath('/candidates')
    } catch {
      // revalidatePath throws when called outside a Next.js request context
      // (e.g. from CLI scripts). Swallow — the DB write is the source of
      // truth, and the next request re-fetches anyway.
    }
    // Publish a single rank update for the workspace
    const ranked: CandidateRankedSnapshot = {
      hiringRequestId: input.hiringRequestId,
      rankings: results
        .filter(r => r.candidate)
        .map(r => ({
          candidateId: r.candidate!.id,
          fullName: r.candidate!.fullName,
          overallScore: r.candidate!.matchScore ?? 0,
          recommendation: r.candidate!.recommendation ?? '—',
        })),
      rankedAt: new Date().toISOString(),
    }
    bus.publish({ type: 'CandidateRanked', payload: ranked })

    return {
      ok: true,
      data: { results, created, failed },
    }
  } catch (err) {
    return actionError(err)
  }
}

// -----------------------------------------------------------------------------
// 3. Re-analyze a single candidate
// -----------------------------------------------------------------------------

export interface ReanalyzeCandidateSuccess {
  candidate: WorkspaceCandidate
}

export async function reanalyzeCandidateAction(
  candidateId: string
): Promise<ActionResult<ReanalyzeCandidateSuccess>> {
  try {
    // Sprint 9: requires ai.analyze_candidate. Tenant-scoped.
    const auth = await requirePermission('ai.analyze_candidate')
    if (!auth.ok) return toActionFailure(auth)
    const orgId = auth.data.organizationId
    const candidate = await db.candidate.findFirst({
      where: { id: candidateId, organizationId: orgId },
      include: {
        skills: true,
        experiences: true,
        educations: true,
        hiringRequest: { include: { jobDescription: true } },
      },
    })
    if (!candidate) {
      return { ok: false, error: { code: 'CANDIDATE_NOT_FOUND', message: 'Candidate not found.', retryable: false } }
    }
    if (!candidate.hiringRequest.jobDescription) {
      return { ok: false, error: { code: 'NO_JOB_DESCRIPTION', message: 'Hiring request has no job description.', retryable: false } }
    }
    const jd = candidate.hiringRequest.jobDescription

    const engine = getAIEngine()

    // Sprint 16 — per-org AI quota. Refuse if over limit.
    const quotaCheck = await enforceAiQuota(orgId, 'candidate_ranking')
    if (!quotaCheck.allowed) {
      return {
        ok: false,
        error: {
          code: 'AI_LIMIT_REACHED',
          message: quotaCheck.message ?? 'AI limit reached for this month.',
          retryable: false,
        },
        meta: { used: quotaCheck.used, quota: quotaCheck.quota, resetAt: quotaCheck.resetAt.toISOString() },
      }
    }

    const ranking = await engine.rankCandidate({
      candidateId: candidate.id,
      hiringRequestId: candidate.hiringRequestId,
      jobDescription: {
        title: jd.title,
        summary: jd.summary ?? '',
        responsibilities: jd.responsibilities,
        requiredSkills: jd.requiredSkills,
        niceToHaveSkills: jd.niceToHave,
        qualifications: [],
      },
      candidateProfile: {
        fullName: `${candidate.firstName} ${candidate.lastName}`,
        currentTitle: candidate.currentTitle ?? '',
        yearsExperience: candidate.yearsExperience ?? 0,
        summary: candidate.summary ?? '',
        topSkills: candidate.skills.map(s => s.name),
        workExperience: candidate.experiences.map(e => ({
          company: e.company,
          title: e.title,
          startDate: e.startDate.toISOString().slice(0, 10),
          endDate: e.endDate?.toISOString().slice(0, 10) ?? null,
          description: e.description ?? '',
        })),
        education: candidate.educations.map(e => ({
          institution: e.institution,
          degree: e.degree,
          field: e.field,
        })),
      },
    })

    await recordAiUsage({
      organizationId: orgId,
      feature: 'candidate_ranking',
      tokensIn: ranking.usage.inputTokens,
      tokensOut: ranking.usage.outputTokens,
    })

    await db.candidate.update({
      where: { id: candidate.id },
      data: {
        matchScore: ranking.data.overallScore,
        matchScoreBreakdown: {
          skills: ranking.data.skillsScore,
          experience: ranking.data.experienceScore,
          education: ranking.data.educationScore,
          role: ranking.data.roleScore,
        } as Prisma.InputJsonValue,
        recommendation: recommendationToLabel(ranking.data.recommendation),
        recommendationReasoning: ranking.data.reasoning,
        strengths: ranking.data.strengths,
        gaps: ranking.data.gaps,
        concerns: ranking.data.concerns,
        analyzedAt: new Date(),
      },
    })

    try {
      revalidatePath(`/hiring-requests/${candidate.hiringRequestId}/candidates`)
      revalidatePath(`/candidates/${candidate.id}`)
    } catch {
      // see uploadCVsAction for why we swallow
    }

    const workspace: WorkspaceCandidate = {
      id: candidate.id,
      fullName: `${candidate.firstName} ${candidate.lastName}`,
      email: candidate.email,
      currentTitle: candidate.currentTitle,
      yearsExperience: candidate.yearsExperience,
      topSkills: candidate.skills.map(s => s.name),
      stage: candidate.stage,
      rating: candidate.rating,
      matchScore: ranking.data.overallScore,
      recommendation: recommendationToLabel(ranking.data.recommendation),
      recommendationReasoning: ranking.data.reasoning,
      strengths: ranking.data.strengths,
      gaps: ranking.data.gaps,
      concerns: ranking.data.concerns,
      appliedAt: candidate.appliedAt.toISOString(),
      analyzedAt: new Date().toISOString(),
      avatar: candidate.avatarUrl ?? avatarFor(candidate.firstName),
      source: candidate.source,
    }

    return { ok: true, data: { candidate: workspace } }
  } catch (err) {
    return actionError(err)
  }
}

// -----------------------------------------------------------------------------
// 4. Move candidate stage
// -----------------------------------------------------------------------------

export interface MoveCandidateStageInput {
  candidateId: string
  toStage: ApplicationStage
}

export interface MoveCandidateStageSuccess {
  candidate: WorkspaceCandidate
  activity: ActivitySnapshot
}

const STAGE_TO_ACTIVITY: Partial<Record<ApplicationStage, 'CANDIDATE_MOVED' | 'REJECTED'>> = {
  SCREENING: 'CANDIDATE_MOVED',
  INTERVIEW: 'CANDIDATE_MOVED',
  OFFER: 'CANDIDATE_MOVED',
  HIRED: 'CANDIDATE_MOVED',
  REJECTED: 'REJECTED',
  WITHDRAWN: 'CANDIDATE_MOVED',
}

export async function moveCandidateStageAction(
  input: MoveCandidateStageInput
): Promise<ActionResult<MoveCandidateStageSuccess>> {
  try {
    // Sprint 9: requires candidate.change_stage. Tenant-scoped.
    const auth = await requirePermission('candidate.change_stage')
    if (!auth.ok) return toActionFailure(auth)
    const orgId = auth.data.organizationId
    const actorId = auth.data.userId
    const candidate = await db.candidate.findFirst({
      where: { id: input.candidateId, organizationId: orgId },
      include: { hiringRequest: true, skills: true },
    })
    if (!candidate) {
      return { ok: false, error: { code: 'CANDIDATE_NOT_FOUND', message: 'Candidate not found.', retryable: false } }
    }

    const updated = await db.$transaction(async tx => {
      const u = await tx.candidate.update({
        where: { id: candidate.id },
        data: {
          stage: input.toStage,
          rejectedAt: input.toStage === 'REJECTED' ? new Date() : null,
          hiredAt: input.toStage === 'HIRED' ? new Date() : null,
          withdrawnAt: input.toStage === 'WITHDRAWN' ? new Date() : null,
          lastActivityAt: new Date(),
        },
      })

      const activity = await tx.activity.create({
        data: {
          organizationId: candidate.organizationId,
          type: STAGE_TO_ACTIVITY[input.toStage] ?? 'CANDIDATE_MOVED',
          actorId,
          candidateId: candidate.id,
          hiringRequestId: candidate.hiringRequestId,
          title: `${u.firstName} ${u.lastName} → ${input.toStage.toLowerCase()}`,
          description: `Moved from ${candidate.stage} to ${input.toStage}.`,
        },
        include: { actor: true },
      })

      return { u, activity }
    })

    try {
      revalidatePath(`/hiring-requests/${candidate.hiringRequestId}/candidates`)
      revalidatePath(`/candidates/${candidate.id}`)
    } catch {
      // see uploadCVsAction for why we swallow
    }

    const actorName = updated.activity.actor
      ? `${updated.activity.actor.firstName} ${updated.activity.actor.lastName}`
      : null
    const activity: ActivitySnapshot = {
      id: updated.activity.id,
      type: updated.activity.type,
      title: updated.activity.title,
      description: updated.activity.description,
      actorName,
      candidateName: `${updated.u.firstName} ${updated.u.lastName}`,
      occurredAt: updated.activity.occurredAt.toISOString(),
    }

    const bus = getEventBus()
    bus.publish({
      type: 'CandidateStageChanged',
      payload: {
        candidateId: candidate.id,
        hiringRequestId: candidate.hiringRequestId,
        fullName: `${updated.u.firstName} ${updated.u.lastName}`,
        fromStage: candidate.stage,
        toStage: input.toStage,
        changedAt: updated.activity.occurredAt.toISOString(),
        actorName,
      } satisfies CandidateStageChangedSnapshot,
    })
    bus.publish({ type: 'ActivityRecorded', payload: { activity } })

    const workspace: WorkspaceCandidate = {
      id: updated.u.id,
      fullName: `${updated.u.firstName} ${updated.u.lastName}`,
      email: updated.u.email,
      currentTitle: updated.u.currentTitle,
      yearsExperience: updated.u.yearsExperience,
      topSkills: candidate.skills.map(s => s.name),
      stage: updated.u.stage,
      rating: updated.u.rating,
      matchScore: updated.u.matchScore,
      recommendation: updated.u.recommendation,
      recommendationReasoning: updated.u.recommendationReasoning,
      strengths: updated.u.strengths,
      gaps: updated.u.gaps,
      concerns: updated.u.concerns,
      appliedAt: updated.u.appliedAt.toISOString(),
      analyzedAt: updated.u.analyzedAt?.toISOString() ?? null,
      avatar: updated.u.avatarUrl ?? avatarFor(updated.u.firstName),
      source: updated.u.source,
    }

    return { ok: true, data: { candidate: workspace, activity } }
  } catch (err) {
    return actionError(err)
  }
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

/**
 * Best-effort parser for partial dates like `2024`, `2024-03`, `2024-03-15`,
 * `Mar 2020`, etc. Returns `null` if nothing parseable is found.
 *
 * Always returns the first day of the month / year.
 */
function parseDateLoose(s: string): Date | null {
  if (!s) return null
  const trimmed = s.trim()

  // ISO date
  const iso = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/.exec(trimmed)
  if (iso) {
    const year = parseInt(iso[1]!, 10)
    const month = iso[2] ? parseInt(iso[2], 10) - 1 : 0
    const day = iso[3] ? parseInt(iso[3], 10) : 1
    const d = new Date(Date.UTC(year, month, day))
    return isNaN(d.getTime()) ? null : d
  }

  // "Mar 2020" / "March 2020"
  const monthYear = /^([A-Za-z]{3,9})\s+(\d{4})$/.exec(trimmed)
  if (monthYear) {
    const monthIdx = [
      'jan', 'feb', 'mar', 'apr', 'may', 'jun',
      'jul', 'aug', 'sep', 'oct', 'nov', 'dec',
    ].indexOf(monthYear[1]!.toLowerCase().slice(0, 3))
    if (monthIdx >= 0) {
      const d = new Date(Date.UTC(parseInt(monthYear[2]!, 10), monthIdx, 1))
      return isNaN(d.getTime()) ? null : d
    }
  }

  return null
}

