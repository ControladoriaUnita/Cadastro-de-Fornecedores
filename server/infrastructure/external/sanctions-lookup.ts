/**
 * Sanções no Portal da Transparência (CGU): CEIS (inidôneas/suspensas) e CNEP (punidas).
 * Exige chave gratuita (TRANSPARENCIA_API_KEY). Sem chave, devolve null ("não consultado").
 */
import type { SanctionsLookup } from '../../application/ports'
import { envValue } from '../env'

const BASE = 'https://api.portaldatransparencia.gov.br/api-de-dados'
const TIMEOUT_MS = 20_000

export class TransparenciaSanctions implements SanctionsLookup {
  private readonly key = envValue('TRANSPARENCIA_API_KEY')
  get configured() {
    return !!this.key
  }

  private async query(list: 'ceis' | 'cnep', document: string) {
    if (!this.key) return null
    try {
      const res = await fetch(`${BASE}/${list}?codigoSancionado=${document}&pagina=1`, {
        headers: { 'chave-api-dados': this.key, Accept: 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      if (!res.ok) {
        console.warn(`[transparencia] ${list} HTTP ${res.status}`)
        return null
      }
      const items = (await res.json()) as unknown[]
      return { count: Array.isArray(items) ? items.length : 0, items: Array.isArray(items) ? items.slice(0, 20) : [] }
    } catch (err) {
      console.warn(`[transparencia] ${list} falhou`, err)
      return null
    }
  }

  ceis(document: string) {
    return this.query('ceis', document)
  }
  cnep(document: string) {
    return this.query('cnep', document)
  }
}
