# Marcações por ponto e espaçamento da página inicial

## Escopo

AMJ-MAPA-20261016: adicionar vários pontos na fotografia antes de preencher procedimento e quantidade individualmente. Preservar a identidade clara, os dados existentes, as ferramentas de linha/leque/caneta e o salvamento transacional.

AMJ-LAYOUT-20261016: revisar o espaçamento das colunas e o canto superior direito da página inicial, inclusive em celular.

## Comportamento entregue

- Marcação em sequência continua ativa por padrão. Tocar na foto acrescenta os pontos sem abrir um formulário a cada toque.
- Selecionar um número ou **Preencher marcações** abre seus dados. **Anterior** e **Próxima** percorrem o conjunto; **Continuar marcando na foto** preserva o preenchimento.
- Cada ponto guarda seu procedimento, versão do cadastro, quantidade e unidade. Um ponto novo começa sem procedimento ou quantidade; não copia uma aplicação anterior.
- A legenda acompanha o preenchimento, incluindo quantidades com quatro casas decimais. O total salvo permanece distinto da prévia ainda não gravada.
- **Salvar conjunto** valida e grava as marcações juntas. Falha de rede ou conflito não deve apagar o rascunho nem duplicar as marcações no reenvio.
- Na página inicial, as colunas consideram a largura útil de cada card. Títulos e ações podem ocupar linhas separadas; o cabeçalho permite quebra sem comprimir o seletor de áreas.

## Verificação desta revisão

- 1.149 testes aprovados em uma execução de 107 arquivos: interface/integração, regras de backend, documentos, TCLE e contratos SQL. Não representam 1.149 jornadas reais em produção.
- Oito regressões de sequência usam o DOM, CloudStore e handler reais com repositório de teste. Cobrem procedimentos distintos, 0,1/0,25/0,0001 mL, segundo cliente, resposta perdida, reenvio e conflito de versões.
- Duas regressões de conclusão verificam consumo de 0,45 mL, cobrança por procedimento e rejeição de consumo divergente da quantidade registrada no ponto.
- 17 testes focais da página inicial passaram após o ajuste de CSS.
- No navegador local, três pontos fictícios foram criados, preenchidos, salvos e reabertos. As quantidades individuais e o total 0,5501 mL (incluindo um ponto de teste já existente) permaneceram iguais.
- Medições do mapa em 320 e 390 px e da página inicial em 320, 390, 768 e 1366 px não mostraram transbordamento horizontal global. No cabeçalho de notebook, seletor e data mantêm 20 px entre si; os cards mantêm 24 px de separação.

## Limites e validações pendentes

O navegador conectado por extensão não respondeu nesta execução. A aba oficial disponível no navegador do Codex estava sem sessão autenticada. Portanto, o novo salvamento autenticado em produção e a confirmação em Android/iPhone físicos não foram realizados nesta revisão. Os testes de dois clientes usam um repositório de teste; a conferência responsiva usa o motor do navegador em tamanhos controlados.

Achados anteriores preservados para revisão separada: a conclusão aceita no máximo 400 consumos por atendimento, apesar de o mapa admitir conjuntos maiores; entradas de API/importação com cinco casas decimais não têm a mesma restrição de quatro casas da interface e da conclusão. A interface desta entrega não envia cinco casas. Nenhum limite de backend, schema, permissão ou dado clínico foi alterado.

Evidências detalhadas e capturas ficam na pasta privada `skinpro-analise/revisao-item-a-item-20261015`, fora da publicação. O item **Estética** do Notion foi consultado, mas a atualização foi recusada porque o workspace atingiu o limite de blocos. A sincronização do registro permanece pendente; este documento é o registro técnico provisório. A confirmação da publicação deve ser registrada separadamente do resultado dos testes.
