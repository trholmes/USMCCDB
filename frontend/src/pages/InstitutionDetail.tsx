import { Badge, Card, Group, Stack, Table, Text, Title } from '@mantine/core'
import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api } from '../api/client'
import type { Institution, PersonSummary } from '../api/types'
import PersonAvatar from '../components/PersonAvatar'
import { SortableTh, useSortable, type Accessors } from '../components/sortable'

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
  const navigate = useNavigate()
  const { sorted, sort, toggle } = useSortable(members, ACCESSORS)

  const load = useCallback(() => {
    api.get<Institution>(`/institutions/${id}`).then(setInst).catch(() => setInst(null))
    api
      .get<PersonSummary[]>(`/people?institution_id=${id}`)
      .then(setMembers)
      .catch(() => setMembers([]))
  }, [id])
  useEffect(load, [load])

  if (!inst) return <Text c="dimmed">Loading…</Text>

  return (
    <Stack>
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
          {!inst.is_active && <Badge color="gray">inactive</Badge>}
        </Group>
      </div>

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
      <Table striped highlightOnHover maw={900}>
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
      <Text size="sm" c="dimmed">
        Manage institution details in <Link to="/institutions">Institutions</Link> (office).
      </Text>
    </Stack>
  )
}
