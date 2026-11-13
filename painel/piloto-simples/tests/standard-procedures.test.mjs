import test from 'node:test';
import assert from 'node:assert/strict';
import {STANDARD_PROCEDURES, missingStandardProcedures} from '../operations-ui.mjs';
import {saveProcedure} from '../operations-domain.mjs';
import {ensureDocuments, saveTemplate} from '../documents-domain.mjs';
import {CLINIC_DOCUMENT_MODELS} from '../document-library.mjs';
import {emptyState, validateTransition} from '../../../supabase/functions/app-workspace/rules.mjs';

function clinic() {
  const state = emptyState(); ensureDocuments(state);
  for (const m of CLINIC_DOCUMENT_MODELS.filter(m => m.kind === 'termo')) saveTemplate(state, {id: m.id, kind: m.kind, title: m.title, body: m.body, questions: m.questions, blocks: m.blocks || []});
  return state;
}

test('every standard procedure points to a term that exists in the library', () => {
  const ids = new Set(CLINIC_DOCUMENT_MODELS.filter(m => m.kind === 'termo').map(m => m.id));
  for (const p of STANDARD_PROCEDURES) assert.ok(ids.has(p.consentTemplateId), p.name);
  assert.equal(STANDARD_PROCEDURES.some(p => /lipoescultura|limpeza de pele|laser/i.test(p.name)), false);
});

test('missing list skips existing names (including variants like "Bioestimulador de colágeno — marca")', () => {
  const state = clinic();
  const today = '2026-11-12';
  saveProcedure(state, {operationId: 'p0', now: today + 'T12:00:00.000Z', today, data: {id: 'elleva', name: 'Bioestimulador de colágeno — ELLEVA 210 mg', price: 100000, cost: 0, duration: 60, recordMode: 'simple'}});
  const missing = missingStandardProcedures(state);
  assert.equal(missing.some(p => p.id === 'amj-proc-bioestimulador'), false);
  assert.equal(missing.length, STANDARD_PROCEDURES.length - 1);
});

test('adding all standard procedures is accepted by the server rules and becomes idempotent', () => {
  const before = clinic(), next = structuredClone(before), today = '2026-11-12';
  for (const p of missingStandardProcedures(next)) saveProcedure(next, {operationId: 'op-' + p.id, now: today + 'T12:00:00.000Z', today, data: {id: p.id, name: p.name, category: p.category, emoji: p.emoji, recordMode: p.recordMode, price: 0, cost: 0, duration: p.duration, returnDays: 0, consentTemplateId: p.consentTemplateId, requiredDocumentIds: [p.consentTemplateId], active: true}});
  assert.doesNotThrow(() => validateTransition(before, next));
  assert.equal(next.procedures.length, STANDARD_PROCEDURES.length);
  assert.equal(missingStandardProcedures(next).length, 0);
});
