# Conclusão clínica pessoal e configurações versionadas

Implementação e testes sintéticos; este documento não afirma publicação, assinatura de paciente/profissional real, validação de habilitação ou homologação no celular físico.

## Separação das responsabilidades

O vínculo de um original recebido continua sendo apenas recebimento. O rascunho do editor continua sem assinatura operacional; assinaturas demonstrativas nunca são promovidas. O estado `signed` dos protocolos legados não é reutilizado como prova de assinatura profissional: a RPC legada pode atribuir esse estado sem uma assinatura pessoal correspondente.

O novo fluxo recebe a confirmação pessoal da profissional por conta autenticada e MFA, preservando declaração, ator, data, hashes e revisão. O método se chama `authenticated_session_mfa`. Não é ICP-Brasil, biometria nem prova externa da habilitação. A tabela de credenciais antiga, cujo escopo é `post_procedure_followup`, não é reutilizada para criar uma atribuição clínica maior.

## Preparação administrativa explícita

1. Em Configuração clínica, selecionar a profissional do aplicativo e uma conta proprietária existente e já autorizada neste aplicativo, conferir identidade, informar motivo e confirmar. Não há inferência por nome, convite ou mudança de permissões. Substituição/revogação gera versão nova; o histórico permanece.
2. Selecionar a versão do procedimento e associar **cada** modelo exigido ao tipo de original oficial correto. O hash e o JSON dessa versão são preservados. Uma versão histórica só pode ser configurada se existir no catálogo ou em consulta preservada.
3. Os tipos com suporte de conclusão são anamnese, TCLE de toxina botulínica e TCLE de preenchimento facial. Intradermoterapia, bioestimulador, peeling e fios de PDO permanecem pré-avaliações: não substituem TCLE por conveniência. Modelos personalizados/de imagem ainda precisam de fluxo de assinatura oficial correspondente; a política não permite contornar essa ausência.

Escolher uma conta não a torna profissional verificada. É uma atribuição administrativa auditável. A confirmação final precisa acontecer **na conta atribuída**, nunca na conta de outra pessoa. Nenhuma atribuição Ana/Rodney deve ser criada automaticamente na publicação.

## Protocolo HTTP em app-workspace

Mantém o acesso existente `supabase_auth`, proprietário e AAL2. Todas as RPCs repetem escopo da clínica e sessão. Campos desconhecidos são recusados nos envios de preparação/conclusão/configuração.

- `listar_configuracao_clinica`: retorna membros ativos, vínculos mais recentes e políticas mais recentes, sem credenciais, convites ou tokens.
- `configurar_conta_profissional`: `operation_id, professional_id, member_id, expected_version, status, reason, confirmed:true`. Status active/revoked. Retorno `configuration` com UUID, versão e recibo.
- `configurar_documentos_procedimento`: `operation_id, procedure_id, procedure_version, requirements:[{template_id,source_type}], expected_version, status, reason, confirmed:true`.
- `status_configuracao_clinica`: `operation_id, kind:'profile'|'policy'`. Retorna registro histórico exato ou null. Null não comprova falha de uma operação em trânsito.
- `preparar_conclusao_clinica`: `operation_id, expected_revision, patient_id, visit_id, procedure_id, consumptions, quote_id?, item_id?, sessions`. Não grava. Retorna `review` com pendências, resumo, declaração e hash.
- `concluir_consulta_clinica`: o mesmo corpo anterior com `review_hash, declaration_version, confirmed:true`. Revalida tudo, constrói estado no servidor e confirma em transação.
- `status_conclusao_clinica`: `operation_id`. Recupera workspace histórico e assinatura do recibo exato ou null.

Para materiais, consumptions admite somente `lotId,quantity,photoId?,pointId?,reason?`. IDs de ator, assinatura, estado e conjunto de conclusões confiáveis nunca vêm do cliente.

## Verificações e transação

A preparação encontra paciente e consulta salvas e abertas, procedimento preservado, conta profissional vinculada e política da versão. Para cada requisito, seleciona deterministicamente o vínculo elegível mais recente do tipo configurado. Reconfere CPF/nome/nascimento, situação e fingerprint da fonte, e baixa PDF/assinatura apenas do armazenamento autorizado para verificar seus bytes e hashes. Originais arquivados, retirados, incompletos ou de identidade divergente bloqueiam.

`completeVisit` monta estoque, sessões, financeiro e snapshot no servidor. `validateTransition` recebe `clinicalCompletions: new Set([visit.id])` **somente dentro do módulo confiável**. O commit genérico não pode preencher esse Set, mesmo enviando campo com o mesmo nome. Nenhuma conclusão nova do commit genérico deve ser liberada.

O hash apresentado cobre a solicitação, revisão/hash do estado, perfil, política, originais selecionados e versão da declaração. Na confirmação, a Edge recalcula e exige igualdade. A RPC obtém o lock do workspace, repete sessão/conta/política, bloqueia fontes e repete identidade/situação/fingerprint. Usa o mesmo guard de exclusão dos originais. O commit do estado e o INSERT da assinatura acontecem na mesma transação. Falha reverte todos os efeitos. O registro assinado referencia a versão preservada do workspace.

O recibo idempotente usa UUID e fingerprint. Repetir exatamente a operação retorna o recibo original sem duplicar assinatura, baixa ou cobrança. Novo corpo com UUID antigo é recusado. A leitura do recibo histórico não finge que a assinatura acabou de acontecer. Configurações possuem recuperação própria antes de consultar um catálogo que possa ter mudado.

## Integração e arquivos

- Backend: `clinical-completion.mjs`, `clinical-settings.mjs`; root integra seus arrays de ações/factories no handler. Factory de conclusão recebe o validador operacional.
- RPCs: migration `20261015235931_app_workspace_clinical_completion.sql`. Tabelas RLS sem grants anon/authenticated. Serviço tem SELECT/INSERT, sem UPDATE/DELETE de configuração/assinatura.
- Repository: completionContext → app_workspace_clinical_context; completionOperation → app_workspace_clinical_operation; completeClinical → app_workspace_complete_clinical; clinicalSettings → app_workspace_clinical_settings; configureClinicalProfile → app_workspace_configure_clinical_profile; configureClinicalPolicy → app_workspace_configure_clinical_policy; clinicalConfigurationOperation → app_workspace_clinical_configuration_operation.
- Cliente: `clinical-completion-service.mjs`, `clinical-completion-ui.mjs`, `clinical-completion.css`. Root compartilha sessão ativa e integra rota `#configuracao-clinica`/confirmação final.
- `mountClinicalSettings(host,{service,getState,onChanged,notify})` possui ready/refresh/isBusy/isDirty/hasUncertain/discard/dispose.
- `mountClinicalCompletion(host,{service,input,onComplete,onCancel,notify})` possui ready/isBusy/isDirty/hasUncertain/discard/dispose. onComplete recebe recibo com workspace e signature; erros na atualização da tela não apagam a confirmação já recebida.

## Testes e limites

Testes Node exercitam o validador operacional real, requisições sintéticas, perda de resposta, recibo trocado, logout, confirmação não marcada e ausência de inferência. SQL executa PostgreSQL/WASM PGlite com Auth e originais sintéticos. Valida atomicidade, replay, conta diferente, revogação, mudanças de fonte/política/perfil e grants.

PGlite em conexão única não prova interleaving de sessões concorrentes em PostgreSQL remoto. Ainda se exige publicação coordenada, conferência da sessão real e teste humano de confirmação com a conta da profissional, sem o agente assinar por ela. Fechar o navegador à força perde o rascunho/UUID pendente em memória; os recibos salvos permanecem no servidor, e a unicidade por consulta impede uma segunda conclusão.

## Integração verificada com o aplicativo

A tela de conclusão conectada entrega os dados estruturados ao serviço de revisão clínica, sem commit genérico de conclusão. O formulário anterior permanece disponível em cancelamento ou erro de abertura, inclusive lotes, quantidades e motivo. Quando a assinatura é confirmada mas a releitura falha, a tela mantém o recibo e oferece apenas recarregar a consulta, sem repetir a conclusão.

Consultas anteriores sem procedimento preservado ou profissional identificada recebem uma etapa explícita de configuração. A escolha registra uma versão válida do catálogo e uma profissional habilitada para atendimento no cadastro local, usando o CAS operacional de rascunho; não assina nem conclui. Fotos, notas, mapas e data ficam preservados. A seleção de conta pessoal é separada dessa atribuição de atendimento.

Rejeições determinísticas de originais (404/409/422) liberam a operação para correção. Respostas desconhecidas, timeout e falha de conexão continuam preservando a operação incerta. Rejeições de versão em configurações atualizam as versões do servidor, conservam o rascunho e exigem nova confirmação explícita. Contas com papel somente `professional` não aparecem para vínculo porque esta versão do aplicativo requer `owner`; o vínculo clínico não amplia essa permissão.
