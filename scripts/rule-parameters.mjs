import { abilityName } from "./ability-saves.mjs";
import { conditionLabel } from "./save-consequences.mjs";
import { CONDITION_IDS, DURATION_UNITS, SAVE_ABILITIES, validateCustomRules } from "./custom-rule-schema.mjs";
import { L } from "./lib/dom.mjs";

// The fields a GM may change on an applied feature without opening the JSON.
// Each descriptor names a path inside the effect (or `name` on the rule) and a
// kind that decides which input to draw and how to coerce what comes back.

const DIE_FACES = Object.freeze([4, 6, 8, 10, 12]);
/** Effects the schema lets narrow to one firing per target. */
const ONCE_PER_TARGET_EFFECTS = new Set([
  "extraDamage", "extraDamageDie", "extraBaseDamage", "shatterGear", "stealGear",
  "swallow", "severLimb", "save", "abilityDamage"
]);

function descriptor(effectIndex, path, kind, labelKey, value, extra = {}) {
  return {
    id: `${effectIndex === null ? "rule" : `e${effectIndex}`}:${path}`,
    effectIndex,
    path,
    kind,
    label: L(labelKey),
    value,
    ...extra
  };
}

/** Editable parameters for one validated rule, in display order. */
export function ruleParameters(rule) {
  const out = [descriptor(null, "name", "text", "GTNPCMULTIATTACK.Parameters.Name", rule.name)];
  for (const [index, effect] of rule.effects.entries()) {
    const add = (path, kind, labelKey, value, extra) => out.push(descriptor(index, path, kind, labelKey, value, extra));
    switch (effect.type) {
      case "save": {
        add("ability", "ability", "GTNPCMULTIATTACK.Parameters.Ability", effect.ability);
        add("dc", "dc", "GTNPCMULTIATTACK.Parameters.Dc", effect.dc);
        const failure = effect.onFailure ?? {};
        if (failure.damage !== undefined) {
          add("onFailure.damage", "formula", "GTNPCMULTIATTACK.Parameters.Damage", failure.damage);
        }
        if (failure.condition !== undefined) {
          add("onFailure.condition", "condition", "GTNPCMULTIATTACK.Parameters.Condition", failure.condition);
          if (failure.duration) {
            add("onFailure.duration.formula", "formula", "GTNPCMULTIATTACK.Parameters.Duration", failure.duration.formula);
            add("onFailure.duration.unit", "unit", "GTNPCMULTIATTACK.Parameters.DurationUnit", failure.duration.unit);
          }
          if (failure.limb !== undefined) {
            add("onFailure.limb", "boolean", "GTNPCMULTIATTACK.Parameters.Limb", failure.limb);
          }
        }
        if (failure.setHp === 0) {
          // Always offered: features applied before 1.3.2 stored no timer, and
          // an emptied field means "leave the death timer to the system".
          add("onFailure.deathTimer", "formula", "GTNPCMULTIATTACK.Parameters.DeathTimer",
            failure.deathTimer ?? "", { optional: true });
        }
        if (failure.abilityDamage) {
          add("onFailure.abilityDamage.ability", "ability", "GTNPCMULTIATTACK.Parameters.DrainedAbility", failure.abilityDamage.ability);
          add("onFailure.abilityDamage.formula", "formula", "GTNPCMULTIATTACK.Parameters.Damage", failure.abilityDamage.formula);
        }
        if (failure.note !== undefined) {
          add("onFailure.note", "text", "GTNPCMULTIATTACK.Parameters.Note", failure.note);
        }
        break;
      }
      case "abilityDamage":
        add("ability", "ability", "GTNPCMULTIATTACK.Parameters.DrainedAbility", effect.ability);
        add("formula", "formula", "GTNPCMULTIATTACK.Parameters.Damage", effect.formula);
        if (effect.note !== undefined) add("note", "text", "GTNPCMULTIATTACK.Parameters.Note", effect.note);
        break;
      case "extraDamage":
      case "selfDamage":
        add("formula", "formula", "GTNPCMULTIATTACK.Parameters.Damage", effect.formula);
        break;
      case "extraDamageDie":
        add("count", "integer", "GTNPCMULTIATTACK.Parameters.Dice", effect.count, { min: 1, max: 20 });
        break;
      case "extraBaseDamage":
        add("multiplier", "integer", "GTNPCMULTIATTACK.Parameters.Multiplier", effect.multiplier, { min: 1, max: 10 });
        break;
      case "damageBonus":
        add("amount", "integer", "GTNPCMULTIATTACK.Parameters.Bonus", effect.amount, { min: -100, max: 100 });
        break;
      case "replaceDamageDie":
        add("from", "die", "GTNPCMULTIATTACK.Parameters.DieFrom", effect.from);
        add("to", "die", "GTNPCMULTIATTACK.Parameters.DieTo", effect.to);
        break;
      case "swallow":
        add("dc", "dc", "GTNPCMULTIATTACK.Parameters.Dc", effect.dc);
        add("damage", "formula", "GTNPCMULTIATTACK.Parameters.Damage", effect.damage);
        add("releaseDamage", "integer", "GTNPCMULTIATTACK.Parameters.ReleaseDamage", effect.releaseDamage, { min: 1, max: 1000 });
        break;
      default:
        break;
    }
    if (ONCE_PER_TARGET_EFFECTS.has(effect.type)) {
      add("oncePerTarget", "boolean", "GTNPCMULTIATTACK.Parameters.OncePerTarget", effect.oncePerTarget === true);
    }
  }
  return out;
}

/** Options for select-type parameters. */
export function parameterOptions(kind) {
  if (kind === "ability") return SAVE_ABILITIES.map(key => ({ value: key, label: abilityName(key) }));
  if (kind === "condition") return CONDITION_IDS.map(id => ({ value: id, label: conditionLabel(id) }));
  if (kind === "unit") return DURATION_UNITS.map(unit => ({ value: unit, label: L(`GTNPCMULTIATTACK.Duration.${unit}`) }));
  if (kind === "die") return DIE_FACES.map(faces => ({ value: faces, label: `d${faces}` }));
  return [];
}

/** Coerce a raw input value into what the schema expects for this kind. */
export function coerceParameter(kind, raw) {
  if (kind === "boolean") return raw === true || raw === "true" || raw === "on";
  if (kind === "dc" || kind === "integer" || kind === "die") {
    const number = Number.parseInt(raw, 10);
    return Number.isFinite(number) ? number : null;
  }
  return String(raw ?? "").trim();
}

function setPath(target, path, value) {
  const keys = path.split(".");
  let cursor = target;
  for (const key of keys.slice(0, -1)) {
    if (!cursor[key] || typeof cursor[key] !== "object") cursor[key] = {};
    cursor = cursor[key];
  }
  cursor[keys.at(-1)] = value;
}

function deletePath(target, path) {
  const keys = path.split(".");
  let cursor = target;
  for (const key of keys.slice(0, -1)) {
    if (!cursor?.[key] || typeof cursor[key] !== "object") return;
    cursor = cursor[key];
  }
  delete cursor[keys.at(-1)];
}

/**
 * Return the rules document JSON with one parameter changed, or null with a
 * validation result when the change would make the document invalid. An
 * optional parameter left empty is removed from the effect instead.
 */
export function sourceWithParameter(source, ruleId, parameter, rawValue) {
  let document;
  try { document = JSON.parse(source); }
  catch (_error) { return { source: null, validation: validateCustomRules(source) }; }
  const rule = (document.rules ?? []).find(candidate => candidate.id === ruleId);
  if (!rule) return { source: null, validation: validateCustomRules(document) };
  const value = coerceParameter(parameter.kind, rawValue);
  const cleared = parameter.optional === true && value === "";
  if (value === null || (!cleared && parameter.kind !== "boolean" && value === "" && parameter.path !== "name")) {
    return { source: null, validation: { valid: false, details: { path: parameter.path, code: "type" } } };
  }
  if (parameter.effectIndex === null) {
    if (parameter.path === "name") rule.name = value;
  }
  else {
    const effect = rule.effects?.[parameter.effectIndex];
    if (!effect) return { source: null, validation: validateCustomRules(document) };
    // Stored documents may still use the pre-1.3 `damage` shorthand on a save.
    if (effect.type === "save" && effect.onFailure === undefined && effect.damage !== undefined) {
      effect.onFailure = { damage: effect.damage };
      delete effect.damage;
    }
    if (cleared) deletePath(effect, parameter.path);
    else setPath(effect, parameter.path, value);
  }
  const validation = validateCustomRules(document);
  return validation.valid
    ? { source: JSON.stringify(document, null, 2), validation }
    : { source: null, validation };
}

export const ruleParametersTestApi = Object.freeze({
  coerceParameter,
  parameterOptions,
  ruleParameters,
  sourceWithParameter
});
