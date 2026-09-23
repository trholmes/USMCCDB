import {
  Badge,
  Button,
  Card,
  Code,
  Group,
  Modal,
  Pagination,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import type { EmailLogEntry, EmailLogPage, EmailTestResult } from '../api/types'

const PAGE_SIZE = 50

const STATUS_COLOR: Record<EmailLogEntry['status'], string> = {
  sent: 'green',
  failed: 'red',
  disabled: 'gray',
}

// Admin tab (issue #166): every notification email the system tried to send,
// with its outcome, plus a test-email button to verify the SMTP setup. The
// catalogue of notification kinds and their audiences is docs/NOTIFICATIONS.md.
export default function AdminEmails() {
  const [page, setPage] = useState(1)
  const [data, setData] = useState<EmailLogPage | null>(null)
  const [kind, setKind] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<EmailLogEntry | null>(null)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<EmailTestResult | null>(null)

  const load = useCallback(() => {
    const params = new URLSearchParams({
      limit: String(PAGE_SIZE),
      offset: String((page - 1) * PAGE_SIZE),
    })
    if (kind) params.set('kind', kind)
    if (status) params.set('status', status)
    if (q.trim()) params.set('q', q.trim())
    api
      .get<EmailLogPage>(`/email-log?${params}`)
      .then(setData)
      .catch((err) => notifications.show({ color: 'red', message: err.message }))
  }, [page, kind, status, q])
  useEffect(load, [load])

  const sendTest = async () => {
    setTesting(true)
    try {
      const r = await api.post<EmailTestResult>('/email-log/test')
      setTestResult(r)
      // The send runs after the response; give it a moment before refreshing.
      setTimeout(load, 1500)
    } catch (err: any) {
      notifications.show({ color: 'red', message: err.message })
    } finally {
      setTesting(false)
    }
  }

  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1

  return (
    <Stack>
      <Group justify="space-between" align="flex-start">
        <div>
          <Title order={3}>Admin — email</Title>
          <Text size="sm" c="dimmed">
            Every notification the database tried to send, newest first. See{' '}
            <Code>docs/NOTIFICATIONS.md</Code> for what triggers each kind and who receives it.
          </Text>
        </div>
        <Button size="xs" variant="light" onClick={sendTest} loading={testing}>
          Send me a test email
        </Button>
      </Group>

      {testResult && (
        <Card withBorder maw={720} bg={testResult.email_enabled ? undefined : 'var(--mantine-color-gray-0)'}>
          <Text size="sm">
            {testResult.detail}
            {testResult.sent_to.length > 0 && <> Recipient: {testResult.sent_to.join(', ')}.</>}
          </Text>
        </Card>
      )}

      <Group gap="xs" align="flex-end">
        <Select
          label="Kind"
          placeholder="All kinds"
          data={data?.kinds ?? []}
          value={kind}
          onChange={(v) => {
            setKind(v)
            setPage(1)
          }}
          clearable
          searchable
          w={{ base: '100%', xs: 260 }}
        />
        <Select
          label="Status"
          placeholder="All"
          data={['sent', 'failed', 'disabled']}
          value={status}
          onChange={(v) => {
            setStatus(v)
            setPage(1)
          }}
          clearable
          w={{ base: '100%', xs: 140 }}
        />
        <TextInput
          label="Search"
          placeholder="Subject or recipient…"
          value={q}
          onChange={(e) => {
            setQ(e.currentTarget.value)
            setPage(1)
          }}
          w={{ base: '100%', xs: 260 }}
        />
        <Text size="sm" c="dimmed" pb={6}>
          {data ? `${data.total} message${data.total === 1 ? '' : 's'}` : ''}
        </Text>
      </Group>

      <Table.ScrollContainer minWidth={800}>
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>When</Table.Th>
              <Table.Th>Kind</Table.Th>
              <Table.Th>Status</Table.Th>
              <Table.Th>Recipients</Table.Th>
              <Table.Th>Subject</Table.Th>
              <Table.Th>About</Table.Th>
              <Table.Th>Triggered by</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {(data?.items ?? []).map((e) => (
              <Table.Tr key={e.id} style={{ cursor: 'pointer' }} onClick={() => setOpen(e)}>
                <Table.Td style={{ whiteSpace: 'nowrap' }}>
                  {new Date(e.created_at).toLocaleString()}
                </Table.Td>
                <Table.Td>
                  <Code>{e.kind}</Code>
                </Table.Td>
                <Table.Td>
                  <Badge size="xs" variant="light" color={STATUS_COLOR[e.status] ?? 'gray'}>
                    {e.status}
                  </Badge>
                </Table.Td>
                <Table.Td>
                  <Text size="sm" lineClamp={1} maw={260} title={e.recipients}>
                    {e.recipients}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Text size="sm" lineClamp={1} maw={320} title={e.subject}>
                    {e.subject}
                  </Text>
                </Table.Td>
                <Table.Td>
                  {e.person_id && e.person_name ? (
                    <Link to={`/people/${e.person_id}`} onClick={(ev) => ev.stopPropagation()}>
                      {e.person_name}
                    </Link>
                  ) : (
                    <Text size="sm" c="dimmed">
                      {e.context ?? '—'}
                    </Text>
                  )}
                </Table.Td>
                <Table.Td>
                  <Text size="sm" c="dimmed">
                    {e.actor_login ?? '—'}
                  </Text>
                </Table.Td>
              </Table.Tr>
            ))}
            {data && data.items.length === 0 && (
              <Table.Tr>
                <Table.Td colSpan={7}>
                  <Text size="sm" c="dimmed">
                    No emails logged{kind || status || q ? ' for these filters' : ' yet'}.
                  </Text>
                </Table.Td>
              </Table.Tr>
            )}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      {pages > 1 && (
        <Group justify="center">
          <Pagination value={page} onChange={setPage} total={pages} size="sm" />
        </Group>
      )}

      <Modal opened={open !== null} onClose={() => setOpen(null)} title={open?.subject} size="lg">
        {open && (
          <Stack gap="xs">
            <Group gap="xs">
              <Badge size="sm" variant="light" color={STATUS_COLOR[open.status] ?? 'gray'}>
                {open.status}
              </Badge>
              <Code>{open.kind}</Code>
              <Text size="sm" c="dimmed">
                {new Date(open.created_at).toLocaleString()}
              </Text>
            </Group>
            <Text size="sm">
              <b>To:</b> {open.recipients}
            </Text>
            {open.context && (
              <Text size="sm">
                <b>Context:</b> {open.context}
              </Text>
            )}
            {open.actor_login && (
              <Text size="sm">
                <b>Triggered by:</b> {open.actor_login}
              </Text>
            )}
            {open.error && (
              <Text size="sm" c="red">
                <b>Error:</b> {open.error}
              </Text>
            )}
            <Code block style={{ whiteSpace: 'pre-wrap' }}>
              {open.body}
            </Code>
          </Stack>
        )}
      </Modal>
    </Stack>
  )
}
