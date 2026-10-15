// Version browser modules and styles without bundling or altering source imports.
// Run before publishing; --check verifies generated HTML is current.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {dirname,resolve,relative,sep} from 'node:path';

const digest=(bytes,format='hex')=>createHash('sha256').update(bytes).digest(format);
const moduleRefs=/\b(?:import\s*(?:[^'";]*?\sfrom\s*)?|export\s+[^'";]*?\sfrom\s*|import\s*\(\s*)['"](\.[^'"]+)['"]/g;
const mapBlock=/<script type="importmap" data-amj-release>[\s\S]*?<\/script>/g;
export async function prepareRelease(root,{check=false}={}){
  const cache=new Map();
  async function source(path){
    const full=resolve(root,path),rel=relative(root,full);
    if(rel.startsWith('..'+sep)||rel==='..'||rel.includes('?')||rel.includes('#'))throw Error('Asset outside application: '+path);
    if(!cache.has(full))cache.set(full,await readFile(full));
    return cache.get(full);
  }
  const modules=new Map();
  async function walk(path){
    path=relative(root,resolve(root,path)).split(sep).join('/');
    if(modules.has(path))return;
    const bytes=await source(path);modules.set(path,digest(bytes).slice(0,16));
    const text=bytes.toString('utf8');
    for(const match of text.matchAll(moduleRefs)){
      const dependency=relative(root,resolve(root,dirname(path),match[1])).split(sep).join('/');
      if(/\.(mjs|js)$/.test(dependency))await walk(dependency);
    }
  }
  for(const entry of ['app.mjs','connected-bootstrap.mjs','capture-mode.mjs'])await walk(entry);
  const imports=Object.fromEntries([...modules].sort(([a],[b])=>a.localeCompare(b)).map(([path,hash])=>['./'+path,'./'+path+'?v='+hash]));
  const json=JSON.stringify({imports}).replace(/</g,'\\u003c');
  const policyHash="'sha256-"+digest(json,'base64')+"'";
  const block='<script type="importmap" data-amj-release>'+json+'</script>';
  const changed=[];
  for(const entry of ['index.html','connected.html']){
    const original=(await source(entry)).toString('utf8');
    let html=original.replace(mapBlock,'').replace(/script-src 'self'(?: 'sha256-[A-Za-z0-9+/=]+')*/g,"script-src 'self' "+policyHash);
    html=html.replace(/<script type="module"/,block+'<script type="module"');
    const paths=[...html.matchAll(/(?:href|src)="([^"?]+\.(?:css|mjs))(?:\?v=[a-f0-9]+)?"/g)].map(match=>match[1]);
    for(const path of new Set(paths)){
      const hash=digest(await source(path)).slice(0,16);
      const escaped=path.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
      html=html.replace(new RegExp('((?:href|src)=")'+escaped+'(?:\\?v=[a-f0-9]+)?"','g'),'$1'+path+'?v='+hash+'"');
    }
    if(html!==original){changed.push(entry);if(!check)await writeFile(resolve(root,entry),html,'utf8');}
  }
  if(check&&changed.length)throw Error('Run prepare-release.mjs: outdated '+changed.join(', '));
  return {modules:modules.size,changed};
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  console.log(JSON.stringify(await prepareRelease(dirname(fileURLToPath(import.meta.url)),{check:process.argv.includes('--check')})));
}
