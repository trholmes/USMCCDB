import { Select } from '@mantine/core'
import { useEffect, useMemo, useState } from 'react'
import { api } from '../api/client'
import type { PersonSummary } from '../api/types'

// Searchable person picker. Pass `people` to choose from a caller-supplied
// list (e.g. the members of one institution); without it the full directory
// is loaded once.
export default function PersonSelect({
  value,
  onChange,
  label,
  placeholder = 'Search people…',
  people,
  excludeIds,
  ...rest
}: {
  value: string | null
  onChange: (v: string | null) => void
  label?: string
  placeholder?: string
  people?: PersonSummary[]
  excludeIds?: number[]
} & Record<string, unknown>) {
  const [loaded, setLoaded] = useState<PersonSummary[]>([])
  useEffect(() => {
    if (people) return
    api.get<PersonSummary[]>('/people').then(setLoaded).catch(() => setLoaded([]))
  }, [people])

  const source = people ?? loaded
  const data = useMemo(() => {
    const excluded = new Set(excludeIds ?? [])
    return source
      .filter((p) => !excluded.has(p.id))
      .sort(
        (a, b) =>
          a.family_name.localeCompare(b.family_name) ||
          a.given_name.localeCompare(b.given_name),
      )
      .map((p) => ({
        value: String(p.id),
        label:
          `${p.family_name}, ${p.preferred_name || p.given_name}` +
          (p.primary_institution
            ? ` (${p.primary_institution.short_name || p.primary_institution.name})`
            : ''),
      }))
  }, [source, excludeIds])

  return (
    <Select
      label={label}
      placeholder={placeholder}
      data={data}
      value={value}
      onChange={onChange}
      searchable
      clearable
      nothingFoundMessage="No matching person"
      {...rest}
    />
  )
}
