import {
  Alert,
  Badge,
  Button,
  Card,
  FileButton,
  Group,
  Loader,
  Modal,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useCallback, useEffect, useRef, useState } from 'react'
import { api, backupDownloadUrl } from '../api/client'
import type { BackupStatus, RestoreStatus } from '../api/types'

const CATEGORY_COLOR: Record<string, string> = {
  daily: 'blue',
  weekly: 'grape',
  monthly: 'teal',
  'pre-restore': 'orange',
  uploads: 'gray',
}

const CONFIRM_WORD = 'RESTORE'

type RestoreTarget = { kind: 'path'; path: string } | { kind: 'upload'; file: File }

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

  // Restore flow: pick a target (snapshot row or uploaded .dump), type
  // RESTORE to confirm, then poll the backup container's status file while
  // it takes a pre-restore safety dump and runs pg_restore.
  const [target, setTarget] = useState<RestoreTarget | null>(null)
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [confirmText, setConfirmText] = useState('')
  const [restoreBusy, setRestoreBusy] = useState(false)
  const [restoreState, setRestoreState] = useState<RestoreStatus | null>(null)
  const [tracking, setTracking] = useState(false)
  const pollRef = useRef<number | null>(null)

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

  const stopPolling = useCallback(() => {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [])

  const startPolling = useCallback(() => {
    setTracking(true)
    stopPolling()
    pollRef.current = window.setInterval(async () => {
      try {
        const s = await api.get<RestoreStatus>('/backups/restore-status')
        setRestoreState(s)
        if (s.state !== 'queued' && s.state !== 'running') {
          stopPolling()
          if (s.state === 'success') load()
        }
      } catch {
        /* transient — the backend may drop connections mid-restore */
      }
    }, 2500)
  }, [load, stopPolling])
  useEffect(() => stopPolling, [stopPolling])

  // A restore may already be running (another tab, or a page reload mid-way).
  useEffect(() => {
    api
      .get<RestoreStatus>('/backups/restore-status')
      .then((s) => {
        if (s.state === 'queued' || s.state === 'running') {
          setRestoreState(s)
          startPolling()
        }
      })
      .catch(() => undefined)
  }, [startPolling])

  const requestRestore = async () => {
    if (!target) return
    setRestoreBusy(true)
    try {
      const form = new FormData()
      form.append('confirm', confirmText)
      if (target.kind === 'path') form.append('path', target.path)
      else form.append('file', target.file)
      // Multipart upload — bypass the JSON api client.
      const res = await fetch('/api/v1/backups/restore', {
        method: 'POST',
        credentials: 'same-origin',
        body: form,
      })
      if (!res.ok) {
        let detail = res.statusText
        try {
          const d = await res.json()
          if (typeof d.detail === 'string') detail = d.detail
        } catch {
          /* keep statusText */
        }
        throw new Error(detail)
      }
      setRestoreState((await res.json()) as RestoreStatus)
      setTarget(null)
      setConfirmText('')
      setUploadFile(null)
      startPolling()
    } catch (err: any) {
      notifications.show({ color: 'red', message: err.message })
    } finally {
      setRestoreBusy(false)
    }
  }

  const openRestore = (tgt: RestoreTarget) => {
    setConfirmText('')
    setTarget(tgt)
  }

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
            entire database, so store it carefully. Restoring from here always takes a
            fresh pre-restore safety dump first (kept under the{' '}
            <Badge component="span" color="orange" variant="light" size="xs">
              pre-restore
            </Badge>{' '}
            rotation), so a mistaken restore can be undone.
          </Text>
        </Stack>
      </Card>

      {failed && (
        <Text c="red" size="sm">
          Could not load the backup list.
        </Text>
      )}

      {tracking && restoreState && restoreState.state !== 'idle' && (
        <Alert
          mb="md"
          color={
            restoreState.state === 'success'
              ? 'green'
              : restoreState.state === 'failed'
                ? 'red'
                : 'blue'
          }
          icon={
            restoreState.state === 'queued' || restoreState.state === 'running' ? (
              <Loader size={16} />
            ) : undefined
          }
          title={`Restore ${restoreState.state}${restoreState.backup ? ` — ${restoreState.backup}` : ''}`}
          withCloseButton={restoreState.state === 'success' || restoreState.state === 'failed'}
          onClose={() => setTracking(false)}
        >
          <Text size="sm">{restoreState.detail}</Text>
          {restoreState.state === 'success' && (
            <Button size="xs" mt="xs" onClick={() => window.location.reload()}>
              Reload the app
            </Button>
          )}
        </Alert>
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
                <Group gap={4} wrap="nowrap">
                  <Button
                    component="a"
                    href={backupDownloadUrl(s.category, s.filename)}
                    size="compact-xs"
                    variant="light"
                  >
                    Download
                  </Button>
                  {s.filename.endsWith('.dump') && (
                    <Button
                      size="compact-xs"
                      variant="subtle"
                      color="red"
                      onClick={() => openRestore({ kind: 'path', path: `${s.category}/${s.filename}` })}
                    >
                      Restore
                    </Button>
                  )}
                </Group>
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

      <Group mt="md" gap="sm">
        <FileButton accept=".dump" onChange={setUploadFile}>
          {(props) => (
            <Button variant="default" size="xs" {...props}>
              Choose a .dump file…
            </Button>
          )}
        </FileButton>
        {uploadFile && (
          <Text size="sm" ff="monospace">
            {uploadFile.name}
          </Text>
        )}
        <Button
          size="xs"
          color="red"
          variant="light"
          disabled={!uploadFile}
          onClick={() => uploadFile && openRestore({ kind: 'upload', file: uploadFile })}
        >
          Restore from uploaded file
        </Button>
      </Group>

      <Modal opened={target !== null} onClose={() => setTarget(null)} title="Restore database">
        <Stack gap="sm">
          <Alert color="red">
            This overwrites <b>all current data</b> (and member photos, when the backup
            has a photo snapshot) with the contents of the backup.
          </Alert>
          <Text size="sm">
            Restore from{' '}
            <Text component="span" ff="monospace" size="sm">
              {target?.kind === 'path' ? target.path : target?.file.name}
            </Text>
            ?
          </Text>
          <Text size="sm" c="dimmed">
            A fresh pre-restore backup of the current state is taken first, so this can be
            undone by restoring that snapshot.
          </Text>
          <TextInput
            label={`Type ${CONFIRM_WORD} to confirm`}
            placeholder={CONFIRM_WORD}
            value={confirmText}
            onChange={(e) => setConfirmText(e.currentTarget.value)}
            data-autofocus
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setTarget(null)}>
              Cancel
            </Button>
            <Button
              color="red"
              loading={restoreBusy}
              disabled={confirmText.trim().toUpperCase() !== CONFIRM_WORD}
              onClick={requestRestore}
            >
              Restore
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  )
}
