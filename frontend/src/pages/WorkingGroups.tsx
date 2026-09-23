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
import type { CollabRole, PersonSummary, WorkingGroup } from '../api/types'
import { useSession } from '../auth/SessionContext'
import PersonSelect from '../components/PersonSelect'
import { today } from '../dates'

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
  // Person selected in the "Add member" picker of the open accordion panel.
  const [addPersonId, setAddPersonId] = useState<string | null>(null)
  const { me, canManageWGs, isAdmin } = useSession()

  // Conveners may manage their own group's membership (mirrors the backend
  // rule on POST/DELETE /working-groups/{id}/members).
  const [convenerWgIds, setConvenerWgIds] = useState<number[]>([])
  useEffect(() => {
    if (me?.person_id == null || canManageWGs) {
      setConvenerWgIds([])
      return
    }
    const t = today()
    api
      .get<CollabRole[]>(`/collab-roles?person_id=${me.person_id}&role=convener`)
      .then((rs) =>
        setConvenerWgIds(
          rs
            .filter((r) => r.start_date <= t && (!r.end_date || r.end_date >= t))
            .map((r) => r.working_group_id)
            .filter((x): x is number => x != null),
        ),
      )
      .catch(() => setConvenerWgIds([]))
  }, [me?.person_id, canManageWGs])

  const canManage = (wgId: number) => canManageWGs || convenerWgIds.includes(wgId)

  // One shared directory load for the per-group "Add member" pickers (every
  // accordion panel stays mounted, so self-loading pickers would each fetch).
  const [people, setPeople] = useState<PersonSummary[]>([])
  useEffect(() => {
    if (!canManageWGs && convenerWgIds.length === 0) return
    api.get<PersonSummary[]>('/people').then(setPeople).catch(() => setPeople([]))
  }, [canManageWGs, convenerWgIds])

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

  const addMember = async (wgId: number) => {
    if (!addPersonId) return
    try {
      await api.post(`/working-groups/${wgId}/members`, { person_id: Number(addPersonId) })
      notifications.show({ message: 'Member added.' })
      setAddPersonId(null)
      loadMembers(wgId)
      load()
    } catch (err: any) {
      notifications.show({ color: 'red', message: err.message })
    }
  }

  const removeMember = async (wg: WorkingGroup, p: PersonSummary) => {
    if (!window.confirm(`Remove ${p.given_name} ${p.family_name} from "${wg.name}"?`)) return
    try {
      await api.delete(`/working-groups/${wg.id}/members/${p.id}`)
      notifications.show({ message: 'Member removed.' })
      loadMembers(wg.id)
      load()
    } catch (err: any) {
      notifications.show({ color: 'red', message: err.message })
    }
  }

  const remove = async (wg: WorkingGroup) => {
    if (
      !window.confirm(
        `Delete the working group "${wg.name}"? Its ${wg.member_count} membership(s) and ` +
          'any convener roles are removed with it; talks and publications tagged with it lose the tag.',
      )
    )
      return
    try {
      await api.delete(`/working-groups/${wg.id}`)
      notifications.show({ message: 'Working group deleted.' })
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
        {canManageWGs && <Button onClick={() => open('new')}>Add working group</Button>}
      </Group>
      <Accordion
        onChange={(v) => {
          setAddPersonId(null)
          if (v) loadMembers(Number(v))
        }}
      >
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
                {canManageWGs && (
                  <Button size="xs" variant="subtle" onClick={() => open(wg)}>
                    Edit
                  </Button>
                )}
                {isAdmin && (
                  <Button size="xs" variant="subtle" color="red" onClick={() => remove(wg)}>
                    Delete
                  </Button>
                )}
              </Group>
              {canManage(wg.id) && (
                <Group gap="xs" mb="sm" align="flex-end">
                  <PersonSelect
                    people={people}
                    value={addPersonId}
                    onChange={setAddPersonId}
                    placeholder="Add a person to this group…"
                    excludeIds={(members[wg.id] ?? []).map((p) => p.id)}
                    w={{ base: '100%', xs: 280 }}
                  />
                  <Button size="xs" disabled={!addPersonId} onClick={() => addMember(wg.id)}>
                    Add member
                  </Button>
                </Group>
              )}
              <Table.ScrollContainer minWidth={500}>
              <Table>
                <Table.Tbody>
                  {(members[wg.id] ?? []).map((p) => (
                    <Table.Tr key={p.id}>
                      <Table.Td>
                        {p.given_name} {p.family_name}
                      </Table.Td>
                      <Table.Td>{p.career_stage}</Table.Td>
                      <Table.Td>{p.email}</Table.Td>
                      {canManage(wg.id) && (
                        <Table.Td>
                          {p.id !== me?.person_id && (
                            <Button
                              size="compact-xs"
                              variant="subtle"
                              color="red"
                              onClick={() => removeMember(wg, p)}
                            >
                              Remove
                            </Button>
                          )}
                        </Table.Td>
                      )}
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
              </Table.ScrollContainer>
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
