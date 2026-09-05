const test = require('node:test');
const assert = require('node:assert/strict');
const { engine, clone } = require('./helpers/game-fixture');

for (const preset of ['legacy', 'light', 'mist', 'council', 'neutral', 'chaos']) {
    for (let count = 5; count <= 10; count++) {
        test(`${preset}: ${count} players can compile, assign and finish a full game`, async () => {
            const f = engine({ preset, count });
            assert.equal(f.config.validate(f.game.rules).length, 0);
            assert.equal(Object.keys(f.secrets.roles).length, count);
            assert.equal(new Set(Object.values(f.secrets.roles).filter((role) => !['loyal', 'minion'].includes(role))).size,
                Object.values(f.secrets.roles).filter((role) => !['loyal', 'minion'].includes(role)).length);
            await f.begin();
            for (let i = 0; i < 5 && !['assassin', 'ended'].includes(f.game.phase); i++) await f.mission();
            if (f.game.phase === 'assassin') {
                const assassin = f.ids.find((id) => f.secrets.roles[id] === 'assassin');
                const target = f.ids.find((id) => id !== assassin && f.secrets.roles[id] !== 'merlin');
                await f.ok('assassinate', { targetPlayerId: target }, assassin);
            }
            assert.equal(f.game.phase, 'ended');
            assert.equal(f.game.winners, 'good');
            assert.ok(f.game.revealedDetails);
            assert.ok(f.game.history.some((entry) => entry.type === 'mission'));
        });
    }
}

test('template export/import and local storage preserve all six recipes; unsupported and impossible configurations are rejected', () => {
    const f = engine();
    const template = f.config.preset('chaos');
    template.id = 'custom-test'; template.name = '朋友局';
    template.variants[5].missionSizes[0] = 3;
    assert.equal(f.config.stringify(f.config.parse(f.config.stringify(template))), f.config.stringify(template));
    f.config.save(template);
    assert.equal(f.config.loadSaved()[0].variants[5].missionSizes[0], 3);
    const bad = clone(template);
    bad.variants[7].exileEnabled = false;
    assert.throws(() => f.config.parse(JSON.stringify(bad)), /放逐/);
    bad.variants[7] = clone(template.variants[7]); bad.variants[7].roleCounts.merlin = 2;
    assert.throws(() => f.config.normalizeTemplate(bad), /最多一名/);
    bad.variants[7] = clone(template.variants[7]); bad.variants[7].missionFails[0] = 11;
    assert.throws(() => f.config.normalizeTemplate(bad), /失败门槛/);
    bad.version = 999;
    assert.throws(() => f.config.normalizeTemplate(bad), /版本/);
    assert.throws(() => f.config.parse('a'.repeat(100001)), /过大/);
    const slots = f.config.preset('neutral').variants[7];
    slots.neutralSlots = 2; slots.roleCounts.loyal = 0;
    slots.neutralPool = ['gambler'];
    assert.ok(f.config.validate(slots).some((error) => error.includes('候选数量')));
    f.context.localStorage.setItem = () => { throw new Error('quota'); };
    assert.throws(() => f.config.save(template), /quota/);
});

test('new identities change only their intended night-information edges', () => {
    const f = engine({ count: 8, roles: ['merlin', 'percival', 'hermit', 'oberon', 'illusionist', 'morgana', 'assassin', 'loyal'] });
    const assignments = Object.fromEntries(Object.entries(f.secrets.roles).map(([id, role]) => [id, f.config.role(role)]));
    const night = f.context.window.getNightInfo;
    assert.deepEqual(clone(night(f.config.role('merlin'), assignments, 'p0')[0].players), ['p4', 'p5', 'p6']);
    assert.deepEqual(clone(night(f.config.role('percival'), assignments, 'p1')[0].players), ['p0', 'p4', 'p5']);
    assert.ok(night(f.config.role('assassin'), assignments, 'p6')[0].players.includes('p2'));
    assert.ok(!night(f.config.role('assassin'), assignments, 'p6')[0].players.includes('p3'));
});

test('skills keep targets, results and spent abilities private; duplicate or invalid submissions do not consume anything', async () => {
    const f = engine({ roles: ['merlin', 'spy', 'oathkeeper', 'blackguard', 'assassin', 'loyal', 'loyal'], rules: { eventPool: [] } });
    await f.begin();
    const before = clone(f.secrets);
    assert.match((await f.act('submitRoundSkill', { choice: 'use', targets: ['p2', 'p2'] }, 'p1')).error, /两名/);
    assert.deepEqual(f.secrets, before);
    const reply = await f.ok('submitRoundSkill', { choice: 'use', targets: ['p2', 'p6'] }, 'p1');
    assert.equal(f.game.skillSubmittedCount, 1);
    assert.equal(f.secrets.expansion.results.p1[0].sameTeam, true);
    assert.ok(reply.privateMessages.every((message) => message.playerId === 'p1'));
    assert.ok(!JSON.stringify(f.game).includes('sameTeam'));
    assert.ok(!Object.hasOwn(f.game, 'expansion'));
    assert.match((await f.act('submitRoundSkill', { choice: 'pass' }, 'p1')).error, /已经提交/);
    await f.passSkills();
    assert.equal(f.game.phase, 'captainChoice');
    assert.equal(f.secrets.expansion.used.p2, undefined);
});

test('timeout is authority-controlled, does not spend skills, and a refreshed host can finish the existing window', async () => {
    const f = engine({ rules: { eventPool: [] } });
    await f.begin();
    const deadline = f.game.skillDeadline;
    assert.ok(deadline > Date.now());
    assert.match((await f.act('advanceSkills', {}, 'p1')).error, /房主/);
    await f.ok('advanceSkills');
    assert.equal(f.game.phase, 'roundSkill');
    f.database.setHostSecrets(clone(f.secrets));
    f.game.skillDeadline = Date.now() - 1;
    await f.ok('reconcilePresence');
    assert.equal(f.game.phase, 'captainChoice');
    assert.deepEqual(clone(f.secrets.expansion.used), {});
});

test('an uncommitted authority result does not spend a skill or change the saved private state', async () => {
    const f = engine({ roles: ['merlin', 'spy', 'loyal', 'assassin', 'loyal', 'loyal', 'loyal'], rules: { eventPool: [] } });
    await f.begin();
    const saved = clone(f.secrets), game = clone(f.game);
    const response = await f.gm.handleAuthoritativeAction({ action: 'submitRoundSkill', payload: { choice: 'use', targets: ['p2', 'p3'] }, senderPlayerId: 'p1', room: f.room });
    assert.equal(response.secrets.expansion.used.p1, true);
    assert.deepEqual(f.secrets, saved);
    assert.deepEqual(clone(f.game), game);
    assert.equal(f.gm._authoritySecrets, null);
    await f.ok('submitRoundSkill', { choice: 'use', targets: ['p2', 'p3'] }, 'p1');
    assert.equal(f.secrets.expansion.log.length, 1);
});

test('a disconnected captain is skipped when the skill window expires, and shields expire after the task', async () => {
    const f = engine({ roles: ['merlin', 'oathkeeper', 'loyal', 'assassin', 'loyal', 'loyal', 'loyal'], rules: { eventPool: [] } });
    await f.begin();
    await f.ok('submitRoundSkill', { choice: 'use', targets: ['p2'] }, 'p1');
    f.room.players.p0.connected = false;
    f.game.skillDeadline = Date.now() - 1;
    await f.ok('advanceSkills');
    assert.equal(f.game.phase, 'captainChoice');
    assert.equal(f.gm.getCaptain().id, 'p1');
    assert.equal(f.secrets.expansion.shields.p2, true);
    await f.mission();
    assert.deepEqual(clone(f.secrets.expansion.shields), {});
    assert.equal(f.secrets.expansion.used.p1, true);
});

test('good and evil protection merge, conceal the source, stop one exile, and do not advance the mission', async () => {
    const f = engine({ roles: ['merlin', 'oathkeeper', 'blackguard', 'assassin', 'loyal', 'loyal', 'loyal'], rules: { eventPool: [] } });
    await f.begin();
    await f.ok('submitRoundSkill', { choice: 'use', targets: ['p5'] }, 'p1');
    await f.ok('submitRoundSkill', { choice: 'use', targets: ['p5'] }, 'p2');
    await f.passSkills();
    const exile = async () => {
        await f.ok('chooseAction', { actionType: 'tribunal' }, f.gm.getCaptain().id);
        await f.ok('confirmExile', { targetPlayerId: 'p5', gameId: f.game.gameId, selectionRevision: f.game.selectionRevision }, f.gm.getCaptain().id);
        for (const id of f.gm.getActivePlayerIds()) await f.ok('castVote', { approve: true }, id);
        await f.ok('proceedVoteResult');
    };
    await exile();
    assert.equal(f.game.currentMission, 0);
    assert.equal(f.game.exiledPlayers.length, 0);
    assert.equal(f.game.history.filter((entry) => entry.type === 'protected').length, 1);
    assert.deepEqual(Object.keys(f.game.history.find((entry) => entry.type === 'protected')).sort(), ['mission', 'playerId', 'seq', 'type']);
    await exile();
    assert.ok(f.game.exiledPlayers.includes('p5'));
});

test('witness reads original submitted cards even when a barrier makes the mission succeed', async () => {
    const f = engine({ count: 5, roles: ['merlin', 'assassin', 'loyal', 'witness', 'loyal'], rules: { eventPool: ['barrier'], exileEnabled: false } });
    await f.begin();
    assert.equal(f.game.activeEvent.id, 'barrier');
    await f.mission({ p1: false });
    assert.equal(f.game.missionResults[0], true);
    assert.equal(f.game.phase, 'roundSkill');
    await f.ok('submitRoundSkill', { choice: 'use', targets: ['p0', 'p1'] }, 'p3');
    assert.equal(f.secrets.expansion.results.p3[0].hasFail, true);
    assert.equal(f.secrets.missionHistory.p1[0], false);
});

test('gamblers and bounty hunters cannot sabotage; simultaneous neutral wins preempt a faction win', async () => {
    const f = engine({ count: 7, roles: ['merlin', 'gambler', 'bountyhunter', 'assassin', 'scapegoat', 'loyal', 'loyal'], rules: { eventPool: [] } });
    assert.equal(f.gm.canRoleSubmitFail(f.config.role('gambler'), 'p1'), false);
    assert.equal(f.gm.canRoleSubmitFail(f.config.role('bountyhunter'), 'p2'), false);
    await f.begin(); await f.passSkills();
    f.game.phase = 'mission'; f.game.selectedTeam = ['p1'];
    assert.match((await f.act('submitMissionCard', { success: false }, 'p1')).error, /不能提交失败/);
    f.secrets.expansion.bountyTargets.p2 = ['p4', 'p5'];
    f.game.exiledPlayers = ['p5'];
    f.game.phase = 'voteResult'; f.game.voteType = 'exile'; f.game.voteResultApproved = true; f.game.exileTarget = 'p4';
    await f.ok('proceedVoteResult');
    assert.equal(f.game.winners, 'neutral');
    assert.deepEqual(clone(f.game.neutralWinnerIds).sort(), ['p2', 'p4']);
    assert.equal(f.gm.checkNeutralWin().filter((result) => result.won).length, 2);
});

test('gambler predictions use actual tasks and resolve before the third good point', async () => {
    const f = engine({ count: 5, roles: ['merlin', 'gambler', 'loyal', 'loyal', 'assassin'], rules: { eventPool: [] } });
    await f.begin();
    await f.ok('submitRoundSkill', { choice: 'use', predictions: [true, true, true] }, 'p1');
    await f.mission(); await f.mission(); await f.mission();
    assert.equal(f.game.winners, 'neutral');
    assert.equal(f.game.neutralWinnerId, 'p1');
    assert.equal(f.game.currentMission, 2);
});

test('regroup validates proposals, and permanently losing its only outside player revokes the restriction', async () => {
    const f = engine({ count: 5, preset: 'light', rules: { eventPool: ['regroup'] } });
    await f.begin(); await f.mission();
    assert.equal(f.game.activeEvent.id, 'regroup');
    f.game.rules.missionSizes[1] = 2;
    await f.ok('chooseAction', { actionType: 'mission' }, f.gm.getCaptain().id);
    const response = await f.act('confirmTeam', { gameId: f.game.gameId, selectionRevision: f.game.selectionRevision, selectedTeam: ['p0', 'p1'] }, f.gm.getCaptain().id);
    assert.match(response.error, /重整编队/);
    for (const id of ['p2', 'p3', 'p4']) f.room.players[id].left = true;
    await f.ok('reconcilePresence');
    assert.equal(f.game.activeEvent.revoked, true);
    assert.ok(f.game.history.some((entry) => entry.type === 'eventRevoked'));
});

test('events are drawn once per real task, without replacement, and survive rejected proposals and restoration', async () => {
    const f = engine({ count: 5, preset: 'light', rules: { eventPool: ['rotation', 'double', 'reinforcement'], eventRounds: [true, true, true, true, true] } });
    await f.begin();
    const event = clone(f.game.activeEvent), deck = clone(f.secrets.expansion.deck);
    await f.ok('reconcilePresence');
    assert.deepEqual(clone(f.game.activeEvent), event);
    f.game.phase = 'voteResult'; f.game.voteResultApproved = false;
    await f.ok('proceedVoteResult');
    assert.deepEqual(clone(f.game.activeEvent), event);
    assert.deepEqual(clone(f.secrets.expansion.deck), deck);
    await f.mission();
    assert.notEqual(f.game.activeEvent.id, event.id);
    assert.equal(f.secrets.expansion.deck.length, 1);
});

test('strategy truce and custom exile limits are enforced by authority; scrutiny needs rounded-up two thirds', async () => {
    const f = engine({ count: 5, rules: { eventPool: ['truce'] } });
    await f.begin(); await f.passSkills();
    assert.match((await f.act('chooseAction', { actionType: 'tribunal' })).error, /不能发起放逐/);
    f.game.activeEvent = { id: 'scrutiny' };
    f.game.phase = 'vote'; f.game.voteType = 'mission'; f.game.selectedTeam = ['p0', 'p1'];
    for (let i = 0; i < 5; i++) await f.ok('castVote', { approve: i < 3 }, f.ids[i]);
    assert.equal(f.game.voteResultApproved, false);
    f.game.phase = 'captainChoice'; f.game.activeEvent = null; f.game.rules.maxExiles = 0;
    assert.match((await f.act('chooseAction', { actionType: 'tribunal' })).error, /不能发起放逐/);
});

test('permanent departures shrink teams, temporary disconnections do not, and crisis changes only the failure threshold', async () => {
    const f = engine({ count: 7, rules: { missionSizes: [7, 3, 3, 4, 4], eventPool: [] } });
    f.room.players.p6.connected = false;
    assert.equal(f.gm.getCurrentMissionSize(), 7);
    f.room.players.p6.left = true;
    assert.equal(f.gm.getCurrentMissionSize(), 6);
    f.game.currentMission = 3; f.game.activeEvent = { id: 'crisis' };
    assert.equal(f.gm.getRequiredMissionFails(), 1);
    assert.equal(f.gm.getCurrentMissionSize(), 4);
});

test('double progress can finish after two tasks without satisfying a three-task gambler prediction', async () => {
    const f = engine({ count: 5, roles: ['merlin', 'gambler', 'loyal', 'loyal', 'assassin'], rules: { eventPool: ['double'], assassinationEnabled: false } });
    await f.begin(); await f.ok('submitRoundSkill', { choice: 'use', predictions: [true, true, true] }, 'p1');
    await f.mission(); await f.mission();
    assert.equal(f.game.winners, 'good');
    assert.equal(f.game.missionResults.filter((r) => r !== null).length, 2);
    assert.equal(f.gm.missionScore(f.game, true), 4);
});

test('replay escapes player names and exposes original cards only after a normal conclusion', async () => {
    const f = engine({ count: 5, preset: 'light' });
    f.room.players.p0.name = '<img src=x onerror=alert(1)>';
    await f.begin(); await f.mission();
    const ui = f.context.window.Workshop;
    const during = ui.historyHTML(f.game);
    assert.ok(!during.includes('<img'));
    assert.ok(during.includes('&lt;img'));
    assert.ok(!during.includes('真实身份与任务牌'));
    await f.mission(); await f.mission();
    await f.ok('assassinate', { targetPlayerId: f.ids.find((id) => !['assassin', 'merlin'].includes(f.secrets.roles[id])) }, f.ids.find((id) => f.secrets.roles[id] === 'assassin'));
    assert.ok(ui.historyHTML(f.game).includes('真实身份与任务牌'));
    f.game.winners = 'aborted';
    assert.ok(!ui.historyHTML(f.game).includes('真实身份与任务牌'));
});
