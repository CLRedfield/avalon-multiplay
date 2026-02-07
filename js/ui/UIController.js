/**
 * SuperChess - UI Controller
 * UI控制器 - 管理所有用户界面交互
 */

import { NATIONS, getNationList, PIECE_SYMBOLS } from '../data/nations.js';
import { getNationAbilities } from '../data/abilities.js';
import { GameEngine } from '../engine/GameEngine.js';
import { BoardRenderer } from './BoardRenderer.js';

export class UIController {
    constructor() {
        this.engine = new GameEngine();
        this.boardRenderer = new BoardRenderer('chess-board');

        // 选择状态
        this.selectedPiece = null;
        this.currentMoves = [];
        this.isAbilityMode = false;
        this.abilityTargets = [];

        // 玩家选择
        this.player1Nation = null;
        this.player2Nation = null;

        // 绑定事件
        this.bindEvents();
    }

    /**
     * 初始化UI
     */
    init() {
        this.showScreen('main-menu');
        this.populateNationGrids();
        this.populateNationsGallery();
    }

    /**
     * 显示指定屏幕
     */
    showScreen(screenId) {
        const screens = document.querySelectorAll('.screen');
        screens.forEach(screen => screen.classList.remove('active'));

        const targetScreen = document.getElementById(screenId);
        if (targetScreen) {
            targetScreen.classList.add('active');
        }
    }

    /**
     * 显示模态框
     */
    showModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.classList.add('active');
        }
    }

    /**
     * 隐藏模态框
     */
    hideModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.classList.remove('active');
        }
    }

    /**
     * 绑定所有事件
     */
    bindEvents() {
        // 主菜单按钮
        document.getElementById('btn-start-game')?.addEventListener('click', () => {
            this.showScreen('nation-select');
        });

        document.getElementById('btn-rules')?.addEventListener('click', () => {
            this.showModal('rules-modal');
        });

        document.getElementById('btn-nations')?.addEventListener('click', () => {
            this.showModal('nations-modal');
            // 重置为列表视图
            if (document.getElementById('nations-list-view')) {
                document.getElementById('nations-list-view').style.display = 'block';
                document.getElementById('nations-detail-view').style.display = 'none';
            }
        });

        // 关闭模态框
        document.getElementById('rules-close')?.addEventListener('click', () => {
            this.hideModal('rules-modal');
        });

        document.getElementById('nations-close')?.addEventListener('click', () => {
            this.hideModal('nations-modal');
        });

        // 国家选择
        document.getElementById('btn-back-menu')?.addEventListener('click', () => {
            this.showScreen('main-menu');
        });

        document.getElementById('btn-confirm-nations')?.addEventListener('click', () => {
            this.startGame();
        });

        // 游戏控制
        document.getElementById('btn-surrender')?.addEventListener('click', () => {
            this.handleSurrender();
        });

        document.getElementById('btn-back-select')?.addEventListener('click', () => {
            this.showScreen('nation-select');
        });

        // 国家图鉴返回按钮
        document.getElementById('btn-back-gallery')?.addEventListener('click', () => {
            document.getElementById('nations-list-view').style.display = 'block';
            document.getElementById('nations-detail-view').style.display = 'none';
        });

        // 游戏结束模态框
        document.getElementById('btn-rematch')?.addEventListener('click', () => {
            this.hideModal('game-over-modal');
            this.startGame();
        });

        document.getElementById('btn-return-menu')?.addEventListener('click', () => {
            this.hideModal('game-over-modal');
            this.showScreen('main-menu');
        });

        // 棋盘点击
        this.boardRenderer.onCellClick = (row, col) => {
            this.handleCellClick(row, col);
        };

        // 游戏事件
        this.engine.on('moveMade', (data) => this.onMoveMade(data));
        this.engine.on('turnChange', (data) => this.onTurnChange(data));
        this.engine.on('gameEnd', (data) => this.onGameEnd(data));
    }

    /**
     * 填充国家选择网格
     */
    populateNationGrids() {
        const nations = getNationList();
        const grid1 = document.getElementById('nation-grid-1');
        const grid2 = document.getElementById('nation-grid-2');

        if (!grid1 || !grid2) return;

        grid1.innerHTML = '';
        grid2.innerHTML = '';

        for (const nation of nations) {
            // 玩家1的卡片
            const card1 = this.createNationCard(nation, 1);
            grid1.appendChild(card1);

            // 玩家2的卡片
            const card2 = this.createNationCard(nation, 2);
            grid2.appendChild(card2);
        }
    }

    /**
     * 创建国家卡片
     */
    createNationCard(nation, player) {
        const card = document.createElement('div');
        card.className = 'nation-card';
        card.dataset.nation = nation.id;
        card.dataset.player = player;

        card.innerHTML = `
            <span class="nation-icon">${nation.icon}</span>
            <span class="nation-name">${nation.name}</span>
        `;

        card.addEventListener('click', () => {
            this.selectNation(nation, player);
        });

        card.addEventListener('mouseenter', () => {
            this.showNationPreview(nation);
        });

        return card;
    }

    /**
     * 选择国家
     */
    selectNation(nation, player) {
        const grid = document.getElementById(`nation-grid-${player}`);

        // 移除其他选中
        grid.querySelectorAll('.nation-card').forEach(card => {
            card.classList.remove('selected');
        });

        // 选中当前
        const card = grid.querySelector(`[data-nation="${nation.id}"]`);
        if (card) {
            card.classList.add('selected');
        }

        if (player === 1) {
            this.player1Nation = nation;
        } else {
            this.player2Nation = nation;
        }

        // 检查是否可以开始
        const confirmBtn = document.getElementById('btn-confirm-nations');
        if (confirmBtn) {
            confirmBtn.disabled = !(this.player1Nation && this.player2Nation);
        }
    }

    /**
     * 显示国家预览
     */
    showNationPreview(nation) {
        const previewName = document.getElementById('preview-name');
        const previewDesc = document.getElementById('preview-desc');
        const previewPieces = document.getElementById('preview-pieces');

        if (previewName) {
            previewName.textContent = `${nation.icon} ${nation.name}`;
        }
        if (previewDesc) {
            previewDesc.innerHTML = `
                <em>"${nation.motto}"</em><br>
                <strong>风格:</strong> ${nation.style}<br>
                <strong>特色:</strong> ${nation.description}
            `;
        }
        if (previewPieces) {
            previewPieces.innerHTML = '';
            const pieceTypes = ['king', 'queen', 'rook', 'bishop', 'knight', 'pawn'];
            for (const type of pieceTypes) {
                const pieceInfo = nation.pieces[type];
                const pieceEl = document.createElement('span');
                pieceEl.className = 'preview-piece';
                pieceEl.innerHTML = `${PIECE_SYMBOLS.white[type]} ${pieceInfo.name}`;
                pieceEl.title = pieceInfo.localName;
                previewPieces.appendChild(pieceEl);
            }
        }
    }

    /**
     * 填充国家图鉴
     */
    populateNationsGallery() {
        const gallery = document.getElementById('nations-gallery');
        if (!gallery) return;

        gallery.innerHTML = '';
        const nations = getNationList();

        for (const nation of nations) {
            const card = document.createElement('div');
            card.className = 'nation-gallery-card';
            card.style.cursor = 'pointer'; // 明确可点击
            card.innerHTML = `
                <div class="header">
                    <span class="icon">${nation.icon}</span>
                    <div>
                        <div class="name">${nation.name}</div>
                        <div class="desc">"${nation.motto}"</div>
                    </div>
                </div>
                <div class="style"><strong>风格:</strong> ${nation.style}</div>
                <div class="ratings">
                    <span>进攻: ${'⭐'.repeat(nation.ratings.attack)}</span>
                    <span>防守: ${'⭐'.repeat(nation.ratings.defense)}</span>
                </div>
                <div class="hint" style="font-size: 0.8rem; color: var(--color-primary); margin-top: 0.5rem; text-align: right;">👉 点击查看详情</div>
            `;

            // 点击查看详情
            card.onclick = () => this.showNationDetail(nation);

            gallery.appendChild(card);
        }
    }

    /**
     * 显示国家详情
     */
    showNationDetail(nation) {
        // 切换视图
        document.getElementById('nations-list-view').style.display = 'none';
        document.getElementById('nations-detail-view').style.display = 'block';

        // 设置标题
        document.getElementById('gallery-detail-title').innerHTML = `${nation.icon} ${nation.name}`;

        // 填充内容
        const container = document.getElementById('nation-detail-content');
        container.innerHTML = '';

        // 基本信息
        const infoDiv = document.createElement('div');
        infoDiv.className = 'nation-detail-info';
        infoDiv.style.marginBottom = '1.5rem';
        infoDiv.innerHTML = `
            <div style="font-size: 1.1rem; color: var(--text-secondary); margin-bottom: 0.5rem;"><em>"${nation.motto}"</em></div>
            <div style="margin-bottom: 0.5rem;"><strong>风格:</strong> ${nation.style}</div>
            <div style="margin-bottom: 1rem;">${nation.description}</div>
            <div class="ratings" style="display: flex; gap: 1rem;">
                <span>⚔️ 进攻: ${'⭐'.repeat(nation.ratings.attack)}</span>
                <span>🛡️ 防守: ${'⭐'.repeat(nation.ratings.defense)}</span>
            </div>
        `;
        container.appendChild(infoDiv);

        // 技能列表
        const abilitiesHeader = document.createElement('h3');
        abilitiesHeader.textContent = '🛡️ 特色兵种与技能';
        abilitiesHeader.style.color = 'var(--color-primary)';
        abilitiesHeader.style.borderBottom = '1px solid rgba(201, 162, 39, 0.3)';
        abilitiesHeader.style.paddingBottom = '0.5rem';
        abilitiesHeader.style.marginBottom = '1rem';
        container.appendChild(abilitiesHeader);

        const abilitiesList = document.createElement('div');
        abilitiesList.className = 'abilities-grid';
        abilitiesList.style.display = 'grid';
        abilitiesList.style.gridTemplateColumns = 'repeat(auto-fill, minmax(280px, 1fr))';
        abilitiesList.style.gap = '1rem';

        const abilities = getNationAbilities(nation.id);
        const pieceNames = {
            king: '👑 国王',
            queen: '👸 皇后',
            rook: '🏰 车',
            bishop: '⛪ 象',
            knight: '🐴 马',
            pawn: '⚔️ 兵'
        };

        for (const ability of abilities) {
            const item = document.createElement('div');
            item.className = 'ability-item';
            item.style.height = '100%'; // 使卡片高度一致
            item.innerHTML = `
                <div class="piece-type" style="font-size: 1rem; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 0.3rem;">
                    ${pieceNames[ability.piece] || ability.piece} <span style="font-size: 0.8rem; opacity: 0.8;">- ${ability.name}</span>
                </div>
                <div class="ability-desc" style="margin-top: 0.5rem; font-size: 0.9rem;">${ability.description}</div>
            `;
            abilitiesList.appendChild(item);
        }

        container.appendChild(abilitiesList);
    }

    /**
     * 开始游戏
     */
    startGame() {
        if (!this.player1Nation || !this.player2Nation) return;

        // 设置玩家国家
        this.engine.setPlayerNation('white', this.player1Nation.id);
        this.engine.setPlayerNation('black', this.player2Nation.id);

        // 初始化游戏
        const result = this.engine.initGame();
        if (!result.success) {
            alert(result.error);
            return;
        }

        // 初始化棋盘渲染
        this.boardRenderer.init();
        this.boardRenderer.render(this.engine.board);

        // 设置玩家信息
        this.updatePlayerInfo();

        // 显示游戏界面
        this.showScreen('game-screen');

        // 更新状态显示
        this.updateGameStatus();
        this.updateAbilityPanel();
        this.updateNationAbilitiesList();
    }

    /**
     * 更新玩家信息显示
     */
    updatePlayerInfo() {
        // 玩家1（白方）
        const player1Flag = document.getElementById('player1-flag');
        const player1Nation = document.getElementById('player1-nation');
        if (player1Flag) player1Flag.textContent = this.player1Nation.icon;
        if (player1Nation) player1Nation.textContent = this.player1Nation.name;

        const player1Info = document.getElementById('player1-info');
        if (player1Info) player1Info.dataset.nation = this.player1Nation.id;

        // 玩家2（黑方）
        const player2Flag = document.getElementById('player2-flag');
        const player2Nation = document.getElementById('player2-nation');
        if (player2Flag) player2Flag.textContent = this.player2Nation.icon;
        if (player2Nation) player2Nation.textContent = this.player2Nation.name;

        const player2Info = document.getElementById('player2-info');
        if (player2Info) player2Info.dataset.nation = this.player2Nation.id;
    }

    /**
     * 更新国家特色技能列表
     */
    updateNationAbilitiesList() {
        const list = document.getElementById('nation-abilities-list');
        if (!list) return;

        list.innerHTML = '';

        // 显示当前回合玩家的国家技能
        const currentNation = this.engine.currentTurn === 'white'
            ? this.player1Nation
            : this.player2Nation;

        if (!currentNation) return;

        const abilities = getNationAbilities(currentNation.id);
        const pieceNames = {
            king: '👑 国王',
            queen: '👸 皇后',
            rook: '🏰 车',
            bishop: '⛪ 象',
            knight: '🐴 马',
            pawn: '⚔️ 兵'
        };

        for (const ability of abilities) {
            const item = document.createElement('div');
            item.className = 'ability-item';
            item.innerHTML = `
                <div class="piece-type">${pieceNames[ability.piece] || ability.piece}</div>
                <div class="ability-name">【${ability.name}】</div>
                <div class="ability-desc">${ability.description}</div>
            `;
            list.appendChild(item);
        }
    }

    /**
     * 处理格子点击
     */
    handleCellClick(row, col) {
        console.log(`[DEBUG] handleCellClick: (${row}, ${col}), gameState: ${this.engine.gameState}`);
        if (this.engine.gameState !== 'playing') return;

        // 能力模式
        if (this.isAbilityMode) {
            const isValidTarget = this.abilityTargets.some(t => t.row === row && t.col === col);
            if (isValidTarget) {
                this.executeAbility(row, col);
            } else {
                this.cancelAbilityMode();
            }
            return;
        }

        const piece = this.engine.board.getPiece(row, col);

        // 如果已选中棋子
        if (this.selectedPiece) {
            // 检查是否点击可移动位置
            const move = this.currentMoves.find(m => m.row === row && m.col === col);

            if (move) {
                this.makeMove(this.selectedPiece.row, this.selectedPiece.col, row, col);
            } else if (piece && piece.color === this.engine.currentTurn) {
                // 选择新棋子
                this.selectPiece(row, col);
            } else {
                // 取消选择
                this.deselectPiece();
            }
        } else {
            // 选择棋子
            if (piece && piece.color === this.engine.currentTurn) {
                this.selectPiece(row, col);
            }
        }
    }

    /**
     * 选择棋子
     */
    selectPiece(row, col) {
        const piece = this.engine.board.getPiece(row, col);
        console.log(`[DEBUG] selectPiece: (${row}, ${col}), piece:`, piece);
        if (!piece) return;

        this.selectedPiece = { row, col, piece };
        this.currentMoves = this.engine.getLegalMoves(row, col);
        console.log(`[DEBUG] currentMoves:`, this.currentMoves);

        this.boardRenderer.selectCell(row, col);
        this.boardRenderer.highlightMoves(this.currentMoves);
    }

    /**
     * 取消选择
     */
    deselectPiece() {
        this.selectedPiece = null;
        this.currentMoves = [];
        this.boardRenderer.clearSelection();
    }

    /**
     * 执行移动
     */
    makeMove(fromRow, fromCol, toRow, toCol) {
        // 检查是否需要晋升
        const piece = this.engine.board.getPiece(fromRow, fromCol);
        let promotionType = null;

        if (piece.type === 'pawn') {
            const promotionRow = piece.color === 'white' ? 0 : 7;
            if (toRow === promotionRow) {
                promotionType = this.showPromotionDialog();
            }
        }

        const result = this.engine.makeMove(fromRow, fromCol, toRow, toCol, promotionType);

        if (result.success) {
            this.deselectPiece();
            this.boardRenderer.render(this.engine.board);
            this.boardRenderer.markLastMove({ row: fromRow, col: fromCol }, { row: toRow, col: toCol });
            this.updateMoveHistory();
            this.updateCapturedPieces();
        } else {
            console.error('移动失败:', result.error);
        }
    }

    /**
     * 显示晋升对话框
     */
    showPromotionDialog() {
        // 简化处理，默认晋升为皇后
        // TODO: 实现完整的晋升选择UI
        return 'queen';
    }

    /**
     * 移动完成回调
     */
    onMoveMade(data) {
        // 可以添加音效等
    }

    /**
     * 回合切换回调
     */
    onTurnChange(data) {
        this.updateGameStatus();
        this.updateAbilityPanel();
        this.updateActivePlayer();
        this.updateNationAbilitiesList();

        // 检查将军
        if (this.engine.moveValidator.isInCheck(data.currentTurn)) {
            const kingPos = this.engine.board.getKingPosition(data.currentTurn);
            this.boardRenderer.markCheck(kingPos);
        } else {
            this.boardRenderer.markCheck(null);
        }
    }

    /**
     * 更新游戏状态显示
     */
    updateGameStatus() {
        const statusEl = document.getElementById('game-status');
        if (!statusEl) return;

        const state = this.engine.getGameState();
        let statusText = state.currentTurn === 'white' ? '白方回合' : '黑方回合';

        if (state.isCheck) {
            statusText += ' - 将军!';
        }

        statusEl.textContent = statusText;
    }

    /**
     * 更新当前玩家高亮
     */
    updateActivePlayer() {
        const player1Info = document.getElementById('player1-info');
        const player2Info = document.getElementById('player2-info');

        if (player1Info) {
            player1Info.classList.toggle('active', this.engine.currentTurn === 'white');
        }
        if (player2Info) {
            player2Info.classList.toggle('active', this.engine.currentTurn === 'black');
        }
    }

    /**
     * 更新能力面板
     */
    updateAbilityPanel() {
        const abilityList = document.getElementById('ability-list');
        if (!abilityList) return;

        abilityList.innerHTML = '';

        const abilities = this.engine.getAvailableAbilities();

        if (abilities.length === 0) {
            abilityList.innerHTML = '<p style="color: var(--text-muted); font-size: 0.85rem;">无可用能力</p>';
            return;
        }

        for (const ability of abilities) {
            const btn = document.createElement('button');
            btn.className = 'ability-btn';
            btn.dataset.nation = ability.nation;
            btn.innerHTML = `
                <span>${ability.name}</span>
                <span class="uses">(${ability.pieces.length})</span>
            `;
            btn.title = ability.description;

            btn.addEventListener('click', () => {
                this.activateAbility(ability.id, ability.pieces[0].id);
            });

            abilityList.appendChild(btn);
        }
    }

    /**
     * 激活能力
     */
    activateAbility(abilityId, pieceId) {
        const result = this.engine.activateAbility(abilityId, pieceId);

        if (result.success && result.needsTarget) {
            this.isAbilityMode = true;
            this.abilityTargets = result.targets;
            this.boardRenderer.highlightAbilityTargets(result.targets);
        } else if (result.success) {
            // 能力直接执行
            this.boardRenderer.render(this.engine.board);
        } else {
            console.error('能力激活失败:', result.error);
        }
    }

    /**
     * 执行能力
     */
    executeAbility(row, col) {
        const result = this.engine.executeAbility(row, col);

        if (result.success) {
            this.cancelAbilityMode();
            this.boardRenderer.render(this.engine.board);
        } else {
            console.error('能力执行失败:', result.error);
        }
    }

    /**
     * 取消能力模式
     */
    cancelAbilityMode() {
        this.isAbilityMode = false;
        this.abilityTargets = [];
        this.engine.cancelAbility();
        this.boardRenderer.clearHighlights();
    }

    /**
     * 更新移动历史
     */
    updateMoveHistory() {
        const moveList = document.getElementById('move-list');
        if (!moveList) return;

        moveList.innerHTML = '';

        for (const move of this.engine.moveHistory) {
            const entry = document.createElement('div');
            entry.className = 'move-entry';
            entry.innerHTML = `
                <span class="move-number">${move.number}.</span>
                <span class="move-white">${move.white || ''}</span>
                <span class="move-black">${move.black || ''}</span>
            `;
            moveList.appendChild(entry);
        }

        // 滚动到底部
        moveList.scrollTop = moveList.scrollHeight;
    }

    /**
     * 更新被吃棋子显示
     */
    updateCapturedPieces() {
        // 白方被吃的棋子显示在玩家2区域
        const player1Captured = document.getElementById('player1-captured');
        const player2Captured = document.getElementById('player2-captured');

        if (player1Captured) {
            player1Captured.innerHTML = '';
            for (const piece of this.engine.capturedPieces.white) {
                const span = document.createElement('span');
                span.className = `captured-piece ${piece.color}`;
                span.textContent = PIECE_SYMBOLS[piece.color][piece.type];
                player1Captured.appendChild(span);
            }
        }

        if (player2Captured) {
            player2Captured.innerHTML = '';
            for (const piece of this.engine.capturedPieces.black) {
                const span = document.createElement('span');
                span.className = `captured-piece ${piece.color}`;
                span.textContent = PIECE_SYMBOLS[piece.color][piece.type];
                player2Captured.appendChild(span);
            }
        }
    }

    /**
     * 处理认输
     */
    handleSurrender() {
        if (confirm(`确定要认输吗？`)) {
            this.engine.resign(this.engine.currentTurn);
        }
    }

    /**
     * 游戏结束回调
     */
    onGameEnd(data) {
        const modal = document.getElementById('game-over-modal');
        const title = document.getElementById('game-over-title');
        const message = document.getElementById('game-over-message');

        if (title && message) {
            if (data.winner) {
                const winnerNation = data.winner === 'white' ? this.player1Nation : this.player2Nation;
                title.textContent = `${winnerNation.icon} ${winnerNation.name} 获胜!`;

                switch (data.reason) {
                    case 'checkmate':
                        message.textContent = '将杀！对方国王无处可逃。';
                        break;
                    case 'resignation':
                        message.textContent = '对方认输。';
                        break;
                    default:
                        message.textContent = '游戏结束。';
                }
            } else {
                title.textContent = '和棋';
                switch (data.reason) {
                    case 'stalemate':
                        message.textContent = '僵局，无合法移动。';
                        break;
                    default:
                        message.textContent = '双方和棋。';
                }
            }
        }

        this.showModal('game-over-modal');
    }
}
