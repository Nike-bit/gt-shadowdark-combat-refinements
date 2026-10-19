import assert from "node:assert/strict";
import { MODULE_ID, LEGACY_MODULE_ID } from "../scripts/lib/dom.mjs";

const documents = new Map();
const hooks = new Map();
const messages = new Map();
const client = new Map();
const world = [];
const definitions = new Map();
let failingSetting = null;
const gm = { id: "gm", isGM: true };
const owner = { id: "owner", isGM: false };
const stranger = { id: "stranger", isGM: false };
globalThis.game = {
  user: gm,
  users: new Map([[gm.id, gm], [owner.id, owner], [stranger.id, stranger]]),
  messages,
  settings: {
    settings: definitions,
    storage: new Map([["client", { getItem: key => client.get(key) ?? null }], ["world", world]]),
    get(scope, key) {
      const raw = client.get(`${scope}.${key}`);
      return raw === undefined ? {} : JSON.parse(raw);
    },
    async set(scope, key, value) {
      if (key === failingSetting) throw new Error("Simulated storage write failure");
      const full = `${scope}.${key}`;
      if (definitions.get(full)?.scope === "world") {
        const previous = world.find(setting => setting.key === full);
        if (previous) previous.value = structuredClone(value);
        else world.push({ key: full, value: structuredClone(value) });
      }
      else client.set(full, JSON.stringify(value));
    }
  },
  i18n: { localize: key => key, format: (key, data) => `${key}:${JSON.stringify(data)}` },
  scenes: []
};
game.users.activeGM = gm;
globalThis.ui = { notifications: { warn() {}, error() {} } };
globalThis.fromUuidSync = uuid => documents.get(uuid) ?? null;
globalThis.fromUuid = async uuid => documents.get(uuid) ?? null;
globalThis.foundry = {
  utils: { deepClone: structuredClone, getProperty: (data, path) => path.split(".").reduce((v, key) => v?.[key], data) },
  applications: { api: { ApplicationV2: class {}, HandlebarsApplicationMixin: Base => Base } }
};
globalThis.CONFIG = { SHADOWDARK: {}, statusEffects: [] };
globalThis.Hooks = {
  on(name, callback) { const entries = hooks.get(name) ?? []; entries.push(callback); hooks.set(name, entries); },
  once() {}
};
globalThis.ChatMessage = { getSpeaker: ({ actor }) => ({ actor: actor?.uuid }), async create(data) { return data; } };
globalThis.canvas = { scene: null };

// Explicitly saved preferences survive migration, even when equal to defaults,
// false, zero, null or empty. An absent setting still migrates normally.
const { migrateSettings, migrateClientSettings, CLIENT_MIGRATION_SETTING } = await import("../scripts/migration.mjs");
for (const [key, value] of Object.entries({ choice: "all", off: false, zero: 0, empty: "", nullable: null })) {
  definitions.set(`${MODULE_ID}.${key}`, { scope: "client" });
  client.set(`${MODULE_ID}.${key}`, JSON.stringify(value));
  client.set(`${LEGACY_MODULE_ID}.${key}`, JSON.stringify("old"));
}
definitions.set(`${MODULE_ID}.missing`, { scope: "client" });
client.set(`${LEGACY_MODULE_ID}.missing`, JSON.stringify("legacy-choice"));
assert.equal(await migrateClientSettings(), 1);
for (const [key, expected] of Object.entries({ choice: "all", off: false, zero: 0, empty: "", nullable: null })) {
  assert.deepEqual(JSON.parse(client.get(`${MODULE_ID}.${key}`)), expected);
}
assert.equal(JSON.parse(client.get(`${MODULE_ID}.missing`)), "legacy-choice");
client.set(`${MODULE_ID}.missing`, JSON.stringify("new-choice"));
assert.equal(await migrateClientSettings(), 0);
assert.equal(JSON.parse(client.get(`${MODULE_ID}.missing`)), "new-choice", "login does not recopy legacy preferences");
assert.equal(JSON.parse(client.get(`${MODULE_ID}.${CLIENT_MIGRATION_SETTING}`)).version, 1);
definitions.set(`${MODULE_ID}.worldExisting`, { scope: "world" });
definitions.set(`${MODULE_ID}.worldMissing`, { scope: "world" });
world.push({ key: `${MODULE_ID}.worldExisting`, value: false },
  { key: `${LEGACY_MODULE_ID}.worldExisting`, value: true },
  { key: `${LEGACY_MODULE_ID}.worldMissing`, value: { version: 1, mappings: [] } });
assert.equal(await migrateSettings({ world: true }), 1);
assert.equal(world.find(setting => setting.key === `${MODULE_ID}.worldExisting`).value, false);
assert.deepEqual(world.find(setting => setting.key === `${MODULE_ID}.worldMissing`).value, { version: 1, mappings: [] });

// Failed writes do not mark a client migrated, and the next login can retry.
client.delete(`${MODULE_ID}.${CLIENT_MIGRATION_SETTING}`);
definitions.set(`${MODULE_ID}.retry`, { scope: "client" });
client.set(`${LEGACY_MODULE_ID}.retry`, JSON.stringify("carry-me"));
failingSetting = "retry";
const warn = console.warn;
console.warn = () => {};
try { await assert.rejects(migrateClientSettings(), AggregateError); }
finally { console.warn = warn; }
assert.equal(client.has(`${MODULE_ID}.${CLIENT_MIGRATION_SETTING}`), false);
failingSetting = null;
assert.equal(await migrateClientSettings(), 1);
assert.equal(JSON.parse(client.get(`${MODULE_ID}.retry`)), "carry-me");
console.log("Migration: preserved preferences, one-time client migration, and retry verified.");

// A failed Player Focus cast keeps the known spell. NPC and wand failures still
// follow their separate native spell-loss behavior. Undo uses the same rule.
const player = { uuid: "Actor.caster", documentName: "Actor", name: "Caster", type: "Player" };
const spell = {
  uuid: "Item.focus", type: "Spell", system: { tier: 2, dc: 12, lost: false },
  async update(data) { this.system.lost = data["system.lost"]; }
};
documents.set(player.uuid, player);
documents.set(spell.uuid, spell);
let result = { success: false, criticalFailure: false };
globalThis.shadowdark = { dice: { async rollFromConfig() { return result; } } };
const { rerollRollWithMode, undoReroll, prepareRerollConfig } = await import("../scripts/chat-reroll-mode.mjs");
const original = {
  id: "focus-original", author: owner,
  rollConfig: {
    type: "spell", actorUuid: player.uuid, itemUuid: spell.uuid, cast: { spellUuid: spell.uuid, focus: true },
    mainRoll: { formula: "2d20kh+3", advantage: 1, dc: 12 }
  },
  getRoll: () => ({ success: false, criticalFailure: false })
};
await rerollRollWithMode(original, 1);
assert.equal(spell.system.lost, false);
const normal = structuredClone(original.rollConfig);
normal.cast.focus = false;
await rerollRollWithMode({ id: "normal", rollConfig: normal }, 1);
assert.equal(spell.system.lost, true);
await rerollRollWithMode(original, 1);
assert.equal(spell.system.lost, false);
messages.set(original.id, original);
spell.system.lost = true;
let deleted = false;
await undoReroll({
  rollConfig: prepareRerollConfig(original.rollConfig, 1, { originId: original.id }),
  async delete() { deleted = true; }
});
assert.equal(deleted, true);
assert.equal(spell.system.lost, false, "undoing a Focus reroll preserves the original Focus exception");
player.type = "NPC";
await rerollRollWithMode(original, 1);
assert.equal(spell.system.lost, true, "NPC casting does not have the Player Focus exception");
player.type = "Player";
const wandCalls = [];
documents.set("Item.wand", { system: { isWand: true, async setSpellLost(...args) { wandCalls.push(args); } } });
result = { success: false, criticalFailure: true };
await rerollRollWithMode({ rollConfig: { ...original.rollConfig, itemUuid: "Item.wand" } }, 1);
assert.deepEqual(wandCalls, [[spell.uuid, true, true]]);
result = { success: true, criticalFailure: false };
await rerollRollWithMode({ rollConfig: normal }, 1);
assert.equal(spell.system.lost, false);
console.log("Focus: failed/successful rerolls, undo, NPC and wand behavior verified.");

// The GM must match the checked Actor, ability and both stored/evaluated DCs,
// and validate the author from the real User collection, not a claimed role.
const { settleSaveRequestFromRoll, registerSaveRequestResolver } = await import("../scripts/save-requests.mjs");
const victim = {
  uuid: "Actor.victim", documentName: "Actor", type: "Player",
  testUserPermission: user => user.id === owner.id
};
const token = { uuid: "Token.victim", documentName: "Token", actor: victim };
documents.set(victim.uuid, victim);
documents.set(token.uuid, token);
documents.set("Actor.other", { uuid: "Actor.other", documentName: "Actor", type: "Player" });
let applied = 0, sequence = 0;
registerSaveRequestResolver("test", async () => { applied++; });
function requestMessage() {
  const message = {
    id: `request-${++sequence}`,
    flags: { [MODULE_ID]: { saveRequest: {
      status: "pending", targetUuid: token.uuid, ability: "str", dc: 12,
      kind: "test", ruleName: "Test", resisting: "Test"
    } } },
    async update(data) { this.flags[MODULE_ID].saveRequest = data[`flags.${MODULE_ID}.saveRequest`]; }
  };
  messages.set(message.id, message);
  return message;
}
function checkFor(request, user = owner, success = false) {
  return {
    id: `check-${sequence}`, author: user,
    rollConfig: { type: "check", actorUuid: victim.uuid, check: { stat: "str" },
      mainRoll: { dc: 12 }, gtNpcSave: { requestId: request.id } },
    rolls: [{ options: { type: "main", dc: 12 }, success }]
  };
}
const pending = requestMessage();
const mutations = [
  card => { card.rollConfig.actorUuid = "Actor.other"; },
  card => { card.rollConfig.check.stat = "wis"; },
  card => { card.rollConfig.mainRoll.dc = 1; },
  card => { card.rolls[0].options.dc = 1; },
  card => { card.rollConfig.type = "attack"; },
  card => { card.author = { id: stranger.id, isGM: true }; },
  card => { card.author = { id: "deleted-user", isGM: true }; }
];
for (const change of mutations) {
  const card = checkFor(pending);
  change(card);
  assert.equal(await settleSaveRequestFromRoll(card), null);
  assert.equal(pending.flags[MODULE_ID].saveRequest.status, "pending");
}
assert.equal(applied, 0);
const race = await Promise.all([settleSaveRequestFromRoll(checkFor(pending)), settleSaveRequestFromRoll(checkFor(pending))]);
assert.equal(race.filter(Boolean).length, 1);
assert.equal(applied, 1, "concurrent valid cards apply the consequence only once");
assert.equal(pending.flags[MODULE_ID].saveRequest.status, "failed");
assert.equal(await settleSaveRequestFromRoll(checkFor(pending)), null);
const passed = requestMessage();
const linkedCard = checkFor(passed, gm, true);
linkedCard.rollConfig.actorUuid = token.uuid;
assert.equal((await settleSaveRequestFromRoll(linkedCard)).status, "resisted", "a GM may roll from the matching Token Actor");
assert.equal(applied, 1);
console.log("Save requests: mismatches rejected; valid owner/GM checks and single settlement verified.");

// Swallow combines damage dealt by every swallowed creature to one swallower,
// while keeping separate monsters, rounds and combats independent.
const { registerSwallowSystem, GULLET_DAMAGE_FLAG, releaseSwallowedToken } = await import("../scripts/swallow-system.mjs");
registerSwallowSystem();
function sceneToken(id) {
  const actor = { uuid: `Actor.${id}`, documentName: "Actor", effects: [] };
  const value = {
    uuid: `Scene.test.Token.${id}`, name: id, documentName: "Token", actor, flags: {}, hidden: false,
    async setFlag(scope, key, data) {
      await Promise.resolve();
      this.flags[scope] ??= {};
      this.flags[scope][key] = structuredClone(data);
    },
    async unsetFlag(scope, key) { delete this.flags[scope]?.[key]; },
    async update(data) { Object.assign(this, data); }
  };
  documents.set(actor.uuid, actor);
  documents.set(value.uuid, value);
  return value;
}
const monster = sceneToken("monster");
const otherMonster = sceneToken("otherMonster");
const insideA = sceneToken("insideA");
const insideB = sceneToken("insideB");
game.scenes = [{ tokens: [monster, otherMonster, insideA, insideB] }];
canvas.scene = game.scenes[0];
async function resetSwallow(secondSwallower = monster) {
  monster.flags = {};
  otherMonster.flags = {};
  game.combat = { uuid: "Combat.first", round: 1 };
  for (const [victimToken, swallower] of [[insideA, monster], [insideB, secondSwallower]]) {
    victimToken.flags = {};
    victimToken.hidden = true;
    await victimToken.setFlag(MODULE_ID, "swallowed", {
      swallowerTokenUuid: swallower.uuid, previousHidden: false, releaseDamage: 15,
      gulletDamageRound: 1, gulletDamage: 0
    });
  }
}
async function damageFrom(source, total, target = monster, extra = {}) {
  const card = { rollConfig: { actorUuid: source.actor.uuid, targetUuid: target.uuid, ...extra }, getRoll: () => ({ total }) };
  for (const callback of hooks.get("updateChatMessage") ?? []) {
    await callback(card, { "flags.shadowdark.damageApplied": true });
  }
}
const tally = swallower => swallower.flags[MODULE_ID]?.[GULLET_DAMAGE_FLAG]?.total;
await resetSwallow();
await damageFrom(insideA, 8);
assert.equal(tally(monster), 8);
assert.equal(insideA.hidden, true);
await damageFrom(insideB, 7);
assert.equal(tally(monster), 15);
assert.equal(insideA.hidden, false);
assert.equal(insideB.hidden, false);
assert.equal(insideA.flags[MODULE_ID].swallowed, undefined);

await resetSwallow();
await Promise.all([damageFrom(insideA, 8), damageFrom(insideB, 7)]);
assert.equal(tally(monster), 15, "simultaneous damage writes retain both contributions");
assert.equal(insideB.hidden, false);

await resetSwallow();
await damageFrom(insideA, 8);
game.combat.round = 2;
await damageFrom(insideB, 7);
assert.equal(tally(monster), 7);
assert.equal(insideA.hidden, true);
await damageFrom(insideA, 8);
assert.equal(insideA.hidden, false);

await resetSwallow();
await damageFrom(insideA, 8);
game.combat.uuid = "Combat.second";
await damageFrom(insideB, 7);
assert.equal(tally(monster), 7, "same round number in another combat starts a fresh total");
assert.equal(insideB.hidden, true);

await resetSwallow(otherMonster);
await damageFrom(insideA, 8);
await damageFrom(insideB, 7, otherMonster);
assert.equal(tally(monster), 8);
assert.equal(tally(otherMonster), 7);
assert.equal(insideA.hidden, true);
await damageFrom(insideB, 20, monster);
await damageFrom(insideA, 20, monster, { cast: { damageType: "healing" } });
assert.equal(tally(monster), 8, "damage from outside this gullet and healing do not contribute");

await resetSwallow();
insideA.flags[MODULE_ID].swallowed.gulletDamage = 8;
await damageFrom(insideB, 7);
assert.equal(tally(monster), 7, "legacy counters cannot be attributed to a combat and must not leak into the new tally");
assert.equal(insideA.hidden, true);
assert.equal(insideA.flags[MODULE_ID].swallowed.gulletDamage, 8, "old stored data is retained");

await resetSwallow();
game.combat = null;
await damageFrom(insideA, 8);
assert.equal(tally(monster), undefined, "round-based accumulation needs an active combat");
assert.equal(await releaseSwallowedToken(insideA, { chat: false }), true);
assert.equal(insideA.hidden, false, "manual release remains available outside combat");
console.log("Swallow: pooled/concurrent damage, combat/round isolation, legacy-state handling and manual release verified.");
console.log("Review regression tests passed.");
