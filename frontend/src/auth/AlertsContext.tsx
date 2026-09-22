import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { api } from '../api/client'
import type { AdminAlerts } from '../api/types'
import { useSession } from './SessionContext'

interface Alerts {
  alerts: AdminAlerts | null
  refresh: () => Promise<void>
}

const AlertsContext = createContext<Alerts>({ alerts: null, refresh: async () => {} })

/** Admin alerts feed the badge on the "Alerts" nav item and the alerts
 * panel. Fetched only for admins; refreshed every few minutes and by the
 * panel on mount. */
export function AlertsProvider({ children }: { children: React.ReactNode }) {
  const { isAdmin } = useSession()
  const [alerts, setAlerts] = useState<AdminAlerts | null>(null)

  const refresh = useCallback(async () => {
    if (!isAdmin) {
      setAlerts(null)
      return
    }
    try {
      setAlerts(await api.get<AdminAlerts>('/alerts'))
    } catch {
      // Transient failure: keep whatever count we last showed.
    }
  }, [isAdmin])

  useEffect(() => {
    refresh()
    if (!isAdmin) return
    const timer = window.setInterval(refresh, 5 * 60 * 1000)
    return () => window.clearInterval(timer)
  }, [refresh, isAdmin])

  return <AlertsContext.Provider value={{ alerts, refresh }}>{children}</AlertsContext.Provider>
}

export const useAlerts = () => useContext(AlertsContext)
