import {
  Badge,
  Button,
  Card,
  Checkbox,
  Code,
  CopyButton,
  Divider,
  Group,
  Modal,
  PasswordInput,
  Select,
  Stack,
  Switch,
  Table,
  Tabs,
  Text,
  TextInput,
  Title,
} from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import type { PersonSummary, User } from '../api/types'
import { USER_ROLES } from '../constants'
import { SortableTh, useSortable, type Accessors } from '../components/sortable'
import { useSession } from '../auth/SessionContext'
import AdminBackups from './AdminBackups'
import AdminEmails from './AdminEmails'
import AdminSite from './AdminSite'
import AdminSystem from './AdminSystem'

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
  // Delete the login's current (unapproved, duplicate) person when relinking.
  const [replacePerson, setReplacePerson] = useState(true)
  const [mergePick, setMergePick] = useState<string | null>(null)
  const [q, setQ] = useState('')
  // One-time temporary password from an admin reset, shown in a modal.
  const [tempPassword, setTempPassword] = useState<{ login: string; password: string } | null>(
    null,
  )
  const { me } = useSession()

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

  // Search matches the login (username/ORCID) and the linked person's name.
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return users
    return users.filter(
      (u) =>
        loginLabel(u).toLowerCase().includes(needle) ||
        (u.person_id && (personName.get(u.person_id) ?? '').toLowerCase().includes(needle)),
    )
  }, [users, q, personName])
  const { sorted, sort, toggle } = useSortable(filtered, ACCESSORS)

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

  // Resolves to whether the change went through (the error is already shown).
  const update = async (id: number, body: Record<string, unknown>): Promise<boolean> => {
    try {
      await api.patch(`/auth/users/${id}`, body)
      load()
      return true
    } catch (err: any) {
      notifications.show({ color: 'red', message: err.message })
      return false
    }
  }

  const openManage = (u: User) => {
    setPersonPick(u.person_id ? String(u.person_id) : null)
    setReplacePerson(true)
    setMergePick(null)
    setManage(u)
  }

  const personLabel = (p: PersonSummary) => `${p.given_name} ${p.family_name}`

  // An unapproved registration (typically provisioned by a first ORCID
  // sign-in): a duplicate of a directory record the login belongs to, or a
  // membership an office/admin login does not need.
  const linkedPerson = manage?.person_id ? people.find((p) => p.id === manage.person_id) : undefined
  const removablePerson =
    linkedPerson && ['pending', 'rejected'].includes(linkedPerson.status) ? linkedPerson : undefined
  const pickedPerson = personPick ? people.find((p) => p.id === Number(personPick)) : undefined
  const relinking = !!pickedPerson && pickedPerson.id !== manage?.person_id

  const linkPerson = async () => {
    if (!manage || !pickedPerson) return
    const dropping = relinking && replacePerson && removablePerson
    const lines = [`Link the login '${loginLabel(manage)}' to '${personLabel(pickedPerson)}'?`]
    if (dropping)
      lines.push(
        `The ${removablePerson.status} record '${personLabel(removablePerson)}' currently ` +
          'linked to it is deleted as a duplicate. This cannot be undone.',
      )
    if (manage.orcid && pickedPerson.orcid !== manage.orcid)
      lines.push(
        `'${personLabel(pickedPerson)}' takes the login's ORCID iD ${manage.orcid}` +
          (pickedPerson.orcid ? ` (replacing ${pickedPerson.orcid}).` : '.'),
      )
    if (lines.length > 1 && !window.confirm(lines.join('\n\n'))) return
    if (!(await update(manage.id, { person_id: pickedPerson.id, replace_person: !!dropping })))
      return
    notifications.show({ message: 'Account linked to person' })
    setManage(null)
  }

  // Detach the login from its person record, keeping both (the record stays
  // in the directory). A member-role login without a person gets no access
  // until it is linked again.
  const unlinkPerson = async () => {
    if (!manage || manage.person_id == null) return
    if (!(await update(manage.id, { person_id: null }))) return
    notifications.show({ message: 'Account unlinked from person' })
    setManage(null)
  }

  const removePerson = async () => {
    if (!manage || !removablePerson) return
    if (
      !window.confirm(
        `Delete the ${removablePerson.status} person record ` +
          `'${personLabel(removablePerson)}'?\n\n` +
          `The login '${loginLabel(manage)}' stays` +
          (manage.role === 'member'
            ? ' but has no access until it is linked to an approved member.'
            : ', but no longer belongs to a collaboration member.') +
          ' This cannot be undone.',
      )
    )
      return
    try {
      await api.delete(`/auth/users/${manage.id}/person`)
      notifications.show({ message: 'Person record removed' })
      setManage(null)
      load()
    } catch (err: any) {
      notifications.show({ color: 'red', message: err.message })
    }
  }

  const resetPassword = async (u: User) => {
    if (!window.confirm(`Reset the password of '${loginLabel(u)}' to a temporary one?`)) return
    try {
      const r = await api.post<{ temporary_password: string }>(
        `/auth/users/${u.id}/reset-password`,
      )
      setManage(null)
      setTempPassword({ login: loginLabel(u), password: r.temporary_password })
    } catch (err: any) {
      notifications.show({ color: 'red', message: err.message })
    }
  }

  const deleteAccount = async (u: User) => {
    if (
      !window.confirm(
        `Delete the login '${loginLabel(u)}'?\n\nThe linked person record and all ` +
          'history stay; only the sign-in is removed.',
      )
    )
      return
    try {
      await api.delete(`/auth/users/${u.id}`)
      notifications.show({ message: 'Account deleted' })
      setManage(null)
      load()
    } catch (err: any) {
      notifications.show({ color: 'red', message: err.message })
    }
  }

  const mergeAccounts = async () => {
    if (!manage || !mergePick) return
    const other = users.find((u) => u.id === Number(mergePick))
    if (!other) return
    const otherPerson = other.person_id ? people.find((p) => p.id === other.person_id) : undefined
    const lines = [
      `Merge account '${loginLabel(other)}' into '${loginLabel(manage)}'?`,
      `'${loginLabel(manage)}' keeps both sign-in methods and the more ` +
        `privileged role; '${loginLabel(other)}' is deleted.`,
    ]
    // Two different people: the unapproved one is the duplicate an ORCID
    // sign-in provisioned and goes with the merge (the backend refuses when
    // neither, or both, is unapproved).
    if (linkedPerson && otherPerson && linkedPerson.id !== otherPerson.id) {
      const dup = [linkedPerson, otherPerson].find((p) =>
        ['pending', 'rejected'].includes(p.status),
      )
      if (dup)
        lines.push(
          `The ${dup.status} record '${personLabel(dup)}' is deleted as a duplicate; the ` +
            'merged login is linked to the other person. This cannot be undone.',
        )
    }
    if (!window.confirm(lines.join('\n\n'))) return
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
    <Tabs defaultValue="accounts">
      <Tabs.List mb="md">
        <Tabs.Tab value="accounts">User accounts</Tabs.Tab>
        <Tabs.Tab value="site">Site settings</Tabs.Tab>
        <Tabs.Tab value="system">System</Tabs.Tab>
        <Tabs.Tab value="emails">Email</Tabs.Tab>
        <Tabs.Tab value="backups">Backups</Tabs.Tab>
      </Tabs.List>

      <Tabs.Panel value="site">
        <AdminSite />
      </Tabs.Panel>

      <Tabs.Panel value="system">
        <AdminSystem />
      </Tabs.Panel>

      <Tabs.Panel value="emails">
        <AdminEmails />
      </Tabs.Panel>

      <Tabs.Panel value="backups">
        <AdminBackups />
      </Tabs.Panel>

      <Tabs.Panel value="accounts">
      <Group justify="space-between" mb="md">
        <Title order={3}>Admin — user accounts</Title>
        <Group>
          <TextInput
            placeholder="Search login or person…"
            value={q}
            onChange={(e) => setQ(e.currentTarget.value)}
            w={{ base: '100%', xs: 220 }}
          />
          <Button onClick={() => setModal(true)}>Create local account</Button>
        </Group>
      </Group>

      <Card withBorder mb="md">
        <Text size="sm" c="dimmed">
          Local accounts sign in with username + password. ORCID users appear here
          automatically after their first sign-in. Roles: <b>admin</b> (everything),{' '}
          <b>office</b> (approve members, institutions, all roles), <b>leadership</b>{' '}
          (representatives & deputies: working groups, publications, talks),{' '}
          <b>speakers_committee</b> (talks & events), <b>member</b>.
        </Text>
      </Card>

      <Table.ScrollContainer minWidth={700}>
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
                  data={USER_ROLES.map((r) => r.value)}
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
      </Table.ScrollContainer>

      <Modal
        opened={manage !== null}
        onClose={() => setManage(null)}
        title={manage ? `Manage account — ${loginLabel(manage)}` : ''}
      >
        <Stack gap="sm">
          <Select
            label="Linked person"
            description={
              'Connects this login to a directory record; the account can then edit that profile.' +
              (manage?.orcid ? " The record takes the login's ORCID iD." : '')
            }
            placeholder="Pick a person…"
            searchable
            data={people.map((p) => ({
              value: String(p.id),
              label: `${p.family_name}, ${p.given_name}${p.email ? ` (${p.email})` : ''}`,
            }))}
            value={personPick}
            onChange={setPersonPick}
          />
          {removablePerson && relinking && (
            <Checkbox
              size="xs"
              label={
                `Also delete the ${removablePerson.status} record ` +
                `'${personLabel(removablePerson)}' now linked to this login (a duplicate)`
              }
              checked={replacePerson}
              onChange={(e) => setReplacePerson(e.currentTarget.checked)}
            />
          )}
          <Group gap="xs">
            <Button size="xs" onClick={linkPerson} disabled={!relinking}>
              Link person
            </Button>
            {manage?.person_id != null && (
              <Button
                size="xs"
                variant="light"
                onClick={unlinkPerson}
                title="Detach this login from the person record; both are kept."
              >
                Unlink person
              </Button>
            )}
          </Group>
          {removablePerson && (
            <>
              <Text size="xs" c="dimmed">
                The linked person is an unapproved ({removablePerson.status}) registration —
                usually created by the first ORCID sign-in. If it duplicates an existing directory
                record, pick that record above and link it. To keep this login as an office or
                admin account without a collaboration membership, remove the record instead.
              </Text>
              <Button
                w="fit-content"
                size="xs"
                color="red"
                variant="light"
                onClick={removePerson}
              >
                Remove person record
              </Button>
            </>
          )}
          <Divider label="Merge accounts" />
          <Select
            label="Merge another account into this one"
            description="For one human with two logins (typically local + ORCID). This account keeps both sign-in methods; the other is deleted. If one login is linked to an unapproved duplicate registration, that record goes too."
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
          <Divider label="Danger zone" />
          <Group>
            {manage?.username && (
              <Button size="xs" variant="light" onClick={() => manage && resetPassword(manage)}>
                Reset password
              </Button>
            )}
            <Button
              size="xs"
              color="red"
              variant="light"
              disabled={manage?.id === me?.user.id}
              onClick={() => manage && deleteAccount(manage)}
            >
              Delete account
            </Button>
          </Group>
          {!manage?.username && (
            <Text size="xs" c="dimmed">
              ORCID accounts have no password to reset — sign-in happens at orcid.org.
            </Text>
          )}
        </Stack>
      </Modal>

      <Modal
        opened={tempPassword !== null}
        onClose={() => setTempPassword(null)}
        title="Temporary password"
      >
        <Stack gap="sm">
          <Text size="sm">
            The password of <b>{tempPassword?.login}</b> was reset. Share this temporary
            password with them over a trusted channel — it is shown only once. They can
            change it under Account settings after signing in.
          </Text>
          <Group>
            <Code fz="md" p="xs">
              {tempPassword?.password}
            </Code>
            <CopyButton value={tempPassword?.password ?? ''}>
              {({ copied, copy }) => (
                <Button size="xs" variant="light" onClick={copy}>
                  {copied ? 'Copied' : 'Copy'}
                </Button>
              )}
            </CopyButton>
          </Group>
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
            data={USER_ROLES.map((r) => ({ value: r.value, label: `${r.label} — ${r.description}` }))}
            value={form.role}
            onChange={(v) => setForm({ ...form, role: v ?? 'member' })}
          />
          <Button onClick={create}>Create</Button>
        </Stack>
      </Modal>
      </Tabs.Panel>
    </Tabs>
  )
}
