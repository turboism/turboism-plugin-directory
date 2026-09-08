import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
const read = name => readFileSync(new URL(name, import.meta.url), 'utf8');
test('retired chat cannot return to desktop, mobile or SDK navigation',()=>{
 const nav=JSON.parse(read('navigation.json'));
 assert.deepEqual(nav.links.map(([key])=>key),['home','docs','sdk','plugins','learn','thanks','download']);
 for(const locale of ['en','zh','ja'])assert.equal('chat' in nav.labels[locale],false);
 assert.doesNotMatch(read('navigation.json'),/chat\.turboism\.dev/);
 assert.doesNotMatch(read('shell.tsx'),/['"]chat['"]/);
 for(const name of ['src/data/site.ts','components/network-navigation.tsx','placeholder/index.html','content/docs/use/overview.mdx','content/docs/use/overview.zh.mdx','content/docs/use/overview.ja.mdx']){
  if(existsSync(name))assert.doesNotMatch(readFileSync(name,'utf8'),/chat\.turboism\.dev/,name);
 }
});
