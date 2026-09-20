import { Anchor, Text } from '@mantine/core'

// Every page ends with a pointer to the issue tracker so members can file
// bug reports and suggestions without hunting for the repository (issue #136).
export default function Footer() {
  return (
    <Text size="xs" c="dimmed" ta="center" mt="xl" pb="md">
      Found a bug or have a suggestion?{' '}
      <Anchor
        href="https://github.com/trholmes/USMCCDB/issues"
        target="_blank"
        rel="noopener noreferrer"
        size="xs"
      >
        Report it on GitHub
      </Anchor>
    </Text>
  )
}
