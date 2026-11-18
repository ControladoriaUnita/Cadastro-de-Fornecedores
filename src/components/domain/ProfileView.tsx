/**
 * Ficha cadastral preenchida pelo fornecedor (somente leitura).
 */
import { ACCOUNT_TYPES, PIX_TYPES } from '@shared/domain/supplier'
import { EmptyState } from '@/components/ui'
import { formatCnae, formatDocument } from '@/utils/format'

type P = Record<string, unknown>
const s = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v) : '')

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium text-text-muted">{label}</dt>
      <dd className="mt-0.5 text-sm break-words">{value || '—'}</dd>
    </div>
  )
}

export function ProfileView({ profile }: { profile: P }) {
  if (!Object.keys(profile).length || !profile.legalName) {
    return <EmptyState title="Ficha ainda não preenchida" description="O fornecedor preenche pelo link enviado por e-mail." />
  }
  const a = (profile.address ?? {}) as P
  const b = profile.bank as P | null
  const pix = profile.pix as P | null
  const cep = s(a.cep).replace(/^(\d{5})(\d{3})$/, '$1-$2')
  return (
    <div className="space-y-6">
      <section>
        <h3 className="mb-3 font-sans text-sm font-semibold">Empresa</h3>
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
          <Item label="CNPJ/CPF" value={formatDocument(s(profile.document))} />
          <Item label="Razão social / nome" value={s(profile.legalName)} />
          <Item label="Nome fantasia" value={s(profile.tradeName)} />
          <Item label="Inscrição estadual" value={s(profile.stateRegistration)} />
          <Item label="Inscrição municipal" value={s(profile.municipalRegistration)} />
          <Item label="CNAE principal" value={profile.mainCnae ? formatCnae(s(profile.mainCnae)) : ''} />
          <Item label="Simples Nacional" value={profile.simplesNacional === true ? 'Sim' : profile.simplesNacional === false ? 'Não' : ''} />
        </dl>
      </section>
      <section>
        <h3 className="mb-3 font-sans text-sm font-semibold">Contato e endereço</h3>
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
          <Item label="E-mail" value={s(profile.email)} />
          <Item label="Telefone" value={profile.phoneDdd ? `(${s(profile.phoneDdd)}) ${s(profile.phoneNumber)}` : ''} />
          <Item label="Contato" value={s(profile.contactName)} />
          <Item label="Site" value={s(profile.website)} />
          <Item label="Endereço" value={[s(a.street), s(a.number), s(a.complement)].filter(Boolean).join(', ')} />
          <Item label="Bairro / cidade" value={[s(a.district), a.city ? `${s(a.city)}/${s(a.uf)}` : ''].filter(Boolean).join(' · ')} />
          <Item label="CEP" value={cep} />
        </dl>
      </section>
      <section>
        <h3 className="mb-3 font-sans text-sm font-semibold">Pagamento</h3>
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
          <Item label="Banco" value={b ? `${s(b.bankCode)}${b.bankName ? ` · ${s(b.bankName)}` : ''}` : ''} />
          <Item label="Agência / conta" value={b ? `${s(b.agency)} / ${s(b.account)}` : ''} />
          <Item label="Tipo de conta" value={b ? (ACCOUNT_TYPES[Number(b.accountType) as keyof typeof ACCOUNT_TYPES] ?? '') : ''} />
          <Item label="Pix" value={pix ? `${PIX_TYPES[pix.type as keyof typeof PIX_TYPES] ?? ''}: ${s(pix.key)}` : ''} />
        </dl>
      </section>
    </div>
  )
}
