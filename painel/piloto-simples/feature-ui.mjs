import {isConnected} from './runtime-store.mjs';
export const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const brl=value=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format((value||0)/100);
export function input(label,name,value='',type='text',attrs=''){return `<label class="field">${escapeHTML(label)}<input name="${name}" value="${escapeHTML(value)}" type="${type}" ${attrs}></label>`;}
export function textArea(label,name,value='',attrs=''){return `<label class="field">${escapeHTML(label)}<textarea name="${name}" ${attrs}>${escapeHTML(value)}</textarea></label>`;}
export function select(label,name,options,value=''){return `<label class="field">${escapeHTML(label)}<select name="${name}">${options.map(([id,text])=>`<option value="${escapeHTML(id)}" ${id===value?'selected':''}>${escapeHTML(text)}</option>`).join('')}</select></label>`;}
export function featureDialog({title,html,onSubmit,submitLabel='Salvar',wide=false}){
 const dialog=document.createElement('dialog');dialog.className='feature-dialog'+(wide?' wide':'');const id=crypto.randomUUID();dialog.setAttribute('aria-labelledby',id);
 dialog.innerHTML=`<div class="dialog-top"><h2 id="${id}">${escapeHTML(title)}</h2><button type="button" class="icon-button" data-close aria-label="Fechar janela">×</button></div><form>${html}<p class="error" role="alert"></p><div class="dialog-actions"><button type="button" class="secondary" data-close>Cancelar</button><button class="primary" type="submit">${escapeHTML(submitLabel)}</button></div></form>`;
 document.body.append(dialog);let saving=false;const form=dialog.querySelector('form');const canClose=()=>!saving&&(!form.dataset.unsaved||confirm('Há alterações não salvas neste formulário. Descartar?'));
 form.addEventListener('input',()=>form.dataset.unsaved='true');form.addEventListener('change',()=>form.dataset.unsaved='true');form.addEventListener('pointerdown',e=>{if(e.target.matches('canvas'))form.dataset.unsaved='true';});
 dialog.addEventListener('cancel',e=>{if(!canClose())e.preventDefault();});dialog.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>{if(canClose())dialog.close();});dialog.addEventListener('close',()=>dialog.remove(),{once:true});
 form.addEventListener('submit',async e=>{e.preventDefault();if(saving)return;saving=true;const values=new FormData(form),buttons=dialog.querySelectorAll('button');form.inert=true;buttons.forEach(b=>b.disabled=true);try{await onSubmit(values,dialog);delete form.dataset.unsaved;dialog.close();}catch(error){dialog.querySelector('.error').textContent=error.message;}finally{saving=false;form.inert=false;buttons.forEach(b=>b.disabled=false);}});dialog.showModal();return dialog;
}
export function downloadFile(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}
// The same-origin assets resolve correctly from local, connected and released app URLs.
// Callers supply their existing escaped document body; this wrapper does not rewrite it.
export function printableHTML(title,body){
 const logo=escapeHTML(new URL('./assets/logo.png',import.meta.url).href),font=escapeHTML(new URL('./assets/Poppins-Regular.ttf',import.meta.url).href);
 return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>${escapeHTML(title)}</title><style>
 @font-face{font-family:Poppins;src:url("${font}") format("truetype");font-display:swap}
 *{box-sizing:border-box}body{font:14px/1.8 Poppins,"Segoe UI",sans-serif;color:#28232b;background:#fcfbfa;margin:0;padding:24px}
 .report-page{width:100%;max-width:920px;margin:auto;padding:36px;background:#fff;border:1px solid #e9e1e5;border-radius:22px;box-shadow:0 4px 30px #30232b08}
 .report-header{padding-bottom:22px;margin-bottom:26px;border-bottom:1px solid #d5bd91}
 .report-brand{position:relative;display:block;overflow:hidden;aspect-ratio:1.52;width:190px;max-width:100%;background:none;border:0;margin-bottom:12px}
 .report-brand img{position:absolute;width:142%;max-width:none;height:auto;left:-22%;top:-13%;margin:0}
 h1{font-size:clamp(25px,4.5vw,34px);font-weight:500;line-height:1.25;letter-spacing:-.03em;margin:0;overflow-wrap:anywhere}
 h2,h3{line-height:1.4;color:#28232b;break-after:avoid}p{margin:0 0 16px}
 .report-content{min-width:0;overflow-wrap:anywhere}.report-content img,.report-content svg{max-width:100%;height:auto}
 table{border-collapse:collapse;width:100%;font-size:13px}td,th{text-align:left;padding:10px 8px;border-bottom:1px solid #e9e1e5;vertical-align:top;overflow-wrap:anywhere}th{background:#faf6f8;font-weight:600}
 pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit}a{color:#703046;text-underline-offset:3px}
 .note{background:#fae9ee;border:1px solid #ead4dc;border-radius:16px;padding:18px;margin:28px 0 20px;color:#58454e;font-size:12px;line-height:1.8;overflow-wrap:anywhere}
 .print-actions{display:flex;justify-content:flex-end}#print{font:600 14px/1.5 Poppins,"Segoe UI",sans-serif;min-height:48px;padding:12px 22px;border:1px solid #ae737b;border-radius:16px;background:#e5a9a9;color:#28232b;cursor:pointer}
 #print:focus-visible,a:focus-visible{outline:3px solid #703046;outline-offset:4px}
 @media(max-width:600px){body{padding:12px}.report-page{padding:22px 18px;border-radius:18px}.report-brand{width:160px}.report-header{margin-bottom:22px}td,th{padding:9px 5px}.print-actions #print{width:100%}}
 @media print{@page{margin:14mm}body{background:#fff;padding:0}.report-page{max-width:none;padding:0;border:0;border-radius:0;box-shadow:none}.print-actions{display:none}.report-header{break-inside:avoid}.note{background:#fff;border-color:#c5a059}thead{display:table-header-group}tr,img,svg{break-inside:avoid}}
 </style></head><body><main class="report-page"><header class="report-header"><span class="report-brand"><img src="${logo}" width="1672" height="941" alt="Ana Maria Jacob — Estética Avançada"></span><h1>${escapeHTML(title)}</h1></header><div class="report-content">${body}</div><p class="note">${isConnected()?'Ambiente conectado em homologação. Exportação para conferência; não comprova assinatura clínica, pagamento ou emissão fiscal.':'Demonstração local com dados fictícios. Sem validade de documento clínico ou fiscal.'}</p><div class="print-actions"><button id="print" type="button">Imprimir / salvar PDF</button></div></main></body></html>`;
}
export function printable(title,body){
 const w=window.open('','_blank');if(!w)throw Error('Permita a abertura da janela para imprimir ou salvar em PDF.');
 w.document.open();w.document.write(printableHTML(title,body));w.document.close();w.document.getElementById('print').onclick=()=>w.print();return w;
}
// Reading a saved record must work even when the host cannot display popup windows.
export function readOnlyPreview(title,body){
 const modal=featureDialog({title,wide:true,submitLabel:'Fechar',html:'<p class="read-only-note">Visualização somente para leitura. O registro original permanece preservado.</p><div class="document-readonly">'+body+'</div><div class="feature-actions"><button type="button" class="secondary" data-preview-print>Abrir impressão / PDF</button><button type="button" class="secondary" data-preview-download>Baixar documento HTML</button></div><p class="small-label">Se a janela de impressão não abrir, baixe o HTML, abra no navegador e use Imprimir. O arquivo HTML não é um PDF.</p>',onSubmit:()=>{}});
 modal.querySelector('.dialog-actions [data-close]').remove();
 modal.querySelector('[data-preview-print]').onclick=()=>{try{printable(title,body);}catch(error){modal.querySelector('.error').textContent=error.message;}};
 modal.querySelector('[data-preview-download]').onclick=()=>{
  // No executable code in the exported file; printing uses the browser menu.
  const html=printableHTML(title,body).replace('<button id="print" type="button">Imprimir / salvar PDF</button>','<p>Use o menu do navegador para imprimir ou salvar como PDF.</p>');
  downloadFile(new Blob([html],{type:'text/html;charset=utf-8'}),'documento-ana-maria-jacob.html');
 };
 return modal;
}
