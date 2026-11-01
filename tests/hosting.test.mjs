import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { resolveHosting } from '../config/hosting.mjs';
test('local/default and GitHub Pages keep the repository base', () => {
  assert.deepEqual(resolveHosting({}), { site:'https://cheetoezzz.github.io',base:'/Ian-s-Angels' });
  assert.deepEqual(resolveHosting({KAMPO_DEPLOY_TARGET:'github-pages',VERCEL:'1'}), resolveHosting({}));
});
test('Vercel production and preview use root assets and the production site', () => {
  assert.deepEqual(resolveHosting({VERCEL:'1'}), {site:'https://kampo-delta.vercel.app',base:'/'});
  assert.deepEqual(resolveHosting({KAMPO_DEPLOY_TARGET:'vercel'}), resolveHosting({VERCEL:'1'}));
  assert.deepEqual(resolveHosting({VERCEL:'1',VERCEL_ENV:'preview',VERCEL_URL:'preview.vercel.app',VERCEL_PROJECT_PRODUCTION_URL:'pickleball.example'}), {site:'https://pickleball.example',base:'/'});
  assert.throws(()=>resolveHosting({KAMPO_DEPLOY_TARGET:'invalid'}),/KAMPO_DEPLOY_TARGET/);
});
test('Vercel builds the static Astro output with the explicit Vercel target', () => {
  const config=JSON.parse(fs.readFileSync(new URL('../vercel.json',import.meta.url),'utf8'));
  assert.equal(config.framework,'astro');
  assert.equal(config.buildCommand,'npm run build:vercel');
  assert.equal(config.outputDirectory,'dist');
  assert.equal(config.cleanUrls,false,'retain .html routes for navigation and offline caching');
});
