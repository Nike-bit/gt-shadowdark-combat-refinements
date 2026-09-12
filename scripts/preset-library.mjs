import { validateCustomRules } from "./custom-rule-schema.mjs";
import { L, MODULE_ID, escapeHtml } from "./lib/dom.mjs";

const LIBRARY_SETTING = "customRulePresets";
const LIBRARY_VERSION = 1;
const MAX_PRESETS = 100;

const ApplicationV2 = globalThis.foundry?.applications?.api?.ApplicationV2 ?? class {};
const HandlebarsApplicationMixin = globalThis.foundry?.applications?.api?.HandlebarsApplicationMixin
  ?? (Base => Base);

export const BUILTIN_PRESETS = Object.freeze([
  {
    id: "gore",
    nameKey: "GTNPCMULTIATTACK.Presets.GoreName",
    descriptionKey: "GTNPCMULTIATTACK.Presets.GoreDescription",
    categoryKey: "GTNPCMULTIATTACK.Presets.MultiattackCategory",
    tagKeys: ["GTNPCMULTIATTACK.Presets.TagMelee", "GTNPCMULTIATTACK.Presets.TagDamage"],
    schemaVersion: 1,
    rules: [
      {
        id: "gore",
        name: "Gore",
        enabled: true,
        trigger: "afterAttackBatch",
        scope: "attackSession",
        conditions: [{ type: "sameTargetHits", minimum: 2 }],
        effects: [{ type: "extraDamageDie", count: 1, oncePerTarget: true }]
      }
    ]
  },
  {
    id: "crush",
    nameKey: "GTNPCMULTIATTACK.Presets.CrushName",
    descriptionKey: "GTNPCMULTIATTACK.Presets.CrushDescription",
    categoryKey: "GTNPCMULTIATTACK.Presets.MultiattackCategory",
    tagKeys: ["GTNPCMULTIATTACK.Presets.TagMelee", "GTNPCMULTIATTACK.Presets.TagDamage"],
    schemaVersion: 1,
    rules: [
      {
        id: "crush",
        name: "Crush",
        enabled: true,
        trigger: "afterAttackBatch",
        scope: "attackSession",
        conditions: [{ type: "sameTargetHits", minimum: 2 }],
        effects: [{ type: "extraDamageDie", count: 1, oncePerTarget: true }]
      }
    ]
  },
  {
    id: "charge",
    nameKey: "GTNPCMULTIATTACK.Presets.ChargeName",
    descriptionKey: "GTNPCMULTIATTACK.Presets.ChargeDescription",
    categoryKey: "GTNPCMULTIATTACK.Presets.ConditionalCategory",
    tagKeys: ["GTNPCMULTIATTACK.Presets.TagMelee", "GTNPCMULTIATTACK.Presets.TagDamage"],
    schemaVersion: 1,
    rules: [
      {
        id: "charge",
        name: "Charge",
        enabled: true,
        activation: "manual",
        attackLimit: 1,
        trigger: "afterAttackBatch",
        scope: "currentBatch",
        conditions: [{ type: "sameTargetHits", minimum: 1 }],
        effects: [{ type: "extraBaseDamage", multiplier: 2, oncePerTarget: true }]
      }
    ]
  },
  {
    id: "ambush",
    nameKey: "GTNPCMULTIATTACK.Presets.AmbushName",
    descriptionKey: "GTNPCMULTIATTACK.Presets.AmbushDescription",
    categoryKey: "GTNPCMULTIATTACK.Presets.ConditionalCategory",
    tagKeys: ["GTNPCMULTIATTACK.Presets.TagMelee", "GTNPCMULTIATTACK.Presets.TagDamage"],
    schemaVersion: 1,
    rules: [
      {
        id: "ambush",
        name: "Ambush",
        enabled: true,
        activation: "manual",
        trigger: "afterAttackBatch",
        scope: "currentBatch",
        conditions: [{ type: "sameTargetHits", minimum: 1 }],
        effects: [{ type: "extraDamageDie", count: 1, oncePerTarget: true }]
      }
    ]
  },
  {
    id: "rampage",
    nameKey: "GTNPCMULTIATTACK.Presets.RampageName",
    descriptionKey: "GTNPCMULTIATTACK.Presets.RampageDescription",
    categoryKey: "GTNPCMULTIATTACK.Presets.ConditionalCategory",
    tagKeys: ["GTNPCMULTIATTACK.Presets.TagMelee", "GTNPCMULTIATTACK.Presets.TagDamage"],
    schemaVersion: 1,
    rules: [
      {
        id: "rampage",
        name: "Rampage",
        enabled: true,
        activation: "manual",
        attackLimit: 1,
        trigger: "afterAttackBatch",
        scope: "currentBatch",
        conditions: [{ type: "sameTargetHits", minimum: 1 }],
        effects: [{ type: "extraBaseDamage", multiplier: 2, oncePerTarget: true }]
      }
    ]
  },
  {
    id: "backstab",
    nameKey: "GTNPCMULTIATTACK.Presets.BackstabName",
    descriptionKey: "GTNPCMULTIATTACK.Presets.BackstabDescription",
    categoryKey: "GTNPCMULTIATTACK.Presets.ConditionalCategory",
    tagKeys: ["GTNPCMULTIATTACK.Presets.TagMelee", "GTNPCMULTIATTACK.Presets.TagDamage"],
    schemaVersion: 1,
    rules: [
      {
        id: "backstab",
        name: "Backstab",
        enabled: true,
        activation: "manual",
        trigger: "afterAttackBatch",
        scope: "currentBatch",
        conditions: [{ type: "sameTargetHits", minimum: 1 }],
        effects: [{ type: "extraBaseDamage", multiplier: 1, oncePerTarget: true }]
      }
    ]
  },
  {
    id: "assassinate",
    nameKey: "GTNPCMULTIATTACK.Presets.AssassinateName",
    descriptionKey: "GTNPCMULTIATTACK.Presets.AssassinateDescription",
    categoryKey: "GTNPCMULTIATTACK.Presets.ConditionalCategory",
    tagKeys: ["GTNPCMULTIATTACK.Presets.TagMelee", "GTNPCMULTIATTACK.Presets.TagDamage"],
    schemaVersion: 1,
    rules: [
      {
        id: "assassinate",
        name: "Assassinate",
        enabled: true,
        activation: "manual",
        trigger: "afterAttackBatch",
        scope: "currentBatch",
        conditions: [{ type: "sameTargetHits", minimum: 1 }],
        effects: [{ type: "extraBaseDamage", multiplier: 2, oncePerTarget: true }]
      }
    ]
  },
  {
    id: "algae-eater",
    nameKey: "GTNPCMULTIATTACK.Presets.AlgaeEaterName",
    descriptionKey: "GTNPCMULTIATTACK.Presets.AlgaeEaterDescription",
    categoryKey: "GTNPCMULTIATTACK.Presets.ConditionalCategory",
    tagKeys: ["GTNPCMULTIATTACK.Presets.TagMelee", "GTNPCMULTIATTACK.Presets.TagDamage"],
    schemaVersion: 1,
    rules: [{
      id: "algae-eater", name: "Algae-Eater", enabled: true, activation: "manual",
      trigger: "beforeAttackBatch", scope: "currentBatch",
      conditions: [],
      effects: [{ type: "forceAdvantage" }, { type: "selfDamage", formula: "1d4" }]
    }]
  },
  {
    id: "shatter",
    nameKey: "GTNPCMULTIATTACK.Presets.ShatterName",
    descriptionKey: "GTNPCMULTIATTACK.Presets.ShatterDescription",
    categoryKey: "GTNPCMULTIATTACK.Presets.ConditionalCategory",
    tagKeys: ["GTNPCMULTIATTACK.Presets.TagMelee", "GTNPCMULTIATTACK.Presets.TagInventory"],
    schemaVersion: 1,
    rules: [{
      id: "shatter", name: "Shatter", enabled: true, activation: "manual",
      trigger: "afterAttackBatch", scope: "currentBatch",
      conditions: [{ type: "sameTargetHits", minimum: 1 }],
      effects: [{ type: "shatterGear", oncePerTarget: false }]
    }]
  },
  {
    id: "mob",
    nameKey: "GTNPCMULTIATTACK.Presets.MobName",
    descriptionKey: "GTNPCMULTIATTACK.Presets.MobDescription",
    categoryKey: "GTNPCMULTIATTACK.Presets.ConditionalCategory",
    tagKeys: ["GTNPCMULTIATTACK.Presets.TagMelee", "GTNPCMULTIATTACK.Presets.TagDamage"],
    schemaVersion: 1,
    rules: [{
      id: "mob", name: "Mob", enabled: true, activation: "manual",
      trigger: "beforeAttackBatch", scope: "currentBatch",
      conditions: [],
      effects: [{ type: "damageBonus", amount: 1 }]
    }]
  },
  {
    id: "pod-hunter",
    nameKey: "GTNPCMULTIATTACK.Presets.PodHunterName",
    descriptionKey: "GTNPCMULTIATTACK.Presets.PodHunterDescription",
    categoryKey: "GTNPCMULTIATTACK.Presets.ConditionalCategory",
    tagKeys: ["GTNPCMULTIATTACK.Presets.TagMelee", "GTNPCMULTIATTACK.Presets.TagDamage"],
    schemaVersion: 1,
    rules: [{
      id: "pod-hunter", name: "Pod Hunter", enabled: true, activation: "manual",
      trigger: "beforeAttackBatch", scope: "currentBatch",
      conditions: [],
      effects: [{ type: "damageBonus", amount: 2 }]
    }]
  },
  {
    id: "swallow",
    nameKey: "GTNPCMULTIATTACK.Presets.SwallowName",
    descriptionKey: "GTNPCMULTIATTACK.Presets.SwallowDescription",
    categoryKey: "GTNPCMULTIATTACK.Presets.SpecialCategory",
    tagKeys: ["GTNPCMULTIATTACK.Presets.TagMelee", "GTNPCMULTIATTACK.Presets.TagControl"],
    schemaVersion: 1,
    rules: [{
      id: "swallow", name: "Swallow", enabled: true,
      trigger: "afterAttackBatch", scope: "attackSession",
      conditions: [{ type: "sameTargetHits", minimum: 1 }],
      effects: [{ type: "swallow", dc: 12, damage: "1d8", releaseDamage: 15, oncePerTarget: true }]
    }]
  },
  {
    id: "grab",
    nameKey: "GTNPCMULTIATTACK.Presets.GrabName",
    descriptionKey: "GTNPCMULTIATTACK.Presets.GrabDescription",
    categoryKey: "GTNPCMULTIATTACK.Presets.SpecialCategory",
    tagKeys: ["GTNPCMULTIATTACK.Presets.TagMelee", "GTNPCMULTIATTACK.Presets.TagInventory"],
    schemaVersion: 1,
    rules: [{
      id: "grab", name: "Grab", enabled: true,
      trigger: "afterAttackBatch", scope: "attackSession",
      conditions: [{ type: "sameTargetHits", minimum: 1 }],
      effects: [{
        type: "stealGear", mode: "carried", selection: "random",
        replaceDamage: false, oncePerTarget: true, targetActorTypes: ["Player"]
      }]
    }]
  },
  {
    id: "rage",
    nameKey: "GTNPCMULTIATTACK.Presets.RageName",
    descriptionKey: "GTNPCMULTIATTACK.Presets.RageDescription",
    categoryKey: "GTNPCMULTIATTACK.Presets.SpecialCategory",
    tagKeys: ["GTNPCMULTIATTACK.Presets.TagMelee", "GTNPCMULTIATTACK.Presets.TagDamage"],
    schemaVersion: 1,
    rules: [{
      id: "rage", name: "Rage", enabled: true,
      trigger: "beforeAttackBatch", scope: "currentBatch",
      conditions: [{ type: "attackerInjured" }],
      effects: [{ type: "replaceDamageDie", from: 6, to: 8 }]
    }]
  },
  {
    id: "greedy",
    nameKey: "GTNPCMULTIATTACK.Presets.GreedyName",
    descriptionKey: "GTNPCMULTIATTACK.Presets.GreedyDescription",
    categoryKey: "GTNPCMULTIATTACK.Presets.ConditionalCategory",
    tagKeys: ["GTNPCMULTIATTACK.Presets.TagMelee", "GTNPCMULTIATTACK.Presets.TagInventory"],
    schemaVersion: 1,
    rules: [{
      id: "greedy", name: "Greedy", enabled: true, activation: "manual", attackLimit: 1,
      trigger: "afterAttackBatch", scope: "currentBatch",
      conditions: [{ type: "sameTargetHits", minimum: 1 }],
      effects: [{
        type: "stealGear", mode: "carried", selection: "prompt",
        replaceDamage: true, oncePerTarget: true, targetActorTypes: ["Player"]
      }]
    }]
  },
  {
    id: "poison",
    nameKey: "GTNPCMULTIATTACK.Presets.PoisonName",
    descriptionKey: "GTNPCMULTIATTACK.Presets.PoisonDescription",
    categoryKey: "GTNPCMULTIATTACK.Presets.SpecialCategory",
    tagKeys: ["GTNPCMULTIATTACK.Presets.TagMelee", "GTNPCMULTIATTACK.Presets.TagDamage"],
    schemaVersion: 1,
    rules: [{
      id: "poison", name: "Poison (Damage)", enabled: true,
      trigger: "afterAttackBatch", scope: "currentBatch",
      conditions: [{ type: "sameTargetHits", minimum: 1 }],
      effects: [{
        type: "save", ability: "con", dc: 12,
        onFailure: { damage: "1d4" }, oncePerTarget: false
      }]
    }]
  },
  {
    id: "poison-paralyze",
    nameKey: "GTNPCMULTIATTACK.Presets.PoisonParalyzeName",
    descriptionKey: "GTNPCMULTIATTACK.Presets.PoisonParalyzeDescription",
    categoryKey: "GTNPCMULTIATTACK.Presets.SpecialCategory",
    tagKeys: ["GTNPCMULTIATTACK.Presets.TagMelee", "GTNPCMULTIATTACK.Presets.TagControl"],
    schemaVersion: 1,
    rules: [{
      id: "poison-paralyze", name: "Poison (Paralyze)", enabled: true,
      trigger: "afterAttackBatch", scope: "currentBatch",
      conditions: [{ type: "sameTargetHits", minimum: 1 }],
      effects: [{
        type: "save", ability: "con", dc: 12,
        onFailure: { condition: "paralysis", duration: { formula: "1d4", unit: "rounds" } },
        oncePerTarget: false
      }]
    }]
  },
  {
    id: "poison-sleep",
    nameKey: "GTNPCMULTIATTACK.Presets.PoisonSleepName",
    descriptionKey: "GTNPCMULTIATTACK.Presets.PoisonSleepDescription",
    categoryKey: "GTNPCMULTIATTACK.Presets.SpecialCategory",
    tagKeys: ["GTNPCMULTIATTACK.Presets.TagMelee", "GTNPCMULTIATTACK.Presets.TagControl"],
    schemaVersion: 1,
    rules: [{
      id: "poison-sleep", name: "Poison (Sleep)", enabled: true,
      trigger: "afterAttackBatch", scope: "currentBatch",
      conditions: [{ type: "sameTargetHits", minimum: 1 }],
      effects: [{
        type: "save", ability: "con", dc: 15,
        onFailure: { condition: "sleep", duration: { formula: "1d8", unit: "hours" } },
        oncePerTarget: false
      }]
    }]
  },
  {
    id: "poison-lethal",
    nameKey: "GTNPCMULTIATTACK.Presets.PoisonLethalName",
    descriptionKey: "GTNPCMULTIATTACK.Presets.PoisonLethalDescription",
    categoryKey: "GTNPCMULTIATTACK.Presets.SpecialCategory",
    tagKeys: ["GTNPCMULTIATTACK.Presets.TagMelee", "GTNPCMULTIATTACK.Presets.TagDamage"],
    schemaVersion: 1,
    rules: [{
      id: "poison-lethal", name: "Poison (Lethal)", enabled: true,
      trigger: "afterAttackBatch", scope: "currentBatch",
      conditions: [{ type: "sameTargetHits", minimum: 1 }],
      effects: [{
        type: "save", ability: "con", dc: 15,
        onFailure: { setHp: 0, deathTimer: "1" }, oncePerTarget: false
      }]
    }]
  },
  {
    id: "petrify",
    nameKey: "GTNPCMULTIATTACK.Presets.PetrifyName",
    descriptionKey: "GTNPCMULTIATTACK.Presets.PetrifyDescription",
    categoryKey: "GTNPCMULTIATTACK.Presets.SpecialCategory",
    tagKeys: ["GTNPCMULTIATTACK.Presets.TagMelee", "GTNPCMULTIATTACK.Presets.TagControl"],
    schemaVersion: 1,
    rules: [{
      id: "petrify", name: "Petrify", enabled: true,
      trigger: "afterAttackBatch", scope: "currentBatch",
      conditions: [{ type: "sameTargetHits", minimum: 1 }],
      effects: [{
        type: "save", ability: "con", dc: 12,
        onFailure: { condition: "petrified", limb: false }, oncePerTarget: false
      }]
    }]
  },
  {
    id: "knock",
    nameKey: "GTNPCMULTIATTACK.Presets.KnockName",
    descriptionKey: "GTNPCMULTIATTACK.Presets.KnockDescription",
    categoryKey: "GTNPCMULTIATTACK.Presets.SpecialCategory",
    tagKeys: ["GTNPCMULTIATTACK.Presets.TagMelee", "GTNPCMULTIATTACK.Presets.TagControl"],
    schemaVersion: 1,
    noteKeys: { "0": "GTNPCMULTIATTACK.Presets.KnockNote" },
    rules: [{
      id: "knock", name: "Knock", enabled: true,
      trigger: "afterAttackBatch", scope: "currentBatch",
      conditions: [{ type: "sameTargetHits", minimum: 1 }],
      effects: [{
        type: "save", ability: "str", dc: 9,
        onFailure: { condition: "prone", note: "Pushed a close distance and knocked down." },
        oncePerTarget: false
      }]
    }]
  },
  {
    id: "ability-drain",
    nameKey: "GTNPCMULTIATTACK.Presets.AbilityDrainName",
    descriptionKey: "GTNPCMULTIATTACK.Presets.AbilityDrainDescription",
    categoryKey: "GTNPCMULTIATTACK.Presets.SpecialCategory",
    tagKeys: ["GTNPCMULTIATTACK.Presets.TagMelee", "GTNPCMULTIATTACK.Presets.TagDamage"],
    schemaVersion: 1,
    rules: [{
      id: "ability-drain", name: "Ability Drain", enabled: true,
      trigger: "afterAttackBatch", scope: "currentBatch",
      conditions: [{ type: "sameTargetHits", minimum: 1 }],
      effects: [{ type: "abilityDamage", ability: "wis", formula: "1d6", note: "", oncePerTarget: false }]
    }]
  },
  {
    id: "sever",
    nameKey: "GTNPCMULTIATTACK.Presets.SeverName",
    descriptionKey: "GTNPCMULTIATTACK.Presets.SeverDescription",
    categoryKey: "GTNPCMULTIATTACK.Presets.SpecialCategory",
    tagKeys: ["GTNPCMULTIATTACK.Presets.TagMelee", "GTNPCMULTIATTACK.Presets.TagControl"],
    schemaVersion: 1,
    rules: [{
      id: "sever", name: "Sever", enabled: true,
      trigger: "afterAttackBatch", scope: "currentBatch",
      conditions: [{ type: "naturalAttackRollAtLeast", minimum: 18 }],
      effects: [{ type: "severLimb", oncePerTarget: true }]
    }]
  }
]);

function clone(value) {
  return globalThis.foundry?.utils?.deepClone?.(value) ?? structuredClone(value);
}

function invalid(path, code) {
  return { valid: false, details: { path, code }, preset: null };
}

function presetId(value) {
  return String(value ?? "").trim().replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 64);
}

export function validatePreset(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid("$", "object");
  const allowed = ["id", "name", "description", "category", "tags", "schemaVersion", "rules"];
  if (!Object.keys(value).every(key => allowed.includes(key))) return invalid("$", "unknownField");
  const rawId = String(value.id ?? "").trim();
  const id = presetId(rawId);
  if (!id || rawId !== id || !/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(id)) return invalid("id", "id");
  if (typeof value.name !== "string" || !value.name.trim() || value.name.length > 100) {
    return invalid("name", "text");
  }
  if (value.description !== undefined && (typeof value.description !== "string" || value.description.length > 500)) {
    return invalid("description", "text");
  }
  if (value.category !== undefined && (typeof value.category !== "string" || value.category.length > 80)) {
    return invalid("category", "text");
  }
  if (value.tags !== undefined && (!Array.isArray(value.tags) || value.tags.length > 20
    || value.tags.some(tag => typeof tag !== "string" || !tag.trim() || tag.length > 40))) {
    return invalid("tags", "textArray");
  }
  if (value.schemaVersion !== LIBRARY_VERSION) return invalid("schemaVersion", "version");
  const ruleValidation = validateCustomRules({ version: 1, rules: value.rules });
  if (!ruleValidation.valid) {
    const path = ruleValidation.details?.path ?? "$";
    return invalid(path === "$" ? "rules" : path, ruleValidation.details?.code ?? "schema");
  }
  return {
    valid: true,
    details: null,
    preset: {
      id,
      name: value.name.trim(),
      description: String(value.description ?? "").trim(),
      category: String(value.category ?? "").trim(),
      tags: (value.tags ?? []).map(tag => tag.trim()),
      schemaVersion: LIBRARY_VERSION,
      rules: ruleValidation.rules
    }
  };
}

function storedLibrary() {
  const value = game.settings.get(MODULE_ID, LIBRARY_SETTING);
  if (!value || typeof value !== "object" || value.version !== LIBRARY_VERSION || !Array.isArray(value.presets)) {
    return { version: LIBRARY_VERSION, presets: [] };
  }
  return clone(value);
}

async function saveLibrary(presets) {
  return game.settings.set(MODULE_ID, LIBRARY_SETTING, {
    version: LIBRARY_VERSION,
    presets: presets.slice(0, MAX_PRESETS)
  });
}

function builtInCatalog() {
  return BUILTIN_PRESETS.map(value => {
    const name = L(value.nameKey);
    const rules = clone(value.rules);
    if (rules[0]) rules[0].name = name;
    // Free-text notes inside effects are world content once copied, so the
    // built-ins carry an English default and localise it at copy time.
    for (const [effectIndex, noteKey] of Object.entries(value.noteKeys ?? {})) {
      const effect = rules[0]?.effects?.[Number(effectIndex)];
      if (!effect) continue;
      if (effect.onFailure) effect.onFailure.note = L(noteKey);
      else effect.note = L(noteKey);
    }
    return {
      key: `builtin:${value.id}`,
      id: value.id,
      name,
      description: L(value.descriptionKey),
      category: L(value.categoryKey),
      tags: value.tagKeys.map(L),
      schemaVersion: value.schemaVersion,
      rules,
      builtIn: true
    };
  });
}

function customCatalog() {
  return storedLibrary().presets.flatMap(value => {
    const validation = validatePreset(value);
    return validation.valid ? [{
      key: `custom:${validation.preset.id}`,
      ...validation.preset,
      builtIn: false
    }] : [];
  });
}

export function getPresetCatalog() {
  // Built-ins sort by their localized name so the dropdown reads alphabetically
  // in every language; custom presets keep the order the GM saved them in.
  const builtIns = builtInCatalog().sort((left, right) => left.name.localeCompare(right.name, game.i18n?.lang));
  return [...builtIns, ...customCatalog()];
}

export function getPresetByKey(key) {
  return getPresetCatalog().find(preset => preset.key === key) ?? null;
}

function uniqueId(base, used) {
  let candidate = presetId(base) || "preset";
  let suffix = 2;
  while (used.has(candidate)) candidate = `${presetId(base).slice(0, 58) || "preset"}-${suffix++}`;
  used.add(candidate);
  return candidate;
}

export function applyPresetToRuleSource(source, preset, mode = "add") {
  const presetValidation = validatePreset(presetForExport(preset));
  if (!presetValidation.valid) return { valid: false, validation: presetValidation, source };
  const presetRules = clone(presetValidation.preset.rules);
  if (mode === "replace") {
    const next = { version: 1, rules: presetRules };
    return { valid: true, validation: validateCustomRules(next), source: JSON.stringify(next, null, 2) };
  }

  const current = validateCustomRules(source);
  if (!current.valid) return { valid: false, validation: current, source };
  const used = new Set(current.rules.map(rule => rule.id));
  for (const rule of presetRules) rule.id = uniqueId(rule.id, used);
  const next = { version: 1, rules: [...current.rules, ...presetRules] };
  const validation = validateCustomRules(next);
  return validation.valid
    ? { valid: true, validation, source: JSON.stringify(next, null, 2) }
    : { valid: false, validation, source };
}

export function formatValidationError(validation) {
  const details = validation?.details ?? validation?.validation?.details ?? { path: "$", code: "schema" };
  const reasonCode = ({
    object: "type",
    array: "type",
    text: "type",
    textArray: "type",
    boolean: "type",
    integerRange: "type",
    nonEmptyArray: "required"
  })[details.code] ?? details.code;
  const reasonKey = `GTNPCMULTIATTACK.Validation.${reasonCode}`;
  const localizedReason = L(reasonKey);
  const reason = localizedReason === reasonKey ? L("GTNPCMULTIATTACK.Validation.schema") : localizedReason;
  return game.i18n.format("GTNPCMULTIATTACK.Validation.AtPath", {
    path: details.path ?? "$",
    reason
  });
}

function presetForExport(preset) {
  return {
    id: preset.id,
    name: preset.name,
    description: preset.description,
    category: preset.category,
    tags: [...(preset.tags ?? [])],
    schemaVersion: LIBRARY_VERSION,
    rules: clone(preset.rules)
  };
}

function importedValues(data) {
  if (Array.isArray(data)) return data;
  if (data?.version === LIBRARY_VERSION && Array.isArray(data.presets)) return data.presets;
  if (data?.schemaVersion === LIBRARY_VERSION && Array.isArray(data.rules)) return [data];
  if (data?.version === 1 && Array.isArray(data.rules)) {
    return [{
      id: "imported-preset",
      name: L("GTNPCMULTIATTACK.Presets.ImportedName"),
      description: "",
      category: "",
      tags: [],
      schemaVersion: LIBRARY_VERSION,
      rules: data.rules
    }];
  }
  return [];
}

export class PresetLibraryApplication extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "gt-shadowdark-combat-refinements-preset-library",
    tag: "form",
    classes: ["gt-npc-ma-preset-library"],
    window: {
      title: "GTNPCMULTIATTACK.Presets.LibraryTitle",
      icon: "fa-solid fa-book"
    },
    position: { width: 850, height: 620 },
    form: {
      closeOnSubmit: false,
      handler: PresetLibraryApplication.onSubmit
    },
    actions: {
      selectPreset: PresetLibraryApplication.onSelectPreset,
      newPreset: PresetLibraryApplication.onNewPreset,
      duplicatePreset: PresetLibraryApplication.onDuplicatePreset,
      deletePreset: PresetLibraryApplication.onDeletePreset,
      savePreset: PresetLibraryApplication.onSavePreset,
      importPresets: PresetLibraryApplication.onImportPresets,
      exportPreset: PresetLibraryApplication.onExportPreset,
      exportLibrary: PresetLibraryApplication.onExportLibrary,
      copyPreset: PresetLibraryApplication.onCopyPreset
    }
  };

  static PARTS = {
    library: { template: `modules/${MODULE_ID}/templates/preset-library.hbs` }
  };

  constructor(options = {}) {
    super(options);
    this.selectedKey = "builtin:gore";
    this.draft = null;
  }

  selectedPreset() {
    return this.draft ?? getPresetByKey(this.selectedKey) ?? getPresetCatalog()[0] ?? null;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext?.(options) ?? {};
    const catalog = getPresetCatalog();
    const selected = this.selectedPreset();
    const decorate = preset => ({
      ...preset,
      selected: preset.key === selected?.key,
      searchText: `${preset.name} ${preset.description} ${preset.category} ${(preset.tags ?? []).join(" ")}`.toLocaleLowerCase()
    });
    return Object.assign(context, {
      builtIns: catalog.filter(preset => preset.builtIn).map(decorate),
      customPresets: catalog.filter(preset => !preset.builtIn).map(decorate),
      hasCustomPresets: catalog.some(preset => !preset.builtIn),
      editor: selected ? {
        ...selected,
        isCustom: !selected.builtIn,
        isDraft: Boolean(this.draft),
        tagsText: (selected.tags ?? []).join(", "),
        rulesJson: JSON.stringify({ version: 1, rules: selected.rules }, null, 2)
      } : null
    });
  }

  /**
   * Selecting a preset re-renders the whole form. Remember where the sidebar
   * was scrolled to and what was typed in the search box, so the list does
   * not jump back to the top on every click.
   */
  async _preRender(context, options) {
    await super._preRender?.(context, options);
    const sidebar = this.element?.querySelector?.(".gt-npc-ma-preset-sidebar");
    const search = this.element?.querySelector?.('[name="presetSearch"]');
    this.sidebarState = sidebar
      ? { scrollTop: sidebar.scrollTop, query: search?.value ?? "" }
      : this.sidebarState ?? null;
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    const search = this.element.querySelector('[name="presetSearch"]');
    const applySearch = () => {
      const query = (search?.value ?? "").trim().toLocaleLowerCase();
      for (const row of this.element.querySelectorAll("[data-preset-search]")) {
        row.hidden = Boolean(query) && !row.dataset.presetSearch.includes(query);
      }
    };
    search?.addEventListener("input", applySearch);
    const fileInput = this.element.querySelector('[name="presetImportFile"]');
    fileInput?.addEventListener("change", () => void this.importFiles(fileInput.files));
    const state = this.sidebarState;
    if (!state) return;
    if (search && state.query) {
      search.value = state.query;
      applySearch();
    }
    const sidebar = this.element.querySelector(".gt-npc-ma-preset-sidebar");
    if (sidebar) sidebar.scrollTop = state.scrollTop;
  }

  static onSelectPreset(_event, target) {
    this.draft = null;
    this.selectedKey = target.dataset.presetKey;
    return this.render({ force: true });
  }

  static onSubmit(event) {
    event.preventDefault();
  }

  static onNewPreset() {
    const used = new Set(getPresetCatalog().map(preset => preset.id));
    const id = uniqueId(`custom-${Date.now().toString(36)}`, used);
    this.selectedKey = null;
    this.draft = {
      key: `draft:${id}`,
      id,
      name: L("GTNPCMULTIATTACK.Presets.NewPresetName"),
      description: "",
      category: "",
      tags: [],
      schemaVersion: LIBRARY_VERSION,
      rules: [],
      builtIn: false
    };
    return this.render({ force: true });
  }

  static onDuplicatePreset() {
    const source = this.selectedPreset();
    if (!source) return;
    const used = new Set(getPresetCatalog().map(preset => preset.id));
    const id = uniqueId(source.id, used);
    this.selectedKey = null;
    this.draft = {
      ...presetForExport(source),
      key: `draft:${id}`,
      id,
      name: game.i18n.format("GTNPCMULTIATTACK.Presets.CopyOf", { name: source.name }),
      builtIn: false
    };
    return this.render({ force: true });
  }

  static async onDeletePreset() {
    const selected = this.selectedPreset();
    if (!selected || selected.builtIn || !game.user.isGM) return;
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: L("GTNPCMULTIATTACK.Presets.Delete") },
      content: `<p>${game.i18n.format("GTNPCMULTIATTACK.Presets.ConfirmDelete", {
        name: escapeHtml(selected.name)
      })}</p>`,
      modal: true
    });
    if (!confirmed) return;
    const presets = storedLibrary().presets.filter(preset => preset.id !== selected.id);
    await saveLibrary(presets);
    this.draft = null;
    this.selectedKey = "builtin:gore";
    ui.notifications.info(L("GTNPCMULTIATTACK.Presets.Deleted"));
    return this.render({ force: true });
  }

  static async onSavePreset() {
    if (!game.user.isGM) return;
    const formData = new foundry.applications.ux.FormDataExtended(this.element).object;
    let parsedRules;
    try {
      parsedRules = JSON.parse(String(formData.rulesJson ?? ""));
    }
    catch (_error) {
      ui.notifications.error(formatValidationError({ details: { path: "rules", code: "json" } }));
      return;
    }
    const ruleValidation = validateCustomRules(parsedRules);
    if (!ruleValidation.valid) {
      ui.notifications.error(formatValidationError(ruleValidation));
      return;
    }
    const candidate = {
      id: String(formData.id ?? this.selectedPreset()?.id ?? ""),
      name: String(formData.name ?? ""),
      description: String(formData.description ?? ""),
      category: String(formData.category ?? ""),
      tags: String(formData.tags ?? "").split(",").map(tag => tag.trim()).filter(Boolean),
      schemaVersion: LIBRARY_VERSION,
      rules: ruleValidation.rules
    };
    const validation = validatePreset(candidate);
    if (!validation.valid) {
      ui.notifications.error(formatValidationError(validation));
      return;
    }
    const original = this.draft ? null : this.selectedPreset();
    const presets = storedLibrary().presets;
    const index = original && !original.builtIn ? presets.findIndex(preset => preset.id === original.id) : -1;
    if (index >= 0) presets[index] = validation.preset;
    else {
      if (presets.length >= MAX_PRESETS) {
        ui.notifications.error(formatValidationError({ details: { path: "presets", code: "limit" } }));
        return;
      }
      const used = new Set(getPresetCatalog().map(preset => preset.id));
      if (used.has(validation.preset.id)) validation.preset.id = uniqueId(validation.preset.id, used);
      presets.push(validation.preset);
    }
    await saveLibrary(presets);
    this.draft = null;
    this.selectedKey = `custom:${validation.preset.id}`;
    ui.notifications.info(L("GTNPCMULTIATTACK.Presets.Saved"));
    return this.render({ force: true });
  }

  static onImportPresets() {
    this.element.querySelector('[name="presetImportFile"]')?.click();
  }

  async importFiles(files) {
    const file = files?.[0];
    if (!file || !game.user.isGM) return;
    try {
      let parsed;
      try {
        parsed = JSON.parse(await foundry.utils.readTextFromFile(file));
      }
      catch (_error) {
        throw new Error(L("GTNPCMULTIATTACK.Validation.json"));
      }
      const values = importedValues(parsed);
      if (!values.length) throw new Error(L("GTNPCMULTIATTACK.Presets.ImportNoPresets"));
      const imported = [];
      for (const value of values) {
        const validation = validatePreset(value);
        if (!validation.valid) throw new Error(formatValidationError(validation));
        imported.push(validation.preset);
      }
      const presets = storedLibrary().presets;
      if (presets.length + imported.length > MAX_PRESETS) {
        throw new Error(formatValidationError({ details: { path: "presets", code: "limit" } }));
      }
      const used = new Set(getPresetCatalog().map(preset => preset.id));
      for (const preset of imported) {
        preset.id = uniqueId(preset.id, used);
        presets.push(preset);
      }
      await saveLibrary(presets);
      this.draft = null;
      this.selectedKey = `custom:${imported[0].id}`;
      ui.notifications.info(game.i18n.format("GTNPCMULTIATTACK.Presets.Imported", { count: imported.length }));
      return this.render({ force: true });
    }
    catch (error) {
      ui.notifications.error(game.i18n.format("GTNPCMULTIATTACK.Presets.ImportFailed", {
        error: error.message
      }));
    }
  }

  static onExportPreset() {
    const selected = this.selectedPreset();
    if (!selected) return;
    foundry.utils.saveDataToFile(
      JSON.stringify(presetForExport(selected), null, 2),
      "application/json",
      `${MODULE_ID}-preset-${selected.id}.json`
    );
  }

  static onExportLibrary() {
    foundry.utils.saveDataToFile(
      JSON.stringify(storedLibrary(), null, 2),
      "application/json",
      `${MODULE_ID}-preset-library.json`
    );
  }

  static onCopyPreset() {
    const selected = this.selectedPreset();
    if (!selected) return;
    game.clipboard.copyPlainText(JSON.stringify(presetForExport(selected), null, 2));
    ui.notifications.info(L("GTNPCMULTIATTACK.Presets.Copied"));
  }
}

export function registerPresetLibrary() {
  game.settings.register(MODULE_ID, LIBRARY_SETTING, {
    scope: "world",
    config: false,
    type: Object,
    default: { version: LIBRARY_VERSION, presets: [] }
  });
  game.settings.registerMenu(MODULE_ID, "presetLibrary", {
    name: "GTNPCMULTIATTACK.Presets.LibraryName",
    label: "GTNPCMULTIATTACK.Presets.OpenLibrary",
    hint: "GTNPCMULTIATTACK.Presets.LibraryHint",
    icon: "fa-solid fa-book",
    type: PresetLibraryApplication,
    restricted: true
  });
}

let presetLibraryInstance = null;

export function openPresetLibrary() {
  if (!game.user.isGM) return null;
  presetLibraryInstance ??= new PresetLibraryApplication();
  presetLibraryInstance.render({ force: true });
  return presetLibraryInstance;
}

export const presetLibraryTestApi = Object.freeze({
  importedValues,
  presetForExport,
  presetId,
  uniqueId
});
