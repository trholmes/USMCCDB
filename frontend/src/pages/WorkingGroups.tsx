import {
  Anchor,
  Badge,
  Button,
  Group,
  Table,
  Text,
  Title,
} from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { Fragment, useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import type { CollabRole, PersonSummary, WGMember, WorkingGroup } from '../api/types'
import { useSession } from '../auth/SessionContext'
import PersonSelect from '../components/PersonSelect'
import WorkingGroupModal from '../components/WorkingGroupModal'
import { SortableTh, useSortable, type Accessors } from '../components/sortable'
import { REPRESENTATIVE_AREAS, splitList } from '../constants'
import { coordinatorChangeEmails, useEmailConfirm } from '../emailWarnings'
import { today } from '../dates'

// Sort key for the Areas column: the canonical order of the group's first
// area; groups without any area sort last. Ties keep the API's name order
// (Array.prototype.sort is stable).
const areaOrder = (wg: WorkingGroup) => {
  const first = splitList(wg.areas)[0]
  if (!first) return REPRESENTATIVE_AREAS.length + 1
  const idx = REPRESENTATIVE_AREAS.indexOf(first)
  return idx === -1 ? REPRESENTATIVE_AREAS.length : idx
}

const ACCESSORS: Accessors<WorkingGroup> = {
  name: (wg) => wg.name,
  areas: (wg) => areaOrder(wg),
  members: (wg) => wg.member_count,
}

export default function WorkingGroupsPage() {
  const [wgs, setWgs] = useState<WorkingGroup[]>([])
  const [members, setMembers] = useState<Record<number, WGMember[]>>({})
  const [modal, setModal] = useState<WorkingGroup | 'new' | null>(null)
  // The one expanded group (its detail panel renders below its table row).
  const [expanded, setExpanded] = useState<number | null>(null)
  // Person selected in the "Add member" picker of the expanded panel.
  const [addPersonId, setAddPersonId] = useState<string | null>(null)
  const { me, canManageWGs, isAdmin } = useSession()
  const confirmEmail = useEmailConfirm()

  // Coordinators may manage their own group's membership (mirrors the backend
  // rule on POST/DELETE /working-groups/{id}/members).
  const [coordinatorWgIds, setCoordinatorWgIds] = useState<number[]>([])
  useEffect(() => {
    if (me?.person_id == null || canManageWGs) {
      setCoordinatorWgIds([])
      return
    }
    const t = today()
    api
      .get<CollabRole[]>(`/collab-roles?person_id=${me.person_id}&role=wg_coordinator`)
      .then((rs) =>
        setCoordinatorWgIds(
          rs
            .filter((r) => r.start_date <= t && (!r.end_date || r.end_date >= t))
            .map((r) => r.working_group_id)
            .filter((x): x is number => x != null),
        ),
      )
      .catch(() => setCoordinatorWgIds([]))
  }, [me?.person_id, canManageWGs])

  const canManage = (wgId: number) => canManageWGs || coordinatorWgIds.includes(wgId)

  // One shared directory load for the per-group "Add member" pickers (every
  // accordion panel stays mounted, so self-loading pickers would each fetch).
  const [people, setPeople] = useState<PersonSummary[]>([])
  useEffect(() => {
    if (!canManageWGs && coordinatorWgIds.length === 0) return
    api.get<PersonSummary[]>('/people').then(setPeople).catch(() => setPeople([]))
  }, [canManageWGs, coordinatorWgIds])

  const load = useCallback(() => {
    api.get<WorkingGroup[]>('/working-groups').then(setWgs).catch(() => setWgs([]))
  }, [])
  useEffect(load, [load])

  const loadMembers = async (wgId: number) => {
    const list = await api.get<WGMember[]>(`/working-groups/${wgId}/members`)
    // Coordinators first, each block keeping the server's family-name order.
    setMembers((m) => ({
      ...m,
      [wgId]: [...list].sort((a, b) => Number(b.is_coordinator) - Number(a.is_coordinator)),
    }))
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

  // Name a coordinator straight from the member row (leadership / office —
  // mirrors _require_collab_role_editor; group coordinators cannot).
  const makeCoordinator = async (wg: WorkingGroup, p: WGMember) => {
    if (
      coordinatorChangeEmails({ role: 'wg_coordinator', end_date: null }, 'add') &&
      !confirmEmail(
        `Make ${p.given_name} ${p.family_name} coordinator of "${wg.name}"?`,
        'wg_coordinator_changed',
      )
    )
      return
    try {
      await api.post('/collab-roles', {
        person_id: p.id,
        role: 'wg_coordinator',
        working_group_id: wg.id,
        start_date: today(),
      })
      notifications.show({ message: 'Coordinator added.' })
      loadMembers(wg.id)
    } catch (err: any) {
      notifications.show({ color: 'red', message: err.message })
    }
  }

  const endCoordinator = async (wg: WorkingGroup, p: WGMember) => {
    try {
      const t = today()
      const roles = await api.get<CollabRole[]>(
        `/collab-roles?person_id=${p.id}&role=wg_coordinator`,
      )
      const active = roles.find(
        (r) =>
          r.working_group_id === wg.id && r.start_date <= t && (!r.end_date || r.end_date >= t),
      )
      if (!active) {
        notifications.show({ color: 'yellow', message: 'No active coordinator term found.' })
        loadMembers(wg.id)
        return
      }
      if (
        coordinatorChangeEmails(active, 'end') &&
        !confirmEmail(
          `End ${p.given_name} ${p.family_name}'s coordinator term today?`,
          'wg_coordinator_changed',
        )
      )
        return
      await api.patch(`/collab-roles/${active.id}`, { end_date: t })
      notifications.show({ message: 'Coordinator term ended today.' })
      loadMembers(wg.id)
    } catch (err: any) {
      notifications.show({ color: 'red', message: err.message })
    }
  }

  const remove = async (wg: WorkingGroup) => {
    if (
      !window.confirm(
        `Delete the working group "${wg.name}"? Its ${wg.member_count} membership(s) and ` +
          'any coordinator roles are removed with it; talks and publications tagged with it lose the tag.',
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

  // The API lists groups by name; the column headers re-sort client-side.
  const { sorted, sort, toggle } = useSortable(wgs, ACCESSORS)

  const toggleExpanded = (wgId: number) => {
    setAddPersonId(null)
    if (expanded === wgId) {
      setExpanded(null)
    } else {
      setExpanded(wgId)
      loadMembers(wgId)
    }
  }

  return (
    <>
      <Group justify="space-between" mb="md">
        <Title order={3}>Working groups</Title>
        {canManageWGs && <Button onClick={() => setModal('new')}>Add working group</Button>}
      </Group>
      <Table.ScrollContainer minWidth={500}>
      <Table highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <SortableTh label="Name" k="name" sort={sort} toggle={toggle} />
            <SortableTh label="Areas" k="areas" sort={sort} toggle={toggle} />
            <SortableTh label="Members" k="members" sort={sort} toggle={toggle} />
            <Table.Th />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
        {sorted.map((wg) => (
          <Fragment key={wg.id}>
            <Table.Tr style={{ cursor: 'pointer' }} onClick={() => toggleExpanded(wg.id)}>
              <Table.Td>
                <Group gap="xs" wrap="nowrap">
                  <Text size="sm" fw={600}>
                    {wg.name}
                  </Text>
                  {!wg.is_active && (
                    <Badge color="gray" variant="light">
                      inactive
                    </Badge>
                  )}
                </Group>
              </Table.Td>
              <Table.Td>
                <Group gap="xs">
                  {splitList(wg.areas).map((area) => (
                    <Badge key={area} variant="light" color="grape">
                      {area}
                    </Badge>
                  ))}
                </Group>
              </Table.Td>
              <Table.Td>{wg.member_count}</Table.Td>
              <Table.Td ta="right">
                <Text size="sm" c="dimmed" aria-hidden>
                  {expanded === wg.id ? '▾' : '▸'}
                </Text>
              </Table.Td>
            </Table.Tr>
            {expanded === wg.id && (
            <Table.Tr>
              <Table.Td colSpan={4} p="md">
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
                  <Button size="xs" variant="subtle" onClick={() => setModal(wg)}>
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
                        <Group gap="xs" wrap="nowrap">
                          <Anchor component={Link} to={`/people/${p.id}`} size="sm">
                            {p.given_name} {p.family_name}
                          </Anchor>
                          {p.is_coordinator && (
                            <Badge
                              size="sm"
                              variant="light"
                              color={p.coordinator_until === today() ? 'gray' : 'teal'}
                              title={
                                p.coordinator_until === today()
                                  ? 'Date ranges are inclusive — the term runs through the end of today'
                                  : undefined
                              }
                            >
                              {p.coordinator_until === today()
                                ? 'Coordinator — ends today'
                                : 'Coordinator'}
                            </Badge>
                          )}
                        </Group>
                      </Table.Td>
                      <Table.Td>{p.career_stage}</Table.Td>
                      <Table.Td>{p.email}</Table.Td>
                      {canManage(wg.id) && (
                        <Table.Td>
                          <Group gap="xs" justify="flex-end" wrap="nowrap">
                            {canManageWGs &&
                              (p.is_coordinator ? (
                                p.coordinator_until !== today() && (
                                <Button
                                  size="compact-xs"
                                  variant="subtle"
                                  onClick={() => endCoordinator(wg, p)}
                                >
                                  End coordinator term
                                </Button>
                                )
                              ) : (
                                <Button
                                  size="compact-xs"
                                  variant="subtle"
                                  onClick={() => makeCoordinator(wg, p)}
                                >
                                  Make coordinator
                                </Button>
                              ))}
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
                          </Group>
                        </Table.Td>
                      )}
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
              </Table.ScrollContainer>
              </Table.Td>
            </Table.Tr>
            )}
          </Fragment>
        ))}
        </Table.Tbody>
      </Table>
      </Table.ScrollContainer>

      <WorkingGroupModal target={modal} onClose={() => setModal(null)} onSaved={load} />
    </>
  )
}
