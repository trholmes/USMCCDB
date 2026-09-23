import { Anchor, Badge, Button, Card, Group, Stack, Text, Title } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import { useAlerts } from '../auth/AlertsContext'
import { useSession } from '../auth/SessionContext'
import type { InstitutionAlert, PersonAlert, RoleSuggestionAlert } from '../api/types'

function Section({
  title,
  count,
  description,
  children,
}: {
  title: string
  count: number
  description: string
  children?: React.ReactNode
}) {
  if (count === 0) return null
  return (
    <Card withBorder>
      <Group gap="xs" mb={4}>
        <Title order={5}>{title}</Title>
        <Badge color="red" size="sm">
          {count}
        </Badge>
      </Group>
      <Text size="sm" c="dimmed" mb="xs">
        {description}
      </Text>
      <Stack gap={4}>{children}</Stack>
    </Card>
  )
}

function PersonRow({ item }: { item: PersonAlert }) {
  return (
    <Group gap="xs" wrap="nowrap">
      <Anchor component={Link} to={`/people/${item.person_id}`} size="sm">
        {item.name}
      </Anchor>
      {item.email && (
        <Text size="sm" c="dimmed" style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {item.email}
        </Text>
      )}
      {item.detail && (
        <Text size="sm" c="dimmed">
          — {item.detail}
        </Text>
      )}
    </Group>
  )
}

function InstitutionRow({ item }: { item: InstitutionAlert }) {
  return (
    <Group gap="xs">
      <Anchor component={Link} to={`/institutions/${item.institution_id}`} size="sm">
        {item.name}
      </Anchor>
      <Text size="sm" c="dimmed">
        — {item.current_members} current {item.current_members === 1 ? 'member' : 'members'}
      </Text>
    </Group>
  )
}

function RoleSuggestionRow({
  item,
  onApplied,
}: {
  item: RoleSuggestionAlert
  onApplied: () => void
}) {
  const { me } = useSession()
  const [busy, setBusy] = useState(false)
  const demotion = item.suggested_role === 'member'
  const run = async (action: () => Promise<unknown>, message: string) => {
    setBusy(true)
    try {
      await action()
      notifications.show({ message })
      onApplied()
    } catch (err: any) {
      notifications.show({ color: 'red', message: err.message })
    } finally {
      setBusy(false)
    }
  }
  const apply = () =>
    run(
      () => api.patch(`/auth/users/${item.user_id}`, { role: item.suggested_role }),
      `${item.name} is now ${item.suggested_role}`,
    )
  // Rejecting keeps the role and silences this suggestion until the person's
  // positions change.
  const dismiss = () =>
    run(
      () =>
        api.post('/alerts/role-suggestions/dismiss', {
          user_id: item.user_id,
          suggested_role: item.suggested_role,
          detail: item.detail,
        }),
      `Suggestion for ${item.name} dismissed`,
    )
  return (
    <Group gap="xs" wrap="nowrap" justify="space-between">
      <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
        <Anchor component={Link} to={`/people/${item.person_id}`} size="sm">
          {item.name}
        </Anchor>
        <Text size="sm" c="dimmed" style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
          ({item.login}) — {item.detail}
        </Text>
      </Group>
      <Group gap="xs" wrap="nowrap">
        <Badge variant="light" color="gray" size="sm">
          {item.current_role}
        </Badge>
        <Text size="sm" c="dimmed">
          →
        </Text>
        <Badge variant="light" color={demotion ? 'gray' : 'indigo'} size="sm">
          {item.suggested_role}
        </Badge>
        <Button
          size="compact-xs"
          variant={demotion ? 'default' : 'light'}
          loading={busy}
          disabled={item.user_id === me?.user.id}
          onClick={apply}
        >
          Apply
        </Button>
        <Button size="compact-xs" variant="subtle" color="gray" disabled={busy} onClick={dismiss}>
          Dismiss
        </Button>
      </Group>
    </Group>
  )
}

export default function AlertsPage() {
  const { alerts, refresh } = useAlerts()

  // The badge count may be minutes old — entering the panel re-checks.
  useEffect(() => {
    refresh()
  }, [refresh])

  if (!alerts) return null

  return (
    <Stack maw={900}>
      <div>
        <Title order={3}>Alerts</Title>
        <Text size="sm" c="dimmed">
          Things that need an administrator. Each alert clears itself as soon as the
          underlying issue is fixed.
        </Text>
      </div>

      {alerts.total === 0 && (
        <Card withBorder>
          <Text>Nothing needs attention right now. 🎉</Text>
        </Card>
      )}

      <Section
        title="Pending membership registrations"
        count={alerts.pending_registrations.length}
        description="Registrations waiting for approval — the person has no database access until someone decides. Approve or reject from their profile page."
      >
        {alerts.pending_registrations.map((p) => (
          <PersonRow key={p.person_id} item={p} />
        ))}
      </Section>

      <Section
        title="New institutions to review"
        count={alerts.unreviewed_institutions.length}
        description="Institutions created from free-text registrations, waiting for review. Check for duplicates, fill in the details (ROR, address), and activate them from the institution page."
      >
        {alerts.unreviewed_institutions.map((i) => (
          <InstitutionRow key={i.institution_id} item={i} />
        ))}
      </Section>

      <Section
        title="Institutions without an administrative contact"
        count={alerts.institutions_missing_admin_contact.length}
        description="Institutions with current members but no active Administrative Institutional Contact. Assign one from the institution page — they keep member info current and can approve registrations from their institution."
      >
        {alerts.institutions_missing_admin_contact.map((i) => (
          <InstitutionRow key={i.institution_id} item={i} />
        ))}
      </Section>

      <Section
        title="Sign-ins not linked to a person"
        count={alerts.unlinked_accounts.length}
        description="Member accounts (usually ORCID sign-ins) with no directory record attached. Link them to the right person under Admin → User accounts."
      >
        {alerts.unlinked_accounts.map((u) => (
          <Group key={u.user_id} gap="xs">
            <Anchor component={Link} to="/admin" size="sm">
              {u.login}
            </Anchor>
          </Group>
        ))}
      </Section>

      <Section
        title="Account roles to review"
        count={alerts.role_suggestions.length}
        description="Leadership positions come with database permissions — chair and vice chair as admin, representatives and deputies as leadership, the speakers committee as speakers_committee — but positions never change an account by themselves. These sign-ins hold a role that doesn't match the person's current positions (including admins whose term as chair has ended). Apply the suggestion, or dismiss it to keep the role — it comes back only if the person's positions change."
      >
        {alerts.role_suggestions.map((s) => (
          <RoleSuggestionRow key={s.user_id} item={s} onApplied={refresh} />
        ))}
      </Section>

      <Section
        title="Active members without a current affiliation"
        count={alerts.active_without_affiliation.length}
        description="Active members with no open primary affiliation — they are invisible to author lists and voting eligibility. Add their current institution on their profile page."
      >
        {alerts.active_without_affiliation.map((p) => (
          <PersonRow key={p.person_id} item={p} />
        ))}
      </Section>

      <Section
        title="Voting members no longer eligible"
        count={alerts.ineligible_voting_members.length}
        description="The voting flag requires an active, non-student member currently at a US institution. These flags have drifted (e.g. after an import or an institution edit) — review and correct on the profile page."
      >
        {alerts.ineligible_voting_members.map((p) => (
          <PersonRow key={p.person_id} item={p} />
        ))}
      </Section>

      <Section
        title="Open-ended authorship for non-active members"
        count={alerts.open_author_periods_not_active.length}
        description="People who are not active members but have an author period with no end date — they stay on every future author list. Set an end date on their profile page if that isn't intended."
      >
        {alerts.open_author_periods_not_active.map((p) => (
          <PersonRow key={p.person_id} item={p} />
        ))}
      </Section>

      <Section
        title="Database migrations pending"
        count={alerts.migrations_pending ? 1 : 0}
        description="The database schema is behind the code's migrations — run the upgrade. Details under Admin → System."
      >
        <Anchor component={Link} to="/admin" size="sm">
          Admin → System
        </Anchor>
      </Section>
    </Stack>
  )
}
