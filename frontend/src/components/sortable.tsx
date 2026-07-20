import { Table } from '@mantine/core'
import { useMemo, useState } from 'react'

export type SortDir = 'asc' | 'desc'
export interface SortState {
  key: string
  dir: SortDir
}

export type Accessors<T> = Record<string, (row: T) => unknown>

/** Client-side column sorting. Click cycles asc → desc → default order.
 *  Nulls/empty values always sort last; strings compare case-insensitively. */
export function useSortable<T>(rows: T[], accessors: Accessors<T>) {
  const [sort, setSort] = useState<SortState | null>(null)

  const sorted = useMemo(() => {
    if (!sort) return rows
    const acc = accessors[sort.key]
    if (!acc) return rows
    const mul = sort.dir === 'asc' ? 1 : -1
    return [...rows].sort((a, b) => {
      const va = acc(a)
      const vb = acc(b)
      const aEmpty = va === null || va === undefined || va === ''
      const bEmpty = vb === null || vb === undefined || vb === ''
      if (aEmpty && bEmpty) return 0
      if (aEmpty) return 1
      if (bEmpty) return -1
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * mul
      if (typeof va === 'boolean' && typeof vb === 'boolean')
        return ((va ? 1 : 0) - (vb ? 1 : 0)) * mul
      return String(va).localeCompare(String(vb), undefined, { sensitivity: 'base' }) * mul
    })
  }, [rows, sort, accessors])

  const toggle = (key: string) =>
    setSort((s) =>
      s?.key === key ? (s.dir === 'asc' ? { key, dir: 'desc' } : null) : { key, dir: 'asc' },
    )

  return { sorted, sort, toggle }
}

export function SortableTh({
  label,
  k,
  sort,
  toggle,
}: {
  label: string
  k: string
  sort: SortState | null
  toggle: (key: string) => void
}) {
  const active = sort?.key === k
  const arrow = active ? (sort!.dir === 'asc' ? '↑' : '↓') : '↕'
  return (
    <Table.Th
      onClick={() => toggle(k)}
      style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}
      title={`Sort by ${label.toLowerCase()}`}
    >
      {label}{' '}
      <span aria-hidden style={{ opacity: active ? 1 : 0.35, fontSize: '0.85em' }}>
        {arrow}
      </span>
    </Table.Th>
  )
}
