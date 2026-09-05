const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { FakeBroker, createContext, loadAdapter } = require('./helpers/mqtt-fixture');
const { loadGame, clone } = require('./helpers/game-fixture');
const until = async (check) => {
    const deadline = Date.now() + 5000;
    while (!check()) {
        if (Date.now() > deadline) throw new Error('Timed out waiting for synchronized clients');
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
};

for (const count of [5, 7, 10]) {
    test(`${count} MQTT clients synchronize templates, sealed skills, retry receipts, recovery and a complete match`, async (t) => {
        const broker = new FakeBroker();
        const clients = [];
        t.after(async () => { for (const client of clients) await client.db.disconnectRoom(); });
        for (let i = 0; i < count; i++) {
            const context = createContext(broker);
            const Adapter = loadAdapter(context);
            context.database = context.window.database;
            const api = loadGame(context);
            const db = context.database;
            db.retryDelayMs = 15; db.requestTimeoutMs = 5000; db.hostGraceMs = 5000;
            context.window.onGameChange = (game) => { api.GameManager.gameData = game; };
            context.window.onPlayersChange = (players) => { api.GameManager.players = players; };
            const client = { context, Adapter, db, rm: api.RoomManager, gm: api.GameManager, config: api.GameConfig };
            clients.push(client);
            if (i === 0) await client.rm.createRoom(`玩家 ${i + 1}`);
            else await client.rm.joinRoom(clients[0].rm.currentRoom, `玩家 ${i + 1}`);
        }
        const host = clients[0];
        const template = host.config.preset('mist');
        template.variants[count].eventPool = ['double', 'rotation'];
        await host.rm.updateTemplate(template);
        await until(() => clients.every((client) => client.rm.latestSettings?.template?.id === 'mist'));
        await assert.rejects(clients[1].rm.updateTemplate(template), /只有房主/);
        // Stable assignment for reproducible transport coverage: the spy is a guest.
        vm.runInContext('Math.random = () => 0.999', host.context);
        await host.rm.startGame();
        await until(() => clients.every((client) => client.gm.privateGameId === host.gm.gameData?.gameId));
        const originalRules = clone(host.gm.gameData.rules);
        await assert.rejects(host.rm.updateTemplate(host.config.preset('chaos')), /大厅/);
        assert.deepEqual(clone(host.gm.gameData.rules), originalRules);
        await Promise.all(clients.map((client) => client.rm.setReady(true)));
        await host.db.sendAction('reconcilePresence');
        await until(() => clients.every((client) => client.gm.gameData?.phase === 'roundSkill'));
        const spy = clients.find((client) => client.gm.privateRoleId === 'spy');
        assert.ok(spy && spy !== host);
        const targets = clients.filter((client) => client !== spy).slice(0, 2).map((client) => client.rm.playerId);
        const startingEvent = clone(host.gm.gameData.activeEvent);
        let dropped = false;
        broker.filter = (topic, payload, client) => {
            if (topic.endsWith('/responses/' + spy.db.transportId) && client === spy.db.client && !dropped) { dropped = true; return false; }
            return true;
        };
        await spy.db.sendAction('submitRoundSkill', { choice: 'use', targets }, { sealToHost: true });
        broker.filter = null;
        assert.equal(dropped, true);
        assert.equal(host.db.getHostSecrets().expansion.log.length, 1);
        await until(() => spy.gm.privateExpansion?.used);
        assert.equal(spy.gm.privateExpansion.results.length, 1);
        assert.ok(clients.filter((client) => client !== spy).every((client) => !client.gm.privateExpansion.results.length));
        const commands = broker.sent.filter((packet) => packet.topic.endsWith('/commands')).map((packet) => JSON.parse(packet.payload))
            .filter((command) => command.action === 'submitRoundSkill' && command.senderPlayerId === spy.rm.playerId);
        assert.ok(commands.length >= 2);
        assert.equal(new Set(commands.map((command) => command.requestId)).size, 1);
        assert.ok(commands.every((command) => command.payload.sealed && !command.payload.targets));
        assert.ok(!broker.sent.some((packet) => packet.payload.includes('"sameTeam"')));
        assert.ok(!host.gm.gameData.revealedRoles && !host.gm.gameData.revealedDetails);

        spy.db.client.drop();
        await until(() => host.db.offlineTimers.has(spy.rm.playerId));
        spy.gm.privateExpansion = null;
        spy.db.client.reconnect();
        await until(() => spy.db.ready && spy.gm.privateExpansion?.used);
        assert.equal(spy.gm.privateExpansion.results.length, 1);
        assert.deepEqual(clone(host.gm.gameData.activeEvent), startingEvent);

        if (count === 7) {
            const oldHost = host.db;
            await oldHost.disconnectRoom();
            const replacement = new host.Adapter();
            replacement.retryDelayMs = 15;
            host.context.database = replacement;
            host.context.window.database = replacement;
            replacement.registerActionHandler((context) => host.gm.handleAuthoritativeAction(context));
            host.db = replacement;
            await host.rm.restoreSession();
            await until(() => clients.every((client) => client.db.ready));
            assert.equal(host.db.getHostSecrets().expansion.log.length, 1);
            assert.deepEqual(clone(host.gm.gameData.activeEvent), startingEvent);
            assert.equal(host.db.getHostSecrets().expansion.used[spy.rm.playerId], true);
        }

        const byId = (id) => clients.find((client) => client.rm.playerId === id);
        for (let mission = 0; mission < 5 && !['assassin', 'ended'].includes(host.gm.gameData.phase); mission++) {
            if (host.gm.gameData.phase === 'roundSkill') {
                for (const client of clients) {
                    if (Object.hasOwn(host.db.getHostSecrets().expansion.submissions, client.rm.playerId)) continue;
                    await client.db.sendAction('submitRoundSkill', { choice: 'pass' }, { sealToHost: true });
                }
            }
            await until(() => clients.every((client) => client.gm.gameData.phase === 'captainChoice'));
            const captain = byId(host.gm.getCaptain().id);
            await captain.db.sendAction('chooseAction', { actionType: 'mission' });
            await until(() => captain.gm.gameData.phase === 'selectTeam');
            const team = host.gm.gameData.playerOrder.slice(0, host.gm.getCurrentMissionSize());
            await captain.db.sendAction('confirmTeam', { gameId: captain.gm.gameData.gameId, selectionRevision: captain.gm.gameData.selectionRevision, selectedTeam: team });
            await until(() => clients.every((client) => client.gm.gameData.phase === 'vote'));
            await Promise.all(clients.map((client) => client.db.sendAction('castVote', { approve: true })));
            await host.db.sendAction('proceedVoteResult');
            await until(() => clients.every((client) => client.gm.gameData.phase === 'mission'));
            await Promise.all(team.map((id) => byId(id).db.sendAction('submitMissionCard', { success: true }, { sealToHost: true })));
            await host.db.sendAction('proceedMissionResult');
        }
        if (host.gm.gameData.phase === 'assassin') {
            await until(() => clients.every((client) => client.gm.gameData.phase === 'assassin'));
            const assassin = clients.find((client) => client.gm.privateRoleId === 'assassin');
            const target = clients.find((client) => !['assassin', 'merlin'].includes(client.gm.privateRoleId));
            await assassin.db.sendAction('assassinate', { targetPlayerId: target.rm.playerId });
        }
        await until(() => clients.every((client) => client.gm.gameData.phase === 'ended'));
        assert.ok(clients.every((client) => client.gm.gameData.revealedDetails.skills.length === 1));
        assert.ok(clients.every((client) => client.gm.gameData.winners === 'good'));
        assert.deepEqual(clone(clients[count - 1].gm.gameData), clone(host.gm.gameData));
        await host.rm.resetToLobby();
        await until(() => clients.every((client) => client.rm.roomState === 'waiting'));
        assert.ok(clients.every((client) => !client.gm.gameData));
        assert.equal(host.db.getHostSecrets(), null);
    });
}

test('v5 ignores older-protocol checkpoints, even if stored under a new key', () => {
    const context = createContext(new FakeBroker());
    const Adapter = loadAdapter(context);
    const adapter = new Adapter();
    adapter.roomCode = 'OLD1'; adapter.playerId = 'old-host'; adapter.brokerUrl = 'wss://test';
    context.localStorage.setItem(adapter._checkpointKey(), JSON.stringify({ envelope: { protocol: 2, room: { code: 'OLD1', host: 'old-host' } }, secrets: { roles: { secret: 'merlin' } } }));
    adapter._restoreCheckpoint();
    assert.equal(adapter.envelope, null);
    assert.equal(adapter.getHostSecrets(), null);
});
