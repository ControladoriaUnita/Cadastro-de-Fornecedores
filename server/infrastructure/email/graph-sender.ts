/**
 * Envio pelo Microsoft 365 (Microsoft Graph) com um aplicativo do Entra ID que tem Mail.Send.
 * 1) token por client credentials (em cache) · 2) POST /users/{remetente}/sendMail
 */
import { IntegrationError } from '../../application/context'
import type { EmailMessage } from '../../application/ports'

export interface GraphConfig {
  tenantId: string
  clientId: string
  clientSecret: string
  sender: string
}

const TIMEOUT_MS = 20_000
const recipients = (list: string[]) => list.map((address) => ({ emailAddress: { address } }))

let token: { value: string; expiresAt: number } | null = null

async function getToken(c: GraphConfig): Promise<string> {
  if (token && Date.now() < token.expiresAt) return token.value
  const res = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(c.tenantId)}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: c.clientId,
      client_secret: c.clientSecret,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  const data = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error_description?: string }
  if (!res.ok || !data.access_token) {
    throw new IntegrationError(`Falha ao autenticar no Microsoft 365 (HTTP ${res.status}). ${data.error_description?.split('\r\n')[0] ?? ''}`.trim())
  }
  token = { value: data.access_token, expiresAt: Date.now() + ((data.expires_in ?? 3600) - 60) * 1000 }
  return token.value
}

export async function sendWithGraph(c: GraphConfig, m: EmailMessage): Promise<void> {
  const res = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(c.sender)}/sendMail`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await getToken(c)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: {
        subject: m.subject,
        body: { contentType: 'HTML', content: m.html },
        toRecipients: recipients(m.to),
        ccRecipients: recipients(m.cc ?? []),
      },
      saveToSentItems: true,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (res.status !== 202) {
    const data = (await res.json().catch(() => null)) as { error?: { message?: string } } | null
    throw new IntegrationError(`Microsoft 365 recusou o e-mail (HTTP ${res.status}): ${data?.error?.message ?? res.statusText}`)
  }
}
