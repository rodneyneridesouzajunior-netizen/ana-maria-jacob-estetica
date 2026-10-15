-- New namespace only: no writes/conversion of legacy patients, protocols or finance.
create table public.app_workspaces (
 clinic_id uuid primary key references public.clinics(id) on delete restrict,
 schema_version integer not null default 1 check(schema_version=1),
 revision bigint not null check(revision>=1),
 state jsonb not null check(jsonb_typeof(state)='object' and octet_length(state::text)<=5000000),
 state_hash text not null check(state_hash ~ '^[a-f0-9]{64}$'),
 updated_by uuid not null references auth.users(id) on delete restrict,
 updated_at timestamptz not null default now(),
 check((state->>'schema')::integer=1 and (state->>'revision')::bigint=revision)
);
create table public.app_workspace_versions (
 clinic_id uuid not null references public.clinics(id) on delete restrict,
 revision bigint not null, state jsonb not null, state_hash text not null,
 actor_id uuid not null references auth.users(id) on delete restrict,
 operation_id uuid not null, created_at timestamptz not null default now(),
 primary key(clinic_id,revision),unique(clinic_id,operation_id)
);
create table public.app_workspace_operations (
 clinic_id uuid not null references public.clinics(id) on delete restrict,
 operation_id uuid not null,actor_id uuid not null references auth.users(id) on delete restrict,
 kind text not null check(kind in ('commit','upload')),
 fingerprint text not null check(fingerprint ~ '^[a-f0-9]{64}$'),
 status text not null check(status in ('pending','committed')),
 revision bigint,photo_id text,created_at timestamptz not null default now(),
 primary key(clinic_id,operation_id)
);
create table public.app_workspace_photos (
 clinic_id uuid not null references public.clinics(id) on delete restrict,
 id text not null check(id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,179}$'),
 patient_id text not null,visit_id text not null,
 operation_id uuid not null,status text not null default 'pending' check(status in ('pending','ready')),
 metadata jsonb not null,created_by uuid not null references auth.users(id) on delete restrict,
 created_at timestamptz not null default now(),
 primary key(clinic_id,id),unique(clinic_id,operation_id),
 foreign key(clinic_id,operation_id) references public.app_workspace_operations(clinic_id,operation_id)
);
alter table public.app_workspaces enable row level security;
alter table public.app_workspace_versions enable row level security;
alter table public.app_workspace_operations enable row level security;
alter table public.app_workspace_photos enable row level security;
revoke all on public.app_workspaces,public.app_workspace_versions,public.app_workspace_operations,public.app_workspace_photos from public,anon,authenticated,service_role;
grant select,insert,update on public.app_workspaces to service_role;
grant select,insert on public.app_workspace_operations,public.app_workspace_photos to service_role;
grant update(status) on public.app_workspace_operations,public.app_workspace_photos to service_role;
grant select,insert on public.app_workspace_versions to service_role;

create or replace function public.app_workspace_require_actor(p_clinic uuid,p_actor uuid,p_session uuid)
returns void language plpgsql security invoker set search_path=pg_catalog,public as $$
begin
 if not exists(select 1 from public.clinic_members where clinic_id=p_clinic and user_id=p_actor and role='owner' and status='active') or not public.clinic_validate_auth_session(p_actor,p_session) then
  raise exception 'workspace_access_denied' using errcode='42501';
 end if;
end;$$;

create or replace function public.app_workspace_commit(p_clinic uuid,p_actor uuid,p_session uuid,p_operation uuid,p_fingerprint text,p_expected bigint,p_state jsonb,p_state_hash text)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare w public.app_workspaces; op public.app_workspace_operations; ver public.app_workspace_versions; target bigint;
begin
 perform public.app_workspace_require_actor(p_clinic,p_actor,p_session);
 perform pg_advisory_xact_lock(hashtextextended('app-workspace:'||p_clinic::text,0));
 select * into op from public.app_workspace_operations where clinic_id=p_clinic and operation_id=p_operation;
 if found then
  if op.kind<>'commit' or op.fingerprint<>p_fingerprint then raise exception 'operation_reused' using errcode='23505';end if;
  select * into ver from public.app_workspace_versions where clinic_id=p_clinic and revision=op.revision;
  return jsonb_build_object('replayed',true,'revision',ver.revision,'state',ver.state,'state_hash',ver.state_hash,'updated_at',ver.created_at);
 end if;
 select * into w from public.app_workspaces where clinic_id=p_clinic for update;
 if coalesce(w.revision,0)<>p_expected then raise exception 'revision_conflict' using errcode='40001';end if;
 target=p_expected+1;
 if p_expected<0 or p_state->>'schema'<>'1' or (p_state->>'revision')::bigint<>target or jsonb_typeof(p_state)<>'object' or octet_length(p_state::text)>5000000 or p_state_hash !~ '^[a-f0-9]{64}$' then raise exception 'invalid_workspace_state' using errcode='22023';end if;
 insert into public.app_workspaces(clinic_id,revision,state,state_hash,updated_by) values(p_clinic,target,p_state,p_state_hash,p_actor)
 on conflict(clinic_id) do update set revision=excluded.revision,state=excluded.state,state_hash=excluded.state_hash,updated_by=excluded.updated_by,updated_at=now();
 insert into public.app_workspace_versions(clinic_id,revision,state,state_hash,actor_id,operation_id) values(p_clinic,target,p_state,p_state_hash,p_actor,p_operation);
 insert into public.app_workspace_operations(clinic_id,operation_id,actor_id,kind,fingerprint,status,revision) values(p_clinic,p_operation,p_actor,'commit',p_fingerprint,'committed',target);
 return jsonb_build_object('replayed',false,'revision',target,'state',p_state,'state_hash',p_state_hash,'updated_at',now());
end;$$;

create or replace function public.app_workspace_photo_reserve(p_clinic uuid,p_actor uuid,p_session uuid,p_operation uuid,p_fingerprint text,p_expected bigint,p_photo text,p_patient text,p_visit text,p_metadata jsonb)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare w public.app_workspaces; op public.app_workspace_operations; ph public.app_workspace_photos; v jsonb;
begin
 perform public.app_workspace_require_actor(p_clinic,p_actor,p_session);
 perform pg_advisory_xact_lock(hashtextextended('app-workspace:'||p_clinic::text,0));
 select * into op from public.app_workspace_operations where clinic_id=p_clinic and operation_id=p_operation;
 if found then
  if op.kind<>'upload' or op.fingerprint<>p_fingerprint then raise exception 'operation_reused' using errcode='23505';end if;
  select * into ph from public.app_workspace_photos where clinic_id=p_clinic and id=op.photo_id;
  return to_jsonb(ph);
 end if;
 select * into w from public.app_workspaces where clinic_id=p_clinic for update;
 if coalesce(w.revision,0)<>p_expected then raise exception 'revision_conflict' using errcode='40001';end if;
 select x into v from jsonb_array_elements(w.state->'visits') x where x->>'id'=p_visit and x->>'patientId'=p_patient;
 if v is null or v->>'status' in ('concluido','cancelado') or v->>'lockedAt' is not null then raise exception 'photo_binding_invalid' using errcode='22023';end if;
 if not exists(select 1 from jsonb_array_elements(w.state->'patients') x where x->>'id'=p_patient) then raise exception 'photo_binding_invalid' using errcode='22023';end if;
 insert into public.app_workspace_operations(clinic_id,operation_id,actor_id,kind,fingerprint,status,photo_id) values(p_clinic,p_operation,p_actor,'upload',p_fingerprint,'pending',p_photo);
 insert into public.app_workspace_photos(clinic_id,id,patient_id,visit_id,operation_id,metadata,created_by) values(p_clinic,p_photo,p_patient,p_visit,p_operation,p_metadata,p_actor) returning * into ph;
 return to_jsonb(ph);
end;$$;

create or replace function public.app_workspace_photo_ready(p_clinic uuid,p_actor uuid,p_session uuid,p_operation uuid,p_fingerprint text)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare op public.app_workspace_operations; ph public.app_workspace_photos;
begin
 perform public.app_workspace_require_actor(p_clinic,p_actor,p_session);
 select * into op from public.app_workspace_operations where clinic_id=p_clinic and operation_id=p_operation for update;
 if not found or op.kind<>'upload' or op.fingerprint<>p_fingerprint then raise exception 'operation_reused' using errcode='23505';end if;
 update public.app_workspace_photos set status='ready' where clinic_id=p_clinic and id=op.photo_id returning * into ph;
 update public.app_workspace_operations set status='committed' where clinic_id=p_clinic and operation_id=p_operation;
 return to_jsonb(ph);
end;$$;

revoke all on function public.app_workspace_require_actor(uuid,uuid,uuid),public.app_workspace_commit(uuid,uuid,uuid,uuid,text,bigint,jsonb,text),public.app_workspace_photo_reserve(uuid,uuid,uuid,uuid,text,bigint,text,text,text,jsonb),public.app_workspace_photo_ready(uuid,uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.app_workspace_require_actor(uuid,uuid,uuid),public.app_workspace_commit(uuid,uuid,uuid,uuid,text,bigint,jsonb,text),public.app_workspace_photo_reserve(uuid,uuid,uuid,uuid,text,bigint,text,text,text,jsonb),public.app_workspace_photo_ready(uuid,uuid,uuid,uuid,text) to service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('app-workspace-media','app-workspace-media',false,8388608,array['image/jpeg','image/png','image/webp']);
create policy app_workspace_media_edge_only_guard on storage.objects as restrictive for all to anon,authenticated
using(bucket_id<>'app-workspace-media') with check(bucket_id<>'app-workspace-media');
