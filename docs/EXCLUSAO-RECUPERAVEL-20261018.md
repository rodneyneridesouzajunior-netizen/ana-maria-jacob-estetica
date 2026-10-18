# Exclusão recuperável no aplicativo existente

Pedido de 18/10/2026: todo cadastro criado no aplicativo deve oferecer exclusão pela interface e recuperação persistida. Inclui Financeiro e Orçamentos. Limpeza pontual de testes suspensa; nenhum registro atual deve ser excluído.

Escopo adicional: reproduzir/corrigir o recorte do seletor Ir para uma área em desktop e celular; esclarecer sincronização/revisão/atualização e mover detalhes técnicos para Conta e suporte. Manter o aviso verdadeiro de homologação.

Base recuperada: repositório origin/ main em ab91bb43e5d03d3b11570a1e15cf3e9f91d88420, GitHub Pages legado no domínio existente, app-workspace versão 9, workspace revisão 72. Cópia privada do workspace e do pacote Edge preservadas fora do site em skinpro-analise/exclusao-recuperavel-20261018. Branch local rollback/exclusao-20261018 preserva o código anterior.

Decisão: lixeira lógica no workspace privado existente, sem apagar originais, versões, auditoria ou objetos de Storage. Confirmação nominal, vínculos explícitos, recuperação na interface e CAS/permissões existentes. Não há migração ou alteração de tabela necessária para o campo aditivo do estado JSON.

## Cobertura implementada

29 tipos selecionáveis: pacientes; atendimentos; agendamentos; cobranças; recebimentos; parcelas; despesas; pagamentos de despesas; estornos de recebimentos; estornos de pagamentos; orçamentos; entregas de produtos; estornos de entregas; produtos/materiais; procedimentos; lotes; movimentos de estoque; modelos de documentos; formulários do atendimento; comparações; previsões de retorno; estudos 3D; integrantes da equipe; bloqueios; fechamentos; metas mensais; fotografias; marcações; adendos.

Botões Excluir nas linhas principais e Excluir registro no topo de cada área para os demais detalhes. Lixeira e recuperação está visível nas mesmas áreas. A biblioteca original de PDFs oficiais e os pedidos recebidos do site permanecem acervos próprios, sem exclusão permanente por esta função. Emissões e vínculos de documentos preservam seus originais e permissões existentes.

Uma exclusão de paciente inclui seus vínculos ativos. Excluir um estorno agrupa o recebimento/pagamento/entrega original; excluir uma parcela agrupa a cobrança e suas parcelas/recebimentos. A confirmação enumera os vínculos antes da gravação. Exclusões separadas exigem recuperações separadas. Dados financeiros saem dos totais ativos, sem movimentação bancária externa. Excluir atendimento não devolve material físico ao estoque. Excluir movimento de estoque agrupa seu lote e movimentos.

Recuperação recusa conflitos de horário, CPF ativo duplicado, recebimentos acima da cobrança e sessões/entregas acima do orçamento. O usuário precisa conferir o registro conflitante antes de recuperar; a recusa não apaga nenhum original. Reutilizar um ID/modelo/mês ainda na lixeira pede recuperação e impede duplicatas invisíveis.

## Uso

1. Na área do cadastro, clique em Excluir na linha ou Excluir registro e escolha o item.
2. Confira o nome e os vínculos, clique em Mover para a lixeira e confirme o código de 4 dígitos já usado pelo aplicativo.
3. Para recuperar, abra Lixeira e recuperação, selecione Recuperar e confirme. Reabra a área para conferir.

## Interface e ambiente

O seletor passou a ter um único contorno externo completo e dimensões explícitas para o select nativo. Conferido em Chromium nas larguras 320, 375, 768 e 1440 sem corte ou rolagem horizontal. O cabeçalho diário mostra salvamento em linguagem simples. A revisão técnica, consulta de alterações de outro aparelho, conferência de gravação e saída ficam em Conta e suporte, com explicação de sua função.

Homologação continua explicitamente informada. Leitura atual do servidor confirmou um perfil profissional ativo e duas políticas documentais ativas; isso não comprova habilitação profissional nem homologação clínica completa. A correção da lixeira não promove o ambiente a produção clínica.

## Validação e publicação

Testes novos cobrem todos os 29 tipos, cancelamento/PIN incorreto no navegador, excluir/recarregar/recuperar/reabrir, vínculos, imutabilidade, concorrência, CPF, agenda, pagamentos, estoque, conclusão com fotos/pontos ocultos e substituição de entregas/sessões. Navegador usa servidor isolado com dados fictícios e zero chamadas de escrita ao projeto real. Artefatos de evidência ficam fora do site em skinpro-analise/exclusao-recuperavel-20261018. Resultado agregado e publicação serão registrados após conferência.

## Rollback

Publicar Edge compatível antes do frontend. O estado permanece no mesmo JSON privado e não há migration ou regravação dos cadastros na implantação. A auditoria registra usuário, instante, revisão e ação; cada gravação continua passando por sessão ativa, owner, AAL2, escopo da clínica e CAS.

Após o primeiro uso da lixeira, NÃO reimplantar cegamente o backend v9 ou o frontend anterior: eles não interpretam o ledger. Para voltar apenas a apresentação, mantenha o contrato de lixeira compatível. O pacote Edge anterior e o branch rollback/exclusao-20261018 são cópias de referência; restauração de dados exige escolher a revisão de forma explícita e preservar cadastros posteriores. NUNCA restaurar automaticamente a revisão 72. Todas as exclusões normais se desfazem pela própria Lixeira.
