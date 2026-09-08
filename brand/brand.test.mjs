import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = name => readFileSync(new URL(name, import.meta.url), 'utf8');
test('approved palette, shared fonts, and identical site navigation', () => {
 const css=read('brand.css'), shell=read('shell.tsx'), fonts=read('fonts.ts'), nav=JSON.parse(read('navigation.json'));
 for(const color of ['#6A5ACD','#EEE8AA','#FCFBF7','#30294B','#756D89','#E5E1EE'])assert.ok(css.includes(color));
 assert.doesNotMatch(css,/--color-(red|amber|green)-\d+\s*:/);
 assert.ok(css.includes('prefers-reduced-motion'));
 assert.deepEqual(nav.links.map(([key])=>key),['home','docs','sdk','plugins','learn','thanks','download']);
 for(const locale of ['en','zh','ja'])for(const [key] of nav.links)assert.ok(nav.labels[locale][key]);
 for(const family of ['Geist','Tinos','Noto_Serif_SC','Noto_Serif_JP'])assert.ok(fonts.includes(family));
 assert.match(shell,/data-turboism-brand/);assert.match(shell,/<details/);assert.match(shell,/aria-current/);
 assert.doesNotMatch(shell,/tb-tools|非 Live2D 官方出品|给想法一点活动空间|首页设计预览|为创作者而做/);
 assert.ok(read('../app/layout.tsx').includes('@/brand/brand.css'));
});
