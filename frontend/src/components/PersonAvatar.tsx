import { Avatar } from '@mantine/core'
import { photoUrl } from '../api/client'
import type { PersonSummary } from '../api/types'

export default function PersonAvatar({
  person,
  size = 'sm',
}: {
  person: PersonSummary
  size?: string | number
}) {
  const initials = `${person.given_name[0] ?? ''}${person.family_name[0] ?? ''}`.toUpperCase()
  return (
    <Avatar
      src={person.photo_file ? photoUrl(person.id, person.photo_file) : undefined}
      size={size}
      radius="xl"
      color="blue"
      name={`${person.given_name} ${person.family_name}`}
    >
      {initials}
    </Avatar>
  )
}
