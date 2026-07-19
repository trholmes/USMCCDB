import { Card, Group, SegmentedControl, Table, Text, Title } from '@mantine/core'
import { useEffect, useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { api } from '../api/client'
import type { TalkStatRow } from '../api/types'

export default function StatsPage() {
  const [by, setBy] = useState('person')
  const [rows, setRows] = useState<TalkStatRow[]>([])

  useEffect(() => {
    api.get<TalkStatRow[]>(`/stats/talks?by=${by}`).then(setRows).catch(() => setRows([]))
  }, [by])

  // Aggregate per key across years for the table; per-year totals for the chart.
  const totals = useMemo(() => {
    const m = new Map<string, { talks: number; invited: number }>()
    rows.forEach((r) => {
      const cur = m.get(r.key) ?? { talks: 0, invited: 0 }
      m.set(r.key, { talks: cur.talks + r.talks, invited: cur.invited + r.invited })
    })
    return [...m.entries()].sort((a, b) => b[1].talks - a[1].talks)
  }, [rows])

  const perYear = useMemo(() => {
    const m = new Map<number, { year: number; talks: number; invited: number }>()
    rows.forEach((r) => {
      const cur = m.get(r.year) ?? { year: r.year, talks: 0, invited: 0 }
      cur.talks += r.talks
      cur.invited += r.invited
      m.set(r.year, cur)
    })
    return [...m.values()].sort((a, b) => a.year - b.year)
  }, [rows])

  return (
    <>
      <Group justify="space-between" mb="md">
        <Title order={3}>Speaker fair-share statistics</Title>
        <SegmentedControl
          data={[
            { value: 'person', label: 'By person' },
            { value: 'institution', label: 'By institution' },
          ]}
          value={by}
          onChange={setBy}
        />
      </Group>

      <Card withBorder mb="md" h={300}>
        <Text size="sm" c="dimmed" mb="xs">
          Talks per year (all {by === 'person' ? 'speakers' : 'institutions'})
        </Text>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={perYear}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="year" />
            <YAxis allowDecimals={false} />
            <Tooltip />
            <Legend />
            <Bar dataKey="talks" name="All talks" fill="#4c6ef5" />
            <Bar dataKey="invited" name="Invited" fill="#ae3ec9" />
          </BarChart>
        </ResponsiveContainer>
      </Card>

      <Table striped highlightOnHover maw={720}>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{by === 'person' ? 'Speaker' : 'Institution'}</Table.Th>
            <Table.Th>Talks</Table.Th>
            <Table.Th>Invited</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {totals.map(([key, v]) => (
            <Table.Tr key={key}>
              <Table.Td>{key}</Table.Td>
              <Table.Td>{v.talks}</Table.Td>
              <Table.Td>{v.invited}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </>
  )
}
