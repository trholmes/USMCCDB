import {
  Autocomplete,
  Button,
  Card,
  Center,
  Checkbox,
  MultiSelect,
  NumberInput,
  Select,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../api/client'
import { CAREER_STAGES, joinList, RESEARCH_AREAS, STUDENT_STAGES } from '../constants'

interface InstitutionPublic {
  id: number
  name: string
  short_name: string | null
  is_us: boolean
}

// Mirrors the backend's ORCID_RE (schemas/membership.py) so a typo fails
// on the field instead of as a page-level 422.
const ORCID_FORM_RE = /^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/

export default function RegisterPage() {
  const [form, setForm] = useState({
    given_name: '',
    middle_name: '',
    family_name: '',
    preferred_name: '',
    email: '',
    orcid: '',
    career_stage: 'other',
    usmcc_percent: '' as number | string,
    institution_name: '',
    // 'us' | 'non-us' | null — required when a free-text institution is
    // given; new institutions carry this declaration for office review.
    institution_is_us: null as string | null,
    is_voting: false,
    research_areas: [] as string[],
  })
  // "Too uncertain to estimate" for the research-time question: an answer is
  // required, but this checkbox satisfies it (submits a null percentage).
  const [percentUncertain, setPercentUncertain] = useState(false)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [insts, setInsts] = useState<InstitutionPublic[]>([])
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const set = (k: string, v: unknown) => setForm((f) => ({ ...f, [k]: v }))

  useEffect(() => {
    api.get<InstitutionPublic[]>('/institutions/public').then(setInsts).catch(() => setInsts([]))
  }, [])

  // Typed text that names a known institution (by full or short name) links
  // to it — no US question, no duplicate entry for the office to merge.
  const instMatch = useMemo(() => {
    const typed = form.institution_name.trim().toLowerCase()
    if (!typed) return null
    return (
      insts.find((i) => i.name.toLowerCase() === typed) ??
      insts.find((i) => (i.short_name ?? '').toLowerCase() === typed) ??
      null
    )
  }, [insts, form.institution_name])

  const institutionIsUs = instMatch
    ? instMatch.is_us
    : form.institution_is_us === 'us'
      ? true
      : form.institution_is_us === 'non-us'
        ? false
        : null

  const orcidError =
    form.orcid.trim() && !ORCID_FORM_RE.test(form.orcid.trim().toUpperCase())
      ? 'Enter your ORCID as 0000-0000-0000-0000, or leave it blank.'
      : null

  // Charter voting rules the form can check itself (mirrors the backend
  // validation on /people/register): students are not eligible, and voting
  // requires a US institution — so an institution must be given at all.
  const votingError = !form.is_voting
    ? null
    : STUDENT_STAGES.includes(form.career_stage)
      ? 'Graduate and undergraduate students are not eligible for voting membership — update your position or register as a non-voting member.'
      : !form.institution_name.trim()
        ? 'Voting membership requires a US institution — enter your primary institution above or register as a non-voting member.'
        : institutionIsUs === false
          ? 'Voting membership requires a US institution — register as a non-voting member.'
          : null

  // A new institution must be declared US or non-US (its US status gates
  // voting eligibility, so the backend refuses to guess).
  const instUsError =
    form.institution_name.trim() && !instMatch && !form.institution_is_us
      ? 'Please indicate whether this is a US institution.'
      : null

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const error = orcidError || instUsError || votingError
    if (error) {
      notifications.show({ color: 'red', message: error })
      return
    }
    setBusy(true)
    try {
      await api.post('/people/register', {
        ...form,
        middle_name: form.middle_name || null,
        preferred_name: form.preferred_name || null,
        orcid: form.orcid.trim().toUpperCase() || null,
        usmcc_percent:
          percentUncertain || form.usmcc_percent === '' ? null : Number(form.usmcc_percent),
        institution_id: instMatch?.id ?? null,
        institution_name: instMatch ? null : form.institution_name.trim() || null,
        institution_is_us:
          instMatch || !form.institution_name.trim() ? null : form.institution_is_us === 'us',
        research_areas: joinList(form.research_areas),
      })
      setDone(true)
    } catch (err: any) {
      notifications.show({ color: 'red', message: err.message })
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <Center mih="60vh">
        <Card withBorder w={480} p="xl">
          <Title order={3}>Registration received</Title>
          <Text mt="sm">
            Thanks! Your membership is now pending review by the USMCC office. You'll be able
            to sign in once it's approved.
          </Text>
          <Button mt="md" onClick={() => navigate('/login')}>
            Back to sign in
          </Button>
        </Card>
      </Center>
    )
  }

  return (
    <Center p="md">
      <Card withBorder w={560} p="xl">
        <Stack>
          <div>
            <Title order={3}>Join USMCC</Title>
            {params.get('welcome') === 'orcid' && (
              <Text c="green" size="sm">
                Your ORCID sign-in worked — please complete your membership registration.
              </Text>
            )}
          </div>
          <form onSubmit={submit}>
            <Stack gap="sm">
              <TextInput
                label="First / given name"
                required
                value={form.given_name}
                onChange={(e) => set('given_name', e.currentTarget.value)}
              />
              <TextInput
                label="Middle name (optional)"
                value={form.middle_name}
                onChange={(e) => set('middle_name', e.currentTarget.value)}
              />
              <TextInput
                label="Last / family name"
                required
                value={form.family_name}
                onChange={(e) => set('family_name', e.currentTarget.value)}
              />
              <TextInput
                label="Preferred name (optional)"
                description="Shown in place of your first/given name in listings; your family name always stays."
                value={form.preferred_name}
                onChange={(e) => set('preferred_name', e.currentTarget.value)}
              />
              <TextInput
                label="Email"
                type="email"
                required
                value={form.email}
                onChange={(e) => set('email', e.currentTarget.value)}
              />
              <TextInput
                label="ORCID iD (0000-0000-0000-0000)"
                value={form.orcid}
                onChange={(e) => set('orcid', e.currentTarget.value)}
                error={orcidError}
              />
              <Select
                label="Position"
                data={CAREER_STAGES}
                value={form.career_stage}
                onChange={(v) => set('career_stage', v || 'other')}
              />
              <Autocomplete
                label="Primary institution"
                description="Start typing and pick your institution; if it isn't listed, enter its full name."
                data={insts.map((i) => i.name)}
                limit={8}
                value={form.institution_name}
                onChange={(v) => set('institution_name', v)}
              />
              {instMatch && (
                <Text size="xs" c="green" mt={-8}>
                  Matched to {instMatch.name}
                  {instMatch.short_name ? ` (${instMatch.short_name})` : ''}.
                </Text>
              )}
              {form.institution_name.trim() && !instMatch && (
                <Select
                  label="Is this a US institution?"
                  description="This institution isn't in our list yet — it will be reviewed by the USMCC office. US status gates voting eligibility."
                  placeholder="Select…"
                  data={[
                    { value: 'us', label: 'US institution' },
                    { value: 'non-us', label: 'Non-US institution' },
                  ]}
                  value={form.institution_is_us}
                  onChange={(v) => set('institution_is_us', v)}
                />
              )}
              <div>
                <NumberInput
                  label="Research time on USMCC (%)"
                  description="Fraction of your research time devoted to the USMCC."
                  min={0}
                  max={100}
                  required={!percentUncertain}
                  disabled={percentUncertain}
                  value={form.usmcc_percent}
                  onChange={(v) => set('usmcc_percent', v)}
                />
                <Checkbox
                  mt={6}
                  label="Too uncertain to estimate"
                  checked={percentUncertain}
                  onChange={(e) => {
                    setPercentUncertain(e.currentTarget.checked)
                    if (e.currentTarget.checked) set('usmcc_percent', '')
                  }}
                />
              </div>
              <div>
                <Text size="sm" fw={700}>
                  Register as a voting member
                </Text>
                <Text size="xs" c="dimmed">
                  Per the USMCC charter, voting members are PhD-holding physicists at a US
                  institution who are actively contributing to the muon collider effort.
                  Graduate and undergraduate students are not eligible.
                </Text>
                <Checkbox
                  mt={6}
                  label="I meet these requirements and register as a voting member"
                  checked={form.is_voting}
                  onChange={(e) => set('is_voting', e.currentTarget.checked)}
                  error={votingError}
                />
              </div>
              <MultiSelect
                label="Research area(s)"
                placeholder="Select all relevant areas…"
                data={RESEARCH_AREAS}
                value={form.research_areas}
                onChange={(v) => set('research_areas', v)}
                clearable
              />
              <Button type="submit" loading={busy}>
                Submit registration
              </Button>
            </Stack>
          </form>
        </Stack>
      </Card>
    </Center>
  )
}
