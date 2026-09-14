import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
const root = existsSync('src/brand/language-preference.mjs') ? '../src/brand' : '../brand';
const { persistLanguagePreference, readLanguagePreference } = await import(`${root}/language-preference.mjs`);
function environment(host = 'turboism.dev', path = '/', denyStorage = false) {
  const records = new Map(), storage = new Map(), events = [];
  const seed = (value, domain = host, cookiePath = '/', name = 'turboism-language') => records.set([name, domain, cookiePath].join('|'), { name, value, domain, path: cookiePath });
  seed('zh'); seed('en', '.turboism.dev'); seed('ja', host, '/docs'); seed('keep', host, '/', 'session');
  const doc = {
    get cookie() { return [...records.values()].filter(c => (c.domain === host || (c.domain.startsWith('.') && (host === c.domain.slice(1) || host.endsWith(c.domain)))) && (path === c.path || path.startsWith(c.path.endsWith('/') ? c.path : c.path + '/'))).sort((a,b) => b.path.length - a.path.length).map(c => `${c.name}=${c.value}`).join('; '); },
    set cookie(raw) { const [pair, ...attrs] = raw.split(';').map(x => x.trim()); const [name, value] = pair.split('='); const attr = Object.fromEntries(attrs.map(x => {const i=x.indexOf('=');return [x.slice(0,i<0?undefined:i).toLowerCase(), i<0?'':x.slice(i+1)];})); const domain = attr.domain ? '.' + attr.domain.replace(/^\./, '') : host; const key = [name, domain, attr.path || '/'].join('|'); if(attr['max-age']==='0')records.delete(key);else records.set(key,{name,value,domain,path:attr.path||'/'}); }
  };
  globalThis.document = doc;
  globalThis.window = { location: {hostname:host,pathname:path,protocol:'https:'}, navigator:{language:'ko-KR'}, localStorage:{setItem(k,v){if(denyStorage)throw Error('blocked');storage.set(k,v);},getItem(k){if(denyStorage)throw Error('blocked');return storage.get(k)??null;}}, dispatchEvent(e){events.push(e);} };
  return { records, storage, events, seed };
}
test('explicit selection retires conflicting host/path cookies without touching login state', () => {
  const env=environment('turboism.dev','/docs/en/use/overview');
  assert.equal(readLanguagePreference(),'ja');
  for (const language of ['ko','en','zh','ja']) {
    persistLanguagePreference(language);
    assert.equal(readLanguagePreference(),language);
    const preferences=[...env.records.values()].filter(c=>c.name==='turboism-language');
    assert.deepEqual(preferences,[{name:'turboism-language',value:language,domain:'.turboism.dev',path:'/'}]);
    assert.equal([...env.records.values()].find(c=>c.name==='session').value,'keep');
    assert.equal(env.events.at(-1).type,'turboism:language');
    assert.equal(env.events.at(-1).detail,language);
  }
});
test('subdomain migration and blocked storage still preserve the selected language', () => {
  environment('docs.turboism.dev','/docs/ko',true);
  persistLanguagePreference('ko'); assert.equal(readLanguagePreference(),'ko');
});
test('preview hosts keep an origin-local cookie and invalid preferences do nothing', () => {
  const env=environment('example.vercel.app');persistLanguagePreference('ko');
  assert.ok([...env.records.values()].some(c=>c.name==='turboism-language'&&c.domain==='example.vercel.app'&&c.value==='ko'));
  const before=document.cookie;persistLanguagePreference('kr');assert.equal(document.cookie,before);
});
test('both current and legacy local-storage readers see the same explicit selection', () => {
  const env=environment();persistLanguagePreference('ko');
  for(const key of ['turboism-language','turboism-interface-language','turboism.learn.locale'])assert.equal(env.storage.get(key),'ko');
});
