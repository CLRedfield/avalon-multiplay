const GAME_RULES = {
    neutralCanFailMissions: true,
    exileTieBehavior: 'noExile',
    maxExilesPerGame: null
};

const GameManager = {
    gameData: null,
    players: {},
    privateRoleId: null,
    privateNightInfo: [],
    privateGameId: null,
    privateNeutralFailUsed: false,
    lastPrivateInquisitorResult: null,
    selectionDraft: null,

    _getRoleAssignments(game = this.gameData) {
        const hostRoles = this._authoritySecrets?.roles || (typeof database !== 'undefined' ? database.getHostSecrets?.()?.roles : null);
        return game?.revealedRoles || game?.roles || hostRoles || {};
    },

    canRoleSubmitFail(role, playerId = RoomManager.playerId, game = this.gameData) {
        if (!role || !playerId) return false;
        if (role.team === 'evil') return true;
        if (role.team !== 'neutral' || !GAME_RULES.neutralCanFailMissions) return false;
        if (['gambler', 'bountyhunter'].includes(role.id)) return false;

        if (role.id === 'scapegoat') {
            const privateUsage = playerId === RoomManager.playerId && this.privateNeutralFailUsed;
            return !privateUsage && !game?.neutralFailUsage?.[playerId];
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
        if (!RoomManager.playerId) return null;
        const revealedRoleId = game?.revealedRoles?.[RoomManager.playerId] || game?.roles?.[RoomManager.playerId];
        const privateRoleId = !game?.gameId || this.privateGameId === game.gameId
            ? this.privateRoleId
            : null;
        return this.getRoleById(revealedRoleId || privateRoleId);
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
        return game.playerOrder.filter((playerId) => {
            const player = this.players[playerId];
            return !exiledPlayers.includes(playerId)
                && (!player || (!player.left && player.connected !== false));
        });
    },

    getNextCaptainIndex(currentIndex, exiledPlayers = [], playerOrder = this.gameData?.playerOrder || []) {
        if (!playerOrder.length) return 0;

        let nextIndex = (currentIndex + 1) % playerOrder.length;
        let attempts = 0;

        const isUnavailable = (playerId) => {
            const player = this.players[playerId];
            return exiledPlayers.includes(playerId)
                || (player && (player.left || player.connected === false));
        };

        while (isUnavailable(playerOrder[nextIndex]) && attempts < playerOrder.length) {
            nextIndex = (nextIndex + 1) % playerOrder.length;
            attempts++;
        }

        return nextIndex;
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
        const missionTeam = game?.missionTeamHistory?.[lastMission] || [];

        return missionTeam.filter((playerId) => {
            if (playerId === RoomManager.playerId) return false;
            if (exiledPlayers.includes(playerId)) return false;
            return true;
        });
    },

    chooseActionType(actionType) {
        if (!this.isCaptain()) return;
        if (typeof database !== 'undefined' && database.sendAction) {
            return database.sendAction('chooseAction', { actionType });
        }

        return RoomManager.roomRef.child('game').transaction((game) => {
            if (!game || game.phase !== 'captainChoice') return game;
            if (game.playerOrder?.[game.captainIndex || 0] !== RoomManager.playerId) return game;
            const exileLimit = this.rules(game).maxExiles;
            if (
                actionType === 'tribunal'
                && (!this.canExile(game) || (Number.isInteger(exileLimit) && (game.exiledPlayers || []).length >= exileLimit))
            ) {
                return game;
            }

            game.actionType = actionType;
            game.phase = actionType === 'mission' ? 'selectTeam' : 'selectExile';
            game.selectionRevision = (game.selectionRevision || 0) + 1;
            game.selectedTeam = [];
            game.exileTarget = null;
            return game;
        }, undefined, false);
    },

    syncSelectionDraft(game = this.gameData) {
        if (!['selectTeam', 'selectExile'].includes(game?.phase) || !this.isCaptain(game)) {
            this.selectionDraft = null;
            return null;
        }

        // Keep tentative choices out of the shared snapshot and across unrelated broadcasts.
        const key = JSON.stringify([
            RoomManager.currentRoom, game.gameId, game.selectionRevision || 0,
            game.phase, this.getCaptain(game).id, game.currentMission, game.rejectCount || 0
        ]);
        if (this.selectionDraft?.key !== key) {
            this.selectionDraft = {
                key,
                team: [...new Set(game.selectedTeam || [])],
                targetId: game.exileTarget || null,
                submitting: false
            };
        }

        const activeIds = this.getActivePlayerIds(game);
        const draft = this.selectionDraft;
        draft.team = draft.team.filter((id) => activeIds.includes(id)).slice(0, this.getCurrentMissionSize(game));
        if (!activeIds.includes(draft.targetId) || draft.targetId === this.getCaptain(game).id) {
            draft.targetId = null;
        }
        return draft;
    },

    getSelectionView(game = this.gameData) {
        const draft = this.syncSelectionDraft(game);
        return draft ? { ...game, selectedTeam: [...draft.team], exileTarget: draft.targetId } : game;
    },

    selectTeamMember(playerId) {
        const draft = this.syncSelectionDraft();
        if (!draft || draft.submitting || this.gameData.phase !== 'selectTeam') return;
        if (!this.getActivePlayerIds().includes(playerId)) return;

        const index = draft.team.indexOf(playerId);
        if (index >= 0) draft.team.splice(index, 1);
        else if (draft.team.length < this.getCurrentMissionSize()) draft.team.push(playerId);
        window.onSelectionDraftChange?.();
    },

    selectExileTarget(playerId) {
        const draft = this.syncSelectionDraft();
        if (!draft || draft.submitting || this.gameData.phase !== 'selectExile') return;
        if (!this.getActivePlayerIds().includes(playerId) || playerId === this.getCaptain().id) return;

        draft.targetId = playerId;
        window.onSelectionDraftChange?.();
    },

    async _confirmSelection(phase, action) {
        const draft = this.syncSelectionDraft();
        if (!draft || draft.submitting || this.gameData.phase !== phase) return;
        if (phase === 'selectTeam' && draft.team.length !== this.getCurrentMissionSize()) return;
        if (phase === 'selectExile' && !draft.targetId) return;

        const payload = {
            gameId: this.gameData.gameId,
            selectionRevision: this.gameData.selectionRevision || 0,
            ...(phase === 'selectTeam' ? { selectedTeam: [...draft.team] } : { targetPlayerId: draft.targetId })
        };
        draft.submitting = true;
        window.onSelectionDraftChange?.();
        try {
            // The authority validates and publishes the entire proposal in one state change.
            return await database.sendAction(action, payload);
        } finally {
            if (this.selectionDraft === draft) {
                draft.submitting = false;
                window.onSelectionDraftChange?.();
            }
        }
    },

    confirmTeamForVote() {
        return this._confirmSelection('selectTeam', 'confirmTeam');
    },

    confirmExileForVote() {
        return this._confirmSelection('selectExile', 'confirmExile');
    },

    castVote(approve) {
        if (typeof database !== 'undefined' && database.sendAction) {
            return database.sendAction('castVote', { approve: !!approve });
        }
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
                game.voteResultApproved = approves >= this.approvalThreshold(game, activePlayers.length);
                game.voteResultApproves = approves;
                game.voteResultRejects = rejects;
            }

            return game;
        }, undefined, false);
    },

    _applyEndedState(game, winners, reason) {
        const roleAssignments = this._getRoleAssignments(game);
        game.phase = 'ended';
        game.winners = winners;
        game.winReason = reason;
        game.neutralWinnerId = null;
        game.neutralWinnerRoleId = null;
        game.neutralWinnerIds = [];
        game.revealedRoles = { ...roleAssignments };
        return game;
    },

    _applyNeutralVictory(game, playerId, reason) {
        const roleAssignments = this._getRoleAssignments(game);
        game.phase = 'ended';
        game.winners = 'neutral';
        game.winReason = reason;
        game.neutralWinnerId = playerId;
        game.neutralWinnerIds = [playerId];
        game.neutralWinnerRoleId = roleAssignments?.[playerId] || null;
        game.revealedRoles = { ...roleAssignments };
        return game;
    },

    _prepareNextCaptainState(game) {
        game.phase = 'captainChoice';
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
        game.missionSubmitted = {};
        game.tribunalVotes = {};
        game.tribunalInitiateVotes = {};
        return game;
    },

    _applyNextCaptainState(game) {
        game.rejectCount = 0;
        return this._prepareNextCaptainState(game);
    },

    _applyNextMissionState(game) {
        game.currentMission = (game.currentMission || 0) + 1;
        game.rejectCount = 0;
        this._prepareNextCaptainState(game);
        return this._checkImmediateNeutralVictory(game);
    },

    _applyExileResolution(game, exileTarget) {
        if (!exileTarget) return game;
        if (this.consumeProtection?.(game, exileTarget)) return this._applyNextCaptainState(game);

        const exiledPlayers = Array.from(new Set([...(game.exiledPlayers || []), exileTarget]));
        game.exiledPlayers = exiledPlayers;
        this.logPublic?.(game, { type: 'exile', playerId: exileTarget });

        const neutralVictoryState = this._checkImmediateNeutralVictory(game);
        if (neutralVictoryState.phase === 'ended') {
            return neutralVictoryState;
        }

        const roleAssignments = this._getRoleAssignments(game);
        const evilPlayers = Object.entries(roleAssignments)
            .filter(([, roleId]) => this.getRoleById(roleId)?.team === 'evil')
            .map(([playerId]) => playerId);

        const isRemoved = (playerId) => exiledPlayers.includes(playerId) || this.players[playerId]?.left;
        const allEvilExiled = evilPlayers.every((playerId) => isRemoved(playerId));
        if (allEvilExiled) {
            return this._applyEndedState(game, 'good', 'All evil players were exiled');
        }

        const remainingGood = Object.entries(roleAssignments)
            .filter(([playerId, roleId]) => this.getRoleById(roleId)?.team === 'good' && !isRemoved(playerId))
            .length;

        const remainingEvil = Object.entries(roleAssignments)
            .filter(([playerId, roleId]) => this.getRoleById(roleId)?.team === 'evil' && !isRemoved(playerId))
            .length;

        if (remainingGood <= remainingEvil) {
            return this._applyEndedState(game, 'evil', 'Good players are no longer the majority');
        }

        return this._applyNextCaptainState(game);
    },

    _proceedAfterVoteResult() {
        if (typeof database !== 'undefined' && database.sendAction) {
            return database.sendAction('proceedVoteResult', {});
        }
        return RoomManager.roomRef.child('game').transaction((game) => {
            if (!game || game.phase !== 'voteResult') return game;

            if (game.voteResultApproved) {
                if (game.voteType === 'mission') {
                    game.phase = 'mission';
                    game.missionSubmitted = {};
                    game.missionTeamHistory = game.missionTeamHistory || {};
                    game.missionTeamHistory[game.currentMission] = [...(game.selectedTeam || [])];
                    game.rejectCount = 0;
                    return game;
                }

                if (game.voteType === 'exile') {
                    return this._applyExileResolution(game, game.exileTarget);
                }

                return game;
            }

            const newRejectCount = (game.rejectCount || 0) + 1;
            if (newRejectCount >= this.rules(game).rejectionLimit) {
                return this._applyEndedState(game, 'evil', `连续 ${this.rules(game).rejectionLimit} 次提案被否决`);
            }

            game.rejectCount = newRejectCount;
            return this._prepareNextCaptainState(game);
        }, undefined, false);
    },

    submitMissionCard(success) {
        return database.sendAction('submitMissionCard', { success: !!success }, { sealToHost: true });
    },

    _proceedAfterMissionResult() {
        if (typeof database !== 'undefined' && database.sendAction) {
            return database.sendAction('proceedMissionResult', {});
        }
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
                    return this._applyNextCaptainState(game);
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
                    return this._applyNextCaptainState(game);
                }

                return this._applyExileResolution(game, topCandidates[0] || null);
            }

            return game;
        }, undefined, false);
    },

    assassinate(targetPlayerId) {
        return database.sendAction('assassinate', { targetPlayerId });
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
        const response = await database.sendAction('useInquisitor', { targetPlayerId }, { sealToHost: true });
        return response?.result || null;
    },

    canUseInquisitorSkill() {
        const myRole = this.getMyRole();
        if (myRole?.id !== 'inquisitor') return false;
        if (this.privateInquisitorUsed || this.gameData?.inquisitorUsed?.[RoomManager.playerId]) return false;
        if (!['captainChoice', 'selectTeam', 'selectExile', 'roundSkill'].includes(this.gameData?.phase)) return false;
        if ((this.gameData?.exiledPlayers || []).includes(RoomManager.playerId)) return false;
        if (this.getLastCompletedMissionIndex(this.gameData) === null) return false;
        if (this.getInquisitorEligibleTargetIds(this.gameData).length === 0) return false;
        return true;
    },

    async handleAuthoritativeAction({ action, payload, senderPlayerId, room }) {
        const game = room?.game;
        const savedSecrets = database.getHostSecrets();
        const secrets = savedSecrets ? JSON.parse(JSON.stringify(savedSecrets)) : null;
        if (!game || !secrets || secrets.gameId !== game.gameId) {
            return { error: '房主的私密对局状态不可用，请返回大厅重新开局' };
        }

        const roles = secrets.roles || {};
        const nextRoom = JSON.parse(JSON.stringify(room));
        const nextGame = nextRoom.game;
        const privateMessages = [];
        const activePlayerIds = (nextGame.playerOrder || []).filter((playerId) => {
            const player = nextRoom.players?.[playerId];
            return player && !player.left && player.connected !== false
                && !(nextGame.exiledPlayers || []).includes(playerId);
        });
        const captainId = nextGame.playerOrder?.[nextGame.captainIndex || 0];

        // Helpers must use the transaction snapshot, not potentially stale UI state.
        const previousPlayers = this.players;
        this.players = nextRoom.players;
        this._authoritySecrets = secrets;
        try {
            if (!nextGame.playerOrder.includes(senderPlayerId) && senderPlayerId !== room.host) return { error: '你不是本局玩家' };

            if (action === 'submitRoundSkill') {
                const error = this.submitExpansionSkill(nextGame, secrets, senderPlayerId, payload, privateMessages);
                if (error) return { error };
            } else if (action === 'advanceSkills') {
                if (senderPlayerId !== room.host || nextGame.phase !== 'roundSkill') return { error: '只有房主可以推进技能窗口' };
                this.reconcileExpansion(nextGame, secrets);
            } else if (action === 'reconcilePresence') {
                if (senderPlayerId !== room.host) return { error: '只有房主可以恢复掉线流程' };

                if (nextGame.phase === 'night') {
                    const everyoneReady = activePlayerIds.length > 0
                        && activePlayerIds.every((playerId) => nextRoom.players[playerId]?.isReady);
                    if (everyoneReady) nextGame.phase = 'captainChoice';
                }

                if (['captainChoice', 'selectTeam', 'selectExile'].includes(nextGame.phase) && !activePlayerIds.includes(captainId)) {
                    let nextCaptainIndex = nextGame.captainIndex || 0;
                    for (let offset = 1; offset <= (nextGame.playerOrder || []).length; offset++) {
                        const candidateIndex = ((nextGame.captainIndex || 0) + offset) % nextGame.playerOrder.length;
                        if (activePlayerIds.includes(nextGame.playerOrder[candidateIndex])) {
                            nextCaptainIndex = candidateIndex;
                            break;
                        }
                    }
                    nextGame.captainIndex = nextCaptainIndex;
                    nextGame.phase = 'captainChoice';
                    nextGame.selectedTeam = [];
                    nextGame.exileTarget = null;
                    nextGame.actionType = null;
                }

                if (nextGame.phase === 'vote') {
                    const allActiveVoted = activePlayerIds.length > 0
                        && activePlayerIds.every((playerId) => nextGame.votes?.[playerId] !== undefined);
                    if (allActiveVoted) {
                        const approves = activePlayerIds.filter((playerId) => nextGame.votes[playerId] === true).length;
                        nextGame.phase = 'voteResult';
                        nextGame.voteResultApproved = approves >= this.approvalThreshold(nextGame, activePlayerIds.length);
                        nextGame.voteResultApproves = approves;
                        nextGame.voteResultRejects = activePlayerIds.length - approves;
                    }
                }

                if (nextGame.phase === 'mission' && (nextGame.selectedTeam || []).some((playerId) =>
                    !activePlayerIds.includes(playerId) && !nextGame.missionSubmitted?.[playerId]
                )) {
                    for (const playerId of nextGame.selectedTeam || []) {
                        if (secrets.missionHistory?.[playerId]) delete secrets.missionHistory[playerId][nextGame.currentMission];
                        if (roles[playerId] === 'scapegoat' && secrets.missionCards?.[playerId] === false) {
                            delete secrets.neutralFailUsage?.[playerId];
                            const state = secrets.privateStates?.[playerId];
                            if (state) {
                                state.neutralFailUsed = false;
                                privateMessages.push({ playerId, value: { ...state } });
                            }
                        }
                    }
                    secrets.missionCards = {};
                    secrets.missionCardsMission = nextGame.currentMission;
                    nextGame.phase = 'selectTeam';
                    delete nextGame.missionParameters;
                    nextGame.selectionRevision = (nextGame.selectionRevision || 0) + 1;
                    nextGame.selectedTeam = [];
                    nextGame.missionSubmitted = {};
                    nextGame.votes = {};
                }

                if (nextGame.phase === 'assassin') {
                    const assassinId = Object.keys(roles).find((playerId) => roles[playerId] === 'assassin');
                    const assassinPlayer = nextRoom.players?.[assassinId];
                    if (!assassinPlayer || assassinPlayer.left || (nextGame.exiledPlayers || []).includes(assassinId)) {
                        this._applyEndedState(nextGame, 'good', '刺客已离场，无法执行刺杀');
                    } else if (assassinPlayer.connected === false) {
                        const deadline = nextGame.assassinReconnectDeadline
                            || ((assassinPlayer.disconnectedAt || Date.now()) + 60000);
                        nextGame.assassinReconnectDeadline = deadline;
                        if (Date.now() >= deadline) this._applyEndedState(nextGame, 'good', '刺客掉线超过 60 秒，无法执行刺杀');
                    } else {
                        delete nextGame.assassinReconnectDeadline;
                    }
                }
            } else if (action === 'chooseAction') {
                if (nextGame.phase !== 'captainChoice' || senderPlayerId !== captainId) return { error: '只有当前队长可以选择行动' };
                if (!['mission', 'tribunal'].includes(payload.actionType)) return { error: '无效的行动类型' };
                if (payload.actionType === 'tribunal' && !this.canExile(nextGame)) return { error: '本场不能发起放逐' };
                nextGame.actionType = payload.actionType;
                nextGame.phase = payload.actionType === 'mission' ? 'selectTeam' : 'selectExile';
                nextGame.selectionRevision = (nextGame.selectionRevision || 0) + 1;
                nextGame.selectedTeam = [];
                nextGame.exileTarget = null;
            } else if (action === 'confirmTeam') {
                if (nextGame.phase !== 'selectTeam' || senderPlayerId !== captainId) return { error: '当前不能确认任务队伍' };
                if (payload.gameId !== nextGame.gameId || payload.selectionRevision !== (nextGame.selectionRevision || 0)) {
                    return { error: '选人阶段已变化，请重新选择' };
                }
                const team = payload.selectedTeam;
                if (!Array.isArray(team) || team.length !== this.getCurrentMissionSize(nextGame)) return { error: '任务队伍人数不正确' };
                if (new Set(team).size !== team.length) return { error: '任务队伍不能包含重复玩家' };
                if (!team.every((playerId) => activePlayerIds.includes(playerId))) return { error: '任务队伍包含离线或已放逐玩家' };
                const constraintError = this.teamConstraintError(nextGame, team);
                if (constraintError) return { error: constraintError };
                nextGame.selectedTeam = nextGame.playerOrder.filter((playerId) => team.includes(playerId));
                this.logPublic(nextGame, { type: 'proposal', captainId, team: [...nextGame.selectedTeam] });
                nextGame.phase = 'vote';
                nextGame.votes = {};
                nextGame.voteType = 'mission';
            } else if (action === 'confirmExile') {
                if (!this.canExile(nextGame)) return { error: '本场不能发起放逐' };
                if (nextGame.phase !== 'selectExile' || senderPlayerId !== captainId) {
                    return { error: '当前不能确认放逐目标' };
                }
                if (payload.gameId !== nextGame.gameId || payload.selectionRevision !== (nextGame.selectionRevision || 0)) {
                    return { error: '选人阶段已变化，请重新选择' };
                }
                if (!activePlayerIds.includes(payload.targetPlayerId) || payload.targetPlayerId === captainId) {
                    return { error: '该玩家当前不能被队长提议放逐' };
                }
                nextGame.exileTarget = payload.targetPlayerId;
                this.logPublic(nextGame, { type: 'proposal', captainId, target: payload.targetPlayerId });
                nextGame.phase = 'vote';
                nextGame.votes = {};
                nextGame.voteType = 'exile';
            } else if (action === 'castVote') {
                if (nextGame.phase !== 'vote' || !activePlayerIds.includes(senderPlayerId)) return { error: '当前不能投票' };
                nextGame.votes = nextGame.votes || {};
                if (nextGame.votes[senderPlayerId] !== undefined) return { error: '你已经投过票' };
                nextGame.votes[senderPlayerId] = !!payload.approve;
                const votedCount = activePlayerIds.filter((playerId) => nextGame.votes[playerId] !== undefined).length;
                if (votedCount >= activePlayerIds.length) {
                    const approves = activePlayerIds.filter((playerId) => nextGame.votes[playerId] === true).length;
                    nextGame.phase = 'voteResult';
                    nextGame.voteResultApproved = approves >= this.approvalThreshold(nextGame, activePlayerIds.length);
                    nextGame.voteResultApproves = approves;
                    nextGame.voteResultRejects = activePlayerIds.length - approves;
                }
            } else if (action === 'proceedVoteResult') {
                if (senderPlayerId !== room.host || nextGame.phase !== 'voteResult') return { error: '只有房主可以推进投票结果' };
                if (nextGame.voteResultApproved) {
                    if (nextGame.voteType === 'mission') {
                        const size = this.getCurrentMissionSize(nextGame);
                        const fails = this.getRequiredMissionFails(nextGame);
                        if (nextGame.selectedTeam.length !== size || nextGame.selectedTeam.some((id) => !this.remainingPlayerIds(nextGame).includes(id))) {
                            nextGame.phase = 'selectTeam';
                            nextGame.selectedTeam = [];
                            nextGame.votes = {};
                            nextGame.selectionRevision = (nextGame.selectionRevision || 0) + 1;
                        } else {
                            nextGame.missionParameters = { mission: nextGame.currentMission, size, fails, weight: this.eventId(nextGame) === 'double' ? 2 : 1 };
                            nextGame.phase = 'mission';
                            nextGame.missionSubmitted = {};
                            nextGame.missionTeamHistory = nextGame.missionTeamHistory || {};
                            nextGame.missionTeamHistory[nextGame.currentMission] = [...(nextGame.selectedTeam || [])];
                            nextGame.rejectCount = 0;
                        }
                    } else if (nextGame.voteType === 'exile') {
                        this._applyExileResolution(nextGame, nextGame.exileTarget);
                    } else {
                        return { error: '未知投票类型' };
                    }
                } else {
                    const newRejectCount = (nextGame.rejectCount || 0) + 1;
                    if (newRejectCount >= this.rules(nextGame).rejectionLimit) this._applyEndedState(nextGame, 'evil', `连续 ${this.rules(nextGame).rejectionLimit} 次提案被否决`);
                    else {
                        nextGame.rejectCount = newRejectCount;
                        this._prepareNextCaptainState(nextGame);
                    }
                }
            } else if (action === 'proceedMissionResult') {
                if (senderPlayerId !== room.host || nextGame.phase !== 'missionResult') return { error: '只有房主可以推进任务结果' };
                const successCount = this.missionScore(nextGame, true);
                const failedCount = this.missionScore(nextGame, false);
                if (successCount >= 3) {
                    const assassinId = Object.keys(roles).find((playerId) => roles[playerId] === 'assassin');
                    if (!this.rules(nextGame).assassinationEnabled || !assassinId || (nextGame.exiledPlayers || []).includes(assassinId) || nextRoom.players?.[assassinId]?.left) {
                        this._applyEndedState(nextGame, 'good', '好人累计三点任务进度，本局无需刺杀');
                    } else {
                        nextGame.phase = 'assassin';
                    }
                } else if (failedCount >= 3) {
                    this._applyEndedState(nextGame, 'evil', '坏人累计三点任务进度');
                } else {
                    this._applyNextMissionState(nextGame);
                }
            } else if (action === 'submitMissionCard') {
                if (nextGame.phase !== 'mission') return { error: '当前不在任务阶段' };
                if (!(nextGame.selectedTeam || []).includes(senderPlayerId)) return { error: '你不在本次任务队伍中' };

                secrets.missionCards = secrets.missionCards || {};
                secrets.missionHistory = secrets.missionHistory || {};
                secrets.neutralFailUsage = secrets.neutralFailUsage || {};
                if (secrets.missionCardsMission !== nextGame.currentMission) {
                    secrets.missionCardsMission = nextGame.currentMission;
                    secrets.missionCards = {};
                }
                if (secrets.missionCards[senderPlayerId] !== undefined) return { error: '你已经提交过任务牌' };

                const role = this.getRoleById(roles[senderPlayerId]);
                const success = !!payload.success;
                const canFail = role?.team === 'evil'
                    || (role?.team === 'neutral' && !['gambler', 'bountyhunter'].includes(role.id) && (role.id !== 'scapegoat' || !secrets.neutralFailUsage[senderPlayerId]));
                if (!success && !canFail) return { error: '你的角色不能提交失败牌' };

                secrets.missionCards[senderPlayerId] = success;
                if (!success && role?.id === 'scapegoat') {
                    secrets.neutralFailUsage[senderPlayerId] = true;
                    const privateState = secrets.privateStates?.[senderPlayerId];
                    if (privateState) {
                        privateState.neutralFailUsed = true;
                        privateMessages.push({
                            playerId: senderPlayerId,
                            value: { ...privateState }
                        });
                    }
                }
                secrets.missionHistory[senderPlayerId] = secrets.missionHistory[senderPlayerId] || {};
                secrets.missionHistory[senderPlayerId][nextGame.currentMission] = success;
                nextGame.missionSubmitted = nextGame.missionSubmitted || {};
                nextGame.missionSubmitted[senderPlayerId] = true;

                const selectedTeam = nextGame.selectedTeam || [];
                const submittedCount = selectedTeam.filter((playerId) => secrets.missionCards[playerId] !== undefined).length;
                if (submittedCount >= selectedTeam.length) {
                    const failCount = selectedTeam.filter((playerId) => secrets.missionCards[playerId] === false).length;
                    const requiredFails = this.getRequiredMissionFails(nextGame);
                    const missionSuccess = failCount < requiredFails;
                    nextGame.missionResults = nextGame.missionResults || [null, null, null, null, null];
                    nextGame.missionResults[nextGame.currentMission] = missionSuccess;
                    nextGame.missionWeights = nextGame.missionWeights || {};
                    nextGame.missionWeights[nextGame.currentMission] = nextGame.missionParameters?.weight || (this.eventId(nextGame) === 'double' ? 2 : 1);
                    nextGame.phase = 'missionResult';
                    nextGame.missionResultSuccess = missionSuccess;
                    nextGame.missionResultSuccessCount = selectedTeam.length - failCount;
                    nextGame.missionResultFailCount = failCount;
                    if (secrets.expansion) secrets.expansion.shields = {};
                    this.logPublic(nextGame, { type: 'mission', success: missionSuccess, failCount, team: [...selectedTeam], weight: nextGame.missionWeights[nextGame.currentMission] });
                    this._checkImmediateNeutralVictory(nextGame);
                }
            } else if (action === 'assassinate') {
                if (nextGame.phase !== 'assassin') return { error: '当前不在刺杀阶段' };
                if (roles[senderPlayerId] !== 'assassin' || nextGame.assassinTarget) return { error: '你不能执行刺杀' };
                const targetPlayerId = payload.targetPlayerId;
                if (!roles[targetPlayerId] || targetPlayerId === senderPlayerId) return { error: '无效的刺杀目标' };

                nextGame.assassinTarget = targetPlayerId;
                if (roles[targetPlayerId] === 'merlin') {
                    this._applyEndedState(nextGame, 'evil', '刺客成功找出了梅林');
                } else {
                    this._applyEndedState(nextGame, 'good', '刺客未能找出梅林');
                }
            } else if (action === 'useInquisitor') {
                if (!['captainChoice', 'selectTeam', 'selectExile', 'roundSkill'].includes(nextGame.phase)) return { error: '当前不能使用审判官技能' };
                if (!activePlayerIds.includes(senderPlayerId)) return { error: '当前不能使用技能' };
                if (roles[senderPlayerId] !== 'inquisitor') return { error: '你不是审判官' };
                if (secrets.inquisitorResults?.[senderPlayerId]) return { error: '本局技能已经使用' };
                if ((nextGame.exiledPlayers || []).includes(senderPlayerId)) return { error: '被放逐后不能使用技能' };

                const lastMission = this.getLastCompletedMissionIndex(nextGame);
                const targetPlayerId = payload.targetPlayerId;
                const eligibleTargets = nextGame.missionTeamHistory?.[lastMission] || [];
                if (lastMission === null || targetPlayerId === senderPlayerId || !eligibleTargets.includes(targetPlayerId)) {
                    return { error: '该玩家不是上一轮可查看的任务队员' };
                }
                const vote = secrets.missionHistory?.[targetPlayerId]?.[lastMission];
                if (vote === undefined) return { error: '没有找到该玩家的任务记录' };

                privateMessages.push({
                    playerId: senderPlayerId,
                    retain: false,
                    value: {
                        type: 'inquisitorResult',
                        gameId: nextGame.gameId,
                        player: this.players[targetPlayerId]?.name || targetPlayerId,
                        mission: lastMission + 1,
                        vote: vote ? 'Success' : 'Fail'
                    }
                });
                secrets.inquisitorResults = secrets.inquisitorResults || {};
                secrets.inquisitorResults[senderPlayerId] = privateMessages[privateMessages.length - 1].value;
                if (secrets.privateStates?.[senderPlayerId]) {
                    secrets.privateStates[senderPlayerId].inquisitorUsed = true;
                    privateMessages.push({ playerId: senderPlayerId, value: JSON.parse(JSON.stringify(secrets.privateStates[senderPlayerId])) });
                }
            } else {
                return { error: '未知游戏动作' };
            }

            if (nextGame.phase === 'voteResult' && game.phase !== 'voteResult') {
                this.logPublic(nextGame, { type: 'vote', votes: { ...nextGame.votes }, approved: nextGame.voteResultApproved, voteType: nextGame.voteType });
            }
            this.beginExpansionRound(nextGame, secrets, privateMessages);
            this.reconcileExpansion(nextGame, secrets);
            this.revealExpansion(nextGame, secrets);
            return {
                room: nextRoom,
                secrets,
                privateMessages,
                result: action === 'useInquisitor' ? { delivered: true } : null
            };
        } finally {
            this._authoritySecrets = null;
            this.players = previousPlayers;
        }
    }

};

if (typeof database !== 'undefined') {
    database.registerActionHandler((context) => GameManager.handleAuthoritativeAction(context));
    database.onPrivateMessage((message) => {
        if (!message || (GameManager.gameData?.gameId && message.gameId !== GameManager.gameData.gameId)) return;

        if (message.type === 'role') {
            GameManager.privateGameId = message.gameId;
            GameManager.privateRoleId = message.roleId;
            GameManager.privateNightInfo = Array.isArray(message.nightInfo) ? message.nightInfo : [];
            GameManager.privateNeutralFailUsed = !!message.neutralFailUsed;
            GameManager.privateExpansion = message.expansion || null;
            GameManager.privateInquisitorUsed = !!message.inquisitorUsed;
            if (GameManager.gameData && window.onGameChange) window.onGameChange(GameManager.gameData);
        }

        if (message.type === 'inquisitorResult') {
            GameManager.lastPrivateInquisitorResult = message;
            window.dispatchEvent(new CustomEvent('avalon-inquisitor-result', { detail: message }));
        }
    });
}

window.GAME_RULES = GAME_RULES;
window.GameManager = GameManager;
