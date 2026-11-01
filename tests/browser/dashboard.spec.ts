import {test,expect,type Page} from '@playwright/test';
const key='pickleball_queue_data';
async function fixture(page:Page,count:number) {
  await page.goto('index.html');
  await page.evaluate(({count,key})=>{
    const now=Date.now(),sessionId='layout-session';
    const players=Array.from({length:count},(_,i)=>({id:'layout'+i,name:'Player '+String(i+1).padStart(2,'0'),isActive:true,gamesPlayed:i%6,lastPlayedGameNumber:null,waitingSinceGameNumber:0,partnerHistory:[],opponentHistory:[]}));
    const attendance=Object.fromEntries(players.map((p,i)=>{
      const status=count>=12&&i>=count-3?(['on_break','not_arrived','checked_out'] as const)[i-count+3]:'checked_in';
      return [p.id,{sessionId,playerId:p.id,status,checkedInAt:now,queueEnteredAt:now,lastPlayedAt:null,eligibleWaitMs:0,clockStartedAt:null,availableSince:null,eligibilityEpoch:0,eligibleGamesMissed:0,consecutiveSitOuts:0,consecutiveGames:0,gamesPlayedSinceCheckIn:0,eligibleOpportunities:0,history:[{status,at:now}]}];
    }));
    const currentGame=count>=4?{gameId:'layout-current',gameNumber:6,status:'in_progress',teamA:players.slice(0,2).map(({id,name})=>({id,name})),teamB:players.slice(2,4).map(({id,name})=>({id,name})),teamAScore:null,teamBScore:null,targetScore:11,endingRule:'standard',dateGenerated:new Date(now).toISOString()}:null;
    localStorage.setItem(key,JSON.stringify({schemaVersion:3,players,settings:{currentGameNumber:6,currentSessionNumber:1},activeSession:{sessionId,sessionNumber:1,sessionName:'Session 1',dateStarted:new Date(now).toISOString(),dateEnded:null,status:'active',queueMode:'fair_rotation',games:[],currentGame,pendingGame:null,playerStats:Object.fromEntries(players.map(p=>[p.id,{playerId:p.id,playerName:p.name,gamesPlayedInSession:p.gamesPlayed,wins:0,losses:0,pointsFor:0,pointsAgainst:0,pointDifference:0,currentWinStreak:0,currentLossStreak:0,partners:[],opponents:[]}])),participationVersion:1,attendance,attendanceNeedsReview:false,fixedPairs:count>=8?[{id:'layout-pair',sessionId,playerIds:['layout4','layout5'],createdAt:now,active:true}]:[],rotationHistory:[]},pastSessions:[]}));
  },{count,key});
  await page.reload();
  await expect(page.locator('#rosterPlayerCount')).toHaveText('('+count+')');
}

test('dashboard is bounded at every requested width with 0, 4, 12, 20 and 40 players',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  test.setTimeout(90000);
  for(const count of [0,4,12,20,40]) {
    await fixture(page,count);
    const snapshot=await page.evaluate(key=>localStorage.getItem(key),key);
    for(const width of [320,375,390,430,768,1024,1280,1440,1920]) {
      await page.setViewportSize({width,height:1000});
      await expect(page.locator('.roster-row')).toHaveCount(width<768?Math.min(5,count):count);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${count} players at ${width}`).toBe(true);
      const bounds=await page.locator('#rosterScroll').boundingBox();
      expect(bounds!.height).toBeLessThanOrEqual(500);
      if(width>=1024) {
        const rows=await page.locator('.dashboard-overview').evaluate(el=>[...el.children].map(child=>child.getBoundingClientRect().top));
        expect(Math.max(...rows)-Math.min(...rows)).toBeLessThan(2);
        const current=await page.locator('.current-card').boundingBox(),next=await page.locator('.upcoming-card-section').boundingBox(),roster=await page.locator('#queuePlayersSlot').boundingBox();
        expect(Math.max(current!.y,next!.y,roster!.y)-Math.min(current!.y,next!.y,roster!.y)).toBeLessThan(2);
      }
      expect(await page.evaluate(key=>localStorage.getItem(key),key)).toBe(snapshot,'resizing changes no application data');
    }
  }
  await page.setViewportSize({width:1440,height:1000});
  await page.screenshot({path:'.scoring-browser-test/dashboard-desktop-40.png',fullPage:true});
  const scroll=await page.locator('#rosterScroll').evaluate(el=>({height:el.clientHeight,total:el.scrollHeight}));
  expect(scroll.total).toBeGreaterThan(scroll.height);
  const headerTop=await page.locator('.roster-table thead').evaluate(el=>el.getBoundingClientRect().top);
  await page.locator('#rosterScroll').evaluate(el=>el.scrollTop=300);
  expect(await page.locator('.roster-table thead th').first().evaluate(el=>el.getBoundingClientRect().top)).toBeCloseTo(headerTop,0);
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:'.scoring-browser-test/dashboard-mobile-40.png',fullPage:true});
  expect(errors).toEqual([]);
});

test('roster search, filters, waiting order and tab keys are presentation-only',async({page})=>{
  await fixture(page,20);
  const before=await page.evaluate(key=>localStorage.getItem(key),key);
  await page.locator('#rosterSearch').fill('Player 18');
  await expect(page.locator('.roster-row')).toHaveCount(1);
  await expect(page.locator('.roster-name')).toContainText('Player 18');
  await page.locator('#rosterSearch').fill('not a player');await expect(page.locator('#playerListSection')).toContainText('No matching players');
  await page.locator('#rosterSearch').fill('');
  for(const [status,count] of [['on_break',1],['not_arrived',1],['checked_out',1],['checked_in',17],['all',20]] as const) {
    await page.locator(`[data-roster-filter="${status}"]`).click();
    await expect(page.locator('.roster-row')).toHaveCount(count);
  }
  await page.locator('#rosterPlayersTab').focus();await page.keyboard.press('ArrowRight');
  await expect(page.locator('#rosterWaitingTab')).toHaveAttribute('aria-selected','true');
  await expect(page.locator('#waitingRosterPanel')).toBeVisible();
  await page.keyboard.press('Home');await expect(page.locator('#rosterPlayersTab')).toHaveAttribute('aria-selected','true');
  await page.locator('#rosterWaitingTab').click();
  const names=await page.locator('.compact-waiting-list strong').allTextContents();
  expect(names.length).toBe(13);
  await page.setViewportSize({width:390,height:844});await expect(page.locator('.compact-waiting-list li')).toHaveCount(5);
  await page.locator('#viewFullQueue').click();await expect(page.locator('.compact-waiting-list li')).toHaveCount(13);
  expect(await page.locator('.compact-waiting-list strong').allTextContents()).toEqual(names,'queue ordering is unchanged by the UI');
  await page.locator('#rosterPlayersTab').click();await expect(page.locator('.roster-row')).toHaveCount(5);
  await page.locator('#viewAllPlayers').click();await expect(page.locator('#players-tab')).toHaveClass(/active/);
  await expect(page.locator('.roster-row')).toHaveCount(20);
  expect(await page.evaluate(key=>localStorage.getItem(key),key)).toBe(before,'search, filters, tabs and navigation never mutate app state');
});

test('compact row actions retain attendance, activation and removal controls',async({page})=>{
  await fixture(page,12);
  await page.goto('players.html');
  const row=page.locator('[data-roster-player="layout6"]');
  await row.locator('summary').click();await row.getByRole('button',{name:'Take Break',exact:true}).click();
  await expect(row.locator('.attendance-badge')).toHaveText('On Break');
  await row.locator('summary').click();await row.getByRole('button',{name:'Return to Queue'}).click();
  await expect(row.locator('.attendance-badge')).toHaveText('Checked In');
  await row.locator('summary').click();await row.locator('.player-toggle').click();
  await expect(row.locator('.roster-name')).toContainText('Inactive registration');
  await row.locator('summary').click();await row.locator('.player-toggle').click();
  await row.locator('summary').click();await row.getByRole('button',{name:'Remove Player 07'}).click();
  await page.locator('.feedback-accept').click();await expect(row).toHaveCount(0);
  await page.locator('[data-tab="queue"]').click();
  await page.setViewportSize({width:390,height:844});
  await page.locator('#manageFixedPartnersMobileBtn').click();await expect(page.locator('#participationDialog')).toBeVisible();
  await page.locator('#closeParticipationBtn').click();
  await page.locator('#rosterAddPlayerBtn').click();await expect(page.locator('#playerNameInput')).toBeFocused();
});
