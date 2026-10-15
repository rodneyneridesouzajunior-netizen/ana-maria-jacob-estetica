-- Separate least-privilege correction. Does not touch records, SELECT, RPC or service_role.
revoke truncate on table public.protocol_points,public.protocol_signatures from authenticated,anon,public;
