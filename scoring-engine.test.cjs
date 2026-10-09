'use strict';
const assert = require('node:assert/strict');
const E = require('./scoring-engine.js');
const game = {gameId:'engine-test',teamA:[{id:'a0'},{id:'a1'}],teamB:[{id:'b0'},{id:'b1'}]};
const config = {firstServingTeam:'A',startingRight:{A:'a1',B:'b1'},target:11};
let s = E.create(game,config);
assert.equal(E.servingInfo(s).scoreCall,'0 - 0 - 2');
assert.equal(s.serverId,'a1','explicit starter, not first array player');
let n = E.rally(s,'A');
assert.deepEqual(s.scores,{A:0,B:0},'immutable');
assert.equal(n.scores.A,1);
assert.equal(n.serverId,'a1');
assert.equal(E.servingInfo(n).side,'left');
assert.equal(E.servingInfo(n).receiverId,'b0');
assert.equal(E.servingInfo(n).scoreCall,'1 - 0 - 2');
assert.deepEqual(E.undo(n).scores,s.scores);
assert.deepEqual(E.undo(n).positions,s.positions);
n=E.rally(s,'B');
assert.deepEqual(n.scores,{A:0,B:0});
assert.equal(n.servingTeam,'B'); assert.equal(n.serverNumber,1); assert.equal(n.serverId,'b1');
assert.equal(E.servingInfo(n).scoreCall,'0 - 0 - 1');
let m=E.rally(n,'A');
assert.equal(m.servingTeam,'B'); assert.equal(m.serverNumber,2); assert.equal(m.serverId,'b0');
assert.deepEqual(m.positions,n.positions,'no switch on service loss');
n=E.rally(m,'A');
assert.equal(n.servingTeam,'A'); assert.equal(n.serverNumber,1); assert.equal(n.serverId,'a1');
// After scoring on Server 1, the same player remains server while changing sides.
n=E.rally(n,'A'); assert.equal(n.serverId,'a1'); assert.equal(n.positions.A.left,'a1');
n=E.rally(n,'B'); assert.equal(n.serverId,'a0'); assert.equal(n.serverNumber,2);
n=E.rally(n,'B'); assert.equal(n.servingTeam,'B');
// On the next side-out, the player currently on the right is Server 1.
n=E.rally(n,'A'); n=E.rally(n,'A');
assert.equal(n.serverId,'a0'); assert.equal(n.serverNumber,1);
const atScore = (a,b,target=11) => {
 const initial=E.create(game,{...config,target});
 return E.correct(initial,{scores:{A:a,B:b},positions:E.positionsFor(initial.teams,initial.initialConfig.startingRight,{A:a,B:b}),servingTeam:'A',serverId:'a1',serverNumber:2});
};
s=atScore(10,9); n=E.rally(s,'A');
assert.equal(n.status,'game_over'); assert.equal(n.winner,'A'); assert.equal(n.scores.A,11);
assert.strictEqual(E.rally(n,'B'),n,'no taps after game over');
assert.equal(E.undo(n).status,'in_progress');
s=atScore(10,10); n=E.rally(s,'A'); assert.equal(n.status,'in_progress');
n=E.rally(n,'A'); assert.equal(n.status,'game_over'); assert.equal(n.scores.A,12);
for(const target of [15,21]) {
 s=atScore(target-1,target-2,target); n=E.rally(s,'A'); assert.equal(n.status,'game_over'); assert.equal(n.scores.A,target);
}
assert.throws(()=>E.create(game,{...config,startingRight:{A:null,B:'b1'}}));
assert.throws(()=>E.create(game,{...config,mode:'rally'}));
assert.throws(()=>E.correct(E.create(game,config),{scores:{A:1,B:0},positions:{A:{right:'a1',left:'a0'},B:{right:'b1',left:'b0'}},servingTeam:'A',serverId:'a1',serverNumber:2}),'inconsistent correction rejected');
s=atScore(4,3); n=E.undo(s); assert.equal(n.manuallyCorrected,false); assert.deepEqual(n.scores,{A:0,B:0});
n=E.reset(s); assert.deepEqual(n.scores,{A:0,B:0}); assert.equal(n.serverNumber,2); assert.equal(n.serverId,'a1'); assert.equal(n.history.length,0);
// Long deterministic sequence checks parity, service opportunities and every undo.
s=E.create(game,{...config,target:21});
for (let i=0;i<240;i++) {
 if(s.status==='game_over') break;
 const before=JSON.stringify(s); const winner=i%5<2?s.servingTeam:(s.servingTeam==='A'?'B':'A');
 n=E.rally(s,winner); E.validate(n);
 if(winner===s.servingTeam) {assert.equal(n.scores[winner],s.scores[winner]+1);assert.equal(n.serverId,s.serverId);}
 else {assert.deepEqual(n.scores,s.scores);}
 const undone=E.undo(n); const {revision:r1,hasRecordedRally:h1,...old}=s; const {revision:r2,hasRecordedRally:h2,...restored}=undone;
 assert.deepEqual(restored,old,'undo complete state'); assert.equal(JSON.stringify(s),before,'no input mutation');
 s=n;
}
assert.ok(s.history.length>40,'long sequence exercises many service turns');
console.log('PASS: scenarios A-E, explicit starting identities, diagonal receiver, two-server turns, parity, immutable updates, game-over guards, 11/15/21 targets, deuce, full undo, corrections, reset and long rally sequence');
for (const target of [11,15,21]) {
    let golden=E.create(game,{...config,target,endingRule:'golden_point'});
    const tied={A:target-1,B:target-1};
    golden=E.correct(golden,{scores:tied,positions:E.positionsFor(golden.teams,golden.initialConfig.startingRight,tied),servingTeam:'A',serverId:'a1',serverNumber:1});
    assert.equal(E.suddenDeathActive(golden),true);
    let receivingWin=E.rally(golden,'B');
    assert.deepEqual(receivingWin.scores,tied,'receiving winner earns no point');
    assert.equal(receivingWin.serverNumber,2);
    assert.equal(E.suddenDeathActive(receivingWin),true);
    receivingWin=E.rally(receivingWin,'B');
    assert.equal(receivingWin.servingTeam,'B');assert.equal(receivingWin.serverNumber,1);
    assert.deepEqual(receivingWin.scores,tied);
    const won=E.rally(receivingWin,'B');
    assert.equal(won.scores.B,target);assert.equal(won.scores.A,target-1);
    assert.equal(won.status,'game_over');assert.equal(won.winner,'B');
    assert.equal(E.suddenDeathActive(won),false);
    assert.strictEqual(E.rally(won,'A'),won);
    const undoWon=E.undo(won);
    assert.equal(undoWon.status,'in_progress');assert.equal(undoWon.winner,null);
    assert.deepEqual(undoWon.positions,receivingWin.positions);
    assert.deepEqual(undoWon.scores,tied);
    assert.equal(E.suddenDeathActive(undoWon),true);
    const reloaded=JSON.parse(JSON.stringify(undoWon));E.validate(reloaded);
    assert.equal(reloaded.endingRule,'golden_point');
    assert.throws(()=>E.setEndingRule(reloaded,'standard'));
}
s=E.create(game,config); assert.equal(s.endingRule,'standard');assert.equal(E.suddenDeathActive(atScore(10,10)),false);
n=E.setEndingRule(s,'golden_point');assert.equal(n.initialConfig.endingRule,'golden_point');
n=E.rally(n,'A');n=E.undo(n);assert.throws(()=>E.setEndingRule(n,'standard'),'undo does not unlock rule');
n=E.reset(n);assert.equal(E.setEndingRule(n,'standard').endingRule,'standard','explicit reset unlocks rule');
const legacy=E.create(game,config);delete legacy.endingRule;delete legacy.initialConfig.endingRule;E.validate(legacy);
assert.equal(E.rally(atScore(10,10),'A').status,'in_progress','standard 11-10 unfinished');
console.log('PASS: Golden Point targets 11/15/21, receiving wins, second server and side-outs, winning undo, reload, Standard fallback and ending-rule lock until reset');
