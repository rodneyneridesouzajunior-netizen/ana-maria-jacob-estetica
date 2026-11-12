import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {collectSuggestions, installSuggestions} from '../suggestions.mjs';
const require = createRequire(new URL('../../../../../skinpro-analise/test-tools/package.json', import.meta.url));
const {JSDOM} = require('jsdom');
const tick = () => new Promise(resolve => setImmediate(resolve));

const state = {
  expenses: [{description: 'Aluguel sala 504', category: 'Fixa'}, {description: 'Luvas descartáveis', category: 'Material'}, {description: 'aluguel sala 504', category: 'Fixa'}],
  stockLots: [{supplier: 'Distribuidora Alfa'}, {supplier: 'Distribuidora Beta'}],
  products: [{brand: 'Marca X', category: 'Injetável'}],
  auditLog: [{description: 'não deve aparecer'}],
};

test('coleta valores já usados, sem repetir e sem trechos internos', () => {
  const d = collectSuggestions(state, 'description');
  assert.equal(d.filter(v => /aluguel sala 504/i.test(v)).length, 1, 'sem duplicar maiúsculas/minúsculas');
  assert.ok(d.includes('Luvas descartáveis'));
  assert.ok(!d.includes('não deve aparecer'));
  assert.deepEqual(collectSuggestions(state, 'supplier').sort(), ['Distribuidora Alfa', 'Distribuidora Beta']);
  assert.deepEqual(collectSuggestions(state, 'category').sort(), ['Fixa', 'Injetável', 'Material']);
});

test('campos que aparecem na tela recebem a lista de sugestões ao focar', async t => {
  const dom = new JSDOM('<!doctype html><body></body>');
  t.after(() => dom.window.close());
  const doc = dom.window.document;
  const stop = installSuggestions(() => state, doc);
  t.after(stop);
  doc.body.insertAdjacentHTML('beforeend', '<form><input name="supplier"><input name="amount"><input name="email" type="email"></form>');
  await tick();
  const supplier = doc.querySelector('[name=supplier]');
  assert.equal(supplier.getAttribute('list'), 'amj-sugestoes-supplier');
  assert.equal(doc.querySelector('[name=amount]').hasAttribute('list'), false, 'valores não recebem sugestão');
  assert.equal(doc.querySelector('[name=email]').hasAttribute('list'), false);
  supplier.dispatchEvent(new dom.window.Event('focus'));
  const options = [...doc.getElementById('amj-sugestoes-supplier').options].map(o => o.value).sort();
  assert.deepEqual(options, ['Distribuidora Alfa', 'Distribuidora Beta']);
});
