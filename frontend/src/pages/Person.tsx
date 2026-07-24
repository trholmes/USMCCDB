import {
  Badge,
  Button,
  Card,
  Checkbox,
  Group,
  MultiSelect,
  NumberInput,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, uploadFile } from '../api/client'
import type { CollabRole, Institution, MembershipEvent, Person, Talk, WorkingGroup } from '../api/types'
import PersonAvatar from '../components/PersonAvatar'
import StatusBadge from '../components/StatusBadge'
import { useSession } from '../auth/SessionContext'
import {
  CAREER_STAGES,
  careerStageLabel,
  COLLAB_ROLES,
  collabRoleLabel,
  joinList,
  RESEARCH_AREAS,
  SELF_STATUSES,
  splitList,
  STUDENT_STAGES,
} from '../constants'

// Local calendar date (toISOString would give the UTC date, off by one for
// users east or west of UTC around midnight).
const today = () => {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export default function PersonPage() {
  const { id } = useParams()
  const [person, setPerson] = useState<Person | null>(null)
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<Record<string, string>>({})
  const [usmccPercent, setUsmccPercent] = useState<number | string>('')
  const [voting, setVoting] = useState(false)
  const [researchAreas, setResearchAreas] = useState<string[]>([])
  const { me, isOffice } = useSession()
  const fileInput = useRef<HTMLInputElement>(null)
  const [photoHover, setPhotoHover] = useState(false)

  const [talks, setTalks] = useState<Talk[]>([])
  const [institutions, setInstitutions] = useState<Institution[]>([])
  const [events, setEvents] = useState<MembershipEvent[]>([])

  // Institution move form (collapsed behind a button until requested).
  const [instOpen, setInstOpen] = useState(false)
  const [instId, setInstId] = useState<string | null>(null)
  const [instName, setInstName] = useState('')
  const [instDate, setInstDate] = useState(today())
  const [instStage, setInstStage] = useState<string | null>(null) // null = keep current
  const [instBusy, setInstBusy] = useState(false)

  // Status change form (self-service; collapsed behind a button until requested).
  const [statusOpen, setStatusOpen] = useState(false)
  const [newStatus, setNewStatus] = useState<string | null>(null)
  const [statusDate, setStatusDate] = useState(today())
  const [statusBusy, setStatusBusy] = useState(false)

  // Collaboration roles (leadership positions; office-managed).
  const [roles, setRoles] = useState<CollabRole[]>([])
  const [wgs, setWgs] = useState<WorkingGroup[]>([])
  const [roleType, setRoleType] = useState<string | null>(null)
  const [roleDetail, setRoleDetail] = useState('')
  const [roleWG, setRoleWG] = useState<string | null>(null)
  const [roleInst, setRoleInst] = useState<string | null>(null)
  const [roleStart, setRoleStart] = useState(today())
  const [roleBusy, setRoleBusy] = useState(false)

  const load = useCallback(() => {
    api.get<Person>(`/people/${id}`).then(setPerson).catch(() => setPerson(null))
    api
      .get<Talk[]>(`/talks?speaker_person_id=${id}`)
      .then(setTalks)
      .catch(() => setTalks([]))
  }, [id])
  useEffect(load, [load])

  // isSelf via the route param so it (and everything keyed on it) is stable
  // across profile re-fetches.
  const isSelf = me?.person_id != null && me.person_id === Number(id)
  const canEditFull = isSelf || isOffice

  useEffect(() => {
    if (!canEditFull) return // list feeds the edit cards only
    api.get<Institution[]>('/institutions').then(setInstitutions).catch(() => setInstitutions([]))
  }, [canEditFull])

  // Institutions the signed-in user is currently Administrative Institutional
  // Contact for — they may keep the institutional info of people at those
  // institutions up to date (mirrors ADMIN_CONTACT_EDITABLE on the backend).
  const [adminContactInstIds, setAdminContactInstIds] = useState<number[]>([])
  useEffect(() => {
    if (me?.person_id == null || canEditFull) {
      setAdminContactInstIds([])
      return
    }
    const t = today()
    api
      .get<CollabRole[]>(`/collab-roles?person_id=${me.person_id}&role=admin_contact`)
      .then((rs) =>
        setAdminContactInstIds(
          rs
            .filter((r) => r.start_date <= t && (!r.end_date || r.end_date >= t))
            .map((r) => r.institution_id)
            .filter((x): x is number => x != null),
        ),
      )
      .catch(() => setAdminContactInstIds([]))
  }, [me?.person_id, canEditFull])

  const loadRoles = useCallback(() => {
    api
      .get<CollabRole[]>(`/collab-roles?person_id=${id}`)
      .then(setRoles)
      .catch(() => setRoles([]))
  }, [id])
  useEffect(loadRoles, [loadRoles])

  useEffect(() => {
    if (!isOffice) return // list feeds the add-role form only
    api.get<WorkingGroup[]>('/working-groups').then(setWgs).catch(() => setWgs([]))
  }, [isOffice])

  const uploadPhoto = async (file: File | undefined) => {
    if (!file || !person) return
    try {
      await uploadFile(`/people/${person.id}/photo`, file)
      notifications.show({ message: 'Photo updated' })
      load()
    } catch (err: any) {
      notifications.show({ color: 'red', message: err.message })
    }
  }

  // Membership status history — visible to the member themselves and office.
  // Keyed on the route id (not the person object) so profile saves and photo
  // uploads don't re-fetch it; status changes refresh it explicitly.
  const loadEvents = useCallback(() => {
    if (!canEditFull) return
    api
      .get<MembershipEvent[]>(`/people/${id}/events`)
      .then(setEvents)
      .catch(() => setEvents([]))
  }, [id, canEditFull])
  useEffect(loadEvents, [loadEvents])

  if (!person) return <Text c="dimmed">Loading…</Text>

  const startEdit = () => {
    setForm({
      preferred_name: person.preferred_name ?? '',
      email: person.email,
      orcid: person.orcid ?? '',
      career_stage: person.career_stage,
      professional_title: person.professional_title ?? '',
      department: person.department ?? '',
    })
    setUsmccPercent(person.usmcc_percent ?? '')
    setResearchAreas(splitList(person.research_areas))
    setVoting(person.is_voting)
    setEditing(true)
  }

  const currentPrimary = person.affiliations.find((a) => a.is_primary && a.end_date === null)

  // An admin contact for this person's current institution may edit the
  // institutional-info fields only; the rest of the form is disabled.
  const isAdminContact =
    currentPrimary != null && adminContactInstIds.includes(currentPrimary.institution.id)
  const canEdit = canEditFull || isAdminContact

  // Self-service voting rule (office accounts are not bound by it — the
  // backend enforces eligibility for everyone at save time): active,
  // non-student, and currently at a US institution.
  const votingEligible =
    person.status === 'active' &&
    !STUDENT_STAGES.includes(form.career_stage) &&
    (currentPrimary?.institution.is_us ?? false)
  // What the checkbox actually shows/means for this user.
  const effectiveVoting = isOffice ? voting : votingEligible && voting

  const save = async () => {
    // PATCH only what changed, so unrelated edits can never clobber fields
    // (e.g. an office save must not silently strip a voting flag).
    const payload: Record<string, unknown> = {}
    const changed = (key: string, next: unknown, current: unknown) => {
      if (next !== current) payload[key] = next
    }
    changed('preferred_name', form.preferred_name || null, person.preferred_name)
    changed('email', form.email, person.email)
    changed('orcid', form.orcid || null, person.orcid)
    changed('career_stage', form.career_stage, person.career_stage)
    changed('professional_title', form.professional_title || null, person.professional_title)
    changed('department', form.department || null, person.department)
    changed(
      'usmcc_percent',
      usmccPercent === '' ? null : Number(usmccPercent),
      person.usmcc_percent,
    )
    // Compare canonical forms so an untouched field (possibly stored with
    // older free-text separators) isn't rewritten on every save.
    changed(
      'research_areas',
      joinList(researchAreas),
      joinList(splitList(person.research_areas)),
    )
    changed('is_voting', effectiveVoting, person.is_voting)
    if (Object.keys(payload).length === 0) {
      setEditing(false)
      return
    }
    try {
      await api.patch(`/people/${person.id}`, payload)
      notifications.show({ message: 'Profile updated' })
      setEditing(false)
      load()
    } catch (err: any) {
      notifications.show({ color: 'red', message: err.message })
    }
  }

  // Single path for all status changes (office header select and the
  // self-service card); returns whether the change was accepted.
  const postStatus = async (status: string, effectiveDate?: string) => {
    try {
      await api.post(`/people/${person.id}/status`, {
        status,
        ...(effectiveDate ? { effective_date: effectiveDate } : {}),
      })
      notifications.show({ message: `Status set to ${status}` })
      load()
      loadEvents()
      return true
    } catch (err: any) {
      notifications.show({ color: 'red', message: err.message })
      return false
    }
  }

  const closeInstForm = () => {
    setInstOpen(false)
    setInstId(null)
    setInstName('')
    setInstDate(today())
    setInstStage(null)
  }

  const moveInstitution = async () => {
    if (!instId && !instName.trim()) {
      notifications.show({ color: 'red', message: 'Pick an institution or enter a name' })
      return
    }
    setInstBusy(true)
    try {
      await api.post(`/people/${person.id}/institution`, {
        institution_id: instId ? Number(instId) : null,
        institution_name: instId ? null : instName.trim(),
        start_date: instDate,
        career_stage: instStage,
      })
      notifications.show({ message: 'Institution updated' })
      closeInstForm()
      load()
    } catch (err: any) {
      notifications.show({ color: 'red', message: err.message })
    } finally {
      setInstBusy(false)
    }
  }

  const closeStatusForm = () => {
    setStatusOpen(false)
    setNewStatus(null)
    setStatusDate(today())
  }

  const submitStatus = async () => {
    if (!newStatus) return
    setStatusBusy(true)
    const ok = await postStatus(newStatus, statusDate)
    setStatusBusy(false)
    if (ok) closeStatusForm()
  }

  const roleDef = COLLAB_ROLES.find((r) => r.value === roleType)

  const addRole = async () => {
    if (!roleType) return
    setRoleBusy(true)
    try {
      await api.post('/collab-roles', {
        person_id: person.id,
        role: roleType,
        detail: roleDef?.needsDetail ? roleDetail.trim() || null : null,
        working_group_id: roleDef?.needsWG && roleWG ? Number(roleWG) : null,
        institution_id: roleDef?.needsInstitution && roleInst ? Number(roleInst) : null,
        start_date: roleStart,
      })
      notifications.show({ message: 'Role added' })
      setRoleType(null)
      setRoleDetail('')
      setRoleWG(null)
      setRoleInst(null)
      setRoleStart(today())
      loadRoles()
    } catch (err: any) {
      notifications.show({ color: 'red', message: err.message })
    } finally {
      setRoleBusy(false)
    }
  }

  const endRole = async (roleId: number) => {
    try {
      await api.patch(`/collab-roles/${roleId}`, { end_date: today() })
      notifications.show({ message: 'Role ended today' })
      loadRoles()
    } catch (err: any) {
      notifications.show({ color: 'red', message: err.message })
    }
  }

  const deleteRole = async (roleId: number) => {
    try {
      await api.delete(`/collab-roles/${roleId}`)
      notifications.show({ message: 'Role deleted' })
      loadRoles()
    } catch (err: any) {
      notifications.show({ color: 'red', message: err.message })
    }
  }

  return (
    <Stack>
      <Group justify="space-between">
        <Group align="flex-start">
          {isSelf || isOffice ? (
            <div
              style={{ position: 'relative', width: 72, height: 72, cursor: 'pointer' }}
              title="Click to change photo"
              onClick={() => fileInput.current?.click()}
              onMouseEnter={() => setPhotoHover(true)}
              onMouseLeave={() => setPhotoHover(false)}
            >
              <PersonAvatar person={person} size={72} />
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  borderRadius: '50%',
                  background: 'rgba(0, 0, 0, 0.55)',
                  color: 'white',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 11,
                  fontWeight: 600,
                  textAlign: 'center',
                  lineHeight: 1.2,
                  opacity: photoHover ? 1 : 0,
                  transition: 'opacity 120ms ease',
                  pointerEvents: 'none',
                }}
              >
                📷 Change
              </div>
            </div>
          ) : (
            <PersonAvatar person={person} size={72} />
          )}
          <input
            ref={fileInput}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            hidden
            onChange={(e) => uploadPhoto(e.currentTarget.files?.[0])}
          />
        <div>
          <Title order={3}>
            {person.given_name} {person.family_name}{' '}
            {person.is_voting && <Badge variant="light">voting member</Badge>}
          </Title>
          <Group gap="xs" mt={4}>
            <StatusBadge status={person.status} />
            <Text c="dimmed" size="sm">
              {person.career_stage}
            </Text>
            {person.orcid && (
              <Text size="sm" c="dimmed">
                ORCID: {person.orcid}
              </Text>
            )}
          </Group>
        </div>
        </Group>
        <Group>
          {isOffice && (
            <Select
              placeholder="Change status…"
              data={['pending', 'active', 'inactive', 'alumni', 'rejected']}
              onChange={(v) => v && postStatus(v)}
              w={160}
            />
          )}
          {canEdit && !editing && <Button onClick={startEdit}>Edit profile</Button>}
        </Group>
      </Group>

      {editing ? (
        <Card withBorder maw={520}>
          <Stack gap="sm">
            {!canEditFull && (
              <Text size="xs" c="dimmed">
                As the administrative institutional contact for{' '}
                {currentPrimary?.institution.name}, you can update the institutional info
                fields below; the rest of the profile is member/office-editable only.
              </Text>
            )}
            <TextInput
              label="Preferred name"
              description="Shown in place of your first/given name in listings; your family name always stays."
              value={form.preferred_name}
              disabled={!canEditFull}
              onChange={(e) => setForm({ ...form, preferred_name: e.currentTarget.value })}
            />
            <TextInput
              label="Email"
              value={form.email}
              disabled={!canEditFull}
              onChange={(e) => setForm({ ...form, email: e.currentTarget.value })}
            />
            <TextInput
              label="ORCID iD"
              value={form.orcid}
              disabled={!canEditFull}
              onChange={(e) => setForm({ ...form, orcid: e.currentTarget.value })}
            />
            <Select
              label="Position / career stage"
              data={CAREER_STAGES}
              value={form.career_stage}
              onChange={(v) => setForm({ ...form, career_stage: v || 'other' })}
            />
            <TextInput
              label="Professional title"
              description="Your title in your organization (e.g. Associate Professor, Staff Scientist)."
              value={form.professional_title}
              onChange={(e) => setForm({ ...form, professional_title: e.currentTarget.value })}
            />
            <TextInput
              label="Department"
              value={form.department}
              onChange={(e) => setForm({ ...form, department: e.currentTarget.value })}
            />
            <NumberInput
              label="Research time on USMCC (%)"
              description="Fraction of your research time devoted to the USMCC."
              min={0}
              max={100}
              value={usmccPercent}
              onChange={setUsmccPercent}
            />
            <MultiSelect
              label="Research area(s)"
              placeholder="Select all that apply…"
              data={RESEARCH_AREAS}
              value={researchAreas}
              onChange={setResearchAreas}
              disabled={!canEditFull}
              clearable
            />
            <Checkbox
              label="Voting member"
              checked={effectiveVoting}
              disabled={!canEditFull || (!isOffice && !votingEligible)}
              onChange={(e) => setVoting(e.currentTarget.checked)}
              description={
                isOffice || votingEligible
                  ? 'PhD-holding physicist at a US institution, actively contributing.'
                  : 'Voting membership requires an active, non-student member (not a grad or undergrad student) currently at a US institution.'
              }
            />
            <Group>
              <Button onClick={save}>Save</Button>
              <Button variant="subtle" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </Group>
          </Stack>
        </Card>
      ) : (
        <Card withBorder maw={640}>
          <Stack gap={6}>
            <Text size="sm">
              <b>Email:</b> {person.email}
            </Text>
            {currentPrimary && (
              <Text size="sm">
                <b>Institution:</b> {currentPrimary.institution.name}
              </Text>
            )}
            {person.professional_title && (
              <Text size="sm">
                <b>Professional title:</b> {person.professional_title}
              </Text>
            )}
            {person.department && (
              <Text size="sm">
                <b>Department:</b> {person.department}
              </Text>
            )}
            {person.usmcc_percent != null && (
              <Text size="sm">
                <b>Research time on USMCC:</b> {person.usmcc_percent}%
              </Text>
            )}
            {person.research_areas && (
              <Group gap={6}>
                <Text size="sm">
                  <b>Research areas:</b>
                </Text>
                {splitList(person.research_areas).map((area) => (
                  <Badge key={area} variant="light" size="sm">
                    {area}
                  </Badge>
                ))}
              </Group>
            )}
            {(person.working_groups.length > 0 || isSelf) && (
              <Group gap={6}>
                <Text size="sm">
                  <b>Working groups:</b>
                </Text>
                {person.working_groups.length === 0 ? (
                  <Text size="sm" c="dimmed">
                    none
                  </Text>
                ) : (
                  person.working_groups.map((wg) => (
                    <Badge key={wg.id} variant="light" color="gray" size="sm">
                      {wg.name}
                    </Badge>
                  ))
                )}
                {isSelf && (
                  <Text size="sm" c="dimmed">
                    — join or leave on the <Link to="/working-groups">working groups</Link> page
                  </Text>
                )}
              </Group>
            )}
          </Stack>
        </Card>
      )}

      {canEditFull && (
        <Group align="flex-start" gap="md">
          {instOpen ? (
            <Card withBorder w={340}>
              <Stack gap="sm">
                <Title order={5}>Change institution</Title>
                <Text size="xs" c="dimmed">
                  Records a move as of the date you enter; your current affiliation is closed
                  on that date and history is kept.
                </Text>
                <Select
                  label="New institution"
                  placeholder="Search institutions…"
                  searchable
                  clearable
                  data={institutions.map((i) => ({
                    value: String(i.id),
                    label: i.short_name ? `${i.name} (${i.short_name})` : i.name,
                  }))}
                  value={instId}
                  onChange={setInstId}
                />
                {!instId && (
                  <TextInput
                    label="…or a new institution not in the list"
                    placeholder="Institution name"
                    value={instName}
                    onChange={(e) => setInstName(e.currentTarget.value)}
                  />
                )}
                <Select
                  label="Career stage at the new institution"
                  placeholder={`Keep current (${careerStageLabel(person.career_stage)})`}
                  data={CAREER_STAGES}
                  value={instStage}
                  onChange={setInstStage}
                  clearable
                />
                <TextInput
                  label="Effective date"
                  type="date"
                  value={instDate}
                  onChange={(e) => setInstDate(e.currentTarget.value)}
                />
                <Group>
                  <Button onClick={moveInstitution} loading={instBusy}>
                    Update institution
                  </Button>
                  <Button variant="subtle" onClick={closeInstForm}>
                    Cancel
                  </Button>
                </Group>
              </Stack>
            </Card>
          ) : (
            <Button variant="default" onClick={() => setInstOpen(true)}>
              Change institution…
            </Button>
          )}

          {statusOpen ? (
            <Card withBorder w={340}>
              <Stack gap="sm">
                <Title order={5}>Change status</Title>
                <Text size="xs" c="dimmed">
                  Update your membership status as of a date. The change is recorded in your
                  membership history.
                </Text>
                <Select
                  label="New status"
                  placeholder="Select status…"
                  data={SELF_STATUSES}
                  value={newStatus}
                  onChange={setNewStatus}
                />
                <TextInput
                  label="Effective date"
                  type="date"
                  value={statusDate}
                  onChange={(e) => setStatusDate(e.currentTarget.value)}
                />
                <Group>
                  <Button onClick={submitStatus} loading={statusBusy} disabled={!newStatus}>
                    Update status
                  </Button>
                  <Button variant="subtle" onClick={closeStatusForm}>
                    Cancel
                  </Button>
                </Group>
              </Stack>
            </Card>
          ) : (
            <Button variant="default" onClick={() => setStatusOpen(true)}>
              Change status…
            </Button>
          )}
        </Group>
      )}

      <Title order={5}>Affiliations</Title>
      <Table maw={720}>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Institution</Table.Th>
            <Table.Th>Position</Table.Th>
            <Table.Th>Primary</Table.Th>
            <Table.Th>From</Table.Th>
            <Table.Th>To</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {person.affiliations.map((a) => (
            <Table.Tr key={a.id}>
              <Table.Td>
                <Link to={`/institutions/${a.institution.id}`}>{a.institution.name}</Link>
              </Table.Td>
              <Table.Td>{careerStageLabel(a.career_stage) || '—'}</Table.Td>
              <Table.Td>{a.is_primary ? 'yes' : ''}</Table.Td>
              <Table.Td>{a.start_date}</Table.Td>
              <Table.Td>{a.end_date ?? 'present'}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>

      {(roles.length > 0 || isOffice) && (
        <>
          <Title order={5}>Collaboration roles</Title>
          {roles.length === 0 ? (
            <Text size="sm" c="dimmed">
              No leadership roles recorded.
            </Text>
          ) : (
            <Table maw={860}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Role</Table.Th>
                  <Table.Th>Scope</Table.Th>
                  <Table.Th>From</Table.Th>
                  <Table.Th>To</Table.Th>
                  {isOffice && <Table.Th />}
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {roles.map((r) => (
                  <Table.Tr key={r.id}>
                    <Table.Td>{collabRoleLabel(r.role, r.detail)}</Table.Td>
                    <Table.Td>
                      {r.working_group?.name ?? r.institution?.name ?? '—'}
                    </Table.Td>
                    <Table.Td>{r.start_date}</Table.Td>
                    <Table.Td>{r.end_date ?? 'present'}</Table.Td>
                    {isOffice && (
                      <Table.Td>
                        <Group gap="xs" justify="flex-end" wrap="nowrap">
                          {!r.end_date && (
                            <Button size="compact-xs" variant="light" onClick={() => endRole(r.id)}>
                              End today
                            </Button>
                          )}
                          <Button
                            size="compact-xs"
                            variant="subtle"
                            color="red"
                            onClick={() => deleteRole(r.id)}
                          >
                            Delete
                          </Button>
                        </Group>
                      </Table.Td>
                    )}
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          )}
          {isOffice && (
            <Card withBorder w={340}>
              <Stack gap="sm">
                <Title order={6}>Add role</Title>
                <Select
                  label="Role"
                  placeholder="Select role…"
                  data={COLLAB_ROLES.map((r) => ({ value: r.value, label: r.label }))}
                  value={roleType}
                  onChange={setRoleType}
                  searchable
                />
                {roleDef?.needsDetail && (
                  <TextInput
                    label={roleDef.value === 'other' ? 'Title' : 'Area'}
                    description={
                      roleDef.value === 'other'
                        ? 'Full title as it should appear (e.g. DEI Committee Chair).'
                        : 'Qualifier, e.g. Accelerator, Experimental, Outreach, Target.'
                    }
                    value={roleDetail}
                    onChange={(e) => setRoleDetail(e.currentTarget.value)}
                  />
                )}
                {roleDef?.needsWG && (
                  <Select
                    label="Working group"
                    placeholder="Select working group…"
                    data={wgs.map((w) => ({ value: String(w.id), label: w.name }))}
                    value={roleWG}
                    onChange={setRoleWG}
                    searchable
                  />
                )}
                {roleDef?.needsInstitution && (
                  <Select
                    label="Institution"
                    placeholder="Select institution…"
                    data={institutions.map((i) => ({
                      value: String(i.id),
                      label: i.short_name ? `${i.name} (${i.short_name})` : i.name,
                    }))}
                    value={roleInst}
                    onChange={setRoleInst}
                    searchable
                  />
                )}
                <TextInput
                  label="Start date"
                  type="date"
                  value={roleStart}
                  onChange={(e) => setRoleStart(e.currentTarget.value)}
                />
                <Button
                  onClick={addRole}
                  loading={roleBusy}
                  disabled={
                    !roleType ||
                    (roleDef?.needsDetail && !roleDetail.trim()) ||
                    (roleDef?.needsWG && !roleWG) ||
                    (roleDef?.needsInstitution && !roleInst)
                  }
                >
                  Add role
                </Button>
              </Stack>
            </Card>
          )}
        </>
      )}

      {canEditFull && events.length > 0 && (
        <>
          <Title order={5}>Membership history</Title>
          <Table maw={720}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Effective</Table.Th>
                <Table.Th>From</Table.Th>
                <Table.Th>To</Table.Th>
                <Table.Th>Note</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {events.map((e) => (
                <Table.Tr key={e.id}>
                  <Table.Td>{e.effective_date ?? e.created_at.slice(0, 10)}</Table.Td>
                  <Table.Td>{e.from_status ?? '—'}</Table.Td>
                  <Table.Td>{e.to_status}</Table.Td>
                  <Table.Td>{e.note ?? ''}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </>
      )}

      <Title order={5}>Talks</Title>
      {talks.length === 0 ? (
        <Text size="sm" c="dimmed">
          No talks recorded. Browse <Link to="/talks">talks & speakers</Link>.
        </Text>
      ) : (
        <Table maw={860}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Date</Table.Th>
              <Table.Th>Title</Table.Th>
              <Table.Th>Type</Table.Th>
              <Table.Th>Status</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {talks.map((t) => (
              <Table.Tr key={t.id}>
                <Table.Td>{t.date}</Table.Td>
                <Table.Td>
                  <Link to="/talks">{t.title}</Link>
                </Table.Td>
                <Table.Td>
                  {t.talk_type}
                  {t.is_invited ? ' (invited)' : ''}
                </Table.Td>
                <Table.Td>
                  <StatusBadge status={t.status} />
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}

      <Title order={5}>Authorship periods</Title>
      {person.author_periods.length === 0 ? (
        <Text size="sm" c="dimmed">
          Not currently on the author list.
        </Text>
      ) : (
        <Table maw={720}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>From</Table.Th>
              <Table.Th>To</Table.Th>
              <Table.Th>Signing name</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {person.author_periods.map((p) => (
              <Table.Tr key={p.id}>
                <Table.Td>{p.start_date}</Table.Td>
                <Table.Td>{p.end_date ?? 'present'}</Table.Td>
                <Table.Td>{p.signing_name ?? '—'}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
    </Stack>
  )
}
