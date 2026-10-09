/* Traditional doubles side-out scoring. USA Pickleball 2026, sections 4-6.
 * Pure immutable transitions; no storage or DOM dependencies.
 */
(function (root) {
    'use strict';
    const clone = value => JSON.parse(JSON.stringify(value));
    const other = team => team === 'A' ? 'B' : 'A';
    function requireTeam(team) { if (!['A', 'B'].includes(team)) throw new Error('Choose Team A or Team B.'); }
    function snapshot(state) { const { history, ...rest } = state; return clone(rest); }
    function requireEndingRule(rule) { if (!['standard', 'golden_point'].includes(rule)) throw new Error('Choose a supported game ending rule.'); }
    function winner(scores, target, endingRule = 'standard') {
        requireEndingRule(endingRule);
        if (Math.max(scores.A, scores.B) < target || Math.abs(scores.A - scores.B) < (endingRule === 'golden_point' ? 1 : 2)) return null;
        return scores.A > scores.B ? 'A' : 'B';
    }
    function positionsFor(teams, startingRight, scores) {
        const positions = {};
        for (const team of ['A', 'B']) {
            const starter = startingRight[team];
            const partner = teams[team].find(id => id !== starter);
            positions[team] = scores[team] % 2 === 0 ? {right: starter, left: partner} : {right: partner, left: starter};
        }
        return positions;
    }
    function create(game, config) {
        requireTeam(config.firstServingTeam);
        if (!['traditional'].includes(config.mode || 'traditional')) throw new Error('Only traditional side-out scoring is enabled.');
        const target = Number(config.target || 11);
        if (![11, 15, 21].includes(target)) throw new Error('Target must be 11, 15 or 21.');
        const teams = {A: game.teamA.map(p => p.id), B: game.teamB.map(p => p.id)};
        if (teams.A.length !== 2 || teams.B.length !== 2 || new Set([...teams.A, ...teams.B]).size !== 4) throw new Error('A doubles game needs four distinct players.');
        for (const team of ['A', 'B']) if (!teams[team].includes(config.startingRight[team])) throw new Error('Confirm the right-side player for each team.');
        const endingRule = config.endingRule || 'standard';
        requireEndingRule(endingRule);
        const initialConfig = {endingRule, firstServingTeam: config.firstServingTeam, startingRight: clone(config.startingRight), target, mode: 'traditional'};
        return {
            version: 2, matchId: game.gameId, teams, initialConfig, mode: 'traditional', target, endingRule,
            scores: {A: 0, B: 0}, positions: positionsFor(teams, initialConfig.startingRight, {A:0, B:0}),
            servingTeam: config.firstServingTeam, serverId: config.startingRight[config.firstServingTeam],
            serverNumber: 2, status: 'in_progress', winner: null, history: [], revision: 0, manuallyCorrected: false, hasRecordedRally: false
        };
    }
    function validate(state) {
        if (!state || state.mode !== 'traditional' || ![11,15,21].includes(state.target)) throw new Error('Unsupported scoring state.');
        const rule = state.endingRule || 'standard';
        requireEndingRule(rule);
        if (rule !== (state.initialConfig.endingRule || 'standard')) throw new Error('Ending rule differs from the configured rule. Reset before changing it.');
        requireTeam(state.servingTeam);
        if (![1,2].includes(state.serverNumber)) throw new Error('Server number must be 1 or 2.');
        const ids = [...state.teams.A, ...state.teams.B];
        if (state.teams.A.length !== 2 || state.teams.B.length !== 2 || new Set(ids).size !== 4) throw new Error('Invalid player assignments.');
        const expected = positionsFor(state.teams, state.initialConfig.startingRight, state.scores);
        for (const team of ['A','B']) {
            if (!Number.isSafeInteger(state.scores[team]) || state.scores[team] < 0) throw new Error('Scores must be nonnegative whole numbers.');
            if (!state.teams[team].includes(state.initialConfig.startingRight[team])) throw new Error('Invalid starting player.');
            if (state.positions[team].right !== expected[team].right || state.positions[team].left !== expected[team].left) throw new Error('Court positions must match the starting players and score parity.');
        }
        if (!state.teams[state.servingTeam].includes(state.serverId)) throw new Error('Server must belong to the serving team.');
        const result = winner(state.scores, state.target, state.endingRule || 'standard');
        if (state.winner !== result || state.status !== (result ? 'game_over' : 'in_progress')) throw new Error('Score and match status disagree.');
        return true;
    }
    function rally(state, rallyWinner) {
        validate(state); requireTeam(rallyWinner);
        if (state.status !== 'in_progress') return state;
        const next = clone(state);
        next.hasRecordedRally = true;
        next.history.push({type:'rally', winner: rallyWinner, before: snapshot(state)});
        if (rallyWinner === state.servingTeam) {
            next.scores[rallyWinner]++;
            const position = next.positions[rallyWinner];
            [position.right, position.left] = [position.left, position.right];
        } else if (state.serverNumber === 1) {
            next.serverNumber = 2;
            next.serverId = next.teams[state.servingTeam].find(id => id !== state.serverId);
        } else {
            next.servingTeam = other(state.servingTeam);
            next.serverNumber = 1;
            next.serverId = next.positions[next.servingTeam].right;
        }
        next.winner = winner(next.scores, next.target, next.endingRule || 'standard');
        next.status = next.winner ? 'game_over' : 'in_progress';
        next.revision = state.revision + 1;
        validate(next);
        return next;
    }
    function undo(state) {
        validate(state);
        if (!state.history.length) return state;
        const next = clone(state.history[state.history.length - 1].before);
        next.history = clone(state.history.slice(0,-1));
        next.hasRecordedRally = state.hasRecordedRally || state.history.some(event => event.type === 'rally');
        next.revision = state.revision + 1;
        validate(next);
        return next;
    }
    function correct(state, correction) {
        validate(state); requireTeam(correction.servingTeam);
        const next = clone(state);
        next.history.push({type:'correction', before:snapshot(state)});
        next.scores = clone(correction.scores);
        next.positions = clone(correction.positions);
        next.servingTeam = correction.servingTeam;
        next.serverId = correction.serverId;
        next.serverNumber = Number(correction.serverNumber);
        next.winner = winner(next.scores, next.target, next.endingRule || 'standard');
        next.status = next.winner ? 'game_over' : 'in_progress';
        next.manuallyCorrected = true;
        next.revision = state.revision + 1;
        validate(next);
        return next;
    }
    function reset(state) {
        validate(state);
        const game = {gameId:state.matchId, teamA:state.teams.A.map(id=>({id})), teamB:state.teams.B.map(id=>({id}))};
        const next = create(game, state.initialConfig);
        next.revision = state.revision + 1;
        return next;
    }
    function setEndingRule(state, rule) {
        validate(state); requireEndingRule(rule);
        if (state.hasRecordedRally || state.history.length || state.scores.A || state.scores.B) throw new Error('Reset this match before changing its ending rule.');
        const next = clone(state);
        next.endingRule = rule;
        next.initialConfig.endingRule = rule;
        next.revision = state.revision + 1;
        return next;
    }
    function suddenDeathActive(state) {
        return state.endingRule === 'golden_point' && state.status === 'in_progress' && state.scores.A === state.scores.B && state.scores.A >= state.target - 1;
    }
    function servingInfo(state) {
        validate(state);
        const side = state.positions[state.servingTeam].right === state.serverId ? 'right' : 'left';
        const receivingTeam = other(state.servingTeam);
        return {team:state.servingTeam, playerId:state.serverId, serverNumber:state.serverNumber, side,
            receivingTeam, receiverId:state.positions[receivingTeam][side],
            scoreCall:`${state.scores[state.servingTeam]} - ${state.scores[receivingTeam]} - ${state.serverNumber}`};
    }
    const api = {create, rally, undo, correct, reset, validate, servingInfo, positionsFor, winner, setEndingRule, suddenDeathActive};
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.ScoringEngine = api;
})(globalThis);
