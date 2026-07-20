import {
  Button,
  Card,
  Center,
  Checkbox,
  MultiSelect,
  NumberInput,
  Select,
  Stack,
  TagsInput,
  Text,
  Textarea,
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
    family_name: '',
    preferred_name: '',
    email: '',
    orcid: '',
    career_stage: 'other',
    professional_title: '',
    department: '',
    usmcc_percent: '' as number | string,
    institution_name: '',
    is_voting: false,
    research_areas: [] as string[],
    expertise: [] as string[],
    notes: '',
  })
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
        preferred_name: form.preferred_name || null,
        orcid: form.orcid || null,
        professional_title: form.professional_title || null,
        department: form.department || null,
        usmcc_percent: form.usmcc_percent === '' ? null : Number(form.usmcc_percent),
        institution_name: form.institution_name || null,
        research_areas: joinList(form.research_areas),
        expertise: joinList(form.expertise),
        notes: form.notes || null,
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
          <Title order={3}>Application received</Title>
          <Text mt="sm">
            Thanks! The USMCC office will review your application. You'll be able to sign in
            once it's approved.
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
            <Title order={3}>Apply to join USMCC</Title>
            {params.get('welcome') === 'orcid' && (
              <Text c="green" size="sm">
                Your ORCID sign-in worked — please complete your membership application.
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
                label="Last / family name"
                required
                value={form.family_name}
                onChange={(e) => set('family_name', e.currentTarget.value)}
              />
              <TextInput
                label="Preferred name (optional)"
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
                label="Professional title (optional)"
                description="Your title in your organization (e.g. Associate Professor, Staff Scientist)."
                value={form.professional_title}
                onChange={(e) => set('professional_title', e.currentTarget.value)}
              />
              <TextInput
                label="Primary institution"
                value={form.institution_name}
                onChange={(e) => set('institution_name', e.currentTarget.value)}
              />
              <TextInput
                label="Department (optional)"
                value={form.department}
                onChange={(e) => set('department', e.currentTarget.value)}
              />
              <NumberInput
                label="Research time on USMCC (%) (optional)"
                description="Fraction of your research time devoted to the USMCC."
                min={0}
                max={100}
                value={form.usmcc_percent}
                onChange={(v) => set('usmcc_percent', v)}
              />
              <Checkbox
                label="Registering as a voting member (PhD-holding physicist at a US institution, actively contributing to the muon collider effort)"
                checked={form.is_voting}
                onChange={(e) => set('is_voting', e.currentTarget.checked)}
              />
              <MultiSelect
                label="Research area(s)"
                placeholder="Select all that apply…"
                data={RESEARCH_AREAS}
                value={form.research_areas}
                onChange={(v) => set('research_areas', v)}
                clearable
              />
              <TagsInput
                label="Topics of focus"
                description="Type a topic and press Enter (e.g. muon cooling, tracking detectors)."
                placeholder="Add a topic…"
                value={form.expertise}
                onChange={(v) => set('expertise', v)}
                clearable
              />
              <Textarea
                label="Anything you want to tell us?"
                value={form.notes}
                onChange={(e) => set('notes', e.currentTarget.value)}
              />
              <Button type="submit" loading={busy}>
                Submit application
              </Button>
            </Stack>
          </form>
        </Stack>
      </Card>
    </Center>
  )
}
