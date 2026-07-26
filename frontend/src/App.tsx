import {
  ActionIcon,
  AppShell,
  Badge,
  Burger,
  Group,
  Loader,
  NavLink,
  Text,
  Title,
  useComputedColorScheme,
  useMantineColorScheme,
} from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { useSession } from './auth/SessionContext'
import AccountPage from './pages/Account'
import AdminPage from './pages/Admin'
import RegisterPage from './pages/Register'
import DirectoryPage from './pages/Directory'
import EventsPage from './pages/Events'
import InstitutionDetailPage from './pages/InstitutionDetail'
import InstitutionsPage from './pages/Institutions'
import LeadershipPage from './pages/Leadership'
import LoginPage from './pages/Login'
import PersonPage from './pages/Person'
import PublicationsPage from './pages/Publications'
import PublicationDetailPage from './pages/PublicationDetail'
import StatsPage from './pages/Stats'
import TalksPage from './pages/Talks'
import WorkingGroupsPage from './pages/WorkingGroups'

const NAV = [
  { to: '/directory', label: 'Directory' },
  { to: '/institutions', label: 'Institutions' },
  { to: '/working-groups', label: 'Working groups' },
  { to: '/leadership', label: 'Leadership' },
  { to: '/events', label: 'Conferences' },
  { to: '/talks', label: 'Talks & speakers' },
  { to: '/publications', label: 'Publications' },
  { to: '/stats', label: 'Statistics' },
]

function ColorSchemeToggle() {
  const { setColorScheme } = useMantineColorScheme()
  const computed = useComputedColorScheme('light')
  return (
    <ActionIcon
      variant="subtle"
      color="gray"
      aria-label={computed === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      title={computed === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      onClick={() => setColorScheme(computed === 'dark' ? 'light' : 'dark')}
    >
      {computed === 'dark' ? '☀' : '☾'}
    </ActionIcon>
  )
}

export default function App() {
  const { me, loading, logout, isAdmin } = useSession()
  const [opened, { toggle, close }] = useDisclosure()
  const navigate = useNavigate()
  const location = useLocation()

  if (loading) {
    return (
      <Group justify="center" mt="30vh">
        <Loader />
      </Group>
    )
  }

  // Unauthenticated users only see login + registration.
  if (!me) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    )
  }

  return (
    <AppShell
      header={{ height: 56 }}
      navbar={{ width: 220, breakpoint: 'sm', collapsed: { mobile: !opened } }}
      padding="md"
    >
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Group>
            <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" />
            <Link
              to="/"
              style={{
                color: 'inherit',
                textDecoration: 'none',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
              }}
            >
              <img src="/usmcc-mark.png" alt="" height={32} width={32} />
              <Title order={4}>US Muon Collider Collaboration</Title>
            </Link>
            <Badge variant="light" color="orange" size="sm">
              alpha
            </Badge>
            <Text c="dimmed" size="sm" visibleFrom="md">
              Collaboration Database
            </Text>
          </Group>
          <Group gap="xs">
            <ColorSchemeToggle />
            <ActionIcon
              component={Link}
              to="/account"
              variant="subtle"
              color="gray"
              aria-label="Account settings"
              title="Account settings"
            >
              ⚙
            </ActionIcon>
            <Text
              component={Link}
              to={me.person_id ? `/people/${me.person_id}` : '/account'}
              size="sm"
              c="indigo"
              style={{ cursor: 'pointer' }}
              title={me.person_id ? 'View / edit your profile' : 'Account settings'}
            >
              {me.display_name || me.user.username || me.user.orcid}
              {me.display_name && me.user.username ? ` (${me.user.username})` : ''}
            </Text>
            <Text
              size="sm"
              c="indigo"
              style={{ cursor: 'pointer' }}
              onClick={async () => {
                await logout()
                navigate('/login')
              }}
            >
              Sign out
            </Text>
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="xs">
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            label={item.label}
            active={location.pathname.startsWith(item.to)}
            onClick={() => {
              navigate(item.to)
              close()
            }}
          />
        ))}
        {isAdmin && (
          <NavLink
            label="Admin"
            active={location.pathname.startsWith('/admin')}
            onClick={() => {
              navigate('/admin')
              close()
            }}
          />
        )}
      </AppShell.Navbar>

      <AppShell.Main>
        <Routes>
          <Route path="/" element={<Navigate to="/directory" replace />} />
          <Route path="/login" element={<Navigate to="/directory" replace />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/directory" element={<DirectoryPage />} />
          <Route path="/people/:id" element={<PersonPage />} />
          <Route path="/institutions" element={<InstitutionsPage />} />
          <Route path="/institutions/:id" element={<InstitutionDetailPage />} />
          <Route path="/working-groups" element={<WorkingGroupsPage />} />
          <Route path="/leadership" element={<LeadershipPage />} />
          <Route path="/events" element={<EventsPage />} />
          <Route path="/talks" element={<TalksPage />} />
          <Route path="/publications" element={<PublicationsPage />} />
          <Route path="/publications/:id" element={<PublicationDetailPage />} />
          <Route path="/stats" element={<StatsPage />} />
          <Route path="/account" element={<AccountPage />} />
          {isAdmin && <Route path="/admin" element={<AdminPage />} />}
          <Route path="*" element={<Navigate to="/directory" replace />} />
        </Routes>
      </AppShell.Main>
    </AppShell>
  )
}
