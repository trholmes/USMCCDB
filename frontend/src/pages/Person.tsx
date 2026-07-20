import {
  Badge,
  Button,
  Card,
  Checkbox,
  Group,
  Select,
  Stack,
  Table,
  Text,
  Textarea,
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

const CAREER_STAGES = [
  { value: 'faculty', label: 'Faculty' },
  { value: 'staff', label: 'Lab / research scientist' },
  { value: 'postdoc', label: 'Postdoc' },
  { value: 'grad', label: 'Graduate student' },
  { value: 'undergrad', label: 'Undergraduate' },
  { value: 'engineer', label: 'Engineer' },
  { value: 'other', label: 'Other' },
]
const STUDENT_STAGES = ['undergrad', 'grad']
// Statuses a member may set on themselves (office can set any via the header).
const SELF_STATUSES = ['active', 'inactive', 'alumni']

const today = () => new Date().toISOString().slice(0, 10)

export default function PersonPage() {
  const { id } = useParams()
  const [person, setPerson] = useState<Person | null>(null)
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<Record<string, string>>({})
  const [voting, setVoting] = useState(false)
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

  useEffect(() => {
    api.get<Institution[]>('/institutions').then(setInstitutions).catch(() => setInstitutions([]))
  }, [])

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

  const isSelf = me?.person_id === person?.id
  const canEdit = isSelf || isOffice

  // Membership status history — visible to the member themselves and office.
  const loadEvents = useCallback(() => {
    if (!person || !canEdit) return
    api
      .get<MembershipEvent[]>(`/people/${person.id}/events`)
      .then(setEvents)
      .catch(() => setEvents([]))
  }, [person, canEdit])
  useEffect(loadEvents, [loadEvents])

  if (!person) return <Text c="dimmed">Loading…</Text>

  const startEdit = () => {
    setForm({
      preferred_name: person.preferred_name ?? '',
      email: person.email,
      orcid: person.orcid ?? '',
      career_stage: person.career_stage,
      expertise: person.expertise ?? '',
    })
    setVoting(person.is_voting)
    setEditing(true)
  }

  // Voting is only allowed for active, non-student members.
  const votingEligible =
    person.status === 'active' && !STUDENT_STAGES.includes(form.career_stage)

  const save = async () => {
    try {
      await api.patch(`/people/${person.id}`, {
        preferred_name: form.preferred_name || null,
        email: form.email,
        orcid: form.orcid || null,
        career_stage: form.career_stage,
        expertise: form.expertise || null,
        is_voting: votingEligible ? voting : false,
      })
      notifications.show({ message: 'Profile updated' })
      setEditing(false)
      load()
    } catch (err: any) {
      notifications.show({ color: 'red', message: err.message })
    }
  }

  // Office quick status change from the header (no effective date).
  const changeStatus = async (status: string | null) => {
    if (!status) return
    try {
      await api.post(`/people/${person.id}/status`, { status })
      notifications.show({ message: `Status set to ${status}` })
      load()
      loadEvents()
    } catch (err: any) {
      notifications.show({ color: 'red', message: err.message })
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
    try {
      await api.post(`/people/${person.id}/status`, {
        status: newStatus,
        effective_date: statusDate,
      })
      notifications.show({ message: `Status set to ${newStatus}` })
      setNewStatus(null)
      setStatusDate(today())
      load()
      loadEvents()
    } catch (err: any) {
      notifications.show({ color: 'red', message: err.message })
    } finally {
      setStatusBusy(false)
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
              onChange={changeStatus}
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
            <Textarea
              label="Areas of expertise"
              value={form.expertise}
              onChange={(e) => setForm({ ...form, expertise: e.currentTarget.value })}
            />
            <Checkbox
              label="Voting member"
              checked={votingEligible ? voting : false}
              disabled={!votingEligible}
              onChange={(e) => setVoting(e.currentTarget.checked)}
              description={
                votingEligible
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
              <Text size="sm">
                <b>Expertise:</b> {person.expertise}
              </Text>
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
