const UI = {
    currentView: 'home',

    escapeHTML(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    },

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
        container.innerHTML = mountId === 'home-rules'
            ? '<div class="rules-card"><p class="hint">5—10 人 · 6 套玩法模板 · 固定阵营<br>在大厅选择预设，或编辑角色、技能与事件组合。</p></div>' : '';
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
        this.updateRoomTools();
    },

    showToast(message, duration = 3000) {
        const toast = document.getElementById('toast');
        toast.textContent = message;
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), duration);
    },

    updateBrokerStatus(state, message) {
        const status = document.getElementById('broker-status');
        if (!status) return;
        status.dataset.state = state || 'idle';
        const text = status.querySelector('.broker-status-text');
        if (text) text.textContent = message || '';
        const banner = document.getElementById('connection-banner');
        if (banner) {
            banner.dataset.state = state || 'idle';
            document.getElementById('connection-message').textContent = message || '';
            document.getElementById('reconnect-btn').hidden = ['connected', 'idle'].includes(state);
        }
    },

    updateRoomTools() {
        const inRoom = this.currentView !== 'home' && !!RoomManager.currentRoom;
        const banner = document.getElementById('connection-banner');
        if (banner) banner.hidden = !inRoom;
        const hasGame = inRoom && this.currentView !== 'lobby' && !!GameManager.gameData?.gameId;
        const button = document.getElementById('player-notes-btn');
        if (button) button.hidden = !hasGame;
        const dialog = document.getElementById('player-notes-dialog');
        if (!hasGame && dialog?.open) dialog.close();
    },

    openPlayerNotes(playerId = null) {
        this.renderPlayerNotes();
        const dialog = document.getElementById('player-notes-dialog');
        if (!dialog.open) dialog.showModal();
        if (playerId) {
            const row = [...document.querySelectorAll('.notes-player')].find((item) => item.dataset.playerId === playerId);
            row?.scrollIntoView({ block: 'nearest' });
            row?.querySelector('select')?.focus();
        }
    },

    renderPlayerNotes() {
        const list = document.getElementById('player-notes-list');
        if (!list || typeof PlayerNotes === 'undefined') return;
        list.replaceChildren();
        for (const playerId of this.getPlayerDisplayOrder(GameManager.players, GameManager.gameData)) {
            const player = GameManager.players[playerId];
            const row = document.createElement('div');
            row.className = 'notes-player';
            row.dataset.playerId = playerId;
            const name = document.createElement('p');
            name.className = 'notes-player-name';
            const tags = [playerId === RoomManager.playerId ? '你' : '',
                (GameManager.gameData?.exiledPlayers || []).includes(playerId) ? '已放逐' : '',
                player.left ? '已离场' : player.connected === false ? '离线' : ''].filter(Boolean);
            name.textContent = player.name + (tags.length ? `（${tags.join(' / ')}）` : '');
            row.appendChild(name);
            const fields = document.createElement('div');
            fields.className = 'notes-fields';
            const mark = PlayerNotes.get(playerId);
            for (const [field, title, options] of [
                ['judgment', '阵营判断', Object.entries(PlayerNotes.judgments)],
                ['roleId', '猜测身份', Object.values(ROLES).map((role) => [role.id, role.name])]
            ]) {
                const label = document.createElement('label');
                label.textContent = title;
                const select = document.createElement('select');
                select.setAttribute('aria-label', `${player.name}的${title}`);
                for (const [value, text] of [['', '未标记'], ...options]) {
                    const option = document.createElement('option');
                    option.value = value;
                    option.textContent = text;
                    select.appendChild(option);
                }
                select.value = mark[field];
                select.addEventListener('change', () => {
                    PlayerNotes.set(playerId, { ...PlayerNotes.get(playerId), [field]: select.value });
                    this.refreshNoteBadges();
                });
                label.appendChild(select);
                fields.appendChild(label);
            }
            row.appendChild(fields);
            list.appendChild(row);
        }
        this.refreshNoteBadges();
    },

    refreshNoteBadges() {
        for (const button of document.querySelectorAll('.player-note-badge')) {
            const label = PlayerNotes.label(button.dataset.playerId);
            button.textContent = label || '＋ 标记';
            button.dataset.judgment = PlayerNotes.get(button.dataset.playerId).judgment;
        }
        const hint = document.getElementById('player-notes-hint');
        if (hint) hint.textContent = PlayerNotes.persistent
            ? '仅自己可见，自动保存在此浏览器；新对局会清空。'
            : '仅自己可见。浏览器未允许保存，当前标记刷新后会丢失。';
    },

    appendNoteButton(container, playerId) {
        if (typeof PlayerNotes === 'undefined' || !PlayerNotes.scope) return;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'player-note-badge';
        button.dataset.playerId = playerId;
        button.dataset.judgment = PlayerNotes.get(playerId).judgment;
        button.textContent = PlayerNotes.label(playerId) || '＋ 标记';
        button.setAttribute('aria-label', `标记${GameManager.players[playerId]?.name || '玩家'}（仅自己可见）`);
        button.addEventListener('click', (event) => {
            event.stopPropagation();
            this.openPlayerNotes(playerId);
        });
        container.appendChild(button);
    },

    getPlayerDisplayOrder(players, gameData = null) {
        // Room order is independent of role assignment and legacy shuffled turn orders.
        return Object.keys(players || {})
            .filter((id) => players[id] && (!gameData?.playerOrder || gameData.playerOrder.includes(id)))
            .sort((a, b) => (players[a].joinedAt || 0) - (players[b].joinedAt || 0));
    },

    renderLobbyPlayers(players) {
        const list = document.getElementById('player-list');
        list.innerHTML = '';

        const entries = this.getPlayerDisplayOrder(players)
            .filter((id) => !players[id].left).map((id) => [id, players[id]]);
        const connectedCount = entries.filter(([, player]) => player.connected !== false).length;

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

        const playerOrder = this.getPlayerDisplayOrder(players, gameData).filter((playerId) => {
            const player = players[playerId];
            return player && !player.left && player.connected !== false;
        });
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
                <span class="ready-name">${this.escapeHTML(player.name)}</span>
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
                    const names = item.players
                        .map((playerId) => this.escapeHTML(playerNames[playerId] || playerId))
                        .join(', ');
                    return `<div><strong>${item.label}:</strong> ${names}</div>`;
                }).join('');
            }

            document.getElementById('ready-btn').style.display = 'block';
            card.onclick = null;
        };
    },

    renderMissionTrack(results, currentMission, playerCount) {
        const game = GameManager.gameData;
        const sizes = game?.rules?.missionSizes || MISSION_SIZES[playerCount] || [2, 3, 2, 3, 3];
        const missionResults = results || [null, null, null, null, null];

        for (let index = 0; index < 5; index++) {
            const mission = document.getElementById('mission-' + (index + 1));
            if (!mission) continue;

            mission.classList.remove('current', 'success', 'fail');
            const size = index === currentMission && game ? GameManager.getCurrentMissionSize(game) : sizes[index];
            const fails = index === currentMission && game ? GameManager.getRequiredMissionFails(game) : game?.rules?.missionFails[index] || (index === 3 && playerCount >= 7 ? 2 : 1);
            mission.innerHTML = `<span>${size}</span>`;
            mission.title = `第 ${index + 1} 场，${size} 人，${fails} 张失败牌判失败`;

            if (missionResults[index] === true) {
                mission.classList.add('success');
                mission.innerHTML = game?.missionWeights?.[index] === 2 ? '<span>✓×2</span>' : '<span>✓</span>';
            } else if (missionResults[index] === false) {
                mission.classList.add('fail');
                mission.innerHTML = game?.missionWeights?.[index] === 2 ? '<span>✕×2</span>' : '<span>✕</span>';
            } else if (index === currentMission) {
                mission.classList.add('current');
            }
        }
    },

    renderRejectTrack(rejectCount) {
        const limit = GameManager.rules().rejectionLimit;
        const container = document.querySelector('.reject-markers');
        if (!container) return;
        container.innerHTML = Array.from({ length: limit }, (_, i) => `<div class="reject-marker ${i < rejectCount ? 'active' : ''}" title="${i + 1} / ${limit}"></div>`).join('');
    },

    renderGamePlayers(players, gameData, selectable = false, onSelect = null) {
        const container = document.getElementById('game-players');
        container.innerHTML = '';

        if (!gameData?.playerOrder?.length) return;

        const captainId = gameData.playerOrder[gameData.captainIndex || 0];
        const selectedTeam = gameData.selectedTeam || [];
        const exiledPlayers = gameData.exiledPlayers || [];

        for (const playerId of this.getPlayerDisplayOrder(players, gameData)) {
            const player = players[playerId];
            if (!player) continue;

            const tag = [];
            if (playerId === captainId) tag.push('队长');
            if (playerId === RoomManager.playerId) tag.push('你');
            if (player.left) tag.push('已离场');
            else if (player.connected === false) tag.push('离线');

            const div = document.createElement('div');
            div.className = 'game-player';
            if (playerId === captainId) div.classList.add('captain');
            if (selectedTeam.includes(playerId)) div.classList.add('on-team');
            if (exiledPlayers.includes(playerId)) div.classList.add('exiled');
            if (player.left || player.connected === false) div.classList.add('offline');

            div.innerHTML = `
                <div class="player-name">${this.escapeHTML(player.name)}</div>
                <div class="player-tag">${tag.join(' / ')}</div>
            `;

            if (selectable && !exiledPlayers.includes(playerId) && !player.left && player.connected !== false) {
                div.addEventListener('click', () => onSelect?.(playerId));
            }

            this.appendNoteButton(div, playerId);

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

        for (const playerId of this.getPlayerDisplayOrder(players, { playerOrder: team })) {
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

        for (const playerId of this.getPlayerDisplayOrder(players, gameData)) {
            if (exiledPlayers.includes(playerId)) continue;

            const div = document.createElement('div');
            div.className = 'tribunal-player';
            if (myVote === playerId) div.classList.add('voted');

            div.innerHTML = `
                <div class="player-name">${this.escapeHTML(players[playerId]?.name || playerId)}</div>
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

        instruction.textContent = '好人累计三点任务进度。请选择你认为是梅林的玩家进行刺杀。';
        waiting.style.display = 'none';

        for (const playerId of this.getPlayerDisplayOrder(players, gameData)) {
            if (playerId === RoomManager.playerId) continue;

            const div = document.createElement('div');
            div.className = 'assassin-target';
            const exileLabel = (gameData.exiledPlayers || []).includes(playerId) ? '（已放逐）' : '';
            div.innerHTML = `<div class="player-name">${this.escapeHTML(players[playerId]?.name || playerId)}${exileLabel}</div>`;
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
        } else if (gameData.winners === 'aborted') {
            title.textContent = '对局已安全中止';
        } else {
            card.classList.add('evil-win');
            title.textContent = '坏人阵营获胜';
        }

        description.textContent = gameData.winReason || '';
        rolesDiv.innerHTML = '';

        for (const playerId of this.getPlayerDisplayOrder(players, gameData)) {
            const role = GameManager.getRoleById(gameData.revealedRoles?.[playerId] || gameData.roles?.[playerId]);
            if (!role) continue;

            const item = document.createElement('div');
            item.className = 'role-reveal-item';
            item.innerHTML = `
                <span>${this.escapeHTML(players[playerId]?.name || playerId)}</span>
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
                    <strong>${this.escapeHTML(result.playerName)}</strong> (${result.role.name}): ${result.won ? '胜利' : '失败'}
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

        for (const playerId of this.getPlayerDisplayOrder(players, { playerOrder: eligibleTargets })) {
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

        for (const playerId of this.getPlayerDisplayOrder(players, gameData)) {
            const player = players[playerId];
            if (!player) continue;

            const tag = [];
            if (playerId === captainId) tag.push('队长');
            if (playerId === RoomManager.playerId) tag.push('你');
            if (player.left) tag.push('已离场');
            else if (player.connected === false) tag.push('离线');

            const div = document.createElement('div');
            div.className = 'game-player';
            if (playerId === captainId) div.classList.add('captain');
            if (playerId === gameData.exileTarget) div.classList.add('exile-selected');
            if (exiledPlayers.includes(playerId)) div.classList.add('exiled');
            if (player.left || player.connected === false) div.classList.add('offline');

            if (playerId === gameData.exileTarget) {
                div.style.borderColor = 'var(--accent-red)';
                div.style.background = 'rgba(239, 68, 68, 0.15)';
            }

            div.innerHTML = `
                <div class="player-name">${this.escapeHTML(player.name)}</div>
                <div class="player-tag">${tag.join(' / ')}</div>
            `;

            if (
                selectable
                && playerId !== captainId
                && !exiledPlayers.includes(playerId)
                && !player.left
                && player.connected !== false
            ) {
                div.addEventListener('click', () => onSelect?.(playerId));
            }

            container.appendChild(div);
        }
    }
};

window.UI = UI;
