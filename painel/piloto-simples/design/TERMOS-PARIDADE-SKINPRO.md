# Anamnese e consentimentos — requisitos comparados

Atualização de 16/10/2026. A biblioteca própria contém **12 modelos editáveis: 10 termos específicos, uma autorização independente de imagem e uma anamnese geral**. O seletor observado no Skin Pro contém 11 itens — os dez termos e uso de imagem — e foi novamente conferido nesta data. **A cobertura desse inventário foi implementada; paridade integral de todos os comportamentos do Skin Pro não foi comprovada.**

Os textos adicionais têm redação própria e fontes primárias, com a identidade da Ana. A presença dos modelos não significa revisão clínica/jurídica concluída, habilitação de procedimento ou homologação em aparelhos reais. Este documento registra código, observações e testes; **não atesta a nova publicação**. A conferência de publicação pertence ao relatório do release.

## Como interpretar a evidência

| Classificação | Significado |
|---|---|
| OBSERVADO | Interface ou percurso do Skin Pro efetivamente consultado, limitado aos estados descritos. |
| CÓDIGO | Implementação localizada no repositório; não comprova publicação por si só. |
| TESTADO | Ensaio executado no ambiente e com o escopo informados; teste sintético não é atendimento real. |
| PENDENTE / NÃO TESTADO | Falta definição, revisão ou evidência. Não equivale automaticamente à ausência de função. |

Não são reproduzidos dados de pacientes, credenciais, links individuais, assinaturas ou conteúdo de prontuários.

## Regras da Ana

1. **Anamnese geral obrigatória**, conferida na conclusão mesmo quando a política do procedimento não possui termo específico. Trata-se de requisito do projeto; não se afirma que o Skin Pro imponha a mesma regra em todos os estados.
2. Declarações gerais ficam na anamnese. Termos mantêm objetivos, riscos, cuidados, limites e decisões próprios, sem novo aceite geral de dados. Nenhuma resposta em TCLE comprova recebimento da anamnese.
3. Imagem/publicidade é uma decisão independente; consentimento para procedimento não autoriza publicação.
4. Marca oficial e layout da Ana são preservados; não há cópia da identidade visual nem presunção de acesso ao código interno do Skin Pro.
5. Versões, snapshots e originais emitidos/recebidos permanecem preservados. Atualizar um modelo não altera respostas, assinatura ou PDF anteriores.
6. Preparado, link emitido, recebido, vinculado e revisado são estados distintos. Hash comprova correspondência técnica, não autoria, aprovação clínica ou habilitação.
7. Importar modelos não conclui revisão profissional nem configura automaticamente um procedimento. O plano clínico e os requisitos do catálogo precisam de definição explícita.

## O que foi observado no Skin Pro

| Área | Evidência observada | Limite |
|---|---|---|
| Inventário de consentimentos | Seletor de 11 itens; os oito antes faltantes foram abertos e conferidos item a item em 16/10/2026. | Refere-se ao seletor acessível nesta inspeção; não prova inexistência de recursos em outras configurações. |
| Conteúdo dos oito itens | Estrutura de objetivo, resultados, riscos e cuidados, com informação geral de dados e imagem no encerramento. | Os textos próprios da Ana não são transcrições nem certificação de equivalência clínica. |
| Editor | Nome, blocos e reordenação; interface informa preservação dos termos já enviados/assinados. | Preservação após edição concorrente no Skin Pro não foi ensaiada. |
| Anamnese | Cinco etapas e 47 perguntas exibidas no catálogo, incluindo condições; encerramento com dados, revisão e assinatura. | Não houve comparação integral de todas as combinações condicionais. |
| Fluxo do atendimento | Gerar/recuperar link, selecionar modelo, acompanhar estado e prosseguir até fotos com termo aguardando assinatura. | Não demonstra a regra global de encerramento do Skin Pro. Link criado não comprova assinatura. |
| Leitura pública | Formulário de ácido hialurônico consultado, incluindo objetivo, produto, riscos, cuidados e dados. | Nenhuma assinatura real foi realizada nessa comparação. |
| Imagem | Modelo separado e escolhas de imagem no editor. | Não foram ensaiados todos os estados de revogação, escopo e publicação no Skin Pro. |

## Biblioteca e interface implementadas

A biblioteca combina [modelos originais](../document-library.mjs) e [oito termos adicionais](../document-library-procedures.mjs). Os quatro IDs anteriores são conservados. A anamnese geral tem 68 perguntas no catálogo, incluindo condicionais; isso não significa 68 respostas sempre exigidas.

A [interface de documentos](../documents-ui.mjs) oferece busca por nome, filtro por tipo, contagem de modelos adicionados e cartões com estado/versão. **Adicionar modelos que faltam** abre seleção explícita com prévia do texto/perguntas, marcar todos e limpar seleção. A importação acrescenta somente IDs ausentes e preserva modelos existentes, inclusive editados.

Na consulta, **Preparar documento** agrupa os modelos por tipo, indica rascunhos já preparados e confere se a versão mudou antes de salvar. Editar um modelo cria nova versão. Não existe aprovação profissional presumida pelo botão de importação ou pelo checklist de seleção.

| Item observado | Modelo correspondente no código | Pendência clínica / de escopo |
|---|---|---|
| Toxina Botulínica | Modelo próprio editável; formulário oficial histórico preservado. | Revisão individual e produto utilizado. |
| Ácido Hialurônico | Modelo próprio editável; formulário oficial histórico preservado. | Plano, região e indicação do produto. |
| Preenchimento Labial | Novo termo específico com riscos, herpes, limites e alertas. | Produto destinado aos lábios e cuidados individualizados. |
| Preenchimento Facial Full Face | Novo termo limitado a preenchimento com ácido hialurônico em regiões identificadas. | Não autoriza toda a face nem procedimentos/material diferentes. |
| Rinomodelação | Novo termo de contorno nasal com ácido hialurônico e destaque vascular. | Indicação brasileira do produto e plano nasal; não promete redução estrutural ou melhora respiratória. |
| Bioestimuladores | Novo termo próprio editável. A pré-avaliação oficial anterior permanece com seu estado. | Identificar material/IFU; PLLA, CaHA e outras formulações não são equivalentes. |
| Fios de PDO | Novo termo próprio editável. A pré-avaliação oficial anterior permanece preservada. | Marca/modelo/finalidade e instrução aplicável. |
| Fios Silhouette | Novo termo para Silhouette Soft. | Não equivale a PDO, Lift ou InstaLift; confirmar variante. |
| Hialuronidase | Novo termo próprio sobre finalidade, limites e riscos. | Confirmar medicamento/bula/finalidade; indicação brasileira de dissolução estética não foi comprovada nesta pesquisa. |
| Lipoescultura Cirúrgica de Pescoço | Novo modelo estrutural cirúrgico, editável. | Definir operação, equipe, ambiente, anestesia e seguimento; o título não habilita cirurgia. |
| Uso de Imagem | Modelo próprio independente, com decisão de escopo e recusa preservada. | Revisão profissional e aplicação real do escopo de uso. |

A anamnese é o 12º modelo da biblioteca da Ana e não integra aquele seletor de 11 consentimentos. Pré-avaliações existentes de intradermoterapia e peeling não foram convertidas em TCLE final para aumentar contagens.

Cada termo adicional possui seis blocos e três perguntas específicas opcionais. Objetivo/compreensão/dúvidas informados pela paciente não substituem o plano da equipe. [Fontes e limites dos oito modelos](./TERMOS-FONTES-E-ESCOPO.md) registram 21 referências consultadas, sem copiar conteúdo do Skin Pro.

## Fluxo e preservação

O percurso implementado é: revisar/configurar modelo → preparar para paciente/consulta → emitir link sob MFA → paciente ler/responder/assinar/confirmar → servidor receber e preservar originais → equipe reabrir e conferir → profissional confirmar pessoalmente a conclusão quando todos os requisitos estiverem atendidos.

A página pública `/documento/` usa capacidade individual com prazo e revogação, sem credenciais da equipe. A emissão mantém modelo, versão, conteúdo e contexto. A retomada após falha conclui somente uma submissão previamente confirmada, com o mesmo payload; não cria assinatura nova.

| Requisito | Implementação / limite |
|---|---|
| Validação no servidor | Conteúdo, identidade, versão, respostas e traços; snapshot, assinatura vetorial e PDF com hashes. Assinatura declaratória não é ICP-Brasil, biometria ou revisão profissional. |
| Reenvio e falha | Operação idempotente, lease e payload preservados; confirmação incerta não produz outro original. |
| Anamnese e múltiplos procedimentos | Conclusão exige anamnese elegível e reúne requisitos dos procedimentos da consulta e das marcações, preservando versões. Importar biblioteca não dispensa essas regras. |
| Catálogo e contexto | Vínculo é por ID/versão; alteração concorrente pode impedir confirmação. Não vincular por similaridade do título. |
| Originais e revogação | Revogação bloqueia acesso público e uso futuro elegível; recibo/PDF privado recebido é preservado. |
| Histórico oficial | v1/v2/v3 e leitura de originais legados permanecem preservados; leitura histórica não promove registro a recebido/aprovado. |
| Acesso | Área da equipe mantém MFA e clínica; respostas tardias não devem atravessar logout ou troca de contexto. Link público não é sessão administrativa. |
| Limite atual | Fluxo público exige pessoa adulta e nascimento válido. Representante legal/menores não implementados. |

Referências: [contrato público](./PUBLIC-DOCUMENTS-API.md), [editor](../documents-editor.mjs), [ponte dos originais](./CLINICAL-BRIDGE.md), [conclusão clínica](../../../supabase/functions/app-workspace/clinical-completion.mjs) e [histórico dos formulários oficiais](../../../supabase/tests/TCLE-VERSIONING.md).

## Testes confirmados e limites da prova

- **Baseline histórico anterior: 1.090 testes aprovados**, sem falhas/cancelamentos/skips, no lote de múltiplos procedimentos e documentos personalizados. Esse número **não é o total da nova biblioteca** e não deve ser reapresentado como execução desta rodada.
- Nesse baseline, SQL de mapas teve 8 testes em rodada separada; posteriormente um teste focal de rateio de centavos integrou uma suíte de 6/6. Não somar novamente testes focalizados à suíte geral.
- **Rodada final após congelamento do conteúdo: 1.139/1.139 testes aprovados**, sem falhas, cancelamentos ou skips, em uma execução de 106 arquivos. Inclui app, integração, backend, fotos, documentos personalizados, histórico dos termos e SQL de mapas. Os hashes dos quatro arquivos de biblioteca/interface/editor permaneceram iguais antes e depois da execução.
- As rodadas focais anteriores de 80/80 em documentos/UI (incluindo 18/18 de biblioteca) e 20/20 de backend/SQL já estão cobertas pela rodada final. **Não somar 80, 20, 18 ou o baseline histórico de 1.090 ao total atual de 1.139.**
- Os testes da biblioteca exercitam os 12 IDs, importação, versões, snapshots, persistência serializada/backup, seleção e vínculos de procedimentos. O PDF real é extraído integralmente, inclui perguntas/respostas/rodapés e é comparado em repetição após mudança posterior do modelo.
- PostgreSQL/PGlite e migrations reais exercitam RPC, RLS/permissões, recuperação e integridade. Fixtures de autenticação/armazenamento não provam uma sessão real em outro aparelho.
- **Prova operacional anterior à ampliação:** documento explicitamente fictício e sem validade foi emitido pela UI, recebido, reaberto e baixado pelos acessos público e privado com bytes iguais. Após revogação do link anterior, acesso público foi recusado e PDF privado original permaneceu idêntico. Houve recarga e reabertura na área privada. Isso testa o fluxo publicado naquele momento; não comprova a nova publicação dos oito modelos nem assinatura de pessoa real.
- Renderização e texto do PDF v2 do ensaio foram conferidos, com quebras por palavra. Não extrapolar a inspeção de uma página para afirmar que todos os documentos/aparelhos receberam homologação visual.
- **Pendente:** revisão profissional dos 12 modelos e suas políticas, produto/IFU/plano específicos, celular físico, atendimento real e conferência da publicação deste lote.
- **Não comprovado:** equivalência clínica/jurídica dos textos, todos os estados internos do Skin Pro ou ausência absoluta de erros.

## Critérios de aceite e homologação

Os critérios abaixo preservam o escopo de verificação. Cobertura automatizada não equivale à conclusão de todos os ensaios operacionais ou à revisão clínica. AC-03, AC-06 e AC-12 continuam dependendo também de aparelho físico; AC-08 depende de regra profissional de atualização, sem prazo clínico inventado.

| ID | Critério verificável | Prova mínima exigida |
| --- | --- | --- |
| AC-01 | A emissão captura modelo/versão, texto, perguntas, paciente e consulta. Editar o modelo depois não modifica o documento emitido. | Emitir v1, publicar v2, reabrir o link antigo e o PDF recebido, comparando conteúdo e hashes originais. |
| AC-02 | Gerar/recuperar link individual é idempotente e possui escopo limitado ao documento, sem fornecer acesso ao restante do prontuário ou à conta da equipe. Credenciais de clínica não são solicitadas à paciente. | Repetir emissão; testar link inexistente, expirado, revogado e tentativa de trocar identificadores. Nenhum token ou dado de saúde em logs públicos. |
| AC-03 | Leitura em celular apresenta o documento completo, perguntas aplicáveis, decisões e revisão antes de assinar. Não declara que o texto foi lido apenas porque a tela foi aberta ou rolada. | Ensaiar 320/390 px, teclado, foco, rótulos e escolhas condicionais; conferir texto/versão idênticos aos do recibo. |
| AC-04 | A paciente confirma pessoalmente os aceites específicos e fornece a assinatura; finalidade de imagem permanece independente. Ausência, negativa ou falha não são convertidas em aceite positivo. | Rejeitar confirmação faltante, assinatura vazia e payload adulterado; preservar recusas de imagem no registro e no PDF. |
| AC-05 | O servidor valida a versão emitida, conteúdo, respostas, identidade e assinatura; o recebimento gera registro e PDF recuperáveis com hashes. Hash técnico não é apresentado como atestado de assinatura ou revisão profissional. | Perder a resposta após gravar, reenviar a mesma operação e receber o mesmo original; adulterações e duplicações falham sem sobrescrever. |
| AC-06 | Os estados distinguem preparado/link emitido/aguardando assinatura/recebido/vinculado/revisado, com falha e revogação quando aplicáveis. Avançar no preenchimento interno não oculta pendências de conclusão. | Reabrir em notebook e celular, incluindo resposta tardia, recarga e erro de rede, sem falso sucesso. |
| AC-07 | A conclusão exige anamnese recebida e elegível da paciente, com conferência profissional, inclusive quando o procedimento não tem termo específico configurado. Selecionar “já preenchi” em um TCLE não satisfaz a regra. | Testar catálogo/política vazios, anamnese ausente, ilegível, de outra paciente, legado sem comprovação, documento retirado e confirmação profissional ausente; todos devem bloquear a conclusão apropriada. |
| AC-08 | Anamnese e termos específicos são associados sem repetir autorizações gerais. Reutilização de anamnese previamente recebida depende de regra explícita de atualização/conferência, definida com a profissional; não inventar prazo clínico. | Atendimento com anamnese existente e mudança de informações; demonstrar o que é reaproveitado, o que exige atualização e qual versão ficou vinculada à conclusão. |
| AC-09 | A lista de documentos do catálogo e a política de conclusão preservam anamnese obrigatória e termo específico aplicável. Pré-avaliação não satisfaz exigência de TCLE final. | Alterar catálogo/política durante revisão e provar rejeição por versão/CAS; tentar contornar por chamada direta à API ou edição do snapshot. |
| AC-10 | Original recebido/assinado permanece imutável e acessível no histórico. Nova redação não migra respostas/aceites antigos. Leitura histórica não transforma legado em recebido, assinado ou autorizado. | Regressão v1/v2/v3, recuperação de envio interrompido, hash/caminho original, recusa de sobrescrita e leitura de histórico sem mutação. |
| AC-11 | Conta da equipe mantém MFA/escopo da clínica; resposta antiga não abre arquivo após logout ou troca de paciente/consulta. O link público possui contrato de acesso próprio, sem reutilizar sessão administrativa. | Testes de AAL1, clínica diferente, IDs trocados, URL fora do armazenamento autorizado, logout durante abertura e resposta de outro contexto. |
| AC-12 | Marca e layout da Ana permanecem consistentes no app, página pública e PDF. A disponibilidade de um modelo não afirma aprovação do conteúdo ou habilitação do procedimento. | Revisão visual no notebook e celular real; conferência do documento completo pela profissional antes de liberar cada modelo operacional. |

## Próximas verificações

1. Conferir o release do conteúdo/UI e seus arquivos publicados, mantendo versões e originais existentes. Registrar resultado depois do deploy.
2. Revisar cada modelo aplicável com a profissional e configurar conscientemente os requisitos dos procedimentos. Não criar aprovação em seu nome.
3. Homologar em notebook e celular físico o percurso sintético completo, incluindo leitura, preenchimento, retomada e reabertura do original.
4. Validar o plano clínico e as instruções concretas antes de usar modelos em atendimento real; pendências de hialuronidase e cirurgia cervical não se resolvem pelo título do modelo.

Esta atualização é documental. Não altera registros clínicos, aceites, assinaturas, modelos salvos na conta ou PDFs recebidos.
