import { Button, Checkbox, Group, Modal, Stack, TextInput } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { fetchRorRecord, parseRorRecord, type RorParsed } from '../api/ror'
import type { Institution } from '../api/types'

const EMPTY_FORM = {
  name: '',
  short_name: '',
  ror_id: '',
  latex_address: '',
  is_us: true,
  latitude: '',
  longitude: '',
}

/** Office-only add/edit form, shared by the Institutions list and the
 * institution detail page. `target` is the institution to edit, 'new' to
 * create one, or null (closed). */
export default function InstitutionEditModal({
  target,
  onClose,
  onSaved,
}: {
  target: Institution | 'new' | null
  onClose: () => void
  onSaved: () => void
}) {
  const [form, setForm] = useState(EMPTY_FORM)

  useEffect(() => {
    if (target === null) return
    setForm(
      target === 'new'
        ? EMPTY_FORM
        : {
            name: target.name,
            short_name: target.short_name ?? '',
            ror_id: target.ror_id ?? '',
            latex_address: target.latex_address ?? '',
            is_us: target.is_us,
            latitude: target.latitude != null ? String(target.latitude) : '',
            longitude: target.longitude != null ? String(target.longitude) : '',
          },
    )
  }, [target])

  // Copy a parsed ROR record into the form: ROR id and coordinates always
  // (that's what the buttons promise), short name and author-list address
  // only into blank fields — never over something the office already wrote.
  const applyRor = (p: RorParsed) => {
    setForm((f) => ({
      ...f,
      ror_id: p.rorId ?? f.ror_id,
      latitude: p.latitude != null ? String(p.latitude) : f.latitude,
      longitude: p.longitude != null ? String(p.longitude) : f.longitude,
      short_name: f.short_name.trim() ? f.short_name : (p.acronym ?? ''),
      latex_address: f.latex_address.trim() ? f.latex_address : (p.address ?? ''),
    }))
    const extras = [
      p.latitude == null && 'no coordinates on the ROR record',
      !p.acronym && 'no acronym for the short name',
    ].filter(Boolean)
    if (extras.length)
      notifications.show({ color: 'yellow', message: `Filled from ROR, but ${extras.join('; ')}` })
  }

  // Pull details from the public ROR record (issue #112) — fetched by the
  // browser, so an air-gapped backend still works; entering them by hand does too.
  const fetchByRorId = async () => {
    const m = form.ror_id.trim().toLowerCase().match(/(0[a-z0-9]{8})$/)
    if (!m) {
      notifications.show({ color: 'red', message: 'Enter a ROR id first' })
      return
    }
    try {
      applyRor(await fetchRorRecord(m[1]))
    } catch (err: any) {
      notifications.show({ color: 'red', message: err.message })
    }
  }

  // Search ROR by institution name and, after the user confirms the best
  // match, fill in the ROR id, coordinates, and blank fields from it.
  const lookupByName = async () => {
    const name = form.name.trim()
    if (!name) {
      notifications.show({ color: 'red', message: 'Enter the institution name first' })
      return
    }
    try {
      const resp = await fetch(
        `https://api.ror.org/v2/organizations?query=${encodeURIComponent(name)}`,
      )
      if (!resp.ok) throw new Error(`ROR search failed (${resp.status})`)
      const rec = (await resp.json()).items?.[0]
      if (!rec) throw new Error(`No ROR match for “${name}”`)
      const p = parseRorRecord(rec)
      if (
        !window.confirm(
          `Best ROR match for “${name}”:\n\n${p.name}${p.location ? ` (${p.location})` : ''}\nhttps://ror.org/${p.rorId}\n\nUse it?`,
        )
      )
        return
      applyRor(p)
    } catch (err: any) {
      notifications.show({ color: 'red', message: err.message })
    }
  }

  const save = async (allowSimilar = false) => {
    const body = {
      name: form.name,
      short_name: form.short_name || null,
      ror_id: form.ror_id || null,
      latex_address: form.latex_address || null,
      is_us: form.is_us,
      latitude: form.latitude.trim() === '' ? null : Number(form.latitude),
      longitude: form.longitude.trim() === '' ? null : Number(form.longitude),
    }
    if (Number.isNaN(body.latitude) || Number.isNaN(body.longitude)) {
      notifications.show({ color: 'red', message: 'Coordinates must be decimal numbers' })
      return
    }
    try {
      if (target === 'new') await api.post('/institutions', { ...body, allow_similar: allowSimilar })
      else if (target) await api.patch(`/institutions/${target.id}`, body)
      onClose()
      onSaved()
    } catch (err: any) {
      // The backend flags likely duplicates (normalized-name match) with a
      // 409; the office can confirm it really is a distinct institution.
      if (
        target === 'new' &&
        err.status === 409 &&
        String(err.message).includes('Similar institution') &&
        window.confirm(`${err.message.split(' — ')[0]}.\n\nCreate it anyway?`)
      ) {
        return save(true)
      }
      notifications.show({ color: 'red', message: err.message })
    }
  }

  return (
    <Modal
      opened={target !== null}
      onClose={onClose}
      title={target === 'new' ? 'Add institution' : 'Edit institution'}
    >
      <Stack gap="sm">
        <TextInput
          label="Full name"
          required
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.currentTarget.value })}
        />
        <TextInput
          label="Short name"
          value={form.short_name}
          onChange={(e) => setForm({ ...form, short_name: e.currentTarget.value })}
        />
        <Group align="flex-end" gap="xs">
          <TextInput
            label="ROR id"
            description="Stable identifier from ror.org, e.g. 05gvnxz63 — used to detect duplicates."
            placeholder="05gvnxz63"
            value={form.ror_id}
            onChange={(e) => setForm({ ...form, ror_id: e.currentTarget.value })}
            style={{ flex: 1 }}
          />
          <Button variant="light" onClick={lookupByName} disabled={!form.name.trim()}>
            Look up by name
          </Button>
        </Group>
        <TextInput
          label="Author-list address (as printed on papers)"
          value={form.latex_address}
          onChange={(e) => setForm({ ...form, latex_address: e.currentTarget.value })}
        />
        <Group grow align="flex-end">
          <TextInput
            label="Latitude"
            description="For the institutions map."
            placeholder="41.789"
            value={form.latitude}
            onChange={(e) => setForm({ ...form, latitude: e.currentTarget.value })}
          />
          <TextInput
            label="Longitude"
            placeholder="-87.599"
            value={form.longitude}
            onChange={(e) => setForm({ ...form, longitude: e.currentTarget.value })}
          />
          <Button variant="light" onClick={fetchByRorId} disabled={!form.ror_id.trim()}>
            Fetch from ROR
          </Button>
        </Group>
        <Checkbox
          label="US institution"
          description="Only people currently at a US institution are eligible to vote; unchecking this clears the voting flag of everyone currently here."
          checked={form.is_us}
          onChange={(e) => setForm({ ...form, is_us: e.currentTarget.checked })}
        />
        <Button onClick={() => save()}>Save</Button>
      </Stack>
    </Modal>
  )
}
