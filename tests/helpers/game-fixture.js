const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const clone = (value) => JSON.parse(JSON.stringify(value));
function loadGame(context) {
    for (const file of ['roles.js', 'rules-config.js', 'room-manager.js', 'game.js', 'game-expansion.js', 'ui.js', 'workshop.js']) {
        vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../../js', file), 'utf8'), context);
    }
    return context.window;
}
function engine({ count = 7, preset = 'council', roles, rules: overrides = {} } = {}) {
    let secrets;
    const storage = new Map();
    const callbacks = [];
    const database = {
        getHostSecrets: () => secrets ? clone(secrets) : null,
        setHostSecrets: (value) => { secrets = clone(value); },
        registerActionHandler() {}, onPrivateMessage(fn) { callbacks.push(fn); }
    };
    const context = vm.createContext({ console, window: {}, database, CustomEvent: class {},
        localStorage: { getItem: (key) => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) }
    });
    const { GameConfig: config, GameManager: gm, RoomManager: rm } = loadGame(context);
    const ids = Array.from({ length: count }, (_, i) => `p${i}`);
    const rules = { ...config.resolve({ template: config.preset(preset) }, count), ...overrides };
    const assigned = roles ? Object.fromEntries(ids.map((id, i) => [id, roles[i] || 'loyal']))
        : Object.fromEntries(Object.entries(config.assign(ids, rules)).map(([id, role]) => [id, role.id]));
    if (roles) {
        rules.roleCounts = {};
        for (const role of Object.values(assigned)) rules.roleCounts[role] = (rules.roleCounts[role] || 0) + 1;
        rules.neutralSlots = 0; rules.neutralPool = [];
    }
    let room = {
        code: 'TEST', host: 'p0', state: 'playing',
        players: Object.fromEntries(ids.map((id, i) => [id, { name: `玩家${i + 1}`, connected: true, joinedAt: i, isReady: true }])),
        game: { gameId: 'game-test', phase: 'night', playerOrder: ids, captainIndex: 0, currentMission: 0, selectionRevision: 0,
            rules, history: [], missionResults: [null, null, null, null, null], missionTeamHistory: {}, exiledPlayers: [], votes: {}, selectedTeam: [], rejectCount: 0 }
    };
    secrets = { gameId: room.game.gameId, roles: assigned, missionCards: {}, missionHistory: {}, privateStates: {} };
    gm.createExpansionSecrets(secrets, ids);
    for (const id of ids) secrets.privateStates[id] = { type: 'role', gameId: room.game.gameId, roleId: assigned[id], nightInfo: [], expansion: gm.expansionForPlayer(secrets, id) };
    rm.playerId = 'p0'; rm.currentRoom = 'TEST'; rm.isHost = true;
    gm.players = room.players; gm.gameData = room.game;
    const fixture = {
        context, config, gm, rm, ids, database, callbacks, storage,
        get room() { return room; }, get game() { return room.game; }, get secrets() { return secrets; },
        async act(action, payload = {}, playerId = room.host) {
            const response = await gm.handleAuthoritativeAction({ action, payload, senderPlayerId: playerId, room });
            if (response.room) {
                if (response.secrets) database.setHostSecrets(response.secrets);
                room = response.room; gm.players = room.players; gm.gameData = room.game;
            }
            return response;
        },
        async ok(action, payload = {}, playerId = room.host) {
            const response = await fixture.act(action, payload, playerId);
            if (!response.room) throw new Error(`${action}: ${response.error}`);
            return response;
        },
        async begin() { return fixture.ok('reconcilePresence'); },
        async passSkills() {
            for (const id of ids) {
                if (room.game.phase === 'roundSkill' && gm.getActivePlayerIds().includes(id) && !Object.hasOwn(secrets.expansion.submissions, id)) await fixture.ok('submitRoundSkill', { choice: 'pass' }, id);
            }
        },
        async mission(cards = {}) {
            await fixture.passSkills();
            await fixture.ok('chooseAction', { actionType: 'mission' }, gm.getCaptain().id);
            const size = gm.getCurrentMissionSize();
            const candidates = gm.getActivePlayerIds();
            let team;
            const combinations = (items, n, prefix = []) => {
                if (!n) { if (!gm.teamConstraintError(room.game, prefix)) team = prefix; return; }
                for (let i = 0; i <= items.length - n && !team; i++) combinations(items.slice(i + 1), n - 1, [...prefix, items[i]]);
            };
            combinations(candidates, size);
            await fixture.ok('confirmTeam', { gameId: room.game.gameId, selectionRevision: room.game.selectionRevision, selectedTeam: team }, gm.getCaptain().id);
            for (const id of gm.getActivePlayerIds()) await fixture.ok('castVote', { approve: true }, id);
            await fixture.ok('proceedVoteResult');
            for (const id of team) await fixture.ok('submitMissionCard', { success: cards[id] !== false }, id);
            if (room.game.phase === 'missionResult') await fixture.ok('proceedMissionResult');
        }
    };
    return fixture;
}
module.exports = { engine, loadGame, clone };
