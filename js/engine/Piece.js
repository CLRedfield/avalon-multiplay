/**
 * SuperChess - Piece Class
 * 棋子基类
 */

import { PIECE_SYMBOLS, PIECE_VALUES } from '../data/nations.js';
import { getPieceAbility } from '../data/abilities.js';

export class Piece {
    constructor(type, color, nation) {
        this.type = type;           // king, queen, rook, bishop, knight, pawn
        this.color = color;         // white, black
        this.nation = nation;       // 国家ID
        this.row = -1;
        this.col = -1;
        this.hasMoved = false;
        this.id = `${color}_${type}_${Math.random().toString(36).substr(2, 9)}`;

        // 特殊状态
        this.abilityUses = {};      // 能力使用次数记录
        this.extraLife = 0;         // 额外生命值
        this.isParalyzed = false;   // 是否被瘫痪
        this.isSilenced = false;    // 是否被沉默
        this.silenceTurns = 0;      // 沉默剩余回合
        this.isBurning = false;     // 是否被灼烧
        this.isNeutral = false;     // 是否中立
        this.isShielded = false;    // 是否有护盾
        this.isImmune = false;      // 是否免疫攻击
        this.immunityTurns = 0;     // 免疫持续回合

        // 初始化能力使用次数
        this.initAbilityUses();
    }

    /**
     * 初始化能力使用次数
     */
    initAbilityUses() {
        const abilities = getPieceAbility(this.nation, this.type);
        for (const ability of abilities) {
            if (ability.maxUses > 0) {
                this.abilityUses[ability.id] = ability.maxUses;
            }
        }
    }

    /**
     * 获取棋子符号
     */
    getSymbol() {
        return PIECE_SYMBOLS[this.color][this.type];
    }

    /**
     * 获取棋子价值
     */
    getValue() {
        return PIECE_VALUES[this.type];
    }

    /**
     * 检查是否可以使用能力
     */
    canUseAbility(abilityId) {
        if (this.isSilenced) return false;
        if (this.isNeutral) return false;

        const uses = this.abilityUses[abilityId];
        // 如果能力不在追踪列表中（被动能力），返回 true
        if (uses === undefined) return true;
        return uses > 0;
    }

    /**
     * 使用能力
     */
    useAbility(abilityId) {
        if (!this.canUseAbility(abilityId)) return false;
        this.abilityUses[abilityId]--;
        return true;
    }

    /**
     * 获取剩余能力次数
     */
    getAbilityUses(abilityId) {
        return this.abilityUses[abilityId] || 0;
    }

    /**
     * 复制棋子
     */
    clone() {
        const newPiece = new Piece(this.type, this.color, this.nation);
        newPiece.row = this.row;
        newPiece.col = this.col;
        newPiece.hasMoved = this.hasMoved;
        newPiece.id = this.id;
        newPiece.abilityUses = { ...this.abilityUses };
        newPiece.extraLife = this.extraLife;
        newPiece.isParalyzed = this.isParalyzed;
        newPiece.isSilenced = this.isSilenced;
        newPiece.silenceTurns = this.silenceTurns;
        newPiece.isBurning = this.isBurning;
        newPiece.isNeutral = this.isNeutral;
        newPiece.isShielded = this.isShielded;
        newPiece.isImmune = this.isImmune;
        newPiece.immunityTurns = this.immunityTurns;
        return newPiece;
    }

    /**
     * 处理回合结束
     */
    onTurnEnd() {
        // 解除灼烧
        if (this.isBurning) {
            this.isBurning = false;
        }

        // 解除瘫痪
        if (this.isParalyzed) {
            this.isParalyzed = false;
        }

        // 处理沉默
        if (this.isSilenced && this.silenceTurns > 0) {
            this.silenceTurns--;
            if (this.silenceTurns <= 0) {
                this.isSilenced = false;
            }
        }

        // 处理免疫
        if (this.isImmune && this.immunityTurns > 0) {
            this.immunityTurns--;
            if (this.immunityTurns <= 0) {
                this.isImmune = false;
            }
        }
    }

    /**
     * 受到攻击时的处理
     * 返回 true 表示棋子被移除，false 表示存活
     */
    onAttacked() {
        // 有护盾时抵消一次攻击
        if (this.isShielded) {
            this.isShielded = false;
            return false;
        }

        // 有额外生命值时消耗一点
        if (this.extraLife > 0) {
            this.extraLife--;
            return false;
        }

        return true;
    }

    /**
     * 序列化棋子
     */
    serialize() {
        return {
            id: this.id,
            type: this.type,
            color: this.color,
            nation: this.nation,
            row: this.row,
            col: this.col,
            hasMoved: this.hasMoved,
            abilityUses: { ...this.abilityUses },
            extraLife: this.extraLife,
            isParalyzed: this.isParalyzed,
            isSilenced: this.isSilenced,
            silenceTurns: this.silenceTurns,
            isNeutral: this.isNeutral
        };
    }

    /**
     * 反序列化棋子
     */
    static deserialize(data) {
        const piece = new Piece(data.type, data.color, data.nation);
        piece.id = data.id;
        piece.row = data.row;
        piece.col = data.col;
        piece.hasMoved = data.hasMoved;
        piece.abilityUses = { ...data.abilityUses };
        piece.extraLife = data.extraLife || 0;
        piece.isParalyzed = data.isParalyzed || false;
        piece.isSilenced = data.isSilenced || false;
        piece.silenceTurns = data.silenceTurns || 0;
        piece.isNeutral = data.isNeutral || false;
        return piece;
    }
}

/**
 * 创建标准初始棋子布局
 */
export function createInitialPieces(color, nation) {
    const pieces = [];
    const backRow = color === 'white' ? 7 : 0;
    const pawnRow = color === 'white' ? 6 : 1;

    // 后排棋子顺序：车、马、象、后、王、象、马、车
    const backRowPieces = ['rook', 'knight', 'bishop', 'queen', 'king', 'bishop', 'knight', 'rook'];

    for (let col = 0; col < 8; col++) {
        // 后排
        const piece = new Piece(backRowPieces[col], color, nation);
        piece.row = backRow;
        piece.col = col;
        pieces.push(piece);

        // 兵
        const pawn = new Piece('pawn', color, nation);
        pawn.row = pawnRow;
        pawn.col = col;
        pieces.push(pawn);
    }

    return pieces;
}
