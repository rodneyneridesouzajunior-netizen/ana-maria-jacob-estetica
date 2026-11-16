# Termo intramuscular com anamnese, envio pelo WhatsApp e fichas para imprimir — 16/11/2026

Pedido da clínica (Rodney, 16/11/2026): "para o termo de aplicação intramuscular quero a anamnese e
termo juntos", com pergunta de alergia a medicamentos e de PMMA ou silicone no glúteo; "todos os termos
do site disponíveis para eu enviar no WhatsApp para os pacientes lerem e assinarem"; "em modo PDF caso
algum paciente queira impresso".

## O que mudou

### 1. Novo modelo `amj-termo-intramuscular-20261116` (substitui o de 12/11)
- `painel/piloto-simples/document-library-procedures.mjs`: o modelo "Anamnese e consentimento —
  Aplicação intramuscular com prescrição" reúne, num único documento, a ficha de anamnese geral da
  clínica (as mesmas 52 perguntas do modelo `amj-anamnese-geral-20261016`, sem o campo livre
  "Alergias a medicamentos", que virou pergunta objetiva) e o termo intramuscular.
- 74 perguntas em 7 etapas: Sobre você (nascimento, profissão, contato de emergência) · Sua saúde ·
  Medicamentos e alergias · Procedimentos anteriores e implantes · Pele, cuidados e objetivo ·
  Receita e medicamento · Segurança para a injeção.
- Perguntas novas pedidas pela clínica: `alergia_medicamento` (sim/não, obrigatória) com
  `alergia_medicamento_quais` (condicional) e `gluteo_pmma` ("Tem PMMA, silicone (líquido ou prótese)
  ou outro preenchedor, bioestimulador ou implante aplicado nos glúteos?", obrigatória) com
  `gluteo_pmma_detalhe` (condicional). Também: `anafilaxia`, `implante_outro`/`implante_outro_detalhe`,
  `desmaio_injecao` e a opção "Vitaminas, minerais ou outro injetável prescrito" em `finalidade`.
- 10 blocos de texto: inclui "Local da aplicação" (regra de não aplicar no glúteo com PMMA/silicone)
  e "Uso dos meus dados" (mesma declaração LGPD da ficha do site), já que o documento dispensa a
  anamnese separada.
- `operations-ui.mjs`: o procedimento padrão "Aplicação intramuscular com prescrição" passa a apontar
  para o modelo novo. Clínica que já tinha o procedimento ligado ao modelo de 12/11 precisa trocar o
  termo em Catálogo › editar procedimento.
- O modelo continua marcado como rascunho para revisão da profissional e orientação jurídica
  (campo `source`). Quem já importou o modelo de 12/11 continua com ele nos modelos próprios; o novo
  aparece na biblioteca como "Ainda não adicionado".

### 2. Envio pelo WhatsApp com todos os termos
- `quick-send-ui.mjs`: o atalho "Enviar pelo WhatsApp" da tela inicial lista todos os termos e a
  autorização de imagem da biblioteca, mesmo os ainda não adicionados (marcados "· da biblioteca");
  ao preparar o envio o modelo é importado no mesmo salvamento (`importClinicDocumentModels`).
- Correção: o cadastro rápido pede também a **data de nascimento** (maior de 18 anos) e o campo
  aparece para paciente existente sem nascimento válido. O servidor (`issueSnapshot`) exige essa data
  para gerar o link; sem ela a emissão falhava com `custom_birth_date_required`.
- O fluxo da paciente (link pessoal em /documento/, assinatura, PDF no servidor) não mudou.

### 3. Fichas para imprimir (PDF em branco)
- `painel/piloto-simples/document-print.mjs` (módulo puro): `blankDocumentBody(version)` monta o
  documento com textos, identificação (nome, nascimento, CPF, WhatsApp), todas as perguntas com
  espaço para resposta (caixas para sim/não e listas, linhas para texto, instrução nas perguntas
  condicionais) e área de assinatura; `printFileName(model)` define o nome do PDF.
- App: cada cartão da Biblioteca de modelos (e dos modelos próprios) ganhou "Imprimir em branco"
  (prévia com a marca + "Imprimir / salvar PDF") e, para modelos da biblioteca, "PDF para imprimir"
  (abre `https://anamariajacob.com.br/impressao/<arquivo>.pdf`).
- Site: `scripts/gerar-pdfs-impressao.mjs` gera `impressao/*.pdf` (16 modelos), `impressao/index.html`
  ("Fichas para imprimir", com "Abrir PDF" e "Enviar pelo WhatsApp" por documento; `noindex`) e
  `impressao/manifest.json`. `/fichas/` ("Prefere papel?") passou a apontar para `/impressao/`.
  Regenerar sempre que a biblioteca mudar:

```powershell
node scripts/gerar-pdfs-impressao.mjs            # usa Chrome ou Edge instalado (sem janela)
node scripts/gerar-pdfs-impressao.mjs --so-html  # só index/manifest, sem Chrome
```

## Testes
- Novo: `painel/piloto-simples/tests/document-print.test.mjs` (conteúdo completo de todos os modelos no
  formulário em branco, tipos de resposta, modelo intramuscular integrado).
- `quick-send.test.mjs`: + nascimento obrigatório e termos da biblioteca no atalho.
- `document-library*.test.mjs`: o modelo integrado é a exceção prevista à regra "termo não repete a
  anamnese" (conjunto `INTEGRATED`/`integrated`).
- Ambiente: os testes resolvem jsdom/fake-indexeddb/pdf-lib/pdfjs-dist/fontkit em
  `<avô-do-repo>/skinpro-analise/test-tools` (nesta máquina:
  `C:\Users\NERI\Documents\Codex\2026-11-03\que\skinpro-analise\test-tools`, criada em 16/11 com
  `jsdom`, `fake-indexeddb`, `pdf-lib`, `@pdf-lib/fontkit`, `pdfjs-dist@4.10.38`).
  `document-library-complete.test.mjs` passou a usar essa pasta quando o runtime do Codex
  (`C:/Users/rotan/.cache/...`) não existe.
- Falhas pré-existentes, independentes desta entrega: `sync-domain.mjs --check` acusa
  `Domain drift: operations-domain.mjs`; os testes SQL (`*migration*.test.mjs`, `clinical-review`)
  exigem PGlite fora do repo; `printable-layout` e `map-trace` dependem de versões antigas de jsdom.

## Publicação
- GitHub Pages publica o branch `main`; não há Edge Function nem migração nova nesta entrega
  (`documents-domain.mjs` não mudou). Antes de publicar, rodar
  `node painel/piloto-simples/prepare-release.mjs` em checkout com fim de linha LF para atualizar o
  importmap de `connected.html` (cache dos módulos alterados).
