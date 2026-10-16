import {fail,hash} from './rules.mjs';
import {historicalPDFPath} from './clinical-document-access.mjs';
import {capability,digest,canonical,assertIssueIntegrity,paths,BUCKET as CUSTOM_BUCKET} from '../_shared/custom-documents.mjs';
const BUCKET='app-workspace-media';
export function createRepository({supabaseUrl,serviceRoleKey,fetchImpl=fetch}){
 const base=supabaseUrl.replace(/\/+$/,''),headers={apikey:serviceRoleKey,Authorization:'Bearer '+serviceRoleKey};
 async function request(path,options={}){
  const response=await fetchImpl(base+path,{...options,headers:{...headers,...options.headers},redirect:'error',cache:'no-store',signal:AbortSignal.timeout(25000)});
  if(!response.ok){let body;try{body=await response.json();}catch{}const message=String(body?.message||'');
   const documentErrors={document_clinic_scope_invalid:[403,'O acervo original não está disponível para esta clínica.'],document_source_changed:[409,'O documento original mudou. Atualize a lista e confira novamente.'],document_deletion_in_progress:[409,'O documento está em processo de exclusão e não pode receber vínculos.'],document_source_missing:[404,'Documento original não encontrado.'],document_source_unavailable:[422,'O documento não está recebido, íntegro e disponível para vínculo.'],document_identity_mismatch:[422,'CPF, nome ou nascimento não correspondem ao cadastro selecionado.'],document_binding_invalid:[422,'Confira a paciente e a consulta aberta.'],document_link_invalid:[422,'Confira a confirmação de identidade, motivo e versão.']};
   for(const [code,[status,text]]of Object.entries(documentErrors))if(message===code)fail(code,text,status);
   const bookingErrors={site_request_unavailable:[409,'Pedido indisponível para agendamento.'],site_request_changed:[409,'O pedido mudou. Atualize e confira novamente.'],site_request_already_booked:[409,'Este pedido já foi agendado; use o horário existente para reagendar.'],site_booking_identity_mismatch:[422,'Nome e telefone do cadastro precisam corresponder ao pedido.'],site_booking_binding_immutable:[422,'O horário vinculado ao pedido não pode mudar de paciente.'],site_booking_invalid:[422,'Confira os dados do agendamento.'],site_booking_id_conflict:[409,'Identificador de horário já utilizado.'],site_booking_filters_invalid:[422,'Confira os filtros dos pedidos.']};
   for(const [code,[status,text]]of Object.entries(bookingErrors))if(message===code)fail(code,text,status);
   const clinicalErrors={clinical_configuration_invalid:[422,'Confira seleção, motivo e versão da configuração.'],clinical_professional_missing:[422,'Profissional não encontrada no cadastro.'],clinical_professional_unavailable:[422,'Profissional ou conta não está ativa para esta configuração.'],clinical_procedure_missing:[422,'Versão do procedimento indisponível.'],clinical_policy_mismatch:[422,'Confira a correspondência dos documentos oficiais.'],clinical_completion_invalid:[422,'Confira consulta e declaração da conclusão.'],clinical_professional_changed:[409,'O vínculo da conta profissional mudou. Atualize a revisão.'],clinical_policy_changed:[409,'A política de documentos mudou. Atualize a revisão.'],clinical_documents_incomplete:[422,'Os originais obrigatórios não foram conferidos.'],clinical_document_changed:[409,'Um original mudou ou foi retirado. Confira os documentos novamente.']};
   for(const [code,[status,text]]of Object.entries(clinicalErrors))if(message===code)fail(code,text,status);
   const customErrors={custom_birth_date_required:[422,'Confira a data de nascimento da paciente.'],custom_adult_required:[422,'Este fluxo exige paciente com 18 anos ou mais; menores precisam de conferência presencial do representante.'],clinical_procedure_versions_conflict:[422,'Há versões conflitantes do mesmo procedimento. Confira a consulta e suas marcações.'],custom_link_unavailable:[404,'Este link está inválido, expirado ou revogado.'],custom_operation_reused:[409,'Esta operação já foi utilizada com outros dados.'],custom_binding_invalid:[422,'Confira documento, paciente e consulta.'],custom_visit_locked:[409,'A consulta está encerrada. Preserve os originais.'],custom_issue_invalid:[422,'Confira a versão e a validade do documento.'],custom_active_issue_exists:[409,'Este documento já possui emissão ativa. Abra o link existente ou revogue antes de reemitir.'],custom_processing:[409,'O recebimento está em processamento. Aguarde e repita a mesma operação.'],custom_claim_expired:[409,'O processamento foi retomado por outra tentativa. Repita a mesma operação.'],custom_identity_mismatch:[409,'A identificação ou a consulta mudou. Solicite conferência à clínica.'],custom_submission_invalid:[422,'Confira a confirmação e as respostas.'],custom_integrity_invalid:[409,'Os arquivos originais não correspondem ao registro.']};
   for(const [code,[status,text]]of Object.entries(customErrors))if(message===code)fail(code,text,status);
   if(message.includes('revision_conflict')||body?.code==='40001')fail('revision_conflict','Outra alteração foi salva. Atualize antes de tentar novamente.',409);
   if(message.includes('workspace_access_denied')||body?.code==='42501')fail('workspace_access_denied','A sessão ou o acesso à clínica mudou.',403);
   if(message.includes('operation_reused')||body?.code==='23505')fail('operation_reused','Identificador já utilizado com outros dados.',409);
   if(body?.code==='22023')fail('invalid_workspace_state','O servidor recusou o vínculo ou os dados enviados.');
   fail('backend_unavailable','Não foi possível confirmar a operação no servidor.',503);
  }return response;
 }
 const json=async(path,options)=> (await request(path,options)).json();
 const rows=(table,filters)=>json('/rest/v1/'+table+'?select=*&'+filters);
 const rpc=(name,args)=>json('/rest/v1/rpc/'+name,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(args)});
 const filter=(clinic,tail='')=>'clinic_id=eq.'+encodeURIComponent(clinic)+tail;
 const photoRow=row=>row?{...row.metadata,id:row.id,patient_id:row.patient_id,visit_id:row.visit_id,status:row.status}:null;
 async function signClinicalPath(bucket,path){
  const encoded=path.split('/').map(encodeURIComponent).join('/'),value=await json('/storage/v1/object/sign/'+bucket+'/'+encoded,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({expiresIn:120})}),signed=value.signedURL||value.signedUrl;
  if(typeof signed!=='string'||!signed.startsWith('/object/sign/'+bucket+'/'+encoded+'?'))fail('invalid_document_url','Não foi possível abrir o PDF original.',503);
  return base+'/storage/v1'+signed;
 }
 const repository={
  async load(clinic){return (await rows('app_workspaces',filter(clinic)+'&limit=1'))[0]||null;},
  async operation(clinic,id){return (await rows('app_workspace_operations',filter(clinic)+'&operation_id=eq.'+encodeURIComponent(id)+'&limit=1'))[0]||null;},
  async version(clinic,revision){return (await rows('app_workspace_versions',filter(clinic)+'&revision=eq.'+revision+'&limit=1'))[0]||null;},
  async photos(clinic){const result=[];while(true){const page=await rows('app_workspace_photos',filter(clinic)+'&status=eq.ready&order=id.asc&limit=1000&offset='+result.length);if(!page.length)return result.map(photoRow);result.push(...page);if(result.length>10000)fail('photo_limit_reached','O acervo excede o limite desta versão operacional. Preserve os dados e amplie o contrato antes de continuar.',413);}},
  async photo(clinic,id){return photoRow((await rows('app_workspace_photos',filter(clinic)+'&id=eq.'+encodeURIComponent(id)+'&limit=1'))[0]);},
  commit:args=>rpc('app_workspace_commit',args),
  bookingList:args=>rpc('app_workspace_site_requests_list',args),
  bookingSource:args=>rpc('app_workspace_site_request_source',args),
  bookingOperation:args=>rpc('app_workspace_site_booking_operation',args),
  bookSiteRequest:args=>rpc('app_workspace_book_site_request',args),
  completionContext:args=>rpc('app_workspace_clinical_context',args),
  completionOperation:args=>rpc('app_workspace_clinical_operation',args),
  completeClinical:args=>rpc('app_workspace_complete_clinical',args),
  clinicalSettings:args=>rpc('app_workspace_clinical_settings',args),
  clinicalConfigurationOperation:args=>rpc('app_workspace_clinical_configuration_operation',args),
  configureClinicalProfile:args=>rpc('app_workspace_configure_clinical_profile',args),
  configureClinicalPolicy:args=>rpc('app_workspace_configure_clinical_policy',args),
  clinicalList:args=>rpc('app_workspace_documents_list',args),
  clinicalSource:args=>rpc('app_workspace_document_source',args),
  clinicalLinks:args=>rpc('app_workspace_document_links_list',args),
  clinicalOperation:args=>rpc('app_workspace_document_operation',args),
  customIssues:args=>rpc('app_custom_document_issues_list',args),
  customIssue:args=>rpc('app_custom_document_issue',args),
  customIssueCreate:args=>rpc('app_custom_document_issue_create',args),
  customRevoke:args=>rpc('app_custom_document_revoke',args),
  customPublic:args=>rpc('app_custom_document_public',args),
  customReserve:args=>rpc('app_custom_document_reserve',args),
  customFinish:args=>rpc('app_custom_document_finish',args),
  customRelease:args=>rpc('app_custom_document_release',args),
  customClinicalSources:args=>rpc('app_custom_document_sources',args),
  customClinicalSource:args=>rpc('app_custom_document_source',args),
  customTokenHash:async issue=>digest(await capability(issue,serviceRoleKey)),
  async customPublicURL(issue){const token=await capability(issue,serviceRoleKey);if(await digest(token)!==issue.token_hash)fail('custom_link_key_changed','A chave do servidor mudou. Preserve o original e emita um novo link após revogar este.',409);return 'https://anamariajacob.com.br/documento/#token='+token;},
  async customOriginalPDF(issue){const expected=paths(issue);if(!issue.received_at||issue.pdf_path!==expected.pdf_path||issue.signature_path!==expected.signature_path)fail('custom_integrity_invalid','O original não está confirmado.',409);await assertIssueIntegrity(issue);const registry={issue_id:issue.id,snapshot_hash:issue.snapshot_hash,submission_hash:issue.submission_hash,signed_at:issue.signed_at,...expected,signature_sha256:issue.signature_sha256,pdf_sha256:issue.pdf_sha256};if(await digest(canonical(registry))!==issue.registry_sha256)fail('custom_integrity_invalid','O registro do original está divergente.',409);const source={...issue,bucket:CUSTOM_BUCKET,storage_valid:true};await repository.verifyClinicalObject(source,'pdf');await repository.verifyClinicalObject(source,'signature');return{url:await signClinicalPath(CUSTOM_BUCKET,issue.pdf_path),sha256:issue.pdf_sha256,expires_in:120};},
  async customUpload(path,bytes,mime,expectedHash){
   if(!/^[a-f0-9-]{36}\/[a-f0-9-]{36}\/(documento\.pdf|assinatura\.json)$/.test(path)||!['application/pdf','application/json'].includes(mime)||await digest(bytes)!==expectedHash)fail('custom_integrity_invalid','Arquivo original inválido.',409);
   const encoded=path.split('/').map(encodeURIComponent).join('/'),response=await fetchImpl(base+'/storage/v1/object/'+CUSTOM_BUCKET+'/'+encoded,{method:'POST',headers:{...headers,'Content-Type':mime,'x-upsert':'false'},body:bytes,redirect:'error',cache:'no-store',signal:AbortSignal.timeout(25000)});
   if(response.ok)return;
   if([400,409].includes(response.status)){const existing=await request('/storage/v1/object/'+CUSTOM_BUCKET+'/'+encoded),value=await existing.arrayBuffer();if(value.byteLength===bytes.byteLength&&await digest(value)===expectedHash)return;fail('custom_content_conflict','O arquivo existente diverge. O original foi preservado.',409);}
   fail('custom_upload_unconfirmed','O envio do original não foi confirmado. Repita a mesma operação.',503);
  },
  linkClinical:args=>rpc('app_workspace_link_document',args),
  async openHistoricalClinicalPDF(source){
   const path=historicalPDFPath(source);if(!path)fail('document_not_ready','O PDF histórico não tem um caminho válido registrado.',409);
   const response=await fetchImpl(base+'/storage/v1/object/fichas-pdf/'+encodeURIComponent(path),{headers,redirect:'error',cache:'no-store',signal:AbortSignal.timeout(25000)});
   if(response.status===404)fail('document_file_missing','O PDF histórico não foi encontrado no armazenamento.',404);
   if(!response.ok)fail('backend_unavailable','Não foi possível consultar o PDF histórico.',503);
   const max=5*1024*1024;if(Number(response.headers.get('content-length')||0)>max)fail('document_integrity_invalid','O PDF histórico excede o limite de leitura.');
   const reader=response.body?.getReader(),parts=[];let size=0;if(!reader)fail('document_integrity_invalid','O PDF histórico está vazio.');
   while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max){await reader.cancel();fail('document_integrity_invalid','O PDF histórico excede o limite de leitura.');}parts.push(value);}
   const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}
   if(size<8||String.fromCharCode(...bytes.subarray(0,5))!=='%PDF-')fail('document_integrity_invalid','O arquivo histórico não é um PDF válido.',409);
   const currentHash=await hash(bytes);
   if(source.pdf_sha256!=null&&source.pdf_sha256!==currentHash)fail('document_integrity_invalid','O PDF histórico não corresponde ao hash registrado.',409);
   // This hash describes the bytes read now. It is never a substitute for a
   // historical signature, a received document or a persisted registry hash.
   return {url:await signClinicalPath('fichas-pdf',path),sha256:currentHash,expires_in:120,integrity:'historical_file_only'};
  },
  async verifyClinicalObject(source,kind){
   const bucket=source.bucket,path=kind==='pdf'?source.pdf_path:source.signature_path,expected=kind==='pdf'?source.pdf_sha256:source.signature_sha256,max=kind==='pdf'?5*1024*1024:bucket===CUSTOM_BUCKET?1500000:500000;
   if(!source.storage_valid||!['fichas-pdf','documentos-clinicos',CUSTOM_BUCKET].includes(bucket)||typeof path!=='string'||path.includes('..')||!/^[a-f0-9]{64}$/.test(expected||''))fail('document_integrity_invalid','Metadados do original incompletos.');
   const response=await request('/storage/v1/object/'+bucket+'/'+path.split('/').map(encodeURIComponent).join('/'));
   if(Number(response.headers.get('content-length')||0)>max)fail('document_integrity_invalid','O arquivo original excede o limite de verificação.');
   const reader=response.body?.getReader(),parts=[];let size=0;if(!reader)fail('document_integrity_invalid','O arquivo original está vazio.');
   while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max){await reader.cancel();fail('document_integrity_invalid','O arquivo original excede o limite de verificação.');}parts.push(value);}
   const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}
   if(!size||await hash(bytes)!==expected)fail('document_integrity_invalid','O arquivo original não corresponde ao hash registrado. Nenhum vínculo foi salvo.',409);
  },
  async signClinical(source){
   const bucket=source.bucket,path=source.pdf_path;if(!source.storage_valid||!['fichas-pdf','documentos-clinicos',CUSTOM_BUCKET].includes(bucket)||typeof path!=='string'||path.includes('..'))fail('document_integrity_invalid','Caminho de documento inválido.');
   return signClinicalPath(bucket,path);
  },
  async reserve(args){return photoRow(await rpc('app_workspace_photo_reserve',args));},
  async ready(args){return photoRow(await rpc('app_workspace_photo_ready',args));},
  async upload(path,bytes,mime,expectedHash){
   const encoded=path.split('/').map(encodeURIComponent).join('/');
   const response=await fetchImpl(base+'/storage/v1/object/'+BUCKET+'/'+encoded,{method:'POST',headers:{...headers,'Content-Type':mime,'x-upsert':'false'},body:bytes,redirect:'error',cache:'no-store',signal:AbortSignal.timeout(25000)});
   if(response.ok)return;
   // A lost response or concurrent retry may have already written this immutable object.
   if(response.status===400||response.status===409){const existing=await fetchImpl(base+'/storage/v1/object/'+BUCKET+'/'+encoded,{headers,redirect:'error',cache:'no-store',signal:AbortSignal.timeout(25000)});if(existing.ok){const value=await existing.arrayBuffer();if(value.byteLength===bytes.byteLength&&await hash(value)===expectedHash)return;fail('photo_content_conflict','O arquivo existente não corresponde ao envio. O original foi preservado.',409);}}
   fail('upload_unconfirmed','O envio da foto não foi confirmado. Repita a mesma operação e arquivo.',503);
  },
  async sign(path){const encoded=path.split('/').map(encodeURIComponent).join('/'),value=await json('/storage/v1/object/sign/'+BUCKET+'/'+encoded,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({expiresIn:120})});const signed=value.signedURL||value.signedUrl;if(typeof signed!=='string'||!signed.startsWith('/object/sign/'+BUCKET+'/'))fail('invalid_photo_url','Não foi possível abrir a fotografia.',503);return base+'/storage/v1'+signed;},
 };return repository;
}
