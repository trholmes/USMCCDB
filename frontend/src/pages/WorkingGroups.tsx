import {
  Accordion,
  Badge,
  Button,
  Checkbox,
  Group,
  Modal,
  Stack,
  Table,
  Text,
  Textarea,
  TextInput,
  Title,
} from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useCallback, useEffect, useState } from 'react'
import { api } from '../api/client'
import type { PersonSummary, WorkingGroup } from '../api/types'
import { useSession } from '../auth/SessionContext'

const slugify = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

export default function WorkingGroupsPage() {
  const [wgs, setWgs] = useState<WorkingGroup[]>([])
  const [members, setMembers] = useState<Record<number, PersonSummary[]>>({})
  const [modal, setModal] = useState<WorkingGroup | 'new' | null>(null)
  const [form, setForm] = useState({ name: '', slug: '', description: '', is_active: true })
  const [slugTouched, setSlugTouched] = useState(false)
  const { me, isOffice } = useSession()

  const load = useCallback(() => {
    api.get<WorkingGroup[]>('/working-groups').then(setWgs).catch(() => setWgs([]))
  }, [])
  useEffect(load, [load])

  const loadMembers = async (wgId: number) => {
    const list = await api.get<PersonSummary[]>(`/working-groups/${wgId}/members`)
    setMembers((m) => ({ ...m, [wgId]: list }))
  }

  const join = async (wgId: number) => {
    if (!me?.person_id) {
      notifications.show({
        color: 'yellow',
        message: 'Your login is not linked to a member record yet — contact the office.',
      })
      return
    }
    try {
      await api.post(`/working-groups/${wgId}/members`, { person_id: me.person_id })
      notifications.show({ message: 'Joined!' })
      loadMembers(wgId)
      load()
    } catch (err: any) {
      notifications.show({ color: 'red', message: err.message })
    }
  }

  const leave = async (wgId: number) => {
    if (!me?.person_id) return
    try {
      await api.delete(`/working-groups/${wgId}/members/${me.person_id}`)
      notifications.show({ message: 'Left the group.' })
      loadMembers(wgId)
      load()
    } catch (err: any) {
      notifications.show({ color: 'red', message: err.message })
    }
  }

  const isMember = (wgId: number) =>
    me?.person_id != null && (members[wgId] ?? []).some((p) => p.id === me.person_id)

  const open = (target: WorkingGroup | 'new') => {
    setForm(
      target === 'new'
        ? { name: '', slug: '', description: '', is_active: true }
        : {
            name: target.name,
            slug: target.slug,
            description: target.description ?? '',
            is_active: target.is_active,
          },
    )
    setSlugTouched(false)
    setModal(target)
  }

  const save = async () => {
    try {
      if (modal === 'new') {
        await api.post('/working-groups', {
          name: form.name,
          slug: form.slug,
          description: form.description || null,
          is_active: form.is_active,
        })
      } else if (modal) {
        await api.patch(`/working-groups/${modal.id}`, {
          name: form.name,
          description: form.description || null,
          is_active: form.is_active,
        })
      }
      setModal(null)
      load()
    } catch (err: any) {
      notifications.show({ color: 'red', message: err.message })
    }
  }

  return (
    <>
      <Group justify="space-between" mb="md">
        <Title order={3}>Working groups</Title>
        {isOffice && <Button onClick={() => open('new')}>Add working group</Button>}
      </Group>
      <Accordion onChange={(v) => v && loadMembers(Number(v))}>
        {wgs.map((wg) => (
          <Accordion.Item key={wg.id} value={String(wg.id)}>
            <Accordion.Control>
              <Group>
                <Text fw={600}>{wg.name}</Text>
                <Badge variant="light">{wg.member_count} members</Badge>
                {!wg.is_active && <Badge color="gray">inactive</Badge>}
              </Group>
            </Accordion.Control>
            <Accordion.Panel>
              {wg.description && (
                <Text size="sm" c="dimmed" mb="sm">
                  {wg.description}
                </Text>
              )}
              <Group gap="xs" mb="sm">
                {isMember(wg.id) ? (
                  <Button size="xs" variant="light" color="red" onClick={() => leave(wg.id)}>
                    Leave this group
                  </Button>
                ) : (
                  <Button size="xs" variant="light" onClick={() => join(wg.id)}>
                    Join this group
                  </Button>
                )}
                {isOffice && (
                  <Button size="xs" variant="subtle" onClick={() => open(wg)}>
                    Edit
                  </Button>
                )}
              </Group>
              <Table>
                <Table.Tbody>
                  {(members[wg.id] ?? []).map((p) => (
                    <Table.Tr key={p.id}>
                      <Table.Td>
                        {p.given_name} {p.family_name}
                      </Table.Td>
                      <Table.Td>{p.career_stage}</Table.Td>
                      <Table.Td>{p.email}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Accordion.Panel>
          </Accordion.Item>
        ))}
      </Accordion>

      <Modal
        opened={modal !== null}
        onClose={() => setModal(null)}
        title={modal === 'new' ? 'Add working group' : 'Edit working group'}
      >
        <Stack gap="sm">
          <TextInput
            label="Name"
            required
            value={form.name}
            onChange={(e) => {
              const name = e.currentTarget.value
              setForm((f) => ({
                ...f,
                name,
                slug: modal === 'new' && !slugTouched ? slugify(name) : f.slug,
              }))
            }}
          />
          <TextInput
            label="Slug"
            description={
              modal === 'new'
                ? 'Short identifier: lowercase letters, digits, and hyphens. Cannot be changed later.'
                : 'Slugs cannot be changed.'
            }
            required
            disabled={modal !== 'new'}
            value={form.slug}
            onChange={(e) => {
              setSlugTouched(true)
              setForm({ ...form, slug: e.currentTarget.value })
            }}
          />
          <Textarea
            label="Description"
            autosize
            minRows={2}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.currentTarget.value })}
          />
          <Checkbox
            label="Active"
            description="Inactive groups stay listed with their membership but are flagged as inactive."
            checked={form.is_active}
            onChange={(e) => setForm({ ...form, is_active: e.currentTarget.checked })}
          />
          <Button onClick={save}>Save</Button>
        </Stack>
      </Modal>
    </>
  )
}
