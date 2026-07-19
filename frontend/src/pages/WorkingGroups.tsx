import { Accordion, Badge, Button, Group, Table, Text, Title } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useCallback, useEffect, useState } from 'react'
import { api } from '../api/client'
import type { PersonSummary, WorkingGroup } from '../api/types'
import { useSession } from '../auth/SessionContext'

export default function WorkingGroupsPage() {
  const [wgs, setWgs] = useState<WorkingGroup[]>([])
  const [members, setMembers] = useState<Record<number, PersonSummary[]>>({})
  const { me } = useSession()

  const load = useCallback(() => {
    api.get<WorkingGroup[]>('/working-groups').then(setWgs).catch(() => setWgs([]))
  }, [])
  useEffect(load, [load])

  const loadMembers = async (wgId: number) => {
    const list = await api.get<PersonSummary[]>(`/working-groups/${wgId}/members`)
    setMembers((m) => ({ ...m, [wgId]: list }))
  }

  const join = async (wgId: number) => {
    if (!me?.person_id) {
      notifications.show({
        color: 'yellow',
        message: 'Your login is not linked to a member record yet — contact the office.',
      })
      return
    }
    try {
      await api.post(`/working-groups/${wgId}/members`, { person_id: me.person_id })
      notifications.show({ message: 'Joined!' })
      loadMembers(wgId)
      load()
    } catch (err: any) {
      notifications.show({ color: 'red', message: err.message })
    }
  }

  return (
    <>
      <Title order={3} mb="md">
        Working groups
      </Title>
      <Accordion onChange={(v) => v && loadMembers(Number(v))}>
        {wgs.map((wg) => (
          <Accordion.Item key={wg.id} value={String(wg.id)}>
            <Accordion.Control>
              <Group>
                <Text fw={600}>{wg.name}</Text>
                <Badge variant="light">{wg.member_count} members</Badge>
                {!wg.is_active && <Badge color="gray">inactive</Badge>}
              </Group>
            </Accordion.Control>
            <Accordion.Panel>
              {wg.description && (
                <Text size="sm" c="dimmed" mb="sm">
                  {wg.description}
                </Text>
              )}
              <Button size="xs" variant="light" mb="sm" onClick={() => join(wg.id)}>
                Join this group
              </Button>
              <Table>
                <Table.Tbody>
                  {(members[wg.id] ?? []).map((p) => (
                    <Table.Tr key={p.id}>
                      <Table.Td>
                        {p.given_name} {p.family_name}
                      </Table.Td>
                      <Table.Td>{p.career_stage}</Table.Td>
                      <Table.Td>{p.email}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Accordion.Panel>
          </Accordion.Item>
        ))}
      </Accordion>
    </>
  )
}
