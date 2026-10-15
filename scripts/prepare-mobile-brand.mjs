// Export installation sizes from approved icon artwork; preserve the originals.
import {createRequire} from 'node:module';
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(process.env.AMJ_NODE_DEPENDENCIES+'/package.json');
const sharp=require('sharp');
const generated=process.env.AMJ_GENERATED_ICONS;
const dest=resolve(root,'assets/icons');await mkdir(dest,{recursive:true});
for(const [kind,file] of [['app','exec-9aafceed-de29-4443-881d-2be37f6846a9.png'],['site','exec-b7bb4ac5-3bc1-4c66-9f9e-e64a10fa8b77.png']]){
  const source=generated?resolve(generated,file):resolve(dest,`ana-${kind}-original.png`);
  if(generated)await copyFile(source,resolve(dest,`ana-${kind}-original.png`));
  for(const size of [32,180,192,512])await sharp(source).resize(size,size,{fit:'contain'}).png({compressionLevel:9}).toFile(resolve(dest,`ana-${kind}-${size}-v1.png`));
}
const manifest=(kind)=>({id:kind==='app'?'/app/':'/site/',name:kind==='app'?'Ana Maria Jacob · Clínica':'Ana Maria Jacob · Site',short_name:kind==='app'?'Ana · Clínica':'Ana · Site',lang:'pt-BR',start_url:kind==='app'?'/painel/piloto-simples/connected.html?source=homescreen':'/?source=homescreen',scope:kind==='app'?'/painel/piloto-simples/':'/',display:'standalone',background_color:'#FCFBFA',theme_color:kind==='app'?'#191719':'#D4A5A5',icons:[192,512].map(size=>({src:`/assets/icons/ana-${kind}-${size}-v1.png`,sizes:`${size}x${size}`,type:'image/png',purpose:'any'}))});
await writeFile(resolve(root,'app/manifest.webmanifest'),JSON.stringify(manifest('app'),null,2)+'\n');
await writeFile(resolve(root,'site.webmanifest'),JSON.stringify(manifest('site'),null,2)+'\n');
for(const [kind,pages] of [['app',['app/index.html','painel/piloto-simples/index.html','painel/piloto-simples/connected.html']],['site',['index.html','anamnese/index.html','agendar/index.html','termos/index.html','tratamentos/index.html']]]){
  for(const page of pages){
    const path=resolve(root,page);let html=await readFile(path,'utf8');
    html=html.replace(/<link\b[^>]*rel="(?:icon|apple-touch-icon|manifest)"[^>]*>/g,'').replace(/<meta\b[^>]*name="(?:theme-color|apple-mobile-web-app-title|apple-mobile-web-app-capable|apple-mobile-web-app-status-bar-style)"[^>]*>/g,'');
    html=html.replace('content="width=device-width,initial-scale=1"','content="width=device-width,initial-scale=1,viewport-fit=cover"');
    const head=`<link rel="icon" type="image/png" sizes="32x32" href="/assets/icons/ana-${kind}-32-v1.png"><link rel="apple-touch-icon" sizes="180x180" href="/assets/icons/ana-${kind}-180-v1.png"><link rel="manifest" href="${kind==='app'?'/app/manifest.webmanifest':'/site.webmanifest'}"><meta name="theme-color" content="${kind==='app'?'#191719':'#D4A5A5'}"><meta name="apple-mobile-web-app-title" content="${kind==='app'?'Ana · Clínica':'Ana · Site'}"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-status-bar-style" content="default">`;
    html=html.replace('</head>',head+'</head>');
    if(page.startsWith('painel/piloto-simples/'))html=html.replace('<link rel="stylesheet" href="home.css">','<link rel="stylesheet" href="clinical-bridge.css"><link rel="stylesheet" href="home.css">');
    await writeFile(path,html.replace(/[\t ]+$/gm,''));
  }
}
console.log('App and site icons, manifests and installation metadata ready.');
