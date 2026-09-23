import { Select, TextInput } from '@mantine/core'
import { AREA_CONSTRAINED_ROLES, COLLAB_ROLES, REPRESENTATIVE_AREAS } from '../constants'

// The qualifier input for a collaboration role: a fixed dropdown of Leadership
// Council areas for representatives and deputies (issue #159), free text for
// the other roles that need a detail (focus-area leads, "other").
export default function RoleDetailInput({
  role,
  value,
  onChange,
  maw,
}: {
  role: string
  value: string
  onChange: (v: string) => void
  maw?: number
}) {
  const def = COLLAB_ROLES.find((r) => r.value === role)
  if (!def?.needsDetail) return null
  if (AREA_CONSTRAINED_ROLES.includes(role)) {
    // A stored value outside the list (older free-text rows) stays selectable
    // so opening the edit form never silently blanks it.
    const data = REPRESENTATIVE_AREAS.includes(value) || !value
      ? REPRESENTATIVE_AREAS
      : [...REPRESENTATIVE_AREAS, value]
    return (
      <Select
        label="Area"
        placeholder="Select area…"
        data={data}
        value={value || null}
        onChange={(v) => onChange(v ?? '')}
        maw={maw}
      />
    )
  }
  return (
    <TextInput
      label={role === 'other' ? 'Title' : 'Area'}
      description={
        role === 'other'
          ? 'Full title as it should appear (e.g. DEI Committee Chair).'
          : 'Focus area, e.g. Target, RF, Design.'
      }
      value={value}
      onChange={(e) => onChange(e.currentTarget.value)}
      maw={maw}
    />
  )
}
