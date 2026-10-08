// ==================== DATA STORAGE ====================

const STORAGE_KEY = 'pickleball_queue_data';
const QUEUE_MODES = {
    fair_rotation: {
        label: 'Fair Rotation',
        description: 'Strictly balances play time so everyone gets equal turns.'
    },
    winner_priority: {
        label: 'Winner Priority',
        description: 'Winners get priority for the next game, while still keeping player rotation fair.'
    }
};

function getDefaultData() {
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

function loadData() {
    try {
        const data = localStorage.getItem(STORAGE_KEY);
        if (data) {
            const parsed = JSON.parse(data);
            // Migrate old data structure if needed
            return migrateData(parsed);
        }
    } catch (error) {
        console.error('Error loading data:', error);
    }
    return getDefaultData();
}

function migrateData(data) {
    // Check if data has old structure (currentGame or pastGames)
    if (data.currentGame !== undefined || data.pastGames !== undefined) {
        console.log('Migrating old data structure to session-based structure');

        const migrated = {
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

            const importedSession = {
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

    data.schemaVersion = 2;
    if (data.activeSession) {
        data.activeSession = migrateSession(data.activeSession);
    }
    data.pastSessions = data.pastSessions.map(migrateSession);

    return data;
}

function migrateSession(session) {
    const migrated = {
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

function migrateGame(game) {
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
        status: game.status === 'current' ? 'in_progress' : (game.status || (game.dateCompleted ? 'completed' : 'in_progress')),
        teamAScore,
        teamBScore,
        winningTeam,
        losingTeam,
        winnerPlayerIds,
        loserPlayerIds
    };
}

function getEmptySessionStat(player) {
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

function migratePlayerStats(playerStats, games) {
    const stats = {};
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

function buildStatsFromGames(games) {
    const stats = {};
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

function saveData(data) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        return true;
    } catch (error) {
        console.error('Error saving data:', error);
        showToast('Error saving data', 'error');
        return false;
    }
}

// ==================== PLAYER MANAGEMENT ====================

function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

function addPlayer(name) {
    const data = loadData();

    if (!name || name.trim() === '') {
        showToast('Player name cannot be empty', 'error');
        return false;
    }

    const trimmedName = name.trim();

    const newPlayer = {
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
    saveData(data);
    renderApp();
    showToast(`Player "${trimmedName}" added`, 'success');
    return true;
}

function removePlayer(playerId) {
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
    if (!confirm(`Remove player ${playerName}?`)) return false;
    data.players.splice(playerIndex, 1);
    saveData(data);
    renderApp();
    showToast(`Player "${playerName}" removed`, 'success');
    return true;
}

function togglePlayerActive(playerId) {
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

    saveData(data);
    renderApp();
    const status = player.isActive ? 'activated' : 'deactivated';
    showToast(`Player "${player.name}" ${status}`, 'success');
    return true;
}

// ==================== FAIR QUEUE ALGORITHM ====================

function getActivePlayers(data) {
    return data.players.filter(p => p.isActive);
}

function getCurrentPlayingIds(data) {
    if (!data.activeSession || !data.activeSession.currentGame) return [];
    const allPlayers = [...data.activeSession.currentGame.teamA, ...data.activeSession.currentGame.teamB];
    return allPlayers.map(p => p.id);
}

function getWaitingPlayers(data) {
    const activePlayers = getActivePlayers(data);
    const playingIds = getCurrentPlayingIds(data);
    return activePlayers.filter(p => !playingIds.includes(p.id));
}

function selectPlayersForGame(data) {
    const activePlayers = getActivePlayers(data);

    if (activePlayers.length < 4) {
        return { success: false, message: 'Not enough players to start a game. Need at least 4 active players.' };
    }

    // Sort players by fairness criteria
    const sortedPlayers = [...activePlayers].sort((a, b) => {
        // 1. Lowest gamesPlayed first
        if (a.gamesPlayed !== b.gamesPlayed) {
            return a.gamesPlayed - b.gamesPlayed;
        }

        // 2. Oldest waitingSinceGameNumber first (longer wait)
        if (a.waitingSinceGameNumber !== b.waitingSinceGameNumber) {
            return a.waitingSinceGameNumber - b.waitingSinceGameNumber;
        }

        // 3. Oldest lastPlayedGameNumber first (least recently played)
        const aLastPlayed = a.lastPlayedGameNumber === null ? -1 : a.lastPlayedGameNumber;
        const bLastPlayed = b.lastPlayedGameNumber === null ? -1 : b.lastPlayedGameNumber;
        if (aLastPlayed !== bLastPlayed) {
            return aLastPlayed - bLastPlayed;
        }

        // 4. Random tie-breaker
        return Math.random() - 0.5;
    });

    // Select top 4 players
    const selectedPlayers = sortedPlayers.slice(0, 4);

    return pairSelectedPlayers(selectedPlayers, data.activeSession);
}

function generateWinnerPriorityQueue(activePlayers, activeSession) {
    if (activePlayers.length < 4) {
        return { success: false, message: 'Not enough players to start a game. Need at least 4 active players.' };
    }

    const stats = activeSession.playerStats || {};
    const lastCompletedGame = (activeSession.games || []).find(game => game.status === 'completed');
    const previousWinnerIds = new Set(lastCompletedGame?.winnerPlayerIds || []);
    const activeStats = activePlayers.map(player => ({
        player,
        gamesPlayed: stats[player.id]?.gamesPlayedInSession || 0
    }));
    const minGamesPlayed = Math.min(...activeStats.map(item => item.gamesPlayed));

    const canSelectWithoutGap = (item) => {
        const projectedGames = item.gamesPlayed + 1;
        return projectedGames <= minGamesPlayed + 1 || activePlayers.length === 4;
    };

    const sortedPlayers = activeStats
        .filter(canSelectWithoutGap)
        .sort((a, b) => {
            if (a.gamesPlayed !== b.gamesPlayed) {
                return a.gamesPlayed - b.gamesPlayed;
            }

            const aWinner = previousWinnerIds.has(a.player.id) ? 1 : 0;
            const bWinner = previousWinnerIds.has(b.player.id) ? 1 : 0;
            if (aWinner !== bWinner) {
                return bWinner - aWinner;
            }

            if (a.player.waitingSinceGameNumber !== b.player.waitingSinceGameNumber) {
                return a.player.waitingSinceGameNumber - b.player.waitingSinceGameNumber;
            }

            const aLastPlayed = a.player.lastPlayedGameNumber === null ? -1 : a.player.lastPlayedGameNumber;
            const bLastPlayed = b.player.lastPlayedGameNumber === null ? -1 : b.player.lastPlayedGameNumber;
            if (aLastPlayed !== bLastPlayed) {
                return aLastPlayed - bLastPlayed;
            }

            return Math.random() - 0.5;
        });

    let selectedPlayers = sortedPlayers.slice(0, 4).map(item => item.player);

    if (selectedPlayers.length < 4) {
        const selectedIds = new Set(selectedPlayers.map(player => player.id));
        const fallbackPlayers = activeStats
            .filter(item => !selectedIds.has(item.player.id))
            .sort((a, b) => {
                if (a.gamesPlayed !== b.gamesPlayed) return a.gamesPlayed - b.gamesPlayed;
                return Math.random() - 0.5;
            })
            .map(item => item.player);
        selectedPlayers = [...selectedPlayers, ...fallbackPlayers].slice(0, 4);
    }

    return pairSelectedPlayers(selectedPlayers, activeSession);
}

// Each player must change partners from their own most recent played match.
// The current match counts when validating a lineup that will start afterwards.
function getLastPartner(player, session) {
    const matches = [session?.currentGame, ...(session?.games || []).filter(g => g.status === 'completed')].filter(Boolean);
    for (const game of matches) {
        const team = [game.teamA, game.teamB].find(t => t.some(p => p.id === player.id));
        if (team) return team.find(p => p.id !== player.id)?.id ?? null;
    }
    return player.partnerHistory?.[player.partnerHistory.length - 1] ?? null;
}

function repeatsLastPartner(a, b, session) {
    return getLastPartner(a, session) === b.id || getLastPartner(b, session) === a.id;
}

function pairSelectedPlayers(selectedPlayers, activeSession) {
    const shuffled = [...selectedPlayers].sort(() => Math.random() - 0.5);
    const pairings = [
        [[shuffled[0], shuffled[1]], [shuffled[2], shuffled[3]]],
        [[shuffled[0], shuffled[2]], [shuffled[1], shuffled[3]]],
        [[shuffled[0], shuffled[3]], [shuffled[1], shuffled[2]]]
    ];
    const stats = activeSession?.playerStats || {};

    const partnershipCount = (a, b) => {
        const sessionPartners = stats[a.id]?.partners || [];
        const globalPartners = a.partnerHistory || [];
        return sessionPartners.filter(id => id === b.id).length + globalPartners.filter(id => id === b.id).length;
    };

    const eligiblePairings = pairings.filter(teams => teams.every(team => !repeatsLastPartner(team[0], team[1], activeSession)));
    if (!eligiblePairings.length) {
        return { success: false, message: 'The selected players cannot form teams without repeating a last teammate. Change player availability and try again.' };
    }
    const ranked = eligiblePairings.sort((a, b) => {
        const aScore = partnershipCount(a[0][0], a[0][1]) + partnershipCount(a[1][0], a[1][1]);
        const bScore = partnershipCount(b[0][0], b[0][1]) + partnershipCount(b[1][0], b[1][1]);
        if (aScore !== bScore) return aScore - bScore;
        return Math.random() - 0.5;
    });

    return {
        success: true,
        teamA: ranked[0][0],
        teamB: ranked[0][1]
    };
}

// ==================== SESSION MANAGEMENT ====================

function startNewSession(queueMode = 'fair_rotation') {
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
    const animation = document.getElementById('sessionAnimation');
    if (animation) {
        animation.classList.add('show');
    }

    data.settings.currentSessionNumber++;

    const activePlayers = getActivePlayers(data);

    // Initialize player stats for the session
    const playerStats = {};
    activePlayers.forEach(player => {
        playerStats[player.id] = getEmptySessionStat(player);
    });

    const session = {
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
    saveData(data);
    renderApp();
    showToast(`Session ${session.sessionNumber} started`, 'success');

    // Hide animation after 3 seconds
    setTimeout(() => {
        if (animation) {
            animation.classList.remove('show');
        }
    }, 3000);

    return true;
}

function updateSessionQueueMode(queueMode) {
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
    saveData(data);
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

    if (!confirm('End this session and reveal the final rankings?')) return false;

    const session = data.activeSession;
    session.status = 'completed';
    session.dateEnded = new Date().toISOString();

    session.pendingGame = null;
    session.playerStats = buildStatsFromGames(session.games);
    session.finalLeaderboard = getLeaderboard(session);
    session.leaderboardRanking = 'points';

    data.pastSessions.unshift(session);
    data.activeSession = null;

    saveData(data);
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

    ensurePendingGame(data);
    const game = data.activeSession.pendingGame;
    if (!game) { showToast(data.activeSession.pendingLineupMessage || 'Need at least four available active players.', 'error'); return false; }
    transitionMatch(game, 'in_progress');
    game.gameNumber = ++data.settings.currentGameNumber;
    game.dateStarted = new Date().toISOString();
    game.scoringState = null;
    data.activeSession.currentGame = game;
    data.activeSession.pendingGame = null;
    ensurePendingGame(data);
    saveData(data);
    renderApp();
    showToast(`Game ${game.gameNumber} started`, 'success');
    return true;
}

function completeCurrentGame(options = null) {
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
    if (game.scoringState) {
        try {
            ScoringEngine.validate(game.scoringState);
            if (game.scoringState.teams.A.join('|') !== game.teamA.map(p => p.id).join('|') || game.scoringState.teams.B.join('|') !== game.teamB.map(p => p.id).join('|')) throw new Error('Scoring players do not match the current game.');
            if (game.scoringState.matchId !== game.gameId || game.scoringState.status !== 'game_over') throw new Error('Finish the match on the scoring page before saving.');
            if (options?.expectedRevision !== undefined && game.scoringState.revision !== options.expectedRevision) throw new Error('Scoring changed in another tab. Review the latest score.');
            const {A, B} = game.scoringState.scores;
            const validation = validatePickleballScore(A, B, game.scoringState.target);
            scoreResult = {success:validation.isValid, message:validation.message, teamAScore:A, teamBScore:B, winningTeam:validation.winningTeam, losingTeam:validation.losingTeam};
            game.targetScore = game.scoringState.target;
        } catch (error) {
            showToast(error.message, 'error');
            return false;
        }
    } else {
        scoreResult = getScoreInputValues();
    }

    if (!scoreResult.success) {
        showToast(scoreResult.message, 'error');
        return false;
    }

    game.teamAScore = scoreResult.teamAScore;
    game.teamBScore = scoreResult.teamBScore;
    game.winningTeam = scoreResult.winningTeam;
    game.losingTeam = scoreResult.losingTeam;
    game.winnerPlayerIds = (game.winningTeam === 'A' ? game.teamA : game.teamB).map(p => p.id);
    game.loserPlayerIds = (game.losingTeam === 'A' ? game.teamA : game.teamB).map(p => p.id);

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

    applyGameToStats(data.activeSession.playerStats, game);

    // Move current game to session games
    transitionMatch(game, 'completed');
    game.dateCompleted = new Date().toISOString();
    data.activeSession.games.unshift(game);
    data.activeSession.currentGame = null;

    if (!saveData(data)) return false;
    renderApp();
    showToast(`Game ${game.gameNumber} completed`, 'success');
    return true;
}

function getScoreInputValues() {
    const teamAInput = document.getElementById('teamAScoreInput');
    const teamBInput = document.getElementById('teamBScoreInput');

    if (!teamAInput || !teamBInput) {
        return { success: false, message: 'Score inputs are missing.' };
    }

    const teamARaw = teamAInput.value.trim();
    const teamBRaw = teamBInput.value.trim();

    if (teamARaw === '' || teamBRaw === '') {
        return { success: false, message: 'Enter scores for both teams before completing the game.' };
    }

    const teamAScore = Number(teamARaw);
    const teamBScore = Number(teamBRaw);
    const validation = validatePickleballScore(teamAScore, teamBScore);

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

function validatePickleballScore(teamAScore, teamBScore, target = 11) {
    if (!Number.isFinite(teamAScore) || !Number.isFinite(teamBScore) || !Number.isInteger(teamAScore) || !Number.isInteger(teamBScore)) {
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

    if (lead < 2) {
        return { isValid: false, message: 'A team must win by at least 2 points.', winningTeam: null, losingTeam: null };
    }

    const winningTeam = teamAScore > teamBScore ? 'A' : 'B';
    const losingTeam = winningTeam === 'A' ? 'B' : 'A';

    return { isValid: true, message: '', winningTeam, losingTeam };
}

function applyGameToStats(playerStats, game) {
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

        if (game.status !== 'cancelled' && Number.isFinite(game.teamAScore) && Number.isFinite(game.teamBScore) && validatePickleballScore(game.teamAScore, game.teamBScore, game.targetScore || game.scoringState?.target || 11).isValid) {
            if (isWinner) {
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

    if (!confirm('Cancel the current game? No statistics will be recorded.')) return false;
    const game = data.activeSession.currentGame;
    const gameNumber = game.gameNumber;
    transitionMatch(game, 'cancelled');
    data.activeSession.cancelledGames = [...(data.activeSession.cancelledGames || []), game];
    data.activeSession.currentGame = null;
    data.activeSession.pendingGame = null;

    saveData(data);
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

function importJson(file) {
    const reader = new FileReader();

    reader.onload = function(e) {
        try {
            const importedData = JSON.parse(e.target.result);

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

            // Confirm before replacing
            if (confirm('This will replace all current data. Are you sure?')) {
                const dataToSave = migrateData(importedData);
                saveData(dataToSave);
                renderApp();
                showToast('Backup imported successfully', 'success');
            }
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

function clearPastSessions() {
    if (confirm('This will delete all past sessions. Players will not be affected. Are you sure?')) {
        const data = loadData();
        data.pastSessions = [];
        saveData(data);
        renderApp();
        showToast('Past sessions cleared', 'success');
    }
}

function resetAllData() {
    if (confirm('This will delete ALL data including players, games, and settings. This cannot be undone. Are you sure?')) {
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
    renderWaitingPlayers(data);
    renderPlayerList(data);
    renderPastSessions(data);
}

function renderSession(data) {
    const container = document.getElementById('sessionSection');

    if (!data.activeSession) {
        container.innerHTML = `
            <div class="no-session">
                <div class="empty-state-kicker">No active session</div>
                <p>Start a session to begin queuing players.</p>
                <button id="startSessionBtn" class="btn btn-primary">Start New Session</button>
            </div>
        `;
        const btn = document.getElementById('startSessionBtn');
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

    document.getElementById('liveLeaderboardBtn').addEventListener('click', () => openLeaderboard());
    document.getElementById('endSessionBtn').addEventListener('click', endSession);
}

function renderCurrentGame(data) {
    const container = document.getElementById('currentGameSection');

    if (!data.activeSession || !data.activeSession.currentGame) {
        container.innerHTML = `
            <div class="no-game">
                <p>${data.activeSession?.games[0]?.status === 'completed' ? `Game #${data.activeSession.games[0].gameNumber} completed — Winner: Team ${data.activeSession.games[0].winningTeam || 'unknown'}` : 'Court available'}</p>
                ${data.activeSession?.pendingGame ? '' : '<button id="generateGameBtn" class="btn btn-primary">Start Game</button>'}
            </div>
        `;
        const btn = document.getElementById('generateGameBtn');
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
                        ${game.teamA.map(p => `<div class="team-player">${escapeHtml(p.name)}</div>`).join('')}
                    </div>
                    <label class="score-field team-score-field">
                        <span>Team A Score</span>
                        <input value="${game.scoringState?.scores.A ?? ''}" ${game.scoringState ? 'disabled' : ''} type="number" id="teamAScoreInput" min="0" step="1" inputmode="numeric" placeholder="0">
                    </label>
                </div>

                <div class="versus-indicator">VS</div>

                <div class="team-card team-b">
                    <div class="team-label">Team B</div>
                    <div class="team-players">
                        ${game.teamB.map(p => `<div class="team-player">${escapeHtml(p.name)}</div>`).join('')}
                    </div>
                    <label class="score-field team-score-field">
                        <span>Team B Score</span>
                        <input value="${game.scoringState?.scores.B ?? ''}" ${game.scoringState ? 'disabled' : ''} type="number" id="teamBScoreInput" min="0" step="1" inputmode="numeric" placeholder="0">
                    </label>
                </div>
            </div>

            <a class="btn btn-primary open-scoring-btn" href="scoring.html?match=${encodeURIComponent(game.gameId)}">Open Scoring</a>
            <button id="completeGameBtn" class="btn btn-success" ${game.scoringState && game.scoringState.status !== 'game_over' ? 'disabled' : ''}>Complete Game</button>
            <button id="cancelGameBtn" class="btn btn-danger" style="margin-top: 12px;">Cancel Current Game</button>
        </div>
    `;

    document.getElementById('completeGameBtn').addEventListener('click', completeCurrentGame);
    document.getElementById('cancelGameBtn').addEventListener('click', cancelCurrentGame);
}

function renderWaitingPlayers(data) {
    const container = document.getElementById('waitingPlayersSection');
    const waitingPlayers = getWaitingPlayers(data);

    if (waitingPlayers.length === 0) {
        container.innerHTML = `
            <div class="no-waiting">
                <p>No waiting players</p>
            </div>
        `;
        return;
    }

    container.innerHTML = `
        <div class="waiting-list">
            ${waitingPlayers.map(p => `
                <div class="waiting-player">
                    <span class="waiting-player-name">${escapeHtml(p.name)}</span>
                    <span class="waiting-player-stats">${p.gamesPlayed} games</span>
                </div>
            `).join('')}
        </div>
    `;
}

function renderPlayerList(data) {
    const container = document.getElementById('playerListSection');
    const playingIds = getCurrentPlayingIds(data);

    if (data.players.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <img src="images/ian2.png" alt="" class="empty-state-icon">
                <div class="empty-state-text">No players added yet</div>
            </div>
        `;
        return;
    }

    container.innerHTML = data.players.map(player => {
        let status = 'inactive';
        let statusClass = 'status-inactive';

        if (playingIds.includes(player.id)) {
            status = 'playing';
            statusClass = 'status-playing';
        } else if (player.isActive) {
            status = 'waiting';
            statusClass = 'status-waiting';
        }

        const isPlaying = playingIds.includes(player.id);

        return `
            <div class="player-item">
                <div class="player-info">
                    <div class="player-name">${escapeHtml(player.name)}</div>
                    <div class="player-stats">
                        <span class="status-badge ${statusClass}">${status}</span>
                        <span style="margin-left: 8px;">${player.gamesPlayed} games</span>
                    </div>
                </div>
                <div class="player-actions">
                    <label class="toggle-switch">
                        <input type="checkbox"
                               ${player.isActive ? 'checked' : ''}
                               ${isPlaying ? 'disabled' : ''}
                               data-player-id="${player.id}"
                               class="player-toggle">
                        <span class="toggle-slider"></span>
                    </label>
                    <button class="btn-remove player-remove"
                            data-player-id="${player.id}"
                            ${isPlaying ? 'disabled' : ''}
                            >Remove</button>
                </div>
            </div>
        `;
    }).join('');

    // Add event listeners
    document.querySelectorAll('.player-toggle').forEach(toggle => {
        toggle.addEventListener('change', (e) => {
            togglePlayerActive(e.target.dataset.playerId);
        });
    });

    document.querySelectorAll('.player-remove').forEach(btn => {
        btn.addEventListener('click', (e) => {
            removePlayer(e.target.dataset.playerId);
        });
    });
}

function renderPastSessions(data) {
    const container = document.getElementById('pastSessionsSection');

    if (data.pastSessions.length === 0) {
        container.innerHTML = `
            <div class="no-past-sessions">
                <p>No past sessions yet</p>
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
                        const winnerText = game.winningTeam ? `Team ${game.winningTeam}` : 'No score recorded.';

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

    document.querySelectorAll('.results-btn').forEach(btn => btn.addEventListener('click', () => openLeaderboard(btn.dataset.sessionId)));
    // Add event listeners for expand buttons
    document.querySelectorAll('.expand-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const sessionId = e.target.dataset.sessionId;
            const gamesList = document.getElementById(`games-${sessionId}`);
            gamesList.classList.toggle('expanded');
            e.target.textContent = gamesList.classList.contains('expanded') ? 'Collapse' : 'Expand';
        });
    });
}

// ==================== UTILITY FUNCTIONS ====================

function openQueueModeModal() {
    const modal = document.getElementById('queueModeModal');
    const defaultOption = document.querySelector('input[name="modalQueueMode"][value="fair_rotation"]');

    if (defaultOption) {
        defaultOption.checked = true;
    }

    if (modal) {
        modal.classList.add('show');
        modal.setAttribute('aria-hidden', 'false');
    }
}

function closeQueueModeModal() {
    const modal = document.getElementById('queueModeModal');

    if (modal) {
        modal.classList.remove('show');
        modal.setAttribute('aria-hidden', 'true');
    }
}

function confirmQueueModeSelection() {
    const selectedMode = document.querySelector('input[name="modalQueueMode"]:checked')?.value || 'fair_rotation';

    if (startNewSession(selectedMode)) {
        closeQueueModeModal();
    }
}

function getQueueModeLabel(queueMode) {
    return QUEUE_MODES[queueMode]?.label || QUEUE_MODES.fair_rotation.label;
}

function normalizeScore(score) {
    if (score === null || score === undefined || score === '') {
        return null;
    }

    const numericScore = Number(score);
    return Number.isFinite(numericScore) ? numericScore : null;
}

function formatDateTime(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
        return 'Unknown';
    }

    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function hasRecordedScore(game) {
    return Number.isFinite(game.teamAScore) && Number.isFinite(game.teamBScore);
}

function getSortedSessionStats(playerStats) {
    return Object.values(playerStats || {}).sort((a, b) => {
        if (a.wins !== b.wins) return b.wins - a.wins;
        if (a.pointDifference !== b.pointDifference) return b.pointDifference - a.pointDifference;
        return b.gamesPlayedInSession - a.gamesPlayedInSession;
    });
}

function renderSessionStatsSummary(playerStats) {
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

function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = 'toast show ' + type;

    setTimeout(() => {
        toast.className = 'toast';
    }, 3000);
}

// ==================== TAB NAVIGATION ====================

function setupTabNavigation() {
    const tabButtons = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');
    const toggle = document.getElementById('navigationToggle');
    const menu = document.getElementById('dashboardMenu');
    const currentView = document.getElementById('currentViewLabel');

    function closeNavigation(returnFocus = false) {
        menu.hidden = true;
        toggle.setAttribute('aria-expanded', 'false');
        if (returnFocus) toggle.focus();
    }

    toggle.addEventListener('click', () => {
        const opening = menu.hidden;
        menu.hidden = !opening;
        toggle.setAttribute('aria-expanded', String(opening));
    });
    document.addEventListener('click', event => {
        if (!menu.hidden && !event.target.closest('.dashboard-navigation')) closeNavigation();
    });
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && !menu.hidden) closeNavigation(true);
    });
    document.addEventListener('focusin', event => {
        if (!menu.hidden && !event.target.closest('.dashboard-navigation')) closeNavigation();
    });

    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            const tabId = button.dataset.tab;
            const wasOpen = !menu.hidden;
            tabButtons.forEach(btn => {
                btn.classList.remove('active');
                btn.removeAttribute('aria-current');
            });
            tabContents.forEach(content => content.classList.remove('active'));
            button.classList.add('active');
            button.setAttribute('aria-current', 'page');
            document.getElementById(`${tabId}-tab`).classList.add('active');
            currentView.textContent = button.textContent;
            closeNavigation(wasOpen);
        });
    });
}

// ==================== EVENT LISTENERS ====================

function setupEventListeners() {
    // Add player
    document.getElementById('addPlayerBtn').addEventListener('click', () => {
        const input = document.getElementById('playerNameInput');
        const name = input.value.trim();
        if (addPlayer(name)) {
            input.value = '';
        }
    });

    // Add player on Enter key
    document.getElementById('playerNameInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            const input = e.target;
            const name = input.value.trim();
            if (addPlayer(name)) {
                input.value = '';
            }
        }
    });

    // Export JSON
    document.getElementById('exportJsonBtn').addEventListener('click', exportJson);

    // Import JSON
    document.getElementById('importJsonBtn').addEventListener('click', () => {
        document.getElementById('importJsonInput').click();
    });

    document.getElementById('importJsonInput').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            importJson(file);
            e.target.value = ''; // Reset input
        }
    });

    // Clear past sessions
    document.getElementById('clearPastSessionsBtn').addEventListener('click', clearPastSessions);

    // Reset all data
    document.getElementById('resetAllDataBtn').addEventListener('click', resetAllData);

    const queueModeModal = document.getElementById('queueModeModal');
    const closeQueueModeModalBtn = document.getElementById('closeQueueModeModalBtn');
    const cancelQueueModeModalBtn = document.getElementById('cancelQueueModeModalBtn');
    const confirmQueueModeBtn = document.getElementById('confirmQueueModeBtn');

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
    window.addEventListener('storage', event => {
        if (event.key === STORAGE_KEY || event.key === null) renderApp();
    });
    setupTabNavigation();
    setupEventListeners();
    renderApp();
    if (location.hash === '#leaderboard') openLeaderboard();
}

// Pending assignments use a projection; previews never mutate rotation statistics.
function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
}

function transitionMatch(game, next) {
    const allowed = {pending: ['in_progress'], in_progress: ['completed', 'cancelled']};
    if (!allowed[game.status]?.includes(next)) throw new Error('Invalid match transition');
    game.status = next;
}

function isPendingValid(data) {
    const game = data.activeSession?.pendingGame;
    if (!game || game.status !== 'pending' || game.teamA.length !== 2 || game.teamB.length !== 2) return false;
    const ids = [...game.teamA, ...game.teamB].map(p => p.id);
    const teams = [game.teamA, game.teamB].map(team => team.map(p => data.players.find(player => player.id === p.id)));
    if (teams.some(team => team.some(p => !p) || repeatsLastPartner(team[0], team[1], data.activeSession))) return false;
    return new Set(ids).size === 4 && ids.every(id => data.players.some(p => p.id === id && p.isActive && p.isAvailable !== false));
}

function ensurePendingGame(data, force = false) {
    const session = data.activeSession;
    if (!session) return false;
    if (!force && isPendingValid(data)) return false;
    const hadPending = !!session.pendingGame;
    session.pendingGame = null;
    const projected = JSON.parse(JSON.stringify(data));
    projected.players = projected.players.filter(p => p.isAvailable !== false);
    const current = projected.activeSession.currentGame;
    if (current) {
        const playing = new Set([...current.teamA, ...current.teamB].map(p => p.id));
        projected.players.forEach(p => {
            if (!playing.has(p.id)) return;
            p.gamesPlayed++;
            p.lastPlayedGameNumber = current.gameNumber;
            p.waitingSinceGameNumber = current.gameNumber + 1;
            const stat = projected.activeSession.playerStats[p.id] || getEmptySessionStat(p);
            stat.gamesPlayedInSession++;
            projected.activeSession.playerStats[p.id] = stat;
        });
    }
    const result = session.queueMode === 'winner_priority'
        ? generateWinnerPriorityQueue(getActivePlayers(projected), projected.activeSession)
        : selectPlayersForGame(projected);
    if (!result.success) {
        const changed = session.pendingLineupMessage !== result.message;
        session.pendingLineupMessage = result.message;
        return hadPending || changed;
    }
    session.pendingLineupMessage = null;
    session.pendingGame = {
        gameId: generateId(), gameNumber: data.settings.currentGameNumber + 1,
        teamA: result.teamA.map(p => ({id:p.id, name:p.name})),
        teamB: result.teamB.map(p => ({id:p.id, name:p.name})),
        status: 'pending', dateGenerated: new Date().toISOString(),
        teamAScore: null, teamBScore: null, winnerPlayerIds: [], loserPlayerIds: []
    };
    return true;
}

function regenerateNextLineup() {
    if (!confirm('Replace the prepared next lineup?')) return;
    const data = loadData();
    ensurePendingGame(data, true);
    saveData(data);
    renderApp();
}

function renderUpcoming(data) {
    const container = document.getElementById('upcomingGameSection');
    const session = data.activeSession;
    const game = session?.pendingGame;
    if (!game) {
        container.innerHTML = `<div class="upcoming-card"><p>${session ? escapeHtml(session.pendingLineupMessage || 'Need at least four available active players to prepare a lineup.') : 'Start a session to prepare the next game.'}</p></div>`;
        return;
    }
    const playing = getCurrentPlayingIds(data);
    const reuse = [...game.teamA, ...game.teamB].some(p => playing.includes(p.id));
    container.innerHTML = `<div class="upcoming-card">
        <h3>Game #${game.gameNumber}</h3>
        <div class="upcoming-teams"><div><strong>Team A</strong><p>${game.teamA.map(p => escapeHtml(p.name)).join(' / ')}</p></div>
        <span>VS</span><div><strong>Team B</strong><p>${game.teamB.map(p => escapeHtml(p.name)).join(' / ')}</p></div></div>
        <p class="lineup-status" role="status">${session.currentGame ? `Waiting for current match${reuse ? ' · Returning players will play again after finishing' : ' · Next players can prepare'}` : 'Ready to Play · Court available'}</p>
        <button id="startNextGameBtn" class="btn btn-primary" ${session.currentGame ? 'disabled' : ''}>Start Next Game →</button>
        <button id="regenerateLineupBtn" class="btn btn-secondary">Regenerate Next Lineup</button>
    </div>`;
    document.getElementById('startNextGameBtn').addEventListener('click', generateNextGame);
    document.getElementById('regenerateLineupBtn').addEventListener('click', regenerateNextLineup);
}

function getLeaderboard(session) {
    const stats = {};
    (session.games || []).forEach(game => {
        if (game.status !== 'completed') return;
        const a = normalizeScore(game.teamAScore), b = normalizeScore(game.teamBScore);
        if (a === null || b === null || !validatePickleballScore(a, b, game.targetScore || game.scoringState?.target || 11).isValid) return;
        const ids = [...game.teamA, ...game.teamB].map(p => p.id);
        if (game.teamA.length !== 2 || game.teamB.length !== 2 || new Set(ids).size !== 4) return;
        [...game.teamA, ...game.teamB].forEach(player => {
            const stat = stats[player.id] ||= {playerId:player.id, playerName:player.name, wins:0, losses:0, gamesPlayed:0, pointsFor:0, pointsAgainst:0, pointDifference:0};
            const isTeamA = game.teamA.some(p => p.id === player.id);
            const won = isTeamA ? a > b : b > a;
            stat.pointsFor += isTeamA ? a : b;
            stat.pointsAgainst += isTeamA ? b : a;
            stat.pointDifference = stat.pointsFor - stat.pointsAgainst;
            stat[won ? 'wins' : 'losses']++;
            stat.gamesPlayed++;
            stat.winPercentage = stat.wins / stat.gamesPlayed * 100;
        });
    });
    return Object.values(stats).sort((a,b) => b.pointsFor-a.pointsFor || b.pointDifference-a.pointDifference || b.wins-a.wins || String(a.playerId).localeCompare(String(b.playerId))).map((stat,i) => ({...stat, rank:i+1}));
}

let leaderboardSessionId = null;
let leaderboardSearch = '';
let leaderboardSort = 'pointsFor';

function openLeaderboard(sessionId = null) {
    leaderboardSessionId = sessionId;
    leaderboardSearch = '';
    leaderboardSort = 'pointsFor';
    renderLeaderboard(loadData());
    document.querySelector('[data-tab="leaderboard"]').click();
}

function renderLeaderboard(data) {
    const container = document.getElementById('leaderboardSection');
    const session = leaderboardSessionId ? data.pastSessions.find(s => s.sessionId === leaderboardSessionId) : data.activeSession;
    if (!session) {
        container.innerHTML = '<p>No active session. Open a past session to view its final results.</p><button class="btn btn-secondary" id="backToQueueBtn">Back to Dashboard</button>';
        document.getElementById('backToQueueBtn').onclick = () => document.querySelector('[data-tab="queue"]').click();
        return;
    }
    const final = session.status === 'completed';
    const rankings = final ? (session.finalLeaderboard || getLeaderboard(session)) : getLeaderboard(session);
    const podium = final ? `<div class="podium">${[1,0,2].filter(i => rankings[i]).map(i => {
        const p = rankings[i];
        return `<article class="podium-card place-${i+1}"><div class="podium-medal">${['♛','🥈','🥉'][i]}</div><h3>${escapeHtml(p.playerName)}</h3><strong>#${p.rank} · ${['1st','2nd','3rd'][i]} Place</strong><p>${p.pointsFor} points · ${p.pointDifference >= 0 ? '+' : ''}${p.pointDifference} difference</p><p>${p.wins} wins · ${p.losses} losses</p><p>${p.winPercentage.toFixed(1)}% wins</p></article>`;
    }).join('')}</div>` : '';
    container.innerHTML = `<div class="leaderboard-header"><h3>${escapeHtml(session.sessionName)} · ${final ? 'Final Results' : '● Session Active'}</h3>
        <p>${formatDateTime(new Date(session.dateStarted))} · ${session.games.filter(g => g.status === 'completed').length} completed games · ${new Set(session.games.filter(g => g.status === 'completed').flatMap(g => [...g.teamA,...g.teamB].map(p=>p.id))).size} participating players</p></div>
        ${podium}<p class="ranking-note">Rank: total points scored, point difference, then wins. Exact ties use player ID.</p>
        <div class="leaderboard-controls"><label>Search players<input id="leaderboardSearch" type="search" value="${escapeHtml(leaderboardSearch)}" placeholder="Player name"></label>
        <label>Sort by<select id="leaderboardSort"><option value="pointsFor">Most points</option><option value="pointDifference">Point difference</option><option value="wins">Most wins</option><option value="winPercentage">Highest win percentage</option><option value="gamesPlayed">Games played</option></select></label></div>
        <div id="leaderboardRows" class="stats-table-wrap"></div>
        <button id="backToQueueBtn" class="btn btn-secondary">Back to Dashboard</button>`;
    const renderRows = () => {
        const rows = rankings.filter(p => p.playerName.toLowerCase().includes(leaderboardSearch.toLowerCase())).sort((a,b) => b[leaderboardSort]-a[leaderboardSort] || a.rank-b.rank);
        document.getElementById('leaderboardRows').innerHTML = rows.length ? `<table class="stats-table"><thead><tr><th>Rank</th><th>Player</th><th>Points</th><th>Against</th><th>+/-</th><th>Wins</th><th>Losses</th><th>Games</th><th>Win %</th></tr></thead><tbody>${rows.map(p=>`<tr><td>#${p.rank}</td><td>${escapeHtml(p.playerName)}</td><td>${p.pointsFor}</td><td>${p.pointsAgainst}</td><td>${p.pointDifference}</td><td>${p.wins}</td><td>${p.losses}</td><td>${p.gamesPlayed}</td><td>${p.winPercentage.toFixed(1)}%</td></tr>`).join('')}</tbody></table>` : '<p>No scored matches or matching players.</p>';
    };
    document.getElementById('leaderboardSearch').oninput = e => {leaderboardSearch = e.target.value; renderRows();};
    const sort = document.getElementById('leaderboardSort');
    sort.value = leaderboardSort;
    sort.onchange = e => {leaderboardSort = e.target.value; renderRows();};
    document.getElementById('backToQueueBtn').onclick = () => document.querySelector('[data-tab="queue"]').click();
    renderRows();
}

// Run when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { if (document.body?.dataset.page !== 'scoring') init(); });
} else {
    if (document.body?.dataset.page !== 'scoring') init();
}
