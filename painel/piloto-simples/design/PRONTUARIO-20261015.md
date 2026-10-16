# Prontuário Ana Maria Jacob — revisão de 15/10/2026

## Objetivo e alcance

Reorganizar a interface da paciente e do atendimento, mantendo os editores, campos, fotografias, documentos e operações já existentes. A referência observada no SkinPRO orientou a hierarquia das informações; a identidade utilizada é própria da Ana Maria Jacob, em off-white, rose, champagne e grafite.

Esta revisão não declara equivalência integral ao SkinPRO nem acesso ao código interno do produto. Também não transforma uma fotografia em reconstrução facial 3D: o mapa utiliza a fotografia da paciente e marcações manuais em uma camada separada.

Este documento registra o escopo técnico e as evidências de revisão. A confirmação da publicação e da versão servida em produção deve constar do registro específico de implantação; a existência deste arquivo não comprova publicação.

## Interface implementada

### Paciente

- Visão geral com identificação, último atendimento, data de atualização quando existente, contadores de atendimentos e registros em andamento.
- Informações cadastrais, observações, retornos previstos, agendamentos ainda sem atendimento vinculado e acesso ao editor de paciente existente.
- Atendimentos em andamento separados do histórico. Ações para continuar atendimento, consultar documentos e abrir o resumo.
- Biblioteca de antes e depois incorporada ao prontuário, com as fotografias e comparações da paciente selecionada.
- Cartão de anamnese distingue ficha preparada, rascunho e demonstração. Não deduz assinatura oficial a partir de um documento local, contador ou atendimento concluído.
- O atalho Orçamentos abre a lista geral da clínica; não é um filtro automático pela paciente.

Componentes: [patient-record-ui.mjs](../patient-record-ui.mjs) e [patient-record.css](../patient-record.css).

### Resumo do atendimento

- Cabeçalho com retorno à paciente, nome do procedimento preservado, data, horário quando disponível, situação e profissional cadastrada.
- Ações reais para documentos, registro completo ou continuação do atendimento aberto, fotos/comparações, mapa facial e impressão.
- Foto clínica integral com marcações numeradas, linhas e leques. O seletor troca a fotografia e sua legenda juntas; abrir o mapa mantém a fotografia selecionada.
- Legenda por fotografia com região, produto, quantidade/unidade, lote e observações. Totais são separados por unidade e por foto: duas vistas podem registrar a mesma aplicação e não devem ser somadas como consumo físico.
- Procedimento, materiais efetivamente registrados, lote/validade, evolução preservada e adendos separados.
- Financeiro diferencia valor cobrado, recebido, saldo e custo registrado. Resultado e margem são de contribuição, não lucro líquido. O total de um orçamento com vários itens ou sessões não é atribuído automaticamente a uma consulta. Cobranças ambíguas permanecem sem total escolhido artificialmente.
- Campos ausentes são identificados como não informados. Um registro bloqueado sem situação de conclusão não é rotulado como concluído.
- “Imprimir / salvar PDF” chama a impressão do navegador. Não é um gerador de PDF clínico assinado nem um envio automático de documento.

Componentes: [visit-record-ui.mjs](../visit-record-ui.mjs) e [visit-record.css](../visit-record.css). A apresentação é somente leitura; as alterações continuam nos editores anteriores.

### Comparações e mapa

- Prévia das comparações salvas com divisor ajustável e alternativa lado a lado. Se existir apenas Antes, a interface informa Depois pendente.
- Edição, versões e seleção de fotografias continuam no controlador existente da biblioteca. As imagens de outras pacientes não entram no conjunto de seleção.
- Originais são preservados; a prévia não altera arquivos, não salva por conta própria e não autoriza divulgação.
- Mapa com zoom 1×, 3×, 6× e 10×, preservando as coordenadas normalizadas. A ampliação não aumenta a resolução do arquivo original.
- Inclusão e ajuste de ponto, linha e leque por toque/arraste e também por controles numéricos/teclado. Consulta concluída mantém a visualização, com edição clínica bloqueada conforme as regras existentes.

Componentes: [comparison-preview.mjs](../comparison-preview.mjs), [comparison-preview.css](../comparison-preview.css), [comparison-library.mjs](../comparison-library.mjs), [map-fit.mjs](../map-fit.mjs) e [map-controls.css](../map-controls.css).

## Integração e preservação de dados

As rotas de navegação continuam no aplicativo existente:

| Área | Rota |
| --- | --- |
| Prontuário da paciente | `#paciente/{patientId}` |
| Resumo do atendimento | `#paciente/{patientId}/{visitId}/resumo` |
| Registro/evolução e revisão | `#paciente/{patientId}/{visitId}/registro` |
| Mapa da fotografia | `#paciente/{patientId}/{visitId}/mapa` |
| Fotos e comparação | `#paciente/{patientId}/{visitId}/fotos` |
| Documentos | `#paciente/{patientId}/{visitId}/documentos` |
| Biblioteca de comparações | `#paciente/{patientId}/comparacoes` |

`app.mjs` monta os componentes, carrega as fotografias pelo provedor de armazenamento já selecionado e conserva os controladores de edição. O modo conectado continua usando o workspace privado; o modo local não constitui prova de salvamento no servidor.

O resumo utiliza `data-photo-src`; não recebe URLs permanentes de fotografias na marcação. A geração da visualização e o encerramento da sessão são conferidos antes de criar um URL de blob. O logout limpa os elementos privados e revoga URLs retidos. Uma fotografia indisponível não interrompe o carregamento das restantes nem desativa o seletor.

Rascunhos de cadastro, evolução, marcações e comparações continuam protegidos contra navegação que os descartaria. O novo resumo não conclui consultas, assina documentos, movimenta estoque ou cria cobranças ao ser aberto.

## Correções auxiliares incluídas no lote revisado

- Reconciliação limitada de conflitos de revisão entre aparelhos: após uma rejeição definitiva, registros independentes de pacientes, consultas abertas e agenda podem ser reaplicados sobre a versão atual. Não há mistura automática de campos do mesmo registro. A operação permanece identificada pelo mesmo UUID enquanto o resultado for incerto.
- A interface preserva o formulário e a marcação se a recuperação falhar; só limpa a edição depois da confirmação. Resposta tardia após logout não repõe dados privados.
- CPF é comparado de forma normalizada ao criar uma identidade ou mudar seu CPF. Duplicidades históricas inalteradas não paralisam trabalho em outro registro; a correção continua exigindo versão e histórico.
- Entrega e estorno de produto de orçamento possuem domínio, validação de transição e replay no servidor com lote, quantidade, custos e idempotência. **A interface operacional de entrega não foi implementada neste lote.** A presença do domínio e dos testes não significa que o usuário já pode executar a entrega pela tela.
- Datas operacionais de entrega respeitam a data civil da clínica; os timestamps de auditoria permanecem em UTC.

## Evidências de testes

A suíte consolidada em `testes-prontuario-final.txt` registra **876 testes aprovados, zero falhas, zero cancelados e zero ignorados**. Duração registrada: 42.081,3558 ms. O total abrange testes existentes e regressões deste lote; não representa cobertura de todos os recursos de um produto concorrente.

Regressões diretamente relacionadas:

- [visit-record-ui.test.mjs](../tests/visit-record-ui.test.mjs): escape de conteúdo, vínculos, dados ausentes, leitura sem mutação, isolamento da paciente, geometria e totais, custo histórico, cobranças compartilhadas/ambíguas e seleção de foto.
- [patient-record-integration.test.mjs](../tests/patient-record-integration.test.mjs): router e DOM reais, biblioteca incorporada, preservação de rascunhos, destinos de edição, impressão e continuidade após falha de uma fotografia.
- [app-reconciliation-ui.test.mjs](../tests/app-reconciliation-ui.test.mjs): recuperação de conflito, confirmação antes de limpar edição, concorrência, logout e descarte de fotografias tardias.
- [app-session-cleanup.test.mjs](../tests/app-session-cleanup.test.mjs): remoção de conteúdo privado e bloqueio de operações depois do encerramento da sessão.
- [cloud-reconciliation.test.mjs](../tests/cloud-reconciliation.test.mjs): cliente e handler reais com fronteiras de I/O simuladas, conflitos, resposta perdida, terceiro aparelho e servidor indisponível.
- [patient-identity.test.mjs](../../../supabase/functions/app-workspace/patient-identity.test.mjs) e [quote-delivery-transitions.test.mjs](../../../supabase/functions/app-workspace/quote-delivery-transitions.test.mjs): CPF, histórico e replay de entrega/estorno com fixtures sintéticas, sem realizar operações em pacientes reais.

## Evidências de navegador e responsividade

O arquivo `responsivo-prontuario-cua.json` registra a conferência CUA nas seguintes larguras. São medidas de navegador, não de telefones físicos:

| Viewport | Largura de página registrada | Largura da fotografia / caixa | Itens de navegação |
| ---: | ---: | ---: | ---: |
| 320 px | 305 px | 247 / 247 px | 5 |
| 390 px | 375 px | 317 / 317 px | 5 |
| 768 px | 753 px | 355,34375 / 355,34375 px | 5 |
| 1440 px | 1425 px | 440 / 440 px | 8 |

Capturas preservadas: `ana-atendimento-390-cua.png`, `ana-atendimento-1440-cua.png` e `ana-atendimento-desktop-cua.png`. Referências observadas: `skin-paciente-referencia.png`, `skin-prontuarios-referencia.png` e `skin-atendimento-referencia.png`.

Os logs e capturas ficam na pasta de evidências externa ao repositório: `../../skinpro-analise/revisao-item-a-item-20261015/`, resolvida a partir da raiz `work/clinica-atual`. O relatório anterior `ENTREGA-CONCLUSAO-20261015.md` continua preservado como registro histórico; seus 754 testes e implantação anterior não são confundidos com este lote de 876 testes.

## Limites conhecidos e validações pendentes

1. **Celular físico:** ainda conferir câmera, toque/arraste, legibilidade, instalação na tela inicial, exportação e o mesmo cadastro conectado em notebook e telefone. Emulação de 320/390 px não comprova esses comportamentos.
2. **Profissional:** a configuração clínica, revisão e confirmação pessoal precisam ser realizadas pela profissional autorizada. Nenhum teste sintético ou ajuste visual equivale à assinatura de Ana ou da paciente.
3. **Documentos oficiais:** a conclusão integrada existente utiliza anamnese, TCLE de toxina e preenchimento. As outras fichas públicas de pré-avaliação e os documentos personalizados não ganham assinatura clínica por esta mudança visual.
4. **Modelo de atendimento:** permanece um procedimento preservado por consulta. Vários procedimentos no mesmo atendimento não foram implementados por este resumo.
5. **Concorrência:** a reconciliação não cobre uploads, movimentações financeiras/estoque, documentos ou registros alterados nos dois aparelhos. A versão recusada é preservada para conferência, sem sobrescrever silenciosamente o servidor. Rascunhos continuam em memória; não foi implementada restauração após encerramento do navegador ou descarte da aba pelo celular.
6. **Entrega de produtos:** domínio e validação estão testados; falta a UI de execução. Entregas sucessivas no mesmo lote exigem commits separados, pois a transição genérica aceita um avanço de versão da entidade por commit.
7. **Impressão e backup:** impressão do resumo não constitui PDF oficial assinado. O backup existente não restaura o servidor nem inclui automaticamente os documentos oficiais e registros externos de assinatura; esses limites anteriores permanecem.
8. **Paridade:** não foi comprovada igualdade de todos os módulos, permissões, integrações, notificações ou regras internas do SkinPRO. Nenhuma tela desta entrega deve ser usada como evidência dessa equivalência.
