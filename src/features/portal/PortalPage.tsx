/**
 * Portal do fornecedor: abre pelo link do e-mail, confirma com código e preenche ficha + documentos.
 * Não usa o layout da equipe nem exige conta.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, LockKeyhole, Mail, Save, Send } from 'lucide-react'
import type { PortalDataDTO, PortalStateDTO } from '@shared/contracts'
import { documentChecklist } from '@shared/domain/documents'
import { moduleOfKind, type Module } from '@shared/domain/modules'
import { statusLabel, terms } from '@shared/domain/terms'
import { useShowModule } from '@/app/module'
import { ACCOUNT_TYPES, MARITAL_STATUSES, PIX_TYPES, SEXES, supplierProfileSchema, UFS } from '@shared/domain/supplier'
import logo from '@/assets/brand/logo-unita.png'
import logoWhite from '@/assets/brand/logo-unita-white.png'
import { DocumentList, type UploadValues } from '@/components/domain/DocumentList'
import { Alert, Button, Card, CardBody, CardHeader, Field, Input, Select, Skeleton, Spinner } from '@/components/ui'
import { api, ApiError, errorMessage, upload } from '@/lib/api'
import { formatDateTime, formatDocument } from '@/utils/format'

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

type Profile = Record<string, unknown> & { address?: Record<string, unknown>; bank?: Record<string, unknown> | null; pix?: Record<string, unknown> | null }

function Shell({ children, module = 'pj' }: { children: ReactNode; module?: Module }) {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b-2 border-primary bg-secondary">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4">
          <img src={logoWhite} alt="Unità Engenharia" className="h-8" />
          <span className="text-sm text-ink-300">{cap(terms(module).registration)}</span>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
    </div>
  )
}

function CodeStep({ token, state, onVerified }: { token: string; state: PortalStateDTO; onVerified: () => void }) {
  const [code, setCode] = useState('')
  const [sent, setSent] = useState(false)
  const send = useMutation({ mutationFn: () => api(`/portal/link/${token}/code`, { method: 'POST' }), onSuccess: () => setSent(true) })
  const verify = useMutation({ mutationFn: () => api(`/portal/link/${token}/verify`, { method: 'POST', body: { code } }), onSuccess: onVerified })
  return (
    <Card className="mx-auto max-w-md p-8">
      <img src={logo} alt="" className="h-10" />
      <p className="mt-6 text-xs font-semibold tracking-wider text-primary uppercase">Acesso seguro</p>
      <h1 className="mt-1 text-xl font-semibold">{state.companyName}</h1>
      <p className="mt-2 text-sm text-text-muted">
        Para proteger seus dados, enviamos um código de 6 dígitos para <b>{state.emailHint}</b>.
      </p>
      {!sent ? (
        <Button variant="primary" className="mt-6 w-full" icon={<Mail className="size-4" />} loading={send.isPending} onClick={() => send.mutate()}>
          Enviar código
        </Button>
      ) : (
        <form
          className="mt-6 space-y-3"
          onSubmit={(e) => {
            e.preventDefault()
            verify.mutate()
          }}
        >
          <Field label="Código recebido por e-mail">
            <Input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" autoFocus className="tabular text-center text-xl tracking-[0.4em]" />
          </Field>
          <Button type="submit" variant="primary" className="w-full" icon={<LockKeyhole className="size-4" />} disabled={code.length !== 6} loading={verify.isPending}>
            Entrar
          </Button>
          <button type="button" className="w-full text-center text-xs text-text-muted hover:text-primary" onClick={() => send.mutate()} disabled={send.isPending}>
            Não recebeu? Enviar de novo
          </button>
        </form>
      )}
      {(send.isError || verify.isError) && (
        <Alert tone="error" className="mt-4">
          {errorMessage(send.error ?? verify.error)}
        </Alert>
      )}
    </Card>
  )
}

function ProfileForm({ data, onSaved }: { data: PortalDataDTO; onSaved: (d: PortalDataDTO) => void }) {
  const [p, setP] = useState<Profile>(() => ({ bank: null, pix: null, ...data.profile }))
  const [touched, setTouched] = useState(false)
  const addr = (p.address ?? {}) as Record<string, string>
  const bank = (p.bank ?? null) as Record<string, string | number> | null
  const pix = (p.pix ?? null) as Record<string, string> | null
  const disabled = !data.canEdit

  const set = (k: string, v: unknown) => setP((x) => ({ ...x, [k]: v }))
  const setAddr = (k: string, v: string) => setP((x) => ({ ...x, address: { ...(x.address ?? {}), [k]: v } }))
  // Pessoa física: nascimento, sexo, estado civil e RG (vão para o UAU)
  const person = (p.person ?? {}) as Record<string, string>
  const setPerson = (k: string, v: string) => setP((x) => ({ ...x, person: { ...((x.person as object) ?? {}), [k]: v } }))
  const setBank = (k: string, v: unknown) => setP((x) => ({ ...x, bank: { ...(x.bank ?? { accountType: 0 }), [k]: v } }))

  const parsed = useMemo(() => supplierProfileSchema.safeParse({ ...p, document: data.document }), [p, data.document])
  const errors = useMemo(() => {
    const m = new Map<string, string>()
    if (!parsed.success) for (const i of parsed.error.issues) m.set(i.path.join('.'), i.message)
    return m
  }, [parsed])
  const err = (k: string) => (touched ? (errors.get(k) ?? null) : null)

  // CEP → endereço (BrasilAPI pelo nosso servidor)
  const cep = String(addr.cep ?? '').replace(/\D/g, '')
  useEffect(() => {
    if (cep.length !== 8 || disabled) return
    let alive = true
    api<{ street: string | null; district: string | null; city: string | null; uf: string | null }>(`/portal/cep/${cep}`)
      .then((r) => {
        if (!alive || !r.city) return
        setP((x) => {
          const a = (x.address ?? {}) as Record<string, string>
          return { ...x, address: { ...a, street: a.street || r.street || '', district: a.district || r.district || '', city: r.city ?? a.city, uf: r.uf ?? a.uf } }
        })
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [cep, disabled])

  const save = useMutation({ mutationFn: () => api<PortalDataDTO>('/portal/me/profile', { method: 'PUT', body: { profile: p } }), onSuccess: onSaved })

  return (
    <Card>
      <CardHeader title="1. Dados cadastrais" description={data.personKind === 'PF' ? 'Preencha seus dados pessoais; eles vão para o cadastro da Unità.' : 'Conferimos com a Receita Federal; ajuste o que estiver diferente.'} actions={data.canEdit && <Button size="sm" icon={<Save className="size-4" />} loading={save.isPending} onClick={() => (setTouched(true), save.mutate())}>Salvar rascunho</Button>} />
      <CardBody className="space-y-6">
        <fieldset disabled={disabled} className="grid gap-4 sm:grid-cols-2">
          <Field label={data.personKind === 'PJ' ? 'CNPJ' : 'CPF'}>
            <Input value={formatDocument(data.document)} disabled />
          </Field>
          <Field label={data.personKind === 'PJ' ? 'Razão social' : 'Nome completo'} required error={err('legalName')}>
            <Input value={String(p.legalName ?? '')} onChange={(e) => set('legalName', e.target.value)} />
          </Field>
          {data.personKind === 'PF' && (
            <>
              <Field label="Data de nascimento" required error={err('person.birthDate') ?? err('person')}>
                <Input type="date" value={person.birthDate ?? ''} onChange={(e) => setPerson('birthDate', e.target.value)} />
              </Field>
              <Field label="Sexo" required error={err('person.sex')}>
                <Select value={person.sex ?? ''} onChange={(e) => setPerson('sex', e.target.value)}>
                  <option value="">Escolha…</option>
                  {Object.entries(SEXES).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Estado civil" required error={err('person.maritalStatus')}>
                <Select value={person.maritalStatus ?? ''} onChange={(e) => setPerson('maritalStatus', e.target.value)}>
                  <option value="">Escolha…</option>
                  {Object.entries(MARITAL_STATUSES).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="RG (número)" required error={err('person.rgNumber')}>
                <Input value={person.rgNumber ?? ''} onChange={(e) => setPerson('rgNumber', e.target.value)} />
              </Field>
              <div className="grid grid-cols-[1fr_96px] gap-2">
                <Field label="Órgão emissor" required error={err('person.rgIssuer')}>
                  <Input value={person.rgIssuer ?? ''} onChange={(e) => setPerson('rgIssuer', e.target.value)} placeholder="SSP" />
                </Field>
                <Field label="UF do RG" required error={err('person.rgUf')}>
                  <Select value={person.rgUf ?? ''} onChange={(e) => setPerson('rgUf', e.target.value)}>
                    <option value="">UF</option>
                    {UFS.map((u) => (
                      <option key={u} value={u}>
                        {u}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
            </>
          )}
          {data.personKind === 'PJ' && (
            <>
              <Field label="Nome fantasia">
                <Input value={String(p.tradeName ?? '')} onChange={(e) => set('tradeName', e.target.value)} />
              </Field>
              <Field label="Inscrição estadual">
                <Input value={String(p.stateRegistration ?? '')} onChange={(e) => set('stateRegistration', e.target.value)} />
              </Field>
              <Field label="Inscrição municipal">
                <Input value={String(p.municipalRegistration ?? '')} onChange={(e) => set('municipalRegistration', e.target.value)} />
              </Field>
              <Field label="Optante pelo Simples Nacional?">
                <Select value={p.simplesNacional === true ? 'sim' : p.simplesNacional === false ? 'nao' : ''} onChange={(e) => set('simplesNacional', e.target.value === '' ? null : e.target.value === 'sim')}>
                  <option value="">Não sei</option>
                  <option value="sim">Sim</option>
                  <option value="nao">Não</option>
                </Select>
              </Field>
            </>
          )}
          <Field label="E-mail" required error={err('email')}>
            <Input type="email" value={String(p.email ?? '')} onChange={(e) => set('email', e.target.value)} />
          </Field>
          <div className="grid grid-cols-[80px_1fr] gap-2">
            <Field label="DDD" required error={err('phoneDdd')}>
              <Input value={String(p.phoneDdd ?? '')} onChange={(e) => set('phoneDdd', e.target.value)} inputMode="numeric" maxLength={2} />
            </Field>
            <Field label="Telefone" required error={err('phoneNumber')}>
              <Input value={String(p.phoneNumber ?? '')} onChange={(e) => set('phoneNumber', e.target.value)} inputMode="numeric" />
            </Field>
          </div>
          <Field label="Pessoa de contato">
            <Input value={String(p.contactName ?? '')} onChange={(e) => set('contactName', e.target.value)} />
          </Field>
          <Field label="Site">
            <Input value={String(p.website ?? '')} onChange={(e) => set('website', e.target.value)} />
          </Field>
        </fieldset>

        <fieldset disabled={disabled}>
          <legend className="mb-3 text-sm font-semibold">Endereço</legend>
          <div className="grid gap-4 sm:grid-cols-6">
            <Field label="CEP" required error={err('address.cep')} className="sm:col-span-2">
              <Input value={String(addr.cep ?? '')} onChange={(e) => setAddr('cep', e.target.value)} inputMode="numeric" maxLength={9} />
            </Field>
            <Field label="Logradouro" required error={err('address.street')} className="sm:col-span-4">
              <Input value={String(addr.street ?? '')} onChange={(e) => setAddr('street', e.target.value)} />
            </Field>
            <Field label="Número" required error={err('address.number')} className="sm:col-span-2">
              <Input value={String(addr.number ?? '')} onChange={(e) => setAddr('number', e.target.value)} />
            </Field>
            <Field label="Complemento" className="sm:col-span-4">
              <Input value={String(addr.complement ?? '')} onChange={(e) => setAddr('complement', e.target.value)} />
            </Field>
            <Field label="Bairro" required error={err('address.district')} className="sm:col-span-2">
              <Input value={String(addr.district ?? '')} onChange={(e) => setAddr('district', e.target.value)} />
            </Field>
            <Field label="Cidade" required error={err('address.city')} className="sm:col-span-3">
              <Input value={String(addr.city ?? '')} onChange={(e) => setAddr('city', e.target.value)} />
            </Field>
            <Field label="UF" required error={err('address.uf')} className="sm:col-span-1">
              <Select value={String(addr.uf ?? '')} onChange={(e) => setAddr('uf', e.target.value)}>
                <option value=""></option>
                {UFS.map((u) => (
                  <option key={u}>{u}</option>
                ))}
              </Select>
            </Field>
          </div>
        </fieldset>

        <fieldset disabled={disabled}>
          <legend className="mb-3 text-sm font-semibold">Dados para pagamento</legend>
          <label className="mb-3 flex items-center gap-2 text-sm">
            <input type="checkbox" className="accent-primary" checked={!!bank} onChange={(e) => set('bank', e.target.checked ? { accountType: 0 } : null)} /> Informar conta bancária
          </label>
          {bank && (
            <div className="grid gap-4 sm:grid-cols-4">
              <Field label="Código do banco" required error={err('bank.bankCode')} hint="Ex.: 341, 001, 237">
                <Input value={String(bank.bankCode ?? '')} onChange={(e) => setBank('bankCode', e.target.value)} inputMode="numeric" maxLength={3} />
              </Field>
              <Field label="Agência" required error={err('bank.agency')}>
                <Input value={String(bank.agency ?? '')} onChange={(e) => setBank('agency', e.target.value)} />
              </Field>
              <Field label="Conta com dígito" required error={err('bank.account')}>
                <Input value={String(bank.account ?? '')} onChange={(e) => setBank('account', e.target.value)} />
              </Field>
              <Field label="Tipo">
                <Select value={String(bank.accountType ?? 0)} onChange={(e) => setBank('accountType', Number(e.target.value))}>
                  {Object.entries(ACCOUNT_TYPES).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          )}
          <label className="mt-4 mb-3 flex items-center gap-2 text-sm">
            <input type="checkbox" className="accent-primary" checked={!!pix} onChange={(e) => set('pix', e.target.checked ? { type: 'cpf_cnpj', key: data.document } : null)} /> Informar chave Pix
          </label>
          {pix && (
            <div className="grid gap-4 sm:grid-cols-[200px_1fr]">
              <Field label="Tipo da chave">
                <Select value={pix.type} onChange={(e) => set('pix', { ...pix, type: e.target.value })}>
                  {Object.entries(PIX_TYPES).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Chave" error={err('pix.key')}>
                <Input value={pix.key ?? ''} onChange={(e) => set('pix', { ...pix, key: e.target.value })} />
              </Field>
            </div>
          )}
        </fieldset>
        {save.isError && <Alert tone="error">{errorMessage(save.error)}</Alert>}
        {save.isSuccess && !save.isPending && <p className="text-sm text-success">Rascunho salvo.</p>}
        <SubmitBar data={data} profile={p} valid={parsed.success} onTouched={() => setTouched(true)} onSaved={onSaved} />
      </CardBody>
    </Card>
  )
}

function SubmitBar({ data, profile, valid, onTouched, onSaved }: { data: PortalDataDTO; profile: Profile; valid: boolean; onTouched: () => void; onSaved: (d: PortalDataDTO) => void }) {
  const check = documentChecklist(data.requirements, data.documents)
  const missing = check.missing.length + check.rejected.length
  const submit = useMutation({
    mutationFn: async () => {
      await api('/portal/me/profile', { method: 'PUT', body: { profile } })
      return api<PortalDataDTO>('/portal/me/submit', { method: 'POST' })
    },
    onSuccess: onSaved,
  })
  if (!data.canEdit) return null
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-control border border-primary/30 bg-primary-soft px-4 py-3">
      <p className="text-sm text-ink-700">
        {!valid ? 'Complete os campos obrigatórios.' : missing ? `Falta(m) ${missing} documento(s) obrigatório(s) na seção 2.` : 'Tudo pronto para enviar.'}
      </p>
      <Button
        variant="primary"
        icon={<Send className="size-4" />}
        loading={submit.isPending}
        onClick={() => {
          onTouched()
          if (valid) submit.mutate()
        }}
      >
        Enviar para análise
      </Button>
      {submit.isError && <Alert tone="error" className="w-full">{errorMessage(submit.error)}</Alert>}
    </div>
  )
}

export default function PortalPage() {
  const { token = '' } = useParams()
  const qc = useQueryClient()
  const state = useQuery({ queryKey: ['portal-state', token], queryFn: () => api<PortalStateDTO>(`/portal/link/${token}`), retry: false })
  const ready = state.data?.stage === 'ready'
  const data = useQuery({ queryKey: ['portal-data'], queryFn: () => api<PortalDataDTO>('/portal/me'), enabled: ready, retry: false })
  const setData = (d: PortalDataDTO) => qc.setQueryData(['portal-data'], d)
  // PF fala de "pessoa", não de "fornecedor" (também nos componentes de documentos)
  const module = moduleOfKind(data.data?.personKind ?? state.data?.personKind ?? 'PJ')
  useShowModule(state.data ? module : null)
  const t = terms(module)

  if (state.isLoading)
    return (
      <Shell module={module}>
        <div className="flex justify-center py-20 text-primary">
          <Spinner />
        </div>
      </Shell>
    )
  if (state.isError)
    return (
      <Shell module={module}>
        <Alert tone="error" title="Link indisponível" className="mx-auto max-w-lg">
          {errorMessage(state.error)}
        </Alert>
      </Shell>
    )
  if (!ready) return <Shell module={module}>{state.data && <CodeStep token={token} state={state.data} onVerified={() => void state.refetch()} />}</Shell>
  if (data.isError) {
    const expired = data.error instanceof ApiError && data.error.status === 401
    return (
      <Shell module={module}>
        <Alert tone="error" className="mx-auto max-w-lg">
          {expired ? 'Sua sessão expirou. Recarregue a página para receber um novo código.' : errorMessage(data.error)}
        </Alert>
      </Shell>
    )
  }
  if (!data.data)
    return (
      <Shell module={module}>
        <Skeleton className="h-96" />
      </Shell>
    )
  const d = data.data

  return (
    <Shell module={module}>
      <p className="text-xs font-semibold tracking-wider text-primary uppercase">Solicitação nº {d.requestNumber}</p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">{state.data?.companyName}</h1>
      <p className="mt-1 text-sm text-text-muted">
        {cap(t.registration)} · {d.modelName} · situação: <b>{statusLabel(d.status, module)}</b>
      </p>

      <div className="mt-6 space-y-6">
        {d.pendingNote && d.canEdit && (
          <Alert tone="warning" title="A Unità pediu ajustes">
            {d.pendingNote}
          </Alert>
        )}
        {!d.canEdit && (
          <Alert tone="success" title="Cadastro enviado">
            Recebemos seus dados {d.submittedAt ? `em ${formatDateTime(d.submittedAt)}` : ''}. {module === 'pf' ? 'A equipe da Unità' : 'A equipe de suprimentos'} vai analisar e, se precisar de algo, você recebe um novo e-mail.
          </Alert>
        )}

        <ProfileForm data={d} onSaved={setData} />

        <Card>
          <CardHeader title="2. Documentos" description="Envie PDF ou imagem legível. Cada envio substitui o anterior do mesmo tipo." />
          <CardBody>
            <DocumentList
              requirements={d.requirements}
              documents={d.documents}
              fileUrl={(doc) => `/api/portal/me/documents/${doc.id}/file`}
              onUpload={
                d.canEdit
                  ? async (v: UploadValues) => setData(await upload<PortalDataDTO>('/portal/me/documents', { file: v.file, documentTypeId: v.documentTypeId, issuedAt: v.issuedAt, expiresAt: v.expiresAt }))
                  : undefined
              }
            />
          </CardBody>
        </Card>

        <p className="flex items-center justify-center gap-2 text-center text-xs text-text-muted">
          <CheckCircle2 className="size-4 text-success" /> Seus dados são usados só para o {t.registration} da Unità Engenharia (LGPD).
        </p>
      </div>
    </Shell>
  )
}
