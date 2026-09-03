// Personal deductions only. This module has no transport or shared-state access.
const PlayerNotes = {
    scope: null,
    gameId: null,
    marks: {},
    persistent: true,
    judgments: { good: '好人', suspicious: '疑似坏人', evil: '坏人' },

    useGame(broker, roomCode, viewerId, game) {
        if (!roomCode || !viewerId || !game?.gameId) {
            this.scope = null;
            this.gameId = null;
            this.marks = {};
            return;
        }
        const scope = 'avalon_notes_' + JSON.stringify([broker, roomCode, viewerId]);
        if (this.scope === scope && this.gameId === game.gameId) return;
        this.scope = scope;
        this.gameId = game.gameId;
        this.marks = {};
        this.persistent = true;
        try {
            const saved = JSON.parse(localStorage.getItem(scope) || 'null');
            if (saved?.gameId === this.gameId) {
                for (const playerId of game.playerOrder || []) {
                    const mark = this.normalize(saved.marks?.[playerId]);
                    if (mark.roleId || mark.judgment) this.marks[playerId] = mark;
                }
            }
        } catch (error) {
            this.persistent = false;
        }
    },

    normalize(mark) {
        return {
            roleId: Object.values(ROLES).some((role) => role.id === mark?.roleId) ? mark.roleId : '',
            judgment: Object.hasOwn(this.judgments, mark?.judgment) ? mark.judgment : ''
        };
    },

    get(playerId) {
        return this.normalize(this.marks[playerId]);
    },

    set(playerId, value) {
        if (!this.scope || !playerId) return;
        const mark = this.normalize(value);
        if (mark.roleId || mark.judgment) this.marks[playerId] = mark;
        else delete this.marks[playerId];
        this.save();
    },

    clear() {
        this.marks = {};
        this.save();
    },

    save() {
        try {
            localStorage.setItem(this.scope, JSON.stringify({ gameId: this.gameId, marks: this.marks }));
            this.persistent = true;
        } catch (error) {
            this.persistent = false;
        }
    },

    label(playerId) {
        const mark = this.get(playerId);
        return [Object.values(ROLES).find((role) => role.id === mark.roleId)?.name,
            this.judgments[mark.judgment]].filter(Boolean).join(' · ');
    }
};

window.PlayerNotes = PlayerNotes;
