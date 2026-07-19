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

      <Card withBorder mb="md" h={320}>
        <Text size="sm" fw={600} mb={2}>
          USMCC talks per year
        </Text>
        <Text size="xs" c="dimmed" mb="xs">
          All talks vs. invited, {by === 'person' ? 'all speakers' : 'all institutions'}
        </Text>
        {/* Colors are the validated 2-slot categorical palette (blue, green);
            identity is also carried by the legend, never color alone. */}
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={perYear} barGap={2} barCategoryGap="28%">
            <CartesianGrid vertical={false} stroke="#e7e6e2" />
            <XAxis
              dataKey="year"
              tickLine={false}
              axisLine={{ stroke: '#e7e6e2' }}
              tick={{ fill: '#52514e', fontSize: 12 }}
            />
            <YAxis
              allowDecimals={false}
              tickLine={false}
              axisLine={false}
              tick={{ fill: '#52514e', fontSize: 12 }}
              width={32}
            />
            <Tooltip
              cursor={{ fill: 'rgba(42, 120, 214, 0.06)' }}
              contentStyle={{ borderRadius: 8, border: '1px solid #e7e6e2', fontSize: 13 }}
            />
            <Legend wrapperStyle={{ fontSize: 13 }} iconType="circle" iconSize={9} />
            <Bar dataKey="talks" name="All talks" fill="#2a78d6" radius={[4, 4, 0, 0]} maxBarSize={28} />
            <Bar dataKey="invited" name="Invited" fill="#008300" radius={[4, 4, 0, 0]} maxBarSize={28} />
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
