# Cadastro de Fornecedores — Unità Engenharia

Plataforma para pedir, homologar e gravar fornecedores no **UAU**, com o fornecedor enviando os próprios dados e documentos por um link seguro.

```
Solicitante pede ──▶ Suprimentos convida ──▶ Fornecedor preenche ──▶ Suprimentos confere ──▶ Aprovação grava no UAU
 (CNPJ em tempo real)   (link por e-mail)      (ficha + documentos)     (documentos + risco)     (pessoa, conta, anexos)
```

Stack: **React 19 + TypeScript (strict) + Vite 7 + Tailwind CSS 4** · **Vercel Functions (Node)** · **Neon (PostgreSQL) + Drizzle** · Zod · TanStack Query.
Identidade visual: **v2** (`IDENTIDADE_VISUAL_PARA_APP v2.html`), tokens em `src/styles/tokens.css` (nenhum hex fora dele: `npm run lint:hex`).

---

## Rodando localmente

```bash
npm install
npm run db:migrate    # cria as tabelas no Neon (DATABASE_URL no .env.local)
npm run db:seed       # usuários de teste + sugestão de modelos, documentos, critérios e regras
npm run dev           # http://localhost:5175
```

> No PowerShell, `npm run ...` pode ser bloqueado pela política de scripts. Use o Git Bash ou `npx vite`.

Com `AUTH_MODE=dev`, a tela de entrada mostra um seletor de usuário (Administrador Dev, Solicitante, Analista e Aprovador de teste). Com `EMAIL_PROVIDER=log` nenhum e-mail sai: **os links do fornecedor e os códigos de acesso aparecem em Painel dev → E-mails**.

### Variáveis (`.env.local`)

| Variável | Para quê |
|---|---|
| `DATABASE_URL` | Banco Neon |
| `SESSION_SECRET` | Assina os cookies de sessão (32+ caracteres aleatórios) |
| `AUTH_MODE` | `dev` (seletor, só fora de produção) · `entra` (conta Microsoft) |
| `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`, `ENTRA_CLIENT_SECRET` | Registro do app no Microsoft Entra ID (redirect: `<APP_URL>/api/auth/microsoft/callback`) |
| `UAU_BASE_URL`, `UAU_INTEGRATION_TOKEN`, `UAU_LOGIN`, `UAU_PASSWORD` | Usuário de integração do UAU (o mesmo do app de Insumos) |
| `UAU_GRAVACAO` | `simulacao` (padrão): aprova no app e mostra o JSON, **não grava**. `real`: grava no UAU |
| `UAU_PASTA_ANEXOS` | Pasta dos anexos, relativa a `#Arquivos` do UAU: `1-UNITA\UNITA\3-Suprimentos\5 - Cadastro e qualificação de fornecedores` |
| `EMAIL_PROVIDER` | `log` (Painel dev) · `graph` (Microsoft 365: `GRAPH_*` + `EMAIL_SENDER`) · `none` |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob (arquivos privados). Sem ele, arquivos ficam em `.data/uploads` (só local) |
| `TRANSPARENCIA_API_KEY` | Chave gratuita do Portal da Transparência (sanções CEIS/CNEP) |
| `APP_URL` | Endereço público do app (usado nos links dos e-mails) |

A base do UAU **é produção**. Só ligue `UAU_GRAVACAO=real` de propósito, e faça o primeiro cadastro real acompanhando.

---

## Cargos e permissões

As **permissões** são fixas no código ([`shared/domain/roles.ts`](shared/domain/roles.ts)): cada uma libera telas e ações na API. Os **cargos** ficam no banco (tabela `roles`) e são criados e editados em **Painel dev → Cargos e permissões**. Um usuário pode ter vários cargos; as permissões se somam. Usuários são criados em **Painel dev → Usuários**.

Cargos iniciais (editáveis):

| Cargo | O que faz |
|---|---|
| **Solicitante** | Abre solicitação (busca CNPJ em tempo real), acompanha as próprias, avalia fornecedores |
| **Analista de suprimentos** | Convida o fornecedor, confere documentos, roda a análise de risco, devolve com pendências, envia para aprovação, importa a base do UAU |
| **Aprovação** | Tudo do analista + tela de validação e gravação no UAU |
| **Dev** (sistema) | Sempre tem todas as permissões; não pode ser apagado |

Proteções: só quem é Dev dá ou tira o cargo Dev; ninguém tira o próprio Dev nem se desativa; sempre sobra ao menos um Dev ativo; cargo com usuários não pode ser apagado. Os avisos por e-mail vão para quem tem a permissão de analisar ou de aprovar (por cargo, não para o Dev). As transições do fluxo ficam em [`shared/domain/request/workflow.ts`](shared/domain/request/workflow.ts).

## Fluxo (kanban)

| Situação | Quem age | Ações |
|---|---|---|
| Solicitado | Analista | enviar convite · recusar · (solicitante) cancelar |
| Aguardando fornecedor | Fornecedor | preencher ficha, enviar documentos, enviar para análise |
| Em análise | Analista | aprovar/reprovar documentos · rodar risco · devolver com pendências · enviar para aprovação |
| Pendências | Fornecedor | corrigir e reenviar (novo link por e-mail com o motivo) |
| Aguardando aprovação | Aprovação | validar e gravar no UAU · devolver para análise · recusar |
| Gravado no UAU | — | encerrada (fornecedor homologado) |

**Enviar para aprovação** só passa com: documentos obrigatórios enviados, conferidos e no prazo; ficha válida; análise de risco feita depois do último envio do fornecedor e sem item que bloqueie.

### Gravação no UAU ([`server/application/use-cases/approval.ts`](server/application/use-cases/approval.ts))
1. `Pessoas/ConsultarDadosPessoaPorCpfCnpjEStatus` — se o CNPJ já existe, usa o código existente (não duplica).
2. `Pessoas/GravarPessoa` — pessoa **confirmada e ativa** (`status_pes = 2`, externo).
3. `Pessoas/ManterTelefone` e `Pessoas/GravarContaBancaria` (falhas viram aviso; a pessoa já existe).
4. `Anexo/AnexarArquivosBase64Request` — documentos aprovados, chave `Pessoas <código>`, pasta `<UAU_PASTA_ANEXOS>\<código> - <NOME>` (o padrão que Suprimentos já usa; reaproveita a pasta se o fornecedor já tiver uma).

A tela **Validação ERP** mostra cada chamada com o JSON exato antes de aprovar.

## Portal do fornecedor

Link pessoal por e-mail (token aleatório, só o hash fica no banco, vale 15 dias) → código de 6 dígitos no mesmo e-mail (10 min, 5 tentativas) → cookie de sessão preso àquele convite (8 h). Sem conta e sem senha. A ficha vem pré-preenchida com a Receita; o CEP completa o endereço. O fornecedor só altera enquanto a solicitação está com ele.

## Análise de risco

Fontes gratuitas: **Receita Federal** (BrasilAPI, reserva CNPJ.ws) e **Portal da Transparência** (CEIS/CNEP, exige chave). Regras em [`shared/domain/risk.ts`](shared/domain/risk.ts); gravidade (bloqueia / alerta / desligada) e parâmetros (meses de atividade, capital mínimo) no Painel dev. Sem a chave da Transparência, as sanções aparecem como "não consultado" e não bloqueiam.

## Segurança

- Sessões em cookie `HttpOnly`/`SameSite=Lax`, assinadas com HMAC; nada de token no `localStorage`.
- Toda requisição que altera dados exige `X-Requested-With: fornecedores` (barra CSRF).
- Entradas validadas com Zod no servidor; tipo real do arquivo conferido pelos primeiros bytes (PDF/PNG/JPG, até 4 MB).
- Arquivos privados; download só pela API, com `Content-Security-Policy: sandbox`.
- Credenciais só no servidor (nunca `VITE_*`). Rode `npm run check:secrets` antes de cada commit.

## Estrutura

```
api/router.ts                 Vercel Function única (/api/*)
server/http/router.ts         rotas → casos de uso (camada fina)
server/application/           casos de uso, portas, notificações
server/infrastructure/        Neon/Drizzle, UAU, e-mail, arquivos, Receita, Transparência, sessão
shared/domain/                regras puras (workflow, risco, documentos, avaliação, payload UAU) + testes
shared/contracts/             esquemas Zod e DTOs usados pelos dois lados
src/features/                 telas (painel, kanban, solicitação, fornecedores, validação, modelos, dev, portal)
db/migrations/                SQL gerado pelo drizzle-kit
```

Mudou o schema (`server/infrastructure/db/schema.ts`)? `npm run db:generate` e depois `npm run db:migrate`.

## Verificações

```bash
npm run check          # tipos (front e servidor) + cores fora dos tokens + testes
npm run check:secrets  # credenciais em arquivos que iriam para o GitHub
```

## Publicação (Vercel)

1. Crie o projeto na Vercel apontando para o repositório do GitHub.
2. Configure as variáveis acima com `AUTH_MODE=entra`, `EMAIL_PROVIDER=graph`, `BLOB_READ_WRITE_TOKEN` (crie um Blob Store) e `APP_URL` com o domínio final.
3. No Entra ID, cadastre o redirect `https://<domínio>/api/auth/microsoft/callback`.
4. Cadastre os usuários reais no Painel dev (o e-mail precisa ser o da conta Microsoft).
