import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from 'lucide-react'
import type { DocumentTypeDTO, ModelDTO } from '@shared/contracts'
import { MODULE_INFO, type Module } from '@shared/domain/modules'
import { PERMISSIONS } from '@shared/domain/roles'
import { PageHeader } from '@/components/layout/PageHeader'
import { Alert, Badge, Button, Card, CardBody, CardHeader, ConfirmDialog, Dialog, EmptyState, Field, Input, Select, Skeleton, Textarea } from '@/components/ui'
import { api, errorMessage } from '@/lib/api'
import { useAuth } from '@/lib/auth'

interface Req {
  documentTypeId: string
  required: boolean
  instructions: string
}

function ModelEditor({ model, types, onClose, module = 'pj' }: { model: ModelDTO | null; types: DocumentTypeDTO[]; onClose: () => void; module?: Module }) {
  const qc = useQueryClient()
  const [name, setName] = useState(model?.name ?? '')
  const [description, setDescription] = useState(model?.description ?? '')
  // Modelo novo nasce no módulo da tela (PJ = CNPJ, PF = CPF)
  const [personKind, setPersonKind] = useState<ModelDTO['personKind']>(model?.personKind ?? MODULE_INFO[module].personKind)
  const [cnae, setCnae] = useState(model?.expectedCnaePrefixes.join(', ') ?? '')
  const [active, setActive] = useState(model?.active ?? true)
  const [reqs, setReqs] = useState<Req[]>(model?.requirements.map((r) => ({ documentTypeId: r.documentTypeId, required: r.required, instructions: r.instructions ?? '' })) ?? [])
  const available = types.filter((t) => t.active && !reqs.some((r) => r.documentTypeId === t.id))
  const typeName = new Map(types.map((t) => [t.id, t.name]))

  const save = useMutation({
    mutationFn: () =>
      api<ModelDTO>(model ? `/models/${model.id}` : '/models', {
        method: model ? 'PUT' : 'POST',
        body: {
          name,
          description: description || null,
          personKind,
          active,
          expectedCnaePrefixes: cnae
            .split(/[\s,;]+/)
            .map((c) => c.replace(/\D/g, ''))
            .filter(Boolean),
          requirements: reqs.map((r) => ({ ...r, instructions: r.instructions || null })),
        },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['models'] })
      onClose()
    },
  })

  const move = (i: number, dir: -1 | 1) =>
    setReqs((list) => {
      const next = [...list]
      const j = i + dir
      if (j < 0 || j >= next.length) return list
      ;[next[i], next[j]] = [next[j]!, next[i]!]
      return next
    })

  return (
    <Dialog
      open
      onClose={onClose}
      width="min(94vw, 48rem)"
      title={model ? 'Editar modelo' : module === 'pf' ? 'Novo modelo de pessoa física' : 'Novo modelo de fornecedor'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} className="mr-auto">
            Cancelar
          </Button>
          <Button variant="primary" loading={save.isPending} disabled={name.trim().length < 2} onClick={() => save.mutate()}>
            Salvar modelo
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_160px]">
          <Field label="Nome" required>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Tipo de pessoa">
            <Select value={personKind} onChange={(e) => setPersonKind(e.target.value as ModelDTO['personKind'])}>
              <option value="PJ">CNPJ</option>
              <option value="PF">CPF</option>
              <option value="ambos">Ambos</option>
            </Select>
          </Field>
        </div>
        <Field label="Descrição">
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
        </Field>
        <Field label="CNAEs esperados (prefixos)" hint="Ex.: 41, 42, 43 para construção. Vazio = qualquer atividade. Usado na análise de risco.">
          <Input value={cnae} onChange={(e) => setCnae(e.target.value)} />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="accent-primary" /> Modelo ativo (aparece na nova solicitação)
        </label>

        <div>
          <p className="mb-2 text-sm font-semibold">Documentos exigidos</p>
          <ul className="space-y-2">
            {reqs.map((r, i) => (
              <li key={r.documentTypeId} className="rounded-control border border-border-soft p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 flex-1 text-sm font-medium">{typeName.get(r.documentTypeId)}</span>
                  <label className="flex items-center gap-1.5 text-xs">
                    <input
                      type="checkbox"
                      checked={r.required}
                      onChange={(e) => setReqs((l) => l.map((x, k) => (k === i ? { ...x, required: e.target.checked } : x)))}
                      className="accent-primary"
                    />
                    Obrigatório
                  </label>
                  <Button size="sm" variant="ghost" aria-label="Subir" onClick={() => move(i, -1)}>
                    <ArrowUp className="size-4" />
                  </Button>
                  <Button size="sm" variant="ghost" aria-label="Descer" onClick={() => move(i, 1)}>
                    <ArrowDown className="size-4" />
                  </Button>
                  <Button size="sm" variant="ghost" aria-label="Remover" onClick={() => setReqs((l) => l.filter((_, k) => k !== i))}>
                    <Trash2 className="size-4 text-error" />
                  </Button>
                </div>
                <Input
                  value={r.instructions}
                  onChange={(e) => setReqs((l) => l.map((x, k) => (k === i ? { ...x, instructions: e.target.value } : x)))}
                  placeholder={module === 'pf' ? 'Orientação para a pessoa (opcional)' : 'Orientação para o fornecedor (opcional)'}
                  className="mt-2 h-8"
                />
              </li>
            ))}
          </ul>
          {available.length > 0 && (
            <Select
              value=""
              onChange={(e) => e.target.value && setReqs((l) => [...l, { documentTypeId: e.target.value, required: true, instructions: '' }])}
              className="mt-2"
              aria-label="Adicionar documento"
            >
              <option value="">+ Adicionar documento…</option>
              {available.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          )}
        </div>
        {save.isError && <Alert tone="error">{errorMessage(save.error)}</Alert>}
      </div>
    </Dialog>
  )
}

export default function ModelsPage({ module = 'pj' }: { module?: Module }) {
  const { can } = useAuth()
  const edit = can(PERMISSIONS.settingsManage)
  const [editing, setEditing] = useState<ModelDTO | 'new' | null>(null)
  const [removing, setRemoving] = useState<ModelDTO | null>(null)
  const qc = useQueryClient()
  const del = useMutation({
    mutationFn: (id: string) => api(`/models/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['models'] })
      setRemoving(null)
    },
  })
  const models = useQuery({ queryKey: ['models', module], queryFn: () => api<ModelDTO[]>(`/models?module=${module}`) })
  const types = useQuery({ queryKey: ['document-types', module], queryFn: () => api<DocumentTypeDTO[]>('/document-types') })

  return (
    <>
      <PageHeader
        eyebrow={module === 'pf' ? `Modelos · ${MODULE_INFO.pf.label}` : 'Modelos'}
        title={module === 'pf' ? 'Modelos de pessoa física' : 'Modelos de fornecedor'}
        description={module === 'pf' ? 'Cada modelo define quais documentos a pessoa física envia.' : 'Cada modelo define quais documentos o fornecedor envia e o que se espera da atividade dele.'}
        actions={
          edit && (
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
              Novo modelo
            </Button>
          )
        }
      />
      {models.isError && <Alert tone="error">{errorMessage(models.error)}</Alert>}
      {models.isLoading ? (
        <Skeleton className="h-60" />
      ) : models.data?.length ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {models.data.map((m) => (
            <Card key={m.id} className={m.active ? '' : 'opacity-60'}>
              <CardHeader
                title={m.name}
                description={m.description}
                actions={
                  <>
                    <Badge>{m.personKind === 'ambos' ? 'CNPJ ou CPF' : m.personKind === 'PJ' ? 'CNPJ' : 'CPF'}</Badge>
                    {!m.active && <Badge tone="warning">Inativo</Badge>}
                    {edit && (
                      <Button size="sm" variant="ghost" aria-label={`Editar ${m.name}`} onClick={() => setEditing(m)}>
                        <Pencil className="size-4" />
                      </Button>
                    )}
                    {edit && (
                      <Button size="sm" variant="ghost" aria-label={`Excluir ${m.name}`} onClick={() => (del.reset(), setRemoving(m))}>
                        <Trash2 className="size-4 text-error" />
                      </Button>
                    )}
                  </>
                }
              />
              <CardBody>
                <ul className="space-y-1 text-sm">
                  {m.requirements.map((r) => (
                    <li key={r.documentTypeId} className="flex items-center justify-between gap-2">
                      <span>{r.name}</span>
                      {!r.required && <span className="text-xs text-text-muted">opcional</span>}
                    </li>
                  ))}
                </ul>
                {m.expectedCnaePrefixes.length > 0 && <p className="mt-3 text-xs text-text-muted">CNAE esperado: {m.expectedCnaePrefixes.join(', ')}…</p>}
              </CardBody>
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState title="Nenhum modelo" />
      )}
      <ConfirmDialog
        open={!!removing}
        tone="danger"
        title={`Excluir o modelo "${removing?.name}"?`}
        description="O modelo e a lista de documentos dele deixam de existir. Esta ação não pode ser desfeita. Modelo já usado em cadastro ou solicitação não pode ser excluído: desative-o."
        confirmLabel="Excluir"
        loading={del.isPending}
        onConfirm={() => removing && del.mutate(removing.id)}
        onCancel={() => setRemoving(null)}
      >
        {del.isError && <Alert tone="error">{errorMessage(del.error)}</Alert>}
      </ConfirmDialog>
      {editing && types.data && <ModelEditor module={module} model={editing === 'new' ? null : editing} types={types.data} onClose={() => setEditing(null)} />}
    </>
  )
}
