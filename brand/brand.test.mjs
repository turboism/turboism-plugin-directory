import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=name=>readFileSync(new URL(name,import.meta.url),'utf8');
test('approved brand and accessible navigation',()=>{const css=read('brand.css'),shell=read('shell.tsx');for(const color of ['#6A5ACD','#EEE8AA','#FCFBF7','#30294B','#756D89','#E5E1EE'])assert.ok(css.includes(color));assert.doesNotMatch(css,/--color-(red|amber|green)-\d+\s*:/);assert.ok(css.includes('prefers-reduced-motion'));for(const entry of ['/docs','/sdk/index.html','/plugins','/learn','/thanks','/download','chat.turboism.dev','discord.gg/bect4anknH','github.com/turboism/Turboism','<details','aria-current','BrandLanguage'])assert.ok(shell.includes(entry),entry);assert.ok(read('../app/layout.tsx').includes('@/brand/brand.css'));assert.doesNotMatch(shell,/非 Live2D 官方出品|给想法一点活动空间|首页设计预览|为创作者而做/);});
