// ===== 游戏逻辑管理 =====

const GameManager = {
    gameData: null,
    players: {},
    myRole: null,

    // 获取角色对象
    getRoleById(roleId) {
        for (const key of Object.keys(ROLES)) {
            if (ROLES[key].id === roleId) {
                return ROLES[key];
            }
        }
        return null;
    },

    // 获取我的角色
    getMyRole() {
        if (!this.gameData || !this.gameData.roles) return null;
        const roleId = this.gameData.roles[RoomManager.playerId];
        return this.getRoleById(roleId);
    },

    // 获取当前队长
    getCaptain() {
        if (!this.gameData || !this.gameData.playerOrder) return { id: null, name: '未知' };
        const idx = this.gameData.captainIndex || 0;
        const playerId = this.gameData.playerOrder[idx];
        return { id: playerId, name: this.players[playerId]?.name || '未知' };
    },

    // 我是否是队长
    isCaptain() {
        const captain = this.getCaptain();
        return captain && captain.id === RoomManager.playerId;
    },

    // 获取下一个非放逐的队长索引
    getNextCaptainIndex(currentIndex, exiledPlayers = []) {
        if (!this.gameData || !this.gameData.playerOrder) return 0;

        const playerOrder = this.gameData.playerOrder;
        let nextIndex = (currentIndex + 1) % playerOrder.length;
        let attempts = 0;

        // 跳过被放逐的玩家
        while (exiledPlayers.includes(playerOrder[nextIndex]) && attempts < playerOrder.length) {
            nextIndex = (nextIndex + 1) % playerOrder.length;
            attempts++;
        }

        return nextIndex;
    },

    // 获取当前任务需要的队伍人数
    getCurrentMissionSize() {
        if (!this.gameData) return 0;
        const playerCount = this.gameData.playerOrder.length;
        const missionIndex = this.gameData.currentMission;
        return MISSION_SIZES[playerCount]?.[missionIndex] || 0;
    },

    // 队长选择行动类型（发起行动 或 发起放逐）
    async chooseActionType(actionType) {
        if (!this.isCaptain()) return;

        await RoomManager.roomRef.child('game').update({
            actionType: actionType, // 'mission' 或 'tribunal'
            phase: actionType === 'mission' ? 'selectTeam' : 'selectExile',
            selectedTeam: [],
            exileTarget: null
        });
    },

    // 队长选择任务队员
    async selectTeamMember(playerId) {
        if (!this.isCaptain()) return;

        const currentTeam = [...(this.gameData.selectedTeam || [])];
        const maxSize = this.getCurrentMissionSize();

        const index = currentTeam.indexOf(playerId);
        if (index > -1) {
            currentTeam.splice(index, 1);
        } else if (currentTeam.length < maxSize) {
            currentTeam.push(playerId);
        }

        await RoomManager.roomRef.child('game/selectedTeam').set(currentTeam);
    },

    // 队长选择放逐目标
    async selectExileTarget(playerId) {
        if (!this.isCaptain()) return;
        await RoomManager.roomRef.child('game/exileTarget').set(playerId);
    },

    // 队长确认队伍 - 进入表决
    async confirmTeamForVote() {
        if (!this.isCaptain()) return;
        if ((this.gameData.selectedTeam?.length || 0) !== this.getCurrentMissionSize()) return;

        await RoomManager.roomRef.child('game').update({
            phase: 'vote',
            votes: {},
            voteType: 'mission'
        });
    },

    // 队长确认放逐目标 - 进入表决
    async confirmExileForVote() {
        if (!this.isCaptain()) return;
        if (!this.gameData.exileTarget) return;

        await RoomManager.roomRef.child('game').update({
            phase: 'vote',
            votes: {},
            voteType: 'exile'
        });
    },

    // 投票赞成/反对队伍
    async castVote(approve) {
        await RoomManager.roomRef.child('game/votes/' + RoomManager.playerId).set(approve);

        // 检查是否所有人投完
        this._checkVoteComplete();
    },

    // 检查投票是否完成
    async _checkVoteComplete() {
        const snapshot = await RoomManager.roomRef.child('game').once('value');
        const game = snapshot.val();

        // 获取未流放的玩家
        const activePlayers = game.playerOrder.filter(pid => !(game.exiledPlayers || []).includes(pid));
        const votes = game.votes || {};
        const votedCount = Object.keys(votes).filter(pid => activePlayers.includes(pid)).length;

        if (votedCount >= activePlayers.length) {
            // 所有人投完，计算结果
            const approves = Object.entries(votes).filter(([pid, v]) => activePlayers.includes(pid) && v === true).length;
            const rejects = activePlayers.length - approves;
            const approved = approves > rejects;

            // 保存投票结果并进入结果展示阶段
            await RoomManager.roomRef.child('game').update({
                phase: 'voteResult',
                voteResultApproved: approved,
                voteResultApproves: approves,
                voteResultRejects: rejects
            });
            // 注意：10秒后推进到下一阶段的逻辑已移至 app.js 的 onGameChange 回调中
            // 这样可以确保房主一定会收到 phase 变化并设置计时器
        }
    },

    // 投票结果展示后继续游戏
    async _proceedAfterVoteResult(game, approved) {
        const voteType = game.voteType; // 'mission' 或 'exile'

        if (approved) {
            if (voteType === 'mission') {
                // 投票通过，执行任务
                await RoomManager.roomRef.child('game').update({
                    phase: 'mission',
                    missionCards: {},
                    rejectCount: 0
                });
            } else if (voteType === 'exile') {
                // 放逐投票通过，执行放逐
                await this._executeExile(game);
            }
        } else {
            // 投票否决
            const newRejectCount = (game.rejectCount || 0) + 1;

            if (newRejectCount >= 5) {
                // 连续否决5次，坏人直接获胜
                await this._endGame('evil', '连续5次否决队伍');
            } else {
                // 更换队长（跳过被放逐的玩家）
                const exiled = game.exiledPlayers || [];
                const newCaptainIndex = this.getNextCaptainIndex(game.captainIndex, exiled);
                await RoomManager.roomRef.child('game').update({
                    phase: 'captainChoice',
                    rejectCount: newRejectCount,
                    captainIndex: newCaptainIndex,
                    selectedTeam: [],
                    exileTarget: null,
                    actionType: null,
                    votes: {}
                });
            }
        }
    },

    // 执行放逐
    async _executeExile(game) {
        const exileTarget = game.exileTarget;
        if (!exileTarget) return;

        const exiledPlayers = [...(game.exiledPlayers || []), exileTarget];
        await RoomManager.roomRef.child('game/exiledPlayers').set(exiledPlayers);
        await RoomManager.roomRef.child('players/' + exileTarget + '/isExiled').set(true);

        // 检查胜利条件
        const exiledRole = this.getRoleById(game.roles[exileTarget]);

        // 检查是否所有坏人被放逐
        const evilPlayers = Object.entries(game.roles)
            .filter(([pid, roleId]) => {
                const role = this.getRoleById(roleId);
                return role.team === 'evil';
            })
            .map(([pid]) => pid);

        const allEvilExiled = evilPlayers.every(pid => exiledPlayers.includes(pid));

        if (allEvilExiled) {
            await this._endGame('good', '所有坏人被放逐');
            return;
        }

        // 检查好人数量
        const remainingGood = Object.entries(game.roles)
            .filter(([pid, roleId]) => {
                const role = this.getRoleById(roleId);
                return role.team === 'good' && !exiledPlayers.includes(pid);
            }).length;

        const remainingEvil = Object.entries(game.roles)
            .filter(([pid, roleId]) => {
                const role = this.getRoleById(roleId);
                return role.team === 'evil' && !exiledPlayers.includes(pid);
            }).length;

        if (remainingGood <= remainingEvil) {
            await this._endGame('evil', '好人数量不多于坏人');
            return;
        }

        // 游戏继续，下一轮
        await this._nextMission(game);
    },

    // 执行任务（成功或破坏）
    async submitMissionCard(success) {
        const myRole = this.getMyRole();

        // 好人只能投成功（除非是特殊情况）
        if (myRole.team === 'good' && !success) {
            return; // 不允许好人投失败
        }

        await RoomManager.roomRef.child('game/missionCards/' + RoomManager.playerId).set(success);

        // 记录任务投票历史（用于审判官查看）
        const currentMission = this.gameData.currentMission;
        await RoomManager.roomRef.child('game/missionHistory/' + RoomManager.playerId + '/' + currentMission).set(success);

        // 检查任务是否完成
        this._checkMissionComplete();
    },

    // 检查任务完成
    async _checkMissionComplete() {
        const snapshot = await RoomManager.roomRef.child('game').once('value');
        const game = snapshot.val();

        const team = game.selectedTeam || [];
        const cards = game.missionCards || {};
        const submittedCount = Object.keys(cards).filter(pid => team.includes(pid)).length;

        if (submittedCount >= team.length) {
            const failCount = Object.entries(cards).filter(([pid, v]) => team.includes(pid) && v === false).length;
            const successCardCount = team.length - failCount;
            const missionSuccess = failCount === 0;

            const missionResults = [...(game.missionResults || [null, null, null, null, null])];
            missionResults[game.currentMission] = missionSuccess;

            await RoomManager.roomRef.child('game/missionResults').set(missionResults);

            // 进入任务结果展示阶段
            await RoomManager.roomRef.child('game').update({
                phase: 'missionResult',
                missionResultSuccess: missionSuccess,
                missionResultSuccessCount: successCardCount,
                missionResultFailCount: failCount
            });
        }
    },

    // 任务结果展示后继续游戏
    async _proceedAfterMissionResult(game) {
        const missionResults = game.missionResults || [];
        const successCount = missionResults.filter(r => r === true).length;
        const failedCount = missionResults.filter(r => r === false).length;

        if (successCount >= 3) {
            await RoomManager.roomRef.child('game/phase').set('assassin');
        } else if (failedCount >= 3) {
            await this._endGame('evil', '破坏3次任务');
        } else {
            await this._nextMission(game);
        }
    },

    // 进入下一轮任务
    async _nextMission(game) {
        const exiled = game.exiledPlayers || [];
        const newCaptainIndex = this.getNextCaptainIndex(game.captainIndex, exiled);
        await RoomManager.roomRef.child('game').update({
            phase: 'captainChoice',
            currentMission: game.currentMission + 1,
            captainIndex: newCaptainIndex,
            selectedTeam: [],
            exileTarget: null,
            actionType: null,
            votes: {},
            missionCards: {},
            rejectCount: 0
        });
    },

    // 投票是否发起放逐会议
    async voteToInitiateTribunal(agree) {
        await RoomManager.roomRef.child('game/tribunalInitiateVotes/' + RoomManager.playerId).set(agree);

        // 检查结果
        const snapshot = await RoomManager.roomRef.child('game').once('value');
        const game = snapshot.val();

        const activePlayers = game.playerOrder.filter(pid => !(game.exiledPlayers || []).includes(pid));
        const votes = game.tribunalInitiateVotes || {};
        const votedCount = Object.keys(votes).filter(pid => activePlayers.includes(pid)).length;

        if (votedCount >= activePlayers.length) {
            const agrees = Object.entries(votes).filter(([pid, v]) => activePlayers.includes(pid) && v === true).length;

            if (agrees > activePlayers.length / 2) {
                // 发起放逐会议
                await RoomManager.roomRef.child('game').update({
                    phase: 'tribunal',
                    tribunalVotes: {}
                });
            } else {
                // 不发起，进入下一轮
                await this._nextMission(game);
            }
        }
    },

    // 放逐投票
    async castTribunalVote(targetPlayerId) {
        await RoomManager.roomRef.child('game/tribunalVotes/' + RoomManager.playerId).set(targetPlayerId);

        // 检查结果
        this._checkTribunalComplete();
    },

    // 检查放逐投票完成
    async _checkTribunalComplete() {
        const snapshot = await RoomManager.roomRef.child('game').once('value');
        const game = snapshot.val();

        const activePlayers = game.playerOrder.filter(pid => !(game.exiledPlayers || []).includes(pid));
        const votes = game.tribunalVotes || {};
        const votedCount = Object.keys(votes).filter(pid => activePlayers.includes(pid)).length;

        if (votedCount >= activePlayers.length) {
            // 统计票数
            const voteCount = {};
            for (const [voterId, targetId] of Object.entries(votes)) {
                if (activePlayers.includes(voterId)) {
                    voteCount[targetId] = (voteCount[targetId] || 0) + 1;
                }
            }

            // 找最高票
            let maxVotes = 0;
            let exiledPlayer = null;
            for (const [pid, count] of Object.entries(voteCount)) {
                if (count > maxVotes) {
                    maxVotes = count;
                    exiledPlayer = pid;
                }
            }

            // 放逐玩家
            const exiledPlayers = [...(game.exiledPlayers || []), exiledPlayer];
            await RoomManager.roomRef.child('game/exiledPlayers').set(exiledPlayers);
            await RoomManager.roomRef.child('players/' + exiledPlayer + '/isExiled').set(true);

            // 检查胜利条件
            const exiledRole = this.getRoleById(game.roles[exiledPlayer]);

            // 检查是否所有坏人被放逐
            const evilPlayers = Object.entries(game.roles)
                .filter(([pid, roleId]) => {
                    const role = this.getRoleById(roleId);
                    return role.team === 'evil';
                })
                .map(([pid]) => pid);

            const allEvilExiled = evilPlayers.every(pid => exiledPlayers.includes(pid));

            if (allEvilExiled) {
                await this._endGame('good', '所有坏人被放逐');
                return;
            }

            // 检查好人数量
            const remainingGood = Object.entries(game.roles)
                .filter(([pid, roleId]) => {
                    const role = this.getRoleById(roleId);
                    return role.team === 'good' && !exiledPlayers.includes(pid);
                }).length;

            const remainingEvil = Object.entries(game.roles)
                .filter(([pid, roleId]) => {
                    const role = this.getRoleById(roleId);
                    return role.team === 'evil' && !exiledPlayers.includes(pid);
                }).length;

            if (remainingGood <= remainingEvil) {
                await this._endGame('evil', '好人数量不多于坏人');
                return;
            }

            // 游戏继续
            await this._nextMission(game);
        }
    },

    // 刺客刺杀
    async assassinate(targetPlayerId) {
        const myRole = this.getMyRole();
        if (myRole?.id !== 'assassin') return;

        await RoomManager.roomRef.child('game/assassinTarget').set(targetPlayerId);

        // 检查是否刺中梅林
        const snapshot = await RoomManager.roomRef.child('game/roles/' + targetPlayerId).once('value');
        const targetRoleId = snapshot.val();

        if (targetRoleId === 'merlin') {
            await this._endGame('evil', '刺客成功刺杀梅林');
        } else {
            await this._endGame('good', '刺客刺杀失败');
        }
    },

    // 游戏结束
    async _endGame(winningTeam, reason) {
        await RoomManager.roomRef.child('game').update({
            phase: 'ended',
            winners: winningTeam,
            winReason: reason
        });
    },

    // 审判官使用技能
    async useInquisitorSkill(targetPlayerId) {
        const myRole = this.getMyRole();
        if (myRole?.id !== 'inquisitor') return null;

        // 检查是否已使用
        if (this.gameData.inquisitorUsed?.[RoomManager.playerId]) {
            return null;
        }

        // 标记已使用
        await RoomManager.roomRef.child('game/inquisitorUsed/' + RoomManager.playerId).set(true);

        // 获取目标玩家上一轮的任务投票
        const lastMission = this.gameData.currentMission - 1;
        if (lastMission < 0) {
            return { noData: true };
        }

        // 查看missionHistory（任务成功/失败票）
        const missionVote = this.gameData.missionHistory?.[targetPlayerId]?.[lastMission];

        // 如果该玩家不在上轮任务队伍中
        if (missionVote === undefined) {
            return {
                player: this.players[targetPlayerId]?.name || targetPlayerId,
                mission: lastMission + 1,
                vote: '未参与任务'
            };
        }

        return {
            player: this.players[targetPlayerId]?.name || targetPlayerId,
            mission: lastMission + 1,
            vote: missionVote === true ? '✅ 任务成功' : '❌ 任务失败'
        };
    },

    // 检查审判官能否使用技能
    canUseInquisitorSkill() {
        const myRole = this.getMyRole();
        if (myRole?.id !== 'inquisitor') return false;
        if (this.gameData?.inquisitorUsed?.[RoomManager.playerId]) return false;
        if (this.gameData?.currentMission < 1) return false; // 第一轮没有历史
        return true;
    },

    // 检查中立角色胜利条件
    checkNeutralWin() {
        if (!this.gameData || this.gameData.phase !== 'ended') return [];

        const neutralWinners = [];

        for (const [pid, roleId] of Object.entries(this.gameData.roles)) {
            const role = this.getRoleById(roleId);
            if (role.team !== 'neutral') continue;

            const isExiled = (this.gameData.exiledPlayers || []).includes(pid);
            const exileCount = (this.gameData.exiledPlayers || []).length;
            const missionCount = this.gameData.missionResults.filter(r => r !== null).length;

            let won = false;
            let reason = '';

            switch (role.id) {
                case 'scapegoat':
                    won = isExiled;
                    reason = won ? '被放逐 - 胜利!' : '未被放逐';
                    break;
                case 'armsdealer':
                    won = missionCount >= 5 && !isExiled;
                    reason = won ? '游戏进行到第5轮且存活 - 胜利!' : (isExiled ? '被放逐' : '游戏未进行到第5轮');
                    break;
                case 'cultist':
                    won = exileCount >= 2 && !isExiled;
                    reason = won ? '2人被流放且存活 - 胜利!' : (isExiled ? '被放逐' : `只有${exileCount}人被流放`);
                    break;
            }

            neutralWinners.push({
                playerId: pid,
                playerName: this.players[pid]?.name || pid,
                role: role,
                won: won,
                reason: reason
            });
        }

        return neutralWinners;
    }
};

window.GameManager = GameManager;
