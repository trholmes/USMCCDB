import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { api } from '../api/client'
import type { AdminAlerts } from '../api/types'
import { useSession } from './SessionContext'

interface Alerts {
  alerts: AdminAlerts | null
  // Whether the signed-in account has an alerts panel at all: admins, the
  // office, and administrative institutional contacts (who see the pending
  // registrations at their institution). Decides the nav item.
  hasAlerts: boolean
  refresh: () => Promise<void>
}

const AlertsContext = createContext<Alerts>({
  alerts: null,
  hasAlerts: false,
  refresh: async () => {},
})

/** Alerts feed the badge on the "Alerts" nav item and the alerts panel.
 * The server scopes them to what the account can act on; fetched for every
 * signed-in account, refreshed every few minutes and by the panel on mount. */
export function AlertsProvider({ children }: { children: React.ReactNode }) {
  const { me } = useSession()
  // Re-fetched whenever the account the session acts as changes (sign-in,
  // view as, stop viewing as); null when signed out.
  const accountId = me?.user.id ?? null
  const [alerts, setAlerts] = useState<AdminAlerts | null>(null)

  const refresh = useCallback(async () => {
    if (accountId === null) {
      setAlerts(null)
      return
    }
    try {
      setAlerts(await api.get<AdminAlerts>('/alerts'))
    } catch {
      // Transient failure: keep whatever count we last showed.
    }
  }, [accountId])

  useEffect(() => {
    refresh()
    if (accountId === null) return
    const timer = window.setInterval(refresh, 5 * 60 * 1000)
    return () => window.clearInterval(timer)
  }, [refresh, accountId])

  return (
    <AlertsContext.Provider
      value={{ alerts, hasAlerts: !!alerts && alerts.scope !== 'none', refresh }}
    >
      {children}
    </AlertsContext.Provider>
  )
}

export const useAlerts = () => useContext(AlertsContext)
