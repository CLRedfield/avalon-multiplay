const RoomManager = {
    roomRef: null,
    playerId: null,
    currentRoom: null,
    isHost: false,
    hostId: null,
    playerName: '',
    roomState: 'waiting',
    latestPlayers: {},
    latestGame: null,
    isLeaving: false,
    gameStartPending: false,
    sessionKey: 'awaron_session',

    _generateRoomCode() {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let code = '';
        for (let i = 0; i < 4; i++) {
            code += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return code;
    },

    _generatePlayerId() {
        return 'player_' + Date.now() + '_' + Math.random().toString(36).slice(2, 11);
    },

    _saveSession() {
        if (!this.currentRoom || !this.playerId) return;

        try { localStorage.setItem(this.sessionKey, JSON.stringify({
            roomCode: this.currentRoom,
            playerId: this.playerId,
            playerName: this.playerName || '',
            brokerUrl: database.brokerUrl || MQTTBrokerConfig.getSelectedBroker()
        })); } catch (error) { console.warn('[RoomManager] Session could not be saved', error); }
    },

    _loadSession() {
        try {
            const raw = localStorage.getItem(this.sessionKey);
            return raw ? JSON.parse(raw) : null;
        } catch (error) {
            console.warn('[RoomManager] Failed to parse session', error);
            return null;
        }
    },

    _clearSession() {
        try { localStorage.removeItem(this.sessionKey); } catch (error) { /* Memory-only session. */ }
    },

    _getPlayerRef(playerId = this.playerId) {
        if (!this.roomRef || !playerId) return null;
        return this.roomRef.child('players/' + playerId);
    },

    async _setupPresence(playerId = this.playerId) {
        const playerRef = this._getPlayerRef(playerId);
        if (!playerRef) return;
        const player = database.envelope?.room?.players?.[playerId];
        if (player?.connected === true && player.transportId === database.transportId && !player.left) return;

        await playerRef.update({
            connected: true,
            disconnectedAt: null,
            lastSeen: Date.now(),
            transportId: database.transportId,
            left: false
        });

        await playerRef.onDisconnect().update({
            connected: false,
            disconnectedAt: Date.now(),
            lastSeen: Date.now()
        });
    },

    async _cancelPresence(playerId = this.playerId) {
        const playerRef = this._getPlayerRef(playerId);
        if (!playerRef) return;
        await playerRef.onDisconnect().cancel();
    },

    _getOrderedPlayerIds(players, game) {
        const gameOrder = Array.isArray(game?.playerOrder) ? game.playerOrder : [];
        const ordered = [...gameOrder];
        const remaining = Object.keys(players || {})
            .filter((playerId) => !ordered.includes(playerId))
            .sort((a, b) => (players[a]?.joinedAt || 0) - (players[b]?.joinedAt || 0));

        return [...ordered, ...remaining];
    },

    _pickHostId(room, excludedPlayerId = null) {
        const players = room?.players || {};
        const orderedIds = this._getOrderedPlayerIds(players, room?.game);
        let fallbackHostId = null;

        for (const playerId of orderedIds) {
            const player = players[playerId];
            if (!player || player.left || playerId === excludedPlayerId) continue;

            if (!fallbackHostId) {
                fallbackHostId = playerId;
            }

            if (player.connected !== false) {
                return playerId;
            }
        }

        return fallbackHostId;
    },

    _syncHostFlags(room) {
        if (!room?.players) return room;

        Object.keys(room.players).forEach((playerId) => {
            room.players[playerId].isHost = playerId === room.host;
        });

        return room;
    },

    _shuffleList(items) {
        const list = [...items];
        for (let i = list.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [list[i], list[j]] = [list[j], list[i]];
        }
        return list;
    },

    async createRoom(playerName) {
        this._clearSession();
        this.playerName = playerName;
        this.playerId = this._generatePlayerId();
        this.isHost = true;

        let roomCode;
        let exists = true;
        while (exists) {
            roomCode = this._generateRoomCode();
            await database.connectForRoom(roomCode, this.playerId, MQTTBrokerConfig.getSelectedBroker());
            const snapshot = await database.ref('rooms/' + roomCode).once('value');
            exists = snapshot.exists();
        }

        this.currentRoom = roomCode;
        this.hostId = this.playerId;
        this.roomRef = database.ref('rooms/' + roomCode);

        await this.roomRef.set({
            code: roomCode,
            host: this.playerId,
            state: 'waiting',
            createdAt: Date.now(),
            brokerUrl: database.brokerUrl,
            settings: {
                neutralPool: ['scapegoat', 'armsdealer', 'cultist']
            },
            players: {
                [this.playerId]: {
                    name: playerName,
                    isHost: true,
                    isReady: false,
                    isExiled: false,
                    connected: true,
                    disconnectedAt: null,
                    transportId: database.transportId,
                    authPublicKey: database.publicSigningKey,
                    encryptionPublicKey: database.publicEncryptionKey,
                    left: false,
                    joinedAt: Date.now()
                }
            }
        });

        this._saveSession();
        await this._setupPresence();
        this._setupListeners();

        return roomCode;
    },

    async joinRoom(roomCode, playerName) {
        this._clearSession();
        this.playerName = playerName;
        this.playerId = this._generatePlayerId();
        this.isHost = false;
        this.hostId = null;
        this.currentRoom = roomCode;

        await database.connectForRoom(roomCode, this.playerId, MQTTBrokerConfig.getSelectedBroker());
        const roomRef = database.ref('rooms/' + roomCode);
        const initialSnapshot = await roomRef.once('value');
        if (!initialSnapshot.exists()) {
            throw new Error('房间不存在');
        }

        const initialRoom = initialSnapshot.val();
        if (initialRoom.state !== 'waiting') {
            throw new Error('游戏已经开始');
        }

        const initialConnectedCount = Object.values(initialRoom.players || {})
            .filter((player) => player && !player.left && player.connected !== false)
            .length;
        if (initialConnectedCount >= 10) {
            throw new Error('房间已满');
        }

        const playerPayload = {
            name: playerName,
            isHost: false,
            isReady: false,
            isExiled: false,
            connected: true,
            disconnectedAt: null,
            transportId: database.transportId,
            authPublicKey: database.publicSigningKey,
            encryptionPublicKey: database.publicEncryptionKey,
            left: false,
            joinedAt: Date.now()
        };

        const transactionResult = await roomRef.transaction((room) => {
            if (!room) return;
            if (room.state !== 'waiting') return;

            const players = room.players || {};
            const connectedCount = Object.values(players).filter((player) => player && !player.left && player.connected !== false).length;
            if (connectedCount >= 10) return;

            room.players = players;
            room.players[this.playerId] = playerPayload;
            return room;
        }, undefined, false);

        if (!transactionResult.committed) {
            const snapshot = await roomRef.once('value');
            if (!snapshot.exists()) {
                throw new Error('房间不存在');
            }

            const roomData = snapshot.val();
            if (roomData.state !== 'waiting') {
                throw new Error('游戏已经开始');
            }

            const connectedCount = Object.values(roomData.players || {}).filter((player) => player && !player.left && player.connected !== false).length;
            if (connectedCount >= 10) {
                throw new Error('房间已满');
            }

            throw new Error('加入房间失败，请重试');
        }

        this.roomRef = roomRef;
        this.hostId = transactionResult.snapshot.val()?.host || null;
        this._saveSession();
        await this._setupPresence();
        this._setupListeners();
    },

    async restoreSession() {
        const session = this._loadSession();
        if (!session?.roomCode || !session?.playerId) return null;

        const brokerUrl = MQTTBrokerConfig.setSelectedBroker(session.brokerUrl || MQTTBrokerConfig.getSelectedBroker());
        await database.connectForRoom(session.roomCode, session.playerId, brokerUrl);
        const roomRef = database.ref('rooms/' + session.roomCode);
        const snapshot = await roomRef.once('value');

        if (!snapshot.exists()) {
            this._clearSession();
            await database.disconnectRoom();
            return null;
        }

        const roomData = snapshot.val();
        const player = roomData.players?.[session.playerId];

        if (!player || player.left) {
            this._clearSession();
            await database.disconnectRoom();
            return null;
        }

        if (
            roomData.state === 'playing'
            && Array.isArray(roomData.game?.playerOrder)
            && !roomData.game.playerOrder.includes(session.playerId)
        ) {
            this._clearSession();
            await database.disconnectRoom();
            return null;
        }

        this.roomRef = roomRef;
        this.playerId = session.playerId;
        this.currentRoom = session.roomCode;
        this.playerName = player.name || session.playerName || '';
        this.hostId = roomData.host || null;
        this.isHost = this.hostId === this.playerId || !!player.isHost;
        this.roomState = roomData.state || 'waiting';
        this.latestPlayers = roomData.players || {};
        this.latestGame = roomData.game || null;

        this._saveSession();
        await this._setupPresence();
        this._setupListeners();

        return {
            roomCode: this.currentRoom,
            state: this.roomState
        };
    },

    async leaveRoom() {
        if (!this.roomRef || !this.playerId) return;

        this.isLeaving = true;

        try {
            await this._cancelPresence();

            if (this.roomState === 'playing') {
                await this._getPlayerRef().update({
                    left: true,
                    connected: false,
                    disconnectedAt: Date.now(),
                    lastSeen: Date.now()
                });

                if (this.isHost) {
                    await this.roomRef.transaction((room) => {
                        if (!room?.players?.[this.playerId]) return;
                        const nextHostId = this._pickHostId(room, this.playerId);
                        if (nextHostId) room.host = nextHostId;
                        return this._syncHostFlags(room);
                    }, undefined, false);
                }
            } else {
                await this.roomRef.transaction((room) => {
                    if (!room?.players || !room.players[this.playerId]) return room;

                    delete room.players[this.playerId];

                    const remainingIds = Object.keys(room.players);
                    if (remainingIds.length === 0) return null;

                    if (room.host === this.playerId) {
                        const nextHostId = this._pickHostId(room, this.playerId);
                        if (!nextHostId) return null;
                        room.host = nextHostId;
                    }

                    return this._syncHostFlags(room);
                }, undefined, false);
            }

            await database.disconnectRoom();
            this._cleanup(true);
        } catch (error) {
            this.isLeaving = false;
            throw error;
        }
    },

    async updateNeutralPool(pool) {
        if (!this.roomRef || !this.isHost) return;
        await this.roomRef.child('settings/neutralPool').set(pool);
    },

    async setReady(isReady) {
        if (!this.roomRef || !this.playerId) return;
        await this.roomRef.child('players/' + this.playerId + '/isReady').set(isReady);
    },

    async startGame() {
        if (!this.roomRef || !this.isHost || this.gameStartPending) return;

        let preparedSecrets = null;
        let preparedPrivateRoles = [];
        this.gameStartPending = true;

        try {
            const transactionResult = await this.roomRef.transaction((room) => {
                if (!room || room.state !== 'waiting') return;

                const allPlayers = room.players || {};
                const activeEntries = Object.entries(allPlayers)
                    .filter(([, player]) => player && !player.left && player.connected !== false)
                    .sort((a, b) => (a[1].joinedAt || 0) - (b[1].joinedAt || 0));

                if (activeEntries.length < 5 || activeEntries.length > 10) {
                    return;
                }

                room.players = Object.fromEntries(activeEntries.map(([playerId, player]) => [
                    playerId,
                    {
                        ...player,
                        isReady: false,
                        isExiled: false
                    }
                ]));

                if (!room.players[room.host]) {
                    room.host = activeEntries[0][0];
                }

                this._syncHostFlags(room);

                const playerIds = activeEntries.map(([playerId]) => playerId);
                const neutralPool = (room.settings?.neutralPool || []).map((id) => getNeutralRole(id)).filter(Boolean);
                const roleAssignments = assignRoles(playerIds, neutralPool);
                const roles = {};

                for (const [playerId, role] of Object.entries(roleAssignments)) {
                    roles[playerId] = role.id;
                }

                const gameId = 'game_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
                preparedSecrets = {
                    gameId,
                    roles,
                    missionCards: {},
                    missionHistory: {},
                    neutralFailUsage: {},
                    privateStates: {}
                };
                preparedPrivateRoles = playerIds.map((playerId) => {
                    const value = {
                        type: 'role',
                        gameId,
                        roleId: roles[playerId],
                        nightInfo: getNightInfo(roleAssignments[playerId], roleAssignments, playerId),
                        neutralFailUsed: false
                    };
                    preparedSecrets.privateStates[playerId] = value;
                    return { playerId, value };
                });

                room.game = {
                    gameId,
                    phase: 'night',
                    playerOrder: playerIds,
                    captainIndex: Math.floor(Math.random() * playerIds.length),
                    selectionRevision: 0,
                    currentMission: 0,
                    rejectCount: 0,
                    selectedTeam: [],
                    exileTarget: null,
                    actionType: null,
                    voteType: null,
                    votes: {},
                    missionSubmitted: {},
                    missionResults: [null, null, null, null, null],
                    missionTeamHistory: {},
                    exiledPlayers: [],
                    inquisitorUsed: {},
                    tribunalVotes: {},
                    tribunalInitiateVotes: {},
                    assassinTarget: null
                };

                room.state = 'playing';
                // Persist secrets before the authority commits the new public game snapshot.
                database.setHostSecrets(preparedSecrets);
                return room;
            }, undefined, false);

            if (!transactionResult.committed) {
                throw new Error('开始游戏失败，请重试');
            }

            database.setHostSecrets(preparedSecrets);
            this.gameStartPending = false;
            await Promise.all(preparedPrivateRoles.map((privateRole) => database.publishPrivate(privateRole.playerId, privateRole.value)));
        } finally {
            this.gameStartPending = false;
        }
    },

    async resetToLobby() {
        if (!this.roomRef || !this.isHost) return;

        const playerIds = Object.keys(this.latestPlayers || {});

        await this.roomRef.transaction((room) => {
            if (!room) return room;

            delete room.game;
            room.state = 'waiting';

            const players = room.players || {};
            Object.keys(players).forEach((playerId) => {
                players[playerId].isReady = false;
                players[playerId].isExiled = false;
            });

            if (!players[room.host]) {
                const nextHostId = this._pickHostId(room);
                if (nextHostId) {
                    room.host = nextHostId;
                }
            }

            return this._syncHostFlags(room);
        }, undefined, false);

        database.setHostSecrets(null);
        for (const playerId of playerIds) {
            await database.clearPrivate(playerId).catch(() => undefined);
        }
        GameManager.privateRoleId = null;
        GameManager.privateNightInfo = [];
        GameManager.privateGameId = null;
        GameManager.privateNeutralFailUsed = false;
    },

    async _ensureActiveHost() {
        if (!this.roomRef) return;

        const knownHostId = this.hostId || Object.keys(this.latestPlayers || {})
            .find((playerId) => this.latestPlayers[playerId]?.isHost);
        const knownHost = knownHostId ? this.latestPlayers?.[knownHostId] : null;
        if (knownHost && !knownHost.left && knownHost.connected !== false) {
            return;
        }

        try {
            await this.roomRef.transaction((room) => {
                if (!room?.players) return;

                const currentHost = room.host;
                const currentHostPlayer = currentHost ? room.players[currentHost] : null;

                if (currentHostPlayer && !currentHostPlayer.left && currentHostPlayer.connected !== false) {
                    return;
                }

                const nextHostId = this._pickHostId(room, currentHost);
                if (!nextHostId) {
                    return;
                }

                room.host = nextHostId;
                return this._syncHostFlags(room);
            }, undefined, false);
        } catch (error) {
            console.warn('[RoomManager] Host migration skipped', error);
        }
    },

    _setupListeners() {
        if (!this.roomRef) return;
        this.roomRef.off();

        this.roomRef.child('players').on('value', (snapshot) => {
            const players = snapshot.val() || {};
            this.latestPlayers = players;

            if (this.playerId && players[this.playerId]) {
                this.isHost = !!players[this.playerId].isHost;
                this.playerName = players[this.playerId].name || this.playerName;
                this._saveSession();
            }

            if (window.onPlayersChange) {
                window.onPlayersChange(players);
            }

            if (!this.isLeaving) {
                this._ensureActiveHost();
            }
        });

        this.roomRef.child('host').on('value', (snapshot) => {
            this.hostId = snapshot.val();
            this.isHost = this.hostId === this.playerId;

            if (window.onHostChange) {
                window.onHostChange(this.hostId);
            }
        });

        this.roomRef.child('state').on('value', (snapshot) => {
            this.roomState = snapshot.val() || 'waiting';
            if (window.onRoomStateChange) {
                window.onRoomStateChange(this.roomState);
            }
        });

        this.roomRef.child('settings').on('value', (snapshot) => {
            const settings = snapshot.val() || {};
            if (window.onSettingsChange) {
                window.onSettingsChange(settings);
            }
        });

        this.roomRef.child('game').on('value', (snapshot) => {
            const game = snapshot.val();
            this.latestGame = game;
            if (window.onGameChange) {
                window.onGameChange(game);
            }
        });
    },

    _cleanup(clearSession = false) {
        if (this.roomRef) {
            this.roomRef.off();
        }

        if (clearSession) {
            this._clearSession();
        }

        this.roomRef = null;
        this.playerId = null;
        this.currentRoom = null;
        this.isHost = false;
        this.hostId = null;
        this.playerName = '';
        this.roomState = 'waiting';
        this.latestPlayers = {};
        this.latestGame = null;
        this.isLeaving = false;
        this.gameStartPending = false;

        if (typeof GameManager !== 'undefined') GameManager.selectionDraft = null;

        if (database.client || database.connected) {
            database.disconnectRoom().catch((error) => {
                console.warn('[RoomManager] MQTT disconnect failed', error);
            });
        }
    }
};

window.RoomManager = RoomManager;
