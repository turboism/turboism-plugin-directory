#!/usr/bin/env node
// Stages an R2 mirror ONLY from the live, production Ed25519-signed Plugin
// Directory v2 catalog. No signing secrets are read by this tool.
// Use --validate-only to inspect the index without downloading any JARs.
// Use --out <empty-dir> to download & verify all active JARs; the final index
// is written only when EVERY artifact has passed exact size and SHA256.
import {createHash} from 'node:crypto';
import {mkdir,writeFile,stat,readdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadTrustedKeys,verifyCatalogBytes} from '../../lib/catalog-v2/catalog.mjs';
import {buildPluginMirrorIndex} from '../../lib/catalog-v2/mirror-index.mjs';

const base='https://plugin.turboism.dev/api/v2/';
const dirname=path.dirname(fileURLToPath(import.meta.url));
const keysPath=path.resolve(dirname,'../../lib/catalog-v2/trusted-keys.json');
const args=process.argv.slice(2);
const pos=args.indexOf('--out');
const out=pos>=0?args[pos+1]:null;
const validateOnly=args.includes('--validate-only');
if((!out&&!validateOnly)||(out&&validateOnly)||pos>=0&&!out){
 console.error('usage: node scripts/catalog-v2/stage-jar-mirror.mjs --validate-only | --out /tmp/empty-directory');
 process.exit(2);
}

async function getPublic(url,maxBytes,expectedMedia){
 const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(45000),headers:{Accept:expectedMedia,'Cache-Control':'no-cache'}});
 if(response.status!==200||!response.headers.get('content-type')?.startsWith(expectedMedia)){
  await response.body?.cancel();
  throw new Error('Production catalog pair unavailable or wrong content type');
 }
 const body=Buffer.from(await response.arrayBuffer());
 if(body.length<1||body.length>maxBytes)throw new Error('Oversized catalog/signature');
 return body;
}

const [catalogBytes,sigBytes]=await Promise.all([
 getPublic(base+'catalog.json',2*1024*1024,'application/vnd.turboism.plugin-catalog+json;version=2'),
 getPublic(base+'catalog.json.sig',16*1024,'application/vnd.turboism.plugin-catalog-signature+json;version=2'),
]);
const trusted=loadTrustedKeys(keysPath);
if(!trusted.ok)throw new Error('Invalid local production trust roots');
const checked=verifyCatalogBytes(catalogBytes,sigBytes,trusted.keys,{requireProduction:true});
if(!checked.ok)throw new Error('Production Ed25519 catalog verification failed: '+JSON.stringify(checked.errors));
const index=buildPluginMirrorIndex(checked.catalog,catalogBytes);
const bytes=index.artifacts.reduce((total,item)=>total+item.size,0);
console.log('Verified production catalog version '+index.catalogVersion+
            ' with '+index.artifacts.length+' active JARs ('+bytes+' bytes)');
if(validateOnly)process.exit(0);

const target=path.resolve(out);
await mkdir(target,{recursive:true});
if((await readdir(target)).length)throw new Error('Output directory must be empty');
const objectsPath=path.join(target,'plugins','objects');
const approvedRedirectHosts=new Set(['github.com','release-assets.githubusercontent.com','objects.githubusercontent.com']);
async function readVerifiedJar(item){
 let url=item.githubUrl, response;
 for(let hop=0;hop<5;hop++){
  const u=new URL(url);
  if(u.protocol!=='https:'||u.username||u.password||u.port||!approvedRedirectHosts.has(u.hostname)){
   throw new Error('Untrusted JAR redirect host');
  }
  if(hop===0&&u.hostname!=='github.com')throw new Error('Unexpected signed release URL host');
  response=await fetch(u,{redirect:'manual',signal:AbortSignal.timeout(80000),headers:{Accept:'application/octet-stream'}});
  if([301,302,303,307,308].includes(response.status)){
   const next=response.headers.get('location');
   await response.body?.cancel();
   if(!next)throw new Error('Missing redirect');
   url=new URL(next,u).href;continue;
  }
  break;
 }
 if(!response||response.status!==200||!response.body)throw new Error('JAR origin not available (HTTP '+response?.status+')');
 if(response.headers.get('content-encoding')&&!['identity'].includes(response.headers.get('content-encoding'))){
  await response.body.cancel();throw new Error('Unexpected compressed artifact');
 }
 const announced=Number(response.headers.get('content-length'));
 if(response.headers.has('content-length')&&announced!==item.size){
  await response.body.cancel();throw new Error('JAR size header mismatch');
 }
 const reader=response.body.getReader(),chunks=[];
 const sha256=createHash('sha256');let received=0;
 try{
  while(true){
   const {done,value}=await reader.read();
   if(done)break;
   received+=value.byteLength;
   if(received>item.size){await reader.cancel();throw new Error('JAR exceeds signed size');}
   sha256.update(value);
   chunks.push(Buffer.from(value));
  }
 }finally{reader.releaseLock();}
 if(received!==item.size)throw new Error('JAR byte length mismatch');
 if(sha256.digest('hex')!==item.sha256)throw new Error('JAR digest mismatch');
 return Buffer.concat(chunks,item.size);
}
let processed=0;
const queue=[...index.artifacts];
async function worker(){
 while(queue.length){
  const item=queue.shift();
  if(!item)break;
  const content=await readVerifiedJar(item);
  const dir=path.join(objectsPath,item.sha256);
  await mkdir(dir,{recursive:true});
  await writeFile(path.join(dir,item.fileName),content,{flag:'wx',mode:0o600});
  processed++;
  if(processed%25===0||processed===index.artifacts.length){
   console.log('Verified '+processed+'/'+index.artifacts.length+' JARs');
  }
 }
}
await Promise.all(Array.from({length:Math.min(5,queue.length)},()=>worker()));
// The index is the last file written. A deploy workflow MUST upload JAR
// objects first and this index last; withdrawal requires purge of old cache.
const indexDirectory=path.join(target,'plugins');
await writeFile(path.join(indexDirectory,'index-v1.json'),JSON.stringify(index)+'\n',{flag:'wx',mode:0o600});
const indexStat=await stat(path.join(indexDirectory,'index-v1.json'));
console.log('STAGED '+JSON.stringify({catalogVersion:index.catalogVersion,artifacts:index.artifacts.length,totalBytes:bytes,indexBytes:indexStat.size,output:target}));
