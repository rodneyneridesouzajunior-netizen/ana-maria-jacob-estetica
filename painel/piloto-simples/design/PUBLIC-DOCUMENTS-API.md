# Documento individual — contrato operacional

Contrato de implementação, 16/10/2026. Não representa homologação clínica dos modelos.

## Equipe autenticada: `app-workspace`

Todas as ações usam sessão individual owner/AAL2. Envelope existente `ok`, `auth_method`, `role`, `clinic_id`.

- `emitir_documento_paciente`: `{operation_id, expected_revision, document_id, expires_in_days:7}`. `document_id` é o documento preparado em `state.documentResponses`; o servidor captura sua versão/snapshot e o vínculo paciente/consulta. Retorna `{issue,operation}`. Repetir a mesma operação recupera a emissão original, sem trocar texto/validade.
- `listar_emissoes_documento`: `{document_id}`. Retorna `{issues:[issue...]}`; recupera o link válido somente sob MFA.
- `revogar_documento_paciente`: `{operation_id,issue_id}`. Retorna `{issue,operation}`. Revoga a capacidade pública e elegibilidade futura, preservando original/recibo anterior.
- `obter_pdf_documento_paciente`: `{issue_id}`. Retorna `{issue,pdf:{url,sha256,expires_in:120}}` apenas se recebido; permite consultar original preservado mesmo após revogação, sob MFA.

`issue`: `{id,document_id,patient_id,visit_id,template_id,template_version,kind,title,status,issued_at,expires_at,snapshot_hash,received_at,revoked_at,public_url?}`. Estados `issued`, `processing`, `received`, `revoked`. URL pública: `https://anamariajacob.com.br/documento/#token=...`. Não registrar token em logs, analytics, armazenamento permanente ou referrer. Prazo permitido: 1–30 dias.

## Paciente: nova Edge Function `documento-paciente`

Somente POST JSON, sem cookies nem sessão da equipe. Token no corpo da requisição, obtido do fragmento da URL. CORS da clínica, respostas `Cache-Control:no-store` e limite de requisições. Erros `{ok:false,codigo,erro}`.

- Abrir: `{acao:'abrir',token}` → `{ok:true,document:{id,title,kind,templateVersion,snapshot,patientName},snapshot_hash,confirmation:{version,text,general_data_text?},expires_at,status}`. Não retorna CPF/telefone, outros documentos, paciente_id ou consulta_id. Snapshot usa o contrato existente de `documents-domain.mjs`.
- Assinar: `{acao:'assinar',token,operation_id,snapshot_hash,confirmation_version,answers,signer_name,signature_strokes,confirmed:true,general_data_consent?,image_use?}` → `{ok:true,receipt}`. `operation_id` UUID deve ser mantido junto ao payload até confirmação; não criar outra operação ao perder a resposta.
- Recibo: `{acao:'recibo',token}` → `{ok:true,receipt}` quando recebido; antes disso retorna erro de pendência. Link expirado/revogado não abre recibo público, mas a equipe pode acessar o original autenticada.

Regras do envio:

- `confirmation_version`: valor devolvido em `confirmation.version`; a declaração é exibida antes da confirmação.
- `confirmed` deve ser explicitamente `true`. `signer_name` deve coincidir com o nome capturado na emissão, após normalização de espaços/acentos. Isso é conferência declaratória, não reconhecimento biométrico.
- `signature_strokes`: 1–100 linhas de 2–1024 pontos `{x,y}` normalizados; até 20 mil pontos no total e traço com deslocamento. Nenhuma assinatura automática ou nome de demonstração é aceito como atalho.
- Para `kind:'anamnese'`, `general_data_consent:true` é obrigatório e o texto correspondente vem no retorno de abertura. Para outros tipos, não enviar esse campo; não herdar ou inventar consentimento geral.
- Para `kind:'imagem'`, `image_use` exige escolha explícita entre `tratamento`, `publicacao` e `nao_autorizado`. Para outros tipos, não enviar esse campo. A recusa fica registrada e não equivale a recusa do atendimento.
- `answers` usa IDs e valores do snapshot; respostas ocultas/desconhecidas não entram no original. Perguntas obrigatórias visíveis são validadas no servidor.

`receipt`: `{id,document_id,status:'received',signed_at,snapshot_hash,pdf_url,pdf_sha256,expires_in:120,clinical_authorization:false}`. A URL HTTPS deve pertencer ao backend conhecido e ao bucket privado `app-custom-documents`. Recebimento não equivale a revisão profissional.

## Integração clínica

`repository.customClinicalSources({p_clinic,p_actor,p_session,p_patient,p_visit})` consulta apenas o contexto exato. Cada fonte recebida tem `source_kind:'custom_doc'`, `source_id` UUID da emissão, `type:'custom_doc'`, `template_id`, `template_kind`, `patient_id`, `visit_id`, `identity`, `status:'recebido'`, versão/hash do snapshot, hashes do PDF/assinatura/registro, caminhos canônicos e fingerprint.

RPCs: `app_custom_document_source(p_clinic,p_actor,p_session,p_id)` e `app_custom_document_sources(p_clinic,p_actor,p_session,p_patient,p_visit)`. A conclusão deve conferir template e tipo, paciente/consulta exatos, recebimento, integridade, ausência de revogação e declaração profissional. Não misturar com os registros históricos ou transformar assinatura de demonstração em operacional.

Arquivos privados: `<clinicUUID>/<issueUUID>/documento.pdf` e `assinatura.json`. O JSON preserva declaração, nome e traços da assinatura; o PDF desenha os mesmos traços em vetor. Reenvio recupera bytes existentes e não sobrescreve o original. Nenhuma migração reescreve documentos anteriores.

### Retomada após interrupção ou recarga
`abrir` inclui `can_resume:true` quando há submissão confirmada reservada (`processing`). Nesse estado não apresentar nova assinatura. A ação pública `{acao:'retomar',token}` retoma exclusivamente a operação e as respostas/decisões/traços imutáveis já reservados no servidor. Não aceita UUID, respostas nem outra assinatura. Um lease ainda ativo responde `custom_processing`; recebido devolve o recibo existente. `issued` sem confirmação reservada rejeita a retomada. O botão deve exigir clique e informar que conclui o envio já confirmado.
