# App Workspace — contrato operacional isolado

Implementado localmente em 15/10/2026. Este documento descreve o código e os testes locais; aplicar a migration e publicar a função não substitui a homologação autenticada no ambiente real.

## Separação de dados e autenticação

- Mesmo projeto Supabase e mesmas contas já existentes. `authenticateDual` valida usuário, sessão ativa, vínculo `clinic_members`, papel `owner` e MFA `aal2`. `requireAdminSessionAction` revalida o bearer e o contexto antes de mutação. Não há conta criada pelo app, senha fixa, proof legado ou autenticação alternativa.
- `app_workspaces`, `app_workspace_versions`, `app_workspace_operations` e `app_workspace_photos` formam namespace novo. Nenhum paciente, prontuário, financeiro ou arquivo legado é convertido, copiado ou alterado.
- Primeira leitura devolve estado vazio em memória, revisão zero. Não escreve tabela, não chama `seed()` e não importa IndexedDB. Profissional/configuração padrão são apresentação e horários não confirmados, sem conceder acesso a contas.
- RLS habilitada em todas as tabelas novas; `anon`/`authenticated` não recebem SELECT, gravação, TRUNCATE ou EXECUTE nas funções novas. RPCs são SECURITY INVOKER e exclusivas do serviço. SQL revalida proprietário e sessão na mutação. Histórico tem SELECT/INSERT somente; fotos e operações permitem UPDATE apenas da coluna `status`.
- Bucket `app-workspace-media` privado, sem acesso direto de `anon`/`authenticated`; originais imutáveis, `x-upsert:false`, SHA-256 de original/prévia, contexto paciente/consulta e URLs assinadas por 120 segundos apenas para fotos presentes no estado atual.
- Origens exatas: domínio oficial com/sem www, localhost/127.0.0.1 nas portas 8765 e 8766. Nenhum wildcard, rede local arbitrária ou origem externa. Requisições sem Origin ainda precisam de toda a autenticação. CORS não é mecanismo de autorização.

## HTTP

`POST /functions/v1/app-workspace`, cabeçalhos `Authorization: Bearer <sessão>` e `apikey: <chave pública>`. Nenhuma chave de serviço vai para o navegador. JSON exceto upload multipart.

Sucesso inclui `{ok:true,auth_method:'supabase_auth',role:'owner',clinic_id}`. Erro inclui `{ok:false,codigo,erro}` com HTTP 401/403/409/413/422/503. Não expõe mensagens internas do banco nem credenciais. 503/queda de conexão significa resultado não confirmado; consultar/repetir a MESMA operação, nunca gerar UUID novo automaticamente.

### Abrir

Pedido `{acao:'abrir'}`.

Resposta `workspace:{schema:1,revision,state,state_hash,updated_at}`. Estado vazio: revisão 0, hash/data null. Estado existente: schema1 do novo app, incluindo `patientHistory`, `facialStudies`, mapas, comparações e operações financeiras.

### Commit

Pedido `{acao:'commit',operation_id:UUID,expected_revision:inteiro,state}`. `state.revision` deve ser exatamente `expected_revision`. IDs internos de entidades continuam strings do schema1; somente operação de transporte é UUID.

Servidor valida estrutura e transição, calcula hash, avança revisão em um e acrescenta auditoria do ator. SQL usa trava por clínica e CAS, grava estado + versão + recibo na mesma transação. O cliente não escreve sua própria auditoria de revisão. Resposta contém workspace e `operation:{id,status:'committed',revision,replayed}`.

Mesmo UUID e mesmo fingerprint recuperam o resultado histórico original, mesmo quando revisões posteriores existem. UUID reutilizado com outro corpo ou revisão antiga de outra operação retorna 409 sem sobrescrever nada. Não existe merge automático de rascunhos concorrentes.

### Status de operação

Pedido `{acao:'status_operacao',operation_id:UUID}`; não exige `operation_kind`.

- Ausente: `operation:null`. Isso não é prova de falha de um pedido ainda em trânsito.
- Upload pendente: `operation:{id,kind:'upload',status:'pending',revision:null,result:null}`.
- Upload concluído: `operation:{id,kind:'upload',status:'committed',revision:null,result:{photo}}`.
- Commit: `operation:{id,kind:'commit',status:'committed',revision,result:{workspace}}`.

Cliente deve conferir id e tipo esperados. Recuperação de upload também confere paciente, consulta, id, hashes, MIME, tamanhos e dimensões do pedido retido. Commit não retorna foto e upload não retorna workspace.

### Upload

Multipart com `acao=upload`, `operation_id`, `expected_revision`, `patient_id`, `visit_id`, `photo_id`, `original:File`, `preview:File`.

A paciente e a consulta em aberto devem estar salvas na revisão esperada. Reserva idempotente antecede upload dos objetos. Falha parcial mantém operação pendente: repetir o mesmo UUID, revisão, contexto e bytes recupera o original existente por tamanho/hash e termina a prévia, sem sobrescrever objeto. Upload não aumenta revisão; depois o cliente realiza commit vinculando a foto. Foto enviada ainda não vinculada não recebe URL por `obterfoto`.

`photo` devolve `id,patient_id,visit_id,sha256,mime_type,size_bytes,preview_sha256,preview_mime_type,preview_size_bytes,width,height,original_width,original_height`. `width/height` são as dimensões da prévia usada pelo mapa. Caminhos internos não são enviados.

Limites: original 8 MiB, prévia 2 MiB, JPEG/PNG/WebP estático, até 40 megapixels. Validação verifica estrutura íntegra (PNG com CRC/chunks, JPEG com segmentos/SOF/SOS/EOI, WebP com RIFF/chunks/bitstream) e hash. Não decodifica todos os pixels nem avalia qualidade clínica; imagem original nunca é retocada ou regravada. Arquivos abandonados permanecem privados até uma futura rotina de limpeza explícita e auditada.

### Obter foto

Pedido `{acao:'obterfoto',photo_id}`. Apenas fotografia pronta, pertencente à clínica autenticada e vinculada ao estado atual na paciente/consulta verificadas. Resposta inclui metadados `photo` + `original_url,preview_url,expires_in:120`. Hashes e bytes devem ser conferidos também pelo cliente. URLs assinadas não entram em state, backup ou IndexedDB do piloto.

## Invariantes verificadas no servidor

Validadores puros do app são extraídos/copied por `sync-domain.mjs`, com hashes de fonte e resultado em `_shared/app-workspace-domain/manifest.json`. Não há import do monólito legado ou módulo que abra IndexedDB/DOM; seed é excluído. Após mudança no domínio, executar sincronização e testes antes de publicar.

Além do validador estrutural: registros anteriores não são apagados; pagamentos, estornos e movimentos anteriores são preservados; alterações cadastrais/despesas precisam de versão/histórico; custos derivam de centavos inteiros e quantidade fixa dos lotes; conclusão exige baixa correspondente e ligação exclusiva com a cobrança; snapshot selecionado de procedimento não pode ser reescrito nem em rascunho; catálogo novo deve sustentar o snapshot inicial. Lote precisa estar válido no dia do servidor (São Paulo), inclusive em conclusão retrodatada pelo cliente.

Consulta concluída aceita apenas adendos novos. Orçamento aprovado/cancelado preserva valores; edição de rascunho e comparação exige versão anterior exata. Produto de orçamento não gera sessão. Original de foto e vínculo são imutáveis. Mapa aceita edição versionada ou desfazer exatamente o último quadro; o estado completo de todas as revisões permanece na tabela de versões, inclusive quadros fora do limite visual de vinte. Retornos não podem desaparecer. Agendamento concluído preserva horário/profissional; novo horário/reagendamento é validado contra disponibilidade.

## Limites explícitos desta entrega

- Assinatura `assinado_demo` nunca vira consentimento real. Endpoint aceita apenas respostas em rascunho; finalização de procedimento com documentos obrigatórios configurados é bloqueada até integrar o fluxo real de documentos. Não relaxa essa exigência nem afirma validade jurídica de assinatura desenhada.
- Solicitações públicas do site requerem uma ponte explícita: `requests` locais não são promovidas ao servidor. Site/legado permanecem separados.
- Estado até 4 MiB, até 10.000 entradas por coleção e até 10.000 fotos prontas por clínica nesta versão. Acima disso a operação falha de forma explícita; não corta dados. Fotos são consultadas com paginação para evitar o teto de linhas do REST.
- Histórico de revisões existe; restauração de revisão/exportação integral privada ainda não tem endpoint dedicado. Nenhuma restauração do backup demonstrativo é aceita como atalho de migração.
- Perfis de profissionais no calendário não criam contas. Somente proprietários ativos autenticados são admitidos neste endpoint.
- Testes locais usam dados fictícios; mock de rede/SDK quando indicado. SQL é executado de fato em PostgreSQL/WASM PGlite 0.5.10 com estruturas de Auth/Storage mínimas de teste. Não comprova configuração, tráfego, latência, URLs assinadas ou upload em produção; esses pontos precisam de homologação autenticada após deploy.

## Publicação pelo responsável

Migrations criadas via CLI Supabase **2.121.0**, apenas localmente:

1. `20261015220006_app_workspace_private_cas.sql` — quatro tabelas, quatro RPCs, bucket e política exclusiva novos.
2. `20261015220008_revoke_legacy_protocol_truncate.sql` — mudança separada e estreita, retira somente TRUNCATE de public/anon/authenticated nas duas tabelas legadas; preserva Edge/service_role e demais privilégios.

Registrar no config compartilhado (responsável pelo deploy):

```toml
[functions.app-workspace]
enabled = true
verify_jwt = false # JWT + sessão ativa + owner + AAL2 são verificados em dual-auth.
entrypoint = "./functions/app-workspace/index.ts"
```

Variáveis somente da função: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, já fornecidas pelo ambiente Supabase. Sem segredo novo no site. Entregar apenas os módulos de runtime e o bundle puro ao deploy; testes/sync/README não são importados pelo endpoint. Não aplicar migrações pendentes de outras frentes em lote.

Verificações locais na raiz do repo:

```powershell
& 'C:\Users\rotan\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' supabase/functions/app-workspace/sync-domain.mjs --check
& 'C:\Users\rotan\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --test supabase/functions/app-workspace/*.test.mjs painel/piloto-simples/tests/cloud-contract-review.test.mjs
& 'C:\Users\rotan\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\fallback\pnpm.cmd' dlx deno@2.5.4 check --no-config --no-lock --no-remote --no-npm supabase/functions/app-workspace/index.ts
```

Dependência de teste SQL existente: `skinpro-analise/revisoes/codigo-provas/map2d-sql/node_modules/@electric-sql/pglite` 0.5.10. Não é dependência de runtime. Deno check não executa endpoint nem lê credenciais. Guia oficial consultado: [autenticação de Edge Functions](https://supabase.com/docs/guides/functions/auth), [controle de acesso ao Storage](https://supabase.com/docs/guides/storage/security/access-control). Changelog conferido em 15/10/2026: [TLS CBC](https://supabase.com/changelog/cbc-tls-ciphers-deprecated) não exige alteração em clientes atuais; esta migration não utiliza os recursos afetados listados na [mudança PostgreSQL 17.11](https://supabase.com/changelog/postgres-15-19-17-11-breaking-changes).
