const UI = {
    currentView: 'home',

    getRoleDescription(role) {
        if (!role) return '';
        if (role.id === 'inquisitor') {
            return '每局可使用一次技能，只能查看上一轮上车玩家提交的是成功还是失败。';
        }
        return role.description || '';
    },

    ensureRuleMount(containerSelector, mountId, beforeSelector = null) {
        const parent = document.querySelector(containerSelector);
        if (!parent) return null;

        let mount = document.getElementById(mountId);
        if (!mount) {
            mount = document.createElement('div');
            mount.id = mountId;
            const beforeNode = beforeSelector ? parent.querySelector(beforeSelector) : null;
            if (beforeNode) {
                parent.insertBefore(mount, beforeNode);
            } else {
                parent.appendChild(mount);
            }
        }

        return mount;
    },

    renderRuleSummary(mountId) {
        const container = document.getElementById(mountId);
        if (!container) return;

        const neutralMissionRule = GAME_RULES.neutralCanFailMissions
            ? '中立角色上车时可以提交失败牌；其中替罪羊整局只能提交 1 次失败牌。'
            : '中立角色上车时只能提交成功牌。';
        const exileTieRule = GAME_RULES.exileTieBehavior === 'noExile'
            ? '放逐投票若最高票平票，本轮无人被放逐，直接进入下一轮。'
            : '放逐投票若最高票平票，将按系统预设规则继续结算。';
        const exileLimitRule = Number.isInteger(GAME_RULES.maxExilesPerGame)
            ? `每局最多可发起 ${GAME_RULES.maxExilesPerGame} 次放逐。`
            : '每局不限次放逐，队长每轮都可以选择任务或放逐。';

        container.innerHTML = `
            <div class="glass card rules-card">
                <h3 class="rules-title">规则说明</h3>
                <ul class="rules-list">
                    <li>${neutralMissionRule}</li>
                    <li>${exileTieRule}</li>
                    <li>${exileLimitRule}</li>
                </ul>
            </div>
        `;
    },

    renderRuleSummaries() {
        const homeMount = this.ensureRuleMount('#home-view .container', 'home-rules');
        const lobbyMount = this.ensureRuleMount('#lobby-view .container', 'lobby-rules', '#host-panel');

        if (homeMount) this.renderRuleSummary(homeMount.id);
        if (lobbyMount) this.renderRuleSummary(lobbyMount.id);
    },

    showView(viewId) {
        document.querySelectorAll('.view').forEach((view) => view.classList.remove('active'));
        const nextView = document.getElementById(viewId + '-view');
        if (!nextView) return;

        nextView.classList.add('active');
        this.currentView = viewId;
    },

    showToast(message, duration = 3000) {
        const toast = document.getElementById('toast');
        toast.textContent = message;
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), duration);
    },

    renderLobbyPlayers(players) {
        const list = document.getElementById('player-list');
        list.innerHTML = '';

        const entries = Object.entries(players || {}).filter(([, player]) => player && !player.left);
        const connectedCount = entries.filter(([, player]) => player.connected !== false).length;

        entries.sort((a, b) => (a[1].joinedAt || 0) - (b[1].joinedAt || 0));

        for (const [playerId, player] of entries) {
            const li = document.createElement('li');
            const suffix = [];

            if (player.connected === false) suffix.push('离线');
            if (playerId === RoomManager.playerId) suffix.push('你');

            li.textContent = suffix.length > 0
                ? `${player.name} (${suffix.join(' / ')})`
                : player.name;

            if (player.isHost) li.classList.add('host');
            if (playerId === RoomManager.playerId) li.classList.add('me');
            if (player.connected === false) li.classList.add('offline');
            if (player.isExiled) li.classList.add('exiled');
            list.appendChild(li);
        }

        document.getElementById('player-count').textContent = `(${connectedCount}/10)`;

        const startBtn = document.getElementById('start-game-btn');
        if (startBtn) {
            startBtn.disabled = connectedCount < 5;
            startBtn.querySelector('span').textContent = connectedCount < 5
                ? `开始游戏（还需 ${5 - connectedCount} 人）`
                : '开始游戏';
        }
    },

    renderRoleReadyStatus(players, gameData) {
        const container = document.getElementById('ready-status');
        if (!container) return null;

        container.innerHTML = '';

        const playerOrder = gameData?.playerOrder || Object.keys(players || {});
        let readyCount = 0;

        for (const playerId of playerOrder) {
            const player = players[playerId];
            if (!player) continue;

            const isReady = !!player.isReady;
            if (isReady) readyCount++;

            const div = document.createElement('div');
            div.className = 'ready-player' + (isReady ? ' ready' : '');
            div.innerHTML = `
                <span class="ready-icon">${isReady ? '✓' : '○'}</span>
                <span class="ready-name">${player.name}</span>
            `;
            container.appendChild(div);
        }

        const progress = document.getElementById('ready-progress');
        if (progress) {
            progress.textContent = `${readyCount}/${playerOrder.length} 已准备`;
        }

        return {
            readyCount,
            totalCount: playerOrder.length
        };
    },

    renderRoleCard(role, nightInfo, playerNames) {
        const card = document.getElementById('my-role-card');
        const icon = document.getElementById('role-icon');
        const name = document.getElementById('role-name');
        const description = document.getElementById('role-description');
        const info = document.getElementById('role-info');

        card.classList.remove('good', 'evil', 'neutral', 'revealed');
        icon.textContent = '?';
        name.textContent = '点击查看身份';
        description.textContent = '';
        info.innerHTML = '';

        if (!role) {
            card.onclick = null;
            return;
        }

        card.onclick = () => {
            card.classList.add('revealed', role.team);
            icon.textContent = role.icon;
            name.textContent = role.name;
            description.textContent = this.getRoleDescription(role);

            if (nightInfo?.length) {
                info.innerHTML = nightInfo.map((item) => {
                    const names = item.players.map((playerId) => playerNames[playerId] || playerId).join(', ');
                    return `<div><strong>${item.label}:</strong> ${names}</div>`;
                }).join('');
            }

            document.getElementById('ready-btn').style.display = 'block';
            card.onclick = null;
        };
    },

    renderMissionTrack(results, currentMission, playerCount) {
        const sizes = MISSION_SIZES[playerCount] || [2, 3, 2, 3, 3];
        const missionResults = results || [null, null, null, null, null];

        for (let index = 0; index < 5; index++) {
            const mission = document.getElementById('mission-' + (index + 1));
            if (!mission) continue;

            mission.classList.remove('current', 'success', 'fail');
            mission.innerHTML = `<span>${sizes[index]}</span>`;

            if (missionResults[index] === true) {
                mission.classList.add('success');
                mission.innerHTML = '<span>✓</span>';
            } else if (missionResults[index] === false) {
                mission.classList.add('fail');
                mission.innerHTML = '<span>✕</span>';
            } else if (index === currentMission) {
                mission.classList.add('current');
            }
        }
    },

    renderRejectTrack(rejectCount) {
        for (let index = 1; index <= 5; index++) {
            const marker = document.getElementById('reject-' + index);
            marker.classList.toggle('active', index <= rejectCount);
        }
    },

    renderGamePlayers(players, gameData, selectable = false, onSelect = null) {
        const container = document.getElementById('game-players');
        container.innerHTML = '';

        if (!gameData?.playerOrder?.length) return;

        const captainId = gameData.playerOrder[gameData.captainIndex || 0];
        const selectedTeam = gameData.selectedTeam || [];
        const exiledPlayers = gameData.exiledPlayers || [];

        for (const playerId of gameData.playerOrder) {
            const player = players[playerId];
            if (!player) continue;

            const tag = [];
            if (playerId === captainId) tag.push('队长');
            if (playerId === RoomManager.playerId) tag.push('你');
            if (player.connected === false) tag.push('离线');

            const div = document.createElement('div');
            div.className = 'game-player';
            if (playerId === captainId) div.classList.add('captain');
            if (selectedTeam.includes(playerId)) div.classList.add('on-team');
            if (exiledPlayers.includes(playerId)) div.classList.add('exiled');
            if (player.connected === false) div.classList.add('offline');

            div.innerHTML = `
                <div class="player-name">${player.name}</div>
                <div class="player-tag">${tag.join(' / ')}</div>
            `;

            if (selectable && !exiledPlayers.includes(playerId)) {
                div.addEventListener('click', () => onSelect?.(playerId));
            }

            container.appendChild(div);
        }
    },

    renderActionPanel(content) {
        document.getElementById('action-panel').innerHTML = content;
    },

    renderVoteView(team, players, description) {
        document.getElementById('vote-title').textContent = '队伍投票';
        document.getElementById('vote-description').textContent = description;

        const teamDiv = document.getElementById('vote-team');
        teamDiv.innerHTML = '';

        for (const playerId of team) {
            const span = document.createElement('span');
            span.className = 'team-member';
            span.textContent = players[playerId]?.name || playerId;
            teamDiv.appendChild(span);
        }

        document.getElementById('vote-approve').style.display = 'inline-flex';
        document.getElementById('vote-reject').style.display = 'inline-flex';
        document.getElementById('vote-waiting').style.display = 'none';
    },

    showVoteWaiting(castCount, totalCount) {
        document.getElementById('vote-approve').style.display = 'none';
        document.getElementById('vote-reject').style.display = 'none';
        document.getElementById('vote-waiting').style.display = 'block';
        document.getElementById('votes-cast').textContent = castCount;
        document.getElementById('votes-total').textContent = totalCount;
    },

    renderMissionView(isOnTeam, canFail) {
        const instruction = document.getElementById('mission-instruction');
        const successBtn = document.getElementById('mission-success');
        const failBtn = document.getElementById('mission-fail');
        const waiting = document.getElementById('mission-waiting');

        if (isOnTeam) {
            instruction.textContent = '你正在执行任务，请选择要提交的任务牌';
            successBtn.style.display = 'inline-flex';
            failBtn.style.display = canFail ? 'inline-flex' : 'none';
            waiting.style.display = 'none';
        } else {
            instruction.textContent = '等待任务队员完成任务...';
            successBtn.style.display = 'none';
            failBtn.style.display = 'none';
            waiting.style.display = 'block';
        }
    },

    renderTribunalPrompt(voted) {
        if (voted) {
            this.renderActionPanel(`
                <p style="text-align: center; color: var(--text-secondary);">
                    等待其他玩家决定是否发起放逐...
                </p>
            `);
            return;
        }

        this.renderActionPanel(`
            <p style="text-align: center; margin-bottom: 16px;">是否发起放逐？</p>
            <div class="action-choice">
                <button class="btn btn-danger" onclick="App.voteInitiateTribunal(true)">
                    <span>发起放逐</span>
                </button>
                <button class="btn btn-secondary" onclick="App.voteInitiateTribunal(false)">
                    <span>跳过</span>
                </button>
            </div>
        `);
    },

    renderTribunalVoting(players, gameData, myVote) {
        const container = document.getElementById('tribunal-players');
        container.innerHTML = '';

        document.getElementById('tribunal-phase').textContent = myVote
            ? '等待其他玩家投票...'
            : '选择一名玩家进行放逐';

        const exiledPlayers = gameData.exiledPlayers || [];
        const voteCount = {};

        for (const [voterId, targetId] of Object.entries(gameData.tribunalVotes || {})) {
            if (!exiledPlayers.includes(voterId)) {
                voteCount[targetId] = (voteCount[targetId] || 0) + 1;
            }
        }

        for (const playerId of gameData.playerOrder || []) {
            if (exiledPlayers.includes(playerId)) continue;

            const div = document.createElement('div');
            div.className = 'tribunal-player';
            if (myVote === playerId) div.classList.add('voted');

            div.innerHTML = `
                <div class="player-name">${players[playerId]?.name || playerId}</div>
                ${voteCount[playerId] ? `<div class="vote-count">${voteCount[playerId]} 票</div>` : ''}
            `;

            if (!myVote && playerId !== RoomManager.playerId) {
                div.addEventListener('click', () => App.castTribunalVote(playerId));
            }

            container.appendChild(div);
        }
    },

    renderAssassinView(players, gameData, isAssassin) {
        const instruction = document.getElementById('assassin-instruction');
        const targets = document.getElementById('assassin-targets');
        const waiting = document.getElementById('assassin-waiting');

        targets.innerHTML = '';

        if (!isAssassin) {
            instruction.textContent = '';
            waiting.style.display = 'block';
            return;
        }

        instruction.textContent = '好人完成了三次任务。请选择你认为是梅林的玩家进行刺杀。';
        waiting.style.display = 'none';

        for (const playerId of gameData.playerOrder || []) {
            const role = GameManager.getRoleById(gameData.roles?.[playerId]);
            if (!role || role.team === 'evil') continue;
            if ((gameData.exiledPlayers || []).includes(playerId)) continue;

            const div = document.createElement('div');
            div.className = 'assassin-target';
            div.innerHTML = `<div class="player-name">${players[playerId]?.name || playerId}</div>`;
            div.addEventListener('click', () => App.assassinate(playerId));
            targets.appendChild(div);
        }
    },

    renderResult(gameData, players) {
        const card = document.querySelector('.result-card');
        const title = document.getElementById('result-title');
        const description = document.getElementById('result-description');
        const rolesDiv = document.getElementById('all-roles');
        const neutralDiv = document.getElementById('neutral-results');

        card.classList.remove('good-win', 'evil-win');
        if (gameData.winners === 'good') {
            card.classList.add('good-win');
            title.textContent = '好人阵营获胜';
        } else if (gameData.winners === 'neutral') {
            title.textContent = '中立角色获胜';
        } else {
            card.classList.add('evil-win');
            title.textContent = '坏人阵营获胜';
        }

        description.textContent = gameData.winReason || '';
        rolesDiv.innerHTML = '';

        for (const playerId of gameData.playerOrder || []) {
            const role = GameManager.getRoleById(gameData.roles?.[playerId]);
            if (!role) continue;

            const item = document.createElement('div');
            item.className = 'role-reveal-item';
            item.innerHTML = `
                <span>${players[playerId]?.name || playerId}</span>
                <span class="role-tag ${role.team}">${role.icon} ${role.name}</span>
            `;
            rolesDiv.appendChild(item);
        }

        const neutralResults = GameManager.checkNeutralWin();
        if (!neutralResults.length) {
            neutralDiv.innerHTML = '';
            return;
        }

        neutralDiv.innerHTML = '<h4>中立角色结算</h4>';
        neutralResults.forEach((result) => {
            neutralDiv.innerHTML += `
                <div style="margin: 8px 0;">
                    <strong>${result.playerName}</strong> (${result.role.name}): ${result.won ? '胜利' : '失败'}
                    <br><small style="color: var(--text-muted);">${result.reason}</small>
                </div>
            `;
        });
    },

    updateInquisitorButton(canUse) {
        const button = document.getElementById('inquisitor-btn');
        const myRole = GameManager.getMyRole();

        if (myRole?.id === 'inquisitor') {
            button.style.display = 'block';
            button.disabled = !canUse;
        } else {
            button.style.display = 'none';
        }
    },

    renderInquisitorTargets(players, gameData) {
        const container = document.getElementById('inquisitor-targets');
        container.innerHTML = '';
        const eligibleTargets = GameManager.getInquisitorEligibleTargetIds(gameData);

        if (eligibleTargets.length === 0) {
            container.innerHTML = '<p class="hint">上一轮没有可查看的上车玩家</p>';
            return;
        }

        for (const playerId of eligibleTargets) {
            const button = document.createElement('button');
            button.className = 'btn btn-secondary';
            button.textContent = players[playerId]?.name || playerId;
            button.addEventListener('click', () => App.useInquisitorSkill(playerId));
            container.appendChild(button);
        }
    },

    renderExileVoteView(targetName, description) {
        document.getElementById('vote-title').textContent = '放逐投票';
        document.getElementById('vote-description').textContent = description;

        const teamDiv = document.getElementById('vote-team');
        teamDiv.innerHTML = '';

        const span = document.createElement('span');
        span.className = 'team-member exile-target';
        span.textContent = '目标: ' + targetName;
        span.style.borderColor = 'var(--accent-red)';
        span.style.background = 'rgba(239, 68, 68, 0.2)';
        teamDiv.appendChild(span);

        document.getElementById('vote-approve').style.display = 'inline-flex';
        document.getElementById('vote-reject').style.display = 'inline-flex';
        document.getElementById('vote-waiting').style.display = 'none';
    },

    renderExileTargetSelection(players, gameData, selectable, onSelect) {
        const container = document.getElementById('game-players');
        container.innerHTML = '';

        if (!gameData?.playerOrder?.length) return;

        const captainId = gameData.playerOrder[gameData.captainIndex || 0];
        const exiledPlayers = gameData.exiledPlayers || [];

        for (const playerId of gameData.playerOrder) {
            const player = players[playerId];
            if (!player) continue;

            const tag = [];
            if (playerId === captainId) tag.push('队长');
            if (playerId === RoomManager.playerId) tag.push('你');
            if (player.connected === false) tag.push('离线');

            const div = document.createElement('div');
            div.className = 'game-player';
            if (playerId === captainId) div.classList.add('captain');
            if (playerId === gameData.exileTarget) div.classList.add('exile-selected');
            if (exiledPlayers.includes(playerId)) div.classList.add('exiled');
            if (player.connected === false) div.classList.add('offline');

            if (playerId === gameData.exileTarget) {
                div.style.borderColor = 'var(--accent-red)';
                div.style.background = 'rgba(239, 68, 68, 0.15)';
            }

            div.innerHTML = `
                <div class="player-name">${player.name}</div>
                <div class="player-tag">${tag.join(' / ')}</div>
            `;

            if (selectable && playerId !== captainId && !exiledPlayers.includes(playerId)) {
                div.addEventListener('click', () => onSelect?.(playerId));
            }

            container.appendChild(div);
        }
    }
};

window.UI = UI;
