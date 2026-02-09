// ===== 主应用入口 =====

const App = {
    // 初始化
    init() {
        this.bindEvents();
        UI.showView('home');
    },

    // 绑定事件
    bindEvents() {
        // 首页事件
        document.getElementById('create-room-btn').addEventListener('click', () => this.createRoom());
        document.getElementById('join-room-btn').addEventListener('click', () => this.joinRoom());

        // 房间号输入自动大写
        document.getElementById('room-code').addEventListener('input', (e) => {
            e.target.value = e.target.value.toUpperCase();
        });

        // 回车键快捷操作
        document.getElementById('player-name').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.createRoom();
        });
        document.getElementById('room-code').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.joinRoom();
        });

        // 大厅事件
        document.getElementById('copy-code-btn').addEventListener('click', () => this.copyRoomCode());
        document.getElementById('start-game-btn').addEventListener('click', () => this.startGame());
        document.getElementById('leave-room-btn').addEventListener('click', () => this.leaveRoom());

        // 中立角色选择
        document.getElementById('neutral-scapegoat').addEventListener('change', () => this.updateNeutralPool());
        document.getElementById('neutral-armsdealer').addEventListener('change', () => this.updateNeutralPool());
        document.getElementById('neutral-cultist').addEventListener('change', () => this.updateNeutralPool());

        // 角色查看
        document.getElementById('ready-btn').addEventListener('click', () => this.setReady());

        // 投票
        document.getElementById('vote-approve').addEventListener('click', () => this.castVote(true));
        document.getElementById('vote-reject').addEventListener('click', () => this.castVote(false));

        // 任务
        document.getElementById('mission-success').addEventListener('click', () => this.submitMissionCard(true));
        document.getElementById('mission-fail').addEventListener('click', () => this.submitMissionCard(false));

        // 审判官
        document.getElementById('inquisitor-btn').addEventListener('click', () => this.showInquisitorModal());
        document.getElementById('inquisitor-cancel').addEventListener('click', () => this.hideInquisitorModal());

        // 返回大厅
        document.getElementById('back-to-lobby').addEventListener('click', () => this.backToLobby());
    },

    // 创建房间
    async createRoom() {
        const name = document.getElementById('player-name').value.trim();
        if (!name) {
            UI.showToast('请输入昵称');
            return;
        }

        try {
            const code = await RoomManager.createRoom(name);
            document.getElementById('display-room-code').textContent = code;
            document.getElementById('host-panel').style.display = 'block';
            document.getElementById('guest-panel').style.display = 'none';
            UI.showView('lobby');
            UI.showToast('房间创建成功: ' + code);
        } catch (error) {
            UI.showToast('创建失败: ' + error.message);
        }
    },

    // 加入房间
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
            document.getElementById('host-panel').style.display = 'none';
            document.getElementById('guest-panel').style.display = 'block';
            UI.showView('lobby');
            UI.showToast('已加入房间');
        } catch (error) {
            UI.showToast('加入失败: ' + error.message);
        }
    },

    // 复制房间号
    copyRoomCode() {
        const code = RoomManager.currentRoom;
        if (navigator.clipboard) {
            navigator.clipboard.writeText(code);
            UI.showToast('已复制房间号: ' + code);
        } else {
            // 兼容处理
            const input = document.createElement('input');
            input.value = code;
            document.body.appendChild(input);
            input.select();
            document.execCommand('copy');
            document.body.removeChild(input);
            UI.showToast('已复制房间号: ' + code);
        }
    },

    // 退出房间
    async leaveRoom() {
        if (!confirm('确定要退出房间吗？')) {
            return;
        }

        try {
            await RoomManager.leaveRoom();
            UI.showView('home');
            UI.showToast('已退出房间');
        } catch (error) {
            UI.showToast('退出失败: ' + error.message);
        }
    },

    // 更新中立角色池
    async updateNeutralPool() {
        const pool = [];
        if (document.getElementById('neutral-scapegoat').checked) pool.push('scapegoat');
        if (document.getElementById('neutral-armsdealer').checked) pool.push('armsdealer');
        if (document.getElementById('neutral-cultist').checked) pool.push('cultist');

        if (pool.length === 0) {
            UI.showToast('至少选择一个中立角色');
            return;
        }

        await RoomManager.updateNeutralPool(pool);
    },

    // 开始游戏
    async startGame() {
        try {
            await RoomManager.startGame();
        } catch (error) {
            UI.showToast('开始失败: ' + error.message);
        }
    },

    // 设置准备
    async setReady() {
        await RoomManager.setReady(true);
        // 隐藏准备按钮，显示已准备提示
        document.getElementById('ready-btn').style.display = 'none';
        UI.showToast('✅ 你已准备，等待其他玩家...');
    },

    // 投票
    async castVote(approve) {
        await GameManager.castVote(approve);
    },

    // 提交任务卡
    async submitMissionCard(success) {
        await GameManager.submitMissionCard(success);
    },

    // 发起放逐投票
    async voteInitiateTribunal(agree) {
        await GameManager.voteToInitiateTribunal(agree);
    },

    // 放逐投票
    async castTribunalVote(targetId) {
        await GameManager.castTribunalVote(targetId);
    },

    // 刺杀
    async assassinate(targetId) {
        if (confirm('确定要刺杀这名玩家吗？')) {
            await GameManager.assassinate(targetId);
        }
    },

    // 审判官弹窗
    showInquisitorModal() {
        if (!GameManager.canUseInquisitorSkill()) {
            UI.showToast('技能不可用');
            return;
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

        if (result) {
            if (result.noData) {
                UI.showToast('第一轮没有投票记录');
            } else {
                UI.showToast(`${result.player} 在任务${result.mission}投票: ${result.vote}`, 5000);
            }
        }
    },

    // 返回大厅
    async backToLobby() {
        if (RoomManager.isHost) {
            await RoomManager.resetToLobby();
        }
        UI.showView('lobby');
        // 隐藏角色面板
        document.getElementById('role-info-panel').style.display = 'none';
    },

    // 切换角色面板展开/收起
    toggleRolePanel() {
        const panel = document.getElementById('role-info-panel');
        panel.classList.toggle('expanded');
    },

    // 显示角色面板
    showRolePanel(role) {
        if (!role) return;
        const panel = document.getElementById('role-info-panel');
        panel.style.display = 'block';

        document.getElementById('role-panel-icon').textContent = role.icon || '?';
        document.getElementById('role-panel-name').textContent = role.name || '未知';
        document.getElementById('role-panel-desc').textContent = role.desc || '';

        // 根据阵营设置颜色
        const header = panel.querySelector('.role-info-header');
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

    // 队长选人
    selectTeamMember(playerId) {
        GameManager.selectTeamMember(playerId);
    },

    // 队长选择行动类型
    chooseAction(actionType) {
        GameManager.chooseActionType(actionType);
    },

    // 确认队伍并进入表决
    confirmTeamForVote() {
        GameManager.confirmTeamForVote();
    },

    // 队长选择放逐目标
    selectExileTarget(playerId) {
        GameManager.selectExileTarget(playerId);
    },

    // 确认放逐目标并进入表决
    confirmExileForVote() {
        GameManager.confirmExileForVote();
    }
};

// ===== Firebase 回调 =====

window.onPlayersChange = (players) => {
    GameManager.players = players;

    if (UI.currentView === 'lobby') {
        UI.renderLobbyPlayers(players);
    }

    // 在角色查看阶段显示准备状态
    if (UI.currentView === 'role' && GameManager.gameData) {
        console.log('[DEBUG] In role view, rendering ready status');
        const result = UI.renderRoleReadyStatus(players, GameManager.gameData);
        console.log('[DEBUG] Ready result:', result);

        // 检查是否所有人都准备好了
        if (result && result.readyCount === result.totalCount && result.totalCount > 0) {
            console.log('[DEBUG] All players ready! Transitioning...');
            // 所有人准备好，自动进入游戏（由房主触发）
            if (RoomManager.isHost) {
                console.log('[DEBUG] Host setting phase to selectTeam');
                RoomManager.roomRef.child('game/phase').set('selectTeam');
            }
        }
    }
};

window.onRoomStateChange = (state) => {
    if (state === 'playing' && UI.currentView === 'lobby') {
        UI.showView('role');
    }
};

window.onSettingsChange = (settings) => {
    // 同步中立角色设置到UI
    if (settings.neutralPool) {
        document.getElementById('neutral-scapegoat').checked = settings.neutralPool.includes('scapegoat');
        document.getElementById('neutral-armsdealer').checked = settings.neutralPool.includes('armsdealer');
        document.getElementById('neutral-cultist').checked = settings.neutralPool.includes('cultist');
    }
};

window.onGameChange = (game) => {
    console.log('[DEBUG] onGameChange - game:', game);
    console.log('[DEBUG] onGameChange - phase:', game?.phase);
    console.log('[DEBUG] onGameChange - playerOrder:', game?.playerOrder);

    if (!game) return;

    // 检查游戏数据完整性（避免部分更新导致错误）
    if (!game.phase) {
        console.warn('[DEBUG] Game data incomplete, missing phase');
        return;
    }

    GameManager.gameData = game;

    // 获取玩家名字映射
    const playerNames = {};
    for (const [pid, player] of Object.entries(GameManager.players)) {
        playerNames[pid] = player.name;
    }

    // 根据阶段更新UI
    switch (game.phase) {
        case 'night':
            const myRole = GameManager.getMyRole();
            const nightInfo = getNightInfo(myRole,
                // 需要完整角色对象
                Object.fromEntries(
                    Object.entries(game.roles).map(([pid, roleId]) =>
                        [pid, GameManager.getRoleById(roleId)]
                    )
                ),
                RoomManager.playerId
            );
            UI.renderRoleCard(myRole, nightInfo, playerNames);
            UI.showView('role');
            // 初始渲染准备状态
            UI.renderRoleReadyStatus(GameManager.players, game);
            // 显示角色面板
            App.showRolePanel(myRole);
            break;

        case 'captainChoice':
            UI.showView('game');
            App.showRolePanel(GameManager.getMyRole());

            if (!game.playerOrder || game.playerOrder.length === 0) {
                document.getElementById('game-status-text').textContent = '错误: 玩家列表丢失';
                break;
            }

            UI.renderMissionTrack(game.missionResults, game.currentMission, game.playerOrder.length);
            UI.renderRejectTrack(game.rejectCount || 0);

            const captainCC = GameManager.getCaptain();
            document.getElementById('game-status-text').textContent = '队长选择行动类型';
            document.getElementById('captain-info').textContent = `当前队长: ${captainCC?.name || '未知'}`;

            // 显示玩家列表（不可选）
            UI.renderGamePlayers(GameManager.players, game, false, null);

            if (GameManager.isCaptain()) {
                UI.renderActionPanel(`
                    <p style="text-align: center; margin-bottom: 16px;">
                        请选择本轮行动
                    </p>
                    <div class="action-choice">
                        <button class="btn btn-primary" onclick="App.chooseAction('mission')">
                            <span>🚀 发起行动</span>
                        </button>
                        <button class="btn btn-danger" onclick="App.chooseAction('tribunal')">
                            <span>⚖️ 发起放逐</span>
                        </button>
                    </div>
                `);
            } else {
                UI.renderActionPanel(`
                    <p style="text-align: center; color: var(--text-secondary);">
                        等待队长选择行动类型...
                    </p>
                `);
            }
            break;

        case 'selectTeam':
            UI.showView('game');
            App.showRolePanel(GameManager.getMyRole());

            if (!game.playerOrder || game.playerOrder.length === 0) {
                document.getElementById('game-status-text').textContent = '错误: 玩家列表丢失';
                break;
            }

            UI.renderMissionTrack(game.missionResults, game.currentMission, game.playerOrder.length);
            UI.renderRejectTrack(game.rejectCount || 0);

            const captainST = GameManager.getCaptain();
            document.getElementById('game-status-text').textContent = '队长选择任务队员';
            document.getElementById('captain-info').textContent = `当前队长: ${captainST?.name || '未知'}`;

            const isCaptainST = GameManager.isCaptain();
            UI.renderGamePlayers(GameManager.players, game, isCaptainST, (pid) => {
                App.selectTeamMember(pid);
            });

            if (isCaptainST) {
                const teamSize = GameManager.getCurrentMissionSize();
                const selected = (game.selectedTeam || []).length;
                const canConfirmTeam = selected === teamSize;
                UI.renderActionPanel(`
                    <p style="text-align: center; margin-bottom: 12px;">
                        选择 ${teamSize} 名队员 (已选 ${selected}/${teamSize})
                    </p>
                    <button class="btn btn-primary" onclick="App.confirmTeamForVote()" ${!canConfirmTeam ? 'disabled' : ''}>
                        <span>✓ 确认队伍并表决</span>
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

        case 'selectExile':
            UI.showView('game');
            App.showRolePanel(GameManager.getMyRole());

            if (!game.playerOrder || game.playerOrder.length === 0) {
                document.getElementById('game-status-text').textContent = '错误: 玩家列表丢失';
                break;
            }

            UI.renderMissionTrack(game.missionResults, game.currentMission, game.playerOrder.length);
            UI.renderRejectTrack(game.rejectCount || 0);

            const captainSE = GameManager.getCaptain();
            document.getElementById('game-status-text').textContent = '队长选择放逐目标';
            document.getElementById('captain-info').textContent = `当前队长: ${captainSE?.name || '未知'}`;

            const isCaptainSE = GameManager.isCaptain();
            // 渲染玩家选择（队长可点击选择放逐目标）
            UI.renderExileTargetSelection(GameManager.players, game, isCaptainSE, (pid) => {
                App.selectExileTarget(pid);
            });

            if (isCaptainSE) {
                const hasTarget = !!game.exileTarget;
                const targetName = hasTarget ? GameManager.players[game.exileTarget]?.name : '未选择';
                UI.renderActionPanel(`
                    <p style="text-align: center; margin-bottom: 12px;">
                        放逐目标: ${targetName}
                    </p>
                    <button class="btn btn-danger" onclick="App.confirmExileForVote()" ${!hasTarget ? 'disabled' : ''}>
                        <span>⚖️ 确认放逐并表决</span>
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

        case 'vote':
            UI.showView('vote');
            const hasVotedV = game.votes?.[RoomManager.playerId] !== undefined;

            if (hasVotedV) {
                const activePlayers = game.playerOrder.filter(pid => !(game.exiledPlayers || []).includes(pid));
                const votedCount = Object.keys(game.votes || {}).filter(pid => activePlayers.includes(pid)).length;
                UI.showVoteWaiting(votedCount, activePlayers.length);
            } else {
                // 根据投票类型显示不同内容
                if (game.voteType === 'mission') {
                    const team = game.selectedTeam || [];
                    UI.renderVoteView(team, GameManager.players, '是否同意此次任务队伍出发？');
                } else if (game.voteType === 'exile') {
                    const targetName = GameManager.players[game.exileTarget]?.name || '未知';
                    UI.renderExileVoteView(targetName, '是否同意放逐此玩家？');
                }
            }
            break;

        case 'voteResult':
            UI.showView('vote-result');

            // 显示投票结果
            const approveList = document.getElementById('vote-approve-list');
            const rejectList = document.getElementById('vote-reject-list');
            approveList.innerHTML = '';
            rejectList.innerHTML = '';

            const voteData = game.votes || {};
            const activeVoters = game.playerOrder.filter(pid => !(game.exiledPlayers || []).includes(pid));

            for (const pid of activeVoters) {
                const playerName = GameManager.players[pid]?.name || pid;
                const li = document.createElement('li');
                li.textContent = playerName;

                if (voteData[pid] === true) {
                    approveList.appendChild(li);
                } else {
                    rejectList.appendChild(li);
                }
            }

            // 显示结果状态
            const resultStatus = document.getElementById('vote-result-status');
            if (game.voteResultApproved) {
                resultStatus.textContent = `✅ 投票通过 (${game.voteResultApproves} : ${game.voteResultRejects})`;
                resultStatus.style.color = 'var(--accent-green)';
            } else {
                resultStatus.textContent = `❌ 投票否决 (${game.voteResultApproves} : ${game.voteResultRejects})`;
                resultStatus.style.color = 'var(--accent-red)';
            }

            // 倒计时显示
            let countdown = 10;
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

            // 房主负责10秒后推进到下一阶段
            // 这里使用 onGameChange 回调来确保房主一定会设置计时器
            if (RoomManager.isHost) {
                console.log('[DEBUG] Host detected voteResult phase, setting 10s timer');
                setTimeout(async () => {
                    console.log('[DEBUG] Host timer fired, proceeding after vote result');
                    // 检查当前阶段是否仍然是 voteResult（避免重复推进）
                    const currentSnapshot = await RoomManager.roomRef.child('game/phase').once('value');
                    if (currentSnapshot.val() !== 'voteResult') {
                        console.log('[DEBUG] Phase already changed, skipping');
                        return;
                    }
                    // 获取完整游戏数据
                    const freshSnapshot = await RoomManager.roomRef.child('game').once('value');
                    const freshGame = freshSnapshot.val();
                    console.log('[DEBUG] Proceeding with freshGame:', freshGame?.voteType, freshGame?.voteResultApproved);
                    await GameManager._proceedAfterVoteResult(freshGame, freshGame.voteResultApproved);
                    console.log('[DEBUG] _proceedAfterVoteResult completed');
                }, 10000);
            }
            break;

        case 'mission':
            UI.showView('mission');
            const isOnTeam = (game.selectedTeam || []).includes(RoomManager.playerId);
            const myMissionRole = GameManager.getMyRole();
            const canFail = myMissionRole?.team === 'evil' || myMissionRole?.team === 'neutral';

            if (game.missionCards?.[RoomManager.playerId] !== undefined) {
                document.getElementById('mission-instruction').textContent = '等待其他队员完成任务...';
                document.getElementById('mission-success').style.display = 'none';
                document.getElementById('mission-fail').style.display = 'none';
                document.getElementById('mission-waiting').style.display = 'block';
            } else {
                UI.renderMissionView(isOnTeam, canFail);
            }
            break;

        // tribunalPrompt 已废弃 - 队长在selectTeam阶段直接选择是否发起放逐

        case 'tribunal':
            UI.showView('tribunal');
            const myTribunalVote = game.tribunalVotes?.[RoomManager.playerId];
            UI.renderTribunalVoting(GameManager.players, game, myTribunalVote);
            break;

        case 'assassin':
            UI.showView('assassin');
            const isAssassin = GameManager.getMyRole()?.id === 'assassin';
            UI.renderAssassinView(GameManager.players, game, isAssassin);
            break;

        case 'ended':
            UI.showView('result');
            UI.renderResult(game, GameManager.players);
            break;
    }
};

// 初始化
document.addEventListener('DOMContentLoaded', () => {
    App.init();
});
