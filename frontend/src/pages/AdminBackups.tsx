import { Badge, Button, Card, Group, Stack, Table, Text, Title } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useCallback, useEffect, useState } from 'react'
import { api, backupDownloadUrl } from '../api/client'
import type { BackupStatus } from '../api/types'

const CATEGORY_COLOR: Record<string, string> = {
  daily: 'blue',
  weekly: 'grape',
  monthly: 'teal',
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function formatAge(iso: string): string {
  const hours = (Date.now() - new Date(iso).getTime()) / 3600_000
  if (hours < 1) return `${Math.max(0, Math.round(hours * 60))} min ago`
  if (hours < 48) return `${Math.round(hours)} h ago`
  return `${Math.round(hours / 24)} days ago`
}

export default function AdminBackups() {
  const [status, setStatus] = useState<BackupStatus | null>(null)
  const [failed, setFailed] = useState(false)
  const [running, setRunning] = useState(false)

  const load = useCallback(() => {
    api
      .get<BackupStatus>('/backups')
      .then((s) => {
        setStatus(s)
        setFailed(false)
      })
      .catch(() => setFailed(true))
  }, [])
  useEffect(load, [load])

  const run = async () => {
    setRunning(true)
    try {
      // The backend answers only once the backup container has finished the
      // dump (or after ~2 min if it never does), so this can take a moment.
      const s = await api.post<BackupStatus>('/backups/run')
      setStatus(s)
      notifications.show({ message: 'Backup completed' })
    } catch (err: any) {
      notifications.show({ color: 'red', message: err.message })
    } finally {
      setRunning(false)
    }
  }

  const lastBackupHours = status?.last_backup_at
    ? (Date.now() - new Date(status.last_backup_at).getTime()) / 3600_000
    : null

  return (
    <>
      <Group justify="space-between" mb="md">
        <Title order={3}>Admin — backups</Title>
        <Button onClick={run} loading={running}>
          Run backup now
        </Button>
      </Group>

      <Card withBorder mb="md">
        <Stack gap={4}>
          <Group gap="xs">
            <Text size="sm" fw={500}>
              Last backup:
            </Text>
            <Text size="sm">
              {status?.last_backup_at
                ? `${new Date(status.last_backup_at).toLocaleString()} (${formatAge(status.last_backup_at)})`
                : 'none found'}
            </Text>
            {lastBackupHours !== null && (
              <Badge color={lastBackupHours < 26 ? 'green' : 'red'} variant="light">
                {lastBackupHours < 26 ? 'OK' : 'overdue'}
              </Badge>
            )}
            {status && lastBackupHours === null && (
              <Badge color="red" variant="light">
                no backups
              </Badge>
            )}
          </Group>
          <Text size="sm" c="dimmed">
            Automatic backups (database dump + member photos) run nightly at{' '}
            {status?.backup_hour_utc ?? '02'}:00 UTC with daily/weekly/monthly rotation.
            Download a snapshot now and then for offsite safekeeping — a snapshot is the
            entire database, so store it carefully. Restoring is done on the server with{' '}
            <code>scripts/restore.sh</code>.
          </Text>
        </Stack>
      </Card>

      {failed && (
        <Text c="red" size="sm">
          Could not load the backup list.
        </Text>
      )}

      <Table striped>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Snapshot</Table.Th>
            <Table.Th>Rotation</Table.Th>
            <Table.Th>Size</Table.Th>
            <Table.Th>Taken</Table.Th>
            <Table.Th />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {(status?.snapshots ?? []).map((s) => (
            <Table.Tr key={`${s.category}/${s.filename}`}>
              <Table.Td>
                <Text size="sm" ff="monospace">
                  {s.filename}
                </Text>
              </Table.Td>
              <Table.Td>
                <Badge color={CATEGORY_COLOR[s.category] ?? 'gray'} variant="light">
                  {s.category}
                </Badge>
              </Table.Td>
              <Table.Td>{formatSize(s.size_bytes)}</Table.Td>
              <Table.Td>
                <Text size="sm" c="dimmed">
                  {new Date(s.modified_at).toLocaleString()} ({formatAge(s.modified_at)})
                </Text>
              </Table.Td>
              <Table.Td>
                <Button
                  component="a"
                  href={backupDownloadUrl(s.category, s.filename)}
                  size="compact-xs"
                  variant="light"
                >
                  Download
                </Button>
              </Table.Td>
            </Table.Tr>
          ))}
          {status && status.snapshots.length === 0 && (
            <Table.Tr>
              <Table.Td colSpan={5}>
                <Text size="sm" c="dimmed">
                  No snapshots yet — the first nightly backup hasn't run. Use “Run backup
                  now” to take one.
                </Text>
              </Table.Td>
            </Table.Tr>
          )}
        </Table.Tbody>
      </Table>
    </>
  )
}
