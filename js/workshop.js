const Workshop = {
    draft: null,
    count: 5,
    reference: 'roles',
    skillKey: null,
    skillTargets: [],
    skillPredictions: [true, false, true],
    skillPending: false,
    clock: null,
    e(value) { return UI.escapeHTML(value); },
    name(id) { return GameManager.players[id]?.name || id; },
    names(ids) { return (ids || []).map((id) => this.name(id)).join('、'); },
    countPlayers() { return Object.values(RoomManager.latestPlayers || {}).filter((p) => p && !p.left && p.connected !== false).length; },
    template() { return RoomManager.latestSettings?.template || GameConfig.preset('legacy'); },
    init() {
        document.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => document.getElementById(button.dataset.close).close()));
        document.querySelectorAll('[data-reference]').forEach((button) => button.addEventListener('click', () => this.openReference(button.dataset.reference)));
        document.getElementById('template-name').addEventListener('input', () => { this.draft.name = document.getElementById('template-name').value; this.showErrors(); });
        document.getElementById('template-copy').addEventListener('click', () => {
            this.collect();
            this.draft.id = this.newId();
            this.draft.name = this.draft.name.slice(0, 35) + ' 副本';
            document.getElementById('template-name').value = this.draft.name;
            this.showErrors('已复制，可修改后保存');
        });
        document.getElementById('template-save').addEventListener('click', () => this.save());
        document.getElementById('template-apply').addEventListener('click', () => this.apply());
        document.getElementById('template-export').addEventListener('click', () => this.export());
        document.getElementById('template-import').addEventListener('change', async (event) => {
            const file = event.target.files[0];
            event.target.value = '';
            if (!file) return;
            try {
                if (file.size > 100000) throw new Error('模板文件不能超过 100 KB');
                this.openEditor(GameConfig.parse(await file.text()), true);
            } catch (error) { UI.showToast('导入失败：' + error.message, 6000); }
        });
    },
    newId() { return 'custom_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8); },
    summary(config) {
        const roleText = Object.entries(config.roleCounts).filter(([, count]) => count > 0)
            .map(([id, count]) => `${GameConfig.role(id).name} × ${count}`).join(' · ');
        const pool = config.neutralSlots ? `<p>随机中立 × ${config.neutralSlots}：${this.e(config.neutralPool.map((id) => GameConfig.role(id).name).join('、'))}</p>` : '';
        const events = config.eventPool.length ? config.eventPool.map((id) => ROUND_EVENTS[id].name).join('、') : '关闭';
        return `<div class="recipe-summary"><p class="recipe-roles">${this.e(roleText)}</p>${pool}
            <dl class="recipe-facts"><div><dt>任务人数</dt><dd>${config.missionSizes.join(' / ')}</dd></div>
            <div><dt>失败门槛</dt><dd>${config.missionFails.join(' / ')}</dd></div>
            <div><dt>放逐</dt><dd>${!config.exileEnabled ? '关闭' : config.maxExiles === null ? '不限次数' : `最多成功 ${config.maxExiles} 次`}</dd></div>
            <div><dt>连续否决</dt><dd>${config.rejectionLimit} 次判坏人胜</dd></div>
            <div><dt>刺杀</dt><dd>${config.assassinationEnabled ? '开启' : '关闭'}</dd></div></dl>
            <details><summary>事件与结算规则</summary><p>事件池：${this.e(events)}</p>
            <p>抽牌场次：${config.eventRounds.map((on, i) => on ? i + 1 : null).filter(Boolean).join('、') || '不抽牌'}。每场最多一张，否决与放逐不重抽。</p>
            <p>累计三点任务进度触发阵营胜利或刺杀。中立即时胜利优先，同一结算点达标的中立玩家共同获胜。个人情报与技能来源保持秘密，正常终局后公开复盘。</p>
            <p>永久离场或放逐后按剩余人数收缩任务队伍；临时断线不收缩。特殊身份各一名，阵营整局固定。</p></details></div>`;
    },
    renderLobby() {
        const mount = document.getElementById('workshop-lobby');
        if (!mount) return;
        const n = Math.max(5, Math.min(10, this.countPlayers()));
        const template = this.template();
        const config = template.variants[n];
        let saved = [], storageError = '';
        try { saved = GameConfig.loadSaved(); } catch (_) { storageError = '本机模板暂不可读取，仍可使用预设或导入文件。'; }
        const choices = [...GameConfig.presets(), ...saved];
        if (!choices.some((item) => item.id === template.id && JSON.stringify(item) === JSON.stringify(template))) choices.push(template);
        const selected = choices.findLastIndex((item) => item.id === template.id && JSON.stringify(item) === JSON.stringify(template));
        const host = RoomManager.isHost && RoomManager.roomState === 'waiting';
        mount.innerHTML = `<div class="section-heading"><div><span class="eyebrow">本局玩法 · ${n} 人配方</span><h3>${this.e(template.name)}</h3></div><button type="button" id="lobby-guide" class="text-button">图鉴</button></div>
            ${host ? `<label class="sr-only" for="preset-select">选择玩法模板</label><select id="preset-select">${choices.map((item, index) => `<option value="${index}" ${index === selected ? 'selected' : ''}>${this.e(item.name)}</option>`).join('')}</select>
            <div class="workshop-toolbar"><button type="button" id="edit-template" class="text-button">编辑 / 另存模板</button><button type="button" id="import-template" class="text-button">导入 JSON</button></div>` : '<p class="hint">房主配置已同步给所有玩家</p>'}
            ${this.summary(config)}${storageError ? `<p class="hint">${storageError}</p>` : ''}`;
        document.getElementById('lobby-guide').onclick = () => this.openReference('roles');
        if (host) {
            document.getElementById('edit-template').onclick = () => this.openEditor(template);
            document.getElementById('import-template').onclick = () => document.getElementById('template-import').click();
            document.getElementById('preset-select').onchange = async (event) => {
                const choice = choices[Number(event.target.value)];
                event.target.disabled = true;
                try { await RoomManager.updateTemplate(choice); }
                catch (error) { UI.showToast(error.message); }
                finally { this.renderLobby(); }
            };
        }
    },
    openEditor(template, copy = false) {
        this.draft = GameConfig.clone(template);
        if (copy || GameConfig.presets().some((item) => item.id === template.id)) {
            this.draft.id = this.newId();
            this.draft.name = template.name.slice(0, 34) + ' 自定义';
        }
        this.count = Math.max(5, Math.min(10, this.countPlayers()));
        document.getElementById('template-name').value = this.draft.name;
        this.renderEditor();
        const dialog = document.getElementById('workshop-dialog');
        if (!dialog.open) dialog.showModal();
    },
    renderEditor() {
        const config = this.draft.variants[this.count];
        const tabs = document.getElementById('workshop-counts');
        tabs.innerHTML = Array.from({ length: 6 }, (_, i) => `<button type="button" data-count="${i + 5}" aria-pressed="${i + 5 === this.count}">${i + 5} 人</button>`).join('');
        tabs.querySelectorAll('button').forEach((button) => button.onclick = () => { this.collect(); this.count = Number(button.dataset.count); this.renderEditor(); });
        const checked = (on) => on ? 'checked' : '';
        const roles = ['good', 'evil', 'neutral'].map((team) => `<section class="editor-role-group"><h4>${({ good: '好人', evil: '坏人', neutral: '固定中立' })[team]}</h4>
            ${Object.values(ROLES).filter((role) => role.team === team).map((role) => `<label class="role-count-row"><span title="${this.e(role.description)}">${role.icon} ${role.name}</span><input type="number" data-role="${role.id}" min="0" max="${['loyal', 'minion'].includes(role.id) ? 10 : 1}" value="${config.roleCounts[role.id] || 0}" aria-label="${role.name}人数"></label>`).join('')}</section>`).join('');
        const same = (ids) => ids.length === config.eventPool.length && ids.every((id) => config.eventPool.includes(id));
        const mode = config.eventPool.length === 0 ? 'off' : same(GameConfig.eventIds('strategy')) ? 'strategy' : same(GameConfig.eventIds('chaos')) ? 'chaos' : same(GameConfig.eventIds()) ? 'all' : 'custom';
        document.getElementById('workshop-fields').innerHTML = `<section class="editor-section"><div class="section-heading"><h3>角色名额</h3><span id="role-total"></span></div><div class="role-editor-grid">${roles}</div>
            <div class="neutral-editor"><label>随机中立席位 <input id="neutral-slots" type="number" min="0" max="5" value="${config.neutralSlots}"></label><p class="hint">候选池按席位随机抽取，不会与固定身份重复。</p>
            <div class="check-list">${Object.values(ROLES).filter((role) => role.team === 'neutral').map((role) => `<label><input type="checkbox" data-neutral="${role.id}" ${checked(config.neutralPool.includes(role.id))}>${role.name}</label>`).join('')}</div></div></section>
            <section class="editor-section"><h3>任务与胜负</h3><div class="check-list"><label><input id="exile-enabled" type="checkbox" ${checked(config.exileEnabled)}>允许放逐</label><label><input id="assassination-enabled" type="checkbox" ${checked(config.assassinationEnabled)}>开启刺杀</label></div>
            <div class="rule-inputs"><label>成功放逐上限<select id="exile-limit"><option value="unlimited" ${config.maxExiles === null ? 'selected' : ''}>不限</option>${Array.from({ length: 11 }, (_, i) => `<option value="${i}" ${config.maxExiles === i ? 'selected' : ''}>${i} 次</option>`).join('')}</select></label>
            <label>连续否决上限<input id="rejection-limit" type="number" min="1" max="10" value="${config.rejectionLimit}"></label></div>
            <div class="table-scroll"><table class="mission-editor"><caption>五场任务配方</caption><thead><tr><th>规则</th>${[1, 2, 3, 4, 5].map((i) => `<th>第 ${i} 场</th>`).join('')}</tr></thead><tbody>
            <tr><th>队员</th>${config.missionSizes.map((size, i) => `<td><input type="number" min="1" max="${this.count}" data-size="${i}" value="${size}" aria-label="第${i + 1}场队员人数"></td>`).join('')}</tr>
            <tr><th>失败牌</th>${config.missionFails.map((fails, i) => `<td><input type="number" min="1" max="${this.count}" data-fails="${i}" value="${fails}" aria-label="第${i + 1}场失败门槛"></td>`).join('')}</tr>
            <tr><th>抽事件</th>${config.eventRounds.map((on, i) => `<td><input type="checkbox" data-round="${i}" ${checked(on)} aria-label="第${i + 1}场抽事件"></td>`).join('')}</tr></tbody></table></div></section>
            <section class="editor-section"><h3>事件池</h3><label class="sr-only" for="event-mode">选择事件池</label><select id="event-mode">${[['off', '关闭事件'], ['strategy', '策略事件'], ['chaos', '混沌事件'], ['all', '全部混搭'], ['custom', '自选卡池']].map(([id, name]) => `<option value="${id}" ${id === mode ? 'selected' : ''}>${name}</option>`).join('')}</select>
            <div class="event-editor">${Object.entries(ROUND_EVENTS).map(([id, event]) => `<label class="event-option"><input type="checkbox" data-event="${id}" ${checked(config.eventPool.includes(id))}><span><strong>${event.name}</strong><small>${event.pool === 'strategy' ? '策略' : '混沌'} · ${event.description}</small></span></label>`).join('')}</div></section>`;
        document.getElementById('workshop-fields').querySelectorAll('input, select').forEach((input) => input.addEventListener('input', () => {
            this.collect();
            if (input.dataset.event) document.getElementById('event-mode').value = 'custom';
            this.showErrors();
        }));
        document.getElementById('event-mode').onchange = (event) => {
            const mode = event.target.value;
            if (mode === 'custom') return;
            config.eventPool = mode === 'off' ? [] : GameConfig.eventIds(mode === 'all' ? null : mode);
            this.renderEditor();
        };
        this.showErrors();
    },
    collect() {
        if (!this.draft) return;
        const config = this.draft.variants[this.count];
        const root = document.getElementById('workshop-fields');
        this.draft.name = document.getElementById('template-name').value;
        root.querySelectorAll('[data-role]').forEach((input) => { config.roleCounts[input.dataset.role] = input.valueAsNumber; });
        config.neutralSlots = document.getElementById('neutral-slots').valueAsNumber;
        config.neutralPool = [...root.querySelectorAll('[data-neutral]:checked')].map((input) => input.dataset.neutral);
        config.exileEnabled = document.getElementById('exile-enabled').checked;
        config.assassinationEnabled = document.getElementById('assassination-enabled').checked;
        config.maxExiles = document.getElementById('exile-limit').value === 'unlimited' ? null : Number(document.getElementById('exile-limit').value);
        config.rejectionLimit = document.getElementById('rejection-limit').valueAsNumber;
        root.querySelectorAll('[data-size]').forEach((input) => { config.missionSizes[Number(input.dataset.size)] = input.valueAsNumber; });
        root.querySelectorAll('[data-fails]').forEach((input) => { config.missionFails[Number(input.dataset.fails)] = input.valueAsNumber; });
        root.querySelectorAll('[data-round]').forEach((input) => { config.eventRounds[Number(input.dataset.round)] = input.checked; });
        config.eventPool = [...root.querySelectorAll('[data-event]:checked')].map((input) => input.dataset.event);
    },
    showErrors(message = '') {
        const errors = [];
        for (let n = 5; n <= 10; n++) errors.push(...GameConfig.validate(this.draft.variants[n], n).map((error) => `${n} 人：${error}`));
        if (!this.draft.name.trim()) errors.unshift('请填写模板名称');
        const status = document.getElementById('workshop-errors');
        status.classList.toggle('has-error', !!errors.length);
        status.textContent = errors.length ? errors.join('；') : message || '5—10 人配方均通过校验。新增预设为实验玩法，可按试玩结果调整。';
        ['template-save', 'template-apply', 'template-export'].forEach((id) => { document.getElementById(id).disabled = !!errors.length || (id === 'template-apply' && (!RoomManager.isHost || RoomManager.roomState !== 'waiting')); });
        const config = this.draft.variants[this.count];
        document.getElementById('role-total').textContent = `${Object.values(config.roleCounts).reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0) + (config.neutralSlots || 0)} / ${this.count} 席`;
        return errors;
    },
    save() {
        this.collect();
        try { GameConfig.save(this.draft); this.showErrors('模板已保存到本机'); this.renderLobby(); }
        catch (error) { this.showErrors('保存失败：' + error.message + '。可导出 JSON 保留配置。'); }
    },
    async apply() {
        this.collect();
        const button = document.getElementById('template-apply');
        button.disabled = true;
        try {
            await RoomManager.updateTemplate(this.draft);
            document.getElementById('workshop-dialog').close();
            UI.showToast('玩法已同步给全员');
        } catch (error) { this.showErrors(error.message); }
    },
    export() {
        this.collect();
        try {
            const url = URL.createObjectURL(new Blob([GameConfig.stringify(this.draft)], { type: 'application/json' }));
            const link = document.createElement('a');
            link.href = url; link.download = 'avalon-template.json'; document.body.appendChild(link); link.click(); link.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        } catch (error) { this.showErrors(error.message); }
    },
    updateGame(game) {
        document.getElementById('game-reference-tools').hidden = !game;
        const banner = document.getElementById('round-context');
        banner.hidden = !game || game.phase === 'night' || game.phase === 'ended';
        if (game && !banner.hidden) {
            const event = game.activeEvent && ROUND_EVENTS[game.activeEvent.id];
            banner.innerHTML = `<div class="round-metrics">第 ${game.currentMission + 1} 场 · ${GameManager.getCurrentMissionSize(game)} 人 / ${GameManager.getRequiredMissionFails(game)} 张失败牌判失败 <span>好人 ${GameManager.missionScore(game, true)} : ${GameManager.missionScore(game, false)} 坏人</span></div>
                ${event ? `<strong>${event.pool === 'chaos' ? '混沌' : '策略'}事件 · ${event.name}${game.activeEvent.revoked ? '（已撤销）' : ''}</strong><p>${event.description}</p>` : '<p>本场无事件，按本局配方进行。</p>'}`;
        }
        if (game?.phase !== 'roundSkill') { clearInterval(this.clock); this.clock = null; this.skillKey = null; }
        if (document.getElementById('reference-dialog').open) this.renderReference();
    },
    skillState(game) {
        return GameManager.privateGameId === game.gameId ? GameManager.privateExpansion : null;
    },
    renderSkill(game) {
        UI.showView('round-skill');
        const key = `${game.gameId}:${game.currentMission}`;
        if (this.skillKey !== key) {
            this.skillKey = key; this.skillTargets = []; this.skillPending = false;
            this.skillPredictions = [...(this.skillState(game)?.predictions || [true, false, true])];
        }
        const state = this.skillState(game);
        const role = GameManager.getMyRole(game);
        const id = RoomManager.playerId;
        const active = GameManager.getActivePlayerIds(game).includes(id);
        const submitted = state?.submittedMission === game.currentMission;
        const canUse = state && !state.used && active && !submitted && (['witness', 'spy'].includes(role?.id)
            || (['oathkeeper', 'blackguard'].includes(role?.id) && GameManager.canExile(game)) || (role?.id === 'gambler' && game.currentMission === 0));
        const targets = role?.id === 'witness' ? (game.missionTeamHistory?.[game.currentMission - 1] || []).filter((pid) => pid !== id)
            : GameManager.remainingPlayerIds(game).filter((pid) => pid !== id);
        this.skillTargets = this.skillTargets.filter((pid) => targets.includes(pid));
        const count = ['spy', 'witness'].includes(role?.id) ? 2 : 1;
        const root = document.getElementById('round-skill-content');
        root.innerHTML = !state || !role ? '<p>正在安全接收身份与技能状态…</p>' : `<div class="skill-role"><span>${role.icon}</span><h3>${role.name}</h3></div>
            <p class="skill-description">${this.e(role.description)}</p>
            ${submitted ? '<p class="skill-message">本窗口已提交，等待其他玩家。</p>' : !active ? '<p class="skill-message">你已出局，可以查看时间线和已有情报。</p>' : `${canUse ? role.id === 'gambler'
                ? `<div class="prediction-inputs">${this.skillPredictions.map((value, i) => `<label>第 ${i + 1} 场<select data-prediction="${i}"><option value="true" ${value ? 'selected' : ''}>成功</option><option value="false" ${!value ? 'selected' : ''}>失败</option></select></label>`).join('')}</div>`
                : `<p class="hint">选择 ${count} 名玩家${role.id === 'witness' ? '（上一场任务队员）' : ''}</p><div class="skill-targets">${targets.map((pid, index) => `<button type="button" data-target-index="${index}" aria-pressed="${this.skillTargets.includes(pid)}">${this.e(this.name(pid))}</button>`).join('') || '<p>当前没有可选目标，可保留技能。</p>'}</div>` : '<p class="hint">本窗口没有可用能力，跳过不会消耗技能。</p>'}
                <div class="skill-actions">${canUse ? `<button id="skill-use" type="button" class="btn btn-primary" ${this.skillPending || (role.id !== 'gambler' && this.skillTargets.length !== count) ? 'disabled' : ''}>${role.id === 'gambler' ? '确认预测' : '使用技能'}</button>` : ''}
                <button id="skill-pass" type="button" class="btn btn-secondary" ${this.skillPending ? 'disabled' : ''}>${this.skillPending ? '正在提交…' : role.id === 'gambler' ? '保留当前预测' : '跳过，保留技能'}</button></div>`}`;
        root.querySelectorAll('[data-target-index]').forEach((button) => button.onclick = () => {
            if (this.skillPending) return;
            const pid = targets[Number(button.dataset.targetIndex)];
            if (this.skillTargets.includes(pid)) this.skillTargets = this.skillTargets.filter((item) => item !== pid);
            else if (count === 1) this.skillTargets = [pid];
            else if (this.skillTargets.length < count) this.skillTargets.push(pid);
            this.renderSkill(game);
        });
        root.querySelectorAll('[data-prediction]').forEach((select) => select.onchange = () => { this.skillPredictions[Number(select.dataset.prediction)] = select.value === 'true'; });
        if (document.getElementById('skill-use')) document.getElementById('skill-use').onclick = () => this.submitSkill('use');
        if (document.getElementById('skill-pass')) document.getElementById('skill-pass').onclick = () => this.submitSkill('pass');
        const tick = () => {
            const seconds = Math.max(0, Math.ceil((GameManager.gameData?.skillDeadline - Date.now()) / 1000));
            document.getElementById('skill-countdown').textContent = `${seconds} 秒`;
            document.getElementById('skill-progress').textContent = `已提交 ${GameManager.gameData?.skillSubmittedCount || 0} / ${GameManager.getActivePlayerIds().length}`;
            if (seconds === 0) root.querySelectorAll('button, select').forEach((input) => { input.disabled = true; });
        };
        clearInterval(this.clock); tick(); this.clock = setInterval(tick, 250);
    },
    async submitSkill(choice) {
        if (this.skillPending) return;
        this.skillPending = true;
        const key = this.skillKey;
        this.renderSkill(GameManager.gameData);
        try { await database.sendAction('submitRoundSkill', { choice, targets: [...this.skillTargets], predictions: [...this.skillPredictions] }, { sealToHost: true }); }
        catch (error) { UI.showToast(error.message); }
        finally {
            this.skillPending = false;
            if (this.skillKey === key && GameManager.gameData?.phase === 'roundSkill') this.renderSkill(GameManager.gameData);
        }
    },
    openReference(kind) {
        this.reference = kind;
        this.renderReference();
        const dialog = document.getElementById('reference-dialog');
        if (!dialog.open) dialog.showModal();
    },
    resultText(result) {
        const names = this.names(result.targets);
        if (result.kind === 'spy') return `${names}：${result.sameTeam ? '同一阵营' : '不同阵营'}`;
        if (result.kind === 'witness') return `第 ${result.mission} 场，${names}：${result.hasFail ? '至少一人提交失败牌' : '两人均提交成功牌'}`;
        return `第 ${result.mission} 场，已保护 ${names}（任务完成时到期）`;
    },
    renderReference() {
        const root = document.getElementById('reference-content');
        const title = document.getElementById('reference-title');
        const game = GameManager.gameData;
        const scroll = document.getElementById('reference-dialog').scrollTop;
        if (this.reference === 'roles') {
            title.textContent = '角色与事件图鉴';
            root.innerHTML = `<p class="hint">19 个角色 · 8 张事件卡。角色阵营固定，只有本局配置中的角色和事件会出现。</p>${['good', 'evil', 'neutral'].map((team) => `<section class="reference-section"><h3>${({ good: '好人阵营', evil: '坏人阵营', neutral: '中立阵营' })[team]}</h3>${Object.values(ROLES).filter((role) => role.team === team).map((role) => `<article class="catalog-entry"><h4>${role.icon} ${role.name}</h4><p>${this.e(role.description)}</p></article>`).join('')}</section>`).join('')}
                ${['strategy', 'chaos'].map((pool) => `<section class="reference-section"><h3>${pool === 'strategy' ? '策略事件' : '混沌事件'}</h3>${Object.values(ROUND_EVENTS).filter((event) => event.pool === pool).map((event) => `<article class="catalog-entry"><h4>${event.name}</h4><p>${event.description}</p></article>`).join('')}</section>`).join('')}`;
        } else if (this.reference === 'rules') {
            title.textContent = game?.rules?.templateName || this.template().name;
            root.innerHTML = this.summary(game?.rules || this.template().variants[Math.max(5, Math.min(10, this.countPlayers()))]);
        } else if (this.reference === 'intel') {
            title.textContent = '我的情报';
            const state = game && this.skillState(game);
            const info = GameManager.privateGameId === game?.gameId ? GameManager.privateNightInfo : [];
            root.innerHTML = `<p class="hint">仅你可见。信息来自当时的真实记录，身份阵营整局固定。</p>${info.map((item) => `<article class="catalog-entry"><h4>${this.e(item.label)}</h4><p>${this.e(this.names(item.players))}</p></article>`).join('')}
                ${state?.predictions ? `<p class="intel-line">前三场预测：${state.predictions.map((v) => v ? '成功' : '失败').join(' / ')}</p>` : ''}
                ${state?.bountyTargets ? `<p class="intel-line">赏金目标：${this.e(this.names(state.bountyTargets))}</p>` : ''}
                ${(state?.results || []).map((result) => `<p class="intel-line">${this.e(this.resultText(result))}</p>`).join('')}
                ${GameManager.lastPrivateInquisitorResult?.gameId === game?.gameId ? `<p class="intel-line">审判官：${this.e(GameManager.lastPrivateInquisitorResult.player)} 在第 ${GameManager.lastPrivateInquisitorResult.mission} 场提交 ${GameManager.lastPrivateInquisitorResult.vote === 'Fail' ? '失败' : '成功'}牌</p>` : ''}
                ${!info.length && !state?.results?.length && !state?.predictions && !state?.bountyTargets ? '<p>暂无额外情报。</p>' : ''}`;
        } else {
            title.textContent = game?.phase === 'ended' ? '终局复盘' : '本局时间线';
            root.innerHTML = this.historyHTML(game);
        }
        document.getElementById('reference-dialog').scrollTop = scroll;
    },
    historyHTML(game) {
        if (!game) return '<p>开局后会记录本局时间线。</p>';
        const lines = (game.history || []).map((entry) => {
            let text = '';
            if (entry.type === 'event') text = '抽到事件：' + ROUND_EVENTS[entry.eventId].name;
            if (entry.type === 'eventRevoked') text = entry.reason;
            if (entry.type === 'skillWindow') text = '进入秘密技能窗口';
            if (entry.type === 'proposal') text = this.name(entry.captainId) + (entry.team ? ' 提议队伍：' + this.names(entry.team) : ' 提议放逐：' + this.name(entry.target));
            if (entry.type === 'vote') text = `提案${entry.approved ? '通过' : '否决'}。` + Object.entries(entry.votes).map(([id, value]) => `${this.name(id)} ${value ? '赞成' : '反对'}`).join('；');
            if (entry.type === 'mission') text = `任务${entry.success ? '成功' : '失败'}，${entry.failCount} 张失败牌，计 ${entry.weight} 点。队伍：${this.names(entry.team)}`;
            if (entry.type === 'exile') text = this.name(entry.playerId) + ' 被放逐';
            if (entry.type === 'protected') text = this.name(entry.playerId) + ' 获得保护，本次放逐被抵消';
            if (entry.type === 'notice') text = entry.text;
            return `<li><span class="timeline-round">第 ${entry.mission} 场</span><p>${this.e(text)}</p></li>`;
        });
        let html = `<p class="hint">${game.phase === 'ended' ? this.e(game.winReason || '') : '进行中仅展示公共记录。真实任务牌、技能和秘密目标在正常结算后公开。'}</p><ol class="game-timeline">${lines.join('') || '<li>暂无公共记录。</li>'}</ol>`;
        if (game.phase === 'ended' && game.winners !== 'aborted' && game.revealedDetails) {
            const details = game.revealedDetails;
            html += `<section class="reference-section"><h3>真实身份与任务牌</h3><div class="table-scroll"><table class="replay-table"><thead><tr><th>玩家 / 身份</th>${[1, 2, 3, 4, 5].map((n) => `<th>第 ${n} 场</th>`).join('')}</tr></thead><tbody>${game.playerOrder.map((id) => `<tr><th>${this.e(this.name(id))}<small>${this.e(GameConfig.role(game.revealedRoles?.[id])?.name || '未知')}</small></th>${[0, 1, 2, 3, 4].map((i) => `<td>${details.missionHistory[id]?.[i] === true ? '成功' : details.missionHistory[id]?.[i] === false ? '失败' : '—'}</td>`).join('')}</tr>`).join('')}</tbody></table></div></section>
                <section class="reference-section"><h3>技能与秘密目标</h3>${details.skills.map((entry) => `<p class="intel-line">${this.e(this.name(entry.playerId))}：${this.e(entry.result ? this.resultText(entry.result) : '修改前三场预测')}</p>`).join('')}
                ${Object.entries(details.predictions).map(([id, values]) => `<p class="intel-line">${this.e(this.name(id))} 预测：${values.map((v) => v ? '成功' : '失败').join(' / ')}</p>`).join('')}
                ${Object.entries(details.bountyTargets).map(([id, targets]) => `<p class="intel-line">${this.e(this.name(id))} 的赏金目标：${this.e(this.names(targets))}</p>`).join('')}
                ${Object.entries(details.inquisitorResults || {}).map(([id, result]) => `<p class="intel-line">${this.e(this.name(id))} 查验：${this.e(result.player)} 在第 ${result.mission} 场提交 ${result.vote === 'Fail' ? '失败' : '成功'}牌</p>`).join('')}</section>`;
        } else if (game.phase === 'ended') html += '<p>对局中止，未公开缺失的秘密记录。</p>';
        return html;
    }
};
window.Workshop = Workshop;
