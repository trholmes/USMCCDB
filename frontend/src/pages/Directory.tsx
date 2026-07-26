import {
  Anchor,
  Badge,
  Group,
  MultiSelect,
  Select,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import type { PersonSummary } from '../api/types'
import PersonAvatar from '../components/PersonAvatar'
import StatusBadge from '../components/StatusBadge'
import { PageCount, PaginationBar, usePagination } from '../components/pagination'
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
  // Multi-select filters: OR within a filter, AND across filters (issue #114).
  const [statuses, setStatuses] = useState<string[]>(['active'])
  const [stages, setStages] = useState<string[]>([])
  const [institutions, setInstitutions] = useState<string[]>([])
  const [areas, setAreas] = useState<string[]>([])
  const [voting, setVoting] = useState<string | null>(null)
  const navigate = useNavigate()
  const { isOffice } = useSession()

  useEffect(() => {
    api.get<PersonSummary[]>('/people').then(setPeople).catch(() => setPeople([]))
  }, [])

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
        (statuses.length === 0 || statuses.includes(p.status)) &&
        (stages.length === 0 || stages.includes(p.career_stage)) &&
        (institutions.length === 0 ||
          institutions.includes(String(p.primary_institution?.id))) &&
        (areas.length === 0 ||
          splitList(p.research_areas).some((a) => areas.includes(a))) &&
        (!voting || p.is_voting === (voting === 'voting')),
    )
  }, [people, q, statuses, stages, institutions, areas, voting])
  const { sorted, sort, toggle } = useSortable(filtered, ACCESSORS)
  const { paged, page, setPage, total, count } = usePagination(sorted)

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
      <Group mb="md" gap="xs" align="flex-start">
        <MultiSelect
          data={[
            { value: 'active', label: 'Active' },
            { value: 'pending', label: 'Pending' },
            { value: 'inactive', label: 'Inactive' },
            { value: 'alumni', label: 'Alumni' },
          ]}
          value={statuses}
          onChange={setStatuses}
          clearable
          placeholder={statuses.length ? undefined : 'All statuses'}
          w={190}
        />
        <MultiSelect
          data={CAREER_STAGES}
          value={stages}
          onChange={setStages}
          clearable
          searchable
          placeholder={stages.length ? undefined : 'All positions'}
          w={210}
        />
        <MultiSelect
          data={institutionOptions}
          value={institutions}
          onChange={setInstitutions}
          clearable
          searchable
          placeholder={institutions.length ? undefined : 'All institutions'}
          w={230}
        />
        <MultiSelect
          data={RESEARCH_AREAS}
          value={areas}
          onChange={setAreas}
          clearable
          placeholder={areas.length ? undefined : 'All research areas'}
          w={240}
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

      <PageCount shown={paged.length} count={count} noun="people" />
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
          {paged.map((p) => (
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
      <PaginationBar page={page} total={total} setPage={setPage} />
    </>
  )
}
