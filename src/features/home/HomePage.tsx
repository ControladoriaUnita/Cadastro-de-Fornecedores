import { Link, Navigate } from 'react-router-dom'
import { ArrowRight, Building2, LogOut, UserRound } from 'lucide-react'
import { MODULE_INFO, MODULES, type Module } from '@shared/domain/modules'
import logo from '@/assets/brand/logo-unita.png'
import pattern from '@/assets/brand/pattern-un.png'
import { NAV_BY_MODULE } from '@/app/navigation'
import { Alert, Button, Card } from '@/components/ui'
import { useAuth } from '@/lib/auth'

const ICONS: Record<Module, typeof Building2> = { pj: Building2, pf: UserRound }

/**
 * Tela inicial: escolha do módulo (Fornecedores/PJ ou Pessoas Físicas/PF), SEM cabeçalho —
 * ele só aparece depois de entrar num módulo. Os módulos são independentes: cada um com
 * cargos, usuários e Painel dev próprios. Quem tem um módulo só vai direto para ele.
 */
export default function HomePage() {
  const { user, signOut } = useAuth()
  // Primeira tela que o cargo libera em cada módulo (com as permissões daquele módulo)
  const firstOf = (m: Module) => NAV_BY_MODULE[m].find((n) => n.anyOf.some((p) => user?.access?.[m]?.includes(p)))?.to ?? null
  const modules = MODULES.filter((m) => user?.modules.includes(m) && firstOf(m))

  if (modules.length === 1) return <Navigate to={firstOf(modules[0]!)!} replace />

  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-background">
      <img src={pattern} alt="" aria-hidden className="pointer-events-none absolute -bottom-10 left-0 w-[160%] max-w-none opacity-[0.05]" />
      <header className="relative flex items-center justify-between px-6 py-5">
        <img src={logo} alt="Unità Engenharia" className="h-10" />
        <Button variant="ghost" size="sm" icon={<LogOut className="size-4" />} onClick={signOut}>
          Sair
        </Button>
      </header>
      <main className="relative mx-auto w-full max-w-4xl flex-1 px-4 pt-6 pb-16 lg:pt-16">
        <p className="text-xs font-semibold tracking-wider text-primary uppercase">Cadastro de fornecedores e pessoas</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Olá, {user?.fullName.split(' ')[0] ?? ''}</h1>
        <p className="mt-1 text-text-muted">Escolha o módulo em que vai trabalhar.</p>

        {modules.length ? (
          <div className="mt-8 grid gap-6 md:grid-cols-2">
            {modules.map((m) => {
              const Icon = ICONS[m]
              return (
                <Link key={m} to={firstOf(m)!} className="group">
                  <Card className="h-full p-6 transition-shadow group-hover:shadow-overlay">
                    <div className="flex items-start gap-4">
                      <span className="rounded-card bg-primary-soft p-3 text-primary">
                        <Icon className="size-7" aria-hidden />
                      </span>
                      <div className="min-w-0 flex-1">
                        <h2 className="text-xl font-semibold">{MODULE_INFO[m].label}</h2>
                        <p className="mt-1 text-sm text-text-muted">{MODULE_INFO[m].description}</p>
                      </div>
                      <ArrowRight className="size-5 shrink-0 text-ink-400 transition-transform group-hover:translate-x-1 group-hover:text-primary" aria-hidden />
                    </div>
                  </Card>
                </Link>
              )
            })}
          </div>
        ) : (
          <Alert tone="warning" title="Sem acesso" className="mt-8 max-w-md">
            Seus cargos ainda não liberam nenhum módulo. Peça a quem administra o app para revisar suas permissões.
          </Alert>
        )}
      </main>
    </div>
  )
}
