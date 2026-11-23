import { lazy, Suspense, type ReactNode } from 'react'
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import { MODULES, type Module } from '@shared/domain/modules'
import { PERMISSIONS, type Permission } from '@shared/domain/roles'
import { NAV_BY_MODULE, PATHS } from '@/app/navigation'
import { AppShell } from '@/components/layout/AppShell'
import { Alert, Spinner } from '@/components/ui'
import { LoginPage } from '@/features/auth/LoginPage'
import { useAuth } from '@/lib/auth'

// Telas carregadas sob demanda (o portal do fornecedor não baixa o código da equipe)
const DashboardPage = lazy(() => import('@/features/dashboard/DashboardPage'))
const KanbanPage = lazy(() => import('@/features/requests/KanbanPage'))
const NewRequestPage = lazy(() => import('@/features/requests/NewRequestPage'))
const RequestPage = lazy(() => import('@/features/requests/RequestPage'))
const SuppliersPage = lazy(() => import('@/features/suppliers/SuppliersPage'))
const SupplierPage = lazy(() => import('@/features/suppliers/SupplierPage'))
const ValidationQueuePage = lazy(() => import('@/features/validation/ValidationQueuePage'))
const ValidationPage = lazy(() => import('@/features/validation/ValidationPage'))
const ModelsPage = lazy(() => import('@/features/models/ModelsPage'))
const HomePage = lazy(() => import('@/features/home/HomePage'))
const EvaluatePage = lazy(() => import('@/features/evaluations/EvaluatePage'))
const DevPanelPage = lazy(() => import('@/features/dev/DevPanelPage'))
const PortalPage = lazy(() => import('@/features/portal/PortalPage'))

const P = PERMISSIONS

const Loading = () => (
  <div className="flex min-h-[40vh] items-center justify-center text-primary">
    <Spinner />
  </div>
)

/** Só mostra o app para quem entrou; o resto vai para o login. `bare` = sem cabeçalho (tela de escolha do módulo). */
function Protected({ bare = false }: { bare?: boolean }) {
  const { status, error } = useAuth()
  if (status === 'loading') return <Loading />
  if (status === 'signed-out') return <Navigate to="/entrar" replace />
  if (status === 'error')
    return (
      <div className="mx-auto max-w-md p-8">
        <Alert tone="error" title="Não foi possível carregar sua sessão">
          {error}
        </Alert>
      </div>
    )
  return bare ? <Outlet /> : <AppShell />
}

/** Esconde a tela de quem não tem acesso (a API aplica a mesma regra). */
function Guard({ anyOf, module, children }: { anyOf: Permission[]; module?: Module; children: ReactNode }) {
  const { can, hasModule } = useAuth()
  const { pathname } = useLocation()
  if (anyOf.some(can) && (!module || hasModule(module))) return <>{children}</>
  // Manda para a primeira tela que o cargo libera (no mesmo módulo, se tiver); se não houver nenhuma, explica
  const inModule = module && hasModule(module) ? NAV_BY_MODULE[module].find((n) => n.anyOf.some(can)) : null
  const first = inModule ?? (MODULES.some(hasModule) || can('dev.panel') || can('users.manage') || can('settings.manage') ? { to: PATHS.home } : null)
  if (first && first.to !== pathname) return <Navigate to={first.to} replace />
  return (
    <div className="mx-auto max-w-md py-16">
      <Alert tone="warning" title="Sem acesso">
        Seus cargos ainda não liberam nenhuma tela. Peça a quem administra o app para revisar suas permissões.
      </Alert>
    </div>
  )
}

const g = (anyOf: Permission[], page: ReactNode, module?: Module) => (
  <Guard anyOf={anyOf} module={module}>
    {page}
  </Guard>
)

export function App() {
  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route path="/entrar" element={<LoginPage />} />
        <Route path="/portal/:token" element={<PortalPage />} />
        {/* Escolha do módulo: sem cabeçalho (ele só aparece dentro de um módulo) */}
        <Route element={<Protected bare />}>
          <Route index element={<HomePage />} />
        </Route>
        <Route element={<Protected />}>
          {/* Fornecedores/PJ (endereços que já existiam) */}
          <Route path={PATHS.pjDashboard} element={g([P.supplierRead], <DashboardPage module="pj" />, 'pj')} />
          <Route path={PATHS.requests} element={g([P.requestReadOwn, P.requestReadAll], <KanbanPage module="pj" />, 'pj')} />
          <Route path={PATHS.newRequest} element={g([P.requestCreate], <NewRequestPage module="pj" />, 'pj')} />
          <Route path={PATHS.evaluate} element={g([P.evaluationCreate], <EvaluatePage />, 'pj')} />
          <Route path={PATHS.suppliers} element={g([P.supplierRead], <SuppliersPage module="pj" />, 'pj')} />
          <Route path={PATHS.validation} element={g([P.requestApprove], <ValidationQueuePage module="pj" />, 'pj')} />
          <Route path={PATHS.models} element={g([P.modelRead], <ModelsPage module="pj" />, 'pj')} />
          {/* Pessoas Físicas/PF */}
          <Route path={PATHS.pfDashboard} element={g([P.supplierRead], <DashboardPage module="pf" />, 'pf')} />
          <Route path={PATHS.pfRequests} element={g([P.requestReadOwn, P.requestReadAll], <KanbanPage module="pf" />, 'pf')} />
          <Route path={PATHS.pfNewRequest} element={g([P.requestCreate], <NewRequestPage module="pf" />, 'pf')} />
          <Route path={PATHS.pfPeople} element={g([P.supplierRead], <SuppliersPage module="pf" />, 'pf')} />
          <Route path={PATHS.pfValidation} element={g([P.requestApprove], <ValidationQueuePage module="pf" />, 'pf')} />
          <Route path={PATHS.pfModels} element={g([P.modelRead], <ModelsPage module="pf" />, 'pf')} />
          {/* Detalhes: servem aos dois módulos (o módulo vem do documento; a API confere o acesso) */}
          <Route path="/solicitacoes/:id" element={g([P.requestReadOwn, P.requestReadAll], <RequestPage />)} />
          <Route path="/fornecedores/:id" element={g([P.supplierRead], <SupplierPage />)} />
          <Route path="/validacao/:id" element={g([P.requestAnalyze], <ValidationPage />)} />
          <Route path={PATHS.dev} element={g([P.devPanel, P.usersManage, P.settingsManage], <DevPanelPage module="pj" />, 'pj')} />
          <Route path={PATHS.pfDev} element={g([P.devPanel, P.usersManage, P.settingsManage], <DevPanelPage module="pf" />, 'pf')} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Suspense>
  )
}
