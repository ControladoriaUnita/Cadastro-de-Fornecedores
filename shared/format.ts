/**
 * Formatação para exibição (pt-BR).
 */
export { formatDocument } from './domain/document-number'

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = iso.length === 10 ? new Date(`${iso}T12:00:00`) : new Date(iso)
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('pt-BR')
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '—' : d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

export function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const min = Math.round(diff / 60_000)
  if (min < 1) return 'agora'
  if (min < 60) return `há ${min} min`
  const h = Math.round(min / 60)
  if (h < 24) return `há ${h} h`
  const d = Math.round(h / 24)
  return d === 1 ? 'ontem' : `há ${d} dias`
}

export const formatMoney = (n: number | null | undefined) => (n === null || n === undefined ? '—' : n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }))

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export const formatScore = (n: number | null | undefined) => (n === null || n === undefined ? '—' : n.toFixed(1).replace('.', ','))

export function formatCnae(code: string | null | undefined): string {
  const d = (code ?? '').replace(/\D/g, '')
  return d.length === 7 ? `${d.slice(0, 4)}-${d.slice(4, 5)}/${d.slice(5)}` : (code ?? '—')
}
