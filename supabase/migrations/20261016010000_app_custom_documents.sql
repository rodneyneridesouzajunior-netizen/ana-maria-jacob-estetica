begin;
-- Capability-based originals. Browser roles have neither table nor RPC access.
create table public.app_custom_document_issues (
 id uuid primary key,clinic_id uuid not null references public.clinics(id) on delete restrict,
 document_id text not null,patient_id text not null,visit_id text not null,template_id text not null,
 template_version integer not null check(template_version>0),kind text not null check(kind in ('anamnese','termo','imagem')),title text not null,
 snapshot jsonb not null,identity jsonb not null,confirmation jsonb not null,snapshot_hash text not null check(snapshot_hash~'^[a-f0-9]{64}$'),
 request_hash text not null check(request_hash~'^[a-f0-9]{64}$'),workspace_revision bigint not null,
 token_nonce uuid not null,token_hash text not null check(token_hash~'^[a-f0-9]{64}$'),
 issued_by uuid not null references auth.users(id),issued_at timestamptz not null default clock_timestamp(),expires_at timestamptz not null,
 status text not null default 'issued' check(status in ('issued','processing','received','revoked')),revoked_at timestamptz,received_at timestamptz,
 submit_operation_id uuid,submission_hash text,submission_payload jsonb,signed_at timestamptz,claim_id uuid,lease_until timestamptz,
 unique(clinic_id,id),check(expires_at>issued_at),check(jsonb_typeof(snapshot)='object'),check(jsonb_typeof(identity)='object')
);
create unique index app_custom_document_active on public.app_custom_document_issues(clinic_id,document_id) where revoked_at is null;
create table public.app_custom_document_receipts (
 issue_id uuid primary key references public.app_custom_document_issues(id) on delete restrict,
 clinic_id uuid not null,submit_operation_id uuid not null,submission_hash text not null,
 signed_at timestamptz not null,pdf_path text not null,signature_path text not null,
 pdf_sha256 text not null check(pdf_sha256~'^[a-f0-9]{64}$'),signature_sha256 text not null check(signature_sha256~'^[a-f0-9]{64}$'),
 registry_sha256 text not null check(registry_sha256~'^[a-f0-9]{64}$'),created_at timestamptz not null default clock_timestamp(),
 clinical_authorization boolean not null default false check(not clinical_authorization),
 foreign key(clinic_id,issue_id) references public.app_custom_document_issues(clinic_id,id) on delete restrict
);
create table public.app_custom_document_operations (
 clinic_id uuid not null references public.clinics(id),operation_id uuid not null,issue_id uuid not null references public.app_custom_document_issues(id),
 action text not null check(action='revoke'),actor_id uuid not null references auth.users(id),created_at timestamptz not null default clock_timestamp(),primary key(clinic_id,operation_id)
);
alter table public.app_custom_document_issues enable row level security;
alter table public.app_custom_document_receipts enable row level security;
alter table public.app_custom_document_operations enable row level security;
revoke all on public.app_custom_document_issues,public.app_custom_document_receipts,public.app_custom_document_operations from public,anon,authenticated,service_role;
grant select on public.app_custom_document_issues,public.app_custom_document_receipts,public.app_custom_document_operations to service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('app-custom-documents','app-custom-documents',false,5242880,array['application/pdf','application/json']) on conflict(id) do nothing;
create policy app_custom_document_storage_edge_only on storage.objects as restrictive for all to anon,authenticated
using(bucket_id<>'app-custom-documents') with check(bucket_id<>'app-custom-documents');

create function public.app_custom_document_row(p_id uuid) returns jsonb language sql security definer set search_path='' as $$
 select to_jsonb(i)||coalesce((select to_jsonb(r)-'issue_id'-'clinic_id'-'signed_at' from public.app_custom_document_receipts r where r.issue_id=i.id),'{}'::jsonb) from public.app_custom_document_issues i where i.id=p_id;
$$;
create function public.app_custom_document_issue(p_clinic uuid,p_actor uuid,p_session uuid,p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin perform public.app_workspace_require_actor(p_clinic,p_actor,p_session);if not exists(select 1 from public.app_custom_document_issues where id=p_id and clinic_id=p_clinic) then return null;end if;return public.app_custom_document_row(p_id);end;$$;
create function public.app_custom_document_issues_list(p_clinic uuid,p_actor uuid,p_session uuid,p_document text) returns jsonb language plpgsql security definer set search_path='' as $$
begin perform public.app_workspace_require_actor(p_clinic,p_actor,p_session);return coalesce((select jsonb_agg(public.app_custom_document_row(id) order by issued_at desc) from public.app_custom_document_issues where clinic_id=p_clinic and document_id=p_document),'[]'::jsonb);end;$$;
create function public.app_custom_document_issue_create(p_clinic uuid,p_actor uuid,p_session uuid,p_operation uuid,p_expected bigint,p_request_hash text,p_snapshot jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare w public.app_workspaces;old public.app_custom_document_issues;d jsonb;p jsonb;v jsonb;
begin
 perform public.app_workspace_require_actor(p_clinic,p_actor,p_session);
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('app-workspace:'||p_clinic::text,0));
 select * into old from public.app_custom_document_issues where id=p_operation;
 if found then if old.clinic_id<>p_clinic or old.request_hash<>p_request_hash then raise exception 'custom_operation_reused';end if;return public.app_custom_document_row(old.id);end if;
 select * into w from public.app_workspaces where clinic_id=p_clinic;
 if w.revision is distinct from p_expected then raise exception 'revision_conflict' using errcode='40001';end if;
 select x into d from jsonb_array_elements(coalesce(w.state->'documentResponses','[]')) x where x->>'id'=p_snapshot->>'document_id';
 select x into p from jsonb_array_elements(coalesce(w.state->'patients','[]')) x where x->>'id'=p_snapshot->>'patient_id';
 select x into v from jsonb_array_elements(coalesce(w.state->'visits','[]')) x where x->>'id'=p_snapshot->>'visit_id';
 if d is null or p is null or v is null or d->>'patientId'<>p->>'id' or d->>'visitId'<>v->>'id' or v->>'patientId'<>p->>'id'
 or d->>'status'<>'rascunho' or d->'snapshot' is distinct from p_snapshot->'snapshot' or d->>'templateId'<>p_snapshot->>'template_id'
 or d->>'kind'<>p_snapshot->>'kind' or d->>'templateVersion'<>p_snapshot->>'template_version' or d#>>'{snapshot,title}'<>p_snapshot->>'title'
 or p_snapshot#>>'{identity,name}'<>btrim(p->>'name') or p_snapshot#>>'{identity,cpf}'<>regexp_replace(p->>'cpf','[^0-9]','','g')
 or not public.app_workspace_document_cpf(p->>'cpf') or coalesce(p->>'birthDate','')<>p_snapshot#>>'{identity,birth_date}'
 or coalesce(p->>'phone','')<>p_snapshot#>>'{identity,phone}' or p_snapshot->>'id'<>p_operation::text or p_snapshot->>'clinic_id'<>p_clinic::text
 then raise exception 'custom_binding_invalid' using errcode='22023';end if;
 if coalesce(v->>'lockedAt','')<>'' or v->>'status' in ('concluido','cancelado') then raise exception 'custom_visit_locked';end if;
 if coalesce(p->>'birthDate','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'custom_birth_date_required';end if;
 if (p->>'birthDate')::date>((clock_timestamp() at time zone 'America/Sao_Paulo')::date-interval '18 years')::date then raise exception 'custom_adult_required';end if;
 if (p_snapshot->>'expires_at')::timestamptz<=clock_timestamp() or (p_snapshot->>'expires_at')::timestamptz>clock_timestamp()+interval '31 days'
 or coalesce(p_snapshot#>>'{confirmation,version}','')='' or coalesce(p_snapshot#>>'{confirmation,text}','')='' then raise exception 'custom_issue_invalid';end if;
 if exists(select 1 from public.app_custom_document_issues where clinic_id=p_clinic and document_id=p_snapshot->>'document_id' and revoked_at is null) then raise exception 'custom_active_issue_exists';end if;
 insert into public.app_custom_document_issues(id,clinic_id,document_id,patient_id,visit_id,template_id,template_version,kind,title,snapshot,identity,confirmation,snapshot_hash,request_hash,workspace_revision,token_nonce,token_hash,issued_by,expires_at)
 values(p_operation,p_clinic,p_snapshot->>'document_id',p_snapshot->>'patient_id',p_snapshot->>'visit_id',p_snapshot->>'template_id',(p_snapshot->>'template_version')::int,p_snapshot->>'kind',p_snapshot->>'title',p_snapshot->'snapshot',p_snapshot->'identity',p_snapshot->'confirmation',p_snapshot->>'snapshot_hash',p_request_hash,p_expected,(p_snapshot->>'token_nonce')::uuid,p_snapshot->>'token_hash',p_actor,(p_snapshot->>'expires_at')::timestamptz);
 return public.app_custom_document_row(p_operation);
end;$$;
create function public.app_custom_document_revoke(p_clinic uuid,p_actor uuid,p_session uuid,p_operation uuid,p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare old public.app_custom_document_operations;i public.app_custom_document_issues;
begin
 perform public.app_workspace_require_actor(p_clinic,p_actor,p_session);
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('custom-operation:'||p_clinic::text||':'||p_operation::text,0));
 select * into old from public.app_custom_document_operations where clinic_id=p_clinic and operation_id=p_operation;
 if found then if old.issue_id<>p_id then raise exception 'custom_operation_reused';end if;return public.app_custom_document_row(p_id);end if;
 select * into i from public.app_custom_document_issues where id=p_id and clinic_id=p_clinic for update;
 if not found then raise exception 'custom_link_unavailable';end if;
 update public.app_custom_document_issues set status='revoked',revoked_at=coalesce(revoked_at,clock_timestamp()),lease_until=null,claim_id=null where id=p_id;
 insert into public.app_custom_document_operations values(p_clinic,p_operation,p_id,'revoke',p_actor,clock_timestamp());return public.app_custom_document_row(p_id);
end;$$;
create function public.app_custom_document_public(p_id uuid,p_token_hash text) returns jsonb language plpgsql security definer set search_path='' as $$
begin if not exists(select 1 from public.app_custom_document_issues where id=p_id and token_hash=p_token_hash and revoked_at is null and expires_at>clock_timestamp()) then raise exception 'custom_link_unavailable';end if;return public.app_custom_document_row(p_id);end;$$;
create function public.app_custom_document_reserve(p_id uuid,p_token_hash text,p_operation uuid,p_submission_hash text,p_payload jsonb,p_claim uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare i public.app_custom_document_issues;w jsonb;p jsonb;v jsonb;
begin
 select * into i from public.app_custom_document_issues where id=p_id;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('app-workspace:'||i.clinic_id::text,0));
 select * into i from public.app_custom_document_issues where id=p_id for update;
 perform public.app_custom_document_public(p_id,p_token_hash);
 if i.submit_operation_id is not null and (i.submit_operation_id<>p_operation or i.submission_hash<>p_submission_hash) then raise exception 'custom_operation_reused';end if;
 if i.status='received' then return public.app_custom_document_row(p_id);end if;
 if i.lease_until>clock_timestamp() then raise exception 'custom_processing';end if;
 -- Recheck identity and consultation at the transaction boundary. No rebinding.
 select state into w from public.app_workspaces where clinic_id=i.clinic_id;
 select x into p from jsonb_array_elements(coalesce(w->'patients','[]')) x where x->>'id'=i.patient_id;
 select x into v from jsonb_array_elements(coalesce(w->'visits','[]')) x where x->>'id'=i.visit_id;
 if not coalesce(public.app_workspace_document_identity(jsonb_build_object('identity',i.identity),p),false) or v is null or v->>'patientId'<>i.patient_id then raise exception 'custom_identity_mismatch';end if;
 if coalesce(v->>'lockedAt','')<>'' or v->>'status' in ('concluido','cancelado') then raise exception 'custom_visit_locked';end if;
 if p_operation is null or p_claim is null or p_submission_hash!~'^[a-f0-9]{64}$' or jsonb_typeof(p_payload)<>'object' or p_payload->>'confirmed'<>'true' then raise exception 'custom_submission_invalid';end if;
 update public.app_custom_document_issues set status='processing',submit_operation_id=p_operation,submission_hash=p_submission_hash,submission_payload=coalesce(submission_payload,p_payload),signed_at=coalesce(signed_at,clock_timestamp()),claim_id=p_claim,lease_until=clock_timestamp()+interval '90 seconds' where id=p_id;
 return public.app_custom_document_row(p_id);
end;$$;
create function public.app_custom_document_finish(p_id uuid,p_token_hash text,p_claim uuid,p_artifacts jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare i public.app_custom_document_issues;prefix text;w jsonb;p jsonb;v jsonb;
begin
 select * into i from public.app_custom_document_issues where id=p_id;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('app-workspace:'||i.clinic_id::text,0));
 select * into i from public.app_custom_document_issues where id=p_id for update;perform public.app_custom_document_public(p_id,p_token_hash);
 if i.status='received' then return public.app_custom_document_row(p_id);end if;
 if i.status<>'processing' or i.claim_id is distinct from p_claim then raise exception 'custom_claim_expired';end if;
 select state into w from public.app_workspaces where clinic_id=i.clinic_id;
 select x into p from jsonb_array_elements(coalesce(w->'patients','[]')) x where x->>'id'=i.patient_id;
 select x into v from jsonb_array_elements(coalesce(w->'visits','[]')) x where x->>'id'=i.visit_id;
 if not coalesce(public.app_workspace_document_identity(jsonb_build_object('identity',i.identity),p),false) or v is null or v->>'patientId'<>i.patient_id then raise exception 'custom_identity_mismatch';end if;
 if coalesce(v->>'lockedAt','')<>'' or v->>'status' in ('concluido','cancelado') then raise exception 'custom_visit_locked';end if;
 prefix:=i.clinic_id::text||'/'||i.id::text||'/';
 if p_artifacts->>'pdf_path' is distinct from prefix||'documento.pdf' or p_artifacts->>'signature_path' is distinct from prefix||'assinatura.json'
 or coalesce(p_artifacts->>'pdf_sha256','')!~'^[a-f0-9]{64}$' or coalesce(p_artifacts->>'signature_sha256','')!~'^[a-f0-9]{64}$' or coalesce(p_artifacts->>'registry_sha256','')!~'^[a-f0-9]{64}$' then raise exception 'custom_integrity_invalid';end if;
 insert into public.app_custom_document_receipts(issue_id,clinic_id,submit_operation_id,submission_hash,signed_at,pdf_path,signature_path,pdf_sha256,signature_sha256,registry_sha256)
 values(i.id,i.clinic_id,i.submit_operation_id,i.submission_hash,i.signed_at,p_artifacts->>'pdf_path',p_artifacts->>'signature_path',p_artifacts->>'pdf_sha256',p_artifacts->>'signature_sha256',p_artifacts->>'registry_sha256');
 update public.app_custom_document_issues set status='received',received_at=clock_timestamp(),claim_id=null,lease_until=null where id=p_id;return public.app_custom_document_row(p_id);
end;$$;
create function public.app_custom_document_release(p_id uuid,p_claim uuid) returns void language sql security definer set search_path='' as $$
 update public.app_custom_document_issues set claim_id=null,lease_until=null where id=p_id and claim_id=p_claim and status='processing';
$$;
create function public.app_custom_document_source(p_clinic uuid,p_actor uuid,p_session uuid,p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare i jsonb;s jsonb;prefix text;
begin
 i:=public.app_custom_document_issue(p_clinic,p_actor,p_session,p_id);if i is null then return null;end if;prefix:=p_clinic::text||'/'||p_id::text||'/';
 s:=jsonb_build_object('source_kind','custom_doc','source_id',p_id,'type','custom_doc','template_id',i->>'template_id','template_kind',i->>'kind','patient_id',i->>'patient_id','visit_id',i->>'visit_id','identity',i->'identity','status',case when i->>'received_at' is not null then 'recebido' else 'aguardando' end,'received_at',i->>'received_at','source_version',i->>'template_version','source_hash',i->>'snapshot_hash','signature_sha256',i->>'signature_sha256','pdf_sha256',i->>'pdf_sha256','registry_sha256',i->>'registry_sha256','bucket','app-custom-documents','pdf_path',i->>'pdf_path','signature_path',i->>'signature_path','storage_valid',coalesce(i->>'pdf_path'=prefix||'documento.pdf' and i->>'signature_path'=prefix||'assinatura.json' and i->>'received_at' is not null,false),'archived',false,'withdrawn',i->>'revoked_at' is not null);
 return s||jsonb_build_object('source_fingerprint',encode(sha256(convert_to(s::text,'UTF8')),'hex'));
end;$$;
create function public.app_custom_document_sources(p_clinic uuid,p_actor uuid,p_session uuid,p_patient text,p_visit text) returns jsonb language plpgsql security definer set search_path='' as $$
begin perform public.app_workspace_require_actor(p_clinic,p_actor,p_session);return coalesce((select jsonb_agg(public.app_custom_document_source(p_clinic,p_actor,p_session,id) order by issued_at desc) from public.app_custom_document_issues where clinic_id=p_clinic and patient_id=p_patient and visit_id=p_visit),'[]'::jsonb);end;$$;

-- Service-role RPCs only; definer privileges are narrowly fenced by actor or token.
do $$ declare f record;begin for f in select p.oid::regprocedure::text sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'app_custom_document_%' loop execute 'revoke all on function '||f.sig||' from public,anon,authenticated,service_role';if f.sig not like '%app_custom_document_row(%' then execute 'grant execute on function '||f.sig||' to service_role';end if;end loop;end;$$;
commit;
