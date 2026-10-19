import { Alert, Radio, Stack, Text } from '@mantine/core'

type Props = {
  /** Current consent: true = listed on muoncollider.us/people and named on
   *  the public talks page. */
  value: boolean
  onChange: (value: boolean) => void
  disabled?: boolean
  /** Shown under the group label after the standard explanation. */
  note?: string
  /**
   * The consent currently saved on the record (profile page). When it is
   * true and the form now says "not listed", a notice spells out that saving
   * removes the person from the public page.
   */
  saved?: boolean
}

/**
 * The public-listing consent question (name and photo on the public
 * muoncollider.us/people page, and the name next to one's talks on the
 * database's public talks page), shared by the registration form and the
 * profile editor.
 *
 * Being listed is the collaboration's default: the "listed" option is
 * pre-selected and opting out is a separate, explicitly worded choice
 * rather than an unticked checkbox, so nobody ends up unlisted just by
 * skimming past the question.
 */
export function PublicListingChoice({ value, onChange, disabled, note, saved }: Props) {
  const optingOut = saved === true && !value
  return (
    <Radio.Group
      label="Public people page"
      description={
        <>
          <Text span size="xs" c="dimmed">
            muoncollider.us/people lists collaboration members by name and photo, showing the
            size and breadth of the US Muon Collider Collaboration. The same choice decides
            whether the public talks page names you as the speaker of your talks.
          </Text>
          {note && (
            <Text span size="xs" c="dimmed">
              {' '}
              {note}
            </Text>
          )}
        </>
      }
      value={value ? 'listed' : 'not_listed'}
      onChange={(v) => onChange(v === 'listed')}
    >
      <Stack gap={6} mt={8}>
        <Radio
          value="listed"
          disabled={disabled}
          label="Yes, list name and photo on muoncollider.us/people"
        />
        <Radio
          value="not_listed"
          disabled={disabled}
          label="No, do not list on the public page"
        />
      </Stack>
      {optingOut && (
        <Alert color="yellow" variant="light" mt="xs" py="xs">
          Saving removes the name and photo from muoncollider.us/people and the name from
          the public talks page.
        </Alert>
      )}
    </Radio.Group>
  )
}
