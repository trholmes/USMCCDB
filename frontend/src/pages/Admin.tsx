import {
  Badge,
  Button,
  Card,
  Group,
  Modal,
  PasswordInput,
  Select,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useCallback, useEffect, useState } from 'react'
import { api } from '../api/client'
import type { User } from '../api/types'
import { SortableTh, useSortable, type Accessors } from '../components/sortable'
import { useSession } from '../auth/SessionContext'

const ACCESSORS: Accessors<User> = {
  id: (u) => u.id,
  login: (u) => u.username ?? u.orcid,
  role: (u) => u.role,
  active: (u) => u.is_active,
  last_login: (u) => u.last_login_at,
}

export default function AdminPage() {
  const [users, setUsers] = useState<User[]>([])
  const [modal, setModal] = useState(false)
  const [form, setForm] = useState({ username: '', password: '', role: 'member' })
  const { me } = useSession()
  const { sorted, sort, toggle } = useSortable(users, ACCESSORS)

  const load = useCallback(() => {
    api.get<User[]>('/auth/users').then(setUsers).catch(() => setUsers([]))
  }, [])
  useEffect(load, [load])

  const create = async () => {
    try {
      await api.post('/auth/users', form)
      notifications.show({ message: `Account '${form.username}' created` })
      setModal(false)
      setForm({ username: '', password: '', role: 'member' })
      load()
    } catch (err: any) {
      notifications.show({ color: 'red', message: err.message })
    }
  }

  const update = async (id: number, body: Record<string, unknown>) => {
    try {
      await api.patch(`/auth/users/${id}`, body)
      load()
    } catch (err: any) {
      notifications.show({ color: 'red', message: err.message })
    }
  }

  return (
    <>
      <Group justify="space-between" mb="md">
        <Title order={3}>Admin — user accounts</Title>
        <Button onClick={() => setModal(true)}>Create local account</Button>
      </Group>

      <Card withBorder mb="md">
        <Text size="sm" c="dimmed">
          Local accounts sign in with username + password. ORCID users appear here
          automatically after their first sign-in. Roles: <b>admin</b> (everything),{' '}
          <b>office</b> (approve members, manage speakers & publications), <b>member</b>.
        </Text>
      </Card>

      <Table striped>
        <Table.Thead>
          <Table.Tr>
            <SortableTh label="ID" k="id" sort={sort} toggle={toggle} />
            <SortableTh label="Login" k="login" sort={sort} toggle={toggle} />
            <SortableTh label="Role" k="role" sort={sort} toggle={toggle} />
            <SortableTh label="Active" k="active" sort={sort} toggle={toggle} />
            <SortableTh label="Last login" k="last_login" sort={sort} toggle={toggle} />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {sorted.map((u) => (
            <Table.Tr key={u.id}>
              <Table.Td>{u.id}</Table.Td>
              <Table.Td>
                {u.username ?? (
                  <Group gap={4}>
                    <Badge variant="light" color="green">
                      ORCID
                    </Badge>
                    <Text size="sm">{u.orcid}</Text>
                  </Group>
                )}
              </Table.Td>
              <Table.Td>
                <Select
                  data={['admin', 'office', 'member']}
                  value={u.role}
                  onChange={(v) => v && update(u.id, { role: v })}
                  disabled={u.id === me?.user.id}
                  w={120}
                  size="xs"
                />
              </Table.Td>
              <Table.Td>
                <Switch
                  checked={u.is_active}
                  onChange={(e) => update(u.id, { is_active: e.currentTarget.checked })}
                  disabled={u.id === me?.user.id}
                />
              </Table.Td>
              <Table.Td>
                <Text size="sm" c="dimmed">
                  {u.last_login_at ? new Date(u.last_login_at).toLocaleString() : 'never'}
                </Text>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>

      <Modal opened={modal} onClose={() => setModal(false)} title="Create local account">
        <Stack gap="sm">
          <TextInput
            label="Username"
            required
            value={form.username}
            onChange={(e) => setForm({ ...form, username: e.currentTarget.value })}
          />
          <PasswordInput
            label="Password (min 8 characters)"
            required
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.currentTarget.value })}
          />
          <Select
            label="Role"
            data={['admin', 'office', 'member']}
            value={form.role}
            onChange={(v) => setForm({ ...form, role: v ?? 'member' })}
          />
          <Button onClick={create}>Create</Button>
        </Stack>
      </Modal>
    </>
  )
}
