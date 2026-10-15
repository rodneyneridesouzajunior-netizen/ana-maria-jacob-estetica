# Interface AMJ — base visual refinada

Versão de 15/10/2026. Escopo: Home, navegação, estrutura do aplicativo, controles compartilhados e entrada conectada. Implementação original sobre o aplicativo existente. Não usa imagens, estilos ou componentes extraídos do SkinPRO; não altera o site público nem a marca oficial.

## Arquitetura e ordem

- `luxury-theme.css`: tokens e componentes da estrutura. É o último CSS em `index.html` e `connected.html`.
- `home.css`: substitui integralmente a decoração antiga da Home. Carrega imediatamente antes do tema novo, depois dos estilos legados e dos módulos.
- `home.mjs`: seletores, gráfico, próximos horários, tabela e composição da Home. `homeData`, `getHomeData` e `renderHome` conservam seus contratos. Os eventos continuam delegados ao aplicativo; não foi criado um segundo controlador.
- Os estilos clínicos específicos e as regras de negócio permanecem nos módulos existentes. Os tokens antigos de rosé continuam escuros para evitar texto branco ilegível em indicadores legados. O blush novo é usado em ações e seleção da navegação.

## Tokens

| Token | Valor | Uso |
|---|---|---|
| `--ui-bg`, `--ui-warm` | `#FAF8F6` | Fundo quente e superfícies secundárias |
| `--ui-surface` | `#FCFBFA` | Cartões e entrada conectada |
| `--ui-ink` | `#1A1A1A` | Títulos, números e ações |
| `--ui-muted` | `#625F5B` | Corpo e legendas |
| `--ui-blush` / `--ui-blush-hover` | `#E5A9A9` / `#D4A5A5` | Ação principal e navegação ativa; sempre texto grafite |
| `--ui-line` | `#E9E3DC` | Divisórias de 1px, não sinalizam controles sozinhas |
| `--ui-champagne` | `#D8C9B2` | Borda selecionada, em área pequena |
| `--ui-champagne-ink` | `#8B765A` | Ícones decorativos e separador, sem corpo de texto |
| `--ui-control-edge` | `#918B83` | Limites visíveis dos controles |
| `--ui-blush-edge` | `#AE7777` | Borda do botão blush |
| `--ui-focus` | `#704B4B` | Contorno de teclado 2px com afastamento 4px |
| `--ui-radius` / `--ui-control-radius` | 20px / 16px | Cartões / controles |
| `--ui-shadow` | `0 4px 30px rgba(0,0,0,.02)` | Elevação discreta |
| `--ui-motion` | 160ms | Resposta dos controles |

A maior parte da composição usa os dois off-whites, sem grandes áreas rosé ou douradas. A proporção de 70% é uma direção visual, não uma medição de pixels em todas as telas e estados.

Fonte: `Inter, -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif`. Usa fontes disponíveis no aparelho, sem importação remota nem arquivo adicional. Títulos 350–400, corpo 500 e ações 600. A fonte efetiva depende do sistema. Corpo 13–16px; legendas 12px; navegação móvel 11px com alvo mínimo 58px. Campos 16px evitam zoom involuntário em celulares.

## Componentes e estados

| Componente | Padrão | Interação / acessibilidade |
|---|---|---|
| Navegação | Texto neutro, ícone de linha, alvo 48px | Ativo blush + texto mais forte; mantém rótulo e rota. No celular, todos os itens permanecem numa faixa com rolagem horizontal |
| Ação principal | Blush com grafite, borda legível, 44–46px | Hover blush escurecido; foco visível; `disabled` neutro e sem deslocamento |
| Ação secundária | Off-white, grafite, borda contrastante | Hover quente; mesmos alvos/foco; sem falsa elevação |
| Cartão | Off-white, borda 1px, raio 20px | Não recebe hover de botão se não for uma ação |
| Meta | Valor real, progresso e link para configuração | Vazio diz “Ainda não configurada”; não desenha progresso fictício |
| Gráfico | Barras neutras, grade fina, escala comum | Valores dos seis meses em `desc` e valores individuais em `title`; não depende só da cor |
| Consulta / horário | Nome, data, estado textual, atalho | Cores de serviço só como apoio; cancelamento e conclusão mantêm texto |
| Aviso de conexão | Informação persistente da sessão | Botões de conferir, atualizar, conflito e sair continuam no DOM e com suas ações originais |
| Erro / pendência | Texto escuro avermelhado | Não é transformado em decoração blush; mensagens e bloqueios preservados |

Os estados de carregamento, gravação pendente e desabilitado continuam controlados pelos módulos existentes. O CSS não simula sucesso ou conexão. `prefers-reduced-motion` remove as transições; a entrada da Home é apenas uma mudança de opacidade de 180ms. Nenhum `transform` foi aplicado ao plano da foto, aos pontos ou ao desenho da paciente.

## Home e recortes dos números

Permanecem agenda, novo agendamento, metas, financeiro, procedimentos, catálogo, avisos, últimos atendimentos, prontuários e cadastro vazio. Não há promoção do modelo genérico 3D.

A Home usa `financeReport` com `{period:'month', today}` no mês atual. Meses anteriores do gráfico permanecem completos. A meta recebe o mesmo `today`. O rótulo informa “mês até hoje”; o saldo a receber continua identificado como total. Cobrado, recebido líquido e saldo não são chamados de lucro. Nenhuma alteração é feita em registros existentes pelo renderizador.

## Contrastes calculados

Valores de cores sólidas calculados pela luminância relativa sRGB; não substituem a inspeção do navegador.

| Par | Razão |
|---|---:|
| Grafite `#1A1A1A` / superfície `#FCFBFA` | 16,84:1 |
| Corpo `#625F5B` / superfície `#FCFBFA` | 6,14:1 |
| Grafite / blush `#E5A9A9` | 8,77:1 |
| Grafite / blush hover `#D4A5A5` | 8,06:1 |
| Borda de controle `#918B83` / branco | 3,37:1 |
| Borda do CTA `#AE7777` / branco | 3,68:1 |
| Foco `#704B4B` / superfície `#FCFBFA` | 7,26:1 |
| Barras `#68615A` / branco | 6,09:1 |

Texto branco sobre blush teria apenas 1,98:1 e não é utilizado. O champagne não é usado para informação textual pequena. Divisórias leves são decoração; os controles recebem bordas separadas de contraste maior.

## Responsividade e validação

- Desktop: resumo e meta em duas colunas; agenda, gráfico e procedimentos em três colunas amplas.
- Até 1450px: a segunda linha usa duas colunas, procedimentos abaixo; até 1100px, resumo e meta empilham.
- Até 720px: cartões em uma coluna; indicadores do resumo em pares. Até 480px, padding de 20–24px e botões que quebram linha. Rótulos do SVG passam a 21 unidades, com margem da escala ampliada, para continuarem legíveis após o redimensionamento.
- A tabela mantém sua região rolável e nome acessível; nenhum campo é removido para caber no celular.
- Até 850px, a navegação fica na base, com safe area e espaço reservado no conteúdo. Não há rolagem horizontal intencional fora da tabela e da navegação.

Verificados nesta frente: sintaxe JS, 44 testes Home/Clínica/modo conectado, dados futuros excluídos do mês corrente, valores históricos completos, metas coerentes, preservação de conteúdo e bloqueio de assinatura demo no conectado. O parser CSS aceitou 122 regras na Home e 76 no tema; todos os 18/19 links CSS dos pontos de entrada local/conectado existem, sem duplicação, com a ordem final `home.css` → `luxury-theme.css`. `git diff --check` passou.

O root confirmou a revisão visual desktop como limpa e coerente. A inspeção em 390px e a conferência final de teclado/estados conectados ficam com o root. Esta entrega não constitui publicação, homologação clínica ou prova de sincronização real.
