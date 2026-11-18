/**
 * Modelos de e-mail (HTML simples, compatível com Outlook) na identidade Unità.
 */
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

function layout(title: string, bodyHtml: string): string {
  return `<!doctype html><html><body style="margin:0;background:#f8f7f6;font-family:Segoe UI,Arial,sans-serif;color:#1a1817">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px">
<table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #e2dfdc;border-radius:12px">
<tr><td style="background:#231f20;border-bottom:3px solid #fe5000;padding:16px 24px;border-radius:12px 12px 0 0;color:#ffffff;font-weight:600">Unità Engenharia · Fornecedores</td></tr>
<tr><td style="padding:24px"><h2 style="margin:0 0 12px;font-size:18px">${esc(title)}</h2>${bodyHtml}</td></tr>
<tr><td style="padding:12px 24px;color:#77716d;font-size:12px;border-top:1px solid #f0eeec">Mensagem automática. Em caso de dúvida, responda ao contato de suprimentos que solicitou o cadastro.</td></tr>
</table></td></tr></table></body></html>`
}

const button = (href: string, label: string) =>
  `<p style="margin:20px 0"><a href="${esc(href)}" style="background:#fe5000;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600">${esc(label)}</a></p>`

export function inviteEmail(p: { supplierName: string; link: string; expiresAt: Date; message?: string | null; pending?: string | null }) {
  const subject = p.pending ? 'Unità Engenharia — pendências no seu cadastro de fornecedor' : 'Unità Engenharia — cadastro de fornecedor'
  const expires = p.expiresAt.toLocaleDateString('pt-BR')
  const intro = p.pending
    ? `<p>Encontramos pendências no cadastro de <b>${esc(p.supplierName)}</b>:</p><p style="background:#fdf4e3;padding:10px 12px;border-radius:8px">${esc(p.pending)}</p>`
    : `<p>Olá! A Unità Engenharia convidou <b>${esc(p.supplierName)}</b> para o cadastro de fornecedor.</p>`
  const html = layout(
    'Cadastro de fornecedor',
    `${intro}${p.message ? `<p>${esc(p.message)}</p>` : ''}<p>Pelo link abaixo você informa os dados da empresa e envia os documentos solicitados. Ao abrir, enviaremos um código de confirmação para este e-mail.</p>${button(p.link, 'Abrir meu cadastro')}<p style="color:#77716d;font-size:13px">O link é pessoal e vale até ${expires}.</p>`,
  )
  const text = `${p.pending ? `Pendências no cadastro de ${p.supplierName}: ${p.pending}` : `A Unità Engenharia convidou ${p.supplierName} para o cadastro de fornecedor.`}\n\nAbra o link para preencher os dados e enviar os documentos (válido até ${expires}):\n${p.link}`
  return { subject, html, text }
}

export function codeEmail(p: { code: string }) {
  const html = layout(
    'Seu código de acesso',
    `<p>Use o código abaixo para abrir o cadastro de fornecedor. Ele vale por 10 minutos.</p><p style="font-size:28px;font-weight:700;letter-spacing:6px;margin:16px 0">${p.code}</p><p style="color:#77716d;font-size:13px">Se você não pediu este código, ignore este e-mail.</p>`,
  )
  return { subject: `Código de acesso: ${p.code}`, html, text: `Seu código de acesso ao cadastro de fornecedor da Unità: ${p.code} (válido por 10 minutos).` }
}

export function notifyEmail(p: { title: string; lines: string[]; link: string | null }) {
  const html = layout(p.title, `${p.lines.map((l) => `<p>${esc(l)}</p>`).join('')}${p.link ? button(p.link, 'Abrir no app') : ''}`)
  return { subject: `Fornecedores — ${p.title}`, html, text: [...p.lines, p.link ?? ''].join('\n') }
}
