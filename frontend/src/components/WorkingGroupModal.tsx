import {
  Button,
  Checkbox,
  Modal,
  MultiSelect,
  Stack,
  Textarea,
  TextInput,
} from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useEffect, useState } from 'react'
import { api } from '../api/client'
import type { WorkingGroup } from '../api/types'
import { joinList, REPRESENTATIVE_AREAS, splitList } from '../constants'

const slugify = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

/** Create/edit modal for a working group — shared by the Working Groups page
 * and the Leadership page's add-convener flow (which creates a group on the
 * spot before naming its convener). `target` is 'new', the group being
 * edited, or null while closed. */
export default function WorkingGroupModal({
  target,
  onClose,
  onSaved,
}: {
  target: WorkingGroup | 'new' | null
  onClose: () => void
  onSaved: (wg: WorkingGroup) => void
}) {
  const [form, setForm] = useState({
    name: '',
    slug: '',
    description: '',
    is_active: true,
    areas: [] as string[],
  })
  const [slugTouched, setSlugTouched] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (target === null) return
    setForm(
      target === 'new'
        ? { name: '', slug: '', description: '', is_active: true, areas: [] }
        : {
            name: target.name,
            slug: target.slug,
            description: target.description ?? '',
            is_active: target.is_active,
            areas: splitList(target.areas),
          },
    )
    setSlugTouched(false)
  }, [target])

  const save = async () => {
    setBusy(true)
    try {
      const payload = {
        name: form.name,
        description: form.description || null,
        is_active: form.is_active,
        areas: joinList(form.areas),
      }
      const wg =
        target === 'new'
          ? await api.post<WorkingGroup>('/working-groups', { ...payload, slug: form.slug })
          : await api.patch<WorkingGroup>(`/working-groups/${(target as WorkingGroup).id}`, payload)
      onSaved(wg)
      onClose()
    } catch (err: any) {
      notifications.show({ color: 'red', message: err.message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      opened={target !== null}
      onClose={onClose}
      title={target === 'new' ? 'Add working group' : 'Edit working group'}
    >
      <Stack gap="sm">
        <TextInput
          label="Name"
          required
          value={form.name}
          onChange={(e) => {
            const name = e.currentTarget.value
            setForm((f) => ({
              ...f,
              name,
              slug: target === 'new' && !slugTouched ? slugify(name) : f.slug,
            }))
          }}
        />
        <TextInput
          label="Slug"
          description={
            target === 'new'
              ? 'Short identifier: lowercase letters, digits, and hyphens. Cannot be changed later.'
              : 'Slugs cannot be changed.'
          }
          required
          disabled={target !== 'new'}
          value={form.slug}
          onChange={(e) => {
            setSlugTouched(true)
            setForm({ ...form, slug: e.currentTarget.value })
          }}
        />
        <Textarea
          label="Description"
          autosize
          minRows={2}
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.currentTarget.value })}
        />
        <MultiSelect
          label="Areas"
          description="Leadership Council area(s) the group falls under — none, one, or several."
          placeholder={form.areas.length ? undefined : 'Select areas…'}
          data={REPRESENTATIVE_AREAS}
          value={form.areas}
          onChange={(v) => setForm({ ...form, areas: v })}
          clearable
        />
        <Checkbox
          label="Active"
          description="Inactive groups stay listed with their membership but are flagged as inactive."
          checked={form.is_active}
          onChange={(e) => setForm({ ...form, is_active: e.currentTarget.checked })}
        />
        <Button onClick={save} loading={busy} disabled={!form.name || !form.slug}>
          Save
        </Button>
      </Stack>
    </Modal>
  )
}
