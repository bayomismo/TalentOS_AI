import type { HiringPackage } from '../types'

export const SENIOR_FRONTEND_PACKAGE: HiringPackage = {
  role: 'Senior Frontend Developer',
  department: 'Engineering',
  level: 'Senior (IC4)',
  jobDescription: `We're looking for a Senior Frontend Developer to join our product engineering team and help shape the next generation of TalentOS. You'll own complex UI features end-to-end — from architecture and implementation to performance and accessibility — while mentoring engineers and raising the bar on frontend craft across the org.

You'll work closely with design, product, and backend teams in a fast-moving environment where quality and velocity both matter. This is a high-impact role for someone who loves building polished, scalable interfaces and cares deeply about developer experience.`,
  responsibilities: [
    'Lead frontend architecture for major product surfaces and shared component systems',
    'Build performant, accessible React applications with TypeScript and modern tooling',
    'Partner with design to translate Figma specs into pixel-perfect, responsive UI',
    'Establish frontend best practices: testing, code review standards, and CI pipelines',
    'Mentor mid-level and junior engineers through pairing and technical guidance',
    'Drive performance optimization — Core Web Vitals, bundle size, and runtime efficiency',
    'Collaborate with backend on API contracts and real-time data patterns',
  ],
  requiredSkills: [
    '5+ years of professional frontend development experience',
    'Expert-level React and TypeScript proficiency',
    'Deep knowledge of CSS, responsive design, and accessibility (WCAG 2.1)',
    'Experience with state management (Zustand, Redux, or similar)',
    'Strong understanding of web performance and browser rendering',
    'Proficiency with Git, code review, and agile workflows',
    'Excellent communication and cross-functional collaboration',
  ],
  niceToHave: [
    'Experience with Next.js App Router and Server Components',
    'Familiarity with design systems (shadcn/ui, Radix, Storybook)',
    'Background in HR tech, SaaS, or B2B enterprise products',
    'Experience with Framer Motion or animation libraries',
    'Contributions to open-source frontend projects',
    'Knowledge of GraphQL or tRPC for type-safe APIs',
  ],
  screeningQuestions: [
    'Walk me through a complex frontend feature you owned from design to production.',
    'How do you approach performance optimization when users report slow page loads?',
    'Describe your experience building and maintaining a component library or design system.',
    'What does accessibility mean to you, and how do you bake it into your workflow?',
    'Tell me about a time you had to push back on a design or product decision for technical reasons.',
  ],
  interviewQuestions: [
    {
      category: 'Technical Deep Dive',
      questions: [
        'Explain how React reconciliation works and when you would use useMemo vs useCallback.',
        'Design a real-time collaborative document editor UI. What architecture would you choose?',
        'How would you debug a memory leak in a long-running SPA?',
      ],
    },
    {
      category: 'System Design',
      questions: [
        'Design the frontend architecture for a multi-tenant SaaS dashboard with 50+ routes.',
        'How would you implement optimistic updates for a kanban board with drag-and-drop?',
        'Walk through your approach to code-splitting and lazy loading in a Next.js app.',
      ],
    },
    {
      category: 'Behavioral & Leadership',
      questions: [
        'Tell me about a time you mentored someone who was struggling with frontend concepts.',
        'Describe a situation where you had to deliver under a tight deadline without cutting quality.',
        'How do you stay current with the rapidly evolving frontend ecosystem?',
      ],
    },
  ],
  scorecard: [
    {
      category: 'React & TypeScript Mastery',
      weight: 25,
      indicators: [
        'Writes clean, type-safe component APIs',
        'Understands hooks, composition, and render optimization',
        'Demonstrates advanced patterns (compound components, render props)',
      ],
    },
    {
      category: 'UI Craft & Design Fidelity',
      weight: 20,
      indicators: [
        'Produces pixel-accurate implementations from design specs',
        'Strong eye for spacing, typography, and visual hierarchy',
        'Handles edge cases: empty states, loading, error boundaries',
      ],
    },
    {
      category: 'Architecture & Scalability',
      weight: 20,
      indicators: [
        'Makes sound tradeoffs for maintainability vs speed',
        'Structures code for team scalability and clear ownership',
        'Understands micro-frontend and monorepo patterns',
      ],
    },
    {
      category: 'Performance & Accessibility',
      weight: 15,
      indicators: [
        'Proactively measures and improves Core Web Vitals',
        'Builds keyboard-navigable, screen-reader-friendly interfaces',
        'Knows when and how to use virtualization and lazy loading',
      ],
    },
    {
      category: 'Communication & Collaboration',
      weight: 10,
      indicators: [
        'Articulates technical decisions clearly to non-engineers',
        'Provides constructive, actionable code review feedback',
        'Works effectively across design, product, and backend',
      ],
    },
    {
      category: 'Leadership & Mentorship',
      weight: 10,
      indicators: [
        'Elevates team standards through documentation and tooling',
        'Invests in growing junior engineers',
        'Takes ownership beyond individual ticket scope',
      ],
    },
  ],
}

export function extractRoleFromPrompt(prompt: string): string {
  const normalized = prompt.trim()
  if (!normalized) return ''

  // Try the verb pattern FIRST. This is the common case: "Hire a X",
  // "I want to hire a X", "Create a job for a X", "Looking for a X",
  // "Backfill for a X", etc.
  //
  // The capture starts after the verb (which itself may have a chain of
  // auxiliaries like "want to", "are looking", etc.). We then strip
  // leading articles and prepositions from the captured text so the
  // result is the bare role name.
  const verbMatch = normalized.match(
    /(?:hire|recruit|find|need|want(?:\s+to)?|looking(?:\s+for)?|search(?:ing)?(?:\s+for)?|hiring|build|create|generate|write|draft|opening|backfill|staff|fill|recruiting|sourcing)\b[^\w]+(.+)/i,
  )
  if (verbMatch?.[1]) {
    // The capture may start with another verb ("to hire" in "I want to
    // hire a X") or with articles / prepositions. Strip them iteratively
    // until we hit actual content.
    let stripped = verbMatch[1].trim()
    let prev = ''
    while (prev !== stripped) {
      prev = stripped
      stripped = stripped
        .replace(/^(?:a\s+|an\s+|the\s+|some\s+|new\s+)/i, '')
        .replace(/^(?:role\s+of\s+|position\s+of\s+|job\s+(?:for|of)\s+)/i, '')
        .replace(/^(?:for\s+(?:a\s+|an\s+|the\s+|some\s+|new\s+)?)/i, '')
        .replace(/^(?:to\s+(?:a\s+|an\s+|the\s+|some\s+|new\s+)?)/i, '')
        // The case "I want to hire a X" — the inner verb is "hire" + "a X"
        .replace(/^(?:hire|recruit|find|need|build|create|generate|write|draft|opening|backfill|staff|fill)\s+(?:a\s+|an\s+|the\s+|some\s+|new\s+)*/i, '')
        .trim()
    }
    // If the capture is too long, it's not really a role name — it's
    // the tail of a long sentence. Bail out and let the AI infer from
    // the full prompt (which the caller passes as extraContext).
    if (stripped && stripped.length <= 80 && !/[.!?]/.test(stripped)) {
      return capitalizeRole(stripped)
    }
  }

  // No verb pattern matched. If the prompt looks like a bare role name
  // (short, no sentence punctuation), use the whole thing as the role.
  //
  // Previous behavior was to fall back to a hardcoded "Senior Frontend
  // Developer" — which silently generated a JD for the wrong role
  // whenever the user typed just the role name. That was a real UX bug.
  if (
    normalized.length <= 80 &&
    !/[.!?;]/.test(normalized) &&
    !/,\s*\w+\s+\w+/.test(normalized) // contains a comma (likely a sentence)
  ) {
    return capitalizeRole(normalized)
  }

  // Long, free-form prompt. Caller will pass it as extraContext; we
  // don't try to extract a role from it here. Return empty so the
  // caller knows to use the prompt itself as the role.
  return ''
}

function capitalizeRole(role: string): string {
  return role
    .replace(/[?.!]+$/, '')
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')
}

export function isHiringPrompt(prompt: string): boolean {
  const lower = prompt.toLowerCase()
  return (
    lower.includes('hire') ||
    lower.includes('hiring') ||
    lower.includes('recruit') ||
    lower.includes('job description') ||
    lower.includes('interview question') ||
    lower.includes('scorecard') ||
    lower.includes('screening') ||
    lower.includes('frontend developer') ||
    lower.includes('engineer') ||
    lower.includes('manager')
  )
}
