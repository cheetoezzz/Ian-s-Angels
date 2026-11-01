import type { AppData, Player, Session } from '../../types';
import { activePair, eligiblePlayers, gamePlayerIds, waitingMilliseconds } from './participation';

export type LineupResult = {success:boolean; message?:string; teamA?:Player[]; teamB?:Player[]};
type Candidate = {teams:[Player[],Player[]]; fairness:number; repetition:number; key:number; required:number};
const pairKey=(a:string,b:string)=>[a,b].sort().join('|');
function hash(value:string):number {let h=2166136261;for(let i=0;i<value.length;i++) h=Math.imul(h^value.charCodeAt(i),16777619);return h>>>0;}
export function fairnessPriority(data: AppData, player: Player, now:number): number {
  const session=data.activeSession, record=session.attendance[player.id];
  if(!record) return 0;
  const share=record.eligibleOpportunities ? record.gamesPlayedSinceCheckIn/record.eligibleOpportunities : 4/Math.max(4,eligiblePlayers(data,true).length);
  const winnerBonus=session.queueMode==='winner_priority'&&session.games[0]?.winnerPlayerIds?.includes(player.id)?5:0;
  return record.eligibleGamesMissed*100+record.consecutiveSitOuts*25+
    Math.min(60,waitingMilliseconds(record,now)/60000)*2-record.consecutiveGames*40-share*15+winnerBonus;
}
export function candidateTeams(data: AppData, players:Player[]): Player[][] {
  const session=data.activeSession, byId=new Map(players.map(p=>[p.id,p]));
  const fixed=(session.fixedPairs||[]).filter(p=>p.active&&p.playerIds.every(id=>byId.has(id)))
    .map(pair=>pair.playerIds.map(id=>byId.get(id)));
  const free=players.filter(p=>!activePair(session,p.id));
  const teams=[...fixed];
  for(let i=0;i<free.length;i++) for(let j=i+1;j<free.length;j++) teams.push([free[i],free[j]]);
  return teams;
}
function repetitionEvaluator(session:Session, players:Player[]) {
  const partners=new Map<string,number>(), opponents=new Map<string,number>(), groups=new Map<string,number>();
  const last=new Map<string,string>();
  for(const player of players) if(player.partnerHistory?.length) last.set(player.id,player.partnerHistory.at(-1));
  const history=session.rotationHistory||[];
  for(const record of history) {
    groups.set(record.groupKey,(groups.get(record.groupKey)||0)+1);
    for(const team of [record.teamA,record.teamB]) {
      const key=pairKey(team[0],team[1]);partners.set(key,(partners.get(key)||0)+1);
      last.set(team[0],team[1]);last.set(team[1],team[0]);
    }
    for(const a of record.teamA) for(const b of record.teamB) {const key=pairKey(a,b);opponents.set(key,(opponents.get(key)||0)+1);}
  }
  return (a:Player[],b:Player[])=> {
    const group=[...a,...b].map(p=>p.id).sort().join('|');
    let penalty=(groups.get(group)||0)*200+(history.at(-1)?.groupKey===group?800:0);
    for(const team of [a,b]) if(!activePair(session,team[0].id)) {
      penalty+=(partners.get(pairKey(team[0].id,team[1].id))||0)*16;
      if(last.get(team[0].id)===team[1].id||last.get(team[1].id)===team[0].id) penalty+=180;
    }
    for(const x of a) for(const y of b) penalty+=(opponents.get(pairKey(x.id,y.id))||0)*5;
    return penalty;
  };
}
/** One engine for fixed, mixed and unpaired teams. Maximum 16 candidate players. */
export function selectSmartMatch(data:AppData, now=Date.now(), supplied?:Player[]):LineupResult {
  const session=data.activeSession;
  if(!session?.attendance) return {success:false,message:'Start a session and check players in to prepare a game.'};
  const available=eligiblePlayers(data);
  const eligible=supplied ? available.filter(p=>supplied.some(candidate=>candidate.id===p.id)) : available;
  const priority=new Map(eligible.map(p=>[p.id,fairnessPriority(data,p,now)]));
  const units:Player[][]=[], seen=new Set<string>();
  for(const player of eligible) {
    if(seen.has(player.id)) continue;
    const pair=activePair(session,player.id);
    const unit=pair?pair.playerIds.map(id=>eligible.find(p=>p.id===id)).filter(Boolean):[player];
    if(pair&&unit.length!==2) continue;
    unit.forEach(p=>seen.add(p.id));units.push(unit);
  }
  units.sort((a,b)=> Math.max(...b.map(p=>priority.get(p.id)))-Math.max(...a.map(p=>priority.get(p.id))) || a[0].id.localeCompare(b[0].id));
  const pool:Player[]=[];
  for(const unit of units) {if(pool.length+unit.length<=16)pool.push(...unit);if(pool.length>=16)break;}
  const teams=candidateTeams(data,pool), repetition=repetitionEvaluator(session,pool);
  const overdue=eligible.filter(p=>session.attendance[p.id].eligibleGamesMissed>=Math.ceil(eligible.length/4)+1)
    .sort((a,b)=>priority.get(b.id)-priority.get(a.id)||a.id.localeCompare(b.id)).slice(0,4);
  const candidates:Candidate[]=[];
  for(let i=0;i<teams.length;i++) for(let j=i+1;j<teams.length;j++) {
    const a=teams[i],b=teams[j];
    if(a.some(p=>b.some(q=>q.id===p.id))) continue;
    const lineup=[...a,...b], ids=lineup.map(p=>p.id);
    const key=hash(session.sessionId+'|'+(session.rotationHistory?.length||0)+'|'+[a.map(p=>p.id).sort().join(','),b.map(p=>p.id).sort().join(',')].sort().join('/'));
    candidates.push({teams:[a,b],fairness:lineup.reduce((sum,p)=>sum+priority.get(p.id),0),
      repetition:repetition(a,b),key,required:overdue.filter(p=>ids.includes(p.id)).length});
  }
  if(!candidates.length) return {success:false,message:'Waiting for two compatible teams. Check in at least four available players and ensure every fixed partner is present.'};
  const required=Math.max(...candidates.map(c=>c.required));
  const viable=candidates.filter(c=>c.required===required), best=Math.max(...viable.map(c=>c.fairness));
  // One missed opportunity is comparable; larger waits eventually become mandatory.
  const tolerance=eligible.length>4?200:0;
  const finalists=viable.filter(c=>c.fairness>=best-tolerance);
  finalists.sort((a,b)=>a.repetition-b.repetition||b.fairness-a.fairness||a.key-b.key);
  return {success:true,teamA:finalists[0].teams[0],teamB:finalists[0].teams[1]};
}
export function orderedWaitingPlayers(data:AppData, now=Date.now()) {
  const playing=new Set(gamePlayerIds(data.activeSession?.currentGame));
  return data.players.filter(p=>individuallyCheckedIn(data,p)&&!playing.has(p.id))
    .sort((a,b)=>fairnessPriority(data,b,now)-fairnessPriority(data,a,now)||a.id.localeCompare(b.id));
}
function individuallyCheckedIn(data:AppData,player:Player) {
  return player.isActive&&player.isAvailable!==false&&data.activeSession?.attendance?.[player.id]?.status==='checked_in';
}
