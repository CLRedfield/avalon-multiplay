// ===== 角色定义 =====

const ROLES = {
    // 好人阵营
    MERLIN: {
        id: 'merlin',
        name: '梅林',
        icon: '🧙',
        team: 'good',
        description: '你知道谁是坏人（奥柏隆除外）。如果好人任务胜利，你可能被刺客刺杀，导致好人失败。',
        seesEvil: true
    },
    PERCIVAL: {
        id: 'percival',
        name: '派西维尔',
        icon: '⚔️',
        team: 'good',
        description: '你知道谁是梅林和莫甘娜，但不知道谁是谁。保护梅林的身份！',
        seesMerlinMorgana: true
    },
    INQUISITOR: {
        id: 'inquisitor',
        name: '审判官',
        icon: '🔍',
        team: 'good',
        description: '每局游戏可以使用一次技能，查看某位玩家上一轮的投票结果。',
        hasSkill: true
    },
    LOYAL: {
        id: 'loyal',
        name: '忠臣',
        icon: '🛡️',
        team: 'good',
        description: '你是亚瑟王的忠诚臣民。通过观察和推理找出坏人！'
    },

    // 坏人阵营
    ASSASSIN: {
        id: 'assassin',
        name: '刺客',
        icon: '🗡️',
        team: 'evil',
        description: '你知道其他坏人（奥柏隆除外）。如果好人任务胜利，你可以选择刺杀一名玩家，如果刺中梅林，坏人获胜！',
        canAssassinate: true
    },
    MORGANA: {
        id: 'morgana',
        name: '莫甘娜',
        icon: '🌙',
        team: 'evil',
        description: '你知道其他坏人。在派西维尔眼中，你和梅林看起来一样。',
        looksLikeMerlin: true
    },
    MINION: {
        id: 'minion',
        name: '爪牙',
        icon: '👤',
        team: 'evil',
        description: '你知道其他坏人（奥柏隆除外）。帮助坏人破坏任务！'
    },
    OBERON: {
        id: 'oberon',
        name: '奥柏隆',
        icon: '👁️',
        team: 'evil',
        description: '你是孤独的坏人。其他坏人不知道你，你也不知道其他坏人。梅林也看不到你。',
        isHidden: true
    },

    // 中立阵营
    SCAPEGOAT: {
        id: 'scapegoat',
        name: '替罪羊',
        icon: '🐑',
        team: 'neutral',
        appearsAs: 'evil', // 对梅林显示为坏人
        description: '你在梅林的视野中显示为坏人。你的胜利条件：在放逐会议中被投票放逐。',
        winCondition: '被放逐会议票死'
    },
    ARMS_DEALER: {
        id: 'armsdealer',
        name: '军火商',
        icon: '🔫',
        team: 'neutral',
        appearsAs: 'good',
        description: '你看起来像好人。你的胜利条件：游戏进行到第5轮任务且你存活（无论哪方获胜）。',
        winCondition: '游戏进行到第5轮且存活'
    },
    CULTIST: {
        id: 'cultist',
        name: '狂热者',
        icon: '🔥',
        team: 'neutral',
        appearsAs: 'good',
        description: '你看起来像好人。你的胜利条件：至少2名玩家被放逐流放，且你存活。',
        winCondition: '2人被流放且存活'
    }
};

// ===== 发车人数配置 =====
const MISSION_SIZES = {
    5: [2, 3, 2, 3, 3],
    6: [2, 3, 4, 3, 4],
    7: [2, 3, 3, 4, 4],
    8: [3, 4, 4, 5, 5],
    9: [3, 4, 4, 5, 5],
    10: [3, 4, 4, 5, 5]
};

// ===== 角色分配表 =====
const ROLE_DISTRIBUTION = {
    5: {
        good: [ROLES.MERLIN, ROLES.PERCIVAL, ROLES.INQUISITOR],
        evil: [ROLES.ASSASSIN],
        neutralCount: 1
    },
    6: {
        good: [ROLES.MERLIN, ROLES.PERCIVAL, ROLES.INQUISITOR],
        evil: [ROLES.MORGANA, ROLES.ASSASSIN],
        neutralCount: 1
    },
    7: {
        good: [ROLES.MERLIN, ROLES.PERCIVAL, ROLES.INQUISITOR, ROLES.LOYAL],
        evil: [ROLES.MORGANA, ROLES.ASSASSIN],
        neutralCount: 1
    },
    8: {
        good: [ROLES.MERLIN, ROLES.PERCIVAL, ROLES.INQUISITOR, ROLES.LOYAL, ROLES.LOYAL],
        evil: [ROLES.MORGANA, ROLES.ASSASSIN],
        neutralCount: 1
    },
    9: {
        good: [ROLES.MERLIN, ROLES.PERCIVAL, ROLES.INQUISITOR, ROLES.LOYAL, ROLES.LOYAL],
        evil: [ROLES.MORGANA, ROLES.ASSASSIN, ROLES.MINION],
        neutralCount: 1
    },
    10: {
        good: [ROLES.MERLIN, ROLES.PERCIVAL, ROLES.INQUISITOR, ROLES.LOYAL, ROLES.LOYAL, ROLES.LOYAL],
        evil: [ROLES.MORGANA, ROLES.ASSASSIN, ROLES.OBERON],
        neutralCount: 1
    }
};

// ===== 角色分配函数 =====
function assignRoles(playerIds, neutralPool) {
    const playerCount = playerIds.length;
    const distribution = ROLE_DISTRIBUTION[playerCount];

    if (!distribution) {
        throw new Error('不支持的玩家人数: ' + playerCount);
    }

    // 复制角色数组
    let goodRoles = [...distribution.good];
    let evilRoles = [...distribution.evil];

    // 从中立池随机选一个
    let neutralRole = null;
    if (neutralPool && neutralPool.length > 0) {
        const randomIndex = Math.floor(Math.random() * neutralPool.length);
        neutralRole = neutralPool[randomIndex];
    }

    // 合并所有角色
    let allRoles = [...goodRoles, ...evilRoles];
    if (neutralRole) {
        allRoles.push(neutralRole);
    }

    // 洗牌玩家ID
    const shuffledPlayers = [...playerIds].sort(() => Math.random() - 0.5);

    // 洗牌角色
    const shuffledRoles = allRoles.sort(() => Math.random() - 0.5);

    // 分配
    const assignments = {};
    for (let i = 0; i < shuffledPlayers.length; i++) {
        assignments[shuffledPlayers[i]] = shuffledRoles[i];
    }

    return assignments;
}

// ===== 获取某玩家的夜晚信息 =====
function getNightInfo(myRole, allAssignments, myPlayerId) {
    const info = [];

    if (myRole.id === 'merlin') {
        // 梅林看到所有坏人（除了奥柏隆）和替罪羊
        const evilPlayers = [];
        for (const [playerId, role] of Object.entries(allAssignments)) {
            if (playerId === myPlayerId) continue;
            // 坏人（除奥柏隆）
            if (role.team === 'evil' && role.id !== 'oberon') {
                evilPlayers.push(playerId);
            }
            // 替罪羊在梅林眼中是坏人
            if (role.id === 'scapegoat') {
                evilPlayers.push(playerId);
            }
        }
        if (evilPlayers.length > 0) {
            info.push({ type: 'evil', label: '你看到以下是邪恶的', players: evilPlayers });
        }
    }

    if (myRole.id === 'percival') {
        // 派西维尔看到梅林和莫甘娜
        const merlinMorgana = [];
        for (const [playerId, role] of Object.entries(allAssignments)) {
            if (playerId === myPlayerId) continue;
            if (role.id === 'merlin' || role.id === 'morgana') {
                merlinMorgana.push(playerId);
            }
        }
        if (merlinMorgana.length > 0) {
            info.push({ type: 'mystery', label: '梅林/莫甘娜（不知谁是谁）', players: merlinMorgana });
        }
    }

    if (myRole.team === 'evil' && myRole.id !== 'oberon') {
        // 坏人看到其他坏人（除奥柏隆外）
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

// ===== 获取中立角色对象 =====
function getNeutralRole(id) {
    switch (id) {
        case 'scapegoat': return ROLES.SCAPEGOAT;
        case 'armsdealer': return ROLES.ARMS_DEALER;
        case 'cultist': return ROLES.CULTIST;
        default: return null;
    }
}

// 导出
window.ROLES = ROLES;
window.MISSION_SIZES = MISSION_SIZES;
window.ROLE_DISTRIBUTION = ROLE_DISTRIBUTION;
window.assignRoles = assignRoles;
window.getNightInfo = getNightInfo;
window.getNeutralRole = getNeutralRole;
