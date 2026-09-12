import { LEGACY_MODULE_ID, MODULE_ID } from "./lib/dom.mjs";

export const MIGRATION_SETTING = "legacyIdMigration";
const MIGRATION_VERSION = 2;

/**
 * Document flags this module owns. Each is copied from the legacy namespace into
 * the current one and then removed from the legacy namespace.
 */
const DOCUMENT_FLAGS = Object.freeze({
  Actor: ["favoriteSpells"],
  Item: ["customRules", "customRulesEnabled"],
  Token: ["swallowed"]
});

function isActiveGm() {
  return game.users?.activeGM?.id ? game.users.activeGM.id === game.user.id : game.user.isGM;
}

function legacyFlagData(document) {
  return document?.flags?.[LEGACY_MODULE_ID] ?? null;
}

/**
 * Flags this module used to own and no longer reads. They are removed from both
 * namespaces so they do not linger on player gear forever.
 */
const RETIRED_FLAGS = Object.freeze({ Item: ["metallic"] });

/** Copy one document's legacy flags across, returning the update or null. */
export function legacyFlagUpdate(document, flagNames, retiredNames = []) {
  const legacy = legacyFlagData(document);
  const current = document?.flags?.[MODULE_ID] ?? null;
  const update = {};
  let changed = false;
  for (const name of flagNames) {
    if (!legacy || legacy[name] === undefined) continue;
    if (current?.[name] === undefined) update[`flags.${MODULE_ID}.${name}`] = legacy[name];
    update[`flags.${LEGACY_MODULE_ID}.-=${name}`] = null;
    changed = true;
  }
  for (const name of retiredNames) {
    if (legacy?.[name] !== undefined) {
      update[`flags.${LEGACY_MODULE_ID}.-=${name}`] = null;
      changed = true;
    }
    if (current?.[name] !== undefined) {
      update[`flags.${MODULE_ID}.-=${name}`] = null;
      changed = true;
    }
  }
  return changed ? update : null;
}

async function migrateDocuments(documents, flagNames, label, retiredNames = []) {
  let migrated = 0;
  for (const document of documents) {
    const update = legacyFlagUpdate(document, flagNames, retiredNames);
    if (!update) continue;
    try {
      await document.update(update, { render: false });
      migrated += 1;
    }
    catch (error) {
      console.error(`${MODULE_ID} | Could not migrate ${label} ${document.uuid}.`, error);
    }
  }
  return migrated;
}

function actorItems(actor) {
  return Array.from(actor?.items ?? []);
}

/** Every Item in the world, embedded or not. */
function allItems() {
  return [
    ...Array.from(game.items ?? []),
    ...Array.from(game.actors ?? []).flatMap(actorItems)
  ];
}

/** Every TokenDocument in the world, across all scenes. */
function allTokens() {
  return Array.from(game.scenes ?? []).flatMap(scene => [
    ...Array.from(scene.tokens ?? []),
    ...Array.from(scene.tokens ?? []).flatMap(token => actorItems(token.actor))
  ]);
}

function allTokenDocuments() {
  return Array.from(game.scenes ?? []).flatMap(scene => Array.from(scene.tokens ?? []));
}

/** Raw value of a legacy setting, whichever storage backend holds it. */
function legacySettingValue(name, scope) {
  const key = `${LEGACY_MODULE_ID}.${name}`;
  try {
    if (scope === "world") {
      const stored = game.settings.storage.get("world")?.find?.(setting => setting.key === key);
      return stored === undefined || stored === null ? undefined : stored.value;
    }
    const raw = game.settings.storage.get("client")?.getItem?.(key)
      ?? globalThis.localStorage?.getItem?.(key);
    if (raw === null || raw === undefined) return undefined;
    try { return JSON.parse(raw); }
    catch (_error) { return raw; }
  }
  catch (error) {
    console.warn(`${MODULE_ID} | Could not read legacy setting ${key}.`, error);
    return undefined;
  }
}

/**
 * Copy stored settings from the legacy module id. World-scope settings are only
 * touched by the active GM; every user migrates their own client preferences.
 */
export async function migrateSettings({ world = false } = {}) {
  let migrated = 0;
  for (const [key, definition] of game.settings.settings ?? []) {
    if (!key.startsWith(`${MODULE_ID}.`)) continue;
    const name = key.slice(MODULE_ID.length + 1);
    if (name === MIGRATION_SETTING) continue;
    const isWorld = definition.scope === "world";
    if (isWorld !== world) continue;
    const value = legacySettingValue(name, isWorld ? "world" : "client");
    if (value === undefined) continue;
    try {
      await game.settings.set(MODULE_ID, name, value);
      migrated += 1;
    }
    catch (error) {
      console.warn(`${MODULE_ID} | Could not carry over the ${name} setting.`, error);
    }
  }
  return migrated;
}

/**
 * One-shot migration from the gt-npc-multiattack identity.
 *
 * Runs at "ready" so that scenes, actors and items are all available. Document
 * and world-setting migration happens on the active GM's client only; client
 * preferences migrate for whoever is logged in.
 */
export async function migrateLegacyModuleId() {
  await migrateSettings({ world: false });
  if (!isActiveGm()) return null;

  const state = game.settings.get(MODULE_ID, MIGRATION_SETTING);
  if (Number(state?.version) >= MIGRATION_VERSION) return null;

  const summary = {
    version: MIGRATION_VERSION,
    at: Date.now(),
    settings: await migrateSettings({ world: true }),
    actors: await migrateDocuments(Array.from(game.actors ?? []), DOCUMENT_FLAGS.Actor, "Actor"),
    items: await migrateDocuments(allItems(), DOCUMENT_FLAGS.Item, "Item", RETIRED_FLAGS.Item),
    tokens: await migrateDocuments(allTokenDocuments(), DOCUMENT_FLAGS.Token, "Token")
  };
  // Unlinked token actors carry their own embedded Items.
  summary.items += await migrateDocuments(
    allTokens().filter(document => document.documentName === "Item"),
    DOCUMENT_FLAGS.Item,
    "Item",
    RETIRED_FLAGS.Item
  );

  await game.settings.set(MODULE_ID, MIGRATION_SETTING, summary);
  const touched = summary.settings + summary.actors + summary.items + summary.tokens;
  if (touched) {
    console.log(`${MODULE_ID} | Migrated ${touched} record(s) from ${LEGACY_MODULE_ID}.`, summary);
    ui.notifications.info(game.i18n.format("GTNPCMULTIATTACK.Migration.Completed", { count: touched }));
  }
  return summary;
}

export function registerMigration() {
  game.settings.register(MODULE_ID, MIGRATION_SETTING, {
    scope: "world",
    config: false,
    type: Object,
    default: {}
  });
}

export const migrationTestApi = Object.freeze({
  legacyFlagUpdate,
  migrateSettings
});
