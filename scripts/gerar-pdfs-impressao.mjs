// Gera as versões em branco (para preenchimento em papel) de todos os modelos da biblioteca
// em impressao/*.pdf, mais impressao/index.html e impressao/manifest.json.
// Uso (na raiz do repositório):  node scripts/gerar-pdfs-impressao.mjs [--chrome "caminho\chrome.exe"] [--so-html]
// Requer Google Chrome ou Microsoft Edge instalado (impressão sem janela). Não usa rede.
import {mkdir, writeFile, readFile, access} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {CLINIC_DOCUMENT_MODELS} from '../painel/piloto-simples/document-library.mjs';
import {blankDocumentBody, blankDocumentTitle, printFileName} from '../painel/piloto-simples/document-print.mjs';
import {printableHTML} from '../painel/piloto-simples/feature-ui.mjs';

const root = new URL('../', import.meta.url);
const outDir = new URL('impressao/', root);
const tmpDir = new URL('tmp/impressao/', root);
const args = process.argv.slice(2);
const onlyHtml = args.includes('--so-html');
const chromeArg = args.indexOf('--chrome') >= 0 ? args[args.indexOf('--chrome') + 1] : '';
const candidates = [chromeArg, process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].filter(Boolean);
async function findChrome() { for (const c of candidates) { try { await access(c); return c; } catch {} } return ''; }

const kindName = {anamnese: 'Ficha de anamnese', termo: 'Termo de consentimento', imagem: 'Autorização de imagem'};
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const SITE = 'https://anamariajacob.com.br';
const WHATSAPP = '5531995844803';

function indexPage(items) {
  const cards = items.map(it => {
    const url = `${SITE}/impressao/${it.file}`;
    const text = `Olá! Aqui é da clínica Ana Maria Jacob. Segue a versão para imprimir do documento "${it.title}":\n${url}\n\nSe preferir, preencha pelo celular: ${SITE}/fichas/`;
    return `<article class="impressao-card" data-kind="${esc(it.kind)}"><span class="eyebrow">${esc(kindName[it.kind] || it.kind)}</span><h2>${esc(it.title)}</h2><p>${it.pages ? it.pages + ' página(s) · ' : ''}PDF para imprimir e preencher à mão.</p><div class="impressao-acoes"><a class="button button-small" href="/impressao/${esc(it.file)}" target="_blank" rel="noopener">Abrir PDF</a><a class="text-link" href="https://wa.me/?text=${encodeURIComponent(text)}" target="_blank" rel="noopener noreferrer">Enviar pelo WhatsApp ↗</a></div></article>`;
  }).join('\n');
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Fichas para imprimir | AMJ — Ana Maria Jacob</title>
<meta name="description" content="Versões em PDF da ficha de anamnese e dos termos de consentimento da Ana Maria Jacob Estética, para imprimir e preencher em papel.">
<link rel="canonical" href="${SITE}/impressao/">
<meta name="robots" content="noindex">
<meta name="theme-color" content="#FFFDF9">
<link rel="icon" href="/assets/icons/ana-site-32-v1.png">
<link rel="preload" href="/assets/amj-cormorant-20261015.ttf" as="font" type="font/ttf" crossorigin>
<link rel="stylesheet" href="/assets/amj-editorial-20261104.css">
<link rel="stylesheet" href="/fichas/fichas.css">
<style>
.impressao-grid{display:grid;gap:18px;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));margin-top:28px}
.impressao-card{border:1px solid #e9e1e5;border-radius:22px;padding:22px;background:#fff}
.impressao-card h2{font-size:22px;margin:6px 0 8px}.impressao-card p{margin:0 0 14px;color:#58454e}
.impressao-acoes{display:flex;flex-wrap:wrap;gap:12px;align-items:center}
.impressao-nota{margin-top:36px;color:#58454e;max-width:760px}
</style>
<script src="/assets/amj-editorial-20261104.js" defer></script>
</head>
<body>
<a class="skip" href="#conteudo">Ir para o conteúdo</a>
<header class="header">
<a class="brand" href="/" aria-label="Ana Maria Jacob — página inicial"><img src="/assets/amj-marca-secundaria-20261104.png" alt="AMJ Estética Avançada" width="1080" height="1080"><span>Ana Maria Jacob<small>ESTÉTICA AVANÇADA</small></span></a>
<button class="menu-toggle" type="button" aria-controls="nav" aria-expanded="false">Menu <span aria-hidden="true">☰</span></button>
<nav id="nav" aria-label="Navegação principal"><a href="/#ana">A Ana</a><a href="/tratamentos/">Tratamentos</a><a href="/fichas/">Minhas fichas</a><a class="button button-small" href="/agendar/">Agendar avaliação <span aria-hidden="true">↗</span></a></nav>
</header>
<main id="conteudo">
<section class="wrap fichas-hero">
<p class="eyebrow">PREFERE PAPEL?</p>
<h1>Fichas para <em>imprimir.</em></h1>
<p class="lead">As mesmas fichas do atendimento, em PDF, para quem prefere preencher à mão. Imprima, preencha com calma e traga no dia, ou peça a versão impressa na clínica.</p>
<p><a class="text-link" href="/fichas/">Prefere preencher pelo celular? Vá para Minhas fichas ↗</a></p>
</section>
<section class="wrap">
<div class="impressao-grid">
${cards}
</div>
<p class="impressao-nota">Estes PDFs são versões para preenchimento em papel. A ficha preenchida pelo celular, com link enviado pela clínica, continua sendo o caminho mais rápido. Em qualquer formato, a profissional revisa as respostas antes do atendimento. Não envie informações de saúde pelo WhatsApp.</p>
</section>
</main>
<footer class="footer">
<div><a class="footer-name" href="/">Ana Maria Jacob</a><p>Farmacêutica · CRF/MG 40880</p><p>Rua Clotildes Borges, 370 · sala 504<br>Integral Control · Jardim da Cidade<br>Betim/MG · CEP 32604-288</p><p>Segunda a sexta, das 8h às 18h<br>Atendimento com hora marcada.</p></div>
<div><h2>Vamos conversar</h2><a href="https://wa.me/${WHATSAPP}" target="_blank" rel="noopener noreferrer">WhatsApp · (31) 99584-4803 ↗</a><a href="https://www.instagram.com/anamariajacob/" target="_blank" rel="noopener noreferrer">Instagram · @anamariajacob ↗</a><a href="mailto:contato@anamariajacob.com.br">contato@anamariajacob.com.br</a></div>
<div><h2>Para seu atendimento</h2><a href="/fichas/">Minhas fichas</a><a href="/anamnese/">Ficha de anamnese</a><a href="/impressao/">Fichas para imprimir</a><a href="/tratamentos/#pos-procedimento">Cuidados e retorno</a></div>
</footer>
</body>
</html>
`;
}

async function pdfPages(file) {
  try { const bytes = await readFile(file); return (bytes.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length || null; } catch { return null; }
}

await mkdir(outDir, {recursive: true});
await mkdir(tmpDir, {recursive: true});
const chrome = onlyHtml ? '' : await findChrome();
if (!onlyHtml && !chrome) { console.error('Chrome ou Edge não encontrado. Passe --chrome "caminho" ou use --so-html.'); process.exit(1); }
const items = [];
for (const model of CLINIC_DOCUMENT_MODELS) {
  const file = printFileName(model);
  const footer = `Modelo ${model.id} · versão para preenchimento em papel gerada a partir da biblioteca de documentos da clínica. A via assinada deve ser conferida e arquivada no prontuário.`;
  const html = printableHTML(blankDocumentTitle(model), blankDocumentBody(model, {footer}))
    .replace('<button id="print" type="button">Imprimir / salvar PDF</button>', '');
  const htmlPath = new URL(file.replace(/\.pdf$/, '.html'), tmpDir);
  await writeFile(htmlPath, html);
  const pdfPath = fileURLToPath(new URL(file, outDir));
  if (chrome) {
    execFileSync(chrome, ['--headless=new', '--disable-gpu', '--no-sandbox', '--allow-file-access-from-files', '--no-pdf-header-footer',
      '--virtual-time-budget=8000', `--print-to-pdf=${pdfPath}`, pathToFileURL(fileURLToPath(htmlPath)).href], {stdio: 'ignore', timeout: 120000});
  }
  items.push({id: model.id, kind: model.kind, title: model.title, file, pages: chrome ? await pdfPages(pdfPath) : null});
  console.log((chrome ? 'PDF ' : 'HTML ') + file + (items.at(-1).pages ? ` (${items.at(-1).pages} pág.)` : ''));
}
await writeFile(new URL('manifest.json', outDir), JSON.stringify({generatedFrom: 'painel/piloto-simples/document-library.mjs', items}, null, 2) + '\n');
await writeFile(new URL('index.html', outDir), indexPage(items));
console.log(`${items.length} modelo(s) → impressao/ (index.html, manifest.json${chrome ? ', PDFs' : ''})`);
