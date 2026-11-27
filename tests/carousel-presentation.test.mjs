import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
const source = await readFile(new URL('../scripts/influence-encounters.js', import.meta.url), 'utf8');
const section = source.slice(source.indexOf('function sceneCarouselApi()'), source.indexOf('function renderCinematicHud()'));

function setup() {
  const backdrops = [{ id: 'montage', src: 'montage.webp' }, { id: 'other', src: 'other.webp' }];
  const scene = {
    id: 'gallery', activeId: 'other',
    tiles: [{ texture: { src: 'other.webp' }, getFlag: () => 'backdrop' }],
    getFlag: (_scope, key) => key === 'activeId' ? scene.activeId : undefined
  };
  const calls = [];
  let failure = false;
  const api = {
    getBackdrops: () => backdrops,
    activate: async (target, id) => {
      calls.push([target.id, id]);
      if (failure) throw Error('activation failed');
      target.activeId = id;
      target.tiles = [{ texture: { src: backdrops.find(b => b.id === id).src }, getFlag: () => 'backdrop' }];
    }
  };
  const game = { user: { isGM: true }, modules: { get: () => ({ active: true, api }) }, scenes: { get: () => scene } };
  const canvas = { scene };
  const helpers = new Function('game', 'canvas', 'MODULE_ID', 'ui', 'console', `${section};return {syncCarouselPresentation,carouselBackdropId};`)(
    game, canvas, 'influence-encounters', { notifications: { warn() {} } }, { warn() {}, error() {} });
  const encounter = {
    id: 'council', subsystemType: 'influence', currentPhase: 1, activeNpcId: 'npc', npcs: [{ id: 'npc' }],
    sceneCarousel: { mode: 'scene', sceneId: 'gallery', defaultBackdropId: 'montage', phaseBackdrops: {}, targetBackdrops: {}, objectiveBackdrops: {}, complicationBackdrops: {} }
  };
  return { ...helpers, scene, backdrops, calls, game, canvas, encounter, fail: value => failure = value };
}

test('restores a backdrop after a manual Carousel change, even with the same encounter and mapping', async () => {
  const f = setup();
  await f.syncCarouselPresentation(f.encounter);
  assert.equal(f.calls.length, 1);
  f.scene.activeId = 'other';
  f.scene.tiles[0].texture.src = 'other.webp';
  await f.syncCarouselPresentation(f.encounter);
  assert.equal(f.scene.activeId, 'montage');
  assert.equal(f.scene.tiles[0].texture.src, 'montage.webp');
  assert.equal(f.calls.length, 2);
  await f.syncCarouselPresentation(f.encounter);
  assert.equal(f.calls.length, 2, 'an already-correct scene does not write again');
});

test('repairs missing or stale tiles and updated artwork under the same backdrop ID', async () => {
  const f = setup();
  await f.syncCarouselPresentation(f.encounter);
  f.scene.tiles = [];
  await f.syncCarouselPresentation(f.encounter);
  assert.equal(f.calls.length, 2);
  f.scene.tiles[0].texture.src = 'stale.webp';
  await f.syncCarouselPresentation(f.encounter);
  assert.equal(f.calls.length, 3);
  f.backdrops[0].src = 'replacement.webp';
  await f.syncCarouselPresentation(f.encounter);
  assert.equal(f.scene.tiles[0].texture.src, 'replacement.webp');
  assert.equal(f.calls.length, 4);
});

test('restores the mapping when returning from another encounter or scene', async () => {
  const f = setup();
  await f.syncCarouselPresentation(f.encounter);
  const other = structuredClone(f.encounter);
  other.id = 'another';
  other.sceneCarousel.defaultBackdropId = 'other';
  await f.syncCarouselPresentation(other);
  f.canvas.scene = { id: 'different' };
  assert.equal(await f.syncCarouselPresentation(f.encounter), false);
  f.canvas.scene = f.scene;
  await f.syncCarouselPresentation(f.encounter);
  assert.equal(f.scene.activeId, 'montage');
  assert.equal(f.calls.length, 3);
});

test('all encounter types share the state check and keep their mapping precedence', async () => {
  for (const subsystemType of ['influence', 'research', 'chase', 'skill', 'infiltration', 'starship']) {
    const f = setup();
    f.encounter.subsystemType = subsystemType;
    f.encounter.sceneCarousel.targetBackdrops.npc = 'other';
    assert.equal(f.carouselBackdropId(f.encounter), 'other');
    f.encounter.sceneCarousel.targetBackdrops.npc = '';
    if (subsystemType === 'influence') f.encounter.sceneCarousel.phaseBackdrops['1'] = 'other';
    assert.equal(f.carouselBackdropId(f.encounter), subsystemType === 'influence' ? 'other' : 'montage');
    f.encounter.sceneCarousel.phaseBackdrops = {};
    await f.syncCarouselPresentation(f.encounter);
    assert.equal(f.scene.activeId, 'montage', subsystemType);
  }
});

test('failures remain retryable and player clients never change a Scene', async () => {
  const f = setup();
  f.fail(true);
  assert.equal(await f.syncCarouselPresentation(f.encounter), false);
  f.fail(false);
  assert.equal(await f.syncCarouselPresentation(f.encounter), true);
  assert.equal(f.calls.length, 2);
  f.game.user.isGM = false;
  f.scene.activeId = 'other';
  assert.equal(await f.syncCarouselPresentation(f.encounter), false);
  assert.equal(f.calls.length, 2);
});
