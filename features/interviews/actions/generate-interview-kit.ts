'use server'

/**
 * Sprint 8 — server action: generate (or re-generate) a candidate's
 * personalized interview kit. Thin wrapper around the service.
 */

import { generateInterviewKitService } from '../services/interview-kit-service'
import type { ActionResult, GenerateInterviewKitInput, InterviewKitView } from '../types'

export async function generateInterviewKitAction(
  input: GenerateInterviewKitInput
): Promise<ActionResult<{ interviewId: string; kit: InterviewKitView }>> {
  return generateInterviewKitService(input)
}
