import { lazy, Suspense, type ReactNode } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { PERMISSIONS, type Permission } from '@shared/domain/roles'
import { NAV, PATHS } from '@/app/navigation'
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
const EvaluatePage = lazy(() => import('@/features/evaluations/EvaluatePage'))
const DevPanelPage = lazy(() => import('@/features/dev/DevPanelPage'))
const PortalPage = lazy(() => import('@/features/portal/PortalPage'))

const P = PERMISSIONS

const Loading = () => (
  <div className="flex min-h-[40vh] items-center justify-center text-primary">
    <Spinner />
  </div>
)

/** Só mostra o app para quem entrou; o resto vai para o login. */
function Protected() {
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
  return <AppShell />
}

/** Esconde a tela de quem não tem acesso (a API aplica a mesma regra). */
function Guard({ anyOf, children }: { anyOf: Permission[]; children: ReactNode }) {
  const { can } = useAuth()
  const { pathname } = useLocation()
  if (anyOf.some(can)) return <>{children}</>
  // Manda para a primeira tela que o cargo libera; se não houver nenhuma, explica
  const first = NAV.find((n) => n.anyOf.some(can))
  if (first && first.to !== pathname) return <Navigate to={first.to} replace />
  return (
    <div className="mx-auto max-w-md py-16">
      <Alert tone="warning" title="Sem acesso">
        Seus cargos ainda não liberam nenhuma tela. Peça a quem administra o app para revisar suas permissões.
      </Alert>
    </div>
  )
}

const g = (anyOf: Permission[], page: ReactNode) => <Guard anyOf={anyOf}>{page}</Guard>

export function App() {
  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route path="/entrar" element={<LoginPage />} />
        <Route path="/portal/:token" element={<PortalPage />} />
        <Route element={<Protected />}>
          <Route index element={g([P.supplierRead], <DashboardPage />)} />
          <Route path={PATHS.requests} element={g([P.requestReadOwn, P.requestReadAll], <KanbanPage />)} />
          <Route path={PATHS.newRequest} element={g([P.requestCreate], <NewRequestPage />)} />
          <Route path="/solicitacoes/:id" element={g([P.requestReadOwn, P.requestReadAll], <RequestPage />)} />
          <Route path={PATHS.evaluate} element={g([P.evaluationCreate], <EvaluatePage />)} />
          <Route path={PATHS.suppliers} element={g([P.supplierRead], <SuppliersPage />)} />
          <Route path="/fornecedores/:id" element={g([P.supplierRead], <SupplierPage />)} />
          <Route path={PATHS.validation} element={g([P.requestApprove], <ValidationQueuePage />)} />
          <Route path="/validacao/:id" element={g([P.requestAnalyze], <ValidationPage />)} />
          <Route path={PATHS.models} element={g([P.modelRead], <ModelsPage />)} />
          <Route path={PATHS.dev} element={g([P.devPanel, P.usersManage, P.settingsManage], <DevPanelPage />)} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Suspense>
  )
}
