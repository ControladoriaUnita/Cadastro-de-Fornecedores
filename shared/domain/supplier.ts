/**
 * Ficha cadastral do fornecedor (o que ele preenche pelo link e o que vai para o UAU).
 */
import { z } from 'zod'
import { isValidCnpj, isValidCpf, onlyDigits } from './document-number'

export const SUPPLIER_STATUSES = ['em_cadastro', 'homologado', 'bloqueado', 'inativo'] as const
export type SupplierStatus = (typeof SUPPLIER_STATUSES)[number]
export const SUPPLIER_STATUS_LABELS: Record<SupplierStatus, string> = {
  em_cadastro: 'Em cadastro',
  homologado: 'Homologado',
  bloqueado: 'Bloqueado',
  inativo: 'Inativo',
}

export const UFS = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB',
  'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
] as const

/** Tipos de conta do UAU (GravarContaBancaria.tipo). */
export const ACCOUNT_TYPES = { 0: 'Conta corrente', 1: 'Conta poupança', 3: 'Conta salário' } as const
/** Tipos de chave Pix (guardados no app; a gravação no UAU depende de teste, ver docs/API_UAU.md). */
export const PIX_TYPES = { cpf_cnpj: 'CPF/CNPJ', celular: 'Celular', email: 'E-mail', aleatoria: 'Chave aleatória' } as const

/** Dados de pessoa física (módulo Pessoas Físicas/PF). */
export const SEXES = { M: 'Masculino', F: 'Feminino' } as const
export type Sex = keyof typeof SEXES
export const MARITAL_STATUSES = {
  solteiro: 'Solteiro(a)',
  casado: 'Casado(a)',
  uniao_estavel: 'União estável',
  separado: 'Separado(a)',
  divorciado: 'Divorciado(a)',
  viuvo: 'Viúvo(a)',
} as const
export type MaritalStatus = keyof typeof MARITAL_STATUSES

const text = (max: number) => z.string().trim().max(max)
const optionalText = (max: number) => text(max).optional().transform((v) => v || null).nullable()

export const addressSchema = z.object({
  cep: z.string().transform(onlyDigits).pipe(z.string().length(8, 'CEP com 8 dígitos')),
  street: text(120).min(1, 'Informe o logradouro'),
  number: text(10).min(1, 'Informe o número (ou S/N)'),
  complement: optionalText(60),
  district: text(60).min(1, 'Informe o bairro'),
  city: text(60).min(1, 'Informe a cidade'),
  uf: z.enum(UFS, { errorMap: () => ({ message: 'UF inválida' }) }),
})
export type Address = z.infer<typeof addressSchema>

export const bankSchema = z.object({
  bankCode: z.coerce.number().int().min(1).max(999),
  bankName: optionalText(80),
  agency: text(10).min(1, 'Informe a agência'),
  account: text(20).min(1, 'Informe a conta com dígito'),
  accountType: z.coerce.number().refine((v) => v in ACCOUNT_TYPES, 'Tipo de conta inválido'),
})
export type BankAccount = z.infer<typeof bankSchema>

export const pixSchema = z.object({
  type: z.enum(['cpf_cnpj', 'celular', 'email', 'aleatoria']),
  key: text(77).min(1),
})

export const personSchema = z.object({
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Informe a data de nascimento'),
  sex: z.enum(['M', 'F'], { errorMap: () => ({ message: 'Informe o sexo' }) }),
  maritalStatus: z.enum(Object.keys(MARITAL_STATUSES) as [MaritalStatus, ...MaritalStatus[]], { errorMap: () => ({ message: 'Informe o estado civil' }) }),
  rgNumber: z.string().trim().min(3, 'Informe o número do RG').max(20),
  rgIssuer: z.string().trim().min(2, 'Informe o órgão emissor').max(20),
  rgUf: z.enum(UFS, { errorMap: () => ({ message: 'UF do RG inválida' }) }),
  /** Naturalidade (cidade de nascimento): o UAU exige, até 40 caracteres */
  birthplace: z.string().trim().min(2, 'Informe a naturalidade (cidade de nascimento)').max(40, 'Use até 40 caracteres'),
  /** UF de nascimento: sem ela o UAU falha ao validar o município (HTTP 500) */
  birthUf: z.enum(UFS, { errorMap: () => ({ message: 'Informe a UF de nascimento' }) }),
})
export type PersonData = z.infer<typeof personSchema>

export const supplierProfileSchema = z
  .object({
    document: z.string().transform(onlyDigits),
    legalName: text(100).min(2, 'Informe a razão social / nome'),
    tradeName: optionalText(100),
    email: z.string().trim().toLowerCase().email('E-mail inválido').max(120),
    phoneDdd: z.string().transform(onlyDigits).pipe(z.string().length(2, 'DDD com 2 dígitos')),
    phoneNumber: z.string().transform(onlyDigits).pipe(z.string().min(8, 'Telefone inválido').max(9)),
    website: optionalText(120),
    contactName: optionalText(80),
    stateRegistration: optionalText(20),
    municipalRegistration: optionalText(20),
    mainCnae: optionalText(10),
    simplesNacional: z.boolean().nullable().default(null),
    address: addressSchema,
    bank: bankSchema.nullable(),
    pix: pixSchema.nullable(),
    /** Só pessoa física (CPF): nascimento, sexo, estado civil e RG */
    person: personSchema.nullable().optional(),
  })
  .superRefine((v, ctx) => {
    const ok = v.document.length === 14 ? isValidCnpj(v.document) : v.document.length === 11 ? isValidCpf(v.document) : false
    if (!ok) ctx.addIssue({ code: 'custom', path: ['document'], message: 'CNPJ/CPF inválido' })
    if (v.document.length === 11 && !v.person) ctx.addIssue({ code: 'custom', path: ['person'], message: 'Informe nascimento, sexo, estado civil e RG' })
  })

export type SupplierProfile = z.infer<typeof supplierProfileSchema>

/** Rascunho: o fornecedor pode salvar sem completar tudo. */
export const supplierDraftSchema = z.record(z.unknown())
