import assert from "node:assert/strict";
import { prepareSpellcastingDifficulty, spellcastingDifficulty } from "../scripts/spellcasting-difficulty.mjs";

const spells = new Map();
globalThis.fromUuidSync = uuid => spells.get(uuid) ?? null;

for (const tier of [1, 2, 3, 4, 5]) {
  const spell = { uuid: `Item.tier${tier}`, type: "Spell", system: { tier, dc: 10 + tier } };
  spells.set(spell.uuid, spell);
  for (const ac of [8, 12, 18, 25]) {
    for (const actorType of ["Player", "NPC"]) {
      const config = {
        actorUuid: `Actor.${actorType}`, type: "spell", itemUuid: spell.uuid,
        cast: { spellUuid: spell.uuid }, targetUuid: `Token.ac${ac}`,
        mainRoll: { dc: ac, formula: "d20+3", advantage: 0 },
        damageRoll: { formula: "2d6" }
      };
      const expected = structuredClone(config);
      expected.mainRoll.dc = 10 + tier;
      assert.equal(prepareSpellcastingDifficulty(config), 10 + tier);
      assert.deepEqual(config, expected, "only casting difficulty changes; target and formulas survive");
    }
  }
}

// Scroll/wand itemUuid identifies the casting source, not the spell being cast.
for (const source of ["Scroll", "Wand"]) {
  const config = {
    type: "spell", itemUuid: `Item.${source}`, cast: { spellUuid: "Item.tier3" },
    mainRoll: { dc: 22 }, targetUuid: "Token.armored"
  };
  assert.equal(prepareSpellcastingDifficulty(config), 13);
  assert.equal(config.itemUuid, `Item.${source}`);
}

// A freshly resolved compendium spell can be supplied before casting, even
// when synchronous resolution cannot find it in Foundry's cache.
const unloaded = { type: "Spell", system: { tier: 4 } };
const config = { type: "spell" };
assert.equal(prepareSpellcastingDifficulty(config, unloaded), 14);
assert.equal(config.mainRoll.dc, 14);
assert.equal(spellcastingDifficulty({ type: "Spell", system: { tier: 2, dc: 16 } }), 16,
  "respect the Spell Item's effective DC when the system supplies one");

for (const input of [undefined, {}, { type: "Weapon", system: { dc: 18 } },
  { type: "Spell", system: { tier: null, dc: "" } },
  { type: "Spell", system: { tier: "invalid", dc: NaN } }]) {
  assert.equal(spellcastingDifficulty(input), null);
}

for (const type of ["attack", "check", "ability"]) {
  const other = { type, itemUuid: "Item.tier3", mainRoll: { dc: 18 } };
  assert.equal(prepareSpellcastingDifficulty(other), null);
  assert.equal(other.mainRoll.dc, 18, "weapon AC and attribute difficulties are untouched");
}
const missing = { type: "spell", itemUuid: "Item.missing", mainRoll: { dc: 12 } };
assert.equal(prepareSpellcastingDifficulty(missing), null);
assert.equal(missing.mainRoll.dc, 12);

console.log("Spellcasting difficulty regression tests passed.");
