const GAME_RULES = {
    neutralCanFailMissions: true,
    exileTieBehavior: 'noExile',
    maxExilesPerGame: null
};

const GameManager = {
    gameData: null,
    players: {},

    canRoleSubmitFail(role, playerId = RoomManager.playerId, game = this.gameData) {
        if (!role || !playerId) return false;
        if (role.team === 'evil') return true;
        if (role.team !== 'neutral' || !GAME_RULES.neutralCanFailMissions) return false;

        if (role.id === 'scapegoat') {
            return !game?.neutralFailUsage?.[playerId];
        }

        return true;
    },

    getRoleById(roleId) {
        for (const key of Object.keys(ROLES)) {
            if (ROLES[key].id === roleId) {
                return ROLES[key];
            }
        }
        return null;
    },

    getMyRole(game = this.gameData) {
        if (!game?.roles || !RoomManager.playerId) return null;
        return this.getRoleById(game.roles[RoomManager.playerId]);
    },

    getCaptain(game = this.gameData) {
        if (!game?.playerOrder?.length) {
            return { id: null, name: 'Unknown' };
        }

        const playerId = game.playerOrder[game.captainIndex || 0];
        return {
            id: playerId,
            name: this.players[playerId]?.name || 'Unknown'
        };
    },

    isCaptain(game = this.gameData) {
        return this.getCaptain(game).id === RoomManager.playerId;
    },

    getActivePlayerIds(game = this.gameData) {
        if (!game?.playerOrder) return [];
        const exiledPlayers = game.exiledPlayers || [];
        return game.playerOrder.filter((playerId) => !exiledPlayers.includes(playerId));
    },

    getNextCaptainIndex(currentIndex, exiledPlayers = [], playerOrder = this.gameData?.playerOrder || []) {
        if (!playerOrder.length) return 0;

        let nextIndex = (currentIndex + 1) % playerOrder.length;
        let attempts = 0;

        while (exiledPlayers.includes(playerOrder[nextIndex]) && attempts < playerOrder.length) {
            nextIndex = (nextIndex + 1) % playerOrder.length;
            attempts++;
        }

        return nextIndex;
    },

    getCurrentMissionSize(game = this.gameData) {
        if (!game?.playerOrder?.length) return 0;
        return MISSION_SIZES[game.playerOrder.length]?.[game.currentMission] || 0;
    },

    getLastCompletedMissionIndex(game = this.gameData) {
        const currentMission = game?.currentMission;
        if (!Number.isInteger(currentMission) || currentMission < 1) return null;
        return currentMission - 1;
    },

    getInquisitorEligibleTargetIds(game = this.gameData) {
        const lastMission = this.getLastCompletedMissionIndex(game);
        if (lastMission === null) return [];

        const exiledPlayers = game?.exiledPlayers || [];
        const missionHistory = game?.missionHistory || {};
        const candidateOrder = game?.playerOrder?.length ? game.playerOrder : Object.keys(missionHistory);

        return candidateOrder.filter((playerId) => {
            if (playerId === RoomManager.playerId) return false;
            if (exiledPlayers.includes(playerId)) return false;
            return missionHistory[playerId]?.[lastMission] !== undefined;
        });
    },

    chooseActionType(actionType) {
        if (!this.isCaptain()) return;

        return RoomManager.roomRef.child('game').transaction((game) => {
            if (!game || game.phase !== 'captainChoice') return game;
            if (game.playerOrder?.[game.captainIndex || 0] !== RoomManager.playerId) return game;
            const exileLimit = GAME_RULES.maxExilesPerGame;
            if (
                actionType === 'tribunal'
                && Number.isInteger(exileLimit)
                && (game.exiledPlayers || []).length >= exileLimit
            ) {
                return game;
            }

            game.actionType = actionType;
            game.phase = actionType === 'mission' ? 'selectTeam' : 'selectExile';
            game.selectedTeam = [];
            game.exileTarget = null;
            return game;
        }, undefined, false);
    },

    async selectTeamMember(playerId) {
        if (!this.isCaptain()) return;

        const currentTeam = [...(this.gameData?.selectedTeam || [])];
        const maxSize = this.getCurrentMissionSize();
        const exiledPlayers = this.gameData?.exiledPlayers || [];

        if (exiledPlayers.includes(playerId)) return;

        const index = currentTeam.indexOf(playerId);
        if (index > -1) {
            currentTeam.splice(index, 1);
        } else if (currentTeam.length < maxSize) {
            currentTeam.push(playerId);
        }

        await RoomManager.roomRef.child('game/selectedTeam').set(currentTeam);
    },

    async selectExileTarget(playerId) {
        if (!this.isCaptain()) return;

        const captainId = this.getCaptain().id;
        const exiledPlayers = this.gameData?.exiledPlayers || [];
        if (playerId === captainId || exiledPlayers.includes(playerId)) return;

        await RoomManager.roomRef.child('game/exileTarget').set(playerId);
    },

    confirmTeamForVote() {
        if (!this.isCaptain()) return;

        return RoomManager.roomRef.child('game').transaction((game) => {
            if (!game || game.phase !== 'selectTeam') return game;
            if (game.playerOrder?.[game.captainIndex || 0] !== RoomManager.playerId) return game;
            if ((game.selectedTeam || []).length !== this.getCurrentMissionSize(game)) return;

            game.phase = 'vote';
            game.votes = {};
            game.voteType = 'mission';
            return game;
        }, undefined, false);
    },

    confirmExileForVote() {
        if (!this.isCaptain()) return;

        return RoomManager.roomRef.child('game').transaction((game) => {
            if (!game || game.phase !== 'selectExile') return game;
            if (game.playerOrder?.[game.captainIndex || 0] !== RoomManager.playerId) return game;
            if (!game.exileTarget) return;

            game.phase = 'vote';
            game.votes = {};
            game.voteType = 'exile';
            return game;
        }, undefined, false);
    },

    castVote(approve) {
        return RoomManager.roomRef.child('game').transaction((game) => {
            if (!game || game.phase !== 'vote') return game;

            const playerId = RoomManager.playerId;
            const activePlayers = this.getActivePlayerIds(game);
            if (!activePlayers.includes(playerId)) return;

            game.votes = game.votes || {};
            if (game.votes[playerId] !== undefined) return;

            game.votes[playerId] = !!approve;

            const votedCount = Object.keys(game.votes).filter((pid) => activePlayers.includes(pid)).length;
            if (votedCount >= activePlayers.length) {
                const approves = activePlayers.filter((pid) => game.votes[pid] === true).length;
                const rejects = activePlayers.length - approves;

                game.phase = 'voteResult';
                game.voteResultApproved = approves > rejects;
                game.voteResultApproves = approves;
                game.voteResultRejects = rejects;
            }

            return game;
        }, undefined, false);
    },

    _applyEndedState(game, winners, reason) {
        game.phase = 'ended';
        game.winners = winners;
        game.winReason = reason;
        game.neutralWinnerId = null;
        game.neutralWinnerRoleId = null;
        return game;
    },

    _applyNeutralVictory(game, playerId, reason) {
        game.phase = 'ended';
        game.winners = 'neutral';
        game.winReason = reason;
        game.neutralWinnerId = playerId;
        game.neutralWinnerRoleId = game.roles?.[playerId] || null;
        return game;
    },

    _checkImmediateNeutralVictory(game) {
        const exiledPlayers = game.exiledPlayers || [];

        for (const [playerId, roleId] of Object.entries(game.roles || {})) {
            const role = this.getRoleById(roleId);
            if (role?.team !== 'neutral') continue;

            const isExiled = exiledPlayers.includes(playerId);
            if (isExiled) continue;

            if (role.id === 'armsdealer' && game.currentMission >= 4) {
                return this._applyNeutralVictory(game, playerId, '军火商存活进入第 5 轮任务');
            }
        }

        return game;
    },

    _applyNextMissionState(game) {
        game.phase = 'captainChoice';
        game.currentMission = (game.currentMission || 0) + 1;
        game.captainIndex = this.getNextCaptainIndex(
            game.captainIndex || 0,
            game.exiledPlayers || [],
            game.playerOrder || []
        );
        game.selectedTeam = [];
        game.exileTarget = null;
        game.actionType = null;
        game.voteType = null;
        game.votes = {};
        game.missionCards = {};
        game.rejectCount = 0;
        game.tribunalVotes = {};
        game.tribunalInitiateVotes = {};
        return this._checkImmediateNeutralVictory(game);
    },

    _applyExileResolution(game, exileTarget) {
        if (!exileTarget) return game;

        const exiledPlayers = Array.from(new Set([...(game.exiledPlayers || []), exileTarget]));
        game.exiledPlayers = exiledPlayers;

        const evilPlayers = Object.entries(game.roles || {})
            .filter(([, roleId]) => this.getRoleById(roleId)?.team === 'evil')
            .map(([playerId]) => playerId);

        const allEvilExiled = evilPlayers.every((playerId) => exiledPlayers.includes(playerId));
        if (allEvilExiled) {
            return this._applyEndedState(game, 'good', 'All evil players were exiled');
        }

        const neutralVictoryState = this._checkImmediateNeutralVictory(game);
        if (neutralVictoryState.phase === 'ended') {
            return neutralVictoryState;
        }

        const remainingGood = Object.entries(game.roles || {})
            .filter(([playerId, roleId]) => this.getRoleById(roleId)?.team === 'good' && !exiledPlayers.includes(playerId))
            .length;

        const remainingEvil = Object.entries(game.roles || {})
            .filter(([playerId, roleId]) => this.getRoleById(roleId)?.team === 'evil' && !exiledPlayers.includes(playerId))
            .length;

        if (remainingGood <= remainingEvil) {
            return this._applyEndedState(game, 'evil', 'Good players are no longer the majority');
        }

        return this._applyNextMissionState(game);
    },

    _proceedAfterVoteResult() {
        return RoomManager.roomRef.child('game').transaction((game) => {
            if (!game || game.phase !== 'voteResult') return game;

            if (game.voteResultApproved) {
                if (game.voteType === 'mission') {
                    game.phase = 'mission';
                    game.missionCards = {};
                    game.rejectCount = 0;
                    return game;
                }

                if (game.voteType === 'exile') {
                    return this._applyExileResolution(game, game.exileTarget);
                }

                return game;
            }

            const newRejectCount = (game.rejectCount || 0) + 1;
            if (newRejectCount >= 5) {
                return this._applyEndedState(game, 'evil', 'Five consecutive team rejections');
            }

            game.phase = 'captainChoice';
            game.rejectCount = newRejectCount;
            game.captainIndex = this.getNextCaptainIndex(
                game.captainIndex || 0,
                game.exiledPlayers || [],
                game.playerOrder || []
            );
            game.selectedTeam = [];
            game.exileTarget = null;
            game.actionType = null;
            game.voteType = null;
            game.votes = {};
            return game;
        }, undefined, false);
    },

    submitMissionCard(success) {
        return RoomManager.roomRef.child('game').transaction((game) => {
            if (!game || game.phase !== 'mission') return game;

            const playerId = RoomManager.playerId;
            const myRole = this.getRoleById(game.roles?.[playerId]);
            const selectedTeam = game.selectedTeam || [];
            const canSubmitFail = this.canRoleSubmitFail(myRole, playerId, game);

            if (!myRole || !selectedTeam.includes(playerId)) return;

            game.missionCards = game.missionCards || {};
            if (game.missionCards[playerId] !== undefined) return;
            if (!success && !canSubmitFail) return;

            game.missionCards[playerId] = !!success;
            if (!success && myRole?.id === 'scapegoat') {
                game.neutralFailUsage = game.neutralFailUsage || {};
                game.neutralFailUsage[playerId] = true;
            }
            game.missionHistory = game.missionHistory || {};
            game.missionHistory[playerId] = game.missionHistory[playerId] || {};
            game.missionHistory[playerId][game.currentMission] = !!success;

            const submittedCount = Object.keys(game.missionCards).filter((pid) => selectedTeam.includes(pid)).length;
            if (submittedCount >= selectedTeam.length) {
                const failCount = Object.entries(game.missionCards)
                    .filter(([pid, value]) => selectedTeam.includes(pid) && value === false)
                    .length;

                const successCardCount = selectedTeam.length - failCount;
                const missionSuccess = failCount === 0;

                game.missionResults = game.missionResults || [null, null, null, null, null];
                game.missionResults[game.currentMission] = missionSuccess;
                game.phase = 'missionResult';
                game.missionResultSuccess = missionSuccess;
                game.missionResultSuccessCount = successCardCount;
                game.missionResultFailCount = failCount;
            }

            return game;
        }, undefined, false);
    },

    _proceedAfterMissionResult() {
        return RoomManager.roomRef.child('game').transaction((game) => {
            if (!game || game.phase !== 'missionResult') return game;

            const missionResults = game.missionResults || [];
            const successCount = missionResults.filter((result) => result === true).length;
            const failedCount = missionResults.filter((result) => result === false).length;

            if (successCount >= 3) {
                game.phase = 'assassin';
                return game;
            }

            if (failedCount >= 3) {
                return this._applyEndedState(game, 'evil', 'Three missions were sabotaged');
            }

            return this._applyNextMissionState(game);
        }, undefined, false);
    },

    voteToInitiateTribunal(agree) {
        return RoomManager.roomRef.child('game').transaction((game) => {
            if (!game || game.phase !== 'tribunalPrompt') return game;

            const playerId = RoomManager.playerId;
            const activePlayers = this.getActivePlayerIds(game);
            if (!activePlayers.includes(playerId)) return;

            game.tribunalInitiateVotes = game.tribunalInitiateVotes || {};
            if (game.tribunalInitiateVotes[playerId] !== undefined) return;

            game.tribunalInitiateVotes[playerId] = !!agree;

            const votedCount = Object.keys(game.tribunalInitiateVotes).filter((pid) => activePlayers.includes(pid)).length;
            if (votedCount >= activePlayers.length) {
                const agrees = Object.entries(game.tribunalInitiateVotes)
                    .filter(([pid, vote]) => activePlayers.includes(pid) && vote === true)
                    .length;

                if (agrees > activePlayers.length / 2) {
                    game.phase = 'tribunal';
                    game.tribunalVotes = {};
                } else {
                    return this._applyNextMissionState(game);
                }
            }

            return game;
        }, undefined, false);
    },

    castTribunalVote(targetPlayerId) {
        return RoomManager.roomRef.child('game').transaction((game) => {
            if (!game || game.phase !== 'tribunal') return game;

            const playerId = RoomManager.playerId;
            const activePlayers = this.getActivePlayerIds(game);
            if (!activePlayers.includes(playerId) || !activePlayers.includes(targetPlayerId)) return;
            if (playerId === targetPlayerId) return;

            game.tribunalVotes = game.tribunalVotes || {};
            if (game.tribunalVotes[playerId] !== undefined) return;

            game.tribunalVotes[playerId] = targetPlayerId;

            const votedCount = Object.keys(game.tribunalVotes).filter((pid) => activePlayers.includes(pid)).length;
            if (votedCount >= activePlayers.length) {
                const voteCount = {};
                for (const [voterId, candidateId] of Object.entries(game.tribunalVotes)) {
                    if (!activePlayers.includes(voterId)) continue;
                    voteCount[candidateId] = (voteCount[candidateId] || 0) + 1;
                }

                let maxVotes = 0;
                const topCandidates = [];
                for (const [candidateId, count] of Object.entries(voteCount)) {
                    if (count > maxVotes) {
                        maxVotes = count;
                        topCandidates.length = 0;
                        topCandidates.push(candidateId);
                    } else if (count === maxVotes) {
                        topCandidates.push(candidateId);
                    }
                }

                if (topCandidates.length !== 1 && GAME_RULES.exileTieBehavior === 'noExile') {
                    return this._applyNextMissionState(game);
                }

                return this._applyExileResolution(game, topCandidates[0] || null);
            }

            return game;
        }, undefined, false);
    },

    assassinate(targetPlayerId) {
        return RoomManager.roomRef.child('game').transaction((game) => {
            if (!game || game.phase !== 'assassin') return game;

            const playerId = RoomManager.playerId;
            const myRole = this.getRoleById(game.roles?.[playerId]);
            if (myRole?.id !== 'assassin') return;
            if (game.assassinTarget) return;

            const targetRoleId = game.roles?.[targetPlayerId];
            if (!targetRoleId) return;

            game.assassinTarget = targetPlayerId;
            if (targetRoleId === 'merlin') {
                return this._applyEndedState(game, 'evil', 'The assassin killed Merlin');
            }

            return this._applyEndedState(game, 'good', 'The assassin missed Merlin');
        }, undefined, false);
    },

    async _endGame(winningTeam, reason) {
        await RoomManager.roomRef.child('game').update({
            phase: 'ended',
            winners: winningTeam,
            winReason: reason
        });
    },

    async useInquisitorSkill(targetPlayerId) {
        const myRole = this.getMyRole();
        if (myRole?.id !== 'inquisitor') return null;
        const usageResult = await RoomManager.roomRef.child('game').transaction((game) => {
            if (!game) return game;
            if (game.roles?.[RoomManager.playerId] !== 'inquisitor') return;
            if (game.inquisitorUsed?.[RoomManager.playerId]) return;
            if ((game.exiledPlayers || []).includes(RoomManager.playerId)) return;

            const eligibleTargets = this.getInquisitorEligibleTargetIds(game);
            if (!eligibleTargets.includes(targetPlayerId)) return;

            game.inquisitorUsed = game.inquisitorUsed || {};
            game.inquisitorUsed[RoomManager.playerId] = true;
            return game;
        }, undefined, false);

        if (!usageResult.committed) {
            return null;
        }

        const latestGame = usageResult.snapshot.val() || this.gameData;
        const lastMission = this.getLastCompletedMissionIndex(latestGame);

        if (lastMission === null) {
            return { noData: true };
        }

        const missionVote = latestGame?.missionHistory?.[targetPlayerId]?.[lastMission];

        return {
            player: this.players[targetPlayerId]?.name || targetPlayerId,
            mission: lastMission + 1,
            vote: missionVote === true ? 'Success' : 'Fail'
        };
    },

    canUseInquisitorSkill() {
        const myRole = this.getMyRole();
        if (myRole?.id !== 'inquisitor') return false;
        if (this.gameData?.inquisitorUsed?.[RoomManager.playerId]) return false;
        if ((this.gameData?.exiledPlayers || []).includes(RoomManager.playerId)) return false;
        if (this.getLastCompletedMissionIndex(this.gameData) === null) return false;
        if (this.getInquisitorEligibleTargetIds(this.gameData).length === 0) return false;
        return true;
    },

    checkNeutralWin() {
        if (!this.gameData || this.gameData.phase !== 'ended') return [];

        const exiledPlayers = this.gameData.exiledPlayers || [];
        const exileCount = exiledPlayers.length;
        const neutralResults = [];

        for (const [playerId, roleId] of Object.entries(this.gameData.roles || {})) {
            const role = this.getRoleById(roleId);
            if (role?.team !== 'neutral') continue;

            const isExiled = exiledPlayers.includes(playerId);
            let won = false;
            let reason = '';

            switch (role.id) {
                case 'scapegoat':
                    won = isExiled;
                    reason = won ? '被放逐' : '未被放逐';
                    break;
                case 'armsdealer':
                    won = this.gameData.neutralWinnerId === playerId || (!isExiled && this.gameData.currentMission >= 4);
                    reason = won ? '存活进入了第 5 轮任务' : (isExiled ? '被放逐' : '未能存活进入第 5 轮任务');
                    break;
                case 'cultist':
                    won = exileCount >= 3 && !isExiled;
                    reason = won ? '至少 3 名玩家被放逐且你存活到终局' : (isExiled ? '被放逐' : '被放逐人数不足 3 人');
                    break;
            }

            neutralResults.push({
                playerId,
                playerName: this.players[playerId]?.name || playerId,
                role,
                won,
                reason
            });
        }

        return neutralResults;
    }
};

window.GAME_RULES = GAME_RULES;
window.GameManager = GameManager;
