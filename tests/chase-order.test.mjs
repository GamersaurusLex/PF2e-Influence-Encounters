import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
const source = await readFile(new URL('../scripts/influence-encounters.js', import.meta.url), 'utf8');
const between = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
const helpers = between('function freeChoiceChase(', 'function orderedSkillEncounter(');
const game = { user: { isGM: false } };
const rules = new Function('game', `${helpers};return {freeChoiceChase,chaseObstacleComplete,chaseObstacleAvailable,chaseObstacleVisible,advanceCompletedChaseObstacle};`)(game);
const make = (order = 'any') => ({ subsystemType: 'chase', chaseType: 'beat-clock', chaseObstacleOrder: order, activeNpcId: 'first', actorsActed: {}, npcs: ['first', 'middle', 'last'].map(id => ({ id, points: 0, maximumPoints: 2, availability: 'available' })) });

test('any-order chase finishes only after all obstacles, including when last-listed is first', () => {
  const encounter = make();
  for (const id of ['last', 'first', 'middle']) {
    const npc = encounter.npcs.find(n => n.id === id);
    assert.equal(rules.chaseObstacleAvailable(encounter, npc), true);
    npc.points = 2;
    const { won } = rules.advanceCompletedChaseObstacle(encounter, npc);
    assert.equal(won, id === 'middle');
    assert.equal(rules.chaseObstacleAvailable(encounter, npc), false);
  }
  assert.equal(encounter.chaseOutcome, 'victory');
});

test('existing sequential chases and quarry interception keep their rules', () => {
  const encounter = make(undefined);
  delete encounter.chaseObstacleOrder;
  assert.equal(rules.chaseObstacleAvailable(encounter, encounter.npcs[2]), false);
  encounter.npcs[0].points = 2;
  assert.equal(rules.advanceCompletedChaseObstacle(encounter, encounter.npcs[0]).won, false);
  assert.equal(encounter.activeNpcId, 'middle');
  encounter.chaseType = 'chase-down';
  encounter.opponentPosition = 2;
  encounter.npcs[1].points = 2;
  assert.equal(rules.advanceCompletedChaseObstacle(encounter, encounter.npcs[1]).won, true);
});

test('visibility remains independent, honors hidden obstacles, and completed obstacles remain visible', () => {
  const encounter = make();
  const last = encounter.npcs[2];
  assert.equal(rules.chaseObstacleVisible(encounter, last), true);
  encounter.obscureFutureObstacles = true;
  assert.equal(rules.chaseObstacleVisible(encounter, last), false);
  assert.equal(rules.chaseObstacleVisible(encounter, last, true), true);
  last.points = 2;
  assert.equal(rules.chaseObstacleVisible(encounter, last), true);
  last.availability = 'hidden';
  assert.equal(rules.chaseObstacleVisible(encounter, last, true), false);
  assert.equal(rules.chaseObstacleAvailable(encounter, last), false);
});

test('two PCs retain independent choices and fall back when a chosen obstacle is completed', () => {
  const encounter = make();
  const actors = [{ id: 'pc1' }, { id: 'pc2' }];
  const saved = { actorId: 'pc1', npcIdsByActor: { pc1: 'last', pc2: 'middle' } };
  const fakeGame = { user: { isGM: false }, settings: { get: () => ({ council: saved }) } };
  encounter.id = 'council';
  const select = new Function('game', 'SETTINGS', 'MODULE_ID', 'deepClone', 'encounterParticipants', 'canUserControlActor',
    `${helpers}${between('function encounterViewSelection(', 'async function setEncounterViewSelection(')};return encounterViewSelection;`
  )(fakeGame, { selections: 'userSelections' }, 'influence-encounters', structuredClone, () => actors, () => true);
  assert.equal(select(encounter).npcId, 'last');
  saved.actorId = 'pc2';
  assert.equal(select(encounter).npcId, 'middle');
  encounter.npcs[2].points = 2;
  saved.actorId = 'pc1';
  assert.equal(select(encounter).npcId, 'first');
  assert.equal(encounter.activeNpcId, 'first');
});

test('fresh resolution rejects completed obstacles and PCs who already acted', async () => {
  const encounter = make();
  encounter.activeEffects = [];
  const prefix = between('async function executeCheck(', '  // Adjudication may have been opened');
  let canceled = [];
  const execute = new Function('Store', 'chaseObstacleAvailable', 'cancelPendingCheck', 'ui', `${prefix}\n};return executeCheck;`)(
    { get: () => encounter }, rules.chaseObstacleAvailable, async (...args) => canceled.push(args), { notifications: { error: assert.fail } });
  encounter.npcs[2].points = 2;
  await execute(encounter, { type: 'chase', id: 'pending', npcId: 'last' }, { id: 'pc1' }, {});
  assert.equal(canceled.length, 1);
  encounter.npcs[2].points = 0;
  encounter.actorsActed.pc1 = true;
  await execute(encounter, { type: 'chase', id: 'pending', npcId: 'last' }, { id: 'pc1' }, {});
  assert.equal(canceled.length, 2);
  // Correct Outcome supplies a restored pre-check snapshot, while Store still
  // contains the just-completed obstacle. Replaying must use the snapshot.
  const restored = make();
  restored.activeEffects = [];
  await execute(restored, { type: 'chase', id: 'pending', npcId: 'last' }, { id: 'pc1' }, {}, [], 0, { correction: true });
  assert.equal(canceled.length, 2);
});
