import { Button, Group, Modal, Select, Text, Textarea } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useMemo, useState } from 'react'
import type { PersonSummary } from '../api/types'

// Export the directory's currently filtered people as email lists (issue
// #139). Built client-side from the same rows the table shows, so every
// filter — including the free-text search — applies to the export too.
// Rendered for admins only (issue #162): individual addresses stay visible
// to every member in the table, but bulk extraction is an admin tool.

const FORMATS = [
  { value: 'comma', label: 'Single string (comma-separated)' },
  { value: 'listserv', label: 'Fermilab listserv (one "email Name" per line)' },
  { value: 'csv', label: 'CSV (name, email, institution)' },
]

const csvField = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)

function render(people: PersonSummary[], format: string): string {
  const withEmail = people.filter((p) => p.email)
  if (format === 'comma') {
    return withEmail.map((p) => p.email).join(', ')
  }
  if (format === 'listserv') {
    return withEmail
      .map((p) => `${p.email} ${p.preferred_name || p.given_name} ${p.family_name}`)
      .join('\n')
  }
  const rows = withEmail.map((p) =>
    [
      p.family_name,
      p.preferred_name || p.given_name,
      p.email,
      p.primary_institution?.short_name || p.primary_institution?.name || '',
    ]
      .map(csvField)
      .join(','),
  )
  return ['family_name,given_name,email,institution', ...rows].join('\n')
}

export default function ExportEmails({ people }: { people: PersonSummary[] }) {
  const [opened, setOpened] = useState(false)
  const [format, setFormat] = useState('comma')
  const text = useMemo(() => render(people, format), [people, format])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      notifications.show({ message: 'Copied to clipboard' })
    } catch {
      notifications.show({ color: 'red', message: 'Copy failed — select the text manually' })
    }
  }

  const download = () => {
    const blob = new Blob([text], { type: format === 'csv' ? 'text/csv' : 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = format === 'csv' ? 'directory-emails.csv' : 'directory-emails.txt'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <>
      <Button variant="light" size="xs" onClick={() => setOpened(true)}>
        Export emails
      </Button>
      <Modal
        opened={opened}
        onClose={() => setOpened(false)}
        title="Export email addresses"
        size="lg"
      >
        <Text size="sm" c="dimmed" mb="sm">
          Exports the {people.filter((p) => p.email).length} people matching the current
          directory filters.
        </Text>
        <Select data={FORMATS} value={format} onChange={(v) => setFormat(v ?? 'comma')} mb="sm" />
        <Textarea value={text} readOnly autosize minRows={4} maxRows={14} mb="sm" />
        <Group>
          <Button size="xs" onClick={copy}>
            Copy
          </Button>
          <Button size="xs" variant="light" onClick={download}>
            Download
          </Button>
        </Group>
      </Modal>
    </>
  )
}
