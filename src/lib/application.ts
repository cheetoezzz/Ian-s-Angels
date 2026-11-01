// ==================== DATA STORAGE ====================

import type { AppData, Game, Player, Session, QueueMode, SessionStat, Ranking } from '../types';
import { ScoringEngine } from './scoring/engine';
import { STORAGE_KEY, readStoredData, writeStoredData, subscribe } from '../state/appStore';
import { byId } from './dom';
import { pageUrl } from './paths';
import { renderIcon } from './icons';
import { renderRoster } from '../scripts/roster';
import { initializeParticipation, reconcileEligibility, pendingLineupProblem, beginParticipation, finishParticipation, closeParticipation, activePair, attendanceLabels, setAttendance, bulkAttendance, addFixedPair, removeFixedPair, pairAvailability, individuallyAvailable, gamePlayerIds } from './queue/participation';
import { selectSmartMatch, orderedWaitingPlayers, type LineupResult } from './queue/rotation';
import type { AttendanceStatus } from '../types';
import { confirmAction, emptyState, notify } from './feedback';
export { STORAGE_KEY } from '../state/appStore';
const QUEUE_MODES = {
    fair_rotation: {
        label: 'Smart Fair Rotation',
        description: 'Smart fair rotation balances eligible waiting time and mixes teammates and opponents.'
    },
    winner_priority: {
        label: 'Winner Priority',
        description: 'Uses the same smart rotation, with a small winner preference among equally fair options.'
    }
};

function getDefaultData(): AppData {
    return {
        players: [],
        settings: {
            currentGameNumber: 0,
            currentSessionNumber: 0
        },
        activeSession: null,
        pastSessions: []
    };
}

function loadData(): AppData {
    try { return readStoredData(migrateData, getDefaultData); }
    catch (error) { console.error('Error loading data:', error); return getDefaultData(); }
}

function migrateData(data: any): AppData {
    // Check if data has old structure (currentGame or pastGames)
    if (data.currentGame !== undefined || data.pastGames !== undefined) {
        console.log('Migrating old data structure to session-based structure');

        const migrated: AppData = {
            players: data.players || [],
            settings: {
                currentGameNumber: data.settings?.currentGameNumber || 0,
                currentSessionNumber: 0
            },
            activeSession: null,
            pastSessions: []
        };

        // If there was a currentGame, create an active session with it
        if (data.currentGame) {
            migrated.settings.currentSessionNumber = 1;
            migrated.activeSession = {
                sessionId: generateId(),
                sessionNumber: 1,
                sessionName: 'Session 1',
                dateStarted: data.currentGame.dateGenerated || new Date().toISOString(),
                dateEnded: null,
                status: 'active',
                queueMode: 'fair_rotation',
                currentGame: migrateGame(data.currentGame),
                games: [],
                playerStats: {}
            };
        }

        // If there were pastGames, create a completed session for them
        if (data.pastGames && data.pastGames.length > 0) {
            migrated.settings.currentSessionNumber = migrated.activeSession ? 1 : 0;
            const sessionNumber = migrated.settings.currentSessionNumber + 1;
            migrated.settings.currentSessionNumber = sessionNumber;

            const importedSession: Session = {
                sessionId: generateId(),
                sessionNumber: sessionNumber,
                sessionName: 'Imported Previous Games',
                dateStarted: data.pastGames[data.pastGames.length - 1]?.dateGenerated || new Date().toISOString(),
                dateEnded: data.pastGames[0]?.dateCompleted || new Date().toISOString(),
                status: 'completed',
                queueMode: 'fair_rotation',
                games: data.pastGames.map(migrateGame),
                playerStats: {}
            };

            // Build player stats for the imported session
            importedSession.playerStats = buildStatsFromGames(importedSession.games);

            migrated.pastSessions.push(importedSession);
        }

        // Normalize without writing during a read or import validation.
        return migrateData(migrated);
    }

    // Ensure currentSessionNumber exists in settings
    if (!data.settings) {
        data.settings = { currentGameNumber: 0, currentSessionNumber: 0 };
    } else if (data.settings.currentSessionNumber === undefined) {
        data.settings.currentSessionNumber = 0;
    }

    // Ensure activeSession and pastSessions exist
    if (data.activeSession === undefined) {
        data.activeSession = null;
    }
    if (data.pastSessions === undefined) {
        data.pastSessions = [];
    }

    data.schemaVersion = 3;
    if (data.activeSession) {
        data.activeSession = migrateSession(data.activeSession);
        initializeParticipation(data);
    }
    data.pastSessions = data.pastSessions.map(migrateSession);

    return data;
}

function migrateSession(session: Session) {
    const migrated: Session = {
        ...session,
        queueMode: session.queueMode || 'fair_rotation',
        pendingGame: session.pendingGame ? migrateGame(session.pendingGame) : null,
        currentGame: session.currentGame ? migrateGame(session.currentGame) : null,
        games: Array.isArray(session.games) ? session.games.map(migrateGame) : [],
        playerStats: session.playerStats || {}
    };

    migrated.playerStats = migratePlayerStats(migrated.playerStats, migrated.games);
    if (migrated.status === 'completed' && migrated.leaderboardRanking !== 'points') {
        migrated.finalLeaderboard = getLeaderboard(migrated);
        migrated.leaderboardRanking = 'points';
    }
    return migrated;
}

function migrateGame(game: Game) {
    if (!game) return game;
    const teamA = game.teamA || [];
    const teamB = game.teamB || [];
    const teamAScore = normalizeScore(game.teamAScore);
    const teamBScore = normalizeScore(game.teamBScore);
    let winningTeam = game.winningTeam ?? null;
    let losingTeam = game.losingTeam ?? null;

    if (!winningTeam && Number.isFinite(teamAScore) && Number.isFinite(teamBScore) && teamAScore !== teamBScore) {
        winningTeam = teamAScore > teamBScore ? 'A' : 'B';
        losingTeam = winningTeam === 'A' ? 'B' : 'A';
    }

    const winnerPlayerIds = game.winnerPlayerIds || (winningTeam === 'A' ? teamA : winningTeam === 'B' ? teamB : []).map(p => p.id);
    const loserPlayerIds = game.loserPlayerIds || (losingTeam === 'A' ? teamA : losingTeam === 'B' ? teamB : []).map(p => p.id);

    return {
        ...game,
        endingRule: game.endingRule || game.scoringState?.endingRule || 'standard',
        status: game.status === 'current' ? 'in_progress' : (game.status || (game.dateCompleted ? 'completed' : 'in_progress')),
        teamAScore,
        teamBScore,
        winningTeam,
        losingTeam,
        winnerPlayerIds,
        loserPlayerIds
    };
}

function getEmptySessionStat(player: Pick<Player, 'id' | 'name'>): SessionStat {
    return {
        playerId: player.id,
        playerName: player.name,
        gamesPlayedInSession: 0,
        wins: 0,
        losses: 0,
        pointsFor: 0,
        pointsAgainst: 0,
        pointDifference: 0,
        currentWinStreak: 0,
        currentLossStreak: 0,
        partners: [],
        opponents: []
    };
}

function migratePlayerStats(playerStats: Record<string, SessionStat>, games: Game[]) {
    const stats: Record<string, SessionStat> = {};
    Object.values(playerStats || {}).forEach(stat => {
        stats[stat.playerId] = {
            playerId: stat.playerId,
            playerName: stat.playerName,
            gamesPlayedInSession: stat.gamesPlayedInSession || 0,
            wins: stat.wins || 0,
            losses: stat.losses || 0,
            pointsFor: stat.pointsFor || 0,
            pointsAgainst: stat.pointsAgainst || 0,
            pointDifference: stat.pointDifference ?? ((stat.pointsFor || 0) - (stat.pointsAgainst || 0)),
            currentWinStreak: stat.currentWinStreak || 0,
            currentLossStreak: stat.currentLossStreak || 0,
            partners: Array.isArray(stat.partners) ? stat.partners : [],
            opponents: Array.isArray(stat.opponents) ? stat.opponents : []
        };
    });

    const hasLegacyStats = Object.values(stats).some(stat => stat.gamesPlayedInSession > 0 && stat.wins === 0 && stat.losses === 0 && stat.pointsFor === 0 && stat.pointsAgainst === 0);
    const hasScoredGames = games.some(game => game.winningTeam);
    if (hasLegacyStats && hasScoredGames) {
        return buildStatsFromGames(games);
    }

    return stats;
}

function buildStatsFromGames(games: Game[]) {
    const stats: Record<string, SessionStat> = {};
    [...games].reverse().filter(game => game.status === 'completed').forEach(game => {
        const allPlayers = [...(game.teamA || []), ...(game.teamB || [])];
        allPlayers.forEach(player => {
            if (!stats[player.id]) {
                stats[player.id] = getEmptySessionStat(player);
            }
        });
        applyGameToStats(stats, game);
    });
    return stats;
}

function saveData(data: AppData) {
    try {
        writeStoredData(data);
        return true;
    } catch (error) {
        console.error('Error saving data:', error);
        showToast(error?.message?.includes('another tab') ? error.message : 'Your changes couldn’t be saved. Check browser storage and try again.', 'error');
        return false;
    }
}

// ==================== PLAYER MANAGEMENT ====================

function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function addPlayer(name: string) {
    const data = loadData();

    if (!name || name.trim() === '') {
        const input = byId('playerNameInput');
        input?.setAttribute('aria-invalid', 'true');
        const error = byId('playerNameError');
        if (error) error.textContent = 'Enter a player name to add them to the queue.';
        input?.focus?.();
        showToast('Player name cannot be empty', 'error');
        return false;
    }

    const trimmedName = name.trim();
    byId('playerNameInput')?.removeAttribute?.('aria-invalid');
    const nameError = byId('playerNameError');
    if (nameError) nameError.textContent = '';

    const newPlayer: Player = {
        id: generateId(),
        name: trimmedName,
        isActive: true,
        gamesPlayed: 0,
        lastPlayedGameNumber: null,
        waitingSinceGameNumber: data.settings.currentGameNumber,
        partnerHistory: [],
        opponentHistory: []
    };

    data.players.push(newPlayer);
    initializeParticipation(data);
    if (!saveData(data)) return false;
    renderApp();
    showToast(`Player "${trimmedName}" added`, 'success');
    return true;
}

function removePlayer(playerId: string) {
    const data = loadData();

    // Check if player is in current game
    if (data.activeSession && data.activeSession.currentGame) {
        const playingIds = getCurrentPlayingIds(data);
        if (playingIds.includes(playerId)) {
            showToast('Cannot remove a player currently in a game. Cancel the game first.', 'error');
            return false;
        }
    }

    const playerIndex = data.players.findIndex(p => p.id === playerId);
    if (playerIndex === -1) {
        showToast('Player not found', 'error');
        return false;
    }

    const playerName = data.players[playerIndex].name;
    if (!confirmAction(`Remove player ${playerName}?`, () => removePlayer(playerId))) return false;
    data.players.splice(playerIndex, 1);
    if (!saveData(data)) return false;
    renderApp();
    showToast(`Player "${playerName}" removed`, 'success');
    return true;
}

function togglePlayerActive(playerId: string) {
    const data = loadData();

    // Check if player is in current game
    if (data.activeSession && data.activeSession.currentGame) {
        const playingIds = getCurrentPlayingIds(data);
        if (playingIds.includes(playerId)) {
            showToast('Cannot deactivate a player currently in a game. Cancel the game first.', 'error');
            return false;
        }
    }

    const player = data.players.find(p => p.id === playerId);
    if (!player) {
        showToast('Player not found', 'error');
        return false;
    }

    player.isActive = !player.isActive;

    // Reset waiting priority when activating
    if (player.isActive) {
        player.waitingSinceGameNumber = data.settings.currentGameNumber;
    }

    if (!saveData(data)) return false;
    renderApp();
    const status = player.isActive ? 'activated' : 'deactivated';
    showToast(`Player "${player.name}" ${status}`, 'success');
    return true;
}

// ==================== FAIR QUEUE ALGORITHM ====================

function getActivePlayers(data: AppData) {
    return data.players.filter(p => p.isActive);
}

function getCurrentPlayingIds(data: AppData) {
    if (!data.activeSession || !data.activeSession.currentGame) return [];
    const allPlayers = [...data.activeSession.currentGame.teamA, ...data.activeSession.currentGame.teamB];
    return allPlayers.map(p => p.id);
}

function getWaitingPlayers(data: AppData) {
    return orderedWaitingPlayers(data);
}

function selectPlayersForGame(data: AppData): LineupResult {
    initializeParticipation(data);
    return selectSmartMatch(data);
}

function generateWinnerPriorityQueue(activePlayers: Player[], activeSession: Session): LineupResult {
    const data: AppData = {players:activePlayers,activeSession,pastSessions:[],settings:{currentGameNumber:0,currentSessionNumber:0}};
    initializeParticipation(data);
    return selectSmartMatch(data);
}

// Each player must change partners from their own most recent played match.
// The current match counts when validating a lineup that will start afterwards.
function getLastPartner(player: Player, session: Session) {
    const matches = [session?.currentGame, ...(session?.games || []).filter(g => g.status === 'completed')].filter(Boolean);
    for (const game of matches) {
        const team = [game.teamA, game.teamB].find(t => t.some(p => p.id === player.id));
        if (team) return team.find(p => p.id !== player.id)?.id ?? null;
    }
    return player.partnerHistory?.[player.partnerHistory.length - 1] ?? null;
}

function repeatsLastPartner(a: Player, b: Player, session: Session) {
    return getLastPartner(a, session) === b.id || getLastPartner(b, session) === a.id;
}

function pairSelectedPlayers(selectedPlayers: Player[], activeSession: Session): LineupResult {
    return generateWinnerPriorityQueue(selectedPlayers,activeSession);
}

// ==================== SESSION MANAGEMENT ====================

function startNewSession(queueMode: QueueMode = 'fair_rotation') {
    const data = loadData();

    if (data.activeSession) {
        showToast('A session is already active. End the current session first.', 'error');
        return false;
    }

    if (!QUEUE_MODES[queueMode]) {
        showToast('Choose a valid queue mode.', 'error');
        return false;
    }

    // Show animation
    const animation = byId('sessionAnimation');
    if (animation) {
        animation.classList.add('show');
    }

    data.settings.currentSessionNumber++;

    const activePlayers = getActivePlayers(data);

    // Initialize player stats for the session
    const playerStats: Record<string, SessionStat> = {};
    activePlayers.forEach(player => {
        playerStats[player.id] = getEmptySessionStat(player);
    });

    const session: Session = {
        sessionId: generateId(),
        sessionNumber: data.settings.currentSessionNumber,
        sessionName: `Session ${data.settings.currentSessionNumber}`,
        dateStarted: new Date().toISOString(),
        dateEnded: null,
        status: 'active',
        queueMode,
        currentGame: null,
        games: [],
        playerStats: playerStats
    };

    data.activeSession = session;
    initializeParticipation(data, true);
    if (!saveData(data)) { animation?.classList.remove('show'); return false; }
    renderApp();
    showToast(`Session ${session.sessionNumber} started`, 'success');

    // Keep the original welcome image brief so match controls remain easy to reach.
    setTimeout(() => {
        if (animation) {
            animation.classList.remove('show');
        }
    }, 650);

    return true;
}

function updateSessionQueueMode(queueMode: QueueMode) {
    const data = loadData();

    if (!data.activeSession) {
        showToast('No active session to update', 'error');
        return false;
    }

    if (!QUEUE_MODES[queueMode]) {
        showToast('Choose a valid queue mode.', 'error');
        return false;
    }

    if (data.activeSession.currentGame || data.activeSession.games.length > 0) {
        showToast('Queue mode cannot be changed after play has started.', 'error');
        return false;
    }

    data.activeSession.queueMode = queueMode;
    data.activeSession.pendingGame = null;
    if (!saveData(data)) return false;
    renderApp();
    showToast(`Queue mode set to ${QUEUE_MODES[queueMode].label}`, 'success');
    return true;
}

function endSession() {
    const data = loadData();

    if (!data.activeSession) {
        showToast('No active session to end', 'error');
        return false;
    }

    // Check if there's a current game
    if (data.activeSession.currentGame) {
        showToast('Complete or cancel the current game before ending the session.', 'error');
        return false;
    }

    const sessionId = data.activeSession.sessionId;
    if (!confirmAction('End this session and reveal the final rankings?', () => {
        if (loadData().activeSession?.sessionId !== sessionId) {
            showToast('The active session changed. Review the session before ending it.', 'error');
            return renderApp();
        }
        return endSession();
    })) return false;

    const session = data.activeSession;
    closeParticipation(data);
    session.status = 'completed';
    session.dateEnded = new Date().toISOString();

    session.pendingGame = null;
    session.playerStats = buildStatsFromGames(session.games);
    session.finalLeaderboard = getLeaderboard(session);
    session.leaderboardRanking = 'points';

    data.pastSessions.unshift(session);
    data.activeSession = null;

    if (!saveData(data)) return false;
    renderApp();
    openLeaderboard(session.sessionId);
    showToast(`Session ${session.sessionNumber} ended`, 'success');
    return true;
}

// ==================== GAME MANAGEMENT ====================

function generateNextGame() {
    const data = loadData();

    if (!data.activeSession) {
        showToast('Start a session first.', 'error');
        return false;
    }

    if (data.activeSession.currentGame) {
        showToast('Complete or cancel the current game first.', 'error');
        return false;
    }

    if(data.activeSession.attendanceNeedsReview) {
        const sessionId=data.activeSession.sessionId;
        if(!confirmAction('Confirm current attendance for this session? Existing player availability was preserved. Use Manage Check-In first if anyone is absent.',()=>{
            if(loadData().activeSession?.sessionId!==sessionId) return showToast('The active session changed. Review check-in and try again.','error');
            return generateNextGame();
        })) return false;
        data.activeSession.attendanceNeedsReview=false;
    }

    ensurePendingGame(data);
    const game = data.activeSession.pendingGame;
    if (!game) { showToast(data.activeSession.pendingLineupMessage || 'Need at least four available active players.', 'error'); return false; }
    const problem = pendingLineupProblem(data);
    if (problem) { showToast(problem, 'error'); return false; }
    beginParticipation(data, game);
    transitionMatch(game, 'in_progress');
    game.gameNumber = ++data.settings.currentGameNumber;
    game.dateStarted = new Date().toISOString();
    game.scoringState = null;
    data.activeSession.currentGame = game;
    data.activeSession.pendingGame = null;
    ensurePendingGame(data);
    if (!saveData(data)) return false;
    renderApp();
    showToast(`Game ${game.gameNumber} started`, 'success');
    return true;
}

function completeCurrentGame(options: {expectedGameId?: string; expectedRevision?: number} = null) {
    const data = loadData();

    if (!data.activeSession || !data.activeSession.currentGame) {
        showToast('No current game to complete', 'error');
        return false;
    }

    const game = data.activeSession.currentGame;
    if (game.status !== 'in_progress') return false;
    if (options?.expectedGameId && game.gameId !== options.expectedGameId) {
        showToast('That match is no longer active.', 'error');
        return false;
    }
    let scoreResult;
    if (game.scoringState && (options?.expectedGameId || options?.expectedRevision !== undefined)) {
        try {
            ScoringEngine.validate(game.scoringState);
            if (game.scoringState.teams.A.join('|') !== game.teamA.map(p => p.id).join('|') || game.scoringState.teams.B.join('|') !== game.teamB.map(p => p.id).join('|')) throw new Error('Scoring players do not match the current game.');
            if (game.scoringState.matchId !== game.gameId || game.scoringState.status !== 'game_over') throw new Error('Finish the match on the scoring page before saving.');
            if (options?.expectedRevision !== undefined && game.scoringState.revision !== options.expectedRevision) throw new Error('Scoring changed in another tab. Review the latest score.');
            const {A, B} = game.scoringState.scores;
            const validation = validatePickleballScore(A, B, game.scoringState.target, game.scoringState.endingRule || 'standard');
            scoreResult = {success:validation.isValid, message:validation.message, teamAScore:A, teamBScore:B, winningTeam:validation.winningTeam, losingTeam:validation.losingTeam};
            game.targetScore = game.scoringState.target;
            game.endingRule = game.scoringState.endingRule || 'standard';
        } catch (error) {
            showToast(error.message, 'error');
            return false;
        }
    } else {
        scoreResult = getScoreInputValues(game.scoringState?.target || game.targetScore || 11, game.scoringState?.endingRule || game.endingRule || 'standard');
    }

    if (!scoreResult.success) {
        showToast(scoreResult.message, 'error');
        return false;
    }

    if (!options?.expectedGameId) {
        const previous = game.scoringState;
        const warning = previous ? '\nThis manually entered result replaces scoring state and rally history. An audit copy will be retained; serving positions will be invalidated.' : '';
        const outcome = scoreResult.winningTeam ? `Team ${scoreResult.winningTeam} winning` : 'a tie';
        if (!confirmAction(`Record ${outcome} ${scoreResult.teamAScore} - ${scoreResult.teamBScore}?${warning}`, () => withQueueScoringLock(() => {
            if (JSON.stringify(loadData().activeSession?.currentGame) !== JSON.stringify(game)) {
                showToast('The match changed. Review the latest scores and try again.', 'error');
                return renderApp();
            }
            return completeCurrentGame(options);
        }))) return false;
        // Confirmation may leave time for another tab to score or complete the match.
        const latest = loadData().activeSession?.currentGame;
        if (!latest || JSON.stringify(latest) !== JSON.stringify(game)) {
            showToast('The match changed. Review the latest scores and try again.', 'error');
            renderApp();
            return false;
        }
        if (previous) {
            game.targetScore = previous.target;
            game.endingRule = previous.endingRule || 'standard';
            game.scoringAudit = [...(game.scoringAudit || []), {type:'manual_override', date:new Date().toISOString(), scoringState:previous}];
            delete game.scoringState;
        }
        game.resultSource = 'manual';
    } else {
        game.resultSource = 'rally_scoring';
    }

    game.teamAScore = scoreResult.teamAScore;
    game.teamBScore = scoreResult.teamBScore;
    game.winningTeam = scoreResult.winningTeam;
    game.losingTeam = scoreResult.losingTeam;
    game.winnerPlayerIds = (game.winningTeam === 'A' ? game.teamA : game.winningTeam === 'B' ? game.teamB : []).map(p => p.id);
    game.loserPlayerIds = (game.losingTeam === 'A' ? game.teamA : game.losingTeam === 'B' ? game.teamB : []).map(p => p.id);

    const allPlayerIds = [...game.teamA, ...game.teamB].map(p => p.id);
    const teamAIds = game.teamA.map(p => p.id);
    const teamBIds = game.teamB.map(p => p.id);

    // Update players who played
    data.players.forEach(player => {
        if (allPlayerIds.includes(player.id)) {
            player.gamesPlayed++;
            player.lastPlayedGameNumber = game.gameNumber;
            player.waitingSinceGameNumber = game.gameNumber + 1;

            // Update partner and opponent history
            if (teamAIds.includes(player.id)) {
                const teammates = teamAIds.filter(id => id !== player.id);
                player.partnerHistory.push(...teammates);
                player.opponentHistory.push(...teamBIds);
            } else {
                const teammates = teamBIds.filter(id => id !== player.id);
                player.partnerHistory.push(...teammates);
                player.opponentHistory.push(...teamAIds);
            }
        } else {
            // Players who didn't play keep or improve their waiting priority
            if (player.isActive) {
                player.waitingSinceGameNumber = Math.min(player.waitingSinceGameNumber, game.gameNumber + 1);
            }
        }
    });

    finishParticipation(data, game);
    applyGameToStats(data.activeSession.playerStats, game);

    // Move current game to session games
    transitionMatch(game, 'completed');
    game.dateCompleted = new Date().toISOString();
    data.activeSession.games.unshift(game);
    data.activeSession.currentGame = null;
    reconcileEligibility(data);

    if (!saveData(data)) return false;
    renderApp();
    showToast(`Game ${game.gameNumber} completed`, 'success');
    return true;
}

function getScoreInputValues(_target = 11, _endingRule = 'standard') {
    const teamAInput = byId('teamAScoreInput');
    const teamBInput = byId('teamBScoreInput');

    if (!teamAInput || !teamBInput) {
        return { success: false, message: 'Score inputs are missing.' };
    }

    const teamARaw = teamAInput.value.trim();
    const teamBRaw = teamBInput.value.trim();

    if (teamARaw === '' || teamBRaw === '') {
        return { success: false, message: 'Enter scores for both teams before completing the game.' };
    }

    if (!/^\d+$/.test(teamARaw) || !/^\d+$/.test(teamBRaw)) return {success:false, message:'Scores must be nonnegative whole numbers.'};

    const teamAScore = Number(teamARaw);
    const teamBScore = Number(teamBRaw);
    const validation = validateManualScore(teamAScore, teamBScore);

    if (!validation.isValid) {
        return { success: false, message: validation.message };
    }

    return {
        success: true,
        teamAScore,
        teamBScore,
        winningTeam: validation.winningTeam,
        losingTeam: validation.losingTeam
    };
}

// Manual results are organizer-authoritative, independent of the live scoring rule.
function validateManualScore(a: number, b: number) {
    if (![a, b].every(score => Number.isSafeInteger(score) && score >= 0)) {
        return {isValid:false, message:'Scores must be nonnegative whole numbers.'};
    }
    const winningTeam = a === b ? null : a > b ? 'A' : 'B';
    return {isValid:true, message:'', winningTeam, losingTeam:winningTeam ? (winningTeam === 'A' ? 'B' : 'A') : null};
}

function validateRecordedScore(game: Game) {
    return game.resultSource === 'manual'
        ? validateManualScore(game.teamAScore, game.teamBScore)
        : validatePickleballScore(game.teamAScore, game.teamBScore, game.targetScore || game.scoringState?.target || 11, game.endingRule || game.scoringState?.endingRule || 'standard', true);
}

function validatePickleballScore(teamAScore: number, teamBScore: number, target = 11, endingRule = 'standard', historical = false) {
    if (!Number.isFinite(teamAScore) || !Number.isFinite(teamBScore) || !Number.isSafeInteger(teamAScore) || !Number.isSafeInteger(teamBScore)) {
        return { isValid: false, message: 'Scores must be valid whole numbers.', winningTeam: null, losingTeam: null };
    }

    if (teamAScore < 0 || teamBScore < 0) {
        return { isValid: false, message: 'Scores cannot be negative.', winningTeam: null, losingTeam: null };
    }

    if (teamAScore === teamBScore) {
        return { isValid: false, message: 'Scores cannot be tied. Enter a winning score.', winningTeam: null, losingTeam: null };
    }

    const winningScore = Math.max(teamAScore, teamBScore);
    const lead = Math.abs(teamAScore - teamBScore);

    if (![11, 15, 21].includes(target)) return {isValid:false, message:'Invalid target score.'};
    if (winningScore < target) {
        return { isValid: false, message: `The winning team must score at least ${target} points.`, winningTeam: null, losingTeam: null };
    }

    if (!['standard', 'golden_point'].includes(endingRule)) return {isValid:false, message:'Invalid game ending rule.'};
    if (lead < (endingRule === 'golden_point' ? 1 : 2)) {
        return { isValid: false, message: 'A team must win by at least 2 points.', winningTeam: null, losingTeam: null };
    }

    if (!historical && ((endingRule === 'golden_point' && winningScore !== target) ||
        (endingRule === 'standard' && winningScore > target && lead !== 2))) {
        return {isValid:false, message:'The game should already have ended before this score. Enter the score at the winning point.'};
    }

    const winningTeam = teamAScore > teamBScore ? 'A' : 'B';
    const losingTeam = winningTeam === 'A' ? 'B' : 'A';

    return { isValid: true, message: '', winningTeam, losingTeam };
}

function applyGameToStats(playerStats: Record<string, SessionStat>, game: Game) {
    const teamAIds = game.teamA.map(p => p.id);
    const teamBIds = game.teamB.map(p => p.id);
    const allPlayers = [...game.teamA, ...game.teamB];

    allPlayers.forEach(player => {
        if (!playerStats[player.id]) {
            playerStats[player.id] = getEmptySessionStat(player);
        }
    });

    allPlayers.forEach(player => {
        const stat = playerStats[player.id];
        const isTeamA = teamAIds.includes(player.id);
        const teammateIds = isTeamA ? teamAIds.filter(id => id !== player.id) : teamBIds.filter(id => id !== player.id);
        const opponentIds = isTeamA ? teamBIds : teamAIds;
        const pointsFor = isTeamA ? game.teamAScore : game.teamBScore;
        const pointsAgainst = isTeamA ? game.teamBScore : game.teamAScore;
        const isWinner = isTeamA ? game.teamAScore > game.teamBScore : game.teamBScore > game.teamAScore;

        stat.playerName = player.name;
        stat.gamesPlayedInSession++;
        stat.partners.push(...teammateIds);
        stat.opponents.push(...opponentIds);

        if (Number.isFinite(pointsFor) && Number.isFinite(pointsAgainst)) {
            stat.pointsFor += pointsFor;
            stat.pointsAgainst += pointsAgainst;
            stat.pointDifference = stat.pointsFor - stat.pointsAgainst;
        }

        if (game.status !== 'cancelled' && Number.isFinite(game.teamAScore) && Number.isFinite(game.teamBScore) && validateRecordedScore(game).isValid) {
            if (game.teamAScore === game.teamBScore) {
                stat.currentWinStreak = 0;
                stat.currentLossStreak = 0;
            } else if (isWinner) {
                stat.wins++;
                stat.currentWinStreak++;
                stat.currentLossStreak = 0;
            } else {
                stat.losses++;
                stat.currentLossStreak++;
                stat.currentWinStreak = 0;
            }
        }
    });
}

function cancelCurrentGame() {
    const data = loadData();

    if (!data.activeSession || !data.activeSession.currentGame) {
        showToast('No current game to cancel', 'error');
        return false;
    }

    const matchId = data.activeSession.currentGame.gameId;
    if (!confirmAction('Cancel the current game? No statistics will be recorded.', () => {
        if (loadData().activeSession?.currentGame?.gameId !== matchId) {
            showToast('The current match changed. Review the court before cancelling.', 'error');
            return renderApp();
        }
        return cancelCurrentGame();
    })) return false;
    const game = data.activeSession.currentGame;
    const gameNumber = game.gameNumber;
    transitionMatch(game, 'cancelled');
    data.activeSession.cancelledGames = [...(data.activeSession.cancelledGames || []), game];
    data.activeSession.currentGame = null;
    reconcileEligibility(data);

    if (!saveData(data)) return false;
    renderApp();
    showToast(`Game ${gameNumber} cancelled`, 'success');
    return true;
}

// ==================== DATA TOOLS ====================

function exportJson() {
    const data = loadData();
    const dateStr = new Date().toISOString().split('T')[0];
    const filename = `pickleball-queue-backup-${dateStr}.json`;

    const jsonStr = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showToast('Backup exported successfully', 'success');
}

function importJson(file: File) {
    const reader = new FileReader();

    reader.onload = function(e) {
        try {
            const importedData = JSON.parse(String(e.target.result));

            // Validate structure
            if (!importedData.players || !Array.isArray(importedData.players)) {
                throw new Error('Invalid data structure: missing players array');
            }
            if (!importedData.settings || typeof importedData.settings.currentGameNumber !== 'number') {
                throw new Error('Invalid data structure: missing settings');
            }
            // Check for new structure (activeSession, pastSessions) or old structure (currentGame, pastGames)
            const hasNewStructure = importedData.activeSession !== undefined || importedData.pastSessions !== undefined;
            const hasOldStructure = importedData.currentGame !== undefined || importedData.pastGames !== undefined;

            if (!hasNewStructure && !hasOldStructure) {
                throw new Error('Invalid data structure: missing session or game data');
            }

            applyImportedData(importedData);
        } catch (error) {
            console.error('Import error:', error);
            showToast('Invalid JSON file: ' + error.message, 'error');
        }
    };

    reader.onerror = function() {
        showToast('Error reading file', 'error');
    };

    reader.readAsText(file);
}

function applyImportedData(importedData: AppData) {
    if (!confirmAction('This will replace all current data. Are you sure?', () => applyImportedData(importedData))) return;
    const dataToSave = migrateData(importedData);
    if (!saveData(dataToSave)) return;
    renderApp();
    showToast('Backup imported successfully', 'success');
}

function clearPastSessions() {
    if (confirmAction('This will delete all past sessions. Players will not be affected. Are you sure?', clearPastSessions)) {
        const data = loadData();
        data.pastSessions = [];
        if (!saveData(data)) return false;
        renderApp();
        showToast('Past sessions cleared', 'success');
    }
}

function resetAllData() {
    if (confirmAction('This will delete ALL data including players, games, and settings. This cannot be undone. Are you sure?', resetAllData)) {
        localStorage.removeItem(STORAGE_KEY);
        renderApp();
        showToast('All data reset', 'success');
    }
}

// ==================== UI RENDERING ====================

function renderApp() {
    const data = loadData();
    if (ensurePendingGame(data)) saveData(data);
    if (document.body?.dataset.page === 'scoring') return;
    renderSession(data);
    renderUpcoming(data);
    renderLeaderboard(data);
    renderCurrentGame(data);
    renderPlayerList(data);
    renderPastSessions(data);
    renderLeaderboardPreview(data);
    renderSessionInfo(data);
    renderParticipation(data);
}

function renderSession(data: AppData) {
    const container = byId('sessionSection');

    if (!data.activeSession) {
        container.innerHTML = `
            <div class="no-session">
                ${emptyState('Your next session starts here', 'Add your players, then start a session to get everyone on court.', 'court')}
                <button id="startSessionBtn" class="btn btn-primary">Start New Session</button>
            </div>
        `;
        const btn = byId('startSessionBtn');
        if (btn) {
            btn.addEventListener('click', openQueueModeModal);
        }
        return;
    }

    const session = data.activeSession;
    const startedDate = new Date(session.dateStarted);
    const dateStr = startedDate.toLocaleDateString() + ' ' + startedDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    container.innerHTML = `
        <div class="session-card">
            <div class="session-header">
                <div>
                    <span class="session-name">${escapeHtml(session.sessionName)}</span>
                    <span class="session-date">Started: ${dateStr}</span>
                </div>
                <span class="queue-mode-badge">${getQueueModeLabel(session.queueMode)}</span>
            </div>
            <div class="session-stats">
                <span class="session-stat"><span class="session-stat-label">Games:</span> ${session.games.filter(g => g.status === 'completed').length}</span>
            </div>
            <div class="session-actions">
                <button id="liveLeaderboardBtn" class="btn btn-primary">View Live Leaderboard</button>
                <button id="endSessionBtn" class="btn btn-danger">End Session</button>
            </div>
        </div>
    `;

    byId('liveLeaderboardBtn').addEventListener('click', () => openLeaderboard());
    byId('endSessionBtn').addEventListener('click', endSession);
}

function renderCurrentGame(data: AppData) {
    const container = byId('currentGameSection');

    if (!data.activeSession || !data.activeSession.currentGame) {
        container.innerHTML = `
            <div class="no-game">
                ${emptyState('Court available', data.activeSession ? 'Start the prepared lineup when your players are ready.' : 'Start a session to set up your first game.', 'court')}
                ${data.activeSession && !data.activeSession.pendingGame && getActivePlayers(data).length >= 4 ? '<button id="generateGameBtn" class="btn btn-primary">Start Game</button>' : ''}
            </div>
        `;
        const btn = byId('generateGameBtn');
        if (btn) {
            btn.addEventListener('click', generateNextGame);
        }
        return;
    }

    const game = data.activeSession.currentGame;

    container.innerHTML = `
        <div class="game-card">
            <div class="game-number">Game #${game.gameNumber} · In progress</div>
            <div class="match-card">
                <div class="team-card team-a">
                    <div class="team-label">Team A</div>
                    <div class="team-players">
                        ${game.teamA.map(p => `<div class="team-player" title="${escapeHtml(p.name)}">${escapeHtml(p.name)}</div>`).join('')}
                    </div>
                    <div class="score-field team-score-field">
                        <span>Team A Score</span>
                        <span class="score-stepper"><button type="button" data-score-team="A" data-score-step="-1" aria-label="Decrease Team A score">&minus;</button><input value="${game.scoringState?.scores.A ?? game.teamAScore ?? ''}" type="number" id="teamAScoreInput" aria-label="Team A Score" min="0" step="1" inputmode="numeric" placeholder="0"><button type="button" data-score-team="A" data-score-step="1" aria-label="Increase Team A score">+</button></span>
                    </div>
                </div>

                <div class="versus-indicator">VS</div>

                <div class="team-card team-b">
                    <div class="team-label">Team B</div>
                    <div class="team-players">
                        ${game.teamB.map(p => `<div class="team-player" title="${escapeHtml(p.name)}">${escapeHtml(p.name)}</div>`).join('')}
                    </div>
                    <div class="score-field team-score-field">
                        <span>Team B Score</span>
                        <span class="score-stepper"><button type="button" data-score-team="B" data-score-step="-1" aria-label="Decrease Team B score">&minus;</button><input value="${game.scoringState?.scores.B ?? game.teamBScore ?? ''}" type="number" id="teamBScoreInput" aria-label="Team B Score" min="0" step="1" inputmode="numeric" placeholder="0"><button type="button" data-score-team="B" data-score-step="1" aria-label="Increase Team B score">+</button></span>
                    </div>
                </div>
            </div>

            <label class="queue-rule">Game Ending Rule
                <select id="dashboardEndingRule" ${game.scoringState?.hasRecordedRally || game.scoringState?.history.length || Number(game.teamAScore) > 0 || Number(game.teamBScore) > 0 ? 'disabled' : ''}>
                    <option value="standard" ${(game.scoringState?.endingRule || game.endingRule || 'standard') === 'standard' ? 'selected' : ''}>✓ Standard · Win by 2</option>
                    <option value="golden_point" ${(game.scoringState?.endingRule || game.endingRule) === 'golden_point' ? 'selected' : ''}>Sudden Death · Golden Point</option>
                </select>
            </label>
            <a class="btn btn-primary open-scoring-btn" href="${pageUrl('scoring', '?match=' + encodeURIComponent(game.gameId))}">${uiIcon('scoring')} Open Scoring</a>
            <button id="completeGameBtn" class="btn btn-success">${uiIcon('check')} Complete Game</button>
            <button id="cancelGameBtn" class="btn btn-danger" >Cancel Current Game</button>
        </div>
    `;

    byId('completeGameBtn').addEventListener('click', () => withQueueScoringLock(() => completeCurrentGame()));
    document.querySelectorAll<HTMLElement>('[data-score-step]').forEach(button => button.addEventListener('click', () => {
        const input = byId(`team${button.dataset.scoreTeam}ScoreInput`);
        const score = Number(input.value || 0);
        if (Number.isSafeInteger(score) && score >= 0) input.value = String(Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, score + Number(button.dataset.scoreStep))));
    }));
    byId('cancelGameBtn').addEventListener('click', cancelCurrentGame);
    byId('dashboardEndingRule').onchange = () => withQueueScoringLock(() => {
        const latest = loadData();
        const current = latest.activeSession?.currentGame;
        if (!current || current.gameId !== game.gameId) return renderApp();
        const rule = byId('dashboardEndingRule').value as import('../types').EndingRule;
        if (!['standard', 'golden_point'].includes(rule)) return;
        if (current.scoringState?.hasRecordedRally || current.scoringState?.history.length || Number(current.teamAScore) > 0 || Number(current.teamBScore) > 0) {
            showToast('Reset scoring before changing the ending rule.', 'error');
            return renderApp();
        }
        if (current.scoringState) current.scoringState = ScoringEngine.setEndingRule(current.scoringState, rule);
        current.endingRule = rule;
        saveData(latest);
        renderApp();
    });
    for (const team of ['A', 'B']) byId(`team${team}ScoreInput`).addEventListener('change', () => withQueueScoringLock(() => {
        const input = byId(`team${team}ScoreInput`);
        const value = input.value === '' ? null : Number(input.value);
        if (value !== null && (!Number.isSafeInteger(value) || value < 0)) return;
        const latest = loadData();
        const current = latest.activeSession?.currentGame;
        if (!current || current.gameId !== game.gameId || current.scoringState) return;
        current[team === 'A' ? 'teamAScore' : 'teamBScore'] = value;
        saveData(latest);
    }));
}

function renderWaitingPlayers(data: AppData) { renderPlayerList(data); }

function renderPlayerList(data: AppData) {
    renderRoster(data, {
        getData:loadData, waiting:getWaitingPlayers,
        toggleActive:id=>withQueueScoringLock(()=>togglePlayerActive(id)),
        remove:id=>withQueueScoringLock(()=>removePlayer(id)),
        attendance:(id,status)=>withQueueScoringLock(()=>updateAttendance(id,status)),
        addPlayer:()=>{
            const input=byId('playerNameInput');
            input.focus();
            input.scrollIntoView({block:'center',behavior:'instant'});
        }
    });
}

function renderPastSessions(data: AppData) {
    const container = byId('pastSessionsSection');

    if (data.pastSessions.length === 0) {
        container.innerHTML = `
            <div class="no-past-sessions">
                ${emptyState('No past sessions yet', 'Finished sessions, match results and final rankings will be saved here.', 'clock')}
            </div>
        `;
        return;
    }

    container.innerHTML = data.pastSessions.map(session => {
        const startedDate = new Date(session.dateStarted);
        const endedDate = new Date(session.dateEnded);
        const startedStr = formatDateTime(startedDate);
        const endedStr = formatDateTime(endedDate);
        const playerCount = Object.keys(session.playerStats || {}).length;
        const totalGames = session.games.filter(g => g.status === 'completed').length;

        return `
            <div class="past-session-item">
                <div class="past-session-header">
                    <div class="past-session-info">
                        <div class="past-session-name">${escapeHtml(session.sessionName)}</div>
                        <div class="past-session-dates">Started: ${startedStr} | Ended: ${endedStr}</div>
                        <div class="past-session-stats-summary"><span class="queue-mode-badge small">${getQueueModeLabel(session.queueMode)}</span> ${totalGames} games | ${playerCount} players</div>
                    </div>
                    <button class="expand-btn" data-session-id="${session.sessionId}">Expand</button>
                </div>
                <div class="session-games-list" id="games-${session.sessionId}">
                    ${renderSessionStatsSummary(session.playerStats)}<button class="btn btn-primary results-btn" data-session-id="${session.sessionId}">View Final Results</button>
                    ${session.games.map(game => {
                        const completedDate = new Date(game.dateCompleted);
                        const dateStr = formatDateTime(completedDate);
                        const scoreText = hasRecordedScore(game)
                            ? `Team A ${game.teamAScore} - Team B ${game.teamBScore}`
                            : 'No score recorded.';
                        const winnerText = game.winningTeam ? `Team ${game.winningTeam}` : hasRecordedScore(game) ? 'Tie' : 'No score recorded.';

                        return `
                            <div class="session-game-item">
                                <div class="session-game-header">
                                    <span class="session-game-number">Game #${game.gameNumber}</span>
                                    <span class="session-game-date">${dateStr}</span>
                                </div>
                                <div class="session-game-score">${scoreText} | Winner: ${winnerText}</div>
                                <div class="session-game-teams">
                                    <div class="session-game-team">
                                        <span class="session-game-team-label">Team A:</span>
                                        ${game.teamA.map(p => escapeHtml(p.name)).join(', ')}${hasRecordedScore(game) ? ` (${game.teamAScore})` : ''}
                                    </div>
                                    <div class="session-game-team">
                                        <span class="session-game-team-label">Team B:</span>
                                        ${game.teamB.map(p => escapeHtml(p.name)).join(', ')}${hasRecordedScore(game) ? ` (${game.teamBScore})` : ''}
                                    </div>
                                </div>
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>
        `;
    }).join('');

    document.querySelectorAll<HTMLElement>('.results-btn').forEach(btn => btn.addEventListener('click', () => openLeaderboard(btn.dataset.sessionId)));
    // Add event listeners for expand buttons
    document.querySelectorAll<HTMLElement>('.expand-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const sessionId = (e.target as HTMLElement).dataset.sessionId;
            const gamesList = byId(`games-${sessionId}`);
            gamesList.classList.toggle('expanded');
            (e.target as HTMLElement).textContent = gamesList.classList.contains('expanded') ? 'Collapse' : 'Expand';
        });
    });
}

// ==================== UTILITY FUNCTIONS ====================

let queueModeReturnFocus: HTMLElement = null;

function openQueueModeModal() {
    const modal = byId('queueModeModal');
    const defaultOption = document.querySelector<HTMLInputElement>('input[name="modalQueueMode"][value="fair_rotation"]');

    if (defaultOption) {
        defaultOption.checked = true;
    }

    if (modal) {
        queueModeReturnFocus = document.activeElement as HTMLElement;
        modal.classList.add('show');
        modal.setAttribute('aria-hidden', 'false');
        defaultOption?.focus();
    }
}

function closeQueueModeModal() {
    const modal = byId('queueModeModal');

    if (modal) {
        const wasOpen = modal.classList.contains('show');
        modal.classList.remove('show');
        modal.setAttribute('aria-hidden', 'true');
        if (wasOpen) queueModeReturnFocus?.focus();
    }
}

function confirmQueueModeSelection() {
    const selectedMode = document.querySelector<HTMLInputElement>('input[name="modalQueueMode"]:checked')?.value || 'fair_rotation';

    if (startNewSession(selectedMode as QueueMode)) {
        closeQueueModeModal();
    }
}

function getQueueModeLabel(queueMode: QueueMode) {
    return QUEUE_MODES[queueMode]?.label || QUEUE_MODES.fair_rotation.label;
}

function normalizeScore(score: unknown) {
    if (score === null || score === undefined || score === '') {
        return null;
    }

    const numericScore = Number(score);
    return Number.isFinite(numericScore) ? numericScore : null;
}

function formatDateTime(date: Date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
        return 'Unknown';
    }

    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function hasRecordedScore(game: Game) {
    return Number.isFinite(game.teamAScore) && Number.isFinite(game.teamBScore);
}

function getSortedSessionStats(playerStats: Record<string, SessionStat>) {
    return Object.values(playerStats || {}).sort((a, b) => {
        if (a.wins !== b.wins) return b.wins - a.wins;
        if (a.pointDifference !== b.pointDifference) return b.pointDifference - a.pointDifference;
        return b.gamesPlayedInSession - a.gamesPlayedInSession;
    });
}

function renderSessionStatsSummary(playerStats: Record<string, SessionStat>) {
    const stats = getSortedSessionStats(playerStats);

    if (stats.length === 0) {
        return `
            <div class="session-stats-history">
                <div class="session-stats-heading">Player Stats</div>
                <p class="session-stats-empty">No player stats recorded.</p>
            </div>
        `;
    }

    return `
        <div class="session-stats-history">
            <div class="session-stats-heading">Player Stats</div>
            <div class="stats-table-wrap">
                <table class="stats-table">
                    <thead>
                        <tr>
                            <th>Player</th>
                            <th>GP</th>
                            <th>W</th>
                            <th>L</th>
                            <th>PF</th>
                            <th>PA</th>
                            <th>+/-</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${stats.map(stat => `
                            <tr>
                                <td>${escapeHtml(stat.playerName)}</td>
                                <td>${stat.gamesPlayedInSession}</td>
                                <td>${stat.wins}</td>
                                <td>${stat.losses}</td>
                                <td>${stat.pointsFor}</td>
                                <td>${stat.pointsAgainst}</td>
                                <td>${stat.pointDifference}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        </div>
    `;
}

function showToast(message: string, type = 'info') {
    notify(message, type);
}

// ==================== TAB NAVIGATION ====================

function setupTabNavigation() {
    const labels: Record<string, string> = {queue:'Queue', leaderboard:'Leaderboard', sessions:'Sessions', players:'Players', data:'Data & backups'};
    const descriptions: Record<string, string> = {queue:'Your court. Your crew. The next great game.', leaderboard:'Every point counts. See how the session is shaping up.', sessions:'Good games, saved. Revisit your past sessions.', players:'The people who make the game.', data:'Keep a copy of your players, scores and session history.'};
    const toggle = byId('navigationToggle');
    const utility = byId('utilityMenu');
    const closeMenu = () => { utility.hidden = true; toggle.setAttribute('aria-expanded', 'false'); };
    toggle.addEventListener('click', () => {
        utility.hidden = !utility.hidden;
        toggle.setAttribute('aria-expanded', String(!utility.hidden));
    });
    document.addEventListener('click', e => { if (!(e.target as HTMLElement).closest('.header')) closeMenu(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !utility.hidden) { closeMenu(); toggle.focus(); } });
    function selectView() {
        const requested = location.hash.slice(1) || document.body.dataset.initialView || 'queue';
        const view = labels[requested] ? requested : 'queue';
        document.querySelectorAll<HTMLElement>('.tab-btn').forEach(button => {
            const active = button.dataset.tab === view;
            button.classList.toggle('active', active);
            if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
        });
        document.querySelectorAll<HTMLElement>('.tab-content').forEach(content => content.classList.toggle('active', content.id === `${view}-tab`));
        byId('currentViewLabel').textContent = labels[view];
        byId('viewDescription').textContent = descriptions[view];
        document.title = `${labels[view]} · KAMPO Pickle Ball`;
        document.body.dataset.view=view;
        // Move existing components: same inputs, handlers, player records and IDs.
        const destination = view === 'players' ? byId('playersWorkspace') : null;
        (destination || byId('queueAddSlot')).appendChild(document.querySelector<HTMLElement>('.add-card'));
        (destination || byId('queuePlayersSlot')).appendChild(document.querySelector<HTMLElement>('.players-card'));
        (destination || byId('queueParticipationSlot')).appendChild(byId('participationCard'));
        (destination || byId('queueFixedPartnersSlot')).appendChild(byId('fixedPartnersCard'));
        renderPlayerList(loadData());
        closeMenu();
    }
    document.querySelectorAll<HTMLElement>('.tab-btn').forEach(button => button.addEventListener('click', event => {
        event.preventDefault();
        const view = button.dataset.tab;
        if (view === 'scoring') {
            const game = loadData().activeSession?.currentGame;
            location.assign(pageUrl('scoring', game ? '?match=' + encodeURIComponent(game.gameId) : ''));
            return;
        }
        if (location.hash === `#${view}`) selectView(); else location.hash = view;
    }));
    window.addEventListener('hashchange', selectView);
    window.addEventListener('pageshow', selectView);
    selectView();
}

// ==================== EVENT LISTENERS ====================

function setupEventListeners() {
    byId('playerNameInput').addEventListener('input', () => {
        byId('playerNameInput').removeAttribute('aria-invalid');
        byId('playerNameError').textContent = '';
    });
    // Add player
    byId('addPlayerBtn').addEventListener('click', () => {
        const input = byId('playerNameInput');
        const name = input.value.trim();
        if (addPlayer(name)) {
            input.value = '';
        }
    });

    // Add player on Enter key
    byId('playerNameInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            const input = e.target as HTMLInputElement;
            const name = input.value.trim();
            if (addPlayer(name)) {
                input.value = '';
            }
        }
    });

    // Export JSON
    byId('exportJsonBtn').addEventListener('click', exportJson);

    // Import JSON
    byId('importJsonBtn').addEventListener('click', () => {
        byId('importJsonInput').click();
    });

    byId('importJsonInput').addEventListener('change', (e) => {
        const file = (e.target as HTMLInputElement).files[0];
        if (file) {
            importJson(file);
            (e.target as HTMLInputElement).value = ''; // Reset input
        }
    });

    // Clear past sessions
    byId('clearPastSessionsBtn').addEventListener('click', clearPastSessions);

    // Reset all data
    byId('resetAllDataBtn').addEventListener('click', resetAllData);

    const queueModeModal = byId('queueModeModal');
    const closeQueueModeModalBtn = byId('closeQueueModeModalBtn');
    const cancelQueueModeModalBtn = byId('cancelQueueModeModalBtn');
    const confirmQueueModeBtn = byId('confirmQueueModeBtn');

    if (closeQueueModeModalBtn) {
        closeQueueModeModalBtn.addEventListener('click', closeQueueModeModal);
    }

    if (cancelQueueModeModalBtn) {
        cancelQueueModeModalBtn.addEventListener('click', closeQueueModeModal);
    }

    if (confirmQueueModeBtn) {
        confirmQueueModeBtn.addEventListener('click', confirmQueueModeSelection);
    }

    if (queueModeModal) {
        queueModeModal.addEventListener('keydown', event => {
            if (event.key !== 'Tab') return;
            const controls = [...queueModeModal.querySelectorAll<HTMLElement>('button:not(:disabled), input:checked')];
            const first = controls[0], last = controls.at(-1);
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        });
        queueModeModal.addEventListener('click', (e) => {
            if (e.target === queueModeModal) {
                closeQueueModeModal();
            }
        });
    }

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeQueueModeModal();
        }
    });
}

// ==================== INITIALIZATION ====================

function init() {
    subscribe(data => { if (data === null) renderApp(); });
    setupTabNavigation();
    setupEventListeners();
    renderApp();
    if (location.hash === '#leaderboard') openLeaderboard();
}

// Pending assignments use a projection; previews never mutate rotation statistics.
function escapeHtml(value: unknown) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
}

function transitionMatch(game: Game, next: string) {
    const allowed: Record<string, string[]> = {pending: ['in_progress'], in_progress: ['completed', 'cancelled']};
    if (!allowed[game.status]?.includes(next)) throw new Error('Invalid match transition');
    game.status = next;
}

function isPendingValid(data: AppData) {
    initializeParticipation(data);
    return !!data.activeSession?.pendingGame && !pendingLineupProblem(data);
}

function ensurePendingGame(data: AppData, force = false, now = Date.now()) {
    const session=data.activeSession;
    if (!session) return false;
    let changed=initializeParticipation(data,false,now);
    changed=reconcileEligibility(data,now)||changed;
    if (session.pendingGame && !force) {
        const reason=pendingLineupProblem(data);
        if (session.pendingInvalidReason!==reason) {session.pendingInvalidReason=reason;changed=true;}
        return changed;
    }
    const hadPending=!!session.pendingGame;
    session.pendingGame=null;
    reconcileEligibility(data,now);
    let result=selectSmartMatch(data,now);
    // Preserve four-player preview behavior, but never create a second active game.
    if (!result.success && session.currentGame) {
        const projected: AppData=JSON.parse(JSON.stringify(data));
        finishParticipation(projected,projected.activeSession.currentGame,now);
        projected.activeSession.currentGame=null;
        reconcileEligibility(projected,now);
        result=selectSmartMatch(projected,now);
    }
    if (!result.success) {
        const message=result.message;
        changed=session.pendingLineupMessage!==message||changed;
        session.pendingLineupMessage=message;
        session.pendingInvalidReason=null;
        return changed||hadPending;
    }
    session.pendingLineupMessage=null;
    session.pendingInvalidReason=null;
    session.pendingGame={gameId:generateId(),gameNumber:data.settings.currentGameNumber+1,
        teamA:result.teamA.map(p=>({id:p.id,name:p.name})),teamB:result.teamB.map(p=>({id:p.id,name:p.name})),
        endingRule:session.endingRule||'standard',targetScore:session.targetScore||11,
        status:'pending',dateGenerated:new Date().toISOString(),lineupLocked:false,
        teamAScore:null,teamBScore:null,winningTeam:null,losingTeam:null,winnerPlayerIds:[],loserPlayerIds:[]};
    reconcileEligibility(data,now);
    return true;
}

function regenerateNextLineup() {
    if (!confirmAction('Replace the prepared next lineup?', regenerateNextLineup)) return;
    const data = loadData();
    ensurePendingGame(data, true);
    if (!saveData(data)) return false;
    renderApp();
}

function renderUpcoming(data: AppData) {
    const container = byId('upcomingGameSection');
    const session = data.activeSession;
    const game = session?.pendingGame;
    if (!game) {
        container.innerHTML = `<div class="upcoming-card">${emptyState(session ? 'Getting the next game ready' : 'The next game is waiting', session ? session.pendingLineupMessage || 'Check in available players to prepare a lineup.' : 'Start a session and check your players in to prepare a fair lineup.', 'players')}</div>`;
        return;
    }
    const playing = getCurrentPlayingIds(data);
    const reuse = [...game.teamA, ...game.teamB].some(p => playing.includes(p.id));
    const problem = pendingLineupProblem(data);
    const fixedTeam = (team: Game['teamA']) => activePair(session,team[0].id)?.playerIds.every(id=>team.some(p=>p.id===id));
    container.innerHTML = `<div class="upcoming-card">
        <h3>Game #${game.gameNumber}</h3>
        <div class="upcoming-teams"><div><strong>Team A${fixedTeam(game.teamA) ? ' · Fixed' : ''}</strong><p>${game.teamA.map(p => escapeHtml(p.name)).join(' / ')}</p></div>
        <span>VS</span><div><strong>Team B${fixedTeam(game.teamB) ? ' · Fixed' : ''}</strong><p>${game.teamB.map(p => escapeHtml(p.name)).join(' / ')}</p></div></div>
        ${problem ? `<p class="lineup-warning" role="alert">${escapeHtml(problem)} Your saved lineup has not been changed.</p>` : ''}
        ${game.lineupLocked ? '<span class="lineup-lock">Lineup confirmed</span>' : '<p class="lineup-notice">Prepared lineup · saved until you explicitly regenerate it.</p>'}
        <p class="lineup-status" role="status">${problem ? 'Needs attention · Resolve this lineup before starting' : session.currentGame ? `Waiting for current match${reuse ? ' · Returning players will play again after finishing' : ' · Next players can prepare'}` : 'Ready to Play · Court available'}</p>
        <button id="startNextGameBtn" class="btn btn-primary" ${session.currentGame || problem ? 'disabled' : ''}>Start Next Game →</button>
        ${!game.lineupLocked && !problem ? '<button id="lockLineupBtn" class="btn btn-secondary">Confirm Lineup</button>' : ''}
        <button id="regenerateLineupBtn" class="btn btn-secondary">Regenerate Next Lineup</button>
    </div>`;
    byId('startNextGameBtn').addEventListener('click', generateNextGame);
    byId('regenerateLineupBtn').addEventListener('click', regenerateNextLineup);
    byId('lockLineupBtn')?.addEventListener('click', lockPendingLineup);
}

function participationMutation(change: (data: AppData) => void, message: string) {
    const data=loadData();
    if(!data.activeSession) {showToast('Start a session before managing attendance or partners.','error');return false;}
    try {
        initializeParticipation(data);
        change(data);
        ensurePendingGame(data);
        if(!saveData(data)) return false;
        renderApp();
        showToast(message,'success');
        return true;
    } catch(error) {showToast(error.message,'error');return false;}
}
function updateAttendance(playerId: string, status: AttendanceStatus) {
    return participationMutation(data=>{setAttendance(data,playerId,status);},`Attendance updated · ${attendanceLabels[status]}`);
}
function changeAllAttendance(status: 'checked_in' | 'not_arrived') {
    const session=loadData().activeSession;
    if(!session) {showToast('Start a session before managing check-in.','error');return false;}
    if(status==='not_arrived'&&session.currentGame) {showToast('Finish or cancel the current game before resetting attendance.','error');return false;}
    const message=status==='checked_in'?'Check in all registered players for this session?':'Reset session attendance to Not Arrived? Player records, match history and statistics will be kept.';
    if(!confirmAction(message,()=>{
        if(loadData().activeSession?.sessionId!==session.sessionId) return showToast('The session changed. Review attendance and try again.','error');
        return changeAllAttendance(status);
    })) return false;
    return participationMutation(data=>bulkAttendance(data,status),status==='checked_in'?'All players checked in':'Session attendance reset');
}
function createFixedPartnership(first: string, second: string) {
    const result=participationMutation(data=>addFixedPair(data,first,second,generateId()),'Fixed partnership saved');
    const problem=loadData().activeSession?.pendingInvalidReason;
    if(result&&problem) showToast('Pair saved. The prepared lineup needs explicit regeneration.','warning');
    return result;
}
function removeFixedPartnership(pairId: string) {
    if(!confirmAction('Remove fixed partnership? Future games may rotate their teammates. Attendance, scores and history will be kept.',()=>removeFixedPartnership(pairId))) return false;
    return participationMutation(data=>removeFixedPair(data,pairId),'Fixed partnership removed');
}
function lockPendingLineup() {
    return participationMutation(data=>{
        const problem=pendingLineupProblem(data);
        if(problem) throw new Error(problem);
        data.activeSession.pendingGame.lineupLocked=true;
    },'Upcoming lineup confirmed');
}
function renderParticipation(data: AppData) {
    const summary=byId('attendanceSummary');
    if(!summary) return;
    const session=data.activeSession;
    byId('manageCheckInBtn').onclick=()=>openParticipationManager();
    byId('manageFixedPartnersBtn').onclick=()=>openParticipationManager(true);
    byId('manageFixedPartnersMobileBtn').onclick=()=>openParticipationManager(true);
    byId('closeParticipationBtn').onclick=()=>byId('participationDialog').close();
    if(!session) {
        byId('manageFixedPartnersMobileBtn').textContent='Fixed Partners';
        summary.innerHTML='<p class="participation-empty">Start a session to check players in and manage optional fixed partners.</p>';
        byId('fixedPairSummary').innerHTML='';
        byId('attendanceManager').innerHTML='<p class="participation-empty">No active session. Start one from Queue.</p>';
        byId('fixedPairManager').innerHTML='';
        return;
    }
    const counts=Object.fromEntries(Object.keys(attendanceLabels).map(status=>[status,data.players.filter(p=>session.attendance[p.id]?.status===status).length]));
    summary.innerHTML=`<p class="attendance-total"><strong>${data.players.length}</strong> registered players</p><div class="attendance-summary">${(['checked_in','on_break','not_arrived','checked_out'] as AttendanceStatus[]).map(status=>`<span class="attendance-count ${status}">${attendanceLabels[status]} <strong>${counts[status]}</strong></span>`).join('')}</div>${session.attendanceNeedsReview?'<p class="migration-note">Existing availability preserved. Review check-in before the next game.</p>':''}`;
    const pairs=session.fixedPairs.filter(p=>p.active);
    byId('manageFixedPartnersMobileBtn').textContent=`Fixed Partners (${pairs.length})`;
    byId('fixedPairSummary').innerHTML=`<div class="fixed-summary"><strong>${pairs.length} ${pairs.length===1?'Pair':'Pairs'}</strong><div class="fixed-summary-list">${pairs.length?pairs.map(pair=>`<div class="fixed-summary-row">${renderIcon('link')}<span title="${pair.playerIds.map(id=>escapeHtml(data.players.find(p=>p.id===id)?.name||'Removed player')).join(' + ')}">${pair.playerIds.map(id=>escapeHtml(data.players.find(p=>p.id===id)?.name||'Removed player')).join(' + ')}</span><button type="button" class="remove-fixed-pair" data-pair-id="${escapeHtml(pair.id)}" aria-label="Remove pair ${pair.playerIds.map(id=>escapeHtml(data.players.find(p=>p.id===id)?.name||'Removed player')).join(' and ')}">×</button></div>`).join(''):'<p>No fixed pairs yet.</p>'}</div></div>`;

    const playing=new Set(gamePlayerIds(session.currentGame));
    const actions: Record<AttendanceStatus,[AttendanceStatus,string][]>={not_arrived:[['checked_in','Check In']],checked_in:[['on_break','Take Break'],['checked_out','Check Out']],on_break:[['checked_in','Return to Queue'],['checked_out','Check Out']],checked_out:[['checked_in','Check In Again']]};
    byId('attendanceManager').innerHTML=`${session.attendanceNeedsReview?'<div class="migration-note">Current-game players and previous eligibility were preserved during the update. Check the attendance list, then <button type="button" id="reviewAttendanceBtn" class="btn btn-secondary">Confirm Attendance</button></div>':''}<div class="participation-bulk"><button id="checkInAllBtn" class="btn btn-primary" type="button">Check In All</button><button id="resetAttendanceBtn" class="btn btn-secondary" type="button" ${playing.size?'disabled':''}>Reset Session Attendance</button></div><div class="attendance-list">${data.players.map(player=>{
        const record=session.attendance[player.id],pair=activePair(session,player.id);
        const partner=pair?data.players.find(p=>p.id===pair.playerIds.find(id=>id!==player.id)):null;
        return `<div class="attendance-row" data-attendance-player="${escapeHtml(player.id)}"><div class="attendance-person"><strong>${escapeHtml(player.name)}</strong><p class="attendance-meta">${attendanceLabels[record.status]}${playing.has(player.id)?' · On court':''}${!player.isActive?' · Inactive registration':''} · ${session.playerStats[player.id]?.gamesPlayedInSession||0} session games</p><p class="fixed-label">${pair?'Fixed with '+escapeHtml(partner?.name||'unavailable player'):'No fixed partner'}</p></div><div class="attendance-row-actions">${actions[record.status].map(([status,label])=>`<button type="button" class="btn btn-secondary attendance-action" data-player-id="${escapeHtml(player.id)}" data-attendance-status="${status}" ${playing.has(player.id)?'disabled':''}>${label}</button>`).join('')}</div></div>`;
    }).join('')}</div>`;
    byId('checkInAllBtn').onclick=()=>withQueueScoringLock(()=>changeAllAttendance('checked_in'));
    byId('resetAttendanceBtn').onclick=()=>withQueueScoringLock(()=>changeAllAttendance('not_arrived'));
    byId('reviewAttendanceBtn')?.addEventListener('click',()=>{
        if(confirmAction('Confirm current attendance for this session?',()=>byId('reviewAttendanceBtn')?.click())) participationMutation(d=>{d.activeSession.attendanceNeedsReview=false;},'Attendance confirmed');
    });
    document.querySelectorAll<HTMLButtonElement>('.attendance-action').forEach(button=>button.onclick=()=>withQueueScoringLock(()=>updateAttendance(button.dataset.playerId,button.dataset.attendanceStatus as AttendanceStatus)));
    const options=data.players.filter(p=>individuallyAvailable(data,p.id)&&!activePair(session,p.id));
    const optionMarkup='<option value="">Choose player</option>'+options.map(p=>`<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`).join('');
    byId('fixedPairManager').innerHTML=`<form id="fixedPairForm" class="fixed-pair-form"><label>Player 1<select id="fixedPlayer1" required>${optionMarkup}</select></label><label>Player 2<select id="fixedPlayer2" required>${optionMarkup}</select></label><button class="btn btn-primary" type="submit">Create Fixed Pair</button></form>${pairs.length?pairs.map(pair=>`<div class="fixed-pair-row"><div><strong>${pair.playerIds.map(id=>escapeHtml(data.players.find(p=>p.id===id)?.name||'Removed player')).join(' + ')}</strong><p>${escapeHtml(pairAvailability(data,pair))}</p></div><button type="button" class="btn btn-secondary remove-fixed-pair" data-pair-id="${escapeHtml(pair.id)}">Remove Pair</button></div>`).join(''):'<p class="participation-empty">No fixed pairs. Unpaired players rotate teammates normally.</p>'}`;
    for(const [id,other] of [['fixedPlayer1','fixedPlayer2'],['fixedPlayer2','fixedPlayer1']]) byId(id).onchange=()=>{
        for(const option of [...byId(other).options]) option.disabled=!!option.value&&option.value===byId(id).value;
    };
    byId('fixedPairForm').onsubmit=event=>{event.preventDefault();withQueueScoringLock(()=>createFixedPartnership(byId('fixedPlayer1').value,byId('fixedPlayer2').value));};
    document.querySelectorAll<HTMLButtonElement>('.remove-fixed-pair').forEach(button=>button.onclick=()=>withQueueScoringLock(()=>removeFixedPartnership(button.dataset.pairId)));
}
function openParticipationManager(pairs = false) {
    const dialog=byId('participationDialog');
    if(!dialog.open) dialog.showModal();
    if(pairs) byId('pairManagerTitle').scrollIntoView({block:'start'});
}
export {updateAttendance,changeAllAttendance,createFixedPartnership,removeFixedPartnership,lockPendingLineup};

function getLeaderboard(session: Session) {
    const stats: Record<string, Ranking> = {};
    (session.games || []).forEach(game => {
        if (game.status !== 'completed') return;
        const a = normalizeScore(game.teamAScore), b = normalizeScore(game.teamBScore);
        if (a === null || b === null || !validateRecordedScore(game).isValid) return;
        const ids = [...game.teamA, ...game.teamB].map(p => p.id);
        if (game.teamA.length !== 2 || game.teamB.length !== 2 || new Set(ids).size !== 4) return;
        [...game.teamA, ...game.teamB].forEach(player => {
            const stat = stats[player.id] ||= {playerId:player.id, playerName:player.name, wins:0, losses:0, gamesPlayed:0, pointsFor:0, pointsAgainst:0, pointDifference:0, winPercentage:0};
            const isTeamA = game.teamA.some(p => p.id === player.id);
            const won = isTeamA ? a > b : b > a;
            stat.pointsFor += isTeamA ? a : b;
            stat.pointsAgainst += isTeamA ? b : a;
            stat.pointDifference = stat.pointsFor - stat.pointsAgainst;
            if (a !== b) stat[won ? 'wins' : 'losses']++;
            stat.gamesPlayed++;
            stat.winPercentage = stat.wins / stat.gamesPlayed * 100;
        });
    });
    return Object.values(stats).sort((a,b) => b.pointsFor-a.pointsFor || b.pointDifference-a.pointDifference || b.wins-a.wins || String(a.playerId).localeCompare(String(b.playerId))).map((stat,i) => ({...stat, rank:i+1}));
}

let leaderboardSessionId: string = null;
let leaderboardSearch = '';
let leaderboardSort: keyof Ranking = 'pointsFor';

function openLeaderboard(sessionId: string = null) {
    leaderboardSessionId = sessionId;
    leaderboardSearch = '';
    leaderboardSort = 'pointsFor';
    renderLeaderboard(loadData());
    document.querySelector<HTMLElement>('[data-tab="leaderboard"]').click();
}

function renderLeaderboard(data: AppData) {
    const container = byId('leaderboardSection');
    const session = leaderboardSessionId ? data.pastSessions.find(s => s.sessionId === leaderboardSessionId) : data.activeSession;
    if (!session) {
        container.innerHTML = emptyState('No rankings yet', 'Start a session and complete a game to see the standings. Past results are available in Sessions.', 'trophy') + '<button class="btn btn-secondary" id="backToQueueBtn">Back to Dashboard</button>';
        byId('backToQueueBtn').onclick = () => document.querySelector<HTMLElement>('[data-tab="queue"]').click();
        return;
    }
    const final = session.status === 'completed';
    const rankings: Ranking[] = final ? (session.finalLeaderboard || getLeaderboard(session)) : getLeaderboard(session);
    const podium = final ? `<div class="podium">${[1,0,2].filter(i => rankings[i]).map(i => {
        const p = rankings[i];
        return `<article class="podium-card place-${i+1}"><div class="podium-medal" aria-hidden="true">${['&#9819;','&#129352;','&#129353;'][i]}</div><h3>${escapeHtml(p.playerName)}</h3><strong>${['1st','2nd','3rd'][i]} Place</strong></article>`;
    }).join('')}</div>` : '';
    container.innerHTML = `<div class="leaderboard-header"><h3>${escapeHtml(session.sessionName)} · ${final ? 'Final Results' : '● Session Active'}</h3>
        <p>${formatDateTime(new Date(session.dateStarted))} · ${session.games.filter(g => g.status === 'completed').length} completed games · ${new Set(session.games.filter(g => g.status === 'completed').flatMap(g => [...g.teamA,...g.teamB].map(p=>p.id))).size} participating players</p></div>
        ${podium}<p class="ranking-note">Rank: total points scored, point difference, then wins. Exact ties use player ID.</p>
        <div class="leaderboard-controls"><label>Search players<input id="leaderboardSearch" type="search" value="${escapeHtml(leaderboardSearch)}" placeholder="Player name"></label>
        <label>Sort by<select id="leaderboardSort"><option value="pointsFor">Most points</option><option value="pointDifference">Point difference</option><option value="wins">Most wins</option><option value="winPercentage">Highest win percentage</option><option value="gamesPlayed">Games played</option></select></label></div>
        <div id="leaderboardRows" class="stats-table-wrap"></div>
        <button id="backToQueueBtn" class="btn btn-secondary">Back to Dashboard</button>`;
    const renderRows = () => {
        const rows = rankings.filter(p => p.playerName.toLowerCase().includes(leaderboardSearch.toLowerCase())).sort((a,b) => Number(b[leaderboardSort])-Number(a[leaderboardSort]) || a.rank-b.rank);
        byId('leaderboardRows').innerHTML = rows.length ? `<table class="stats-table"><thead><tr><th>Rank</th><th>Player</th><th>Points</th><th>Against</th><th>+/-</th><th>Wins</th><th>Losses</th><th>Games</th><th>Win %</th></tr></thead><tbody>${rows.map(p=>`<tr><td>#${p.rank}</td><td>${escapeHtml(p.playerName)}</td><td>${p.pointsFor}</td><td>${p.pointsAgainst}</td><td>${p.pointDifference}</td><td>${p.wins}</td><td>${p.losses}</td><td>${p.gamesPlayed}</td><td>${p.winPercentage.toFixed(1)}%</td></tr>`).join('')}</tbody></table>` : emptyState(leaderboardSearch ? 'No players match your search' : 'Every point starts here', 'No scored matches or matching players. ' + (leaderboardSearch ? 'Try a different name or clear the search.' : 'Complete a game to add the first results.'), 'trophy');
    };
    byId('leaderboardSearch').oninput = e => {leaderboardSearch = (e.target as HTMLInputElement).value; renderRows();};
    const sort = byId('leaderboardSort');
    sort.value = leaderboardSort;
    sort.onchange = e => {leaderboardSort = (e.target as HTMLInputElement).value as keyof Ranking; renderRows();};
    byId('backToQueueBtn').onclick = () => document.querySelector<HTMLElement>('[data-tab="queue"]').click();
    renderRows();
}

function uiIcon(name: string) { return renderIcon(name); }

function withQueueScoringLock<T>(callback: () => T) {
    return navigator.locks?.request ? navigator.locks.request('pickleball-queue-scoring', callback) : callback();
}


function renderLeaderboardPreview(data: AppData) {
    const container = byId('leaderboardPreview');
    if (!container) return;
    const rows = data.activeSession ? getLeaderboard(data.activeSession).slice(0,5) : [];
    container.innerHTML = rows.length ? `<div class="stats-table-wrap"><table class="stats-table preview-table"><thead><tr><th>#</th><th>Player</th><th>Points</th><th>Wins</th></tr></thead><tbody>${rows.map(p => `<tr><td>${p.rank}</td><td>${escapeHtml(p.playerName)}</td><td>${p.pointsFor}</td><td>${p.wins}</td></tr>`).join('')}</tbody></table></div>` : `<div class="preview-empty">${emptyState('Every point starts here', 'Complete your first game to see your crew climb the leaderboard.', 'trophy')}</div>`;
}

export { getDefaultData, loadData, migrateData, migrateSession, migrateGame, getEmptySessionStat, migratePlayerStats, buildStatsFromGames, saveData, generateId, addPlayer, removePlayer, togglePlayerActive, getActivePlayers, getCurrentPlayingIds, getWaitingPlayers, selectPlayersForGame, generateWinnerPriorityQueue, getLastPartner, repeatsLastPartner, pairSelectedPlayers, startNewSession, updateSessionQueueMode, endSession, generateNextGame, completeCurrentGame, getScoreInputValues, validateManualScore, validateRecordedScore, validatePickleballScore, applyGameToStats, cancelCurrentGame, exportJson, importJson, clearPastSessions, resetAllData, renderApp, renderSession, renderCurrentGame, renderWaitingPlayers, renderPlayerList, renderPastSessions, openQueueModeModal, closeQueueModeModal, confirmQueueModeSelection, getQueueModeLabel, normalizeScore, formatDateTime, hasRecordedScore, getSortedSessionStats, renderSessionStatsSummary, showToast, setupTabNavigation, setupEventListeners, init, escapeHtml, transitionMatch, isPendingValid, ensurePendingGame, regenerateNextLineup, renderUpcoming, getLeaderboard, openLeaderboard, renderLeaderboard, uiIcon, withQueueScoringLock, renderLeaderboardPreview };

function renderSessionInfo(data: AppData) {
    const container = byId('sessionInfo');
    if (!container) return;
    const session = data.activeSession;
    container.innerHTML = session ? `<dl><dt>Session</dt><dd>${escapeHtml(session.sessionName)}</dd><dt>Started</dt><dd>${formatDateTime(new Date(session.dateStarted))}</dd><dt>Games</dt><dd>${session.games.filter(g => g.status === 'completed').length}</dd><dt>Rotation</dt><dd>${getQueueModeLabel(session.queueMode)}</dd><dt>Status</dt><dd>● Active</dd></dl>` : emptyState('No session details yet', 'Your session information will appear here once you start playing.', 'info');
}
