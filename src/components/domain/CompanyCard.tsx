/**
 * Dados públicos da Receita Federal (resultado da busca por CNPJ).
 */
import type { CompanyDTO } from '@shared/contracts'
import { Badge } from '@/components/ui'
import { formatCnae, formatDate, formatDocument, formatMoney } from '@/utils/format'

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium text-text-muted">{label}</dt>
      <dd className="mt-0.5 text-sm break-words text-text">{value || '—'}</dd>
    </div>
  )
}

export function CompanyCard({ company }: { company: CompanyDTO }) {
  const active = company.situacaoCadastral?.toUpperCase() === 'ATIVA'
  const e = company.endereco
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-display text-lg font-semibold">{company.razaoSocial}</p>
        <Badge tone={active ? 'success' : 'error'}>{company.situacaoCadastral ?? 'Situação desconhecida'}</Badge>
        {company.mei && <Badge tone="warning">MEI</Badge>}
        {company.simples && !company.mei && <Badge tone="info">Simples Nacional</Badge>}
      </div>
      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
        <Row label="CNPJ" value={formatDocument(company.cnpj)} />
        <Row label="Nome fantasia" value={company.nomeFantasia} />
        <Row label="Abertura" value={formatDate(company.dataAbertura)} />
        <Row label="Porte" value={company.porte} />
        <Row label="Capital social" value={formatMoney(company.capitalSocial)} />
        <Row label="Natureza jurídica" value={company.naturezaJuridica} />
        <Row label="Atividade principal" value={company.cnaePrincipal ? `${formatCnae(company.cnaePrincipal.codigo)} · ${company.cnaePrincipal.descricao}` : null} />
        <Row label="Endereço" value={[e.logradouro, e.numero, e.complemento, e.bairro, e.municipio && `${e.municipio}/${e.uf}`].filter(Boolean).join(', ')} />
        <Row label="Contato na Receita" value={[company.email, company.telefone].filter(Boolean).join(' · ')} />
      </dl>
      {company.socios.length > 0 && (
        <div>
          <p className="text-xs font-medium text-text-muted">Quadro societário</p>
          <ul className="mt-1 flex flex-wrap gap-2">
            {company.socios.map((s) => (
              <li key={s.nome} className="rounded-full bg-ink-100 px-3 py-1 text-xs text-ink-700">
                {s.nome}
                {s.qualificacao && <span className="text-text-muted"> · {s.qualificacao}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="text-xs text-text-muted">Fonte: {company.fonte}</p>
    </div>
  )
}
