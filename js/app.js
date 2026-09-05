const App = {
    phaseTimers: {
        voteResult: null,
        missionResult: null,
        assassinReconnect: null
    },
    roomActionPending: false,
    sessionRestorePending: true,
    orphanedGameAbortPending: false,
    pendingActions: new Set(),

    init() {
        this.setupBrokerSelector();
        this.bindEvents();
        Workshop.init();
        UI.renderRuleSummaries();
        UI.showView('home');
        this.setHomeActionsBusy(true);
        this.restoreSession().finally(() => {
            this.sessionRestorePending = false;
            this.setHomeActionsBusy(false);
        });
    },

    setHomeActionsBusy(isBusy) {
        const createButton = document.getElementById('create-room-btn');
        const joinButton = document.getElementById('join-room-btn');
        const brokerSelect = document.getElementById('broker-select');
        if (createButton) createButton.disabled = isBusy;
        if (joinButton) joinButton.disabled = isBusy;
        if (brokerSelect) brokerSelect.disabled = isBusy;
    },

    async runGameAction(action, failureLabel = '操作失败') {
        if (this.pendingActions.has(failureLabel)) return null;
        this.pendingActions.add(failureLabel);
        try {
            return await action();
        } catch (error) {
            console.warn('[App] Game action failed', error);
            UI.showToast(`${failureLabel}: ${error.message || error}`);
            return null;
        } finally {
            this.pendingActions.delete(failureLabel);
        }
    },

    setupBrokerSelector() {
        const select = document.getElementById('broker-select');
        if (!select) return;

        select.innerHTML = '';
        MQTTBrokerConfig.alternatives.forEach((brokerUrl) => {
            const option = document.createElement('option');
            option.value = brokerUrl;
            option.textContent = MQTTBrokerConfig.getBrokerLabel(brokerUrl);
            select.appendChild(option);
        });
        select.value = MQTTBrokerConfig.getSelectedBroker();

        select.addEventListener('change', () => {
            const selected = MQTTBrokerConfig.setSelectedBroker(select.value);
            UI.updateBrokerStatus('idle', `已选择 ${MQTTBrokerConfig.getBrokerLabel(selected)}`);
        });

        window.addEventListener('avalon-broker-status', (event) => {
            const detail = event.detail || {};
            UI.updateBrokerStatus(detail.state, detail.message);
        });
    },

    bindEvents() {
        document.getElementById('reconnect-btn').addEventListener('click', () => database.reconnectNow());
        document.getElementById('player-notes-btn').addEventListener('click', () => UI.openPlayerNotes());
        document.getElementById('player-notes-close').addEventListener('click', () => document.getElementById('player-notes-dialog').close());
        document.getElementById('player-notes-clear').addEventListener('click', () => {
            PlayerNotes.clear();
            UI.renderPlayerNotes();
        });
        window.addEventListener('avalon-room-resumed', () => {
            if (!RoomManager.roomRef) return;
            if (GameManager.gameData) window.onGameChange(GameManager.gameData);
            if (RoomManager.isHost && RoomManager.roomState === 'playing' && GameManager.gameData?.phase !== 'ended') {
                database.sendAction('reconcilePresence', {}).catch(() => undefined);
            }
        });
        document.getElementById('create-room-btn').addEventListener('click', () => this.createRoom());
        document.getElementById('join-room-btn').addEventListener('click', () => this.joinRoom());

        document.getElementById('room-code').addEventListener('input', (event) => {
            event.target.value = event.target.value.toUpperCase();
        });

        document.getElementById('player-name').addEventListener('keypress', (event) => {
            if (event.key === 'Enter') this.createRoom();
        });

        document.getElementById('room-code').addEventListener('keypress', (event) => {
            if (event.key === 'Enter') this.joinRoom();
        });

        document.getElementById('copy-code-btn').addEventListener('click', () => this.copyRoomCode());
        document.getElementById('start-game-btn').addEventListener('click', () => this.startGame());
        document.getElementById('leave-room-btn').addEventListener('click', () => this.leaveRoom());


        document.getElementById('ready-btn').addEventListener('click', () => this.setReady());
        document.getElementById('vote-approve').addEventListener('click', () => this.castVote(true));
        document.getElementById('vote-reject').addEventListener('click', () => this.castVote(false));
        document.getElementById('mission-success').addEventListener('click', () => this.submitMissionCard(true));
        document.getElementById('mission-fail').addEventListener('click', () => this.submitMissionCard(false));
        document.getElementById('inquisitor-btn').addEventListener('click', () => this.showInquisitorModal());
        document.getElementById('inquisitor-cancel').addEventListener('click', () => this.hideInquisitorModal());
        document.getElementById('return-lobby-btn').addEventListener('click', () => this.backToLobby());
        window.addEventListener('avalon-inquisitor-result', (event) => {
            const result = event.detail;
            if (!result) return;
            UI.showToast(`${result.player} 在任务 ${result.mission} 提交了: ${result.vote}`, 6000);
        });
    },

    async restoreSession() {
        try {
            const restored = await RoomManager.restoreSession();
            if (!restored) return;

            document.getElementById('display-room-code').textContent = restored.roomCode;
            this.updateLobbyPanels();

            if (restored.state === 'waiting') {
                UI.showView('lobby');
                UI.renderLobbyPlayers(RoomManager.latestPlayers);
                this.updateLobbyPanels();
            }

            UI.showToast('已恢复房间连接');
        } catch (error) {
            console.warn('[App] Session restore failed', error);
            UI.showToast('恢复连接失败，已保留房间记录；可刷新重试。', 6000);
        }
    },

    updateLobbyPanels() {
        const hostPanel = document.getElementById('host-panel');
        const guestPanel = document.getElementById('guest-panel');

        hostPanel.style.display = RoomManager.isHost ? 'block' : 'none';
        guestPanel.style.display = RoomManager.isHost ? 'none' : 'block';

        Workshop.renderLobby();
        if (RoomManager.roomState !== 'waiting') document.getElementById('workshop-dialog').close();
    },

    clearTimer(timerKey) {
        if (this.phaseTimers[timerKey]) {
            clearTimeout(this.phaseTimers[timerKey]);
            this.phaseTimers[timerKey] = null;
        }
    },

    clearPhaseTimers(exceptKeys = []) {
        Object.keys(this.phaseTimers).forEach((timerKey) => {
            if (!exceptKeys.includes(timerKey)) {
                this.clearTimer(timerKey);
            }
        });
    },

    scheduleVoteResultAdvance() {
        if (!RoomManager.isHost || this.phaseTimers.voteResult) return;

        this.phaseTimers.voteResult = setTimeout(async () => {
            this.phaseTimers.voteResult = null;

            const phaseSnapshot = await RoomManager.roomRef.child('game/phase').once('value');
            if (phaseSnapshot.val() !== 'voteResult') return;

            try {
                await GameManager._proceedAfterVoteResult();
            } catch (error) {
                console.warn('[App] Vote-result advance failed; retrying', error);
                this.scheduleVoteResultAdvance();
            }
        }, 5000);
    },

    scheduleMissionResultAdvance() {
        if (!RoomManager.isHost || this.phaseTimers.missionResult) return;

        this.phaseTimers.missionResult = setTimeout(async () => {
            this.phaseTimers.missionResult = null;

            const phaseSnapshot = await RoomManager.roomRef.child('game/phase').once('value');
            if (phaseSnapshot.val() !== 'missionResult') return;

            try {
                await GameManager._proceedAfterMissionResult();
            } catch (error) {
                console.warn('[App] Mission-result advance failed; retrying', error);
                this.scheduleMissionResultAdvance();
            }
        }, 5000);
    },

    resumeHostControlledPhase() {
        if (!RoomManager.isHost || !GameManager.gameData) return;

        switch (GameManager.gameData.phase) {
            case 'roundSkill':
                this.scheduleSkillsAdvance();
                break;
            case 'voteResult':
                this.scheduleVoteResultAdvance();
                break;
            case 'missionResult':
                this.scheduleMissionResultAdvance();
                break;
            case 'ended':
                break;
        }
    },

    scheduleSkillsAdvance() {
        if (!RoomManager.isHost || this.phaseTimers.roundSkill || GameManager.gameData?.phase !== 'roundSkill') return;
        const gameId = GameManager.gameData.gameId;
        const mission = GameManager.gameData.currentMission;
        this.phaseTimers.roundSkill = setTimeout(async () => {
            this.phaseTimers.roundSkill = null;
            if (GameManager.gameData?.gameId !== gameId || GameManager.gameData?.currentMission !== mission || GameManager.gameData?.phase !== 'roundSkill') return;
            try { await database.sendAction('advanceSkills', {}); }
            catch (_) {
                this.phaseTimers.roundSkill = setTimeout(() => { this.phaseTimers.roundSkill = null; this.scheduleSkillsAdvance(); }, 1000);
            }
        }, Math.max(0, GameManager.gameData.skillDeadline - Date.now()) + 30);
    },

    updateResultControls() {
        document.getElementById('return-lobby-btn').style.display = RoomManager.isHost ? 'block' : 'none';
        document.getElementById('result-host-waiting').style.display = RoomManager.isHost ? 'none' : 'block';
    },

    abortOrphanedGameIfNeeded(game = GameManager.gameData) {
        if (
            this.orphanedGameAbortPending
            || !RoomManager.isHost
            || RoomManager.gameStartPending
            || RoomManager.roomState !== 'playing'
            || !game
            || game.phase === 'ended'
            || database.getHostSecrets?.()?.gameId === game.gameId
        ) {
            return;
        }

        this.orphanedGameAbortPending = true;
        RoomManager.roomRef.child('game').transaction((currentGame) => {
            if (!currentGame || currentGame.phase === 'ended') return;
            currentGame.phase = 'ended';
            currentGame.winners = 'aborted';
            currentGame.winReason = '原房主离线；为避免秘密身份泄露，本局已安全中止';
            return currentGame;
        }, undefined, false).catch((error) => {
            console.warn('[App] Failed to abort orphaned game', error);
        }).finally(() => {
            this.orphanedGameAbortPending = false;
        });
    },

    async createRoom() {
        if (this.roomActionPending || this.sessionRestorePending) return;

        const name = document.getElementById('player-name').value.trim();
        if (!name) {
            UI.showToast('请输入昵称');
            return;
        }

        this.roomActionPending = true;
        this.setHomeActionsBusy(true);

        try {
            const code = await RoomManager.createRoom(name);
            document.getElementById('display-room-code').textContent = code;
            UI.showView('lobby');
            UI.renderLobbyPlayers(RoomManager.latestPlayers);
            this.updateLobbyPanels();
            UI.showToast('房间创建成功: ' + code);
        } catch (error) {
            RoomManager._cleanup(true);
            UI.showToast('创建失败: ' + error.message);
        } finally {
            this.roomActionPending = false;
            this.setHomeActionsBusy(false);
        }
    },

    async joinRoom() {
        if (this.roomActionPending || this.sessionRestorePending) return;

        const name = document.getElementById('player-name').value.trim();
        const code = document.getElementById('room-code').value.trim().toUpperCase();

        if (!name) {
            UI.showToast('请输入昵称');
            return;
        }

        if (!code) {
            UI.showToast('请输入房间号');
            return;
        }

        this.roomActionPending = true;
        this.setHomeActionsBusy(true);

        try {
            await RoomManager.joinRoom(code, name);
            document.getElementById('display-room-code').textContent = code;
            UI.showView('lobby');
            UI.renderLobbyPlayers(RoomManager.latestPlayers);
            this.updateLobbyPanels();
            UI.showToast('已加入房间');
        } catch (error) {
            RoomManager._cleanup(true);
            UI.showToast('加入失败: ' + error.message);
        } finally {
            this.roomActionPending = false;
            this.setHomeActionsBusy(false);
        }
    },

    copyRoomCode() {
        const code = RoomManager.currentRoom;
        if (!code) return;

        if (navigator.clipboard) {
            navigator.clipboard.writeText(code);
        } else {
            const input = document.createElement('input');
            input.value = code;
            document.body.appendChild(input);
            input.select();
            document.execCommand('copy');
            document.body.removeChild(input);
        }

        UI.showToast('已复制房间号: ' + code);
    },

    async leaveRoom() {
        if (this.roomActionPending) return;
        if (!confirm('确定要离开当前房间吗？')) {
            return;
        }

        this.roomActionPending = true;
        try {
            await RoomManager.leaveRoom();
            this.clearPhaseTimers();
            UI.showView('home');
            UI.showToast('已离开房间');
        } catch (error) {
            UI.showToast('离开失败: ' + error.message);
        } finally {
            this.roomActionPending = false;
        }
    },

    async startGame() {
        try {
            await RoomManager.startGame();
        } catch (error) {
            UI.showToast('开始失败: ' + error.message);
        }
    },

    async setReady() {
        await this.runGameAction(async () => {
            await RoomManager.setReady(true);
            document.getElementById('ready-btn').style.display = 'none';
            UI.showToast('已准备，等待其他玩家');
        }, '准备失败');
    },

    castVote(approve) {
        return this.runGameAction(() => GameManager.castVote(approve), '投票失败');
    },

    submitMissionCard(success) {
        return this.runGameAction(() => GameManager.submitMissionCard(success), '提交任务牌失败');
    },

    voteInitiateTribunal(agree) {
        return GameManager.voteToInitiateTribunal(agree);
    },

    castTribunalVote(targetId) {
        return GameManager.castTribunalVote(targetId);
    },

    async assassinate(targetId) {
        if (!confirm('确定刺杀这名玩家吗？')) {
            return;
        }

        await this.runGameAction(() => GameManager.assassinate(targetId), '刺杀失败');
    },

    showInquisitorModal() {
        if (!GameManager.canUseInquisitorSkill()) {
            UI.showToast('当前不能使用该技能');
            return;
        }

        const eligibleTargets = GameManager.getInquisitorEligibleTargetIds(GameManager.gameData);
        if (eligibleTargets.length === 0) {
            UI.showToast('上一轮没有可查看的上车玩家');
            return;
        }

        const modalDescription = document.querySelector('#inquisitor-modal p');
        const lastMission = GameManager.getLastCompletedMissionIndex(GameManager.gameData);
        if (modalDescription) {
            modalDescription.textContent = lastMission === null
                ? '选择上一轮上车的玩家，查看其任务牌'
                : `选择第 ${lastMission + 1} 轮上车的玩家，查看其提交的是成功还是失败`;
        }

        UI.renderInquisitorTargets(GameManager.players, GameManager.gameData);
        document.getElementById('inquisitor-modal').style.display = 'flex';
    },

    hideInquisitorModal() {
        document.getElementById('inquisitor-modal').style.display = 'none';
    },

    async useInquisitorSkill(targetId) {
        const result = await this.runGameAction(
            () => GameManager.useInquisitorSkill(targetId),
            '使用审判官技能失败'
        );
        this.hideInquisitorModal();

        if (!result || result.delivered) return;

        if (result.noData) {
            UI.showToast('第一轮没有可查看的任务记录');
            return;
        }

        UI.showToast(`${result.player} 在任务 ${result.mission} 提交了: ${result.vote}`, 5000);
    },

    async backToLobby() {
        if (RoomManager.isHost) {
            await RoomManager.resetToLobby();
        }

        UI.showView('lobby');
        document.getElementById('role-info-panel').style.display = 'none';
    },

    toggleRolePanel() {
        document.getElementById('role-info-panel').classList.toggle('expanded');
    },

    showRolePanel(role) {
        if (!role) return;

        const panel = document.getElementById('role-info-panel');
        const header = panel.querySelector('.role-info-header');

        panel.style.display = 'block';
        document.getElementById('role-panel-icon').textContent = role.icon || '?';
        document.getElementById('role-panel-name').textContent = role.name || 'Unknown';
        document.getElementById('role-panel-desc').textContent = UI.getRoleDescription(role);

        header.style.borderLeftWidth = '4px';
        header.style.borderLeftStyle = 'solid';

        if (role.team === 'good') {
            header.style.borderLeftColor = 'var(--accent-blue)';
        } else if (role.team === 'evil') {
            header.style.borderLeftColor = 'var(--accent-red)';
        } else {
            header.style.borderLeftColor = 'var(--accent-gold)';
        }
    },

    refreshSelectionView() {
        if (RoomManager.currentRoom && ['selectTeam', 'selectExile'].includes(GameManager.gameData?.phase)) {
            window.onGameChange(GameManager.gameData);
        }
    },

    selectTeamMember(playerId) {
        return this.runGameAction(() => GameManager.selectTeamMember(playerId));
    },

    chooseAction(actionType) {
        return this.runGameAction(() => GameManager.chooseActionType(actionType));
    },

    confirmTeamForVote() {
        return this.runGameAction(() => GameManager.confirmTeamForVote());
    },

    selectExileTarget(playerId) {
        return this.runGameAction(() => GameManager.selectExileTarget(playerId));
    },

    confirmExileForVote() {
        return this.runGameAction(() => GameManager.confirmExileForVote());
    }
};

window.onSelectionDraftChange = () => App.refreshSelectionView();

window.onPlayersChange = (players) => {
    GameManager.players = players;
    App.updateLobbyPanels();

    if (
        !RoomManager.isLeaving
        && RoomManager.playerId
        && RoomManager.currentRoom
        && !players[RoomManager.playerId]
    ) {
        RoomManager._cleanup(true);
        App.clearPhaseTimers();
        UI.showView('home');
        UI.showToast('你已不在当前房间');
        return;
    }

    if (UI.currentView === 'lobby') {
        UI.renderLobbyPlayers(players);
    }

    if (UI.currentView === 'role' && GameManager.gameData) {
        const readyStatus = UI.renderRoleReadyStatus(players, GameManager.gameData);

        if (readyStatus && readyStatus.readyCount === readyStatus.totalCount && readyStatus.totalCount > 0 && RoomManager.isHost) {
            database.sendAction('reconcilePresence', {}).catch(() => undefined);
        }
    }

    App.refreshSelectionView();
    if (document.getElementById('player-notes-dialog')?.open) UI.renderPlayerNotes();

    if (RoomManager.isHost && RoomManager.roomState === 'playing' && GameManager.gameData) {
        database.sendAction('reconcilePresence', {}).catch((error) => {
            console.warn('[App] Presence reconciliation skipped', error);
        });
    }
};

window.onHostChange = () => {
    App.updateLobbyPanels();
    if (GameManager.gameData?.phase === 'ended') App.updateResultControls();
    App.resumeHostControlledPhase();
    App.abortOrphanedGameIfNeeded();
};

window.onRoomStateChange = (state) => {
    App.updateLobbyPanels();

    if (state === 'playing' && UI.currentView === 'lobby') {
        UI.showView('role');
    }

    if (state === 'waiting' && RoomManager.currentRoom && UI.currentView !== 'lobby') {
        UI.showView('lobby');
        UI.renderLobbyPlayers(RoomManager.latestPlayers);
        App.updateLobbyPanels();
        document.getElementById('role-info-panel').style.display = 'none';
    }
};

window.onSettingsChange = (settings) => {
    RoomManager.latestSettings = settings;
    App.updateLobbyPanels();
};

window.onGameChange = (game) => {
    GameManager.gameData = game;
    Workshop.updateGame(game);
    PlayerNotes.useGame(database.brokerUrl, RoomManager.currentRoom, RoomManager.playerId, game);
    GameManager.syncSelectionDraft(game);

    if (!game) {
        App.clearPhaseTimers();
        return;
    }

    App.abortOrphanedGameIfNeeded(game);

    if (game.playerOrder && !game.playerOrder.includes(RoomManager.playerId)) {
        UI.showToast('你没有加入当前对局');
        return;
    }

    const playerNames = {};
    for (const [playerId, player] of Object.entries(GameManager.players || {})) {
        playerNames[playerId] = player.name;
    }

    App.clearPhaseTimers(
        game.phase === 'voteResult' ? ['voteResult']
            : game.phase === 'missionResult' ? ['missionResult']
            : game.phase === 'roundSkill' ? ['roundSkill']
            : []
    );

    switch (game.phase) {
        case 'roundSkill': {
            Workshop.renderSkill(game);
            App.showRolePanel(GameManager.getMyRole(game));
            App.scheduleSkillsAdvance();
            break;
        }
        case 'night': {
            const myRole = GameManager.getMyRole(game);
            UI.renderRoleCard(myRole, GameManager.privateNightInfo, playerNames);
            if (!myRole) document.getElementById('role-name').textContent = '正在安全接收身份...';
            UI.showView('role');
            UI.renderRoleReadyStatus(GameManager.players, game);
            App.showRolePanel(myRole);
            break;
        }

        case 'captainChoice': {
            UI.showView('game');
            App.showRolePanel(GameManager.getMyRole(game));
            UI.renderMissionTrack(game.missionResults, game.currentMission, game.playerOrder.length);
            UI.renderRejectTrack(game.rejectCount || 0);

            const captain = GameManager.getCaptain(game);
            document.getElementById('game-status-text').textContent = '队长选择本轮行动';
            document.getElementById('captain-info').textContent = `当前队长: ${captain.name}`;

            UI.renderGamePlayers(GameManager.players, game, false, null);

            if (GameManager.isCaptain(game)) {
                UI.renderActionPanel(`
                    <p style="text-align: center; margin-bottom: 16px;">请选择本轮行动</p>
                    <div class="action-choice">
                        <button class="btn btn-primary" onclick="App.chooseAction('mission')">
                            <span>发起任务</span>
                        </button>
                        <button class="btn btn-danger" onclick="App.chooseAction('tribunal')" ${GameManager.canExile(game) ? '' : 'disabled'}>
                            <span>发起放逐</span>
                        </button>
                    </div>
                `);
            } else {
                UI.renderActionPanel(`
                    <p style="text-align: center; color: var(--text-secondary);">
                        等待队长选择行动...
                    </p>
                `);
            }
            break;
        }

        case 'selectTeam': {
            UI.showView('game');
            App.showRolePanel(GameManager.getMyRole(game));
            UI.renderMissionTrack(game.missionResults, game.currentMission, game.playerOrder.length);
            UI.renderRejectTrack(game.rejectCount || 0);

            const captain = GameManager.getCaptain(game);
            const isCaptain = GameManager.isCaptain(game);
            const teamSize = GameManager.getCurrentMissionSize(game);
            const selectionView = GameManager.getSelectionView(game);
            const submitting = !!GameManager.selectionDraft?.submitting;
            const selectedCount = (selectionView.selectedTeam || []).length;

            document.getElementById('game-status-text').textContent = '队长选择任务队员';
            document.getElementById('captain-info').textContent = `当前队长: ${captain.name}`;

            UI.renderGamePlayers(GameManager.players, selectionView, isCaptain && !submitting, (playerId) => App.selectTeamMember(playerId));

            if (isCaptain) {
                UI.renderActionPanel(`
                    <p style="text-align: center; margin-bottom: 12px;">
                        选择 ${teamSize} 名队员（已选 ${selectedCount}/${teamSize}）
                    </p>
                    <p class="hint">本地选择，确认后向全员公布队伍</p>
                    <button class="btn btn-primary" onclick="App.confirmTeamForVote()" ${selectedCount === teamSize && !submitting ? '' : 'disabled'}>
                        <span>${submitting ? '正在提交…' : '确认队伍并投票'}</span>
                    </button>
                `);
            } else {
                UI.renderActionPanel(`
                    <p style="text-align: center; color: var(--text-secondary);">
                        等待队长选择队员...
                    </p>
                `);
            }

            UI.updateInquisitorButton(GameManager.canUseInquisitorSkill());
            break;
        }

        case 'selectExile': {
            UI.showView('game');
            App.showRolePanel(GameManager.getMyRole(game));
            UI.renderMissionTrack(game.missionResults, game.currentMission, game.playerOrder.length);
            UI.renderRejectTrack(game.rejectCount || 0);

            const captain = GameManager.getCaptain(game);
            const isCaptain = GameManager.isCaptain(game);
            const selectionView = GameManager.getSelectionView(game);
            const submitting = !!GameManager.selectionDraft?.submitting;
            const hasTarget = !!selectionView.exileTarget;
            const targetName = hasTarget ? (GameManager.players[selectionView.exileTarget]?.name || selectionView.exileTarget) : '未选择';

            document.getElementById('game-status-text').textContent = '队长选择放逐目标';
            document.getElementById('captain-info').textContent = `当前队长: ${captain.name}`;

            UI.renderExileTargetSelection(GameManager.players, selectionView, isCaptain && !submitting, (playerId) => App.selectExileTarget(playerId));

            if (isCaptain) {
                UI.renderActionPanel(`
                    <p style="text-align: center; margin-bottom: 12px;">放逐目标: ${UI.escapeHTML(targetName)}</p>
                    <p class="hint">本地选择，确认后向全员公布目标</p>
                    <button class="btn btn-danger" onclick="App.confirmExileForVote()" ${hasTarget && !submitting ? '' : 'disabled'}>
                        <span>${submitting ? '正在提交…' : '确认放逐并投票'}</span>
                    </button>
                `);
            } else {
                UI.renderActionPanel(`
                    <p style="text-align: center; color: var(--text-secondary);">
                        等待队长选择放逐目标...
                    </p>
                `);
            }
            break;
        }

        case 'vote': {
            UI.showView('vote');
            const hasVoted = game.votes?.[RoomManager.playerId] !== undefined;
            const activePlayers = GameManager.getActivePlayerIds(game);

            if (hasVoted) {
                const votedCount = Object.keys(game.votes || {}).filter((playerId) => activePlayers.includes(playerId)).length;
                UI.showVoteWaiting(votedCount, activePlayers.length);
                break;
            }

            if (game.voteType === 'mission') {
                UI.renderVoteView(game.selectedTeam || [], GameManager.players, '是否同意这次任务队伍出发？');
            } else if (game.voteType === 'exile') {
                const targetName = GameManager.players[game.exileTarget]?.name || '未知';
                UI.renderExileVoteView(targetName, '是否同意放逐这名玩家？');
            }
            break;
        }

        case 'voteResult': {
            UI.showView('vote-result');

            const approveList = document.getElementById('vote-approve-list');
            const rejectList = document.getElementById('vote-reject-list');
            approveList.innerHTML = '';
            rejectList.innerHTML = '';

            for (const playerId of GameManager.getActivePlayerIds(game)) {
                const li = document.createElement('li');
                li.textContent = GameManager.players[playerId]?.name || playerId;

                if (game.votes?.[playerId] === true) {
                    approveList.appendChild(li);
                } else {
                    rejectList.appendChild(li);
                }
            }

            const resultStatus = document.getElementById('vote-result-status');
            if (game.voteResultApproved) {
                resultStatus.textContent = `投票通过 (${game.voteResultApproves} : ${game.voteResultRejects})`;
                resultStatus.style.color = 'var(--accent-green)';
            } else {
                resultStatus.textContent = `投票否决 (${game.voteResultApproves} : ${game.voteResultRejects})`;
                resultStatus.style.color = 'var(--accent-red)';
            }

            let countdown = 5;
            const countdownEl = document.getElementById('vote-countdown-num');
            countdownEl.textContent = countdown;

            const countdownInterval = setInterval(() => {
                countdown--;
                if (countdown >= 0) {
                    countdownEl.textContent = countdown;
                } else {
                    clearInterval(countdownInterval);
                }
            }, 1000);

            App.scheduleVoteResultAdvance();
            break;
        }

        case 'mission': {
            UI.showView('mission');
            const isOnTeam = (game.selectedTeam || []).includes(RoomManager.playerId);
            const myRole = GameManager.getMyRole(game);
            const canFail = GameManager.canRoleSubmitFail(myRole, RoomManager.playerId, game);

            if (game.missionSubmitted?.[RoomManager.playerId]) {
                document.getElementById('mission-instruction').textContent = '等待其他队员完成任务...';
                document.getElementById('mission-success').style.display = 'none';
                document.getElementById('mission-fail').style.display = 'none';
                document.getElementById('mission-waiting').style.display = 'block';
            } else {
                UI.renderMissionView(isOnTeam, canFail);
            }
            break;
        }

        case 'missionResult': {
            UI.showView('mission-result');
            document.getElementById('mission-success-count').textContent = game.missionResultSuccessCount || 0;
            document.getElementById('mission-fail-count').textContent = game.missionResultFailCount || 0;

            const resultStatus = document.getElementById('mission-result-status');
            if (game.missionResultSuccess) {
                resultStatus.textContent = `任务成功 · 计 ${game.missionWeights?.[game.currentMission] || 1} 点`;
                resultStatus.style.color = 'var(--accent-green)';
            } else {
                resultStatus.textContent = `任务失败 · 计 ${game.missionWeights?.[game.currentMission] || 1} 点`;
                resultStatus.style.color = 'var(--accent-red)';
            }

            let countdown = 5;
            const countdownEl = document.getElementById('mission-countdown-num');
            countdownEl.textContent = countdown;

            const countdownInterval = setInterval(() => {
                countdown--;
                if (countdown >= 0) {
                    countdownEl.textContent = countdown;
                } else {
                    clearInterval(countdownInterval);
                }
            }, 1000);

            App.scheduleMissionResultAdvance();
            break;
        }

        case 'tribunal': {
            UI.showView('tribunal');
            UI.renderTribunalVoting(GameManager.players, game, game.tribunalVotes?.[RoomManager.playerId]);
            break;
        }

        case 'assassin': {
            UI.showView('assassin');
            UI.renderAssassinView(GameManager.players, game, GameManager.getMyRole(game)?.id === 'assassin');
            if (RoomManager.isHost && game.assassinReconnectDeadline && !App.phaseTimers.assassinReconnect) {
                App.phaseTimers.assassinReconnect = setTimeout(() => {
                    App.phaseTimers.assassinReconnect = null;
                    database.sendAction('reconcilePresence', {}).catch(() => undefined);
                }, Math.max(0, game.assassinReconnectDeadline - Date.now()));
            }
            break;
        }

        case 'ended': {
            UI.showView('result');
            UI.renderResult(game, GameManager.players);
            App.updateResultControls();
            break;
        }
    }
};

document.addEventListener('DOMContentLoaded', () => {
    App.init();
});
