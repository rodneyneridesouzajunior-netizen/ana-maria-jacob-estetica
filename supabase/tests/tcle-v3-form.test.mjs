import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {webcrypto} from 'node:crypto';
import {createRequire} from 'node:module';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

// Actual HTML and browser scripts in a DOM fixture. No real browser, API or patient data.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(new URL('../../../../skinpro-analise/test-tools/package.json', import.meta.url));
const {JSDOM, VirtualConsole} = require('jsdom');
const slugs = ['toxina', 'preenchimento', 'intradermoterapia', 'bioestimulador', 'peeling-quimico', 'fios-pdo'];
const healthCounts = [17, 17, 14, 8, 11, 13];
const requiredFields = slug => [
  ['aceite_leitura', 'leitura'],
  ['aceite_informacoes', 'informacoes_verdadeiras'],
  ['aceite_voluntario', 'decisao_voluntaria'],
  ['aceite_revisao', 'revisao_profissional'],
  ...(slug === 'preenchimento'
    ? [['aceite_risco_vascular', 'risco_vascular'], ['aceite_hialuronidase', 'ciencia_hialuronidase_urgencia']]
    : slug === 'toxina' ? [] : [['aceite_riscos_especificos', 'riscos_especificos']]),
];

async function formHarness(slug, {corruptTerm = false} = {}) {
  const [html, script, term] = await Promise.all(['index.html', 'tcle.js', 'termo-v3.txt'].map(file => readFile(resolve(root, 'tcle-' + slug, file), 'utf8')));
  const dom = new JSDOM(html, {url: 'https://offline.invalid/tcle-' + slug + '/', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: new VirtualConsole()});
  const {window} = dom, calls = [], errors = [];
  Object.defineProperty(window, 'crypto', {value: webcrypto});
  Object.assign(window, {TextEncoder, TextDecoder, console: {error: error => errors.push(error)}});
  window.HTMLElement.prototype.scrollIntoView = () => {};
  window.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, {get: (_target, key) => key === 'measureText' ? () => ({width: 100}) : () => {}});
  window.fetch = async (url, init = {}) => {
    calls.push({url: String(url), method: init.method || 'GET'});
    assert.equal(String(url), 'termo-v3.txt', 'The offline test must never send data or fetch another resource');
    assert.equal(init.method || 'GET', 'GET');
    return new Response(corruptTerm ? term + '\nALTERADO' : term);
  };
  window.eval(script + '\n;window.__testForm = {state, collectData, validateForm, CONFIG};');
  const api = window.__testForm;
  for (let attempt = 0; attempt < 100 && !api.state.termReady && !window.document.getElementById('enviar').disabled; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  const form = window.document.getElementById('formulario');
  const collect = () => JSON.parse(JSON.stringify(api.collectData('2026-10-15T18:00:00.000Z')));
  const choose = (name, value) => {
    const input = form.querySelector('input[name="' + name + '"][value="' + value + '"]');
    assert(input, name + '=' + value);
    input.checked = true;
    input.dispatchEvent(new window.Event('change', {bubbles: true}));
  };
  return {dom, window, form, calls, errors, api, collect, choose};
}

for (const [index, slug] of slugs.entries()) {
  test(slug + ': v3 opens verified term without submitting, accepting or signing anything', async t => {
    const h = await formHarness(slug);
    t.after(() => h.dom.window.close());
    assert.equal(h.api.state.termReady, true);
    assert.equal(h.api.CONFIG.TERM_VERSION, '2026-10-15-v3');
    assert.equal(h.api.state.signed, false);
    assert.equal(h.api.state.signatureMethod, '');
    assert.deepEqual(h.calls, [{url: 'termo-v3.txt', method: 'GET'}]);
    assert.equal(h.form.querySelector('[name="aceite_dados"]'), null);
    assert.equal(h.form.querySelectorAll('.health-question').length, healthCounts[index]);
    assert.equal(h.form.querySelectorAll('.health-question input:checked').length, 0);
    for (const [field] of requiredFields(slug)) {
      assert.equal(h.form.elements[field].required, true, field);
      assert.equal(h.form.elements[field].checked, false, field);
    }
    assert.equal(h.api.validateForm().ok, false, 'An untouched form must not be submittable');
    assert.deepEqual(h.errors, []);
  });

  test(slug + ': collected v3 declarations reflect only explicit individual selections', async t => {
    const h = await formHarness(slug);
    t.after(() => h.dom.window.close());
    const before = h.collect().declaracoes;
    assert.equal(Object.hasOwn(before, 'tratamento_dados'), false);
    assert.deepEqual(Object.keys(before).sort(), requiredFields(slug).map(([, key]) => key).sort());
    for (const [field, key] of requiredFields(slug)) {
      assert.equal(before[key], false);
      h.form.elements[field].checked = true;
      h.form.elements[field].dispatchEvent(new h.window.Event('change', {bubbles: true}));
      assert.equal(h.collect().declaracoes[key], true);
      h.form.elements[field].checked = false;
    }
    assert.equal(Object.hasOwn(h.collect().declaracoes, 'tratamento_dados'), false);
    assert.equal(h.calls.filter(call => call.method !== 'GET').length, 0);
    assert.equal(h.api.state.signed, false);
  });

  test(slug + ': image refusal defaults remain independent and changing choices never sends the form', async t => {
    const h = await formHarness(slug);
    t.after(() => h.dom.window.close());
    const refused = {foto_prontuario: 'nao', divulgacao: 'nao', antes_depois: 'nao', forma_imagem: 'nao_aplicavel', primeiro_nome: 'nao', depoimento: 'nao'};
    const initialChoice = ['toxina', 'preenchimento'].includes(slug) ? 'nao' : '';
    assert.deepEqual(h.collect().imagem, {...refused, foto_prontuario: initialChoice, divulgacao: initialChoice});
    if (!initialChoice) {
      for (const name of ['foto_prontuario', 'divulgacao']) {
        assert.equal(h.form.querySelector('input[name="' + name + '"]').required, true);
      }
    }
    h.choose('foto_prontuario', 'nao');
    h.choose('divulgacao', 'nao');
    assert.deepEqual(h.collect().imagem, refused);
    h.choose('foto_prontuario', 'sim');
    assert.deepEqual(h.collect().imagem, {...refused, foto_prontuario: 'sim'});
    h.choose('divulgacao', 'sim');
    assert.equal(h.form.querySelector('#opcoes-divulgacao').getAttribute('aria-disabled'), 'false');
    assert.equal(h.form.elements.forma_imagem.value, '', 'Publication requires a new explicit image framing choice');
    h.choose('forma_imagem', 'parcial');
    h.choose('antes_depois', 'sim');
    h.choose('primeiro_nome', 'sim');
    h.choose('depoimento', 'sim');
    assert.equal(h.collect().imagem.antes_depois, 'sim');
    h.choose('divulgacao', 'nao');
    assert.deepEqual(h.collect().imagem, {...refused, foto_prontuario: 'sim'});
    assert.equal(h.form.querySelector('#opcoes-divulgacao').getAttribute('aria-disabled'), 'true');
    assert.equal(h.calls.filter(call => call.method !== 'GET').length, 0);
    assert.equal(h.api.state.signed, false);
  });

  test(slug + ': mismatched term integrity disables sending without a background retry or submission', async t => {
    const h = await formHarness(slug, {corruptTerm: true});
    t.after(() => h.dom.window.close());
    assert.equal(h.api.state.termReady, false);
    assert.equal(h.window.document.getElementById('enviar').disabled, true);
    assert.match(h.window.document.getElementById('texto-integral').textContent, /integridade/);
    assert.equal(h.api.validateForm().ok, false);
    assert.deepEqual(h.calls, [{url: 'termo-v3.txt', method: 'GET'}]);
    assert.equal(h.api.state.signed, false);
  });
}
