import {CustomDocumentError,exact,reject,tokenParts,digest,canonical,validateSubmission,publicDocument,paths,assertIssueIntegrity} from '../_shared/custom-documents.mjs';
const origins=new Set(['https://anamariajacob.com.br','https://www.anamariajacob.com.br','http://127.0.0.1:8766','http://localhost:8766','http://127.0.0.1:8765','http://localhost:8765']);
async function body(req){let n=0;const chunks=[],reader=req.body?.getReader();if(!reader)reject('custom_invalid_payload','Envio vazio.');while(true){const {done,value}=await reader.read();if(done)break;n+=value.length;if(n>1500000){await reader.cancel();reject('custom_body_too_large','Envio acima do limite.',413);}chunks.push(value);}const bytes=new Uint8Array(n);let at=0;for(const c of chunks){bytes.set(c,at);at+=c.length;}try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{reject('custom_invalid_payload','Envio inválido.');}}
export function createPublicDocumentHandler({repository,renderPDF,rateLimit}){
 const receipt=async row=>{const pdf=await repository.customOriginalPDF(row);return{id:row.id,document_id:row.document_id,status:'received',signed_at:row.signed_at,snapshot_hash:row.snapshot_hash,pdf_url:pdf.url,pdf_sha256:pdf.sha256,expires_in:120,clinical_authorization:false};};
 return async req=>{
  const origin=req.headers.get('origin')||'',headers={'Access-Control-Allow-Origin':origins.has(origin)?origin:'https://anamariajacob.com.br','Access-Control-Allow-Headers':'content-type,apikey,x-client-info','Access-Control-Allow-Methods':'POST,OPTIONS','Vary':'Origin','Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','Content-Type':'application/json; charset=utf-8'},respond=(value,status=200)=>new Response(JSON.stringify(value),{status,headers});
  let claim,id;
  try{
   if(origin&&!origins.has(origin))reject('origin_forbidden','Origem não autorizada.',403);
   if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
   if(req.method!=='POST')reject('method_not_allowed','Use POST.',405);
   if(!(req.headers.get('content-type')||'').startsWith('application/json'))reject('custom_invalid_payload','Use envio JSON.');
   const p=await body(req);if(!['abrir','assinar','recibo','retomar'].includes(p?.acao))reject('custom_invalid_payload','Operação não reconhecida.');
   if(p.acao!=='assinar')exact(p,['acao','token']);
   // No capability is logged or echoed. Both token and IP limits precede mutation.
   const limit=await rateLimit(req,p.acao);if(!limit.allowed)reject('custom_rate_limited','Aguarde alguns minutos antes de tentar novamente.',429);
   const parts=tokenParts(p.token);id=parts.id;const tokenHash=await digest(parts.token),access={p_id:id,p_token_hash:tokenHash};
   const issue=await repository.customPublic(access);await assertIssueIntegrity(issue);
   if(p.acao==='abrir')return respond({ok:true,document:publicDocument(issue),snapshot_hash:issue.snapshot_hash,confirmation:issue.confirmation,expires_at:issue.expires_at,status:issue.status,can_resume:issue.status==='processing'&&!!issue.submit_operation_id});
   if(p.acao==='recibo'){if(!issue.received_at)reject('custom_not_received','Este documento ainda não foi recebido.',409);return respond({ok:true,receipt:await receipt(issue)});}
   if(p.acao==='retomar'&&issue.received_at)return respond({ok:true,receipt:await receipt(issue)});
   if(p.acao==='retomar'&&(issue.status!=='processing'||!issue.submit_operation_id||!issue.submission_payload))reject('custom_resume_unavailable','Não há envio confirmado para retomar.',409);
   const submission=p.acao==='retomar'?issue.submission_payload:validateSubmission(p,issue),operation=p.acao==='retomar'?issue.submit_operation_id:p.operation_id,submissionHash=await digest(canonical({snapshot_hash:issue.snapshot_hash,submission}));
   if(p.acao==='retomar'&&submissionHash!==issue.submission_hash)reject('custom_integrity_invalid','O envio reservado não corresponde ao registro original.',409);
   if(renderPDF.validate)await renderPDF.validate(issue,submission);
   claim=crypto.randomUUID();const reserved=await repository.customReserve({...access,p_operation:operation,p_submission_hash:submissionHash,p_payload:submission,p_claim:claim});
   if(reserved.received_at){claim=null;return respond({ok:true,receipt:await receipt(reserved)});}
   const packet={schema:1,issue_id:id,clinic_id:reserved.clinic_id,document_id:reserved.document_id,snapshot_hash:reserved.snapshot_hash,signed_at:reserved.signed_at,submission:reserved.submission_payload};
   const signature=new TextEncoder().encode(canonical(packet)),pdf=await renderPDF(reserved,packet);
   if(!(pdf instanceof Uint8Array)||pdf.length<8||pdf.length>5242880||String.fromCharCode(...pdf.subarray(0,5))!=='%PDF-')reject('custom_pdf_invalid','Não foi possível produzir o PDF original.',503);
   const artifacts={...paths(reserved),signature_sha256:await digest(signature),pdf_sha256:await digest(pdf)};
   artifacts.registry_sha256=await digest(canonical({issue_id:id,snapshot_hash:reserved.snapshot_hash,submission_hash:submissionHash,signed_at:reserved.signed_at,...artifacts}));
   await repository.customUpload(artifacts.signature_path,signature,'application/json',artifacts.signature_sha256);
   await repository.customUpload(artifacts.pdf_path,pdf,'application/pdf',artifacts.pdf_sha256);
   const complete=await repository.customFinish({...access,p_claim:claim,p_artifacts:artifacts});claim=null;
   return respond({ok:true,receipt:await receipt(complete)});
  }catch(e){if(claim&&id)try{await repository.customRelease({p_id:id,p_claim:claim});}catch{}
   const known=e instanceof CustomDocumentError||typeof e?.code==='string'&&typeof e?.status==='number';return respond({ok:false,codigo:known?e.code:'custom_unavailable',erro:known?e.message:'O recebimento não foi confirmado. Preserve a mesma operação e tente novamente.'},known?e.status:503);
  }
 };
}
