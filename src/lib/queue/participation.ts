import type { AppData, AttendanceStatus, FixedPair, Game, Player, Session, SessionAttendance } from '../../types';

export const attendanceLabels: Record<AttendanceStatus,string> = {
  not_arrived:'Not Arrived', checked_in:'Checked In', on_break:'On Break', checked_out:'Checked Out',
};
export function gamePlayerIds(game?: Game | null): string[] {
  return game ? [...game.teamA,...game.teamB].map(p=>p.id) : [];
}
export function activePair(session: Session, playerId: string): FixedPair | undefined {
  return session?.fixedPairs?.find(pair=>pair.active && pair.playerIds.includes(playerId));
}
function attendanceRecord(session: Session, player: Player, status: AttendanceStatus, now: number): SessionAttendance {
  return {sessionId:session.sessionId,playerId:player.id,status,checkedInAt:status==='checked_in'?now:null,
    queueEnteredAt:status==='checked_in'?now:null,lastPlayedAt:null,eligibleWaitMs:0,clockStartedAt:null,
    availableSince:null,eligibilityEpoch:0,eligibleGamesMissed:0,consecutiveSitOuts:0,consecutiveGames:0,
    gamesPlayedSinceCheckIn:0,eligibleOpportunities:0,history:[{status,at:now}]};
}
/** Additive migration. Historical sessions and all match records remain untouched. */
export function initializeParticipation(data: AppData, fresh = false, now = Date.now()): boolean {
  const session=data.activeSession;
  if(!session) return false;
  const legacy=!session.participationVersion;
  let changed=legacy;
  if(legacy) {
    session.participationVersion=1;
    session.attendance ||= {};
    session.fixedPairs ||= [];
    session.rotationHistory ||= session.games.filter(g=>g.status==='completed').slice().reverse().map(rotationRecord);
    session.attendanceNeedsReview=!fresh;
  }
  const current=new Set(gamePlayerIds(session.currentGame));
  for(const player of data.players) if(!session.attendance[player.id]) {
    const status=!fresh && legacy && ((player.isActive && player.isAvailable!==false)||current.has(player.id)) ? 'checked_in' : 'not_arrived';
    session.attendance[player.id]=attendanceRecord(session,player,status,now);
    changed=true;
  }
  return changed;
}
export function individuallyAvailable(data: AppData, playerId: string): boolean {
  const player=data.players.find(p=>p.id===playerId);
  return !!player && player.isActive && player.isAvailable!==false && data.activeSession?.attendance?.[playerId]?.status==='checked_in';
}
export function eligiblePlayers(data: AppData, includePlaying = false): Player[] {
  if(!data.activeSession) return [];
  const playing=new Set(includePlaying?[]:gamePlayerIds(data.activeSession.currentGame));
  return data.players.filter(player=> {
    if(!individuallyAvailable(data,player.id)||playing.has(player.id)) return false;
    const pair=activePair(data.activeSession,player.id);
    return !pair || pair.playerIds.every(id=>individuallyAvailable(data,id)&&!playing.has(id));
  });
}
/** Clocks run only while a complete eligible unit is free and unreserved. */
export function reconcileEligibility(data: AppData, now = Date.now()): boolean {
  const session=data.activeSession;
  if(!session?.attendance) return false;
  const available=new Set(eligiblePlayers(data,true).map(p=>p.id));
  const occupied=new Set([...gamePlayerIds(session.currentGame),...gamePlayerIds(session.pendingGame)]);
  let changed=false;
  for(const record of Object.values(session.attendance)) {
    const canPlay=available.has(record.playerId);
    if(canPlay && record.availableSince===null) {record.availableSince=now;changed=true;}
    if(!canPlay && record.availableSince!==null) {record.availableSince=null;record.eligibilityEpoch++;changed=true;}
    const ticking=canPlay&&!occupied.has(record.playerId);
    if(ticking && record.clockStartedAt===null) {record.clockStartedAt=now;changed=true;}
    if(!ticking && record.clockStartedAt!==null) {
      record.eligibleWaitMs+=Math.max(0,now-record.clockStartedAt);
      record.clockStartedAt=null;changed=true;
    }
  }
  return changed;
}
export function waitingMilliseconds(record: SessionAttendance, now: number): number {
  return record.eligibleWaitMs+(record.clockStartedAt===null?0:Math.max(0,now-record.clockStartedAt));
}
export function setAttendance(data: AppData, playerId: string, status: AttendanceStatus, now=Date.now()) {
  initializeParticipation(data,false,now);
  const session=data.activeSession;
  if(!session) throw new Error('Start a session before managing check-in.');
  if(!Object.hasOwn(attendanceLabels,status)) throw new Error('Choose a valid attendance status.');
  const record=session.attendance[playerId];
  if(!record || !data.players.some(p=>p.id===playerId)) throw new Error('Player not found in this session.');
  if(record.status===status) return false;
  if(gamePlayerIds(session.currentGame).includes(playerId)) throw new Error('Finish or cancel the current game before changing this player’s attendance.');
  reconcileEligibility(data,now);
  record.status=status;
  if(status!=='checked_in') record.consecutiveGames=0;
  if(status==='checked_in') {record.checkedInAt=now;record.queueEnteredAt=now;}
  record.history.push({status,at:now});
  reconcileEligibility(data,now);
  return true;
}
export function bulkAttendance(data: AppData, status: 'checked_in' | 'not_arrived', now=Date.now()) {
  initializeParticipation(data,false,now);
  if(!data.activeSession) throw new Error('Start a session before managing check-in.');
  const playing=new Set(gamePlayerIds(data.activeSession.currentGame));
  if(status==='not_arrived'&&playing.size) throw new Error('Finish or cancel the current game before resetting attendance.');
  for(const player of data.players) if(!playing.has(player.id)) setAttendance(data,player.id,status,now);
  data.activeSession.attendanceNeedsReview=false;
  reconcileEligibility(data,now);
}
export function addFixedPair(data: AppData, first: string, second: string, id: string, now=Date.now()) {
  const session=data.activeSession;
  if(!session) throw new Error('Start a session before creating fixed partners.');
  if(first===second) throw new Error('Choose two different players.');
  if(![first,second].every(playerId=>individuallyAvailable(data,playerId))) throw new Error('Both players must be active, available and checked in.');
  if([first,second].some(playerId=>activePair(session,playerId))) throw new Error('A player already has a fixed partner. Remove that pair first.');
  reconcileEligibility(data,now);
  session.fixedPairs.push({id,sessionId:session.sessionId,playerIds:[first,second],createdAt:now,active:true});
  for(const playerId of [first,second]) {
    const record=session.attendance[playerId];
    record.eligibleWaitMs=0;record.clockStartedAt=null;record.availableSince=null;
    record.eligibleGamesMissed=0;record.consecutiveSitOuts=0;record.eligibilityEpoch++;
  }
  reconcileEligibility(data,now);
}
export function removeFixedPair(data: AppData, pairId: string, now=Date.now()) {
  const pair=data.activeSession?.fixedPairs?.find(p=>p.id===pairId&&p.active);
  if(!pair) throw new Error('This partnership is no longer active.');
  reconcileEligibility(data,now);
  pair.active=false;
  reconcileEligibility(data,now);
}
export function pairAvailability(data: AppData, pair: FixedPair): string {
  const unavailable=pair.playerIds.filter(id=>!individuallyAvailable(data,id));
  if(unavailable.some(id=>data.activeSession.attendance[id]?.status==='on_break')) return 'Temporarily unavailable · partner on break';
  if(unavailable.length) return 'Waiting for '+unavailable.map(id=>data.players.find(p=>p.id===id)?.name||'missing player').join(' and ');
  if(pair.playerIds.some(id=>gamePlayerIds(data.activeSession.currentGame).includes(id))) return 'On court · available after this game';
  return 'Ready to play';
}
export function pendingLineupProblem(data: AppData): string | null {
  const session=data.activeSession, game=session?.pendingGame;
  if(!game) return 'No prepared lineup.';
  const ids=gamePlayerIds(game);
  if(game.status!=='pending'||game.teamA.length!==2||game.teamB.length!==2||new Set(ids).size!==4) return 'The lineup needs four distinct players.';
  for(const id of ids) {
    const player=data.players.find(p=>p.id===id);
    if(!player) return 'A player in this lineup was removed. Regenerate the lineup.';
    if(!individuallyAvailable(data,id)) return `${player.name} is ${!player.isActive||player.isAvailable===false?'inactive or unavailable':attendanceLabels[session.attendance[id]?.status]||'not checked in'}. Regenerate the lineup.`;
  }
  for(const team of [game.teamA,game.teamB]) for(const player of team) {
    const pair=activePair(session,player.id);
    if(pair&&!pair.playerIds.every(id=>team.some(p=>p.id===id))) return 'This lineup conflicts with a fixed partnership. Regenerate the lineup.';
  }
  return null;
}
export function rotationRecord(game: Game) {
  return {gameId:game.gameId,groupKey:gamePlayerIds(game).sort().join('|'),teamA:game.teamA.map(p=>p.id),teamB:game.teamB.map(p=>p.id)};
}
export function beginParticipation(data: AppData, game: Game, now=Date.now()) {
  reconcileEligibility(data,now);
  game.rotationEligibility=Object.fromEntries(eligiblePlayers(data,true).map(p=>[p.id,data.activeSession.attendance[p.id].eligibilityEpoch]));
}
/** Called by the existing completion path only; previews use a cloned AppData. */
export function finishParticipation(data: AppData, game: Game, now=Date.now()) {
  const session=data.activeSession;
  if(!session?.attendance || session.rotationHistory.some(record=>record.gameId===game.gameId)) return;
  reconcileEligibility(data,now);
  const played=new Set(gamePlayerIds(game)), reserved=new Set(gamePlayerIds(session.pendingGame));
  for(const record of Object.values(session.attendance)) {
    const continuous=game.rotationEligibility?.[record.playerId]===record.eligibilityEpoch && record.availableSince!==null;
    if(played.has(record.playerId)) {
      record.gamesPlayedSinceCheckIn++;record.eligibleOpportunities++;
      record.lastPlayedAt=now;record.consecutiveGames++;record.consecutiveSitOuts=0;
      record.eligibleGamesMissed=0;record.eligibleWaitMs=0;record.clockStartedAt=null;
    } else if(continuous&&!reserved.has(record.playerId)) {
      record.eligibleGamesMissed++;record.consecutiveSitOuts++;record.consecutiveGames=0;record.eligibleOpportunities++;
    }
  }
  session.rotationHistory.push(rotationRecord(game));
}

export function closeParticipation(data: AppData, now=Date.now()) {
  for(const record of Object.values(data.activeSession?.attendance||{})) {
    if(record.clockStartedAt!==null) record.eligibleWaitMs+=Math.max(0,now-record.clockStartedAt);
    record.clockStartedAt=null;
  }
}
