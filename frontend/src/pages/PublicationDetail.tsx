import {
  ActionIcon,
  Anchor,
  Button,
  Card,
  CopyButton,
  Group,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { api, exportUrl } from '../api/client'
import type { AuthorList, PersonSummary, Publication } from '../api/types'
import StatusBadge from '../components/StatusBadge'
import { useSession } from '../auth/SessionContext'
import { today } from '../dates'

const STATUSES = ['in_progress', 'collab_review', 'submitted', 'published']
const MEMBER_ROLES = [
  { value: 'contributor', label: 'Contributor' },
  { value: 'editor', label: 'Editor' },
  { value: 'contact', label: 'Contact' },
  { value: 'analysis_contact', label: 'Analysis contact' },
]
const OFFICE_ROLES = [...MEMBER_ROLES, { value: 'reviewer', label: 'Reviewer' }]

export default function PublicationDetailPage() {
  const { id } = useParams()
  const [pub, setPub] = useState<Publication | null>(null)
  const [lists, setLists] = useState<AuthorList[]>([])
  const [people, setPeople] = useState<PersonSummary[]>([])
  const [cutoff, setCutoff] = useState('')
  const [scope, setScope] = useState<string | null>('involved')
  const [personPick, setPersonPick] = useState<string | null>(null)
  const [rolePick, setRolePick] = useState<string | null>('contributor')
  const [ack, setAck] = useState<string | null>(null)
  const { me, isOffice } = useSession()

  const load = useCallback(() => {
    api
      .get<Publication>(`/publications/${id}`)
      .then((p) => {
        setPub(p)
        if (p.status !== 'in_progress') {
          api
            .get<{ text: string }>(`/publications/${id}/acknowledgment`)
            .then((a) => setAck(a.text))
            .catch(() => setAck(null))
        } else {
          setAck(null)
        }
      })
      .catch(() => setPub(null))
    api
      .get<AuthorList[]>(`/author-lists?publication_id=${id}`)
      .then(setLists)
      .catch(() => setLists([]))
    api.get<PersonSummary[]>('/people?status=active').then(setPeople).catch(() => setPeople([]))
  }, [id])
  useEffect(load, [load])

  if (!pub) return <Text c="dimmed">Loading…</Text>

  const isEditor =
    me?.person_id != null &&
    pub.people.some((pp) => pp.role === 'editor' && pp.person.id === me.person_id)
  const canManage = isOffice || isEditor

  const changeStatus = async (status: string | null) => {
    if (!status) return
    try {
      await api.post(`/publications/${pub.id}/status`, { status })
      load()
    } catch (err: any) {
      notifications.show({ color: 'red', message: err.message })
    }
  }

  const requestReview = async () => {
    try {
      await api.post(`/publications/${pub.id}/status`, { status: 'collab_review' })
      notifications.show({
        message: 'Collaboration review requested — suggested acknowledgment text is below.',
      })
      load()
    } catch (err: any) {
      notifications.show({ color: 'red', message: err.message })
    }
  }

  const addPerson = async () => {
    if (!personPick || !rolePick) return
    try {
      await api.post(`/publications/${pub.id}/people`, {
        person_id: Number(personPick),
        role: rolePick,
      })
      setPersonPick(null)
      load()
    } catch (err: any) {
      notifications.show({ color: 'red', message: err.message })
    }
  }

  const removePerson = async (ppId: number) => {
    try {
      await api.delete(`/publications/${pub.id}/people/${ppId}`)
      load()
    } catch (err: any) {
      notifications.show({ color: 'red', message: err.message })
    }
  }

  const generate = async () => {
    try {
      // Local date, not UTC — author periods are inclusive on both ends, so
      // a UTC off-by-one would wrongly include/exclude boundary authors.
      const cutoffDate = cutoff || today()
      await api.post(`/publications/${pub.id}/author-list`, {
        cutoff_date: cutoffDate,
        scope: scope ?? 'involved',
      })
      notifications.show({ message: 'Author list generated' })
      load()
    } catch (err: any) {
      notifications.show({ color: 'red', message: err.message })
    }
  }

  return (
    <Stack>
      <Group justify="space-between" align="flex-start">
        <div>
          <Text size="sm" c="dimmed">
            {pub.short_code}
          </Text>
          <Title order={3}>{pub.title}</Title>
          <Group gap="xs" mt={4}>
            <StatusBadge status={pub.status} />
            <Text size="sm" c="dimmed">
              {pub.pub_type.replace('_', ' ')}
            </Text>
            {pub.arxiv_id && (
              <Anchor size="sm" href={`https://arxiv.org/abs/${pub.arxiv_id}`} target="_blank">
                arXiv:{pub.arxiv_id}
              </Anchor>
            )}
            {pub.journal && <Text size="sm">{pub.journal}</Text>}
          </Group>
        </div>
        <Group gap="xs">
          {canManage && pub.status === 'in_progress' && (
            <Button onClick={requestReview}>Request collaboration review</Button>
          )}
          {isOffice && (
            <Select placeholder="Change status…" data={STATUSES} onChange={changeStatus} w={170} />
          )}
        </Group>
      </Group>

      {pub.abstract && (
        <Card withBorder>
          <Text size="sm">{pub.abstract}</Text>
        </Card>
      )}

      <Card withBorder>
        <Title order={6} mb="xs">
          People involved
        </Title>
        {pub.people.length === 0 && (
          <Text size="sm" c="dimmed">
            Nobody attached yet.
          </Text>
        )}
        <Table verticalSpacing={4} withRowBorders={false} w="auto">
          <Table.Tbody>
            {pub.people.map((pp) => (
              <Table.Tr key={pp.id}>
                <Table.Td>
                  <Text size="sm">
                    {pp.person.given_name} {pp.person.family_name}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Text size="xs" c="dimmed">
                    {pp.role.replace('_', ' ')}
                  </Text>
                </Table.Td>
                <Table.Td>
                  {canManage && (pp.role !== 'reviewer' || isOffice) && (
                    <ActionIcon
                      variant="subtle"
                      color="red"
                      size="sm"
                      aria-label="Remove"
                      onClick={() => removePerson(pp.id)}
                    >
                      ✕
                    </ActionIcon>
                  )}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
        {canManage && (
          <Group mt="sm">
            <Select
              placeholder="Add person from directory…"
              searchable
              data={people.map((p) => ({
                value: String(p.id),
                label: `${p.family_name}, ${p.given_name}`,
              }))}
              value={personPick}
              onChange={setPersonPick}
              w={260}
            />
            <Select
              data={isOffice ? OFFICE_ROLES : MEMBER_ROLES}
              value={rolePick}
              onChange={setRolePick}
              w={170}
            />
            <Button size="xs" onClick={addPerson} disabled={!personPick || !rolePick}>
              Add
            </Button>
          </Group>
        )}
      </Card>

      {ack && (
        <Card withBorder>
          <Group justify="space-between" mb="xs">
            <Title order={6}>Suggested acknowledgment</Title>
            <CopyButton value={ack}>
              {({ copied, copy }) => (
                <Button size="xs" variant="light" onClick={copy}>
                  {copied ? 'Copied' : 'Copy'}
                </Button>
              )}
            </CopyButton>
          </Group>
          <Text size="sm">{ack}</Text>
        </Card>
      )}

      <Card withBorder>
        <Title order={6} mb="xs">
          Author lists
        </Title>
        {lists.map((l) => (
          <Group key={l.id} gap="md" mb={6}>
            <Text size="sm">
              cutoff {l.cutoff_date} — {l.snapshot.authors.length} authors,{' '}
              {Object.keys(l.snapshot.institutions).length} institutions
            </Text>
            <Group gap={6}>
              <Anchor size="sm" href={exportUrl(l.id, 'txt')}>
                txt
              </Anchor>
              <Anchor size="sm" href={exportUrl(l.id, 'tex')}>
                LaTeX
              </Anchor>
              <Anchor size="sm" href={exportUrl(l.id, 'xml')}>
                authors.xml
              </Anchor>
            </Group>
          </Group>
        ))}
        <Group mt="sm">
          <Select
            data={[
              { value: 'involved', label: 'People involved' },
              { value: 'collaboration', label: 'Whole collaboration' },
            ]}
            value={scope}
            onChange={setScope}
            w={190}
          />
          <TextInput
            placeholder="Cutoff date YYYY-MM-DD (default: today)"
            value={cutoff}
            onChange={(e) => setCutoff(e.currentTarget.value)}
            w={280}
          />
          <Button size="xs" onClick={generate}>
            Generate author list
          </Button>
        </Group>
      </Card>
    </Stack>
  )
}
