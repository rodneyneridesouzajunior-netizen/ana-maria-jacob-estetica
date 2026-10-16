begin;
-- A site request is a preference, never a reservation until an owner confirms it.
-- Its CRM lifecycle remains intact; this table records the separate app booking.
create table public.app_workspace_site_bookings (
 clinic_id uuid not null references public.clinics(id) on delete restrict,
 request_id uuid not null, request_version integer not null check(request_version>0),
 patient_id text not null, appointment_id text not null,
 operation_id uuid not null, fingerprint text not null check(fingerprint ~ '^[a-f0-9]{64}$'),
 workspace_revision bigint not null check(workspace_revision>0),
 scheduled_by uuid not null references auth.users(id), scheduled_at timestamptz not null default now(),
 source_snapshot jsonb not null,
 primary key(clinic_id,request_id), unique(clinic_id,appointment_id), unique(clinic_id,operation_id),
 foreign key(clinic_id,request_id) references private.crm_site_booking_requests(clinic_id,id) on delete restrict,
 foreign key(clinic_id,workspace_revision) references public.app_workspace_versions(clinic_id,revision) on delete restrict
);
alter table public.app_workspace_site_bookings enable row level security;
revoke all on public.app_workspace_site_bookings from public,anon,authenticated,service_role;
grant select on public.app_workspace_site_bookings to service_role;

create function public.app_workspace_site_request_source(p_clinic uuid,p_actor uuid,p_session uuid,p_request uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r private.crm_site_booking_requests;b public.app_workspace_site_bookings;a jsonb;
begin
 perform public.app_workspace_require_actor(p_clinic,p_actor,p_session);
 select * into r from private.crm_site_booking_requests where clinic_id=p_clinic and id=p_request;
 if not found then return null;end if;
 select * into b from public.app_workspace_site_bookings where clinic_id=p_clinic and request_id=p_request;
 if found then select value into a from public.app_workspaces w cross join lateral jsonb_array_elements(w.state->'appointments') where w.clinic_id=p_clinic and value->>'id'=b.appointment_id;end if;
 return jsonb_build_object('id',r.id,'full_name',r.full_name,'phone',r.phone,'interest',r.interest,'preferred_date',r.preferred_date,'preferred_period',r.preferred_period,'contact_consent',r.contact_consent,'status',r.status,'version',r.version,'received_at',r.created_at,
 'booking',case when b.request_id is null then null else jsonb_build_object('request_id',b.request_id,'patient_id',b.patient_id,'appointment_id',b.appointment_id,'operation_id',b.operation_id,'workspace_revision',b.workspace_revision,'scheduled_at',b.scheduled_at,'appointment',a) end);
end;$$;

create function public.app_workspace_site_requests_list(p_clinic uuid,p_actor uuid,p_session uuid,p_status text default 'available',p_limit integer default 26,p_offset integer default 0)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r record;result jsonb:='[]'::jsonb;
begin
 perform public.app_workspace_require_actor(p_clinic,p_actor,p_session);
 if p_status is null or p_status not in ('available','scheduled','archived','all') or p_limit is null or p_limit not between 1 and 51 or p_offset is null or p_offset not between 0 and 10000 then raise exception 'site_booking_filters_invalid' using errcode='22023';end if;
 for r in select q.id from private.crm_site_booking_requests q left join public.app_workspace_site_bookings b on b.clinic_id=q.clinic_id and b.request_id=q.id
 where q.clinic_id=p_clinic and (p_status='all' or p_status='available' and q.status in ('pending','accepted') and b.request_id is null or p_status='scheduled' and b.request_id is not null or p_status='archived' and q.status='archived')
 order by q.created_at desc,q.id limit p_limit offset p_offset loop
  result:=result||jsonb_build_array(public.app_workspace_site_request_source(p_clinic,p_actor,p_session,r.id));
 end loop;return result;
end;$$;

create function public.app_workspace_site_booking_operation(p_clinic uuid,p_actor uuid,p_session uuid,p_operation uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare b public.app_workspace_site_bookings;
begin
 perform public.app_workspace_require_actor(p_clinic,p_actor,p_session);
 select * into b from public.app_workspace_site_bookings where clinic_id=p_clinic and operation_id=p_operation;
 if not found then return null;end if;
 return jsonb_build_object('fingerprint',b.fingerprint,'workspace_revision',b.workspace_revision,'booking',public.app_workspace_site_request_source(p_clinic,p_actor,p_session,b.request_id)->'booking');
end;$$;

create function public.app_workspace_book_site_request(p_clinic uuid,p_actor uuid,p_session uuid,p_operation uuid,p_fingerprint text,p_expected bigint,p_request uuid,p_request_version integer,p_patient text,p_appointment text,p_state jsonb,p_state_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r private.crm_site_booking_requests;b public.app_workspace_site_bookings;w public.app_workspaces;a jsonb;p jsonb;saved jsonb;
begin
 perform public.app_workspace_require_actor(p_clinic,p_actor,p_session);
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('app-workspace:'||p_clinic::text,0));
 select * into b from public.app_workspace_site_bookings where clinic_id=p_clinic and operation_id=p_operation;
 if found then
  if b.fingerprint<>p_fingerprint then raise exception 'operation_reused' using errcode='23505';end if;
  return public.app_workspace_site_booking_operation(p_clinic,p_actor,p_session,p_operation)||jsonb_build_object('replayed',true);
 end if;
 select * into w from public.app_workspaces where clinic_id=p_clinic for update;
 if coalesce(w.revision,0)<>p_expected then raise exception 'revision_conflict' using errcode='40001';end if;
 select * into r from private.crm_site_booking_requests where clinic_id=p_clinic and id=p_request for update;
 if not found or r.status not in ('pending','accepted') or not r.contact_consent then raise exception 'site_request_unavailable' using errcode='22023';end if;
 if r.version<>p_request_version then raise exception 'site_request_changed' using errcode='40001';end if;
 if exists(select 1 from public.app_workspace_site_bookings where clinic_id=p_clinic and request_id=p_request) then raise exception 'site_request_already_booked' using errcode='23505';end if;
 select value into a from jsonb_array_elements(p_state->'appointments') where value->>'id'=p_appointment;
 select value into p from jsonb_array_elements(p_state->'patients') where value->>'id'=p_patient;
 if a is null or p is null or a->>'patientId'<>p_patient or a->>'status'<>'confirmado' or p_fingerprint !~ '^[a-f0-9]{64}$' or p_request_version is null then raise exception 'site_booking_invalid' using errcode='22023';end if;
 if exists(select 1 from jsonb_array_elements(coalesce(w.state->'appointments','[]'::jsonb)) where value->>'id'=p_appointment) then raise exception 'site_booking_id_conflict' using errcode='23505';end if;
 if public.app_workspace_document_name(p->>'name')<>public.app_workspace_document_name(r.full_name) or
 regexp_replace(regexp_replace(p->>'phone','[^0-9]','','g'),'^55([0-9]{10,11})$','\1')<>substring(r.phone from 4) then raise exception 'site_booking_identity_mismatch' using errcode='22023';end if;
 saved:=public.app_workspace_commit(p_clinic,p_actor,p_session,p_operation,p_fingerprint,p_expected,p_state,p_state_hash);
 insert into public.app_workspace_site_bookings(clinic_id,request_id,request_version,patient_id,appointment_id,operation_id,fingerprint,workspace_revision,scheduled_by,source_snapshot)
 values(p_clinic,p_request,p_request_version,p_patient,p_appointment,p_operation,p_fingerprint,(saved->>'revision')::bigint,p_actor,
 jsonb_build_object('id',r.id,'full_name',r.full_name,'phone',r.phone,'interest',r.interest,'preferred_date',r.preferred_date,'preferred_period',r.preferred_period,'version',r.version,'status',r.status));
 return public.app_workspace_site_booking_operation(p_clinic,p_actor,p_session,p_operation)||jsonb_build_object('replayed',false);
end;$$;

-- Ordinary edits can reschedule/cancel the same appointment, but cannot silently
-- move a website-origin booking to another person or erase its reference.
create function public.app_workspace_preserve_site_bookings() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.app_workspace_site_bookings b where b.clinic_id=new.clinic_id and not exists(select 1 from jsonb_array_elements(new.state->'appointments') a where a->>'id'=b.appointment_id and a->>'patientId'=b.patient_id)) then
  raise exception 'site_booking_binding_immutable' using errcode='22023';
 end if;return new;
end;$$;
create trigger app_workspace_preserve_site_bookings before update on public.app_workspaces for each row execute function public.app_workspace_preserve_site_bookings();

revoke all on function public.app_workspace_site_request_source(uuid,uuid,uuid,uuid),public.app_workspace_site_requests_list(uuid,uuid,uuid,text,integer,integer),public.app_workspace_site_booking_operation(uuid,uuid,uuid,uuid),public.app_workspace_book_site_request(uuid,uuid,uuid,uuid,text,bigint,uuid,integer,text,text,jsonb,text),public.app_workspace_preserve_site_bookings() from public,anon,authenticated,service_role;
grant execute on function public.app_workspace_site_request_source(uuid,uuid,uuid,uuid),public.app_workspace_site_requests_list(uuid,uuid,uuid,text,integer,integer),public.app_workspace_site_booking_operation(uuid,uuid,uuid,uuid),public.app_workspace_book_site_request(uuid,uuid,uuid,uuid,text,bigint,uuid,integer,text,text,jsonb,text) to service_role;
commit;
