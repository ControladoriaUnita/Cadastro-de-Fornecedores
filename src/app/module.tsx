/**
 * Módulo atual na tela (Fornecedores/PJ ou Pessoas Físicas/PF).
 *  - nas listas, vem do endereço (/pf/... = PF);
 *  - nas telas de detalhe, a própria tela informa o módulo do registro aberto (useShowModule);
 *  - nas telas comuns (início, Painel dev), fica o último usado.
 */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import type { Module } from '@shared/domain/modules'
import { terms } from '@shared/domain/terms'
import { setApiModule } from '@/lib/api'
import { moduleOfPath } from './navigation'

const KEY = 'forn.module'
const read = (): Module => {
  try {
    return localStorage.getItem(KEY) === 'pf' ? 'pf' : 'pj'
  } catch {
    return 'pj'
  }
}

const ModuleContext = createContext<{ module: Module; setModule: (m: Module) => void } | null>(null)

export function ModuleProvider({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  const [last, setLast] = useState<Module>(read)
  const fromPath = moduleOfPath(pathname)
  const module = fromPath ?? last

  useEffect(() => {
    if (fromPath && fromPath !== last) setLast(fromPath)
  }, [fromPath, last])
  useEffect(() => {
    try {
      localStorage.setItem(KEY, last)
    } catch {
      /* navegador sem armazenamento: só não lembra o último módulo */
    }
  }, [last])

  // Título da aba segue o módulo (PF: "Pessoas Físicas", sem "Fornecedores")
  useEffect(() => {
    document.title = `${terms(module).area} · Unità Engenharia`
  }, [module])

  // Toda chamada à API leva o módulo da tela (x-module)
  setApiModule(module)
  const value = useMemo(() => ({ module, setModule: setLast }), [module])
  return <ModuleContext.Provider value={value}>{children}</ModuleContext.Provider>
}

export function useModule(): Module {
  return useContext(ModuleContext)?.module ?? 'pj'
}

/** Telas de detalhe: avisa o módulo do registro aberto (menu e "voltar" seguem o módulo certo). */
export function useShowModule(module: Module | null | undefined) {
  const ctx = useContext(ModuleContext)
  useEffect(() => {
    if (module && ctx && ctx.module !== module) ctx.setModule(module)
  }, [module, ctx])
}
