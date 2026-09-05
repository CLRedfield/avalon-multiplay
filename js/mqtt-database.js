(function initializeMqttDatabase() {
    const TOPIC_PREFIX = 'avalon-multiplay/v5';
    const PROTOCOL_VERSION = 3;
    const INITIAL_STATE_WAIT_MS = 1200;
    const REQUEST_TIMEOUT_MS = 75000;
    const HEARTBEAT_MS = 5000;
    const PEER_TIMEOUT_MS = 20000;
    const PLAYER_GRACE_MS = 15000;
    const HOST_GRACE_MS = 60000;
    // A full room can submit ten votes/readiness updates against the same version.
    const MAX_TRANSACTION_RETRIES = 16;

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
            context: command.context || null,
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
            this.messageQueue = Promise.resolve();
            this.peers = new Map();
            this.offlineTimers = new Map();
            this.heartbeatTimer = null;
            this.syncPromise = null;
            this.ready = false;
            this.lastPublishedVersion = null;
            this.lastEchoAt = 0;
            this.connectionStatus = { state: 'idle' };
            this.retryDelayMs = 800;
            this.requestTimeoutMs = REQUEST_TIMEOUT_MS;
            this.playerGraceMs = PLAYER_GRACE_MS;
            this.hostGraceMs = HOST_GRACE_MS;
            this.wakeHandler = () => {
                if (this.ready && this.connected && Date.now() - this.lastEchoAt < HEARTBEAT_MS * 2) {
                    this._announcePresence('heartbeat').catch(() => undefined);
                } else this.reconnectNow();
            };
            this.visibilityHandler = () => {
                if (typeof document !== 'undefined' && document.visibilityState === 'visible') this.wakeHandler();
            };
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
            const key = `avalon_host_secrets_v5_${this.brokerUrl}_${this.roomCode}_${this.playerId}`;
            try {
                if (this.hostSecrets) localStorage.setItem(key, JSON.stringify(this.hostSecrets));
                else localStorage.removeItem(key);
            } catch (error) {
                console.warn('[MQTT] Host secrets could not be persisted', error);
            }
        }

        _restoreHostSecrets() {
            const key = `avalon_host_secrets_v5_${this.brokerUrl}_${this.roomCode}_${this.playerId}`;
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
            this.connectionStatus = { state, message, brokerUrl: this.brokerUrl };
            window.dispatchEvent(new CustomEvent('avalon-broker-status', {
                detail: this.connectionStatus
            }));
        }

        _checkpointKey() {
            return `avalon_checkpoint_v5_${this.brokerUrl}_${this.roomCode}_${this.playerId}`;
        }

        _persistCheckpoint() {
            if (!this.roomCode || !this.envelope) return;
            try {
                // One atomic write keeps the public state, secret cards and receipts together.
                localStorage.setItem(this._checkpointKey(), JSON.stringify({
                    envelope: this.envelope,
                    secrets: this.envelope.room?.host === this.playerId ? this.hostSecrets : null,
                    receipts: [...this.processedRequests.entries()]
                }));
            } catch (error) {
                console.warn('[MQTT] Recovery checkpoint unavailable', error);
            }
        }

        _restoreCheckpoint() {
            try {
                const saved = JSON.parse(localStorage.getItem(this._checkpointKey()) || 'null');
                if (!saved?.envelope || saved.envelope.protocol !== PROTOCOL_VERSION || saved.envelope.room?.code !== this.roomCode) return;
                this.envelope = saved.envelope;
                this.processedRequests = new Map(saved.receipts || []);
                if (saved.envelope.room.host === this.playerId) this.hostSecrets = saved.secrets;
            } catch (error) {
                console.warn('[MQTT] Recovery checkpoint could not be read', error);
            }
        }

        reconnectNow() {
            if (!this.client) return;
            if (!this.connected) this.client.reconnect?.();
            else this._synchronize().catch(() => undefined);
        }

        async _acquireSessionLock() {
            if (typeof navigator === 'undefined' || !navigator.locks?.request) return;
            const name = `avalon-session-${this.brokerUrl}-${this.roomCode}-${this.playerId}`;
            await new Promise((resolve, reject) => {
                navigator.locks.request(name, { ifAvailable: true }, async (lock) => {
                    if (!lock) {
                        reject(new Error('此玩家已在另一个标签页连接；请回到原页面，或关闭原页面后刷新'));
                        return;
                    }
                    await new Promise((release) => {
                        this.releaseSessionLock = release;
                        resolve();
                    });
                }).catch(reject);
            });
        }

        async _synchronize() {
            if (this.syncPromise) return this.syncPromise;
            const generation = this.connectionGeneration;
            this.ready = false;
            this._emitStatus('syncing', '正在恢复房间状态…');
            this.syncPromise = (async () => {
                await this._waitForInitialState();
                if (generation !== this.connectionGeneration || !this.connected) return;
                if (this.envelope?.room?.host === this.playerId) {
                    // Republish the durable checkpoint after broker data loss or a refresh.
                    await this._publishState(this.envelope);
                }
                if (this.envelope?.room?.players?.[this.playerId]) {
                    const response = await this._requestAction('sync', {}, this.envelope.version);
                    if (!response.ok) throw new Error(response.error || '恢复房间失败');
                    if (response.envelope) this._acceptEnvelope(response.envelope);
                }
                if (generation !== this.connectionGeneration || !this.connected) return;
                this.ready = true;
                this._emitStatus('connected', '已连接 · 状态已同步');
                window.dispatchEvent(new CustomEvent('avalon-room-resumed'));
            })().finally(() => {
                if (generation === this.connectionGeneration) this.syncPromise = null;
            });
            return this.syncPromise;
        }

        _startHeartbeat() {
            clearTimeout(this.heartbeatTimer);
            const generation = this.connectionGeneration;
            const tick = async () => {
                if (generation !== this.connectionGeneration || !this.connected) return;
                try {
                    await this._announcePresence('heartbeat');
                    const now = Date.now();
                    // A broken local socket must never elect this client as a new host.
                    if (now - this.lastEchoAt > PEER_TIMEOUT_MS) {
                        this.ready = false;
                        this._emitStatus('offline', '连接无响应，正在重新连接…');
                        this.client.reconnect?.();
                    } else {
                        for (const [id, player] of Object.entries(this.envelope?.room?.players || {})) {
                            const peer = this.peers.get(id);
                            if (id !== this.playerId && !player.left && player.connected !== false
                                && now - (peer?.seenAt || this.connectedAt) > PEER_TIMEOUT_MS) {
                                this._scheduleOffline(id, player.transportId);
                            }
                        }
                    }
                } catch (error) {
                    // MQTT's reconnect loop owns transport recovery.
                }
                if (generation === this.connectionGeneration && this.connected) {
                    this.heartbeatTimer = setTimeout(tick, HEARTBEAT_MS);
                }
            };
            this.heartbeatTimer = setTimeout(tick, HEARTBEAT_MS);
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
            this._restoreCheckpoint();
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

            await this._acquireSessionLock();
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
                    keepalive: 10,
                    connectTimeout: 8000,
                    reconnectPeriod: 750,
                    resubscribe: false,
                    queueQoSZero: false,
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
                    this.connectedAt = Date.now();
                    this.lastEchoAt = Date.now();
                    this.ready = false;
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

                        clearTimeout(this.initialStateTimer);
                        this.initialStateTimer = setTimeout(() => {
                            if (generation === this.connectionGeneration) {
                                this._markInitialStateKnown();
                            }
                        }, INITIAL_STATE_WAIT_MS);
                        this._announcePresence('online').catch(() => undefined);
                        this._startHeartbeat();
                        this._synchronize().catch((error) => {
                            this._emitStatus('error', error.message || '同步失败，请重试连接');
                        });

                        if (!settled) {
                            settled = true;
                            clearTimeout(timeoutId);
                            resolve();
                        }
                    });
                });

                this.client.on('message', (topic, payload) => {
                    if (generation !== this.connectionGeneration) return;
                    // Liveness must not wait behind state publication acknowledgments.
                    if (topic === presenceTopic) {
                        Promise.resolve().then(() => this._handlePresence(JSON.parse(payload.toString())))
                            .catch((error) => console.warn('[MQTT] Presence handling failed', error));
                        return;
                    }
                    this.messageQueue = this.messageQueue.then(() => {
                        if (generation === this.connectionGeneration) return this._handleMessage(topic, payload);
                    }).catch((error) => {
                        console.warn('[MQTT] Message handling failed', error);
                    });
                });

                this.client.on('reconnect', () => {
                    if (generation !== this.connectionGeneration) return;
                    this._emitStatus('connecting', '联机服务器断开，正在重连');
                });

                this.client.on('offline', () => {
                    if (generation !== this.connectionGeneration) return;
                    this.ready = false;
                    clearTimeout(this.heartbeatTimer);
                    this._clearOfflineTimers();
                    this._emitStatus('offline', '联机服务器已断开');
                });

                this.client.on('close', () => {
                    if (generation !== this.connectionGeneration) return;
                    this.ready = false;
                    clearTimeout(this.heartbeatTimer);
                    this._clearOfflineTimers();
                    this._emitStatus('offline', '连接已断开，正在自动重连…');
                });

                this.client.on('error', (error) => {
                    if (generation !== this.connectionGeneration) return;
                    console.warn('[MQTT] Connection error', error);
                    this._emitStatus('error', '联机服务器连接失败，可尝试其他节点');
                });
            });

            try {
                await this.connectionPromise;
                await this.syncPromise;
                window.addEventListener?.('online', this.wakeHandler);
                window.addEventListener?.('pageshow', this.wakeHandler);
                if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.visibilityHandler);
            } catch (error) {
                await this.disconnectRoom();
                throw error;
            }
        }

        async disconnectRoom() {
            this.connectionGeneration += 1;
            this.ready = false;
            this.lastPublishedVersion = null;
            this.releaseSessionLock?.();
            this.releaseSessionLock = null;
            this.syncPromise = null;
            clearTimeout(this.heartbeatTimer);
            this._clearOfflineTimers();
            this.peers.clear();
            window.removeEventListener?.('online', this.wakeHandler);
            window.removeEventListener?.('pageshow', this.wakeHandler);
            if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.visibilityHandler);
            clearTimeout(this.initialStateTimer);
            this.initialStateTimer = null;
            const client = this.client;
            this.client = null;
            this.connectionPromise = null;

            for (const { reject, timeoutId, retryId } of this.pendingRequests.values()) {
                clearTimeout(timeoutId);
                clearTimeout(retryId);
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
            if (!this.ready) throw new Error('正在恢复连接，请等待状态同步后重试');

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
            return this._sendRequest(command);
        }

        async sendAction(action, payload = {}, options = {}) {
            if (!this.connected) throw new Error('未连接联机服务器');
            if (!this.ready) throw new Error('正在恢复连接，请等待状态同步后重试');

            const game = this.envelope?.room?.game;
            const context = game?.gameId ? {
                gameId: game.gameId, phase: game.phase,
                currentMission: game.currentMission, selectionRevision: game.selectionRevision || 0
            } : null;

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
                    this.envelope?.version || 0,
                    context
                );

                if (response.envelope) this._acceptEnvelope(response.envelope);
                if (response.ok) return response;
                if (!response.conflict) {
                    throw new Error(response.error || '联机动作失败');
                }
            }

            throw new Error('联机动作冲突过多，请重试');
        }

        async _requestAction(action, actionPayload, baseVersion, context = null) {
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
                context,
                at: Date.now()
            };
            command.signature = await this._signCommand(command);
            return this._sendRequest(command);
        }

        _sendRequest(command) {
            const generation = this.connectionGeneration;
            return new Promise((resolve, reject) => {
                const requestId = command.requestId;
                const timeoutId = setTimeout(() => {
                    clearTimeout(this.pendingRequests.get(requestId)?.retryId);
                    this.pendingRequests.delete(requestId);
                    reject(new Error('等待房主确认超时，请恢复连接后检查当前状态'));
                }, this.requestTimeoutMs);

                const pending = { resolve, reject, timeoutId, retryId: null, attempts: 0, command };
                this.pendingRequests.set(requestId, pending);
                const send = () => {
                    if (generation !== this.connectionGeneration || !this.pendingRequests.has(requestId)) return;
                    if (this.connected) {
                        pending.attempts++;
                        if (this.envelope?.room?.host === this.playerId) {
                            // Host actions use the same serial authority queue without a broker round trip.
                            const task = this.commandQueue.then(() => this._handleCommand(command));
                            this.commandQueue = task.catch(() => undefined);
                        } else {
                            this._publishRaw(this._topic('commands'), JSON.stringify(command), { qos: 1, retain: false })
                                .catch(() => undefined);
                        }
                    }
                    pending.retryId = setTimeout(send, Math.min(4000, this.retryDelayMs * 2 ** Math.min(pending.attempts, 3)));
                };
                send();
            });
        }

        async publishPrivate(playerId, value, options = {}) {
            const publicKey = this.envelope?.room?.players?.[playerId]?.encryptionPublicKey;
            if (!publicKey) throw new Error('目标玩家的安全通道尚未就绪');
            const sealed = await this._sealForPublicKey(value, publicKey);
            const body = {
                protocol: PROTOCOL_VERSION, playerId, sealed,
                signerPlayerId: this.playerId, gameId: this.envelope?.room?.game?.gameId || null
            };
            await this._publishRaw(
                this._topic(`private/${playerId}`),
                JSON.stringify({ ...body, signature: await this._signValue(body) }),
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
                if (await this._validateEnvelope(envelope)) {
                    this._acceptEnvelope(envelope);
                    this._markInitialStateKnown();
                }
                return;
            }

            if (topic === this._topic('commands')) {
                const command = JSON.parse(payload.toString());
                const commandTask = this.commandQueue.then(() => this._handleCommand(command));
                this.commandQueue = commandTask.catch((error) => {
                    console.warn('[MQTT] Command handling failed', error);
                });
                return;
            }

            if (topic === this._topic(`responses/${this.transportId}`)) {
                const response = JSON.parse(payload.toString());
                const pending = this.pendingRequests.get(response.requestId);
                if (!pending) return;
                const { signature, ...body } = response;
                const hostId = this.envelope?.room?.host;
                if (response.signerPlayerId !== hostId || !await this._verifyValue(
                    body, signature, this.envelope?.room?.players?.[hostId]?.authPublicKey
                )) return;
                if (response.envelope && !await this._validateEnvelope(response.envelope)) return;
                clearTimeout(pending.timeoutId);
                clearTimeout(pending.retryId);
                this.pendingRequests.delete(response.requestId);
                pending.resolve(response);
                return;
            }

            if (topic === this._topic(`private/${this.playerId}`)) {
                if (!payload || payload.length === 0) return;
                const message = JSON.parse(payload.toString());
                if (message.protocol !== PROTOCOL_VERSION || message.playerId !== this.playerId || !message.sealed) return;
                const { signature, ...body } = message;
                const hostId = this.envelope?.room?.host;
                if (message.signerPlayerId !== hostId || !await this._verifyValue(
                    body, signature, this.envelope?.room?.players?.[hostId]?.authPublicKey
                )) return;
                if (message.gameId !== (this.envelope?.room?.game?.gameId || null)) return;
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
                await this._handlePresence(presence);
            }
        }

        async _validateEnvelope(envelope) {
            if (envelope.protocol !== PROTOCOL_VERSION || !Number.isSafeInteger(envelope.version)) return false;
            if (envelope.room && envelope.room.code !== this.roomCode) return false;
            if (!envelope.stateSignature || !envelope.signerPlayerId) return false;
            const previousRoom = this.envelope?.room;
            const signerId = envelope.signerPlayerId;
            const signerKey = previousRoom?.players?.[signerId]?.authPublicKey
                || envelope.room?.players?.[signerId]?.authPublicKey;
            if (!signerKey) return false;
            const stateBody = {
                protocol: envelope.protocol, version: envelope.version,
                updatedAt: envelope.updatedAt, room: envelope.room, signerPlayerId: signerId
            };
            if (!await this._verifyValue(stateBody, envelope.stateSignature, signerKey)) return false;
            if (!previousRoom && envelope.room && envelope.room.host !== signerId) return false;
            if (previousRoom && signerId !== previousRoom.host) {
                const expectedSuccessor = this._getNextHostId(previousRoom, previousRoom.host);
                const validHandoff = envelope.room?.host === signerId
                    && expectedSuccessor === signerId
                    && envelope.room?.players?.[previousRoom.host]?.connected === false;
                if (!validHandoff) return false;
            }
            return true;
        }

        _acceptEnvelope(envelope) {
            if (!envelope || envelope.protocol !== PROTOCOL_VERSION) return;
            if (envelope.room && envelope.room.code !== this.roomCode) return;
            if (this.envelope && envelope.version < this.envelope.version) return;
            if (this.envelope && envelope.version === this.envelope.version
                && !valuesEqual(this.envelope.room, envelope.room)) return;
            this.envelope = cloneValue(envelope);
            this._persistCheckpoint();
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
            const generation = this.connectionGeneration;
            if (
                !command
                || command.protocol !== PROTOCOL_VERSION
                || !['mutation', 'action'].includes(command.type)
                || command.roomCode !== this.roomCode
                || command.replyTopic !== this._topic(`responses/${command.senderTransportId}`)
            ) {
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
            if (generation !== this.connectionGeneration || !this.connected) return;

            const cachedResponse = this.processedRequests.get(command.requestId);
            if (cachedResponse) {
                if (cachedResponse.commandSignature !== command.signature) return;
                await this._deliverResponse(command, cachedResponse);
                return;
            }

            if (command.action === 'sync' && room.players?.[command.senderPlayerId] && !room.players[command.senderPlayerId].left) {
                await this._setPeerOnline(command.senderPlayerId, command.senderTransportId);
                const value = this.hostSecrets?.gameId === room.game?.gameId
                    ? this.hostSecrets?.privateStates?.[command.senderPlayerId] : null;
                const messages = value ? [{ playerId: command.senderPlayerId, value }] : [];
                const inquiry = this.hostSecrets?.inquisitorResults?.[command.senderPlayerId];
                if (inquiry && this.hostSecrets?.gameId === room.game?.gameId) {
                    messages.push({ playerId: command.senderPlayerId, value: inquiry, retain: false });
                }
                await this._deliverResponse(command, { ok: true, privateMessages: messages });
                return;
            }

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
                    let nextSecrets;

                    if (command.type === 'action') {
                        if (!this.actionHandler) throw new Error('房主尚未加载游戏动作处理器');
                        const game = currentRoom.game;
                        const expected = game?.gameId ? {
                            gameId: game.gameId, phase: game.phase,
                            currentMission: game.currentMission, selectionRevision: game.selectionRevision || 0
                        } : null;
                        if (!valuesEqual(command.context || null, expected)) throw new Error('对局阶段已变化，请按当前界面重新操作');
                        if (room.players?.[command.senderPlayerId]?.left) throw new Error('你已离开房间');
                        let actionPayload = cloneValue(command.payload || {});
                        if (actionPayload.sealed) actionPayload = await this._openSealedValue(actionPayload.sealed);
                        const actionResult = await this.actionHandler({
                            action: command.action,
                            payload: actionPayload,
                            senderPlayerId: command.senderPlayerId,
                            room: cloneValue(currentRoom)
                        });
                        if (generation !== this.connectionGeneration) return;
                        nextRoom = actionResult?.room;
                        nextSecrets = actionResult?.secrets;
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

                    response = {
                        protocol: PROTOCOL_VERSION,
                        requestId: command.requestId,
                        ok: true,
                        conflict: false,
                        result,
                        privateMessages,
                        commandSignature: command.signature
                    };
                    // Record the result before any network I/O: an ACK loss must not run an action twice.
                    // Apply private changes only after the handler and connection generation are valid.
                    if (nextSecrets !== undefined) this.setHostSecrets(nextSecrets);
                    this.processedRequests.set(command.requestId, response);
                    this._trimReceipts();
                    this._acceptEnvelope(nextEnvelope);
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

            delete response.envelope;
            response.commandSignature = command.signature;
            this.processedRequests.set(command.requestId, response);
            this._trimReceipts();
            this._persistCheckpoint();
            await this._deliverResponse(command, response);
        }

        _trimReceipts() {
            if (this.processedRequests.size > 256) {
                const oldestKey = this.processedRequests.keys().next().value;
                this.processedRequests.delete(oldestKey);
            }
        }

        async _deliverResponse(command, record) {
            // Retry publication too, even when the action itself was already durably committed.
            if (this.lastPublishedVersion !== this.envelope.version || command.action === 'sync') {
                await this._publishState(this.envelope);
            }
            await Promise.all((record.privateMessages || []).map((message) => this.publishPrivate(
                message.playerId, message.value, { retain: message.retain !== false }
            )));
            const body = {
                protocol: PROTOCOL_VERSION, requestId: command.requestId,
                ok: !!record.ok, conflict: !!record.conflict,
                error: record.error || null, result: record.result || null,
                envelope: cloneValue(this.envelope), signerPlayerId: this.playerId
            };
            const response = { ...body, signature: await this._signValue(body) };
            if (command.senderPlayerId === this.playerId && command.senderTransportId === this.transportId) {
                const pending = this.pendingRequests.get(command.requestId);
                if (pending) {
                    clearTimeout(pending.timeoutId);
                    clearTimeout(pending.retryId);
                    this.pendingRequests.delete(command.requestId);
                    pending.resolve(response);
                }
            } else {
                await this._publishRaw(command.replyTopic, JSON.stringify(response), { qos: 1, retain: false });
            }
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
            const generation = this.connectionGeneration;
            if (
                !presence
                || presence.protocol !== PROTOCOL_VERSION
                || presence.roomCode !== this.roomCode
                || !['online', 'heartbeat', 'offline'].includes(presence.type)
                || !presence.playerId
            ) {
                return;
            }

            const room = this.envelope?.room;
            const currentPlayer = room?.players?.[presence.playerId];
            const { signature, ...presenceBody } = presence;
            const key = presence.playerId === this.playerId ? this.publicSigningKey : currentPlayer?.authPublicKey;
            if (!await this._verifyValue(presenceBody, signature, key)) return;
            if (generation !== this.connectionGeneration || !this.connected) return;
            if (presence.playerId === this.playerId && presence.transportId === this.transportId && presence.type !== 'offline') {
                this.lastEchoAt = Date.now();
                if (this.ready && !this.offlineTimers.has(room?.host)) {
                    this._emitStatus('connected', `已连接 · 转发往返 ${Math.max(0, Date.now() - presence.at)} ms`);
                }
            }
            if (!currentPlayer || currentPlayer.left) return;
            if (
                presence.type === 'offline'
                && currentPlayer.transportId
                && currentPlayer.transportId !== presence.transportId
            ) {
                return;
            }

            if (presence.type === 'offline') {
                this._scheduleOffline(presence.playerId, presence.transportId);
                return;
            }
            if (presence.type === 'heartbeat' && currentPlayer.transportId && presence.transportId !== currentPlayer.transportId) return;
            const previous = this.peers.get(presence.playerId);
            if (previous && presence.at < previous.at) return;
            this.peers.set(presence.playerId, { at: presence.at, seenAt: Date.now(), transportId: presence.transportId });
            const pending = this.offlineTimers.get(presence.playerId);
            clearTimeout(pending?.timer);
            this.offlineTimers.delete(presence.playerId);
            if (room.host === this.playerId && (currentPlayer.connected === false || currentPlayer.transportId !== presence.transportId)) {
                const task = this.commandQueue.then(() => this._setPeerOnline(presence.playerId, presence.transportId));
                this.commandQueue = task.catch(() => undefined);
                await task;
            }
            if (pending && presence.playerId === room.host && this.ready) {
                this._emitStatus('connected', '房主已重连 · 正在补齐状态');
                this._synchronize().catch(() => undefined);
            }
            if (room.host === this.playerId && presence.type === 'heartbeat'
                && Number.isInteger(presence.version) && presence.version < this.envelope.version) {
                await this._publishState(this.envelope);
            }
        }

        async _setPeerOnline(playerId, transportId) {
            const room = this.envelope?.room;
            const player = room?.players?.[playerId];
            if (!player || player.left || room.host !== this.playerId) return;
            const pending = this.offlineTimers.get(playerId);
            clearTimeout(pending?.timer);
            this.offlineTimers.delete(playerId);
            if (player.connected !== false && player.transportId === transportId) return;
            const nextRoom = cloneValue(room);
            Object.assign(nextRoom.players[playerId], { connected: true, disconnectedAt: null, transportId });
            this._acceptEnvelope({ protocol: PROTOCOL_VERSION, version: this.envelope.version + 1, updatedAt: Date.now(), room: nextRoom });
            await this._publishState(this.envelope);
        }

        _clearOfflineTimers() {
            for (const pending of this.offlineTimers.values()) clearTimeout(pending.timer);
            this.offlineTimers.clear();
        }

        _scheduleOffline(playerId, transportId) {
            if (!this.connected || playerId === this.playerId || this.offlineTimers.has(playerId)) return;
            const room = this.envelope?.room;
            if (!room?.players?.[playerId] || room.players[playerId].left || room.players[playerId].connected === false) return;
            const grace = room.host === playerId && room.state === 'playing' ? this.hostGraceMs : this.playerGraceMs;
            const pending = { transportId, deadline: Date.now() + grace, timer: null };
            pending.timer = setTimeout(() => {
                if (this.offlineTimers.get(playerId) !== pending) return;
                const task = this.commandQueue.then(() => this._finalizeOffline(playerId, pending));
                this.commandQueue = task.catch((error) => {
                    if (this.connected) console.warn('[MQTT] Offline recovery failed', error);
                });
            }, grace);
            this.offlineTimers.set(playerId, pending);
            if (room.host === playerId) this._emitStatus('waiting', `房主正在重连，保留对局 ${Math.ceil(grace / 1000)} 秒…`);
        }

        async _finalizeOffline(playerId, pending) {
            if (this.offlineTimers.get(playerId) !== pending || !this.connected
                || Date.now() - this.lastEchoAt > PEER_TIMEOUT_MS) return;
            const room = this.envelope?.room;
            if (!room?.players?.[playerId] || (room.players[playerId].transportId
                && room.players[playerId].transportId !== pending.transportId)) return;
            const isHostSuccessor = room.host === playerId && this._getNextHostId(room, playerId) === this.playerId;
            if (room.host !== this.playerId && !isHostSuccessor) return;
            this.offlineTimers.delete(playerId);
            const nextRoom = cloneValue(room);
            Object.assign(nextRoom.players[playerId], { connected: false, disconnectedAt: Date.now() });
            if (isHostSuccessor) {
                nextRoom.host = this.playerId;
                for (const [id, entry] of Object.entries(nextRoom.players || {})) {
                    entry.isHost = id === this.playerId;
                }
                if (nextRoom.state === 'playing' && nextRoom.game?.phase !== 'ended') {
                    nextRoom.game.phase = 'ended';
                    nextRoom.game.winners = 'aborted';
                    nextRoom.game.winReason = '房主重连等待超时，无法恢复私密对局状态；本局中止，可返回大厅重开';
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
            if (isHostSuccessor) this._emitStatus('connected', '已接任房主');
        }

        async _announcePresence(type) {
            const body = {
                protocol: PROTOCOL_VERSION,
                type,
                roomCode: this.roomCode,
                playerId: this.playerId,
                transportId: this.transportId,
                version: this.envelope?.version || 0,
                at: Date.now()
            };
            return this._publishRaw(this._topic('presence'), JSON.stringify({
                ...body,
                signature: await this._signValue(body)
            }), { qos: type === 'heartbeat' ? 0 : 1, retain: false });
        }

        async _publishState(envelope) {
            const generation = this.connectionGeneration;
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
            if (generation !== this.connectionGeneration) return;
            if (this.envelope?.version === envelope.version && valuesEqual(this.envelope.room, envelope.room)) {
                this.envelope = signedEnvelope;
                this._persistCheckpoint();
            }
            await this._publishRaw(this._topic('state'), JSON.stringify(signedEnvelope), { qos: 1, retain: true });
            this.lastPublishedVersion = envelope.version;
        }

        _publishRaw(topic, payload, options) {
            return new Promise((resolve, reject) => {
                if (!this.client?.connected) {
                    reject(new Error('未连接联机服务器'));
                    return;
                }
                const timer = setTimeout(() => reject(new Error('发送确认超时')), 8000);
                this.client.publish(topic, payload, options, (error) => {
                    clearTimeout(timer);
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
