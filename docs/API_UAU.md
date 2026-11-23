# API UAU — o que foi confirmado para fornecedores

Servidor: `UAU_BASE_URL` (Swagger em `/swagger/ui/index`, JSON em `/1.0/swagger`). Toda rota é `POST <base>/api/v1.0/<Controller>/<Metodo>`, com `X-INTEGRATION-Authorization` e o token de `Autenticador/AutenticarUsuario`. Cliente em [`server/infrastructure/uau/uau-client.ts`](../server/infrastructure/uau/uau-client.ts) (mesmo desenho do app de Insumos).

No UAU, **fornecedor é uma Pessoa** (física ou jurídica). Não há marcação de "fornecedor" nem rota de categoria/homologação: isso fica no app.

## Rotas usadas

| Rota | Uso | Observações confirmadas |
|---|---|---|
| `Pessoas/ConsultarDadosPessoaPorCpfCnpjEStatus` | evitar duplicidade | `{ cpf_cnpj: "só dígitos", status: 2 }` (0 ativos, 1 inativos, 2 ambos). **Não encontrado = HTTP 400** com `Descricao: "Não foi encontrado nenhuma pessoa com os dados informados."` |
| `Pessoas/ConsultarPessoasPorCondicao` | consulta livre | `condicaoConsultarPessoa` é um WHERE simples (`cod_pes = 2`); subconsultas são recusadas. Campos voltam como `CodigoPessoa`, `NomePessoa`… e **incluem `SenhaLoginPessoa`** — nunca guardar a resposta inteira |
| `Pessoas/GravarPessoa` | criar pessoa | `cod_pes = 0` cria. `info_pes`, `info_pesfis`, `infopes_jur` e `info_pesendereco_principal` são **objetos** (lista → HTTP 400 "O campo info_pes é obrigatório"). Mandar **sempre os dois blocos** `info_pesfis` e `infopes_jur`, com `natureza_pj: 0`, `sexo_pf: 0`, `indicativofiscal_pf: 0`, e `dspes_tel_json` com a linha de estrutura (ver `UAU_PHONE_JSON_HEADER`) — sem isso → HTTP 500 "O objeto nulo deve ter um valor". **Não** mandar `infopes_doc` vazio (exige `registro_doc`). Usamos `status_pes = 2` (confirmado), `intext_pes = 2` (externo), `atinat_pes = 0` (ativo). Testado em 18/11/2026 (cod_pes 8758) |
| `Pessoas/ManterTelefone` | telefone | `{ Numero: cod_pes, Telefones: [{ DDD, Telefone, Tipo, Principal }] }` — Tipo 1 comercial, 2 celular. Não aceita telefone repetido |
| `Pessoas/GravarContaBancaria` | conta | `{ codigoPessoa, banco, agencia, conta, tipo (0 CC, 1 poupança, 3 salário), padrao }` |
| `Anexo/AnexarArquivosBase64Request` | documentos | `{ empresa, usuario, lista_arquivos[] }` com `ConteudoArquivo` (base64 sem prefixo), `NomeArquivo` **sem extensão** (o UAU acrescenta), `Extension`, `CaminhoArquivo` (subpasta; o UAU **cria** se não existir), `Identificador: "Pessoas <cod_pes>"`, `Origem: 1`. **`empresa` é obrigatório** (sem ele: FK_HistoricoArquivoVinculado_Empresas); o app usa `UAU_EMPRESA`, padrão 1 = UNITÀ ENGENHARIA SA |
| `Anexo/ListaArquivoPorChave` | conferir anexos | `{ Chave: "Pessoas", Valores: ["<cod_pes>"] }` — `Valores` **tem de ser lista** |

## Anexos

- `Anexo/ConsultarChavesComentario` confirmou a chave **`Pessoas`** (campo `CodPessoa`). Outras: Venda, Contrato, Proposta, Processo, Medicao, ItemPedidoServico, ItemPedidoMaterial, Cotacao.
- `Anexo/ListarArmazenamentos`: padrão é o servidor local (`Origem 1`); AWS S3 existe mas não é o padrão.
- Pasta de Suprimentos (relativa a `#Arquivos`): `1-UNITA\UNITA\3-Suprimentos\5 - Cadastro e qualificação de fornecedores`. Dentro dela há uma pasta por fornecedor no padrão `<código da pessoa no UAU> - <NOME>` (ex.: `5539 - PLUMA ICAMENTOS LTDA`; confirmado consultando os códigos). O app reaproveita a pasta existente ou cria uma nova nesse padrão.

## Primeira gravação real (18/11/2026)

Testada com a empresa fictícia `TESTE INTEGRACAO APP FORNECEDORES LTDA` (CNPJ 99.887.766/0001-05), criada como **cod_pes 8758**: pessoa, telefone, conta e 7 anexos conferidos no UAU. **Inativar/excluir essa pessoa no UAU.** O `GravarPessoa` devolve o código numa forma que o app lê (ou reconsulta pelo CNPJ).

## Pendente

1. `ChavePix/Pessoas/Cadastrar`: a documentação se contradiz nos códigos de tipo de chave e de "padrão" — por isso o Pix fica só no app por enquanto.

## Importação da base de fornecedores

O UAU não marca quem é fornecedor. O app (Fornecedores → Importar do UAU → Base inteira) lê `Pessoas/ConsultarPessoasPorCondicao` em faixas de 500 códigos (`cod_pes > N and cod_pes <= N+500`) até 4.000 códigos seguidos sem ninguém, e fica com as **pessoas jurídicas ativas** (TipoPessoa 1, CNPJ de 14 dígitos, AtivoInativo 0). CNPJ repetido no UAU: fica o maior código. Só nome, fantasia, CNPJ, e-mail e código são lidos (a resposta traz `SenhaLoginPessoa`). Regras em [`shared/domain/uau-suppliers.ts`](../shared/domain/uau-suppliers.ts); rota `POST /api/suppliers/uau-sync`, em etapas de ~8 s que o navegador encadeia. Em 11/2026: 8.751 pessoas, 5.653 CNPJs de empresas ativas, leitura completa em 30 s a 2,5 min.

No módulo **Pessoas Físicas/PF** (Pessoas → Importar do UAU) a mesma leitura fica com as **pessoas físicas ativas** (TipoPessoa 0, CPF válido, AtivoInativo 0), gravadas como PF e visíveis só no módulo PF. Em 23/11/2026: 8.766 pessoas lidas, 3.087 pessoas físicas importadas (1 inativa e 1 CPF repetido ignorados).

## Pessoa física (módulo Pessoas Físicas/PF)

Mesmo `Pessoas/GravarPessoa`, com `tipo_pes = 0`. A ficha do portal pede nascimento, naturalidade e UF de nascimento, sexo, estado civil e RG.
Códigos conforme a documentação da própria API (`/uauAPI/swagger/ui/index`, modelo `UAUApi.Models.Pessoas.PesFis`) e **confirmados na gravação real de 23/11/2026** (pessoa de teste código 8773):

| Ficha | UAU |
|---|---|
| Data de nascimento | `info_pes.dtnasc_pes` |
| Naturalidade (cidade) | `info_pesfis.naturalid_pf` — **obrigatória** (até 40 caracteres) |
| UF de nascimento | `info_pesfis.ufnasc_pf` — **obrigatória na prática**: sem ela o UAU devolve HTTP 500 em `ValidarConsistenciaMunicipioPessoa` |
| Sexo | `info_pesfis.sexo_pf`: 0 masculino, 1 feminino |
| Estado civil | `info_pesfis.estciv_pf`: 0 separado, 1 solteiro, 2 casado, 3 desquitado, 4 viúvo, 5 divorciado, 6 outros. União estável = solteiro + `uniaoestavel_pf` |
| RG (número) | `info_pesfis.doc_pf` com `tdoc_pf = "RG"` |
| RG (órgão e UF) | guardados no app (não há campo próprio no bloco PesFis) |

O UAU às vezes recusa com **HTTP 200** e `{"Sucesso": false, "Mensagem": "..."}`; o app trata isso como recusa (`uauRefusal`) e mostra a mensagem.
