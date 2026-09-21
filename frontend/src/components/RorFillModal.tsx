import {
  Badge,
  Button,
  Card,
  Group,
  Modal,
  Progress,
  Stack,
  Text,
} from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useEffect, useRef, useState } from 'react'
import { api } from '../api/client'
import { fetchRorRecord, matchRorAffiliation, type RorParsed } from '../api/ror'
import type { Institution } from '../api/types'

/** An institution the automatic pass could not settle, with whatever ROR
 * offered so the admin can pick (or bail out to manual editing). */
interface Unresolved {
  inst: Institution
  message: string
  candidates: RorParsed[]
}

const needsFill = (i: Institution) =>
  !i.short_name || !i.latex_address || i.latitude == null || i.longitude == null

/** Bulk "fill missing details from ROR" for the office: unambiguous matches
 * are applied automatically (blank fields only), everything else lands in a
 * review list where the admin picks among ROR's candidates or edits by hand.
 * All lookups run in the browser, like the edit form's ROR buttons. */
export default function RorFillModal({
  opened,
  onClose,
  institutions,
  onChanged,
  onEdit,
}: {
  opened: boolean
  onClose: () => void
  institutions: Institution[]
  onChanged: () => void
  onEdit: (inst: Institution) => void
}) {
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [filledCount, setFilledCount] = useState(0)
  const [unresolved, setUnresolved] = useState<Unresolved[]>([])
  // Uniqueness bookkeeping across the run: short_name and ror_id are unique
  // columns, so never PATCH a value another row already holds.
  const takenShortNames = useRef(new Set<string>())
  const takenRorIds = useRef(new Map<string, number>())
  const cancelled = useRef(false)

  // What a candidate would fill for this institution: blank fields only.
  const buildPatch = (inst: Institution, p: RorParsed) => {
    const patch: Record<string, unknown> = {}
    const skipped: string[] = []
    if (!inst.ror_id && p.rorId) {
      const holder = takenRorIds.current.get(p.rorId)
      if (holder !== undefined && holder !== inst.id) {
        skipped.push('ROR id already belongs to another institution (possible duplicate row)')
      } else {
        patch.ror_id = p.rorId
      }
    }
    if (!inst.short_name && p.acronym) {
      if (takenShortNames.current.has(p.acronym.toLowerCase())) {
        skipped.push(`acronym '${p.acronym}' is already another institution's short name`)
      } else {
        patch.short_name = p.acronym
      }
    }
    if (!inst.latex_address && p.address) patch.latex_address = p.address
    if ((inst.latitude == null || inst.longitude == null) && p.latitude != null && p.longitude != null) {
      patch.latitude = p.latitude
      patch.longitude = p.longitude
    }
    return { patch, skipped }
  }

  const applyPatch = async (inst: Institution, p: RorParsed) => {
    const { patch, skipped } = buildPatch(inst, p)
    if (Object.keys(patch).length === 0) {
      return { ok: false, message: skipped.join('; ') || 'nothing left to fill from this record' }
    }
    await api.patch(`/institutions/${inst.id}`, patch)
    if (typeof patch.short_name === 'string')
      takenShortNames.current.add(patch.short_name.toLowerCase())
    if (typeof patch.ror_id === 'string') takenRorIds.current.set(patch.ror_id, inst.id)
    return { ok: true, message: skipped.join('; ') }
  }

  // Kick off the scan each time the modal opens.
  useEffect(() => {
    if (!opened) {
      cancelled.current = true
      return
    }
    cancelled.current = false
    takenShortNames.current = new Set(
      institutions.filter((i) => i.short_name).map((i) => i.short_name!.toLowerCase()),
    )
    takenRorIds.current = new Map(
      institutions.filter((i) => i.ror_id).map((i) => [i.ror_id!, i.id]),
    )
    const targets = institutions.filter(needsFill)
    setProgress({ done: 0, total: targets.length })
    setFilledCount(0)
    setUnresolved([])
    setRunning(true)

    ;(async () => {
      let filled = 0
      const problems: Unresolved[] = []
      for (const inst of targets) {
        if (cancelled.current) return
        try {
          let parsed: RorParsed | null = null
          let candidates: RorParsed[] = []
          if (inst.ror_id) {
            parsed = await fetchRorRecord(inst.ror_id)
          } else {
            const res = await matchRorAffiliation(inst.latex_address || inst.name)
            parsed = res.chosen
            candidates = res.candidates
          }
          if (parsed === null) {
            problems.push({
              inst,
              message: candidates.length
                ? 'No unambiguous ROR match — pick the right one:'
                : 'No ROR match at all — edit manually.',
              candidates,
            })
          } else {
            const result = await applyPatch(inst, parsed)
            if (result.ok) {
              filled += 1
              if (result.message)
                problems.push({ inst, message: `Partly filled; ${result.message}`, candidates: [] })
            } else {
              problems.push({ inst, message: result.message, candidates: [] })
            }
          }
        } catch (err: any) {
          problems.push({
            inst,
            message: err?.message ?? 'lookup failed',
            candidates: [],
          })
        }
        if (cancelled.current) return
        setProgress((pr) => ({ ...pr, done: pr.done + 1 }))
        setFilledCount(filled)
        setUnresolved([...problems])
      }
      if (!cancelled.current) {
        setRunning(false)
        if (filled > 0) onChanged()
      }
    })()
    // Rescanning on every institutions-refresh would loop (applying a patch
    // triggers onChanged); the scan runs once per open on the list as it was.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened])

  const useCandidate = async (u: Unresolved, cand: RorParsed) => {
    try {
      const result = await applyPatch(u.inst, cand)
      if (!result.ok) {
        notifications.show({ color: 'yellow', message: `${u.inst.name}: ${result.message}` })
        return
      }
      notifications.show({ color: 'green', message: `${u.inst.name}: filled from ${cand.name}` })
      setUnresolved((list) => list.filter((x) => x !== u))
      onChanged()
    } catch (err: any) {
      notifications.show({ color: 'red', message: `${u.inst.name}: ${err.message}` })
    }
  }

  const wouldFill = (u: Unresolved, cand: RorParsed) => {
    const { patch } = buildPatch(u.inst, cand)
    const bits: string[] = []
    if (patch.short_name) bits.push(`short name '${patch.short_name}'`)
    if (patch.latex_address) bits.push(`address '${patch.latex_address}'`)
    if (patch.latitude != null) bits.push('coordinates')
    if (patch.ror_id) bits.push(`ROR id ${patch.ror_id}`)
    return bits.length ? `fills ${bits.join(', ')}` : 'nothing left to fill'
  }

  const total = progress.total
  return (
    <Modal opened={opened} onClose={onClose} title="Fill missing details from ROR" size="lg">
      <Stack gap="sm">
        <Text size="sm" c="dimmed">
          Looks up every institution missing a short name, author-list address, or map
          coordinates on ror.org and fills the blanks (never overwriting existing values).
          Unambiguous matches are applied directly; the rest are listed below for review.
        </Text>
        {total === 0 && !running && (
          <Text size="sm">Nothing to do — every institution already has all three.</Text>
        )}
        {total > 0 && (
          <>
            <Progress value={total ? (progress.done / total) * 100 : 0} animated={running} />
            <Text size="sm">
              {progress.done}/{total} checked — {filledCount} filled automatically,{' '}
              {unresolved.length} to review
            </Text>
          </>
        )}
        {unresolved.map((u) => (
          <Card key={u.inst.id} withBorder padding="sm">
            <Group justify="space-between" wrap="nowrap">
              <div>
                <Text fw={500}>{u.inst.name}</Text>
                <Text size="sm" c="dimmed">
                  {u.message}
                </Text>
              </div>
              <Button size="compact-xs" variant="default" onClick={() => onEdit(u.inst)}>
                Edit manually
              </Button>
            </Group>
            {u.candidates.length > 0 && (
              <Stack gap={6} mt="xs">
                {u.candidates.map((cand) => (
                  <Group key={cand.rorId ?? cand.name} wrap="nowrap" justify="space-between">
                    <div style={{ minWidth: 0 }}>
                      <Group gap="xs" wrap="nowrap">
                        <Text size="sm" truncate>
                          {cand.name}
                          {cand.location ? ` — ${cand.location}` : ''}
                        </Text>
                        {cand.score != null && (
                          <Badge variant="light" color={cand.score >= 0.9 ? 'green' : 'gray'}>
                            {Math.round(cand.score * 100)}%
                          </Badge>
                        )}
                      </Group>
                      <Text size="xs" c="dimmed" truncate>
                        {wouldFill(u, cand)}
                      </Text>
                    </div>
                    <Button size="compact-xs" onClick={() => useCandidate(u, cand)}>
                      Use
                    </Button>
                  </Group>
                ))}
              </Stack>
            )}
          </Card>
        ))}
        {!running && (
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>
              Done
            </Button>
          </Group>
        )}
      </Stack>
    </Modal>
  )
}
