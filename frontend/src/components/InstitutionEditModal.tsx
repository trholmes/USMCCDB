import { Button, Checkbox, Divider, Group, Modal, Stack, Text, TextInput } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useCallback, useEffect, useState } from 'react'
import { api } from '../api/client'
import { fetchRorRecord, parseRorRecord, type RorParsed } from '../api/ror'
import type { CollabRole, Institution, PersonSummary } from '../api/types'
import { today } from '../dates'
import PersonSelect from './PersonSelect'

const EMPTY_FORM = {
  name: '',
  short_name: '',
  ror_id: '',
  latex_address: '',
  is_us: true,
  is_active: true,
  latitude: '',
  longitude: '',
}

/** Office-only add/edit form, shared by the Institutions list and the
 * institution detail page. `target` is the institution to edit, 'new' to
 * create one, or null (closed). When editing an existing institution it also
 * manages the institution's administrative contacts (admin_contact roles). */
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
  const [members, setMembers] = useState<PersonSummary[]>([])
  const [contacts, setContacts] = useState<CollabRole[]>([])
  const [contactSel, setContactSel] = useState<string | null>(null)

  // The institution being edited, if any — the administrative-contact section
  // needs a persisted id, so it's hidden while creating a new institution.
  const instId = target !== null && target !== 'new' ? target.id : null

  useEffect(() => {
    if (target === null) return
    setContactSel(null)
    setForm(
      target === 'new'
        ? EMPTY_FORM
        : {
            name: target.name,
            short_name: target.short_name ?? '',
            ror_id: target.ror_id ?? '',
            latex_address: target.latex_address ?? '',
            is_us: target.is_us,
            is_active: target.is_active,
            latitude: target.latitude != null ? String(target.latitude) : '',
            longitude: target.longitude != null ? String(target.longitude) : '',
          },
    )
  }, [target])

  const loadContacts = useCallback(() => {
    if (instId == null) {
      setMembers([])
      setContacts([])
      return
    }
    api
      .get<PersonSummary[]>(`/people?institution_id=${instId}`)
      .then(setMembers)
      .catch(() => setMembers([]))
    api
      .get<CollabRole[]>(`/collab-roles?institution_id=${instId}&role=admin_contact`)
      .then(setContacts)
      .catch(() => setContacts([]))
  }, [instId])
  useEffect(loadContacts, [loadContacts])

  // Assigning/ending a contact takes effect immediately (it's a collab-role
  // change, not part of the institution PATCH the Save button sends).
  const assignContact = async () => {
    if (!contactSel || instId == null) return
    try {
      await api.post('/collab-roles', {
        person_id: Number(contactSel),
        role: 'admin_contact',
        detail: null,
        working_group_id: null,
        institution_id: instId,
        start_date: today(),
      })
      notifications.show({ message: 'Administrative contact assigned.' })
      setContactSel(null)
      loadContacts()
      onSaved()
    } catch (err: any) {
      notifications.show({ color: 'red', message: err.message })
    }
  }

  const endContact = async (r: CollabRole) => {
    const name = r.person ? `${r.person.given_name} ${r.person.family_name}` : 'this person'
    if (!window.confirm(`End ${name}'s administrative-contact role today?`)) return
    try {
      await api.patch(`/collab-roles/${r.id}`, { end_date: today() })
      notifications.show({ message: 'Role ended today.' })
      loadContacts()
      onSaved()
    } catch (err: any) {
      notifications.show({ color: 'red', message: err.message })
    }
  }

  // Copy a parsed ROR record into the form: ROR id and coordinates always
  // (that's what the buttons promise), short name and author-list address
  // only into blank fields — never over something the office already wrote.
  // The US checkbox follows ROR's country (still editable before saving).
  // When ROR's canonical name differs from the stored one (free-text
  // registrations produce names like "UT Knoxville"), offer — never force —
  // renaming to match.
  const applyRor = (p: RorParsed) => {
    const rorName = p.name !== '(unnamed)' ? p.name : null
    const rename =
      rorName != null &&
      rorName.trim().toLowerCase() !== form.name.trim().toLowerCase() &&
      window.confirm(
        `ROR names this institution:\n\n${rorName}\n\nUpdate the name to match?\n(Currently “${form.name}”; everything else is filled either way.)`,
      )
    setForm((f) => ({
      ...f,
      name: rename && rorName ? rorName : f.name,
      ror_id: p.rorId ?? f.ror_id,
      latitude: p.latitude != null ? String(p.latitude) : f.latitude,
      longitude: p.longitude != null ? String(p.longitude) : f.longitude,
      short_name: f.short_name.trim() ? f.short_name : (p.shortName ?? ''),
      latex_address: f.latex_address.trim() ? f.latex_address : (p.address ?? ''),
      is_us: p.isUS ?? f.is_us,
    }))
    const extras = [
      p.latitude == null && 'no coordinates on the ROR record',
      !p.shortName && 'no short-name suggestion',
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
      is_active: form.is_active,
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

  // Contacts currently in effect; date ranges are inclusive on both ends,
  // so a role ending today is still current.
  const t = today()
  const currentContacts = contacts.filter(
    (r) => r.start_date <= t && (!r.end_date || r.end_date >= t),
  )

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
        <Checkbox
          label="Active"
          description="Institutions created by imports or free-text registration start inactive, awaiting office review; only active institutions appear in the registration form's institution list. Check this once the details above are right."
          checked={form.is_active}
          onChange={(e) => setForm({ ...form, is_active: e.currentTarget.checked })}
        />
        {instId != null && (
          <>
            <Divider
              label="Administrative Institutional Contact"
              labelPosition="left"
              mt="xs"
            />
            {currentContacts.map((r) => (
              <Group key={r.id} gap="xs" wrap="nowrap">
                <Text size="sm">
                  {r.person
                    ? `${r.person.preferred_name || r.person.given_name} ${r.person.family_name}`
                    : '—'}
                </Text>
                <Button size="compact-xs" variant="subtle" color="red" onClick={() => endContact(r)}>
                  End
                </Button>
              </Group>
            ))}
            {currentContacts.length === 0 && (
              <Text size="sm" c="dimmed">
                No administrative contact assigned.
              </Text>
            )}
            <Group gap="xs" align="flex-end">
              <PersonSelect
                people={members}
                excludeIds={currentContacts.map((r) => r.person_id)}
                value={contactSel}
                onChange={setContactSel}
                placeholder="Assign administrative contact…"
                style={{ flex: 1 }}
              />
              <Button variant="light" disabled={!contactSel} onClick={assignContact}>
                Assign
              </Button>
            </Group>
            <Text size="xs" c="dimmed" mt={-8}>
              Contact changes apply immediately; Save is only needed for the fields above.
            </Text>
          </>
        )}
        <Button onClick={() => save()}>Save</Button>
      </Stack>
    </Modal>
  )
}
