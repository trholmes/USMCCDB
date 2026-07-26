import {
  Badge,
  Button,
  Card,
  Group,
  PasswordInput,
  Stack,
  Text,
  Title,
} from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import { useSession } from '../auth/SessionContext'

export default function AccountPage() {
  const { me } = useSession()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)

  if (!me) return null
  const isLocal = Boolean(me.user.username)

  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault()
    if (next !== confirm) {
      notifications.show({ color: 'red', message: 'New passwords do not match.' })
      return
    }
    setBusy(true)
    try {
      await api.post('/auth/me/password', { current_password: current, new_password: next })
      notifications.show({ message: 'Password changed.' })
      setCurrent('')
      setNext('')
      setConfirm('')
    } catch (err: any) {
      notifications.show({ color: 'red', message: err.message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Stack maw={560}>
      <Title order={3}>Account settings</Title>

      <Card withBorder>
        <Title order={6} mb="xs">
          Account
        </Title>
        <Stack gap={6}>
          {me.user.username && (
            <Group gap="xs">
              <Text size="sm" c="dimmed" w={110}>
                Username
              </Text>
              <Text size="sm">{me.user.username}</Text>
            </Group>
          )}
          <Group gap="xs">
            <Text size="sm" c="dimmed" w={110}>
              ORCID iD
            </Text>
            {me.user.orcid ? (
              <Text size="sm">{me.user.orcid}</Text>
            ) : (
              <Text size="sm" c="dimmed">
                not linked
                {me.orcid_enabled &&
                  ' — sign in with ORCID (after your profile ORCID is on record) to link it'}
              </Text>
            )}
          </Group>
          <Group gap="xs">
            <Text size="sm" c="dimmed" w={110}>
              Role
            </Text>
            <Badge variant="light">{me.user.role}</Badge>
          </Group>
          <Group gap="xs">
            <Text size="sm" c="dimmed" w={110}>
              Member profile
            </Text>
            {me.person_id ? (
              <Text size="sm" component={Link} to={`/people/${me.person_id}`} c="indigo">
                {me.display_name || 'View profile'}
              </Text>
            ) : (
              <Text size="sm" c="dimmed">
                not linked — contact the office to link this account to your directory record
              </Text>
            )}
          </Group>
        </Stack>
      </Card>

      {isLocal ? (
        <Card withBorder>
          <Title order={6} mb="xs">
            Change password
          </Title>
          <form onSubmit={changePassword}>
            <Stack gap="sm">
              <PasswordInput
                label="Current password"
                required
                value={current}
                onChange={(e) => setCurrent(e.currentTarget.value)}
              />
              <PasswordInput
                label="New password (min 8 characters)"
                required
                minLength={8}
                value={next}
                onChange={(e) => setNext(e.currentTarget.value)}
              />
              <PasswordInput
                label="Repeat new password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.currentTarget.value)}
                error={confirm && next !== confirm ? 'Passwords do not match' : undefined}
              />
              <Button type="submit" loading={busy} w="fit-content">
                Change password
              </Button>
            </Stack>
          </form>
        </Card>
      ) : (
        <Card withBorder>
          <Text size="sm" c="dimmed">
            This account signs in with ORCID and has no local password.
          </Text>
        </Card>
      )}
    </Stack>
  )
}
