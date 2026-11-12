// Atalho "Enviar pelo WhatsApp" da tela inicial, com DOM real (jsdom) e estado de demonstração.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {seed} from '../domain.mjs';
import {ensureDocuments, saveTemplate} from '../documents-domain.mjs';
import {CLINIC_DOCUMENT_MODELS} from '../document-library.mjs';
import {saveProcedure} from '../operations-domain.mjs';
import {emptyState, validateTransition} from '../../../supabase/functions/app-workspace/rules.mjs';
import {openQuickSend, anamneseWhatsapp, openVisits, ANAMNESE_URL} from '../quick-send-ui.mjs';
const require = createRequire(new URL('../../../../../skinpro-analise/test-tools/package.json', import.meta.url));
const {JSDOM} = require('jsdom');
const tick = () => new Promise(resolve => setImmediate(resolve));

function harness(t) {
  const dom = new JSDOM('<!doctype html><body></body>', {url: 'https://anamariajacob.com.br/app/'}), w = dom.window;
  const previous = {document: globalThis.document, FormData: globalThis.FormData};
  Object.assign(globalThis, {document: w.document, FormData: w.FormData});
  w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  w.HTMLDialogElement.prototype.close = function () { this.open = false; };
  t.after(() => { for (const [k, v] of Object.entries(previous)) { if (v === undefined) delete globalThis[k]; else globalThis[k] = v; } w.close(); });
  let state = seed(); ensureDocuments(state);
  { const today = state.visits[0].date; saveProcedure(state, {today, now: today + 'T12:00:00.000Z', operationId: 'proc-quick', data: {id: 'proc-quick', name: 'Toxina botulínica', price: 10000, cost: 1000, duration: 30, recordMode: 'simple'}}); }
  const model = CLINIC_DOCUMENT_MODELS.find(m => m.id === 'amj-termo-toxina-20261016');
  saveTemplate(state, {id: model.id, kind: model.kind, title: model.title, body: model.body, questions: model.questions, blocks: model.blocks || []});
  const opened = [], delivered = [];
  const persist = async fn => { const next = structuredClone(state); fn(next); state = next; };
  const dialog = openQuickSend({getState: () => state, persist, openWindow: url => opened.push(url), openDelivery: record => delivered.push(record)});
  const form = dialog.querySelector('form');
  const set = (name, value) => { form.elements.namedItem(name).value = value; form.elements.namedItem(name).dispatchEvent(new w.Event('change', {bubbles: true})); };
  const submit = async () => { form.dispatchEvent(new w.Event('submit', {bubbles: true, cancelable: true})); await tick(); await tick(); };
  return {dialog, form, set, submit, opened, delivered, model, get state() { return state; }};
}

test('anamnese vai para qualquer número, sem cadastro e sem dado de saúde', async t => {
  const h = harness(t);
  assert.equal(h.form.elements.namedItem('what').value, 'anamnese');
  const patientsBefore = h.state.patients.length;
  h.form.elements.namedItem('aName').value = 'Joana Lima'; h.form.elements.namedItem('aPhone').value = '(31) 98888-7777';
  await h.submit();
  assert.equal(h.opened.length, 1);
  const url = new URL(h.opened[0]);
  assert.equal(url.pathname, '/5531988887777');
  assert.match(url.searchParams.get('text'), /^Olá, Joana!/);
  assert.ok(url.searchParams.get('text').includes(ANAMNESE_URL));
  assert.equal(h.state.patients.length, patientsBefore, 'não cria cadastro');
  assert.equal(h.dialog.isConnected, false);
});

test('anamnese recusa número sem DDD', () => {
  assert.throws(() => anamneseWhatsapp('98888-7777'), /DDD/);
});

test('termo para paciente nova: cadastro rápido, consulta nova e documento preparado', async t => {
  const h = harness(t);
  const procedure = h.state.procedures.find(p => p.active !== false);
  h.set('what', h.model.id);
  h.set('patientId', '__nova__');
  h.form.elements.namedItem('pName').value = 'Paciente Nova Teste'; h.form.elements.namedItem('pPhone').value = '31977776666';
  assert.equal(h.form.elements.namedItem('visitId').value, '__nova__');
  h.form.elements.namedItem('procedureId').value = procedure.id;
  await h.submit();
  const patient = h.state.patients.find(p => p.name === 'Paciente Nova Teste');
  assert.ok(patient, 'paciente cadastrada');
  assert.equal(patient.phone, '31977776666');
  const visit = h.state.visits.find(v => v.patientId === patient.id);
  assert.ok(visit, 'consulta criada');
  const doc = h.state.documentResponses.find(d => d.visitId === visit.id);
  assert.equal(doc.templateId, h.model.id);
  assert.deepEqual(h.delivered.map(d => d.id), [doc.id]);
});

test('termo para paciente existente reaproveita consulta aberta e não duplica documento', async t => {
  const h = harness(t);
  const patient = h.state.patients.find(p => openVisits(h.state, p.id).length);
  assert.ok(patient, 'seed precisa de paciente com consulta aberta');
  const visit = openVisits(h.state, patient.id)[0];
  h.set('what', h.model.id);
  h.set('patientId', patient.id);
  assert.equal(h.form.elements.namedItem('visitId').value, visit.id);
  await h.submit();
  const docs = () => h.state.documentResponses.filter(d => d.visitId === visit.id && d.templateId === h.model.id);
  assert.equal(docs().length, 1);
  assert.equal(h.delivered.length, 1);
  // Reabrir o atalho para a mesma consulta não cria um segundo documento.
  const delivered = [];
  const reopened = openQuickSend({getState: () => h.state, persist: async () => { throw Error('não deveria gravar'); }, openDelivery: r => delivered.push(r)});
  const f = reopened.querySelector('form');
  f.elements.namedItem('what').value = h.model.id; f.elements.namedItem('what').dispatchEvent(new f.ownerDocument.defaultView.Event('change'));
  f.elements.namedItem('patientId').value = patient.id; f.elements.namedItem('patientId').dispatchEvent(new f.ownerDocument.defaultView.Event('change'));
  f.dispatchEvent(new f.ownerDocument.defaultView.Event('submit', {cancelable: true})); await tick(); await tick();
  assert.equal(docs().length, 1);
  assert.deepEqual(delivered.map(d => d.id), [docs()[0].id]);
});

test('termo exige paciente e procedimento quando a consulta é nova', async t => {
  const h = harness(t);
  h.set('what', h.model.id);
  await h.submit();
  assert.match(h.dialog.querySelector('[data-qs-feedback]').textContent, /Selecione a paciente/);
  h.set('patientId', '__nova__');
  h.form.elements.namedItem('pName').value = 'Fulana'; h.form.elements.namedItem('pPhone').value = '31977776666';
  await h.submit();
  assert.match(h.dialog.querySelector('[data-qs-feedback]').textContent, /procedimento/);
  assert.equal(h.delivered.length, 0);
  assert.equal(h.state.patients.some(p => p.name === 'Fulana'), false, 'nada é gravado pela metade');
});

test('servidor aceita cadastro rápido, consulta e documento num único salvamento', async t => {
  const dom = new JSDOM('<!doctype html><body></body>', {url: 'https://anamariajacob.com.br/app/'}), w = dom.window;
  const previous = {document: globalThis.document, FormData: globalThis.FormData};
  Object.assign(globalThis, {document: w.document, FormData: w.FormData});
  w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  w.HTMLDialogElement.prototype.close = function () { this.open = false; };
  t.after(() => { for (const [k, v] of Object.entries(previous)) { if (v === undefined) delete globalThis[k]; else globalThis[k] = v; } w.close(); });
  const today = new Date().toISOString().slice(0, 10);
  let state = emptyState(); ensureDocuments(state);
  saveProcedure(state, {today, now: today + 'T12:00:00.000Z', operationId: 'p', data: {id: 'p', name: 'Toxina botulínica', price: 10000, cost: 1000, duration: 30, recordMode: 'simple'}});
  const model = CLINIC_DOCUMENT_MODELS.find(m => m.id === 'amj-termo-intramuscular-20261112');
  saveTemplate(state, {id: model.id, kind: model.kind, title: model.title, body: model.body, questions: model.questions, blocks: model.blocks || []});
  let saves = 0; const delivered = [];
  const persist = async fn => { const next = structuredClone(state); fn(next); validateTransition(state, next); state = next; saves++; };
  const dialog = openQuickSend({getState: () => state, persist, openDelivery: r => delivered.push(r)});
  const f = dialog.querySelector('form'), field = n => f.elements.namedItem(n), change = el => el.dispatchEvent(new w.Event('change'));
  field('what').value = model.id; change(field('what'));
  field('patientId').value = '__nova__'; change(field('patientId'));
  field('pName').value = 'Paciente Servidor'; field('pPhone').value = '31966665555'; field('procedureId').value = 'p';
  f.dispatchEvent(new w.Event('submit', {cancelable: true})); await tick(); await tick();
  assert.equal(saves, 1, 'um único salvamento');
  assert.equal(delivered.length, 1);
  assert.equal(state.documentResponses[0].templateId, model.id);
});