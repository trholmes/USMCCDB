import { Anchor, Badge, Group, Select, Table, Text, TextInput, Title } from '@mantine/core'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import type { PersonSummary } from '../api/types'
import PersonAvatar from '../components/PersonAvatar'
import StatusBadge from '../components/StatusBadge'
import { SortableTh, useSortable, type Accessors } from '../components/sortable'
import { CAREER_STAGES, RESEARCH_AREAS, splitList } from '../constants'
import { useSession } from '../auth/SessionContext'

const ACCESSORS: Accessors<PersonSummary> = {
  name: (p) => `${p.family_name} ${p.given_name}`,
  institution: (p) => p.primary_institution?.short_name || p.primary_institution?.name,
  email: (p) => p.email,
  position: (p) => p.career_stage,
  voting: (p) => p.is_voting,
  orcid: (p) => p.orcid,
  status: (p) => p.status,
}

export default function DirectoryPage() {
  const [people, setPeople] = useState<PersonSummary[]>([])
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<string | null>('active')
  const [stage, setStage] = useState<string | null>(null)
  const [institution, setInstitution] = useState<string | null>(null)
  const [area, setArea] = useState<string | null>(null)
  const [voting, setVoting] = useState<string | null>(null)
  const navigate = useNavigate()
  const { isOffice } = useSession()

  useEffect(() => {
    const query = status ? `?status=${status}` : ''
    api.get<PersonSummary[]>(`/people${query}`).then(setPeople).catch(() => setPeople([]))
  }, [status])

  const institutionOptions = useMemo(() => {
    const seen = new Map<string, string>()
    for (const p of people) {
      if (p.primary_institution) {
        seen.set(
          String(p.primary_institution.id),
          p.primary_institution.short_name || p.primary_institution.name,
        )
      }
    }
    return [...seen.entries()]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [people])

  const filtered = useMemo(() => {
    const needle = q.toLowerCase()
    return people.filter(
      (p) =>
        (!needle ||
          `${p.given_name} ${p.family_name}`.toLowerCase().includes(needle) ||
          p.email.toLowerCase().includes(needle)) &&
        (!stage || p.career_stage === stage) &&
        (!institution || String(p.primary_institution?.id) === institution) &&
        (!area || splitList(p.research_areas).includes(area)) &&
        (!voting || p.is_voting === (voting === 'voting')),
    )
  }, [people, q, stage, institution, area, voting])
  const { sorted, sort, toggle } = useSortable(filtered, ACCESSORS)

  return (
    <>
      <Group justify="space-between" mb="md">
        <Title order={3}>Member directory</Title>
        <TextInput
          placeholder="Search name or email…"
          value={q}
          onChange={(e) => setQ(e.currentTarget.value)}
          w={240}
        />
      </Group>
      <Group mb="md" gap="xs">
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
        <Select
          data={CAREER_STAGES}
          value={stage}
          onChange={setStage}
          clearable
          placeholder="All positions"
          w={180}
        />
        <Select
          data={institutionOptions}
          value={institution}
          onChange={setInstitution}
          clearable
          searchable
          placeholder="All institutions"
          w={200}
        />
        <Select
          data={RESEARCH_AREAS}
          value={area}
          onChange={setArea}
          clearable
          placeholder="All research areas"
          w={220}
        />
        <Select
          data={[
            { value: 'voting', label: 'Voting' },
            { value: 'nonvoting', label: 'Non-voting' },
          ]}
          value={voting}
          onChange={setVoting}
          clearable
          placeholder="Voting?"
          w={130}
        />
      </Group>

      <Text size="sm" c="dimmed" mb="xs">
        {filtered.length} people
      </Text>
      <Table striped highlightOnHover stickyHeader>
        <Table.Thead>
          <Table.Tr>
            <SortableTh label="Name" k="name" sort={sort} toggle={toggle} />
            <SortableTh label="Institution" k="institution" sort={sort} toggle={toggle} />
            <SortableTh label="Email" k="email" sort={sort} toggle={toggle} />
            <SortableTh label="Position" k="position" sort={sort} toggle={toggle} />
            <SortableTh label="Voting" k="voting" sort={sort} toggle={toggle} />
            <SortableTh label="ORCID" k="orcid" sort={sort} toggle={toggle} />
            {isOffice && <SortableTh label="Status" k="status" sort={sort} toggle={toggle} />}
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
              <Table.Td>
                {p.primary_institution && (
                  <Text
                    size="sm"
                    c="blue"
                    component="span"
                    style={{ cursor: 'pointer' }}
                    onClick={(e) => {
                      e.stopPropagation()
                      navigate(`/institutions/${p.primary_institution!.id}`)
                    }}
                  >
                    {p.primary_institution.short_name || p.primary_institution.name}
                  </Text>
                )}
              </Table.Td>
              <Table.Td>{p.email}</Table.Td>
              <Table.Td>{p.career_stage}</Table.Td>
              <Table.Td>
                {p.is_voting ? <Badge variant="light">voting</Badge> : null}
              </Table.Td>
              <Table.Td>
                {p.orcid ? (
                  <Anchor
                    href={`https://orcid.org/${p.orcid}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    size="sm"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {p.orcid}
                  </Anchor>
                ) : (
                  <Text size="sm" c="dimmed">
                    —
                  </Text>
                )}
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
