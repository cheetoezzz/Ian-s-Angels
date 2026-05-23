// ==================== DATA STORAGE ====================

const STORAGE_KEY = 'pickleball_queue_data';

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
                currentGame: data.currentGame,
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
                games: data.pastGames,
                playerStats: {}
            };
            
            // Build player stats for the imported session
            const stats = {};
            data.pastGames.forEach(game => {
                [...game.teamA, ...game.teamB].forEach(player => {
                    if (!stats[player.id]) {
                        stats[player.id] = {
                            playerId: player.id,
                            playerName: player.name,
                            gamesPlayedInSession: 0,
                            partners: [],
                            opponents: []
                        };
                    }
                    stats[player.id].gamesPlayedInSession++;
                });
            });
            importedSession.playerStats = stats;
            
            migrated.pastSessions.push(importedSession);
        }
        
        // Save migrated data
        saveData(migrated);
        return migrated;
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
    
    return data;
}

function saveData(data) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (error) {
        console.error('Error saving data:', error);
        showToast('Error saving data', 'error');
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
    
    // Shuffle selected players for team assignment
    const shuffled = [...selectedPlayers].sort(() => Math.random() - 0.5);
    
    // Try to avoid repeating teammates if possible without sacrificing fairness
    const teamA = [shuffled[0], shuffled[1]];
    const teamB = [shuffled[2], shuffled[3]];
    
    return {
        success: true,
        teamA,
        teamB
    };
}

// ==================== SESSION MANAGEMENT ====================

function startNewSession() {
    const data = loadData();
    
    if (data.activeSession) {
        showToast('A session is already active. End the current session first.', 'error');
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
        playerStats[player.id] = {
            playerId: player.id,
            playerName: player.name,
            gamesPlayedInSession: 0,
            partners: [],
            opponents: []
        };
    });
    
    const session = {
        sessionId: generateId(),
        sessionNumber: data.settings.currentSessionNumber,
        sessionName: `Session ${data.settings.currentSessionNumber}`,
        dateStarted: new Date().toISOString(),
        dateEnded: null,
        status: 'active',
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
    
    // Check if session has no completed games
    if (data.activeSession.games.length === 0) {
        if (!confirm('This session has no completed games. Are you sure you want to end it?')) {
            return false;
        }
    }
    
    const session = data.activeSession;
    session.status = 'completed';
    session.dateEnded = new Date().toISOString();
    
    // Clear all players for a fresh start
    data.players = [];
    
    data.pastSessions.unshift(session);
    data.activeSession = null;
    
    saveData(data);
    renderApp();
    showToast(`Session ${session.sessionNumber} ended - all players cleared`, 'success');
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
    
    const result = selectPlayersForGame(data);
    
    if (!result.success) {
        showToast(result.message, 'error');
        return false;
    }
    
    data.settings.currentGameNumber++;
    
    const game = {
        gameId: generateId(),
        gameNumber: data.settings.currentGameNumber,
        teamA: result.teamA.map(p => ({ id: p.id, name: p.name })),
        teamB: result.teamB.map(p => ({ id: p.id, name: p.name })),
        dateGenerated: new Date().toISOString(),
        dateCompleted: null,
        status: 'current'
    };
    
    data.activeSession.currentGame = game;
    saveData(data);
    renderApp();
    showToast(`Game ${game.gameNumber} generated`, 'success');
    return true;
}

function completeCurrentGame() {
    const data = loadData();
    
    if (!data.activeSession || !data.activeSession.currentGame) {
        showToast('No current game to complete', 'error');
        return false;
    }
    
    const game = data.activeSession.currentGame;
    const allPlayerIds = [...game.teamA, ...game.teamB].map(p => p.id);
    
    // Update players who played
    data.players.forEach(player => {
        if (allPlayerIds.includes(player.id)) {
            player.gamesPlayed++;
            player.lastPlayedGameNumber = game.gameNumber;
            player.waitingSinceGameNumber = game.gameNumber + 1;
            
            // Update partner and opponent history
            const teamAIds = game.teamA.map(p => p.id);
            const teamBIds = game.teamB.map(p => p.id);
            
            if (teamAIds.includes(player.id)) {
                const teammates = teamAIds.filter(id => id !== player.id);
                player.partnerHistory.push(...teammates);
                player.opponentHistory.push(...teamBIds);
            } else {
                const teammates = teamBIds.filter(id => id !== player.id);
                player.partnerHistory.push(...teammates);
                player.opponentHistory.push(...teamAIds);
            }
            
            // Update session player stats
            if (data.activeSession.playerStats[player.id]) {
                data.activeSession.playerStats[player.id].gamesPlayedInSession++;
                if (teamAIds.includes(player.id)) {
                    const teammates = teamAIds.filter(id => id !== player.id);
                    data.activeSession.playerStats[player.id].partners.push(...teammates);
                    data.activeSession.playerStats[player.id].opponents.push(...teamBIds);
                } else {
                    const teammates = teamBIds.filter(id => id !== player.id);
                    data.activeSession.playerStats[player.id].partners.push(...teammates);
                    data.activeSession.playerStats[player.id].opponents.push(...teamAIds);
                }
            }
        } else {
            // Players who didn't play keep or improve their waiting priority
            if (player.isActive) {
                player.waitingSinceGameNumber = Math.min(player.waitingSinceGameNumber, game.gameNumber + 1);
            }
        }
    });
    
    // Move current game to session games
    game.status = 'completed';
    game.dateCompleted = new Date().toISOString();
    data.activeSession.games.unshift(game);
    data.activeSession.currentGame = null;
    
    saveData(data);
    renderApp();
    showToast(`Game ${game.gameNumber} completed`, 'success');
    return true;
}

function cancelCurrentGame() {
    const data = loadData();
    
    if (!data.activeSession || !data.activeSession.currentGame) {
        showToast('No current game to cancel', 'error');
        return false;
    }
    
    const gameNumber = data.activeSession.currentGame.gameNumber;
    data.activeSession.currentGame = null;
    
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
                // Migrate if old structure
                const dataToSave = hasOldStructure ? migrateData(importedData) : importedData;
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
    renderSession(data);
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
                <p>No active session</p>
                <button id="startSessionBtn" class="btn btn-primary">Start New Session</button>
            </div>
        `;
        const btn = document.getElementById('startSessionBtn');
        if (btn) {
            btn.addEventListener('click', startNewSession);
        }
        return;
    }
    
    const session = data.activeSession;
    const startedDate = new Date(session.dateStarted);
    const dateStr = startedDate.toLocaleDateString() + ' ' + startedDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    container.innerHTML = `
        <div class="session-card">
            <div class="session-header">
                <span class="session-name">${session.sessionName}</span>
                <span class="session-date">Started: ${dateStr}</span>
            </div>
            <div class="session-stats">
                <span class="session-stat"><span class="session-stat-label">Games:</span> ${session.games.length}</span>
            </div>
            <div class="session-actions">
                <button id="endSessionBtn" class="btn btn-danger">End Session</button>
            </div>
        </div>
    `;
    
    document.getElementById('endSessionBtn').addEventListener('click', endSession);
}

function renderCurrentGame(data) {
    const container = document.getElementById('currentGameSection');
    
    if (!data.activeSession || !data.activeSession.currentGame) {
        container.innerHTML = `
            <div class="no-game">
                <p>No active game</p>
                <button id="generateGameBtn" class="btn btn-primary">Generate Next Game</button>
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
            <div class="game-number">Game #${game.gameNumber}</div>
            
            <div class="team-card team-a">
                <div class="team-label">Team A</div>
                <div class="team-players">
                    ${game.teamA.map(p => `<div class="team-player">${p.name}</div>`).join('')}
                </div>
            </div>
            
            <div class="team-card team-b">
                <div class="team-label">Team B</div>
                <div class="team-players">
                    ${game.teamB.map(p => `<div class="team-player">${p.name}</div>`).join('')}
                </div>
            </div>
            
            <button id="completeGameBtn" class="btn btn-success">Complete Game</button>
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
                    <span class="waiting-player-name">${p.name}</span>
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
                <div class="empty-state-icon">👤</div>
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
                    <div class="player-name">${player.name}</div>
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
                    <button class="btn-remove" 
                            data-player-id="${player.id}"
                            ${isPlaying ? 'disabled' : ''}
                            class="player-remove">Remove</button>
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
        const startedStr = startedDate.toLocaleDateString() + ' ' + startedDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const endedStr = endedDate.toLocaleDateString() + ' ' + endedDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        
        // Build player stats summary
        const playerCount = Object.keys(session.playerStats).length;
        const totalGames = session.games.length;
        
        return `
            <div class="past-session-item">
                <div class="past-session-header">
                    <div class="past-session-info">
                        <div class="past-session-name">${session.sessionName}</div>
                        <div class="past-session-dates">Started: ${startedStr} | Ended: ${endedStr}</div>
                        <div class="past-session-stats-summary">${totalGames} games • ${playerCount} players</div>
                    </div>
                    <button class="expand-btn" data-session-id="${session.sessionId}">Expand</button>
                </div>
                <div class="session-games-list" id="games-${session.sessionId}">
                    ${session.games.map(game => {
                        const completedDate = new Date(game.dateCompleted);
                        const dateStr = completedDate.toLocaleDateString() + ' ' + completedDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                        
                        return `
                            <div class="session-game-item">
                                <div class="session-game-header">
                                    <span class="session-game-number">Game #${game.gameNumber}</span>
                                    <span class="session-game-date">${dateStr}</span>
                                </div>
                                <div class="session-game-teams">
                                    <div class="session-game-team">
                                        <span class="session-game-team-label">Team A:</span>
                                        ${game.teamA.map(p => p.name).join(', ')}
                                    </div>
                                    <div class="session-game-team">
                                        <span class="session-game-team-label">Team B:</span>
                                        ${game.teamB.map(p => p.name).join(', ')}
                                    </div>
                                </div>
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>
        `;
    }).join('');
    
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
    
    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            const tabId = button.dataset.tab;
            
            // Remove active class from all buttons and contents
            tabButtons.forEach(btn => btn.classList.remove('active'));
            tabContents.forEach(content => content.classList.remove('active'));
            
            // Add active class to clicked button and corresponding content
            button.classList.add('active');
            document.getElementById(`${tabId}-tab`).classList.add('active');
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
}

// ==================== INITIALIZATION ====================

function init() {
    setupTabNavigation();
    setupEventListeners();
    renderApp();
}

// Run when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
