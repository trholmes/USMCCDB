import {
  Anchor,
  Button,
  Card,
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

const STATUSES = ['proposed', 'in_progress', 'collab_review', 'submitted', 'published']

export default function PublicationDetailPage() {
  const { id } = useParams()
  const [pub, setPub] = useState<Publication | null>(null)
  const [lists, setLists] = useState<AuthorList[]>([])
  const [people, setPeople] = useState<PersonSummary[]>([])
  const [cutoff, setCutoff] = useState('')
  const [editorPick, setEditorPick] = useState<string | null>(null)
  const { isOffice } = useSession()

  const load = useCallback(() => {
    api.get<Publication>(`/publications/${id}`).then(setPub).catch(() => setPub(null))
    api
      .get<AuthorList[]>(`/author-lists?publication_id=${id}`)
      .then(setLists)
      .catch(() => setLists([]))
    api.get<PersonSummary[]>('/people?status=active').then(setPeople).catch(() => setPeople([]))
  }, [id])
  useEffect(load, [load])

  if (!pub) return <Text c="dimmed">Loading…</Text>

  const changeStatus = async (status: string | null) => {
    if (!status) return
    try {
      await api.post(`/publications/${pub.id}/status`, { status })
      load()
    } catch (err: any) {
      notifications.show({ color: 'red', message: err.message })
    }
  }

  const addEditor = async () => {
    if (!editorPick) return
    try {
      await api.post(`/publications/${pub.id}/people`, {
        person_id: Number(editorPick),
        role: 'editor',
      })
      setEditorPick(null)
      load()
    } catch (err: any) {
      notifications.show({ color: 'red', message: err.message })
    }
  }

  const generate = async () => {
    try {
      const cutoffDate = cutoff || new Date().toISOString().slice(0, 10)
      await api.post(`/publications/${pub.id}/author-list`, { cutoff_date: cutoffDate })
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
        {isOffice && (
          <Select placeholder="Change status…" data={STATUSES} onChange={changeStatus} w={170} />
        )}
      </Group>

      {pub.abstract && (
        <Card withBorder>
          <Text size="sm">{pub.abstract}</Text>
        </Card>
      )}

      <Card withBorder>
        <Title order={6} mb="xs">
          Editors & contacts
        </Title>
        {pub.people.length === 0 && (
          <Text size="sm" c="dimmed">
            Nobody assigned yet.
          </Text>
        )}
        {pub.people.map((pp) => (
          <Group key={pp.id} gap="xs">
            <Text size="sm">
              {pp.person.given_name} {pp.person.family_name}
            </Text>
            <Text size="xs" c="dimmed">
              {pp.role.replace('_', ' ')}
            </Text>
          </Group>
        ))}
        {isOffice && (
          <Group mt="sm">
            <Select
              placeholder="Add editor…"
              searchable
              data={people.map((p) => ({
                value: String(p.id),
                label: `${p.family_name}, ${p.given_name}`,
              }))}
              value={editorPick}
              onChange={setEditorPick}
              w={260}
            />
            <Button size="xs" onClick={addEditor} disabled={!editorPick}>
              Add
            </Button>
          </Group>
        )}
      </Card>

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
