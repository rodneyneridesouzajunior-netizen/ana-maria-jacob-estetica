// Atalho da tela inicial: enviar anamnese ou termo pelo WhatsApp em poucos toques.
// Anamnese: link público do site, sem cadastro. Termo: exige paciente e consulta (cadastro rápido quando faltar).
import {escapeHTML as e} from './feature-ui.mjs';
import {savePatient} from './patients-domain.mjs';
import {createVisit} from './visit-workflow.mjs';
import {prepareDocument} from './documents-domain.mjs';
import {openDocumentDelivery} from './documents-delivery-ui.mjs';

export const ANAMNESE_URL = 'https://anamariajacob.com.br/anamnese/';
const NEW = '__nova__';
const digits = value => String(value || '').replace(/\D/g, '');
const today = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };

/** Link do WhatsApp com a anamnese pública. Sem dado de saúde no texto. */
export function anamneseWhatsapp(phone, name = '') {
  const d = digits(phone);
  if (d.length < 10 || d.length > 13) throw Error('Informe o WhatsApp com DDD.');
  const number = d.length <= 11 ? '55' + d : d;
  const first = String(name).trim().split(/\s+/)[0] || '';
  const text = 'Olá' + (first ? ', ' + first : '') + '! Aqui é da clínica Ana Maria Jacob. Antes do seu atendimento, preencha a sua ficha de anamnese por este link:\n' + ANAMNESE_URL + '\n\nLeva poucos minutos. Por favor, não envie informações de saúde por aqui no WhatsApp.';
  return 'https://wa.me/' + number + '?text=' + encodeURIComponent(text);
}

/** Consultas em que ainda é possível preparar documentos, mais recentes primeiro. */
export function openVisits(state, patientId) {
  return (state.visits || []).filter(v => v.patientId === patientId && v.status !== 'concluido' && v.status !== 'cancelado' && !v.lockedAt)
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
}

/** Modelos de termo/autorização já disponíveis na clínica. */
export function sendableTemplates(state) {
  return (state.documentTemplates || []).filter(t => t.kind === 'termo' || t.kind === 'imagem')
    .sort((a, b) => a.title.localeCompare(b.title, 'pt-BR'));
}

export function openQuickSend({getState, persist, notify = () => {}, navigate = () => {}, openDelivery = openDocumentDelivery, openWindow = (url) => window.open(url, '_blank', 'noopener,noreferrer')}) {
  const dialog = document.createElement('dialog');
  dialog.className = 'feature-dialog wide quick-send';
  dialog.setAttribute('aria-label', 'Enviar pelo WhatsApp');
  const state = getState();
  const templates = sendableTemplates(state);
  const patients = [...(state.patients || [])].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  const procedures = (state.procedures || []).filter(p => p.active !== false);
  dialog.innerHTML = `<div class="dialog-top"><h2>Enviar pelo WhatsApp</h2><button type="button" class="icon-button" data-qs="close" aria-label="Fechar janela">×</button></div>
<form data-qs-form novalidate>
 <label class="field">O que enviar<select name="what" required><option value="anamnese">Ficha de anamnese (não precisa de cadastro)</option>${templates.map(t => `<option value="${e(t.id)}">${e(t.title)}</option>`).join('')}</select></label>
 ${templates.length ? '' : '<p class="note-box">Para enviar termos, importe os modelos em <a href="#documentos" data-qs="library">Documentos › Biblioteca de modelos</a>.</p>'}
 <div data-qs-anamnese>
  <label class="field">Nome (opcional)<input name="aName" maxlength="140" autocomplete="off"></label>
  <label class="field">WhatsApp com DDD<input name="aPhone" inputmode="tel" maxlength="25" placeholder="(31) 99999-9999" autocomplete="off"></label>
 </div>
 <div data-qs-termo hidden>
  <label class="field">Paciente<select name="patientId"><option value="">Selecione</option><option value="${NEW}">+ Nova paciente (cadastro rápido)</option>${patients.map(p => `<option value="${e(p.id)}">${e(p.name)}${digits(p.phone).length >= 10 ? '' : ' · sem WhatsApp'}</option>`).join('')}</select></label>
  <div data-qs-new hidden>
   <label class="field">Nome completo<input name="pName" maxlength="140" autocomplete="off"></label>
   <label class="field">WhatsApp com DDD<input name="pPhone" inputmode="tel" maxlength="25" placeholder="(31) 99999-9999" autocomplete="off"></label>
  </div>
  <label class="field">Consulta<select name="visitId"></select></label>
  <label class="field" data-qs-proc hidden>Procedimento da nova consulta<select name="procedureId"><option value="">Selecione</option>${procedures.map(p => `<option value="${e(p.id)}">${e(p.name)}</option>`).join('')}</select></label>
 </div>
 <p data-qs-feedback role="status" aria-live="polite"></p>
 <div class="feature-actions"><button class="primary" type="submit" data-qs="go">Abrir WhatsApp</button><button class="secondary" type="button" data-qs="close">Cancelar</button></div>
 <p class="small-label">A mensagem não cita procedimento nem dados de saúde. Confira o número antes de enviar.</p>
</form>`;
  document.body.append(dialog);
  const form = dialog.querySelector('form');
  const $ = sel => dialog.querySelector(sel);
  const feedback = (text, error = false) => { const p = $('[data-qs-feedback]'); p.textContent = text; p.classList.toggle('error', error); };
  const close = () => { dialog.close(); dialog.remove(); };
  const refreshVisits = () => {
    const pid = form.elements.namedItem('patientId').value;
    const visits = pid && pid !== NEW ? openVisits(getState(), pid) : [];
    form.elements.namedItem('visitId').innerHTML = visits.map(v => `<option value="${e(v.id)}">${e(v.service || 'Consulta')} · ${e(String(v.date || '').split('-').reverse().join('/'))}</option>`).join('') + `<option value="${NEW}">+ Nova consulta hoje</option>`;
    form.elements.namedItem('visitId').value = visits[0]?.id || NEW;
    $('[data-qs-proc]').hidden = form.elements.namedItem('visitId').value !== NEW;
  };
  const sync = () => {
    const anamnese = form.elements.namedItem('what').value === 'anamnese';
    $('[data-qs-anamnese]').hidden = !anamnese;
    $('[data-qs-termo]').hidden = anamnese;
    $('[data-qs-new]').hidden = form.elements.namedItem('patientId').value !== NEW;
    $('[data-qs=go]').textContent = anamnese ? 'Abrir WhatsApp' : 'Preparar e gerar link';
    $('[data-qs-proc]').hidden = anamnese || form.elements.namedItem('visitId').value !== NEW;
  };
  form.elements.namedItem('what').addEventListener('change', sync);
  form.elements.namedItem('patientId').addEventListener('change', () => { refreshVisits(); sync(); });
  form.elements.namedItem('visitId').addEventListener('change', sync);
  dialog.addEventListener('click', ev => {
    const action = ev.target.closest('[data-qs]')?.dataset.qs;
    if (action === 'close') close();
    if (action === 'library') { close(); navigate('documentos'); }
  });
  dialog.addEventListener('cancel', ev => { ev.preventDefault(); close(); });
  form.addEventListener('submit', async ev => {
    ev.preventDefault();
    const button = $('[data-qs=go]');
    try {
      if (form.elements.namedItem('what').value === 'anamnese') {
        openWindow(anamneseWhatsapp(form.elements.namedItem('aPhone').value, form.elements.namedItem('aName').value));
        notify('WhatsApp aberto com o link da anamnese. Confira e toque em enviar.');
        close();
        return;
      }
      button.disabled = true;
      feedback('Preparando…');
      // Valida tudo antes de gravar; cadastro, consulta e documento entram num único salvamento.
      const templateId = form.elements.namedItem('what').value;
      const newPatient = form.elements.namedItem('patientId').value === NEW, newVisit = !form.elements.namedItem('visitId').value || form.elements.namedItem('visitId').value === NEW;
      if (!form.elements.namedItem('patientId').value) throw Error('Selecione a paciente ou faça o cadastro rápido.');
      const name = form.elements.namedItem('pName').value.trim(), phone = form.elements.namedItem('pPhone').value.trim();
      if (newPatient && name.length < 2) throw Error('Informe o nome completo da paciente.');
      if (newPatient && digits(phone).length < 10) throw Error('Informe o WhatsApp com DDD.');
      if (newVisit && !form.elements.namedItem('procedureId').value) throw Error('Escolha o procedimento da nova consulta.');
      const patientId = newPatient ? crypto.randomUUID() : form.elements.namedItem('patientId').value;
      const visitId = newVisit ? crypto.randomUUID() : form.elements.namedItem('visitId').value;
      let record = newVisit ? null : (getState().documentResponses || []).find(d => d.visitId === visitId && d.templateId === templateId && d.status !== 'cancelado');
      if (!record) {
        const id = crypto.randomUUID();
        await persist(s => {
          if (newPatient) savePatient(s, {id: patientId, name, phone}, {expectedVersion: 0, operationId: crypto.randomUUID(), today: today()});
          if (newVisit) createVisit(s, {id: visitId, patientId, procedureId: form.elements.namedItem('procedureId').value, date: today(), notes: 'Aberta pelo atalho de envio da tela inicial.'});
          prepareDocument(s, {id, templateId, patientId, visitId});
        });
        record = getState().documentResponses.find(d => d.id === id);
      }
      if (!record) throw Error('O documento não foi confirmado. Abra a consulta e confira.');
      close();
      openDelivery(record, {getState, notify});
    } catch (error) {
      feedback(error.message || 'Não foi possível preparar o envio.', true);
      button.disabled = false;
    }
  });
  sync();
  refreshVisits();
  sync();
  dialog.showModal();
  return dialog;
}
