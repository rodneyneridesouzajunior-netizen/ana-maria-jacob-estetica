# Editor facial: requisitos verificados e execução

## Pedido

Marcar vários pontos, linhas e leques diretamente na fotografia antes de preencher quantidades e identificação. O editor deve conservar a identidade Ana Maria Jacob, usar a fotografia original e funcionar no telefone e notebook. Desenho livre foi solicitado expressamente como complemento. A revisão não representa conclusão de todos os módulos nem paridade integral com SkinPRO.

## Referência observada

- No atendimento de teste aberto no SkinPRO Web foram vistos 19 marcadores e campos individuais de região, quantidade e procedimento. Há seleção de procedimento e tipo de aplicação antes da marcação.
- O leque é composto por três segmentos abertos com origem comum. O segmento central define direção e comprimento; os laterais têm o mesmo comprimento e abertura observada de aproximadamente 24 graus para cada lado, usando o aspecto real da fotografia.
- A fotografia continua sendo uma imagem bidimensional. Não foi demonstrada reconstrução tridimensional do rosto.
- O material público móvel mostra zoom e controles próximos da marcação. Isso não prova que todas as interfaces web/móvel tenham exatamente os mesmos controles.
- Não foi confirmada caneta livre na referência. A caneta da Ana atende ao pedido adicional do usuário.

## Critérios de aceitação

1. Modo em sequência inicialmente ativo, sem formulário obrigatório entre cada toque.
2. Marcadores numerados e edição individual posterior. Quantidade ausente permanece ausente; nenhuma dose é sugerida.
3. Conjunto gravado em uma transação, com revisão do servidor e histórico para desfazer.
4. Rascunho preservado quando há falha ou conflito; saída e troca de fotografia não descartam silenciosamente.
5. Pontos, linhas, leques e traços aparecem de forma consistente no editor, resumo e PNG exportado.
6. Coordenadas normalizadas; zoom e tamanho da tela não mudam a posição registrada.
7. Desenho livre limitado a 256 vértices por traço, sem consumo automático de estoque. Foto original intacta.
8. Consultas concluídas/canceladas ou bloqueadas permanecem protegidas.
9. Usabilidade visual conferida em viewport móvel; teste no telefone físico relatado separadamente.

## Correção concomitante: PDF histórico

O erro genérico de contexto ao abrir fichas antigas era a tradução de uma recusa por ausência dos metadados do fluxo novo. Os seis registros legados possuíam PDFs, mas não os hashes e assinaturas separados do modelo atual. A leitura histórica foi separada da elegibilidade clínica: abre somente o caminho registrado, na clínica autorizada e com sessão/MFA, sem promover o documento a assinado ou liberar conclusão de atendimento.

Edge app-workspace v5 publicada e ativa. Abertura de uma ficha histórica verificada na sessão autenticada: resposta de sucesso e nova aba do PDF original. O visualizador PDF não pôde ser inspecionado pelo recurso de captura disponível; não foi feita revisão clínica do conteúdo.

## Limites ainda abertos

- O atendimento da Ana continua vinculado a um procedimento. Selecionar procedimentos diferentes por ponto exige integração com consentimentos, conclusão e consumo, não apenas acrescentar um seletor visual.
- Paridade dos termos: ver TERMOS-PARIDADE-SKINPRO.md; permanece pendente.
- Não há confirmação nova de teste físico no telefone.
- Este arquivo é evidência local de execução; o registro oficial no Notion continua pendente por limite de blocos anteriormente verificado.

## Estado da revisão

Caneta, foto ampliada e correção de PDFs passaram uma suíte de 995 testes, antes da inclusão posterior do modo em sequência e do leque de três raios. Os testes finais e a publicação do cliente devem ser registrados após essas alterações, sem somar execuções sobrepostas.

## Validação final de 16/10/2026

- 1.027 testes aprovados (902 núcleo + 125 complementares em arquivos distintos), zero falhas ou ignorados. Inclui lote até 1.000 marcações, conflito, edição durante salvamento, troca de contexto, logout, histórico, PNG real e servidor.
- A revisão independente identificou e corrigiu uma duplicação apenas visual após edição durante commit; a regressão exige IDs, números e linhas de legenda únicos.
- Dois pontos fictícios adicionados pelo fluxo acessível, editados depois e salvos juntos; ao recarregar, identificação, coordenadas e 0,1 mL informado manualmente permaneceram. Essa prova é local, separada da verificação conectada a registrar após a publicação.
- Backend app-workspace v6 ACTIVE; os 22 arquivos foram comparados e coincidem com o código local.
- Direção visual final confirmada pelo usuário: **tons claros**. Fundo off-white quente, rosé e dourado, vidro na navegação, sombras para profundidade. O estudo escuro foi descartado da publicação.
- Layout conferido em 320 e 390 px; foto sem filtro decorativo, documentos impressos sem alteração pelo novo tema. O financeiro móvel ganhou cartões em uma coluna e números maiores.
- Verificação de publicação, commit e gravação conectada: registrar no relatório privado da entrega. Não declarar paridade integral nem teste físico já concluído.
