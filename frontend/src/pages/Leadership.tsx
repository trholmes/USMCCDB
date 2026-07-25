import { Anchor, Checkbox, Group, Table, Text, Title } from '@mantine/core'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import type { CollabRole } from '../api/types'
import PersonAvatar from '../components/PersonAvatar'
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

function RoleRows({ roles, past }: { roles: CollabRole[]; past?: boolean }) {
  const { sorted, sort, toggle } = useSortable(roles, ACCESSORS)
  return (
    <Table maw={860}>
      <Table.Thead>
        <Table.Tr>
          <SortableTh label="Role" k="role" sort={sort} toggle={toggle} />
          <SortableTh label="Person" k="person" sort={sort} toggle={toggle} />
          <SortableTh label="Scope" k="scope" sort={sort} toggle={toggle} />
          <SortableTh label={past ? 'From' : 'Since'} k="from" sort={sort} toggle={toggle} />
          <SortableTh label={past ? 'To' : 'Until'} k="to" sort={sort} toggle={toggle} />
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

  useEffect(() => {
    // Administrative Institutional Contacts are an admin function, not
    // collaboration leadership, so they don't belong on this page.
    api
      .get<CollabRole[]>('/collab-roles')
      .then((rs) => setRoles(rs.filter((r) => r.role !== 'admin_contact')))
      .catch(() => setRoles([]))
  }, [])

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
        <RoleRows roles={current} />
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
              <RoleRows roles={former} past />
            </>
          )}
        </>
      )}
    </>
  )
}
