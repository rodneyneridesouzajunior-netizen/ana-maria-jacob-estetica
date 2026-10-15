# Ponte de documentos recebidos — primeira etapa

Implementação local. A migration e a Edge precisam ser aplicadas/publicadas pelo responsável após revisão. Este arquivo não afirma implantação nem homologação de assinatura profissional.

## Escopo e autorização

Reutiliza a autenticação existente do app-workspace: sessão Supabase ativa, owner e MFA AAL2. As RPCs revalidam ator/sessão e o escopo singleton dos documentos legados. Não cria pacientes no cadastro antigo, não copia PDFs/assinaturas, não escreve respostas de documentos no snapshot e não altera seu contrato de commit.

O vínculo significa somente **original recebido associado à consulta**. Não é revisão profissional, assinatura da profissional, aprovação de texto ou autorização clínica. Os bloqueios existentes de assinatura demonstrativa e de conclusão com documentos obrigatórios permanecem integralmente ativos.

## Ações POST em app-workspace

Todas as respostas de sucesso incluem `ok:true, auth_method:'supabase_auth', role:'owner', clinic_id`. Erros usam `codigo/erro` e status HTTP seguros.

* `listar_documentos_originais`: `patient_id/visit_id` opcionais juntos; `search` até 120 caracteres, `limit` 1–50 (padrão25), `offset` 0–10000. Retorna `documents`, `pagination:{limit,offset,has_more}` e `capabilities:{link_received:true,clinical_authorization:false,professional_signature:false}`. Sem paciente selecionada, documentos podem ser consultados, mas não ficam elegíveis para vínculo.
* `listar_vinculos_documentos`: `patient_id,visit_id`. Retorna `links`, revisão atual do workspace e capacidades. Cada vínculo preserva seu retrato histórico e informa `current_identity_matches/available` recalculados. Correções cadastrais não movem documentos para outra identidade silenciosamente.
* `obter_documento_original`: `source_kind:'anamnese'|'documento_clinico',source_id:UUID,expected_source_fingerprint:SHA256`. Confere a versão da fonte e os bytes do PDF antes de emitir `pdf:{url,sha256,expires_in:120}`. Caminhos de Storage e CPF integral nunca são devolvidos.
* `vincular_documento`: campos acima mais `operation_id:UUID,expected_revision,patient_id,visit_id,confirmed_identity:true,reason` (3–500 caracteres). Retorna `link`, `workspace_revision` histórica e `operation:{id,kind:'document_link',status:'committed',replayed}`.
* `status_vinculo_documento`: `operation_id`. Retorna `operation:null` ou `{id,kind:'document_link',status:'committed',result:{link,workspace_revision}}`. Ausência não comprova que um pedido em trânsito falhou. Após perda da resposta, consultar ou repetir exatamente UUID e corpo anteriores; nunca gerar chave nova automaticamente.

Documento público da resposta: `source_kind,source_id,type,title,status,source_version,source_hash,signature_sha256,pdf_sha256,source_fingerprint,received_at,identity:{name,cpf_masked,birth_date,phone_masked},archived,withdrawn,eligible_for_link,blockers,matching:{cpf_matches,name_matches,birth_matches},clinical_authorization:false`.

`source_hash` é o hash do modelo de anamnese/termo; o fingerprint cobre também identidade, hashes de assinatura/PDF/registro e situação atual. Não se confunde com o SHA do PDF.

## Condições para vínculo

Exige fonte `recebido`, não arquivada/retirada, versão e hashes completos, caminhos canônicos dos formulários existentes, PDF e assinatura cujos bytes correspondem aos hashes registrados. CPF do cadastro deve ser válido e igual ao original; nomes normalizados devem ser iguais (sem comparação por substring). Nascimento divergente bloqueia quando os dois registros o possuem. Nome, CPF ou data faltantes/divergentes não são corrigidos automaticamente.

O servidor baixa os objetos apenas do Storage do mesmo Supabase e limita leitura a 5 MiB para PDF e 500.000 bytes para assinatura. Não faz upload, retoque, cópia de paciente ou envio externo. A verificação comprova integridade dos bytes em relação ao registro existente; não certifica identidade civil, validade jurídica ou avaliação clínica.

## Transação, exclusão e histórico

Migration `20261015224148_app_workspace_clinical_document_links.sql`, criada pela CLI Supabase2.121.0. Adiciona `app_workspace_document_links` e `app_workspace_document_events`, ambas RLS e sem grants anon/authenticated. Service recebe apenas SELECT/INSERT; eventos/vínculos não têm UPDATE/DELETE.

A RPC faz CAS da revisão salva e confere paciente/consulta aberta sob o mesmo advisory lock do workspace. O vínculo tem operação própria e não muda a revisão JSON. FKs individuais para anamneses e documentos_clinicos usam RESTRICT, permitindo à rotina legada `fichas_exclusao_vinculos` detectar a retenção antes de excluir Storage.

O guard privado usa exatamente o advisory lock `clinic:ficha_delete:kind:id`, empregado tanto na preparação como na conclusão da exclusão legada. Também verifica intenção ainda vigente e tombstone. Seu SECURITY DEFINER é estreito e necessário para consultar esse controle privado; não concede ao serviço leitura das tabelas privadas antigas e não possui EXECUTE público. Ator/sessão e escopo são revalidados dentro dele.

Este passo não implementa desvincular ou revisar clinicamente: erros de associação requerem um futuro evento de correção preservando o histórico. Não há exclusão silenciosa.

## Testes e limites de evidência

`clinical-bridge.test.mjs`: handler HTTP real, autenticação/negação, máscara de dados, identidade, replay, fonte alterada e Storage por fetch sintético. `clinical-migration.test.mjs`: SQL real em PostgreSQL/WASM PGlite, com estruturas Auth/Storage legadas sintéticas declaradas; usa também a função de bloqueadores legada original. `clinical-sql-fixture.mjs` é compartilhável com a revisão independente.

PGlite com conexão única não comprova interleaving de duas sessões reais. O teste autenticação real, Storage do ambiente e corrida concorrente em PostgreSQL de homologação ainda dependem de publicação coordenada. Nenhum teste desta implementação criou dados na nuvem.

Referências consultadas: [RLS e grants](https://supabase.com/docs/guides/database/postgres/row-level-security); changelog Supabase conferido em15/10/2026. Não usa GraphQL, algoritmos TLS antigos ou novo provedor de autenticação.
