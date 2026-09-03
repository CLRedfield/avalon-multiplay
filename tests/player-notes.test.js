const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function fixture(storage = new Map()) {
    const context = vm.createContext({ window: {}, localStorage: {
        getItem: (key) => storage.get(key) || null,
        setItem: (key, value) => storage.set(key, value)
    } });
    for (const file of ['roles.js', 'player-notes.js']) {
        vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', file), 'utf8'), context);
    }
    return { notes: context.window.PlayerNotes, context, storage };
}

const game = { gameId: 'g1', playerOrder: ['p1', 'p2'] };

test('personal role and allegiance marks survive refresh and never mutate game state', () => {
    const { notes, storage } = fixture();
    const before = JSON.stringify(game);
    notes.useGame('broker', 'ROOM', 'p1', game);
    notes.set('p2', { roleId: 'morgana', judgment: 'suspicious' });
    assert.equal(notes.label('p2'), '莫甘娜 · 疑似坏人');
    assert.equal(JSON.stringify(game), before);
    const restored = fixture(storage).notes;
    restored.useGame('broker', 'ROOM', 'p1', game);
    assert.equal(restored.label('p2'), '莫甘娜 · 疑似坏人');
    restored.set('p2', { roleId: '', judgment: '' });
    assert.equal(restored.label('p2'), '');
});

test('marks are isolated between players, rooms, brokers and games', () => {
    const { notes } = fixture();
    notes.useGame('broker', 'ROOM', 'p1', game);
    notes.set('p2', { judgment: 'evil' });
    for (const args of [
        ['broker', 'ROOM', 'p2', game], ['broker', 'ELSE', 'p1', game],
        ['other-broker', 'ROOM', 'p1', game], ['broker', 'ROOM', 'p1', { ...game, gameId: 'g2' }]
    ]) {
        notes.useGame(...args);
        assert.equal(notes.label('p2'), '');
    }
});

test('malformed storage is ignored, invalid roles are rejected and storage failure keeps local marks usable', () => {
    const { notes, context, storage } = fixture();
    notes.useGame('broker', 'ROOM', 'p1', game);
    storage.set(notes.scope, '{broken');
    notes.scope = null;
    notes.useGame('broker', 'ROOM', 'p1', game);
    notes.set('p2', { roleId: '<img onerror=alert(1)>', judgment: 'evil' });
    assert.equal(notes.label('p2'), '坏人');
    context.localStorage.setItem = () => { throw new Error('quota'); };
    notes.set('p2', { judgment: 'good' });
    assert.equal(notes.label('p2'), '好人');
    assert.equal(notes.persistent, false);
    notes.clear();
    assert.equal(notes.label('p2'), '');
});
