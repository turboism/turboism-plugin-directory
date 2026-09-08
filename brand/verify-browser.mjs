import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const navigation=JSON.parse(await readFile(new URL('./navigation.json',import.meta.url),'utf8'));
const origin=process.env.SITE_ORIGIN||'http://127.0.0.1:3000';
const route=process.env.BRAND_ROUTE||'/', site=process.env.BRAND_SITE||'home';
await mkdir('artifacts/brand',{recursive:true});
for(let i=0;i<75;i++){try{if((await fetch(origin+route)).ok)break;}catch{}if(i===74)throw new Error('Site did not start');await new Promise(resolve=>setTimeout(resolve,1000));}
const browser=await chromium.launch({headless:true});const report=[];
try{
 for(const width of [1440,375]){
  const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'});
  await page.goto(origin+route,{waitUntil:'networkidle'});
  for(const locale of ['en','zh','ja']){
   const header=page.locator('header.tb-header');assert.equal(await header.count(),1);
   assert.equal(await header.getAttribute('data-turboism-brand'),navigation.version);
   if(width<1200)await header.locator('summary').click();
   const group=header.locator(width<1200?'.tb-menu-panel .tb-locale':'.tb-header-row > .tb-language .tb-locale');
   await group.locator(`button[lang="${locale==='zh'?'zh-CN':locale}"]`).click();
   await page.waitForFunction(locale=>document.documentElement.lang===(locale==='zh'?'zh-CN':locale),locale);
   if(width<1200 && await header.locator('.tb-menu').getAttribute('open')!==null)await header.locator('summary').click();
   await page.evaluate(()=>document.fonts.ready);
   const row=header.locator('.tb-header-row');
   assert.deepEqual(await row.locator(':scope > nav > a').evaluateAll(nodes=>nodes.map(a=>[a.getAttribute('href'),a.textContent])),navigation.links.map(([key,href])=>[href,navigation.labels[locale][key]]));
   assert.equal(await row.locator(':scope > nav > a[aria-current="page"]').count(),1);
   assert.equal(await row.locator(':scope > nav > a[aria-current="page"]').getAttribute('href'),navigation.links.find(([key])=>key===site)[1]);
   assert.equal(await row.locator(':scope > .tb-tools').count(),0);
   assert.deepEqual(await row.locator('.tb-socials > a').evaluateAll(nodes=>nodes.map(a=>a.getAttribute('href'))),navigation.socials.map(item=>item.href));
   const css=await header.evaluate(node=>{const h=getComputedStyle(node),logo=getComputedStyle(node.querySelector('.tb-logo'));return{height:h.height,background:h.backgroundColor,font:h.fontFamily,logo:logo.color,overflow:document.documentElement.scrollWidth>innerWidth};});
   assert.equal(css.height,'80px');assert.equal(css.background,'rgb(252, 251, 247)');assert.equal(css.logo,'rgb(106, 90, 205)');assert.match(css.font,/geist/i);assert.equal(css.overflow,false,`${site}/${locale}/${width} horizontal overflow`);
   await page.evaluate(()=>{document.activeElement?.blur();scrollTo(0,0)});
   await page.screenshot({path:`artifacts/brand/${site}-${locale}-${width}.png`,fullPage:true});report.push({site,locale,width,...css});
  }
  await page.close();
 }
 if(process.env.BRAND_SDK_ROUTE){
  const page=await browser.newPage({viewport:{width:375,height:900}});
  await page.goto(origin+process.env.BRAND_SDK_ROUTE,{waitUntil:'networkidle'});
  assert.equal(await page.locator('header.tb-header').count(),1);
  await page.locator('header.tb-header summary').click();
  await page.locator('.tb-menu-panel [data-tb-lang="zh"]').click();
  assert.equal(await page.locator('.tb-menu-panel [data-tb-label="home"]').textContent(),'首页');
  assert.equal(await page.locator('.tb-menu-panel [data-tb-label="thanks"]').getAttribute('href'),'https://turboism.dev/thanks');
  await page.locator('header.tb-header summary').click();
  await page.evaluate(()=>document.fonts.ready);
  assert.match(await page.locator('.tb-logo').evaluate(node=>getComputedStyle(node).fontFamily),/geist/i);
  await page.screenshot({path:'artifacts/brand/sdk-zh-375.png',fullPage:true});await page.close();
 }
} finally {await browser.close();await writeFile('artifacts/brand/report.json',JSON.stringify(report,null,2));}
console.log(`Verified ${report.length} shared-header, locale, palette and mobile workflows.`);
