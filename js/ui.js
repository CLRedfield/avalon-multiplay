// ===== UI 渲染 =====

const UI = {
    currentView: 'home',

    // 显示视图
    showView(viewId) {
        document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
        const view = document.getElementById(viewId + '-view');
        if (view) {
            view.classList.add('active');
            this.currentView = viewId;
        }
    },

    // Toast 提示
    showToast(message, duration = 3000) {
        const toast = document.getElementById('toast');
        toast.textContent = message;
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), duration);
    },

    // 更新玩家列表（大厅）
    renderLobbyPlayers(players) {
        const list = document.getElementById('player-list');
        list.innerHTML = '';

        let count = 0;
        for (const [pid, player] of Object.entries(players)) {
            count++;
            const li = document.createElement('li');
            li.textContent = player.name;
            if (player.isHost) li.classList.add('host');
            if (pid === RoomManager.playerId) li.classList.add('me');
            if (player.isExiled) li.classList.add('exiled');
            list.appendChild(li);
        }

        document.getElementById('player-count').textContent = `(${count}/10)`;

        // 更新开始按钮状态
        const startBtn = document.getElementById('start-game-btn');
        if (startBtn) {
            startBtn.disabled = count < 5;
            startBtn.querySelector('span').textContent = count < 5
                ? `开始游戏 (需要${5 - count}人)`
                : '开始游戏';
        }
    },

    // 渲染角色查看阶段的准备状态
    renderRoleReadyStatus(players, gameData) {
        const container = document.getElementById('ready-status');
        if (!container) return;

        container.innerHTML = '';
        const playerOrder = gameData?.playerOrder || Object.keys(players);
        let readyCount = 0;
        const totalCount = playerOrder.length;

        for (const pid of playerOrder) {
            const player = players[pid];
            if (!player) continue;

            const isReady = player.isReady;
            if (isReady) readyCount++;

            const div = document.createElement('div');
            div.className = 'ready-player' + (isReady ? ' ready' : '');
            div.innerHTML = `
                <span class="ready-icon">${isReady ? '✅' : '⏳'}</span>
                <span class="ready-name">${player.name}</span>
            `;
            container.appendChild(div);
        }

        // 更新准备进度
        const progressEl = document.getElementById('ready-progress');
        if (progressEl) {
            progressEl.textContent = `${readyCount}/${totalCount} 已准备`;
        }

        return { readyCount, totalCount };
    },

    // 渲染角色卡
    renderRoleCard(role, nightInfo, playerNames) {
        const card = document.getElementById('my-role-card');
        const icon = document.getElementById('role-icon');
        const name = document.getElementById('role-name');
        const desc = document.getElementById('role-description');
        const info = document.getElementById('role-info');

        card.classList.remove('good', 'evil', 'neutral', 'revealed');
        icon.textContent = '❓';
        name.textContent = '点击查看身份';
        desc.textContent = '';
        info.innerHTML = '';

        card.onclick = () => {
            card.classList.add('revealed', role.team);
            icon.textContent = role.icon;
            name.textContent = role.name;
            desc.textContent = role.description;

            // 显示夜晚信息
            if (nightInfo && nightInfo.length > 0) {
                let infoHtml = '';
                for (const item of nightInfo) {
                    const names = item.players.map(pid => playerNames[pid] || pid).join(', ');
                    infoHtml += `<div><strong>${item.label}:</strong> ${names}</div>`;
                }
                info.innerHTML = infoHtml;
            }

            document.getElementById('ready-btn').style.display = 'block';
            card.onclick = null;
        };
    },

    // 渲染任务进度
    renderMissionTrack(results, currentMission, playerCount) {
        const sizes = MISSION_SIZES[playerCount] || [2, 3, 2, 3, 3];
        // 确保results是数组
        const missionResults = results || [null, null, null, null, null];

        for (let i = 0; i < 5; i++) {
            const el = document.getElementById('mission-' + (i + 1));
            if (!el) continue;

            el.classList.remove('current', 'success', 'fail');
            el.innerHTML = `<span>${sizes[i]}</span>`;

            if (missionResults[i] === true) {
                el.classList.add('success');
                el.innerHTML = '<span>✓</span>';
            } else if (missionResults[i] === false) {
                el.classList.add('fail');
                el.innerHTML = '<span>✗</span>';
            } else if (i === currentMission) {
                el.classList.add('current');
            }
        }
    },

    // 渲染否决次数
    renderRejectTrack(rejectCount) {
        for (let i = 1; i <= 5; i++) {
            const el = document.getElementById('reject-' + i);
            el.classList.toggle('active', i <= rejectCount);
        }
    },

    // 渲染游戏玩家区域
    renderGamePlayers(players, gameData, selectable = false, onSelect = null) {
        const container = document.getElementById('game-players');
        container.innerHTML = '';

        // 安全检查
        if (!gameData || !gameData.playerOrder || gameData.playerOrder.length === 0) {
            console.warn('renderGamePlayers: playerOrder is missing');
            return;
        }

        const captain = gameData.playerOrder[gameData.captainIndex || 0];
        const team = gameData.selectedTeam || [];
        const exiled = gameData.exiledPlayers || [];

        for (const pid of gameData.playerOrder) {
            const player = players[pid];
            if (!player) continue;

            const div = document.createElement('div');
            div.className = 'game-player';
            if (pid === captain) div.classList.add('captain');
            if (team.includes(pid)) div.classList.add('on-team');
            if (exiled.includes(pid)) div.classList.add('exiled');

            let tag = '';
            if (pid === captain) tag = '👑 队长';
            else if (pid === RoomManager.playerId) tag = '(你)';

            div.innerHTML = `
                <div class="player-name">${player.name}</div>
                <div class="player-tag">${tag}</div>
            `;

            if (selectable && !exiled.includes(pid)) {
                div.addEventListener('click', () => {
                    if (onSelect) onSelect(pid);
                });
            }

            container.appendChild(div);
        }
    },

    // 渲染操作面板
    renderActionPanel(content) {
        document.getElementById('action-panel').innerHTML = content;
    },

    // 渲染投票界面
    renderVoteView(team, players, description) {
        document.getElementById('vote-title').textContent = '队伍表决';
        document.getElementById('vote-description').textContent = description;

        const teamDiv = document.getElementById('vote-team');
        teamDiv.innerHTML = '';
        for (const pid of team) {
            const span = document.createElement('span');
            span.className = 'team-member';
            span.textContent = players[pid]?.name || pid;
            teamDiv.appendChild(span);
        }

        document.getElementById('vote-approve').style.display = 'inline-flex';
        document.getElementById('vote-reject').style.display = 'inline-flex';
        document.getElementById('vote-waiting').style.display = 'none';
    },

    // 显示投票等待
    showVoteWaiting(cast, total) {
        document.getElementById('vote-approve').style.display = 'none';
        document.getElementById('vote-reject').style.display = 'none';
        document.getElementById('vote-waiting').style.display = 'block';
        document.getElementById('votes-cast').textContent = cast;
        document.getElementById('votes-total').textContent = total;
    },

    // 渲染任务界面
    renderMissionView(isOnTeam, canFail) {
        const instruction = document.getElementById('mission-instruction');
        const successBtn = document.getElementById('mission-success');
        const failBtn = document.getElementById('mission-fail');
        const waiting = document.getElementById('mission-waiting');

        if (isOnTeam) {
            instruction.textContent = '你正在执行此次任务，请选择你的行动';
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

    // 渲染放逐会议发起投票
    renderTribunalPrompt(voted) {
        if (voted) {
            this.renderActionPanel(`
                <p style="text-align: center; color: var(--text-secondary);">
                    等待其他玩家投票是否发起放逐会议...
                </p>
            `);
        } else {
            this.renderActionPanel(`
                <p style="text-align: center; margin-bottom: 16px;">
                    任务失败！是否发起放逐会议？
                </p>
                <div class="action-choice">
                    <button class="btn btn-danger" onclick="App.voteInitiateTribunal(true)">
                        <span>⚖️ 发起放逐</span>
                    </button>
                    <button class="btn btn-secondary" onclick="App.voteInitiateTribunal(false)">
                        <span>跳过</span>
                    </button>
                </div>
            `);
        }
    },

    // 渲染放逐会议投票
    renderTribunalVoting(players, gameData, myVote) {
        const container = document.getElementById('tribunal-players');
        container.innerHTML = '';

        document.getElementById('tribunal-phase').textContent = myVote
            ? '等待其他玩家投票...'
            : '选择一名玩家进行放逐';

        const exiled = gameData.exiledPlayers || [];
        const votes = gameData.tribunalVotes || {};

        // 统计票数
        const voteCount = {};
        for (const [voterId, targetId] of Object.entries(votes)) {
            if (!exiled.includes(voterId)) {
                voteCount[targetId] = (voteCount[targetId] || 0) + 1;
            }
        }

        for (const pid of gameData.playerOrder) {
            if (exiled.includes(pid)) continue;
            const player = players[pid];

            const div = document.createElement('div');
            div.className = 'tribunal-player';
            if (myVote === pid) div.classList.add('voted');

            div.innerHTML = `
                <div class="player-name">${player?.name || pid}</div>
                ${voteCount[pid] ? `<div class="vote-count">${voteCount[pid]} 票</div>` : ''}
            `;

            if (!myVote && pid !== RoomManager.playerId) {
                div.addEventListener('click', () => App.castTribunalVote(pid));
            }

            container.appendChild(div);
        }
    },

    // 渲染刺客界面
    renderAssassinView(players, gameData, isAssassin) {
        const instruction = document.getElementById('assassin-instruction');
        const targets = document.getElementById('assassin-targets');
        const waiting = document.getElementById('assassin-waiting');

        if (isAssassin) {
            instruction.textContent = '好人已完成3个任务！选择你认为是梅林的玩家进行刺杀';
            targets.innerHTML = '';
            waiting.style.display = 'none';

            const exiled = gameData.exiledPlayers || [];

            for (const pid of gameData.playerOrder) {
                if (exiled.includes(pid)) continue;
                const role = GameManager.getRoleById(gameData.roles[pid]);
                if (role.team === 'evil') continue; // 不能刺杀坏人

                const player = players[pid];
                const div = document.createElement('div');
                div.className = 'assassin-target';
                div.innerHTML = `<div class="player-name">${player?.name || pid}</div>`;
                div.addEventListener('click', () => App.assassinate(pid));
                targets.appendChild(div);
            }
        } else {
            instruction.textContent = '';
            targets.innerHTML = '';
            waiting.style.display = 'block';
        }
    },

    // 渲染游戏结果
    renderResult(gameData, players) {
        const card = document.querySelector('.result-card');
        const title = document.getElementById('result-title');
        const desc = document.getElementById('result-description');
        const rolesDiv = document.getElementById('all-roles');
        const neutralDiv = document.getElementById('neutral-results');

        card.classList.remove('good-win', 'evil-win');

        if (gameData.winners === 'good') {
            card.classList.add('good-win');
            title.textContent = '🏆 好人阵营胜利!';
        } else {
            card.classList.add('evil-win');
            title.textContent = '💀 坏人阵营胜利!';
        }

        desc.textContent = gameData.winReason || '';

        // 显示所有角色
        rolesDiv.innerHTML = '';
        for (const pid of gameData.playerOrder) {
            const player = players[pid];
            const role = GameManager.getRoleById(gameData.roles[pid]);

            const div = document.createElement('div');
            div.className = 'role-reveal-item';
            div.innerHTML = `
                <span>${player?.name || pid}</span>
                <span class="role-tag ${role.team}">${role.icon} ${role.name}</span>
            `;
            rolesDiv.appendChild(div);
        }

        // 显示中立角色结果
        const neutralResults = GameManager.checkNeutralWin();
        if (neutralResults.length > 0) {
            neutralDiv.innerHTML = '<h4>中立角色结算</h4>';
            for (const nr of neutralResults) {
                const resultText = nr.won ? '✅ 胜利' : '❌ 失败';
                neutralDiv.innerHTML += `
                    <div style="margin: 8px 0;">
                        <strong>${nr.playerName}</strong> (${nr.role.name}): ${resultText}
                        <br><small style="color: var(--text-muted);">${nr.reason}</small>
                    </div>
                `;
            }
        } else {
            neutralDiv.innerHTML = '';
        }
    },

    // 更新审判官按钮
    updateInquisitorButton(canUse) {
        const btn = document.getElementById('inquisitor-btn');
        const myRole = GameManager.getMyRole();

        if (myRole?.id === 'inquisitor') {
            btn.style.display = 'block';
            btn.disabled = !canUse;
        } else {
            btn.style.display = 'none';
        }
    },

    // 渲染审判官目标选择
    renderInquisitorTargets(players, gameData) {
        const container = document.getElementById('inquisitor-targets');
        container.innerHTML = '';

        const exiled = gameData.exiledPlayers || [];

        for (const pid of gameData.playerOrder) {
            if (pid === RoomManager.playerId) continue;
            if (exiled.includes(pid)) continue;

            const player = players[pid];
            const btn = document.createElement('button');
            btn.className = 'btn btn-secondary';
            btn.textContent = player?.name || pid;
            btn.addEventListener('click', () => App.useInquisitorSkill(pid));
            container.appendChild(btn);
        }
    },

    // 渲染放逐投票界面
    renderExileVoteView(targetName, description) {
        document.getElementById('vote-title').textContent = '放逐表决';
        document.getElementById('vote-description').textContent = description;

        const teamDiv = document.getElementById('vote-team');
        teamDiv.innerHTML = '';

        const span = document.createElement('span');
        span.className = 'team-member exile-target';
        span.textContent = '🎯 ' + targetName;
        span.style.borderColor = 'var(--accent-red)';
        span.style.background = 'rgba(239, 68, 68, 0.2)';
        teamDiv.appendChild(span);

        document.getElementById('vote-approve').style.display = 'inline-flex';
        document.getElementById('vote-reject').style.display = 'inline-flex';
        document.getElementById('vote-waiting').style.display = 'none';
    },

    // 渲染放逐目标选择界面
    renderExileTargetSelection(players, gameData, selectable, onSelect) {
        const container = document.getElementById('game-players');
        container.innerHTML = '';

        if (!gameData || !gameData.playerOrder || gameData.playerOrder.length === 0) {
            console.warn('renderExileTargetSelection: playerOrder is missing');
            return;
        }

        const captain = gameData.playerOrder[gameData.captainIndex || 0];
        const exileTarget = gameData.exileTarget;
        const exiled = gameData.exiledPlayers || [];

        for (const pid of gameData.playerOrder) {
            const player = players[pid];
            if (!player) continue;

            const div = document.createElement('div');
            div.className = 'game-player';
            if (pid === captain) div.classList.add('captain');
            if (pid === exileTarget) div.classList.add('exile-selected');
            if (exiled.includes(pid)) div.classList.add('exiled');

            let tag = '';
            if (pid === captain) tag = '👑 队长';
            else if (pid === RoomManager.playerId) tag = '(你)';

            // 放逐目标高亮
            if (pid === exileTarget) {
                div.style.borderColor = 'var(--accent-red)';
                div.style.background = 'rgba(239, 68, 68, 0.15)';
            }

            div.innerHTML = `
                <div class="player-name">${player.name}</div>
                <div class="player-tag">${tag}</div>
            `;

            // 队长可以选择放逐目标（不能选自己，不能选已放逐的）
            if (selectable && pid !== captain && !exiled.includes(pid)) {
                div.addEventListener('click', () => {
                    if (onSelect) onSelect(pid);
                });
            }

            container.appendChild(div);
        }
    }
};

window.UI = UI;
