import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const nav=JSON.parse(readFileSync(new URL('./navigation.json',import.meta.url),'utf8'));
test('retired chat is absent from public navigation',()=>{assert.ok(!JSON.stringify(nav).includes('chat.turboism.dev'),'retired chat link is present');assert.deepEqual(nav.links.map(([key])=>key),['home','docs','sdk','plugins','learn','thanks','download']);for(const labels of Object.values(nav.labels))assert.ok(!Object.hasOwn(labels,'chat'));});
