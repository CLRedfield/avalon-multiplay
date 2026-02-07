/**
 * SuperChess - Board Logic
 * 棋盘逻辑类
 */

export class Board {
    constructor() {
        this.size = 8;
        this.cells = this.createEmptyBoard();
        this.lastMove = null;
    }

    /**
     * 创建空棋盘
     */
    createEmptyBoard() {
        const board = [];
        for (let row = 0; row < this.size; row++) {
            board[row] = [];
            for (let col = 0; col < this.size; col++) {
                board[row][col] = null;
            }
        }
        return board;
    }

    /**
     * 获取指定位置的棋子
     */
    getPiece(row, col) {
        if (!this.isValidPosition(row, col)) return null;
        return this.cells[row][col];
    }

    /**
     * 设置指定位置的棋子
     */
    setPiece(row, col, piece) {
        if (!this.isValidPosition(row, col)) return false;
        this.cells[row][col] = piece;
        if (piece) {
            piece.row = row;
            piece.col = col;
        }
        return true;
    }

    /**
     * 移除指定位置的棋子
     */
    removePiece(row, col) {
        if (!this.isValidPosition(row, col)) return null;
        const piece = this.cells[row][col];
        this.cells[row][col] = null;
        return piece;
    }

    /**
     * 移动棋子
     */
    movePiece(fromRow, fromCol, toRow, toCol) {
        const piece = this.getPiece(fromRow, fromCol);
        if (!piece) return null;

        const captured = this.getPiece(toRow, toCol);

        this.removePiece(fromRow, fromCol);
        this.setPiece(toRow, toCol, piece);

        piece.hasMoved = true;
        this.lastMove = {
            piece,
            from: { row: fromRow, col: fromCol },
            to: { row: toRow, col: toCol },
            captured
        };

        return captured;
    }

    /**
     * 验证位置是否有效
     */
    isValidPosition(row, col) {
        return row >= 0 && row < this.size && col >= 0 && col < this.size;
    }

    /**
     * 检查位置是否为空
     */
    isEmpty(row, col) {
        return this.isValidPosition(row, col) && this.cells[row][col] === null;
    }

    /**
     * 检查位置是否有敌方棋子
     */
    hasEnemy(row, col, color) {
        const piece = this.getPiece(row, col);
        return piece !== null && piece.color !== color;
    }

    /**
     * 检查位置是否有己方棋子
     */
    hasAlly(row, col, color) {
        const piece = this.getPiece(row, col);
        return piece !== null && piece.color === color;
    }

    /**
     * 获取指定颜色的所有棋子
     */
    getPiecesByColor(color) {
        const pieces = [];
        for (let row = 0; row < this.size; row++) {
            for (let col = 0; col < this.size; col++) {
                const piece = this.cells[row][col];
                if (piece && piece.color === color) {
                    pieces.push(piece);
                }
            }
        }
        return pieces;
    }

    /**
     * 获取国王位置
     */
    getKingPosition(color) {
        for (let row = 0; row < this.size; row++) {
            for (let col = 0; col < this.size; col++) {
                const piece = this.cells[row][col];
                if (piece && piece.type === 'king' && piece.color === color) {
                    return { row, col };
                }
            }
        }
        return null;
    }

    /**
     * 获取所有棋子
     */
    getAllPieces() {
        const pieces = [];
        for (let row = 0; row < this.size; row++) {
            for (let col = 0; col < this.size; col++) {
                const piece = this.cells[row][col];
                if (piece) {
                    pieces.push(piece);
                }
            }
        }
        return pieces;
    }

    /**
     * 复制棋盘状态
     */
    clone() {
        const newBoard = new Board();
        for (let row = 0; row < this.size; row++) {
            for (let col = 0; col < this.size; col++) {
                const piece = this.cells[row][col];
                if (piece) {
                    newBoard.cells[row][col] = piece.clone();
                }
            }
        }
        newBoard.lastMove = this.lastMove ? { ...this.lastMove } : null;
        return newBoard;
    }

    /**
     * 判断是否在己方半场
     */
    isInOwnHalf(row, color) {
        if (color === 'white') {
            return row >= 4; // 白方在下半场 (row 4-7)
        } else {
            return row <= 3; // 黑方在上半场 (row 0-3)
        }
    }

    /**
     * 判断是否在敌方半场
     */
    isInEnemyHalf(row, color) {
        return !this.isInOwnHalf(row, color);
    }

    /**
     * 判断是否已过河（中线）
     */
    hasCrossedMidline(row, color) {
        if (color === 'white') {
            return row <= 3; // 白方过河到 row 0-3
        } else {
            return row >= 4; // 黑方过河到 row 4-7
        }
    }

    /**
     * 获取相邻的棋子
     */
    getAdjacentPieces(row, col) {
        const adjacent = [];
        const directions = [
            [-1, -1], [-1, 0], [-1, 1],
            [0, -1], [0, 1],
            [1, -1], [1, 0], [1, 1]
        ];

        for (const [dr, dc] of directions) {
            const newRow = row + dr;
            const newCol = col + dc;
            const piece = this.getPiece(newRow, newCol);
            if (piece) {
                adjacent.push({ piece, row: newRow, col: newCol });
            }
        }
        return adjacent;
    }

    /**
     * 检查是否有相邻的己方兵
     */
    hasAdjacentAllyPawn(row, col, color) {
        const adjacent = this.getAdjacentPieces(row, col);
        return adjacent.some(({ piece }) =>
            piece.color === color && piece.type === 'pawn'
        );
    }

    /**
     * 检查上下左右是否有己方棋子
     */
    hasOrthogonalAlly(row, col, color) {
        const orthogonalDirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
        for (const [dr, dc] of orthogonalDirs) {
            const newRow = row + dr;
            const newCol = col + dc;
            if (this.hasAlly(newRow, newCol, color)) {
                return true;
            }
        }
        return false;
    }

    /**
     * 检查是否有相邻的己方主要棋子（后、车、象）
     */
    hasAdjacentMajorPiece(row, col, color) {
        const majorPieces = ['queen', 'rook', 'bishop'];
        const adjacent = this.getAdjacentPieces(row, col);
        return adjacent.some(({ piece }) =>
            piece.color === color && majorPieces.includes(piece.type)
        );
    }

    /**
     * 获取同一行的兵数量
     */
    getPawnsInRow(row, color) {
        let count = 0;
        for (let col = 0; col < this.size; col++) {
            const piece = this.cells[row][col];
            if (piece && piece.type === 'pawn' && piece.color === color) {
                count++;
            }
        }
        return count;
    }

    /**
     * 获取空的底线位置
     */
    getEmptyBackRankPositions(color) {
        const backRank = color === 'white' ? 7 : 0;
        const positions = [];
        for (let col = 0; col < this.size; col++) {
            if (this.isEmpty(backRank, col)) {
                positions.push({ row: backRank, col });
            }
        }
        return positions;
    }

    /**
     * 获取敌方底线空位
     */
    getEmptyEnemyBackRankPositions(color) {
        const backRank = color === 'white' ? 0 : 7;
        const positions = [];
        for (let col = 0; col < this.size; col++) {
            if (this.isEmpty(backRank, col)) {
                positions.push({ row: backRank, col });
            }
        }
        return positions;
    }

    /**
     * 序列化棋盘状态
     */
    serialize() {
        const state = [];
        for (let row = 0; row < this.size; row++) {
            for (let col = 0; col < this.size; col++) {
                const piece = this.cells[row][col];
                if (piece) {
                    state.push({
                        row,
                        col,
                        type: piece.type,
                        color: piece.color,
                        nation: piece.nation,
                        hasMoved: piece.hasMoved
                    });
                }
            }
        }
        return state;
    }
}
