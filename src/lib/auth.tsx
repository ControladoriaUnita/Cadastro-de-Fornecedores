/**
 * Sessão da equipe na tela: quem está logado e o que pode fazer.
 * A autorização de verdade é feita na API; aqui só decide o que mostrar.
 */
import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { UserDTO } from '@shared/contracts'
import type { Permission } from '@shared/domain/roles'
import { api, ApiError } from './api'

interface AuthState {
  status: 'loading' | 'signed-out' | 'ready' | 'error'
  user: UserDTO | null
  error: string | null
  can: (p: Permission) => boolean
  signOut: () => Promise<void>
  refresh: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  const me = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return (await api<{ user: UserDTO }>('/me')).user
      } catch (err) {
        if (err instanceof ApiError && (err.status === 401 || err.status === 403)) return null
        throw err
      }
    },
    staleTime: 5 * 60_000,
    retry: false,
  })

  const refresh = useCallback(async () => {
    await qc.invalidateQueries()
  }, [qc])

  const signOut = useCallback(async () => {
    await api('/auth/logout', { method: 'POST' })
    qc.clear()
    window.location.href = '/entrar'
  }, [qc])

  const value = useMemo<AuthState>(() => {
    const user = me.data ?? null
    const status = me.isLoading ? 'loading' : me.isError ? 'error' : user ? 'ready' : 'signed-out'
    return {
      status,
      user,
      error: me.error ? (me.error as Error).message : null,
      can: (p) => !!user?.permissions.includes(p),
      signOut,
      refresh,
    }
  }, [me.data, me.isLoading, me.isError, me.error, signOut, refresh])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth fora do AuthProvider')
  return ctx
}
