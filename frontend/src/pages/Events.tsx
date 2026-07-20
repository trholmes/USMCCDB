import { Anchor, Button, Group, Modal, Stack, Table, TextInput, Title } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useCallback, useEffect, useState } from 'react'
import { api } from '../api/client'
import type { EventItem } from '../api/types'
import { SortableTh, useSortable, type Accessors } from '../components/sortable'
import { useSession } from '../auth/SessionContext'

const ACCESSORS: Accessors<EventItem> = {
  name: (e) => e.name,
  location: (e) => e.location,
  dates: (e) => e.start_date,
  abstract_deadline: (e) => e.abstract_deadline,
  talks: (e) => e.talk_count,
}

export default function EventsPage() {
  const [rows, setRows] = useState<EventItem[]>([])
  const [modal, setModal] = useState(false)
  const [form, setForm] = useState({
    name: '',
    url: '',
    location: '',
    start_date: '',
    end_date: '',
    abstract_deadline: '',
  })
  const { isOffice } = useSession()
  const { sorted, sort, toggle } = useSortable(rows, ACCESSORS)

  const load = useCallback(() => {
    api.get<EventItem[]>('/events').then(setRows).catch(() => setRows([]))
  }, [])
  useEffect(load, [load])

  const save = async () => {
    try {
      await api.post('/events', {
        name: form.name,
        url: form.url || null,
        location: form.location || null,
        start_date: form.start_date || null,
        end_date: form.end_date || null,
        abstract_deadline: form.abstract_deadline || null,
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
        <Title order={3}>Conferences & events</Title>
        {isOffice && <Button onClick={() => setModal(true)}>Add event</Button>}
      </Group>
      <Table striped highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <SortableTh label="Name" k="name" sort={sort} toggle={toggle} />
            <SortableTh label="Location" k="location" sort={sort} toggle={toggle} />
            <SortableTh label="Dates" k="dates" sort={sort} toggle={toggle} />
            <SortableTh label="Abstract deadline" k="abstract_deadline" sort={sort} toggle={toggle} />
            <SortableTh label="Talks" k="talks" sort={sort} toggle={toggle} />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {sorted.map((e) => (
            <Table.Tr key={e.id}>
              <Table.Td>
                {e.url ? (
                  <Anchor href={e.url} target="_blank" rel="noreferrer">
                    {e.name}
                  </Anchor>
                ) : (
                  e.name
                )}
              </Table.Td>
              <Table.Td>{e.location}</Table.Td>
              <Table.Td>
                {e.start_date ?? ''}
                {e.end_date ? ` → ${e.end_date}` : ''}
              </Table.Td>
              <Table.Td>{e.abstract_deadline}</Table.Td>
              <Table.Td>{e.talk_count}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>

      <Modal opened={modal} onClose={() => setModal(false)} title="Add event">
        <Stack gap="sm">
          <TextInput
            label="Name"
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.currentTarget.value })}
          />
          <TextInput
            label="URL"
            value={form.url}
            onChange={(e) => setForm({ ...form, url: e.currentTarget.value })}
          />
          <TextInput
            label="Location"
            value={form.location}
            onChange={(e) => setForm({ ...form, location: e.currentTarget.value })}
          />
          <Group grow>
            <TextInput
              label="Start (YYYY-MM-DD)"
              value={form.start_date}
              onChange={(e) => setForm({ ...form, start_date: e.currentTarget.value })}
            />
            <TextInput
              label="End (YYYY-MM-DD)"
              value={form.end_date}
              onChange={(e) => setForm({ ...form, end_date: e.currentTarget.value })}
            />
          </Group>
          <TextInput
            label="Abstract deadline (YYYY-MM-DD)"
            value={form.abstract_deadline}
            onChange={(e) => setForm({ ...form, abstract_deadline: e.currentTarget.value })}
          />
          <Button onClick={save}>Save</Button>
        </Stack>
      </Modal>
    </>
  )
}
