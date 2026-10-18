# Conteúdo por embalagem — 18/10/2026

Solicitação: Ana precisa cadastrar, editar e ver quantos mL (ou outra unidade existente) há em uma embalagem. O atributo não representa saldo nem número de frascos.

Implementado: `products[].packageQuantity`, opcional, número positivo com até quatro casas decimais e limite de 100.000.000 na unidade escolhida. Entrada aceita vírgula ou ponto decimal, sem separador de milhar. Ausência legada permanece ausente; campo vazio é salvo como null. Edição por cliente anterior preserva o atributo via domínio e os controles existentes de versão/CAS permanecem.

Em Catálogo → Produtos → Adicionar produto/Editar, Quantidade por embalagem fica junto à unidade. Na lista aparece, por exemplo, 5 mL por embalagem, abaixo do nome/marca. A calculadora reutiliza esse único campo. Só Usar custo calculado altera o custo sugerido. Salvar apenas a quantidade não altera estoque, lotes, movimentos, orçamentos ou custos históricos. Nome, marca, uso, ativo, lixeira e recuperação permanecem.

Validação: 1.065 testes, todos aprovados; criação com 2, edição para 5, decimal 2,5 e precisão 0,0001; legado sem quantidade; limpeza opcional; inválidos sem commit; API autenticada commit/abrir; estoque e históricos preservados. Navegador Chromium isolado com handler real e persistência em arquivo: criar/editar/recarregar/reabrir, calculadora, unidade dinâmica e telas 320/375/1440 sem overflow global. Nenhuma gravação de teste na conta real.

Publicação: segue fluxo existente, Edge app-workspace antes de GitHub Pages. Apenas dois módulos de domínio da Edge mudam. Sem migration, restauração de snapshot ou regravação dos dados. Versão anterior: commit 66b50f73d2805799b3874df0f0ebf3b786a5ef82 / Edge v10, branch local rollback/embalagem-20261018. Rollback de código deve preservar o novo atributo já salvo e toda a lixeira; nunca restaurar um snapshot antigo de dados. Evidência final da publicação e hashes fica fora do site público.

Evidências locais: `skinpro-analise/quantidade-embalagem-20261018` na raiz do espaço de trabalho, fora deste repositório. Inclui logs, navegador local/publicado, relatório final e backup do código da Edge v10.

Notion: consultada a página Estética 3aea5dba-91be-8184-99ca-e1a36294b1e3 e buscado registro específico sem resultado pertinente. A tentativa de acrescentar esta solicitação à página existente foi recusada pelo limite de blocos gratuitos (entitlement_required); nada foi criado ou duplicado. Atualização oficial permanece pendente. Nenhuma memória do assistente editada.

Limites: testes funcionais publicados usam dados/API isolados; não representam gravação de teste em produção. Permanece o aviso de homologação do aplicativo. A aba da usuária não é navegada, recarregada nem interrompida por esta entrega.
