// Enumerate only the entrypoint's local source dependencies for deployment.
import {readFileSync} from 'node:fs';
import {resolve,relative,dirname} from 'node:path';
const root=process.cwd(),files=new Map();
function collect(name){
 const full=resolve(root,name),path=relative(root,full).replaceAll('\\','/');
 if(!path.startsWith('supabase/functions/'))throw Error('Dependency outside functions: '+path);
 if(files.has(path))return;
 const content=readFileSync(full,'utf8');files.set(path,{name:path,content});
 for(const match of content.matchAll(/\b(?:import\s*(?:[^'";]*?\sfrom\s*)?|export\s+[^'";]*?\sfrom\s*|import\s*\(\s*)['"](\.[^'"]+)['"]/g))collect(resolve(dirname(full),match[1]));
}
collect('supabase/functions/app-workspace/index.ts');
process.stdout.write(JSON.stringify([...files.values()]));
