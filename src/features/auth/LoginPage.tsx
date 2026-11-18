import { useState } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { LogIn } from 'lucide-react'
import type { AuthConfigDTO, DevUserOption } from '@shared/contracts'
import logo from '@/assets/brand/logo-unita.png'
import pattern from '@/assets/brand/pattern-un.png'
import { Alert, Button, Card, Spinner } from '@/components/ui'
import { api, errorMessage } from '@/lib/api'
import { useAuth } from '@/lib/auth'

/** Entrada da equipe: Microsoft (produção) ou seletor de usuário (localhost, AUTH_MODE=dev). */
export function LoginPage() {
  const { status } = useAuth()
  const qc = useQueryClient()
  const [params] = useSearchParams()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(params.get('erro'))
  const config = useQuery({ queryKey: ['auth-config'], queryFn: () => api<AuthConfigDTO>('/auth/config') })
  const devUsers = useQuery({
    queryKey: ['dev-users'],
    queryFn: () => api<DevUserOption[]>('/auth/dev-users'),
    enabled: config.data?.mode === 'dev',
  })

  if (status === 'ready') return <Navigate to="/" replace />

  const devLogin = async (userId: string) => {
    setBusy(userId)
    setError(null)
    try {
      await api('/auth/dev-login', { method: 'POST', body: { userId } })
      await qc.invalidateQueries({ queryKey: ['me'] })
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-10">
      <img src={pattern} alt="" aria-hidden className="pointer-events-none absolute -bottom-10 left-0 w-[160%] max-w-none opacity-[0.06]" />
      <Card className="relative w-full max-w-md p-8">
        <img src={logo} alt="Unità Engenharia" className="h-12" />
        <p className="mt-8 text-xs font-semibold tracking-wider text-primary uppercase">Suprimentos</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Cadastro de fornecedores</h1>
        <p className="mt-1 text-sm text-text-muted">Solicitação, homologação e gravação no UAU em um só fluxo.</p>

        {error && (
          <Alert tone="error" className="mt-6">
            {error}
          </Alert>
        )}

        <div className="mt-6 space-y-3">
          {config.isLoading && <Spinner className="text-primary" />}
          {config.data?.mode === 'entra' && (
            <Button
              variant="primary"
              className="w-full"
              icon={<LogIn className="size-4" />}
              disabled={!config.data.entraConfigured}
              onClick={() => (window.location.href = '/api/auth/microsoft/start')}
            >
              Entrar com a conta Microsoft
            </Button>
          )}
          {config.data?.mode === 'entra' && !config.data.entraConfigured && (
            <p className="text-xs text-text-muted">O login Microsoft ainda não foi configurado no servidor.</p>
          )}
          {config.data?.mode === 'dev' && (
            <>
              <Alert tone="info" title="Modo desenvolvimento">
                Escolha um usuário para entrar. Em produção esta tela vira o login com a conta Microsoft.
              </Alert>
              <ul className="space-y-2">
                {devUsers.data?.map((u) => (
                  <li key={u.id}>
                    <button
                      type="button"
                      onClick={() => devLogin(u.id)}
                      disabled={!!busy}
                      className="flex w-full items-center justify-between gap-3 rounded-control border border-border px-4 py-3 text-left transition hover:border-primary hover:bg-primary-soft disabled:opacity-60"
                    >
                      <span>
                        <span className="block text-sm font-semibold">{u.fullName}</span>
                        <span className="block text-xs text-text-muted">{u.roleNames.join(' · ')}</span>
                      </span>
                      {busy === u.id ? <Spinner className="size-4 text-primary" /> : <LogIn className="size-4 text-ink-400" />}
                    </button>
                  </li>
                ))}
              </ul>
              {devUsers.isError && <Alert tone="error">{errorMessage(devUsers.error)}</Alert>}
            </>
          )}
        </div>
      </Card>
    </div>
  )
}
