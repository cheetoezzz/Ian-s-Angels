import { test, expect, type Page } from '@playwright/test';

const key = 'pickleball_queue_data';
const names = ['Ava Reyes','Noah Tan','Mia Santos','Liam Cruz','Sofia Lim','Ethan Lee','Isla Torres','Lucas Ong'];
async function seed(page: Page) {
  await page.goto('index.html');
  await page.evaluate(({key,names}) => localStorage.setItem(key,JSON.stringify({
    players:names.map((name,i)=>({id:'p'+i,name,isActive:true,gamesPlayed:0,lastPlayedGameNumber:null,waitingSinceGameNumber:0,partnerHistory:[],opponentHistory:[]})),
    settings:{currentGameNumber:0,currentSessionNumber:0},activeSession:null,pastSessions:[]
  })),{key,names});
  await page.reload();
  await page.locator('#startSessionBtn').click();
  await page.locator('#confirmQueueModeBtn').click();
  await page.locator('#manageCheckInBtn').click();
  await page.locator('#checkInAllBtn').click();
  await acceptConfirmation(page);
  await page.locator('#closeParticipationBtn').click();
  await page.locator('#startNextGameBtn').click();
  await expect(page.locator('#teamAScoreInput')).toBeVisible();
  await expect(page.locator('#sessionAnimation')).not.toBeVisible();
}
async function data(page:Page) { return page.evaluate(key=>JSON.parse(localStorage.getItem(key)!),key); }
async function acceptConfirmation(page:Page) {
  await expect(page.locator('.feedback-confirm')).toBeVisible();
  await page.locator('.feedback-accept').click();
  await expect(page.locator('.feedback-confirm')).toHaveCount(0);
}
async function scoring(page:Page) {
  await page.locator('.open-scoring-btn').click();
  await expect(page.locator('#setupDialog')).toBeVisible();
  await page.locator('#firstServingTeam').selectOption('A');
  await page.locator('#startingRightA').selectOption({index:1});
  await page.locator('#startingRightB').selectOption({index:1});
  // Orientation/fullscreen support remains optional; omit it in automated desktop runs.
  await page.evaluate(()=>{document.documentElement.requestFullscreen=undefined as any;});
  await page.locator('#setupForm button[type=submit]').click();
  await expect(page.locator('#rallyA')).toBeVisible();
}
test.beforeEach(async({page})=>{
  page.on('dialog',dialog=>dialog.accept());
});

test('empty states, inline errors, success notices and confirmation decisions are accessible',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto('index.html');
  await expect(page.locator('#playerListSection')).toContainText('No players added yet');
  await expect(page.locator('#sessionSection .feedback-empty-icon')).toBeVisible();
  await page.locator('#addPlayerBtn').click();
  await expect(page.locator('#playerNameInput')).toHaveAttribute('aria-invalid','true');
  await expect(page.locator('#playerNameError')).toContainText('Enter a player name');
  await expect(page.locator('#toast')).toHaveAttribute('role','alert');
  await expect(page.locator('#toast')).toHaveCSS('opacity','1');
  await page.screenshot({path:'.scoring-browser-test/feedback-error.png',fullPage:true});
  await page.locator('#toast .feedback-dismiss').click();
  await expect(page.locator('#toast')).not.toBeVisible();
  await page.locator('#playerNameInput').fill('New player');
  await expect(page.locator('#playerNameError')).not.toBeVisible();
  await page.locator('#addPlayerBtn').click();
  await expect(page.locator('#toast')).toHaveAttribute('role','status');
  await expect(page.locator('#toast')).toContainText('New player');
  await expect(page.locator('#toast')).toHaveCSS('opacity','1');
  await page.screenshot({path:'.scoring-browser-test/feedback-success.png'});
  await seed(page);
  await page.locator('#teamAScoreInput').fill('3');
  await page.locator('#teamBScoreInput').fill('2');
  await page.locator('#completeGameBtn').click();
  await expect(page.locator('#feedbackConfirmTitle')).toHaveText('Save this result?');
  await expect(page.locator('.feedback-cancel')).toBeFocused();
  expect((await data(page)).activeSession.games).toHaveLength(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('.feedback-confirm')).toHaveCount(0);
  await expect(page.locator('#completeGameBtn')).toBeFocused();
  expect((await data(page)).activeSession.games).toHaveLength(0);
  await page.locator('#completeGameBtn').click();
  for(const width of [320,390,1440]) {
    await page.setViewportSize({width,height:844});
    const bounds=await page.locator('.feedback-confirm').boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x+bounds!.width).toBeLessThanOrEqual(width);
  }
  await page.screenshot({path:'.scoring-browser-test/feedback-confirm.png'});
  await page.locator('.feedback-cancel').click();
  expect((await data(page)).activeSession.games).toHaveLength(0);
  await page.locator('#completeGameBtn').click();
  await acceptConfirmation(page);
  await expect(page.locator('#toast')).toContainText('completed');
  expect((await data(page)).activeSession.games).toHaveLength(1);
  await page.evaluate(()=>{
    const original=Storage.prototype.setItem;
    (window as any).restoreStorage=()=>{Storage.prototype.setItem=original;};
    Storage.prototype.setItem=()=>{throw new DOMException('Quota exceeded','QuotaExceededError');};
  });
  const count=(await data(page)).players.length;
  await page.locator('[data-tab=queue]').click();
  await page.locator('#playerNameInput').fill('Unsaved player');
  await page.locator('#addPlayerBtn').click();
  await expect(page.locator('#toast')).toHaveClass(/error/);
  await expect(page.locator('#toast')).toContainText('couldn’t be saved');
  expect((await data(page)).players).toHaveLength(count);
  await page.evaluate(()=>(window as any).restoreStorage());
});

test('a pending cancellation cannot cancel a replacement match',async({page})=>{
  await seed(page);
  await page.locator('#cancelGameBtn').click();
  await expect(page.locator('.feedback-confirm')).toBeVisible();
  await page.evaluate(key=>{
    const value=JSON.parse(localStorage.getItem(key)!);
    value.activeSession.currentGame.gameId='replacement-match';
    localStorage.setItem(key,JSON.stringify(value));
  },key);
  await acceptConfirmation(page);
  expect((await data(page)).activeSession.currentGame.gameId).toBe('replacement-match');
  await expect(page.locator('#toast')).toContainText('match changed');
});

test('scoring setup presents required-field errors inside the form',async({page})=>{
  await seed(page);
  await page.locator('.open-scoring-btn').click();
  await page.locator('#setupForm button[type=submit]').click();
  await expect(page.locator('#setupError')).toHaveText('Choose the team that will serve first.');
  await expect(page.locator('#firstServingTeam')).toBeFocused();
  await expect(page.locator('#firstServingTeam')).toHaveAttribute('aria-invalid','true');
  await page.locator('#firstServingTeam').selectOption('A');
  await expect(page.locator('#setupError')).not.toBeVisible();
  await page.locator('#setupForm button[type=submit]').click();
  await expect(page.locator('#setupError')).toHaveText('Choose Team A’s starting right-side player.');
  await page.setViewportSize({width:667,height:375});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.screenshot({path:'.scoring-browser-test/feedback-scoring-validation.png'});
});

test('registration, dedicated pages, navigation and direct completion preserve IDs and history',async({page})=>{
  const errors:string[]=[]; page.on('pageerror',e=>errors.push(e.message));
  await seed(page);
  const pending=(await data(page)).activeSession.pendingGame.gameId;
  await page.locator('#teamAScoreInput').fill('3');
  await page.locator('#teamBScoreInput').fill('2');
  await page.locator('#completeGameBtn').click();
  await acceptConfirmation(page);
  await expect(page.locator('#startNextGameBtn')).toBeEnabled();
  expect((await data(page)).activeSession.games).toHaveLength(1);
  await page.locator('#startNextGameBtn').click();
  expect((await data(page)).activeSession.currentGame.gameId).toBe(pending);
  await page.goto('players.html');
  await expect(page.locator('#players-tab')).toHaveClass(/active/);
  await page.locator('#playerNameInput').fill('New Player');
  await page.locator('#addPlayerBtn').click();
  expect((await data(page)).players).toHaveLength(9);
  const availableRow=page.locator('.roster-row').filter({has:page.locator('.player-toggle:not(:disabled)')}).first();
  await availableRow.locator('summary').click();
  await availableRow.locator('.player-toggle').click();
  expect((await data(page)).players.some(p=>!p.isActive)).toBe(true);
  await page.goto('leaderboard.html');
  await expect(page.locator('#leaderboard-tab')).toHaveClass(/active/);
  await expect(page.locator('.podium')).toHaveCount(0);
  await expect(page.locator('#leaderboardRows tbody tr')).toHaveCount(4);
  await page.locator('#leaderboardSearch').fill('missing name');
  await expect(page.locator('#leaderboardRows')).toContainText('No scored matches or matching players');
  await page.goto('index.html');
  await page.locator('#cancelGameBtn').click();
  await acceptConfirmation(page);
  await page.locator('#endSessionBtn').click();
  await acceptConfirmation(page);
  await expect(page.locator('.podium-card')).toHaveCount(3);
  await page.goto('sessions.html');
  await page.locator('.expand-btn').click();
  await expect(page.locator('.session-game-item')).toHaveCount(1);
  await page.locator('.results-btn').click();
  await expect(page.locator('.podium-card')).toHaveCount(3);
  expect((await data(page)).players.slice(0,8).map(p=>p.id)).toEqual(names.map((_,i)=>'p'+i));
  expect(errors).toEqual([]);
});

test('responsive queue and landscape scoring fit the requested viewports',async({page})=>{
  await seed(page);
  for(const width of [320,375,390,430,768,1024,1280,1440,1920]) {
    await page.setViewportSize({width,height:900});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth+1),`queue width ${width}`).toBe(true);
    const controls=await page.locator('[data-score-step]').evaluateAll(els=>els.map(e=>({w:e.getBoundingClientRect().width,h:e.getBoundingClientRect().height})));
    expect(controls.every(e=>e.w>=44 && e.h>=44)).toBe(true);
  }
  await page.setViewportSize({width:1440,height:900});
  await page.screenshot({path:'.scoring-browser-test/kampo-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:'.scoring-browser-test/kampo-mobile.png',fullPage:true});
  await scoring(page);
  for(const [width,height] of [[1440,900],[844,390],[667,375],[568,320],[390,844]]) {
    await page.setViewportSize({width,height});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth+1),`scoring ${width}x${height}`).toBe(true);
    if(width>height) expect(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight+1),`landscape height ${height}`).toBe(true);
  }
  await page.setViewportSize({width:844,height:390});
  await page.screenshot({path:'.scoring-browser-test/kampo-scoring.png'});
});

test('side-out, duplicate taps, undo, correction, refresh and once-only finalization',async({page})=>{
  await seed(page); await scoring(page);
  await expect(page.locator('.score-call')).toHaveText('0 - 0 - 2');
  await page.locator('#rallyA').click();
  await page.locator('#rallyA').click();
  expect((await data(page)).activeSession.currentGame.scoringState.scores.A).toBe(1);
  await page.waitForTimeout(360);
  await page.locator('#rallyB').click();
  await expect.poll(async()=>(await data(page)).activeSession.currentGame.scoringState.servingTeam).toBe('B');
  let state=(await data(page)).activeSession.currentGame.scoringState;
  expect(state.servingTeam).toBe('B'); expect(state.serverNumber).toBe(1); expect(state.scores.B).toBe(0);
  await page.locator('#undoBtn').click();
  await expect.poll(async()=>(await data(page)).activeSession.currentGame.scoringState.servingTeam).toBe('A');
  state=(await data(page)).activeSession.currentGame.scoringState;
  expect(state.servingTeam).toBe('A');
  await page.reload();
  expect((await data(page)).activeSession.currentGame.scoringState).toEqual(state);
  await expect(page.locator('#liveEndingRule')).toBeDisabled();
  await page.locator('#correctBtn').click();
  await page.locator('#correctScoreA').fill('10'); await page.locator('#correctScoreB').fill('0');
  await page.locator('#correctServingTeam').selectOption('A');
  await page.locator('#correctServerNumber').selectOption('2');
  const game=(await data(page)).activeSession.currentGame;
  await page.locator('#correctRightA').selectOption(state.initialConfig.startingRight.A);
  await page.locator('#correctRightB').selectOption(state.initialConfig.startingRight.B);
  await page.locator('#correctServerId').selectOption(state.serverId);
  await page.locator('#correctionConfirmed').check();
  await page.locator('#correctionForm button[type=submit]').click();
  await expect(page.locator('#correctionDialog')).not.toBeVisible();
  await page.waitForTimeout(360); await page.locator('#rallyA').click();
  await expect(page.locator('#finishBtn')).toBeEnabled();
  await page.locator('#undoBtn').click();
  await expect(page.locator('#finishBtn')).toBeDisabled();
  await page.waitForTimeout(360); await page.locator('#rallyA').click();
  await page.locator('#finishBtn').click();
  await expect(page.locator('#startNextGameBtn')).toBeEnabled();
  const saved=await data(page);
  expect(saved.activeSession.games).toHaveLength(1);
  expect(saved.activeSession.games[0].gameId).toBe(game.gameId);
  await page.goto('scoring.html?match='+game.gameId);
  await expect(page.locator('.empty-match')).toContainText('saved');
  expect((await data(page)).activeSession.games).toHaveLength(1);
});

test('Golden Point, cross-tab persistence and rule locking use the same match',async({page,context})=>{
  await seed(page);
  await page.locator('#dashboardEndingRule').selectOption('golden_point');
  await expect(page.locator('#dashboardEndingRule')).toHaveValue('golden_point');
  const other=await context.newPage();
  await other.goto('index.html'); await scoring(other);
  await expect(other.locator('#liveEndingRule')).toHaveValue('golden_point');
  await other.locator('#rallyA').click();
  await expect(page.locator('#teamAScoreInput')).toHaveValue('1');
  await expect(page.locator('#dashboardEndingRule')).toBeDisabled();
  await other.locator('#correctBtn').click();
  const state=(await data(other)).activeSession.currentGame.scoringState;
  await other.locator('#correctScoreA').fill('10'); await other.locator('#correctScoreB').fill('10');
  await other.locator('#correctRightA').selectOption(state.initialConfig.startingRight.A);
  await other.locator('#correctRightB').selectOption(state.initialConfig.startingRight.B);
  await other.locator('#correctServerId').selectOption(state.serverId);
  await other.locator('#correctionConfirmed').check();
  await other.locator('#correctionForm button[type=submit]').click();
  await expect(other.locator('.golden-point-indicator')).toBeVisible();
  await other.waitForTimeout(360); await other.locator('#rallyA').click();
  await expect(other.locator('#finishBtn')).toBeEnabled();
  expect((await data(page)).activeSession.currentGame.scoringState.scores).toEqual({A:11,B:10});
  await other.close();
});

test('backup export/import and legacy migrations preserve IDs, pending assignments and scores',async({page})=>{
  await seed(page);
  await page.goto('data.html');
  const before=await data(page);
  const downloadPromise=page.waitForEvent('download');
  await page.locator('#exportJsonBtn').click();
  const download=await downloadPromise;
  const stream=await download.createReadStream(); let backup='';
  for await (const chunk of stream!) backup+=chunk.toString();
  expect(JSON.parse(backup).players.map(p=>p.id)).toEqual(before.players.map(p=>p.id));
  await page.locator('#importJsonInput').setInputFiles({name:'backup.json',mimeType:'application/json',buffer:Buffer.from(backup)});
  await acceptConfirmation(page);
  await expect(page.locator('#toast')).toContainText('Backup imported');
  const restored=await data(page);
  expect(restored.players).toEqual(before.players);
  expect(restored.activeSession.currentGame).toEqual(before.activeSession.currentGame);
  expect(restored.activeSession.pendingGame).toEqual({...before.activeSession.pendingGame,winningTeam:null,losingTeam:null});
  await page.locator('#importJsonInput').setInputFiles({name:'again.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(restored))});
  await acceptConfirmation(page);
  await expect(page.locator('#toast')).toContainText('Backup imported');
  expect(await data(page)).toEqual(restored);
  const legacy={players:before.players,settings:before.settings,currentGame:before.activeSession.currentGame,pastGames:[]};
  await page.locator('#importJsonInput').setInputFiles({name:'legacy.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(legacy))});
  await acceptConfirmation(page);
  await expect(page.locator('#toast')).toContainText('Backup imported');
  const migrated=await data(page);
  expect(migrated.activeSession.currentGame.gameId).toBe(before.activeSession.currentGame.gameId);
  expect(migrated.players.map(p=>p.id)).toEqual(before.players.map(p=>p.id));
  await page.reload();
  expect(await data(page)).toEqual(migrated);
});

test('complete production build works offline on every route including match query URLs',async({page,context})=>{
  await seed(page); await scoring(page);
  await page.locator('#rallyA').click();
  const before=await data(page);
  await page.evaluate(async()=>{
    await navigator.serviceWorker.ready;
    if(!navigator.serviceWorker.controller) await new Promise<void>(resolve=>navigator.serviceWorker.addEventListener('controllerchange',()=>resolve(),{once:true}));
  });
  const manifest=await page.request.get('manifest.webmanifest'); expect(manifest.ok()).toBe(true);
  for(const icon of (await manifest.json()).icons) expect((await page.request.get(icon.src)).ok()).toBe(true);
  await context.setOffline(true);
  await page.reload(); await expect(page.locator('#rallyA')).toBeVisible();
  expect((await data(page)).activeSession.currentGame.scoringState).toEqual(before.activeSession.currentGame.scoringState);
  for(const route of ['index','players','sessions','leaderboard','data']) {
    await page.goto(route+'.html');
    await expect(page.locator('#'+(route==='index'?'queue':route)+'-tab')).toHaveClass(/active/);
  }
  await page.goto('scoring.html?match='+before.activeSession.currentGame.gameId);
  await page.locator('#undoBtn').click();
  expect((await data(page)).activeSession.currentGame.scoringState.scores.A).toBe(0);
  await context.setOffline(false);
});
