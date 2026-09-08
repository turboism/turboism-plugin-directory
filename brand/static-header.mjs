import { readFileSync } from 'node:fs';
const navigation = JSON.parse(readFileSync(new URL('./navigation.json', import.meta.url), 'utf8'));
const escape = value => String(value).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;');
export function renderStaticHeader(active = 'sdk', locale = 'en') {
 const text=navigation.labels[locale] ?? navigation.labels.en;
 const nav=`<nav class="tb-nav" aria-label="${escape(text.nav)}">${navigation.links.map(([key,href])=>`<a href="${escape(href)}" data-tb-label="${key}"${key===active?' aria-current="page"':''}>${escape(text[key])}</a>`).join('')}</nav>`;
 const language=`<div class="tb-language"><div class="tb-locale" role="group" aria-label="Interface language">${['en','zh','ja'].map(value=>`<button type="button" data-tb-lang="${value}" lang="${value==='zh'?'zh-CN':value}" aria-pressed="${value===locale}">${({en:'EN',zh:'中文',ja:'日本語'})[value]}</button>`).join('')}</div></div>`;
 const socials=`<div class="tb-socials">${navigation.socials.map(item=>`<a class="tb-icon" href="${escape(item.href)}" target="_blank" rel="noopener noreferrer" aria-label="Turboism ${item.name}" title="${item.name}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${item.path}"/></svg></a>`).join('')}</div>`;
 return `<header data-turboism-nav data-turboism-brand="${navigation.version}" class="tb-header"><div class="tb-header-row"><a class="tb-logo" href="https://turboism.dev/" aria-label="Turboism">Turboism.</a>${nav}${language}${socials}<details class="tb-menu"><summary aria-label="${escape(text.menu)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg></summary><div class="tb-menu-panel">${nav}${language}</div></details></div></header>`;
}
export const staticHeaderScript = `(() => {
 const labels=${JSON.stringify(navigation.labels)};
 const header=document.querySelector('[data-turboism-nav]'); if(!header)return;
 const change=(locale,persist)=>{if(!labels[locale])return;header.lang=locale==='zh'?'zh-CN':locale;
  header.querySelectorAll('[data-tb-label]').forEach(link=>link.textContent=labels[locale][link.dataset.tbLabel]);
  header.querySelectorAll('nav').forEach(nav=>nav.setAttribute('aria-label',labels[locale].nav));
  header.querySelector('summary').setAttribute('aria-label',labels[locale].menu);
  header.querySelectorAll('[data-tb-lang]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.tbLang===locale)));
  if(persist){const domain=location.hostname==='turboism.dev'||location.hostname.endsWith('.turboism.dev')?'; Domain=.turboism.dev':'';document.cookie='turboism-language='+locale+'; Path=/; Max-Age=31536000; SameSite=Lax'+domain+(location.protocol==='https:'?'; Secure':'');}
 };
 const saved=document.cookie.split('; ').find(item=>item.startsWith('turboism-language='))?.split('=')[1];change(saved||'en',false);
 header.querySelectorAll('[data-tb-lang]').forEach(button=>button.addEventListener('click',()=>change(button.dataset.tbLang,true)));
})();`;
