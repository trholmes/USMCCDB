import {
  Badge,
  Button,
  Card,
  Divider,
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
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import type { PersonSummary, User } from '../api/types'
import { SortableTh, useSortable, type Accessors } from '../components/sortable'
import { useSession } from '../auth/SessionContext'

const ACCESSORS: Accessors<User> = {
  id: (u) => u.id,
  login: (u) => u.username ?? u.orcid,
  person: (u) => u.person_id,
  role: (u) => u.role,
  active: (u) => u.is_active,
  last_login: (u) => u.last_login_at,
}

const loginLabel = (u: User) => u.username ?? u.orcid ?? `#${u.id}`

export default function AdminPage() {
  const [users, setUsers] = useState<User[]>([])
  const [people, setPeople] = useState<PersonSummary[]>([])
  const [modal, setModal] = useState(false)
  const [form, setForm] = useState({ username: '', password: '', role: 'member' })
  // Link-person / merge dialog for one account.
  const [manage, setManage] = useState<User | null>(null)
  const [personPick, setPersonPick] = useState<string | null>(null)
  const [mergePick, setMergePick] = useState<string | null>(null)
  const { me } = useSession()
  const { sorted, sort, toggle } = useSortable(users, ACCESSORS)

  const load = useCallback(() => {
    api.get<User[]>('/auth/users').then(setUsers).catch(() => setUsers([]))
    api.get<PersonSummary[]>('/people').then(setPeople).catch(() => setPeople([]))
  }, [])
  useEffect(load, [load])

  const personName = useMemo(() => {
    const m = new Map<number, string>()
    people.forEach((p) => m.set(p.id, `${p.family_name}, ${p.given_name}`))
    return m
  }, [people])

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

  const openManage = (u: User) => {
    setPersonPick(u.person_id ? String(u.person_id) : null)
    setMergePick(null)
    setManage(u)
  }

  const linkPerson = async () => {
    if (!manage || !personPick) return
    await update(manage.id, { person_id: Number(personPick) })
    notifications.show({ message: 'Account linked to person' })
    setManage(null)
  }

  const mergeAccounts = async () => {
    if (!manage || !mergePick) return
    const other = users.find((u) => u.id === Number(mergePick))
    if (
      !other ||
      !window.confirm(
        `Merge account '${loginLabel(other)}' into '${loginLabel(manage)}'?\n\n` +
          `'${loginLabel(manage)}' keeps both sign-in methods and the more ` +
          `privileged role; '${loginLabel(other)}' is deleted.`,
      )
    )
      return
    try {
      await api.post(`/auth/users/${manage.id}/merge/${other.id}`)
      notifications.show({ message: 'Accounts merged' })
      setManage(null)
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
            <SortableTh label="Person" k="person" sort={sort} toggle={toggle} />
            <SortableTh label="Role" k="role" sort={sort} toggle={toggle} />
            <SortableTh label="Active" k="active" sort={sort} toggle={toggle} />
            <SortableTh label="Last login" k="last_login" sort={sort} toggle={toggle} />
            <Table.Th />
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
                {u.person_id ? (
                  <Text size="sm" component={Link} to={`/people/${u.person_id}`} c="indigo">
                    {personName.get(u.person_id) ?? `#${u.person_id}`}
                  </Text>
                ) : (
                  <Text size="sm" c="dimmed">
                    —
                  </Text>
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
              <Table.Td>
                <Button size="compact-xs" variant="subtle" onClick={() => openManage(u)}>
                  Manage
                </Button>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>

      <Modal
        opened={manage !== null}
        onClose={() => setManage(null)}
        title={manage ? `Manage account — ${loginLabel(manage)}` : ''}
      >
        <Stack gap="sm">
          <Select
            label="Linked person"
            description="Connects this login to a directory record; the account can then edit that profile."
            placeholder="Pick a person…"
            searchable
            data={people.map((p) => ({
              value: String(p.id),
              label: `${p.family_name}, ${p.given_name}${p.email ? ` (${p.email})` : ''}`,
            }))}
            value={personPick}
            onChange={setPersonPick}
          />
          <Button
            w="fit-content"
            size="xs"
            onClick={linkPerson}
            disabled={!personPick || Number(personPick) === manage?.person_id}
          >
            Link person
          </Button>
          <Divider label="Merge accounts" />
          <Select
            label="Merge another account into this one"
            description="For one human with two logins (typically local + ORCID). This account keeps both sign-in methods; the other is deleted."
            placeholder="Pick the account to absorb…"
            searchable
            data={users
              .filter((u) => manage && u.id !== manage.id && u.id !== me?.user.id)
              .map((u) => ({ value: String(u.id), label: loginLabel(u) }))}
            value={mergePick}
            onChange={setMergePick}
          />
          <Button
            w="fit-content"
            size="xs"
            color="orange"
            variant="light"
            onClick={mergeAccounts}
            disabled={!mergePick}
          >
            Merge
          </Button>
        </Stack>
      </Modal>

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
