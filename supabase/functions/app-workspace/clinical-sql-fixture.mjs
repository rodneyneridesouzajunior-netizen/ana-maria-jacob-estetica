// Local SQL-only fixture. Auth/Storage/legacy tables are synthetic; migrations run in PostgreSQL/WASM.
import {createRequire} from 'node:module';import {readFile} from 'node:fs/promises';
const require=createRequire(new URL('../../../skinpro-analise/revisoes/codigo-provas/map2d-sql/package.json',import.meta.url));
const {PGlite}=require('@electric-sql/pglite');
export const clinicalId=n=>`${n.repeat(8)}-${n.repeat(4)}-4${n.repeat(3)}-8${n.repeat(3)}-${n.repeat(12)}`;
export async function createClinicalSqlFixture(){
 const db=new PGlite(),clinic=clinicalId('1'),actor=clinicalId('2'),session=clinicalId('3'),sourceId=clinicalId('4');
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;create schema private;
 create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid);create table public.clinics(id uuid primary key);create table public.clinic_members(clinic_id uuid,user_id uuid,role text,status text);
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(bucket_id text);alter table storage.objects enable row level security;
 create function clinic_validate_auth_session(p_user_id uuid,p_session_id uuid) returns boolean language sql security invoker as $$ select exists(select 1 from auth.sessions where id=p_session_id and user_id=p_user_id) $$;
 grant usage on schema public,auth to service_role;grant select on clinic_members,auth.sessions to service_role;
 create table public.anamneses(id uuid primary key,idempotency_key uuid,nome text,cpf text,telefone text,recebido_em timestamptz,updated_at timestamptz,formulario_versao text,formulario_sha256 text,assinatura_sha256 text,pdf_sha256 text,registro_sha256 text,status text,arquivado_em timestamptz,consentimento_retirado_em timestamptz,pdf_path text,assinatura_path text,dados jsonb);
 create table public.documentos_clinicos(like public.anamneses including all);alter table public.documentos_clinicos add column tipo text,add column versao_termo text,add column termo_sha256 text;
 grant select,insert,update on public.anamneses,public.documentos_clinicos to service_role;
 create table private.fichas_exclusao_intencoes(clinic_id uuid,origem text,documento_id uuid,expira_em timestamptz);
 create table public.fichas_exclusao_tombstones(clinic_id uuid,origem text,alvo_hmac bytea);
 create function private.fichas_exclusao_hmac(text) returns bytea language sql security definer set search_path='' as $$select pg_catalog.sha256(pg_catalog.convert_to($1,'UTF8'))$$;
 revoke all on private.fichas_exclusao_intencoes,public.fichas_exclusao_tombstones from public,anon,authenticated,service_role;revoke all on function private.fichas_exclusao_hmac(text) from public,anon,authenticated,service_role;
 create function public.painel_validar_escopo_clinico_legado(p_clinic_id uuid) returns boolean language sql security definer set search_path='' as $$select (select count(*) from public.clinics)=1 and exists(select 1 from public.clinics where id=p_clinic_id)$$;
 revoke all on function public.painel_validar_escopo_clinico_legado(uuid) from public,anon,authenticated;grant execute on function public.painel_validar_escopo_clinico_legado(uuid) to service_role;
 create table public.patient_source_links(clinic_id uuid,source_kind text,source_id uuid,patient_id uuid,status text);
 `);
 for(const [sql,args]of [['insert into clinics values($1)',[clinic]],['insert into auth.users values($1)',[actor]],['insert into auth.sessions values($1,$2)',[session,actor]],["insert into clinic_members values($1,$2,'owner','active')",[clinic,actor]]])await db.query(sql,args);
 await db.exec(await readFile(new URL('../../migrations/20261015220006_app_workspace_private_cas.sql',import.meta.url),'utf8'));
 await db.exec(await readFile(new URL('../../migrations/20261015224148_app_workspace_clinical_document_links.sql',import.meta.url),'utf8'));
 const oldSql=await readFile(new URL('../../migrations/20260824050000_exclusao_definitiva_fichas_elegiveis.sql',import.meta.url),'utf8'),start=oldSql.indexOf('create or replace function private.fichas_exclusao_vinculos('),end=oldSql.indexOf('$function$;',start)+'$function$;'.length;
 await db.exec(oldSql.slice(start,end));
 let state={schema:1,revision:1,patients:[{id:'patient',name:'Paciente Fictícia',cpf:'52998224725',birthDate:'1990-01-01'}],visits:[{id:'visit',patientId:'patient',status:'rascunho'}]};
 await db.query('select app_workspace_commit($1,$2,$3,$4,$5,0,$6,$7)',[clinic,actor,session,clinicalId('5'),'1'.repeat(64),state,'2'.repeat(64)]);
 async function seed(kind='anamnese',id=sourceId){const table=kind==='anamnese'?'anamneses':'documentos_clinicos',prefix=kind==='anamnese'?'anamneses/'+id+'/':'tcle-toxina/'+id+'/';await db.query(`insert into ${table}(id,idempotency_key,nome,cpf,telefone,recebido_em,updated_at,formulario_versao,formulario_sha256,assinatura_sha256,pdf_sha256,registro_sha256,status,pdf_path,assinatura_path,dados) values($1,$1,'Paciente Fictícia','52998224725','31900000000','2026-10-15T18:00:00Z','2026-10-15T18:00:00Z','2026-08-19-v1',$2,$3,$4,$5,'recebido',$6,$7,$8)`,[id,'a'.repeat(64),'b'.repeat(64),'c'.repeat(64),'d'.repeat(64),prefix+(kind==='anamnese'?'ficha.pdf':'documento.pdf'),prefix+'assinatura.png',{nascimento:'1990-01-01'}]);if(kind!=='anamnese')await db.query("update documentos_clinicos set tipo='tcle_toxina_botulinica',formulario_versao=null,formulario_sha256=null,versao_termo='2026-08-18-v1',termo_sha256=$1 where id=$2",['a'.repeat(64),id]);}
 await seed();
 const actorArgs=()=>[clinic,actor,session];
 const source=async(kind='anamnese',id=sourceId)=>(await db.query('select app_workspace_document_source($1,$2,$3,$4,$5) result',[...actorArgs(),kind,id])).rows[0].result;
 async function link(overrides={}){const s=await source(overrides.kind,overrides.id),args={operation:clinicalId('6'),fingerprint:'e'.repeat(64),expected:1,patient:'patient',visit:'visit',kind:'anamnese',id:sourceId,sourceFingerprint:s?.source_fingerprint,reason:'Identidade conferida em teste',...overrides};return (await db.query('select app_workspace_link_document($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) result',[...actorArgs(),args.operation,args.fingerprint,args.expected,args.patient,args.visit,args.kind,args.id,args.sourceFingerprint,args.reason])).rows[0].result;}
 const links=async()=>(await db.query('select app_workspace_document_links_list($1,$2,$3,$4,$5) result',[...actorArgs(),'patient','visit'])).rows[0].result;
 return {db,clinic,actor,session,sourceId,state,source,seed,link,links,close:()=>db.close()};
}
