import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { api } from '../api/client'
import type { Me } from '../api/types'

interface Session {
  me: Me | null
  loading: boolean
  refresh: () => Promise<void>
  logout: () => Promise<void>
  // Admin "view as": act as another account (its role, person and contextual
  // permissions) while every action stays recorded against the admin.
  viewAs: (userId: number) => Promise<void>
  stopViewAs: () => Promise<void>
  isViewingAs: boolean
  isOffice: boolean
  isAdmin: boolean
  // Leadership Council representatives / deputies (or office): working
  // groups, their members and conveners (issue #167).
  canManageWGs: boolean
  // Same accounts: any publication, its people, status and author lists.
  canManagePubs: boolean
  // Speakers committee (or leadership / office): any talk, event, nomination.
  canManageTalks: boolean
}

const SessionContext = createContext<Session>({
  me: null,
  loading: true,
  refresh: async () => {},
  logout: async () => {},
  viewAs: async () => {},
  stopViewAs: async () => {},
  isViewingAs: false,
  isOffice: false,
  isAdmin: false,
  canManageWGs: false,
  canManagePubs: false,
  canManageTalks: false,
})

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<Me | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      setMe(await api.get<Me>('/auth/me'))
    } catch {
      setMe(null)
    } finally {
      setLoading(false)
    }
  }, [])

  const logout = useCallback(async () => {
    await api.post('/auth/logout')
    setMe(null)
  }, [])

  const viewAs = useCallback(async (userId: number) => {
    setMe(await api.post<Me>(`/auth/view-as/${userId}`))
  }, [])

  const stopViewAs = useCallback(async () => {
    setMe(await api.post<Me>('/auth/view-as/stop'))
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  return (
    <SessionContext.Provider
      value={{
        me,
        loading,
        refresh,
        logout,
        viewAs,
        stopViewAs,
        isViewingAs: !!me?.actor,
        isOffice: !!me && me.permissions.includes('office'),
        isAdmin: !!me && me.permissions.includes('admin'),
        canManageWGs: !!me && me.permissions.includes('leadership'),
        canManagePubs: !!me && me.permissions.includes('leadership'),
        canManageTalks: !!me && me.permissions.includes('speakers_committee'),
      }}
    >
      {children}
    </SessionContext.Provider>
  )
}

export const useSession = () => useContext(SessionContext)
