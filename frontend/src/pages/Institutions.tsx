import {
  Badge,
  Button,
  Group,
  SegmentedControl,
  Table,
  TextInput,
  Title,
} from '@mantine/core'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import type { Institution } from '../api/types'
import InstitutionEditModal from '../components/InstitutionEditModal'
import InstitutionMap from '../components/InstitutionMap'
import RorFillModal from '../components/RorFillModal'
import { PageCount, PaginationBar, usePagination } from '../components/pagination'
import { SortableTh, useSortable, type Accessors } from '../components/sortable'
import { useSession } from '../auth/SessionContext'

const ACCESSORS: Accessors<Institution> = {
  name: (i) => i.name,
  short_name: (i) => i.short_name,
  latex_address: (i) => i.latex_address,
  is_us: (i) => i.is_us,
  people_count: (i) => i.people_count,
}

export default function InstitutionsPage() {
  const [rows, setRows] = useState<Institution[]>([])
  const [modal, setModal] = useState<Institution | 'new' | null>(null)
  const [fillOpen, setFillOpen] = useState(false)
  const [q, setQ] = useState('')
  const [view, setView] = useState<'list' | 'map'>('list')
  const { isOffice } = useSession()
  const navigate = useNavigate()

  const filtered = useMemo(() => {
    const needle = q.toLowerCase()
    return rows.filter(
      (i) =>
        !needle ||
        i.name.toLowerCase().includes(needle) ||
        (i.short_name ?? '').toLowerCase().includes(needle),
    )
  }, [rows, q])
  const { sorted, sort, toggle } = useSortable(filtered, ACCESSORS)
  const { paged, page, setPage, total, count } = usePagination(sorted)

  const load = useCallback(() => {
    api.get<Institution[]>('/institutions').then(setRows).catch(() => setRows([]))
  }, [])
  useEffect(load, [load])

  return (
    <>
      <Group justify="space-between" mb="md">
        <Title order={3}>Institutions</Title>
        <Group>
          <SegmentedControl
            data={[
              { value: 'list', label: 'List' },
              { value: 'map', label: 'Map' },
            ]}
            value={view}
            onChange={(v) => setView(v as 'list' | 'map')}
            size="xs"
          />
          <TextInput
            placeholder="Search name…"
            value={q}
            onChange={(e) => setQ(e.currentTarget.value)}
            w={220}
          />
          {isOffice && (
            <Button variant="light" onClick={() => setFillOpen(true)}>
              Fill from ROR
            </Button>
          )}
          {isOffice && <Button onClick={() => setModal('new')}>Add institution</Button>}
        </Group>
      </Group>
      {view === 'map' && <InstitutionMap institutions={filtered} />}
      {view === 'list' && (
        <>
      <PageCount shown={paged.length} count={count} noun="institutions" />
      <Table striped highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <SortableTh label="Name" k="name" sort={sort} toggle={toggle} />
            <SortableTh label="Short name" k="short_name" sort={sort} toggle={toggle} />
            <SortableTh label="Author-list address" k="latex_address" sort={sort} toggle={toggle} />
            <SortableTh label="US" k="is_us" sort={sort} toggle={toggle} />
            <SortableTh label="People" k="people_count" sort={sort} toggle={toggle} />
            <Table.Th />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {paged.map((i) => (
            <Table.Tr
              key={i.id}
              style={{ cursor: 'pointer' }}
              onClick={() => navigate(`/institutions/${i.id}`)}
            >
              <Table.Td>
                {i.name}
                {!i.is_active && (
                  <Badge
                    color="gray"
                    variant="light"
                    ml="xs"
                    title="Created by an import or registration and awaiting office review — edit it, then check 'Active'"
                  >
                    inactive
                  </Badge>
                )}
              </Table.Td>
              <Table.Td>{i.short_name}</Table.Td>
              <Table.Td>{i.latex_address}</Table.Td>
              <Table.Td>
                {i.is_us ? null : (
                  <Badge color="gray" variant="light">
                    non-US
                  </Badge>
                )}
              </Table.Td>
              <Table.Td>{i.people_count}</Table.Td>
              <Table.Td onClick={(e) => e.stopPropagation()}>
                {isOffice && (
                  <Button size="compact-xs" variant="subtle" onClick={() => setModal(i)}>
                    Edit
                  </Button>
                )}
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      <PaginationBar page={page} total={total} setPage={setPage} />
        </>
      )}

      <InstitutionEditModal target={modal} onClose={() => setModal(null)} onSaved={load} />
      <RorFillModal
        opened={fillOpen}
        onClose={() => setFillOpen(false)}
        institutions={rows}
        onChanged={load}
        onEdit={(inst) => {
          setFillOpen(false)
          setModal(inst)
        }}
      />
    </>
  )
}
