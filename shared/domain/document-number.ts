/**
 * CNPJ e CPF: limpeza, validação de dígitos e formatação.
 */

export const onlyDigits = (v: string) => v.replace(/\D/g, '')

function cnpjCheckDigit(base: string): number {
  const weights = base.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
  const sum = base.split('').reduce((acc, d, i) => acc + Number(d) * weights[i]!, 0)
  const rest = sum % 11
  return rest < 2 ? 0 : 11 - rest
}

export function isValidCnpj(value: string): boolean {
  const c = onlyDigits(value)
  if (c.length !== 14 || /^(\d)\1+$/.test(c)) return false
  const d1 = cnpjCheckDigit(c.slice(0, 12))
  const d2 = cnpjCheckDigit(c.slice(0, 12) + d1)
  return c.endsWith(`${d1}${d2}`)
}

export function isValidCpf(value: string): boolean {
  const c = onlyDigits(value)
  if (c.length !== 11 || /^(\d)\1+$/.test(c)) return false
  const digit = (len: number) => {
    const sum = c
      .slice(0, len)
      .split('')
      .reduce((acc, d, i) => acc + Number(d) * (len + 1 - i), 0)
    const r = (sum * 10) % 11
    return r === 10 ? 0 : r
  }
  return digit(9) === Number(c[9]) && digit(10) === Number(c[10])
}

export type PersonKind = 'PJ' | 'PF'

export function personKindOf(document: string): PersonKind | null {
  const d = onlyDigits(document)
  if (d.length === 14 && isValidCnpj(d)) return 'PJ'
  if (d.length === 11 && isValidCpf(d)) return 'PF'
  return null
}

export function formatDocument(value: string | null | undefined): string {
  const d = onlyDigits(value ?? '')
  if (d.length === 14) return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
  if (d.length === 11) return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4')
  return value ?? ''
}
