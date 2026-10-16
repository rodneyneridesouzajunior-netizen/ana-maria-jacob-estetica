# Decisão de componentes e acabamento visual

Verificação: 16/10/2026. Escopo: Astra UI da **Outerbase**, shadcn/ui e acabamento escuro, rosé, champagne e vidro. Nenhuma dependência instalada nesta análise.

**Recomendação:** manter os componentes HTML/ES modules atuais e aprimorar os tokens e superfícies existentes. Não migrar a interface durante a estabilização do prontuário e das marcações em sequência. A biblioteca não é necessária para produzir profundidade, transparência ou movimento; a qualidade depende da composição e da resposta dos controles.

## Evidência e compatibilidade

| Opção | Fato verificado | Decisão para este app |
|---|---|---|
| Astra UI / Outerbase | Web Components utilizáveis sem framework; README oferece bundle pré-compilado e hospedagem própria. O repositório foi arquivado pelo proprietário em **21/01/2026**. | Tecnicamente pode coexistir com a página atual, mas não recomendo introduzir uma base arquivada nos formulários clínicos. [Repositório oficial](https://github.com/outerbase/astra-ui) |
| Pacote modular Astra | O manifesto distingue bundle e módulos; declara Lit como dependência par e inclui bibliotecas de gráficos/edição. | Importar o pacote npm não equivale a acrescentar um arquivo `.mjs` isolado ao navegador. Seria preciso resolver dependências ou avaliar o bundle. Não foi medido tamanho nem desempenho. [Manifesto oficial](https://github.com/outerbase/astra-ui/blob/main/package.json) |
| shadcn/ui | A instalação manual configura Tailwind, utilitários e aliases; o guia Vite utiliza React, JSX e plugins de compilação. Temas são definidos por variáveis CSS. | Não entra diretamente nas funções atuais que retornam HTML. Uma ilha React seria possível, mas acrescentaria ciclo de montagem, dependências e testes de integração. Adiar até existir necessidade funcional concreta. [Instalação](https://ui.shadcn.com/docs/installation/manual), [Vite](https://ui.shadcn.com/docs/installation/vite), [temas](https://ui.shadcn.com/docs/theming) |
| Componentes atuais + CSS | `index.html` carrega import map, módulos nativos e CSS local; `app.mjs` usa HTML, formulários nativos e eventos delegados. | Menor superfície de mudança: preservar IDs, `data-action`, validações, rascunhos, CAS e histórico. Reutilizar `luxury-theme.css`, `depth-theme.css` e estilos por módulo. |

O link de documentação da Outerbase indicado no README não pôde ser recuperado nesta consulta. Isso não demonstra indisponibilidade do serviço; a avaliação usou o README e o manifesto oficiais disponíveis. A expressão “Astra UI” também identifica projetos de outros autores; esta decisão não os trata como a biblioteca da Outerbase.

## Aplicação visual proposta

- Estrutura escura em grafite quente, rosé nas ações principais e dourado champagne em bordas/ícones discretos. Áreas de leitura e formulários podem conservar superfícies claras; trocar tudo para escuro exige revisão própria de todos os estados.
- Vidro apenas na navegação e em superfícies flutuantes pequenas, com fundo quase opaco de reserva. `backdrop-filter` depende de transparência para mostrar o efeito e pode não funcionar em navegadores antigos; legibilidade deve sobreviver sem ele. [Documentação CSS](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/backdrop-filter)
- Neumorfismo moderado: sombra externa suave e realce interno; inputs mantêm contorno visível e foco inequívoco. A sombra não pode ser o único indicador de campo, seleção ou erro.
- Movimento curto ao abrir superfícies e pressionar botões; respeitar `prefers-reduced-motion`. Não mover a foto nem a camada das marcações por animação decorativa durante um gesto.
- Fotografia clínica permanece sem blur, filtros de pigmentação, brilho artificial ou alteração de cor. A decoração pertence à interface; exportações e coordenadas continuam fiéis ao registro.

## Próxima entrega mínima e critérios

Depois de fechar a revisão funcional, aplicar o acabamento a uma tela com navegação, formulário e mapa. Comparar em 320, 390 e 430 px e no desktop; verificar teclado, foco, zoom, rolagem e teclado virtual. Critérios de aceite: nenhum campo/ação perdido, alvos atuais de 44 px preservados, ausência de sobreposição com a barra inferior, texto legível com transparência desativada, gestos e salvamento iguais antes/depois.

Uma adoção futura de biblioteca deve começar por um componente isolado sem gravação clínica. Para Astra, seria necessário assumir manutenção de uma cópia versionada. Para shadcn, definir primeiro a fronteira React e o pipeline. Nenhuma dessas opções justifica reescrever agora o editor, autenticação ou persistência. A análise acima é arquitetural; não constitui benchmark nem homologação de acessibilidade das bibliotecas.

## Direção final confirmada

O usuário confirmou em 16/10/2026 que quer manter **tons claros**. A implementação usa `glass-theme.css` com off-white, rosé, dourado, superfícies de vidro e sombras. A direção escura anterior foi substituída antes da publicação. `light-responsive.css` melhora especificamente o financeiro móvel; nenhuma biblioteca foi instalada.
