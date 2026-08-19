import { Alert, Badge, Card, Group, Stack, Table, Text, Title } from '@mantine/core'
import { useEffect, useState } from 'react'
import { api } from '../api/client'
import type { LoginEvent, SystemStatus } from '../api/types'

function formatBytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GB`
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`
  return `${Math.round(n / 1024)} kB`
}

// Admin tab: self-diagnosis (database size, record counts, migration state)
// plus the recent sign-in audit.
export default function AdminSystem() {
  const [status, setStatus] = useState<SystemStatus | null>(null)
  const [events, setEvents] = useState<LoginEvent[]>([])

  useEffect(() => {
    api.get<SystemStatus>('/site/system').then(setStatus).catch(() => setStatus(null))
    api.get<LoginEvent[]>('/auth/login-events?limit=100').then(setEvents).catch(() => setEvents([]))
  }, [])

  return (
    <Stack>
      <Title order={3}>Admin — system</Title>

      {status?.migrations_pending && (
        <Alert color="orange" maw={720}>
          The database schema ({status.db_revision}) is behind the code's newest
          migration ({status.code_revision}). Run{' '}
          <code>docker compose exec backend python -m alembic upgrade head</code>.
        </Alert>
      )}

      {status && (
        <Card withBorder maw={720}>
          <Title order={6} mb="xs">
            Status
          </Title>
          <Table w="auto" verticalSpacing={4} withRowBorders={false}>
            <Table.Tbody>
              <Table.Tr>
                <Table.Td>Database size</Table.Td>
                <Table.Td>{formatBytes(status.db_size_bytes)}</Table.Td>
              </Table.Tr>
              <Table.Tr>
                <Table.Td>Schema revision</Table.Td>
                <Table.Td>
                  {status.db_revision ?? 'fresh install (create_all)'}{' '}
                  {!status.migrations_pending && (
                    <Badge size="xs" variant="light" color="green">
                      up to date
                    </Badge>
                  )}
                </Table.Td>
              </Table.Tr>
              {status.backup_hour_utc && (
                <Table.Tr>
                  <Table.Td>Nightly backup</Table.Td>
                  <Table.Td>{status.backup_hour_utc}:00 UTC (see the Backups tab)</Table.Td>
                </Table.Tr>
              )}
              {Object.entries(status.counts).map(([k, v]) => (
                <Table.Tr key={k}>
                  <Table.Td style={{ textTransform: 'capitalize' }}>{k}</Table.Td>
                  <Table.Td>{v}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Card>
      )}

      <Card withBorder>
        <Group justify="space-between" mb="xs">
          <Title order={6}>Recent sign-ins</Title>
          <Text size="xs" c="dimmed">
            last {events.length} attempts, newest first
          </Text>
        </Group>
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>When</Table.Th>
              <Table.Th>Account</Table.Th>
              <Table.Th>Method</Table.Th>
              <Table.Th>Result</Table.Th>
              <Table.Th>IP</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {events.map((e) => (
              <Table.Tr key={e.id}>
                <Table.Td>{new Date(e.created_at).toLocaleString()}</Table.Td>
                <Table.Td>
                  {e.login ?? e.username_attempted ?? '—'}
                  {!e.login && e.username_attempted && (
                    <Text size="xs" c="dimmed" component="span">
                      {' '}
                      (attempted)
                    </Text>
                  )}
                </Table.Td>
                <Table.Td>{e.method}</Table.Td>
                <Table.Td>
                  <Badge size="xs" variant="light" color={e.success ? 'green' : 'red'}>
                    {e.success ? 'success' : 'failed'}
                  </Badge>
                </Table.Td>
                <Table.Td>
                  <Text size="sm" c="dimmed">
                    {e.ip ?? '—'}
                  </Text>
                </Table.Td>
              </Table.Tr>
            ))}
            {events.length === 0 && (
              <Table.Tr>
                <Table.Td colSpan={5}>
                  <Text size="sm" c="dimmed" ta="center" py="sm">
                    No sign-ins recorded yet.
                  </Text>
                </Table.Td>
              </Table.Tr>
            )}
          </Table.Tbody>
        </Table>
      </Card>
    </Stack>
  )
}
