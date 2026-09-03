(function initializeMqttDatabase() {
    const TOPIC_PREFIX = 'avalon-multiplay/v3';
    const PROTOCOL_VERSION = 1;
    const INITIAL_STATE_WAIT_MS = 1200;
    const REQUEST_TIMEOUT_MS = 8000;
    const MAX_TRANSACTION_RETRIES = 6;

    function cloneValue(value) {
        if (value === undefined) return undefined;
        return JSON.parse(JSON.stringify(value));
    }

    function valuesEqual(left, right) {
        return JSON.stringify(left) === JSON.stringify(right);
    }

    function bytesToBase64(value) {
        const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
        let binary = '';
        for (const byte of bytes) binary += String.fromCharCode(byte);
        if (typeof btoa === 'function') return btoa(binary);
        return Buffer.from(bytes).toString('base64');
    }

    function base64ToBytes(value) {
        if (typeof atob === 'function') {
            const binary = atob(value);
            return Uint8Array.from(binary, (character) => character.charCodeAt(0));
        }
        return new Uint8Array(Buffer.from(value, 'base64'));
    }

    function textBytes(value) {
        if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(String(value));
        return new Uint8Array(Buffer.from(String(value), 'utf8'));
    }

    function bytesToText(value) {
        if (typeof TextDecoder !== 'undefined') return new TextDecoder().decode(value);
        return Buffer.from(value).toString('utf8');
    }

    function canonicalCommand(command) {
        return JSON.stringify({
            protocol: command.protocol,
            type: command.type,
            requestId: command.requestId,
            roomCode: command.roomCode,
            senderPlayerId: command.senderPlayerId,
            senderTransportId: command.senderTransportId,
            senderPublicSigningKey: command.senderPublicSigningKey || null,
            baseVersion: command.baseVersion,
            operation: command.operation || null,
            path: command.path || null,
            value: command.value === undefined ? null : command.value,
            action: command.action || null,
            payload: command.payload === undefined ? null : command.payload,
            at: command.at
        });
    }

    function createId(prefix = '') {
        const randomPart = typeof crypto !== 'undefined' && crypto.randomUUID
            ? crypto.randomUUID().replace(/-/g, '')
            : Math.random().toString(36).slice(2) + Date.now().toString(36);
        return prefix + randomPart;
    }

    function normalizePath(path) {
        return String(path || '')
            .split('/')
            .map((segment) => segment.trim())
            .filter(Boolean);
    }

    function getAtPath(root, segments) {
        let current = root;
        for (const segment of segments) {
            if (current === null || current === undefined || typeof current !== 'object') {
                return null;
            }
            current = current[segment];
        }
        return current === undefined ? null : current;
    }

    function setAtPath(root, segments, value) {
        if (segments.length === 0) {
            return value === null ? null : cloneValue(value);
        }

        const nextRoot = root && typeof root === 'object' ? cloneValue(root) : {};
        let current = nextRoot;

        for (let index = 0; index < segments.length - 1; index++) {
            const segment = segments[index];
            if (!current[segment] || typeof current[segment] !== 'object') {
                current[segment] = {};
            }
            current = current[segment];
        }

        const finalSegment = segments[segments.length - 1];
        if (value === null || value === undefined) {
            delete current[finalSegment];
        } else {
            current[finalSegment] = cloneValue(value);
        }

        return nextRoot;
    }

    function updateAtPath(root, segments, patch) {
        let nextRoot = root && typeof root === 'object' ? cloneValue(root) : {};
        for (const [key, value] of Object.entries(patch || {})) {
            nextRoot = setAtPath(nextRoot, [...segments, ...normalizePath(key)], value);
        }
        return nextRoot;
    }

    class MqttSnapshot {
        constructor(value) {
            this._value = cloneValue(value);
        }

        val() {
            return cloneValue(this._value);
        }

        exists() {
            return this._value !== null && this._value !== undefined;
        }
    }

    class MqttRoomRef {
        constructor(database, pathSegments) {
            this.database = database;
            this.pathSegments = pathSegments;
        }

        child(childPath) {
            return new MqttRoomRef(this.database, [...this.pathSegments, ...normalizePath(childPath)]);
        }

        set(value) {
            return this.database._set(this.pathSegments, value);
        }

        update(patch) {
            return this.database._update(this.pathSegments, patch);
        }

        transaction(updateFunction) {
            return this.database._transaction(this.pathSegments, updateFunction);
        }

        once(eventName) {
            if (eventName !== 'value') {
                return Promise.reject(new Error('MQTT adapter only supports value events'));
            }
            return this.database._once(this.pathSegments);
        }

        on(eventName, callback) {
            if (eventName !== 'value') {
                throw new Error('MQTT adapter only supports value events');
            }
            this.database._on(this.pathSegments, callback);
            return callback;
        }

        off(eventName, callback) {
            this.database._off(this.pathSegments, eventName, callback);
        }

        onDisconnect() {
            return {
                update: async () => undefined,
                cancel: async () => undefined
            };
        }
    }

    class MqttDatabaseAdapter {
        constructor() {
            this.client = null;
            this.roomCode = null;
            this.playerId = null;
            this.brokerUrl = null;
            this.transportId = null;
            this.envelope = null;
            this.initialStateKnown = false;
            this.initialStateWaiters = [];
            this.listeners = [];
            this.pendingRequests = new Map();
            this.processedRequests = new Map();
            this.connectionPromise = null;
            this.connectionGeneration = 0;
            this.initialStateTimer = null;
            this.cryptoIdentity = null;
            this.actionHandler = null;
            this.privateListeners = [];
            this.hostSecrets = null;
            this.commandQueue = Promise.resolve();
        }

        ref(path) {
            return new MqttRoomRef(this, normalizePath(path));
        }

        get connected() {
            return !!this.client?.connected;
        }

        async _ensureCryptoIdentity(playerId) {
            if (this.cryptoIdentity?.playerId === playerId) return this.cryptoIdentity;

            const storageKey = `avalon_crypto_${playerId}`;
            let stored = null;
            try {
                stored = JSON.parse(localStorage.getItem(storageKey) || 'null');
            } catch (error) {
                stored = null;
            }

            try {
                if (stored?.signPrivateKey && stored?.signPublicKey && stored?.decryptPrivateKey && stored?.encryptPublicKey) {
                    const signPrivateKey = await crypto.subtle.importKey(
                        'jwk', stored.signPrivateKey, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']
                    );
                    const signPublicKey = await crypto.subtle.importKey(
                        'jwk', stored.signPublicKey, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']
                    );
                    const decryptPrivateKey = await crypto.subtle.importKey(
                        'jwk', stored.decryptPrivateKey, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['decrypt']
                    );
                    const encryptPublicKey = await crypto.subtle.importKey(
                        'jwk', stored.encryptPublicKey, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']
                    );
                    this.cryptoIdentity = {
                        playerId,
                        signPrivateKey,
                        signPublicKey,
                        decryptPrivateKey,
                        encryptPublicKey,
                        signPublicJwk: stored.signPublicKey,
                        encryptPublicJwk: stored.encryptPublicKey
                    };
                    return this.cryptoIdentity;
                }
            } catch (error) {
                console.warn('[MQTT] Stored crypto identity was invalid; generating a new identity', error);
            }

            const signingKeys = await crypto.subtle.generateKey(
                { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']
            );
            const encryptionKeys = await crypto.subtle.generateKey(
                {
                    name: 'RSA-OAEP',
                    modulusLength: 2048,
                    publicExponent: new Uint8Array([1, 0, 1]),
                    hash: 'SHA-256'
                },
                true,
                ['encrypt', 'decrypt']
            );
            const exported = {
                signPrivateKey: await crypto.subtle.exportKey('jwk', signingKeys.privateKey),
                signPublicKey: await crypto.subtle.exportKey('jwk', signingKeys.publicKey),
                decryptPrivateKey: await crypto.subtle.exportKey('jwk', encryptionKeys.privateKey),
                encryptPublicKey: await crypto.subtle.exportKey('jwk', encryptionKeys.publicKey)
            };
            try {
                localStorage.setItem(storageKey, JSON.stringify(exported));
            } catch (error) {
                console.warn('[MQTT] Crypto identity could not be persisted', error);
            }

            this.cryptoIdentity = {
                playerId,
                signPrivateKey: signingKeys.privateKey,
                signPublicKey: signingKeys.publicKey,
                decryptPrivateKey: encryptionKeys.privateKey,
                encryptPublicKey: encryptionKeys.publicKey,
                signPublicJwk: exported.signPublicKey,
                encryptPublicJwk: exported.encryptPublicKey
            };
            return this.cryptoIdentity;
        }

        get publicSigningKey() {
            return cloneValue(this.cryptoIdentity?.signPublicJwk || null);
        }

        get publicEncryptionKey() {
            return cloneValue(this.cryptoIdentity?.encryptPublicJwk || null);
        }

        registerActionHandler(handler) {
            this.actionHandler = typeof handler === 'function' ? handler : null;
        }

        onPrivateMessage(callback) {
            if (typeof callback === 'function') this.privateListeners.push(callback);
            return callback;
        }

        setHostSecrets(secrets) {
            this.hostSecrets = cloneValue(secrets);
            this._persistHostSecrets();
        }

        getHostSecrets() {
            return cloneValue(this.hostSecrets);
        }

        _persistHostSecrets() {
            if (!this.roomCode || !this.playerId) return;
            const key = `avalon_host_secrets_${this.roomCode}_${this.playerId}`;
            try {
                if (this.hostSecrets) localStorage.setItem(key, JSON.stringify(this.hostSecrets));
                else localStorage.removeItem(key);
            } catch (error) {
                console.warn('[MQTT] Host secrets could not be persisted', error);
            }
        }

        _restoreHostSecrets() {
            const key = `avalon_host_secrets_${this.roomCode}_${this.playerId}`;
            try {
                this.hostSecrets = JSON.parse(localStorage.getItem(key) || 'null');
            } catch (error) {
                this.hostSecrets = null;
            }
        }

        async _signCommand(command) {
            const identity = await this._ensureCryptoIdentity(this.playerId);
            const signature = await crypto.subtle.sign(
                { name: 'ECDSA', hash: 'SHA-256' },
                identity.signPrivateKey,
                textBytes(canonicalCommand(command))
            );
            return bytesToBase64(signature);
        }

        async _verifyCommand(command, publicJwk) {
            if (!command?.signature || !publicJwk) return false;
            try {
                const publicKey = await crypto.subtle.importKey(
                    'jwk', publicJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']
                );
                return crypto.subtle.verify(
                    { name: 'ECDSA', hash: 'SHA-256' },
                    publicKey,
                    base64ToBytes(command.signature),
                    textBytes(canonicalCommand(command))
                );
            } catch (error) {
                return false;
            }
        }

        async _signValue(value) {
            const identity = await this._ensureCryptoIdentity(this.playerId);
            const signature = await crypto.subtle.sign(
                { name: 'ECDSA', hash: 'SHA-256' },
                identity.signPrivateKey,
                textBytes(JSON.stringify(value))
            );
            return bytesToBase64(signature);
        }

        async _verifyValue(value, signature, publicJwk) {
            if (!signature || !publicJwk) return false;
            try {
                const publicKey = await crypto.subtle.importKey(
                    'jwk', publicJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']
                );
                return crypto.subtle.verify(
                    { name: 'ECDSA', hash: 'SHA-256' },
                    publicKey,
                    base64ToBytes(signature),
                    textBytes(JSON.stringify(value))
                );
            } catch (error) {
                return false;
            }
        }

        async _sealForPublicKey(value, publicJwk) {
            const publicKey = await crypto.subtle.importKey(
                'jwk', publicJwk, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']
            );
            const aesKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']);
            const rawAesKey = await crypto.subtle.exportKey('raw', aesKey);
            const iv = crypto.getRandomValues(new Uint8Array(12));
            const ciphertext = await crypto.subtle.encrypt(
                { name: 'AES-GCM', iv }, aesKey, textBytes(JSON.stringify(value))
            );
            const wrappedKey = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, publicKey, rawAesKey);
            return {
                wrappedKey: bytesToBase64(wrappedKey),
                iv: bytesToBase64(iv),
                ciphertext: bytesToBase64(ciphertext)
            };
        }

        async _openSealedValue(sealed) {
            const identity = await this._ensureCryptoIdentity(this.playerId);
            const rawAesKey = await crypto.subtle.decrypt(
                { name: 'RSA-OAEP' }, identity.decryptPrivateKey, base64ToBytes(sealed.wrappedKey)
            );
            const aesKey = await crypto.subtle.importKey('raw', rawAesKey, { name: 'AES-GCM' }, false, ['decrypt']);
            const plaintext = await crypto.subtle.decrypt(
                { name: 'AES-GCM', iv: base64ToBytes(sealed.iv) },
                aesKey,
                base64ToBytes(sealed.ciphertext)
            );
            return JSON.parse(bytesToText(plaintext));
        }

        _topic(suffix) {
            return `${TOPIC_PREFIX}/rooms/${this.roomCode}/${suffix}`;
        }

        _emitStatus(state, message) {
            window.dispatchEvent(new CustomEvent('avalon-broker-status', {
                detail: {
                    state,
                    message,
                    brokerUrl: this.brokerUrl
                }
            }));
        }

        async connectForRoom(roomCode, playerId, brokerUrl = null) {
            const normalizedRoomCode = String(roomCode || '').trim().toUpperCase();
            const selectedBroker = brokerUrl || MQTTBrokerConfig.getSelectedBroker();

            if (!normalizedRoomCode || !playerId) {
                throw new Error('缺少房间号或玩家标识');
            }

            if (
                this.connected
                && this.roomCode === normalizedRoomCode
                && this.playerId === playerId
                && this.brokerUrl === selectedBroker
            ) {
                return;
            }

            await this.disconnectRoom();

            if (typeof mqtt === 'undefined' || typeof mqtt.connect !== 'function') {
                throw new Error('MQTT.js 加载失败，请检查网络后刷新页面');
            }

            this.roomCode = normalizedRoomCode;
            this.playerId = playerId;
            this.brokerUrl = selectedBroker;
            this.transportId = createId('av').slice(0, 22);
            this.envelope = null;
            this.initialStateKnown = false;
            await this._ensureCryptoIdentity(playerId);
            this._restoreHostSecrets();
            this.connectionGeneration += 1;
            const generation = this.connectionGeneration;

            const stateTopic = this._topic('state');
            const commandTopic = this._topic('commands');
            const responseTopic = this._topic(`responses/${this.transportId}`);
            const presenceTopic = this._topic('presence');
            const privateTopic = this._topic(`private/${this.playerId}`);
            const willBody = {
                protocol: PROTOCOL_VERSION,
                type: 'offline',
                roomCode: this.roomCode,
                playerId: this.playerId,
                transportId: this.transportId,
                at: Date.now()
            };
            const willPayload = JSON.stringify({
                ...willBody,
                signature: await this._signValue(willBody)
            });

            this._emitStatus('connecting', `正在连接 ${selectedBroker}`);

            this.connectionPromise = new Promise((resolve, reject) => {
                let settled = false;
                const timeoutId = setTimeout(() => {
                    if (settled || generation !== this.connectionGeneration) return;
                    settled = true;
                    reject(new Error(`连接联机服务器超时: ${selectedBroker}`));
                    this._emitStatus('error', '连接超时，请更换联机服务器');
                }, 10000);

                this.client = mqtt.connect(selectedBroker, {
                    clientId: this.transportId,
                    clean: true,
                    keepalive: 30,
                    connectTimeout: 8000,
                    reconnectPeriod: 2500,
                    protocolVersion: 4,
                    will: {
                        topic: presenceTopic,
                        payload: willPayload,
                        qos: 1,
                        retain: false
                    }
                });

                this.client.on('connect', () => {
                    if (generation !== this.connectionGeneration) return;
                    const topics = [stateTopic, commandTopic, responseTopic, presenceTopic, privateTopic];
                    this.client.subscribe(topics, { qos: 1 }, (error) => {
                        if (error) {
                            if (!settled) {
                                settled = true;
                                clearTimeout(timeoutId);
                                reject(error);
                            }
                            this._emitStatus('error', '订阅房间频道失败');
                            return;
                        }

                        this._announcePresence('online').catch(() => undefined);

                        clearTimeout(this.initialStateTimer);
                        this.initialStateTimer = setTimeout(() => {
                            if (generation === this.connectionGeneration) {
                                this._markInitialStateKnown();
                            }
                        }, INITIAL_STATE_WAIT_MS);
                        this._emitStatus('connected', `已连接 ${selectedBroker}`);

                        if (!settled) {
                            settled = true;
                            clearTimeout(timeoutId);
                            resolve();
                        }
                    });
                });

                this.client.on('message', (topic, payload) => {
                    if (generation !== this.connectionGeneration) return;
                    this._handleMessage(topic, payload).catch((error) => {
                        console.warn('[MQTT] Message handling failed', error);
                    });
                });

                this.client.on('reconnect', () => {
                    if (generation !== this.connectionGeneration) return;
                    this._emitStatus('connecting', '联机服务器断开，正在重连');
                });

                this.client.on('offline', () => {
                    if (generation !== this.connectionGeneration) return;
                    this._emitStatus('offline', '联机服务器已断开');
                });

                this.client.on('error', (error) => {
                    if (generation !== this.connectionGeneration) return;
                    console.warn('[MQTT] Connection error', error);
                    this._emitStatus('error', '联机服务器连接失败，可尝试其他节点');
                });
            });

            try {
                await this.connectionPromise;
            } catch (error) {
                await this.disconnectRoom();
                throw error;
            }
        }

        async disconnectRoom() {
            this.connectionGeneration += 1;
            clearTimeout(this.initialStateTimer);
            this.initialStateTimer = null;
            const client = this.client;
            this.client = null;
            this.connectionPromise = null;

            for (const { reject, timeoutId } of this.pendingRequests.values()) {
                clearTimeout(timeoutId);
                reject(new Error('联机连接已关闭'));
            }
            this.pendingRequests.clear();
            this.processedRequests.clear();

            const stateWaiters = this.initialStateWaiters.splice(0);
            stateWaiters.forEach(({ reject }) => reject(new Error('联机连接已关闭')));

            if (client) {
                await new Promise((resolve) => {
                    try {
                        client.end(true, {}, resolve);
                        setTimeout(resolve, 300);
                    } catch (error) {
                        resolve();
                    }
                });
            }

            this.roomCode = null;
            this.playerId = null;
            this.brokerUrl = null;
            this.transportId = null;
            this.envelope = null;
            this.initialStateKnown = false;
            this.listeners = [];
            this._emitStatus('idle', '已断开联机服务器');
        }

        _markInitialStateKnown() {
            if (this.initialStateKnown) return;
            clearTimeout(this.initialStateTimer);
            this.initialStateTimer = null;
            this.initialStateKnown = true;
            const waiters = this.initialStateWaiters.splice(0);
            waiters.forEach(({ resolve }) => resolve());
            this._notifyListeners();
        }

        _waitForInitialState() {
            if (this.initialStateKnown) return Promise.resolve();
            return new Promise((resolve, reject) => this.initialStateWaiters.push({ resolve, reject }));
        }

        _roomRelativePath(pathSegments) {
            if (pathSegments[0] !== 'rooms' || pathSegments[1] !== this.roomCode) {
                throw new Error(`当前 MQTT 连接不支持路径: ${pathSegments.join('/')}`);
            }
            return pathSegments.slice(2);
        }

        _getValue(pathSegments) {
            const relativePath = this._roomRelativePath(pathSegments);
            return getAtPath(this.envelope?.room ?? null, relativePath);
        }

        async _once(pathSegments) {
            await this._waitForInitialState();
            return new MqttSnapshot(this._getValue(pathSegments));
        }

        _on(pathSegments, callback) {
            const listener = {
                pathSegments: [...pathSegments],
                callback,
                initialized: false,
                lastValue: undefined
            };
            this.listeners.push(listener);
            if (this.initialStateKnown) {
                queueMicrotask(() => {
                    const value = this._getValue(pathSegments);
                    listener.initialized = true;
                    listener.lastValue = cloneValue(value);
                    callback(new MqttSnapshot(value));
                });
            }
        }

        _off(pathSegments, eventName = null, callback = null) {
            const pathKey = pathSegments.join('/');
            this.listeners = this.listeners.filter((listener) => {
                const listenerKey = listener.pathSegments.join('/');
                const sameTree = listenerKey === pathKey || listenerKey.startsWith(pathKey + '/');
                if (!sameTree) return true;
                if (callback && listener.callback !== callback) return true;
                return false;
            });
        }

        _notifyListeners() {
            if (!this.initialStateKnown) return;
            for (const listener of [...this.listeners]) {
                try {
                    const value = this._getValue(listener.pathSegments);
                    if (listener.initialized && valuesEqual(listener.lastValue, value)) continue;
                    listener.initialized = true;
                    listener.lastValue = cloneValue(value);
                    listener.callback(new MqttSnapshot(value));
                } catch (error) {
                    console.warn('[MQTT] Listener failed', error);
                }
            }
        }

        async _set(pathSegments, value) {
            await this._waitForInitialState();
            const relativePath = this._roomRelativePath(pathSegments);

            if (relativePath.length === 0 && !this.envelope?.room && value !== null) {
                const envelope = {
                    protocol: PROTOCOL_VERSION,
                    version: 1,
                    updatedAt: Date.now(),
                    room: cloneValue(value)
                };
                this._acceptEnvelope(envelope);
                await this._publishState(envelope);
                return;
            }

            await this._sendMutationWithRetry('set', relativePath, value);
        }

        async _update(pathSegments, patch) {
            await this._waitForInitialState();
            const relativePath = this._roomRelativePath(pathSegments);
            await this._sendMutationWithRetry('update', relativePath, patch);
        }

        async _transaction(pathSegments, updateFunction) {
            await this._waitForInitialState();
            const relativePath = this._roomRelativePath(pathSegments);

            for (let attempt = 0; attempt < MAX_TRANSACTION_RETRIES; attempt++) {
                const currentValue = getAtPath(this.envelope?.room ?? null, relativePath);
                const nextValue = updateFunction(cloneValue(currentValue));

                if (nextValue === undefined) {
                    return {
                        committed: false,
                        snapshot: new MqttSnapshot(currentValue)
                    };
                }

                if (valuesEqual(nextValue, currentValue)) {
                    return {
                        committed: true,
                        snapshot: new MqttSnapshot(currentValue)
                    };
                }

                const response = await this._requestMutation({
                    operation: 'set',
                    path: relativePath,
                    value: nextValue,
                    baseVersion: this.envelope?.version || 0
                });

                if (response.envelope) this._acceptEnvelope(response.envelope);
                if (response.ok) {
                    return {
                        committed: true,
                        snapshot: new MqttSnapshot(getAtPath(this.envelope?.room ?? null, relativePath))
                    };
                }
                if (!response.conflict) {
                    throw new Error(response.error || '联机事务失败');
                }
            }

            throw new Error('联机操作冲突过多，请重试');
        }

        async _sendMutationWithRetry(operation, path, value) {
            for (let attempt = 0; attempt < MAX_TRANSACTION_RETRIES; attempt++) {
                const response = await this._requestMutation({
                    operation,
                    path,
                    value,
                    baseVersion: this.envelope?.version || 0
                });

                if (response.envelope) this._acceptEnvelope(response.envelope);
                if (response.ok) return;
                if (!response.conflict) {
                    throw new Error(response.error || '联机写入失败');
                }
            }
            throw new Error('联机写入冲突过多，请重试');
        }

        async _requestMutation({ operation, path, value, baseVersion }) {
            if (!this.connected) {
                throw new Error('未连接联机服务器');
            }

            const requestId = createId('req_');
            const command = {
                protocol: PROTOCOL_VERSION,
                type: 'mutation',
                requestId,
                roomCode: this.roomCode,
                senderPlayerId: this.playerId,
                senderTransportId: this.transportId,
                senderPublicSigningKey: this.publicSigningKey,
                replyTopic: this._topic(`responses/${this.transportId}`),
                baseVersion,
                operation,
                path,
                value: cloneValue(value),
                at: Date.now()
            };
            command.signature = await this._signCommand(command);

            return new Promise((resolve, reject) => {
                const timeoutId = setTimeout(() => {
                    this.pendingRequests.delete(requestId);
                    reject(new Error('等待房主响应超时'));
                }, REQUEST_TIMEOUT_MS);

                this.pendingRequests.set(requestId, { resolve, reject, timeoutId });
                this._publishRaw(this._topic('commands'), JSON.stringify(command), { qos: 1, retain: false })
                    .catch((error) => {
                        clearTimeout(timeoutId);
                        this.pendingRequests.delete(requestId);
                        reject(error);
                    });
            });
        }

        async sendAction(action, payload = {}, options = {}) {
            if (!this.connected) throw new Error('未连接联机服务器');

            let actionPayload = cloneValue(payload);
            if (options.sealToHost) {
                const room = this.envelope?.room;
                const hostId = room?.host;
                const hostEncryptionKey = room?.players?.[hostId]?.encryptionPublicKey;
                if (!hostEncryptionKey) throw new Error('房主安全通道尚未就绪');
                actionPayload = {
                    sealed: await this._sealForPublicKey(actionPayload, hostEncryptionKey)
                };
            }

            for (let attempt = 0; attempt < MAX_TRANSACTION_RETRIES; attempt++) {
                const response = await this._requestAction(
                    action,
                    actionPayload,
                    this.envelope?.version || 0
                );

                if (response.envelope) this._acceptEnvelope(response.envelope);
                if (response.ok) return response;
                if (!response.conflict) {
                    throw new Error(response.error || '联机动作失败');
                }
            }

            throw new Error('联机动作冲突过多，请重试');
        }

        async _requestAction(action, actionPayload, baseVersion) {
            const requestId = createId('act_');
            const command = {
                protocol: PROTOCOL_VERSION,
                type: 'action',
                requestId,
                roomCode: this.roomCode,
                senderPlayerId: this.playerId,
                senderTransportId: this.transportId,
                senderPublicSigningKey: this.publicSigningKey,
                replyTopic: this._topic(`responses/${this.transportId}`),
                baseVersion,
                action,
                payload: actionPayload,
                at: Date.now()
            };
            command.signature = await this._signCommand(command);

            return new Promise((resolve, reject) => {
                const timeoutId = setTimeout(() => {
                    this.pendingRequests.delete(requestId);
                    reject(new Error('等待房主响应超时'));
                }, REQUEST_TIMEOUT_MS);

                this.pendingRequests.set(requestId, { resolve, reject, timeoutId });
                this._publishRaw(this._topic('commands'), JSON.stringify(command), { qos: 1, retain: false })
                    .catch((error) => {
                        clearTimeout(timeoutId);
                        this.pendingRequests.delete(requestId);
                        reject(error);
                    });
            });
        }

        async publishPrivate(playerId, value, options = {}) {
            const publicKey = this.envelope?.room?.players?.[playerId]?.encryptionPublicKey;
            if (!publicKey) throw new Error('目标玩家的安全通道尚未就绪');
            const sealed = await this._sealForPublicKey(value, publicKey);
            await this._publishRaw(
                this._topic(`private/${playerId}`),
                JSON.stringify({ protocol: PROTOCOL_VERSION, playerId, sealed }),
                { qos: 1, retain: options.retain !== false }
            );
        }

        async clearPrivate(playerId) {
            await this._publishRaw(this._topic(`private/${playerId}`), '', { qos: 1, retain: true });
        }

        async _handleMessage(topic, payload) {
            if (topic === this._topic('state')) {
                if (!payload || payload.length === 0) {
                    if (this.envelope?.room) return;
                    this.envelope = null;
                    this._markInitialStateKnown();
                    this._notifyListeners();
                    return;
                }

                const envelope = JSON.parse(payload.toString());
                if (envelope.stateSignature && envelope.signerPlayerId) {
                    const previousRoom = this.envelope?.room;
                    const signerId = envelope.signerPlayerId;
                    const signerKey = previousRoom?.players?.[signerId]?.authPublicKey
                        || envelope.room?.players?.[signerId]?.authPublicKey;
                    if (!signerKey) return;
                    const stateBody = {
                        protocol: envelope.protocol,
                        version: envelope.version,
                        updatedAt: envelope.updatedAt,
                        room: envelope.room,
                        signerPlayerId: signerId
                    };
                    if (!await this._verifyValue(stateBody, envelope.stateSignature, signerKey)) return;

                    if (!previousRoom && envelope.room && envelope.room.host !== signerId) return;

                    if (previousRoom && signerId !== previousRoom.host) {
                        const expectedSuccessor = this._getNextHostId(previousRoom, previousRoom.host);
                        const validHandoff = envelope.room?.host === signerId
                            && expectedSuccessor === signerId
                            && envelope.room?.players?.[previousRoom.host]?.connected === false;
                        if (!validHandoff) return;
                    }
                } else {
                    return;
                }
                this._acceptEnvelope(envelope);
                this._markInitialStateKnown();
                return;
            }

            if (topic === this._topic('commands')) {
                const command = JSON.parse(payload.toString());
                const commandTask = this.commandQueue.then(() => this._handleCommand(command));
                this.commandQueue = commandTask.catch((error) => {
                    console.warn('[MQTT] Command handling failed', error);
                });
                await commandTask;
                return;
            }

            if (topic === this._topic(`responses/${this.transportId}`)) {
                const response = JSON.parse(payload.toString());
                const pending = this.pendingRequests.get(response.requestId);
                if (!pending) return;
                clearTimeout(pending.timeoutId);
                this.pendingRequests.delete(response.requestId);
                pending.resolve(response);
                return;
            }

            if (topic === this._topic(`private/${this.playerId}`)) {
                if (!payload || payload.length === 0) return;
                const message = JSON.parse(payload.toString());
                if (message.protocol !== PROTOCOL_VERSION || message.playerId !== this.playerId || !message.sealed) return;
                const value = await this._openSealedValue(message.sealed);
                for (const listener of [...this.privateListeners]) {
                    try {
                        listener(cloneValue(value));
                    } catch (error) {
                        console.warn('[MQTT] Private message listener failed', error);
                    }
                }
                return;
            }

            if (topic === this._topic('presence')) {
                const presence = JSON.parse(payload.toString());
                const presenceTask = this.commandQueue.then(() => this._handlePresence(presence));
                this.commandQueue = presenceTask.catch((error) => {
                    console.warn('[MQTT] Presence handling failed', error);
                });
                await presenceTask;
            }
        }

        _acceptEnvelope(envelope) {
            if (!envelope || envelope.protocol !== PROTOCOL_VERSION) return;
            if (this.envelope && envelope.version < this.envelope.version) return;
            this.envelope = cloneValue(envelope);
            this._notifyListeners();
        }

        _isMutationAuthorized(command, room, nextRoom) {
            const senderId = command.senderPlayerId;
            const sender = room.players?.[senderId];
            const path = Array.isArray(command.path) ? command.path : [];

            if (senderId === room.host) return true;

            if (!sender) {
                if (room.state !== 'waiting' || path.length !== 0 || command.operation !== 'set') return false;
                const proposedPlayer = nextRoom?.players?.[senderId];
                if (!proposedPlayer || !valuesEqual(proposedPlayer.authPublicKey, command.senderPublicSigningKey)) return false;
                const withoutNewPlayer = cloneValue(nextRoom);
                delete withoutNewPlayer.players[senderId];
                return valuesEqual(withoutNewPlayer, room);
            }

            if (path[0] === 'players' && path[1] === senderId) {
                const allowedFields = new Set(['isReady', 'connected', 'disconnectedAt', 'lastSeen', 'transportId', 'left']);
                if (path.length >= 3) return allowedFields.has(path[2]);
                const previous = room.players[senderId] || {};
                const next = nextRoom?.players?.[senderId] || {};
                return Object.keys({ ...previous, ...next }).every((key) => (
                    allowedFields.has(key) || valuesEqual(previous[key], next[key])
                ));
            }

            if (path.length === 0 && command.operation === 'set' && !nextRoom?.players?.[senderId]) {
                const expected = cloneValue(room);
                delete expected.players[senderId];
                if (expected.game) {
                    if (expected.game.roles) delete expected.game.roles[senderId];
                    expected.game.playerOrder = (expected.game.playerOrder || []).filter((playerId) => playerId !== senderId);
                    expected.game.selectedTeam = (expected.game.selectedTeam || []).filter((playerId) => playerId !== senderId);
                    expected.game.exiledPlayers = (expected.game.exiledPlayers || []).filter((playerId) => playerId !== senderId);
                }
                return valuesEqual(expected, nextRoom);
            }

            return false;
        }

        async _handleCommand(command) {
            if (
                !command
                || command.protocol !== PROTOCOL_VERSION
                || !['mutation', 'action'].includes(command.type)
                || command.roomCode !== this.roomCode
                || !command.replyTopic
            ) {
                return;
            }

            const cachedResponse = this.processedRequests.get(command.requestId);
            if (cachedResponse) {
                await this._publishRaw(command.replyTopic, JSON.stringify(cachedResponse), { qos: 1, retain: false });
                return;
            }

            const room = this.envelope?.room;
            if (!room || room.host !== this.playerId) return;

            let verificationKey = room.players?.[command.senderPlayerId]?.authPublicKey;
            if (!verificationKey && command.type === 'mutation' && Array.isArray(command.path) && command.path.length === 0) {
                verificationKey = command.value?.players?.[command.senderPlayerId]?.authPublicKey;
            }
            if (!verificationKey || !valuesEqual(verificationKey, command.senderPublicSigningKey)) return;
            if (!await this._verifyCommand(command, verificationKey)) return;

            let response;
            if ((this.envelope?.version || 0) !== command.baseVersion) {
                response = {
                    protocol: PROTOCOL_VERSION,
                    requestId: command.requestId,
                    ok: false,
                    conflict: true,
                    envelope: cloneValue(this.envelope)
                };
            } else {
                try {
                    const currentRoom = cloneValue(room);
                    let nextRoom;
                    let privateMessages = [];
                    let result = null;

                    if (command.type === 'action') {
                        if (!this.actionHandler) throw new Error('房主尚未加载游戏动作处理器');
                        let actionPayload = cloneValue(command.payload || {});
                        if (actionPayload.sealed) actionPayload = await this._openSealedValue(actionPayload.sealed);
                        const actionResult = await this.actionHandler({
                            action: command.action,
                            payload: actionPayload,
                            senderPlayerId: command.senderPlayerId,
                            room: cloneValue(currentRoom)
                        });
                        nextRoom = actionResult?.room;
                        privateMessages = actionResult?.privateMessages || [];
                        result = actionResult?.result || null;
                        if (!nextRoom) throw new Error(actionResult?.error || '动作未获允许');
                    } else {
                        nextRoom = command.operation === 'update'
                            ? updateAtPath(currentRoom, command.path || [], command.value || {})
                            : setAtPath(currentRoom, command.path || [], command.value);
                        if (!this._isMutationAuthorized(command, room, nextRoom)) {
                            throw new Error('没有权限修改该房间状态');
                        }
                    }

                    const nextEnvelope = valuesEqual(currentRoom, nextRoom)
                        ? cloneValue(this.envelope)
                        : {
                            protocol: PROTOCOL_VERSION,
                            version: (this.envelope?.version || 0) + 1,
                            updatedAt: Date.now(),
                            room: nextRoom
                        };

                    if (!valuesEqual(currentRoom, nextRoom)) {
                        this._acceptEnvelope(nextEnvelope);
                        await this._publishState(nextEnvelope);
                    }
                    for (const message of privateMessages) {
                        await this.publishPrivate(message.playerId, message.value, { retain: message.retain !== false });
                    }
                    response = {
                        protocol: PROTOCOL_VERSION,
                        requestId: command.requestId,
                        ok: true,
                        conflict: false,
                        envelope: cloneValue(nextEnvelope),
                        result
                    };
                } catch (error) {
                    response = {
                        protocol: PROTOCOL_VERSION,
                        requestId: command.requestId,
                        ok: false,
                        conflict: false,
                        error: error.message || String(error),
                        envelope: cloneValue(this.envelope)
                    };
                }
            }

            this.processedRequests.set(command.requestId, response);
            if (this.processedRequests.size > 100) {
                const oldestKey = this.processedRequests.keys().next().value;
                this.processedRequests.delete(oldestKey);
            }
            await this._publishRaw(command.replyTopic, JSON.stringify(response), { qos: 1, retain: false });
        }

        _getNextHostId(room, excludedPlayerId) {
            const players = room?.players || {};
            const gameOrder = Array.isArray(room?.game?.playerOrder) ? room.game.playerOrder : [];
            const ordered = [...gameOrder];
            const remaining = Object.keys(players)
                .filter((playerId) => !ordered.includes(playerId))
                .sort((a, b) => (players[a]?.joinedAt || 0) - (players[b]?.joinedAt || 0));

            return [...ordered, ...remaining].find((playerId) => {
                const player = players[playerId];
                return player
                    && playerId !== excludedPlayerId
                    && !player.left
                    && player.connected !== false;
            }) || null;
        }

        async _handlePresence(presence) {
            if (
                !presence
                || presence.protocol !== PROTOCOL_VERSION
                || presence.roomCode !== this.roomCode
                || !presence.playerId
                || !this.envelope?.room?.players?.[presence.playerId]
            ) {
                return;
            }

            const room = this.envelope.room;
            const currentPlayer = room.players[presence.playerId];
            const { signature, ...presenceBody } = presence;
            if (!await this._verifyValue(presenceBody, signature, currentPlayer.authPublicKey)) return;
            if (
                presence.type === 'offline'
                && currentPlayer.transportId
                && currentPlayer.transportId !== presence.transportId
            ) {
                return;
            }

            const isCurrentHost = room.host === this.playerId;
            const nextHostId = presence.type === 'offline' && room.host === presence.playerId
                ? this._getNextHostId(room, presence.playerId)
                : null;
            const isHostSuccessor = nextHostId === this.playerId;

            if (!isCurrentHost && !isHostSuccessor) return;

            const nextRoom = cloneValue(room);
            const player = nextRoom.players[presence.playerId];
            player.connected = presence.type !== 'offline';
            if (presence.type === 'online') {
                player.transportId = presence.transportId;
            }
            player.disconnectedAt = presence.type === 'offline' ? Date.now() : null;
            player.lastSeen = Date.now();

            if (isHostSuccessor) {
                nextRoom.host = this.playerId;
                for (const [playerId, entry] of Object.entries(nextRoom.players || {})) {
                    entry.isHost = playerId === this.playerId;
                }
            }

            const nextEnvelope = {
                protocol: PROTOCOL_VERSION,
                version: (this.envelope.version || 0) + 1,
                updatedAt: Date.now(),
                room: nextRoom
            };
            this._acceptEnvelope(nextEnvelope);
            await this._publishState(nextEnvelope);
        }

        async _announcePresence(type) {
            const body = {
                protocol: PROTOCOL_VERSION,
                type,
                roomCode: this.roomCode,
                playerId: this.playerId,
                transportId: this.transportId,
                at: Date.now()
            };
            return this._publishRaw(this._topic('presence'), JSON.stringify({
                ...body,
                signature: await this._signValue(body)
            }), { qos: 1, retain: false });
        }

        async _publishState(envelope) {
            const stateBody = {
                protocol: envelope.protocol,
                version: envelope.version,
                updatedAt: envelope.updatedAt,
                room: envelope.room,
                signerPlayerId: this.playerId
            };
            const signedEnvelope = {
                ...envelope,
                signerPlayerId: this.playerId,
                stateSignature: await this._signValue(stateBody)
            };
            await this._publishRaw(this._topic('state'), JSON.stringify(signedEnvelope), { qos: 1, retain: true });
        }

        _publishRaw(topic, payload, options) {
            return new Promise((resolve, reject) => {
                if (!this.client?.connected) {
                    reject(new Error('未连接联机服务器'));
                    return;
                }
                this.client.publish(topic, payload, options, (error) => {
                    if (error) reject(error);
                    else resolve();
                });
            });
        }
    }

    window.MqttDatabaseAdapter = MqttDatabaseAdapter;
    window.MqttSnapshot = MqttSnapshot;
    window.database = new MqttDatabaseAdapter();
})();
