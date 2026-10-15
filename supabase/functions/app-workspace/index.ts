import {authenticateDual,requireAdminSessionAction} from '../_shared/dual-auth.ts';
import {createWorkspaceHandler} from './handler.mjs';
import {createRepository} from './repository.mjs';
const supabaseUrl=(Deno.env.get('SUPABASE_URL')||'').replace(/\/+$/,''),serviceRoleKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const authConfig={supabaseUrl,serviceRoleKey,allowedRoles:['owner'] as const,requireAal2:true};
export const handler=createWorkspaceHandler({
 authenticate:(req:Request)=>authenticateDual(req,authConfig),
 authorize:(req:Request,ctx:Parameters<typeof requireAdminSessionAction>[2],scope:Parameters<typeof requireAdminSessionAction>[3])=>requireAdminSessionAction(req,authConfig,ctx,scope),
 repository:createRepository({supabaseUrl,serviceRoleKey}),
});
if(import.meta.main)Deno.serve(handler);
