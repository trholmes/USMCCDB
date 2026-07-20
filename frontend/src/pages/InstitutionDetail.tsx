import { Badge, Card, Group, Stack, Table, Text, Title } from '@mantine/core'
import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api } from '../api/client'
import type { Institution, PersonSummary } from '../api/types'
import PersonAvatar from '../components/PersonAvatar'

export default function InstitutionDetailPage() {
  const { id } = useParams()
  const [inst, setInst] = useState<Institution | null>(null)
  const [members, setMembers] = useState<PersonSummary[]>([])
  const navigate = useNavigate()

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
            <Table.Th>Name</Table.Th>
            <Table.Th>Position</Table.Th>
            <Table.Th>Voting</Table.Th>
            <Table.Th>Email</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {members.map((p) => (
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
