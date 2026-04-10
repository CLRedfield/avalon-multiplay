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

        localStorage.setItem(this.sessionKey, JSON.stringify({
            roomCode: this.currentRoom,
            playerId: this.playerId,
            playerName: this.playerName || ''
        }));
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
        localStorage.removeItem(this.sessionKey);
    },

    _getPlayerRef(playerId = this.playerId) {
        if (!this.roomRef || !playerId) return null;
        return this.roomRef.child('players/' + playerId);
    },

    async _setupPresence(playerId = this.playerId) {
        const playerRef = this._getPlayerRef(playerId);
        if (!playerRef) return;

        await playerRef.update({
            connected: true,
            disconnectedAt: null,
            lastSeen: firebase.database.ServerValue.TIMESTAMP,
            left: false
        });

        await playerRef.onDisconnect().update({
            connected: false,
            disconnectedAt: firebase.database.ServerValue.TIMESTAMP,
            lastSeen: firebase.database.ServerValue.TIMESTAMP
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
            createdAt: firebase.database.ServerValue.TIMESTAMP,
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

        const roomRef = database.ref('rooms/' + roomCode);
        const playerPayload = {
            name: playerName,
            isHost: false,
            isReady: false,
            isExiled: false,
            connected: true,
            disconnectedAt: null,
            left: false,
            joinedAt: Date.now()
        };

        const transactionResult = await roomRef.transaction((room) => {
            if (!room) return room;
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

        const roomRef = database.ref('rooms/' + session.roomCode);
        const snapshot = await roomRef.once('value');

        if (!snapshot.exists()) {
            this._clearSession();
            return null;
        }

        const roomData = snapshot.val();
        const player = roomData.players?.[session.playerId];

        if (!player || player.left) {
            this._clearSession();
            return null;
        }

        if (roomData.state === 'playing' && roomData.game?.roles && !roomData.game.roles[session.playerId]) {
            this._clearSession();
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

        await this._cancelPresence();

        await this.roomRef.transaction((room) => {
            if (!room?.players || !room.players[this.playerId]) return room;

            delete room.players[this.playerId];

            if (room.game) {
                if (room.game.roles) delete room.game.roles[this.playerId];
                room.game.playerOrder = (room.game.playerOrder || []).filter((playerId) => playerId !== this.playerId);
                room.game.selectedTeam = (room.game.selectedTeam || []).filter((playerId) => playerId !== this.playerId);
                room.game.exiledPlayers = (room.game.exiledPlayers || []).filter((playerId) => playerId !== this.playerId);
            }

            const remainingIds = Object.keys(room.players);
            if (remainingIds.length === 0) {
                return null;
            }

            if (room.host === this.playerId) {
                const nextHostId = this._pickHostId(room, this.playerId);
                if (!nextHostId) {
                    return null;
                }
                room.host = nextHostId;
            }

            return this._syncHostFlags(room);
        }, undefined, false);

        this._cleanup(true);
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
        if (!this.roomRef || !this.isHost) return;

        const transactionResult = await this.roomRef.transaction((room) => {
            if (!room || room.state !== 'waiting') return;

            const allPlayers = room.players || {};
            const activeEntries = Object.entries(allPlayers).filter(([, player]) => player && !player.left && player.connected !== false);

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

            room.game = {
                phase: 'night',
                roles: roles,
                playerOrder: this._shuffleList(playerIds),
                captainIndex: 0,
                currentMission: 0,
                rejectCount: 0,
                selectedTeam: [],
                exileTarget: null,
                actionType: null,
                voteType: null,
                votes: {},
                missionCards: {},
                missionResults: [null, null, null, null, null],
                missionHistory: {},
                exiledPlayers: [],
                inquisitorUsed: {},
                tribunalVotes: {},
                tribunalInitiateVotes: {},
                assassinTarget: null
            };

            room.state = 'playing';
            return room;
        }, undefined, false);

        if (!transactionResult.committed) {
            throw new Error('开始游戏失败，请重试');
        }
    },

    async resetToLobby() {
        if (!this.roomRef || !this.isHost) return;

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
    },

    async _ensureActiveHost() {
        if (!this.roomRef) return;

        try {
            await this.roomRef.transaction((room) => {
                if (!room?.players) return room;

                const currentHost = room.host;
                const currentHostPlayer = currentHost ? room.players[currentHost] : null;

                if (currentHostPlayer && !currentHostPlayer.left && currentHostPlayer.connected !== false) {
                    return room;
                }

                const nextHostId = this._pickHostId(room, currentHost);
                if (!nextHostId) {
                    return room;
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

            this._ensureActiveHost();
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
    }
};

window.RoomManager = RoomManager;
