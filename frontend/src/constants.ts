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

// Stages not eligible for voting membership (see _voting_eligible).
export const STUDENT_STAGES = ['undergrad', 'grad']

// Statuses a member may set on themselves (see SELF_SETTABLE_STATUSES).
export const SELF_STATUSES = ['active', 'inactive', 'alumni']

// Standard research areas (mirrors RESEARCH_AREAS in
// backend/app/models/membership.py); people.research_areas stores a
// comma-separated subset of the values.
export const RESEARCH_AREAS = [
  { value: 'accelerator', label: 'Accelerator' },
  { value: 'experiment', label: 'Experiment' },
  { value: 'theory', label: 'Theory' },
  { value: 'other', label: 'Other' },
]

export const researchAreaLabel = (value: string): string =>
  RESEARCH_AREAS.find((r) => r.value === value)?.label ?? value

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
