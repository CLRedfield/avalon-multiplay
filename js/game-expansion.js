// Expansion rules run inside the same serialized authority transaction as core actions.
Object.assign(GameManager, {
    privateExpansion: null,
    checkNeutralWin() {
        const game = this.gameData;
        if (!game || game.phase !== 'ended') return [];
        const winners = game.neutralWinnerIds || (game.neutralWinnerId ? [game.neutralWinnerId] : []);
        return Object.entries(game.revealedRoles || game.roles || {}).flatMap(([playerId, roleId]) => {
            const role = GameConfig.role(roleId);
            if (role?.team !== 'neutral') return [];
            const won = game.winners === 'neutral' && winners.includes(playerId);
            return [{ playerId, playerName: this.players[playerId]?.name || playerId, role, won, reason: won ? game.winReason : '未达成胜利条件' }];
        });
    },

    rules(game = this.gameData) {
        return game?.rules || GameConfig.base(game?.playerOrder?.length || 5);
    },
    remainingPlayerIds(game = this.gameData) {
        return (game?.playerOrder || []).filter((id) => !(game.exiledPlayers || []).includes(id) && !this.players[id]?.left);
    },
    eventId(game = this.gameData) { return game?.activeEvent?.revoked ? null : game?.activeEvent?.id; },
    getCurrentMissionSize(game = this.gameData) {
        if (!game?.playerOrder?.length) return 0;
        if (['mission', 'missionResult'].includes(game.phase) && game.missionParameters?.mission === game.currentMission) return game.missionParameters.size;
        const size = this.rules(game).missionSizes[game.currentMission] || 0;
        return Math.min(size + (this.eventId(game) === 'reinforcement' ? 1 : 0), this.remainingPlayerIds(game).length);
    },
    getRequiredMissionFails(game = this.gameData) {
        if (['mission', 'missionResult'].includes(game?.phase) && game.missionParameters?.mission === game.currentMission) return game.missionParameters.fails;
        let fails = this.rules(game).missionFails[game?.currentMission || 0];
        if (this.eventId(game) === 'barrier') fails++;
        if (this.eventId(game) === 'crisis') fails = 1;
        return Math.max(1, Math.min(fails, this.getCurrentMissionSize(game)));
    },
    canExile(game = this.gameData, ignoreEvent = false) {
        const rules = this.rules(game);
        return rules.exileEnabled && (rules.maxExiles === null || (game?.exiledPlayers || []).length < rules.maxExiles)
            && (ignoreEvent || this.eventId(game) !== 'truce');
    },
    approvalThreshold(game, voterCount) {
        return game.voteType === 'mission' && this.eventId(game) === 'scrutiny'
            ? Math.ceil(voterCount * 2 / 3) : Math.floor(voterCount / 2) + 1;
    },
    missionScore(game, success) {
        return (game.missionResults || []).reduce((sum, result, index) => sum + (result === success ? (game.missionWeights?.[index] || 1) : 0), 0);
    },
    logPublic(game, entry) {
        game.history = game.history || [];
        game.history.push({ seq: game.history.length + 1, mission: game.currentMission + 1, ...entry });
    },
    createExpansionSecrets(secrets, playerIds) {
        secrets.expansion = {
            used: {}, shields: {}, predictions: {}, bountyTargets: {}, submissions: {},
            deck: null, results: {}, log: []
        };
        for (const id of playerIds) {
            if (secrets.roles[id] === 'gambler') secrets.expansion.predictions[id] = [true, false, true];
            if (secrets.roles[id] === 'bountyhunter') secrets.expansion.bountyTargets[id] = shuffleList(playerIds.filter((other) => other !== id)).slice(0, 2);
        }
    },
    expansionForPlayer(secrets, playerId) {
        const state = secrets.expansion;
        if (!state) return null;
        return {
            used: !!state.used[playerId], results: state.results[playerId] || [],
            predictions: state.predictions[playerId] || null, bountyTargets: state.bountyTargets[playerId] || null,
            submittedMission: Object.hasOwn(state.submissions, playerId) ? state.mission : null
        };
    },
    refreshPrivateExpansion(secrets, playerId, messages) {
        const value = secrets.privateStates?.[playerId];
        if (!value) return;
        value.expansion = this.expansionForPlayer(secrets, playerId);
        messages.push({ playerId, value: GameConfig.clone(value) });
    },
    needsSkillWindow(game) {
        const rules = this.rules(game);
        const possible = [...Object.keys(rules.roleCounts).filter((id) => rules.roleCounts[id] > 0), ...(rules.neutralSlots ? rules.neutralPool : [])];
        return possible.some((id) => ['witness', 'spy', 'oathkeeper', 'blackguard'].includes(id) || (id === 'gambler' && game.currentMission === 0));
    },
    regroupPossible(game) {
        if (game.currentMission < 1 || this.getCurrentMissionSize(game) < 2) return false;
        const previous = game.missionTeamHistory?.[game.currentMission - 1] || [];
        const available = this.remainingPlayerIds(game);
        return available.some((id) => previous.includes(id)) && available.some((id) => !previous.includes(id));
    },
    teamConstraintError(game, team) {
        if (this.eventId(game) !== 'regroup' || !this.regroupPossible(game)) return null;
        const previous = game.missionTeamHistory?.[game.currentMission - 1] || [];
        return team.some((id) => previous.includes(id)) && team.some((id) => !previous.includes(id))
            ? null : '重整编队：至少选择一名上一场队员和一名上一场未上车玩家';
    },
    eligibleEvent(id, game) {
        const rules = this.rules(game), remaining = this.remainingPlayerIds(game).length;
        const size = Math.min(rules.missionSizes[game.currentMission], remaining);
        const fails = Math.min(rules.missionFails[game.currentMission], size);
        if (id === 'regroup') return this.regroupPossible(game);
        if (id === 'rotation') return this.getActivePlayerIds(game).length > 1;
        if (id === 'truce') return this.canExile(game, true);
        if (id === 'scrutiny') return Math.ceil(remaining * 2 / 3) > Math.floor(remaining / 2) + 1;
        if (id === 'reinforcement') return size < remaining;
        if (id === 'barrier') return fails < size;
        if (id === 'crisis') return fails > 1;
        return id === 'double';
    },
    beginExpansionRound(game, secrets, messages) {
        if (!game.rules || game.phase !== 'captainChoice' || game.roundStarted === game.currentMission) return;
        if (!secrets.expansion) this.createExpansionSecrets(secrets, game.playerOrder);
        const state = secrets.expansion;
        game.roundStarted = game.currentMission;
        game.activeEvent = null;
        delete game.missionParameters;
        state.shields = {};
        state.submissions = {};
        state.mission = game.currentMission;
        const rules = this.rules(game);
        if (rules.eventRounds[game.currentMission] && rules.eventPool.length) {
            if (!state.deck?.length) state.deck = shuffleList(rules.eventPool);
            const index = state.deck.findIndex((id) => this.eligibleEvent(id, game));
            if (index >= 0) {
                const id = state.deck.splice(index, 1)[0];
                game.activeEvent = { id, mission: game.currentMission, revoked: false };
                if (id === 'rotation') game.captainIndex = this.getNextCaptainIndex(game.captainIndex, game.exiledPlayers, game.playerOrder);
                this.logPublic(game, { type: 'event', eventId: id });
            }
        }
        if (this.needsSkillWindow(game)) {
            game.phase = 'roundSkill';
            game.skillDeadline = Date.now() + 20000;
            game.skillSubmittedCount = 0;
            this.logPublic(game, { type: 'skillWindow' });
        }
        for (const id of game.playerOrder) this.refreshPrivateExpansion(secrets, id, messages);
    },
    reconcileExpansion(game, secrets) {
        if (game.phase === 'roundSkill') {
            const active = this.getActivePlayerIds(game);
            game.skillSubmittedCount = active.filter((id) => Object.hasOwn(secrets.expansion.submissions, id)).length;
            if (Date.now() >= game.skillDeadline || (active.length > 0 && game.skillSubmittedCount === active.length)) {
                game.phase = 'captainChoice';
                delete game.skillDeadline;
            }
        }
        const active = this.getActivePlayerIds(game);
        if (active.length && ['captainChoice', 'selectTeam', 'selectExile'].includes(game.phase) && !active.includes(this.getCaptain(game).id)) {
            game.captainIndex = this.getNextCaptainIndex(game.captainIndex, game.exiledPlayers, game.playerOrder);
            game.phase = 'captainChoice';
            game.selectedTeam = [];
            game.exileTarget = null;
            game.actionType = null;
            game.selectionRevision = (game.selectionRevision || 0) + 1;
        }
        if (this.eventId(game) === 'regroup' && !this.regroupPossible(game) && !['mission', 'missionResult', 'ended'].includes(game.phase)) {
            game.activeEvent.revoked = true;
            this.logPublic(game, { type: 'eventRevoked', eventId: 'regroup', reason: '玩家离场后无法满足编队条件，本场取消该限制' });
        }
        if (['vote', 'voteResult'].includes(game.phase) && game.voteType === 'mission') {
            const remaining = this.remainingPlayerIds(game);
            if (game.selectedTeam.length !== this.getCurrentMissionSize(game) || game.selectedTeam.some((id) => !remaining.includes(id))) {
                game.phase = 'selectTeam';
                game.selectedTeam = [];
                game.votes = {};
                game.selectionRevision = (game.selectionRevision || 0) + 1;
                this.logPublic(game, { type: 'notice', text: '玩家永久离场，已按剩余人数重新组队' });
            }
        }
    },
    submitExpansionSkill(game, secrets, playerId, payload, messages) {
        if (game.phase !== 'roundSkill' || Date.now() >= game.skillDeadline) return '技能窗口已结束';
        if (!this.getActivePlayerIds(game).includes(playerId)) return '当前不能提交技能';
        const state = secrets.expansion;
        if (Object.hasOwn(state.submissions, playerId)) return '本窗口已经提交';
        if (!['pass', 'use'].includes(payload.choice)) return '请选择技能或跳过';
        const role = secrets.roles[playerId];
        if (payload.choice === 'use') {
            if (state.used[playerId]) return '本局技能已使用';
            const targets = payload.targets;
            const selectable = this.remainingPlayerIds(game).filter((id) => id !== playerId);
            const pairValid = Array.isArray(targets) && targets.length === 2 && new Set(targets).size === 2 && targets.every((id) => selectable.includes(id));
            let result = null;
            if (role === 'gambler') {
                if (game.currentMission !== 0 || !Array.isArray(payload.predictions) || payload.predictions.length !== 3 || payload.predictions.some((v) => typeof v !== 'boolean')) return '只能在首次窗口预测前三场任务';
                state.predictions[playerId] = [...payload.predictions];
            } else if (role === 'spy') {
                if (!pairValid) return '请选择两名不同的其他在场玩家';
                result = { kind: 'spy', targets: [...targets], sameTeam: GameConfig.role(secrets.roles[targets[0]]).team === GameConfig.role(secrets.roles[targets[1]]).team, mission: game.currentMission + 1 };
            } else if (role === 'witness') {
                const previous = game.missionTeamHistory?.[game.currentMission - 1] || [];
                if (!Array.isArray(targets) || targets.length !== 2 || new Set(targets).size !== 2 || targets.includes(playerId)
                    || !targets.every((id) => previous.includes(id) && typeof secrets.missionHistory?.[id]?.[game.currentMission - 1] === 'boolean')) return '请选择上一场任务的两名其他队员';
                result = { kind: 'witness', targets: [...targets], hasFail: targets.some((id) => secrets.missionHistory[id][game.currentMission - 1] === false), mission: game.currentMission };
            } else if (['oathkeeper', 'blackguard'].includes(role)) {
                if (!Array.isArray(targets) || targets.length !== 1 || !selectable.includes(targets[0])) return '请选择一名其他在场玩家';
                if (!this.canExile(game)) return '本场不能放逐，无需消耗保护';
                state.shields[targets[0]] = true;
                result = { kind: 'protection', targets: [...targets], mission: game.currentMission + 1 };
            } else return '你的角色没有此窗口技能';
            state.used[playerId] = true;
            state.log.push({ playerId, role, mission: game.currentMission + 1, targets: targets || [], predictions: role === 'gambler' ? [...state.predictions[playerId]] : undefined, result });
            if (result) {
                state.results[playerId] = state.results[playerId] || [];
                state.results[playerId].push(result);
            }
        }
        state.submissions[playerId] = true;
        this.refreshPrivateExpansion(secrets, playerId, messages);
        this.reconcileExpansion(game, secrets);
        return null;
    },
    consumeProtection(game, target) {
        const state = this._authoritySecrets?.expansion;
        if (!state?.shields[target]) return false;
        delete state.shields[target];
        this.logPublic(game, { type: 'protected', playerId: target });
        return true;
    },
    _checkImmediateNeutralVictory(game) {
        const exiled = game.exiledPlayers || [];
        const state = this._authoritySecrets?.expansion || (typeof database !== 'undefined' ? database.getHostSecrets?.()?.expansion : null);
        const winners = [];
        for (const [id, role] of Object.entries(this._getRoleAssignments(game))) {
            const removed = exiled.includes(id) || !!this.players[id]?.left;
            let reason = null;
            if (role === 'scapegoat' && exiled.includes(id)) reason = '呆呆鸟被放逐';
            if (!removed) {
                if (role === 'cultist' && exiled.length >= 3) reason = '狂热者存活且已有至少 3 名玩家被放逐';
                if (role === 'armsdealer' && game.currentMission >= 4) reason = '军火商存活进入第 5 轮任务';
                if (role === 'gambler' && state?.predictions[id]?.length === 3 && state.predictions[id].every((prediction, index) => game.missionResults?.[index] === prediction)) reason = '赌徒命中前三场任务';
                if (role === 'bountyhunter' && state?.bountyTargets[id]?.length === 2 && state.bountyTargets[id].every((target) => exiled.includes(target))) reason = '赏金客的两名目标均被放逐';
            }
            if (reason) winners.push({ playerId: id, reason });
        }
        if (winners.length) {
            this._applyNeutralVictory(game, winners[0].playerId, winners.map((winner) => winner.reason).join('；'));
            game.neutralWinnerIds = winners.map((winner) => winner.playerId);
        }
        return game;
    },
    revealExpansion(game, secrets) {
        if (game.phase !== 'ended' || game.winners === 'aborted') return;
        game.revealedRoles = { ...secrets.roles };
        game.revealedDetails = {
            missionHistory: GameConfig.clone(secrets.missionHistory || {}),
            skills: GameConfig.clone(secrets.expansion?.log || []),
            predictions: GameConfig.clone(secrets.expansion?.predictions || {}),
            bountyTargets: GameConfig.clone(secrets.expansion?.bountyTargets || {}),
            inquisitorResults: GameConfig.clone(secrets.inquisitorResults || {})
        };
    }
});
