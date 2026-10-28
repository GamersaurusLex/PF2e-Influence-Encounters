import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../scripts/influence-encounters.js", import.meta.url), "utf8");
const moduleId = "influence-encounters";
const between = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
class ApplicationV2 {
  static RENDER_STATES = { CLOSING: -2 };
  _configureRenderParts() { return structuredClone(this.constructor.PARTS); }
  _configureRenderOptions() {}
  async close() { this.closed = true; return this; }
}
const mixin = Base => Base;
let encounter = { subsystemType: "influence" };
const Tracker = new Function("ApplicationV2", "HandlebarsApplicationMixin", "MODULE_ID", "Store",
  `${between("class InfluenceTracker extends", "function renderCinematicHud(")}\nreturn InfluenceTracker;`
)(ApplicationV2, mixin, moduleId, { get: () => encounter });
const Manager = new Function("ApplicationV2", "HandlebarsApplicationMixin", "MODULE_ID",
  `${between("class EncounterManager extends", "class EncounterEditor extends")}\nreturn EncounterManager;`
)(ApplicationV2, mixin, moduleId);

test("every tracker and manager template action is registered with native dispatch", async () => {
  for (const [App, templates] of [[Tracker, ["tracker", "starship-tracker"]], [Manager, ["manager"]]]) {
    const app = new App();
    const event = { currentTarget: { dataset: {} } };
    for (const template of templates) {
      const html = await readFile(new URL(`../templates/${template}.hbs`, import.meta.url), "utf8");
      for (const [, action] of html.matchAll(/data-action="([^"]+)"/g)) {
        if (action === "tab") continue; // ApplicationV2 supplies native tab dispatch.
        const handler = App.DEFAULT_OPTIONS.actions[action];
        assert.equal(typeof handler, "function", `${template}: ${action}`);
        const target = { dataset: { action, id: "clicked-record" } };
        app._action = (actualEvent, actualTarget) => {
          assert.equal(actualEvent, event);
          assert.equal(actualTarget, target, "use the clicked control, not the delegated event root");
        };
        handler.call(app, event, target);
      }
    }
  }
});

test("approved checks expose deliberate player roll and final-submit states", () => {
  const checks = new Function(
    "game", "participantDisplayName", "starshipShip", "starshipActivityFor", "targetDisplayName", "PLAYER_ROLL_STATES",
    `${between("function playerRollChecks", "function starshipTrackerContext")}
return playerRollChecks;`
  )(
    { user: { id: "player", isGM: true }, actors: { get: id => ({ id, name: "Testy" }) } },
    (_encounter, actor) => actor.name,
    () => null,
    () => null,
    target => target?.name ?? "Target",
    new Set(["awaiting-player-roll", "awaiting-final-result"])
  );
  const encounter = {
    npcs: [{ id: "npc", name: "Lanekar" }],
    pendingChecks: [
      { id: "roll", requesterId: "player", actorId: "actor", npcId: "npc", status: "awaiting-player-roll", approval: { skill: { label: "Diplomacy" } } },
      { id: "submit", requesterId: "player", actorId: "actor", npcId: "npc", status: "awaiting-final-result", approval: { skill: { label: "Society" } } }
    ]
  };
  const [roll, submit] = checks(encounter);
  assert.deepEqual({ canRoll: roll.canRoll, canSubmit: roll.canSubmit }, { canRoll: true, canSubmit: false });
  assert.deepEqual({ canRoll: submit.canRoll, canSubmit: submit.canSubmit }, { canRoll: false, canSubmit: true });
});

test("player roll actions stay above the scrollable encounter detail", async () => {
  for (const template of ["tracker", "starship-tracker"]) {
    const html = await readFile(new URL(`../templates/${template}.hbs`, import.meta.url), "utf8");
    const dock = html.indexOf('class="player-roll-queue player-action-dock"');
    const precedingNav = html.lastIndexOf("tracker-tabs", dock);
    const content = html.indexOf('class="tracker-content"', dock);
    assert.ok(dock >= 0, `${template} supplies an immediate player action dock`);
    assert.ok(precedingNav < dock && dock < content, `${template} places the action dock before scrollable encounter details`);
  }
  const css = await readFile(new URL("../styles/influence-encounters.css", import.meta.url), "utf8");
  assert.match(css, /\.player-action-dock \{ position: sticky;/);
  assert.match(css, /\.influence-tracker\.player-view \.encounter-header/);
});

test("approved player rolls use PF2e's native visible-or-blind card and preserve reroll tracking", () => {
  const approvedRoll = between("async function openApprovedPlayerRoll", "function reportPlayerRoll");
  assert.match(approvedRoll, /messageMode:\s*request\.type === ["']discovery["'] \? ["']blind["'] : ["']public["']/);
  assert.match(approvedRoll, /skipDialog:\s*true/);
  const rerollTracking = between("async function trackPlayerRollMessage", "Hooks.on(\"preDeleteChatMessage\"");
  assert.match(rerollTracking, /Object\.values\(Store\.all\(\)\)/);
  assert.match(rerollTracking, /message\.rolls\?\.at\(-1\)/);
  assert.match(source, /Hooks\.on\(["']preDeleteChatMessage["']/);
  assert.match(source, /Hooks\.on\(["']updateChatMessage["']/);
  assert.match(source, /check:reroll/);
});

test("creative approaches and recovery controls use the shared check pipeline", () => {
  assert.match(source, /const attempts = speculativeAttemptSkills\(actor, npc, knownSkills\);/);
  assert.match(source, /function starshipProposalChoices\(actor, activity\)/);
  assert.match(source, /proposed: !!localSelection\.starshipProposed/);
  assert.match(source, /Treat <strong>\$\{esc\(skill\.label\)\}<\/strong> as valid for this check/);
  assert.match(source, /async function resolveCheckManually\(/);
  assert.match(source, /async function reopenPlayerRoll\(/);
  assert.match(source, /async function forgetPendingCheck\(/);
  const manualResolution = between("async function resolveApprovedCheckManually", "async function resolveCheckManually");
  assert.match(manualResolution, /requestedDegree !== null/);
  assert.match(manualResolution, /requestedDegree !== undefined/);
  assert.match(manualResolution, /degreeOfSuccess: degree, manual: true/);
  assert.doesNotMatch(manualResolution, /includes\(Number\(requestedDegree\)\) \? Number\(requestedDegree\)/,
    "a dismissed prompt must not coerce null into critical failure");
  const executeCheck = between("async function executeCheck", "async function offerDiscovery");
  assert.match(executeCheck, /request\.type !== "discovery" \|\| \(!skill\.invalidDiscovery && degree >= 2\)/,
    "successful Discovery checks receive a public sanitized result card");
  assert.match(executeCheck, /GM Adjudicated \$\{outcome\}/,
    "manual results are clearly identified without inventing a dice roll");
  assert.match(executeCheck, /messageMode:\s*request\.type === ["']discovery["'] \? ["']blind["'] : ["']public["']/,
    "directly resolved checks keep Discovery blind and all other checks public");
  const executeStarship = between("async function executeStarshipCheck", "async function executeCheck");
  assert.match(executeStarship, /messageMode:\s*["']public["']/,
    "directly resolved starship checks remain public");
});

test("tracker changes native template and title when switching subsystem on the same instance", () => {
  const app = new Tracker();
  for (const type of ["influence", "starship", "research", "chase", "skill", "starship", "influence"]) {
    encounter = { subsystemType: type };
    assert.equal(app._configureRenderParts({}).tracker.template,
      `modules/${moduleId}/templates/${type === "starship" ? "starship-tracker" : "tracker"}.hbs`);
    assert.equal(app.title, type === "starship" ? "Starship Encounter" : "Influence Encounter");
    const options = {};
    app._configureRenderOptions(options);
    assert.equal(options.window.title, app.title);
  }
});

test("numeric and selection prompts preserve zero, cancellation, dismissal, and form values", async () => {
  let mode;
  const DialogV2 = {
    async prompt(config) {
      assert.equal(config.rejectClose, false);
      if (mode === "dismiss") return null;
      const button = mode === "cancel" ? config.buttons[0] : config.ok;
      // Match v14's nullish callback fallback to its action identifier.
      return button.callback({}, { form: { elements: { value: { value: mode } } } }) ?? button.action;
    }
  };
  const prompts = new Function("DialogV2", "esc",
    `${between("async function promptNumber(", "let tracker;")}\nreturn { promptNumber, promptSelect };`
  )(DialogV2, String);
  for (const value of ["0", "-2", "12"]) {
    mode = value;
    assert.equal(await prompts.promptNumber("Points", 1), Number(value));
    assert.equal(await prompts.promptSelect("Select", [[value, value]]), value);
  }
  for (mode of ["cancel", "dismiss"]) {
    assert.equal(await prompts.promptNumber("Points", 1), null);
    assert.equal(await prompts.promptSelect("Select", [["id", "Label"]]), null);
  }
});

test("dirty editor protects cancel and dismiss, awaits save, and refuses to close after failed validation", async () => {
  let choice;
  const closeMethod = between("  async close(options = {})", "\n}\n\nasync function requestStarshipRole");
  const Editor = new Function("ApplicationV2", "DialogV2", "esc", "foundry",
    `return class extends ApplicationV2 { ${closeMethod} };`
  )(ApplicationV2, { wait: async () => choice }, String, {
    applications: { ux: { FormDataExtended: class { constructor() { this.object = { name: "Changed" }; } } } }
  });
  for (choice of [null, "cancel", "discard", "save"]) {
    const app = new Editor();
    app._dirty = true;
    app.encounter = { name: "Original" };
    let saved = false;
    app._save = async data => { await Promise.resolve(); assert.equal(data.name, "Changed"); saved = true; };
    await app.close();
    assert.equal(!!app.closed, ["discard", "save"].includes(choice));
    assert.equal(saved, choice === "save");
  }
  choice = "save";
  const invalid = new Editor();
  invalid._dirty = true;
  invalid.encounter = { name: "Invalid" };
  invalid._save = async () => false;
  await invalid.close();
  assert.equal(invalid.closed, undefined);
});

test("Lore picker filters examples, selects examples, normalizes custom Lore, and resolves dismissal", async () => {
  let config;
  const chooseLore = new Function("DialogV2", "LORE_CATEGORIES", "esc",
    `${between("async function chooseLoreSpecialization(", "class InfluenceTracker extends")}\nreturn chooseLoreSpecialization;`
  )({ wait: options => { config = options; } }, { "Deity *": ["Abadar Lore"] }, String);
  const handlers = {};
  const example = { dataset: { loreExample: "Abadar Lore" }, addEventListener: (type, handler) => { handlers[type] = handler; } };
  let search;
  const app = { element: {
    querySelector: () => ({ addEventListener: (_type, handler) => { search = handler; } }),
    querySelectorAll: () => [example]
  }, close: () => config.close() };
  let result = chooseLore("Deity *");
  config.render({}, app);
  search({ currentTarget: { value: "pharasma" } });
  assert.equal(example.hidden, true);
  search({ currentTarget: { value: "abadar" } });
  assert.equal(example.hidden, false);
  handlers.click({ currentTarget: example });
  assert.equal(await result, "Abadar Lore");
  for (const [input, expected] of [[" River ", "River Lore"], ["River Lore", "River Lore"], ["", null]]) {
    result = chooseLore("Deity *");
    config.buttons[0].callback({}, { form: { elements: { customLore: { value: input } } } });
    config.close();
    assert.equal(await result, expected);
  }
  result = chooseLore("Deity *");
  config.close();
  assert.equal(await result, null);
});

test("typed DC adjustments use PF2e stacking rules", () => {
  const resolveTypedDcAdjustment = new Function(
    `${between("function resolveTypedDcAdjustment", "function applicableBoons")}\nreturn resolveTypedDcAdjustment;`
  )();
  assert.equal(resolveTypedDcAdjustment([
    { type: "circumstance", value: 2 },
    { type: "circumstance", value: 2 }
  ]), 2, "same-type circumstance bonuses do not stack");
  assert.equal(resolveTypedDcAdjustment([
    { type: "circumstance", value: 1 },
    { type: "circumstance", value: 2 },
    { type: "status", value: -1 },
    { type: "status", value: -2 },
    { type: "untyped", value: 1 }
  ]), 1, "use the largest typed bonus, worst typed penalty, and all untyped adjustments");
});

test("target dialog trusts native file-picker markup and saves the native form data", async () => {
  let config, saved;
  const content = { innerHTML: "" };
  const editNpc = new Function("DialogV2", "document", "esc", "foundry", "Store",
    `${between("async function editNpc(", "async function handleNpcDrop(")}\nreturn editNpc;`
  )(class { constructor(options) { config = options; } render() {} },
    { createElement: tag => { assert.equal(tag, "div"); return content; } }, String,
    { applications: { ux: { FormDataExtended: class { constructor(form) { this.object = form; } } } } },
    { save: async record => { saved = record; } });
  const npc = { name: "Original", nickname: "", image: "original.webp" };
  const record = { npcs: [npc] };
  await editNpc(record, npc);
  assert.equal(config.content, content, "pass a trusted DOM div so v14 preserves the custom control");
  assert.match(content.innerHTML, /<file-picker name="image"/);
  assert.equal(config.buttons[1].callback, undefined, "Cancel has no persistence side effect");
  await config.buttons[0].callback({}, { form: { name: " Changed ", nickname: " Test ", image: "custom.webp", background: " Notes " } });
  assert.equal(saved, record);
  assert.deepEqual(npc, { name: "Changed", nickname: "Test", image: "custom.webp", background: "Notes", appearance: "", personality: "" });
});
