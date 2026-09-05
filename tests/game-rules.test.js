const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const projectRoot = path.resolve(__dirname, '..');
const context = vm.createContext({
    console,
    RoomManager: {
        playerId: null,
        roomRef: null
    },
    window: {}
});

vm.runInContext(fs.readFileSync(path.join(projectRoot, 'js', 'roles.js'), 'utf8'), context);
vm.runInContext(fs.readFileSync(path.join(projectRoot, 'js', 'rules-config.js'), 'utf8'), context);
vm.runInContext(fs.readFileSync(path.join(projectRoot, 'js', 'game.js'), 'utf8'), context);
vm.runInContext(fs.readFileSync(path.join(projectRoot, 'js', 'game-expansion.js'), 'utf8'), context);

const GameManager = context.window.GameManager;
const assignRoles = context.window.assignRoles;
const ROLES = context.window.ROLES;
const getNightInfo = context.window.getNightInfo;

function makeGame(overrides = {}) {
    return {
        phase: 'captainChoice',
        roles: {
            p0: 'merlin',
            p1: 'percival',
            p2: 'loyal',
            p3: 'loyal',
            p4: 'assassin',
            p5: 'morgana',
            p6: 'armsdealer'
        },
        playerOrder: ['p0', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6'],
        captainIndex: 0,
        currentMission: 1,
        rejectCount: 0,
        selectedTeam: ['p0', 'p1'],
        exileTarget: null,
        actionType: 'tribunal',
        voteType: 'exile',
        votes: {},
        missionCards: {},
        exiledPlayers: [],
        tribunalVotes: {},
        tribunalInitiateVotes: {},
        ...overrides
    };
}

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function installGameTransaction(initialGame) {
    let storedGame = clone(initialGame);

    context.RoomManager.roomRef = {
        child(childPath) {
            assert.equal(childPath, 'game');
            return {
                transaction(update) {
                    const updatedGame = update(clone(storedGame));
                    if (updatedGame !== undefined) storedGame = updatedGame;
                    return Promise.resolve({
                        committed: updatedGame !== undefined,
                        snapshot: { val: () => clone(storedGame) }
                    });
                }
            };
        }
    };

    return () => clone(storedGame);
}

test('scapegoat wins immediately and alone when exiled', () => {
    const game = makeGame({
        roles: {
            p0: 'merlin',
            p1: 'percival',
            p2: 'loyal',
            p3: 'loyal',
            p4: 'assassin',
            p5: 'morgana',
            p6: 'scapegoat'
        }
    });

    const result = GameManager._applyExileResolution(game, 'p6');

    assert.equal(result.phase, 'ended');
    assert.equal(result.winners, 'neutral');
    assert.equal(result.neutralWinnerId, 'p6');
    assert.equal(result.neutralWinnerRoleId, 'scapegoat');
    assert.equal(result.currentMission, 1);
});

test('Merlin sees the scapegoat but not the arms dealer or cultist', () => {
    const nightInfo = getNightInfo(ROLES.MERLIN, {
        merlinPlayer: ROLES.MERLIN,
        scapegoatPlayer: ROLES.SCAPEGOAT,
        armsDealerPlayer: ROLES.ARMS_DEALER,
        cultistPlayer: ROLES.CULTIST
    }, 'merlinPlayer');

    const visiblePlayers = nightInfo.find((entry) => entry.type === 'evil')?.players || [];
    assert.equal(visiblePlayers.includes('scapegoatPlayer'), true);
    assert.equal(visiblePlayers.includes('armsDealerPlayer'), false);
    assert.equal(visiblePlayers.includes('cultistPlayer'), false);
});

test('arms dealer and cultist can repeatedly fail missions while scapegoat has one use', () => {
    const game = makeGame({ neutralFailUsage: { p6: true } });

    assert.equal(GameManager.canRoleSubmitFail(ROLES.ARMS_DEALER, 'p6', game), true);
    assert.equal(GameManager.canRoleSubmitFail(ROLES.CULTIST, 'p6', game), true);
    assert.equal(GameManager.canRoleSubmitFail(ROLES.SCAPEGOAT, 'p6', game), false);
    assert.equal(GameManager.canRoleSubmitFail(ROLES.SCAPEGOAT, 'unused', game), true);

    context.RoomManager.playerId = 'private-scapegoat';
    GameManager.privateNeutralFailUsed = true;
    assert.equal(GameManager.canRoleSubmitFail(ROLES.SCAPEGOAT, 'private-scapegoat', makeGame()), false);
    GameManager.privateNeutralFailUsed = false;
    context.RoomManager.playerId = null;
});

test('cultist wins immediately and alone when a third player is exiled', () => {
    const game = makeGame({
        roles: {
            p0: 'merlin',
            p1: 'percival',
            p2: 'loyal',
            p3: 'loyal',
            p4: 'assassin',
            p5: 'morgana',
            p6: 'cultist'
        },
        exiledPlayers: ['p1', 'p4']
    });

    const result = GameManager._applyExileResolution(game, 'p2');

    assert.equal(result.phase, 'ended');
    assert.equal(result.winners, 'neutral');
    assert.equal(result.neutralWinnerId, 'p6');
    assert.equal(result.neutralWinnerRoleId, 'cultist');
});

test('cultist does not win if the cultist is the third exiled player', () => {
    const game = makeGame({
        roles: {
            p0: 'merlin',
            p1: 'percival',
            p2: 'loyal',
            p3: 'loyal',
            p4: 'assassin',
            p5: 'morgana',
            p6: 'cultist'
        },
        exiledPlayers: ['p1', 'p4']
    });

    const result = GameManager._applyExileResolution(game, 'p6');

    assert.notEqual(result.winners, 'neutral');
    assert.notEqual(result.neutralWinnerId, 'p6');
});

test('successful exile rotates captain without advancing the mission', () => {
    const game = makeGame({ currentMission: 2, rejectCount: 3 });

    const result = GameManager._applyExileResolution(game, 'p2');

    assert.equal(result.phase, 'captainChoice');
    assert.equal(result.captainIndex, 1);
    assert.equal(result.currentMission, 2);
    assert.equal(result.rejectCount, 0);
    assert.deepEqual(Array.from(result.exiledPlayers), ['p2']);
});

test('captain rotation skips the player who was just exiled', () => {
    const game = makeGame({ currentMission: 2 });

    const result = GameManager._applyExileResolution(game, 'p1');

    assert.equal(result.captainIndex, 2);
    assert.equal(result.currentMission, 2);
});

test('rejected exile rotates captain, preserves mission, and increments rejection count', async () => {
    const readGame = installGameTransaction(makeGame({
        phase: 'voteResult',
        voteResultApproved: false,
        voteType: 'exile',
        currentMission: 2,
        rejectCount: 2
    }));

    await GameManager._proceedAfterVoteResult();
    const result = readGame();

    assert.equal(result.phase, 'captainChoice');
    assert.equal(result.captainIndex, 1);
    assert.equal(result.currentMission, 2);
    assert.equal(result.rejectCount, 3);
});

test('arms dealer only wins when an actual mission advances into round five', () => {
    const exileRotation = GameManager._applyNextCaptainState(makeGame({ currentMission: 3 }));
    assert.equal(exileRotation.phase, 'captainChoice');
    assert.equal(exileRotation.currentMission, 3);
    assert.notEqual(exileRotation.winners, 'neutral');

    const missionAdvance = GameManager._applyNextMissionState(makeGame({ currentMission: 3 }));
    assert.equal(missionAdvance.currentMission, 4);
    assert.equal(missionAdvance.phase, 'ended');
    assert.equal(missionAdvance.winners, 'neutral');
    assert.equal(missionAdvance.neutralWinnerId, 'p6');
});

test('five consecutive rejected proposals still award evil victory', async () => {
    const readGame = installGameTransaction(makeGame({
        phase: 'voteResult',
        voteResultApproved: false,
        voteType: 'exile',
        currentMission: 2,
        rejectCount: 4
    }));

    await GameManager._proceedAfterVoteResult();
    const result = readGame();

    assert.equal(result.phase, 'ended');
    assert.equal(result.winners, 'evil');
    assert.equal(result.currentMission, 2);
});

test('the fourth mission needs two fails with seven or more players', () => {
    assert.equal(GameManager.getRequiredMissionFails(makeGame({ currentMission: 3 })), 2);
    assert.equal(GameManager.getRequiredMissionFails(makeGame({ currentMission: 2 })), 1);
    assert.equal(GameManager.getRequiredMissionFails(makeGame({
        currentMission: 3,
        playerOrder: ['p0', 'p1', 'p2', 'p3', 'p4', 'p5']
    })), 1);
});

test('nine player distribution keeps six good-equivalent seats and one neutral', () => {
    const assignments = assignRoles(
        Array.from({ length: 9 }, (_, index) => `p${index}`),
        [ROLES.ARMS_DEALER]
    );
    const roles = Object.values(assignments);

    assert.equal(roles.filter((role) => role.team === 'good').length, 6);
    assert.equal(roles.filter((role) => role.team === 'evil').length, 2);
    assert.equal(roles.filter((role) => role.team === 'neutral').length, 1);
});

test('ten player distribution always uses a selected neutral instead of randomly using Oberon', () => {
    for (let run = 0; run < 20; run++) {
        const assignments = assignRoles(
            Array.from({ length: 10 }, (_, index) => `p${index}`),
            [ROLES.CULTIST]
        );
        const roles = Object.values(assignments);
        assert.equal(roles.some((role) => role.id === 'cultist'), true);
        assert.equal(roles.some((role) => role.id === 'oberon'), false);
    }
});
