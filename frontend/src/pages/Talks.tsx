import {
  Badge,
  Button,
  Card,
  Group,
  Modal,
  MultiSelect,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { PageCount, PaginationBar, usePagination } from '../components/pagination'
import { SortableTh, useSortable, type Accessors } from '../components/sortable'
import type { EventItem, PersonSummary, Talk } from '../api/types'
import StatusBadge from '../components/StatusBadge'
import { useSession } from '../auth/SessionContext'
import { TALK_TYPES } from '../constants'
import { today } from '../dates'

const emptyForm = {
  title: '',
  event_id: '',
  venue: '',
  talk_type: 'parallel',
  date: '',
  is_invited: 'false',
  speaker_person_id: '',
}

export default function TalksPage() {
  const [talks, setTalks] = useState<Talk[]>([])
  const [events, setEvents] = useState<EventItem[]>([])
  const [people, setPeople] = useState<PersonSummary[]>([])
  const [detail, setDetail] = useState<Talk | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [nominee, setNominee] = useState<string | null>(null)
  const [q, setQ] = useState('')
  // Multi-select filters: OR within a filter, AND across filters (issue #114).
  const [eventFilter, setEventFilter] = useState<string[]>([])
  const [typeFilter, setTypeFilter] = useState<string[]>([])
  const [statusFilter, setStatusFilter] = useState<string[]>([])
  const { me, isOffice } = useSession()
  const navigate = useNavigate()

  const load = useCallback(() => {
    api.get<Talk[]>('/talks').then(setTalks).catch(() => setTalks([]))
    api.get<EventItem[]>('/events').then(setEvents).catch(() => setEvents([]))
    api.get<PersonSummary[]>('/people?status=active').then(setPeople).catch(() => setPeople([]))
  }, [])
  useEffect(load, [load])

  const eventName = (id: number | null) => events.find((e) => e.id === id)?.name ?? ''
  // Conference name for conference talks, free-text venue for seminars/colloquia.
  const whereGiven = (t: Talk) => eventName(t.event_id) || t.venue || ''

  const accessors = useMemo<Accessors<Talk>>(
    () => ({
      date: (t) => t.date,
      conference: (t) => whereGiven(t),
      title: (t) => t.title,
      type: (t) => `${t.talk_type}${t.is_invited ? ' invited' : ''}`,
      speaker: (t) => (t.speaker ? `${t.speaker.family_name} ${t.speaker.given_name}` : null),
      status: (t) => t.status,
    }),
    [events],
  )

  const filtered = useMemo(() => {
    const needle = q.toLowerCase()
    return talks.filter(
      (t) =>
        (!needle ||
          t.title.toLowerCase().includes(needle) ||
          whereGiven(t).toLowerCase().includes(needle) ||
          (t.speaker &&
            `${t.speaker.given_name} ${t.speaker.family_name}`.toLowerCase().includes(needle))) &&
        (eventFilter.length === 0 ||
          eventFilter.some((f) =>
            f === 'none' ? t.event_id === null : String(t.event_id) === f,
          )) &&
        (typeFilter.length === 0 || typeFilter.includes(t.talk_type)) &&
        (statusFilter.length === 0 || statusFilter.includes(t.status)),
    )
  }, [talks, events, q, eventFilter, typeFilter, statusFilter])
  const { sorted, sort, toggle } = useSortable(filtered, accessors)
  const { paged, page, setPage, total, count } = usePagination(sorted)

  const openCreate = () => {
    // Members most often record their own seminars/colloquia — default the
    // speaker to themselves; office users start blank (open talks).
    setForm({
      ...emptyForm,
      speaker_person_id: !isOffice && me?.person_id ? String(me.person_id) : '',
    })
    setCreateOpen(true)
  }

  const createTalk = async () => {
    const speakerId = form.speaker_person_id ? Number(form.speaker_person_id) : null
    // A talk added with a speaker is already settled: given if the date has
    // passed, assigned otherwise. Without a speaker it stays open for
    // nominations.
    const status = speakerId
      ? form.date && form.date <= today()
        ? 'given'
        : 'assigned'
      : 'open'
    try {
      await api.post('/talks', {
        title: form.title,
        event_id: form.event_id ? Number(form.event_id) : null,
        venue: form.venue || null,
        talk_type: form.talk_type,
        date: form.date || null,
        is_invited: form.is_invited === 'true',
        speaker_person_id: speakerId,
        status,
      })
      setCreateOpen(false)
      load()
    } catch (err: any) {
      notifications.show({ color: 'red', message: err.message })
    }
  }

  // The nominee pick belongs to the open detail modal — clear it whenever the
  // modal closes, so it can't carry over and nominate the wrong person for
  // the next talk opened.
  const closeDetail = () => {
    setDetail(null)
    setNominee(null)
  }

  const deleteTalk = async (talk: Talk) => {
    if (!window.confirm(`Delete "${talk.title}"?`)) return
    try {
      await api.delete(`/talks/${talk.id}`)
      closeDetail()
      load()
    } catch (err: any) {
      notifications.show({ color: 'red', message: err.message })
    }
  }

  const nominate = async (talk: Talk, personId: number) => {
    try {
      await api.post(`/talks/${talk.id}/nominations`, { person_id: personId })
      notifications.show({ message: 'Nomination submitted' })
      load()
      closeDetail()
    } catch (err: any) {
      notifications.show({ color: 'red', message: err.message })
    }
  }

  const setNomStatus = async (nomId: number, status: string) => {
    try {
      await api.patch(`/nominations/${nomId}`, { status })
      load()
      closeDetail()
    } catch (err: any) {
      notifications.show({ color: 'red', message: err.message })
    }
  }

  return (
    <>
      <Group justify="space-between" mb="md">
        <Title order={3}>Talks & speakers</Title>
        <Button onClick={openCreate}>Add talk</Button>
      </Group>

      <Group mb="md" gap="xs">
        <TextInput
          placeholder="Search title, conference, venue or speaker…"
          value={q}
          onChange={(e) => setQ(e.currentTarget.value)}
          w={260}
        />
        <MultiSelect
          data={[
            { value: 'none', label: 'No conference (seminars & colloquia)' },
            ...events.map((e) => ({ value: String(e.id), label: e.name })),
          ]}
          value={eventFilter}
          onChange={setEventFilter}
          clearable
          searchable
          placeholder={eventFilter.length ? undefined : 'All conferences'}
          w={230}
        />
        <MultiSelect
          data={TALK_TYPES}
          value={typeFilter}
          onChange={setTypeFilter}
          clearable
          placeholder={typeFilter.length ? undefined : 'All types'}
          w={180}
        />
        <MultiSelect
          data={['open', 'nominations', 'assigned', 'given', 'cancelled']}
          value={statusFilter}
          onChange={setStatusFilter}
          clearable
          placeholder={statusFilter.length ? undefined : 'All statuses'}
          w={190}
        />
      </Group>

      <PageCount shown={paged.length} count={count} noun="talks" />
      <Table striped highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <SortableTh label="Date" k="date" sort={sort} toggle={toggle} />
            <SortableTh label="Conference / venue" k="conference" sort={sort} toggle={toggle} />
            <SortableTh label="Title" k="title" sort={sort} toggle={toggle} />
            <SortableTh label="Type" k="type" sort={sort} toggle={toggle} />
            <SortableTh label="Speaker" k="speaker" sort={sort} toggle={toggle} />
            <SortableTh label="Status" k="status" sort={sort} toggle={toggle} />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {paged.map((t) => (
            <Table.Tr key={t.id} style={{ cursor: 'pointer' }} onClick={() => setDetail(t)}>
              <Table.Td>{t.date}</Table.Td>
              <Table.Td>{whereGiven(t)}</Table.Td>
              <Table.Td>{t.title}</Table.Td>
              <Table.Td>
                {t.talk_type}
                {t.is_invited && (
                  <Badge ml={6} size="xs" variant="light" color="grape">
                    invited
                  </Badge>
                )}
              </Table.Td>
              <Table.Td>
                {t.speaker ? (
                  <Text
                    size="sm"
                    c="blue"
                    component="span"
                    style={{ cursor: 'pointer' }}
                    onClick={(e) => {
                      e.stopPropagation()
                      navigate(`/people/${t.speaker!.id}`)
                    }}
                  >
                    {t.speaker.given_name} {t.speaker.family_name}
                  </Text>
                ) : (
                  '—'
                )}
              </Table.Td>
              <Table.Td>
                <StatusBadge status={t.status} />
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      <PaginationBar page={page} total={total} setPage={setPage} />

      <Modal
        opened={detail !== null}
        onClose={closeDetail}
        title={detail?.title}
        size="lg"
      >
        {detail && (
          <Stack>
            <Group gap="xs" justify="space-between">
              <Group gap="xs">
                <StatusBadge status={detail.status} />
                <Text size="sm" c="dimmed">
                  {whereGiven(detail)} {detail.date ? `— ${detail.date}` : ''}
                </Text>
              </Group>
              {(isOffice || me?.user.id === detail.created_by_user_id) && (
                <Button
                  size="compact-xs"
                  variant="subtle"
                  color="red"
                  onClick={() => deleteTalk(detail)}
                >
                  Delete
                </Button>
              )}
            </Group>
            {detail.notes && <Text size="sm">{detail.notes}</Text>}

            <Card withBorder>
              <Title order={6} mb="xs">
                Nominations
              </Title>
              {detail.nominations.length === 0 && (
                <Text size="sm" c="dimmed">
                  No nominations yet.
                </Text>
              )}
              {detail.nominations.map((n) => (
                <Group key={n.id} justify="space-between" mb={4}>
                  <Text size="sm" component={Link} to={`/people/${n.person.id}`} c="blue">
                    {n.person.given_name} {n.person.family_name}
                  </Text>
                  <Group gap="xs">
                    <StatusBadge status={n.status} />
                    {isOffice && n.status !== 'assigned' && (
                      <Button size="compact-xs" onClick={() => setNomStatus(n.id, 'assigned')}>
                        Assign
                      </Button>
                    )}
                    {(isOffice ||
                      me?.person_id === n.person.id ||
                      me?.user.id === n.nominated_by_user_id) &&
                      n.status === 'nominated' && (
                        <Button
                          size="compact-xs"
                          variant="subtle"
                          color="gray"
                          onClick={() => setNomStatus(n.id, 'withdrawn')}
                        >
                          Withdraw
                        </Button>
                      )}
                  </Group>
                </Group>
              ))}
              {['open', 'nominations'].includes(detail.status) && (
                <Group mt="sm">
                  <Select
                    placeholder="Nominate someone…"
                    searchable
                    data={people.map((p) => ({
                      value: String(p.id),
                      label: `${p.family_name}, ${p.given_name}`,
                    }))}
                    value={nominee}
                    onChange={setNominee}
                    w={260}
                  />
                  <Button
                    size="xs"
                    disabled={!nominee}
                    onClick={() => nominee && nominate(detail, Number(nominee))}
                  >
                    Nominate
                  </Button>
                  {me?.person_id && (
                    <Button
                      size="xs"
                      variant="light"
                      onClick={() => nominate(detail, me.person_id!)}
                    >
                      Nominate myself
                    </Button>
                  )}
                </Group>
              )}
            </Card>
          </Stack>
        )}
      </Modal>

      <Modal opened={createOpen} onClose={() => setCreateOpen(false)} title="Add talk">
        <Stack gap="sm">
          <TextInput
            label="Title / topic"
            required
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.currentTarget.value })}
          />
          <Select
            label="Conference"
            description="Leave empty for seminars and colloquia"
            data={events.map((e) => ({ value: String(e.id), label: e.name }))}
            value={form.event_id}
            onChange={(v) => setForm({ ...form, event_id: v ?? '' })}
            searchable
            clearable
          />
          {!form.event_id && (
            <TextInput
              label="Venue"
              description="Where it was given, e.g. “MIT physics colloquium”"
              value={form.venue}
              onChange={(e) => setForm({ ...form, venue: e.currentTarget.value })}
            />
          )}
          <Group grow>
            <Select
              label="Type"
              data={TALK_TYPES}
              value={form.talk_type}
              onChange={(v) => setForm({ ...form, talk_type: v ?? 'parallel' })}
            />
            <Select
              label="Invited?"
              data={[
                { value: 'true', label: 'Invited' },
                { value: 'false', label: 'Contributed' },
              ]}
              value={form.is_invited}
              onChange={(v) => setForm({ ...form, is_invited: v ?? 'false' })}
            />
          </Group>
          <Select
            label="Speaker"
            description="Leave empty to open the talk for nominations"
            data={people.map((p) => ({
              value: String(p.id),
              label: `${p.family_name}, ${p.given_name}`,
            }))}
            value={form.speaker_person_id}
            onChange={(v) => setForm({ ...form, speaker_person_id: v ?? '' })}
            searchable
            clearable
          />
          <TextInput
            label="Date (YYYY-MM-DD)"
            value={form.date}
            onChange={(e) => setForm({ ...form, date: e.currentTarget.value })}
          />
          <Button onClick={createTalk}>Save</Button>
        </Stack>
      </Modal>
    </>
  )
}
