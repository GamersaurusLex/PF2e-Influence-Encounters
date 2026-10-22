import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../scripts/influence-encounters.js", import.meta.url), "utf8");
const start = source.indexOf("  async _prepareDirectoryContext(");
assert.notEqual(start, -1);
const method = source.slice(start, source.indexOf("\n  async _onClickEntry(", start));

test("encounter directory filters its own tree without mutating the Journal directory", async () => {
  class Document {
    constructor(name, flags = {}) { this.name = name; this.flags = flags; }
    getFlag(_module, key) { return this.flags[key]; }
  }
  const encounter = new Document("Encounter", { record: true });
  const journal = new Document("Ordinary journal");
  const encounterFolder = new Document("Encounters", { encounterFolder: true });
  const emptyFolder = new Document("Empty encounters", { encounterFolder: true });
  const journalFolder = new Document("Campaign Codex - NPCs");

  for (const childKey of ["children", "folders"]) {
    const nested = Object.freeze({ folder: emptyFolder, entries: Object.freeze([]), [childKey]: Object.freeze([]) });
    const encounters = Object.freeze({
      folder: encounterFolder, entries: Object.freeze([encounter, journal]), [childKey]: Object.freeze([nested])
    });
    const ordinary = Object.freeze({ folder: journalFolder, entries: Object.freeze([journal]), [childKey]: Object.freeze([]) });
    const sharedTree = Object.freeze({
      folder: null, entries: Object.freeze([journal, encounter]), [childKey]: Object.freeze([ordinary, encounters])
    });
    class Base {
      async _prepareDirectoryContext(context) { context.tree = sharedTree; }
    }
    const Sidebar = new Function("Base", "encounterRecordFlag", "MODULE_ID",
      `return class extends Base { ${method} };`
    )(Base, record => record.getFlag("influence-encounters", "record") === true, "influence-encounters");

    for (let render = 0; render < 3; render++) {
      const context = {};
      await new Sidebar()._prepareDirectoryContext(context, {});
      assert.notEqual(context.tree, sharedTree);
      assert.deepEqual(context.tree.entries, [encounter]);
      assert.equal(context.tree[childKey].length, 1);
      const filtered = context.tree[childKey][0];
      assert.notEqual(filtered, encounters);
      assert.equal(filtered.folder, encounterFolder, "retain native Folder identity and methods");
      assert.equal(filtered.entries[0], encounter, "retain native JournalEntry identity and methods");
      assert.deepEqual(filtered.entries, [encounter]);
      assert.equal(filtered[childKey][0].folder, emptyFolder, "retain empty encounter folders");
      assert.notEqual(filtered[childKey][0], nested);
      assert.equal(sharedTree[childKey][0], ordinary, "ordinary folders remain in the shared tree");
      assert.deepEqual(sharedTree.entries, [journal, encounter]);
      assert.deepEqual(encounters.entries, [encounter, journal]);
    }
  }
});
