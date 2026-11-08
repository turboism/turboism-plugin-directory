import {createHash} from 'node:crypto';

const SHA=/^[a-f0-9]{64}$/;
const NAME=/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.jar$/;
const ID=/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/;
const VERSION=/^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9._-]+)?$/;
const MAX_JAR_BYTES=16*1024*1024;

/**
 * Input MUST come from a production Ed25519-verified catalog, not arbitrary
 * caller-controlled JSON. Reject unsupported GitHub URL/metadata changes.
 */
export function buildPluginMirrorIndex(catalog,catalogBytes){
 if(!Number.isSafeInteger(catalog?.catalogVersion)||catalog.catalogVersion<1||!Array.isArray(catalog.plugins)){
  throw new Error('Invalid catalog envelope');
 }
 const entries=[], identities=new Map();
 for(const plugin of catalog.plugins){
  if(!ID.test(plugin.id??'')||!Array.isArray(plugin.releases))throw new Error('Invalid plugin');
  for(const release of plugin.releases){
   if(release.status!=='active')continue;
   const artifact=release.artifact;
   if(!VERSION.test(release.version??'')||!artifact||!SHA.test(artifact.sha256??'')||
      !NAME.test(artifact.fileName??'')||!SHA.test(artifact.descriptorSha256??'')||
      !Number.isSafeInteger(artifact.size)||artifact.size<1||artifact.size>MAX_JAR_BYTES){
    throw new Error('Invalid active JAR artifact for '+plugin.id);
   }
   const url=new URL(artifact.url);
   if(url.protocol!=='https:'||url.host!=='github.com'||url.username||url.password||
      url.search||url.hash||
      url.pathname!=='/turboism/turboism-plugin-directory/releases/download/'+
                        url.pathname.split('/')[5]+'/'+artifact.fileName||
      !/^plugins-[A-Za-z0-9._-]+$/.test(url.pathname.split('/')[5]??'')){
    throw new Error('Untrusted GitHub Release URL for '+plugin.id);
   }
   const item={
    pluginId:plugin.id,version:release.version,
    sha256:artifact.sha256,fileName:artifact.fileName,
    descriptorSha256:artifact.descriptorSha256,size:artifact.size,
    githubUrl:artifact.url,
   };
   const key=item.sha256+'/'+item.fileName;
   const old=identities.get(key);
   if(old&&JSON.stringify(old)!==JSON.stringify(item))throw new Error('Conflicting SHA filename identity');
   if(!old){identities.set(key,item);entries.push(item);}
  }
 }
 entries.sort((a,b)=>a.sha256.localeCompare(b.sha256)||a.fileName.localeCompare(b.fileName));
 const signedCatalogSha256=createHash('sha256').update(catalogBytes).digest('hex');
 const index={schemaVersion:1,catalogVersion:catalog.catalogVersion,signedCatalogSha256,artifacts:entries};
 if(Buffer.byteLength(JSON.stringify(index))>1024*1024)throw new Error('Mirror index exceeds Worker limit');
 return index;
}
