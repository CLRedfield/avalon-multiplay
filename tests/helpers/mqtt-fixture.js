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
        this.filter = null;
        this.sent = [];
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
        this.sent.push({ topic, payload: buffer.toString() });
        if (options.retain) {
            if (buffer.length === 0) this.retained.delete(topic);
            else this.retained.set(topic, Buffer.from(buffer));
        }

        for (const client of this.clients) {
            if (!client.connected || !client.subscriptions.has(topic)) continue;
            if (this.filter && !this.filter(topic, buffer, client)) continue;
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

    drop() {
        this.connected = false;
        this.emit('offline');
        this.emit('close');
        this.broker.publish(this.options.will.topic, this.options.will.payload, this.options.will);
    }

    reconnect() {
        this.connected = true;
        this.emit('connect');
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
            },
            removeItem(key) {
                storage.delete(key);
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
    const projectRoot = path.resolve(__dirname, '../..');
    vm.runInContext(fs.readFileSync(path.join(projectRoot, 'js', 'mqtt-config.js'), 'utf8'), context);
    vm.runInContext(fs.readFileSync(path.join(projectRoot, 'js', 'mqtt-database.js'), 'utf8'), context);
    return context.window.MqttDatabaseAdapter;
}

module.exports = { FakeBroker, FakeClient, createContext, loadAdapter };
