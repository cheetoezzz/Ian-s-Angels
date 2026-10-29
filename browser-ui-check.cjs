const assert=require('node:assert/strict');
const fs=require('node:fs');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const pages=await (await fetch('http://127.0.0.1:9223/json/list')).json();
 const page=pages.find(p=>p.type==='page');
 const ws=new WebSocket(page.webSocketDebuggerUrl);
 await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
 let seq=0; const pending=new Map(), errors=[];
 ws.onmessage=event=>{const m=JSON.parse(event.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(new Error(m.error.message)):p.resolve(m.result);}if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.text+': '+m.params.exceptionDetails.exception?.description);};
 const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
 const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
 const until=async predicate=>{for(let i=0;i<100;i++){if(await evaluate(predicate))return;await pause(50);}throw new Error('Timed out: '+predicate);};
 const navigate=async url=>{await call('Page.navigate',{url});await until('document.readyState === "complete"');await pause(150);};
 await call('Runtime.enable'); await call('Page.enable');

 const root='http://127.0.0.1:8765/';
 await navigate(root+'index.html');
 await evaluate('Promise.all([navigator.serviceWorker.getRegistrations().then(rs=>Promise.all(rs.map(r=>r.unregister()))),caches.keys().then(ks=>Promise.all(ks.map(k=>caches.delete(k))))])');
 await navigate(root+'index.html');
 await evaluate(`window.confirm=()=>true; let demo=getDefaultData(); demo.players=['Ava Reyes','Noah Tan','Mia Santos','Liam Cruz','Sofia Lim','Ethan Lee','Isla Torres','Lucas Ong'].map((name,i)=>({id:'ui'+i,name,isActive:true,gamesPlayed:0,lastPlayedGameNumber:null,waitingSinceGameNumber:0,partnerHistory:[],opponentHistory:[]})); saveData(demo);startNewSession();generateNextGame();document.getElementById('teamAScoreInput').value='11';document.getElementById('teamBScoreInput').value='8';completeCurrentGame();generateNextGame();`);
 await pause(1200);
 const state=await evaluate('JSON.stringify(loadData())');
 for (const width of [320,375,390,430,768,1024,1280,1440,1920]) {
  await call('Emulation.setDeviceMetricsOverride',{width,height:width<768?844:1000,deviceScaleFactor:1,mobile:width<768});await pause(70);
  const fit=await evaluate(`({width:innerWidth,scroll:document.documentElement.scrollWidth,nav:getComputedStyle(document.getElementById('dashboardMenu')).position,teams:[...document.querySelectorAll('.team-card')].map(x=>({width:x.clientWidth,scroll:x.scrollWidth})),steps:[...document.querySelectorAll('[data-score-step]')].map(x=>({w:x.getBoundingClientRect().width,h:x.getBoundingClientRect().height})),current:document.getElementById('currentGameSection').getBoundingClientRect().width})`);
  console.log('Queue viewport',width,JSON.stringify(fit));
  assert.ok(fit.scroll<=width+1,'Queue has no horizontal overflow at '+width);
  assert.ok(fit.teams.every(x=>x.scroll<=x.width+1),'team cards fit at '+width);
  assert.ok(fit.steps.every(x=>x.w>=44&&x.h>=44),'score buttons meet touch minimum');
  assert.equal(await evaluate('JSON.stringify(loadData())'),state,'resizing preserves every stored record');
  if(width===390||width===1440)await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false}).then(r=>fs.writeFileSync('.scoring-browser-test/ui-'+width+'.png',Buffer.from(r.data,'base64')));
 }
 // A second page shares the same rule, score and rally lock through storage events.
 const scoringTarget=await call('Target.createTarget',{url:root+'scoring.html'});
 const scoringPage=(await (await fetch('http://127.0.0.1:9223/json/list')).json()).find(p=>p.id===scoringTarget.targetId);
 const otherWs=new WebSocket(scoringPage.webSocketDebuggerUrl);await new Promise(r=>otherWs.onopen=r);
 let otherSeq=0;const otherPending=new Map();
 otherWs.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=otherPending.get(m.id);otherPending.delete(m.id);m.error?p.reject(new Error(m.error.message)):p.resolve(m.result);}};
 const otherCall=(method,params={})=>new Promise((resolve,reject)=>{const id=++otherSeq;otherPending.set(id,{resolve,reject});otherWs.send(JSON.stringify({id,method,params}));});
 const otherEval=async expression=>{const r=await otherCall('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description);return r.result.value;};
 await pause(300);
 await otherEval(`const game=loadData().activeSession.currentGame;document.getElementById('firstServingTeam').value='A';document.getElementById('startingRightA').value=game.teamA[0].id;document.getElementById('startingRightB').value=game.teamB[0].id;document.getElementById('setupForm').requestSubmit();`);
 await until('!!loadData().activeSession.currentGame.scoringState');
 await otherEval(`mutateScoring(s=>ScoringEngine.setEndingRule(s,'golden_point'))`);
 await pause(100);
 assert.equal(await otherEval('scoringView.state.endingRule'),'golden_point','scoring page persists selected rule');
 await otherEval(`mutateScoring(s=>ScoringEngine.setEndingRule(s,'standard'))`);await pause(100);
 assert.equal(await evaluate('loadData().activeSession.currentGame.endingRule'),'standard','scoring rule updates Queue');
 await otherEval(`recordRally('A')`);await pause(100);
 assert.equal(await evaluate('document.getElementById("teamAScoreInput").value'),'1','rally updates Queue score');
 assert.equal(await otherEval('document.getElementById("liveEndingRule").disabled'),true,'rally locks scoring rule');
 await otherEval(`mutateScoring(s=>ScoringEngine.reset(s))`);await pause(100);
 assert.equal(await otherEval('document.getElementById("liveEndingRule").disabled'),false,'explicit reset unlocks scoring rule');
 await call('Target.closeTarget',{targetId:scoringTarget.targetId});otherWs.close();
 // Hash navigation uses browser history and moves, rather than duplicates, player controls.
 await evaluate(`document.querySelector('[data-tab="players"]').click()`);await until('location.hash === "#players"');
 assert.equal(await evaluate('document.querySelectorAll("#playerNameInput").length'),1);
 assert.equal(await evaluate('document.querySelector("#playersWorkspace #playerListSection") !== null'),true);
 await evaluate(`document.getElementById('playerNameInput').value='New Player';document.getElementById('addPlayerBtn').click()`);
 assert.equal(await evaluate('loadData().players.length'),9);
 await evaluate(`document.querySelector('.player-toggle:not(:disabled)').click()`);
 assert.equal(await evaluate('loadData().players.some(p=>!p.isActive)'),true);
 await evaluate(`document.querySelector('.player-toggle:not(:disabled)').click()`);
 const navHistory=await call('Page.getNavigationHistory');
 await call('Page.navigateToHistoryEntry',{entryId:navHistory.entries[navHistory.currentIndex-1].id});await until('document.getElementById("queue-tab").classList.contains("active")');
 assert.equal(await evaluate('document.querySelector("#queueAddSlot #playerNameInput") !== null'),true);
 await call('Page.navigateToHistoryEntry',{entryId:navHistory.entries[navHistory.currentIndex].id});await until('document.getElementById("players-tab").classList.contains("active")');
 await navigate(root+'index.html#queue');
 assert.equal(await evaluate('loadData().players.length'),9,'players survive reload');
 await evaluate(`document.getElementById('teamAScoreInput').value='3';document.getElementById('teamBScoreInput').value='2';`);
 assert.equal(await evaluate('document.querySelector(".ending-rule-control")'),null,'Queue has no ending-rule selector');
 await evaluate(`document.querySelector('[data-score-team="A"][data-score-step="1"]').click()`);
 assert.equal(await evaluate('document.getElementById("teamAScoreInput").value'),'4');
 await evaluate(`document.getElementById('completeGameBtn').click()`);await until('!loadData().activeSession.currentGame');
 assert.equal(await evaluate('loadData().activeSession.games.length'),2);
 assert.equal(await evaluate('document.getElementById("startNextGameBtn").disabled'),false);
 assert.ok(await evaluate('document.getElementById("leaderboardPreview").textContent.includes("Ava") || document.getElementById("leaderboardPreview").textContent.includes("Mia")'));
 await evaluate(`document.querySelector('[data-tab="leaderboard"]').click()`);await until('location.hash === "#leaderboard"');
 assert.equal(await evaluate('!!document.querySelector(".podium")'),false);
 await evaluate(`const search=document.getElementById('leaderboardSearch');search.value='no such player';search.dispatchEvent(new Event('input'));`);
 assert.equal(await evaluate('document.getElementById("leaderboardRows").textContent.includes("No scored")'),true);
 await evaluate(`document.getElementById('leaderboardSearch').value='';document.getElementById('leaderboardSearch').dispatchEvent(new Event('input'));endSession();`);
 assert.equal(await evaluate('document.querySelectorAll(".podium-card").length'),3);
 await evaluate(`document.querySelector('[data-tab="sessions"]').click()`);await until('location.hash === "#sessions"');
 await evaluate(`document.querySelector('.expand-btn').click()`);
 assert.equal(await evaluate('document.querySelectorAll(".session-game-item").length'),2);
 await evaluate(`document.querySelector('.results-btn').click()`);await until('location.hash === "#leaderboard"');
 assert.equal(await evaluate('document.querySelectorAll(".podium-card").length'),3);
 for(const width of [320,375,390,430,1024,1280,1440,1920]) {
  await call('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<768});
  for(const view of ['leaderboard','players','sessions','data']) {
   await evaluate(`document.querySelector('[data-tab="${view}"]').click()`);await until(`document.getElementById('${view}-tab').classList.contains('active')`);
   assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth+1'),true,view+' fits '+width);
  }
 }
 // Exercise existing export/import with browser FileReader and preserve completed history.
 await call('Browser.setDownloadBehavior',{behavior:'deny'});
 const backup=await evaluate(`(async()=>{const create=URL.createObjectURL;let exported;URL.createObjectURL=blob=>{exported=blob;return create(blob);};exportJson();URL.createObjectURL=create;return await exported.text();})()`);
 const beforeImport=await evaluate('JSON.stringify(loadData())');
 await evaluate(`window.confirm=()=>true;importJson(new File([${JSON.stringify(backup)}],'backup.json',{type:'application/json'}));`);
 await until('document.getElementById("toast").textContent.includes("Backup imported")');
 assert.equal(await evaluate('JSON.stringify(loadData())'),beforeImport,'backup roundtrip retains players, completed matches and final rankings');
 await navigate(root+'index.html#queue');
 await evaluate(`document.querySelector('[data-tab="scoring"]').click()`);await until('location.pathname.endsWith("scoring.html") && document.getElementById("scoringContent")');
 assert.equal(await evaluate('loadData().activeSession'),null,'empty Scoring tab never starts a session');
 assert.equal(await evaluate('document.getElementById("scoringContent").textContent.includes("No active match")'),true);
 assert.deepEqual(errors,[],'no uncaught browser errors');
 console.log('PASS: responsive Queue at 320/375/390/430/768/1024/1280/1440/1920, touch controls, data preservation, Players and history navigation, add/status management, direct completion, next-game readiness, previews, search, final podium, session history, cross-tab score sync and rule persistence, rally lock, backup roundtrip and empty Scoring');
 ws.close();
})().catch(e=>{console.error(e);process.exit(1);});
