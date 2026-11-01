import { ScoringEngine } from '../lib/scoring/engine';
import { loadData, saveData, escapeHtml, showToast, completeCurrentGame } from '../lib/application';
import { byId } from '../lib/dom';
import { pageUrl } from '../lib/paths';
import { subscribe } from '../state/appStore';
import { confirmAction, emptyState } from '../lib/feedback';
import type { Game, ScoringState, Team, EndingRule, CourtPositions, Player } from '../types';
/* Uses the Queue's existing storage, migration, completion and rotation functions. */
'use strict';
const scoringView: {matchId: string; revision: number | null | undefined; lastTap: number; busy: boolean; setupMatchId: string; game: Game; state: ScoringState} = {
    matchId: new URLSearchParams(location.search).get('match'),
    revision: null, lastTap: -Infinity, busy: false, setupMatchId: null,
    game: null, state: null
};
const $score = byId;
function setupFormFeedback(formId: string, errorId: string) {
    const form = $score(formId);
    const messages: Record<string, string> = {
        firstServingTeam:'Choose the team that will serve first.',
        startingRightA:'Choose Team A’s starting right-side player.',
        startingRightB:'Choose Team B’s starting right-side player.',
        resumeTeam:'Choose the current serving team to resume this match.',
        resumeNumber:'Choose the current server number.',
        resumePlayer:'Choose the current serving player.',
        resumeConfirmed:'Confirm the saved court positions before resuming.',
        correctionConfirmed:'Confirm the server and court positions before applying this correction.',
    };
    form.addEventListener('invalid', event => {
        event.preventDefault();
        const input = event.target as HTMLInputElement;
        input.setAttribute('aria-invalid', 'true');
        input.setAttribute('aria-describedby', errorId);
        const first = form.querySelector<HTMLInputElement | HTMLSelectElement>(':invalid');
        if (input !== first) return;
        $score(errorId).textContent = messages[input.id] || input.validationMessage || 'Check this field and try again.';
        first.focus();
    }, true);
    const clearError = (event: Event) => {
        const field = event.target as HTMLInputElement;
        if (field.validity?.valid) field.removeAttribute('aria-invalid');
        $score(errorId).textContent = '';
    };
    form.addEventListener('input', clearError);
    form.addEventListener('change', clearError);
}
setupFormFeedback('setupForm','setupError');
setupFormFeedback('correctionForm','correctionError');
const nameFor = (game: Game, id: string) => [...game.teamA, ...game.teamB].find(p => p.id === id)?.name || 'Unknown player';
function playerOptions(players: Pick<Player, 'id' | 'name'>[], chosen = '') {
    return '<option value="">Choose a player</option>' + players.map(p => `<option value="${escapeHtml(p.id)}" ${p.id === chosen ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('');
}
function activeScoringGame() {
    const data = loadData();
    const game = data.activeSession?.currentGame;
    if (!scoringView.matchId && game) scoringView.matchId = game.gameId;
    if (!game || game.gameId !== scoringView.matchId || game.status !== 'in_progress') return {data, game:null};
    return {data, game};
}
function closeScoringDialogs() {
    for (const id of ['setupDialog','correctionDialog']) if ($score(id).open) $score(id).close();
}
function renderScoring() {
    const {data, game} = activeScoringGame();
    const content = $score('scoringContent');
    scoringView.game = game;
    scoringView.state = game?.scoringState || null;
    $score('scoringControls').hidden = !game?.scoringState;
    $score('servingBadge').hidden = !game?.scoringState;
    if (!game) {
        closeScoringDialogs();
        const saved = data.activeSession?.games.find(g => g.gameId === scoringView.matchId) || data.pastSessions.flatMap(s => s.games).find(g => g.gameId === scoringView.matchId);
        content.innerHTML = `<div class="empty-match">${emptyState(saved ? `Game #${saved.gameNumber} saved` : 'No active match to score', saved ? `${saved.winningTeam ? 'Team ' + saved.winningTeam + ' won' : 'Tie'} · ${saved.teamAScore} - ${saved.teamBScore}. Your next lineup is ready in Queue.` : 'Start a game in Queue, then return here to confirm servers and score your match.', saved ? 'success' : 'court')}<a class="back-link primary" href="${pageUrl()}">${saved ? 'Ready for Next Game →' : 'Back to Queue'}</a></div>`;
        $score('gameBadge').textContent = saved ? 'Match completed' : 'Court available';
        $score('matchId').textContent = '';
        return;
    }
    $score('gameBadge').textContent = `Game #${game.gameNumber} · ${game.scoringState?.status === 'game_over' ? 'Game over' : 'In progress'}`;
    $score('matchId').textContent = `Game #${game.gameNumber}`;
    if (!game.scoringState) {
        content.innerHTML = `<div class="empty-match">${emptyState(`Game #${game.gameNumber} · Ready to score`, game.teamA.map(p=>p.name).join(' / ') + ' vs ' + game.teamB.map(p=>p.name).join(' / '), 'court')}<button id="configureScoringBtn" class="primary">Confirm Starting Servers</button></div>`;
        $score('configureScoringBtn').onclick = () => openStartingSetup(game);
        if (scoringView.setupMatchId !== game.gameId) {
            scoringView.setupMatchId = game.gameId;
            openStartingSetup(game);
        }
        return;
    }
    const state = game.scoringState;
    try { ScoringEngine.validate(state); }
    catch (error) {
        closeScoringDialogs();
        $score('scoringControls').hidden = true;
        content.innerHTML = `<div class="empty-match">${emptyState('Scoring state needs review', error.message + ' Export a backup from Queue before restoring a valid match backup.', 'warning')}<a class="back-link primary" href="${pageUrl()}">Back to Queue</a></div>`;
        return;
    }
    scoringView.revision = state.revision;
    const info = ScoringEngine.servingInfo(state);
    const golden = ScoringEngine.suddenDeathActive(state);
    const rule = state.endingRule || 'standard';
    const ruleLocked = state.hasRecordedRally || state.history.length > 0 || state.scores.A > 0 || state.scores.B > 0;
    const over = state.status === 'game_over';
    $score('servingBadge').textContent = over ? `Team ${state.winner} wins` : `Team ${state.servingTeam} serving`;
    content.innerHTML = `<div class="ending-rule-bar"><label>Ending rule <select id="liveEndingRule" ${ruleLocked ? 'disabled' : ''}><option value="standard">Standard — Win by 2</option><option value="golden_point">Sudden Death — Golden Point</option></select></label><strong class="golden-point-indicator" ${golden ? '' : 'hidden'} role="status">SUDDEN DEATH — NEXT POINT WINS</strong></div><div class="scoreboard ${golden ? 'golden-point-active' : ''}">${(['A','B'] as Team[]).map(team => `<button type="button" class="team-panel ${state.servingTeam === team ? 'serving' : ''}" id="rally${team}" ${over ? 'disabled' : ''} aria-label="Team ${team} won the rally. Score ${state.scores[team]}.">
        <div><div class="team-label">TEAM ${team} ${state.servingTeam === team ? '<span class="serving-pill">SERVING</span>' : ''}</div>
        ${(team === 'A' ? game.teamA : game.teamB).map(p=>`<span title="${escapeHtml(p.name)}" class="player-line ${p.id === state.serverId ? 'current-server' : ''}">${p.id === state.serverId ? '● ' : ''}${escapeHtml(p.name)}</span>`).join('')}</div>
        <span class="score">${state.scores[team]}</span><span class="tap-label">${over ? (state.winner === team ? '✓ Winning team' : 'Game over') : `TAP if Team ${team} wins rally`}</span>
        </button>`).join('')}</div>
        <div class="match-details"><div class="serving-info"><h2>${over ? '✓ GAME OVER' : '● SERVING INFORMATION'}</h2>
        <strong>${over ? `Team ${state.winner} wins · ${state.scores.A} - ${state.scores.B}` : `Current server: ${escapeHtml(nameFor(game,state.serverId))}`}</strong>
        <span>Team ${info.team} · Server ${info.serverNumber} · ${info.side === 'right' ? 'Right' : 'Left'} Court</span>
        <span class="score-call" aria-live="polite">${info.scoreCall}</span><span>${state.manuallyCorrected ? 'Manually corrected · ' : ''}${state.history.filter(e=>e.type === 'rally').length} rallies recorded</span></div>
        <div class="court-wrap"><span class="court-caption">COURT FROM ABOVE · SIDES FACE THE NET</span><div class="court">${courtPlayers(game,state,info)}</div></div>
        </div>`;
    $score('liveEndingRule').value = rule;
    $score('liveEndingRule').onchange = e => { const selectedRule = (e.target as HTMLSelectElement).value as EndingRule; mutateScoring(s=>ScoringEngine.setEndingRule(s,selectedRule)); };
    for (const team of ['A','B'] as Team[]) $score(`rally${team}`).onclick = () => recordRally(team);
    $score('undoBtn').disabled = !state.history.length;
    $score('undoBtn').textContent = state.history.at(-1)?.type === 'correction' ? '↶ Undo Correction' : '↶ Undo Last Rally';
    $score('finishBtn').disabled = !over;
    $score('scoringNote').textContent = `${state.manuallyCorrected ? 'Manually corrected · ' : ''}Traditional doubles · First to ${state.target} · ${rule === 'golden_point' ? 'Golden Point, win by 1' : 'Standard, win by 2'} · ${over ? 'Finish & Save unlocks Start Next Game in Queue' : 'Progress saved on this device'}`;
}
function courtPlayers(game: Game,state: ScoringState,info: ReturnType<typeof ScoringEngine.servingInfo>) {
    // Team A faces right: its right court is bottom. Team B faces left: right is top.
    const cells: [Team, 'left' | 'right'][] = [['A','left'],['B','right'],['A','right'],['B','left']];
    return cells.map(([team,side]) => {
        const id = state.positions[team][side];
        const role = id === info.playerId ? 'server' : id === info.receiverId ? 'receiver' : '';
        return `<div class="court-player ${role}"><span>${escapeHtml(nameFor(game,id))}</span><small>${role ? (role === 'server' ? 'SERVES' : 'RECEIVES') : `Team ${team}`} · ${side}</small></div>`;
    }).join('');
}
function openStartingSetup(game: Game) {
    $score('endingRule').value = game.endingRule || 'standard';
    $score('targetScore').value = String(game.targetScore || 11);
    $score('startingRightA').innerHTML = playerOptions(game.teamA);
    $score('startingRightB').innerHTML = playerOptions(game.teamB);
    $score('setupError').textContent = '';
    const resume = Number(game.teamAScore) > 0 || Number(game.teamBScore) > 0;
    $score('resumeSetup').hidden = !resume;
    for (const id of ['resumeTeam','resumeNumber','resumePlayer','resumeConfirmed']) $score(id).disabled = !resume;
    if (resume) {
        $score('resumeExplanation').textContent = `Resume saved score ${game.teamAScore ?? 0} - ${game.teamBScore ?? 0}. Select each team's original right-side player at 0-0 above, then confirm the current server. Starting right players belong on the right at an even score and on the left at an odd score.`;
        $score('resumeTeam').value = '';
        $score('resumeNumber').value = '';
        $score('resumePlayer').innerHTML = '<option value="">Choose serving team first</option>';
        $score('resumeConfirmed').checked = false;
    }
    if (!$score('setupDialog').open) $score('setupDialog').showModal();
}
async function withScoringLock<T>(callback: () => T) {
    if (navigator.locks?.request) return navigator.locks.request('pickleball-queue-scoring', callback);
    return callback();
}
async function mutateScoring(change: (state: ScoringState, game: Game) => ScoringState) {
    if (scoringView.busy) return false;
    scoringView.busy = true;
    const expectedRevision = scoringView.revision;
    try {
        return await withScoringLock(() => {
            const {data,game} = activeScoringGame();
            if (!game) throw new Error('This match is no longer active.');
            if (game.scoringState?.revision !== expectedRevision) throw new Error('Scoring changed in another tab. Review the latest state and try again.');
            const next = change(game.scoringState,game);
            if (next === game.scoringState) return false;
            ScoringEngine.validate(next);
            if (next.matchId !== game.gameId || next.teams.A.join('|') !== game.teamA.map(p=>p.id).join('|') || next.teams.B.join('|') !== game.teamB.map(p=>p.id).join('|')) throw new Error('Scoring player assignments do not match the current game.');
            game.scoringState = next;
            // Preview state stays separate from completed-match statistics.
            game.teamAScore = next.scores.A;
            game.teamBScore = next.scores.B;
            game.targetScore = next.target;
            game.endingRule = next.endingRule || 'standard';
            if (!saveData(data)) throw new Error('Unable to save. Free browser storage and retry.');
            $score('saveStatus').textContent = 'Saved locally';
            renderScoring();
            return true;
        });
    } catch (error) {
        showToast(error.message,'error');
        renderScoring();
        return false;
    } finally { scoringView.busy = false; }
}
async function recordRally(team: Team) {
    const time = performance.now();
    if (time - scoringView.lastTap < 350 || scoringView.busy || !scoringView.state || scoringView.state.status !== 'in_progress') return;
    scoringView.lastTap = time;
    if (await mutateScoring(s => ScoringEngine.rally(s,team))) $score(`rally${team}`)?.classList.add('rally-flash');
}
function openCorrection() {
    const game = scoringView.game, state = scoringView.state;
    if (!game || !state) return;
    $score('correctScoreA').value = String(state.scores.A);
    $score('correctScoreB').value = String(state.scores.B);
    $score('correctServingTeam').value = state.servingTeam;
    $score('correctServerNumber').value = String(state.serverNumber);
    for (const team of ['A','B'] as Team[]) $score(`correctRight${team}`).innerHTML = playerOptions(team === 'A' ? game.teamA : game.teamB,state.positions[team].right);
    updateCorrectServerOptions(state.serverId);
    $score('correctionConfirmed').checked = false;
    $score('correctionError').textContent = '';
    $score('correctionDialog').showModal();
}
function updateCorrectServerOptions(chosen = '') {
    const game = scoringView.game;
    if (game) $score('correctServerId').innerHTML = playerOptions($score('correctServingTeam').value === 'A' ? game.teamA : game.teamB,chosen);
}
$score('setupForm').onsubmit = async event => {
    event.preventDefault();
    scoringView.revision = undefined;
    const success = await mutateScoring((state,game) => {
        if (state) throw new Error('Scoring is already initialized.');
        let next = ScoringEngine.create(game,{firstServingTeam:$score('firstServingTeam').value as Team, startingRight:{A:$score('startingRightA').value,B:$score('startingRightB').value}, target:Number($score('targetScore').value), endingRule:$score('endingRule').value as EndingRule});
        if (Number(game.teamAScore) > 0 || Number(game.teamBScore) > 0) {
            if (!$score('resumeConfirmed').checked) throw new Error('Confirm existing positions before resuming.');
            const scores = {A:Number(game.teamAScore ?? 0),B:Number(game.teamBScore ?? 0)};
            next = ScoringEngine.correct(next,{scores,positions:ScoringEngine.positionsFor(next.teams,next.initialConfig.startingRight,scores),servingTeam:$score('resumeTeam').value as Team,serverId:$score('resumePlayer').value,serverNumber:Number($score('resumeNumber').value)});
        }
        return next;
    });
    if (success) { $score('setupDialog').close(); requestLandscape(); }
    else $score('setupError').textContent = 'Check your selections and the current match, then try again.';
};
$score('correctionForm').onsubmit = async event => {
    event.preventDefault();
    const state = scoringView.state;
    if (!state) return;
    const positions = {} as CourtPositions;
    for (const team of ['A','B'] as Team[]) {
        const right = $score(`correctRight${team}`).value;
        positions[team] = {right, left:state.teams[team].find(id=>id !== right)};
    }
    const correction = {scores:{A:Number($score('correctScoreA').value),B:Number($score('correctScoreB').value)}, positions, servingTeam:$score('correctServingTeam').value as Team, serverId:$score('correctServerId').value, serverNumber:Number($score('correctServerNumber').value)};
    try { ScoringEngine.correct(state,correction); }
    catch(error) { $score('correctionError').textContent = error.message; return; }
    if (await mutateScoring(s=>ScoringEngine.correct(s,correction))) $score('correctionDialog').close();
};
$score('resumeTeam').onchange = () => {
    const game = scoringView.game;
    if (game) $score('resumePlayer').innerHTML = playerOptions($score('resumeTeam').value === 'A' ? game.teamA : game.teamB);
};
$score('correctServingTeam').onchange = () => updateCorrectServerOptions();
$score('closeCorrectionBtn').onclick = () => $score('correctionDialog').close();
$score('undoBtn').onclick = () => mutateScoring(s=>ScoringEngine.undo(s));
$score('correctBtn').onclick = openCorrection;
function resetWithConfirmation() {
    if (confirmAction('Reset this match to 0-0-2 with the original starting positions? Recorded rallies and corrections for this match will be cleared.', resetWithConfirmation)) return mutateScoring(s=>ScoringEngine.reset(s));
}
$score('resetMatchBtn').onclick = resetWithConfirmation;
$score('finishBtn').onclick = async () => {
    if (scoringView.busy || scoringView.state?.status !== 'game_over') return;
    scoringView.busy = true;
    try {
        await withScoringLock(() => {
            if (completeCurrentGame({expectedGameId:scoringView.matchId,expectedRevision:scoringView.revision})) location.assign(pageUrl());
            else renderScoring();
        });
    } finally { scoringView.busy = false; }
};
async function requestLandscape() {
    try {
        if (!document.fullscreenElement && document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
        const orientation = screen.orientation as ScreenOrientation & {lock?: (value: string) => Promise<void>};
        if (orientation?.lock) await orientation.lock('landscape');
    } catch (_) { /* Portrait hint remains available when permission or support is absent. */ }
}
$score('landscapeBtn').onclick = requestLandscape;
subscribe(data=>{if (data === null) renderScoring();});
window.addEventListener('pageshow',renderScoring);
window.addEventListener('focus',renderScoring);
renderScoring();
requestLandscape();

