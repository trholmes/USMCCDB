import {
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
import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../api/client'
import { CAREER_STAGES, joinList, RESEARCH_AREAS } from '../constants'

export default function ApplyPage() {
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
    is_voting: false,
    research_areas: [] as string[],
  })
  // "Too uncertain to estimate" for the research-time question: an answer is
  // required, but this checkbox satisfies it (submits a null percentage).
  const [percentUncertain, setPercentUncertain] = useState(false)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const set = (k: string, v: unknown) => setForm((f) => ({ ...f, [k]: v }))

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      await api.post('/people/apply', {
        ...form,
        middle_name: form.middle_name || null,
        preferred_name: form.preferred_name || null,
        orcid: form.orcid || null,
        usmcc_percent:
          percentUncertain || form.usmcc_percent === '' ? null : Number(form.usmcc_percent),
        institution_name: form.institution_name || null,
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
              />
              <Select
                label="Position"
                data={CAREER_STAGES}
                value={form.career_stage}
                onChange={(v) => set('career_stage', v || 'other')}
              />
              <TextInput
                label="Primary institution"
                value={form.institution_name}
                onChange={(e) => set('institution_name', e.currentTarget.value)}
              />
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
                <Checkbox
                  mt={4}
                  label="PhD-holding physicist at a US institution, actively contributing to the muon collider effort"
                  checked={form.is_voting}
                  onChange={(e) => set('is_voting', e.currentTarget.checked)}
                />
              </div>
              <MultiSelect
                label="Research area(s)"
                placeholder="Select all that apply…"
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
