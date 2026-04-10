const App = {
    phaseTimers: {
        voteResult: null,
        missionResult: null,
        ended: null
    },

    init() {
        this.bindEvents();
        UI.renderRuleSummaries();
        UI.showView('home');
        this.restoreSession();
    },

    bindEvents() {
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

        document.getElementById('neutral-scapegoat').addEventListener('change', () => this.updateNeutralPool());
        document.getElementById('neutral-armsdealer').addEventListener('change', () => this.updateNeutralPool());
        document.getElementById('neutral-cultist').addEventListener('change', () => this.updateNeutralPool());

        document.getElementById('ready-btn').addEventListener('click', () => this.setReady());
        document.getElementById('vote-approve').addEventListener('click', () => this.castVote(true));
        document.getElementById('vote-reject').addEventListener('click', () => this.castVote(false));
        document.getElementById('mission-success').addEventListener('click', () => this.submitMissionCard(true));
        document.getElementById('mission-fail').addEventListener('click', () => this.submitMissionCard(false));
        document.getElementById('inquisitor-btn').addEventListener('click', () => this.showInquisitorModal());
        document.getElementById('inquisitor-cancel').addEventListener('click', () => this.hideInquisitorModal());
    },

    async restoreSession() {
        try {
            const restored = await RoomManager.restoreSession();
            if (!restored) return;

            document.getElementById('display-room-code').textContent = restored.roomCode;
            this.updateLobbyPanels();

            if (restored.state === 'waiting') {
                UI.showView('lobby');
            }

            UI.showToast('已恢复房间连接');
        } catch (error) {
            console.warn('[App] Session restore failed', error);
        }
    },

    updateLobbyPanels() {
        const hostPanel = document.getElementById('host-panel');
        const guestPanel = document.getElementById('guest-panel');

        hostPanel.style.display = RoomManager.isHost ? 'block' : 'none';
        guestPanel.style.display = RoomManager.isHost ? 'none' : 'block';

        const players = GameManager.players || {};
        const connectedCount = Object.values(players).filter((player) => player && !player.left && player.connected !== false).length;
        const enableNeutral = connectedCount >= 7;
        const neutralHint = hostPanel.querySelector('.hint');

        ['neutral-scapegoat', 'neutral-armsdealer', 'neutral-cultist'].forEach((id) => {
            const checkbox = document.getElementById(id);
            checkbox.disabled = !enableNeutral;
        });

        if (neutralHint) {
            neutralHint.textContent = enableNeutral
                ? '至少选择一个中立角色，游戏会从已勾选池中随机抽取。'
                : '5-6 人局默认不开中立，7 人以上才会启用中立池。';
        }
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

            await GameManager._proceedAfterVoteResult();
        }, 5000);
    },

    scheduleMissionResultAdvance() {
        if (!RoomManager.isHost || this.phaseTimers.missionResult) return;

        this.phaseTimers.missionResult = setTimeout(async () => {
            this.phaseTimers.missionResult = null;

            const phaseSnapshot = await RoomManager.roomRef.child('game/phase').once('value');
            if (phaseSnapshot.val() !== 'missionResult') return;

            await GameManager._proceedAfterMissionResult();
        }, 5000);
    },

    scheduleReturnToLobby() {
        if (!RoomManager.isHost || this.phaseTimers.ended) return;

        this.phaseTimers.ended = setTimeout(async () => {
            this.phaseTimers.ended = null;

            const phaseSnapshot = await RoomManager.roomRef.child('game/phase').once('value');
            if (phaseSnapshot.val() !== 'ended') return;

            if (RoomManager.isHost) {
                await RoomManager.resetToLobby();
            }

            UI.showView('lobby');
            document.getElementById('role-info-panel').style.display = 'none';
        }, 5000);
    },

    resumeHostControlledPhase() {
        if (!RoomManager.isHost || !GameManager.gameData) return;

        switch (GameManager.gameData.phase) {
            case 'voteResult':
                this.scheduleVoteResultAdvance();
                break;
            case 'missionResult':
                this.scheduleMissionResultAdvance();
                break;
            case 'ended':
                this.scheduleReturnToLobby();
                break;
        }
    },

    async createRoom() {
        const name = document.getElementById('player-name').value.trim();
        if (!name) {
            UI.showToast('请输入昵称');
            return;
        }

        try {
            const code = await RoomManager.createRoom(name);
            document.getElementById('display-room-code').textContent = code;
            this.updateLobbyPanels();
            UI.showView('lobby');
            UI.showToast('房间创建成功: ' + code);
        } catch (error) {
            UI.showToast('创建失败: ' + error.message);
        }
    },

    async joinRoom() {
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

        try {
            await RoomManager.joinRoom(code, name);
            document.getElementById('display-room-code').textContent = code;
            this.updateLobbyPanels();
            UI.showView('lobby');
            UI.showToast('已加入房间');
        } catch (error) {
            UI.showToast('加入失败: ' + error.message);
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
        if (!confirm('确定要离开当前房间吗？')) {
            return;
        }

        try {
            await RoomManager.leaveRoom();
            this.clearPhaseTimers();
            UI.showView('home');
            UI.showToast('已离开房间');
        } catch (error) {
            UI.showToast('离开失败: ' + error.message);
        }
    },

    async updateNeutralPool() {
        const pool = [];
        const connectedCount = Object.values(GameManager.players || {}).filter((player) => player && !player.left && player.connected !== false).length;

        if (connectedCount >= 7) {
            if (document.getElementById('neutral-scapegoat').checked) pool.push('scapegoat');
            if (document.getElementById('neutral-armsdealer').checked) pool.push('armsdealer');
            if (document.getElementById('neutral-cultist').checked) pool.push('cultist');
        }

        if (connectedCount >= 7 && pool.length === 0) {
            UI.showToast('至少选择一个中立角色');
            return;
        }

        await RoomManager.updateNeutralPool(pool);
    },

    async startGame() {
        try {
            await RoomManager.startGame();
        } catch (error) {
            UI.showToast('开始失败: ' + error.message);
        }
    },

    async setReady() {
        await RoomManager.setReady(true);
        document.getElementById('ready-btn').style.display = 'none';
        UI.showToast('已准备，等待其他玩家');
    },

    castVote(approve) {
        return GameManager.castVote(approve);
    },

    submitMissionCard(success) {
        return GameManager.submitMissionCard(success);
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

        await GameManager.assassinate(targetId);
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
        const result = await GameManager.useInquisitorSkill(targetId);
        this.hideInquisitorModal();

        if (!result) return;

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

    selectTeamMember(playerId) {
        return GameManager.selectTeamMember(playerId);
    },

    chooseAction(actionType) {
        return GameManager.chooseActionType(actionType);
    },

    confirmTeamForVote() {
        return GameManager.confirmTeamForVote();
    },

    selectExileTarget(playerId) {
        return GameManager.selectExileTarget(playerId);
    },

    confirmExileForVote() {
        return GameManager.confirmExileForVote();
    }
};

window.onPlayersChange = (players) => {
    GameManager.players = players;
    App.updateLobbyPanels();

    if (RoomManager.playerId && RoomManager.currentRoom && !players[RoomManager.playerId]) {
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
            RoomManager.roomRef.child('game').transaction((game) => {
                if (!game || game.phase !== 'night') return game;
                game.phase = 'captainChoice';
                return game;
            }, undefined, false);
        }
    }
};

window.onHostChange = () => {
    App.updateLobbyPanels();
    App.resumeHostControlledPhase();
};

window.onRoomStateChange = (state) => {
    App.updateLobbyPanels();

    if (state === 'playing' && UI.currentView === 'lobby') {
        UI.showView('role');
    }

    if (state === 'waiting' && RoomManager.currentRoom && UI.currentView === 'home') {
        UI.showView('lobby');
    }
};

window.onSettingsChange = (settings) => {
    document.getElementById('neutral-scapegoat').checked = (settings.neutralPool || []).includes('scapegoat');
    document.getElementById('neutral-armsdealer').checked = (settings.neutralPool || []).includes('armsdealer');
    document.getElementById('neutral-cultist').checked = (settings.neutralPool || []).includes('cultist');
    App.updateLobbyPanels();
};

window.onGameChange = (game) => {
    GameManager.gameData = game;

    if (!game) {
        App.clearPhaseTimers();
        return;
    }

    if (game.roles && !game.roles[RoomManager.playerId]) {
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
            : game.phase === 'ended' ? ['ended']
            : []
    );

    switch (game.phase) {
        case 'night': {
            const myRole = GameManager.getMyRole(game);
            const roleAssignments = Object.fromEntries(
                Object.entries(game.roles || {}).map(([playerId, roleId]) => [playerId, GameManager.getRoleById(roleId)])
            );

            UI.renderRoleCard(myRole, getNightInfo(myRole, roleAssignments, RoomManager.playerId), playerNames);
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
                        <button class="btn btn-danger" onclick="App.chooseAction('tribunal')">
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
            const selectedCount = (game.selectedTeam || []).length;

            document.getElementById('game-status-text').textContent = '队长选择任务队员';
            document.getElementById('captain-info').textContent = `当前队长: ${captain.name}`;

            UI.renderGamePlayers(GameManager.players, game, isCaptain, (playerId) => App.selectTeamMember(playerId));

            if (isCaptain) {
                UI.renderActionPanel(`
                    <p style="text-align: center; margin-bottom: 12px;">
                        选择 ${teamSize} 名队员（已选 ${selectedCount}/${teamSize}）
                    </p>
                    <button class="btn btn-primary" onclick="App.confirmTeamForVote()" ${selectedCount === teamSize ? '' : 'disabled'}>
                        <span>确认队伍并投票</span>
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
            const hasTarget = !!game.exileTarget;
            const targetName = hasTarget ? (GameManager.players[game.exileTarget]?.name || game.exileTarget) : '未选择';

            document.getElementById('game-status-text').textContent = '队长选择放逐目标';
            document.getElementById('captain-info').textContent = `当前队长: ${captain.name}`;

            UI.renderExileTargetSelection(GameManager.players, game, isCaptain, (playerId) => App.selectExileTarget(playerId));

            if (isCaptain) {
                UI.renderActionPanel(`
                    <p style="text-align: center; margin-bottom: 12px;">放逐目标: ${targetName}</p>
                    <button class="btn btn-danger" onclick="App.confirmExileForVote()" ${hasTarget ? '' : 'disabled'}>
                        <span>确认放逐并投票</span>
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

            if (game.missionCards?.[RoomManager.playerId] !== undefined) {
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
                resultStatus.textContent = '任务成功';
                resultStatus.style.color = 'var(--accent-green)';
            } else {
                resultStatus.textContent = '任务失败';
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
            break;
        }

        case 'ended': {
            UI.showView('result');
            UI.renderResult(game, GameManager.players);

            let countdown = 5;
            const countdownEl = document.getElementById('result-countdown-num');
            countdownEl.textContent = countdown;

            const countdownInterval = setInterval(() => {
                countdown--;
                if (countdown >= 0) {
                    countdownEl.textContent = countdown;
                } else {
                    clearInterval(countdownInterval);
                }
            }, 1000);

            App.scheduleReturnToLobby();
            break;
        }
    }
};

document.addEventListener('DOMContentLoaded', () => {
    App.init();
});
