# API UAU — o que foi confirmado para fornecedores

Servidor: `UAU_BASE_URL` (Swagger em `/swagger/ui/index`, JSON em `/1.0/swagger`). Toda rota é `POST <base>/api/v1.0/<Controller>/<Metodo>`, com `X-INTEGRATION-Authorization` e o token de `Autenticador/AutenticarUsuario`. Cliente em [`server/infrastructure/uau/uau-client.ts`](../server/infrastructure/uau/uau-client.ts) (mesmo desenho do app de Insumos).

No UAU, **fornecedor é uma Pessoa** (física ou jurídica). Não há marcação de "fornecedor" nem rota de categoria/homologação: isso fica no app.

## Rotas usadas

| Rota | Uso | Observações confirmadas |
|---|---|---|
| `Pessoas/ConsultarDadosPessoaPorCpfCnpjEStatus` | evitar duplicidade | `{ cpf_cnpj: "só dígitos", status: 2 }` (0 ativos, 1 inativos, 2 ambos). **Não encontrado = HTTP 400** com `Descricao: "Não foi encontrado nenhuma pessoa com os dados informados."` |
| `Pessoas/ConsultarPessoasPorCondicao` | consulta livre | `condicaoConsultarPessoa` é um WHERE simples (`cod_pes = 2`); subconsultas são recusadas. Campos voltam como `CodigoPessoa`, `NomePessoa`… e **incluem `SenhaLoginPessoa`** — nunca guardar a resposta inteira |
| `Pessoas/GravarPessoa` | criar pessoa | `cod_pes = 0` cria; `info_pes` é lista. Usamos `status_pes = 2` (confirmado), `intext_pes = 2` (externo), `atinat_pes = 0` (ativo) |
| `Pessoas/ManterTelefone` | telefone | `{ Numero: cod_pes, Telefones: [{ DDD, Telefone, Tipo, Principal }] }` — Tipo 1 comercial, 2 celular. Não aceita telefone repetido |
| `Pessoas/GravarContaBancaria` | conta | `{ codigoPessoa, banco, agencia, conta, tipo (0 CC, 1 poupança, 3 salário), padrao }` |
| `Anexo/AnexarArquivosBase64Request` | documentos | `lista_arquivos[]` com `ConteudoArquivo` (base64 sem prefixo), `NomeArquivo`, `Extension`, `CaminhoArquivo` (subpasta), `Identificador: "Pessoas <cod_pes>"`, `Origem: 1` |
| `Anexo/ListaArquivoPorChave` | conferir anexos | `{ Chave: "Pessoas", Valores: ["<cod_pes>"] }` — `Valores` **tem de ser lista** |

## Anexos

- `Anexo/ConsultarChavesComentario` confirmou a chave **`Pessoas`** (campo `CodPessoa`). Outras: Venda, Contrato, Proposta, Processo, Medicao, ItemPedidoServico, ItemPedidoMaterial, Cotacao.
- `Anexo/ListarArmazenamentos`: padrão é o servidor local (`Origem 1`); AWS S3 existe mas não é o padrão.
- Pasta de Suprimentos (relativa a `#Arquivos`): `1-UNITA\UNITA\3-Suprimentos\5 - Cadastro e qualificação de fornecedores`. Dentro dela há uma pasta por fornecedor no padrão `<código da pessoa no UAU> - <NOME>` (ex.: `5539 - PLUMA ICAMENTOS LTDA`; confirmado consultando os códigos). O app reaproveita a pasta existente ou cria uma nova nesse padrão.

## A testar antes de ligar `UAU_GRAVACAO=real`

1. Formato exato da resposta do `GravarPessoa` (o app procura `cod_pes`/`CodigoPessoa` em qualquer nível e, se não achar, reconsulta pelo CNPJ).
2. Se o `AnexarArquivosBase64Request` cria a subpasta sozinho ou se ela precisa existir.
3. `ChavePix/Pessoas/Cadastrar`: a documentação se contradiz nos códigos de tipo de chave e de "padrão" — por isso o Pix fica só no app por enquanto.

## Importação da base de fornecedores

O UAU não marca quem é fornecedor. O app (Fornecedores → Importar do UAU → Base inteira) lê `Pessoas/ConsultarPessoasPorCondicao` em faixas de 500 códigos (`cod_pes > N and cod_pes <= N+500`) até 4.000 códigos seguidos sem ninguém, e fica com as **pessoas jurídicas ativas** (TipoPessoa 1, CNPJ de 14 dígitos, AtivoInativo 0). CNPJ repetido no UAU: fica o maior código. Só nome, fantasia, CNPJ, e-mail e código são lidos (a resposta traz `SenhaLoginPessoa`). Regras em [`shared/domain/uau-suppliers.ts`](../shared/domain/uau-suppliers.ts); rota `POST /api/suppliers/uau-sync`, em etapas de ~8 s que o navegador encadeia. Em 11/2026: 8.751 pessoas, 5.653 CNPJs de empresas ativas, leitura completa em 30 s a 2,5 min.
