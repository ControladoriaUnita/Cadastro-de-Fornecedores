import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { LayoutGrid, LogOut, Menu, X } from 'lucide-react'
import logoWhite from '@/assets/brand/logo-unita-white.png'
import { useModule } from '@/app/module'
import { NAV_BY_MODULE } from '@/app/navigation'
import { MODULE_INFO, MODULES } from '@shared/domain/modules'
import { Button } from '@/components/ui'
import { useAuth } from '@/lib/auth'
import { cn } from '@/utils/cn'

/** Barra superior grafite (64px) com borda laranja de 2px, logo à esquerda e abas centralizadas — Identidade v2. */
export function AppShell() {
  const { user, signOut, can, hasModule } = useAuth()
  const module = useModule()
  const [open, setOpen] = useState(false)
  // Menu do módulo atual (se o cargo tiver o módulo) + itens comuns (Painel dev)
  const items = (hasModule(module) ? NAV_BY_MODULE[module] : []).filter((n) => n.anyOf.some(can))
  const modules = MODULES.filter(hasModule)

  const link = (n: (typeof items)[number], mobile = false) => (
    <NavLink
      key={n.to}
      to={n.to}
      end={n.end}
      onClick={() => setOpen(false)}
      className={({ isActive }) =>
        cn(
          'rounded-control px-4 py-2 text-[15px] font-medium whitespace-nowrap transition-colors',
          mobile && 'block',
          isActive ? 'bg-white/10 text-white' : 'text-ink-300 hover:bg-white/10 hover:text-white',
        )
      }
    >
      {n.label}
    </NavLink>
  )

  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-30 border-b-2 border-primary bg-secondary">
        <div className="grid h-16 grid-cols-[auto_1fr_auto] items-center gap-4 px-4 lg:px-6">
          <div className="flex shrink-0 items-center gap-3">
            <NavLink to="/" aria-label="Início — escolher o módulo">
              <img src={logoWhite} alt="Unità Engenharia" className="h-8" />
            </NavLink>
            <span className="hidden border-l border-white/20 pl-3 text-xs font-semibold tracking-wider text-primary uppercase sm:inline">{MODULE_INFO[module].label}</span>
          </div>
          <nav className="hidden min-w-0 justify-self-center gap-1 overflow-x-auto [scrollbar-width:none] lg:flex" aria-label="Principal">
            {items.map((n) => link(n))}
          </nav>
          <div className="flex items-center gap-3 justify-self-end">
            {modules.length > 1 && (
              <NavLink to="/" className="hidden items-center gap-1.5 rounded-control px-3 py-1.5 text-xs font-semibold text-ink-300 hover:bg-white/10 hover:text-white md:inline-flex" title="Voltar à escolha do módulo">
                <LayoutGrid className="size-4" aria-hidden /> Módulos
              </NavLink>
            )}
            {user && (
              <div className="hidden text-right leading-tight md:block">
                <p className="text-sm font-semibold text-white">{user.fullName}</p>
                <p className="text-xs text-ink-400">{user.roleNames.join(' · ')}</p>
              </div>
            )}
            <Button variant="inverse" size="sm" icon={<LogOut className="size-4" />} onClick={signOut} className="hidden sm:inline-flex">
              Sair
            </Button>
            <button
              type="button"
              className="rounded-control p-2 text-ink-200 hover:bg-white/10 lg:hidden"
              aria-label={open ? 'Fechar menu' : 'Abrir menu'}
              aria-expanded={open}
              onClick={() => setOpen((v) => !v)}
            >
              {open ? <X className="size-5" /> : <Menu className="size-5" />}
            </button>
          </div>
        </div>
        {open && (
          <nav className="space-y-1 border-t border-white/10 px-4 py-3 lg:hidden" aria-label="Principal (celular)">
            {modules.length > 1 && (
              <p className="px-4 pb-1 text-xs font-semibold tracking-wider text-ink-400 uppercase">{MODULE_INFO[module].label}</p>
            )}
            {items.map((n) => link(n, true))}
            {modules.length > 1 && (
              <NavLink to="/" onClick={() => setOpen(false)} className="block rounded-control px-4 py-2 text-[15px] text-primary hover:bg-white/10">
                Escolher outro módulo
              </NavLink>
            )}
            <button type="button" onClick={signOut} className="block w-full rounded-control px-4 py-2 text-left text-[15px] text-ink-300 hover:bg-white/10 hover:text-white">
              Sair
            </button>
          </nav>
        )}
      </header>
      <main className="mx-auto max-w-[1400px] px-4 pt-6 pb-16 lg:px-6">
        <Outlet />
      </main>
    </div>
  )
}
