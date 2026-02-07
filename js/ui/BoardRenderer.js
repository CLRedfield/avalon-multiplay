/**
 * SuperChess - Board Renderer
 * 棋盘渲染器 - 负责渲染棋盘和棋子到DOM
 */

import { PIECE_SYMBOLS } from '../data/nations.js';
import { createPieceElement } from './PieceRenderer.js';

export class BoardRenderer {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        this.cells = [];
        this.selectedCell = null;
        this.highlightedCells = [];
        this.lastMoveFrom = null;
        this.lastMoveTo = null;

        // 事件回调
        this.onCellClick = null;
    }

    /**
     * 初始化棋盘DOM
     */
    init() {
        this.container.innerHTML = '';
        this.cells = [];

        for (let row = 0; row < 8; row++) {
            this.cells[row] = [];
            for (let col = 0; col < 8; col++) {
                const cell = document.createElement('div');
                cell.className = 'cell';
                cell.classList.add((row + col) % 2 === 0 ? 'light' : 'dark');
                cell.dataset.row = row;
                cell.dataset.col = col;

                // 添加坐标标签
                const files = 'abcdefgh';
                const ranks = '87654321';

                // 第一列显示行号 (1-8)
                if (col === 0) {
                    const rankLabel = document.createElement('div');
                    rankLabel.className = 'coord-rank';
                    rankLabel.textContent = ranks[row];
                    cell.appendChild(rankLabel);
                }

                // 最后一行显示列号 (a-h)
                if (row === 7) {
                    const fileLabel = document.createElement('div');
                    fileLabel.className = 'coord-file';
                    fileLabel.textContent = files[col];
                    cell.appendChild(fileLabel);
                }

                cell.addEventListener('click', () => this.handleCellClick(row, col));

                this.container.appendChild(cell);
                this.cells[row][col] = cell;
            }
        }
    }

    /**
     * 处理格子点击
     */
    handleCellClick(row, col) {
        if (this.onCellClick) {
            this.onCellClick(row, col);
        }
    }

    /**
     * 渲染棋盘状态
     */
    render(board) {
        for (let row = 0; row < 8; row++) {
            for (let col = 0; col < 8; col++) {
                const cell = this.cells[row][col];
                const piece = board.getPiece(row, col);

                // 清除棋子
                const existingPiece = cell.querySelector('.piece');
                if (existingPiece) {
                    existingPiece.remove();
                }

                // 添加棋子
                if (piece) {
                    const pieceEl = createPieceElement(piece);
                    cell.appendChild(pieceEl);
                }
            }
        }
    }

    /**
     * 创建棋子DOM元素
     */
    createPieceElement(piece) {
        const el = document.createElement('div');
        el.className = 'piece';
        el.classList.add(piece.color);
        el.dataset.type = piece.type;
        el.dataset.nation = piece.nation;
        el.dataset.id = piece.id;
        el.textContent = PIECE_SYMBOLS[piece.color][piece.type];

        // 特殊状态标记
        if (piece.isParalyzed || piece.isBurning) {
            el.classList.add('disabled');
        }
        if (piece.isNeutral) {
            el.classList.add('neutral');
            el.style.opacity = '0.5';
        }
        if (piece.extraLife > 0) {
            el.dataset.value = `+${piece.extraLife} HP`;
        }

        // 检查是否有可用能力
        const hasActiveAbility = Object.values(piece.abilityUses).some(uses => uses > 0);
        if (hasActiveAbility) {
            el.classList.add('has-ability');
        }

        return el;
    }

    /**
     * 选中格子
     */
    selectCell(row, col) {
        this.clearSelection();

        if (row !== null && col !== null) {
            this.selectedCell = { row, col };
            this.cells[row][col].classList.add('selected');
        }
    }

    /**
     * 清除选中状态
     */
    clearSelection() {
        if (this.selectedCell) {
            const { row, col } = this.selectedCell;
            this.cells[row][col].classList.remove('selected');
            this.selectedCell = null;
        }
        this.clearHighlights();
    }

    /**
     * 高亮可移动的格子
     */
    highlightMoves(moves) {
        this.clearHighlights();

        for (const move of moves) {
            const cell = this.cells[move.row][move.col];

            if (move.type === 'move') {
                cell.classList.add('can-move');
            } else if (move.type === 'capture' || move.type === 'enPassant' || move.type === 'cannonCapture') {
                cell.classList.add('can-attack');
            } else if (move.type === 'castling') {
                cell.classList.add('can-move');
            }

            this.highlightedCells.push(cell);
        }
    }

    /**
     * 清除高亮
     */
    clearHighlights() {
        for (const cell of this.highlightedCells) {
            cell.classList.remove('can-move', 'can-attack', 'highlight');
        }
        this.highlightedCells = [];
    }

    /**
     * 标记最后一步移动
     */
    markLastMove(from, to) {
        // 清除之前的标记
        if (this.lastMoveFrom) {
            this.cells[this.lastMoveFrom.row][this.lastMoveFrom.col].classList.remove('last-move');
        }
        if (this.lastMoveTo) {
            this.cells[this.lastMoveTo.row][this.lastMoveTo.col].classList.remove('last-move');
        }

        // 添加新标记
        if (from && to) {
            this.lastMoveFrom = from;
            this.lastMoveTo = to;
            this.cells[from.row][from.col].classList.add('last-move');
            this.cells[to.row][to.col].classList.add('last-move');
        }
    }

    /**
     * 标记被将军的国王
     */
    markCheck(kingPosition) {
        // 清除之前的将军标记
        const checkCells = this.container.querySelectorAll('.check');
        checkCells.forEach(cell => cell.classList.remove('check'));

        if (kingPosition) {
            this.cells[kingPosition.row][kingPosition.col].classList.add('check');
        }
    }

    /**
     * 高亮能力目标
     */
    highlightAbilityTargets(targets) {
        this.clearHighlights();

        for (const target of targets) {
            const cell = this.cells[target.row][target.col];
            cell.classList.add('highlight');
            this.highlightedCells.push(cell);
        }
    }

    /**
     * 播放移动动画
     */
    animateMove(fromRow, fromCol, toRow, toCol) {
        return new Promise(resolve => {
            const fromCell = this.cells[fromRow][fromCol];
            const pieceEl = fromCell.querySelector('.piece');

            if (pieceEl) {
                pieceEl.classList.add('animating');
                setTimeout(() => {
                    pieceEl.classList.remove('animating');
                    resolve();
                }, 300);
            } else {
                resolve();
            }
        });
    }

    /**
     * 播放吃子动画
     */
    animateCapture(row, col) {
        return new Promise(resolve => {
            const cell = this.cells[row][col];
            const pieceEl = cell.querySelector('.piece');

            if (pieceEl) {
                pieceEl.classList.add('capturing');
                setTimeout(() => {
                    resolve();
                }, 300);
            } else {
                resolve();
            }
        });
    }
}
