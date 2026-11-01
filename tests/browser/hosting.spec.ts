import { test, expect } from '@playwright/test';
import { resolveHosting } from '../../config/hosting.mjs';
const prefix=resolveHosting().base.replace(/\/?$/, '/');

test('production CSS, modules, navigation, KAMPO artwork and manifests use the selected host base',async({page})=>{
  const errors:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  for(const route of ['index','scoring','leaderboard','sessions','players','data']) {
    await page.goto(route+'.html');
    const refs=await page.evaluate(()=>[...document.querySelectorAll('link[href],script[src],img[src],svg image[href],svg use[href]')]
      .map(el=>el.getAttribute('src')||el.getAttribute('href')).filter(Boolean));
    const checked=new Set<string>();
    for(const ref of refs) {
      const url=new URL(ref!,page.url());url.hash='';
      if(url.origin!==new URL(page.url()).origin||checked.has(url.href))continue;
      checked.add(url.href);
      expect(url.pathname.startsWith(prefix)).toBe(true);
      if(prefix==='/')expect(url.pathname).not.toContain('/Ian-s-Angels/');
      const response=await page.request.get(url.href);
      expect(response.status(),url.pathname).toBe(200);
      const contentType=response.headers()['content-type'];
      if(url.pathname.endsWith('.css'))expect(contentType).toContain('text/css');
      if(url.pathname.endsWith('.js'))expect(contentType).toMatch(/javascript/);
      if(url.pathname.endsWith('.svg'))expect(contentType).toContain('image/svg+xml');
    }
    if(route!=='scoring') {
      expect(await page.locator('body').evaluate(el=>getComputedStyle(el).backgroundColor)).toBe('rgb(247, 247, 247)');
      expect(await page.locator('.skip-link').evaluate(el=>el.getBoundingClientRect().top)).toBeLessThan(0);
      await expect.poll(()=>page.locator('.header .brand-stacked').evaluate((el:HTMLImageElement)=>el.complete&&el.naturalWidth>0)).toBe(true);
      const hrefs=await page.locator('#dashboardMenu a').evaluateAll(links=>links.map(link=>(link as HTMLAnchorElement).pathname));
      expect(hrefs).toEqual(['index','scoring','leaderboard','sessions','players'].map(route=>prefix+route+'.html'));
    }
  }
  for(const image of ['ian.png','ian2.png','kampo-logo-white.svg','kampo-emblem-white.svg']) {
    const response=await page.request.get('images/'+image);
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('image/');
  }
  const response=await page.request.get('manifest.webmanifest'),manifest=await response.json();
  const manifestUrl=new URL(prefix+'manifest.webmanifest',page.url());
  expect(new URL(manifest.scope,manifestUrl).pathname).toBe(prefix);
  expect(new URL(manifest.start_url,manifestUrl).pathname).toBe(prefix+'index.html');
  for(const icon of manifest.icons)expect((await page.request.get(new URL(icon.src,manifestUrl).href)).status()).toBe(200);
  expect(errors).toEqual([]);
});

test('worker scope, navigation and existing stored data survive offline use for this host',async({page,context})=>{
  await page.goto('index.html');
  const preserved=JSON.stringify({schemaVersion:3,players:[],settings:{currentGameNumber:0,currentSessionNumber:0},activeSession:null,pastSessions:[],hostingPreservationCheck:'unchanged'});
  await page.evaluate(value=>localStorage.setItem('pickleball_queue_data',value),preserved);
  await page.reload();
  const scope=await page.evaluate(async()=>{
    const registration=await navigator.serviceWorker.ready;
    if(!navigator.serviceWorker.controller)await new Promise<void>(resolve=>navigator.serviceWorker.addEventListener('controllerchange',()=>resolve(),{once:true}));
    return new URL(registration.scope).pathname;
  });
  expect(scope).toBe(prefix);
  await context.setOffline(true);
  for(const route of ['index','players','leaderboard','sessions','data']) {
    await page.goto(route+'.html');
    await expect(page.locator('#'+(route==='index'?'queue':route)+'-tab')).toHaveClass(/active/);
    expect(await page.evaluate(()=>localStorage.getItem('pickleball_queue_data'))).toBe(preserved);
  }
  await page.goto('scoring.html?match=hosting-offline-test');
  await expect(page.locator('#scoringContent')).toContainText('No active match to score');
  expect(await page.evaluate(()=>localStorage.getItem('pickleball_queue_data'))).toBe(preserved);
  await context.setOffline(false);
});
