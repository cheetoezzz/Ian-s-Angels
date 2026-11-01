import {test,expect,type Page} from '@playwright/test';
const key='pickleball_queue_data';
const read=(page:Page)=>page.evaluate(key=>JSON.parse(localStorage.getItem(key)!),key);
async function accept(page:Page) {await page.locator('.feedback-accept').click();await expect(page.locator('.feedback-confirm')).toHaveCount(0);}
async function session(page:Page,count=12,checkAll=true) {
  await page.goto('index.html');
  await page.evaluate(({key,count})=>localStorage.setItem(key,JSON.stringify({players:Array.from({length:count},(_,i)=>({id:'a'+i,name:'Player '+i,isActive:true,gamesPlayed:0,lastPlayedGameNumber:null,waitingSinceGameNumber:0,partnerHistory:[],opponentHistory:[]})),settings:{currentGameNumber:0,currentSessionNumber:0},activeSession:null,pastSessions:[]})),{key,count});
  await page.reload();await page.locator('#startSessionBtn').click();await page.locator('#confirmQueueModeBtn').click();
  await expect(page.locator('#sessionAnimation')).not.toBeVisible();
  if(checkAll) {await page.locator('#manageCheckInBtn').click();await page.locator('#checkInAllBtn').click();await accept(page);await page.locator('#closeParticipationBtn').click();}
}
const row=(page:Page,id:string)=>page.locator(`[data-attendance-player="${id}"]`);

test('new session requires check-in; attendance actions preserve a saved lineup until resolved',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await session(page,8,false);
  expect(Object.values((await read(page)).activeSession.attendance).every((r:any)=>r.status==='not_arrived')).toBe(true);
  await expect(page.locator('#startNextGameBtn')).toHaveCount(0);
  await page.locator('#manageCheckInBtn').click();
  await page.locator('#checkInAllBtn').click();await page.locator('.feedback-cancel').click();
  expect((await read(page)).activeSession.pendingGame).toBeNull();
  for(let i=0;i<4;i++) await row(page,'a'+i).getByRole('button',{name:'Check In',exact:true}).click();
  const pending=(await read(page)).activeSession.pendingGame;
  expect(new Set([...pending.teamA,...pending.teamB].map(p=>p.id)).size).toBe(4);
  await row(page,'a0').getByRole('button',{name:'Take Break'}).click();
  expect((await read(page)).activeSession.pendingGame.gameId).toBe(pending.gameId);
  await page.locator('#closeParticipationBtn').click();
  await expect(page.locator('.lineup-warning')).toContainText('On Break');
  await expect(page.locator('#startNextGameBtn')).toBeDisabled();
  await page.locator('#manageCheckInBtn').click();await row(page,'a0').getByRole('button',{name:'Return to Queue'}).click();
  await page.locator('#closeParticipationBtn').click();await expect(page.locator('#startNextGameBtn')).toBeEnabled();
  expect((await read(page)).activeSession.pendingGame.gameId).toBe(pending.gameId);
  await page.locator('#startNextGameBtn').click();
  await page.locator('#manageCheckInBtn').click();
  await expect(page.locator('#resetAttendanceBtn')).toBeDisabled();
  await expect(row(page,'a0').getByRole('button',{name:'Take Break'})).toBeDisabled();
  await page.locator('#closeParticipationBtn').click();
  await page.goto('players.html');await page.locator('#manageCheckInBtn').click();
  await row(page,'a4').getByRole('button',{name:'Check In',exact:true}).click();
  await row(page,'a4').getByRole('button',{name:'Check Out',exact:true}).click();
  await row(page,'a4').getByRole('button',{name:'Check In Again'}).click();
  expect((await read(page)).activeSession.attendance.a4.history.map(r=>r.status)).toEqual(['not_arrived','checked_in','checked_out','checked_in']);
  await page.locator('#closeParticipationBtn').click();await page.reload();
  expect((await read(page)).activeSession.attendance.a4.status).toBe('checked_in');
  expect(errors).toEqual([]);
});

test('fixed pair conflicts keep the announced preview and require explicit regeneration',async({page})=>{
  await session(page,8);
  const before=(await read(page)).activeSession.pendingGame;
  await page.locator('#lockLineupBtn').click();
  await page.locator('#manageFixedPartnersBtn').click();
  await page.locator('#fixedPlayer1').selectOption(before.teamA[0].id);
  await expect(page.locator(`#fixedPlayer2 option[value="${before.teamA[0].id}"]`)).toHaveAttribute('disabled','');
  await page.locator('#fixedPlayer2').selectOption(before.teamB[0].id);
  await page.locator('#fixedPairForm button').click();
  await expect(page.locator('.fixed-pair-row')).toHaveCount(1);
  const d=await read(page);
  expect(d.activeSession.fixedPairs.filter(p=>p.active)).toHaveLength(1);
  expect(d.activeSession.pendingGame).toEqual({...before,lineupLocked:true});
  expect(d.activeSession.pendingInvalidReason).toContain('fixed partnership');
  const pair=d.activeSession.fixedPairs[0];
  await expect(page.locator(`#fixedPlayer1 option[value="${pair.playerIds[0]}"]`)).toHaveCount(0);
  await page.locator('#closeParticipationBtn').click();
  await expect(page.locator('#startNextGameBtn')).toBeDisabled();
  await page.locator('#regenerateLineupBtn').click();await accept(page);
  expect((await read(page)).activeSession.pendingGame.gameId).not.toBe(before.gameId);
  await expect(page.locator('#startNextGameBtn')).toBeEnabled();
  await page.locator('#startNextGameBtn').click();
  const current=(await read(page)).activeSession.currentGame;
  for(const team of [current.teamA,current.teamB]) if(team.some(p=>pair.playerIds.includes(p.id))) expect(team.map(p=>p.id).sort()).toEqual([...pair.playerIds].sort());
  await page.locator('#manageFixedPartnersBtn').click();
  await page.locator('#fixedPairManager .remove-fixed-pair').click();await accept(page);
  expect((await read(page)).activeSession.currentGame).toEqual(current);
  expect((await read(page)).activeSession.fixedPairs[0].active).toBe(false);
  await page.locator('#closeParticipationBtn').click();
  await page.locator('#teamAScoreInput').fill('4');await page.locator('#teamBScoreInput').fill('2');
  await page.locator('#completeGameBtn').click();await accept(page);
  expect((await read(page)).activeSession.games).toHaveLength(1);
});

test('late arrivals and mid-game pairing leave the active match and locked preview unchanged',async({page})=>{
  await session(page,13,false);
  await page.locator('#manageCheckInBtn').click();
  for(let i=0;i<12;i++)await row(page,'a'+i).getByRole('button',{name:'Check In',exact:true}).click();
  await page.locator('#closeParticipationBtn').click();await page.locator('#startNextGameBtn').click();
  await page.locator('#lockLineupBtn').click();
  const before=await read(page);
  await page.locator('#manageCheckInBtn').click();await row(page,'a12').getByRole('button',{name:'Check In',exact:true}).click();
  let after=await read(page);
  expect(after.activeSession.currentGame).toEqual(before.activeSession.currentGame);
  expect(after.activeSession.pendingGame).toEqual(before.activeSession.pendingGame);
  expect(after.activeSession.attendance.a12.eligibleGamesMissed).toBe(0);
  const currentId=before.activeSession.currentGame.teamA[0].id;
  await page.locator('#fixedPlayer1').selectOption(currentId);await page.locator('#fixedPlayer2').selectOption('a12');await page.locator('#fixedPairForm button').click();
  await expect(page.locator('.fixed-pair-row')).toHaveCount(1);
  after=await read(page);expect(after.activeSession.currentGame).toEqual(before.activeSession.currentGame);
  expect(after.activeSession.pendingGame).toEqual(before.activeSession.pendingGame);
  await row(page,'a12').getByRole('button',{name:'Take Break'}).click();
  await expect(page.locator('.fixed-pair-row')).toContainText('Temporarily unavailable');
  await page.locator('#closeParticipationBtn').click();await page.reload();
  expect((await read(page)).activeSession.fixedPairs).toHaveLength(1);
  expect((await read(page)).activeSession.attendance.a12.status).toBe('on_break');
});

test('existing active sessions migrate attendance without altering matches and require review',async({page})=>{
  await session(page,8);await page.locator('#startNextGameBtn').click();
  const before=await read(page);
  await page.evaluate(key=>{
    const d=JSON.parse(localStorage.getItem(key)!);d.schemaVersion=2;
    for(const field of ['participationVersion','attendance','attendanceNeedsReview','fixedPairs','rotationHistory'])delete d.activeSession[field];
    localStorage.setItem(key,JSON.stringify(d));
  },key);
  await page.reload();
  const after=await read(page);
  expect(after.schemaVersion).toBe(3);
  expect(after.activeSession.currentGame).toEqual(before.activeSession.currentGame);
  expect(after.activeSession.pendingGame).toEqual(before.activeSession.pendingGame);
  expect(after.activeSession.attendanceNeedsReview).toBe(true);
  await page.locator('#cancelGameBtn').click();await accept(page);
  await page.locator('#startNextGameBtn').click();
  await expect(page.locator('#feedbackConfirmTitle')).toHaveText('Confirm attendance?');
  await page.locator('.feedback-cancel').click();
  expect((await read(page)).activeSession.currentGame).toBeNull();
  await page.locator('#manageCheckInBtn').click();await page.locator('#reviewAttendanceBtn').click();await accept(page);
  expect((await read(page)).activeSession.attendanceNeedsReview).toBe(false);
  await page.locator('#closeParticipationBtn').click();
});

test('attendance manager stays usable on mobile, desktop and offline',async({page,context})=>{
  await session(page,12);
  await page.locator('#manageFixedPartnersBtn').click();
  await page.locator('#fixedPlayer1').selectOption('a0');await page.locator('#fixedPlayer2').selectOption('a1');await page.locator('#fixedPairForm button').click();
  await expect(page.locator('.fixed-pair-row')).toHaveCount(1);
  for(const width of [320,390,768,1024,1440]) {
    await page.setViewportSize({width,height:844});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
    const fit=await page.locator('#participationDialog').evaluate(dialog=>({client:dialog.clientWidth,scroll:dialog.scrollWidth}));
    expect(fit.scroll).toBeLessThanOrEqual(fit.client+1);
  }
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:'.scoring-browser-test/attendance-mobile.png'});
  await page.locator('#closeParticipationBtn').click();
  await page.evaluate(async()=>{await navigator.serviceWorker.ready;if(!navigator.serviceWorker.controller)await new Promise<void>(resolve=>navigator.serviceWorker.addEventListener('controllerchange',()=>resolve(),{once:true}));});
  await context.setOffline(true);await page.reload();await page.locator('#manageCheckInBtn').click();
  await row(page,'a1').getByRole('button',{name:'Check Out'}).click();
  await expect(page.locator('.fixed-pair-row')).toContainText('Waiting for Player 1');
  await page.locator('#closeParticipationBtn').click();await page.reload();
  expect((await read(page)).activeSession.attendance.a1.status).toBe('checked_out');
  expect((await read(page)).activeSession.fixedPairs[0].active).toBe(true);
  await context.setOffline(false);
});
