const ROLES = {
    MERLIN: {
        id: 'merlin',
        name: '梅林',
        icon: '🧙',
        team: 'good',
        description: '你知道谁是坏人（奥伯伦除外）。如果好人先完成三次任务，刺客还可以尝试刺杀你。'
    },
    PERCIVAL: {
        id: 'percival',
        name: '派西维尔',
        icon: '🛡️',
        team: 'good',
        description: '你知道谁是梅林和莫甘娜，但不知道谁是谁。'
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
        description: '你知道其他坏人（奥伯伦除外）。如果好人先完成三次任务，你可以刺杀一名玩家；刺中梅林则坏人翻盘。'
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
        name: '替罪羊',
        icon: '🐑',
        team: 'neutral',
        description: '在梅林视角中你会被当成坏人。你的胜利条件是被放逐。你整局只能提交 1 次失败牌。'
    },
    ARMS_DEALER: {
        id: 'armsdealer',
        name: '军火商',
        icon: '💣',
        team: 'neutral',
        description: '你看起来像好人。只要你存活并进入第 5 轮任务，你就单独获胜。'
    },
    CULTIST: {
        id: 'cultist',
        name: '狂热者',
        icon: '🔥',
        team: 'neutral',
        description: '你看起来像好人。只要至少三名玩家被放逐且你仍然存活，你就单独获胜。'
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
        good: [ROLES.MERLIN, ROLES.PERCIVAL, ROLES.INQUISITOR, ROLES.LOYAL, ROLES.LOYAL],
        evil: [ROLES.MORGANA, ROLES.ASSASSIN, ROLES.MINION],
        neutralCount: 1,
        neutralFallback: ROLES.LOYAL
    },
    10: {
        good: [ROLES.MERLIN, ROLES.PERCIVAL, ROLES.INQUISITOR, ROLES.LOYAL, ROLES.LOYAL, ROLES.LOYAL],
        evil: [ROLES.MORGANA, ROLES.ASSASSIN, ROLES.MINION],
        neutralCount: 0,
        flexRoleMode: 'oberonOrNeutral'
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

    if (distribution.flexRoleMode === 'oberonOrNeutral') {
        const useNeutral = availableNeutralPool.length > 0 && Math.random() < 0.5;
        if (useNeutral) {
            allRoles.push(pickRandomRole(availableNeutralPool, ROLES.OBERON));
        } else {
            allRoles.push(ROLES.OBERON);
        }
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
            if (role.team === 'evil' && role.id !== 'oberon') {
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
            if (role.id === 'merlin' || role.id === 'morgana') {
                merlinOrMorgana.push(playerId);
            }
        }
        if (merlinOrMorgana.length > 0) {
            info.push({ type: 'mystery', label: '这些人里有梅林和莫甘娜', players: merlinOrMorgana });
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
