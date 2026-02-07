/**
 * SuperChess - Game Engine
 * 游戏引擎 - 核心游戏逻辑控制器
 */

import { Board } from './Board.js';
import { Piece, createInitialPieces } from './Piece.js';
import { MoveValidator } from './MoveValidator.js';
import { AbilitySystem } from './AbilitySystem.js';
import { getNation } from '../data/nations.js';

export class GameEngine {
    constructor() {
        this.board = new Board();
        this.moveValidator = new MoveValidator(this.board);
        this.abilitySystem = new AbilitySystem(this);

        // 游戏状态
        this.currentTurn = 'white';
        this.turnNumber = 1;
        this.gameState = 'setup'; // setup, playing, paused, ended
        this.winner = null;
        this.endReason = null;

        // 玩家信息
        this.players = {
            white: { nation: null, time: 600 },
            black: { nation: null, time: 600 }
        };

        // 被吃的棋子
        this.capturedPieces = {
            white: [],
            black: []
        };

        // 移动历史
        this.moveHistory = [];

        // 事件回调
        this.eventListeners = {};
    }

    /**
     * 设置玩家国家
     */
    setPlayerNation(color, nationId) {
        const nation = getNation(nationId);
        if (!nation) return false;

        this.players[color].nation = nation;
        return true;
    }

    /**
     * 获取玩家国家
     */
    getNation(color) {
        return this.players[color].nation;
    }

    /**
     * 初始化游戏
     */
    initGame() {
        if (!this.players.white.nation || !this.players.black.nation) {
            return { success: false, error: '请先选择双方国家' };
        }

        this.board = new Board();
        this.moveValidator.setBoard(this.board);

        // 放置白方棋子
        const whitePieces = createInitialPieces('white', this.players.white.nation.id);
        for (const piece of whitePieces) {
            this.board.setPiece(piece.row, piece.col, piece);
        }

        // 放置黑方棋子
        const blackPieces = createInitialPieces('black', this.players.black.nation.id);
        for (const piece of blackPieces) {
            this.board.setPiece(piece.row, piece.col, piece);
        }

        // 重置游戏状态
        this.currentTurn = 'white';
        this.turnNumber = 1;
        this.gameState = 'playing';
        this.winner = null;
        this.endReason = null;
        this.capturedPieces = { white: [], black: [] };
        this.moveHistory = [];

        this.emit('gameStart', {
            white: this.players.white.nation,
            black: this.players.black.nation
        });

        return { success: true };
    }

    /**
     * 获取棋子的合法移动
     */
    getLegalMoves(row, col) {
        const piece = this.board.getPiece(row, col);
        if (!piece) return [];
        if (piece.color !== this.currentTurn) return [];
        if (this.gameState !== 'playing') return [];

        return this.moveValidator.getLegalMoves(piece);
    }

    /**
     * 执行移动
     */
    makeMove(fromRow, fromCol, toRow, toCol, promotionType = null) {
        if (this.gameState !== 'playing') {
            return { success: false, error: '游戏未在进行中' };
        }

        const piece = this.board.getPiece(fromRow, fromCol);
        if (!piece) {
            return { success: false, error: '没有选中棋子' };
        }

        if (piece.color !== this.currentTurn) {
            return { success: false, error: '不是你的回合' };
        }

        const legalMoves = this.moveValidator.getLegalMoves(piece);
        const move = legalMoves.find(m => m.row === toRow && m.col === toCol);

        if (!move) {
            return { success: false, error: '非法移动' };
        }

        // 检查是否有免疫
        if (move.type === 'capture' || move.type === 'cannonCapture') {
            const defender = this.board.getPiece(toRow, toCol);
            if (defender && this.abilitySystem.checkImmunity(piece, defender)) {
                return { success: false, error: '目标免疫此攻击' };
            }
        }

        // 执行移动
        const moveResult = this.executeMove(piece, move, promotionType);

        if (!moveResult.success) {
            return moveResult;
        }

        // 使用能力（如果有）
        if (move.ability) {
            piece.useAbility(move.ability);
        }

        // 记录移动
        this.recordMove(piece, fromRow, fromCol, move, moveResult.captured);

        // 切换回合
        this.switchTurn();

        // 检查游戏结束
        this.checkGameEnd();

        this.emit('moveMade', {
            piece,
            from: { row: fromRow, col: fromCol },
            to: { row: toRow, col: toCol },
            captured: moveResult.captured,
            move
        });

        return { success: true, ...moveResult };
    }

    /**
     * 执行具体的移动操作
     */
    executeMove(piece, move, promotionType) {
        const { row, col, type } = move;
        let captured = null;
        const effects = [];

        switch (type) {
            case 'move':
                this.board.movePiece(piece.row, piece.col, row, col);
                break;

            case 'capture':
            case 'cannonCapture':
                const defender = this.board.getPiece(row, col);
                if (defender) {
                    // 检查是否被消灭
                    if (defender.onAttacked()) {
                        captured = this.board.removePiece(row, col);
                        this.capturedPieces[captured.color === 'white' ? 'black' : 'white'].push(captured);

                        // 处理吃子效果
                        const captureEffects = this.abilitySystem.onCapture(piece, defender, row, col);
                        effects.push(...captureEffects);
                    }
                }
                this.board.movePiece(piece.row, piece.col, row, col);
                break;

            case 'enPassant':
                const capturedPos = move.capturedPiecePos;
                captured = this.board.removePiece(capturedPos.row, capturedPos.col);
                if (captured) {
                    this.capturedPieces[captured.color === 'white' ? 'black' : 'white'].push(captured);
                }
                this.board.movePiece(piece.row, piece.col, row, col);
                break;

            case 'castling':
                // 移动国王
                this.board.movePiece(piece.row, piece.col, row, col);
                // 移动车
                this.board.movePiece(move.rookFrom.row, move.rookFrom.col, move.rookTo.row, move.rookTo.col);
                break;
        }

        // 检查兵升变
        if (piece.type === 'pawn' && this.moveValidator.canPromote(piece, row)) {
            const newType = promotionType || 'queen';
            piece.type = newType;
            effects.push({ type: 'promotion', pieceId: piece.id, newType });
        }

        // 处理效果
        for (const effect of effects) {
            this.processEffect(effect);
        }

        return { success: true, captured, effects };
    }

    /**
     * 处理特殊效果
     */
    processEffect(effect) {
        switch (effect.type) {
            case 'mutualDestruction':
                const attacker = this.board.getAllPieces().find(p => p.id === effect.attackerId);
                if (attacker) {
                    const captured = this.board.removePiece(attacker.row, attacker.col);
                    if (captured) {
                        this.capturedPieces[captured.color === 'white' ? 'black' : 'white'].push(captured);
                    }
                }
                break;

            case 'push':
                // 推开棋子逻辑
                const pushedPiece = this.board.getAllPieces().find(p => p.id === effect.pieceId);
                if (pushedPiece) {
                    // 找一个相邻的空位
                    const directions = [[-1, 0], [1, 0], [0, -1], [0, 1]];
                    for (const [dr, dc] of directions) {
                        const newRow = pushedPiece.row + dr;
                        const newCol = pushedPiece.col + dc;
                        if (this.board.isEmpty(newRow, newCol)) {
                            this.board.movePiece(pushedPiece.row, pushedPiece.col, newRow, newCol);
                            break;
                        }
                    }
                }
                break;
        }
    }

    /**
     * 记录移动
     */
    recordMove(piece, fromRow, fromCol, move, captured) {
        const notation = this.getMoveNotation(piece, fromRow, fromCol, move, captured);

        if (this.currentTurn === 'white') {
            this.moveHistory.push({
                number: this.turnNumber,
                white: notation,
                black: null
            });
        } else {
            if (this.moveHistory.length > 0) {
                this.moveHistory[this.moveHistory.length - 1].black = notation;
            }
        }
    }

    /**
     * 获取移动记谱法
     */
    getMoveNotation(piece, fromRow, fromCol, move, captured) {
        const files = 'abcdefgh';
        const ranks = '87654321';

        const from = files[fromCol] + ranks[fromRow];
        const to = files[move.col] + ranks[move.row];

        let notation = '';

        if (move.type === 'castling') {
            notation = move.col === 6 ? 'O-O' : 'O-O-O';
        } else {
            if (piece.type !== 'pawn') {
                const pieceLetters = { king: 'K', queen: 'Q', rook: 'R', bishop: 'B', knight: 'N' };
                notation += pieceLetters[piece.type];
            }

            if (captured) {
                if (piece.type === 'pawn') {
                    notation += files[fromCol];
                }
                notation += 'x';
            }

            notation += to;
        }

        // 检查将军
        const enemyColor = this.currentTurn === 'white' ? 'black' : 'white';
        if (this.moveValidator.isInCheck(enemyColor)) {
            if (this.moveValidator.isCheckmate(enemyColor)) {
                notation += '#';
            } else {
                notation += '+';
            }
        }

        return notation;
    }

    /**
     * 切换回合
     */
    switchTurn() {
        // 处理当前玩家棋子的回合结束效果
        const currentPieces = this.board.getPiecesByColor(this.currentTurn);
        for (const piece of currentPieces) {
            piece.onTurnEnd();
        }

        this.currentTurn = this.currentTurn === 'white' ? 'black' : 'white';

        if (this.currentTurn === 'white') {
            this.turnNumber++;
        }

        this.emit('turnChange', { currentTurn: this.currentTurn, turnNumber: this.turnNumber });
    }

    /**
     * 检查游戏结束
     */
    checkGameEnd() {
        const color = this.currentTurn;

        if (this.moveValidator.isCheckmate(color)) {
            this.endGame(color === 'white' ? 'black' : 'white', 'checkmate');
        } else if (this.moveValidator.isStalemate(color)) {
            this.endGame(null, 'stalemate');
        }
    }

    /**
     * 结束游戏
     */
    endGame(winner, reason) {
        this.gameState = 'ended';
        this.winner = winner;
        this.endReason = reason;

        this.emit('gameEnd', { winner, reason });
    }

    /**
     * 认输
     */
    resign(color) {
        const winner = color === 'white' ? 'black' : 'white';
        this.endGame(winner, 'resignation');
    }

    /**
     * 获取被吃的棋子
     */
    getCapturedPieces(color) {
        return this.capturedPieces[color === 'white' ? 'black' : 'white'];
    }

    /**
     * 移除被吃的棋子记录（用于复活）
     */
    removeCapturedPiece(color, piece) {
        const list = this.capturedPieces[color === 'white' ? 'black' : 'white'];
        const index = list.findIndex(p => p.id === piece.id);
        if (index !== -1) {
            list.splice(index, 1);
        }
    }

    /**
     * 获取可用的特殊能力
     */
    getAvailableAbilities() {
        return this.abilitySystem.getAvailableAbilities(this.currentTurn);
    }

    /**
     * 激活能力
     */
    activateAbility(abilityId, pieceId) {
        return this.abilitySystem.activateAbility(abilityId, pieceId);
    }

    /**
     * 执行能力
     */
    executeAbility(targetRow, targetCol) {
        const result = this.abilitySystem.executeAbility(targetRow, targetCol);

        if (result.success) {
            this.emit('abilityUsed', result);

            // 不结束回合的能力
            const noTurnEndAbilities = ['paralyzeAround', 'paralyzeEnemy', 'silenceEnemy', 'paralyzeKnight', 'shieldNeighbors'];
            if (!noTurnEndAbilities.includes(result.targetType)) {
                this.switchTurn();
            }
            this.checkGameEnd();
        }

        return result;
    }

    /**
     * 取消能力
     */
    cancelAbility() {
        this.abilitySystem.cancelAbility();
    }

    // ==================== 事件系统 ====================

    on(event, callback) {
        if (!this.eventListeners[event]) {
            this.eventListeners[event] = [];
        }
        this.eventListeners[event].push(callback);
    }

    off(event, callback) {
        if (!this.eventListeners[event]) return;
        const index = this.eventListeners[event].indexOf(callback);
        if (index !== -1) {
            this.eventListeners[event].splice(index, 1);
        }
    }

    emit(event, data) {
        if (!this.eventListeners[event]) return;
        for (const callback of this.eventListeners[event]) {
            callback(data);
        }
    }

    // ==================== 状态获取 ====================

    getGameState() {
        return {
            board: this.board.serialize(),
            currentTurn: this.currentTurn,
            turnNumber: this.turnNumber,
            gameState: this.gameState,
            winner: this.winner,
            endReason: this.endReason,
            players: this.players,
            capturedPieces: this.capturedPieces,
            moveHistory: this.moveHistory,
            isCheck: this.moveValidator.isInCheck(this.currentTurn)
        };
    }
}
