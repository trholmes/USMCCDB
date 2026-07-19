import {
  Badge,
  Button,
  Card,
  Group,
  Select,
  Stack,
  Table,
  Text,
  Textarea,
  TextInput,
  Title,
} from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { api, uploadFile } from '../api/client'
import type { Person } from '../api/types'
import PersonAvatar from '../components/PersonAvatar'
import StatusBadge from '../components/StatusBadge'
import { useSession } from '../auth/SessionContext'

export default function PersonPage() {
  const { id } = useParams()
  const [person, setPerson] = useState<Person | null>(null)
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<Record<string, string>>({})
  const { me, isOffice } = useSession()
  const fileInput = useRef<HTMLInputElement>(null)

  const load = useCallback(() => {
    api.get<Person>(`/people/${id}`).then(setPerson).catch(() => setPerson(null))
  }, [id])
  useEffect(load, [load])

  const uploadPhoto = async (file: File | undefined) => {
    if (!file || !person) return
    try {
      await uploadFile(`/people/${person.id}/photo`, file)
      notifications.show({ message: 'Photo updated' })
      load()
    } catch (err: any) {
      notifications.show({ color: 'red', message: err.message })
    }
  }

  if (!person) return <Text c="dimmed">Loading…</Text>

  const isSelf = me?.person_id === person.id
  const canEdit = isSelf || isOffice

  const startEdit = () => {
    setForm({
      preferred_name: person.preferred_name ?? '',
      email: person.email,
      orcid: person.orcid ?? '',
      expertise: person.expertise ?? '',
    })
    setEditing(true)
  }

  const save = async () => {
    try {
      await api.patch(`/people/${person.id}`, {
        preferred_name: form.preferred_name || null,
        email: form.email,
        orcid: form.orcid || null,
        expertise: form.expertise || null,
      })
      notifications.show({ message: 'Profile updated' })
      setEditing(false)
      load()
    } catch (err: any) {
      notifications.show({ color: 'red', message: err.message })
    }
  }

  const changeStatus = async (status: string | null) => {
    if (!status) return
    try {
      await api.post(`/people/${person.id}/status`, { status })
      notifications.show({ message: `Status set to ${status}` })
      load()
    } catch (err: any) {
      notifications.show({ color: 'red', message: err.message })
    }
  }

  return (
    <Stack>
      <Group justify="space-between">
        <Group align="flex-start">
          <div
            style={{ cursor: isSelf || isOffice ? 'pointer' : undefined }}
            title={isSelf || isOffice ? 'Click to upload a photo' : undefined}
            onClick={() => (isSelf || isOffice) && fileInput.current?.click()}
          >
            <PersonAvatar person={person} size={72} />
          </div>
          <input
            ref={fileInput}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            hidden
            onChange={(e) => uploadPhoto(e.currentTarget.files?.[0])}
          />
        <div>
          <Title order={3}>
            {person.given_name} {person.family_name}{' '}
            {person.is_voting && <Badge variant="light">voting member</Badge>}
          </Title>
          <Group gap="xs" mt={4}>
            <StatusBadge status={person.status} />
            <Text c="dimmed" size="sm">
              {person.career_stage}
            </Text>
            {person.orcid && (
              <Text size="sm" c="dimmed">
                ORCID: {person.orcid}
              </Text>
            )}
          </Group>
        </div>
        </Group>
        <Group>
          {isOffice && (
            <Select
              placeholder="Change status…"
              data={['pending', 'active', 'inactive', 'alumni', 'rejected']}
              onChange={changeStatus}
              w={160}
            />
          )}
          {canEdit && !editing && <Button onClick={startEdit}>Edit profile</Button>}
        </Group>
      </Group>

      {editing ? (
        <Card withBorder maw={520}>
          <Stack gap="sm">
            <TextInput
              label="Preferred name"
              value={form.preferred_name}
              onChange={(e) => setForm({ ...form, preferred_name: e.currentTarget.value })}
            />
            <TextInput
              label="Email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.currentTarget.value })}
            />
            <TextInput
              label="ORCID iD"
              value={form.orcid}
              onChange={(e) => setForm({ ...form, orcid: e.currentTarget.value })}
            />
            <Textarea
              label="Areas of expertise"
              value={form.expertise}
              onChange={(e) => setForm({ ...form, expertise: e.currentTarget.value })}
            />
            <Group>
              <Button onClick={save}>Save</Button>
              <Button variant="subtle" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </Group>
          </Stack>
        </Card>
      ) : (
        <Card withBorder maw={640}>
          <Stack gap={6}>
            <Text size="sm">
              <b>Email:</b> {person.email}
            </Text>
            {person.expertise && (
              <Text size="sm">
                <b>Expertise:</b> {person.expertise}
              </Text>
            )}
          </Stack>
        </Card>
      )}

      <Title order={5}>Affiliations</Title>
      <Table maw={720}>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Institution</Table.Th>
            <Table.Th>Primary</Table.Th>
            <Table.Th>From</Table.Th>
            <Table.Th>To</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {person.affiliations.map((a) => (
            <Table.Tr key={a.id}>
              <Table.Td>{a.institution.name}</Table.Td>
              <Table.Td>{a.is_primary ? 'yes' : ''}</Table.Td>
              <Table.Td>{a.start_date}</Table.Td>
              <Table.Td>{a.end_date ?? 'present'}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>

      <Title order={5}>Authorship periods</Title>
      {person.author_periods.length === 0 ? (
        <Text size="sm" c="dimmed">
          Not currently on the author list.
        </Text>
      ) : (
        <Table maw={720}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>From</Table.Th>
              <Table.Th>To</Table.Th>
              <Table.Th>Signing name</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {person.author_periods.map((p) => (
              <Table.Tr key={p.id}>
                <Table.Td>{p.start_date}</Table.Td>
                <Table.Td>{p.end_date ?? 'present'}</Table.Td>
                <Table.Td>{p.signing_name ?? '—'}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
    </Stack>
  )
}
