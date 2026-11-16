// Versão em branco de um modelo (anamnese, termo ou autorização) para preenchimento em papel.
// Módulo puro: sem DOM, usado pelo app (Imprimir em branco) e pelo gerador de PDFs do site.
import {documentSections} from './documents-domain.mjs';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const paragraphs=text=>String(text||'').split(/\n{2,}/).map(p=>p.trim()).filter(Boolean).map(p=>`<p>${esc(p).replace(/\n/g,'<br>')}</p>`).join('');
const box=label=>`<span class="pb-opt"><span class="pb-box" aria-hidden="true"></span>${esc(label)}</span>`;
const lines=n=>Array.from({length:n},()=>'<span class="pb-line"></span>').join('');

/** Nome do arquivo PDF publicado em /impressao/ para um modelo da biblioteca (mesma regra no gerador e no app). */
export function printFileName(model){
 const base=String(model.title||model.id).normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
 return base+'.pdf';
}

export function blankAnswer(q){
 if(q.type==='yesno')return box('Sim')+box('Não');
 if(q.type==='yesnona')return box('Sim')+box('Não')+box('Não se aplica');
 if(q.type==='select')return (q.options||[]).map(box).join('');
 if(q.type==='date')return '<span class="pb-date">____ / ____ / ________</span>';
 if(q.type==='scale')return `<span class="pb-date">Nota de ${esc(q.min)} a ${esc(q.max)}: ________</span>`;
 if(q.type==='long')return lines(3);
 return lines(1);
}

/** Pergunta condicional: indica quando deve ser respondida, já que no papel não há ocultação automática. */
function conditionNote(q,all){
 if(!q.condition)return '';
 const parent=all.find(p=>p.id===q.condition.questionId);
 return parent?`<span class="pb-cond">Responda apenas se “${esc(parent.label)}” = ${esc(q.condition.value)}.</span>`:'';
}

export const BLANK_FORM_STYLE=`<style>
.pb-form{font-size:13px;line-height:1.55}.pb-form p{margin:0 0 10px}.pb-form h3{font-size:15px;margin:22px 0 8px;padding-bottom:4px;border-bottom:1px solid #d5bd91}
.pb-form .pb-id{display:grid;grid-template-columns:1fr 1fr;gap:10px 22px;margin:8px 0 6px}.pb-form .pb-id div{break-inside:avoid}
.pb-form ol{margin:0;padding:0;list-style:none}.pb-form li{margin:0 0 12px;break-inside:avoid}.pb-form .pb-q{display:block;font-weight:600;margin-bottom:4px}
.pb-form .pb-req{font-weight:400;color:#703046}.pb-form .pb-cond{display:block;font-size:11.5px;color:#58454e;margin-bottom:4px}
.pb-form .pb-opt{display:inline-block;margin:2px 18px 2px 0;white-space:nowrap}.pb-form .pb-box{display:inline-block;width:12px;height:12px;border:1.5px solid #28232b;border-radius:2px;vertical-align:-1px;margin-right:6px}
.pb-form .pb-line{display:block;height:22px;border-bottom:1px solid #8a7f84;margin-top:2px}.pb-form .pb-date{display:inline-block;margin-top:2px;letter-spacing:.04em}
.pb-form .pb-sign{display:grid;grid-template-columns:1fr 1fr;gap:28px 32px;margin-top:30px;break-inside:avoid}.pb-form .pb-sign div{border-top:1px solid #28232b;padding-top:6px;font-size:12px;margin-top:38px}
.pb-form .pb-note{font-size:11.5px;color:#58454e;margin-top:22px}
@media print{.pb-form{font-size:12px}.pb-form .pb-line{height:20px}}
</style>`;

/**
 * Corpo HTML (sem cabeçalho de marca) do modelo em branco: textos, identificação da paciente,
 * perguntas com espaço para resposta e área de assinatura. `version` é uma versão publicada
 * (state.documentTemplates[].versions[]) ou um modelo da biblioteca (document-library.mjs).
 */
export function blankDocumentBody(version,{identification=true,footer=''}={}){
 const questions=version.questions||[];
 const sections=documentSections({...version,questions});
 const id=identification?`<section><h3>Identificação</h3><div class="pb-id"><div>Nome completo${lines(1)}</div><div>Data de nascimento <span class="pb-date">____ / ____ / ________</span></div><div>CPF${lines(1)}</div><div>WhatsApp${lines(1)}</div></div></section>`:'';
 const text=paragraphs(version.body)+(version.blocks||[]).map(b=>`<section><h3>${esc(b.title)}</h3>${paragraphs(b.body)}</section>`).join('');
 const steps=sections.map(step=>step.questions.length?`<section><h3>${esc(step.title)}</h3><ol>${step.questions.map(q=>`<li><span class="pb-q">${esc(q.label)}${q.required?' <span class="pb-req">(obrigatória)</span>':''}</span>${conditionNote(q,questions)}${blankAnswer(q)}</li>`).join('')}</ol></section>`:'').join('');
 const sign=`<section><h3>Declaração e assinatura</h3><p>Declaro que li este documento, que as respostas acima são verdadeiras e que comunicarei qualquer alteração antes do atendimento.</p><div class="pb-sign"><div>Assinatura da paciente</div><div>Local e data</div><div>Assinatura e carimbo da profissional</div><div>Data da revisão profissional</div></div></section>`;
 return `${BLANK_FORM_STYLE}<div class="pb-form">${id}${text}${steps}${sign}${footer?`<p class="pb-note">${esc(footer)}</p>`:''}</div>`;
}

export function blankDocumentTitle(model){return String(model.title||'Documento')+' · para preenchimento em papel';}
