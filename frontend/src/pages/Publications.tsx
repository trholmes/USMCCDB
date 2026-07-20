import {
  Button,
  Group,
  Modal,
  Select,
  Stack,
  Table,
  Textarea,
  TextInput,
  Title,
} from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import type { Publication, WorkingGroup } from '../api/types'
import StatusBadge from '../components/StatusBadge'
import { SortableTh, useSortable, type Accessors } from '../components/sortable'
import { useSession } from '../auth/SessionContext'

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
  const navigate = useNavigate()
  const { isOffice } = useSession()
  const { sorted, sort, toggle } = useSortable(pubs, ACCESSORS)

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
        <Button onClick={() => setModal(true)}>Propose publication</Button>
      </Group>
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

      <Modal opened={modal} onClose={() => setModal(false)} title="Propose a publication">
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
          <Button onClick={save} disabled={!isOffice && false}>
            Submit
          </Button>
        </Stack>
      </Modal>
    </>
  )
}
