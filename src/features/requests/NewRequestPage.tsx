import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Building2, CheckCircle2, Database, Search, Send } from 'lucide-react'
import type { DocumentLookupDTO, ModelDTO } from '@shared/contracts'
import { onlyDigits, personKindOf } from '@shared/domain/document-number'
import { URGENCIES, URGENCY_LABELS, type Urgency } from '@shared/domain/request/status'
import { PERMISSIONS } from '@shared/domain/roles'
import { PATHS } from '@/app/navigation'
import { CompanyCard } from '@/components/domain/CompanyCard'
import { SupplierStatusBadge } from '@/components/domain/badges'
import { PageHeader } from '@/components/layout/PageHeader'
import { Alert, Button, Card, CardBody, CardHeader, Field, Input, Select, Spinner, Textarea } from '@/components/ui'
import { api, errorMessage } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { formatDocument } from '@/utils/format'

export default function NewRequestPage() {
  const { can } = useAuth()
  const navigate = useNavigate()
  const [document, setDocument] = useState('')
  const [modelId, setModelId] = useState('')
  const [contactEmail, setContactEmail] = useState('')
  const [contactName, setContactName] = useState('')
  const [workName, setWorkName] = useState('')
  const [justification, setJustification] = useState('')
  const [urgency, setUrgency] = useState<Urgency>('normal')
  const [sendInvite, setSendInvite] = useState(can(PERMISSIONS.requestAnalyze))

  const digits = onlyDigits(document)
  const kind = personKindOf(digits)
  const lookup = useQuery({
    queryKey: ['lookup', digits],
    queryFn: () => api<DocumentLookupDTO>(`/lookup/${digits}`),
    enabled: !!kind,
    staleTime: 5 * 60_000,
    retry: false,
  })
  const models = useQuery({ queryKey: ['models', 'active'], queryFn: () => api<ModelDTO[]>('/models?active=1') })
  const options = (models.data ?? []).filter((m) => !kind || m.personKind === 'ambos' || m.personKind === kind)

  // Preenche o e-mail com o da Receita, se o usuário ainda não digitou
  const companyEmail = lookup.data?.company?.email
  useEffect(() => {
    if (companyEmail && !contactEmail) setContactEmail(companyEmail)
  }, [companyEmail]) // eslint-disable-line react-hooks/exhaustive-deps

  const create = useMutation({
    mutationFn: () =>
      api<{ id: string; number: number }>('/requests', {
        method: 'POST',
        body: { document: digits, modelId, contactEmail, contactName: contactName || null, workName: workName || null, justification: justification || null, urgency, sendInvite },
      }),
    onSuccess: (r) => navigate(PATHS.request(r.id)),
  })

  const existingOpen = lookup.data?.existing?.openRequestId
  const invalidDoc = digits.length >= 11 && !kind && (digits.length === 11 || digits.length === 14)
  const canSubmit = !!kind && !!modelId && /\S+@\S+\.\S+/.test(contactEmail) && !existingOpen

  return (
    <>
      <PageHeader eyebrow="Solicitações" backTo={PATHS.requests} title="Nova solicitação de cadastro" description="Informe o CNPJ ou CPF: consultamos a Receita, o app e o UAU na hora." />
      <div className="grid gap-6 lg:grid-cols-[1fr_420px]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="1. Quem é o fornecedor?" />
            <CardBody className="space-y-4">
              <Field label="CNPJ ou CPF" required error={invalidDoc ? 'Número inválido (confira os dígitos).' : null}>
                <div className="relative">
                  <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-400" aria-hidden />
                  <Input value={document} onChange={(e) => setDocument(e.target.value)} placeholder="00.000.000/0000-00" inputMode="numeric" autoFocus className="pl-9 tabular" maxLength={18} />
                </div>
              </Field>
              {lookup.isFetching && (
                <p className="flex items-center gap-2 text-sm text-text-muted">
                  <Spinner className="size-4 text-primary" /> Consultando Receita Federal e UAU…
                </p>
              )}
              {lookup.isError && <Alert tone="error">{errorMessage(lookup.error)}</Alert>}
              {lookup.data && (
                <div className="space-y-3">
                  {lookup.data.existing && (
                    <Alert
                      tone={existingOpen ? 'warning' : 'info'}
                      title={existingOpen ? `Já existe a solicitação nº ${lookup.data.existing.openRequestNumber} em andamento` : 'Fornecedor já cadastrado no app'}
                      action={
                        <Link to={existingOpen ? PATHS.request(existingOpen) : PATHS.supplier(lookup.data.existing.id)} className="text-sm font-semibold underline">
                          Abrir
                        </Link>
                      }
                    >
                      <span className="inline-flex items-center gap-2">
                        {lookup.data.existing.legalName} <SupplierStatusBadge status={lookup.data.existing.status} />
                      </span>
                      {!existingOpen && <p className="mt-1">Você pode abrir uma nova solicitação para atualizar o cadastro e os documentos.</p>}
                    </Alert>
                  )}
                  <div className="flex flex-wrap gap-2 text-sm">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-ink-100 px-3 py-1">
                      <Database className="size-3.5" aria-hidden />
                      UAU:{' '}
                      {lookup.data.uau.error ? (
                        <span className="text-warning">não consultado ({lookup.data.uau.error})</span>
                      ) : lookup.data.uau.found ? (
                        <span className="font-medium text-info">já existe (código {lookup.data.uau.codPes})</span>
                      ) : (
                        <span className="font-medium text-success">não cadastrado</span>
                      )}
                    </span>
                  </div>
                  {lookup.data.uau.found && (
                    <p className="text-sm text-text-muted">Na aprovação, o app vai usar o código existente no UAU em vez de criar outra pessoa, e anexar os documentos nela.</p>
                  )}
                </div>
              )}
            </CardBody>
          </Card>

          {lookup.data?.company && (
            <Card>
              <CardHeader title="Dados da Receita Federal" description="Consulta em tempo real" />
              <CardBody>
                <CompanyCard company={lookup.data.company} />
              </CardBody>
            </Card>
          )}
          {lookup.data && kind === 'PJ' && !lookup.data.company && (
            <Alert tone={lookup.data.companyError ? 'warning' : 'error'} title={lookup.data.companyError ? 'Receita indisponível' : 'CNPJ não encontrado na Receita'}>
              {lookup.data.companyError ?? 'Confira o número. Se estiver certo, a análise de risco vai apontar o problema.'}
            </Alert>
          )}
        </div>

        <Card className="h-fit lg:sticky lg:top-24">
          <CardHeader title="2. Dados da solicitação" />
          <CardBody className="space-y-4">
            <Field label="Modelo de fornecedor" required hint="Define quais documentos o fornecedor vai enviar.">
              <Select value={modelId} onChange={(e) => setModelId(e.target.value)}>
                <option value="">Escolha…</option>
                {options.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </Select>
            </Field>
            {modelId && (
              <ul className="space-y-1 rounded-control bg-ink-50 px-3 py-2 text-xs text-ink-700">
                {options
                  .find((m) => m.id === modelId)
                  ?.requirements.map((r) => (
                    <li key={r.documentTypeId} className="flex items-center gap-1.5">
                      <CheckCircle2 className={r.required ? 'size-3.5 text-primary' : 'size-3.5 text-ink-400'} aria-hidden />
                      {r.name}
                      {!r.required && <span className="text-text-muted">(opcional)</span>}
                    </li>
                  ))}
              </ul>
            )}
            <Field label="E-mail do fornecedor" required hint="Para onde vai o link de cadastro.">
              <Input type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} placeholder="contato@empresa.com.br" />
            </Field>
            <Field label="Nome do contato">
              <Input value={contactName} onChange={(e) => setContactName(e.target.value)} />
            </Field>
            <Field label="Obra / centro de custo">
              <Input value={workName} onChange={(e) => setWorkName(e.target.value)} />
            </Field>
            <Field label="Por que precisamos deste fornecedor?">
              <Textarea value={justification} onChange={(e) => setJustification(e.target.value)} rows={3} />
            </Field>
            <Field label="Urgência">
              <Select value={urgency} onChange={(e) => setUrgency(e.target.value as Urgency)}>
                {URGENCIES.map((u) => (
                  <option key={u} value={u}>
                    {URGENCY_LABELS[u]}
                  </option>
                ))}
              </Select>
            </Field>
            {can(PERMISSIONS.requestAnalyze) && (
              <label className="flex items-start gap-2 text-sm text-ink-700">
                <input type="checkbox" checked={sendInvite} onChange={(e) => setSendInvite(e.target.checked)} className="mt-1 accent-primary" />
                Já enviar o link de cadastro ao fornecedor
              </label>
            )}
            {create.isError && <Alert tone="error">{errorMessage(create.error)}</Alert>}
            <Button variant="primary" className="w-full" disabled={!canSubmit} loading={create.isPending} onClick={() => create.mutate()} icon={sendInvite ? <Send className="size-4" /> : <Building2 className="size-4" />}>
              {sendInvite ? 'Abrir e enviar convite' : 'Abrir solicitação'}
            </Button>
            {kind && <p className="text-center text-xs text-text-muted">{formatDocument(digits)}</p>}
          </CardBody>
        </Card>
      </div>
    </>
  )
}
