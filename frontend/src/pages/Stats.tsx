import { Card, Group, SegmentedControl, SimpleGrid, Table, Tabs, Text, Title } from '@mantine/core'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
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
import type { MemberStats, TalkStatRow } from '../api/types'
import { careerStageLabel } from '../constants'
import { SortableTh, useSortable, type Accessors } from '../components/sortable'

// Shared chart chrome (matches the talks chart below): recessive grid/axes,
// text in ink tokens, series color only on the marks.
const GRID = '#e7e6e2'
const TICK = { fill: '#52514e', fontSize: 12 }
const TOOLTIP = {
  cursor: { fill: 'rgba(42, 120, 214, 0.06)' },
  contentStyle: { borderRadius: 8, border: '1px solid #e7e6e2', fontSize: 13 },
}
// Categorical slot 1 (blue) — the single-series hue used across this page.
const BLUE = '#2a78d6'

export default function StatsPage() {
  const [tab, setTab] = useState<string | null>('members')
  return (
    <>
      <Title order={3} mb="xs">
        Statistics
      </Title>
      <Tabs value={tab} onChange={setTab} mb="md">
        <Tabs.List>
          <Tabs.Tab value="members">Membership</Tabs.Tab>
          <Tabs.Tab value="talks">Talks &amp; speakers</Tabs.Tab>
        </Tabs.List>
      </Tabs>
      {tab === 'members' ? <MembershipStats /> : <TalkStats />}
    </>
  )
}

// --- Membership ---------------------------------------------------------------

function StatTile({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <Card withBorder py="sm">
      <Text size="sm" c="dimmed">
        {label}
      </Text>
      <Text fz={28} fw={700} lh={1.2}>
        {value}
      </Text>
      {sub && (
        <Text size="xs" c="dimmed">
          {sub}
        </Text>
      )}
    </Card>
  )
}

function MembershipStats() {
  const [stats, setStats] = useState<MemberStats | null>(null)
  useEffect(() => {
    api.get<MemberStats>('/stats/members').then(setStats).catch(() => setStats(null))
  }, [])
  if (!stats) return null

  const pctActive = (n: number) =>
    stats.active ? `${Math.round((100 * n) / stats.active)}% of active members` : '—'
  const pending = stats.by_status.find((r) => r.label === 'pending')?.count ?? 0
  const stages = stats.by_career_stage.map((r) => ({
    label: careerStageLabel(r.label),
    count: r.count,
  }))

  return (
    <>
      <SimpleGrid cols={{ base: 2, sm: 3, lg: 5 }} mb="md">
        <StatTile
          label="Active members"
          value={stats.active}
          sub={`of ${stats.total_people} people on record`}
        />
        <StatTile label="Voting members" value={stats.voting} sub={pctActive(stats.voting)} />
        <StatTile
          label="At US institutions"
          value={stats.us_active}
          sub={pctActive(stats.us_active)}
        />
        <StatTile
          label="Institutions"
          value={stats.institutions_with_active}
          sub="with active members"
        />
        <StatTile label="Pending applications" value={pending} sub="awaiting office review" />
      </SimpleGrid>

      <SimpleGrid cols={{ base: 1, lg: 2 }} mb="md">
        <Card withBorder h={320}>
          <Text size="sm" fw={600} mb={2}>
            Active members by career stage
          </Text>
          <Text size="xs" c="dimmed" mb="xs">
            Current active membership
          </Text>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={stages} layout="vertical" barCategoryGap="28%">
              <CartesianGrid horizontal={false} stroke={GRID} />
              <XAxis
                type="number"
                allowDecimals={false}
                tickLine={false}
                axisLine={{ stroke: GRID }}
                tick={TICK}
                height={24}
              />
              <YAxis
                type="category"
                dataKey="label"
                tickLine={false}
                axisLine={false}
                tick={TICK}
                width={150}
              />
              <Tooltip {...TOOLTIP} />
              <Bar
                dataKey="count"
                name="Active members"
                fill={BLUE}
                radius={[0, 4, 4, 0]}
                maxBarSize={22}
              />
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card withBorder h={320}>
          <Text size="sm" fw={600} mb={2}>
            New members per year
          </Text>
          <Text size="xs" c="dimmed" mb="xs">
            First activation of each membership
          </Text>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={stats.new_members_by_year} barCategoryGap="28%">
              <CartesianGrid vertical={false} stroke={GRID} />
              <XAxis
                dataKey="year"
                tickLine={false}
                axisLine={{ stroke: GRID }}
                tick={TICK}
              />
              <YAxis
                allowDecimals={false}
                tickLine={false}
                axisLine={false}
                tick={TICK}
                width={32}
              />
              <Tooltip {...TOOLTIP} />
              <Bar
                dataKey="count"
                name="New members"
                fill={BLUE}
                radius={[4, 4, 0, 0]}
                maxBarSize={28}
              />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </SimpleGrid>

      <SimpleGrid cols={{ base: 1, md: 2 }} maw={860}>
        <Card withBorder>
          <Text size="sm" fw={600} mb={2}>
            By research area
          </Text>
          <Text size="xs" c="dimmed" mb="xs">
            Active members; several areas may be selected, so counts can exceed the total.
          </Text>
          <Table striped>
            <Table.Tbody>
              {stats.by_research_area.map((r) => (
                <Table.Tr key={r.label}>
                  <Table.Td>{r.label}</Table.Td>
                  <Table.Td w={80} ta="right">
                    {r.count}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Card>

        <Card withBorder>
          <Text size="sm" fw={600} mb={2}>
            By membership status
          </Text>
          <Text size="xs" c="dimmed" mb="xs">
            Everyone on record, including former members and applicants.
          </Text>
          <Table striped>
            <Table.Tbody>
              {stats.by_status.map((r) => (
                <Table.Tr key={r.label}>
                  <Table.Td tt="capitalize">{r.label}</Table.Td>
                  <Table.Td w={80} ta="right">
                    {r.count}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Card>
      </SimpleGrid>
    </>
  )
}

// --- Talks / speaker fair-share -------------------------------------------------

type TotalRow = [string, { id: number; talks: number; invited: number }]

const ACCESSORS: Accessors<TotalRow> = {
  key: (r) => r[0],
  talks: (r) => r[1].talks,
  invited: (r) => r[1].invited,
}

function TalkStats() {
  const [by, setBy] = useState('person')
  const [rows, setRows] = useState<TalkStatRow[]>([])
  const navigate = useNavigate()

  useEffect(() => {
    api.get<TalkStatRow[]>(`/stats/talks?by=${by}`).then(setRows).catch(() => setRows([]))
  }, [by])

  // Aggregate per key across years for the table; per-year totals for the chart.
  const totals = useMemo(() => {
    const m = new Map<string, { id: number; talks: number; invited: number }>()
    rows.forEach((r) => {
      const cur = m.get(r.key) ?? { id: r.key_id, talks: 0, invited: 0 }
      m.set(r.key, { id: r.key_id, talks: cur.talks + r.talks, invited: cur.invited + r.invited })
    })
    return [...m.entries()].sort((a, b) => b[1].talks - a[1].talks) as TotalRow[]
  }, [rows])
  const { sorted, sort, toggle } = useSortable(totals, ACCESSORS)

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
        <Text fw={600}>Speaker fair-share</Text>
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
            <CartesianGrid vertical={false} stroke={GRID} />
            <XAxis
              dataKey="year"
              tickLine={false}
              axisLine={{ stroke: GRID }}
              tick={TICK}
            />
            <YAxis
              allowDecimals={false}
              tickLine={false}
              axisLine={false}
              tick={TICK}
              width={32}
            />
            <Tooltip {...TOOLTIP} />
            <Legend wrapperStyle={{ fontSize: 13 }} iconType="circle" iconSize={9} />
            <Bar dataKey="talks" name="All talks" fill={BLUE} radius={[4, 4, 0, 0]} maxBarSize={28} />
            <Bar dataKey="invited" name="Invited" fill="#008300" radius={[4, 4, 0, 0]} maxBarSize={28} />
          </BarChart>
        </ResponsiveContainer>
      </Card>

      <Table striped highlightOnHover maw={720}>
        <Table.Thead>
          <Table.Tr>
            <SortableTh
              label={by === 'person' ? 'Speaker' : 'Institution'}
              k="key"
              sort={sort}
              toggle={toggle}
            />
            <SortableTh label="Talks" k="talks" sort={sort} toggle={toggle} />
            <SortableTh label="Invited" k="invited" sort={sort} toggle={toggle} />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {sorted.map(([key, v]) => (
            <Table.Tr
              key={key}
              style={{ cursor: 'pointer' }}
              onClick={() =>
                navigate(by === 'person' ? `/people/${v.id}` : `/institutions/${v.id}`)
              }
            >
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
