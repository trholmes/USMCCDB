import { Alert } from '@mantine/core'
import { useEffect, useState } from 'react'
import { api } from '../api/client'
import type { SiteSettings } from '../api/types'

const LEVEL_COLORS: Record<SiteSettings['banner_level'], string> = {
  info: 'blue',
  warning: 'yellow',
  critical: 'red',
}

// Site-wide announcement banner set from the admin panel (Site settings tab).
// Rendered on the login page and above every signed-in page alike.
export default function SiteBanner() {
  const [settings, setSettings] = useState<SiteSettings | null>(null)
  useEffect(() => {
    api.get<SiteSettings>('/site/settings').then(setSettings).catch(() => setSettings(null))
  }, [])

  if (!settings?.banner_message) return null
  return (
    <Alert color={LEVEL_COLORS[settings.banner_level] ?? 'blue'} mb="md" radius="md">
      {settings.banner_message}
    </Alert>
  )
}
