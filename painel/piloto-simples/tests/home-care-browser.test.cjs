'use strict';

// Chromium exercises the connected shell and real UI modules without clinic credentials or network.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { before, after, test } = require('node:test');
const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE || 'playwright');

const root = path.resolve(__dirname, '../../..');
const origin = 'https://clinica-preview.invalid';
const app = '/painel/piloto-simples/connected.html';
const date = '2026-11-06';
const pdfOrigin = 'https://rjxtxoqprnumouqakxbc.supabase.co';
const pdfUrl = pdfOrigin + '/storage/v1/object/sign/fichas-pdf/anamnese-ficticia.pdf?token=fixture';
const types = {
  '.html': 'text/html', '.css': 'text/css', '.mjs': 'text/javascript', '.js': 'text/javascript',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json'
};
const documentRows = [
  { source_kind: 'anamnese', title: 'Ficha de anamnese', identity: { name: 'Paciente Exemplo A' } },
  { source_kind: 'anamnese', title: 'Ficha de anamnese', identity: { name: 'Paciente Exemplo B' } },
  { source_kind: 'documento_clinico', title: 'Termo de exemplo', identity: { name: 'Paciente Exemplo C' } }
].map((row,index) => ({
  ...row, source_id:'00000000-0000-4000-8000-00000000000' + (index + 1),
  status: 'recebido', received_at: date + 'T11:00:00Z', source_fingerprint: 'a'.repeat(64),
  pdf_sha256: 'b'.repeat(64), pdf_access: 'verified',
  ...(index === 0 ? {status:'legado',pdf_access:'historical',eligible_for_link:false,clinical_authorization:false} : {})
}));

function minimalPDF() {
  const stream = 'BT /F1 16 Tf 60 750 Td (Anamnese ficticia para teste) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Length ' + Buffer.byteLength(stream) + ' >>\nstream\n' + stream + '\nendstream'
  ];
  let body = '%PDF-1.4\n';
  const offsets = [0];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(body));
    body += (offsets.length - 1) + ' 0 obj\n' + object + '\nendobj\n';
  }
  const xref = Buffer.byteLength(body);
  body += 'xref\n0 6\n0000000000 65535 f \n' +
    offsets.slice(1).map(offset => String(offset).padStart(10, '0') + ' 00000 n \n').join('') +
    'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n';
  return body;
}

function bootstrap() {
  return [
    "import {seed} from './domain.mjs';",
    "import {normalizeWorkspace} from './store.mjs';",
    "import {configureRuntimeStore} from './runtime-store.mjs';",
    "import {configureClinicalBridge} from './clinical-bridge-runtime.mjs';",
    "import {createClinicalBridgeService} from './clinical-bridge-service.mjs';",
    "const key = 'synthetic-clinic-browser-workspace';",
    "const starting = normalizeWorkspace(seed());",
    "starting.patients.forEach((patient, index) => patient.name = 'Paciente Exemplo ' + 'ABC'[index]);",
    "starting.appointments[0].time = '09:00';",
    "starting.appointments[1].time = '11:00';",
    "starting.appointments[2].date = '2026-11-09';",
    "starting.appointments.push({...starting.appointments[1], id:'example-far', date:'2026-11-17'});",
    "starting.appointments.push({...starting.appointments[1], id:'example-cancelled', time:'14:00', status:'cancelado'});",
    "const read = () => JSON.parse(sessionStorage.getItem(key)) || structuredClone(starting);",
    "configureRuntimeStore({async load(){return read();}, async getPhoto(){return null;},",
    "  async commit(revision, update){const next=read();if(next.revision!==revision)throw Error('Conflito de revisão fictício.');",
    "    update(next);next.revision++;sessionStorage.setItem(key,JSON.stringify(next));return next;}});",
    'const all = ' + JSON.stringify(documentRows) + ';',
    'const pdfUrl = ' + JSON.stringify(pdfUrl) + ';',
    "const session={async requireReady(){return {token:'fixture'};},async assertCurrent(){},subscribe(){return ()=>{};}};",
    "const auth={ok:true,role:'owner',auth_method:'supabase_auth',clinic_id:'00000000-0000-4000-8000-000000000010'};",
    "configureClinicalBridge(createClinicalBridgeService({session,async request(endpoint, action, input){",
    "  if(action==='listar_documentos_originais'){const {search='',source_kind,kind,offset=0,limit=25}=input;",
    "    const filter=source_kind||kind;",
    "    const docs=all.filter(row=>(!filter||filter==='all'||row.source_kind===filter)&&row.identity.name.toLowerCase().includes(search.toLowerCase()));",
    "    return {...auth,documents:docs.slice(offset,offset+limit),pagination:{limit,offset,total:docs.length,has_more:offset+limit<docs.length}};}",
    "  if(action==='listar_solicitacoes_site')return {...auth,solicitacoes_site:[]};",
    "  if(action==='obter_documento_original'){const doc=all.find(row=>row.source_id===input.source_id&&row.source_kind===input.source_kind);",
    "    if(!doc||doc.source_fingerprint!==input.expected_source_fingerprint)throw Error('Original fictício indisponível.');",
    "    return {...auth,document:doc,pdf:{url:pdfUrl,sha256:doc.pdf_sha256,expires_in:300,integrity:doc.pdf_access==='historical'?'historical_file_only':'verified'}};}",
    "  throw Error('Operação fora da prévia');}}));",
    "document.querySelector('[data-cloud-daily-status]').textContent = 'Prévia com dados fictícios';",
    "await import('./app.mjs');"
  ].join('\n');
}

async function offline(context) {
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.href === pdfUrl) return route.fulfill({ status: 200, contentType: 'application/pdf', body: minimalPDF() });
    if (url.origin !== origin || route.request().method() !== 'GET') return route.abort();
    if (url.pathname.endsWith('/connected-bootstrap.mjs')) {
      return route.fulfill({ contentType: 'text/javascript', body: bootstrap() });
    }
    const file = path.resolve(root, '.' + decodeURIComponent(url.pathname));
    assert.ok(file.startsWith(root + path.sep), 'A prévia serve apenas arquivos do worktree');
    try {
      await route.fulfill({ contentType: types[path.extname(file)] || 'application/octet-stream', body: await fs.readFile(file) });
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await route.fulfill({ status: 404, body: 'Arquivo fora da prévia' });
    }
  });
}

async function capture(target, name, style) {
  const dir = process.env.HOME_PREVIEW_DIR;
  if (!dir) return;
  await fs.mkdir(dir, { recursive: true });
  await target.screenshot({ path: path.join(dir, name + '.png'), animations: 'disabled', style });
}
const edit = id => '[data-action="edit-appointment"][data-id="' + id + '"]';
const busy = page => page.waitForFunction(() => !document.querySelector('#content')?.inert);
const saved = page => page.evaluate(() => JSON.parse(sessionStorage.getItem('synthetic-clinic-browser-workspace')));
const exact = hash => '#page-body a[href="' + hash + '"]';
const ready = page => page.locator('.sp-care-priorities').waitFor();
const backToHome = async page => {
  await page.locator('#nav a[href="#hoje"]').click();
  await ready(page);
  await busy(page);
};

let browser;
before(async () => {
  browser = await chromium.launch({ ...(process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {}), headless: true });
});
after(async () => { await browser?.close(); });

for (const [device, viewport] of [['computador', { width: 1366, height: 900 }], ['celular', { width: 390, height: 844 }]]) {
  test('aplicativo conectado: atalhos e reagendamento no ' + device, { timeout: 70000 }, async () => {
    const context = await browser.newContext({ viewport, timezoneId: 'America/Sao_Paulo', locale: 'pt-BR' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => dialog.accept());
    page.setDefaultTimeout(6500);
    await offline(context);
    await page.clock.setFixedTime(new Date(date + 'T08:00:00-03:00'));
    try {
      await page.goto(origin + app + '#hoje');
      await ready(page);
      await busy(page);
      await capture(page, 'inicio-' + device);
      if (device === 'celular') {
        await capture(page.locator('.sp-care-priorities'), 'prioridades-celular', '.sidebar { visibility: hidden !important; }');
      }

      await page.locator(exact('#originais/anamneses')).click();
      await page.waitForFunction(() => location.hash === '#originais/anamneses');
      const records = page.locator('[data-cb-content] .cb-record');
      await records.first().waitFor();
      assert.equal(await records.count(), 2);
      assert.doesNotMatch(await page.locator('[data-cb-content]').textContent(), /Termo de exemplo/);
      await page.locator('[data-cb-search] input[name="search"]').fill('Exemplo A');
      await page.locator('[data-cb-search] [type="submit"]').click();
      await page.waitForFunction(() => document.querySelectorAll('[data-cb-content] .cb-record').length === 1);
      assert.match(await records.first().textContent(), /Paciente Exemplo A/);
      if (device === 'computador') await capture(page, 'anamneses-computador');
      const opened = context.waitForEvent('response', { predicate: response => response.url() === pdfUrl });
      await records.first().locator('[data-cb="pdf"]').click();
      assert.equal((await opened).status(), 200);
      for (const popup of context.pages().filter(tab => tab !== page)) await popup.close();

      for (const [hash, visible, excluded] of [
        ['#agenda/hoje', ['demo-ag1', 'demo-ag2'], ['demo-ag3', 'example-far']],
        ['#agenda/proximos', ['demo-ag1', 'demo-ag3'], ['example-far', 'example-cancelled']],
        ['#agenda/aguardando', ['demo-ag2', 'demo-ag3'], ['demo-ag1', 'example-far', 'example-cancelled']]
      ]) {
        await backToHome(page);
        await page.locator(exact(hash)).click();
        await page.waitForFunction(expected => location.hash === expected && document.querySelector('[data-agenda-module]'), hash);
        await busy(page);
        for (const id of visible) await page.locator('#page-body ' + edit(id)).first().waitFor();
        for (const id of excluded) assert.equal(await page.locator('#page-body ' + edit(id)).count(), 0, hash + ' exclui ' + id);
      }

      await backToHome(page);
      await page.locator('#page-body ' + edit('demo-ag1')).first().click();
      await page.locator('#dialog[open]').waitFor();
      assert.equal(await page.locator('#d-patient').inputValue(), 'demo-marina');
      assert.equal(await page.locator('#d-time').inputValue(), '09:00');
      if (device === 'computador') await capture(page, 'reagendar-computador');
      await page.locator('#d-time').fill('11:00');
      await page.locator('#dialog-form [type="submit"]').click();
      await page.waitForFunction(() => document.querySelector('#dialog-error').textContent.includes('nesse intervalo'));
      assert.equal(await saved(page), null, 'O conflito não grava alterações');
      await page.locator('#d-time').fill('10:00');
      await page.locator('#dialog-form [type="submit"]').click();
      await page.locator('#dialog[open]').waitFor({ state: 'hidden' });
      const rescheduled = await saved(page);
      assert.equal(rescheduled.appointments.length, 5);
      assert.equal(rescheduled.appointments.find(item => item.id === 'demo-ag1').time, '10:00');
      assert.equal(rescheduled.visits.find(visit => visit.id === 'demo-consulta').appointmentId, 'demo-ag1');

      await page.reload();
      await ready(page);
      await busy(page);
      await page.locator('#page-body ' + edit('demo-ag1')).first().click();
      assert.equal(await page.locator('#d-time').inputValue(), '10:00');
      await page.locator('#d-time').fill('09:00');
      await page.locator('#cancel-dialog').click();
      await page.locator('#page-body [data-action="new-appointment"]').first().click();
      assert.equal(await page.locator('#dialog-title').textContent(), 'Novo agendamento');
      assert.equal(await page.locator('#d-service').inputValue(), '');
      await page.locator('#d-patient').selectOption('demo-beatriz');
      await page.locator('#d-time').fill('16:00');
      await page.locator('#d-service').fill('Novo horário fictício');
      await page.locator('#dialog-form [type="submit"]').click();
      await page.locator('#dialog[open]').waitFor({ state: 'hidden' });
      const final = await saved(page);
      assert.equal(final.appointments.length, 6);
      assert.equal(final.appointments.find(item => item.id === 'demo-ag1').time, '10:00');
      assert.notEqual(final.appointments.find(item => item.service === 'Novo horário fictício').id, 'demo-ag1');
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });
}
