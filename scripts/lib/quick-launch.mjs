import { L, MODULE_ID } from "./dom.mjs";

// What the Token HUD's quick buttons do, and what they remember. Shared by the
// HUD launchers and the roll-dialog selectors so neither imports the other.

export const ROLL_INTERFACE_SETTING = "rollInterface";
export const ROLL_INTERFACE_MERGED = "merged";
export const ROLL_INTERFACE_SEPARATE = "separate";
export const UNARMED_SETTING = "includeUnarmedAttacks";
export const QUICK_LAUNCH_MEMORY_SETTING = "quickLaunchMemory";
const MAX_MEMORY_ENTRIES = 250;

let memoryCache = null;
let memoryWrite = Promise.resolve();

export function registerQuickLaunchSettings() {
  // One choice covers both halves of the 1.1 design: where the quick buttons
  // lead and whether the roll dialog carries the weapon rows / spell column.
  game.settings.register(MODULE_ID, ROLL_INTERFACE_SETTING, {
    name: L("GTNPCMULTIATTACK.Settings.RollInterface"),
    hint: L("GTNPCMULTIATTACK.Settings.RollInterfaceHint"),
    scope: "client",
    config: true,
    type: String,
    choices: {
      [ROLL_INTERFACE_MERGED]: L("GTNPCMULTIATTACK.Settings.RollInterfaceMerged"),
      [ROLL_INTERFACE_SEPARATE]: L("GTNPCMULTIATTACK.Settings.RollInterfaceSeparate")
    },
    default: ROLL_INTERFACE_MERGED
  });
  game.settings.register(MODULE_ID, UNARMED_SETTING, {
    name: L("GTNPCMULTIATTACK.Settings.IncludeUnarmedAttacks"),
    hint: L("GTNPCMULTIATTACK.Settings.IncludeUnarmedAttacksHint"),
    scope: "world",
    config: true,
    type: Boolean,
    default: false
  });
  game.settings.register(MODULE_ID, QUICK_LAUNCH_MEMORY_SETTING, {
    scope: "client",
    config: false,
    type: Object,
    default: {}
  });
}

function setting(key, fallback) {
  try { return game.settings.get(MODULE_ID, key); }
  catch (_error) { return fallback; }
}

/** "merged": the roll dialog chooses; "separate": palettes on the HUD, plain dialogs. */
export function rollInterface() {
  return setting(ROLL_INTERFACE_SETTING, ROLL_INTERFACE_MERGED) === ROLL_INTERFACE_SEPARATE
    ? ROLL_INTERFACE_SEPARATE
    : ROLL_INTERFACE_MERGED;
}

/** "dialog": the quick buttons open the roll dialog; "palette": the separate palette. */
export function quickButtonMode() {
  return rollInterface() === ROLL_INTERFACE_SEPARATE ? "palette" : "dialog";
}

export function dialogSelectorsEnabled() {
  return rollInterface() === ROLL_INTERFACE_MERGED;
}

export function unarmedAttacksEnabled() {
  return setting(UNARMED_SETTING, false) === true;
}

function memory() {
  if (!memoryCache) {
    const stored = setting(QUICK_LAUNCH_MEMORY_SETTING, {});
    memoryCache = stored && typeof stored === "object" && !Array.isArray(stored) ? { ...stored } : {};
  }
  return memoryCache;
}

/** The last attack or spell launched for this actor on this client, if any. */
export function rememberedLaunch(actorUuid, kind) {
  if (!actorUuid) return null;
  const entry = memory()[actorUuid];
  return entry && typeof entry === "object" ? entry[kind] ?? null : null;
}

export async function rememberLaunch(actorUuid, kind, value) {
  if (!actorUuid || !kind) return;
  const store = memory();
  const entry = { ...(store[actorUuid] ?? {}), [kind]: value };
  delete store[actorUuid];
  store[actorUuid] = entry;
  memoryCache = Object.fromEntries(Object.entries(store).slice(-MAX_MEMORY_ENTRIES));
  const snapshot = structuredClone(memoryCache);
  memoryWrite = memoryWrite
    .catch(() => undefined)
    .then(() => game.settings.set(MODULE_ID, QUICK_LAUNCH_MEMORY_SETTING, snapshot));
  await memoryWrite;
}

export const quickLaunchTestApi = Object.freeze({
  rollInterface,
  quickButtonMode,
  dialogSelectorsEnabled,
  rememberLaunch,
  rememberedLaunch,
  resetMemoryCache: () => { memoryCache = null; }
});
