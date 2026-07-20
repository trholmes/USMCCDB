import {
  Badge,
  Button,
  Card,
  Group,
  Modal,
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
import { SortableTh, useSortable, type Accessors } from '../components/sortable'
import type { EventItem, PersonSummary, Talk } from '../api/types'
import StatusBadge from '../components/StatusBadge'
import { useSession } from '../auth/SessionContext'

export default function TalksPage() {
  const [talks, setTalks] = useState<Talk[]>([])
  const [events, setEvents] = useState<EventItem[]>([])
  const [people, setPeople] = useState<PersonSummary[]>([])
  const [detail, setDetail] = useState<Talk | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [form, setForm] = useState({
    title: '',
    event_id: '',
    talk_type: 'parallel',
    date: '',
    is_invited: 'false',
  })
  const [nominee, setNominee] = useState<string | null>(null)
  const { me, isOffice } = useSession()
  const navigate = useNavigate()

  const load = useCallback(() => {
    api.get<Talk[]>('/talks').then(setTalks).catch(() => setTalks([]))
    api.get<EventItem[]>('/events').then(setEvents).catch(() => setEvents([]))
    api.get<PersonSummary[]>('/people?status=active').then(setPeople).catch(() => setPeople([]))
  }, [])
  useEffect(load, [load])

  const eventName = (id: number | null) => events.find((e) => e.id === id)?.name ?? ''

  const accessors = useMemo<Accessors<Talk>>(
    () => ({
      date: (t) => t.date,
      conference: (t) => events.find((e) => e.id === t.event_id)?.name,
      title: (t) => t.title,
      type: (t) => `${t.talk_type}${t.is_invited ? ' invited' : ''}`,
      speaker: (t) => (t.speaker ? `${t.speaker.family_name} ${t.speaker.given_name}` : null),
      status: (t) => t.status,
    }),
    [events],
  )
  const { sorted, sort, toggle } = useSortable(talks, accessors)

  const createTalk = async () => {
    try {
      await api.post('/talks', {
        title: form.title,
        event_id: form.event_id ? Number(form.event_id) : null,
        talk_type: form.talk_type,
        date: form.date || null,
        is_invited: form.is_invited === 'true',
      })
      setCreateOpen(false)
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
      setDetail(null)
    } catch (err: any) {
      notifications.show({ color: 'red', message: err.message })
    }
  }

  const setNomStatus = async (nomId: number, status: string) => {
    try {
      await api.patch(`/nominations/${nomId}`, { status })
      load()
      setDetail(null)
    } catch (err: any) {
      notifications.show({ color: 'red', message: err.message })
    }
  }

  return (
    <>
      <Group justify="space-between" mb="md">
        <Title order={3}>Talks & speakers</Title>
        {isOffice && <Button onClick={() => setCreateOpen(true)}>Add talk</Button>}
      </Group>

      <Table striped highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <SortableTh label="Date" k="date" sort={sort} toggle={toggle} />
            <SortableTh label="Conference" k="conference" sort={sort} toggle={toggle} />
            <SortableTh label="Title" k="title" sort={sort} toggle={toggle} />
            <SortableTh label="Type" k="type" sort={sort} toggle={toggle} />
            <SortableTh label="Speaker" k="speaker" sort={sort} toggle={toggle} />
            <SortableTh label="Status" k="status" sort={sort} toggle={toggle} />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {sorted.map((t) => (
            <Table.Tr key={t.id} style={{ cursor: 'pointer' }} onClick={() => setDetail(t)}>
              <Table.Td>{t.date}</Table.Td>
              <Table.Td>{eventName(t.event_id)}</Table.Td>
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

      <Modal
        opened={detail !== null}
        onClose={() => setDetail(null)}
        title={detail?.title}
        size="lg"
      >
        {detail && (
          <Stack>
            <Group gap="xs">
              <StatusBadge status={detail.status} />
              <Text size="sm" c="dimmed">
                {eventName(detail.event_id)} {detail.date ? `— ${detail.date}` : ''}
              </Text>
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
            data={events.map((e) => ({ value: String(e.id), label: e.name }))}
            value={form.event_id}
            onChange={(v) => setForm({ ...form, event_id: v ?? '' })}
            searchable
            clearable
          />
          <Group grow>
            <Select
              label="Type"
              data={['plenary', 'parallel', 'poster', 'seminar', 'outreach']}
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
