/**
 * SuperChess - Abilities Data
 * 所有国家特殊能力的数据定义
 */

export const ABILITIES = {
    // ==================== 法兰西 ====================
    france_king_royalGuard: {
        id: 'france_king_royalGuard',
        nation: 'france',
        piece: 'king',
        name: '皇家卫队',
        description: '当国王首次受到威胁时，可与任意己方骑士交换位置',
        maxUses: 1,
        trigger: 'onCheck', // 被将军时触发
        targetType: 'ownKnight'
    },
    france_bishop_blessing: {
        id: 'france_bishop_blessing',
        nation: 'france',
        piece: 'bishop',
        name: '教廷祝福',
        description: '移动时可跳过一个友方棋子后无限延伸',
        maxUses: undefined, // 被动能力
        trigger: 'passive',
        effectType: 'jumpOver' // 自定义效果类型
    },
    france_knight_charge: {
        id: 'france_knight_charge',
        nation: 'france',
        piece: 'knight',
        name: '重装冲锋',
        description: '增加上下左右各个方向2格的跳跃移动',
        maxUses: undefined, // 被动能力
        trigger: 'passive',
        effectType: 'extendedMove'
    },

    // ==================== 英格兰 ====================
    england_king_castlePlus: {
        id: 'england_king_castlePlus',
        nation: 'england',
        piece: 'king',
        name: '王车易位Plus',
        description: '可与任意一个车进行王车易位（无论距离）',
        maxUses: 1,
        trigger: 'onMove',
        targetType: 'castle'
    },
    england_rook_towerShot: {
        id: 'england_rook_towerShot',
        nation: 'england',
        piece: 'rook',
        name: '伦敦塔守卫',
        description: '横向最多移动5格，但增加四个斜向1格的移动方式',
        maxUses: undefined, // 被动能力
        trigger: 'passive',
        effectType: 'modifiedMove'
    },
    england_pawn_longbow: {
        id: 'england_pawn_longbow',
        nation: 'england',
        piece: 'pawn',
        name: '长弓兵',
        description: '中间4列兵可吃掉前方2格的敌方单位（每次只能前进1格）',
        maxUses: undefined, // 被动能力
        trigger: 'passive',
        effectType: 'modifiedMove'
    },

    // ==================== 神圣罗马帝国 ====================
    holyroman_king_elector: {
        id: 'holyroman_king_elector',
        nation: 'holyroman',
        piece: 'king',
        name: '选帝侯',
        description: '每局可与一个友方兵交换位置一次',
        maxUses: 1,
        trigger: 'active',
        targetType: 'swapWithPawn'
    },
    holyroman_queen_authority: {
        id: 'holyroman_queen_authority',
        nation: 'holyroman',
        piece: 'queen',
        name: '帝国权威',
        description: '皇后不能被敌方兵直接吃掉',
        maxUses: undefined, // 被动能力
        trigger: 'passive',
        effect: 'immuneToPawn'
    },
    holyroman_bishop_vote: {
        id: 'holyroman_bishop_vote',
        nation: 'holyroman',
        piece: 'bishop',
        name: '联盟投票',
        description: '当被吃掉时，可选择与己方一个兵交换位置',
        maxUses: 1,
        trigger: 'onCapture',
        targetType: 'swapWithPawn'
    },
    holyroman_knight_crusade: {
        id: 'holyroman_knight_crusade',
        nation: 'holyroman',
        piece: 'knight',
        name: '十字军精神',
        description: '在敌方半场时，增加直线移动1格的能力',
        maxUses: undefined,
        trigger: 'passive',
        condition: 'inEnemyHalf'
    },
    holyroman_pawn_pikeFormation: {
        id: 'holyroman_pawn_pikeFormation',
        nation: 'holyroman',
        piece: 'pawn',
        name: '长矛阵',
        description: '当两个兵相邻时，它们不能被敌方骑士吃掉',
        maxUses: undefined,
        trigger: 'passive',
        condition: 'adjacentPawn'
    },

    // ==================== 中国 ====================
    china_king_expedition: {
        id: 'china_king_expedition',
        nation: 'china',
        piece: 'king',
        name: '御驾亲征',
        description: '每局可与皇后交换位置一次（即使隔着棋子）',
        maxUses: 1,
        trigger: 'active',
        targetType: 'swapWithQueen'
    },
    china_rook_cannon: {
        id: 'china_rook_cannon',
        nation: 'china',
        piece: 'rook',
        name: '冲锋陷阵',
        description: '每局可进行1次类似“炮”的隔子攻击',
        maxUses: 1,
        trigger: 'passive', // 移动验证器处理
        effectType: 'cannonAttack'
    },
    china_bishop_advisor: {
        id: 'china_bishop_advisor',
        nation: 'china',
        piece: 'bishop',
        name: '随军谋士',
        description: '斜向移动限制5格，但增加前后左右直向1格移动',
        maxUses: undefined,
        trigger: 'passive',
        effectType: 'modifiedMove'
    },
    china_pawn_crossRiver: {
        id: 'china_pawn_crossRiver',
        nation: 'china',
        piece: 'pawn',
        name: '过河强化',
        description: '越过棋盘中线后，可向左右横移一格',
        maxUses: -1,
        trigger: 'passive',
        condition: 'crossedMidline'
    },

    // ==================== 日本 ====================
    japan_king_bushido: {
        id: 'japan_king_bushido',
        nation: 'japan',
        piece: 'king',
        name: '武士道',
        description: '当将军被将军时，可选择与任意一个己方棋子同归于尽来逃脱',
        maxUses: 1,
        trigger: 'onCheck',
        effect: 'sacrificeToEscape'
    },
    japan_queen_valkyrie: {
        id: 'japan_queen_valkyrie',
        nation: 'japan',
        piece: 'queen',
        name: '女武将',
        description: '吃掉敌方兵后，可在己方底线生成一个兵（限2次）',
        maxUses: 2,
        trigger: 'onCapture',
        condition: 'capturePawn',
        effect: 'spawnPawnBackRow'
    },
    japan_bishop_chant: {
        id: 'japan_bishop_chant',
        nation: 'japan',
        piece: 'bishop',
        name: '僧兵',
        description: '主动释放：相邻己方棋子下回合免疫（消耗1次，释放后回合结束）',
        maxUses: 1,
        trigger: 'active',
        targetType: 'shieldNeighbors',
        effect: 'shieldNeighbors'
    },
    japan_knight_seppuku: {
        id: 'japan_knight_seppuku',
        nation: 'japan',
        piece: 'knight',
        name: '切腹觉悟',
        description: '被吃掉时，可选择与吃它的棋子同归于尽',
        maxUses: 1,
        trigger: 'onCaptured',
        effect: 'mutualDestruction'
    },
    japan_pawn_teppo: {
        id: 'japan_pawn_teppo',
        nation: 'japan',
        piece: 'pawn',
        name: '铁炮',
        description: '仅中间4列兵有效：首次移动可直接前进3格',
        maxUses: 1,
        trigger: 'onFirstMove',
        effect: 'tripleMove'
    },

    // ==================== 奥斯曼 ====================
    ottoman_king_haremGuard: {
        id: 'ottoman_king_haremGuard',
        nation: 'ottoman',
        piece: 'king',
        name: '苏丹护卫',
        description: '苏丹上下左右若有己方棋子，则苏丹免疫攻击',
        maxUses: undefined,
        trigger: 'passive',
        condition: 'orthogonalAlly'
    },
    ottoman_queen_intrigue: {
        id: 'ottoman_queen_intrigue',
        nation: 'ottoman',
        piece: 'queen',
        name: '宫廷阴谋',
        description: '使周围一圈敌方棋子下回合不能移动',
        maxUses: 1,
        trigger: 'active',
        targetType: 'paralyzeAround'
    },
    ottoman_rook_cannon: {
        id: 'ottoman_rook_cannon',
        nation: 'ottoman',
        piece: 'rook',
        name: '大炮',
        description: '本局内没吃过子时，可隔一个棋子吃掉后方的敌方棋子',
        maxUses: 1,
        trigger: 'passive',
        effect: 'cannonCapture'
    },
    ottoman_bishop_shaman: {
        id: 'ottoman_bishop_shaman',
        nation: 'ottoman',
        piece: 'bishop',
        name: '萨满',
        description: '可禁止一个敌方棋子下回合移动（限2次）',
        maxUses: 2,
        trigger: 'active',
        targetType: 'paralyzeEnemy'
    },
    ottoman_pawn_musket: {
        id: 'ottoman_pawn_musket',
        nation: 'ottoman',
        piece: 'pawn',
        name: '火枪',
        description: '中间4列未移动的兵可射击前方1-2格的敌方棋子',
        maxUses: undefined,
        trigger: 'passive',
        effectType: 'rangedCapture'
    },

    // ==================== 蒙古 ====================
    mongol_king_migration: {
        id: 'mongol_king_migration',
        nation: 'mongol',
        piece: 'king',
        name: '汗帐迁移',
        description: '可与任意己方棋子交换位置',
        maxUses: 1,
        trigger: 'active',
        targetType: 'swapWithAny'
    },
    mongol_rook_siege: {
        id: 'mongol_rook_siege',
        nation: 'mongol',
        piece: 'rook',
        name: '破城',
        description: '吃掉敌方车或象时，该棋子不能用特殊能力反制',
        maxUses: -1,
        trigger: 'onCapture',
        effect: 'disableAbility'
    },
    mongol_bishop_prophecy: {
        id: 'mongol_bishop_prophecy',
        nation: 'mongol',
        piece: 'bishop',
        name: '天狼星佑',
        description: '每回合结束时，可预知敌方下一步将移动哪个棋子',
        maxUses: 2,
        trigger: 'endOfTurn',
        effect: 'revealNextMove'
    },
    mongol_knight_horseArcher: {
        id: 'mongol_knight_horseArcher',
        nation: 'mongol',
        piece: 'knight',
        name: '骑射',
        description: '可选择不吃子，改为"射击"目标位置相邻格的敌方兵',
        maxUses: 1,
        trigger: 'insteadOfCapture',
        targetType: 'adjacentCapture'
    },
    mongol_pawn_nomad: {
        id: 'mongol_pawn_nomad',
        nation: 'mongol',
        piece: 'pawn',
        name: '游牧',
        description: '可向后退一格（不能吃子）',
        maxUses: 1,
        trigger: 'onMove',
        effect: 'retreatOne'
    },

    // ==================== 拜占庭 ====================
    byzantine_king_continuation: {
        id: 'byzantine_king_continuation',
        nation: 'byzantine',
        piece: 'king',
        name: '帝国延续',
        description: '当被将军时，可召唤一个"瓦良格卫队"（兵）到相邻空位保护',
        maxUses: 1,
        trigger: 'onCheck',
        effect: 'spawnGuard'
    },
    byzantine_queen_conspiracy: {
        id: 'byzantine_queen_conspiracy',
        nation: 'byzantine',
        piece: 'queen',
        name: '宫廷阴谋',
        description: '可使敌方一个棋子"瘫痪"一回合（不能移动）',
        maxUses: 1,
        trigger: 'active',
        targetType: 'paralyzeEnemy'
    },
    byzantine_rook_walls: {
        id: 'byzantine_rook_walls',
        nation: 'byzantine',
        piece: 'rook',
        name: '固若金汤',
        description: '不能被敌方骑士吃掉',
        maxUses: -1,
        trigger: 'passive',
        effect: 'immuneToKnight'
    },
    byzantine_bishop_excommunicate: {
        id: 'byzantine_bishop_excommunicate',
        nation: 'byzantine',
        piece: 'bishop',
        name: '破门律',
        description: '可"驱逐"一个敌方兵到棋盘边缘',
        maxUses: 1,
        trigger: 'active',
        targetType: 'banishPawn'
    },
    byzantine_knight_charge: {
        id: 'byzantine_knight_charge',
        nation: 'byzantine',
        piece: 'knight',
        name: '重骑冲锋',
        description: '吃子时可"推开"目标相邻的一个敌方兵一格',
        maxUses: -1,
        trigger: 'onCapture',
        effect: 'pushAdjacent'
    },
    byzantine_pawn_greekFire: {
        id: 'byzantine_pawn_greekFire',
        nation: 'byzantine',
        piece: 'pawn',
        name: '希腊火',
        description: '被吃掉时，吃它的棋子下回合不能移动',
        maxUses: 1,
        trigger: 'onCaptured',
        effect: 'burnAttacker'
    },

    // ==================== 西班牙 ====================
    spain_king_inquisition: {
        id: 'spain_king_inquisition',
        nation: 'spain',
        piece: 'king',
        name: '宗教裁判所',
        description: '可"审判"一个敌方棋子，使其下两回合不能使用特殊能力',
        maxUses: 1,
        trigger: 'active',
        targetType: 'silenceEnemy'
    },
    spain_queen_voyage: {
        id: 'spain_queen_voyage',
        nation: 'spain',
        piece: 'queen',
        name: '赞助远航',
        description: '移动最远5格；可将己方一个兵直接移动到敌方底线（释放后回合结束）',
        maxUses: 1,
        trigger: 'active',
        targetType: 'teleportPawn'
    },
    spain_bishop_heresy: {
        id: 'spain_bishop_heresy',
        nation: 'spain',
        piece: 'bishop',
        name: '异端审判',
        description: '可吃掉上下左右相邻的敌方棋子（限2次）',
        maxUses: 2,
        trigger: 'passive',
        effectType: 'orthogonalCapture'
    },
    spain_knight_gold: {
        id: 'spain_knight_gold',
        nation: 'spain',
        piece: 'knight',
        name: '黄金渴望',
        description: '在敌方半场吃子后，可在己方底线空位生成一个兵',
        maxUses: undefined,
        trigger: 'onCapture',
        condition: 'inEnemyHalf',
        effect: 'spawnPawnBackRow'
    },
    spain_pawn_tercio: {
        id: 'spain_pawn_tercio',
        nation: 'spain',
        piece: 'pawn',
        name: '西班牙方阵',
        description: '当三个或更多兵在同一横排时，它们可以前进两格',
        maxUses: -1,
        trigger: 'passive',
        condition: 'threeInRow'
    },

    // ==================== 波兰-立陶宛 ====================
    poland_king_election: {
        id: 'poland_king_election',
        nation: 'poland',
        piece: 'king',
        name: '贵族选举',
        description: '当国王被将军时，可让任意己方棋子为其"挡驾"',
        maxUses: 1,
        trigger: 'onCheck',
        targetType: 'blockWithAlly'
    },
    poland_rook_sejm: {
        id: 'poland_rook_sejm',
        nation: 'poland',
        piece: 'rook',
        name: '联邦议会',
        description: '当车与另一个己方主要棋子相邻时，车不能被吃',
        maxUses: undefined,
        trigger: 'passive',
        condition: 'adjacentToMajorPiece'
    },
    poland_knight_hussar: {
        id: 'poland_knight_hussar',
        nation: 'poland',
        piece: 'knight',
        name: '翼骑冲锋',
        description: '可额外直线冲锋2格，直线冲锋时可连续吃掉路径上的所有敌方兵',
        maxUses: 1,
        trigger: 'onMove',
        effect: 'lineCharge'
    },
    poland_pawn_cossack: {
        id: 'poland_pawn_cossack',
        nation: 'poland',
        piece: 'pawn',
        name: '边境游击',
        description: '可横向移动一格',
        maxUses: 2,
        trigger: 'onMove',
        effect: 'sidewaysMove'
    },

    // ==================== 罗斯 ====================
    rus_king_scorchedEarth: {
        id: 'rus_king_scorchedEarth',
        nation: 'rus',
        piece: 'king',
        name: '焦土战略',
        description: '当被将军时，可与自己周围一格内的一个己方棋子交换位置',
        maxUses: 1,
        trigger: 'onCheck',
        targetType: 'swapWithAdjacent'
    },
    rus_queen_alliance: {
        id: 'rus_queen_alliance',
        nation: 'rus',
        piece: 'queen',
        name: '联姻外交',
        description: '可使敌方一个骑士3回合不能动（使用后不结束回合）',
        maxUses: 1,
        trigger: 'active',
        targetType: 'paralyzeKnight'
    },
    rus_rook_fortress: {
        id: 'rus_rook_fortress',
        nation: 'rus',
        piece: 'rook',
        name: '坚城',
        description: '当在己方半场时可以斜向移动最多2格',
        maxUses: undefined,
        trigger: 'passive',
        condition: 'inOwnHalf',
        effect: 'diagonalMove2'
    },
    rus_bishop_icon: {
        id: 'rus_bishop_icon',
        nation: 'rus',
        piece: 'bishop',
        name: '圣像庇护',
        description: '相邻己方棋子下回合免疫（使用后不结束回合）',
        maxUses: 1,
        trigger: 'active',
        targetType: 'shieldNeighbors'
    },
    rus_knight_raid: {
        id: 'rus_knight_raid',
        nation: 'rus',
        piece: 'knight',
        name: '突袭',
        description: '首次移动可横竖移动最多3格',
        maxUses: 1,
        trigger: 'onFirstMove',
        effect: 'orthogonalMove3'
    },
    rus_pawn_winter: {
        id: 'rus_pawn_winter',
        nation: 'rus',
        piece: 'pawn',
        name: '冬季坚守',
        description: '在己方半场时，不能被敌方兵吃掉',
        maxUses: undefined,
        trigger: 'passive',
        condition: 'inOwnHalf'
    }
};

// 获取国家的所有能力
export function getNationAbilities(nationId) {
    return Object.values(ABILITIES).filter(ability => ability.nation === nationId);
}

// 获取棋子的能力
export function getPieceAbility(nationId, pieceType) {
    return Object.values(ABILITIES).filter(
        ability => ability.nation === nationId && ability.piece === pieceType
    );
}

// 获取能力详情
export function getAbility(abilityId) {
    return ABILITIES[abilityId] || null;
}
