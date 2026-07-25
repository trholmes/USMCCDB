import {
  Card,
  Group,
  SegmentedControl,
  SimpleGrid,
  Table,
  Tabs,
  Text,
  Title,
  useComputedColorScheme,
} from '@mantine/core'
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

// Categorical slot 1 (blue) — the single-series hue used across this page.
const BLUE = '#2a78d6'

// Growth-chart research-area series (labels shortened from RESEARCH_AREAS).
const GROWTH_AREAS = [
  { area: 'Experimental Particle Physics', key: 'experimental', label: 'Experimental', color: BLUE },
  { area: 'Theoretical Particle Physics', key: 'theoretical', label: 'Theoretical', color: '#008300' },
  { area: 'Accelerator Physics', key: 'accelerator', label: 'Accelerator', color: '#b45309' },
  { area: 'Other', key: 'other', label: 'Other', color: '#8a8781' },
]

// Shared chart chrome (grid, ticks, tooltip): recessive grid/axes, text in ink
// tokens, series color only on the marks — resolved against the active color
// scheme so axis labels stay readable in dark mode.
function useChartChrome() {
  const dark = useComputedColorScheme('light') === 'dark'
  return {
    grid: dark ? '#464646' : '#e7e6e2',
    tick: { fill: dark ? '#b5b3af' : '#52514e', fontSize: 12 },
    tooltip: {
      cursor: { fill: dark ? 'rgba(103, 162, 226, 0.12)' : 'rgba(42, 120, 214, 0.06)' },
      contentStyle: {
        borderRadius: 8,
        border: `1px solid ${dark ? '#464646' : '#e7e6e2'}`,
        backgroundColor: dark ? '#2e2e2e' : '#ffffff',
        color: dark ? '#e4e2de' : '#1f1e1c',
        fontSize: 13,
      },
    },
  }
}

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

function StatTile({ label, value, sub }: { label: string; value: number | string; sub?: string }) {
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
  const [growthBucket, setGrowthBucket] = useState('quarter')
  const [growthSplit, setGrowthSplit] = useState('total')
  const { grid, tick, tooltip } = useChartChrome()
  useEffect(() => {
    api.get<MemberStats>('/stats/members').then(setStats).catch(() => setStats(null))
  }, [])

  // Re-bucket the monthly growth series into quarters or half-years, carrying
  // the per-area breakdown along.
  const growth = useMemo(() => {
    if (!stats) return []
    const label = (m: string) => {
      const [y, mo] = m.split('-').map(Number)
      if (growthBucket === 'month') return m
      if (growthBucket === 'quarter') return `${y} Q${Math.floor((mo - 1) / 3) + 1}`
      return `${y} H${mo <= 6 ? 1 : 2}`
    }
    const out: Record<string, string | number>[] = []
    for (const row of stats.new_members_by_month) {
      const period = label(row.month)
      let last = out[out.length - 1]
      if (!last || last.period !== period) {
        last = { period, count: 0 }
        for (const a of GROWTH_AREAS) last[a.key] = 0
        out.push(last)
      }
      last.count = (last.count as number) + row.count
      for (const a of GROWTH_AREAS)
        last[a.key] = (last[a.key] as number) + (row.areas?.[a.area] ?? 0)
    }
    return out
  }, [stats, growthBucket])

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
      <SimpleGrid cols={{ base: 2, sm: 3, lg: 4 }} mb="md">
        <StatTile
          label="Active members"
          value={stats.active}
          sub={`of ${stats.total_people} people on record`}
        />
        <StatTile label="Voting members" value={stats.voting} sub={pctActive(stats.voting)} />
        <StatTile
          label="Non-voting members"
          value={stats.active - stats.voting}
          sub={pctActive(stats.active - stats.voting)}
        />
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
        <StatTile
          label="Effort on USMCC"
          value={stats.avg_usmcc_percent != null ? `${Math.round(stats.avg_usmcc_percent)}%` : '—'}
          sub={
            stats.avg_usmcc_percent != null
              ? `avg of ${stats.usmcc_reporting} reporting · ${stats.usmcc_fte.toFixed(1)} FTE total`
              : 'no active member has reported effort'
          }
        />
        <StatTile label="Pending memberships" value={pending} sub="awaiting office review" />
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
              <CartesianGrid horizontal={false} stroke={grid} />
              <XAxis
                type="number"
                allowDecimals={false}
                tickLine={false}
                axisLine={{ stroke: grid }}
                tick={tick}
                height={24}
              />
              <YAxis
                type="category"
                dataKey="label"
                tickLine={false}
                axisLine={false}
                tick={tick}
                width={150}
              />
              <Tooltip {...tooltip} />
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
            Percentage of time on USMCC
          </Text>
          <Text size="xs" c="dimmed" mb="xs">
            {stats.usmcc_reporting
              ? `Self-reported effort of the ${stats.usmcc_reporting} active members reporting`
              : 'No active member has reported effort'}
          </Text>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={stats.by_usmcc_percent} barCategoryGap="28%">
              <CartesianGrid vertical={false} stroke={grid} />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={{ stroke: grid }}
                tick={tick}
              />
              <YAxis
                allowDecimals={false}
                tickLine={false}
                axisLine={false}
                tick={tick}
                width={32}
              />
              <Tooltip {...tooltip} />
              <Bar
                dataKey="count"
                name="Members"
                fill={BLUE}
                radius={[4, 4, 0, 0]}
                maxBarSize={28}
              />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </SimpleGrid>

      <Card withBorder h={360} mb="md" maw={860}>
        <Group justify="space-between" align="flex-start" mb={2}>
          <div>
            <Text size="sm" fw={600} mb={2}>
              New members
            </Text>
            <Text size="xs" c="dimmed">
              First activation of each membership
              {growthSplit === 'area' &&
                ' — people with several research areas count in each'}
            </Text>
          </div>
          <Group gap="xs">
            <SegmentedControl
              size="xs"
              data={[
                { value: 'month', label: 'Monthly' },
                { value: 'quarter', label: 'Quarterly' },
                { value: 'half', label: 'Half-yearly' },
              ]}
              value={growthBucket}
              onChange={setGrowthBucket}
            />
            <SegmentedControl
              size="xs"
              data={[
                { value: 'total', label: 'Total' },
                { value: 'area', label: 'By research area' },
              ]}
              value={growthSplit}
              onChange={setGrowthSplit}
            />
          </Group>
        </Group>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={growth} barGap={1} barCategoryGap="24%">
            <CartesianGrid vertical={false} stroke={grid} />
            <XAxis
              dataKey="period"
              tickLine={false}
              axisLine={{ stroke: grid }}
              tick={tick}
              minTickGap={24}
            />
            <YAxis
              allowDecimals={false}
              tickLine={false}
              axisLine={false}
              tick={tick}
              width={32}
            />
            <Tooltip {...tooltip} />
            {growthSplit === 'area' && (
              <Legend wrapperStyle={{ fontSize: 13 }} iconType="circle" iconSize={9} />
            )}
            {growthSplit === 'area' ? (
              GROWTH_AREAS.map((a) => (
                <Bar
                  key={a.key}
                  dataKey={a.key}
                  name={a.label}
                  fill={a.color}
                  radius={[4, 4, 0, 0]}
                  maxBarSize={20}
                />
              ))
            ) : (
              <Bar
                dataKey="count"
                name="New members"
                fill={BLUE}
                radius={[4, 4, 0, 0]}
                maxBarSize={28}
              />
            )}
          </BarChart>
        </ResponsiveContainer>
      </Card>

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
            Everyone on record, including former and pending members.
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

type TotalRow = [number, { label: string; talks: number; invited: number }]

const ACCESSORS: Accessors<TotalRow> = {
  key: (r) => r[1].label,
  talks: (r) => r[1].talks,
  invited: (r) => r[1].invited,
}

function TalkStats() {
  const [by, setBy] = useState('person')
  const [rows, setRows] = useState<TalkStatRow[]>([])
  const { grid, tick, tooltip } = useChartChrome()
  const navigate = useNavigate()

  useEffect(() => {
    api.get<TalkStatRow[]>(`/stats/talks?by=${by}`).then(setRows).catch(() => setRows([]))
  }, [by])

  // Aggregate across years for the table; per-year totals for the chart.
  // Keyed on key_id (the backend groups by id too) — keying on the display
  // name would merge distinct people who share a full name.
  const totals = useMemo(() => {
    const m = new Map<number, { label: string; talks: number; invited: number }>()
    rows.forEach((r) => {
      const cur = m.get(r.key_id) ?? { label: r.key, talks: 0, invited: 0 }
      m.set(r.key_id, {
        label: r.key,
        talks: cur.talks + r.talks,
        invited: cur.invited + r.invited,
      })
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
            <CartesianGrid vertical={false} stroke={grid} />
            <XAxis
              dataKey="year"
              tickLine={false}
              axisLine={{ stroke: grid }}
              tick={tick}
            />
            <YAxis
              allowDecimals={false}
              tickLine={false}
              axisLine={false}
              tick={tick}
              width={32}
            />
            <Tooltip {...tooltip} />
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
          {sorted.map(([id, v]) => (
            <Table.Tr
              key={id}
              style={{ cursor: 'pointer' }}
              onClick={() =>
                navigate(by === 'person' ? `/people/${id}` : `/institutions/${id}`)
              }
            >
              <Table.Td>{v.label}</Table.Td>
              <Table.Td>{v.talks}</Table.Td>
              <Table.Td>{v.invited}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </>
  )
}
