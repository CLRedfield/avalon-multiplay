/**
 * SuperChess - Move Validator
 * 移动验证器 - 负责验证和生成合法移动
 */

export class MoveValidator {
    constructor(board) {
        this.board = board;
    }

    /**
     * 更新棋盘引用
     */
    setBoard(board) {
        this.board = board;
    }

    /**
     * 获取棋子的所有合法移动
     */
    getLegalMoves(piece, checkKingSafety = true) {
        if (!piece || piece.isParalyzed || piece.isBurning || piece.isNeutral) {
            return [];
        }

        let moves = [];

        switch (piece.type) {
            case 'pawn':
                moves = this.getPawnMoves(piece);
                break;
            case 'rook':
                moves = this.getRookMoves(piece);
                break;
            case 'knight':
                moves = this.getKnightMoves(piece);
                break;
            case 'bishop':
                moves = this.getBishopMoves(piece);
                break;
            case 'queen':
                moves = this.getQueenMoves(piece);
                break;
            case 'king':
                moves = this.getKingMoves(piece);
                break;
        }

        // 检查王的安全性（过滤掉会导致己方被将军的移动）
        if (checkKingSafety) {
            moves = moves.filter(move =>
                !this.wouldBeInCheck(piece, move.row, move.col)
            );
        }

        // 检查目标免疫状态
        moves = moves.filter(move => {
            if (move.type === 'capture' || move.type === 'cannonCapture') {
                const target = this.board.getPiece(move.row, move.col);
                if (target && target.isImmune) return false;
            }
            return true;
        });

        return moves;
    }

    /**
     * 获取兵的移动
     */
    getPawnMoves(piece) {
        const moves = [];
        const { row, col, color, nation } = piece;
        const direction = color === 'white' ? -1 : 1;

        // 向前移动一格
        const oneStep = row + direction;
        if (this.board.isEmpty(oneStep, col)) {
            moves.push({ row: oneStep, col, type: 'move' });

            // 初始位置可以移动两格
            // 英格兰长弓兵：每次只能前进1格
            if (!piece.hasMoved && nation !== 'england') {
                const twoStep = row + 2 * direction;
                if (this.board.isEmpty(twoStep, col)) {
                    moves.push({ row: twoStep, col, type: 'move' });
                }
            }

            // 日本足轻：首次可移动三格 (仅中间4列)
            if (nation === 'japan' && !piece.hasMoved && piece.canUseAbility('japan_pawn_teppo')) {
                if (col >= 2 && col <= 5) {
                    const threeStep = row + 3 * direction;
                    if (this.board.isValidPosition(threeStep, col) && this.board.isEmpty(threeStep, col)) {
                        moves.push({ row: threeStep, col, type: 'move', ability: 'japan_pawn_teppo' });
                    }
                }
            }
        }

        // 英格兰长弓兵：仅中间4列兵可攻击前方第2格
        if (nation === 'england' && piece.canUseAbility('england_pawn_longbow')) {
            if (col >= 2 && col <= 5) {
                const range2Row = row + 2 * direction;
                if (this.board.isValidPosition(range2Row, col) && this.board.hasEnemy(range2Row, col, color)) {
                    moves.push({ row: range2Row, col, type: 'capture', ability: 'england_pawn_longbow' });
                }
            }
        }

        // 斜向吃子
        for (const dc of [-1, 1]) {
            const captureCol = col + dc;
            if (this.board.hasEnemy(oneStep, captureCol, color)) {
                moves.push({ row: oneStep, col: captureCol, type: 'capture' });
            }
        }

        // 中国步卒：过河后可以横移
        if (nation === 'china' && this.board.hasCrossedMidline(row, color)) {
            for (const dc of [-1, 1]) {
                const sideCol = col + dc;
                if (this.board.isEmpty(row, sideCol)) {
                    moves.push({ row, col: sideCol, type: 'move' });
                }
            }
        }

        // 波兰哥萨克：可横向移动
        if (nation === 'poland' && piece.canUseAbility('poland_pawn_cossack')) {
            for (const dc of [-1, 1]) {
                const sideCol = col + dc;
                if (this.board.isEmpty(row, sideCol)) {
                    moves.push({ row, col: sideCol, type: 'move', ability: 'poland_pawn_cossack' });
                }
            }
        }

        // 蒙古轻骑兵：可后退一格
        if (nation === 'mongol' && piece.canUseAbility('mongol_pawn_nomad')) {
            const backStep = row - direction;
            if (this.board.isEmpty(backStep, col)) {
                moves.push({ row: backStep, col, type: 'move', ability: 'mongol_pawn_nomad' });
            }
        }

        // 奥斯曼火枪兵：中间4列未移动的兵可以吃掉前方1-2格的敌方棋子
        if (nation === 'ottoman' && !piece.hasMoved && piece.canUseAbility('ottoman_pawn_musket')) {
            if (col >= 2 && col <= 5) {
                for (let i = 1; i <= 2; i++) {
                    const targetRow = row + i * direction;
                    if (this.board.isValidPosition(targetRow, col) && this.board.hasEnemy(targetRow, col, color)) {
                        moves.push({ row: targetRow, col, type: 'capture', ability: 'ottoman_pawn_musket' });
                    }
                }
            }
        }

        // 过路兵
        const enPassantMove = this.getEnPassantMove(piece);
        if (enPassantMove) {
            moves.push(enPassantMove);
        }

        return moves;
    }

    /**
     * 获取过路兵移动
     */
    getEnPassantMove(piece) {
        const { row, col, color } = piece;
        const lastMove = this.board.lastMove;

        if (!lastMove || lastMove.piece.type !== 'pawn') return null;

        const expectedRow = color === 'white' ? 3 : 4;
        if (row !== expectedRow) return null;

        const { from, to, piece: lastPiece } = lastMove;
        if (Math.abs(from.row - to.row) !== 2) return null;
        if (Math.abs(col - to.col) !== 1) return null;
        if (to.row !== row) return null;

        const captureRow = color === 'white' ? row - 1 : row + 1;
        return {
            row: captureRow,
            col: to.col,
            type: 'enPassant',
            capturedPiecePos: { row: to.row, col: to.col }
        };
    }

    /**
     * 获取车的移动
     */
    getRookMoves(piece) {
        const moves = [];
        const { row, col, color, nation } = piece;

        // 四个方向：上、下、左、右
        const directions = [[-1, 0], [1, 0], [0, -1], [0, 1]];

        // 罗斯克里姆林：己方半场时范围+1
        let maxRange = 7;

        for (const [dr, dc] of directions) {
            // 英格兰限制横向范围
            let currentMaxRange = maxRange;
            if (nation === 'england') {
                currentMaxRange = 5;
            }

            for (let i = 1; i <= currentMaxRange; i++) {
                const newRow = row + dr * i;
                const newCol = col + dc * i;

                if (!this.board.isValidPosition(newRow, newCol)) break;

                if (this.board.isEmpty(newRow, newCol)) {
                    moves.push({ row: newRow, col: newCol, type: 'move' });
                } else if (this.board.hasEnemy(newRow, newCol, color)) {
                    moves.push({ row: newRow, col: newCol, type: 'capture' });
                    break;
                } else {
                    break;
                }
            }
        }

        // 英格兰伦敦塔守卫：增加四个斜向1格的移动
        if (nation === 'england') {
            const diagDirs = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
            for (const [dr, dc] of diagDirs) {
                const newRow = row + dr;
                const newCol = col + dc;
                if (this.board.isValidPosition(newRow, newCol)) {
                    if (this.board.isEmpty(newRow, newCol)) {
                        moves.push({ row: newRow, col: newCol, type: 'move', ability: 'england_rook_towerShot' });
                    } else if (this.board.hasEnemy(newRow, newCol, color)) {
                        moves.push({ row: newRow, col: newCol, type: 'capture', ability: 'england_rook_towerShot' });
                    }
                }
            }
        }

        // 中国冲锋陷阵：类似炮的隔子攻击 (限1次)
        if (nation === 'china' && piece.canUseAbility('china_rook_cannon') && piece.type === 'rook') {
            const cannonMoves = this.getCannonCaptures(piece);
            // 标记为能力使用
            cannonMoves.forEach(m => m.ability = 'china_rook_cannon');
            moves.push(...cannonMoves);
        }

        // 奥斯曼大炮：可以隔子吃 (限制本局还没吃过子)
        if (nation === 'ottoman' && piece.canUseAbility('ottoman_rook_cannon') && piece.type === 'rook') {
            const cannonMoves = this.getCannonCaptures(piece);
            cannonMoves.forEach(m => m.ability = 'ottoman_rook_cannon');
            moves.push(...cannonMoves);
        }

        // 罗斯坚城：己方半场可斜向移动最多2格
        if (nation === 'rus' && this.board.isInOwnHalf(row, color)) {
            const diagDirs = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
            for (const [dr, dc] of diagDirs) {
                for (let i = 1; i <= 2; i++) {
                    const newRow = row + dr * i;
                    const newCol = col + dc * i;
                    if (!this.board.isValidPosition(newRow, newCol)) break;

                    if (this.board.isEmpty(newRow, newCol)) {
                        moves.push({ row: newRow, col: newCol, type: 'move', ability: 'rus_rook_fortress' });
                    } else if (this.board.hasEnemy(newRow, newCol, color)) {
                        moves.push({ row: newRow, col: newCol, type: 'capture', ability: 'rus_rook_fortress' });
                        break;
                    } else {
                        break;
                    }
                }
            }
        }

        return moves;
    }

    /**
     * 获取炮的隔子吃（奥斯曼特殊）
     */
    getCannonCaptures(piece) {
        const moves = [];
        const { row, col, color } = piece;
        const directions = [[-1, 0], [1, 0], [0, -1], [0, 1]];

        for (const [dr, dc] of directions) {
            let foundPlatform = false;
            for (let i = 1; i <= 7; i++) {
                const newRow = row + dr * i;
                const newCol = col + dc * i;

                if (!this.board.isValidPosition(newRow, newCol)) break;

                const targetPiece = this.board.getPiece(newRow, newCol);
                if (targetPiece) {
                    if (!foundPlatform) {
                        foundPlatform = true;
                    } else if (targetPiece.color !== color) {
                        moves.push({ row: newRow, col: newCol, type: 'cannonCapture' });
                        break;
                    } else {
                        break;
                    }
                }
            }
        }

        return moves;
    }

    /**
     * 获取马的移动
     */
    getKnightMoves(piece) {
        const moves = [];
        const { row, col, color, nation } = piece;

        // 标准马的8个跳跃位置
        const jumps = [
            [-2, -1], [-2, 1], [-1, -2], [-1, 2],
            [1, -2], [1, 2], [2, -1], [2, 1]
        ];

        for (const [dr, dc] of jumps) {
            const newRow = row + dr;
            const newCol = col + dc;

            if (!this.board.isValidPosition(newRow, newCol)) continue;

            if (this.board.isEmpty(newRow, newCol)) {
                moves.push({ row: newRow, col: newCol, type: 'move' });
            } else if (this.board.hasEnemy(newRow, newCol, color)) {
                moves.push({ row: newRow, col: newCol, type: 'capture' });
            }
        }

        // 法兰西骑士：重装冲锋 (增加上下左右2格跳跃)
        if (nation === 'france') {
            const extraJumps = [
                [-2, 0], [2, 0], [0, -2], [0, 2]
            ];
            for (const [dr, dc] of extraJumps) {
                const newRow = row + dr;
                const newCol = col + dc;

                if (!this.board.isValidPosition(newRow, newCol)) continue;

                if (this.board.isEmpty(newRow, newCol)) {
                    moves.push({ row: newRow, col: newCol, type: 'move', ability: 'france_knight_charge' });
                } else if (this.board.hasEnemy(newRow, newCol, color)) {
                    moves.push({ row: newRow, col: newCol, type: 'capture', ability: 'france_knight_charge' });
                }
            }
        }

        // 神圣罗马帝国条顿骑士：敌方半场时增加直线移动1格
        if (nation === 'holyroman' && this.board.isInEnemyHalf(row, color)) {
            const directions = [[-1, 0], [1, 0], [0, -1], [0, 1]];
            for (const [dr, dc] of directions) {
                for (let i = 1; i <= 1; i++) {
                    const newRow = row + dr * i;
                    const newCol = col + dc * i;

                    if (!this.board.isValidPosition(newRow, newCol)) break;

                    if (this.board.isEmpty(newRow, newCol)) {
                        moves.push({ row: newRow, col: newCol, type: 'move', ability: 'holyroman_knight_crusade' });
                    } else if (this.board.hasEnemy(newRow, newCol, color)) {
                        moves.push({ row: newRow, col: newCol, type: 'capture', ability: 'holyroman_knight_crusade' });
                        break;
                    } else {
                        break;
                    }
                }
            }
        }

        // 波兰翼骑兵：可额外直线冲锋
        if (nation === 'poland' && piece.canUseAbility('poland_knight_hussar')) {
            const directions = [[-1, 0], [1, 0], [0, -1], [0, 1]];
            for (const [dr, dc] of directions) {
                for (let i = 1; i <= 2; i++) {
                    const newRow = row + dr * i;
                    const newCol = col + dc * i;

                    if (!this.board.isValidPosition(newRow, newCol)) break;

                    if (this.board.isEmpty(newRow, newCol)) {
                        moves.push({ row: newRow, col: newCol, type: 'move', ability: 'poland_knight_hussar' });
                    } else if (this.board.hasEnemy(newRow, newCol, color)) {
                        moves.push({ row: newRow, col: newCol, type: 'capture', ability: 'poland_knight_hussar' });
                        break;
                    } else {
                        break;
                    }
                }
            }
        }

        // 罗斯突袭：首次移动可横竖移动最多3格
        if (nation === 'rus' && !piece.hasMoved && piece.canUseAbility('rus_knight_raid')) {
            const directions = [[-1, 0], [1, 0], [0, -1], [0, 1]];
            for (const [dr, dc] of directions) {
                for (let i = 1; i <= 3; i++) {
                    const newRow = row + dr * i;
                    const newCol = col + dc * i;

                    if (!this.board.isValidPosition(newRow, newCol)) break;

                    if (this.board.isEmpty(newRow, newCol)) {
                        moves.push({ row: newRow, col: newCol, type: 'move', ability: 'rus_knight_raid' });
                    } else if (this.board.hasEnemy(newRow, newCol, color)) {
                        moves.push({ row: newRow, col: newCol, type: 'capture', ability: 'rus_knight_raid' });
                        break;
                    } else {
                        break;
                    }
                }
            }
        }

        return moves;
    }

    /**
     * 获取象的移动
     */
    getBishopMoves(piece) {
        const moves = [];
        const { row, col, color, nation } = piece;

        // 四个斜向
        const directions = [[-1, -1], [-1, 1], [1, -1], [1, 1]];

        // 中国随军谋士：限制斜向5格
        const maxRange = (nation === 'china') ? 5 : 7;

        for (const [dr, dc] of directions) {
            for (let i = 1; i <= maxRange; i++) {
                const newRow = row + dr * i;
                const newCol = col + dc * i;

                if (!this.board.isValidPosition(newRow, newCol)) break;

                if (this.board.isEmpty(newRow, newCol)) {
                    moves.push({ row: newRow, col: newCol, type: 'move' });
                } else if (this.board.hasEnemy(newRow, newCol, color)) {
                    moves.push({ row: newRow, col: newCol, type: 'capture' });
                    break;
                } else {
                    // 法兰西主教：可跳过一个己方棋子后无限延伸
                    if (nation === 'france' && piece.type === 'bishop') {
                        // 跳过后继续延伸
                        for (let j = 1; ; j++) {
                            const jumpRow = newRow + dr * j;
                            const jumpCol = newCol + dc * j;
                            if (!this.board.isValidPosition(jumpRow, jumpCol)) break;

                            if (this.board.isEmpty(jumpRow, jumpCol)) {
                                moves.push({ row: jumpRow, col: jumpCol, type: 'move', ability: 'france_bishop_blessing' });
                            } else if (this.board.hasEnemy(jumpRow, jumpCol, color)) {
                                moves.push({ row: jumpRow, col: jumpCol, type: 'capture', ability: 'france_bishop_blessing' });
                                break;
                            } else {
                                break; // 遇到第二个友方棋子停止
                            }
                        }
                    }
                    break;
                }
            }
        }

        // 中国随军谋士：增加前后直向1格
        if (nation === 'china') {
            const vertDirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
            for (const [dr, dc] of vertDirs) {
                const newRow = row + dr;
                const newCol = col + dc;

                if (this.board.isValidPosition(newRow, newCol)) {
                    if (this.board.isEmpty(newRow, newCol)) {
                        moves.push({ row: newRow, col: newCol, type: 'move' });
                    } else if (this.board.hasEnemy(newRow, newCol, color)) {
                        moves.push({ row: newRow, col: newCol, type: 'capture' });
                    }
                }
            }
        }

        // 西班牙异端审判：可吃上下左右相邻的子（限2次）
        if (nation === 'spain' && piece.canUseAbility('spain_bishop_heresy')) {
            const orthoDirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
            for (const [dr, dc] of orthoDirs) {
                const newRow = row + dr;
                const newCol = col + dc;
                if (this.board.isValidPosition(newRow, newCol) && this.board.hasEnemy(newRow, newCol, color)) {
                    moves.push({ row: newRow, col: newCol, type: 'capture', ability: 'spain_bishop_heresy' });
                }
            }
        }

        return moves;
    }

    /**
     * 获取后的移动
     */
    getQueenMoves(piece) {
        const { nation, row, col } = piece;
        // 后 = 车 + 象
        let rookMoves = this.getRookMoves(piece);
        let bishopMoves = this.getBishopMoves(piece);

        // 西班牙皇后：限制移动最远5格
        if (nation === 'spain') {
            const maxDist = 5;
            const filterByDistance = (moves) => moves.filter(m => {
                const dist = Math.max(Math.abs(m.row - row), Math.abs(m.col - col));
                return dist <= maxDist;
            });
            rookMoves = filterByDistance(rookMoves);
            bishopMoves = filterByDistance(bishopMoves);
        }

        return [...rookMoves, ...bishopMoves];
    }

    /**
     * 获取王的移动
     */
    getKingMoves(piece) {
        const moves = [];
        const { row, col, color } = piece;

        // 8个方向各移动一格
        const directions = [
            [-1, -1], [-1, 0], [-1, 1],
            [0, -1], [0, 1],
            [1, -1], [1, 0], [1, 1]
        ];

        for (const [dr, dc] of directions) {
            const newRow = row + dr;
            const newCol = col + dc;

            if (!this.board.isValidPosition(newRow, newCol)) continue;

            if (this.board.isEmpty(newRow, newCol)) {
                moves.push({ row: newRow, col: newCol, type: 'move' });
            } else if (this.board.hasEnemy(newRow, newCol, color)) {
                moves.push({ row: newRow, col: newCol, type: 'capture' });
            }
        }

        // 王车易位
        const castlingMoves = this.getCastlingMoves(piece);
        moves.push(...castlingMoves);

        return moves;
    }

    /**
     * 获取王车易位移动
     */
    getCastlingMoves(king) {
        const moves = [];
        const { row, col, color, nation } = king;

        if (king.hasMoved) return moves;
        if (this.isInCheck(color)) return moves;

        const backRow = color === 'white' ? 7 : 0;
        if (row !== backRow) return moves;

        // 短易位（王侧）
        const kingSideRook = this.board.getPiece(backRow, 7);
        if (kingSideRook && kingSideRook.type === 'rook' && !kingSideRook.hasMoved) {
            if (this.isCastlingPathClear(backRow, col, 7, color)) {
                moves.push({ row: backRow, col: 6, type: 'castling', rookFrom: { row: backRow, col: 7 }, rookTo: { row: backRow, col: 5 } });
            }
        }

        // 长易位（后侧）
        const queenSideRook = this.board.getPiece(backRow, 0);
        if (queenSideRook && queenSideRook.type === 'rook' && !queenSideRook.hasMoved) {
            if (this.isCastlingPathClear(backRow, col, 0, color)) {
                moves.push({ row: backRow, col: 2, type: 'castling', rookFrom: { row: backRow, col: 0 }, rookTo: { row: backRow, col: 3 } });
            }
        }

        // 英格兰王车易位Plus：可与任意车易位
        if (nation === 'england' && king.canUseAbility('england_king_castlePlus')) {
            const rooks = this.board.getPiecesByColor(color).filter(p => p.type === 'rook' && !p.hasMoved);
            for (const rook of rooks) {
                // 避免重复添加标准易位
                if ((rook.col === 0 || rook.col === 7) && rook.row === backRow) continue;

                const direction = rook.col > col ? 1 : -1;
                const newKingCol = col + 2 * direction;
                const newRookCol = col + direction;

                if (this.board.isValidPosition(row, newKingCol) && this.board.isEmpty(row, newKingCol)) {
                    moves.push({
                        row: backRow,
                        col: newKingCol,
                        type: 'castling',
                        rookFrom: { row: rook.row, col: rook.col },
                        rookTo: { row: backRow, col: newRookCol },
                        ability: 'england_king_castlePlus'
                    });
                }
            }
        }

        return moves;
    }

    /**
     * 检查易位路径是否畅通且安全
     */
    isCastlingPathClear(row, kingCol, rookCol, color) {
        const start = Math.min(kingCol, rookCol) + 1;
        const end = Math.max(kingCol, rookCol);

        // 检查路径是否为空
        for (let col = start; col < end; col++) {
            if (!this.board.isEmpty(row, col)) return false;
        }

        // 检查王经过的格子是否被攻击
        const direction = rookCol > kingCol ? 1 : -1;
        for (let i = 0; i <= 2; i++) {
            const checkCol = kingCol + i * direction;
            if (this.isSquareAttacked(row, checkCol, color)) return false;
        }

        return true;
    }

    /**
     * 检查移动后是否会被将军
     */
    wouldBeInCheck(piece, toRow, toCol) {
        // 模拟移动
        const originalRow = piece.row;
        const originalCol = piece.col;
        const capturedPiece = this.board.getPiece(toRow, toCol);

        this.board.removePiece(originalRow, originalCol);
        this.board.setPiece(toRow, toCol, piece);

        const inCheck = this.isInCheck(piece.color);

        // 恢复棋盘状态
        this.board.removePiece(toRow, toCol);
        this.board.setPiece(originalRow, originalCol, piece);
        if (capturedPiece) {
            this.board.setPiece(toRow, toCol, capturedPiece);
        }

        return inCheck;
    }

    /**
     * 检查某方是否被将军
     */
    isInCheck(color) {
        const kingPos = this.board.getKingPosition(color);
        if (!kingPos) return false;

        // 奥斯曼苏丹：周围有己方棋子时不能被将军
        const king = this.board.getPiece(kingPos.row, kingPos.col);
        if (king.nation === 'ottoman') {
            const adjacent = this.board.getAdjacentPieces(kingPos.row, kingPos.col);
            const hasAllyAdjacent = adjacent.some(({ piece }) => piece.color === color);
            if (hasAllyAdjacent) return false;
        }

        return this.isSquareAttacked(kingPos.row, kingPos.col, color);
    }

    /**
     * 检查某个格子是否被敌方攻击
     * 注意：此方法直接检查攻击，不调用getLegalMoves以避免递归
     */
    isSquareAttacked(row, col, defenderColor) {
        const attackerColor = defenderColor === 'white' ? 'black' : 'white';

        // 检查敌方兵的攻击
        const pawnDir = attackerColor === 'white' ? 1 : -1;
        const pawnPositions = [
            { row: row + pawnDir, col: col - 1 },
            { row: row + pawnDir, col: col + 1 }
        ];
        for (const pos of pawnPositions) {
            const piece = this.board.getPiece(pos.row, pos.col);
            if (piece && piece.color === attackerColor && piece.type === 'pawn') {
                return true;
            }
        }

        // 检查敌方骑士的攻击
        const knightMoves = [
            [-2, -1], [-2, 1], [-1, -2], [-1, 2],
            [1, -2], [1, 2], [2, -1], [2, 1]
        ];
        for (const [dr, dc] of knightMoves) {
            const piece = this.board.getPiece(row + dr, col + dc);
            if (piece && piece.color === attackerColor && piece.type === 'knight') {
                return true;
            }
        }

        // 检查敌方国王的攻击
        for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
                if (dr === 0 && dc === 0) continue;
                const piece = this.board.getPiece(row + dr, col + dc);
                if (piece && piece.color === attackerColor && piece.type === 'king') {
                    return true;
                }
            }
        }

        // 检查直线攻击（车、后）
        const straightDirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
        for (const [dr, dc] of straightDirs) {
            let r = row + dr, c = col + dc;
            while (this.board.isValidPosition(r, c)) {
                const piece = this.board.getPiece(r, c);
                if (piece) {
                    if (piece.color === attackerColor && (piece.type === 'rook' || piece.type === 'queen')) {
                        return true;
                    }
                    break;
                }
                r += dr;
                c += dc;
            }
        }

        // 检查斜线攻击（象、后）
        const diagDirs = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
        for (const [dr, dc] of diagDirs) {
            let r = row + dr, c = col + dc;
            while (this.board.isValidPosition(r, c)) {
                const piece = this.board.getPiece(r, c);
                if (piece) {
                    if (piece.color === attackerColor && (piece.type === 'bishop' || piece.type === 'queen')) {
                        return true;
                    }
                    break;
                }
                r += dr;
                c += dc;
            }
        }

        return false;
    }

    /**
     * 检查某方是否被将死
     */
    isCheckmate(color) {
        if (!this.isInCheck(color)) return false;

        const pieces = this.board.getPiecesByColor(color);
        for (const piece of pieces) {
            const moves = this.getLegalMoves(piece);
            if (moves.length > 0) return false;
        }

        return true;
    }

    /**
     * 检查是否为僵局
     */
    isStalemate(color) {
        if (this.isInCheck(color)) return false;

        const pieces = this.board.getPiecesByColor(color);
        for (const piece of pieces) {
            const moves = this.getLegalMoves(piece);
            if (moves.length > 0) return false;
        }

        return true;
    }

    /**
     * 检查兵是否可以晋升
     */
    canPromote(piece, toRow) {
        if (piece.type !== 'pawn') return false;
        const promotionRow = piece.color === 'white' ? 0 : 7;
        return toRow === promotionRow;
    }
}
