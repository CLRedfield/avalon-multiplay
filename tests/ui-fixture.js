// Loaded only by browser-smoke.html, in a separate iframe with memory-only storage.
(() => {
    const storage = new Map();
    Object.defineProperty(window, 'localStorage', { value: {
        getItem: (key) => storage.get(key) || null,
        setItem: (key, value) => storage.set(key, String(value)), removeItem: (key) => storage.delete(key)
    } });
    const clone = (value) => JSON.parse(JSON.stringify(value));
    let room = null, secrets = null, handler;
    const listeners = [];
    const reference = (path = '') => ({
        child: (child) => reference(path + '/' + child),
        once: async () => ({ val: () => path.split('/').filter(Boolean).reduce((value, key) => value?.[key], room), exists: () => !!room }),
        off() {}
    });
    window.database = {
        connected: true, ready: true, client: null, brokerUrl: 'memory://ui-fixture',
        getHostSecrets: () => secrets ? clone(secrets) : null,
        setHostSecrets: (value) => { secrets = clone(value); },
        registerActionHandler: (value) => { handler = value; },
        onPrivateMessage: (callback) => listeners.push(callback), reconnectNow() {},
        sendAction: async (action, payload = {}) => {
            const result = await handler({ action, payload, senderPlayerId: 'p0', room });
            if (!result.room) throw new Error(result.error);
            room = result.room; secrets = result.secrets;
            for (const message of result.privateMessages || []) if (message.playerId === 'p0') listeners.forEach((callback) => callback(message.value));
            sync();
            return { ok: true, result: result.result };
        }
    };
    function sync() {
        RoomManager.latestSettings = room.settings;
        RoomManager.latestPlayers = room.players;
        RoomManager.roomState = room.state;
        GameManager.players = room.players;
        App.updateLobbyPanels();
        if (!room.game) {
            window.onGameChange(null);
            document.getElementById('role-info-panel').style.display = 'none';
            UI.showView('lobby'); UI.renderLobbyPlayers(room.players);
        }
        else window.onGameChange(room.game);
    }
    document.addEventListener('DOMContentLoaded', () => {
        RoomManager.restoreSession = async () => false;
        RoomManager.updateTemplate = async (template) => { room.settings.template = GameConfig.normalizeTemplate(template); sync(); };
        RoomManager.createRoom = RoomManager.joinRoom = async () => { throw new Error('请使用上方验收场景按钮'); };
        window.addEventListener('message', async (event) => {
            if (event.source !== parent || event.origin !== new URL(document.baseURI).origin || event.data?.type !== 'avalon-ui-fixture') return;
            try {
                App.clearPhaseTimers();
                const { count, scene, role } = event.data;
                if (![5, 7, 10].includes(count)) return;
                const ids = Array.from({ length: count }, (_, i) => 'p' + i);
                const template = GameConfig.preset('chaos');
                room = { code: 'TEST', host: 'p0', state: scene === 'lobby' ? 'waiting' : 'playing', settings: { template },
                    players: Object.fromEntries(ids.map((id, i) => [id, { name: i ? `玩家 ${i + 1}` : '你', connected: true, isHost: i === 0, isReady: true, joinedAt: i }])) };
                Object.assign(RoomManager, { playerId: 'p0', currentRoom: 'TEST', isHost: true, hostId: 'p0', roomRef: reference(), playerName: '你' });
                document.getElementById('display-room-code').textContent = 'TEST';
                if (scene === 'lobby') { secrets = null; sync(); return; }
                const roles = Object.fromEntries(ids.map((id, i) => [id, i === 0 ? (scene === 'ended' ? 'spy' : role) : i === 1 ? 'merlin' : i === 2 ? 'assassin' : 'loyal']));
                const rules = GameConfig.base(count);
                for (const id of Object.values(roles)) rules.roleCounts[id] = (rules.roleCounts[id] || 0) + 1;
                Object.assign(rules, { version: 1, templateName: '本地界面验收', eventPool: ['reinforcement'] });
                room.game = { gameId: 'ui-' + Date.now(), rules, phase: 'captainChoice', playerOrder: ids, captainIndex: 0,
                    currentMission: role === 'witness' ? 1 : 0, selectionRevision: 0, selectedTeam: [], exiledPlayers: [],
                    missionResults: [role === 'witness' ? false : null, null, null, null, null], missionTeamHistory: { 0: ['p1', 'p2'] }, history: [], rejectCount: 0 };
                secrets = { gameId: room.game.gameId, roles, missionCards: {}, missionHistory: { p1: { 0: true }, p2: { 0: false } }, privateStates: {} };
                GameManager.createExpansionSecrets(secrets, ids);
                GameManager.players = room.players;
                for (const id of ids) secrets.privateStates[id] = { type: 'role', gameId: room.game.gameId, roleId: roles[id], nightInfo: [], expansion: GameManager.expansionForPlayer(secrets, id) };
                const messages = [];
                GameManager.beginExpansionRound(room.game, secrets, messages);
                if (scene === 'ended') {
                    room.game.currentMission = 2; room.game.missionResults = [true, true, true, null, null];
                    secrets.missionHistory = Object.fromEntries(ids.slice(0, 3).map((id) => [id, { 0: true, 1: true, 2: true }]));
                    const result = { kind: 'spy', targets: ['p1', 'p2'], sameTeam: false, mission: 2 };
                    secrets.expansion.log = [{ playerId: 'p0', role: 'spy', mission: 2, result }];
                    room.game.history = [0, 1, 2].map((index) => ({ seq: index + 1, mission: index + 1, type: 'mission', team: ['p0', 'p1', 'p2'], success: true, failCount: 0, weight: 1 }));
                    GameManager._applyEndedState(room.game, 'good', '好人累计三点任务进度，刺客未命中梅林');
                    GameManager.revealExpansion(room.game, secrets);
                } else {
                    // Leave the real authority waiting only for the visible player's input.
                    for (const id of ids.slice(1)) if (room.game.phase === 'roundSkill') {
                        const result = await handler({ action: 'submitRoundSkill', payload: { choice: 'pass' }, senderPlayerId: id, room });
                        if (!result.room) throw new Error(result.error);
                        room = result.room; secrets = result.secrets;
                    }
                }
                GameManager.gameData = room.game;
                listeners.forEach((callback) => callback(secrets.privateStates.p0));
                sync();
            } catch (error) { console.error(error); UI.showToast(error.message, 10000); }
        });
    });
})();
