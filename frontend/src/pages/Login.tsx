import {
  Anchor,
  Button,
  Card,
  Center,
  Divider,
  PasswordInput,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../api/client'
import { useSession } from '../auth/SessionContext'

interface AuthConfig {
  orcid_enabled: boolean
  contact_email: string
}

// Error codes the backend redirects back with (see /auth/orcid/callback).
const SIGNIN_ERRORS: Record<string, string> = {
  orcid_denied: 'ORCID sign-in was cancelled or denied.',
  orcid_state: 'ORCID sign-in expired — please try again.',
  account_disabled: 'This account is disabled.',
  membership_pending: 'Your membership registration is awaiting approval.',
  membership_rejected: 'Your membership registration was not approved — contact the office.',
}

export default function LoginPage() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [capsLock, setCapsLock] = useState(false)
  const [busy, setBusy] = useState(false)
  const [config, setConfig] = useState<AuthConfig | null>(null)
  const { refresh } = useSession()
  const navigate = useNavigate()
  const [params] = useSearchParams()

  useEffect(() => {
    api.get<AuthConfig>('/auth/config').then(setConfig).catch(() => setConfig(null))
    const error = params.get('error')
    if (error) {
      notifications.show({
        color: 'red',
        message: SIGNIN_ERRORS[error] ?? `Sign-in problem: ${error}`,
      })
    }
  }, [])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      await api.post('/auth/login', { username, password })
      await refresh()
      navigate('/directory')
    } catch (err: any) {
      notifications.show({ color: 'red', message: err.message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Center mih="100vh" p="md">
      <Card withBorder shadow="sm" w={380} p="xl">
        <Stack>
          <div>
            <Title order={3}>
              USMCC Collaboration Database
            </Title>
            <Text c="dimmed" size="sm">
              US Muon Collider Collaboration — muoncollider.us
            </Text>
          </div>

          {config?.orcid_enabled && (
            <>
              <Button
                component="a"
                href="/api/v1/auth/orcid/login"
                variant="filled"
                color="green"
              >
                Sign in with ORCID
              </Button>
              <Divider label="or use a local account" />
            </>
          )}

          <form onSubmit={submit}>
            <Stack gap="sm">
              <TextInput
                label="Username"
                value={username}
                onChange={(e) => setUsername(e.currentTarget.value)}
                required
              />
              <PasswordInput
                label="Password"
                value={password}
                onChange={(e) => setPassword(e.currentTarget.value)}
                onKeyDown={(e) => setCapsLock(e.getModifierState('CapsLock'))}
                onKeyUp={(e) => setCapsLock(e.getModifierState('CapsLock'))}
                error={capsLock ? 'Caps Lock is on' : undefined}
                required
              />
              <Button type="submit" loading={busy}>
                Sign in
              </Button>
            </Stack>
          </form>

          <Text size="sm" c="dimmed">
            Not a member yet? <Anchor href="/register">Register to join.</Anchor>
            {config?.contact_email && (
              <>
                {' '}
                Trouble signing in? Contact{' '}
                <Anchor href={`mailto:${config.contact_email}`}>{config.contact_email}</Anchor>.
              </>
            )}
          </Text>
        </Stack>
      </Card>
    </Center>
  )
}
