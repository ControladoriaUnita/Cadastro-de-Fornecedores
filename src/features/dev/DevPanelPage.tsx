import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Pencil, Plus, XCircle } from 'lucide-react'
import type { CriterionDTO, DiagnosticsDTO, DocumentTypeDTO, OutboxItemDTO, RiskRuleDTO } from '@shared/contracts'
import { RISK_SEVERITIES, SEVERITY_LABELS, type RiskSeverity } from '@shared/domain/risk'
import { PERMISSIONS, type Permission } from '@shared/domain/roles'
import { PageHeader } from '@/components/layout/PageHeader'
import { Alert, Badge, Button, Card, CardBody, CardHeader, Dialog, Field, Input, Select, Skeleton, Tabs, Textarea } from '@/components/ui'
import { api, errorMessage } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { formatDateTime } from '@/utils/format'
import { RolesManager, UsersManager } from './AccessManagement'

type Tab = 'diag' | 'users' | 'roles' | 'types' | 'criteria' | 'risk' | 'outbox'

const Ok = ({ ok, children }: { ok: boolean; children: React.ReactNode }) => (
  <span className="inline-flex items-center gap-1.5 text-sm">
    {ok ? <CheckCircle2 className="size-4 text-success" /> : <XCircle className="size-4 text-error" />}
    {children}
  </span>
)

function Diagnostics() {
  const q = useQuery({ queryKey: ['diagnostics'], queryFn: () => api<DiagnosticsDTO>('/dev/diagnostics'), staleTime: 0 })
  if (q.isLoading) return <Skeleton className="h-40" />
  if (q.isError || !q.data) return <Alert tone="error">{errorMessage(q.error)}</Alert>
  const d = q.data
  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader title="Integrações" actions={<Button size="sm" onClick={() => q.refetch()} loading={q.isFetching}>Testar de novo</Button>} />
          <CardBody className="space-y-2">
            <Ok ok={d.database.ok}>Banco Neon {d.database.ms !== null && `(${d.database.ms} ms)`} {d.database.error}</Ok>
            <br />
            <Ok ok={d.uau.login.ok}>
              Login no UAU ({d.uau.mode}) {d.uau.login.ms !== null && `${d.uau.login.ms} ms`} {d.uau.login.error}
            </Ok>
            <br />
            <Ok ok={d.uau.writeEnabled}>Gravação no UAU: {d.uau.writeEnabled ? 'real' : 'simulação'}</Ok>
            <br />
            <Ok ok={d.transparencia.configured}>Portal da Transparência (CEIS/CNEP)</Ok>
            <br />
            <Ok ok={d.authMode === 'entra'}>Login: {d.authMode === 'entra' ? 'Microsoft Entra ID' : 'modo dev (seletor de usuário)'}</Ok>
            <br />
            <Ok ok={d.email.provider === 'graph'}>E-mail: {d.email.provider === 'graph' ? 'Microsoft 365' : d.email.provider === 'log' ? 'registro local (aba E-mails)' : 'desligado'}</Ok>
            <br />
            <Ok ok={d.storage.kind === 'vercel-blob'}>Arquivos: {d.storage.kind === 'vercel-blob' ? 'Vercel Blob' : 'disco local (.data/uploads)'}</Ok>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Variáveis de ambiente" description="Só presença; valores nunca saem do servidor." />
          <CardBody className="grid grid-cols-2 gap-1">
            {Object.entries(d.env).map(([k, v]) => (
              <Ok key={k} ok={v}>
                <code className="font-mono text-xs">{k}</code>
              </Ok>
            ))}
          </CardBody>
        </Card>
      </div>
    </div>
  )
}

function DocumentTypes() {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['document-types'], queryFn: () => api<DocumentTypeDTO[]>('/document-types') })
  const [edit, setEdit] = useState<DocumentTypeDTO | 'new' | null>(null)
  const [form, setForm] = useState({ name: '', description: '', hasExpiry: false, defaultValidityDays: '' as string, active: true, sort: 0 })
  const open = (t: DocumentTypeDTO | 'new') => {
    setEdit(t)
    setForm(
      t === 'new'
        ? { name: '', description: '', hasExpiry: false, defaultValidityDays: '', active: true, sort: (q.data?.length ?? 0) + 1 }
        : { name: t.name, description: t.description ?? '', hasExpiry: t.hasExpiry, defaultValidityDays: t.defaultValidityDays ? String(t.defaultValidityDays) : '', active: t.active, sort: t.sort },
    )
  }
  const save = useMutation({
    mutationFn: () =>
      api(edit === 'new' ? '/document-types' : `/document-types/${(edit as DocumentTypeDTO).id}`, {
        method: edit === 'new' ? 'POST' : 'PUT',
        body: { ...form, description: form.description || null, defaultValidityDays: form.defaultValidityDays ? Number(form.defaultValidityDays) : null },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['document-types'] })
      void qc.invalidateQueries({ queryKey: ['models'] })
      setEdit(null)
    },
  })
  return (
    <Card>
      <CardHeader title="Tipos de documento" description="Catálogo usado pelos modelos de fornecedor." actions={<Button size="sm" variant="primary" icon={<Plus className="size-4" />} onClick={() => open('new')}>Novo tipo</Button>} />
      <ul className="divide-y divide-border-soft">
        {q.data?.map((t) => (
          <li key={t.id} className="flex items-center gap-3 px-5 py-3">
            <div className="min-w-0 flex-1">
              <p className="font-medium">
                {t.name} {!t.active && <Badge tone="warning">Inativo</Badge>}
              </p>
              <p className="text-xs text-text-muted">{t.description}</p>
            </div>
            {t.hasExpiry && <Badge tone="info">Validade{t.defaultValidityDays ? ` ${t.defaultValidityDays} dias` : ''}</Badge>}
            <Button size="sm" variant="ghost" aria-label={`Editar ${t.name}`} onClick={() => open(t)}>
              <Pencil className="size-4" />
            </Button>
          </li>
        ))}
      </ul>
      {edit && (
        <Dialog open onClose={() => setEdit(null)} title={edit === 'new' ? 'Novo tipo de documento' : 'Editar tipo de documento'} footer={<Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Salvar</Button>}>
          <div className="space-y-3">
            <Field label="Nome" required>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label="Descrição / orientação">
              <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="accent-primary" checked={form.hasExpiry} onChange={(e) => setForm({ ...form, hasExpiry: e.target.checked })} /> Tem validade (controlar vencimento)
            </label>
            {form.hasExpiry && (
              <Field label="Validade padrão (dias)" hint="Usada quando o fornecedor não informa a data de validade.">
                <Input type="number" min={1} value={form.defaultValidityDays} onChange={(e) => setForm({ ...form, defaultValidityDays: e.target.value })} />
              </Field>
            )}
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="accent-primary" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> Ativo
            </label>
            {save.isError && <Alert tone="error">{errorMessage(save.error)}</Alert>}
          </div>
        </Dialog>
      )}
    </Card>
  )
}

function Criteria() {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['criteria'], queryFn: () => api<CriterionDTO[]>('/criteria') })
  const [edit, setEdit] = useState<CriterionDTO | 'new' | null>(null)
  const [form, setForm] = useState({ name: '', description: '', weight: 1, active: true, sort: 0 })
  const open = (c: CriterionDTO | 'new') => {
    setEdit(c)
    setForm(c === 'new' ? { name: '', description: '', weight: 1, active: true, sort: (q.data?.length ?? 0) + 1 } : { name: c.name, description: c.description ?? '', weight: c.weight, active: c.active, sort: c.sort })
  }
  const save = useMutation({
    mutationFn: () => api(edit === 'new' ? '/criteria' : `/criteria/${(edit as CriterionDTO).id}`, { method: edit === 'new' ? 'POST' : 'PUT', body: { ...form, description: form.description || null } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['criteria'] })
      setEdit(null)
    },
  })
  return (
    <Card>
      <CardHeader title="Critérios de avaliação" description="Notas de 1 a 5; a média é ponderada pelo peso." actions={<Button size="sm" variant="primary" icon={<Plus className="size-4" />} onClick={() => open('new')}>Novo critério</Button>} />
      <ul className="divide-y divide-border-soft">
        {q.data?.map((c) => (
          <li key={c.id} className="flex items-center gap-3 px-5 py-3">
            <div className="min-w-0 flex-1">
              <p className="font-medium">
                {c.name} {!c.active && <Badge tone="warning">Inativo</Badge>}
              </p>
              <p className="text-xs text-text-muted">{c.description}</p>
            </div>
            <Badge>peso {c.weight}</Badge>
            <Button size="sm" variant="ghost" aria-label={`Editar ${c.name}`} onClick={() => open(c)}>
              <Pencil className="size-4" />
            </Button>
          </li>
        ))}
      </ul>
      {edit && (
        <Dialog open onClose={() => setEdit(null)} title={edit === 'new' ? 'Novo critério' : 'Editar critério'} footer={<Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Salvar</Button>}>
          <div className="space-y-3">
            <Field label="Nome" required>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label="Descrição">
              <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </Field>
            <Field label="Peso (1 a 10)">
              <Input type="number" min={1} max={10} value={form.weight} onChange={(e) => setForm({ ...form, weight: Number(e.target.value) })} />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="accent-primary" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> Ativo
            </label>
            {save.isError && <Alert tone="error">{errorMessage(save.error)}</Alert>}
          </div>
        </Dialog>
      )}
    </Card>
  )
}

function RiskRules() {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['risk-rules'], queryFn: () => api<RiskRuleDTO[]>('/risk-rules') })
  const [draft, setDraft] = useState<Record<string, { severity: RiskSeverity; param: number | null }>>({})
  const save = useMutation({
    mutationFn: () => api<RiskRuleDTO[]>('/risk-rules', { method: 'PUT', body: { rules: q.data!.map((r) => ({ key: r.key, ...(draft[r.key] ?? { severity: r.severity, param: r.param }) })) } }),
    onSuccess: (data) => {
      qc.setQueryData(['risk-rules'], data)
      setDraft({})
    },
  })
  const dirty = Object.keys(draft).length > 0
  return (
    <Card>
      <CardHeader
        title="Regras de risco"
        description="Bloqueia = impede enviar para aprovação · Alerta = só avisa · Desligada = não avalia"
        actions={<Button size="sm" variant="primary" disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>Salvar regras</Button>}
      />
      {save.isError && <Alert tone="error" className="m-4">{errorMessage(save.error)}</Alert>}
      <ul className="divide-y divide-border-soft">
        {q.data?.map((r) => {
          const cur = draft[r.key] ?? { severity: r.severity, param: r.param }
          return (
            <li key={r.key} className="flex flex-wrap items-center gap-3 px-5 py-3">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{r.definition.label}</p>
                <p className="text-xs text-text-muted">{r.definition.description}</p>
              </div>
              {r.definition.param && (
                <label className="flex items-center gap-2 text-xs text-ink-700">
                  {r.definition.param.label}
                  <Input type="number" min={0} className="h-8 w-28" value={cur.param ?? ''} onChange={(e) => setDraft({ ...draft, [r.key]: { ...cur, param: e.target.value === '' ? null : Number(e.target.value) } })} />
                  {r.definition.param.unit}
                </label>
              )}
              <Select className="h-8 w-36" value={cur.severity} onChange={(e) => setDraft({ ...draft, [r.key]: { ...cur, severity: e.target.value as RiskSeverity } })} aria-label={`Gravidade: ${r.definition.label}`}>
                {RISK_SEVERITIES.map((s) => (
                  <option key={s} value={s}>
                    {SEVERITY_LABELS[s]}
                  </option>
                ))}
              </Select>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}

function Outbox() {
  const q = useQuery({ queryKey: ['outbox'], queryFn: () => api<OutboxItemDTO[]>('/dev/outbox'), refetchInterval: 15_000 })
  const [open, setOpen] = useState<OutboxItemDTO | null>(null)
  return (
    <Card>
      <CardHeader title="E-mails" description="Tudo que o app enviou ou tentou enviar. Com EMAIL_PROVIDER=log, os links do fornecedor e os códigos aparecem aqui." />
      <ul className="divide-y divide-border-soft">
        {q.data?.map((m) => (
          <li key={m.id}>
            <button type="button" onClick={() => setOpen(m)} className="flex w-full flex-wrap items-center gap-3 px-5 py-3 text-left hover:bg-ink-50">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{m.subject}</p>
                <p className="truncate text-xs text-text-muted">
                  para {m.to.join(', ')} · {formatDateTime(m.createdAt)}
                </p>
              </div>
              <Badge tone={m.status === 'erro' ? 'error' : m.status === 'enviado' ? 'success' : 'neutral'}>{m.status}</Badge>
            </button>
          </li>
        ))}
        {q.data?.length === 0 && <li className="px-5 py-6 text-sm text-text-muted">Nenhum e-mail ainda.</li>}
      </ul>
      {open && (
        <Dialog open onClose={() => setOpen(null)} title={open.subject} description={`para ${open.to.join(', ')}`} width="min(94vw, 44rem)">
          {open.error && <Alert tone="error" className="mb-3">{open.error}</Alert>}
          <pre className="font-sans text-sm whitespace-pre-wrap text-ink-700">
            {open.text.split(/(https?:\/\/\S+)/g).map((part, i) =>
              /^https?:\/\//.test(part) ? (
                <a key={i} href={part} target="_blank" rel="noreferrer" className="font-medium break-all text-primary underline">
                  {part}
                </a>
              ) : (
                part
              ),
            )}
          </pre>
        </Dialog>
      )}
    </Card>
  )
}

const TABS: { key: Tab; label: string; permission: Permission }[] = [
  { key: 'users', label: 'Usuários', permission: PERMISSIONS.usersManage },
  { key: 'roles', label: 'Cargos e permissões', permission: PERMISSIONS.usersManage },
  { key: 'types', label: 'Tipos de documento', permission: PERMISSIONS.settingsManage },
  { key: 'criteria', label: 'Critérios de avaliação', permission: PERMISSIONS.settingsManage },
  { key: 'risk', label: 'Regras de risco', permission: PERMISSIONS.settingsManage },
  { key: 'diag', label: 'Diagnóstico', permission: PERMISSIONS.devPanel },
  { key: 'outbox', label: 'E-mails', permission: PERMISSIONS.devPanel },
]

export default function DevPanelPage() {
  const { can } = useAuth()
  const tabs = TABS.filter((t) => can(t.permission))
  const [tab, setTab] = useState<Tab>(tabs[0]?.key ?? 'users')
  return (
    <>
      <PageHeader eyebrow="Painel dev" title="Administração" description="Usuários, cargos e permissões, catálogos, regras e integrações. Modelos de fornecedor ficam na aba Modelos." />
      <Tabs<Tab> sticky value={tab} onChange={setTab} items={tabs.map(({ key, label }) => ({ key, label }))} />
      <div className="mt-6">
        {tab === 'users' && <UsersManager />}
        {tab === 'roles' && <RolesManager />}
        {tab === 'types' && <DocumentTypes />}
        {tab === 'criteria' && <Criteria />}
        {tab === 'risk' && <RiskRules />}
        {tab === 'diag' && <Diagnostics />}
        {tab === 'outbox' && <Outbox />}
      </div>
    </>
  )
}
