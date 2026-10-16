# Anamnese e consentimentos — requisitos comparados

Registro de 15/10/2026. **Paridade funcional com o Skin Pro: PENDENTE.** Este documento organiza a continuidade autorizada; não declara os termos concluídos nem implementa novos módulos.

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

## Comparação com o código da Ana

| Requisito | CÓDIGO localizado | LACUNA / PENDENTE | NÃO TESTADO nesta rodada |
| --- | --- | --- | --- |
| Editar modelos, perguntas, etapas e blocos | `documents-domain.mjs` valida tipos de pergunta, condições, etapas, blocos, versões e snapshots; `documents-editor.mjs` fornece o editor. | Ainda não há paridade completa do percurso editor → link público → assinatura operacional do modelo personalizado. O editor existente publica/salva por ação explícita; não presumir o salvamento imediato observado no Skin Pro. | Edição simultânea em dois aparelhos e todos os tipos de pergunta no celular. |
| Preservar versões anteriores | `saveTemplate` acrescenta versão; `prepareDocument` captura snapshot; respostas assinadas de demonstração não são reescritas. Os seis formulários oficiais têm catálogo histórico v1/v2/v3. | Fazer a emissão pública de modelos personalizados preservar o mesmo snapshot do começo ao fim. | Compatibilidade de futuros modelos públicos ainda não implementados. |
| Link público individual para paciente | `documents-ui.mjs` copia link privado do documento, que exige acesso da clínica. `clinical-bridge-ui.mjs` disponibiliza rotas públicas dos formulários oficiais existentes. | **PENDENTE:** emitir/recuperar link individual de um documento preparado no app, vinculado à paciente, à consulta e à versão do modelo. Link privado ou rota geral do site não atende esse requisito. | Entrega de um novo link individual e abertura externa no celular sem conta da equipe. |
| Assinatura operacional de modelo personalizado | `documents-ui.mjs` desabilita a assinatura de demonstração no ambiente conectado. Os formulários oficiais possuem fluxos próprios de submissão e geração de PDF. | **PENDENTE:** assinatura pública versionada dos modelos criados no app. Não habilitar `signDemoDocument` como solução operacional. | Assinatura real de paciente, envio e recuperação de um modelo personalizado. |
| Consentimentos específicos sem duplicação geral | A v3 dos seis formulários remove `aceite_dados`/`tratamento_dados`; mantém privacidade informativa, respostas específicas, leitura, decisão e assinatura. `anamnese/index.html` possui a declaração geral. | Garantir a mesma separação em novos modelos e no editor. Textos novos necessitam revisão da profissional; não copiar automaticamente o bloco geral do Skin Pro. | Equivalência semântica integral entre todos os textos da Ana e os onze modelos do Skin Pro. |
| Anamnese exigida na conclusão | `clinical-completion.mjs` confere documentos descritos pela política do procedimento; `procedureDocumentIds` agrega `requiredDocumentIds` e `consentTemplateId`. | **PENDENTE:** tornar anamnese um requisito de conclusão que não desapareça com catálogo/política sem documento geral. O código lido não estabelece essa invariante universal. | Regra global de conclusão do Skin Pro. Não inferir a regra a partir da tela Documentos. |
| Compatibilidade do catálogo com documentos | Há snapshots de procedimento, configuração explícita de política e conferência da versão/hash antes da conclusão. | Padronizar catálogo e políticas para exigir anamnese e o termo específico aplicável. O backend atual aceita como fontes de conclusão anamnese, TCLE de toxina e TCLE de preenchimento; as quatro pré-avaliações não substituem TCLE. | Configuração completa do catálogo real da clínica e adequação profissional de cada associação. |
| Recebimento, vínculo e revisão separados | `clinical-bridge.mjs`, `clinical-bridge-service.mjs` e `clinical-bridge-ui.mjs` consultam originais, conferem identidade/fingerprint e mantêm vínculo auditado. A conclusão exige declaração da conta profissional configurada. | Integrar futuros documentos personalizados nesse mesmo contrato sem promover rascunho a recebido ou recebido a autorizado. | Recebimento de todos os futuros modelos e sua conclusão clínica em produção. |
| Consulta do PDF e histórico | Originais modernos são verificados antes de abrir; o novo acesso histórico usa `pdf_path` armazenado, sem mudar o status legado. `historical_file_only` identifica hash calculado na leitura atual. | Manter esse comportamento ao ampliar modelos; nunca reconstruir documento antigo com texto ou assinatura atuais. | Conferência visual/conteúdo de cada PDF legado real. |
| Autorização de imagem | Os seis formulários públicos mantêm escolhas independentes. O domínio de modelos inclui `kind: 'imagem'`, mas a assinatura operacional personalizada permanece bloqueada. | **PENDENTE:** percurso público do modelo independente de imagem, quando aplicável, com finalidade/escopo e controle de revogação definidos. | Publicação efetiva com autorização, revogação e todos os estados do modelo separado. |

Referências no repositório: [documentos](../documents-ui.mjs), [domínio dos documentos](../documents-domain.mjs), [editor](../documents-editor.mjs), [ponte dos originais](./CLINICAL-BRIDGE.md), [conclusão clínica](../../../supabase/functions/app-workspace/clinical-completion.mjs), [versionamento dos seis termos](../../../supabase/tests/TCLE-VERSIONING.md).

## Inventário dos 11 modelos observados

Os nomes abaixo identificam itens do inventário. A existência de um item no Skin Pro não demonstra que o procedimento integra a atuação ou o catálogo autorizado da Ana. A habilitação do procedimento e o conteúdo aplicável precisam ser confirmados pela profissional antes de publicar um modelo novo.

| Modelo observado | Situação no código da Ana | Estado de paridade |
| --- | --- | --- |
| Toxina Botulínica | Formulário oficial `/tcle-toxina/`, versões v1/v2/v3. | **PENDENTE:** integrar ao percurso de emissão por modelo/paciente/consulta e conferir todos os campos/estados. |
| Ácido Hialurônico | Formulário de preenchimento facial `/tcle-preenchimento/`, versões v1/v2/v3. | **PENDENTE:** comparação detalhada do conteúdo aplicável e do percurso público individual. |
| Preenchimento Labial | Não localizado formulário operacional separado neste inventário. | **PENDENTE:** definir necessidade de modelo específico; não presumir equivalência automática com preenchimento facial. |
| Preenchimento Facial Full Face | Não localizado formulário operacional separado neste inventário. | **PENDENTE:** mesma definição profissional e de modelo específico. |
| Rinomodelação | Não localizado formulário operacional separado neste inventário. | **PENDENTE:** confirmar aplicabilidade e conteúdo específico. |
| Bioestimuladores | `/tcle-bioestimulador/` está identificado como pré-avaliação. | **PENDENTE:** pré-avaliação não será renomeada como consentimento final para aparentar equivalência. |
| Fios de PDO | `/tcle-fios-pdo/` está identificado como pré-avaliação. | **PENDENTE:** consentimento aplicável e integração de conclusão, se o procedimento for habilitado. |
| Fios Silhouette | Não localizado formulário operacional separado neste inventário. | **PENDENTE:** aplicabilidade, modelo e percurso. |
| Hialuronidase | Não localizado formulário operacional separado neste inventário. | **PENDENTE:** aplicabilidade, modelo e percurso. |
| Lipoescultura Cirúrgica de Pescoço | Não localizado formulário operacional separado neste inventário. | **PENDENTE:** não habilitar por mera presença no catálogo de referência. |
| Uso de Imagem | Escolhas independentes nos formulários; tipo de modelo `imagem` no app. | **PENDENTE:** documento público independente com assinatura operacional e estados de autorização. |

Também existem pré-avaliações de intradermoterapia e peeling químico na Ana. Elas não apareceram entre os onze itens do seletor consultado. Isso não comprova ausência desses recursos em outras áreas ou configurações do Skin Pro.

## Critérios de aceite para a próxima implementação

Estes critérios são requisitos, não entregas já concluídas. Não removem os bloqueios atuais de assinatura operacional personalizada.

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

## Ordem de continuidade

1. Fechar o contrato de documento público versionado aproveitando os componentes e as garantias já existentes; não habilitar a assinatura de demonstração no servidor.
2. Implementar a invariante de anamnese na conclusão e sua relação com catálogo/políticas, preservando consulta e histórico existentes.
3. Homologar um percurso completo com modelo e paciente fictícios: emitir, abrir no celular, responder, assinar no ensaio autorizado, receber, reabrir original e vincular. A aprovação de cada texto pela profissional é uma entrega separada da aprovação técnica.
4. Ampliar somente para os modelos aplicáveis à clínica, mantendo versões anteriores e os mesmos testes de integridade, recebimento e contexto.

## Verificação disponível e pendências

- A revisão de código do acesso a PDF histórico nesta rodada executou **45 testes locais aprovados** de cliente, handler, repositório, DOM e cenários adversariais. Usou dados sintéticos e rede/banco simulados; não foi assinatura real nem prova de implantação.
- O histórico dos seis termos possui testes de compatibilidade v1/v2/v3 e manifesto de hashes. Consulte `supabase/tests/TCLE-VERSIONING.md` e os resultados do lote correspondente; este documento não executou novamente toda a suíte dos termos.
- **PENDENTE:** assinatura pública operacional dos modelos personalizados, emissão individual ligada ao atendimento, invariante universal de anamnese na conclusão, ampliação/homologação dos modelos aplicáveis e teste integral em notebook/celular com persistência real.
- **NÃO TESTADO:** assinatura e recebimento final do Skin Pro nesta comparação, conclusão do atendimento de referência com documentos pendentes, conteúdo integral dos onze modelos e equivalência clínica/jurídica dos textos.

Nenhuma alteração de formulário, autorização, assinatura, registro de paciente, migração ou publicação foi realizada para produzir este documento.
