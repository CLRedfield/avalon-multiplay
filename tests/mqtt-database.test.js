const test = require('node:test');
const assert = require('node:assert/strict');
const { FakeBroker, createContext, loadAdapter } = require('./helpers/mqtt-fixture');

test('two MQTT clients create, join, transact, sync, and clear a retained room', async (t) => {
    const fakeBroker = new FakeBroker();
    const context = createContext(fakeBroker);
    const MqttDatabaseAdapter = loadAdapter(context);
    const host = new MqttDatabaseAdapter();
    const guest = new MqttDatabaseAdapter();
    const secondGuest = new MqttDatabaseAdapter();
    t.after(async () => { await Promise.all([host, guest, secondGuest].map((adapter) => adapter.disconnectRoom())); });
    guest.playerGraceMs = 20;
    secondGuest.playerGraceMs = 20;
    const roomPath = 'rooms/T35T';

    await host.connectForRoom('T35T', 'host-player');
    assert.equal((await host.ref(roomPath).once('value')).exists(), false);

    await host.ref(roomPath).set({
        code: 'T35T',
        host: 'host-player',
        state: 'waiting',
        players: {
            'host-player': {
                name: 'Host',
                isHost: true,
                connected: true,
                authPublicKey: host.publicSigningKey,
                encryptionPublicKey: host.publicEncryptionKey,
                joinedAt: 1
            }
        }
    });

    await guest.connectForRoom('T35T', 'guest-player');
    const retainedRoom = (await guest.ref(roomPath).once('value')).val();
    assert.equal(retainedRoom.host, 'host-player');

    const joinResult = await guest.ref(roomPath).transaction((room) => {
        room.players['guest-player'] = {
            name: 'Guest',
            isHost: false,
            connected: true,
            authPublicKey: guest.publicSigningKey,
            encryptionPublicKey: guest.publicEncryptionKey,
            joinedAt: 2
        };
        return room;
    });

    assert.equal(joinResult.committed, true);
    assert.equal(joinResult.snapshot.val().players['guest-player'].name, 'Guest');
    assert.equal((await host.ref(roomPath).once('value')).val().players['guest-player'].name, 'Guest');

    await secondGuest.connectForRoom('T35T', 'second-guest-player');
    await secondGuest.ref(roomPath).transaction((room) => {
        room.players['second-guest-player'] = {
            name: 'Second Guest',
            isHost: false,
            connected: true,
            authPublicKey: secondGuest.publicSigningKey,
            encryptionPublicKey: secondGuest.publicEncryptionKey,
            joinedAt: 3
        };
        return room;
    });

    const versionBeforeNoOp = guest.envelope.version;
    const noOpResult = await guest.ref(roomPath).transaction((room) => room);
    assert.equal(noOpResult.committed, true);
    assert.equal(guest.envelope.version, versionBeforeNoOp);

    await assert.rejects(
        guest.ref(roomPath).child('game').set({ phase: 'ended', winners: 'evil' }),
        /没有权限/
    );

    host.registerActionHandler(async ({ action, room }) => {
        assert.equal(action, 'increment');
        await new Promise((resolve) => setTimeout(resolve, 15));
        room.game = { count: (room.game?.count || 0) + 1 };
        return { room };
    });
    await Promise.all([
        guest.sendAction('increment'),
        secondGuest.sendAction('increment')
    ]);
    assert.equal((await host.ref(roomPath).once('value')).val().game.count, 2);

    let privateMessage = null;
    guest.onPrivateMessage((message) => {
        privateMessage = message;
    });
    await host.publishPrivate('guest-player', { type: 'role', roleId: 'merlin' });
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.deepEqual(JSON.parse(JSON.stringify(privateMessage)), { type: 'role', roleId: 'merlin' });

    const retainedState = JSON.parse(fakeBroker.retained.get('avalon-multiplay/v5/rooms/T35T/state').toString());
    assert.ok(retainedState.stateSignature);

    const versionBeforeUnsignedInjection = host.envelope.version;
    fakeBroker.publish(
        'avalon-multiplay/v5/rooms/T35T/state',
        JSON.stringify({
            protocol: retainedState.protocol,
            version: versionBeforeUnsignedInjection + 100,
            updatedAt: Date.now(),
            room: { ...retainedState.room, host: 'attacker' }
        }),
        { retain: true }
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(host.envelope.version, versionBeforeUnsignedInjection);
    assert.equal(guest.envelope.version, versionBeforeUnsignedInjection);

    await host.disconnectRoom();
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal((await guest.ref(roomPath).once('value')).val().host, 'guest-player');

    const clearResult = await guest.ref(roomPath).transaction(() => null);
    assert.equal(clearResult.committed, true);
    assert.equal((await guest.ref(roomPath).once('value')).exists(), false);
    assert.equal(fakeBroker.retained.has('avalon-multiplay/v5/rooms/T35T/state'), true);

    await secondGuest.disconnectRoom();
    await guest.disconnectRoom();
});

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, timeout = 3000) {
    const deadline = Date.now() + timeout;
    while (!check()) {
        if (Date.now() > deadline) throw new Error('Timed out waiting for expected state');
        await delay(10);
    }
}

async function recoveryFixture(t) {
    const broker = new FakeBroker();
    const context = createContext(broker);
    const Adapter = loadAdapter(context);
    const host = new Adapter();
    const guest = new Adapter();
    const adapters = [host, guest];
    t.after(async () => { for (const adapter of adapters) await adapter.disconnectRoom(); });
    for (const adapter of adapters) {
        adapter.retryDelayMs = 15;
        adapter.requestTimeoutMs = 2000;
        adapter.playerGraceMs = 160;
        adapter.hostGraceMs = 250;
    }
    await host.connectForRoom('RCVR', 'host');
    await host.ref('rooms/RCVR').set({
        code: 'RCVR', state: 'waiting', host: 'host', createdAt: Date.now(),
        players: { host: { name: 'Host', joinedAt: 1, connected: true, isHost: true,
            transportId: host.transportId, authPublicKey: host.publicSigningKey, encryptionPublicKey: host.publicEncryptionKey } }
    });
    await guest.connectForRoom('RCVR', 'guest');
    await guest.ref('rooms/RCVR').transaction((room) => {
        room.players.guest = { name: 'Guest', joinedAt: 2, connected: true,
            transportId: guest.transportId, authPublicKey: guest.publicSigningKey, encryptionPublicKey: guest.publicEncryptionKey };
        return room;
    });
    host.setHostSecrets({ gameId: 'round-1', roles: { host: 'loyal', guest: 'merlin' }, privateStates: {
        guest: { type: 'role', gameId: 'round-1', roleId: 'merlin', nightInfo: [], neutralFailUsed: false }
    } });
    await host.ref('rooms/RCVR').update({ state: 'playing', game: {
        gameId: 'round-1', phase: 'vote', currentMission: 0, selectionRevision: 1,
        playerOrder: ['host', 'guest'], votes: {}, count: 0
    } });
    await until(() => guest.envelope.room.state === 'playing');
    const handler = async ({ action, room }) => {
        assert.equal(action, 'increment');
        room.game.count++;
        return { room };
    };
    host.registerActionHandler(handler);
    return { broker, context, Adapter, host, guest, adapters, handler };
}

test('lost response retries the same command without executing it twice', async (t) => {
    const { host, guest, broker } = await recoveryFixture(t);
    let dropped = false;
    broker.filter = (topic) => {
        if (topic.includes('/responses/') && !dropped) { dropped = true; return false; }
        return true;
    };
    await guest.sendAction('increment');
    assert.equal(host.envelope.room.game.count, 1);
    const requests = broker.sent.filter((message) => message.topic.endsWith('/commands'))
        .map((message) => JSON.parse(message.payload)).filter((command) => command.action === 'increment');
    assert.ok(requests.length >= 2);
    assert.equal(new Set(requests.map((command) => command.requestId)).size, 1);
});

test('short host and guest outages preserve game, authority and submitted cards; reconnect resends private identity', async (t) => {
    const { host, guest } = await recoveryFixture(t);
    let received = null;
    guest.onPrivateMessage((message) => { received = message; });
    const hostSocket = host.client;
    hostSocket.drop();
    await until(() => guest.offlineTimers.has('host'));
    assert.equal(guest.envelope.room.host, 'host');
    assert.equal(guest.envelope.room.game.phase, 'vote');
    hostSocket.reconnect();
    await until(() => host.ready && !guest.offlineTimers.has('host'));
    await until(() => guest.ready);
    guest.client.drop();
    await until(() => host.offlineTimers.has('guest'));
    assert.equal(host.envelope.room.players.guest.connected, true);
    guest.client.reconnect();
    await until(() => guest.ready && received?.roleId === 'merlin');
    assert.equal(host.envelope.room.host, 'host');
    assert.equal(host.envelope.room.game.phase, 'vote');
    assert.equal(host.offlineTimers.has('guest'), false);
});

test('host timeout safely ends an unrecoverable game, and disconnected clients never elect themselves', async (t) => {
    const { host, guest } = await recoveryFixture(t);
    host.client.drop();
    await until(() => guest.envelope.room.host === 'guest');
    assert.equal(guest.envelope.room.game.winners, 'aborted');
    assert.equal(guest.envelope.room.game.roles, undefined);
    guest.client.drop();
    const room = host.envelope.room;
    host._scheduleOffline('guest', guest.transportId);
    assert.equal(host.offlineTimers.size, 0);
    assert.equal(host.envelope.room, room);
});

test('host refresh restores an atomic checkpoint and receipts after lost broker state', async (t) => {
    const { host, guest, broker, Adapter, adapters, handler } = await recoveryFixture(t);
    await guest.sendAction('increment');
    const command = broker.sent.filter((message) => message.topic.endsWith('/commands'))
        .map((message) => JSON.parse(message.payload)).find((command) => command.action === 'increment');
    guest.hostGraceMs = 4000;
    await host.disconnectRoom();
    broker.retained.clear();
    const restored = new Adapter();
    adapters.push(restored);
    restored.registerActionHandler(handler);
    await restored.connectForRoom('RCVR', 'host');
    assert.equal(restored.getHostSecrets().roles.guest, 'merlin');
    await restored._handleCommand(command);
    assert.equal(restored.envelope.room.game.count, 1);
    assert.equal(restored.envelope.room.host, 'host');
    assert.ok(broker.retained.has('avalon-multiplay/v5/rooms/RCVR/state'));
});

test('old-round commands and forged responses cannot change a later round', async (t) => {
    const { host, guest, broker } = await recoveryFixture(t);
    let savedCommand;
    broker.filter = (topic, buffer) => {
        if (topic.endsWith('/commands') && JSON.parse(buffer).action === 'increment') {
            savedCommand = JSON.parse(buffer);
            return false;
        }
        return true;
    };
    const pending = guest.sendAction('increment');
    const rejected = assert.rejects(pending, /阶段已变化/);
    await until(() => savedCommand);
    broker.publish(savedCommand.replyTopic, JSON.stringify({ requestId: savedCommand.requestId, ok: true, envelope: {
        protocol: 3, version: 9999, room: { host: 'attacker' }
    } }));
    await delay(20);
    assert.ok(guest.pendingRequests.has(savedCommand.requestId));
    await host.ref('rooms/RCVR/game').update({ currentMission: 1, selectionRevision: 2 });
    broker.filter = null;
    await rejected;
    assert.equal(host.envelope.room.game.count, 0);
    assert.equal(guest.envelope.room.host, 'host');
});

test('heartbeats do not churn room versions and old sockets cannot disconnect a resumed player', async (t) => {
    const { host, guest } = await recoveryFixture(t);
    const version = host.envelope.version;
    await guest._announcePresence('heartbeat');
    await host._announcePresence('heartbeat');
    await delay(30);
    assert.equal(host.envelope.version, version);
    const oldTransport = guest.transportId;
    guest.transportId = 'new-transport';
    await guest._announcePresence('online');
    await until(() => host.envelope.room.players.guest.transportId === 'new-transport');
    const body = { protocol: 3, type: 'offline', roomCode: 'RCVR', playerId: 'guest', transportId: oldTransport, at: Date.now() };
    await host._handlePresence({ ...body, signature: await guest._signValue(body) });
    assert.equal(host.offlineTimers.has('guest'), false);
    assert.equal(host.envelope.room.players.guest.connected, true);
});

test('a lost state publication acknowledgment retries the committed result', async (t) => {
    const { host, guest } = await recoveryFixture(t);
    const original = host._publishRaw.bind(host);
    let lost = false;
    host._publishRaw = async (topic, payload, options) => {
        await original(topic, payload, options);
        if (!lost && topic.endsWith('/state')) {
            lost = true;
            throw new Error('simulated PUBACK loss');
        }
    };
    await guest.sendAction('increment');
    assert.equal(lost, true);
    assert.equal(host.envelope.room.game.count, 1);
    assert.equal(guest.envelope.room.game.count, 1);
});
