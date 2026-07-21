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

// Fields an Administrative Institutional Contact may keep up to date for
// people currently at their institution (see ADMIN_CONTACT_EDITABLE in
// backend/app/routers/people.py).
export const ADMIN_CONTACT_EDITABLE = [
  'career_stage',
  'professional_title',
  'department',
  'usmcc_percent',
]

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

// Collaboration leadership roles (mirrors CollabRoleType and
// DETAIL_REQUIRED_ROLES in backend/app/models/membership.py). `detail`
// qualifies the generic types; `template` shows where the qualifier lands in
// the printed title ("Accelerator Representative", "Deputy Communications
// Coordinator", …). needsWG / needsInstitution mirror the backend's scoped
// role requirements.
export interface CollabRoleDef {
  value: string
  label: string
  template?: string
  needsDetail?: boolean
  needsWG?: boolean
  needsInstitution?: boolean
}

export const COLLAB_ROLES: CollabRoleDef[] = [
  { value: 'chair', label: 'Chair' },
  { value: 'vice_chair', label: 'Vice Chair' },
  {
    value: 'representative',
    label: 'Representative',
    template: '{detail} Representative',
    needsDetail: true,
  },
  {
    value: 'deputy_representative',
    label: 'Deputy Representative',
    template: 'Deputy {detail} Representative',
    needsDetail: true,
  },
  // {
  //   value: 'coordinator',
  //   label: 'Coordinator',
  //   template: '{detail} Coordinator',
  //   needsDetail: true,
  // },
  // {
  //   value: 'deputy_coordinator',
  //   label: 'Deputy Coordinator',
  //   template: 'Deputy {detail} Coordinator',
  //   needsDetail: true,
  // },
  //{ value: 'area_lead', label: 'Focus Area Lead', template: '{detail} Lead', needsDetail: true },
  { value: 'lsg_member', label: 'Leadership Strategy Group' },
  //{ value: 'ib_rep', label: 'Institutional Board Representative', needsInstitution: true },
  { value: 'admin_contact', label: 'Administrative Institutional Contact', needsInstitution: true },
  { value: 'convener', label: 'Working Group Convener', needsWG: true },
  { value: 'speakers_comm', label: 'Speakers Committee' },
  //{ value: 'pub_chair', label: 'Publications Committee Chair' },
  //{ value: 'secretary', label: 'Secretary' },
  { value: 'other', label: 'Other (free-form title)', template: '{detail}', needsDetail: true },
]

// Printed title for a role instance ("Accelerator Representative"); falls
// back to the raw value for anything unknown.
export const collabRoleLabel = (role: string, detail?: string | null): string => {
  const def = COLLAB_ROLES.find((r) => r.value === role)
  if (!def) return detail ? `${role} (${detail})` : role
  if (def.template && detail) return def.template.replace('{detail}', detail)
  return def.label
}

// Talk types (mirrors TalkType in backend/app/models/speakers.py). Seminars
// and colloquia are talks with no associated conference — they carry a
// free-text venue instead of an event.
export const TALK_TYPES = [
  'plenary',
  'parallel',
  'poster',
  'seminar',
  'colloquium',
  'outreach',
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
