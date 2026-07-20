import {
  Badge,
  Button,
  Card,
  Checkbox,
  Group,
  Select,
  Stack,
  Table,
  TagsInput,
  Text,
  TextInput,
  Title,
} from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, uploadFile } from '../api/client'
import type { Institution, MembershipEvent, Person, Talk } from '../api/types'
import PersonAvatar from '../components/PersonAvatar'
import StatusBadge from '../components/StatusBadge'
import { useSession } from '../auth/SessionContext'
import {
  CAREER_STAGES,
  EXPERTISE_AREAS,
  joinExpertise,
  SELF_STATUSES,
  splitExpertise,
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
  const [voting, setVoting] = useState(false)
  const [expertise, setExpertise] = useState<string[]>([])
  const { me, isOffice } = useSession()
  const fileInput = useRef<HTMLInputElement>(null)
  const [photoHover, setPhotoHover] = useState(false)

  const [talks, setTalks] = useState<Talk[]>([])
  const [institutions, setInstitutions] = useState<Institution[]>([])
  const [events, setEvents] = useState<MembershipEvent[]>([])

  // Institution move form.
  const [instId, setInstId] = useState<string | null>(null)
  const [instName, setInstName] = useState('')
  const [instDate, setInstDate] = useState(today())
  const [instBusy, setInstBusy] = useState(false)

  // Status change form (self-service).
  const [newStatus, setNewStatus] = useState<string | null>(null)
  const [statusDate, setStatusDate] = useState(today())
  const [statusBusy, setStatusBusy] = useState(false)

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
  const canEdit = isSelf || isOffice

  useEffect(() => {
    if (!canEdit) return // list feeds the edit cards only
    api.get<Institution[]>('/institutions').then(setInstitutions).catch(() => setInstitutions([]))
  }, [canEdit])

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
    if (!canEdit) return
    api
      .get<MembershipEvent[]>(`/people/${id}/events`)
      .then(setEvents)
      .catch(() => setEvents([]))
  }, [id, canEdit])
  useEffect(loadEvents, [loadEvents])

  if (!person) return <Text c="dimmed">Loading…</Text>

  const startEdit = () => {
    setForm({
      preferred_name: person.preferred_name ?? '',
      email: person.email,
      orcid: person.orcid ?? '',
      career_stage: person.career_stage,
    })
    setExpertise(splitExpertise(person.expertise))
    setVoting(person.is_voting)
    setEditing(true)
  }

  // Self-service voting rule (office accounts are not bound by it — the
  // backend enforces eligibility for everyone at save time).
  const votingEligible =
    person.status === 'active' && !STUDENT_STAGES.includes(form.career_stage)
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
    // Compare canonical forms so an untouched field (possibly stored with
    // older free-text separators) isn't rewritten on every save.
    changed(
      'expertise',
      joinExpertise(expertise),
      joinExpertise(splitExpertise(person.expertise)),
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
      })
      notifications.show({ message: 'Institution updated' })
      setInstId(null)
      setInstName('')
      setInstDate(today())
      load()
    } catch (err: any) {
      notifications.show({ color: 'red', message: err.message })
    } finally {
      setInstBusy(false)
    }
  }

  const submitStatus = async () => {
    if (!newStatus) return
    setStatusBusy(true)
    const ok = await postStatus(newStatus, statusDate)
    setStatusBusy(false)
    if (ok) {
      setNewStatus(null)
      setStatusDate(today())
    }
  }

  const currentPrimary = person.affiliations.find((a) => a.is_primary && a.end_date === null)

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
            <TextInput
              label="Preferred name"
              value={form.preferred_name}
              onChange={(e) => setForm({ ...form, preferred_name: e.currentTarget.value })}
            />
            <TextInput
              label="Email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.currentTarget.value })}
            />
            <TextInput
              label="ORCID iD"
              value={form.orcid}
              onChange={(e) => setForm({ ...form, orcid: e.currentTarget.value })}
            />
            <Select
              label="Position / career stage"
              data={CAREER_STAGES}
              value={form.career_stage}
              onChange={(v) => setForm({ ...form, career_stage: v || 'other' })}
            />
            <TagsInput
              label="Areas of expertise"
              description="Pick from the list or type your own and press Enter."
              placeholder="Select or type…"
              data={EXPERTISE_AREAS}
              value={expertise}
              onChange={setExpertise}
              clearable
            />
            <Checkbox
              label="Voting member"
              checked={effectiveVoting}
              disabled={!isOffice && !votingEligible}
              onChange={(e) => setVoting(e.currentTarget.checked)}
              description={
                isOffice || votingEligible
                  ? 'PhD-holding physicist at a US institution, actively contributing.'
                  : 'Voting membership requires an active, non-student member (not a grad or undergrad student).'
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
            {person.expertise && (
              <Group gap={6}>
                <Text size="sm">
                  <b>Expertise:</b>
                </Text>
                {splitExpertise(person.expertise).map((area) => (
                  <Badge key={area} variant="light" color="gray" size="sm">
                    {area}
                  </Badge>
                ))}
              </Group>
            )}
          </Stack>
        </Card>
      )}

      {canEdit && (
        <Group align="flex-start" gap="md">
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
              <TextInput
                label="Effective date"
                type="date"
                value={instDate}
                onChange={(e) => setInstDate(e.currentTarget.value)}
              />
              <Button onClick={moveInstitution} loading={instBusy}>
                Update institution
              </Button>
            </Stack>
          </Card>

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
              <Button onClick={submitStatus} loading={statusBusy} disabled={!newStatus}>
                Update status
              </Button>
            </Stack>
          </Card>
        </Group>
      )}

      <Title order={5}>Affiliations</Title>
      <Table maw={720}>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Institution</Table.Th>
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
              <Table.Td>{a.is_primary ? 'yes' : ''}</Table.Td>
              <Table.Td>{a.start_date}</Table.Td>
              <Table.Td>{a.end_date ?? 'present'}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>

      {canEdit && events.length > 0 && (
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
