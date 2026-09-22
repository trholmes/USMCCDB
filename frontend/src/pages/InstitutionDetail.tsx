import { Anchor, Badge, Button, Card, Group, Stack, Table, Text, Title } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api } from '../api/client'
import type { CollabRole, Institution, PersonSummary } from '../api/types'
import InstitutionEditModal from '../components/InstitutionEditModal'
import PersonAvatar from '../components/PersonAvatar'
import PersonSelect from '../components/PersonSelect'
import { SortableTh, useSortable, type Accessors } from '../components/sortable'
import { collabRoleLabel } from '../constants'
import { today } from '../dates'
import { useSession } from '../auth/SessionContext'

const ACCESSORS: Accessors<PersonSummary> = {
  name: (p) => `${p.family_name} ${p.given_name}`,
  position: (p) => p.career_stage,
  voting: (p) => p.is_voting,
  email: (p) => p.email,
}

export default function InstitutionDetailPage() {
  const { id } = useParams()
  const [inst, setInst] = useState<Institution | null>(null)
  const [members, setMembers] = useState<PersonSummary[]>([])
  const [roles, setRoles] = useState<CollabRole[]>([])
  const [editing, setEditing] = useState(false)
  const [contactSel, setContactSel] = useState<string | null>(null)
  const { isOffice } = useSession()
  const navigate = useNavigate()
  const { sorted, sort, toggle } = useSortable(members, ACCESSORS)

  const load = useCallback(() => {
    api.get<Institution>(`/institutions/${id}`).then(setInst).catch(() => setInst(null))
    api
      .get<PersonSummary[]>(`/people?institution_id=${id}`)
      .then(setMembers)
      .catch(() => setMembers([]))
    api
      .get<CollabRole[]>(`/collab-roles?institution_id=${id}`)
      .then(setRoles)
      .catch(() => setRoles([]))
  }, [id])
  useEffect(load, [load])

  const assignContact = async () => {
    if (!contactSel) return
    try {
      await api.post('/collab-roles', {
        person_id: Number(contactSel),
        role: 'admin_contact',
        detail: null,
        working_group_id: null,
        institution_id: Number(id),
        start_date: today(),
      })
      notifications.show({ message: 'Administrative contact assigned.' })
      setContactSel(null)
      load()
    } catch (err: any) {
      notifications.show({ color: 'red', message: err.message })
    }
  }

  const endRole = async (r: CollabRole) => {
    const name = r.person ? `${r.person.given_name} ${r.person.family_name}` : 'this person'
    if (!window.confirm(`End ${name}'s "${collabRoleLabel(r.role, r.detail)}" role today?`))
      return
    try {
      await api.patch(`/collab-roles/${r.id}`, { end_date: today() })
      notifications.show({ message: 'Role ended today.' })
      load()
    } catch (err: any) {
      notifications.show({ color: 'red', message: err.message })
    }
  }

  if (!inst) return <Text c="dimmed">Loading…</Text>

  // Institution-scoped roles currently in effect (admin contacts, IB reps);
  // date ranges are inclusive on both ends, so a role ending today is current.
  const t = today()
  const currentRoles = roles.filter((r) => r.start_date <= t && (!r.end_date || r.end_date >= t))
  const currentContacts = currentRoles.filter((r) => r.role === 'admin_contact')

  return (
    <Stack>
      <Group justify="space-between" align="flex-start">
        <div>
          <Title order={3}>{inst.name}</Title>
          <Group gap="xs" mt={4}>
            {inst.short_name && <Badge variant="light">{inst.short_name}</Badge>}
          {inst.country && (
            <Text size="sm" c="dimmed">
              {inst.country}
            </Text>
          )}
            {!inst.is_us && (
              <Badge color="gray" variant="light" title="People currently here are not eligible for voting membership">
                non-US
              </Badge>
            )}
            {!inst.is_active && (
              <Badge color="gray" title="Created by an import or registration and awaiting office review; hidden from the registration form's institution list">
                inactive
              </Badge>
            )}
          </Group>
        </div>
        {isOffice && <Button variant="light" onClick={() => setEditing(true)}>Edit</Button>}
      </Group>

      {(currentRoles.length > 0 || isOffice) && (
        <Card withBorder maw={720}>
          <Text size="sm" c="dimmed">
            Contacts & representatives
          </Text>
          <Stack gap={4} mt={4}>
            {currentRoles.map((r) => (
              <Group key={r.id} gap="xs" wrap="nowrap">
                <Text size="sm">{collabRoleLabel(r.role, r.detail)}:</Text>
                {r.person ? (
                  <Anchor component={Link} to={`/people/${r.person.id}`} size="sm">
                    {`${r.person.preferred_name || r.person.given_name} ${r.person.family_name}`}
                  </Anchor>
                ) : (
                  <Text size="sm">—</Text>
                )}
                {isOffice && r.role === 'admin_contact' && (
                  <Button size="compact-xs" variant="subtle" color="red" onClick={() => endRole(r)}>
                    End
                  </Button>
                )}
              </Group>
            ))}
            {currentContacts.length === 0 && (
              <Text size="sm" c="dimmed">
                No administrative contact assigned.
              </Text>
            )}
          </Stack>
          {isOffice && (
            <Group gap="xs" mt="sm" align="flex-end">
              <PersonSelect
                people={members}
                excludeIds={currentContacts.map((r) => r.person_id)}
                value={contactSel}
                onChange={setContactSel}
                placeholder="Assign administrative contact…"
                w={{ base: '100%', xs: 280 }}
              />
              <Button size="xs" disabled={!contactSel} onClick={assignContact}>
                Assign contact
              </Button>
            </Group>
          )}
        </Card>
      )}

      {inst.latex_address && (
        <Card withBorder maw={720}>
          <Text size="sm" c="dimmed">
            Author-list address
          </Text>
          <Text size="sm">{inst.latex_address}</Text>
        </Card>
      )}

      <Title order={5}>
        People ({members.length})
      </Title>
      <Table.ScrollContainer minWidth={700} maw={900}>
      <Table striped highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <SortableTh label="Name" k="name" sort={sort} toggle={toggle} />
            <SortableTh label="Position" k="position" sort={sort} toggle={toggle} />
            <SortableTh label="Voting" k="voting" sort={sort} toggle={toggle} />
            <SortableTh label="Email" k="email" sort={sort} toggle={toggle} />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {sorted.map((p) => (
            <Table.Tr
              key={p.id}
              style={{ cursor: 'pointer' }}
              onClick={() => navigate(`/people/${p.id}`)}
            >
              <Table.Td>
                <Group gap="xs" wrap="nowrap">
                  <PersonAvatar person={p} />
                  <span>
                    {p.family_name}, {p.preferred_name || p.given_name}
                  </span>
                </Group>
              </Table.Td>
              <Table.Td>{p.career_stage}</Table.Td>
              <Table.Td>{p.is_voting ? <Badge variant="light">voting</Badge> : null}</Table.Td>
              <Table.Td>{p.email}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      </Table.ScrollContainer>
      <InstitutionEditModal
        target={editing ? inst : null}
        onClose={() => setEditing(false)}
        onSaved={load}
      />
    </Stack>
  )
}
