// Run the original behavior assertions against compiled migrated TypeScript.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Module = require('node:module');
const ts = require('typescript');
const originalRead = fs.readFileSync;
const originalLoad = Module._load;
const cache = new Map();
function compile(file) {
  let source = originalRead(file,'utf8');
  source = source.replaceAll('import.meta.env.BASE_URL', "'/Ian-s-Angels/'");
  return ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
}
function load(file) {
  if(cache.has(file)) return cache.get(file).exports;
  const mod={exports:{}}; cache.set(file,mod);
  const localRequire = id => id.startsWith('.') ? load(path.resolve(path.dirname(file),id)+(id.endsWith('.ts')?'':'.ts')) : require(id);
  vm.runInThisContext(Module.wrap(compile(file)),{filename:file})(mod.exports,localRequire,mod,file,path.dirname(file));
  return mod.exports;
}
const engine=load(path.resolve('src/lib/scoring/engine.ts')).ScoringEngine;
Module._load = function(id,parent,isMain) { if(id==='./scoring-engine.js') return engine; return originalLoad.call(this,id,parent,isMain); };
const originalContext = vm.createContext;
vm.createContext = function(ctx, options) {
  if(ctx?.localStorage) {
    const mod = {exports:{}};
    const storeFile = path.resolve('src/state/appStore.ts');
    const store = {};
    ctx.exports = mod.exports;
    ctx.module = mod;
    ctx.require = id => {
      if(id==='./scoring/engine') return {ScoringEngine:engine};
      if(id==='./paths') return {pageUrl:(page='index',query='')=>`/Ian-s-Angels/${page}.html${query}`,assetUrl:p=>'/Ian-s-Angels/'+p};
      if(id==='./dom') return {byId:ctx.document.getElementById};
      if(id==='./icons') return load(path.resolve('src/lib/icons.ts'));
      if(id==='./queue/participation') return load(path.resolve('src/lib/queue/participation.ts'));
      if(id==='./queue/rotation') return load(path.resolve('src/lib/queue/rotation.ts'));
      if(id==='../scripts/roster') return load(path.resolve('src/scripts/roster.ts'));
      if(id==='./feedback') return {confirmAction:message=>ctx.confirm(message),emptyState:load(path.resolve('src/lib/feedback.ts')).emptyState,notify:()=>{}};
      if(id==='../state/appStore') return store;
      throw new Error('Unexpected test import '+id);
    };
    const context = originalContext(ctx,options);
    const storeContext = originalContext({exports:store,localStorage:ctx.localStorage,WeakMap,Set,JSON,Error});
    vm.runInContext(compile(storeFile),storeContext);
    return context;
  }
  return originalContext(ctx,options);
};
fs.readFileSync = function(file,...args) {
  if(file==='app.js') return compile(path.resolve('src/lib/application.ts'));
  return originalRead.call(this,file,...args);
};
require('../queue.test.cjs');
require('../scoring-engine.test.cjs');
vm.createContext = originalContext;
require('./storage.cjs');
require('./migration.cjs')(load(path.resolve('src/lib/application.ts')),engine);
require('./rotation.cjs')({P:load(path.resolve('src/lib/queue/participation.ts')),R:load(path.resolve('src/lib/queue/rotation.ts')),app:load(path.resolve('src/lib/application.ts'))});
