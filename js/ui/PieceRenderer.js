/**
 * SuperChess - Piece Renderer
 * SVG棋子渲染器 - 为每个国家创建独特的棋子外观
 */

// 国家主题色
const NATION_COLORS = {
    france: { primary: '#1e3a8a', accent: '#fbbf24' },
    england: { primary: '#dc2626', accent: '#ffffff' },
    holyroman: { primary: '#111827', accent: '#fbbf24' },
    china: { primary: '#dc2626', accent: '#fbbf24' },
    japan: { primary: '#111827', accent: '#dc2626' },
    ottoman: { primary: '#16a34a', accent: '#fbbf24' },
    mongol: { primary: '#0284c7', accent: '#fbbf24' },
    byzantine: { primary: '#7c3aed', accent: '#fbbf24' },
    spain: { primary: '#ea580c', accent: '#fbbf24' },
    poland: { primary: '#dc2626', accent: '#ffffff' },
    rus: { primary: '#16a34a', accent: '#fbbf24' }
};

// 棋子SVG模板
const PIECE_SVGS = {
    // 国王 - 各国有不同的王冠设计
    king: {
        france: `<path d="M20 35h20v3H20zm2-3h16l2-8h-20zm8-10l4-12 4 12h-8zm-6 0h4l-2-8-2 8zm12 0h4l2-8-4 8z"/>`,
        england: `<path d="M20 35h20v3H20zm3-3h14l2-6H21zm6-8h8l-4-14-4 14zm-4 2l2-6h-4l2 6zm12 0l2 6h-4l2-6z"/>`,
        holyroman: `<path d="M20 35h20v3H20zm2-3h16l1-5H21zm7-7h6l-3-12-3 12zm-5 2l1-4h-3l2 4zm14 0l-1-4h3l-2 4z"/><circle cx="30" cy="13" r="3"/>`,
        china: `<path d="M22 35h16v3H22zm0-3h16l2-7H20zm6-9h8l-4-10-4 10z"/><path d="M25 23h10v2H25z"/>`,
        japan: `<path d="M21 35h18v3H21zm1-3h16l1-6H21zm5-8h10l-5-12-5 12z"/><circle cx="30" cy="22" r="2"/>`,
        ottoman: `<path d="M20 35h20v3H20zm2-3h16l1-5H21zm8-7c5 0 8-4 8-8 0-5-4-8-8-8s-8 3-8 8c0 4 3 8 8 8z"/>`,
        mongol: `<path d="M23 35h14v3H23zm-1-3h16l2-8H20zm8-10l6-12 2 6-4 6H26l-4-6 2-6z"/>`,
        byzantine: `<path d="M20 35h20v3H20zm3-3h14l1-4H22zm7-6h6l-3-14-3 14z"/><path d="M24 17l6-5 6 5"/>`,
        spain: `<path d="M20 35h20v3H20zm3-3h14l1-5H22zm4-7h10l-2-6h-6zm3-8l2-6 2 6h-4z"/>`,
        poland: `<path d="M20 35h20v3H20zm2-3h16l2-7H20zm6-9h8c0-6-2-10-4-12-2 2-4 6-4 12z"/>`,
        rus: `<path d="M22 35h16v3H22zm0-3h16l1-5H21zm6-7h8l-4-10-4 10z"/><path d="M27 10l3-5 3 5"/>`,
    },

    // 皇后 - 各国有不同的冠冕
    queen: {
        france: `<path d="M22 35h16v3H22zm-2-3h20l-3-10-4 6-3-8-3 8-4-6z"/>`,
        england: `<path d="M22 35h16v3H22zm-2-3h20l-2-8-5 4-3-10-3 10-5-4z"/>`,
        holyroman: `<path d="M22 35h16v3H22zm-1-3h18l-2-7-4 3-3-10-3 10-4-3z"/><circle cx="30" cy="15" r="2"/>`,
        china: `<path d="M22 35h16v3H22zm0-3h16l-2-8-3 4-3-8-3 8-3-4z"/>`,
        japan: `<path d="M22 35h16v3H22zm-1-3h18l-3-12-3 6-3-6-3 6z"/>`,
        ottoman: `<path d="M22 35h16v3H22zm-1-3h18c-2-4-4-10-8-10s-6 6-8 10z"/>`,
        mongol: `<path d="M23 35h14v3H23zm-2-3h18l-2-6-4 2-3-10-3 10-4-2z"/>`,
        byzantine: `<path d="M22 35h16v3H22zm-1-3h18l-3-8-3 4-3-10-3 10-3-4z"/>`,
        spain: `<path d="M22 35h16v3H22zm-2-3h20l-2-6-4 2-4-12-4 12-4-2z"/>`,
        poland: `<path d="M22 35h16v3H22zm-1-3h18l-3-10-3 5-3-8-3 8-3-5z"/>`,
        rus: `<path d="M23 35h14v3H23zm-2-3h18l-2-8-4 4-3-10-3 10-4-4z"/>`,
    },

    // 车 - 堡塔/城墙设计
    rook: {
        france: `<path d="M22 35h16v3H22zm1-3h14v-4H23zm0-6h14v-6l-2 2h-3v-4h-4v4h-3l-2-2z"/>`,
        england: `<path d="M22 35h16v3H22zm2-3h12v-5H24zm-2-7h16v-5l-3 2h-2v-5h-4v5h-2l-3-2z"/>`,
        holyroman: `<path d="M23 35h14v3H23zm1-3h12v-6H24zm-2-8h16v-4l-2 1h-3v-4h-6v4h-3l-2-1z"/>`,
        china: `<path d="M24 35h12v3H24zm0-3h12v-8H24zm-2-10h16v-4H22z"/>`,
        japan: `<path d="M23 35h14v3H23zm1-3h12v-7c-2-2-4-3-6-3s-4 1-6 3z"/>`,
        ottoman: `<path d="M22 35h16v3H22zm2-3h12v-6H24zm-2-8h16l-1-6h-4v-3h-4v3h-4z"/>`,
        mongol: `<path d="M24 35h12v3H24zm0-3h12l2-10H22z"/>`,
        byzantine: `<path d="M22 35h16v3H22zm1-3h14v-6H23zm-1-8h16l-2-6h-2v-3h-8v3h-2z"/>`,
        spain: `<path d="M22 35h16v3H22zm2-3h12v-5H24zm-2-7h16v-6l-2 2h-4v-4h-4v4h-4l-2-2z"/>`,
        poland: `<path d="M23 35h14v3H23zm0-3h14v-5H23zm-1-7h16l-2-7h-3v-2h-6v2h-3z"/>`,
        rus: `<path d="M22 35h16v3H22zm2-3h12v-8c0-4-3-6-6-6s-6 2-6 6z"/>`,
    },

    // 象 - 主教/宗教符号
    bishop: {
        france: `<path d="M24 35h12v3H24zm-2-3h16l-3-10c0-6-2-10-5-12-3 2-5 6-5 12z"/><path d="M28 16h4v2h-4z"/>`,
        england: `<path d="M24 35h12v3H24zm-1-3h14l-4-14c-1-4-3-6-4-6s-3 2-4 6z"/><circle cx="30" cy="16" r="2"/>`,
        holyroman: `<path d="M24 35h12v3H24zm-1-3h14l-4-12c0-5-2-10-4-10s-4 5-4 10z"/><path d="M28 14h4M30 12v4"/>`,
        china: `<path d="M26 35h8v3h-8zm-3-3h14l-2-8-3 2-2-14-2 14-3-2z"/>`,
        japan: `<path d="M25 35h10v3H25zm-2-3h14c-1-8-3-14-5-20-2 6-4 12-5 20z"/>`,
        ottoman: `<path d="M24 35h12v3H24zm-1-3h14c-2-8-4-14-6-20-2 6-4 12-6 20z"/><path d="M27 15c2-3 4-3 6 0"/>`,
        mongol: `<path d="M25 35h10v3H25zm-2-3h14l-3-12-2 4-2-16-2 16-2-4z"/>`,
        byzantine: `<path d="M24 35h12v3H24zm-1-3h14l-4-14c-1-4-2-8-4-8s-3 4-4 8z"/><path d="M27 12h6M30 10v4"/>`,
        spain: `<path d="M24 35h12v3H24zm-2-3h16l-4-12c-1-5-3-10-5-10s-4 5-5 10z"/><path d="M28 14h4M30 12v4"/>`,
        poland: `<path d="M25 35h10v3H25zm-2-3h14l-3-10c-1-6-3-12-5-12s-4 6-5 12z"/>`,
        rus: `<path d="M24 35h12v3H24zm-1-3h14c-2-10-4-16-6-22-2 6-4 12-6 22z"/><path d="M28 12c2-4 4-4 6 0"/>`,
    },

    // 马 - 骑士马头
    knight: {
        france: `<path d="M22 35h16v3H22zm2-3h12l2-10c-4-2-6-6-6-10 0 3-4 5-8 8v4l-2 4z"/>`,
        england: `<path d="M22 35h16v3H22zm3-3h11l1-8c-3-2-5-5-5-10-2 4-6 6-9 8v6z"/>`,
        holyroman: `<path d="M22 35h16v3H22zm2-3h13l2-12c-5-2-7-5-7-8 0 2-5 4-10 8v8z"/>`,
        china: `<path d="M24 35h12v3H24zm0-3h12c2-6-2-12-4-14 0 4-4 6-8 10z"/>`,
        japan: `<path d="M23 35h14v3H23zm1-3h13c2-8-3-14-5-16 0 4-4 7-10 10z"/>`,
        ottoman: `<path d="M22 35h16v3H22zm3-3h11c3-8-2-14-4-18 0 6-4 10-9 12z"/>`,
        mongol: `<path d="M23 35h14v3H23zm2-3h11c2-6 0-12-3-16 0 4-4 8-10 10z"/>`,
        byzantine: `<path d="M22 35h16v3H22zm2-3h13c3-10-2-16-5-18 0 4-4 10-10 12z"/>`,
        spain: `<path d="M22 35h16v3H22zm3-3h11c2-6-1-14-4-16 0 4-4 8-9 10z"/>`,
        poland: `<path d="M22 35h16v3H22zm2-3h13c3-8-1-16-5-18 0 4-4 10-10 12z"/>`,
        rus: `<path d="M23 35h14v3H23zm2-3h11c2-6-2-12-4-16 0 4-4 8-9 10z"/>`,
    },

    // 兵 - 步兵设计
    pawn: {
        france: `<path d="M26 35h8v3h-8zm-2-3h12l-1-6h-10zm3-8h6c0-4-1-6-3-8-2 2-3 4-3 8z"/>`,
        england: `<path d="M26 35h8v3h-8zm-2-3h12l-2-8h-8zm4-10h4c0-3-1-5-2-6-1 1-2 3-2 6z"/>`,
        holyroman: `<path d="M26 35h8v3h-8zm-3-3h14l-2-8h-10zm4-10h6c0-3-2-6-3-6s-3 3-3 6z"/>`,
        china: `<path d="M27 35h6v3h-6zm-2-3h10l-1-5h-8zm2-7h6c0-3-1-5-3-7-2 2-3 4-3 7z"/>`,
        japan: `<path d="M26 35h8v3h-8zm-1-3h10l-1-5h-8zm2-7h6l-3-8-3 8z"/>`,
        ottoman: `<path d="M26 35h8v3h-8zm-2-3h12l-2-7h-8zm4-9h4l-2-6-2 6z"/>`,
        mongol: `<path d="M27 35h6v3h-6zm-2-3h10l-2-7h-6zm3-9h4l-2-5-2 5z"/>`,
        byzantine: `<path d="M26 35h8v3h-8zm-2-3h12l-1-6h-10zm3-8h6c0-4-2-6-3-8-1 2-3 4-3 8z"/>`,
        spain: `<path d="M26 35h8v3h-8zm-2-3h12l-2-8h-8zm4-10h4c0-3-1-5-2-6-1 1-2 3-2 6z"/>`,
        poland: `<path d="M26 35h8v3h-8zm-2-3h12l-1-6h-10zm3-8h6l-3-7-3 7z"/>`,
        rus: `<path d="M27 35h6v3h-6zm-3-3h12l-2-8h-8zm4-10h4c0-3-1-6-2-6s-2 3-2 6z"/>`,
    }
};

/**
 * 生成棋子SVG
 */
export function createPieceSVG(type, color, nation) {
    const nationColors = NATION_COLORS[nation] || { primary: '#6b7280', accent: '#ffffff' };
    const svgPath = PIECE_SVGS[type]?.[nation] || PIECE_SVGS[type]?.france || '';

    const fillColor = color === 'white' ? '#ffffff' : '#1f2937';
    const strokeColor = color === 'white' ? nationColors.primary : nationColors.accent;

    return `
        <svg viewBox="0 0 60 45" xmlns="http://www.w3.org/2000/svg">
            <g fill="${fillColor}" stroke="${strokeColor}" stroke-width="1.5">
                ${svgPath}
            </g>
        </svg>
    `;
}

/**
 * 获取棋子HTML元素
 */
export function createPieceElement(piece) {
    const el = document.createElement('div');
    el.className = 'piece piece-svg';
    el.classList.add(piece.color);
    el.dataset.type = piece.type;
    el.dataset.nation = piece.nation;
    el.dataset.id = piece.id;

    el.innerHTML = createPieceSVG(piece.type, piece.color, piece.nation);

    // 特殊状态标记
    if (piece.isParalyzed || piece.isBurning) {
        el.classList.add('disabled');
    }
    if (piece.isNeutral) {
        el.classList.add('neutral');
    }
    if (piece.extraLife > 0) {
        const badge = document.createElement('span');
        badge.className = 'life-badge';
        badge.textContent = `+${piece.extraLife}`;
        el.appendChild(badge);
    }

    return el;
}
