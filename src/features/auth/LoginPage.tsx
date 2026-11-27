import { useState, type ReactNode } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { LogIn } from 'lucide-react'
import type { AuthConfigDTO, DevUserOption } from '@shared/contracts'
import logoWhite from '@/assets/brand/logo-unita-white.png'
import pattern from '@/assets/brand/pattern-un.png'
import symbol from '@/assets/brand/symbol-un-orange.png'
import { Alert, Button, Spinner } from '@/components/ui'
import { api, errorMessage } from '@/lib/api'
import { useAuth } from '@/lib/auth'

/**
 * Entrada da equipe: Microsoft (produção) ou seletor de usuário (localhost, AUTH_MODE=dev).
 * Layout no modelo do Relatório de Aporte (painel da marca à esquerda, acesso à direita),
 * com a identidade Unità: painel grafite, logo branco, padrão "UN" a 7% e o laranja só como acento.
 * No celular o painel vira uma faixa no topo.
 */
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

  const microsoftLogin = () => {
    setBusy('microsoft')
    window.location.href = '/api/auth/microsoft/start'
  }

  const dev = config.data?.mode === 'dev'

  return (
    <div className="grid min-h-screen bg-surface md:grid-cols-[minmax(360px,1.05fr)_1fr]">
      <BrandPanel />

      <section className="flex flex-col items-center justify-center bg-[radial-gradient(700px_420px_at_100%_100%,var(--color-primary-soft),transparent_70%)] px-4 pt-10 pb-6 md:px-6 md:pt-12">
        <div className="my-auto w-full max-w-[380px] motion-safe:animate-fade-in">
          <p className="text-sm font-semibold tracking-wider text-primary uppercase">Unità · Suprimentos</p>
          <h1 className="mt-2.5 text-3xl font-semibold tracking-tight md:text-4xl">Bem-vindo</h1>
          <p className="mt-2.5 mb-7 text-base leading-relaxed text-text-muted md:text-lg">
            {dev
              ? 'Modo local de desenvolvimento: escolha um perfil para entrar.'
              : 'Entre com a sua conta corporativa para acessar o cadastro de fornecedores.'}
          </p>

          <div className="grid gap-3.5">
            {error && <Alert tone="error">{error}</Alert>}
            {config.isLoading && <Spinner className="mx-auto text-primary" />}
            {config.isError && <Alert tone="error">{errorMessage(config.error)}</Alert>}

            {config.data?.mode === 'entra' && (
              <>
                <Button
                  variant="primary"
                  className="h-12 w-full gap-3 text-[15px]"
                  icon={<MicrosoftLogo />}
                  loading={busy === 'microsoft'}
                  disabled={!config.data.entraConfigured}
                  onClick={microsoftLogin}
                >
                  {busy === 'microsoft' ? 'Abrindo a Microsoft…' : 'Entrar com Microsoft 365'}
                </Button>
                <p className="text-center text-xs text-text-muted">
                  {config.data.entraConfigured
                    ? 'Use sua conta corporativa da Unità.'
                    : 'O login Microsoft ainda não foi configurado no servidor.'}
                </p>
              </>
            )}

            {dev && (
              <>
                <Alert tone="info" title="Modo desenvolvimento">
                  Em produção esta tela vira o login com a conta Microsoft.
                </Alert>
                <ul className="max-h-[50vh] space-y-2 overflow-y-auto">
                  {devUsers.isLoading && <Spinner className="mx-auto text-primary" />}
                  {devUsers.data?.map((u) => (
                    <li key={u.id}>
                      <button
                        type="button"
                        onClick={() => devLogin(u.id)}
                        disabled={!!busy}
                        className="flex w-full items-center justify-between gap-3 rounded-control border border-border bg-surface px-4 py-3 text-left transition hover:border-primary hover:bg-primary-soft disabled:opacity-60"
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
        </div>

        <Footer>Unità Engenharia · uso interno</Footer>
      </section>
    </div>
  )
}

/** Painel da marca: grafite, logo branco oficial, padrão "UN" como textura e o símbolo laranja como grafismo. */
function BrandPanel() {
  return (
    <aside className="relative flex items-center gap-14 overflow-hidden bg-secondary bg-[radial-gradient(900px_520px_at_0%_0%,rgb(255_255_255/0.08),transparent_60%)] px-6 py-7 text-white md:flex-col md:items-start md:px-16 md:py-14">
      <span aria-hidden className="absolute inset-x-0 top-0 h-1 bg-primary" />
      <img
        src={pattern}
        alt=""
        aria-hidden
        className="pointer-events-none absolute -bottom-2 left-0 w-[160%] max-w-none opacity-[0.07] invert"
      />
      <img src={logoWhite} alt="Unità Engenharia" className="relative z-10 h-12 w-auto md:h-auto md:w-[min(300px,72%)]" />

      <div className="relative z-10 hidden max-w-[480px] md:block">
        <p className="text-sm font-semibold tracking-wider text-white/70 uppercase">Suprimentos</p>
        <h2 className="mt-3 text-[clamp(32px,3.2vw,44px)] leading-tight font-semibold">Cadastro de fornecedores</h2>
        <p className="mt-3.5 text-lg leading-relaxed text-white/80">
          Solicitação, homologação e gravação no UAU em um só fluxo.
        </p>
      </div>

      <img
        src={symbol}
        alt=""
        aria-hidden
        className="pointer-events-none absolute right-4 bottom-4 w-20 md:right-12 md:bottom-12 md:w-[min(180px,34%)]"
      />
    </aside>
  )
}

function Footer({ children }: { children: ReactNode }) {
  return (
    <p className="mt-8 flex items-center gap-2 text-xs text-ink-400">
      <span aria-hidden className="size-1.5 rounded-full bg-primary" />
      {children}
    </p>
  )
}

function MicrosoftLogo() {
  return (
    <svg viewBox="0 0 21 21" aria-hidden className="box-content size-5 rounded bg-white p-[3px]">
      <path className="fill-ms-red" d="M0 0h10v10H0z" />
      <path className="fill-ms-green" d="M11 0h10v10H11z" />
      <path className="fill-ms-blue" d="M0 11h10v10H0z" />
      <path className="fill-ms-yellow" d="M11 11h10v10H11z" />
    </svg>
  )
}
