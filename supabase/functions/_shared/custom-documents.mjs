import {validateDocumentVersion,checkAnswers} from './app-workspace-domain/documents-domain.mjs';
import {validCPF} from './app-workspace-domain/patients-domain.mjs';

export class CustomDocumentError extends Error {constructor(code,message,status=422){super(message);this.code=code;this.status=status;}}
export const reject=(code,message,status=422)=>{throw new CustomDocumentError(code,message,status);};
export const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
export const uuid=x=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(x);
export const identifier=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,179}$/.test(x)&&!['constructor','prototype','__proto__'].includes(x);
export const hex=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
export const canonical=x=>JSON.stringify(x,(_,v)=>plain(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
export const digest=async x=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',typeof x==='string'?new TextEncoder().encode(x):x)),n=>n.toString(16).padStart(2,'0')).join('');
export const normalizeName=x=>String(x||'').normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase().replace(/\s+/g,' ').trim();
export const BUCKET='app-custom-documents';
export const CONFIRMATION=Object.freeze({version:'2026-10-16-v1',text:'Li este documento, conferi minhas respostas e confirmo livremente esta manifestação. Entendo que o recebimento não substitui a conferência da profissional nem autoriza sozinho um procedimento.',general_data_text:'Autorizo o tratamento dos meus dados pessoais e de saúde pela clínica para a prestação segura do atendimento, registro da anamnese, cumprimento de obrigações legais e defesa de direitos. Esta autorização não inclui uso de imagem para divulgação, que depende de decisão separada.'});
export function exact(value,keys){if(!plain(value)||Object.keys(value).some(k=>!keys.includes(k)))reject('custom_invalid_payload','O envio contém campos não reconhecidos.');}
export function requireAdultBirthDate(value,now=new Date()){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value+'T12:00:00Z'))||new Date(value+'T12:00:00Z').toISOString().slice(0,10)!==value)reject('custom_birth_date_required','Informe e confira a data de nascimento antes de emitir o documento.');
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(now)),part=k=>Number(parts.find(p=>p.type===k).value),[year,month,day]=value.split('-').map(Number),age=part('year')-year-(part('month')<month||part('month')===month&&part('day')<day?1:0);
 if(age<18)reject('custom_adult_required','Este fluxo exige paciente com 18 anos ou mais. Para menores, a clínica deve conferir o representante e realizar o atendimento pelo fluxo presencial adequado.');return value;
}
export function issueSnapshot(document,patient,visit,{now=new Date()}={}){
 if(!plain(document)||!identifier(document.id)||!identifier(document.templateId)||!['anamnese','termo','imagem'].includes(document.kind)||document.status!=='rascunho'||document.patientId!==patient?.id||document.visitId!==visit?.id||visit.patientId!==patient.id)reject('custom_binding_invalid','Confira o documento, a paciente e a consulta.');
 if(visit.lockedAt||['concluido','cancelado'].includes(visit.status))reject('custom_visit_locked','A consulta está encerrada. Preserve seus originais.',409);
 if(!Number.isSafeInteger(document.templateVersion)||document.templateVersion!==document.snapshot?.version)reject('custom_snapshot_invalid','A versão do documento não corresponde ao modelo preparado.');
 try{validateDocumentVersion(document.snapshot);}catch{reject('custom_snapshot_invalid','O modelo preparado contém campos ou perguntas inválidos.');}
 const name=String(patient.name||'').trim(),cpf=String(patient.cpf||'').replace(/\D/g,'');
 if(name.length<2||name.length>160||!validCPF(cpf))reject('custom_identity_required','Confira nome completo e CPF válido da paciente antes de emitir o documento.');
 const identity={name,cpf,birth_date:requireAdultBirthDate(patient.birthDate,now),phone:String(patient.phone||'')};
 return{document_id:document.id,template_id:document.templateId,template_version:document.templateVersion,kind:document.kind,title:document.snapshot.title,patient_id:patient.id,visit_id:visit.id,identity,snapshot:structuredClone(document.snapshot),confirmation:{version:CONFIRMATION.version,renderer_version:'2026-10-16-v2',text:CONFIRMATION.text,...(document.kind==='anamnese'?{general_data_text:CONFIRMATION.general_data_text}:{})}};
}
export async function capability(issue,secret){
 if(!secret||!uuid(issue.id)||!uuid(issue.clinic_id)||!uuid(issue.token_nonce))reject('custom_configuration_unavailable','O link individual está temporariamente indisponível.',503);
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const bytes=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(canonical({scope:'amj-custom-document-v1',id:issue.id,clinic:issue.clinic_id,nonce:issue.token_nonce,expires:new Date(issue.expires_at).toISOString()})));
 return issue.id+'.'+Array.from(new Uint8Array(bytes),n=>n.toString(16).padStart(2,'0')).join('');
}
export function tokenParts(token){if(typeof token!=='string'||token.length!==101||!uuid(token.slice(0,36))||token[36]!=='.'||!hex(token.slice(37)))reject('custom_link_unavailable','Este link está inválido, expirado ou revogado.',404);return{id:token.slice(0,36),token};}
export function signatureStrokes(raw){
 if(!Array.isArray(raw)||raw.length<1||raw.length>100)reject('custom_signature_required','Desenhe sua assinatura para confirmar.');
 let count=0,distance=0;const strokes=raw.map(line=>{
  if(!Array.isArray(line)||line.length<2||line.length>1024)reject('custom_signature_invalid','A assinatura contém um traço inválido.');
  count+=line.length;if(count>20000)reject('custom_signature_invalid','A assinatura excedeu o limite. Limpe e desenhe novamente.');
  return line.map((point,i)=>{if(!plain(point)||Object.keys(point).length!==2||!Object.hasOwn(point,'x')||!Object.hasOwn(point,'y')||![point.x,point.y].every(n=>typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=1))reject('custom_signature_invalid','A assinatura está fora da área permitida.');if(i)distance+=Math.hypot(point.x-line[i-1].x,point.y-line[i-1].y);return{x:point.x,y:point.y};});
 });if(distance<.01)reject('custom_signature_required','A assinatura precisa conter um traço.');return strokes;
}
export function validateSubmission(payload,issue){
 exact(payload,['acao','token','operation_id','snapshot_hash','confirmation_version','answers','signer_name','signature_strokes','confirmed','general_data_consent','image_use']);
 const confirmation=issue.confirmation;
 if(!confirmation?.version||!uuid(payload.operation_id)||payload.snapshot_hash!==issue.snapshot_hash||payload.confirmation_version!==confirmation.version)reject('custom_version_changed','Reabra o documento e confira a versão antes de assinar.',409);
 if(payload.confirmed!==true)reject('custom_confirmation_required','Leia e confirme o documento pessoalmente.');
 if(typeof payload.signer_name!=='string'||payload.signer_name.trim().length>160||normalizeName(payload.signer_name)!==normalizeName(issue.identity?.name))reject('custom_identity_mismatch','Digite seu nome completo conforme a identificação apresentada.');
 if(issue.kind==='anamnese'){if(payload.general_data_consent!==true)reject('custom_general_consent_required','Confira a autorização dos dados da anamnese.');}
 else if(Object.hasOwn(payload,'general_data_consent'))reject('custom_general_consent_unexpected','As autorizações gerais pertencem à anamnese.');
 if(issue.kind==='imagem'){if(!['tratamento','publicacao','nao_autorizado'].includes(payload.image_use))reject('custom_image_choice_required','Escolha explicitamente a finalidade ou a recusa de uso de imagem.');}
 else if(Object.hasOwn(payload,'image_use'))reject('custom_image_choice_unexpected','Esta autorização de imagem exige documento próprio.');
 let answers;try{answers=checkAnswers({snapshot:issue.snapshot},payload.answers,true);}catch{reject('custom_answers_invalid','Confira as respostas obrigatórias e suas opções.');}
 if(Object.keys(payload.answers).some(id=>!issue.snapshot.questions.some(q=>q.id===id)))reject('custom_answers_invalid','Há respostas que não pertencem à versão deste documento.');
 return{answers,signer_name:payload.signer_name.trim(),signature_strokes:signatureStrokes(payload.signature_strokes),confirmed:true,confirmation_version:confirmation.version,confirmation_text:confirmation.text,...(issue.kind==='anamnese'?{general_data_consent:true,general_data_text:confirmation.general_data_text}:{}),...(issue.kind==='imagem'?{image_use:payload.image_use}:{})};
}
export function describeIssue(row){return Object.fromEntries(['id','document_id','patient_id','visit_id','template_id','template_version','kind','title','status','issued_at','expires_at','snapshot_hash','received_at','revoked_at'].map(k=>[k,row[k]??null]));}
export function publicDocument(row){return{id:row.id,title:row.title,kind:row.kind,templateVersion:row.template_version,snapshot:row.snapshot,patientName:row.identity.name};}
export async function assertIssueIntegrity(row){const envelope=Object.fromEntries(['document_id','template_id','template_version','kind','title','patient_id','visit_id','identity','snapshot','confirmation'].map(k=>[k,row[k]]));if(await digest(canonical(envelope))!==row.snapshot_hash)reject('custom_integrity_invalid','A versão apresentada não corresponde ao registro da emissão.',409);}
export function paths(row){if(!uuid(row.clinic_id)||!uuid(row.id))reject('custom_integrity_invalid','Identificação do original inválida.',409);const prefix=row.clinic_id+'/'+row.id+'/';return{pdf_path:prefix+'documento.pdf',signature_path:prefix+'assinatura.json'};}
