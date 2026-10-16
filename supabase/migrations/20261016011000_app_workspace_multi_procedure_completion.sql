begin;
-- Additive multi-procedure execution. Historical conclusions and policies remain intact.
alter table public.app_workspace_clinical_signatures add column policy_ids uuid[];
create function public.app_workspace_visit_procedures(p_visit jsonb)
returns jsonb language plpgsql immutable security invoker set search_path='' as $$
declare result jsonb;begin
 select coalesce(jsonb_agg(x order by x->>'id',(x->>'version')::int),'[]') into result from (
  select p_visit->'procedureSnapshot' x where jsonb_typeof(p_visit->'procedureSnapshot')='object'
  union select point->'procedureSnapshot' from jsonb_each(coalesce(p_visit->'maps','{}')) m cross join lateral jsonb_array_elements(coalesce(m.value->'points','[]')) point where jsonb_typeof(point->'procedureSnapshot')='object'
 ) snapshots;
 if (select count(distinct x->>'id') from jsonb_array_elements(result) x)<>jsonb_array_length(result) then raise exception 'clinical_procedure_versions_conflict' using errcode='22023';end if;
 return result;
end;$$;
revoke all on function public.app_workspace_visit_procedures(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.app_workspace_visit_procedures(jsonb) to service_role;
create function public.app_workspace_clinical_lock_custom(p_clinic uuid,p_actor uuid,p_session uuid,p_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin perform public.app_workspace_require_actor(p_clinic,p_actor,p_session);perform 1 from public.app_custom_document_issues where clinic_id=p_clinic and id=p_id for update;end;$$;
revoke all on function public.app_workspace_clinical_lock_custom(uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.app_workspace_clinical_lock_custom(uuid,uuid,uuid,uuid) to service_role;
create or replace function public.app_workspace_configure_clinical_policy(p_clinic uuid,p_actor uuid,p_session uuid,p_operation uuid,p_procedure text,p_procedure_version int,p_procedure_hash text,p_requirements jsonb,p_expected_version int,p_status text,p_reason text)
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
 if procedure is null then select p into procedure from jsonb_array_elements(state->'visits') v cross join lateral jsonb_array_elements(public.app_workspace_visit_procedures(v)) p where p->>'id'=p_procedure and (p->>'version')::int=p_procedure_version limit 1;end if;
 if procedure is null then raise exception 'clinical_procedure_missing' using errcode='22023';end if;
 select coalesce(array_agg(distinct x),'{}') into required from (select jsonb_array_elements_text(coalesce(procedure->'requiredDocumentIds','[]')) x union select procedure->>'consentTemplateId' where nullif(procedure->>'consentTemplateId','') is not null) ids;
 if cardinality(required)<>jsonb_array_length(p_requirements) or (select count(distinct x->>'template_id') from jsonb_array_elements(p_requirements) x)<>cardinality(required) then raise exception 'clinical_policy_mismatch' using errcode='22023';end if;
 for r in select value from jsonb_array_elements(p_requirements) loop
  select x into template from jsonb_array_elements(state->'documentTemplates') x where x->>'id'=r->>'template_id';
  if not coalesce(r->>'template_id'=any(required),false) or r->>'source_type' is null or r->>'source_type' not in ('anamnese','tcle_toxina_botulinica','tcle_preenchimento_facial','custom_doc') or template is null or template->>'kind'='imagem' or r->>'source_type'<>'custom_doc' and (template->>'kind'='anamnese')<>(r->>'source_type'='anamnese') then raise exception 'clinical_policy_mismatch' using errcode='22023';end if;
 end loop;
 insert into public.app_workspace_clinical_policies(id,clinic_id,procedure_id,procedure_version,procedure_hash,procedure_snapshot,requirements,version,status,reason,fingerprint,configured_by)
 values(p_operation,p_clinic,p_procedure,p_procedure_version,p_procedure_hash,procedure,p_requirements,coalesce(old.version,0)+1,p_status,btrim(p_reason),fp,p_actor) returning * into fresh;
 return (to_jsonb(fresh)-'fingerprint')||jsonb_build_object('replayed',false);
end;$$;

create or replace function public.app_workspace_clinical_context(p_clinic uuid,p_actor uuid,p_session uuid,p_patient text,p_visit text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare w public.app_workspaces;v jsonb;profile jsonb;policy jsonb;policies jsonb;
begin
 perform public.app_workspace_require_actor(p_clinic,p_actor,p_session);
 select * into w from public.app_workspaces where clinic_id=p_clinic;
 select x into v from jsonb_array_elements(w.state->'visits') x where x->>'id'=p_visit and x->>'patientId'=p_patient;
 if v is null then raise exception 'document_binding_invalid' using errcode='22023';end if;
 select to_jsonb(x)-'fingerprint' into profile from public.app_workspace_clinical_profiles x where clinic_id=p_clinic and professional_id=v->>'professionalId' order by version desc limit 1;
 select coalesce(jsonb_agg(to_jsonb(p)-'fingerprint' order by p.procedure_id,p.procedure_version),'[]') into policies from jsonb_array_elements(public.app_workspace_visit_procedures(v)) x cross join lateral (select * from public.app_workspace_clinical_policies where clinic_id=p_clinic and procedure_id=x->>'id' and procedure_version=(x->>'version')::int order by version desc limit 1) p;
 select x into policy from jsonb_array_elements(policies) x where x->>'procedure_id'=v->>'procedureId' and (x->>'procedure_version')::int=(v->>'procedureVersion')::int;
 return jsonb_build_object('workspace_revision',w.revision,'profile',profile,'policy',policy,'policies',policies);
end;$$;
drop function public.app_workspace_complete_clinical(uuid,uuid,uuid,uuid,text,bigint,text,text,uuid,uuid,jsonb,text,text,text,jsonb,text);
create function public.app_workspace_complete_clinical(p_clinic uuid,p_actor uuid,p_session uuid,p_operation uuid,p_fingerprint text,p_expected bigint,p_patient text,p_visit text,p_profile uuid,p_policy uuid,p_documents jsonb,p_review_hash text,p_declaration_version text,p_declaration text,p_state jsonb,p_state_hash text,p_policy_ids uuid[])
returns jsonb language plpgsql security invoker set search_path='' as $$
declare w public.app_workspaces;v jsonb;finished jsonb;patient jsonb;person jsonb;profile public.app_workspace_clinical_profiles;policy public.app_workspace_clinical_policies;prior jsonb;receipt jsonb;signature public.app_workspace_clinical_signatures;d jsonb;r jsonb;l public.app_workspace_document_links;s jsonb;proc jsonb;requirements jsonb:='[]';requirement jsonb;policies uuid[]:='{}';template jsonb;
begin
 perform public.app_workspace_require_actor(p_clinic,p_actor,p_session);
 if p_operation is null or p_fingerprint is null or p_fingerprint !~ '^[a-f0-9]{64}$' or p_review_hash is null or p_review_hash !~ '^[a-f0-9]{64}$' or p_declaration_version is distinct from 'amj-clinical-review-2026-10-15-v1' or p_declaration is null or length(p_declaration) not between 100 and 2000 or p_expected is null or p_expected<1 or p_policy_ids is null or cardinality(p_policy_ids)<1 or p_documents is null or jsonb_typeof(p_documents)<>'array' then raise exception 'clinical_completion_invalid' using errcode='22023';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('app-workspace:'||p_clinic::text,0));
 prior:=public.app_workspace_clinical_operation(p_clinic,p_actor,p_session,p_operation);
 if prior is not null then if prior->>'fingerprint'<>p_fingerprint then raise exception 'operation_reused' using errcode='23505';end if;return (prior-'fingerprint')||jsonb_build_object('replayed',true);end if;
 select * into w from public.app_workspaces where clinic_id=p_clinic for update;
 if w.revision is distinct from p_expected then raise exception 'revision_conflict' using errcode='40001';end if;
 select x into patient from jsonb_array_elements(w.state->'patients') x where x->>'id'=p_patient;
 select x into v from jsonb_array_elements(w.state->'visits') x where x->>'id'=p_visit and x->>'patientId'=p_patient;
 select x into finished from jsonb_array_elements(p_state->'visits') x where x->>'id'=p_visit and x->>'patientId'=p_patient;
 if patient is null or v is null or v->>'status' in ('cancelado','concluido') or v->>'lockedAt' is not null or finished->>'status' is distinct from 'concluido' or finished->>'completionOperationId' is distinct from p_operation::text or finished->'procedureSnapshot' is distinct from v->'procedureSnapshot' or finished->'maps' is distinct from v->'maps' or finished->'photos' is distinct from v->'photos' then raise exception 'clinical_completion_invalid' using errcode='22023';end if;
 select * into profile from public.app_workspace_clinical_profiles where clinic_id=p_clinic and professional_id=v->>'professionalId' order by version desc limit 1;
 select x into person from jsonb_array_elements(w.state#>'{clinic,professionals}') x where x->>'id'=v->>'professionalId';
 if profile.id is distinct from p_profile or profile.status is distinct from 'active' or profile.user_id is distinct from p_actor or person is distinct from profile.professional_snapshot or not exists(select 1 from public.clinic_members where clinic_id=p_clinic and user_id=p_actor and status='active' and role='owner') then raise exception 'clinical_professional_changed' using errcode='42501';end if;
 for proc in select value from jsonb_array_elements(public.app_workspace_visit_procedures(v)) order by value->>'id' loop
  select * into policy from public.app_workspace_clinical_policies where clinic_id=p_clinic and procedure_id=proc->>'id' and procedure_version=(proc->>'version')::int order by version desc limit 1;
  if policy.id is null or policy.status is distinct from 'active' or policy.procedure_snapshot is distinct from proc or not coalesce(policy.id=any(p_policy_ids),false) or proc->>'id'=v->>'procedureId' and policy.id is distinct from p_policy then raise exception 'clinical_policy_changed' using errcode='40001';end if;
  policies:=array_append(policies,policy.id);
  for r in select value from jsonb_array_elements(policy.requirements) loop
   select value into requirement from jsonb_array_elements(requirements) where value->>'template_id'=r->>'template_id';
   if requirement is not null and requirement is distinct from r then raise exception 'clinical_policy_mismatch' using errcode='22023';end if;
   if requirement is null then requirements:=requirements||jsonb_build_array(r);end if;
  end loop;
 end loop;
 if cardinality(policies)<>cardinality(p_policy_ids) or (select count(distinct x) from unnest(p_policy_ids) x)<>cardinality(policies) then raise exception 'clinical_policy_changed' using errcode='40001';end if;
 if not exists(select 1 from jsonb_array_elements(requirements) req join jsonb_array_elements(w.state->'documentTemplates') tpl on tpl->>'id'=req->>'template_id' where tpl->>'kind'='anamnese') then requirements:=requirements||jsonb_build_array(jsonb_build_object('template_id','@anamnese-universal','source_type','anamnese','universal',true));end if;
 if jsonb_array_length(p_documents)<>jsonb_array_length(requirements) or (select count(distinct x->>'template_id') from jsonb_array_elements(p_documents) x)<>jsonb_array_length(requirements) then raise exception 'clinical_documents_incomplete' using errcode='22023';end if;
 for r in select value from jsonb_array_elements(requirements) order by value->>'template_id' loop
  select value into d from jsonb_array_elements(p_documents) where value->>'template_id'=r->>'template_id';
  if d->>'source_kind'='custom_doc' then
   if r->>'source_type'<>'custom_doc' and not coalesce((r->>'universal')::boolean,false) then raise exception 'clinical_documents_incomplete' using errcode='22023';end if;
   perform public.app_workspace_clinical_lock_custom(p_clinic,p_actor,p_session,(d->>'source_id')::uuid);
   s:=public.app_custom_document_source(p_clinic,p_actor,p_session,(d->>'source_id')::uuid);
   select x into template from jsonb_array_elements(w.state->'documentTemplates') x where x->>'id'=s->>'template_id';
   if s is null or s->>'patient_id' is distinct from p_patient or s->>'visit_id' is distinct from p_visit or s->>'type' is distinct from 'custom_doc' or d->>'source_type' is distinct from 'custom_doc' or template is null or s->>'template_kind' is distinct from template->>'kind' or template->>'kind' not in ('anamnese','termo') or coalesce((r->>'universal')::boolean,false) and template->>'kind'<>'anamnese' or not coalesce((r->>'universal')::boolean,false) and s->>'template_id' is distinct from r->>'template_id' then raise exception 'clinical_documents_incomplete' using errcode='22023';end if;
  else
   select * into l from public.app_workspace_document_links where clinic_id=p_clinic and id=(d->>'link_id')::uuid and patient_id=p_patient and visit_id=p_visit;
   if l.id is null or d->>'source_type' is distinct from r->>'source_type' or d->>'source_id' is distinct from l.source_id::text or d->>'source_kind' is distinct from l.source_kind then raise exception 'clinical_documents_incomplete' using errcode='22023';end if;
   perform private.app_workspace_document_delete_guard(p_clinic,p_actor,p_session,l.source_kind,l.source_id);
   if l.source_kind='anamnese' then perform 1 from public.anamneses where id=l.source_id for update;else perform 1 from public.documentos_clinicos where id=l.source_id for update;end if;
   s:=public.app_workspace_document_source(p_clinic,p_actor,p_session,l.source_kind,l.source_id);
   if s->>'source_fingerprint' is distinct from l.source_fingerprint or s->>'type' is distinct from r->>'source_type' then raise exception 'clinical_document_changed' using errcode='40001';end if;
  end if;
  if s is null or s->>'source_fingerprint' is distinct from d->>'source_fingerprint' or s->>'status' is distinct from 'recebido' or (s->>'archived')::boolean or (s->>'withdrawn')::boolean or (s->>'storage_valid')::boolean is not true or public.app_workspace_document_identity(s,patient) is not true then raise exception 'clinical_document_changed' using errcode='40001';end if;
  if coalesce(s->>'source_version','')='' or coalesce(s->>'source_hash','') !~ '^[a-f0-9]{64}$' or coalesce(s->>'signature_sha256','') !~ '^[a-f0-9]{64}$' or coalesce(s->>'pdf_sha256','') !~ '^[a-f0-9]{64}$' or coalesce(s->>'registry_sha256','') !~ '^[a-f0-9]{64}$' or s->>'source_version' is distinct from d->>'source_version' or s->>'pdf_sha256' is distinct from d->>'pdf_sha256' or s->>'signature_sha256' is distinct from d->>'signature_sha256' then raise exception 'clinical_document_changed' using errcode='40001';end if;
 end loop;
 receipt:=public.app_workspace_commit(p_clinic,p_actor,p_session,p_operation,p_fingerprint,p_expected,p_state,p_state_hash);
 insert into public.app_workspace_clinical_signatures(id,clinic_id,patient_id,visit_id,actor_id,profile_id,policy_id,policy_ids,workspace_revision,review_hash,state_hash,declaration_version,declaration,documents,fingerprint)
 values(p_operation,p_clinic,p_patient,p_visit,p_actor,p_profile,p_policy,policies,(receipt->>'revision')::bigint,p_review_hash,p_state_hash,p_declaration_version,p_declaration,p_documents,p_fingerprint) returning * into signature;
 return jsonb_build_object('workspace',receipt,'signature',to_jsonb(signature)-'fingerprint','replayed',false);
end;$$;

revoke all on function public.app_workspace_complete_clinical(uuid,uuid,uuid,uuid,text,bigint,text,text,uuid,uuid,jsonb,text,text,text,jsonb,text,uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.app_workspace_complete_clinical(uuid,uuid,uuid,uuid,text,bigint,text,text,uuid,uuid,jsonb,text,text,text,jsonb,text,uuid[]) to service_role;
commit;
