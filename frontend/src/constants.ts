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

// Standard areas of expertise offered on the application and profile forms.
// Members can pick several and add custom entries; the backend stores the
// result as comma-separated text (people.expertise), so free-text values from
// spreadsheet imports still fit the same column.
export const EXPERTISE_AREAS = [
  'Accelerator physics',
  'Magnets',
  'RF systems',
  'Targetry',
  'Muon production & cooling',
  'Machine-detector interface',
  'Detector R&D',
  'Detector simulation',
  'Reconstruction & algorithms',
  'Software & computing',
  'Physics performance & analysis',
  'Theory & phenomenology',
]

// people.expertise round-trips through these: split for editing/display
// (semicolons too, for imported free text), join when saving.
export const splitExpertise = (s: string | null | undefined): string[] =>
  (s ?? '')
    .split(/[,;]/)
    .map((v) => v.trim())
    .filter(Boolean)

export const joinExpertise = (values: string[]): string | null =>
  values.length ? values.join(', ') : null
