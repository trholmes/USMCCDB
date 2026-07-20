// Shared UI constants mirroring backend enums/rules
// (backend/app/models/membership.py and backend/app/routers/people.py).

export const CAREER_STAGES = [
  { value: 'faculty', label: 'Faculty' },
  { value: 'staff', label: 'Lab / research scientist' },
  { value: 'postdoc', label: 'Postdoc' },
  { value: 'grad', label: 'Graduate student' },
  { value: 'undergrad', label: 'Undergraduate' },
  { value: 'engineer', label: 'Engineer' },
  { value: 'other', label: 'Other' },
]

// Display label for a career stage value (falls back to the raw value for
// anything unknown, and '' for missing history).
export const careerStageLabel = (value: string | null | undefined): string =>
  CAREER_STAGES.find((s) => s.value === value)?.label ?? value ?? ''

// Stages not eligible for voting membership (see _voting_eligible).
export const STUDENT_STAGES = ['undergrad', 'grad']

// Statuses a member may set on themselves (see SELF_SETTABLE_STATUSES).
export const SELF_STATUSES = ['active', 'inactive', 'alumni']

// Standard research areas (mirrors RESEARCH_AREAS in
// backend/app/models/membership.py) — the options from the membership
// registration form plus a catch-all; people.research_areas stores a
// comma-separated subset of these names.
export const RESEARCH_AREAS = [
  'Experimental Particle Physics',
  'Theoretical Particle Physics',
  'Accelerator Physics',
  'Other/Multiple',
]

// people.research_areas and people.expertise are comma-separated text
// columns; these round-trip them to arrays for the multi-value inputs
// (splitting on semicolons too, for imported free text).
export const splitList = (s: string | null | undefined): string[] =>
  (s ?? '')
    .split(/[,;]/)
    .map((v) => v.trim())
    .filter(Boolean)

export const joinList = (values: string[]): string | null =>
  values.length ? values.join(', ') : null
