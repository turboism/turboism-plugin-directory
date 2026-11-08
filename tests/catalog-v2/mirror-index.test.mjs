import test from 'node:test';
import assert from 'node:assert/strict';
import {buildPluginMirrorIndex} from '../../lib/catalog-v2/mirror-index.mjs';

const sha='a'.repeat(64),digest='b'.repeat(64);
const base={
 id:'dev.turboism.plugin.acp',
 releases:[
  {version:'0.68.0',status:'active',artifact:{fileName:'acp-0.68.0.jar',sha256:sha,descriptorSha256:digest,size:100,
   url:'https://github.com/turboism/turboism-plugin-directory/releases/download/plugins-test123/acp-0.68.0.jar'}},
  {version:'0.67.0',status:'withdrawn',artifact:{fileName:'acp-0.67.0.jar',sha256:'c'.repeat(64),descriptorSha256:digest,size:90,
   url:'https://github.com/turboism/turboism-plugin-directory/releases/download/plugins-test123/acp-0.67.0.jar'}}
 ]
};
const catalog={catalogVersion:1,plugins:[base]};
test('only active authenticated release identities are included',()=>{
 const out=buildPluginMirrorIndex(catalog,Buffer.from('{}'));
 assert.equal(out.schemaVersion,1);
 assert.equal(out.artifacts.length,1);
 assert.equal(out.artifacts[0].sha256,sha);
 assert.equal(out.artifacts[0].pluginId,base.id);
 assert.equal(out.artifacts[0].version,'0.68.0');
 assert.equal(out.signedCatalogSha256,'44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a');
});
test('arbitrary origin URLs, invalid checksums and huge objects fail closed',()=>{
 assert.throws(()=>buildPluginMirrorIndex({...catalog,plugins:[{...base,releases:[{...base.releases[0],
  artifact:{...base.releases[0].artifact,url:'https://evil.example/jar'}}]}]},Buffer.from('{}')),/Untrusted/);
 assert.throws(()=>buildPluginMirrorIndex({...catalog,plugins:[{...base,releases:[{...base.releases[0],
  artifact:{...base.releases[0].artifact,size:25*1024*1024}}]}]},Buffer.from('{}')),/Invalid active/);
 assert.throws(()=>buildPluginMirrorIndex({...catalog,plugins:[{...base,releases:[{...base.releases[0],
  artifact:{...base.releases[0].artifact,sha256:'bad'}}]}]},Buffer.from('{}')),/Invalid active/);
});
