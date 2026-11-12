import test from 'node:test';
import assert from 'node:assert/strict';
import {whatsappMessage} from '../documents-delivery-ui.mjs';

const record = {id: 'doc-1', patientId: 'p1', visitId: 'v1', title: 'Consentimento — Aplicação intramuscular com prescrição'};
const issue = {id: 'i1', public_url: 'https://anamariajacob.com.br/documento/#token=0f8fad5b-d9cb-469f-a165-70867728950e.' + 'a'.repeat(64), expires_at: '2026-11-19T12:00:00.000Z'};
const state = phone => ({patients: [{id: 'p1', name: 'Maria Souza', phone}]});

test('WhatsApp link uses the patient number with Brazil code and a ready message', () => {
  const url = new URL(whatsappMessage(state('(31) 99584-4803'), record, issue));
  assert.equal(url.origin + url.pathname, 'https://wa.me/5531995844803');
  const text = url.searchParams.get('text');
  assert.match(text, /^Olá, Maria!/);
  assert.ok(text.includes(issue.public_url));
  assert.match(text, /vale até 19\/11\/2026/);
});

test('WhatsApp message never names the procedure or health data', () => {
  const text = new URL(whatsappMessage(state('31995844803'), record, issue)).searchParams.get('text');
  assert.doesNotMatch(text, /intramuscular|toxina|preenchimento|consentimento|horm/i);
  assert.match(text, /não envie informações de saúde/);
});

test('number already with country code is kept; missing phone asks to register it', () => {
  assert.match(whatsappMessage(state('+55 31 99584-4803'), record, issue), /^https:\/\/wa\.me\/5531995844803\?/);
  assert.throws(() => whatsappMessage(state(''), record, issue), /Cadastre o WhatsApp/);
  assert.throws(() => whatsappMessage({patients: []}, record, issue), /Cadastre o WhatsApp/);
});

test('a link outside the official document page is refused', () => {
  assert.throws(() => whatsappMessage(state('31995844803'), record, {...issue, public_url: 'https://golpe.example/documento/#token=x'}), /Link de assinatura não reconhecido/);
});
