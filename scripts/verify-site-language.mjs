/** Browser regression for one independently deployed site; never launches native QQ. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const site=process.env.SITE_NAME||'www',local=process.env.SITE_ORIGIN||'http://127.0.0.1:3000';
const publicOrigin='https://turboism.dev';
const routes={www:['/','/download','/sponsor'],docs:['/docs/en','/docs/en/use/overview','/docs/sdk/index.html'],learn:['/learn?lang=zh&layout=A'],'plugin-directory':['/plugins'],thanks:['/thanks']}[site];
assert.ok(routes,'Unknown site');
const report=[];await mkdir('artifacts/site-language',{recursive:true});
for(let i=0;i<60;i++){try{if((await fetch(local+routes[0],{signal:AbortSignal.timeout(25000)})).ok)break;}catch{}if(i===59)throw Error('Server did not become ready');await new Promise(r=>setTimeout(r,1000));}
const browser=await chromium.launch({headless:true});
try {
 for(const width of [1440,390])for(const routePath of routes){
  const context=await browser.newContext({viewport:{width,height:844},reducedMotion:'reduce'});
  // This test domain is intercepted to the local production build so browser
  // cookie scope matches the real apex/subdomain setup, without editing live data.
  if(!process.env.LANGUAGE_LIVE_ONLY)await context.route(publicOrigin+'/**',async route=>{
   const url=local+route.request().url().slice(publicOrigin.length);
   try {const response=await route.fetch({url,maxRedirects:0});await route.fulfill({response});}catch{await route.abort();}
  });
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{document.addEventListener('click',event=>{if(event.target.closest?.('[data-qq-trigger],[data-qq-launch]'))event.preventDefault();},true);});
  await context.addCookies([{name:'turboism-language',value:'zh',url:publicOrigin+'/'},{name:'turboism-language',value:'en',domain:'.turboism.dev',path:'/',secure:true},{name:'language-test-unrelated',value:'keep',url:publicOrigin+'/'}]);
  const response=await page.goto(publicOrigin+routePath,{waitUntil:'networkidle',timeout:45000});assert.equal(response.status(),200);
  const header=page.locator('header.tb-header').first();await header.waitFor();
  const sdk=routePath.includes('/sdk/');
  for(const locale of ['ko','zh','en','ja','ko']){
   const htmlLang=locale==='zh'?'zh-CN':locale;
   const desktop=header.locator(`.tb-header-row > .tb-language button[lang="${htmlLang}"]`);
   let button=desktop;
   if(!await desktop.isVisible()){
    const menu=header.locator('.tb-menu');if(!await menu.evaluate(node=>node.open))await menu.locator('summary').click();
    button=header.locator(`.tb-menu-panel button[lang="${htmlLang}"]`);
   }
   await button.click();
   await page.waitForFunction(({sdk,htmlLang})=>sdk?document.querySelector('[data-turboism-nav]')?.getAttribute('lang')===htmlLang:document.documentElement.lang===htmlLang,{sdk,htmlLang},{timeout:15000});
   const visible=header.locator(`button[lang="${htmlLang}"][aria-pressed=true]`);assert.ok(await visible.count()>0);
   const cookies=(await context.cookies()).filter(c=>c.name==='turboism-language');
   assert.equal(cookies.length,1,JSON.stringify(cookies));assert.equal(cookies[0].domain,'.turboism.dev');assert.equal(cookies[0].value,locale);assert.equal(cookies[0].path,'/');
   assert.equal((await context.cookies()).find(c=>c.name==='language-test-unrelated')?.value,'keep');
   if(locale==='ko'&&!sdk)assert.match(await page.locator('main').allTextContents().then(rows=>rows.join(' ')),/[가-힣]/,'Korean body UI must update, not just the header');
   if(site==='learn'){assert.equal(new URL(page.url()).searchParams.get('lang'),locale);assert.equal(new URL(page.url()).searchParams.get('layout'),'A');}
   const menu=header.locator('.tb-menu');if(await menu.evaluate(node=>node.open))await menu.locator('summary').click();
  }
  await page.reload({waitUntil:'networkidle'});
  await page.waitForFunction(sdk=>sdk?document.querySelector('[data-turboism-nav]')?.getAttribute('lang')==='ko':document.documentElement.lang==='ko',sdk);
  if(site==='docs'&&routePath.includes('/use/')){assert.equal(await page.locator('[data-language-fallback=en]').count(),1);assert.match(await page.locator('[data-language-fallback=en]').textContent(),/영어/);}
  assert.deepEqual(errors,[]);
  report.push({site,width,route:routePath,url:page.url(),switches:5,legacyCookieMigrated:true,reload:true});
  await page.screenshot({path:`artifacts/site-language/${site}-${width}-${routes.indexOf(routePath)}.png`,fullPage:true});
  await context.close();
 }
}finally{await browser.close();await writeFile('artifacts/site-language/report.json',JSON.stringify(report,null,2));}
console.log(`PASS ${site}: ${report.length} route/viewport workflows, actual button clicks, old-cookie migration and reload persistence.`);
