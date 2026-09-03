const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { webcrypto } = require('node:crypto');

class FakeBroker {
    constructor() {
        this.clients = new Set();
        this.retained = new Map();
    }

    connect(options) {
        const client = new FakeClient(this, options);
        this.clients.add(client);
        queueMicrotask(() => {
            client.connected = true;
            client.emit('connect');
        });
        return client;
    }

    publish(topic, payload, options = {}) {
        const buffer = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload));
        if (options.retain) {
            if (buffer.length === 0) this.retained.delete(topic);
            else this.retained.set(topic, Buffer.from(buffer));
        }

        for (const client of this.clients) {
            if (!client.connected || !client.subscriptions.has(topic)) continue;
            queueMicrotask(() => client.emit('message', topic, Buffer.from(buffer)));
        }
    }
}

class FakeClient extends EventEmitter {
    constructor(broker, options) {
        super();
        this.broker = broker;
        this.options = options;
        this.connected = false;
        this.subscriptions = new Set();
    }

    subscribe(topics, options, callback) {
        for (const topic of Array.isArray(topics) ? topics : [topics]) {
            this.subscriptions.add(topic);
        }
        queueMicrotask(() => {
            callback?.(null);
            for (const topic of this.subscriptions) {
                const retained = this.broker.retained.get(topic);
                if (retained) this.emit('message', topic, Buffer.from(retained));
            }
        });
    }

    publish(topic, payload, options, callback) {
        this.broker.publish(topic, payload, options);
        queueMicrotask(() => callback?.(null));
    }

    end(force, options, callback) {
        if (force && this.options.will) {
            this.broker.publish(
                this.options.will.topic,
                this.options.will.payload,
                this.options.will
            );
        }
        this.connected = false;
        this.broker.clients.delete(this);
        queueMicrotask(() => callback?.());
    }
}

function createContext(fakeBroker) {
    const storage = new Map();
    const window = {
        dispatchEvent() {}
    };
    const context = vm.createContext({
        Buffer,
        CustomEvent: class CustomEvent {
            constructor(type, init = {}) {
                this.type = type;
                this.detail = init.detail;
            }
        },
        clearTimeout,
        console,
        crypto: webcrypto,
        localStorage: {
            getItem(key) {
                return storage.has(key) ? storage.get(key) : null;
            },
            setItem(key, value) {
                storage.set(key, String(value));
            }
        },
        mqtt: {
            connect(url, options) {
                assert.match(url, /^wss:\/\//);
                return fakeBroker.connect(options);
            }
        },
        queueMicrotask,
        setTimeout,
        window
    });
    window.window = window;
    return context;
}

function loadAdapter(context) {
    const projectRoot = path.resolve(__dirname, '..');
    vm.runInContext(fs.readFileSync(path.join(projectRoot, 'js', 'mqtt-config.js'), 'utf8'), context);
    vm.runInContext(fs.readFileSync(path.join(projectRoot, 'js', 'mqtt-database.js'), 'utf8'), context);
    return context.window.MqttDatabaseAdapter;
}

test('two MQTT clients create, join, transact, sync, and clear a retained room', async () => {
    const fakeBroker = new FakeBroker();
    const context = createContext(fakeBroker);
    const MqttDatabaseAdapter = loadAdapter(context);
    const host = new MqttDatabaseAdapter();
    const guest = new MqttDatabaseAdapter();
    const secondGuest = new MqttDatabaseAdapter();
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

    const retainedState = JSON.parse(fakeBroker.retained.get('avalon-multiplay/v3/rooms/T35T/state').toString());
    assert.ok(retainedState.stateSignature);

    const versionBeforeUnsignedInjection = host.envelope.version;
    fakeBroker.publish(
        'avalon-multiplay/v3/rooms/T35T/state',
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
    assert.equal(fakeBroker.retained.has('avalon-multiplay/v3/rooms/T35T/state'), true);

    await secondGuest.disconnectRoom();
    await guest.disconnectRoom();
});
