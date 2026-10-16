import {visibleQuestions} from '../_shared/app-workspace-domain/documents-domain.mjs';
import {reject,digest} from '../_shared/custom-documents.mjs';
export const PDF_ASSETS=Object.freeze({font:{url:'https://anamariajacob.com.br/assets/amj-poppins-20261015.ttf',hash:'7e65201e9b79159e2300267cc885e16c8dcef2424cdfa09a29bfb0980a94a7ba'},logo:{url:'https://anamariajacob.com.br/assets/identidade-visual-transparente-v1.png',hash:'6dd5a16fa082b9875882ad795f975eff3a1423fc4198937a1fc4f955584d33ff'}});
export function createPDFRenderer({PDFDocument,rgb,fontkit,fetchImpl=fetch,assets=null}){
 let loaded;
 async function load(){if(assets)return assets;if(!loaded)loaded=Promise.all(Object.entries(PDF_ASSETS).map(async([key,spec])=>{const r=await fetchImpl(spec.url,{redirect:'error',cache:'no-store',signal:AbortSignal.timeout(12000)});if(!r.ok)throw Error('asset');const b=new Uint8Array(await r.arrayBuffer());if(b.length>4000000||await digest(b)!==spec.hash)throw Error('asset integrity');return[key,b];})).then(Object.fromEntries).catch(e=>{loaded=null;throw e;});return loaded;}
 const render=async(issue,packet)=>{
  const a=await load(),doc=await PDFDocument.create();doc.registerFontkit(fontkit);
  const font=await doc.embedFont(a.font,{subset:true}),logo=await doc.embedPng(a.logo),chars=new Set(font.getCharacterSet()),stamp=new Date(issue.signed_at);
  doc.setTitle(issue.title);doc.setAuthor('Ana Maria Jacob');doc.setCreator('Ana Maria Jacob - documentos');doc.setProducer('Ana Maria Jacob');doc.setCreationDate(stamp);doc.setModificationDate(stamp);
  let page,y;const width=595.28,height=841.89,left=46,right=549.28;
  const addPage=()=>{if(doc.getPageCount()>=150)reject('custom_pdf_limit','O documento ultrapassou o limite de páginas.');page=doc.addPage([width,height]);const s=Math.min(144/logo.width,64/logo.height);page.drawImage(logo,{x:left,y:height-90,width:logo.width*s,height:logo.height*s});y=height-108;};addPage();
  function text(value,{size=9.5,gap=5,color=rgb(.16,.14,.15)}={}){
   value=String(value??'').replace(/\r\n?/g,'\n').replace(/\t/g,'    ');
   if([...value].some(c=>c!=='\n'&&!chars.has(c.codePointAt(0))))reject('custom_pdf_character','O texto contém um caractere sem representação no PDF. Revise o modelo antes de emitir.');
   for(const para of value.split('\n')){let line='';for(const char of [...para]){if(font.widthOfTextAtSize(line+char,size)>right-left&&line){if(y<56)addPage();page.drawText(line,{x:left,y,size,font,color});y-=size*1.5;line='';}line+=char;}if(y<56)addPage();page.drawText(line||' ',{x:left,y,size,font,color});y-=size*1.5;}y-=gap;
  }
  text(issue.title,{size:17,gap:12});text(`Paciente: ${issue.identity.name}\nVersão do modelo: ${issue.template_version}\nEmissão: ${issue.id}\nManifestação recebida em: ${stamp.toISOString()}`);
  text(issue.snapshot.body);for(const b of issue.snapshot.blocks||[]){text(b.title,{size:12});text(b.body);}
  const answers=packet.submission.answers;
  if(visibleQuestions(issue.snapshot,answers).length)text('Respostas registradas',{size:12});
  for(const q of visibleQuestions(issue.snapshot,answers)){text(q.label);text(answers[q.id]||'Não respondido',{gap:10});}
  text('Confirmação expressa',{size:12});text(packet.submission.confirmation_text);
  if(issue.kind==='anamnese')text(packet.submission.general_data_text);
  if(issue.kind==='imagem')text('Decisão independente sobre imagem: '+({tratamento:'somente para tratamento',publicacao:'autorização de publicação',nao_autorizado:'uso não autorizado'})[packet.submission.image_use]);
  text('Assinante: '+packet.submission.signer_name);
  if(y<180)addPage();const sy=y-105,sw=340,sh=95;
  for(const stroke of packet.submission.signature_strokes)for(let i=1;i<stroke.length;i++)page.drawLine({start:{x:left+stroke[i-1].x*sw,y:sy+(1-stroke[i-1].y)*sh},end:{x:left+stroke[i].x*sw,y:sy+(1-stroke[i].y)*sh},thickness:1.3,color:rgb(.16,.14,.15)});
  y=sy-17;text('Assinatura desenhada e confirmada pela pessoa identificada. Recebimento técnico; não substitui revisão profissional.',{size:8});
  text('SHA-256 da versão apresentada: '+issue.snapshot_hash,{size:7.2});
  const pages=doc.getPages();pages.forEach((p,i)=>p.drawText(`${i+1} / ${pages.length}`,{x:width-77,y:28,size:8,font,color:rgb(.35,.32,.34)}));
  return doc.save({useObjectStreams:false});
 };
 // Validate user text BEFORE a submission is reserved. Once reserved, the
 // answers and signature are immutable, so a render error must not trap it.
 render.validate=async(issue,submission)=>{
  const a=await load(),font=fontkit.create(a.font),chars=new Set(font.characterSet),values=[issue.title,issue.identity.name,issue.snapshot.body,...(issue.snapshot.blocks||[]).flatMap(b=>[b.title,b.body]),...visibleQuestions(issue.snapshot,submission.answers).flatMap(q=>[q.label,submission.answers[q.id]||'']),submission.signer_name,submission.confirmation_text,submission.general_data_text||''];let lines=0;
  for(const value of values){const text=String(value).replace(/\r\n?/g,'\n').replace(/\t/g,'    ');if([...text].some(c=>c!=='\n'&&!chars.has(c.codePointAt(0))))reject('custom_pdf_character','Há um caractere que o PDF não representa. Remova emojis ou símbolos especiais da resposta, ou peça a revisão do modelo.');
   for(const paragraph of text.split('\n')){let width=0;for(const char of [...paragraph])width+=font.glyphForCodePoint(char.codePointAt(0)).advanceWidth/font.unitsPerEm*17;lines+=1+Math.ceil(width/490);}
  }
  // Conservative upper bound at title size, including line breaks, headings
  // and page furniture. Content is rejected explicitly, never truncated.
  if(lines>3000)reject('custom_pdf_limit','O conteúdo excede o limite do PDF. Peça à clínica para dividir o modelo em documentos menores.');
 };
 return render;
}
