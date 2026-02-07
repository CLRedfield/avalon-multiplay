/**
 * SuperChess - Nations Data
 * 11个国家的完整数据定义
 */

export const NATIONS = {
    france: {
        id: 'france',
        name: '法兰西王国',
        englishName: 'Kingdom of France',
        icon: '🇫🇷',
        motto: '骑士精神与荣耀之战',
        style: '中心突破型',
        description: '强大的重骑兵传统，擅长中心突破',
        color: '#0055a4',
        pieces: {
            king: { name: '法兰西国王', localName: 'Roi de France' },
            queen: { name: '王后/摄政', localName: 'Reine' },
            rook: { name: '城堡守卫', localName: 'Garde du Château' },
            bishop: { name: '主教', localName: 'Évêque' },
            knight: { name: '法兰西骑士', localName: 'Chevalier' },
            pawn: { name: '步兵', localName: 'Piéton' }
        },
        ratings: { attack: 4, defense: 3, mobility: 4, special: 3 }
    },
    
    england: {
        id: 'england',
        name: '英格兰王国',
        englishName: 'Kingdom of England',
        icon: '🏴󠁧󠁢󠁥󠁮󠁧󠁿',
        motto: '长弓手的荣耀',
        style: '防守反击型',
        description: '远程打击能力强，防御稳健',
        color: '#c8102e',
        pieces: {
            king: { name: '英格兰国王', localName: 'King of England' },
            queen: { name: '王后', localName: 'Queen' },
            rook: { name: '伦敦塔守卫', localName: 'Tower Guard' },
            bishop: { name: '坎特伯雷主教', localName: 'Archbishop' },
            knight: { name: '骑士', localName: 'Knight' },
            pawn: { name: '长弓手', localName: 'Longbowman' }
        },
        ratings: { attack: 3, defense: 4, mobility: 3, special: 4 }
    },
    
    holyroman: {
        id: 'holyroman',
        name: '神圣罗马帝国',
        englishName: 'Holy Roman Empire',
        icon: '🦅',
        motto: '帝国荣耀，诸侯联盟',
        style: '兵阵协作型',
        description: '灵活多变，兵种协作能力强',
        color: '#ffcc00',
        pieces: {
            king: { name: '皇帝', localName: 'Kaiser' },
            queen: { name: '皇后', localName: 'Kaiserin' },
            rook: { name: '帝国堡垒', localName: 'Reichsburg' },
            bishop: { name: '选帝侯', localName: 'Kurfürst' },
            knight: { name: '条顿骑士', localName: 'Teutonic Knight' },
            pawn: { name: '雇佣兵', localName: 'Landsknecht' }
        },
        ratings: { attack: 3, defense: 4, mobility: 3, special: 4 }
    },
    
    china: {
        id: 'china',
        name: '中华帝国',
        englishName: 'Chinese Empire',
        icon: '🇨🇳',
        motto: '兵法谋略，围魏救赵',
        style: '策略灵活型',
        description: '策略灵活，防守反击',
        color: '#de2910',
        pieces: {
            king: { name: '皇帝', localName: 'Emperor' },
            queen: { name: '皇后/将军', localName: 'Empress/General' },
            rook: { name: '战车', localName: 'Chariot' },
            bishop: { name: '谋士', localName: 'Strategist' },
            knight: { name: '骑兵', localName: 'Cavalry' },
            pawn: { name: '步卒', localName: 'Foot Soldier' }
        },
        ratings: { attack: 3, defense: 3, mobility: 5, special: 3 }
    },
    
    japan: {
        id: 'japan',
        name: '日本',
        englishName: 'Japan',
        icon: '🇯🇵',
        motto: '武士道精神，以一敌百',
        style: '激进进攻型',
        description: '高风险高回报，单兵作战能力强',
        color: '#bc002d',
        pieces: {
            king: { name: '征夷大将军', localName: 'Shogun' },
            queen: { name: '女武将', localName: 'Onna-bugeisha' },
            rook: { name: '城', localName: 'Castle/Shiro' },
            bishop: { name: '僧兵', localName: 'Sōhei' },
            knight: { name: '武士', localName: 'Samurai' },
            pawn: { name: '足轻', localName: 'Ashigaru' }
        },
        ratings: { attack: 5, defense: 2, mobility: 3, special: 4 }
    },
    
    ottoman: {
        id: 'ottoman',
        name: '奥斯曼帝国',
        englishName: 'Ottoman Empire',
        icon: '🇹🇷',
        motto: '苏丹的远征',
        style: '火力压制型',
        description: '火力强大，远程压制',
        color: '#e30a17',
        pieces: {
            king: { name: '苏丹', localName: 'Sultan' },
            queen: { name: '哈塞基苏丹', localName: 'Haseki Sultan' },
            rook: { name: '大炮', localName: 'Cannon/Top' },
            bishop: { name: '大维齐尔', localName: 'Grand Vizier' },
            knight: { name: '西帕希骑兵', localName: 'Sipahi' },
            pawn: { name: '耶尼切里', localName: 'Janissary' }
        },
        ratings: { attack: 4, defense: 3, mobility: 3, special: 4 }
    },
    
    mongol: {
        id: 'mongol',
        name: '蒙古帝国',
        englishName: 'Mongol Empire',
        icon: '🏹',
        motto: '天之骄子，草原狼群',
        style: '高机动游击型',
        description: '极致机动性，骑射战术',
        color: '#0066b3',
        pieces: {
            king: { name: '大汗', localName: 'Great Khan' },
            queen: { name: '可敦', localName: 'Khatun' },
            rook: { name: '投石车', localName: 'Trebuchet' },
            bishop: { name: '萨满', localName: 'Shaman' },
            knight: { name: '怯薛骑兵', localName: 'Kheshig' },
            pawn: { name: '轻骑兵', localName: 'Light Cavalry' }
        },
        ratings: { attack: 3, defense: 2, mobility: 5, special: 4 }
    },
    
    byzantine: {
        id: 'byzantine',
        name: '拜占庭帝国',
        englishName: 'Byzantine Empire',
        icon: '🟣',
        motto: '千年帝国，不朽荣光',
        style: '坚固防守型',
        description: '防御坚固，外交与火器结合',
        color: '#4b0082',
        pieces: {
            king: { name: '巴西琉斯', localName: 'Basileus' },
            queen: { name: '奥古斯塔', localName: 'Augusta' },
            rook: { name: '君士坦丁堡城墙', localName: 'Theodosian Walls' },
            bishop: { name: '牧首', localName: 'Patriarch' },
            knight: { name: '铁甲骑兵', localName: 'Cataphract' },
            pawn: { name: '希腊火兵', localName: 'Greek Fire Soldier' }
        },
        ratings: { attack: 3, defense: 5, mobility: 2, special: 4 }
    },
    
    spain: {
        id: 'spain',
        name: '西班牙王国',
        englishName: 'Kingdom of Spain',
        icon: '🇪🇸',
        motto: '无敌舰队，征服新世界',
        style: '中后期扩张型',
        description: '信仰加成，殖民扩张',
        color: '#c60b1e',
        pieces: {
            king: { name: '天主教双王', localName: 'Catholic Monarchs' },
            queen: { name: '伊莎贝拉', localName: 'Isabella' },
            rook: { name: '要塞', localName: 'Alcázar' },
            bishop: { name: '枢机主教', localName: 'Cardinal' },
            knight: { name: '征服者', localName: 'Conquistador' },
            pawn: { name: '火枪手', localName: 'Tercio' }
        },
        ratings: { attack: 4, defense: 3, mobility: 3, special: 4 }
    },
    
    poland: {
        id: 'poland',
        name: '波兰-立陶宛联邦',
        englishName: 'Polish-Lithuanian Commonwealth',
        icon: '🦅',
        motto: '翼骑兵的冲锋',
        style: '骑兵突击型',
        description: '超强骑兵，贵族民主',
        color: '#dc143c',
        pieces: {
            king: { name: '国王', localName: 'Król' },
            queen: { name: '王后', localName: 'Królowa' },
            rook: { name: '城堡', localName: 'Zamek' },
            bishop: { name: '主教', localName: 'Biskup' },
            knight: { name: '翼骑兵', localName: 'Hussar' },
            pawn: { name: '哥萨克', localName: 'Cossack' }
        },
        ratings: { attack: 5, defense: 2, mobility: 4, special: 3 }
    },
    
    rus: {
        id: 'rus',
        name: '罗斯诸公国',
        englishName: "Kievan Rus' / Muscovy",
        icon: '🐻',
        motto: '三驾雪橇，东正之光',
        style: '防守反击型',
        description: '坚韧防守，冬季战争',
        color: '#0039a6',
        pieces: {
            king: { name: '大公', localName: 'Velikiy Knyaz' },
            queen: { name: '公主/大公夫人', localName: 'Knyaginya' },
            rook: { name: '克里姆林', localName: 'Kremlin' },
            bishop: { name: '东正教主教', localName: 'Metropolitan' },
            knight: { name: '博雅尔骑兵', localName: 'Boyar Cavalry' },
            pawn: { name: '农兵', localName: 'Streltsy' }
        },
        ratings: { attack: 3, defense: 5, mobility: 3, special: 3 }
    }
};

// 获取国家列表
export function getNationList() {
    return Object.values(NATIONS);
}

// 获取国家数据
export function getNation(nationId) {
    return NATIONS[nationId] || null;
}

// 获取棋子Unicode符号
export const PIECE_SYMBOLS = {
    white: {
        king: '♔',
        queen: '♕',
        rook: '♖',
        bishop: '♗',
        knight: '♘',
        pawn: '♙'
    },
    black: {
        king: '♚',
        queen: '♛',
        rook: '♜',
        bishop: '♝',
        knight: '♞',
        pawn: '♟'
    }
};

// 棋子价值
export const PIECE_VALUES = {
    king: Infinity,
    queen: 9,
    rook: 5,
    bishop: 3,
    knight: 3,
    pawn: 1
};
