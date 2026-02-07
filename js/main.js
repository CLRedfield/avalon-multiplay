/**
 * SuperChess - Main Entry Point
 * 游戏主入口
 */

import { UIController } from './ui/UIController.js';

// 等待DOM加载完成
document.addEventListener('DOMContentLoaded', () => {
    try {
        console.log('🎮 SuperChess 正在初始化...');

        // 初始化UI控制器
        const ui = new UIController();
        console.log('✅ UIController 创建成功');

        ui.init();
        console.log('✅ UI 初始化成功');

        // 暴露到全局（用于调试）
        window.superChess = {
            ui,
            engine: ui.engine,
            // 调试函数
            testClick: (row, col) => {
                console.log(`测试点击: (${row}, ${col})`);
                ui.handleCellClick(row, col);
            },
            getLegalMoves: (row, col) => {
                const moves = ui.engine.getLegalMoves(row, col);
                console.log(`合法移动 (${row}, ${col}):`, moves);
                return moves;
            }
        };

        console.log('🎮 SuperChess 已加载！');
        console.log('📜 调试命令:');
        console.log('  - superChess.getLegalMoves(6, 0) // 测试兵的移动');
        console.log('  - superChess.testClick(6, 0) // 测试点击');
    } catch (error) {
        console.error('❌ SuperChess 初始化失败:', error);
    }
});
