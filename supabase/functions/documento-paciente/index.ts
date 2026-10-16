import {PDFDocument,rgb} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import {createRepository} from '../app-workspace/repository.mjs';
import {consumePublicFormRateLimit} from '../_shared/public-form-rate-limit.ts';
import {createPublicDocumentHandler} from './handler.mjs';
import {createPDFRenderer} from './pdf.mjs';
const supabaseUrl=Deno.env.get('SUPABASE_URL')||'',serviceRoleKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
export const handler=createPublicDocumentHandler({repository:createRepository({supabaseUrl,serviceRoleKey}),renderPDF:createPDFRenderer({PDFDocument,rgb,fontkit}),rateLimit:(req:Request,action:string)=>consumePublicFormRateLimit(req,{supabaseUrl,serviceRoleKey,scope:'custom_document_'+action,limit:['assinar','retomar'].includes(action)?15:60,windowSeconds:900})});
if(import.meta.main)Deno.serve(handler);
