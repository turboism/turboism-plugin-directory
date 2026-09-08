import test from 'node:test';import assert from 'node:assert/strict';import{readFileSync}from'node:fs';
const read=n=>readFileSync(new URL(n,import.meta.url),'utf8');
test('no retired chat and sponsor uses www',()=>{const n=JSON.parse(read('navigation.json'));assert.ok(!n.links.some(([k,u])=>k==='chat'||u.includes('chat.turboism.dev')));assert.deepEqual(n.links.find(([k])=>k==='sponsor'),['sponsor','https://turboism.dev/sponsor']);for(const l of['en','zh','ja'])assert.ok(n.labels[l].sponsor);assert.doesNotMatch(read('shell.tsx'),/\| 'chat'/);});
