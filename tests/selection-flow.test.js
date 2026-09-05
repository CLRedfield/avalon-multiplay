const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const clone = (value) => JSON.parse(JSON.stringify(value));
const source = (file) => fs.readFileSync(path.join(__dirname, '..', 'js', file), 'utf8');

function fixture(phase = 'selectTeam') {
    let secrets = { gameId: 'game-1', roles: {}, missionHistory: {} };
    const calls = [];
    const database = {
        registerActionHandler() {},
        onPrivateMessage() {},
        getHostSecrets: () => secrets,
        setHostSecrets: (value) => { secrets = value; },
        publishPrivate: async () => {},
        sendAction: async (action, payload) => { calls.push({ action, payload: clone(payload) }); }
    };
    const context = vm.createContext({ console, window: {}, database });
    for (const file of ['roles.js', 'rules-config.js', 'room-manager.js', 'game.js', 'game-expansion.js', 'ui.js']) vm.runInContext(source(file), context);
    const { GameManager: gameManager, RoomManager: roomManager, UI: ui } = context.window;
    const players = Object.fromEntries([3, 1, 5, 2, 4].map((n) => [
        'p' + n, { name: String(n), joinedAt: n * 100, connected: true }
    ]));
    const game = {
        gameId: 'game-1', phase, selectionRevision: 1,
        playerOrder: ['p1', 'p2', 'p3', 'p4', 'p5'], captainIndex: 0,
        currentMission: 0, rejectCount: 0, selectedTeam: [], exileTarget: null,
        exiledPlayers: [], votes: {}, missionResults: [null, null, null, null, null]
    };
    const room = { state: 'playing', host: 'p1', game, players };
    roomManager.playerId = 'p1';
    roomManager.currentRoom = 'TEST';
    gameManager.players = players;
    gameManager.gameData = game;
    const handle = (action, payload, senderPlayerId = 'p1') => gameManager.handleAuthoritativeAction({
        action, payload, senderPlayerId, room
    });
    const payload = (extra) => ({ gameId: game.gameId, selectionRevision: game.selectionRevision, ...extra });
    return { context, database, calls, gameManager, roomManager, ui, players, game, room, handle, payload };
}

test('rapid selection toggles are local, immediate, bounded, and do not change canonical state', () => {
    const { gameManager: gm, game, calls, context } = fixture();
    let renders = 0;
    context.window.onSelectionDraftChange = () => renders++;
    gm.selectTeamMember('p3');
    gm.selectTeamMember('p1');
    gm.selectTeamMember('p4'); // Full team: must not add a third player.
    assert.deepEqual(clone(gm.getSelectionView().selectedTeam), ['p3', 'p1']);
    gm.selectTeamMember('p3');
    gm.selectTeamMember('p2');
    assert.deepEqual(clone(gm.getSelectionView().selectedTeam), ['p1', 'p2']);
    assert.equal(renders, 5);
    assert.deepEqual(game.selectedTeam, []);
    assert.equal(calls.length, 0);
});

test('one confirmation sends the entire team, blocks double submits and locks edits while pending', async () => {
    const { gameManager: gm, database, calls, payload } = fixture();
    let resolve;
    database.sendAction = (action, value) => {
        calls.push({ action, payload: clone(value) });
        return new Promise((done) => { resolve = done; });
    };
    gm.selectTeamMember('p2');
    gm.selectTeamMember('p1');
    const pending = gm.confirmTeamForVote();
    assert.equal(gm.selectionDraft.submitting, true);
    await gm.confirmTeamForVote();
    gm.selectTeamMember('p1');
    assert.deepEqual(clone(gm.selectionDraft.team), ['p2', 'p1']);
    assert.deepEqual(calls, [{ action: 'confirmTeam', payload: payload({ selectedTeam: ['p2', 'p1'] }) }]);
    resolve({ ok: true });
    await pending;
    assert.equal(gm.selectionDraft.submitting, false);
});

test('failed confirmation preserves local choices and allows retry', async () => {
    const { gameManager: gm, database } = fixture();
    gm.selectTeamMember('p1');
    gm.selectTeamMember('p2');
    database.sendAction = async () => { throw new Error('network timeout'); };
    await assert.rejects(gm.confirmTeamForVote(), /network timeout/);
    assert.equal(gm.selectionDraft.submitting, false);
    assert.deepEqual(clone(gm.selectionDraft.team), ['p1', 'p2']);
    let retries = 0;
    database.sendAction = async () => { retries++; };
    await gm.confirmTeamForVote();
    assert.equal(retries, 1);
});

test('incomplete teams and non-captains never submit or edit a local proposal', async () => {
    const { gameManager: gm, roomManager, calls } = fixture();
    gm.selectTeamMember('p1');
    await gm.confirmTeamForVote();
    assert.equal(calls.length, 0);
    roomManager.playerId = 'p2';
    gm.selectTeamMember('p2');
    await gm.confirmTeamForVote();
    assert.equal(gm.selectionDraft, null);
    assert.equal(calls.length, 0);
});

test('unrelated snapshots retain the draft, but phase, round, captain, game and room changes clear it', () => {
    for (const change of [
        (f) => { f.game.phase = 'vote'; },
        (f) => { f.game.selectionRevision++; },
        (f) => { f.game.captainIndex++; },
        (f) => { f.game.gameId = 'game-2'; },
        (f) => { f.roomManager.currentRoom = 'NEW'; }
    ]) {
        const f = fixture();
        f.gameManager.selectTeamMember('p2');
        f.gameManager.gameData = clone(f.game);
        f.gameManager.gameData.inquisitorUsed = { p3: true };
        assert.deepEqual(clone(f.gameManager.getSelectionView().selectedTeam), ['p2']);
        change(f);
        f.gameManager.gameData = f.game;
        assert.deepEqual(clone(f.gameManager.getSelectionView().selectedTeam), []);
    }
});

test('unavailable players are pruned on presence updates and cannot be selected again', () => {
    for (const change of [
        (f) => { f.players.p2.connected = false; },
        (f) => { f.players.p2.left = true; },
        (f) => { f.game.exiledPlayers = ['p2']; }
    ]) {
        const f = fixture();
        f.gameManager.selectTeamMember('p1');
        f.gameManager.selectTeamMember('p2');
        change(f);
        assert.deepEqual(clone(f.gameManager.getSelectionView().selectedTeam), ['p1']);
        f.gameManager.selectTeamMember('p2');
        assert.deepEqual(clone(f.gameManager.selectionDraft.team), ['p1']);
    }
});

test('exile target switching stays local and confirmation submits only the final target', async () => {
    const { gameManager: gm, game, calls, payload, players } = fixture('selectExile');
    gm.selectExileTarget('p1');
    assert.equal(gm.selectionDraft.targetId, null);
    gm.selectExileTarget('p2');
    gm.selectExileTarget('p3');
    assert.equal(gm.getSelectionView().exileTarget, 'p3');
    assert.equal(game.exileTarget, null);
    assert.equal(calls.length, 0);
    await gm.confirmExileForVote();
    assert.deepEqual(calls, [{ action: 'confirmExile', payload: payload({ targetPlayerId: 'p3' }) }]);
    players.p3.connected = false;
    assert.equal(gm.getSelectionView().exileTarget, null);
});

test('authority publishes the complete team and opens voting atomically in seating order', async () => {
    const { handle, payload, room } = fixture();
    const before = clone(room);
    const result = await handle('confirmTeam', payload({ selectedTeam: ['p3', 'p1'] }));
    assert.equal(result.error, undefined);
    assert.equal(result.room.game.phase, 'vote');
    assert.equal(result.room.game.voteType, 'mission');
    assert.deepEqual(clone(result.room.game.selectedTeam), ['p1', 'p3']);
    assert.deepEqual(clone(result.room.game.votes), {});
    assert.deepEqual(room, before);
});

test('authority rejects malformed, duplicate, stale, unavailable and unauthorized team proposals', async () => {
    for (const team of [undefined, 'p1,p2', [], ['p1'], ['p1', 'p2', 'p3'], ['p1', 'p1'], ['p1', 'missing']]) {
        const f = fixture();
        assert.ok((await f.handle('confirmTeam', f.payload({ selectedTeam: team }))).error);
    }
    for (const mutate of [
        (f, p) => { p.gameId = 'old-game'; },
        (f, p) => { p.selectionRevision = 0; },
        (f) => { f.players.p2.connected = false; },
        (f) => { f.players.p2.left = true; },
        (f) => { f.game.exiledPlayers = ['p2']; },
        (f) => { f.game.phase = 'mission'; }
    ]) {
        const f = fixture();
        const p = f.payload({ selectedTeam: ['p1', 'p2'] });
        mutate(f, p);
        assert.ok((await f.handle('confirmTeam', p)).error);
        assert.deepEqual(f.game.selectedTeam, []);
    }
    const f = fixture();
    assert.ok((await f.handle('confirmTeam', f.payload({ selectedTeam: ['p1', 'p2'] }), 'p2')).error);
});

test('authority validates exile proposals, including self, offline and stale targets', async () => {
    const f = fixture('selectExile');
    const result = await f.handle('confirmExile', f.payload({ targetPlayerId: 'p2' }));
    assert.equal(result.room.game.phase, 'vote');
    assert.equal(result.room.game.voteType, 'exile');
    assert.equal(result.room.game.exileTarget, 'p2');
    for (const p of [
        f.payload({ targetPlayerId: 'p1' }), f.payload({ targetPlayerId: 'missing' }),
        f.payload({ targetPlayerId: 'p2', selectionRevision: 0 })
    ]) assert.ok((await f.handle('confirmExile', p)).error);
    f.players.p2.connected = false;
    assert.ok((await f.handle('confirmExile', f.payload({ targetPlayerId: 'p2' }))).error);
});

test('new selection stages receive a new revision, including mission cancellation on disconnect', async () => {
    const f = fixture('captainChoice');
    for (const actionType of ['mission', 'tribunal']) {
        const result = await f.handle('chooseAction', { actionType });
        assert.equal(result.room.game.selectionRevision, 2);
    }
    f.game.phase = 'mission';
    f.game.selectedTeam = ['p1', 'p2'];
    f.players.p2.connected = false;
    const result = await f.handle('reconcilePresence', {});
    assert.equal(result.room.game.phase, 'selectTeam');
    assert.equal(result.room.game.selectionRevision, 2);
    assert.deepEqual(clone(result.room.game.selectedTeam), []);
});

test('a disconnected teammate who already submitted does not cancel the mission', async () => {
    const f = fixture('mission');
    f.game.selectedTeam = ['p1', 'p2'];
    f.game.missionSubmitted = { p2: true };
    f.players.p2.connected = false;
    const result = await f.handle('reconcilePresence', {});
    assert.equal(result.room.game.phase, 'mission');
    assert.equal(result.room.game.missionSubmitted.p2, true);
    assert.deepEqual(clone(result.room.game.selectedTeam), ['p1', 'p2']);
});

test('all display lists follow lobby join order, including old shuffled game snapshots', () => {
    const { ui, players, game } = fixture();
    game.playerOrder = ['p2', 'p5', 'p1', 'p3', 'p4'];
    const expected = ['p1', 'p2', 'p3', 'p4', 'p5'];
    assert.deepEqual(clone(ui.getPlayerDisplayOrder(players)), expected);
    assert.deepEqual(clone(ui.getPlayerDisplayOrder(players, game)), expected);
    assert.deepEqual(clone(ui.getPlayerDisplayOrder(players, { playerOrder: ['p5', 'p2'] })), ['p2', 'p5']);
    players.p2.joinedAt = players.p1.joinedAt;
    assert.deepEqual(clone(ui.getPlayerDisplayOrder(players, game)), clone(ui.getPlayerDisplayOrder(players)));
});

test('starting a new game keeps lobby seats and randomizes the first captain independently', async () => {
    const f = fixture();
    f.room.state = 'waiting';
    f.roomManager.isHost = true;
    f.roomManager.roomRef = { transaction: async (update) => {
        const result = update(f.room);
        return { committed: !!result };
    } };
    vm.runInContext('Math.random = () => 0.75;', f.context);
    await f.roomManager.startGame();
    assert.deepEqual(clone(f.room.game.playerOrder), ['p1', 'p2', 'p3', 'p4', 'p5']);
    assert.equal(f.room.game.captainIndex, 3);
    assert.equal(f.room.game.selectionRevision, 0);
    assert.equal(Object.keys(f.database.getHostSecrets().roles).length, 5);
    assert.equal(f.roomManager.gameStartPending, false);
});
