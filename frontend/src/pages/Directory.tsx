import { Badge, Group, Select, Table, Text, TextInput, Title } from '@mantine/core'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import type { PersonSummary } from '../api/types'
import PersonAvatar from '../components/PersonAvatar'
import StatusBadge from '../components/StatusBadge'
import { useSession } from '../auth/SessionContext'

export default function DirectoryPage() {
  const [people, setPeople] = useState<PersonSummary[]>([])
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<string | null>('active')
  const navigate = useNavigate()
  const { isOffice } = useSession()

  useEffect(() => {
    const query = status ? `?status=${status}` : ''
    api.get<PersonSummary[]>(`/people${query}`).then(setPeople).catch(() => setPeople([]))
  }, [status])

  const filtered = useMemo(() => {
    const needle = q.toLowerCase()
    return people.filter(
      (p) =>
        !needle ||
        `${p.given_name} ${p.family_name}`.toLowerCase().includes(needle) ||
        p.email.toLowerCase().includes(needle),
    )
  }, [people, q])

  return (
    <>
      <Group justify="space-between" mb="md">
        <Title order={3}>Member directory</Title>
        <Group>
          <TextInput
            placeholder="Search name or email…"
            value={q}
            onChange={(e) => setQ(e.currentTarget.value)}
            w={240}
          />
          <Select
            data={[
              { value: 'active', label: 'Active' },
              { value: 'pending', label: 'Pending' },
              { value: 'inactive', label: 'Inactive' },
              { value: 'alumni', label: 'Alumni' },
            ]}
            value={status}
            onChange={setStatus}
            clearable
            placeholder="All statuses"
            w={150}
          />
        </Group>
      </Group>

      <Text size="sm" c="dimmed" mb="xs">
        {filtered.length} people
      </Text>
      <Table striped highlightOnHover stickyHeader>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Name</Table.Th>
            <Table.Th>Email</Table.Th>
            <Table.Th>Position</Table.Th>
            <Table.Th>Voting</Table.Th>
            <Table.Th>ORCID</Table.Th>
            {isOffice && <Table.Th>Status</Table.Th>}
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {filtered.map((p) => (
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
              <Table.Td>{p.email}</Table.Td>
              <Table.Td>{p.career_stage}</Table.Td>
              <Table.Td>
                {p.is_voting ? <Badge variant="light">voting</Badge> : null}
              </Table.Td>
              <Table.Td>
                <Text size="sm" c="dimmed">
                  {p.orcid || '—'}
                </Text>
              </Table.Td>
              {isOffice && (
                <Table.Td>
                  <StatusBadge status={p.status} />
                </Table.Td>
              )}
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </>
  )
}
