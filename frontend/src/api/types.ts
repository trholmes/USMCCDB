export type Role = 'admin' | 'office' | 'member'

export interface User {
  id: number
  person_id: number | null
  username: string | null
  orcid: string | null
  role: Role
  is_active: boolean
  last_login_at: string | null
}

export interface Me {
  user: User
  person_id: number | null
  display_name: string | null
  permissions: string[]
  orcid_enabled: boolean
  contact_email: string
}

export interface Institution {
  id: number
  name: string
  short_name: string | null
  ror_id: string | null
  country: string | null
  is_us: boolean
  latex_address: string | null
  is_active: boolean
  people_count: number
}

export interface Affiliation {
  id: number
  institution: Institution
  is_primary: boolean
  career_stage: string | null
  start_date: string
  end_date: string | null
}

export interface AuthorPeriod {
  id: number
  person_id: number
  start_date: string
  end_date: string | null
  signing_name: string | null
}

export interface PersonSummary {
  id: number
  given_name: string
  family_name: string
  preferred_name: string | null
  email: string
  orcid: string | null
  career_stage: string
  status: string
  is_voting: boolean
  photo_file: string | null
  research_areas: string | null
  primary_institution: { id: number; name: string; short_name: string | null } | null
}

export interface Person extends PersonSummary {
  professional_title: string | null
  department: string | null
  usmcc_percent: number | null
  expertise: string | null
  notes: string | null
  status_changed_at: string | null
  affiliations: Affiliation[]
  author_periods: AuthorPeriod[]
}

export interface MembershipEvent {
  id: number
  person_id: number
  from_status: string | null
  to_status: string
  effective_date: string | null
  actor_user_id: number | null
  note: string | null
  created_at: string
}

export interface WorkingGroup {
  id: number
  name: string
  slug: string
  description: string | null
  is_active: boolean
  member_count: number
}

export interface CollabRole {
  id: number
  person_id: number
  role: string
  detail: string | null
  working_group_id: number | null
  institution_id: number | null
  start_date: string
  end_date: string | null
  person: PersonSummary | null
  working_group: { id: number; name: string; slug: string } | null
  institution: { id: number; name: string; short_name: string | null } | null
}

export interface EventItem {
  id: number
  name: string
  url: string | null
  location: string | null
  start_date: string | null
  end_date: string | null
  abstract_deadline: string | null
  notes: string | null
  talk_count: number
}

export interface Nomination {
  id: number
  talk_id: number
  person: PersonSummary
  nominated_by_user_id: number | null
  status: string
  note: string | null
  created_at: string
}

export interface Talk {
  id: number
  title: string
  event_id: number | null
  venue: string | null
  talk_type: string
  date: string | null
  working_group_id: number | null
  speaker_person_id: number | null
  status: string
  is_invited: boolean
  notes: string | null
  created_by_user_id: number | null
  speaker: PersonSummary | null
  nominations: Nomination[]
}

export interface TalkStatRow {
  key: string
  key_id: number
  year: number
  talks: number
  invited: number
}

export interface PubPerson {
  id: number
  person: PersonSummary
  role: string
}

export interface Publication {
  id: number
  title: string
  short_code: string | null
  pub_type: string
  status: string
  working_group_id: number | null
  arxiv_id: string | null
  doi: string | null
  journal: string | null
  target_journal: string | null
  abstract: string | null
  author_cutoff_date: string | null
  people: PubPerson[]
  created_at: string
}

export interface AuthorListSnapshot {
  cutoff_date: string
  authors: {
    person_id: number
    display_name: string
    family_name: string
    given_name: string
    orcid: string | null
    institution_ids: number[]
  }[]
  institutions: Record<
    string,
    { id: number; index: number; name: string; short_name: string | null; latex_address: string | null }
  >
}

export interface AuthorList {
  id: number
  publication_id: number | null
  cutoff_date: string
  generated_by_user_id: number | null
  snapshot: AuthorListSnapshot
  created_at: string
}
