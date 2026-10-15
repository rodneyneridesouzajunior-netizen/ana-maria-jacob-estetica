import http from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=path.dirname(fileURLToPath(import.meta.url)),port=Number(process.env.AMJ_PILOT_PORT||8766);
const viewerRoot=path.resolve(root,'../rosto3d/v2');
const types={'.html':'text/html; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.css':'text/css; charset=utf-8','.jpg':'image/jpeg','.png':'image/png','.webp':'image/webp','.ttf':'font/ttf','.woff2':'font/woff2','.txt':'text/plain; charset=utf-8'};
http.createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Content-Security-Policy',"default-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'sha256-GqsWfEjHm73zbHa7lGbVXfv95jxypKuCtjd6kntjIRA='; font-src 'self'; connect-src 'self' https://rjxtxoqprnumouqakxbc.supabase.co; frame-ancestors 'self'; object-src 'none'; base-uri 'none'; form-action 'self'");
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);return res.end();}
  try {
    const url=new URL(req.url,'http://127.0.0.1'),pathname=decodeURIComponent(url.pathname),viewer=pathname.startsWith('/painel/rosto3d/v2/'),base=viewer?viewerRoot:root,rel=(viewer?pathname.slice('/painel/rosto3d/v2/'.length):pathname.replace(/^\/+/,''))||'index.html';
    const target=path.resolve(base,rel.endsWith('/')?rel+'index.html':rel);
    if(!target.startsWith(base+path.sep)||rel.split('/').some(s=>s.startsWith('.'))||!types[path.extname(target)])throw Error();
    const info=await stat(target);if(!info.isFile())throw Error();
    const bytes=await readFile(target);
    if(path.extname(target)==='.html'){
      const map=bytes.toString('utf8').match(/<script type="importmap" data-amj-release>([\s\S]*?)<\/script>/);
      if(map){const hash=createHash('sha256').update(map[1]).digest('base64');res.setHeader('Content-Security-Policy',String(res.getHeader('Content-Security-Policy')).replace("script-src 'self'",`script-src 'self' 'sha256-${hash}'`));}
    }
    res.setHeader('Content-Type',types[path.extname(target)]);res.writeHead(200);res.end(req.method==='HEAD'?undefined:bytes);
  }catch{res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8'});res.end('Arquivo não encontrado.');}
}).listen(port,'127.0.0.1',()=>console.log(`Piloto local: http://127.0.0.1:${port}`));
