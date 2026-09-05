const ROLES = {
    MERLIN: {
        id: 'merlin',
        name: '梅林',
        icon: '🧙',
        team: 'good',
        description: '你知道谁是坏人（奥伯伦、隐士除外），呆呆鸟也会出现在你的视野。开启刺杀时，好人累计三点任务进度后，刺客还可以尝试刺杀你。'
    },
    PERCIVAL: {
        id: 'percival',
        name: '派西维尔',
        icon: '🛡️',
        team: 'good',
        description: '你看到梅林，以及本局存在的莫甘娜、幻术师，但不知道谁是谁。'
    },
    INQUISITOR: {
        id: 'inquisitor',
        name: '审判官',
        icon: '🔍',
        team: 'good',
        description: '每局可以使用一次技能，查看一名玩家上一轮任务中提交的是成功还是失败。'
    },
    LOYAL: {
        id: 'loyal',
        name: '忠臣',
        icon: '🗡️',
        team: 'good',
        description: '你是亚瑟阵营的普通忠臣，通过发言和投票找出坏人。'
    },

    ASSASSIN: {
        id: 'assassin',
        name: '刺客',
        icon: '🗡️',
        team: 'evil',
        description: '你知道其他坏人（奥伯伦除外）。开启刺杀时，好人累计三点任务进度后，你可以刺杀一名玩家；刺中梅林则坏人翻盘。'
    },
    MORGANA: {
        id: 'morgana',
        name: '莫甘娜',
        icon: '🔮',
        team: 'evil',
        description: '你知道其他坏人。在派西维尔眼中，你和梅林看起来一样。'
    },
    MINION: {
        id: 'minion',
        name: '爪牙',
        icon: '👁',
        team: 'evil',
        description: '你知道其他坏人（奥伯伦除外），帮助坏人破坏任务。'
    },
    OBERON: {
        id: 'oberon',
        name: '奥伯伦',
        icon: '🌑',
        team: 'evil',
        description: '你是隐藏的坏人。其他坏人看不到你，你也看不到其他坏人；梅林同样看不到你。'
    },

    SCAPEGOAT: {
        id: 'scapegoat',
        name: '呆呆鸟',
        icon: '🐑',
        team: 'neutral',
        description: '在梅林视角中你会被当成坏人。你的胜利条件是被放逐；被放逐时立即获胜。你整局只能提交 1 次失败牌。多个中立同时达标则共同获胜。'
    },
    ARMS_DEALER: {
        id: 'armsdealer',
        name: '军火商',
        icon: '💣',
        team: 'neutral',
        description: '梅林无法看出你。只要你存活并进入第 5 轮实际任务，你就立即获胜；你可以不限次数提交失败牌。多个中立同时达标则共同获胜。'
    },
    WITNESS: {
        id: 'witness', name: '见证者', icon: '🕯️', team: 'good',
        description: '每局一次，在技能窗口选择上一场任务中的两名其他队员，私下得知两人是否至少有一人提交失败牌。'
    },
    SPY: {
        id: 'spy', name: '密探', icon: '🔎', team: 'good',
        description: '每局一次，在技能窗口选择两名其他玩家，私下得知他们是否属于同一阵营。中立单独算一个阵营。'
    },
    OATHKEEPER: {
        id: 'oathkeeper', name: '守誓者', icon: '🛡️', team: 'good',
        description: '每局一次，在技能窗口保护一名其他玩家，抵消本场任务完成前对他的第一次成功放逐。保护来源不公开，同一目标的保护不叠加。'
    },
    HERMIT: {
        id: 'hermit', name: '隐士', icon: '🌘', team: 'evil',
        description: '梅林看不到你。你与其他坏人正常互认，奥伯伦除外。'
    },
    ILLUSIONIST: {
        id: 'illusionist', name: '幻术师', icon: '🪞', team: 'evil',
        description: '你进入派西维尔的候选名单，与梅林、莫甘娜混在一起。你与其他坏人正常互认，奥伯伦除外。'
    },
    BLACKGUARD: {
        id: 'blackguard', name: '黑卫', icon: '⚔️', team: 'evil',
        description: '每局一次，在技能窗口保护一名其他玩家，抵消本场任务完成前对他的第一次成功放逐。与守誓者的保护完全相同，来源不公开。'
    },
    GAMBLER: {
        id: 'gambler', name: '赌徒', icon: '🎲', team: 'neutral',
        description: '秘密预测前三场任务的成败，全部命中且未出局时立即获胜。默认成功、失败、成功，可在首次技能窗口修改。你只能提交成功牌。'
    },
    BOUNTY_HUNTER: {
        id: 'bountyhunter', name: '赏金客', icon: '🎯', team: 'neutral',
        description: '开局随机获得两名其他玩家作为秘密目标。两人都被放逐且你仍在场时立即获胜。你只能提交成功牌。'
    },
    CULTIST: {
        id: 'cultist',
        name: '狂热者',
        icon: '🔥',
        team: 'neutral',
        description: '梅林无法看出你。只要至少三名玩家被放逐且你仍然存活，你就立即获胜；你可以不限次数提交失败牌。多个中立同时达标则共同获胜。'
    }
};

const MISSION_SIZES = {
    5: [2, 3, 2, 3, 3],
    6: [2, 3, 4, 3, 4],
    7: [2, 3, 3, 4, 4],
    8: [3, 4, 4, 5, 5],
    9: [3, 4, 4, 5, 5],
    10: [3, 4, 4, 5, 5]
};

const ROLE_DISTRIBUTION = {
    5: {
        good: [ROLES.MERLIN, ROLES.PERCIVAL, ROLES.LOYAL],
        evil: [ROLES.MORGANA, ROLES.ASSASSIN],
        neutralCount: 0
    },
    6: {
        good: [ROLES.MERLIN, ROLES.PERCIVAL, ROLES.LOYAL, ROLES.LOYAL],
        evil: [ROLES.MORGANA, ROLES.ASSASSIN],
        neutralCount: 0
    },
    7: {
        good: [ROLES.MERLIN, ROLES.PERCIVAL, ROLES.LOYAL, ROLES.LOYAL],
        evil: [ROLES.MORGANA, ROLES.ASSASSIN],
        neutralCount: 1,
        neutralFallback: ROLES.LOYAL
    },
    8: {
        good: [ROLES.MERLIN, ROLES.PERCIVAL, ROLES.LOYAL, ROLES.LOYAL, ROLES.LOYAL],
        evil: [ROLES.MORGANA, ROLES.ASSASSIN],
        neutralCount: 1,
        neutralFallback: ROLES.LOYAL
    },
    9: {
        good: [ROLES.MERLIN, ROLES.PERCIVAL, ROLES.INQUISITOR, ROLES.LOYAL, ROLES.LOYAL, ROLES.LOYAL],
        evil: [ROLES.MORGANA, ROLES.ASSASSIN],
        neutralCount: 1,
        neutralFallback: ROLES.LOYAL
    },
    10: {
        good: [ROLES.MERLIN, ROLES.PERCIVAL, ROLES.INQUISITOR, ROLES.LOYAL, ROLES.LOYAL, ROLES.LOYAL],
        evil: [ROLES.MORGANA, ROLES.ASSASSIN, ROLES.MINION],
        neutralCount: 0,
        flexRoleMode: 'neutralWithOberonFallback'
    }
};

function assignRoles(playerIds, neutralPool) {
    const playerCount = playerIds.length;
    const distribution = ROLE_DISTRIBUTION[playerCount];

    if (!distribution) {
        throw new Error('Unsupported player count: ' + playerCount);
    }

    const allRoles = [...distribution.good, ...distribution.evil];
    const availableNeutralPool = Array.isArray(neutralPool) ? [...neutralPool] : [];

    for (let i = 0; i < (distribution.neutralCount || 0); i++) {
        const neutralRole = pickRandomRole(availableNeutralPool, distribution.neutralFallback || null);
        if (neutralRole) {
            allRoles.push(neutralRole);
        }
    }

    if (distribution.flexRoleMode === 'neutralWithOberonFallback') {
        allRoles.push(pickRandomRole(availableNeutralPool, ROLES.OBERON));
    }

    if (allRoles.length !== playerCount) {
        throw new Error('Role pool size mismatch for player count ' + playerCount);
    }

    const shuffledPlayers = shuffleList(playerIds);
    const shuffledRoles = shuffleList(allRoles);
    const assignments = {};

    for (let i = 0; i < shuffledPlayers.length; i++) {
        assignments[shuffledPlayers[i]] = shuffledRoles[i];
    }

    return assignments;
}

function getNightInfo(myRole, allAssignments, myPlayerId) {
    const info = [];
    if (!myRole) return info;

    if (myRole.id === 'merlin') {
        const evilPlayers = [];
        for (const [playerId, role] of Object.entries(allAssignments)) {
            if (playerId === myPlayerId) continue;
            if (role.team === 'evil' && !['oberon', 'hermit'].includes(role.id)) {
                evilPlayers.push(playerId);
            }
            if (role.id === 'scapegoat') {
                evilPlayers.push(playerId);
            }
        }
        if (evilPlayers.length > 0) {
            info.push({ type: 'evil', label: '你看到以下是邪恶阵营', players: evilPlayers });
        }
    }

    if (myRole.id === 'percival') {
        const merlinOrMorgana = [];
        for (const [playerId, role] of Object.entries(allAssignments)) {
            if (playerId === myPlayerId) continue;
            if (['merlin', 'morgana', 'illusionist'].includes(role.id)) {
                merlinOrMorgana.push(playerId);
            }
        }
        if (merlinOrMorgana.length > 0) {
            info.push({ type: 'mystery', label: '这些人里有梅林，其他可能是莫甘娜或幻术师', players: merlinOrMorgana });
        }
    }

    if (myRole.team === 'evil' && myRole.id !== 'oberon') {
        const fellowEvil = [];
        for (const [playerId, role] of Object.entries(allAssignments)) {
            if (playerId === myPlayerId) continue;
            if (role.team === 'evil' && role.id !== 'oberon') {
                fellowEvil.push(playerId);
            }
        }
        if (fellowEvil.length > 0) {
            info.push({ type: 'ally', label: '你的坏人同伴', players: fellowEvil });
        }
    }

    return info;
}

function pickRandomRole(pool, fallbackRole = null) {
    if (pool && pool.length > 0) {
        const randomIndex = Math.floor(Math.random() * pool.length);
        return pool.splice(randomIndex, 1)[0];
    }
    return fallbackRole;
}

function shuffleList(items) {
    const list = [...items];
    for (let i = list.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [list[i], list[j]] = [list[j], list[i]];
    }
    return list;
}

function getNeutralRole(id) {
    switch (id) {
        case 'scapegoat':
            return ROLES.SCAPEGOAT;
        case 'armsdealer':
            return ROLES.ARMS_DEALER;
        case 'cultist':
            return ROLES.CULTIST;
        case 'gambler':
            return ROLES.GAMBLER;
        case 'bountyhunter':
            return ROLES.BOUNTY_HUNTER;
        default:
            return null;
    }
}

window.ROLES = ROLES;
window.MISSION_SIZES = MISSION_SIZES;
window.ROLE_DISTRIBUTION = ROLE_DISTRIBUTION;
window.assignRoles = assignRoles;
window.getNightInfo = getNightInfo;
window.getNeutralRole = getNeutralRole;
