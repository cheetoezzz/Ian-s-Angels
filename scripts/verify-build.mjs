import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { resolveHosting } from '../config/hosting.mjs';
const { site, base } = resolveHosting();
const prefix = base.replace(/\/?$/, '/');
const root = path.resolve('dist');
const origin = new URL(site).origin;
let references = 0;
function verify(ref, parent) {
  if (!ref || ref.startsWith('#') || ref.startsWith('data:')) return;
  const url = new URL(ref.replaceAll('&amp;', '&'), parent);
  if (url.origin !== origin) return;
  assert.ok(url.pathname.startsWith(prefix), `Wrong base: ${url.pathname}`);
  const relative = decodeURIComponent(url.pathname.slice(prefix.length)) || 'index.html';
  const file = path.resolve(root, relative);
  assert.ok(file.startsWith(root + path.sep), `Outside build: ${ref}`);
  assert.ok(fs.existsSync(file) && fs.statSync(file).isFile(), `Missing asset/page: ${url.pathname}`);
  references++;
}
const pages = ['index', 'scoring', 'leaderboard', 'sessions', 'players', 'data'];
for (const page of pages) {
  const html = fs.readFileSync(path.join(root, `${page}.html`), 'utf8');
  const parent = `${origin}${prefix}${page}.html`;
  for (const match of html.matchAll(/(?:src|href)=["']([^"']+)["']/g)) verify(match[1], parent);
  assert.ok(/rel="stylesheet"/.test(html), `Missing stylesheet on ${page}`);
  assert.ok(/type="module"/.test(html), `Missing browser module on ${page}`);
  if (base === '/') assert.ok(!html.includes('/Ian-s-Angels/'), `GitHub Pages URL leaked into ${page}`);
}
for (const name of ['manifest.json', 'manifest.webmanifest']) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
  const parent = `${origin}${prefix}${name}`;
  verify(manifest.start_url, parent);
  assert.equal(new URL(manifest.scope, parent).pathname, prefix);
  manifest.icons.forEach(icon => verify(icon.src, parent));
}
const worker = fs.readFileSync(path.join(root, 'service-worker.js'), 'utf8');
const assets = JSON.parse(worker.match(/const ASSETS = (\[[^\n]+\]);/)[1]);
assets.forEach(ref => verify(ref, `${origin}${prefix}service-worker.js`));
assert.ok(assets.includes('./scoring.html') && assets.some(asset => asset.includes('/_astro/')));
for (const name of ['ian.png', 'ian2.png', 'kampo-logo-white.svg', 'kampo-emblem-white.svg']) {
  verify(`images/${name}`, `${origin}${prefix}index.html`);
}
console.log(`PASS: ${base === '/' ? 'Vercel' : 'GitHub Pages'} build (${prefix}): ${pages.length} pages, ${references} local references, manifests, all images and ${assets.length} offline resources`);
