/**
 * SuperChess - Ability System
 * 特殊能力系统 - 处理所有国家特殊能力的执行
 */

import { getAbility, getNationAbilities } from '../data/abilities.js';
import { Piece } from './Piece.js';

export class AbilitySystem {
    constructor(gameEngine) {
        this.engine = gameEngine;
        this.pendingAbility = null;
    }

    /**
     * 获取当前玩家可用的能力
     */
    getAvailableAbilities(color) {
        const nation = this.engine.getNation(color);
        if (!nation) return [];

        const abilities = getNationAbilities(nation.id);
        const availableAbilities = [];

        for (const ability of abilities) {
            if (ability.trigger === 'active') {
                // 检查是否有棋子可以使用此能力
                const pieces = this.engine.board.getPiecesByColor(color)
                    .filter(p => p.type === ability.piece && p.canUseAbility(ability.id));

                if (pieces.length > 0) {
                    availableAbilities.push({
                        ...ability,
                        pieces: pieces.map(p => ({ row: p.row, col: p.col, id: p.id }))
                    });
                }
            }
        }

        return availableAbilities;
    }

    /**
     * 激活一个能力
     */
    activateAbility(abilityId, pieceId) {
        const ability = getAbility(abilityId);
        if (!ability) return { success: false, error: '能力不存在' };

        const pieces = this.engine.board.getAllPieces();
        const piece = pieces.find(p => p.id === pieceId);
        if (!piece) return { success: false, error: '棋子不存在' };

        if (!piece.canUseAbility(abilityId)) {
            return { success: false, error: '能力不可用' };
        }

        this.pendingAbility = { ability, piece };

        // 根据能力类型返回需要的目标选择
        return this.getAbilityTargets(ability, piece);
    }

    /**
     * 获取能力的可选目标
     */
    getAbilityTargets(ability, piece) {
        const color = piece.color;
        const targets = [];

        switch (ability.targetType) {
            case 'swapWithAny':
                // 可与任意己方棋子交换
                targets.push(...this.engine.board.getPiecesByColor(color)
                    .filter(p => p.id !== piece.id)
                    .map(p => ({ row: p.row, col: p.col, type: 'swap' })));
                break;

            case 'swapWithQueen':
                // 与皇后交换
                const queen = this.engine.board.getPiecesByColor(color)
                    .find(p => p.type === 'queen');
                if (queen) {
                    targets.push({ row: queen.row, col: queen.col, type: 'swap' });
                }
                break;

            case 'revivePawn':
                // 复活兵到底线
                const deadPawns = this.engine.getCapturedPieces(color)
                    .filter(p => p.type === 'pawn');
                if (deadPawns.length > 0) {
                    const emptyPositions = this.engine.board.getEmptyBackRankPositions(color);
                    targets.push(...emptyPositions.map(pos => ({ ...pos, type: 'revive' })));
                }
                break;

            case 'paralyzeEnemy':
                // 瘫痪敌方棋子
                const enemyColor = color === 'white' ? 'black' : 'white';
                targets.push(...this.engine.board.getPiecesByColor(enemyColor)
                    .filter(p => p.type !== 'king')
                    .map(p => ({ row: p.row, col: p.col, type: 'paralyze' })));
                break;

            case 'silenceEnemy':
                // 沉默敌方棋子
                const enemyColor2 = color === 'white' ? 'black' : 'white';
                targets.push(...this.engine.board.getPiecesByColor(enemyColor2)
                    .map(p => ({ row: p.row, col: p.col, type: 'silence' })));
                break;

            case 'convertEnemyPawn':
                // 转化敌方兵
                const enemyColor3 = color === 'white' ? 'black' : 'white';
                targets.push(...this.engine.board.getPiecesByColor(enemyColor3)
                    .filter(p => p.type === 'pawn')
                    .map(p => ({ row: p.row, col: p.col, type: 'convert' })));
                break;

            case 'banishPawn':
                // 驱逐敌方兵到边缘
                const enemyColor4 = color === 'white' ? 'black' : 'white';
                targets.push(...this.engine.board.getPiecesByColor(enemyColor4)
                    .filter(p => p.type === 'pawn')
                    .map(p => ({ row: p.row, col: p.col, type: 'banish' })));
                break;

            case 'teleportPawn':
                // 传送己方兵到敌方底线
                const myPawns = this.engine.board.getPiecesByColor(color)
                    .filter(p => p.type === 'pawn');
                if (myPawns.length > 0) {
                    const enemyBackRank = this.engine.board.getEmptyEnemyBackRankPositions(color);
                    targets.push(...enemyBackRank.map(pos => ({ ...pos, type: 'teleport' })));
                }
                break;

            case 'neutralizeKnight':
                // 中立化敌方骑士
                const enemyColor5 = color === 'white' ? 'black' : 'white';
                targets.push(...this.engine.board.getPiecesByColor(enemyColor5)
                    .filter(p => p.type === 'knight')
                    .map(p => ({ row: p.row, col: p.col, type: 'neutralize' })));
                break;

            case 'paralyzeKnight':
                // 瘡痪敌方骑士3回合
                const enemyColor6 = color === 'white' ? 'black' : 'white';
                targets.push(...this.engine.board.getPiecesByColor(enemyColor6)
                    .filter(p => p.type === 'knight')
                    .map(p => ({ row: p.row, col: p.col, type: 'paralyzeKnight' })));
                break;

            case 'grantExtraLife':
                // 给相邻己方棋子额外生命
                const adjacent = this.engine.board.getAdjacentPieces(piece.row, piece.col);
                targets.push(...adjacent
                    .filter(({ piece: p }) => p.color === color)
                    .map(({ row, col }) => ({ row, col, type: 'buff' })));
                break;

            case 'shieldNeighbors':
                // 僧兵给相邻棋子免疫 (Target Self triggers effect around self)
                targets.push({ row: piece.row, col: piece.col, type: 'shield' });
                break;

            case 'paralyzeAround':
                // 宫廷阴谋：使周围敌方棋子瘡痪 (Target Self triggers effect around self)
                targets.push({ row: piece.row, col: piece.col, type: 'paralyzeArea' });
                break;
        }

        return {
            success: true,
            needsTarget: targets.length > 0,
            targets,
            abilityId: ability.id
        };
    }

    /**
     * 执行能力（选择目标后）
     */
    executeAbility(targetRow, targetCol) {
        if (!this.pendingAbility) {
            return { success: false, error: '没有待执行的能力' };
        }

        const { ability, piece } = this.pendingAbility;
        let result = { success: false };

        switch (ability.targetType) {
            case 'swapWithAny':
            case 'swapWithQueen':
                result = this.executeSwap(piece, targetRow, targetCol);
                break;

            case 'revivePawn':
                result = this.executeRevive(piece, targetRow, targetCol);
                break;

            case 'paralyzeEnemy':
                result = this.executeParalyze(targetRow, targetCol);
                break;

            case 'silenceEnemy':
                result = this.executeSilence(targetRow, targetCol);
                break;

            case 'convertEnemyPawn':
                result = this.executeConvert(piece, targetRow, targetCol);
                break;

            case 'banishPawn':
                result = this.executeBanish(piece, targetRow, targetCol);
                break;

            case 'teleportPawn':
                result = this.executeTeleport(piece, targetRow, targetCol);
                break;

            case 'neutralizeKnight':
                result = this.executeNeutralize(targetRow, targetCol);
                break;

            case 'grantExtraLife':
                result = this.executeGrantLife(targetRow, targetCol);
                break;

            case 'shieldNeighbors':
                result = this.executeShieldNeighbors(targetRow, targetCol);
                break;

            case 'paralyzeAround':
                result = this.executeParalyzeAround(targetRow, targetCol);
                break;

            case 'paralyzeKnight':
                result = this.executeParalyzeKnight(targetRow, targetCol);
                break;
        }

        if (result.success) {
            piece.useAbility(ability.id);
            result.abilityId = ability.id; // 用于判断是否结束回合
            result.targetType = ability.targetType;
        }

        this.pendingAbility = null;
        return result;
    }

    /**
     * 取消能力
     */
    cancelAbility() {
        this.pendingAbility = null;
    }

    // ==================== 能力执行方法 ====================

    executeSwap(piece, targetRow, targetCol) {
        const targetPiece = this.engine.board.getPiece(targetRow, targetCol);
        if (!targetPiece || targetPiece.color !== piece.color) {
            return { success: false, error: '无效目标' };
        }

        const pieceRow = piece.row;
        const pieceCol = piece.col;

        this.engine.board.removePiece(piece.row, piece.col);
        this.engine.board.removePiece(targetRow, targetCol);
        this.engine.board.setPiece(targetRow, targetCol, piece);
        this.engine.board.setPiece(pieceRow, pieceCol, targetPiece);

        return { success: true, message: `${piece.type} 与 ${targetPiece.type} 交换位置` };
    }

    executeRevive(piece, targetRow, targetCol) {
        const capturedPawns = this.engine.getCapturedPieces(piece.color)
            .filter(p => p.type === 'pawn');

        if (capturedPawns.length === 0) {
            return { success: false, error: '没有可复活的兵' };
        }

        if (!this.engine.board.isEmpty(targetRow, targetCol)) {
            return { success: false, error: '目标位置不为空' };
        }

        const revivedPawn = capturedPawns[0];
        this.engine.removeCapturedPiece(piece.color, revivedPawn);
        this.engine.board.setPiece(targetRow, targetCol, revivedPawn);
        revivedPawn.hasMoved = true;

        return { success: true, message: '复活了一个兵' };
    }

    executeParalyze(targetRow, targetCol) {
        const targetPiece = this.engine.board.getPiece(targetRow, targetCol);
        if (!targetPiece) {
            return { success: false, error: '目标位置没有棋子' };
        }

        targetPiece.isParalyzed = true;
        return { success: true, message: `${targetPiece.type} 被瘫痪` };
    }

    executeSilence(targetRow, targetCol) {
        const targetPiece = this.engine.board.getPiece(targetRow, targetCol);
        if (!targetPiece) {
            return { success: false, error: '目标位置没有棋子' };
        }

        targetPiece.isSilenced = true;
        targetPiece.silenceTurns = 2;
        return { success: true, message: `${targetPiece.type} 被沉默2回合` };
    }

    executeConvert(piece, targetRow, targetCol) {
        const targetPiece = this.engine.board.getPiece(targetRow, targetCol);
        if (!targetPiece || targetPiece.type !== 'pawn') {
            return { success: false, error: '目标必须是敌方兵' };
        }

        // 改变棋子所有权
        targetPiece.color = piece.color;
        return { success: true, message: '成功收买了敌方的兵' };
    }

    executeBanish(piece, targetRow, targetCol) {
        const targetPiece = this.engine.board.getPiece(targetRow, targetCol);
        if (!targetPiece || targetPiece.type !== 'pawn') {
            return { success: false, error: '目标必须是敌方兵' };
        }

        // 找到最近的边缘位置
        const edges = [
            { row: targetRow, col: 0 },
            { row: targetRow, col: 7 },
            { row: 0, col: targetCol },
            { row: 7, col: targetCol }
        ];

        for (const edge of edges) {
            if (this.engine.board.isEmpty(edge.row, edge.col)) {
                this.engine.board.movePiece(targetRow, targetCol, edge.row, edge.col);
                return { success: true, message: `敌方兵被驱逐到 (${edge.row}, ${edge.col})` };
            }
        }

        return { success: false, error: '没有可用的边缘位置' };
    }

    executeTeleport(piece, targetRow, targetCol) {
        // 需要先选择要传送的兵
        const pawns = this.engine.board.getPiecesByColor(piece.color)
            .filter(p => p.type === 'pawn');

        if (pawns.length === 0) {
            return { success: false, error: '没有可传送的兵' };
        }

        // 这里简化处理，传送第一个兵
        const pawn = pawns[0];
        this.engine.board.movePiece(pawn.row, pawn.col, targetRow, targetCol);

        return { success: true, message: '兵被传送到敌方底线' };
    }

    executeNeutralize(targetRow, targetCol) {
        const targetPiece = this.engine.board.getPiece(targetRow, targetCol);
        if (!targetPiece || targetPiece.type !== 'knight') {
            return { success: false, error: '目标必须是敌方骑士' };
        }

        targetPiece.isNeutral = true;
        return { success: true, message: '敌方骑士已中立化' };
    }

    executeGrantLife(targetRow, targetCol) {
        const targetPiece = this.engine.board.getPiece(targetRow, targetCol);
        if (!targetPiece) {
            return { success: false, error: '目标位置没有棋子' };
        }

        targetPiece.extraLife += 1;
        return { success: true, message: `${targetPiece.type} 获得额外生命` };
    }

    executeShieldNeighbors(targetRow, targetCol) {
        const piece = this.engine.board.getPiece(targetRow, targetCol);
        if (!piece) return { success: false, error: '目标丢失' };

        const adjacent = this.engine.board.getAdjacentPieces(targetRow, targetCol);
        let count = 0;
        for (const { piece: adjPiece } of adjacent) {
            if (adjPiece.color === piece.color) {
                adjPiece.isImmune = true;
                adjPiece.immunityTurns = 2; // 持续2个半回合(自己结束+对手回合)
                count++;
            }
        }
        return { success: true, message: `${count} 个盟友获得免疫` };
    }

    executeParalyzeAround(targetRow, targetCol) {
        const piece = this.engine.board.getPiece(targetRow, targetCol);
        if (!piece) return { success: false, error: '目标丢失' };

        const adjacent = this.engine.board.getAdjacentPieces(targetRow, targetCol);
        let count = 0;
        for (const { piece: adjPiece } of adjacent) {
            if (adjPiece.color !== piece.color) {
                adjPiece.isParalyzed = true;
                adjPiece.paralyzeTurns = 2; // 下回合不能移动
                count++;
            }
        }
        return { success: true, message: `${count} 个敌方棋子被瘡痪` };
    }

    executeParalyzeKnight(targetRow, targetCol) {
        const piece = this.engine.board.getPiece(targetRow, targetCol);
        if (!piece || piece.type !== 'knight') {
            return { success: false, error: '目标不是骑士' };
        }

        piece.isParalyzed = true;
        piece.paralyzeTurns = 6; // 3回合 = 6个半回合
        return { success: true, message: `骑士被瘫痪3回合` };
    }

    // ==================== 被动能力检查 ====================

    /**
     * 检查被动能力：是否免疫某类攻击
     */
    checkImmunity(attacker, defender) {
        // 神罗皇后不能被兵吃
        if (defender.nation === 'holyroman' && defender.type === 'queen' && attacker.type === 'pawn') {
            return true;
        }

        // 拜占庭城墙不能被骑士吃
        if (defender.nation === 'byzantine' && defender.type === 'rook' && attacker.type === 'knight') {
            return true;
        }

        // 神罗长矛阵：相邻兵不能被骑士吃
        if (defender.nation === 'holyroman' && defender.type === 'pawn' && attacker.type === 'knight') {
            if (this.engine.board.hasAdjacentAllyPawn(defender.row, defender.col, defender.color)) {
                return true;
            }
        }

        // 罗斯冬季坚守：己方半场的兵不能被敌方兵吃
        if (defender.nation === 'rus' && defender.type === 'pawn' && attacker.type === 'pawn') {
            if (this.engine.board.isInOwnHalf(defender.row, defender.color)) {
                return true;
            }
        }

        // 奥斯曼苏丹护卫：上下左右有己方棋子则免疫
        if (defender.nation === 'ottoman' && defender.type === 'king') {
            if (this.engine.board.hasOrthogonalAlly(defender.row, defender.col, defender.color)) {
                return true;
            }
        }

        // 波兰联邦议会：车与主要棋子相邻时不能被吃
        if (defender.nation === 'poland' && defender.type === 'rook') {
            if (this.engine.board.hasAdjacentMajorPiece(defender.row, defender.col, defender.color)) {
                return true;
            }
        }

        return false;
    }

    /**
     * 处理吃子后的效果
     */
    onCapture(attacker, defender, captureRow, captureCol) {
        const effects = [];

        // 日本女武将：吃兵后生成（限2次）
        if (attacker.nation === 'japan' && attacker.type === 'queen' && defender.type === 'pawn') {
            if (attacker.canUseAbility('japan_queen_valkyrie')) {
                const backRank = this.engine.board.getEmptyBackRankPositions(attacker.color);
                if (backRank.length > 0) {
                    const pos = backRank[0];
                    // 生成新兵
                    const newPawn = new Piece('pawn', attacker.color, attacker.nation);
                    this.engine.board.setPiece(pos.row, pos.col, newPawn);

                    attacker.useAbility('japan_queen_valkyrie');
                    effects.push({ type: 'spawnPawnBackRow', position: pos, message: '女武将征召兵' });
                }
            }
        }

        // 西班牙黄金渴望：在敌方半场吃子后生成兵
        if (attacker.nation === 'spain' && attacker.type === 'knight') {
            if (this.engine.board.isInEnemyHalf(captureRow, attacker.color)) {
                const backRank = this.engine.board.getEmptyBackRankPositions(attacker.color);
                if (backRank.length > 0) {
                    const pos = backRank[0];
                    const newPawn = new Piece('pawn', attacker.color, attacker.nation);
                    this.engine.board.setPiece(pos.row, pos.col, newPawn);
                    effects.push({ type: 'spawnPawnBackRow', position: pos, message: '黄金渴望：征兵' });
                }
            }
        }

        // 拜占庭铁甲骑兵：吃子时推开相邻兵
        if (attacker.nation === 'byzantine' && attacker.type === 'knight') {
            const adjacent = this.engine.board.getAdjacentPieces(captureRow, captureCol);
            for (const { piece, row, col } of adjacent) {
                if (piece.type === 'pawn' && piece.color !== attacker.color) {
                    effects.push({ type: 'push', pieceId: piece.id, from: { row, col } });
                }
            }
        }

        // 拜占庭希腊火兵：被吃时灼烧攻击者
        if (defender.nation === 'byzantine' && defender.type === 'pawn') {
            attacker.isBurning = true;
            effects.push({ type: 'burn', pieceId: attacker.id });
        }

        // 日本武士切腹：被吃时同归于尽
        if (defender.nation === 'japan' && defender.type === 'knight' && defender.canUseAbility('japan_knight_seppuku')) {
            effects.push({ type: 'mutualDestruction', attackerId: attacker.id });
            defender.useAbility('japan_knight_seppuku');
        }

        return effects;
    }
}
