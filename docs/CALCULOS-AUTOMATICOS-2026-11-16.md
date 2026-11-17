# Cálculos automáticos na proposta, no financeiro, no catálogo e na conclusão — 16/11/2026

Pedido da clínica (Rodney, 16/11/2026): "em itens da proposta eu preciso que você já calcule os valores se
houver desconto ou se o valor não condizer com o valor real do procedimento. E se tiver algum outro lugar
que seja preciso fazer cálculos, que faça sozinho também."

Tudo aqui é **interface**: nenhuma regra de domínio (`*-domain.mjs`) mudou, o formato gravado é o mesmo e
não há Edge Function nem migração para publicar. Os campos de apoio só preenchem os campos que já existiam.

## Onde ficou cada conta

| Tela | O que agora é calculado sozinho |
| --- | --- |
| Orçamentos › Itens da proposta | Por item: desconto em **%**, em **R$** ou pelo **total desejado do item** (os três se atualizam entre si); "Total do item"; comparação com o **valor de tabela** do Catálogo (quanto está abaixo/acima, economia da paciente) com os botões "Lançar como desconto de X%" e "Usar valor de tabela". Em produto sem preço, digitar o total do item calcula o preço por unidade. |
| Orçamentos › rodapé da proposta | Desconto geral em %, em R$ ou pelo **total final da proposta**; resumo "Pelo valor de tabela seriam R$ X: a paciente economiza R$ Y (Z%)". A lista de orçamentos e o documento da paciente mostram o desconto do item também em R$. |
| Financeiro › Parcelar | Total da cobrança no topo e prévia do plano enquanto digita: entrada, restante, "3x de R$ 560,00" (com os centavos nas primeiras parcelas) e as datas de vencimento. A prévia usa a mesma regra que grava (`createInstallments`). |
| Financeiro › Receber | Total, já recebido e saldo no topo; "depois deste recebimento ficam faltando R$ X" ou "quita"; aviso imediato se passar do saldo; em Dinheiro, campo "valor entregue" com o **troco**. |
| Financeiro › Nova cobrança | Procedimento do catálogo (preenche descrição, valor cheio e custo), desconto em % ou R$ preenchendo o valor cobrado, e a sobra/margem. |
| Catálogo › Entrada de lote | "Embalagens recebidas" × conteúdo da embalagem = quantidade de entrada; "Valor total pago" ÷ quantidade = custo por unidade; total do lote e diferença de arredondamento. |
| Catálogo › Produto | Valor da embalagem ÷ quantidade = custo por unidade, mostrado enquanto digita. Em produto novo (custo zerado) o campo é preenchido sozinho; se o custo já foi digitado, só muda pelo botão "Usar custo calculado" (decisão de 18/10 mantida) e aparece um aviso da diferença. |
| Catálogo › Procedimento | Sobra por sessão (preço − custo) e margem; aviso quando o custo passa do preço. |
| Consulta › Revisar e concluir | Total marcado por unidade; por lote: quanto está sendo usado, custo e quanto sobra ou **falta** no lote; cobrança prevista, custo (base + materiais) e sobra. Com vários procedimentos, o preço de cada um e a soma. |

Em todos os campos de dinheiro dessas telas passou a ser aceito o ponto de milhar ("1.200,00").

## Como funciona por dentro

- `painel/piloto-simples/calc-helpers.mjs` (novo, puro): `parseMoney`, `parsePercentBps`, `parseUnits`,
  `discountFromAmount`/`discountFromTotal`, `unitPriceForTotal`, `compareToTable`, `splitInstallments`,
  `marginOf`, `lineValue`.
- O orçamento continua gravando só preço, quantidade e descontos em centésimos de %. Como o desconto é
  percentual, um valor em R$ pode não ser atingido ao centavo: a interface escolhe o percentual mais
  próximo e avisa ("valor mais próximo possível de R$ 1.000,00 é R$ 999,96").
- `operations-ui.mjs`: `applyQuoteHelper`, `updateQuotePreview(form, source)`, `quoteRowToTable`,
  `updateProductPreview`, `updateProcedurePreview`, `updateLotPreview`, `updateCompletionPreview` e o
  despachante `updateFormPreviews` (abertura do modal, `input` e `change`). Os campos de apoio
  (`itemDiscountValue`, `itemTotal`, `discountValue`, `finalTotal`, `lotPackages`, `lotPaid`) são retirados
  do envio antes de gravar.
- `finance-ui.mjs`: `installmentPreview` e `receiptPreview`. `bill-calculator.mjs` (novo) + `billDialog`
  em `app.mjs`.
- `operations-completion-quote.mjs`: preço de cada procedimento e total da consulta.
- Estilos novos no fim de `quotes.css` (`.quote-table-hint`, `.quote-hint-action`, `.calc-preview`).

## Testes

`node --test painel/piloto-simples/tests/calc-helpers.test.mjs` — 9 testes: funções puras e os formulários
reais (orçamento, lote, produto, procedimento, conclusão, nova cobrança) em jsdom, além das prévias do
financeiro. A bateria `painel/piloto-simples/tests/*.test.mjs` segue com as mesmas 3 falhas de ambiente
de antes (arrasto de linha/leque e `printable-layout`).

## Fora desta entrega (achados anotados, não feitos)

- Taxa da maquininha no recebimento com cartão (precisa de uma configuração de taxa por clínica).
- Fechamento de caixa por forma de pagamento no relatório do período.
- Horário final do agendamento a partir da duração; idade ao lado da data de nascimento.
- Diluição no mapa do rosto (não há campo de diluição hoje).

## Publicação

Só arquivos estáticos (GitHub Pages do `main`). Rodar `node painel/piloto-simples/prepare-release.mjs`
em checkout LF antes de publicar, para versionar os módulos e o `quotes.css` no `connected.html`.
