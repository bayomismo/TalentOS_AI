'use server'

/**
 * Candidate detail server action.
 *
 * Returns the full candidate profile + AI match analysis (if the candidate
 * was created or analyzed via the AI Recruiter workspace).
 */

import { db } from '@/lib/db'

export interface MatchAnalysisBlock {
  overallScore: number
  skillsScore: number
  experienceScore: number
  educationScore: number
  roleScore: number
  recommendation: string | null
  reasoning: string | null
  strengths: string[]
  gaps: string[]
  concerns: string[]
  analyzedAt: string | null
}

export interface CandidateExperience {
  company: string
  title: string
  startDate: string
  endDate: string | null
  isCurrent: boolean
  location: string | null
  description: string | null
}

export interface CandidateEducation {
  institution: string
  degree: string
  field: string
  startDate: string | null
  endDate: string | null
}

export interface CandidateCertification {
  name: string
  issuer: string
  issueDate: string | null
}

export interface CandidateCVFile {
  id: string
  fileName: string
  fileType: string
  fileSize: number
  uploadedAt: string
}

export interface CandidateDetail {
  id: string
  name: string
  email: string
  phone: string | null
  position: string
  stage:
    | 'applied'
    | 'screening'
    | 'interview'
    | 'offer'
    | 'hired'
    | 'rejected'
    | 'withdrawn'
  rating: number
  source: string | null
  appliedAt: string
  location: string | null
  avatar: string
  jobDescriptionSummary: string | null
  department: string
  currentTitle: string | null
  yearsExperience: number | null
  summary: string | null
  skills: string[]
  experiences: CandidateExperience[]
  educations: CandidateEducation[]
  certifications: CandidateCertification[]
  cvFiles: CandidateCVFile[]
  analysis: MatchAnalysisBlock | null
}

export async function getCandidateDetailAction(id: string): Promise<CandidateDetail | null> {
  const c = await db.candidate.findUnique({
    where: { id },
    include: {
      skills: { orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }] },
      experiences: { orderBy: { startDate: 'desc' } },
      educations: { orderBy: { endDate: 'desc' } },
      certifications: { orderBy: { issueDate: 'desc' } },
      cvFiles: { orderBy: { uploadedAt: 'desc' } },
      hiringRequest: {
        select: {
          title: true,
          department: { select: { name: true } },
          jobDescription: { select: { summary: true } },
        },
      },
    },
  })

  if (!c) return null

  const breakdown = (c.matchScoreBreakdown as Record<string, number> | null) ?? null
  const analysis: MatchAnalysisBlock | null =
    c.matchScore === null
      ? null
      : {
          overallScore: c.matchScore,
          skillsScore: breakdown?.skills ?? 0,
          experienceScore: breakdown?.experience ?? 0,
          educationScore: breakdown?.education ?? 0,
          roleScore: breakdown?.role ?? 0,
          recommendation: c.recommendation,
          reasoning: c.recommendationReasoning,
          strengths: c.strengths,
          gaps: c.gaps,
          concerns: c.concerns,
          analyzedAt: c.analyzedAt?.toISOString() ?? null,
        }

  return {
    id: c.id,
    name: `${c.firstName} ${c.lastName}`,
    email: c.email,
    phone: c.phone,
    position: c.hiringRequest.title,
    stage: c.stage.toLowerCase() as CandidateDetail['stage'],
    rating: c.rating,
    source: c.source,
    appliedAt: c.appliedAt.toISOString(),
    location: c.location,
    avatar: c.avatarUrl ?? '👤',
    jobDescriptionSummary: c.hiringRequest.jobDescription?.summary ?? null,
    department: c.hiringRequest.department.name,
    currentTitle: c.currentTitle,
    yearsExperience: c.yearsExperience,
    summary: c.summary,
    skills: c.skills.map(s => s.name),
    experiences: c.experiences.map(e => ({
      company: e.company,
      title: e.title,
      startDate: e.startDate.toISOString(),
      endDate: e.endDate?.toISOString() ?? null,
      isCurrent: e.isCurrent,
      location: e.location,
      description: e.description,
    })),
    educations: c.educations.map(e => ({
      institution: e.institution,
      degree: e.degree,
      field: e.field,
      startDate: e.startDate?.toISOString() ?? null,
      endDate: e.endDate?.toISOString() ?? null,
    })),
    certifications: c.certifications.map(cert => ({
      name: cert.name,
      issuer: cert.issuer,
      issueDate: cert.issueDate?.toISOString() ?? null,
    })),
    cvFiles: c.cvFiles.map(f => ({
      id: f.id,
      fileName: f.fileName,
      fileType: f.fileType,
      fileSize: f.fileSize,
      uploadedAt: f.uploadedAt.toISOString(),
    })),
    analysis,
  }
}
