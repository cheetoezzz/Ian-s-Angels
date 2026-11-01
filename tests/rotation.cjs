const assert=require('node:assert/strict');
module.exports=({P,R,app})=>{
  let clock=1_800_000_000_000, sequence=0;
  const copy=value=>JSON.parse(JSON.stringify(value));
  function fixture(count=12) {
    const data={players:Array.from({length:count},(_,i)=>({id:'p'+String(i).padStart(2,'0'),name:'Player '+i,isActive:true,isAvailable:true,gamesPlayed:0,lastPlayedGameNumber:null,waitingSinceGameNumber:0,partnerHistory:[],opponentHistory:[]})),settings:{currentGameNumber:0,currentSessionNumber:1},activeSession:{sessionId:'session-test',sessionNumber:1,sessionName:'Test',dateStarted:new Date(clock).toISOString(),dateEnded:null,status:'active',queueMode:'fair_rotation',games:[],currentGame:null,pendingGame:null,playerStats:{}},pastSessions:[]};
    P.initializeParticipation(data,true,clock); return data;
  }
  function ready(count=12) {const data=fixture(count);P.bulkAttendance(data,'checked_in',clock);return data;}
  function start(data,preview=false) {
    let game;
    if(preview) {app.ensurePendingGame(data,false,clock);game=data.activeSession.pendingGame;assert.ok(game);assert.equal(P.pendingLineupProblem(data),null);}
    else {const result=R.selectSmartMatch(data,clock);assert.equal(result.success,true,result.message);game={gameId:'g'+(++sequence),gameNumber:sequence,status:'pending',teamA:result.teamA.map(p=>({id:p.id,name:p.name})),teamB:result.teamB.map(p=>({id:p.id,name:p.name})),teamAScore:null,teamBScore:null};}
    P.beginParticipation(data,game,clock);game.status='in_progress';game.dateStarted=new Date(clock).toISOString();
    data.activeSession.currentGame=game;data.activeSession.pendingGame=null;
    P.reconcileEligibility(data,clock);
    if(preview) app.ensurePendingGame(data,false,clock);
    return game;
  }
  function finish(data,game) {
    clock+=600000;
    P.finishParticipation(data,game,clock);game.status='completed';game.teamAScore=11;game.teamBScore=7;
    data.activeSession.games.unshift(game);data.activeSession.currentGame=null;
    for(const id of P.gamePlayerIds(game))data.players.find(p=>p.id===id).gamesPlayed++;
    P.reconcileEligibility(data,clock);
  }
  function simulate(data,count,preview=false) {
    const groups=new Set(), partners=new Set(), opponents=new Set();let longest=0;
    for(let i=0;i<count;i++) {
      const game=start(data,preview);const ids=P.gamePlayerIds(game);
      assert.equal(new Set(ids).size,4);
      for(const team of [game.teamA,game.teamB]) {
        const pair=P.activePair(data.activeSession,team[0].id);
        if(pair) assert.ok(pair.playerIds.every(id=>team.some(p=>p.id===id)));
        partners.add(team.map(p=>p.id).sort().join('|'));
      }
      for(const a of game.teamA)for(const b of game.teamB)opponents.add([a.id,b.id].sort().join('|'));
      groups.add(ids.sort().join('|'));finish(data,game);
      longest=Math.max(longest,...Object.values(data.activeSession.attendance).map(r=>r.consecutiveSitOuts));
    }
    return {groups:groups.size,partners:partners.size,opponents:opponents.size,longest,counts:data.players.map(p=>p.gamesPlayed)};
  }
  let d=fixture();
  assert.equal(R.selectSmartMatch(d,clock).success,false,'new session needs explicit check-in');
  assert.ok(Object.values(d.activeSession.attendance).every(a=>a.status==='not_arrived'));
  for(const preview of [false,true]) {
    d=ready();const stats=simulate(d,30,preview);
    console.log('Smart 12-player simulation',JSON.stringify({preview,...stats}));
    assert.ok(Math.max(...stats.counts)-Math.min(...stats.counts)<=2,'play counts remain balanced');
    assert.ok(stats.groups>=12,'repeated groups reduced');
    assert.ok(stats.partners>=20&&stats.opponents>=30,'teammates and opponents vary');
    assert.ok(stats.longest<=5,'no indefinite starvation');
  }
  d=ready(4);const four=simulate(d,12,true);assert.equal(four.groups,1);assert.equal(four.partners,6,'all three doubles arrangements used');
  const preservedHistory=copy(d.activeSession.games),playedBefore=d.activeSession.attendance.p00.gamesPlayedSinceCheckIn;
  P.setAttendance(d,'p00','checked_out',clock);
  P.setAttendance(d,'p00','checked_in',clock+600000);
  assert.equal(d.activeSession.attendance.p00.gamesPlayedSinceCheckIn,playedBefore,'checkout/return never resets prior participation');
  assert.deepEqual(d.activeSession.games,preservedHistory,'attendance never changes completed matches');
  d=ready();P.addFixedPair(d,'p00','p01','only-pair',clock);
  const single=simulate(d,30,true);
  assert.ok(Math.max(...single.counts)-Math.min(...single.counts)<=3,'one fixed pair remains fair against unpaired teams');
  assert.ok(single.partners>=20,'unpaired teammates continue mixing around a fixed pair');
  d=ready();P.addFixedPair(d,'p00','p01','pair1',clock);P.addFixedPair(d,'p04','p05','pair2',clock);
  const fixed=simulate(d,30,true);assert.ok(Math.max(...fixed.counts)-Math.min(...fixed.counts)<=3,'fixed and unpaired opportunities balanced');
  for(const ids of [['p00','p01','p04','p05'],['p00','p01','p02','p03'],['p02','p03','p06','p07']]) {
    const pool=d.players.filter(p=>ids.includes(p.id));const result=R.selectSmartMatch(d,clock,pool);
    assert.equal(result.success,true,'all three matchup types supported');
    assert.deepEqual(new Set([...result.teamA,...result.teamB].map(p=>p.id)),new Set(ids));
  }
  assert.throws(()=>P.addFixedPair(d,'p00','p00','self',clock),/different/);
  assert.throws(()=>P.addFixedPair(d,'p01','p00','duplicate',clock),/already/);
  assert.throws(()=>P.addFixedPair(d,'p01','p02','overlap',clock),/already/);
  assert.equal(R.selectSmartMatch(d,clock).teamA.map(p=>p.id).join(),R.selectSmartMatch(copy(d),clock).teamA.map(p=>p.id).join(),'seeded tie-break deterministic');
  d=fixture(13);for(const player of d.players.slice(0,12))P.setAttendance(d,player.id,'checked_in',clock);
  simulate(d,6,true);
  const current=start(d,true);d.activeSession.pendingGame.lineupLocked=true;
  const currentSnapshot=copy(current),nextSnapshot=copy(d.activeSession.pendingGame);
  P.setAttendance(d,'p12','checked_in',clock+1000);app.ensurePendingGame(d);
  assert.deepEqual(d.activeSession.currentGame,currentSnapshot,'late arrival preserves active match');
  assert.deepEqual(d.activeSession.pendingGame,nextSnapshot,'late arrival preserves locked preview');
  assert.equal(d.activeSession.attendance.p12.eligibleGamesMissed,0);
  assert.equal(d.activeSession.attendance.p12.eligibleOpportunities,0);
  finish(d,current);
  let seenLate=false;
  for(let i=0;i<7;i++){const g=start(d,true);if(P.gamePlayerIds(g).includes('p12'))seenLate=true;finish(d,g);}
  assert.ok(seenLate,'late arrival eventually plays');
  d=ready(8);P.addFixedPair(d,'p00','p01','late-pair',clock);
  P.setAttendance(d,'p01','checked_out',clock);
  assert.ok(!P.eligiblePlayers(d).some(p=>['p00','p01'].includes(p.id)));
  P.reconcileEligibility(d,clock+1800000);
  assert.equal(P.waitingMilliseconds(d.activeSession.attendance.p00,clock+1800000),0,'waiting for absent partner earns no credit');
  P.setAttendance(d,'p01','checked_in',clock+1800000);
  assert.equal(P.waitingMilliseconds(d.activeSession.attendance.p00,clock+1800000),0);
  assert.ok(P.eligiblePlayers(d).some(p=>p.id==='p00'));
  const history=copy(d.activeSession.attendance.p01.history);
  P.setAttendance(d,'p01','on_break',clock+1801000);
  const paused=P.waitingMilliseconds(d.activeSession.attendance.p00,clock+1801000);
  assert.ok(!P.eligiblePlayers(d).some(p=>['p00','p01'].includes(p.id)));
  assert.equal(P.waitingMilliseconds(d.activeSession.attendance.p00,clock+2401000),paused);
  P.setAttendance(d,'p01','checked_in',clock+2401000);
  assert.equal(P.waitingMilliseconds(d.activeSession.attendance.p00,clock+2401000),paused);
  assert.ok(d.activeSession.attendance.p01.history.length>history.length);
  d=ready(6);P.addFixedPair(d,'p00','p01','a',clock);P.addFixedPair(d,'p02','p04','b',clock);P.addFixedPair(d,'p03','p05','c',clock);
  P.setAttendance(d,'p04','checked_out',clock);P.setAttendance(d,'p05','checked_out',clock);
  assert.equal(d.players.filter(p=>d.activeSession.attendance[p.id].status==='checked_in').length,4);
  assert.equal(R.selectSmartMatch(d,clock).success,false,'four check-ins can still lack compatible teams');
  d=ready(8);const g=start(d,true);const next=copy(d.activeSession.pendingGame),active=copy(g);
  const [a,b]=[next.teamA[0].id,next.teamB[0].id];P.addFixedPair(d,a,b,'conflicting',clock);app.ensurePendingGame(d);
  assert.deepEqual(d.activeSession.currentGame,active);
  assert.deepEqual(d.activeSession.pendingGame,next);
  assert.match(d.activeSession.pendingInvalidReason,/fixed partnership/);
  P.removeFixedPair(d,'conflicting',clock);app.ensurePendingGame(d);assert.equal(d.activeSession.pendingInvalidReason,null);
  P.setAttendance(d,a,'on_break',clock);app.ensurePendingGame(d);assert.ok(d.activeSession.pendingInvalidReason);
  assert.equal(d.activeSession.pendingGame.gameId,next.gameId);
  assert.throws(()=>P.setAttendance(d,g.teamA[0].id,'checked_out',clock),/current game/);
  assert.throws(()=>P.bulkAttendance(d,'not_arrived',clock),/current game/);
  P.bulkAttendance(d,'checked_in',clock);assert.deepEqual(d.activeSession.currentGame,active);
  assert.equal(d.activeSession.pendingGame.gameId,next.gameId);
  const persisted=copy(d);app.migrateData(persisted);assert.deepEqual(persisted.activeSession.attendance,d.activeSession.attendance);
  assert.deepEqual(persisted.activeSession.fixedPairs,d.activeSession.fixedPairs);
  assert.deepEqual(persisted.activeSession.currentGame,d.activeSession.currentGame);
  const fresh=fixture(8);assert.ok(Object.values(fresh.activeSession.attendance).every(r=>r.status==='not_arrived'));
  d=ready(40);const before=performance.now();const large=simulate(d,30);const elapsed=performance.now()-before;
  assert.ok(Math.min(...large.counts)>=2&&Math.max(...large.counts)<=4,'40-player opportunities remain balanced');
  assert.ok(elapsed<5000,'bounded candidate search supports 40 players');
  console.log('PASS: smart fairness/variety, 4–40 players, deterministic ties, all fixed/unpaired match types, late arrivals, partner eligibility, breaks, checkout/return, locked conflicts, current-game guards, persistence and session reset; 40-player simulation '+Math.round(elapsed)+'ms');
};
