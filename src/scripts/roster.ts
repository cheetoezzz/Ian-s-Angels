import type {AppData, AttendanceStatus, Player} from '../types';
import {activePair, attendanceLabels, gamePlayerIds, pairAvailability} from '../lib/queue/participation';
import {emptyState} from '../lib/feedback';
import {renderIcon} from '../lib/icons';

interface RosterActions {
  getData: () => AppData;
  waiting: (data: AppData) => Player[];
  toggleActive: (id: string) => unknown;
  remove: (id: string) => unknown;
  attendance: (id: string, status: AttendanceStatus) => unknown;
  addPlayer: () => void;
}
// View preferences only. The roster and queue always come from the existing AppData.
let search='', filter: AttendanceStatus | 'all'='all', tab:'players'|'waiting'='players', fullWaiting=false;
let responsiveBound=false;
const escape=(value:unknown)=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const element=(id:string)=>document.getElementById(id);
const mobile=()=>typeof window!=='undefined'&&window.matchMedia('(max-width:767px)').matches;
const dedicated=()=>document.getElementById('players-tab')?.classList.contains('active');
const statusFor=(data:AppData,id:string):AttendanceStatus=>data.activeSession?.attendance?.[id]?.status||'not_arrived';
const attendanceActions:Record<AttendanceStatus,[AttendanceStatus,string][]>={
  not_arrived:[['checked_in','Check In']],checked_in:[['on_break','Take Break'],['checked_out','Check Out']],
  on_break:[['checked_in','Return to Queue'],['checked_out','Check Out']],checked_out:[['checked_in','Check In Again']],
};

export function renderRoster(data:AppData, actions:RosterActions) {
  const body=element('playerListSection');
  if(!body||!element('rosterPlayersTab')) return;
  const preview=mobile()&&!dedicated(), playing=new Set(gamePlayerIds(data.activeSession?.currentGame));
  const waiting=actions.waiting(data);
  element('rosterPlayerCount').textContent=`(${data.players.length})`;
  element('rosterWaitingCount').textContent=`(${waiting.length})`;
  const searchInput=element('rosterSearch') as HTMLInputElement;
  if(searchInput.value!==search)searchInput.value=search;
  const results=data.players.filter(player=>(filter==='all'||statusFor(data,player.id)===filter)&&player.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  const visible=preview?results.slice(0,5):results;
  const filters:[AttendanceStatus|'all',string][]=[['all','All'],['checked_in','Checked In'],['on_break','On Break'],['not_arrived','Not Arrived'],['checked_out','Checked Out']];
  element('rosterFilters').innerHTML=filters.map(([value,label])=>`<button type="button" data-roster-filter="${value}" aria-pressed="${filter===value}">${label} <span>(${value==='all'?data.players.length:data.players.filter(p=>statusFor(data,p.id)===value).length})</span></button>`).join('');
  body.innerHTML=visible.length?visible.map(player=>{
    const status=statusFor(data,player.id),pair=activePair(data.activeSession,player.id);
    const partnerId=pair?.playerIds.find(id=>id!==player.id), partner=data.players.find(p=>p.id===partnerId);
    const onCourt=playing.has(player.id), games=data.activeSession?.playerStats[player.id]?.gamesPlayedInSession??player.gamesPlayed;
    return `<tr class="roster-row" data-roster-player="${escape(player.id)}">
      <td class="roster-number">${String(data.players.indexOf(player)+1).padStart(2,'0')}</td>
      <th class="roster-name" scope="row"><span title="${escape(player.name)}">${escape(player.name)}</span>${onCourt?'<small>On court</small>':!player.isActive?'<small>Inactive registration</small>':''}</th>
      <td class="roster-status"><span class="attendance-badge ${status}">${attendanceLabels[status]}</span></td>
      <td class="roster-games" title="${player.gamesPlayed} total games">${games}<span class="mobile-games-label"> games</span></td>
      <td class="roster-partner">${pair?`<span class="partner-tag" title="Fixed with ${escape(partner?.name||'unavailable player')}">${renderIcon('link')}<span>${escape(partner?.name||'Unavailable')}</span></span>`:'<span class="no-partner" aria-label="No fixed partner">—</span>'}</td>
      <td class="roster-action-cell"><details class="roster-row-actions"><summary aria-label="Actions for ${escape(player.name)}"><span aria-hidden="true">···</span></summary><div class="roster-action-controls">
        <span class="roster-total-games">${player.gamesPlayed} total games</span>
        <label class="roster-active-control"><input class="player-toggle" type="checkbox" data-player-id="${escape(player.id)}" ${player.isActive?'checked':''} ${onCourt?'disabled':''} aria-label="${escape(player.name)} registered player active" />Active registration</label>
        ${data.activeSession?attendanceActions[status].map(([next,label])=>`<button class="btn btn-secondary roster-attendance-action" type="button" data-player-id="${escape(player.id)}" data-status="${next}" ${onCourt?'disabled':''}>${label}</button>`).join(''):''}
        <button class="btn-remove player-remove" type="button" data-player-id="${escape(player.id)}" ${onCourt?'disabled':''} aria-label="Remove ${escape(player.name)}">Remove</button>
      </div></details></td>
    </tr>`;
  }).join(''):`<tr><td colspan="6">${emptyState(data.players.length?'No matching players':'No players added yet',data.players.length?'Try another name or attendance filter.':'Use Add Player to build your crew, then check them in.','players')}</td></tr>`;
  element('rosterResults').textContent=`${visible.length} of ${results.length} ${results.length===1?'player':'players'}${data.activeSession?' · Session games':' · Total games'}`;
  element('viewAllPlayers').hidden=!!dedicated();

  const found=waiting.filter(player=>player.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  const queue=preview&&!fullWaiting?found.slice(0,5):found;
  element('waitingPlayersSection').innerHTML=queue.length?`<ol class="compact-waiting-list">${queue.map(player=>{
    const record=data.activeSession?.attendance?.[player.id],pair=activePair(data.activeSession,player.id);
    return `<li><span class="waiting-position">${String(waiting.indexOf(player)+1).padStart(2,'0')}</span><div><strong>${escape(player.name)}</strong>${pair?`<small>${escape(pairAvailability(data,pair))}</small>`:''}</div><span>${record?.eligibleGamesMissed||0} eligible games waiting</span></li>`;
  }).join('')}</ol>`:emptyState(search?'No waiting players match':'No waiting players',search?'Try another player name.':'Players who are checked in and waiting will appear here in queue order.','clock');
  element('waitingResults').textContent=`${queue.length} of ${found.length} waiting`;
  element('viewFullQueue').hidden=!preview||found.length<=5;
  element('viewFullQueue').textContent=fullWaiting?'Show Preview':'View Full Queue';
  element('viewFullQueue').onclick=()=>{fullWaiting=!fullWaiting;renderRoster(actions.getData(),actions);};
  const selectTab=(next:'players'|'waiting',focus=false)=>{
    tab=next;
    for(const name of ['players','waiting'] as const) {
      const button=element(name==='players'?'rosterPlayersTab':'rosterWaitingTab');
      button.setAttribute('aria-selected',String(name===tab));
      button.tabIndex=name===tab?0:-1;
    }
    element('playerRosterPanel').hidden=tab!=='players';
    element('waitingRosterPanel').hidden=tab!=='waiting';
    if(focus)element(tab==='players'?'rosterPlayersTab':'rosterWaitingTab').focus();
  };
  for(const [id,name] of [['rosterPlayersTab','players'],['rosterWaitingTab','waiting']] as const) {
    element(id).onclick=()=>selectTab(name);
    element(id).onkeydown=event=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();selectTab(event.key==='Home'?'players':event.key==='End'?'waiting':tab==='players'?'waiting':'players',true);}};
  }
  selectTab(tab);
  searchInput.oninput=()=>{search=searchInput.value;renderRoster(actions.getData(),actions);};
  element('rosterFilters').querySelectorAll<HTMLButtonElement>('button').forEach(button=>button.onclick=()=>{filter=button.dataset.rosterFilter as typeof filter;renderRoster(actions.getData(),actions);});
  body.querySelectorAll<HTMLInputElement>('.player-toggle').forEach(input=>input.onchange=()=>actions.toggleActive(input.dataset.playerId));
  body.querySelectorAll<HTMLButtonElement>('.player-remove').forEach(button=>button.onclick=()=>actions.remove(button.dataset.playerId));
  body.querySelectorAll<HTMLButtonElement>('.roster-attendance-action').forEach(button=>button.onclick=()=>actions.attendance(button.dataset.playerId,button.dataset.status as AttendanceStatus));
  body.querySelectorAll<HTMLDetailsElement>('.roster-row-actions').forEach(details=>details.ontoggle=()=>{if(details.open)body.querySelectorAll<HTMLDetailsElement>('.roster-row-actions').forEach(other=>{if(other!==details)other.open=false;});});
  element('rosterAddPlayerBtn').onclick=actions.addPlayer;
  if(!responsiveBound&&typeof window!=='undefined') {
    responsiveBound=true;
    const layout=window.matchMedia('(min-width:1024px)');
    const disclosure=element('sessionInfoDisclosure') as HTMLDetailsElement;
    if(disclosure)disclosure.open=layout.matches;
    layout.addEventListener('change',event=>{if(disclosure)disclosure.open=event.matches;});
    window.matchMedia('(max-width:767px)').addEventListener('change',()=>renderRoster(actions.getData(),actions));
  }
}
