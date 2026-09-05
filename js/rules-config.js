// Public, versioned recipes. This module never contains assigned identities or a shuffled deck.
const ROUND_EVENTS = {
    regroup: { name: '重整编队', pool: 'strategy', description: '队伍至少包含一名上一场队员、一名上一场未上车的玩家。' },
    rotation: { name: '圆桌轮值', pool: 'strategy', description: '本场首位队长额外顺延一位，之后正常轮换。' },
    truce: { name: '暂缓放逐', pool: 'strategy', description: '本场任务完成前不能发起放逐。' },
    scrutiny: { name: '审慎表决', pool: 'strategy', description: '任务组队需要至少三分之二有效投票者同意，放逐仍需过半。' },
    reinforcement: { name: '临时增援', pool: 'chaos', description: '本场任务队伍增加一人，上限为尚未出局的人数。' },
    barrier: { name: '守护屏障', pool: 'chaos', description: '本场任务失败门槛增加一张，上限为任务人数。' },
    crisis: { name: '单点危机', pool: 'chaos', description: '本场任务只需一张失败牌就会失败。' },
    double: { name: '双倍战果', pool: 'chaos', description: '本场成败计为两点进度，累计三点触发阵营胜利或刺杀。实际场次仍只增加一场。' }
};

const GameConfig = {
    version: 1,
    storageKey: 'avalon_workshop_templates_v1',
    role(id) { return Object.values(ROLES).find((role) => role.id === id); },
    clone(value) { return JSON.parse(JSON.stringify(value)); },
    eventIds(pool) { return Object.keys(ROUND_EVENTS).filter((id) => !pool || ROUND_EVENTS[id].pool === pool); },
    base(playerCount) {
        return {
            playerCount, roleCounts: {}, neutralSlots: 0, neutralPool: [],
            missionSizes: [...MISSION_SIZES[playerCount]],
            missionFails: [1, 1, 1, playerCount >= 7 ? 2 : 1, 1],
            exileEnabled: true, maxExiles: null, rejectionLimit: 5, assassinationEnabled: true,
            eventPool: [], eventRounds: [true, true, true, true, true]
        };
    },
    preset(id = 'legacy') {
        const names = { legacy: '现有玩法', light: '轻量推理', mist: '迷雾身份', council: '圆桌议会', neutral: '中立博弈', chaos: '混沌盛宴' };
        if (!Object.hasOwn(names, id)) throw new Error('未知预设');
        const template = { version: this.version, id, name: names[id], variants: {} };
        const fill = (config, ids, count, filler) => {
            for (let i = 0; i < count; i++) {
                const role = ids[i] || filler;
                config.roleCounts[role] = (config.roleCounts[role] || 0) + 1;
            }
        };
        for (let n = 5; n <= 10; n++) {
            const config = this.base(n);
            if (id === 'legacy') {
                const distribution = ROLE_DISTRIBUTION[n];
                for (const role of [...distribution.good, ...distribution.evil]) {
                    config.roleCounts[role.id] = (config.roleCounts[role.id] || 0) + 1;
                }
                config.neutralSlots = n >= 7 ? 1 : 0;
                config.neutralPool = n >= 7 ? ['scapegoat', 'armsdealer', 'cultist'] : [];
            } else {
                const neutral = ['neutral', 'chaos'].includes(id);
                const [good, evil] = (neutral
                    ? [[3, 1], [3, 2], [4, 2], [5, 2], [6, 2], [6, 3]]
                    : [[3, 2], [4, 2], [4, 3], [5, 3], [6, 3], [6, 4]])[n - 5];
                const goodRoles = id === 'light' ? ['merlin'] : id === 'mist'
                    ? ['merlin', 'percival', 'spy', 'witness'] : ['merlin', 'oathkeeper', 'witness', 'spy'];
                const evilRoles = id === 'light' ? ['assassin'] : id === 'mist'
                    ? ['assassin', 'morgana', 'hermit', 'illusionist'] : ['assassin', 'blackguard'];
                fill(config, goodRoles, good, 'loyal');
                fill(config, evilRoles, evil, 'minion');
                config.exileEnabled = !['light', 'mist'].includes(id);
                config.maxExiles = id === 'council' ? 2 : null;
                config.neutralSlots = neutral ? 1 : 0;
                config.neutralPool = !neutral ? [] : n <= 6 ? ['scapegoat', 'gambler']
                    : ['scapegoat', 'armsdealer', 'cultist', 'gambler', 'bountyhunter'];
                config.eventPool = id === 'council' ? this.eventIds('strategy') : id === 'chaos' ? this.eventIds() : [];
            }
            template.variants[n] = config;
        }
        return template;
    },
    presets() { return ['legacy', 'light', 'mist', 'council', 'neutral', 'chaos'].map((id) => this.preset(id)); },
    validate(config, n = config?.playerCount) {
        const errors = [];
        if (!config || typeof config !== 'object' || !Number.isInteger(n) || n < 5 || n > 10) return ['人数必须为 5—10 人'];
        if (config.playerCount !== n) errors.push('配方人数不匹配');
        const counts = config.roleCounts;
        if (!counts || typeof counts !== 'object' || Array.isArray(counts)) return ['角色名额无效'];
        let total = 0, good = 0, evil = 0;
        for (const [id, count] of Object.entries(counts)) {
            const role = this.role(id);
            if (!role || !Number.isInteger(count) || count < 0 || count > 10) { errors.push('角色或名额无效：' + id); continue; }
            if (!['loyal', 'minion'].includes(id) && count > 1) errors.push(role.name + '最多一名');
            total += count;
            if (role.team === 'good') good += count;
            if (role.team === 'evil') evil += count;
        }
        if (!Number.isInteger(config.neutralSlots) || config.neutralSlots < 0 || config.neutralSlots > 5) errors.push('中立随机席位无效');
        else total += config.neutralSlots;
        if (total !== n) errors.push(`角色总数为 ${total}，需要 ${n} 人`);
        if (!good || !evil) errors.push('至少需要一名好人和一名坏人');
        const pool = config.neutralPool;
        if (!Array.isArray(pool) || pool.length > 5 || new Set(pool).size !== pool.length || pool.some((id) => this.role(id)?.team !== 'neutral')) {
            errors.push('中立候选池无效');
        } else {
            if (pool.some((id) => counts[id] > 0)) errors.push('固定中立角色不能同时出现在随机池中');
            if (config.neutralSlots > pool.length) errors.push('中立候选数量少于随机席位');
        }
        for (const key of ['exileEnabled', 'assassinationEnabled']) if (typeof config[key] !== 'boolean') errors.push('规则开关无效');
        if (config.assassinationEnabled && (counts.merlin !== 1 || counts.assassin !== 1)) errors.push('开启刺杀必须包含梅林和刺客');
        if (config.maxExiles !== null && (!Number.isInteger(config.maxExiles) || config.maxExiles < 0 || config.maxExiles > 10)) errors.push('放逐上限应为 0—10 或不限');
        if (!Number.isInteger(config.rejectionLimit) || config.rejectionLimit < 1 || config.rejectionLimit > 10) errors.push('连续否决上限应为 1—10');
        const possible = [...Object.keys(counts).filter((id) => counts[id] > 0), ...(config.neutralSlots > 0 && Array.isArray(pool) ? pool : [])];
        for (const id of ['scapegoat', 'cultist', 'bountyhunter']) {
            if (!possible.includes(id)) continue;
            const needed = id === 'cultist' ? 3 : id === 'bountyhunter' ? 2 : 1;
            if (!config.exileEnabled || (config.maxExiles !== null && config.maxExiles < needed)) errors.push(`${this.role(id).name}需要至少 ${needed} 次放逐机会`);
        }
        if (!Array.isArray(config.missionSizes) || config.missionSizes.length !== 5 || config.missionSizes.some((size) => !Number.isInteger(size) || size < 1 || size > n)) errors.push('五场任务人数必须在 1 至本局人数之间');
        if (!Array.isArray(config.missionFails) || config.missionFails.length !== 5 || config.missionFails.some((fails, i) => !Number.isInteger(fails) || fails < 1 || fails > config.missionSizes?.[i])) errors.push('失败门槛必须在 1 至对应任务人数之间');
        if (!Array.isArray(config.eventPool) || config.eventPool.length > 8 || new Set(config.eventPool).size !== config.eventPool.length || config.eventPool.some((id) => !Object.hasOwn(ROUND_EVENTS, id))) errors.push('事件池无效');
        if (!Array.isArray(config.eventRounds) || config.eventRounds.length !== 5 || config.eventRounds.some((value) => typeof value !== 'boolean')) errors.push('需要设置五场任务的事件开关');
        return errors;
    },
    normalizeTemplate(value) {
        if (!value || value.version !== this.version) throw new Error('模板版本不受支持');
        if (typeof value.name !== 'string' || !value.name.trim() || value.name.length > 40) throw new Error('模板名称需要 1—40 个字符');
        const template = { version: this.version, id: typeof value.id === 'string' ? value.id.slice(0, 80) : 'custom', name: value.name.trim(), variants: {} };
        for (let n = 5; n <= 10; n++) {
            const config = value.variants?.[n];
            const errors = this.validate(config, n);
            if (errors.length) throw new Error(`${n} 人配置：${errors.join('；')}`);
            // Pick supported fields explicitly; imported metadata never becomes authority state.
            const clean = {};
            for (const key of Object.keys(this.base(n))) clean[key] = this.clone(config[key]);
            template.variants[n] = clean;
        }
        return template;
    },
    parse(text) {
        if (typeof text !== 'string' || text.length > 100000) throw new Error('模板文件过大');
        return this.normalizeTemplate(JSON.parse(text));
    },
    stringify(template) { return JSON.stringify(this.normalizeTemplate(template), null, 2); },
    resolve(settings, n) {
        const template = settings?.template ? this.normalizeTemplate(settings.template) : this.preset('legacy');
        const config = this.clone(template.variants[n]);
        // Compatibility for pre-workshop fixtures and settings, never for a frozen running game.
        if (!settings?.template && Array.isArray(settings?.neutralPool) && n >= 7) {
            config.neutralPool = [...settings.neutralPool];
            if (!config.neutralPool.length) {
                config.neutralSlots = 0;
                const fallback = n === 10 ? 'oberon' : 'loyal';
                config.roleCounts[fallback] = (config.roleCounts[fallback] || 0) + 1;
            }
        }
        const errors = this.validate(config, n);
        if (errors.length) throw new Error(errors.join('；'));
        return { ...config, version: this.version, templateId: template.id, templateName: template.name };
    },
    assign(playerIds, config) {
        const errors = this.validate(config, playerIds.length);
        if (errors.length) throw new Error(errors.join('；'));
        const roles = Object.entries(config.roleCounts).flatMap(([id, count]) => Array(count).fill(id));
        roles.push(...shuffleList(config.neutralPool).slice(0, config.neutralSlots));
        const shuffled = shuffleList(roles);
        return Object.fromEntries(playerIds.map((id, index) => [id, this.role(shuffled[index])]));
    },
    loadSaved() {
        const saved = JSON.parse(localStorage.getItem(this.storageKey) || '[]');
        if (!Array.isArray(saved) || saved.length > 50) throw new Error('保存的模板格式无效');
        return saved.map((template) => this.normalizeTemplate(template));
    },
    save(template) {
        const clean = this.normalizeTemplate(template);
        const saved = this.loadSaved().filter((item) => item.id !== clean.id);
        if (saved.length >= 50) throw new Error('最多保存 50 个模板');
        saved.push(clean);
        localStorage.setItem(this.storageKey, JSON.stringify(saved));
        return clean;
    }
};

window.ROUND_EVENTS = ROUND_EVENTS;
window.GameConfig = GameConfig;
