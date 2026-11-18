/**
 * Análise de risco: regras fixas no código, gravidade e parâmetros configuráveis no Painel dev.
 *
 *  bloqueio → impede enviar para aprovação
 *  alerta   → aparece para o analista e o aprovador, mas não impede
 *  desligada → não é avaliada
 */

export const RISK_SEVERITIES = ['bloqueio', 'alerta', 'desligada'] as const
export type RiskSeverity = (typeof RISK_SEVERITIES)[number]

export const SEVERITY_LABELS: Record<RiskSeverity, string> = { bloqueio: 'Bloqueia', alerta: 'Alerta', desligada: 'Desligada' }

export const RISK_RULE_KEYS = [
  'cnpj_nao_ativo',
  'sancao_ceis',
  'sancao_cnep',
  'empresa_recente',
  'capital_social_baixo',
  'optante_mei',
  'cnae_divergente_modelo',
  'documentos_vencidos',
] as const
export type RiskRuleKey = (typeof RISK_RULE_KEYS)[number]

export interface RiskRuleDefinition {
  key: RiskRuleKey
  label: string
  description: string
  defaultSeverity: RiskSeverity
  /** Parâmetro numérico opcional (ex.: meses, valor em R$) */
  param?: { label: string; default: number; unit: string }
}

export const RISK_RULES: Record<RiskRuleKey, RiskRuleDefinition> = {
  cnpj_nao_ativo: {
    key: 'cnpj_nao_ativo',
    label: 'CNPJ não está ativo na Receita',
    description: 'Situação cadastral diferente de ATIVA (baixada, inapta, suspensa, nula).',
    defaultSeverity: 'bloqueio',
  },
  sancao_ceis: {
    key: 'sancao_ceis',
    label: 'Sanção no CEIS',
    description: 'Consta no Cadastro de Empresas Inidôneas e Suspensas (Portal da Transparência).',
    defaultSeverity: 'bloqueio',
  },
  sancao_cnep: {
    key: 'sancao_cnep',
    label: 'Sanção no CNEP',
    description: 'Consta no Cadastro Nacional de Empresas Punidas (Lei Anticorrupção).',
    defaultSeverity: 'bloqueio',
  },
  empresa_recente: {
    key: 'empresa_recente',
    label: 'Empresa aberta há pouco tempo',
    description: 'Data de abertura mais recente que o limite.',
    defaultSeverity: 'alerta',
    param: { label: 'Meses mínimos de atividade', default: 12, unit: 'meses' },
  },
  capital_social_baixo: {
    key: 'capital_social_baixo',
    label: 'Capital social baixo',
    description: 'Capital social declarado abaixo do limite.',
    defaultSeverity: 'alerta',
    param: { label: 'Capital social mínimo', default: 10000, unit: 'R$' },
  },
  optante_mei: {
    key: 'optante_mei',
    label: 'Microempreendedor individual (MEI)',
    description: 'Empresa optante pelo MEI (limite de faturamento e de funcionários).',
    defaultSeverity: 'alerta',
  },
  cnae_divergente_modelo: {
    key: 'cnae_divergente_modelo',
    label: 'Atividade (CNAE) fora do esperado para o modelo',
    description: 'Nenhum CNAE da empresa começa com os prefixos esperados no modelo de fornecedor.',
    defaultSeverity: 'alerta',
  },
  documentos_vencidos: {
    key: 'documentos_vencidos',
    label: 'Documento obrigatório vencido',
    description: 'Algum documento obrigatório do modelo está com a validade vencida.',
    defaultSeverity: 'alerta',
  },
}

export interface RiskRuleConfig {
  key: RiskRuleKey
  severity: RiskSeverity
  param: number | null
}

export function defaultRuleConfigs(): RiskRuleConfig[] {
  return RISK_RULE_KEYS.map((key) => ({ key, severity: RISK_RULES[key].defaultSeverity, param: RISK_RULES[key].param?.default ?? null }))
}

/** Dados que as regras consultam (vindos da Receita, do Portal da Transparência e do app). */
export interface RiskFacts {
  situacaoCadastral: string | null
  dataAbertura: string | null
  capitalSocial: number | null
  mei: boolean | null
  cnaes: string[]
  /** null = consulta não realizada (sem chave ou fora do ar) */
  ceis: { count: number } | null
  cnep: { count: number } | null
  expectedCnaePrefixes: string[]
  expiredRequiredDocuments: number
}

export type RiskLevel = 'baixo' | 'medio' | 'alto' | 'nao_avaliado'
export const RISK_LEVEL_LABELS: Record<RiskLevel, string> = { baixo: 'Baixo', medio: 'Médio', alto: 'Alto', nao_avaliado: 'Não avaliado' }

export interface RiskFinding {
  key: RiskRuleKey
  severity: Exclude<RiskSeverity, 'desligada'>
  /** hit = regra disparou · ok = passou · unchecked = sem dado para avaliar */
  outcome: 'hit' | 'ok' | 'unchecked'
  message: string
}

function monthsBetween(fromIso: string, to: Date): number {
  const from = new Date(fromIso)
  return (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth())
}

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

function evaluateRule(cfg: RiskRuleConfig, f: RiskFacts, today: Date): Omit<RiskFinding, 'key' | 'severity'> {
  switch (cfg.key) {
    case 'cnpj_nao_ativo':
      if (!f.situacaoCadastral) return { outcome: 'unchecked', message: 'Situação cadastral não consultada.' }
      return f.situacaoCadastral.toUpperCase() === 'ATIVA'
        ? { outcome: 'ok', message: 'CNPJ ativo na Receita.' }
        : { outcome: 'hit', message: `Situação cadastral: ${f.situacaoCadastral}.` }
    case 'sancao_ceis':
      if (!f.ceis) return { outcome: 'unchecked', message: 'CEIS não consultado (configure a chave do Portal da Transparência).' }
      return f.ceis.count ? { outcome: 'hit', message: `${f.ceis.count} registro(s) no CEIS.` } : { outcome: 'ok', message: 'Nada consta no CEIS.' }
    case 'sancao_cnep':
      if (!f.cnep) return { outcome: 'unchecked', message: 'CNEP não consultado (configure a chave do Portal da Transparência).' }
      return f.cnep.count ? { outcome: 'hit', message: `${f.cnep.count} registro(s) no CNEP.` } : { outcome: 'ok', message: 'Nada consta no CNEP.' }
    case 'empresa_recente': {
      if (!f.dataAbertura) return { outcome: 'unchecked', message: 'Data de abertura desconhecida.' }
      const months = monthsBetween(f.dataAbertura, today)
      const min = cfg.param ?? 12
      return months < min
        ? { outcome: 'hit', message: `Aberta há ${months} mês(es); mínimo ${min}.` }
        : { outcome: 'ok', message: `Aberta há ${Math.floor(months / 12)} ano(s).` }
    }
    case 'capital_social_baixo': {
      if (f.capitalSocial === null) return { outcome: 'unchecked', message: 'Capital social desconhecido.' }
      const min = cfg.param ?? 0
      return f.capitalSocial < min
        ? { outcome: 'hit', message: `Capital social ${brl(f.capitalSocial)} (mínimo ${brl(min)}).` }
        : { outcome: 'ok', message: `Capital social ${brl(f.capitalSocial)}.` }
    }
    case 'optante_mei':
      if (f.mei === null) return { outcome: 'unchecked', message: 'Opção pelo MEI desconhecida.' }
      return f.mei ? { outcome: 'hit', message: 'Empresa optante pelo MEI.' } : { outcome: 'ok', message: 'Não é MEI.' }
    case 'cnae_divergente_modelo': {
      if (!f.expectedCnaePrefixes.length) return { outcome: 'ok', message: 'Modelo sem restrição de CNAE.' }
      if (!f.cnaes.length) return { outcome: 'unchecked', message: 'CNAEs da empresa desconhecidos.' }
      const match = f.cnaes.some((c) => f.expectedCnaePrefixes.some((p) => c.replace(/\D/g, '').startsWith(p.replace(/\D/g, ''))))
      return match ? { outcome: 'ok', message: 'Atividade compatível com o modelo.' } : { outcome: 'hit', message: 'Nenhum CNAE compatível com o modelo.' }
    }
    case 'documentos_vencidos':
      return f.expiredRequiredDocuments
        ? { outcome: 'hit', message: `${f.expiredRequiredDocuments} documento(s) obrigatório(s) vencido(s).` }
        : { outcome: 'ok', message: 'Nenhum documento obrigatório vencido.' }
  }
}

export function evaluateRisk(configs: RiskRuleConfig[], facts: RiskFacts, today = new Date()): { level: RiskLevel; findings: RiskFinding[]; blocked: boolean } {
  const findings: RiskFinding[] = configs
    .filter((c) => c.severity !== 'desligada')
    .map((c) => ({ key: c.key, severity: c.severity as RiskFinding['severity'], ...evaluateRule(c, facts, today) }))
  const hits = findings.filter((f) => f.outcome === 'hit')
  const blocked = hits.some((f) => f.severity === 'bloqueio')
  const level: RiskLevel = blocked ? 'alto' : hits.length ? 'medio' : findings.every((f) => f.outcome === 'unchecked') ? 'nao_avaliado' : 'baixo'
  return { level, findings, blocked }
}
