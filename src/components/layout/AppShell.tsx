import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { LogOut, Menu, X } from 'lucide-react'
import logoWhite from '@/assets/brand/logo-unita-white.png'
import { NAV } from '@/app/navigation'
import { Button } from '@/components/ui'
import { useAuth } from '@/lib/auth'
import { cn } from '@/utils/cn'

/** Barra superior grafite (64px) com borda laranja de 2px, logo à esquerda e abas centralizadas — Identidade v2. */
export function AppShell() {
  const { user, signOut, can } = useAuth()
  const [open, setOpen] = useState(false)
  const items = NAV.filter((n) => n.anyOf.some(can))

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
          <NavLink to="/" aria-label="Início" className="shrink-0">
            <img src={logoWhite} alt="Unità Engenharia" className="h-8" />
          </NavLink>
          <nav className="hidden min-w-0 justify-self-center gap-1 overflow-x-auto [scrollbar-width:none] lg:flex" aria-label="Principal">
            {items.map((n) => link(n))}
          </nav>
          <div className="flex items-center gap-3 justify-self-end">
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
            {items.map((n) => link(n, true))}
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
