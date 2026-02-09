// ===== 房间管理器 =====

const RoomManager = {
    roomRef: null,
    playerId: null,
    currentRoom: null,
    isHost: false,
    playerName: '',

    // 生成房间码
    _generateRoomCode() {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let code = '';
        for (let i = 0; i < 4; i++) {
            code += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return code;
    },

    // 生成玩家ID
    _generatePlayerId() {
        return 'player_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    },

    // 创建房间
    async createRoom(playerName) {
        this.playerName = playerName;
        this.playerId = this._generatePlayerId();
        this.isHost = true;

        // 生成唯一房间码
        let roomCode;
        let exists = true;
        while (exists) {
            roomCode = this._generateRoomCode();
            const snapshot = await database.ref('rooms/' + roomCode).once('value');
            exists = snapshot.exists();
        }

        this.currentRoom = roomCode;
        this.roomRef = database.ref('rooms/' + roomCode);

        // 创建房间数据
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
                    joinedAt: firebase.database.ServerValue.TIMESTAMP
                }
            }
        });

        // 设置断开连接时的处理
        this.roomRef.child('players/' + this.playerId).onDisconnect().remove();

        // 监听房间变化
        this._setupListeners();

        return roomCode;
    },

    // 加入房间
    async joinRoom(roomCode, playerName) {
        this.playerName = playerName;
        this.playerId = this._generatePlayerId();
        this.isHost = false;
        this.currentRoom = roomCode;

        const roomRef = database.ref('rooms/' + roomCode);
        const snapshot = await roomRef.once('value');

        if (!snapshot.exists()) {
            throw new Error('房间不存在');
        }

        const roomData = snapshot.val();
        if (roomData.state !== 'waiting') {
            throw new Error('游戏已经开始');
        }

        const playerCount = Object.keys(roomData.players || {}).length;
        if (playerCount >= 10) {
            throw new Error('房间已满');
        }

        this.roomRef = roomRef;

        // 添加玩家
        await this.roomRef.child('players/' + this.playerId).set({
            name: playerName,
            isHost: false,
            isReady: false,
            isExiled: false,
            joinedAt: firebase.database.ServerValue.TIMESTAMP
        });

        // 设置断开连接时的处理
        this.roomRef.child('players/' + this.playerId).onDisconnect().remove();

        // 监听房间变化
        this._setupListeners();
    },

    // 离开房间
    async leaveRoom() {
        if (!this.roomRef) return;

        await this.roomRef.child('players/' + this.playerId).remove();

        // 如果是房主，解散房间
        if (this.isHost) {
            await this.roomRef.remove();
        }

        this._cleanup();
    },

    // 更新中立角色池
    async updateNeutralPool(pool) {
        if (!this.roomRef || !this.isHost) return;
        await this.roomRef.child('settings/neutralPool').set(pool);
    },

    // 设置准备状态
    async setReady(isReady) {
        if (!this.roomRef) return;
        await this.roomRef.child('players/' + this.playerId + '/isReady').set(isReady);
    },

    // 开始游戏
    async startGame() {
        if (!this.roomRef || !this.isHost) return;

        const snapshot = await this.roomRef.once('value');
        const roomData = snapshot.val();
        const players = roomData.players || {};
        const playerIds = Object.keys(players);

        if (playerIds.length < 5) {
            throw new Error('至少需要5名玩家');
        }

        if (playerIds.length > 10) {
            throw new Error('最多支持10名玩家');
        }

        // 获取中立角色池
        const neutralPool = (roomData.settings?.neutralPool || []).map(id => getNeutralRole(id)).filter(r => r);

        // 分配角色
        const roleAssignments = assignRoles(playerIds, neutralPool);

        // 转换为 roleId 存储
        const roles = {};
        for (const [playerId, role] of Object.entries(roleAssignments)) {
            roles[playerId] = role.id;
        }

        // 随机确定玩家顺序
        const playerOrder = [...playerIds].sort(() => Math.random() - 0.5);

        // 初始化游戏状态
        await this.roomRef.child('game').set({
            phase: 'night',
            roles: roles,
            playerOrder: playerOrder,
            captainIndex: 0,
            currentMission: 0,
            rejectCount: 0,
            selectedTeam: [],
            exileTarget: null,
            actionType: null,
            votes: {},
            missionCards: {},
            missionResults: [null, null, null, null, null],
            missionHistory: {},
            exiledPlayers: [],
            inquisitorUsed: {}
        });

        // 重置所有玩家准备状态
        for (const pid of playerIds) {
            await this.roomRef.child('players/' + pid + '/isReady').set(false);
        }

        // 更新房间状态
        await this.roomRef.child('state').set('playing');
    },

    // 重置回大厅
    async resetToLobby() {
        if (!this.roomRef || !this.isHost) return;

        await this.roomRef.child('game').remove();
        await this.roomRef.child('state').set('waiting');

        // 重置所有玩家状态
        const snapshot = await this.roomRef.child('players').once('value');
        const players = snapshot.val() || {};
        for (const pid of Object.keys(players)) {
            await this.roomRef.child('players/' + pid).update({
                isReady: false,
                isExiled: false
            });
        }
    },

    // 设置监听器
    _setupListeners() {
        // 监听玩家变化
        this.roomRef.child('players').on('value', (snapshot) => {
            const players = snapshot.val() || {};
            if (window.onPlayersChange) {
                window.onPlayersChange(players);
            }
        });

        // 监听房间状态变化
        this.roomRef.child('state').on('value', (snapshot) => {
            const state = snapshot.val();
            if (window.onRoomStateChange) {
                window.onRoomStateChange(state);
            }
        });

        // 监听设置变化
        this.roomRef.child('settings').on('value', (snapshot) => {
            const settings = snapshot.val() || {};
            if (window.onSettingsChange) {
                window.onSettingsChange(settings);
            }
        });

        // 监听游戏状态变化
        this.roomRef.child('game').on('value', (snapshot) => {
            const game = snapshot.val();
            if (window.onGameChange) {
                window.onGameChange(game);
            }
        });
    },

    // 清理
    _cleanup() {
        if (this.roomRef) {
            this.roomRef.off();
        }
        this.roomRef = null;
        this.playerId = null;
        this.currentRoom = null;
        this.isHost = false;
    }
};

window.RoomManager = RoomManager;
