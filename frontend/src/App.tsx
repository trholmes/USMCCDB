import { AppShell, Burger, Group, Loader, NavLink, Text, Title } from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { useSession } from './auth/SessionContext'
import AdminPage from './pages/Admin'
import ApplyPage from './pages/Apply'
import DirectoryPage from './pages/Directory'
import EventsPage from './pages/Events'
import InstitutionDetailPage from './pages/InstitutionDetail'
import InstitutionsPage from './pages/Institutions'
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
  { to: '/events', label: 'Conferences' },
  { to: '/talks', label: 'Talks & speakers' },
  { to: '/publications', label: 'Publications' },
  { to: '/stats', label: 'Statistics' },
]

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

  // Unauthenticated users only see login + apply.
  if (!me) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/apply" element={<ApplyPage />} />
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
            <Title order={4}>US Muon Collider Collaboration</Title>
            <Text c="dimmed" size="sm" visibleFrom="md">
              Collaboration Database
            </Text>
          </Group>
          <Group gap="xs">
            {me.person_id ? (
              <Text
                component={Link}
                to={`/people/${me.person_id}`}
                size="sm"
                c="indigo"
                style={{ cursor: 'pointer' }}
                title="View / edit your profile"
              >
                {me.display_name || me.user.username || me.user.orcid}
              </Text>
            ) : (
              <Text size="sm" c="dimmed">
                {me.display_name || me.user.username || me.user.orcid}
              </Text>
            )}
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
          <Route path="/apply" element={<ApplyPage />} />
          <Route path="/directory" element={<DirectoryPage />} />
          <Route path="/people/:id" element={<PersonPage />} />
          <Route path="/institutions" element={<InstitutionsPage />} />
          <Route path="/institutions/:id" element={<InstitutionDetailPage />} />
          <Route path="/working-groups" element={<WorkingGroupsPage />} />
          <Route path="/events" element={<EventsPage />} />
          <Route path="/talks" element={<TalksPage />} />
          <Route path="/publications" element={<PublicationsPage />} />
          <Route path="/publications/:id" element={<PublicationDetailPage />} />
          <Route path="/stats" element={<StatsPage />} />
          {isAdmin && <Route path="/admin" element={<AdminPage />} />}
          <Route path="*" element={<Navigate to="/directory" replace />} />
        </Routes>
      </AppShell.Main>
    </AppShell>
  )
}
