/**
 * Mailer conforme EMAIL_PROVIDER. Todo envio fica registrado em email_outbox:
 *   log   → não envia; o e-mail aparece no terminal e no Painel dev (padrão local)
 *   graph → envia pelo Microsoft 365
 *   none  → desligado (registra como "desligado")
 */
import { AppError } from '../../application/context'
import type { EmailMessage, Mailer } from '../../application/ports'
import type { Db } from '../db/client'
import { emailOutbox } from '../db/schema'
import { envOption, envValue } from '../env'
import { sendWithGraph, type GraphConfig } from './graph-sender'

export type EmailProvider = 'log' | 'graph' | 'none'

export function emailProvider(): EmailProvider {
  const p = envOption('EMAIL_PROVIDER')
  return p === 'graph' || p === 'none' ? p : 'log'
}

function graphConfig(): GraphConfig {
  const cfg = {
    tenantId: envValue('GRAPH_TENANT_ID'),
    clientId: envValue('GRAPH_CLIENT_ID'),
    clientSecret: envValue('GRAPH_CLIENT_SECRET'),
    sender: envValue('EMAIL_SENDER'),
  }
  const missing = Object.entries(cfg)
    .filter(([, v]) => !v)
    .map(([k]) => k)
  if (missing.length) throw new AppError('EMAIL_NOT_CONFIGURED', `E-mail sem configuração no servidor: ${missing.join(', ')}.`, 503)
  return cfg as GraphConfig
}

export function createMailer(db: Db): Mailer {
  const provider = emailProvider()
  return {
    provider,
    async send(m: EmailMessage) {
      let status = provider === 'graph' ? 'enviado' : provider === 'log' ? 'registrado' : 'desligado'
      let error: string | null = null
      try {
        if (provider === 'graph') await sendWithGraph(graphConfig(), m)
        if (provider === 'log') console.info(`[e-mail] para ${m.to.join(', ')} — ${m.subject}\n${m.text}`)
      } catch (err) {
        status = 'erro'
        error = err instanceof Error ? err.message : String(err)
      }
      await db.insert(emailOutbox).values({
        to: m.to,
        subject: m.subject,
        html: m.html,
        text: m.text,
        provider,
        status,
        error,
        requestId: m.requestId ?? null,
      })
      if (error) throw new AppError('EMAIL_FAILED', `Não foi possível enviar o e-mail: ${error}`, 502)
    },
  }
}
