import { Group, Pagination, Text } from '@mantine/core'
import { useMemo, useState } from 'react'

export const PAGE_SIZE = 25

/** Client-side pagination over an already filtered/sorted row array. The
 *  current page is clamped (not reset) when the row set shrinks, so sorting
 *  or refining a filter never bounces the reader back to page 1. */
export function usePagination<T>(rows: T[], pageSize = PAGE_SIZE) {
  const [page, setPage] = useState(1)
  const total = Math.max(1, Math.ceil(rows.length / pageSize))
  const current = Math.min(page, total)
  const paged = useMemo(
    () => rows.slice((current - 1) * pageSize, current * pageSize),
    [rows, current, pageSize],
  )
  return { paged, page: current, setPage, total, count: rows.length }
}

export function PaginationBar({
  page,
  total,
  setPage,
}: {
  page: number
  total: number
  setPage: (p: number) => void
}) {
  if (total <= 1) return null
  return (
    <Group justify="center" mt="md">
      <Pagination value={page} onChange={setPage} total={total} size="sm" />
    </Group>
  )
}

/** "{shown} of {count} rows" caption for a paginated table. */
export function PageCount({ shown, count, noun }: { shown: number; count: number; noun: string }) {
  return (
    <Text size="sm" c="dimmed" mb="xs">
      {count === shown ? count : `${shown} of ${count}`} {noun}
    </Text>
  )
}
