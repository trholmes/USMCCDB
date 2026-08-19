import { Button, Card, Group, Select, Stack, Text, Textarea, Title } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useEffect, useState } from 'react'
import { api } from '../api/client'
import type { SiteSettings } from '../api/types'

// Admin tab: runtime site settings (announcement banner + login-page
// message), stored server-side so they apply without a redeploy.
export default function AdminSite() {
  const [form, setForm] = useState({
    banner_message: '',
    banner_level: 'info',
    login_message: '',
  })
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    api
      .get<SiteSettings>('/site/settings')
      .then((s) =>
        setForm({
          banner_message: s.banner_message ?? '',
          banner_level: s.banner_level,
          login_message: s.login_message ?? '',
        }),
      )
      .catch(() => undefined)
      .finally(() => setLoaded(true))
  }, [])

  const save = async () => {
    try {
      await api.patch('/site/settings', form)
      notifications.show({ message: 'Site settings saved' })
    } catch (err: any) {
      notifications.show({ color: 'red', message: err.message })
    }
  }

  return (
    <Stack maw={640}>
      <Title order={3}>Admin — site settings</Title>
      <Card withBorder>
        <Stack gap="sm">
          <Title order={6}>Announcement banner</Title>
          <Text size="sm" c="dimmed">
            Shown to everyone — on the login page and above every page while
            signed in. Clear the text to take the banner down.
          </Text>
          <Textarea
            label="Banner message"
            autosize
            minRows={2}
            maxLength={2000}
            value={form.banner_message}
            onChange={(e) => setForm({ ...form, banner_message: e.currentTarget.value })}
          />
          <Select
            label="Banner level"
            data={[
              { value: 'info', label: 'Info (blue)' },
              { value: 'warning', label: 'Warning (yellow)' },
              { value: 'critical', label: 'Critical (red)' },
            ]}
            value={form.banner_level}
            onChange={(v) => setForm({ ...form, banner_level: v ?? 'info' })}
            allowDeselect={false}
            w={220}
          />
        </Stack>
      </Card>
      <Card withBorder>
        <Stack gap="sm">
          <Title order={6}>Login page message</Title>
          <Text size="sm" c="dimmed">
            Extra text on the sign-in card — e.g. who to contact for an
            account, or a link to collaboration onboarding.
          </Text>
          <Textarea
            label="Message"
            autosize
            minRows={2}
            maxLength={4000}
            value={form.login_message}
            onChange={(e) => setForm({ ...form, login_message: e.currentTarget.value })}
          />
        </Stack>
      </Card>
      <Group>
        <Button onClick={save} disabled={!loaded}>
          Save
        </Button>
      </Group>
    </Stack>
  )
}
