import { Button, Group, Modal, Stack, Table, TextInput, Title } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useCallback, useEffect, useState } from 'react'
import { api } from '../api/client'
import type { Institution } from '../api/types'
import { useSession } from '../auth/SessionContext'

export default function InstitutionsPage() {
  const [rows, setRows] = useState<Institution[]>([])
  const [modal, setModal] = useState<Institution | 'new' | null>(null)
  const [form, setForm] = useState({ name: '', short_name: '', latex_address: '' })
  const { isOffice } = useSession()

  const load = useCallback(() => {
    api.get<Institution[]>('/institutions').then(setRows).catch(() => setRows([]))
  }, [])
  useEffect(load, [load])

  const open = (target: Institution | 'new') => {
    setForm(
      target === 'new'
        ? { name: '', short_name: '', latex_address: '' }
        : {
            name: target.name,
            short_name: target.short_name ?? '',
            latex_address: target.latex_address ?? '',
          },
    )
    setModal(target)
  }

  const save = async () => {
    const body = {
      name: form.name,
      short_name: form.short_name || null,
      latex_address: form.latex_address || null,
    }
    try {
      if (modal === 'new') await api.post('/institutions', body)
      else if (modal) await api.patch(`/institutions/${modal.id}`, body)
      setModal(null)
      load()
    } catch (err: any) {
      notifications.show({ color: 'red', message: err.message })
    }
  }

  return (
    <>
      <Group justify="space-between" mb="md">
        <Title order={3}>Institutions</Title>
        {isOffice && <Button onClick={() => open('new')}>Add institution</Button>}
      </Group>
      <Table striped highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Name</Table.Th>
            <Table.Th>Short name</Table.Th>
            <Table.Th>Author-list address</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows.map((i) => (
            <Table.Tr
              key={i.id}
              style={isOffice ? { cursor: 'pointer' } : undefined}
              onClick={() => isOffice && open(i)}
            >
              <Table.Td>{i.name}</Table.Td>
              <Table.Td>{i.short_name}</Table.Td>
              <Table.Td>{i.latex_address}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>

      <Modal
        opened={modal !== null}
        onClose={() => setModal(null)}
        title={modal === 'new' ? 'Add institution' : 'Edit institution'}
      >
        <Stack gap="sm">
          <TextInput
            label="Full name"
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.currentTarget.value })}
          />
          <TextInput
            label="Short name"
            value={form.short_name}
            onChange={(e) => setForm({ ...form, short_name: e.currentTarget.value })}
          />
          <TextInput
            label="Author-list address (as printed on papers)"
            value={form.latex_address}
            onChange={(e) => setForm({ ...form, latex_address: e.currentTarget.value })}
          />
          <Button onClick={save}>Save</Button>
        </Stack>
      </Modal>
    </>
  )
}
