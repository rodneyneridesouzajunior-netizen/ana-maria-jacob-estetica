# Anamnese e consentimentos — requisitos comparados

Atualização de 16/10/2026. **Paridade integral com o Skin Pro: NÃO COMPROVADA.** O percurso técnico de documentos individuais foi implementado e testado com dados sintéticos. A biblioteca própria entregue contém quatro modelos; isso não significa onze modelos equivalentes, revisão clínica dos textos ou homologação em aparelhos reais. A publicação e sua conferência são registradas separadamente pelo responsável pelo release.

O objetivo é oferecer os percursos de edição, envio, leitura, assinatura e consulta do original com a identidade Ana Maria Jacob. A comparação é de comportamento observado e código disponível, sem copiar o design ou presumir acesso ao código interno do Skin Pro. Não constitui revisão clínica ou jurídica dos textos.

## Como interpretar a evidência

| Classificação | Significado |
| --- | --- |
| OBSERVADO | Interface ou percurso do Skin Pro efetivamente consultado; a abrangência é a descrita, sem extrapolar para outros estados. |
| CÓDIGO | Comportamento localizado no repositório da Ana. Existir no código não comprova publicação ou funcionamento em aparelho real. |
| LACUNA / PENDENTE | Diferença concreta ou requisito da Ana que ainda precisa de implementação, configuração ou homologação. |
| NÃO TESTADO | Não há evidência suficiente para afirmar o resultado. Não equivale a ausência da função. |

As evidências locais do Skin Pro estão em `skinpro-analise/revisao-item-a-item-20261015/`, na raiz do workspace. Este documento não reproduz dados de pacientes, links individuais de formulário, tokens, assinaturas ou conteúdo de prontuários.

## Regras da Ana que orientam a implementação

1. **Anamnese geral obrigatória para todas as pacientes, conferida na conclusão do atendimento.** O catálogo e as políticas dos procedimentos devem preservar essa exigência; uma lista vazia de documentos específicos não deve dispensá-la. Esta é uma regra solicitada pelo usuário, não uma regra universal comprovada do Skin Pro.
2. Declarações e autorizações gerais ficam na anamnese. Termos por procedimento mantêm informações, perguntas, riscos, cuidados e consentimentos próprios, sem duplicar o aceite geral de dados. Nunca preencher aceites automaticamente nem afirmar que a anamnese foi recebida por causa de uma resposta no TCLE.
3. Autorização de imagem, especialmente divulgação/publicidade, permanece uma decisão independente. Consentimento para atendimento não autoriza publicação de imagem. Recusa e escopo da autorização devem ser preservados.
4. Identidade visual da Ana em todo o percurso: marca oficial transparente, sem placa ou moldura, e componentes existentes em off-white, rosé e dourado. A marca não será redesenhada para reproduzir o Skin Pro.
5. Original recebido ou assinado é imutável. Alterar o modelo cria nova versão para novos documentos. Registros históricos, respostas, texto, assinatura e PDF anteriores não são substituídos pela versão atual.
6. Documento preparado, link emitido, recebido, assinado pela paciente, vinculado ao prontuário e revisado pela profissional são estados distintos. Um hash comprova correspondência de bytes dentro do contrato técnico; não comprova, sozinho, autoria, assinatura ou aprovação profissional.

## O que foi observado no Skin Pro

| Área | Evidência observada | Limite da observação |
| --- | --- | --- |
| Modelos de consentimento | Seletor com 11 modelos, criação de termo, edição do nome, blocos e reordenação. A interface informa salvamento das alterações para próximos termos e preservação dos já enviados/assinados. | O aviso e os controles foram vistos; preservação real após edição concorrente e assinatura não foi ensaiada. |
| Anamnese configurável | Cinco etapas: dados iniciais; saúde e hábitos; pele, rotina e estética; condições clínicas; expectativas e observações. A interface exibe 47 perguntas somadas nas etapas e condições de exibição em parte delas. | Não houve comparação integral das 47 perguntas nem validação de todas as combinações condicionais. |
| Encerramento da anamnese | Partes fixas de uso de dados de saúde, revisão das respostas e assinatura. | A assinatura real e a persistência do documento final não foram exercitadas nesta comparação. |
| Atendimento / documentos | Gerar ou recuperar link da anamnese, selecionar um modelo, gerar link do termo, consultar novamente o link e ver o estado de assinatura. | Link criado não é prova de recebimento ou assinatura. Nenhum link individual é reproduzido aqui. |
| Leitura pública de consentimento | O agente principal abriu ao vivo o formulário de ácido hialurônico e leu cinco partes cobrindo objetivo, características do produto, riscos, cuidados e informações sobre dados. | Nenhuma assinatura foi feita. O relato não equivale a validação clínica/jurídica nem a leitura integral dos outros dez modelos. |
| Avanço no atendimento | O agente principal conseguiu prosseguir até fotos com termo gerado ainda em **Aguardando assinatura da paciente**. | Isso demonstra que aquele avanço não exigiu assinatura. Não demonstra se o Skin Pro exige anamnese/termo ao concluir, nem autoriza considerar o procedimento liberado. |
| Imagem e confirmação | O editor mostra escolhas de uso de imagem e uma confirmação final de leitura/dúvidas. Há também um modelo separado de uso de imagem. | Revogação, escopo da publicação e comportamento do documento final ainda não foram verificados de ponta a ponta. |

Fontes locais: `consentimentos-modelos.txt`, `consentimento-bloco-editor.txt`, `clinica-modelos.txt`, `anamnese-etapa-dados.txt`, `anamnese-pergunta-editor.txt` e `atendimento-documentos.txt`. As duas observações ao vivo acima foram relatadas pelo agente principal nesta rodada; não são apresentadas como novos testes independentes deste documento.

## Escopo efetivamente implementado nesta entrega

A biblioteca `document-library.mjs` oferece **quatro modelos próprios**, derivados dos documentos existentes da clínica, para importação explícita e revisão no editor. Nenhum modelo foi importado automaticamente para a conta real, nem assinado em nome da paciente ou da profissional durante os testes.

| Modelo próprio | Tipo | Escopo entregue |
| --- | --- | --- |
| Ficha de anamnese geral | `anamnese` | 68 perguntas no catálogo do modelo, condições de exibição e autorização geral separada na confirmação pública. O número inclui perguntas condicionais; não significa 68 respostas sempre exigidas. |
| Consentimento — Toxina botulínica | `termo` | Modelo versionado, perguntas e consentimentos específicos, sem repetir a autorização geral de dados nem converter a escolha de imagem em requisito do procedimento. |
| Consentimento — Preenchimento com ácido hialurônico | `termo` | Modelo versionado de preenchimento; não equivale automaticamente a modelos separados de lábios, full face ou rinomodelação. |
| Autorização independente de uso de imagem | `imagem` | Documento separado, escolha explícita entre uso para tratamento, publicação ou não autorizado; recusa preservada no original. Não satisfaz TCLE nem anamnese na conclusão. |

O percurso implementado é: preparar o documento no atendimento → emitir o link individual com MFA → paciente ler/responder/assinar/confirmar → servidor receber e preservar os originais → equipe reabrir PDF e conferir → profissional confirmar pessoalmente a conclusão quando todos os requisitos forem atendidos. A emissão fica presa ao modelo, versão, snapshot, paciente e consulta. A paciente não precisa das credenciais da equipe.

A página pública é `/documento/`, servida pela Edge `documento-paciente`. O token fica no fragmento do link e é enviado no corpo da requisição; não é uma sessão da clínica. Há prazo de validade, revogação e retomada de submissão já confirmada após falha/recarga. **Retomar não inventa assinatura:** só conclui a operação e os traços já reservados, sem aceitar novo conteúdo ou outra chave.

## Comparação com o código da Ana

| Requisito | Implementação verificada em código/testes | Limite ou pendência real |
| --- | --- | --- |
| Editor e biblioteca | Editor de perguntas, condições, etapas, blocos e versões; quatro modelos próprios para seleção explícita. | Não há inventário integral dos onze modelos com conteúdo equivalente. Editor salva por ação explícita; não se afirma o mesmo autosave do Skin Pro. |
| Versões e emissão | Emissão captura snapshot persistido e vínculo paciente/consulta. Modelo posterior não modifica link ou original anterior. Repetição recupera a mesma emissão. | Configuração e revisão dos modelos da conta real dependem da equipe; não foram inferidas por nomes. |
| Link individual público | Emitir, listar emissões, recuperar link válido, revogar e reabrir PDF privado sob MFA. Paciente acessa apenas o documento correspondente. | Entrega efetiva a uma paciente e abertura em celular físico ainda precisam de homologação. |
| Assinatura e PDF personalizados | Validação de respostas/decisões/nome/traços no servidor; assinatura preservada como JSON canônico e desenhada em vetor no PDF real. Arquivos em bucket privado com hashes conferidos. | Assinatura eletrônica declaratória; não é ICP-Brasil, biometria ou comprovação automática de autoria/habilitação. Nenhuma assinatura real foi executada no ensaio. |
| Falha, recarga e retomada | UUID e payload preservados; confirmação incerta não cria outra emissão/assinatura. Retomada pública usa somente submissão previamente confirmada e reservada; lease impede dois escritores. | Sem confirmação reservada não há retomada automática nem aceite presumido. |
| Declarações sem repetição | Termos próprios não carregam o aceite geral nem o bloco de imagem da anamnese; formulários oficiais v3 mantêm seus contratos históricos. | Conteúdo clínico e adequação de cada texto precisam de revisão profissional. Os formulários oficiais não foram reescritos por este lote. |
| Anamnese universal | Backend e transação SQL exigem uma anamnese recebida/elegível mesmo quando catálogo e políticas não trazem documento geral. Aceita original oficial vinculado ou anamnese própria do contexto exato. | Não foi inventado prazo de validade clínico para reaproveitamento. Informação alterada ou retirada exige nova conferência. |
| Procedimentos por marcação | Cada vínculo explícito preserva ID/versão/snapshot; ausência mantém herança legada, `null` significa nenhum. Conclusão reúne todos os procedimentos e suas políticas/termos, deduplicando requisitos. | Quantidade sem procedimento não permite concluir. Versões divergentes do mesmo procedimento exigem escolha explícita; opção da versão preservada do atendimento resolve catálogo atualizado sem alterar histórico. |
| Custos, sessões e conclusão | Vários itens de orçamento explícitos, sessão por procedimento, custo material atribuído ao ponto e preço independente do número de pontos. Estoque, cobrança, assinatura profissional e revisão são confirmados no mesmo fluxo transacional. | As prévias não aprovam clinicamente procedimentos. Orçamento compartilhado não é rateado como receita de um atendimento nem apresentado como lucro líquido. |
| Originais e revogação | Fonte própria exige template/tipo, paciente/consulta, integridade, recebido e ausência de revogação. Revogar bloqueia uso futuro e acesso público, preservando PDF/recibo privado. | Recebimento não equivale à revisão profissional. Pré-avaliações e autorização de imagem não substituem TCLE. |
| Histórico oficial | Preservados v1/v2/v3 e acesso somente de leitura ao PDF legado com caminho registrado. | Leitura histórica não promove documento a recebido, assinado ou autorizado. Conteúdo de cada original real não foi revisado neste lote. |

Referências: [biblioteca própria](../document-library.mjs), [contrato público](./PUBLIC-DOCUMENTS-API.md), [documentos](../documents-ui.mjs), [editor](../documents-editor.mjs), [ponte dos originais](./CLINICAL-BRIDGE.md), [conclusão clínica](../../../supabase/functions/app-workspace/clinical-completion.mjs), [versionamento dos seis termos](../../../supabase/tests/TCLE-VERSIONING.md).

## Inventário dos 11 modelos observados

Os nomes abaixo identificam itens do inventário. A existência de um item no Skin Pro não demonstra que o procedimento integra a atuação ou o catálogo autorizado da Ana. A habilitação do procedimento e o conteúdo aplicável precisam ser confirmados pela profissional antes de publicar um modelo novo.

| Modelo observado | Situação no código da Ana | Estado de paridade |
| --- | --- | --- |
| Toxina Botulínica | Formulário oficial `/tcle-toxina/` v1/v2/v3 e novo modelo próprio com emissão individual. | Percurso técnico implementado; comparação integral dos campos/estados e homologação profissional ainda pendentes. |
| Ácido Hialurônico | Formulário oficial `/tcle-preenchimento/` v1/v2/v3 e novo modelo próprio com emissão individual. | Percurso técnico implementado; equivalência de conteúdo e homologação profissional ainda pendentes. |
| Preenchimento Labial | Não localizado formulário operacional separado neste inventário. | **PENDENTE:** definir necessidade de modelo específico; não presumir equivalência automática com preenchimento facial. |
| Preenchimento Facial Full Face | Não localizado formulário operacional separado neste inventário. | **PENDENTE:** mesma definição profissional e de modelo específico. |
| Rinomodelação | Não localizado formulário operacional separado neste inventário. | **PENDENTE:** confirmar aplicabilidade e conteúdo específico. |
| Bioestimuladores | `/tcle-bioestimulador/` está identificado como pré-avaliação. | **PENDENTE:** pré-avaliação não será renomeada como consentimento final para aparentar equivalência. |
| Fios de PDO | `/tcle-fios-pdo/` está identificado como pré-avaliação. | **PENDENTE:** consentimento aplicável e integração de conclusão, se o procedimento for habilitado. |
| Fios Silhouette | Não localizado formulário operacional separado neste inventário. | **PENDENTE:** aplicabilidade, modelo e percurso. |
| Hialuronidase | Não localizado formulário operacional separado neste inventário. | **PENDENTE:** aplicabilidade, modelo e percurso. |
| Lipoescultura Cirúrgica de Pescoço | Não localizado formulário operacional separado neste inventário. | **PENDENTE:** não habilitar por mera presença no catálogo de referência. |
| Uso de Imagem | Novo modelo próprio independente com emissão/assinatura, recusa e revogação; escolhas anteriores preservadas. | Percurso técnico implementado; publicação real, aplicação do escopo e homologação profissional não foram testadas. |

Também existem pré-avaliações de intradermoterapia e peeling químico na Ana. Elas não apareceram entre os onze itens do seletor consultado. Isso não comprova ausência desses recursos em outras áreas ou configurações do Skin Pro.

## Critérios de aceite e alcance da prova

Os critérios permanecem como referência de homologação. AC-01, AC-02, AC-04, AC-05, AC-07, AC-09, AC-10 e AC-11 têm cobertura automatizada com dados sintéticos no escopo técnico descrito acima. AC-03/AC-06 têm cobertura de DOM, recarga, resposta tardia e falha, mas não substituem teste físico em notebook/celular. AC-08 depende também da definição profissional de atualização da anamnese. AC-12 e a equivalência clínica dos textos continuam pendentes de revisão humana. A coluna de prova abaixo expressa o critério completo, não afirma que todo ensaio real já ocorreu.

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

## Continuidade após implementação

1. Conferir publicação das duas migrations e das duas Edge Functions com o bundle de domínio gerado; manter o histórico e os originais existentes.
2. Homologar no notebook e em celular físico o percurso com paciente fictícia: preparar, emitir, abrir, responder, confirmar/assinar pessoalmente, receber, interromper/retomar quando aplicável e reabrir o mesmo PDF.
3. A profissional revisa os quatro textos próprios e configura explicitamente quais modelos e políticas atendem aos procedimentos da clínica. Cadastro de conta e conclusão pessoal não devem ser feitos em nome dela pelo agente.
4. Ampliar apenas os modelos aplicáveis à clínica, depois de conferir conteúdo, escopo e capacidade de atendimento. Os oito itens do inventário observado que não correspondem aos três tipos específicos cobertos acima não foram implementados como novos modelos neste lote; a anamnese geral é o quarto modelo próprio e não integra aquele seletor de onze.

## Verificação desta entrega e limites

- Suíte integrada registrada: **1.090 testes aprovados**, sem falhas, cancelamentos ou skips, abrangendo app, integração, backend, fotos/marcações, histórico dos termos e documentos personalizados. Log: `skinpro-analise/revisao-item-a-item-20261015/testes-multiprocedimentos-documentos.txt`, na raiz do workspace.
- SQL de mapas: **8 testes aprovados** em rodada separada, sem sobreposição; log `testes-multiprocedimentos-sql-mapa.txt` no mesmo diretório. Depois foi acrescentado um teste de divisão exata de centavos entre dois itens do mesmo procedimento; o arquivo `marking-procedures.test.mjs` passou com 6/6. Não somar novamente os testes focalizados à suíte geral.
- Os ensaios de documentos exercitam PostgreSQL/PGlite com migrations reais, RPC sob `service_role`, RLS/permissões, renderização de PDF real, bytes/hashes, reenvio e retomada. Auth/armazenamento externos são fixtures; isso **não é prova de assinatura de paciente real, de publicação ou de uso em dois aparelhos físicos**.
- O fluxo público personalizado nesta entrega exige paciente adulta com data de nascimento válida. Representante legal/menores não foi implementado. O PDF recusa caracteres não suportados antes de reservar o envio, permitindo corrigir o texto sem prender uma operação incompleta.
- **PENDENTE DE HOMOLOGAÇÃO:** revisão profissional dos modelos/políticas, teste físico em notebook/celular, atendimento real com conta pessoal da profissional e comprovação da publicação pelo responsável pelo release.
- **NÃO COMPROVADO:** paridade integral com os onze modelos do Skin Pro, equivalência de conteúdo clínico/jurídico, funcionamento de todos os estados daquele sistema e ausência absoluta de erros.

Esta atualização registra implementação e testes. Não altera textos clínicos, assinaturas, autorizações ou registros de pacientes, nem comprova publicação por si só.
