import {
  ActionIcon,
  Anchor,
  Button,
  Card,
  CopyButton,
  Group,
  Modal,
  MultiSelect,
  Select,
  Stack,
  Table,
  Text,
  Textarea,
  TextInput,
  Title,
} from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { api, exportUrl } from '../api/client'
import type { AuthorList, PersonSummary, Publication, PubPerson, WorkingGroup } from '../api/types'
import StatusBadge from '../components/StatusBadge'
import { useSession } from '../auth/SessionContext'
import { today } from '../dates'

const STATUSES = ['in_progress', 'collab_review', 'submitted', 'published']
const MEMBER_ROLES = [
  { value: 'contributor', label: 'Contributor' },
  { value: 'contact', label: 'Contact' },
]
const OFFICE_ROLES = [...MEMBER_ROLES, { value: 'reviewer', label: 'Reviewer' }]

export default function PublicationDetailPage() {
  const { id } = useParams()
  const [pub, setPub] = useState<Publication | null>(null)
  const [lists, setLists] = useState<AuthorList[]>([])
  const [people, setPeople] = useState<PersonSummary[]>([])
  const [cutoff, setCutoff] = useState('')
  const [scope, setScope] = useState<string | null>('involved')
  // Several people can be picked and attached in one go (issue #102).
  const [personPicks, setPersonPicks] = useState<string[]>([])
  const [rolePick, setRolePick] = useState<string | null>('contributor')
  // Group staging (issue #102): picking an institution or working group adds
  // its (active) members to the picker as a reviewable preview, not straight
  // to the publication.
  const [groupWgBusy, setGroupWgBusy] = useState(false)
  // Per-person contribution text: written by the person, editable by contacts.
  const [contribEdit, setContribEdit] = useState<PubPerson | null>(null)
  const [contribText, setContribText] = useState('')
  // Contribution entered while adding a single person (required then; group
  // adds instead prompt each person to describe theirs).
  const [contribNew, setContribNew] = useState('')
  const [ack, setAck] = useState<string | null>(null)
  const [wgs, setWgs] = useState<WorkingGroup[]>([])
  const [editOpen, setEditOpen] = useState(false)
  const [editForm, setEditForm] = useState({
    title: '',
    pub_type: 'paper',
    working_group_id: '',
    arxiv_id: '',
    doi: '',
    journal: '',
    target_journal: '',
    abstract: '',
  })
  const { me, canManagePubs } = useSession()

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
    api.get<WorkingGroup[]>('/working-groups').then(setWgs).catch(() => setWgs([]))
  }, [id])
  useEffect(load, [load])

  if (!pub) return <Text c="dimmed">Loading…</Text>

  const isContact =
    me?.person_id != null &&
    pub.people.some((pp) => pp.role === 'contact' && pp.person.id === me.person_id)
  const canManage = canManagePubs || isContact

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
    if (
      !window.confirm(
        'Request collaboration review? This notifies the office, which will assign readers.',
      )
    )
      return
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

  const revokeReview = async () => {
    if (!window.confirm('Revoke the collaboration review request and move back to in progress?'))
      return
    try {
      await api.post(`/publications/${pub.id}/status`, { status: 'in_progress' })
      notifications.show({ message: 'Collaboration review request revoked.' })
      load()
    } catch (err: any) {
      notifications.show({ color: 'red', message: err.message })
    }
  }

  const startEdit = () => {
    setEditForm({
      title: pub.title,
      pub_type: pub.pub_type,
      working_group_id: pub.working_group_id ? String(pub.working_group_id) : '',
      arxiv_id: pub.arxiv_id ?? '',
      doi: pub.doi ?? '',
      journal: pub.journal ?? '',
      target_journal: pub.target_journal ?? '',
      abstract: pub.abstract ?? '',
    })
    setEditOpen(true)
  }

  const saveEdit = async () => {
    try {
      await api.patch(`/publications/${pub.id}`, {
        title: editForm.title,
        pub_type: editForm.pub_type,
        working_group_id: editForm.working_group_id ? Number(editForm.working_group_id) : null,
        arxiv_id: editForm.arxiv_id || null,
        doi: editForm.doi || null,
        journal: editForm.journal || null,
        target_journal: editForm.target_journal || null,
        abstract: editForm.abstract || null,
      })
      setEditOpen(false)
      load()
    } catch (err: any) {
      notifications.show({ color: 'red', message: err.message })
    }
  }

  const stagePeople = (ids: string[]) => {
    setPersonPicks((prev) => [...new Set([...prev, ...ids])])
  }

  const stageInstitution = (instId: string | null) => {
    if (!instId) return
    stagePeople(
      people
        .filter((p) => String(p.primary_institution?.id) === instId)
        .map((p) => String(p.id)),
    )
  }

  const stageWorkingGroup = async (wgId: string | null) => {
    if (!wgId) return
    setGroupWgBusy(true)
    try {
      const members = await api.get<PersonSummary[]>(`/working-groups/${wgId}/members`)
      const active = new Set(people.map((p) => p.id))
      stagePeople(members.filter((m) => active.has(m.id)).map((m) => String(m.id)))
    } catch (err: any) {
      notifications.show({ color: 'red', message: err.message })
    } finally {
      setGroupWgBusy(false)
    }
  }

  // A single add requires the contribution up front; a group add can't (they
  // are individual), so each added person is prompted on the page instead.
  const needsContribution =
    personPicks.length === 1 && rolePick !== 'reviewer' && !contribNew.trim()

  const addPeople = async () => {
    if (personPicks.length === 0 || !rolePick || needsContribution) return
    try {
      const added = await api.post<PubPerson[]>(`/publications/${pub.id}/people/bulk`, {
        person_ids: personPicks.map(Number),
        role: rolePick,
      })
      if (personPicks.length === 1 && contribNew.trim() && added.length === 1) {
        await api.patch(`/publications/${pub.id}/people/${added[0].id}`, {
          contribution: contribNew.trim(),
        })
      }
      setPersonPicks([])
      setContribNew('')
      load()
    } catch (err: any) {
      notifications.show({ color: 'red', message: err.message })
    }
  }

  const openContrib = (pp: PubPerson) => {
    setContribEdit(pp)
    setContribText(pp.contribution ?? '')
  }

  const saveContrib = async () => {
    if (!contribEdit) return
    try {
      await api.patch(`/publications/${pub.id}/people/${contribEdit.id}`, {
        contribution: contribText,
      })
      setContribEdit(null)
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
          {canManage && <Button variant="default" onClick={startEdit}>Edit details</Button>}
          {canManage && pub.status === 'in_progress' && (
            <Button onClick={requestReview}>Request collaboration review</Button>
          )}
          {canManage && pub.status === 'collab_review' && (
            <Button variant="light" color="orange" onClick={revokeReview}>
              Revoke review request
            </Button>
          )}
          {canManagePubs && (
            <Select placeholder="Change status…" data={STATUSES} onChange={changeStatus} w={{ base: '100%', xs: 170 }} />
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
                <Table.Td maw={420}>
                  {pp.role !== 'reviewer' &&
                    (pp.contribution ? (
                      <Text size="xs">
                        {pp.contribution}
                        {(me?.person_id === pp.person.id || canManage) && (
                          <Text
                            size="xs"
                            c="blue"
                            component="span"
                            ml={6}
                            style={{ cursor: 'pointer' }}
                            onClick={() => openContrib(pp)}
                          >
                            edit
                          </Text>
                        )}
                      </Text>
                    ) : me?.person_id === pp.person.id ? (
                      <Button size="compact-xs" variant="light" onClick={() => openContrib(pp)}>
                        Add your contribution…
                      </Button>
                    ) : (
                      <Text size="xs" c="dimmed" fs="italic">
                        no contribution described yet
                        {canManage && (
                          <Text
                            size="xs"
                            c="blue"
                            component="span"
                            ml={6}
                            fs="normal"
                            style={{ cursor: 'pointer' }}
                            onClick={() => openContrib(pp)}
                          >
                            add
                          </Text>
                        )}
                      </Text>
                    ))}
                </Table.Td>
                <Table.Td>
                  {canManage && (pp.role !== 'reviewer' || canManagePubs) && (
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
          <Group mt="sm" align="flex-start">
            <MultiSelect
              placeholder={personPicks.length ? undefined : 'Add people from directory…'}
              searchable
              clearable
              data={people.map((p) => ({
                value: String(p.id),
                label: `${p.family_name}, ${p.given_name}`,
              }))}
              value={personPicks}
              onChange={setPersonPicks}
              w={{ base: '100%', xs: 340 }}
            />
            <Select
              data={canManagePubs ? OFFICE_ROLES : MEMBER_ROLES}
              value={rolePick}
              onChange={setRolePick}
              w={{ base: '100%', xs: 170 }}
            />
            <Button
              size="xs"
              onClick={addPeople}
              disabled={personPicks.length === 0 || !rolePick || needsContribution}
            >
              Add{personPicks.length > 1 ? ` ${personPicks.length}` : ''}
            </Button>
          </Group>
        )}
        {canManage && personPicks.length === 1 && rolePick !== 'reviewer' && (
          <TextInput
            mt="xs"
            maw={565}
            placeholder="Their contribution to the paper (required) — e.g. analysis, plots, writing…"
            maxLength={2000}
            value={contribNew}
            onChange={(e) => setContribNew(e.currentTarget.value)}
          />
        )}
        {canManage && personPicks.length > 1 && (
          <Text size="xs" c="dimmed" mt="xs">
            Contributions are individual — each added person is asked to describe theirs on this
            page (contacts can fill them in too).
          </Text>
        )}
        {canManage && (
          <Group mt="xs" gap="xs" align="center">
            <Text size="xs" c="dimmed">
              Add a whole group (staged into the picker above to review before adding):
            </Text>
            <Select
              placeholder="Everyone at institution…"
              searchable
              size="xs"
              data={[
                ...new Map(
                  people
                    .filter((p) => p.primary_institution)
                    .map((p) => [
                      String(p.primary_institution!.id),
                      p.primary_institution!.short_name || p.primary_institution!.name,
                    ]),
                ).entries(),
              ]
                .map(([value, label]) => ({ value, label }))
                .sort((a, b) => a.label.localeCompare(b.label))}
              value={null}
              onChange={stageInstitution}
              w={{ base: '100%', xs: 230 }}
            />
            <Select
              placeholder="Everyone in working group…"
              size="xs"
              data={wgs.map((w) => ({ value: String(w.id), label: w.name }))}
              value={null}
              onChange={stageWorkingGroup}
              disabled={groupWgBusy}
              w={{ base: '100%', xs: 240 }}
            />
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
          <div key={l.id}>
            <Group gap="md" mb={6}>
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
            {(l.snapshot.warnings ?? []).map((w, i) => (
              <Text key={i} size="xs" c="orange" mb={6}>
                ⚠ {w}
              </Text>
            ))}
          </div>
        ))}
        <Group mt="sm">
          <Select
            data={[
              { value: 'involved', label: 'People involved' },
              { value: 'collaboration', label: 'Whole collaboration' },
            ]}
            value={scope}
            onChange={setScope}
            w={{ base: '100%', xs: 190 }}
          />
          <TextInput
            placeholder="Cutoff date YYYY-MM-DD (default: today)"
            value={cutoff}
            onChange={(e) => setCutoff(e.currentTarget.value)}
            w={{ base: '100%', xs: 280 }}
          />
          <Button size="xs" onClick={generate}>
            Generate author list
          </Button>
        </Group>
      </Card>

      <Modal
        opened={contribEdit !== null}
        onClose={() => setContribEdit(null)}
        title={
          contribEdit
            ? `Contribution of ${contribEdit.person.given_name} ${contribEdit.person.family_name}`
            : ''
        }
      >
        <Stack gap="sm">
          <Textarea
            description="What this person did on the paper — e.g. analysis, plots, writing, review of a section."
            autosize
            minRows={3}
            maxLength={2000}
            value={contribText}
            onChange={(e) => setContribText(e.currentTarget.value)}
          />
          <Group>
            <Button onClick={saveContrib}>Save</Button>
            <Button variant="subtle" onClick={() => setContribEdit(null)}>
              Cancel
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal opened={editOpen} onClose={() => setEditOpen(false)} title="Edit publication">
        <Stack gap="sm">
          <TextInput
            label="Title"
            required
            value={editForm.title}
            onChange={(e) => setEditForm({ ...editForm, title: e.currentTarget.value })}
          />
          <Group grow>
            <Select
              label="Type"
              data={[
                { value: 'paper', label: 'Paper' },
                { value: 'proceedings', label: 'Proceedings' },
                { value: 'note', label: 'Note' },
                { value: 'white_paper', label: 'White paper' },
              ]}
              value={editForm.pub_type}
              onChange={(v) => setEditForm({ ...editForm, pub_type: v ?? editForm.pub_type })}
            />
            <Select
              label="Working group"
              data={wgs.map((w) => ({ value: String(w.id), label: w.name }))}
              value={editForm.working_group_id}
              onChange={(v) => setEditForm({ ...editForm, working_group_id: v ?? '' })}
              clearable
              searchable
            />
          </Group>
          <Group grow>
            <TextInput
              label="arXiv id"
              placeholder="2401.01234"
              value={editForm.arxiv_id}
              onChange={(e) => setEditForm({ ...editForm, arxiv_id: e.currentTarget.value })}
            />
            <TextInput
              label="DOI"
              value={editForm.doi}
              onChange={(e) => setEditForm({ ...editForm, doi: e.currentTarget.value })}
            />
          </Group>
          <Group grow>
            <TextInput
              label="Journal"
              value={editForm.journal}
              onChange={(e) => setEditForm({ ...editForm, journal: e.currentTarget.value })}
            />
            <TextInput
              label="Target journal"
              value={editForm.target_journal}
              onChange={(e) => setEditForm({ ...editForm, target_journal: e.currentTarget.value })}
            />
          </Group>
          <Textarea
            label="Abstract"
            autosize
            minRows={3}
            value={editForm.abstract}
            onChange={(e) => setEditForm({ ...editForm, abstract: e.currentTarget.value })}
          />
          <Button onClick={saveEdit} disabled={!editForm.title.trim()}>
            Save
          </Button>
        </Stack>
      </Modal>
    </Stack>
  )
}
