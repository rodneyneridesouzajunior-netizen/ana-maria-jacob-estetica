begin;
-- Received originals only. No document is promoted to professional review or consent.
create table public.app_workspace_document_links (
 id uuid primary key, clinic_id uuid not null references public.clinics(id) on delete restrict,
 patient_id text not null, visit_id text not null, workspace_revision bigint not null check(workspace_revision>=1),
 anamnese_id uuid references public.anamneses(id) on delete restrict,
 documento_clinico_id uuid references public.documentos_clinicos(id) on delete restrict,
 source_kind text not null check(source_kind in ('anamnese','documento_clinico')), source_id uuid not null,
 source_fingerprint text not null check(source_fingerprint ~ '^[a-f0-9]{64}$'),
 source_snapshot jsonb not null check(jsonb_typeof(source_snapshot)='object'),
 fingerprint text not null check(fingerprint ~ '^[a-f0-9]{64}$'), reason text not null check(length(btrim(reason)) between 3 and 500),
 linked_by uuid not null references auth.users(id) on delete restrict, linked_at timestamptz not null default now(),
 status text not null default 'vinculado_recebido' check(status='vinculado_recebido'),
 clinical_authorization boolean not null default false check(not clinical_authorization),
 unique(clinic_id,id),unique(clinic_id,visit_id,source_kind,source_id),
 check((source_kind='anamnese' and anamnese_id=source_id and anamnese_id is not null and documento_clinico_id is null)
    or (source_kind='documento_clinico' and documento_clinico_id=source_id and documento_clinico_id is not null and anamnese_id is null))
);
create table public.app_workspace_document_events (
 id uuid primary key, clinic_id uuid not null, link_id uuid not null, actor_id uuid not null references auth.users(id),
 action text not null check(action='documento_recebido_vinculado'), created_at timestamptz not null default now(),
 foreign key(clinic_id,link_id) references public.app_workspace_document_links(clinic_id,id) on delete restrict
);
alter table public.app_workspace_document_links enable row level security;
alter table public.app_workspace_document_events enable row level security;
revoke all on public.app_workspace_document_links,public.app_workspace_document_events from public,anon,authenticated,service_role;
grant select,insert on public.app_workspace_document_links,public.app_workspace_document_events to service_role;
create index app_workspace_document_visit_idx on public.app_workspace_document_links(clinic_id,patient_id,visit_id);

create function public.app_workspace_document_cpf(p_value text) returns boolean language plpgsql immutable security invoker set search_path='' as $$
declare value text:=regexp_replace(coalesce(p_value,''),'[^0-9]','','g'); n int;i int;sum int;digit int;
begin
 if value !~ '^[0-9]{11}$' or value=repeat(substr(value,1,1),11) then return false;end if;
 for n in 9..10 loop sum:=0;for i in 1..n loop sum:=sum+substr(value,i,1)::int*(n+2-i);end loop;digit:=((sum*10)%11)%10;if digit<>substr(value,n+1,1)::int then return false;end if;end loop;return true;
end;$$;
create function public.app_workspace_document_name(p_value text) returns text language sql immutable security invoker set search_path='' as $$
 select btrim(regexp_replace(regexp_replace(translate(lower(coalesce(p_value,'')),'áàâãäéèêëíìîïóòôõöúùûüçñ','aaaaaeeeeiiiiooooouuuucn'),'[^a-z0-9 ]',' ','g'),'[[:space:]]+',' ','g'));
$$;
create function public.app_workspace_document_identity(p_source jsonb,p_patient jsonb) returns boolean language sql immutable security invoker set search_path='' as $$
 select p_patient is not null and public.app_workspace_document_cpf(p_patient->>'cpf')
 and regexp_replace(p_patient->>'cpf','[^0-9]','','g')=p_source#>>'{identity,cpf}'
 and length(public.app_workspace_document_name(p_patient->>'name'))>=2
 and public.app_workspace_document_name(p_patient->>'name')=public.app_workspace_document_name(p_source#>>'{identity,name}')
 and (coalesce(p_patient->>'birthDate','')='' or coalesce(p_source#>>'{identity,birth_date}','')='' or p_patient->>'birthDate'=p_source#>>'{identity,birth_date}');
$$;

-- Narrow privileged guard: no browser EXECUTE, no grant on legacy private data.
-- It uses the same advisory lock as BOTH deletion prepare and finish, and checks
-- the durable intent that exists while Storage deletion is outside a transaction.
create function private.app_workspace_document_delete_guard(p_clinic uuid,p_actor uuid,p_session uuid,p_kind text,p_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
 perform public.app_workspace_require_actor(p_clinic,p_actor,p_session);
 if not public.painel_validar_escopo_clinico_legado(p_clinic) then raise exception 'document_clinic_scope_invalid' using errcode='42501';end if;
 if p_kind is null or p_kind not in ('anamnese','documento_clinico') or p_id is null then raise exception 'document_source_invalid' using errcode='22023';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_clinic::text||':ficha_delete:'||p_kind||':'||p_id::text,0));
 if exists(select 1 from private.fichas_exclusao_intencoes where clinic_id=p_clinic and origem=p_kind and documento_id=p_id and expira_em>pg_catalog.clock_timestamp())
 or exists(select 1 from public.fichas_exclusao_tombstones where clinic_id=p_clinic and origem=p_kind and alvo_hmac=private.fichas_exclusao_hmac(p_clinic::text||':'||p_kind||':'||p_id::text)) then
  raise exception 'document_deletion_in_progress' using errcode='55000';
 end if;
end;$$;
revoke all on function private.app_workspace_document_delete_guard(uuid,uuid,uuid,text,uuid) from public,anon,authenticated,service_role;
grant usage on schema private to service_role;
grant execute on function private.app_workspace_document_delete_guard(uuid,uuid,uuid,text,uuid) to service_role;

create function public.app_workspace_document_source(p_clinic uuid,p_actor uuid,p_session uuid,p_kind text,p_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare r jsonb;s jsonb;slug text;prefix text;version text;type text;
begin
 perform public.app_workspace_require_actor(p_clinic,p_actor,p_session);
 if not public.painel_validar_escopo_clinico_legado(p_clinic) then raise exception 'document_clinic_scope_invalid' using errcode='42501';end if;
 if p_kind='anamnese' then select to_jsonb(a) into r from public.anamneses a where id=p_id;
 elsif p_kind='documento_clinico' then select to_jsonb(d) into r from public.documentos_clinicos d where id=p_id;
 else raise exception 'document_source_invalid' using errcode='22023';end if;
 if r is null then return null;end if;
 type:=case when p_kind='anamnese' then 'anamnese' else r->>'tipo' end;
 slug:=case type when 'tcle_toxina_botulinica' then 'tcle-toxina' when 'tcle_preenchimento_facial' then 'tcle-preenchimento' when 'tcle_intradermoterapia_estetica' then 'tcle-intradermoterapia' when 'tcle_bioestimulador_colageno' then 'tcle-bioestimulador' when 'tcle_peeling_quimico' then 'tcle-peeling-quimico' when 'tcle_fios_pdo' then 'tcle-fios-pdo' end;
 if type<>'anamnese' and slug is null then return null;end if;
 prefix:=case when p_kind='anamnese' then 'anamneses/'||p_id::text||'/' else slug||'/'||(r->>'idempotency_key')||'/' end;
 s:=jsonb_build_object('source_kind',p_kind,'source_id',p_id,'type',type,'status',r->>'status','source_version',coalesce(r->>'formulario_versao',r->>'versao_termo'),'source_hash',coalesce(r->>'formulario_sha256',r->>'termo_sha256'),
 'signature_sha256',r->>'assinatura_sha256','pdf_sha256',r->>'pdf_sha256','registry_sha256',r->>'registro_sha256','received_at',r->>'recebido_em','updated_at',r->>'updated_at',
 'archived',r->>'arquivado_em' is not null,'withdrawn',r->>'consentimento_retirado_em' is not null,
 'identity',jsonb_build_object('name',r->>'nome','cpf',regexp_replace(coalesce(r->>'cpf',''),'[^0-9]','','g'),'phone',r->>'telefone','birth_date',coalesce(r#>>'{dados,nascimento}',r#>>'{dados,identificacao,nascimento}')),
 'bucket',case when p_kind='anamnese' then 'fichas-pdf' else 'documentos-clinicos' end,'pdf_path',r->>'pdf_path','signature_path',r->>'assinatura_path',
 'storage_valid',coalesce((r->>'assinatura_path')=prefix||'assinatura.png' and (r->>'pdf_path')=prefix||case when p_kind='anamnese' then 'ficha.pdf' else 'documento.pdf' end,false));
 return s||jsonb_build_object('source_fingerprint',encode(sha256(convert_to(s::text,'UTF8')),'hex'));
end;$$;
create function public.app_workspace_documents_list(p_clinic uuid,p_actor uuid,p_session uuid,p_search text default '',p_limit int default 26,p_offset int default 0)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb:='[]'::jsonb;r record;s jsonb;
begin
 perform public.app_workspace_require_actor(p_clinic,p_actor,p_session);
 if not public.painel_validar_escopo_clinico_legado(p_clinic) then raise exception 'document_clinic_scope_invalid' using errcode='42501';end if;
 if p_limit is null or p_offset is null or p_limit not between 1 and 51 or p_offset not between 0 and 10000 or length(coalesce(p_search,''))>120 then raise exception 'document_filters_invalid' using errcode='22023';end if;
 for r in select * from (select 'anamnese'::text kind,id,nome,recebido_em from public.anamneses union all select 'documento_clinico',id,nome,recebido_em from public.documentos_clinicos) sources
 where coalesce(p_search,'')='' or strpos(public.app_workspace_document_name(nome),public.app_workspace_document_name(p_search))>0 order by recebido_em desc nulls last,kind,id limit p_limit offset p_offset loop
  s:=public.app_workspace_document_source(p_clinic,p_actor,p_session,r.kind,r.id);if s is not null then result:=result||jsonb_build_array(s);end if;
 end loop;return result;
end;$$;
create function public.app_workspace_document_operation(p_clinic uuid,p_actor uuid,p_session uuid,p_operation uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare l public.app_workspace_document_links;
begin
 perform public.app_workspace_require_actor(p_clinic,p_actor,p_session);
 if not public.painel_validar_escopo_clinico_legado(p_clinic) then raise exception 'document_clinic_scope_invalid' using errcode='42501';end if;
 select * into l from public.app_workspace_document_links where clinic_id=p_clinic and id=p_operation;
 if not found then return null;end if;
 return jsonb_build_object('fingerprint',l.fingerprint,'workspace_revision',l.workspace_revision,'link',to_jsonb(l)-array['fingerprint','anamnese_id','documento_clinico_id']);
end;$$;
create function public.app_workspace_document_links_list(p_clinic uuid,p_actor uuid,p_session uuid,p_patient text,p_visit text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb:='[]'::jsonb;l public.app_workspace_document_links;s jsonb;patient jsonb;state jsonb;matches boolean;available boolean;
begin
 perform public.app_workspace_require_actor(p_clinic,p_actor,p_session);
 if not public.painel_validar_escopo_clinico_legado(p_clinic) then raise exception 'document_clinic_scope_invalid' using errcode='42501';end if;
 select w.state into state from public.app_workspaces w where clinic_id=p_clinic;
 select x into patient from jsonb_array_elements(state->'patients') x where x->>'id'=p_patient;
 if patient is null or not exists(select 1 from jsonb_array_elements(state->'visits') x where x->>'id'=p_visit and x->>'patientId'=p_patient) then raise exception 'document_binding_invalid' using errcode='22023';end if;
 for l in select * from public.app_workspace_document_links where clinic_id=p_clinic and patient_id=p_patient and visit_id=p_visit order by linked_at,id loop
  s:=public.app_workspace_document_source(p_clinic,p_actor,p_session,l.source_kind,l.source_id);matches:=coalesce(public.app_workspace_document_identity(s,patient),false);
  available:=matches and s->>'status'='recebido' and not (s->>'archived')::boolean and not (s->>'withdrawn')::boolean and s->>'source_fingerprint'=l.source_fingerprint;
  result:=result||jsonb_build_array((to_jsonb(l)-array['fingerprint','anamnese_id','documento_clinico_id'])||jsonb_build_object('current_identity_matches',matches,'available',coalesce(available,false)));
 end loop;return result;
end;$$;
create function public.app_workspace_link_document(p_clinic uuid,p_actor uuid,p_session uuid,p_operation uuid,p_fingerprint text,p_expected bigint,p_patient text,p_visit text,p_kind text,p_id uuid,p_source_fingerprint text,p_reason text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare w public.app_workspaces;v jsonb;patient jsonb;s jsonb;prior jsonb;link public.app_workspace_document_links;snapshot jsonb;
begin
 perform public.app_workspace_require_actor(p_clinic,p_actor,p_session);
 if not public.painel_validar_escopo_clinico_legado(p_clinic) then raise exception 'document_clinic_scope_invalid' using errcode='42501';end if;
 if p_operation is null or coalesce(p_fingerprint,'') !~ '^[a-f0-9]{64}$' or coalesce(p_source_fingerprint,'') !~ '^[a-f0-9]{64}$' or p_expected is null or p_expected<1 or p_kind is null or p_kind not in ('anamnese','documento_clinico') or p_id is null or nullif(p_patient,'') is null or nullif(p_visit,'') is null or p_reason is null or length(btrim(p_reason)) not between 3 and 500 or p_reason ~ '[[:cntrl:]]' then raise exception 'document_link_invalid' using errcode='22023';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('app-workspace:'||p_clinic::text,0));
 prior:=public.app_workspace_document_operation(p_clinic,p_actor,p_session,p_operation);
 if prior is not null then if (prior->>'fingerprint') is distinct from p_fingerprint then raise exception 'operation_reused' using errcode='23505';end if;return (prior-'fingerprint')||jsonb_build_object('replayed',true);end if;
 select * into w from public.app_workspaces where clinic_id=p_clinic for update;
 if w.revision is distinct from p_expected then raise exception 'revision_conflict' using errcode='40001';end if;
 select x into patient from jsonb_array_elements(w.state->'patients') x where x->>'id'=p_patient;
 select x into v from jsonb_array_elements(w.state->'visits') x where x->>'id'=p_visit and x->>'patientId'=p_patient;
 if patient is null or v is null or v->>'status' in ('concluido','cancelado') or v->>'lockedAt' is not null then raise exception 'document_binding_invalid' using errcode='22023';end if;
 perform private.app_workspace_document_delete_guard(p_clinic,p_actor,p_session,p_kind,p_id);
 if p_kind='anamnese' then perform 1 from public.anamneses where id=p_id for update;else perform 1 from public.documentos_clinicos where id=p_id for update;end if;
 s:=public.app_workspace_document_source(p_clinic,p_actor,p_session,p_kind,p_id);
 if s is null then raise exception 'document_source_missing' using errcode='22023';end if;
 if (s->>'source_fingerprint') is distinct from p_source_fingerprint then raise exception 'document_source_changed' using errcode='40001';end if;
 if (s->>'status') is distinct from 'recebido' or (s->>'archived')::boolean or (s->>'withdrawn')::boolean or (s->>'storage_valid')::boolean is not true
 or coalesce(s->>'source_version','')='' or coalesce(s->>'source_hash','') !~ '^[a-f0-9]{64}$' or coalesce(s->>'signature_sha256','') !~ '^[a-f0-9]{64}$' or coalesce(s->>'pdf_sha256','') !~ '^[a-f0-9]{64}$' or coalesce(s->>'registry_sha256','') !~ '^[a-f0-9]{64}$' then raise exception 'document_source_unavailable' using errcode='22023';end if;
 if public.app_workspace_document_identity(s,patient) is not true then raise exception 'document_identity_mismatch' using errcode='22023';end if;
 snapshot:=(s-array['identity','bucket','pdf_path','signature_path'])||jsonb_build_object('title',s->>'type','identity',jsonb_build_object('name',s#>>'{identity,name}','cpf_masked','•••••••••'||right(s#>>'{identity,cpf}',2)));
 insert into public.app_workspace_document_links(id,clinic_id,patient_id,visit_id,workspace_revision,anamnese_id,documento_clinico_id,source_kind,source_id,source_fingerprint,source_snapshot,fingerprint,reason,linked_by)
 values(p_operation,p_clinic,p_patient,p_visit,w.revision,case when p_kind='anamnese' then p_id end,case when p_kind='documento_clinico' then p_id end,p_kind,p_id,p_source_fingerprint,snapshot,p_fingerprint,btrim(p_reason),p_actor) returning * into link;
 insert into public.app_workspace_document_events(id,clinic_id,link_id,actor_id,action) values(p_operation,p_clinic,p_operation,p_actor,'documento_recebido_vinculado');
 return jsonb_build_object('link',to_jsonb(link)-array['fingerprint','anamnese_id','documento_clinico_id'],'workspace_revision',w.revision,'replayed',false);
end;$$;

revoke all on function public.app_workspace_document_cpf(text),public.app_workspace_document_name(text),public.app_workspace_document_identity(jsonb,jsonb),public.app_workspace_document_source(uuid,uuid,uuid,text,uuid),public.app_workspace_documents_list(uuid,uuid,uuid,text,int,int),public.app_workspace_document_operation(uuid,uuid,uuid,uuid),public.app_workspace_document_links_list(uuid,uuid,uuid,text,text),public.app_workspace_link_document(uuid,uuid,uuid,uuid,text,bigint,text,text,text,uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.app_workspace_document_cpf(text),public.app_workspace_document_name(text),public.app_workspace_document_identity(jsonb,jsonb),public.app_workspace_document_source(uuid,uuid,uuid,text,uuid),public.app_workspace_documents_list(uuid,uuid,uuid,text,int,int),public.app_workspace_document_operation(uuid,uuid,uuid,uuid),public.app_workspace_document_links_list(uuid,uuid,uuid,text,text),public.app_workspace_link_document(uuid,uuid,uuid,uuid,text,bigint,text,text,text,uuid,text,text) to service_role;
comment on table public.app_workspace_document_links is 'Vinculo auditado a original recebido; nunca revisao profissional, assinatura ou autorizacao clinica. Sem copia de pacientes legados.';
commit;
