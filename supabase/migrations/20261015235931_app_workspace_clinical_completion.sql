begin;
-- Account assignment is administrative metadata. It is not verification of a
-- professional license, ICP-Brasil certificate, or permission for a procedure.
-- The connected workspace currently accepts owner accounts only. Do not offer
-- or activate professional-only accounts until the full access contract exists.
create table public.app_workspace_clinical_profiles (
 id uuid primary key,clinic_id uuid not null references public.clinics(id) on delete restrict,
 professional_id text not null,user_id uuid not null references auth.users(id) on delete restrict,
 professional_name text not null,professional_snapshot jsonb not null,
 version integer not null check(version>0),status text not null check(status in ('active','revoked')),
 reason text not null check(length(btrim(reason)) between 3 and 500),fingerprint text not null,
 configured_by uuid not null references auth.users(id),created_at timestamptz not null default now(),
 unique(clinic_id,professional_id,version),unique(clinic_id,id)
);
create table public.app_workspace_clinical_policies (
 id uuid primary key,clinic_id uuid not null references public.clinics(id) on delete restrict,
 procedure_id text not null,procedure_version integer not null,procedure_hash text not null check(procedure_hash ~ '^[a-f0-9]{64}$'),procedure_snapshot jsonb not null,
 requirements jsonb not null check(jsonb_typeof(requirements)='array'),
 version integer not null check(version>0),status text not null check(status in ('active','revoked')),
 reason text not null check(length(btrim(reason)) between 3 and 500),fingerprint text not null,
 configured_by uuid not null references auth.users(id),created_at timestamptz not null default now(),
 unique(clinic_id,procedure_id,procedure_version,version),unique(clinic_id,id)
);
create table public.app_workspace_clinical_signatures (
 id uuid primary key,clinic_id uuid not null references public.clinics(id) on delete restrict,
 patient_id text not null,visit_id text not null,actor_id uuid not null references auth.users(id) on delete restrict,
 profile_id uuid not null,policy_id uuid not null,workspace_revision bigint not null,
 review_hash text not null check(review_hash ~ '^[a-f0-9]{64}$'),state_hash text not null check(state_hash ~ '^[a-f0-9]{64}$'),
 declaration_version text not null,declaration text not null,documents jsonb not null,
 signature_method text not null default 'authenticated_session_mfa' check(signature_method='authenticated_session_mfa'),
 fingerprint text not null check(fingerprint ~ '^[a-f0-9]{64}$'),signed_at timestamptz not null default now(),
 unique(clinic_id,visit_id),unique(clinic_id,id),
 foreign key(clinic_id,profile_id) references public.app_workspace_clinical_profiles(clinic_id,id) on delete restrict,
 foreign key(clinic_id,policy_id) references public.app_workspace_clinical_policies(clinic_id,id) on delete restrict,
 foreign key(clinic_id,workspace_revision) references public.app_workspace_versions(clinic_id,revision) on delete restrict
);
alter table public.app_workspace_clinical_profiles enable row level security;
alter table public.app_workspace_clinical_policies enable row level security;
alter table public.app_workspace_clinical_signatures enable row level security;
revoke all on public.app_workspace_clinical_profiles,public.app_workspace_clinical_policies,public.app_workspace_clinical_signatures from public,anon,authenticated,service_role;
grant select,insert on public.app_workspace_clinical_profiles,public.app_workspace_clinical_policies,public.app_workspace_clinical_signatures to service_role;

create function public.app_workspace_clinical_settings(p_clinic uuid,p_actor uuid,p_session uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare members jsonb;profiles jsonb;policies jsonb;
begin
 perform public.app_workspace_require_actor(p_clinic,p_actor,p_session);
 select coalesce(jsonb_agg(jsonb_build_object('user_id',user_id,'display_name',display_name,'role',role) order by display_name,user_id),'[]') into members from public.clinic_members where clinic_id=p_clinic and status='active' and role='owner';
 select coalesce(jsonb_agg(to_jsonb(x)-'fingerprint'),'[]') into profiles from (select distinct on(professional_id) * from public.app_workspace_clinical_profiles where clinic_id=p_clinic order by professional_id,version desc) x;
 select coalesce(jsonb_agg(to_jsonb(x)-'fingerprint'),'[]') into policies from (select distinct on(procedure_id,procedure_version) * from public.app_workspace_clinical_policies where clinic_id=p_clinic order by procedure_id,procedure_version,version desc) x;
 return jsonb_build_object('members',members,'profiles',profiles,'policies',policies,'actor_id',p_actor);
end;$$;

create function public.app_workspace_configure_clinical_profile(p_clinic uuid,p_actor uuid,p_session uuid,p_operation uuid,p_professional text,p_member uuid,p_expected_version int,p_status text,p_reason text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare old public.app_workspace_clinical_profiles;prior public.app_workspace_clinical_profiles;fresh public.app_workspace_clinical_profiles;person jsonb;fp text;
begin
 perform public.app_workspace_require_actor(p_clinic,p_actor,p_session);
 if p_operation is null or nullif(p_professional,'') is null or p_member is null or p_expected_version is null or p_expected_version<0 or p_status is null or p_status not in ('active','revoked') or length(btrim(coalesce(p_reason,''))) not between 3 and 500 or p_reason ~ '[[:cntrl:]]' then raise exception 'clinical_configuration_invalid' using errcode='22023';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('app-workspace:'||p_clinic::text,0));
 fp:=md5(jsonb_build_array(p_professional,p_member,p_expected_version,p_status,btrim(p_reason))::text);
 select * into prior from public.app_workspace_clinical_profiles where clinic_id=p_clinic and id=p_operation;
 if found then if prior.fingerprint<>fp then raise exception 'operation_reused' using errcode='23505';end if;return (to_jsonb(prior)-'fingerprint')||jsonb_build_object('replayed',true);end if;
 select * into old from public.app_workspace_clinical_profiles where clinic_id=p_clinic and professional_id=p_professional order by version desc limit 1;
 if coalesce(old.version,0)<>p_expected_version then raise exception 'revision_conflict' using errcode='40001';end if;
 select x into person from public.app_workspaces w cross join lateral jsonb_array_elements(w.state#>'{clinic,professionals}') x where w.clinic_id=p_clinic and x->>'id'=p_professional;
 if person is null then raise exception 'clinical_professional_missing' using errcode='22023';end if;
 if p_status='active' and ((person->>'active')::boolean is not true or person->>'role'='secretaria' or (person->>'canAttend')::boolean is false or not exists(select 1 from public.clinic_members where clinic_id=p_clinic and user_id=p_member and status='active' and role='owner')) then raise exception 'clinical_professional_unavailable' using errcode='22023';end if;
 if p_status='revoked' and (old.id is null or old.user_id<>p_member) then raise exception 'clinical_configuration_invalid' using errcode='22023';end if;
 insert into public.app_workspace_clinical_profiles(id,clinic_id,professional_id,user_id,professional_name,professional_snapshot,version,status,reason,fingerprint,configured_by)
 values(p_operation,p_clinic,p_professional,p_member,person->>'name',person,coalesce(old.version,0)+1,p_status,btrim(p_reason),fp,p_actor) returning * into fresh;
 return (to_jsonb(fresh)-'fingerprint')||jsonb_build_object('replayed',false);
end;$$;

create function public.app_workspace_configure_clinical_policy(p_clinic uuid,p_actor uuid,p_session uuid,p_operation uuid,p_procedure text,p_procedure_version int,p_procedure_hash text,p_requirements jsonb,p_expected_version int,p_status text,p_reason text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare old public.app_workspace_clinical_policies;prior public.app_workspace_clinical_policies;fresh public.app_workspace_clinical_policies;procedure jsonb;state jsonb;required text[];r jsonb;template jsonb;fp text;
begin
 perform public.app_workspace_require_actor(p_clinic,p_actor,p_session);
 if p_operation is null or p_procedure_version is null or p_procedure_version<1 or p_procedure_hash is null or p_procedure_hash !~ '^[a-f0-9]{64}$' or p_requirements is null or jsonb_typeof(p_requirements)<>'array' or jsonb_array_length(p_requirements)>100 or p_expected_version is null or p_expected_version<0 or p_status is null or p_status not in ('active','revoked') or length(btrim(coalesce(p_reason,''))) not between 3 and 500 or p_reason ~ '[[:cntrl:]]' then raise exception 'clinical_configuration_invalid' using errcode='22023';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('app-workspace:'||p_clinic::text,0));
 fp:=md5(jsonb_build_array(p_procedure,p_procedure_version,p_procedure_hash,p_requirements,p_expected_version,p_status,btrim(p_reason))::text);
 select * into prior from public.app_workspace_clinical_policies where clinic_id=p_clinic and id=p_operation;
 if found then if prior.fingerprint<>fp then raise exception 'operation_reused' using errcode='23505';end if;return (to_jsonb(prior)-'fingerprint')||jsonb_build_object('replayed',true);end if;
 select * into old from public.app_workspace_clinical_policies where clinic_id=p_clinic and procedure_id=p_procedure and procedure_version=p_procedure_version order by version desc limit 1;
 if coalesce(old.version,0)<>p_expected_version then raise exception 'revision_conflict' using errcode='40001';end if;
 select w.state into state from public.app_workspaces w where clinic_id=p_clinic;
 select x into procedure from jsonb_array_elements(state->'procedures') x where x->>'id'=p_procedure and (x->>'version')::int=p_procedure_version;
 -- A historical version can only be configured from a preserved consultation.
 if procedure is null then select x->'procedureSnapshot' into procedure from jsonb_array_elements(state->'visits') x where x#>>'{procedureSnapshot,id}'=p_procedure and (x#>>'{procedureSnapshot,version}')::int=p_procedure_version limit 1;end if;
 if procedure is null then raise exception 'clinical_procedure_missing' using errcode='22023';end if;
 select coalesce(array_agg(distinct x),'{}') into required from (select jsonb_array_elements_text(coalesce(procedure->'requiredDocumentIds','[]')) x union select procedure->>'consentTemplateId' where nullif(procedure->>'consentTemplateId','') is not null) ids;
 if cardinality(required)<>jsonb_array_length(p_requirements) or (select count(distinct x->>'template_id') from jsonb_array_elements(p_requirements) x)<>cardinality(required) then raise exception 'clinical_policy_mismatch' using errcode='22023';end if;
 for r in select value from jsonb_array_elements(p_requirements) loop
  select x into template from jsonb_array_elements(state->'documentTemplates') x where x->>'id'=r->>'template_id';
  if not coalesce(r->>'template_id'=any(required),false) or r->>'source_type' is null or r->>'source_type' not in ('anamnese','tcle_toxina_botulinica','tcle_preenchimento_facial') or template is null or template->>'kind'='imagem' or (template->>'kind'='anamnese')<>(r->>'source_type'='anamnese') then raise exception 'clinical_policy_mismatch' using errcode='22023';end if;
 end loop;
 insert into public.app_workspace_clinical_policies(id,clinic_id,procedure_id,procedure_version,procedure_hash,procedure_snapshot,requirements,version,status,reason,fingerprint,configured_by)
 values(p_operation,p_clinic,p_procedure,p_procedure_version,p_procedure_hash,procedure,p_requirements,coalesce(old.version,0)+1,p_status,btrim(p_reason),fp,p_actor) returning * into fresh;
 return (to_jsonb(fresh)-'fingerprint')||jsonb_build_object('replayed',false);
end;$$;

create function public.app_workspace_clinical_configuration_operation(p_clinic uuid,p_actor uuid,p_session uuid,p_operation uuid,p_kind text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
 perform public.app_workspace_require_actor(p_clinic,p_actor,p_session);
 if p_operation is null or p_kind is null or p_kind not in ('profile','policy') then raise exception 'clinical_configuration_invalid' using errcode='22023';end if;
 if p_kind='profile' then select to_jsonb(x)-'fingerprint' into result from public.app_workspace_clinical_profiles x where clinic_id=p_clinic and id=p_operation;
 else select to_jsonb(x)-'fingerprint' into result from public.app_workspace_clinical_policies x where clinic_id=p_clinic and id=p_operation;end if;
 return result;
end;$$;

create function public.app_workspace_clinical_context(p_clinic uuid,p_actor uuid,p_session uuid,p_patient text,p_visit text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare w public.app_workspaces;v jsonb;profile jsonb;policy jsonb;
begin
 perform public.app_workspace_require_actor(p_clinic,p_actor,p_session);
 select * into w from public.app_workspaces where clinic_id=p_clinic;
 select x into v from jsonb_array_elements(w.state->'visits') x where x->>'id'=p_visit and x->>'patientId'=p_patient;
 if v is null then raise exception 'document_binding_invalid' using errcode='22023';end if;
 select to_jsonb(x)-'fingerprint' into profile from public.app_workspace_clinical_profiles x where clinic_id=p_clinic and professional_id=v->>'professionalId' order by version desc limit 1;
 select to_jsonb(x)-'fingerprint' into policy from public.app_workspace_clinical_policies x where clinic_id=p_clinic and procedure_id=v->>'procedureId' and procedure_version=(v->>'procedureVersion')::int order by version desc limit 1;
 return jsonb_build_object('workspace_revision',w.revision,'profile',profile,'policy',policy);
end;$$;

create function public.app_workspace_clinical_operation(p_clinic uuid,p_actor uuid,p_session uuid,p_operation uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare s public.app_workspace_clinical_signatures;w jsonb;
begin
 perform public.app_workspace_require_actor(p_clinic,p_actor,p_session);
 select * into s from public.app_workspace_clinical_signatures where clinic_id=p_clinic and id=p_operation;
 if not found then return null;end if;
 select to_jsonb(x) into w from public.app_workspace_versions x where clinic_id=p_clinic and revision=s.workspace_revision;
 return jsonb_build_object('signature',to_jsonb(s)-'fingerprint','fingerprint',s.fingerprint,'workspace',w);
end;$$;

create function public.app_workspace_complete_clinical(p_clinic uuid,p_actor uuid,p_session uuid,p_operation uuid,p_fingerprint text,p_expected bigint,p_patient text,p_visit text,p_profile uuid,p_policy uuid,p_documents jsonb,p_review_hash text,p_declaration_version text,p_declaration text,p_state jsonb,p_state_hash text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare w public.app_workspaces;v jsonb;finished jsonb;patient jsonb;person jsonb;profile public.app_workspace_clinical_profiles;policy public.app_workspace_clinical_policies;prior jsonb;receipt jsonb;signature public.app_workspace_clinical_signatures;d jsonb;r jsonb;l public.app_workspace_document_links;s jsonb;
begin
 perform public.app_workspace_require_actor(p_clinic,p_actor,p_session);
 if p_operation is null or p_fingerprint is null or p_fingerprint !~ '^[a-f0-9]{64}$' or p_review_hash is null or p_review_hash !~ '^[a-f0-9]{64}$' or p_declaration_version is distinct from 'amj-clinical-review-2026-10-15-v1' or p_declaration is null or length(p_declaration) not between 100 and 2000 or p_expected is null or p_expected<1 or p_documents is null or jsonb_typeof(p_documents)<>'array' then raise exception 'clinical_completion_invalid' using errcode='22023';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('app-workspace:'||p_clinic::text,0));
 prior:=public.app_workspace_clinical_operation(p_clinic,p_actor,p_session,p_operation);
 if prior is not null then if prior->>'fingerprint'<>p_fingerprint then raise exception 'operation_reused' using errcode='23505';end if;return (prior-'fingerprint')||jsonb_build_object('replayed',true);end if;
 select * into w from public.app_workspaces where clinic_id=p_clinic for update;
 if w.revision is distinct from p_expected then raise exception 'revision_conflict' using errcode='40001';end if;
 select x into patient from jsonb_array_elements(w.state->'patients') x where x->>'id'=p_patient;
 select x into v from jsonb_array_elements(w.state->'visits') x where x->>'id'=p_visit and x->>'patientId'=p_patient;
 select x into finished from jsonb_array_elements(p_state->'visits') x where x->>'id'=p_visit and x->>'patientId'=p_patient;
 if patient is null or v is null or v->>'status' in ('cancelado','concluido') or v->>'lockedAt' is not null or finished->>'status' is distinct from 'concluido' or finished->>'completionOperationId' is distinct from p_operation::text or finished->'procedureSnapshot' is distinct from v->'procedureSnapshot' then raise exception 'clinical_completion_invalid' using errcode='22023';end if;
 select * into profile from public.app_workspace_clinical_profiles where clinic_id=p_clinic and professional_id=v->>'professionalId' order by version desc limit 1;
 select x into person from jsonb_array_elements(w.state#>'{clinic,professionals}') x where x->>'id'=v->>'professionalId';
 if profile.id is distinct from p_profile or profile.status is distinct from 'active' or profile.user_id is distinct from p_actor or person is distinct from profile.professional_snapshot or not exists(select 1 from public.clinic_members where clinic_id=p_clinic and user_id=p_actor and status='active' and role='owner') then raise exception 'clinical_professional_changed' using errcode='42501';end if;
 select * into policy from public.app_workspace_clinical_policies where clinic_id=p_clinic and procedure_id=v->>'procedureId' and procedure_version=(v->>'procedureVersion')::int order by version desc limit 1;
 if policy.id is distinct from p_policy or policy.status is distinct from 'active' or policy.procedure_snapshot is distinct from v->'procedureSnapshot' then raise exception 'clinical_policy_changed' using errcode='40001';end if;
 if jsonb_array_length(p_documents)<>jsonb_array_length(policy.requirements) or (select count(distinct x->>'template_id') from jsonb_array_elements(p_documents) x)<>jsonb_array_length(policy.requirements) then raise exception 'clinical_documents_incomplete' using errcode='22023';end if;
 for r in select value from jsonb_array_elements(policy.requirements) order by value->>'template_id' loop
  select value into d from jsonb_array_elements(p_documents) where value->>'template_id'=r->>'template_id';
  select * into l from public.app_workspace_document_links where clinic_id=p_clinic and id=(d->>'link_id')::uuid and patient_id=p_patient and visit_id=p_visit;
  if l.id is null or d->>'source_type' is distinct from r->>'source_type' or d->>'source_id' is distinct from l.source_id::text or d->>'source_kind' is distinct from l.source_kind then raise exception 'clinical_documents_incomplete' using errcode='22023';end if;
  perform private.app_workspace_document_delete_guard(p_clinic,p_actor,p_session,l.source_kind,l.source_id);
  if l.source_kind='anamnese' then perform 1 from public.anamneses where id=l.source_id for update;else perform 1 from public.documentos_clinicos where id=l.source_id for update;end if;
  s:=public.app_workspace_document_source(p_clinic,p_actor,p_session,l.source_kind,l.source_id);
  if s is null or s->>'source_fingerprint' is distinct from l.source_fingerprint or s->>'source_fingerprint' is distinct from d->>'source_fingerprint' or s->>'type' is distinct from r->>'source_type' or s->>'status' is distinct from 'recebido' or (s->>'archived')::boolean or (s->>'withdrawn')::boolean or (s->>'storage_valid')::boolean is not true or public.app_workspace_document_identity(s,patient) is not true then raise exception 'clinical_document_changed' using errcode='40001';end if;
  if coalesce(s->>'source_version','')='' or coalesce(s->>'source_hash','') !~ '^[a-f0-9]{64}$' or coalesce(s->>'signature_sha256','') !~ '^[a-f0-9]{64}$' or coalesce(s->>'pdf_sha256','') !~ '^[a-f0-9]{64}$' or coalesce(s->>'registry_sha256','') !~ '^[a-f0-9]{64}$' or s->>'source_version' is distinct from d->>'source_version' or s->>'pdf_sha256' is distinct from d->>'pdf_sha256' or s->>'signature_sha256' is distinct from d->>'signature_sha256' then raise exception 'clinical_document_changed' using errcode='40001';end if;
 end loop;
 receipt:=public.app_workspace_commit(p_clinic,p_actor,p_session,p_operation,p_fingerprint,p_expected,p_state,p_state_hash);
 insert into public.app_workspace_clinical_signatures(id,clinic_id,patient_id,visit_id,actor_id,profile_id,policy_id,workspace_revision,review_hash,state_hash,declaration_version,declaration,documents,fingerprint)
 values(p_operation,p_clinic,p_patient,p_visit,p_actor,p_profile,p_policy,(receipt->>'revision')::bigint,p_review_hash,p_state_hash,p_declaration_version,p_declaration,p_documents,p_fingerprint) returning * into signature;
 return jsonb_build_object('workspace',receipt,'signature',to_jsonb(signature)-'fingerprint','replayed',false);
end;$$;

revoke all on function public.app_workspace_clinical_settings(uuid,uuid,uuid),public.app_workspace_configure_clinical_profile(uuid,uuid,uuid,uuid,text,uuid,int,text,text),public.app_workspace_configure_clinical_policy(uuid,uuid,uuid,uuid,text,int,text,jsonb,int,text,text),public.app_workspace_clinical_context(uuid,uuid,uuid,text,text),public.app_workspace_clinical_operation(uuid,uuid,uuid,uuid),public.app_workspace_complete_clinical(uuid,uuid,uuid,uuid,text,bigint,text,text,uuid,uuid,jsonb,text,text,text,jsonb,text) from public,anon,authenticated,service_role;
grant execute on function public.app_workspace_clinical_settings(uuid,uuid,uuid),public.app_workspace_configure_clinical_profile(uuid,uuid,uuid,uuid,text,uuid,int,text,text),public.app_workspace_configure_clinical_policy(uuid,uuid,uuid,uuid,text,int,text,jsonb,int,text,text),public.app_workspace_clinical_context(uuid,uuid,uuid,text,text),public.app_workspace_clinical_operation(uuid,uuid,uuid,uuid),public.app_workspace_complete_clinical(uuid,uuid,uuid,uuid,text,bigint,text,text,uuid,uuid,jsonb,text,text,text,jsonb,text) to service_role;
revoke all on function public.app_workspace_clinical_configuration_operation(uuid,uuid,uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.app_workspace_clinical_configuration_operation(uuid,uuid,uuid,uuid,text) to service_role;
comment on table public.app_workspace_clinical_signatures is 'Declaracao pessoal autenticada por sessao e MFA; nao representa certificado ICP-Brasil, biometria ou verificacao de habilitacao profissional.';
commit;
