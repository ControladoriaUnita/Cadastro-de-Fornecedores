/**
 * Vercel Function única para /api/* (ver rewrites em vercel.json).
 * A camada HTTP é fina: as regras ficam em server/application e shared/domain.
 */
import { handle } from '../server/http/router'

// Gravação no UAU (pessoa + conta + anexos) pode levar dezenas de segundos.
export const config = { maxDuration: 300 }

export default {
  fetch(request: Request): Promise<Response> {
    return handle(request)
  },
}
