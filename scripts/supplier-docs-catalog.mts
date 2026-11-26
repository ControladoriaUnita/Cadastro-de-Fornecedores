/**
 * Documentação exigida por tipo de fornecedor (módulo PJ).
 * Base: GRD — Guia de Remessa de Documentos rev. 06 (05/03/2026) e o padrão por tipo
 * de fornecedor (Materiais, Prestadores/Mão de obra, Laboratórios, Locação de equipamentos).
 *
 * CEIS e CNEP não entram como anexo: o app já consulta automaticamente (regras de risco),
 * assim como a verificação de optante pelo MEI.
 *
 * Usado por db-seed.mts (banco vazio) e db-docs-grd.mts (atualiza o banco existente).
 */

export type DocTypeSeed = { name: string; description: string; hasExpiry: boolean; defaultValidityDays?: number }
export type Req = { doc: string; required: boolean; instructions?: string }
export type ModelSeed = { name: string; description: string; personKind: string; cnae: string[]; reqs: Req[] }

export const DOC_TYPES: DocTypeSeed[] = [
  { name: 'Cartão CNPJ', description: 'Comprovante de inscrição e situação cadastral (Receita Federal), atualizado.', hasExpiry: false },
  { name: 'Contrato social / última alteração', description: 'Contrato social e suas últimas alterações.', hasExpiry: false },
  { name: 'CND Federal (Receita/PGFN)', description: 'Certidão de débitos relativos a tributos federais, dívida ativa da União e contribuições previdenciárias (INSS).', hasExpiry: true, defaultValidityDays: 180 },
  { name: 'CRF — FGTS', description: 'Certificado de regularidade do FGTS (Caixa), atualizado.', hasExpiry: true, defaultValidityDays: 30 },
  { name: 'CNDT — Débitos trabalhistas', description: 'Certidão negativa de débitos trabalhistas (TST).', hasExpiry: true, defaultValidityDays: 180 },
  { name: 'Certidão estadual', description: 'Regularidade com a Fazenda Estadual.', hasExpiry: true, defaultValidityDays: 90 },
  { name: 'Certidão municipal', description: 'Regularidade com a Fazenda Municipal.', hasExpiry: true, defaultValidityDays: 90 },
  { name: 'Comprovante bancário', description: 'Comprovante de titularidade da conta bancária da pessoa jurídica (cabeçalho de extrato ou declaração do banco).', hasExpiry: false },
  { name: 'Documento do responsável', description: 'RG ou CNH do sócio/representante legal.', hasExpiry: false },
  { name: 'CCMEI', description: 'Certificado da condição de microempreendedor individual.', hasExpiry: false },
  { name: 'Registro no CREA/CAU', description: 'Registro da empresa e do responsável técnico.', hasExpiry: true, defaultValidityDays: 365 },
  { name: 'Declaração de optante pelo Simples', description: 'Declaração de optante pelo Simples Nacional.', hasExpiry: false },
  { name: 'Verificação na Lista Suja do Trabalho Escravo (MTE)', description: 'Consulta ao Cadastro de Empregadores (Lista Suja) do Ministério do Trabalho e Emprego.', hasExpiry: true, defaultValidityDays: 30 },
  { name: 'Declaração de Não Alojamento', description: 'Declaração da empresa de que não haverá alojamento de colaboradores.', hasExpiry: false },
  { name: 'Seguro de vida', description: 'Apólice vigente com relação dos segurados, boleto e comprovante de pagamento, conforme CCT.', hasExpiry: true, defaultValidityDays: 365 },
  { name: 'Inventário de Riscos Ocupacionais (NR 01)', description: 'Inventário de riscos específico das atividades na obra, com as devidas assinaturas.', hasExpiry: true, defaultValidityDays: 365 },
  { name: 'PCMSO (NR 07)', description: 'Programa de Controle Médico de Saúde Ocupacional considerando os riscos do inventário (NR 01), com relação de exames e validade.', hasExpiry: true, defaultValidityDays: 365 },
  { name: 'Relatório analítico do PCMSO (NR 07)', description: 'Relação dos exames médicos realizados no período anual, com as devidas assinaturas.', hasExpiry: true, defaultValidityDays: 365 },
  { name: 'CEAT — TRT2 e TRT15', description: 'Certidão eletrônica de ações trabalhistas (distribuição de feitos) do TRT2 e do TRT15.', hasExpiry: true, defaultValidityDays: 30 },
  { name: 'Documentação técnica / garantia do produto', description: 'Ficha técnica, certificados ou termo de garantia do produto fornecido.', hasExpiry: false },
  { name: 'Habilitação técnica do laboratório', description: 'Comprovação da habilitação técnica (ex.: acreditação Inmetro/ISO 17025 ou registro no conselho de classe).', hasExpiry: true, defaultValidityDays: 365 },
  { name: 'Registro do responsável técnico', description: 'Registro do responsável técnico no conselho de classe (CREA, CRQ etc.).', hasExpiry: true, defaultValidityDays: 365 },
  { name: 'Relação dos equipamentos', description: 'Identificação dos equipamentos: tipo, marca, modelo e nº de série/chassi.', hasExpiry: false },
  { name: 'Comprovante de propriedade ou disponibilidade dos equipamentos', description: 'Nota fiscal, documento do equipamento ou contrato que comprove a propriedade ou disponibilidade.', hasExpiry: false },
  { name: 'Laudos, inspeções e manutenções dos equipamentos', description: 'Laudos técnicos, inspeções e registros de manutenção dos equipamentos.', hasExpiry: true, defaultValidityDays: 365 },
  { name: 'Seguro dos equipamentos', description: 'Apólice de seguro vigente dos equipamentos.', hasExpiry: true, defaultValidityDays: 365 },
]

/** Nomes antigos → novos (para o script que atualiza o banco existente). */
export const DOC_TYPE_RENAMES: Record<string, string> = { 'PGR / PCMSO': 'PCMSO (NR 07)' }
export const MODEL_RENAMES: Record<string, string> = { 'Empreiteiro / prestador de serviço de obra': 'Prestador de serviços / mão de obra' }

const CADASTRAIS: Req[] = [
  { doc: 'Cartão CNPJ', required: true },
  { doc: 'Contrato social / última alteração', required: true },
  { doc: 'Documento do responsável', required: true },
]
const FISCAIS: Req[] = [
  { doc: 'CND Federal (Receita/PGFN)', required: true },
  { doc: 'CRF — FGTS', required: true },
  { doc: 'CNDT — Débitos trabalhistas', required: true },
]
const BANCO: Req = { doc: 'Comprovante bancário', required: true, instructions: 'Conta em nome da pessoa jurídica.' }

/** Documentação de mobilização e SST da empresa (GRD, item 1). */
const SST_DOCS = [
  'Seguro de vida',
  'Inventário de Riscos Ocupacionais (NR 01)',
  'PCMSO (NR 07)',
  'Relatório analítico do PCMSO (NR 07)',
  'Declaração de Não Alojamento',
  'CEAT — TRT2 e TRT15',
]
const sstWhen = (instructions: string): Req[] => SST_DOCS.map((doc) => ({ doc, required: false, instructions }))

export const MODELS: ModelSeed[] = [
  {
    name: 'Fornecedor de materiais',
    description: 'Venda de materiais de construção e insumos. Fluxo de Suprimentos, Cadastro, Fiscal e Financeiro.',
    personKind: 'PJ',
    cnae: [],
    reqs: [
      ...CADASTRAIS,
      ...FISCAIS,
      { doc: 'Certidão estadual', required: false, instructions: 'Quando aplicável.' },
      BANCO,
      { doc: 'Documentação técnica / garantia do produto', required: false, instructions: 'Quando aplicável.' },
      ...sstWhen('Somente quando houver instalação ou montagem na obra vinculada ao fornecimento.'),
    ],
  },
  {
    name: 'Prestador de serviços / mão de obra',
    description: 'Empresas que mobilizam colaboradores na obra. Requisitos da GRD.',
    personKind: 'PJ',
    cnae: ['41', '42', '43'],
    reqs: [
      ...CADASTRAIS,
      { doc: 'CND Federal (Receita/PGFN)', required: true, instructions: 'Com vencimento de no mínimo 45 dias.' },
      { doc: 'CRF — FGTS', required: true },
      { doc: 'CNDT — Débitos trabalhistas', required: true },
      { doc: 'Certidão municipal', required: true },
      { doc: 'CEAT — TRT2 e TRT15', required: true },
      { doc: 'Declaração de optante pelo Simples', required: false, instructions: 'Caso seja optante.' },
      { doc: 'Verificação na Lista Suja do Trabalho Escravo (MTE)', required: true },
      { doc: 'Declaração de Não Alojamento', required: true },
      { doc: 'Seguro de vida', required: true },
      BANCO,
      { doc: 'Inventário de Riscos Ocupacionais (NR 01)', required: true },
      { doc: 'PCMSO (NR 07)', required: true },
      { doc: 'Relatório analítico do PCMSO (NR 07)', required: true },
      { doc: 'Registro no CREA/CAU', required: false },
    ],
  },
  {
    name: 'Serviços laboratoriais',
    description: 'Laboratórios que recebem amostras e emitem laudos.',
    personKind: 'PJ',
    cnae: [],
    reqs: [
      ...CADASTRAIS,
      ...FISCAIS,
      BANCO,
      { doc: 'Habilitação técnica do laboratório', required: true },
      { doc: 'Registro do responsável técnico', required: true },
      ...sstWhen('Obrigatório quando houver equipe atuando em campo ou dentro da obra.'),
    ],
  },
  {
    name: 'Locação de equipamentos',
    description: 'Locação de máquinas e equipamentos, com ou sem operador.',
    personKind: 'PJ',
    cnae: [],
    reqs: [
      ...CADASTRAIS,
      ...FISCAIS,
      BANCO,
      { doc: 'Relação dos equipamentos', required: true },
      { doc: 'Comprovante de propriedade ou disponibilidade dos equipamentos', required: true },
      { doc: 'Laudos, inspeções e manutenções dos equipamentos', required: false, instructions: 'Quando aplicável.' },
      { doc: 'Seguro dos equipamentos', required: false, instructions: 'Quando aplicável.' },
      ...sstWhen('Obrigatório na locação com operador ou equipe de manutenção atuando na obra.'),
    ],
  },
  {
    name: 'MEI',
    description: 'Microempreendedor individual.',
    personKind: 'PJ',
    cnae: [],
    reqs: ['Cartão CNPJ', 'CCMEI', 'CND Federal (Receita/PGFN)', 'Comprovante bancário', 'Documento do responsável'].map((doc) => ({ doc, required: true })),
  },
  {
    name: 'Pessoa física',
    description: 'Autônomo / pessoa física.',
    personKind: 'PF',
    cnae: [],
    reqs: ['Documento do responsável', 'Comprovante bancário'].map((doc) => ({ doc, required: true })),
  },
]

/** Modelos que o script de atualização reescreve (MEI e Pessoa física ficam como estão). */
export const GRD_MODELS = MODELS.filter((m) => m.personKind === 'PJ' && m.name !== 'MEI')
