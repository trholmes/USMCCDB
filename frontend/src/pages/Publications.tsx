import {
  Button,
  Group,
  Modal,
  Select,
  Stack,
  Table,
  Text,
  Textarea,
  TextInput,
  Title,
} from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import type { Publication, WorkingGroup } from '../api/types'
import StatusBadge from '../components/StatusBadge'
import { SortableTh, useSortable, type Accessors } from '../components/sortable'

const ACCESSORS: Accessors<Publication> = {
  code: (p) => p.short_code,
  title: (p) => p.title,
  type: (p) => p.pub_type,
  status: (p) => p.status,
  ref: (p) => p.arxiv_id || p.journal,
}

export default function PublicationsPage() {
  const [pubs, setPubs] = useState<Publication[]>([])
  const [wgs, setWgs] = useState<WorkingGroup[]>([])
  const [modal, setModal] = useState(false)
  const [form, setForm] = useState({
    title: '',
    pub_type: 'paper',
    working_group_id: '',
    target_journal: '',
    abstract: '',
  })
  const [q, setQ] = useState('')
  const [typeFilter, setTypeFilter] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<string | null>(null)
  const [wgFilter, setWgFilter] = useState<string | null>(null)
  const navigate = useNavigate()

  const filtered = useMemo(() => {
    const needle = q.toLowerCase()
    return pubs.filter(
      (p) =>
        (!needle ||
          p.title.toLowerCase().includes(needle) ||
          (p.short_code ?? '').toLowerCase().includes(needle) ||
          (p.arxiv_id ?? '').toLowerCase().includes(needle) ||
          (p.journal ?? '').toLowerCase().includes(needle)) &&
        (!typeFilter || p.pub_type === typeFilter) &&
        (!statusFilter || p.status === statusFilter) &&
        (!wgFilter || String(p.working_group_id) === wgFilter),
    )
  }, [pubs, q, typeFilter, statusFilter, wgFilter])
  const { sorted, sort, toggle } = useSortable(filtered, ACCESSORS)

  const load = useCallback(() => {
    api.get<Publication[]>('/publications').then(setPubs).catch(() => setPubs([]))
    api.get<WorkingGroup[]>('/working-groups').then(setWgs).catch(() => setWgs([]))
  }, [])
  useEffect(load, [load])

  const save = async () => {
    try {
      await api.post('/publications', {
        title: form.title,
        pub_type: form.pub_type,
        working_group_id: form.working_group_id ? Number(form.working_group_id) : null,
        target_journal: form.target_journal || null,
        abstract: form.abstract || null,
      })
      setModal(false)
      load()
    } catch (err: any) {
      notifications.show({ color: 'red', message: err.message })
    }
  }

  return (
    <>
      <Group justify="space-between" mb="md">
        <Title order={3}>Publications & analyses</Title>
        <Button onClick={() => setModal(true)}>Add publication</Button>
      </Group>
      <Group mb="md" gap="xs">
        <TextInput
          placeholder="Search title, code, arXiv or journal…"
          value={q}
          onChange={(e) => setQ(e.currentTarget.value)}
          w={280}
        />
        <Select
          data={[
            { value: 'paper', label: 'Paper' },
            { value: 'proceedings', label: 'Proceedings' },
            { value: 'note', label: 'Note' },
            { value: 'white_paper', label: 'White paper' },
          ]}
          value={typeFilter}
          onChange={setTypeFilter}
          clearable
          placeholder="All types"
          w={150}
        />
        <Select
          data={[
            { value: 'in_progress', label: 'In progress' },
            { value: 'collab_review', label: 'Collab review' },
            { value: 'submitted', label: 'Submitted' },
            { value: 'published', label: 'Published' },
          ]}
          value={statusFilter}
          onChange={setStatusFilter}
          clearable
          placeholder="All statuses"
          w={160}
        />
        <Select
          data={wgs.map((w) => ({ value: String(w.id), label: w.name }))}
          value={wgFilter}
          onChange={setWgFilter}
          clearable
          searchable
          placeholder="All working groups"
          w={200}
        />
      </Group>
      <Text size="sm" c="dimmed" mb="xs">
        {filtered.length} publications
      </Text>
      <Table striped highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <SortableTh label="Code" k="code" sort={sort} toggle={toggle} />
            <SortableTh label="Title" k="title" sort={sort} toggle={toggle} />
            <SortableTh label="Type" k="type" sort={sort} toggle={toggle} />
            <SortableTh label="Status" k="status" sort={sort} toggle={toggle} />
            <SortableTh label="arXiv / journal" k="ref" sort={sort} toggle={toggle} />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {sorted.map((p) => (
            <Table.Tr
              key={p.id}
              style={{ cursor: 'pointer' }}
              onClick={() => navigate(`/publications/${p.id}`)}
            >
              <Table.Td>{p.short_code}</Table.Td>
              <Table.Td>{p.title}</Table.Td>
              <Table.Td>{p.pub_type.replace('_', ' ')}</Table.Td>
              <Table.Td>
                <StatusBadge status={p.status} />
              </Table.Td>
              <Table.Td>{p.arxiv_id || p.journal || ''}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>

      <Modal opened={modal} onClose={() => setModal(false)} title="Add a publication">
        <Stack gap="sm">
          <TextInput
            label="Title"
            required
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.currentTarget.value })}
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
              value={form.pub_type}
              onChange={(v) => setForm({ ...form, pub_type: v ?? 'paper' })}
            />
            <Select
              label="Working group"
              data={wgs.map((w) => ({ value: String(w.id), label: w.name }))}
              value={form.working_group_id}
              onChange={(v) => setForm({ ...form, working_group_id: v ?? '' })}
              clearable
            />
          </Group>
          <TextInput
            label="Target journal"
            value={form.target_journal}
            onChange={(e) => setForm({ ...form, target_journal: e.currentTarget.value })}
          />
          <Textarea
            label="Abstract"
            value={form.abstract}
            onChange={(e) => setForm({ ...form, abstract: e.currentTarget.value })}
          />
          <Button onClick={save}>Save</Button>
        </Stack>
      </Modal>
    </>
  )
}
