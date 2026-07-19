import { Badge } from '@mantine/core'

const COLORS: Record<string, string> = {
  // membership
  pending: 'yellow',
  active: 'green',
  inactive: 'gray',
  alumni: 'blue',
  rejected: 'red',
  // talks
  open: 'gray',
  nominations: 'yellow',
  assigned: 'blue',
  given: 'green',
  cancelled: 'red',
  // nominations
  nominated: 'yellow',
  shortlisted: 'blue',
  declined: 'gray',
  withdrawn: 'gray',
  // publications
  proposed: 'yellow',
  in_progress: 'blue',
  collab_review: 'grape',
  submitted: 'orange',
  published: 'green',
}

export default function StatusBadge({ status }: { status: string }) {
  return (
    <Badge color={COLORS[status] ?? 'gray'} variant="light">
      {status.replace('_', ' ')}
    </Badge>
  )
}
