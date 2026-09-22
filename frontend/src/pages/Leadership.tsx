import {
  Anchor,
  Button,
  Card,
  Checkbox,
  Group,
  Modal,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import type { CollabRole, Institution, WorkingGroup } from '../api/types'
import PersonAvatar from '../components/PersonAvatar'
import PersonSelect from '../components/PersonSelect'
import { SortableTh, useSortable, type Accessors } from '../components/sortable'
import { useSession } from '../auth/SessionContext'
import { COLLAB_ROLES, collabRoleLabel } from '../constants'
import { today } from '../dates'

// Sort in organigram order (COLLAB_ROLES order, then qualifier, then name).
const roleOrder = (r: CollabRole) => {
  const idx = COLLAB_ROLES.findIndex((d) => d.value === r.role)
  return idx === -1 ? COLLAB_ROLES.length : idx
}
const byOrgChart = (a: CollabRole, b: CollabRole) =>
  roleOrder(a) - roleOrder(b) ||
  (a.detail ?? '').localeCompare(b.detail ?? '') ||
  (a.person?.family_name ?? '').localeCompare(b.person?.family_name ?? '')

const ACCESSORS: Accessors<CollabRole> = {
  role: (r) => roleOrder(r),
  person: (r) => (r.person ? `${r.person.family_name} ${r.person.given_name}` : null),
  scope: (r) => r.working_group?.name ?? r.institution?.name,
  from: (r) => r.start_date,
  to: (r) => r.end_date,
}

function RoleRows({
  roles,
  past,
  onEnd,
  onEdit,
  onDelete,
}: {
  roles: CollabRole[]
  past?: boolean
  onEnd?: (r: CollabRole) => void
  onEdit?: (r: CollabRole) => void
  onDelete?: (r: CollabRole) => void
}) {
  const { sorted, sort, toggle } = useSortable(roles, ACCESSORS)
  const canEdit = Boolean(onEdit)
  return (
    <Table maw={860}>
      <Table.Thead>
        <Table.Tr>
          <SortableTh label="Role" k="role" sort={sort} toggle={toggle} />
          <SortableTh label="Person" k="person" sort={sort} toggle={toggle} />
          <SortableTh label="Scope" k="scope" sort={sort} toggle={toggle} />
          <SortableTh label={past ? 'From' : 'Since'} k="from" sort={sort} toggle={toggle} />
          <SortableTh label={past ? 'To' : 'Until'} k="to" sort={sort} toggle={toggle} />
          {canEdit && <Table.Th />}
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {sorted.map((r) => (
          <Table.Tr key={r.id}>
            <Table.Td>
              <Text size="sm" fw={600}>
                {collabRoleLabel(r.role, r.detail)}
              </Text>
            </Table.Td>
            <Table.Td>
              {r.person ? (
                <Group gap="xs" wrap="nowrap">
                  <PersonAvatar person={r.person} size={26} />
                  <Anchor component={Link} to={`/people/${r.person.id}`} size="sm">
                    {`${r.person.preferred_name || r.person.given_name} ${r.person.family_name}`}
                  </Anchor>
                </Group>
              ) : (
                '—'
              )}
            </Table.Td>
            <Table.Td>{r.working_group?.name ?? r.institution?.name ?? '—'}</Table.Td>
            <Table.Td>{r.start_date}</Table.Td>
            <Table.Td>{r.end_date ?? '—'}</Table.Td>
            {canEdit && (
              <Table.Td>
                <Group gap="xs" justify="flex-end" wrap="nowrap">
                  {!r.end_date && onEnd && (
                    <Button size="compact-xs" variant="light" onClick={() => onEnd(r)}>
                      End today
                    </Button>
                  )}
                  <Button size="compact-xs" variant="subtle" onClick={() => onEdit!(r)}>
                    Edit
                  </Button>
                  {onDelete && (
                    <Button
                      size="compact-xs"
                      variant="subtle"
                      color="red"
                      onClick={() => onDelete(r)}
                    >
                      Delete
                    </Button>
                  )}
                </Group>
              </Table.Td>
            )}
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  )
}

export default function LeadershipPage() {
  const [roles, setRoles] = useState<CollabRole[]>([])
  const [showPast, setShowPast] = useState(false)
  const { isOffice } = useSession()

  // Add-role form (office only).
  const [addPerson, setAddPerson] = useState<string | null>(null)
  const [roleType, setRoleType] = useState<string | null>(null)
  const [roleDetail, setRoleDetail] = useState('')
  const [roleWG, setRoleWG] = useState<string | null>(null)
  const [roleInst, setRoleInst] = useState<string | null>(null)
  const [roleStart, setRoleStart] = useState(today())
  const [roleBusy, setRoleBusy] = useState(false)
  const [wgs, setWgs] = useState<WorkingGroup[]>([])
  const [institutions, setInstitutions] = useState<Institution[]>([])

  // Edit modal.
  const [roleEdit, setRoleEdit] = useState<CollabRole | null>(null)
  const [roleForm, setRoleForm] = useState({ detail: '', start_date: '', end_date: '' })

  const loadRoles = useCallback(() => {
    // Administrative Institutional Contacts are an admin function, not
    // collaboration leadership, so they don't belong on this page — they are
    // managed from each institution's page instead.
    api
      .get<CollabRole[]>('/collab-roles')
      .then((rs) => setRoles(rs.filter((r) => r.role !== 'admin_contact')))
      .catch(() => setRoles([]))
  }, [])
  useEffect(loadRoles, [loadRoles])

  useEffect(() => {
    if (!isOffice) return // lists feed the add-role form only
    api.get<WorkingGroup[]>('/working-groups').then(setWgs).catch(() => setWgs([]))
    api.get<Institution[]>('/institutions').then(setInstitutions).catch(() => setInstitutions([]))
  }, [isOffice])

  const roleDef = COLLAB_ROLES.find((r) => r.value === roleType)

  const addRole = async () => {
    if (!addPerson || !roleType) return
    setRoleBusy(true)
    try {
      await api.post('/collab-roles', {
        person_id: Number(addPerson),
        role: roleType,
        detail: roleDef?.needsDetail ? roleDetail.trim() || null : null,
        working_group_id: roleDef?.needsWG && roleWG ? Number(roleWG) : null,
        institution_id: roleDef?.needsInstitution && roleInst ? Number(roleInst) : null,
        start_date: roleStart,
      })
      notifications.show({ message: 'Role added' })
      setAddPerson(null)
      setRoleType(null)
      setRoleDetail('')
      setRoleWG(null)
      setRoleInst(null)
      setRoleStart(today())
      loadRoles()
    } catch (err: any) {
      notifications.show({ color: 'red', message: err.message })
    } finally {
      setRoleBusy(false)
    }
  }

  const endRole = async (r: CollabRole) => {
    try {
      await api.patch(`/collab-roles/${r.id}`, { end_date: today() })
      notifications.show({ message: 'Role ended today' })
      loadRoles()
    } catch (err: any) {
      notifications.show({ color: 'red', message: err.message })
    }
  }

  const deleteRole = async (r: CollabRole) => {
    if (!window.confirm('Delete this role? This removes it from the leadership history.')) return
    try {
      await api.delete(`/collab-roles/${r.id}`)
      notifications.show({ message: 'Role deleted' })
      loadRoles()
    } catch (err: any) {
      notifications.show({ color: 'red', message: err.message })
    }
  }

  const openRoleEdit = (r: CollabRole) => {
    setRoleForm({ detail: r.detail ?? '', start_date: r.start_date, end_date: r.end_date ?? '' })
    setRoleEdit(r)
  }

  const saveRoleEdit = async () => {
    if (!roleEdit) return
    try {
      await api.patch(`/collab-roles/${roleEdit.id}`, {
        detail: roleForm.detail.trim() || null,
        start_date: roleForm.start_date,
        end_date: roleForm.end_date || null,
      })
      notifications.show({ message: 'Role updated' })
      setRoleEdit(null)
      loadRoles()
    } catch (err: any) {
      notifications.show({ color: 'red', message: err.message })
    }
  }

  // Date ranges are inclusive on both ends, so a role ending today is current.
  // A role must also have started to be current (a pre-recorded future role is
  // neither current nor former) — same check as the backend and
  // InstitutionDetail.tsx.
  const { current, former } = useMemo(() => {
    const t = today()
    const current = roles
      .filter((r) => r.start_date <= t && (!r.end_date || r.end_date >= t))
      .sort(byOrgChart)
    const former = roles
      .filter((r) => r.end_date && r.end_date < t)
      .sort((a, b) => (b.end_date ?? '').localeCompare(a.end_date ?? '') || byOrgChart(a, b))
    return { current, former }
  }, [roles])

  const officeActions = isOffice
    ? { onEnd: endRole, onEdit: openRoleEdit, onDelete: deleteRole }
    : {}

  return (
    <>
      <Title order={3} mb="xs">
        Leadership
      </Title>

      {current.length === 0 ? (
        <Text size="sm" c="dimmed">
          No current leadership roles recorded.
        </Text>
      ) : (
        <RoleRows roles={current} {...officeActions} />
      )}

      {isOffice && (
        <Card withBorder maw={720} mt="md">
          <Stack gap="sm">
            <Title order={6}>Add role</Title>
            <Group gap="sm" align="flex-start" wrap="wrap">
              <PersonSelect
                label="Person"
                value={addPerson}
                onChange={setAddPerson}
                w={{ base: '100%', xs: 280 }}
              />
              <Select
                label="Role"
                placeholder="Select role…"
                // admin_contact is assigned from the institution pages, not here.
                data={COLLAB_ROLES.filter((r) => !r.hidden && r.value !== 'admin_contact').map(
                  (r) => ({ value: r.value, label: r.label }),
                )}
                value={roleType}
                onChange={setRoleType}
                searchable
                w={{ base: '100%', xs: 260 }}
              />
            </Group>
            {roleDef?.needsDetail && (
              <TextInput
                label={roleDef.value === 'other' ? 'Title' : 'Area'}
                description={
                  roleDef.value === 'other'
                    ? 'Full title as it should appear (e.g. DEI Committee Chair).'
                    : 'Qualifier, e.g. Accelerator, Experimental, Outreach, Target.'
                }
                value={roleDetail}
                onChange={(e) => setRoleDetail(e.currentTarget.value)}
                maw={340}
              />
            )}
            {roleDef?.needsWG && (
              <Select
                label="Working group"
                placeholder="Select working group…"
                data={wgs.map((w) => ({ value: String(w.id), label: w.name }))}
                value={roleWG}
                onChange={setRoleWG}
                searchable
                maw={340}
              />
            )}
            {roleDef?.needsInstitution && (
              <Select
                label="Institution"
                placeholder="Select institution…"
                data={institutions.map((i) => ({
                  value: String(i.id),
                  label: i.short_name ? `${i.name} (${i.short_name})` : i.name,
                }))}
                value={roleInst}
                onChange={setRoleInst}
                searchable
                maw={340}
              />
            )}
            <TextInput
              label="Start date"
              type="date"
              value={roleStart}
              onChange={(e) => setRoleStart(e.currentTarget.value)}
              maw={200}
            />
            <Button
              w="fit-content"
              onClick={addRole}
              loading={roleBusy}
              disabled={
                !addPerson ||
                !roleType ||
                (roleDef?.needsDetail && !roleDetail.trim()) ||
                (roleDef?.needsWG && !roleWG) ||
                (roleDef?.needsInstitution && !roleInst)
              }
            >
              Add role
            </Button>
          </Stack>
        </Card>
      )}

      {former.length > 0 && (
        <>
          <Checkbox
            mt="xl"
            label="Show past leadership"
            checked={showPast}
            onChange={(e) => setShowPast(e.currentTarget.checked)}
          />
          {showPast && (
            <>
              <Title order={4} mt="md" mb="xs">
                Past leadership
              </Title>
              <RoleRows roles={former} past {...officeActions} />
            </>
          )}
        </>
      )}

      <Modal opened={roleEdit !== null} onClose={() => setRoleEdit(null)} title="Edit role">
        {roleEdit && (
          <Stack gap="sm">
            <Text size="sm">
              {collabRoleLabel(roleEdit.role, roleEdit.detail)}
              {roleEdit.person
                ? ` — ${roleEdit.person.preferred_name || roleEdit.person.given_name} ${roleEdit.person.family_name}`
                : ''}
            </Text>
            {COLLAB_ROLES.find((d) => d.value === roleEdit.role)?.needsDetail && (
              <TextInput
                label={roleEdit.role === 'other' ? 'Title' : 'Area'}
                value={roleForm.detail}
                onChange={(e) => setRoleForm({ ...roleForm, detail: e.currentTarget.value })}
              />
            )}
            <TextInput
              label="Start date"
              type="date"
              value={roleForm.start_date}
              onChange={(e) => setRoleForm({ ...roleForm, start_date: e.currentTarget.value })}
            />
            <TextInput
              label="End date"
              description="Leave empty for a role still held."
              type="date"
              value={roleForm.end_date}
              onChange={(e) => setRoleForm({ ...roleForm, end_date: e.currentTarget.value })}
            />
            <Button onClick={saveRoleEdit}>Save</Button>
          </Stack>
        )}
      </Modal>
    </>
  )
}
