import { Anchor, Checkbox, Group, Table, Text, Title } from '@mantine/core'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import type { CollabRole } from '../api/types'
import PersonAvatar from '../components/PersonAvatar'
import { useSession } from '../auth/SessionContext'
import { COLLAB_ROLES, collabRoleLabel } from '../constants'

// Local calendar date (see Person.tsx for why not toISOString).
const today = () => {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// Sort in organigram order (COLLAB_ROLES order, then qualifier, then name).
const roleOrder = (r: CollabRole) => {
  const idx = COLLAB_ROLES.findIndex((d) => d.value === r.role)
  return idx === -1 ? COLLAB_ROLES.length : idx
}
const byOrgChart = (a: CollabRole, b: CollabRole) =>
  roleOrder(a) - roleOrder(b) ||
  (a.detail ?? '').localeCompare(b.detail ?? '') ||
  (a.person?.family_name ?? '').localeCompare(b.person?.family_name ?? '')

function RoleRows({ roles, past }: { roles: CollabRole[]; past?: boolean }) {
  return (
    <Table maw={860}>
      <Table.Thead>
        <Table.Tr>
          <Table.Th>Role</Table.Th>
          <Table.Th>Person</Table.Th>
          <Table.Th>Scope</Table.Th>
          <Table.Th>{past ? 'From' : 'Since'}</Table.Th>
          {past && <Table.Th>To</Table.Th>}
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {roles.map((r) => (
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
            {past && <Table.Td>{r.end_date}</Table.Td>}
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
  const { current, former } = useMemo(() => {
    const t = today()
    const current = roles.filter((r) => !r.end_date || r.end_date >= t).sort(byOrgChart)
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
      {/* <Text size="sm" c="dimmed" mb="md">
        Collaboration roles
      </Text> */}

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
