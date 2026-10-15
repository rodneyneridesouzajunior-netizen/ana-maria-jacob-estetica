import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {prepareRelease} from '../prepare-release.mjs';
async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'amj-release-'));t.after(()=>rm(root,{recursive:true,force:true}));
 await mkdir(join(root,'lib'));
 for(const [path,body] of Object.entries({'app.mjs':"import './lib/domain.mjs';",'connected-bootstrap.mjs':"import './app.mjs';",'capture-mode.mjs':'export {};','lib/domain.mjs':'export const value=1;','main.css':'body{color:black}', 'index.html':`<meta http-equiv="Content-Security-Policy" content="script-src 'self'"><link rel="stylesheet" href="main.css"><script type="module" src="app.mjs"></script>`,'connected.html':`<meta http-equiv="Content-Security-Policy" content="script-src 'self'"><link rel="stylesheet" href="main.css"><script type="module" src="connected-bootstrap.mjs"></script>`}))await writeFile(join(root,path),body);
 return root;
}
const mapOf=html=>html.match(/<script type="importmap" data-amj-release>([\s\S]*?)<\/script>/)[1];
test('release versions transitive imports and authorizes exactly its map without inline scripts',async t=>{
 const root=await fixture(t);const result=await prepareRelease(root);assert.equal(result.modules,4);
 const html=await readFile(join(root,'index.html'),'utf8'),raw=mapOf(html),imports=JSON.parse(raw).imports;
 assert.match(imports['./lib/domain.mjs'],/^\.\/lib\/domain.mjs\?v=[a-f0-9]{16}$/);
 assert.ok(html.includes("'sha256-"+createHash('sha256').update(raw).digest('base64')+"'"));
 assert.equal(html.includes('unsafe-inline'),false);assert.ok(html.indexOf('importmap')<html.indexOf('type="module"'));
 assert.match(html,/main\.css\?v=[a-f0-9]{16}/);
 assert.deepEqual((await prepareRelease(root)).changed,[]);await prepareRelease(root,{check:true});
});
test('dependency edits invalidate HTML and only the changed module version',async t=>{
 const root=await fixture(t);await prepareRelease(root);const first=JSON.parse(mapOf(await readFile(join(root,'index.html'),'utf8'))).imports;
 await writeFile(join(root,'lib/domain.mjs'),'export const value=2;');await assert.rejects(prepareRelease(root,{check:true}),/outdated/);
 await prepareRelease(root);const next=JSON.parse(mapOf(await readFile(join(root,'index.html'),'utf8'))).imports;
 assert.equal(first['./app.mjs'],next['./app.mjs']);assert.notEqual(first['./lib/domain.mjs'],next['./lib/domain.mjs']);
});
test('module graph cannot read files outside the application',async t=>{
 const root=await fixture(t);await writeFile(join(root,'app.mjs'),"import '../outside.mjs';");await assert.rejects(prepareRelease(root),/outside application/);
});
