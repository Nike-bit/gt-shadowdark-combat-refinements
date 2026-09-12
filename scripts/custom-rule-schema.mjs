const MAX_RULES = 20;
const MAX_FORMULA_LENGTH = 200;

export const TRIGGER_BEFORE = "beforeAttackBatch";
export const TRIGGER_AFTER = "afterAttackBatch";

/**
 * Effects applied to the attack configuration before the dice are thrown. They
 * cannot see the outcome, so they cannot honour a condition that depends on it.
 */
export const PRE_ATTACK_EFFECTS = Object.freeze(new Set([
  "forceAdvantage", "damageBonus", "replaceDamageDie", "selfDamage"
]));

/** Ability keys a `save` effect may test. */
export const SAVE_ABILITIES = Object.freeze(["str", "dex", "con", "int", "wis", "cha"]);

/**
 * Conditions a failed save may inflict. Most are Foundry core status ids;
 * `petrified` is registered by this module because neither Foundry nor
 * Shadowdark supplies one.
 */
export const CONDITION_IDS = Object.freeze([
  "paralysis", "sleep", "prone", "unconscious", "stun", "restrain", "blind", "fear", "poison",
  "petrified"
]);
export const DURATION_UNITS = Object.freeze(["rounds", "hours", "days"]);
const MAX_NOTE_LENGTH = 200;

/**
 * What happens when a `save` fails. Exactly one consequence key is required;
 * the optional keys qualify it.
 */
function validateFailure(value, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid("schema", path, "object");
  if (!hasOnlyKeys(value, [
    "damage", "condition", "duration", "limb", "setHp", "deathTimer", "abilityDamage", "note"
  ])) {
    return invalid("schema", path, "unknownField");
  }
  const consequences = ["damage", "condition", "setHp", "abilityDamage"].filter(key => value[key] !== undefined);
  if (consequences.length !== 1) return invalid("schema", path, "oneConsequence");
  const [kind] = consequences;
  const out = {};

  if (kind === "damage") {
    if (!validFormula(value.damage)) return invalid("schema", `${path}.damage`, "formula");
    out.damage = value.damage.trim();
  }
  if (kind === "condition") {
    if (!CONDITION_IDS.includes(value.condition)) return invalid("schema", `${path}.condition`, "unsupported");
    out.condition = value.condition;
    if (value.duration !== undefined) {
      const duration = value.duration;
      if (!duration || typeof duration !== "object" || !hasOnlyKeys(duration, ["formula", "unit"])
        || !validFormula(duration.formula) || !DURATION_UNITS.includes(duration.unit)) {
        return invalid("schema", `${path}.duration`, "unsupported");
      }
      out.duration = { formula: duration.formula.trim(), unit: duration.unit };
    }
    if (value.limb !== undefined) {
      if (typeof value.limb !== "boolean") return invalid("schema", `${path}.limb`, "boolean");
      out.limb = value.limb;
    }
  }
  else if (value.duration !== undefined || value.limb !== undefined) {
    return invalid("schema", `${path}.duration`, "unknownField");
  }
  if (kind === "setHp") {
    if (value.setHp !== 0) return invalid("schema", `${path}.setHp`, "unsupported");
    out.setHp = 0;
    if (value.deathTimer !== undefined) {
      // A formula rolled against the *target*, so "1 + @abilities.con.mod"
      // works. Bare integers from earlier documents are accepted as-is.
      const timer = Number.isInteger(value.deathTimer) ? String(value.deathTimer) : value.deathTimer;
      if (!validFormula(timer)) return invalid("schema", `${path}.deathTimer`, "formula");
      out.deathTimer = timer.trim();
    }
  }
  else if (value.deathTimer !== undefined) {
    return invalid("schema", `${path}.deathTimer`, "unknownField");
  }
  if (kind === "abilityDamage") {
    const drain = value.abilityDamage;
    if (!drain || typeof drain !== "object" || !hasOnlyKeys(drain, ["ability", "formula"])
      || !SAVE_ABILITIES.includes(drain.ability) || !validFormula(drain.formula)) {
      return invalid("schema", `${path}.abilityDamage`, "unsupported");
    }
    out.abilityDamage = { ability: drain.ability, formula: drain.formula.trim() };
  }
  if (value.note !== undefined) {
    if (typeof value.note !== "string" || value.note.length > MAX_NOTE_LENGTH) {
      return invalid("schema", `${path}.note`, "text");
    }
    out.note = value.note.trim();
  }
  return { valid: true, failure: out };
}

/** Actor types an effect may be aimed at. */
export const TARGET_ACTOR_TYPES = Object.freeze(["Player", "NPC"]);

/**
 * Optional on every effect: restrict it to certain target Actor types. Greedy
 * uses it to leave monsters alone; Shatter and Grab can use the same field.
 */
const COMMON_EFFECT_KEYS = Object.freeze(["targetActorTypes"]);

function effectKeys(...keys) {
  return [...keys, ...COMMON_EFFECT_KEYS];
}

/** Conditions about the attacker, knowable at any point in the batch. */
export const ATTACKER_SCOPED_CONDITIONS = Object.freeze(new Set(["attackerInjured"]));

/** Conditions that name which targets an effect applies to, known only afterwards. */
export const TARGET_SCOPED_CONDITIONS = Object.freeze(new Set([
  "sameTargetHits", "naturalAttackRollAtLeast"
]));

/**
 * `sameTargetHits: 1` is the established "on a hit" idiom and is satisfied by any
 * hit, so a pre-attack effect may carry it. A higher threshold, or a natural-roll
 * threshold, cannot be known before the roll.
 */
function knowableBeforeAttack(condition) {
  if (ATTACKER_SCOPED_CONDITIONS.has(condition.type)) return true;
  return condition.type === "sameTargetHits" && condition.minimum === 1;
}

export const DEFAULT_CUSTOM_RULE_SOURCE = `{
  "version": 1,
  "rules": []
}`;

function invalid(error, path, code) {
  return { valid: false, error, details: { path, code }, rules: [] };
}

function hasOnlyKeys(object, allowed) {
  return Object.keys(object).every(key => allowed.includes(key));
}

function validFormula(formula) {
  if (typeof formula !== "string" || !formula.trim() || formula.length > MAX_FORMULA_LENGTH) return false;
  try {
    if (typeof globalThis.Roll?.validate === "function") return globalThis.Roll.validate(formula);
    if (globalThis.Roll) new globalThis.Roll(formula);
    return true;
  }
  catch (_error) {
    return false;
  }
}

export function validateCustomRules(source) {
  let data;
  try {
    data = typeof source === "string" ? JSON.parse(source) : structuredClone(source);
  }
  catch (_error) {
    return invalid("json", "$", "json");
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return invalid("schema", "$", "object");
  }
  if (!hasOnlyKeys(data, ["version", "rules"])) {
    return invalid("schema", "$", "unknownField");
  }
  if (data.version !== 1) return invalid("schema", "version", "version");
  if (!Array.isArray(data.rules)) return invalid("schema", "rules", "array");
  if (data.rules.length > MAX_RULES) return invalid("schema", "rules", "limit");

  const ids = new Set();
  const rules = [];
  for (const [ruleIndex, value] of data.rules.entries()) {
    const path = `rules[${ruleIndex}]`;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return invalid("schema", path, "object");
    }
    if (!hasOnlyKeys(value, [
      "id", "name", "enabled", "activation", "attackLimit", "trigger", "scope", "conditions", "effects"
    ])) {
      return invalid("schema", path, "unknownField");
    }
    if (typeof value.id !== "string" || !/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(value.id)) {
      return invalid("schema", `${path}.id`, "id");
    }
    if (ids.has(value.id)) return invalid("schema", `${path}.id`, "duplicate");
    ids.add(value.id);
    if (value.name !== undefined && (typeof value.name !== "string" || value.name.length > 100)) {
      return invalid("schema", `${path}.name`, "text");
    }
    if (value.enabled !== undefined && typeof value.enabled !== "boolean") {
      return invalid("schema", `${path}.enabled`, "boolean");
    }
    const activation = value.activation ?? "automatic";
    if (!["automatic", "manual"].includes(activation)) {
      return invalid("schema", `${path}.activation`, "unsupported");
    }
    if (value.attackLimit !== undefined
      && (!Number.isInteger(value.attackLimit) || value.attackLimit < 1 || value.attackLimit > 100)) {
      return invalid("schema", `${path}.attackLimit`, "integerRange");
    }
    if (![TRIGGER_AFTER, TRIGGER_BEFORE].includes(value.trigger)) {
      return invalid("schema", `${path}.trigger`, "unsupported");
    }
    if (!["attackSession", "currentBatch"].includes(value.scope)) {
      return invalid("schema", `${path}.scope`, "unsupported");
    }
    // A beforeAttackBatch rule may legitimately have nothing to test.
    if (!Array.isArray(value.conditions)
      || (!value.conditions.length && value.trigger !== TRIGGER_BEFORE)) {
      return invalid("schema", `${path}.conditions`, "nonEmptyArray");
    }
    if (!Array.isArray(value.effects) || !value.effects.length) {
      return invalid("schema", `${path}.effects`, "nonEmptyArray");
    }

    const conditions = [];
    for (const [conditionIndex, condition] of value.conditions.entries()) {
      const conditionPath = `${path}.conditions[${conditionIndex}]`;
      if (!condition || typeof condition !== "object" || Array.isArray(condition)) {
        return invalid("schema", conditionPath, "object");
      }
      if (!hasOnlyKeys(condition, ["type", "minimum"])) {
        return invalid("schema", conditionPath, "unknownField");
      }
      if (!["sameTargetHits", "attackerInjured", "naturalAttackRollAtLeast"].includes(condition.type)) {
        return invalid("schema", `${conditionPath}.type`, "unsupported");
      }
      if (condition.type === "sameTargetHits"
        && (!Number.isInteger(condition.minimum) || condition.minimum < 1 || condition.minimum > 100)) {
        return invalid("schema", `${conditionPath}.minimum`, "integerRange");
      }
      if (condition.type === "naturalAttackRollAtLeast"
        && (!Number.isInteger(condition.minimum) || condition.minimum < 1 || condition.minimum > 20)) {
        return invalid("schema", `${conditionPath}.minimum`, "integerRange");
      }
      if (condition.type === "attackerInjured" && condition.minimum !== undefined) {
        return invalid("schema", `${conditionPath}.minimum`, "unknownField");
      }
      conditions.push({
        type: condition.type,
        ...(["sameTargetHits", "naturalAttackRollAtLeast"].includes(condition.type)
          ? { minimum: condition.minimum }
          : {})
      });
    }

    const effects = [];
    for (const [effectIndex, effect] of value.effects.entries()) {
      const effectPath = `${path}.effects[${effectIndex}]`;
      if (!effect || typeof effect !== "object" || Array.isArray(effect)) {
        return invalid("schema", effectPath, "object");
      }
      if (!hasOnlyKeys(effect, [
        "type", "formula", "count", "multiplier", "oncePerTarget", "amount", "from", "to",
        "mode", "selection", "replaceDamage", "dc", "damage", "releaseDamage", "crits",
        "targetActorTypes", "ability", "onFailure", "note", "ability"
      ])) {
        return invalid("schema", effectPath, "unknownField");
      }
      if (![
        "extraDamage", "extraDamageDie", "extraBaseDamage", "forceAdvantage", "selfDamage",
        "damageBonus", "replaceDamageDie", "shatterGear", "stealGear", "swallow", "severLimb",
        "save", "abilityDamage"
      ].includes(effect.type)) {
        return invalid("schema", `${effectPath}.type`, "unsupported");
      }
      if (effect.type === "extraDamage"
        && (!hasOnlyKeys(effect, effectKeys("type", "formula", "oncePerTarget", "crits"))
        || !validFormula(effect.formula))) {
        return invalid("schema", `${effectPath}.formula`, "formula");
      }
      if (effect.type === "extraDamageDie"
        && (!hasOnlyKeys(effect, effectKeys("type", "count", "oncePerTarget", "crits"))
        || (effect.count !== undefined
          && (!Number.isInteger(effect.count) || effect.count < 1 || effect.count > 20)))) {
        return invalid("schema", `${effectPath}.count`, "integerRange");
      }
      if (effect.type === "extraBaseDamage"
        && (!hasOnlyKeys(effect, effectKeys("type", "multiplier", "oncePerTarget", "crits"))
        || !Number.isInteger(effect.multiplier) || effect.multiplier < 1 || effect.multiplier > 10)) {
        return invalid("schema", `${effectPath}.multiplier`, "integerRange");
      }
      if (effect.type === "forceAdvantage" && !hasOnlyKeys(effect, effectKeys("type"))) {
        return invalid("schema", effectPath, "unknownField");
      }
      if (effect.type === "selfDamage" && (!hasOnlyKeys(effect, effectKeys("type", "formula"))
        || !validFormula(effect.formula))) {
        return invalid("schema", `${effectPath}.formula`, "formula");
      }
      if (effect.type === "damageBonus" && (!hasOnlyKeys(effect, effectKeys("type", "amount"))
        || !Number.isInteger(effect.amount) || effect.amount < -100 || effect.amount > 100)) {
        return invalid("schema", `${effectPath}.amount`, "integerRange");
      }
      if (effect.type === "replaceDamageDie" && (!hasOnlyKeys(effect, effectKeys("type", "from", "to"))
        || ![4, 6, 8, 10, 12].includes(effect.from) || ![4, 6, 8, 10, 12].includes(effect.to))) {
        return invalid("schema", `${effectPath}.from`, "unsupported");
      }
      if (effect.type === "shatterGear" && !hasOnlyKeys(effect, effectKeys("type", "oncePerTarget"))) {
        return invalid("schema", effectPath, "unknownField");
      }
      if (effect.type === "stealGear"
        && (!hasOnlyKeys(effect, effectKeys("type", "mode", "selection", "replaceDamage", "oncePerTarget"))
        || !["carried"].includes(effect.mode)
        || (effect.selection !== undefined && !["random", "prompt"].includes(effect.selection))
        || (effect.replaceDamage !== undefined && typeof effect.replaceDamage !== "boolean"))) {
        return invalid("schema", `${effectPath}.mode`, "unsupported");
      }
      if (effect.type === "swallow"
        && (!hasOnlyKeys(effect, effectKeys("type", "dc", "damage", "releaseDamage", "oncePerTarget"))
        || !Number.isInteger(effect.dc) || effect.dc < 1 || effect.dc > 40
        || !validFormula(effect.damage)
        || !Number.isInteger(effect.releaseDamage) || effect.releaseDamage < 1 || effect.releaseDamage > 1000)) {
        return invalid("schema", effectPath, "unsupported");
      }
      // A target-side ability check with a structured consequence on failure.
      // The pre-1.3 shorthand `damage: "1d4"` is still accepted and normalised.
      let saveFailure = null;
      if (effect.type === "save") {
        if (!hasOnlyKeys(effect, effectKeys("type", "ability", "dc", "damage", "onFailure", "oncePerTarget"))
          || !SAVE_ABILITIES.includes(effect.ability)
          || !Number.isInteger(effect.dc) || effect.dc < 1 || effect.dc > 40
          || (effect.damage !== undefined) === (effect.onFailure !== undefined)) {
          return invalid("schema", effectPath, "unsupported");
        }
        const failureSource = effect.onFailure ?? { damage: effect.damage };
        const failure = validateFailure(failureSource, `${effectPath}.onFailure`);
        if (!failure.valid) return failure;
        saveFailure = failure.failure;
      }
      // Ability score damage with no save, as Drain and Life Drain deal it.
      if (effect.type === "abilityDamage"
        && (!hasOnlyKeys(effect, effectKeys("type", "ability", "formula", "note", "oncePerTarget"))
        || !SAVE_ABILITIES.includes(effect.ability)
        || !validFormula(effect.formula)
        || (effect.note !== undefined && (typeof effect.note !== "string" || effect.note.length > MAX_NOTE_LENGTH)))) {
        return invalid("schema", effectPath, "unsupported");
      }
      if (effect.type === "severLimb" && !hasOnlyKeys(effect, effectKeys("type", "oncePerTarget"))) {
        return invalid("schema", effectPath, "unknownField");
      }
      if (effect.oncePerTarget !== undefined && typeof effect.oncePerTarget !== "boolean") {
        return invalid("schema", `${effectPath}.oncePerTarget`, "boolean");
      }
      if (effect.crits !== undefined && typeof effect.crits !== "boolean") {
        return invalid("schema", `${effectPath}.crits`, "boolean");
      }
      if (effect.targetActorTypes !== undefined
        && (!Array.isArray(effect.targetActorTypes) || !effect.targetActorTypes.length
        || effect.targetActorTypes.some(type => !TARGET_ACTOR_TYPES.includes(type)))) {
        return invalid("schema", `${effectPath}.targetActorTypes`, "unsupported");
      }
      effects.push({
        type: effect.type,
        ...(effect.type === "extraDamage" ? { formula: effect.formula.trim() } : {}),
        ...(effect.type === "extraDamageDie" ? { count: effect.count ?? 1 } : {}),
        ...(effect.type === "extraBaseDamage" ? { multiplier: effect.multiplier } : {}),
        ...(effect.type === "selfDamage" ? { formula: effect.formula.trim() } : {}),
        ...(effect.type === "damageBonus" ? { amount: effect.amount } : {}),
        ...(effect.type === "replaceDamageDie" ? { from: effect.from, to: effect.to } : {}),
        ...(effect.type === "stealGear" ? {
          mode: effect.mode,
          selection: effect.selection ?? "random",
          replaceDamage: effect.replaceDamage === true
        } : {}),
        ...(effect.type === "swallow" ? {
          dc: effect.dc,
          damage: effect.damage.trim(),
          releaseDamage: effect.releaseDamage
        } : {}),
        // Every hit is a fresh save unless the rule says otherwise, so the
        // default here is the opposite of the other effects'.
        ...(effect.type === "save" ? {
          ability: effect.ability,
          dc: effect.dc,
          onFailure: saveFailure,
          oncePerTarget: effect.oncePerTarget === true
        } : {}),
        ...(effect.type === "abilityDamage" ? {
          ability: effect.ability,
          formula: effect.formula.trim(),
          ...(effect.note === undefined ? {} : { note: effect.note.trim() }),
          oncePerTarget: effect.oncePerTarget === true
        } : {}),
        ...(["extraDamage", "extraDamageDie", "extraBaseDamage"].includes(effect.type)
          ? { crits: effect.crits === true }
          : {}),
        ...(effect.targetActorTypes === undefined
          ? {}
          : { targetActorTypes: [...new Set(effect.targetActorTypes)] }),
        ...(["extraDamage", "extraDamageDie", "extraBaseDamage", "shatterGear", "stealGear",
          "swallow", "severLimb"]
          .includes(effect.type) ? { oncePerTarget: effect.oncePerTarget !== false } : {})
      });
    }

    // Semantic pass: a well-formed document must also be able to do what it says.
    const hasPreAttackEffect = effects.some(effect => PRE_ATTACK_EFFECTS.has(effect.type));
    const hasPostAttackEffect = effects.some(effect => !PRE_ATTACK_EFFECTS.has(effect.type));
    if (value.trigger === TRIGGER_BEFORE) {
      if (hasPostAttackEffect) {
        return invalid("schema", `${path}.effects`, "postEffectBeforeAttack");
      }
      const late = conditions.find(condition => !ATTACKER_SCOPED_CONDITIONS.has(condition.type));
      if (late) return invalid("schema", `${path}.conditions`, "preEffectCondition");
    }
    else if (hasPreAttackEffect) {
      // Legacy documents infer the phase from the effect type. Reject only the
      // combination that can never behave as written.
      const late = conditions.find(condition => !knowableBeforeAttack(condition));
      if (late) return invalid("schema", `${path}.conditions`, "preEffectCondition");
    }

    rules.push({
      id: value.id,
      name: value.name ?? value.id,
      enabled: value.enabled !== false,
      activation,
      ...(value.attackLimit === undefined ? {} : { attackLimit: value.attackLimit }),
      trigger: value.trigger,
      scope: value.scope,
      conditions,
      effects
    });
  }
  return { valid: true, error: null, details: null, rules };
}
