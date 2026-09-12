import { F, L, MODULE_ID, enrichHTML } from "./lib/dom.mjs";

export const ENABLE_MISHAPS_SETTING = "enableAutomaticSpellMishaps";
export const MISHAP_CONFIG_SETTING = "spellMishapMappings";
export const SPELL_MISHAP_FLAG_KEY = "spellMishap";
const CONFIG_VERSION = 1;

export const DEFAULT_WIZARD_MISHAP_MAPPING = Object.freeze({
  classKey: "wizard",
  className: "Wizard",
  tables: Object.freeze({
    tier12: "Compendium.shadowdark.rollable-tables.RollTable.NiiJKAiBjpPAj5U1",
    tier34: "Compendium.shadowdark.rollable-tables.RollTable.tXhX6Iv3rOc6GlF6",
    tier5: "Compendium.shadowdark.rollable-tables.RollTable.q83PUKIAznuLpqSr"
  })
});

export const DEFAULT_MISHAP_CONFIG = Object.freeze({
  version: CONFIG_VERSION,
  mappings: Object.freeze([DEFAULT_WIZARD_MISHAP_MAPPING])
});

function clone(value) {
  return globalThis.foundry?.utils?.deepClone?.(value) ?? structuredClone(value);
}

export function normalizeClassKey(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  if (typeof text.slugify === "function") return text.slugify();
  return text.normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeMapping(value) {
  const classKey = normalizeClassKey(value?.classKey);
  return {
    classKey,
    className: String(value?.className ?? classKey).trim() || classKey,
    tables: {
      tier12: String(value?.tables?.tier12 ?? "").trim(),
      tier34: String(value?.tables?.tier34 ?? "").trim(),
      tier5: String(value?.tables?.tier5 ?? "").trim()
    }
  };
}

export function normalizeMishapConfig(value) {
  const source = value?.version === CONFIG_VERSION && Array.isArray(value.mappings)
    ? value.mappings
    : DEFAULT_MISHAP_CONFIG.mappings;
  return {
    version: CONFIG_VERSION,
    mappings: source.map(normalizeMapping).filter(mapping => mapping.classKey)
  };
}

export function storedMishapConfig() {
  return normalizeMishapConfig(game.settings.get(MODULE_ID, MISHAP_CONFIG_SETTING));
}

function values(collection) {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection;
  if (typeof collection.values === "function") return Array.from(collection.values());
  if (typeof collection[Symbol.iterator] === "function") return Array.from(collection);
  if (typeof collection === "object") return Object.values(collection);
  return [];
}

function isCastingClass(item) {
  return item?.type === "Class" && Boolean(item.system?.spellcasting?.ability);
}

function classKeys(item) {
  return [...new Set([
    normalizeClassKey(item?.system?.spellcasting?.class),
    normalizeClassKey(item?.name)
  ].filter(Boolean))];
}

function addClassOption(options, key, label = key) {
  const normalized = normalizeClassKey(key);
  if (!normalized) return;
  const rawLabel = String(label || normalized).trim();
  const displayLabel = rawLabel === normalized
    ? rawLabel.replace(/(^|[\s_-])(\p{L})/gu, (_match, separator, letter) => `${separator}${letter.toLocaleUpperCase()}`)
    : rawLabel;
  const existing = options.get(normalized);
  if (!existing || existing.label === existing.key) {
    options.set(normalized, { key: normalized, label: displayLabel });
  }
}

export async function discoverCastingClasses() {
  const options = new Map();
  for (const actor of values(game.actors)) {
    for (const key of values(actor?.system?.spellcasting?.classes)) addClassOption(options, key);
    for (const item of values(actor?.items)) {
      if (!isCastingClass(item)) continue;
      for (const key of classKeys(item)) addClassOption(options, key, item.name);
    }
  }
  for (const item of values(game.items)) {
    if (!isCastingClass(item)) continue;
    for (const key of classKeys(item)) addClassOption(options, key, item.name);
  }

  for (const mapping of storedMishapConfig().mappings) {
    addClassOption(options, mapping.classKey, mapping.className);
  }
  addClassOption(options, "wizard", "Wizard");
  return Array.from(options.values()).sort((a, b) => a.label.localeCompare(b.label));
}

export async function validateMishapMappings(mappings) {
  const seen = new Set();
  for (const value of mappings) {
    const mapping = normalizeMapping(value);
    if (!mapping.classKey) continue;
    if (seen.has(mapping.classKey)) {
      throw new Error(F("GTNPCMULTIATTACK.Mishaps.DuplicateClass", { class: mapping.className }));
    }
    seen.add(mapping.classKey);
    for (const tableUuid of Object.values(mapping.tables)) {
      if (!tableUuid) continue;
      let table = null;
      try {
        table = await fromUuid(tableUuid);
      }
      catch (_error) {
        // Invalid or inaccessible UUIDs use the same localized validation message.
      }
      if (table?.documentName !== "RollTable") {
        throw new Error(F("GTNPCMULTIATTACK.Mishaps.InvalidTable", { uuid: tableUuid }));
      }
    }
  }
}

export async function saveMishapMappings(mappings) {
  if (!game.user.isGM) return null;
  const normalized = mappings.map(normalizeMapping).filter(mapping => mapping.classKey);
  await validateMishapMappings(normalized);
  const config = { version: CONFIG_VERSION, mappings: normalized };
  await game.settings.set(MODULE_ID, MISHAP_CONFIG_SETTING, config);
  return config;
}

export function tierBand(tier) {
  const value = Math.floor(Number(tier));
  if ([1, 2].includes(value)) return "tier12";
  if ([3, 4].includes(value)) return "tier34";
  if (value === 5) return "tier5";
  return null;
}

/**
 * True only on the one client that should perform world-changing automation.
 * Mirrors the guard swallow-system.mjs already uses.
 */
export function isActiveGm() {
  return game.users?.activeGM?.id ? game.users.activeGM.id === game.user.id : game.user.isGM;
}

function rollConfig(message) {
  return message?.rollConfig ?? message?.getFlag?.("shadowdark", "rollConfig") ?? null;
}

function mainRoll(message) {
  return message?.getRoll?.("main")
    ?? values(message?.rolls).find(roll => roll?.options?.type === "main")
    ?? null;
}

function messageAuthorId(message) {
  return message?.author?.id ?? message?.user?.id ?? message?._source?.user ?? null;
}

async function spellClassCandidates(spell, actor, config) {
  const classDocuments = (await Promise.all(
    values(spell?.system?.class).map(uuid => fromUuid(uuid))
  )).filter(isCastingClass);
  let candidates = classDocuments.map(item => ({
    item,
    keys: classKeys(item),
    label: item.name,
    ability: item.system?.spellcasting?.ability ?? ""
  }));

  const actorClasses = new Set(values(actor?.system?.spellcasting?.classes).map(normalizeClassKey));
  const triggeringItem = config?.itemUuid ? await fromUuid(config.itemUuid) : null;
  const castFromItem = triggeringItem && triggeringItem.uuid !== spell.uuid;
  const allowAllItems = castFromItem && actor?.system?.spellcasting?.allowAllItems;
  if (actor?.type === "Player" && actorClasses.size && !allowAllItems) {
    candidates = candidates.filter(candidate => candidate.keys.some(key => actorClasses.has(key)));
  }

  const ability = String(config?.cast?.ability ?? "");
  const abilityMatches = ability ? candidates.filter(candidate => candidate.ability === ability) : [];
  return abilityMatches.length ? abilityMatches : candidates;
}

export async function resolveMishapSelection(message) {
  const config = rollConfig(message);
  if (config?.type !== "spell") return null;
  const roll = mainRoll(message);
  if (roll?.criticalFailure !== true) return null;
  const spellUuid = config.cast?.spellUuid ?? config.itemUuid;
  const spell = spellUuid ? await fromUuid(spellUuid) : null;
  if (!spell?.system?.isSpell) return null;
  const band = tierBand(spell.system.tier);
  if (!band) return null;
  const actor = config.actorUuid ? await fromUuid(config.actorUuid) : null;
  const candidates = await spellClassCandidates(spell, actor, config);
  const mappings = storedMishapConfig().mappings;
  for (const candidate of candidates) {
    const mapping = mappings.find(entry => candidate.keys.includes(entry.classKey));
    const tableUuid = mapping?.tables?.[band];
    if (mapping && tableUuid) {
      return {
        actor,
        spell,
        tier: Math.floor(Number(spell.system.tier)),
        band,
        classKey: mapping.classKey,
        className: candidate.label || mapping.className,
        tableUuid
      };
    }
  }
  return null;
}

async function renderMishapResult(selection, table, draw) {
  const results = await Promise.all((draw.results ?? []).map(async result => {
    if (typeof result.getHTML === "function") return result.getHTML();
    const description = result.description ?? result.text ?? result.name ?? "";
    return enrichHTML(description);
  }));
  return foundry.applications.handlebars.renderTemplate(
    `modules/${MODULE_ID}/templates/spell-mishap-result.hbs`,
    {
      title: L("GTNPCMULTIATTACK.Mishaps.ResultTitle"),
      context: F("GTNPCMULTIATTACK.Mishaps.ResultContext", {
        class: selection.className,
        tier: selection.tier
      }),
      tableName: table.name,
      rollTotal: draw.roll?.total ?? "",
      results
    }
  );
}

export async function processSpellMishap(message) {
  if (!game.settings.get(MODULE_ID, ENABLE_MISHAPS_SETTING)) return null;
  if (!isActiveGm()) return null;
  const existing = message.getFlag?.(MODULE_ID, SPELL_MISHAP_FLAG_KEY);
  if (existing?.status) return null;
  const selection = await resolveMishapSelection(message);
  if (!selection) return null;

  const table = await fromUuid(selection.tableUuid);
  if (table?.documentName !== "RollTable") {
    ui.notifications.warn(F("GTNPCMULTIATTACK.Mishaps.InvalidTable", { uuid: selection.tableUuid }));
    return null;
  }

  await message.setFlag(MODULE_ID, SPELL_MISHAP_FLAG_KEY, { status: "processing" });
  try {
    const draw = await table.draw({ displayChat: false });
    if (!draw?.results?.length) throw new Error(L("GTNPCMULTIATTACK.Mishaps.NoResult"));
    const resultHtml = await renderMishapResult(selection, table, draw);
    const state = {
      status: "complete",
      classKey: selection.classKey,
      className: selection.className,
      tier: selection.tier,
      band: selection.band,
      tableUuid: selection.tableUuid,
      tableName: table.name,
      rollTotal: draw.roll?.total ?? null
    };
    await message.update({
      content: `${message.content}${resultHtml}`,
      [`flags.${MODULE_ID}.${SPELL_MISHAP_FLAG_KEY}`]: state
    });
    return state;
  }
  catch (error) {
    // Clear the marker rather than replacing it with a terminal state: leaving
    // "processing" (or "failed") behind would make the early return above
    // suppress every future attempt at this message for good.
    await message.unsetFlag(MODULE_ID, SPELL_MISHAP_FLAG_KEY).catch(() => {});
    ui.notifications.error(F("GTNPCMULTIATTACK.Mishaps.RollFailed", { error: error.message }));
    console.error(`${MODULE_ID} | Automatic spell mishap failed.`, error);
    return null;
  }
}

export function registerSpellMishapSettings() {
  game.settings.register(MODULE_ID, ENABLE_MISHAPS_SETTING, {
    name: L("GTNPCMULTIATTACK.Settings.EnableAutomaticSpellMishaps"),
    hint: L("GTNPCMULTIATTACK.Settings.EnableAutomaticSpellMishapsHint"),
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });
  game.settings.register(MODULE_ID, MISHAP_CONFIG_SETTING, {
    scope: "world",
    config: false,
    type: Object,
    default: clone(DEFAULT_MISHAP_CONFIG)
  });
}

export function registerSpellMishapHooks() {
  Hooks.on("createChatMessage", message => {
    if (!isActiveGm()) return;
    void processSpellMishap(message).catch(error => {
      console.error(`${MODULE_ID} | Automatic spell mishap processing failed.`, error);
    });
  });
}
