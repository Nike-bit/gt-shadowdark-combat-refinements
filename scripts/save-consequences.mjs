import { abilityName } from "./ability-saves.mjs";
import { applyMessageMode, escapeHtml, F, L, MODULE_ID } from "./lib/dom.mjs";

/** Module-registered status effects that neither Foundry core nor Shadowdark supply. */
export const MODULE_STATUS_EFFECTS = Object.freeze([
  { id: "petrified", name: "GTNPCMULTIATTACK.Conditions.petrified", img: "icons/svg/statue.svg" }
]);

const CONDITION_ICONS = Object.freeze({
  paralysis: "icons/svg/paralysis.svg",
  sleep: "icons/svg/sleep.svg",
  prone: "icons/svg/falling.svg",
  unconscious: "icons/svg/unconscious.svg",
  stun: "icons/svg/daze.svg",
  restrain: "icons/svg/net.svg",
  blind: "icons/svg/blind.svg",
  fear: "icons/svg/terror.svg",
  poison: "icons/svg/poison.svg",
  petrified: "icons/svg/statue.svg"
});

export function registerModuleStatusEffects() {
  const statusEffects = globalThis.CONFIG?.statusEffects;
  if (!Array.isArray(statusEffects)) return;
  for (const status of MODULE_STATUS_EFFECTS) {
    if (!statusEffects.some(effect => effect.id === status.id)) statusEffects.push({ ...status });
  }
}

export function conditionLabel(condition) {
  const own = MODULE_STATUS_EFFECTS.find(status => status.id === condition);
  if (own) return L(own.name);
  const core = Array.from(globalThis.CONFIG?.statusEffects ?? []).find(status => status.id === condition);
  if (core?.name) return L(core.name);
  return L(`GTNPCMULTIATTACK.Conditions.${condition}`);
}

/** Roll-independent, human-readable name of what a failed save inflicts. */
export function consequenceLabel(failure) {
  if (!failure) return "";
  if (failure.damage) return F("GTNPCMULTIATTACK.Consequences.Damage", { formula: failure.damage });
  if (failure.condition) {
    const base = failure.limb
      ? F("GTNPCMULTIATTACK.Consequences.ConditionLimb", { condition: conditionLabel(failure.condition) })
      : conditionLabel(failure.condition);
    if (!failure.duration) return base;
    return F("GTNPCMULTIATTACK.Consequences.ConditionFor", {
      condition: base,
      formula: failure.duration.formula,
      unit: L(`GTNPCMULTIATTACK.Duration.${failure.duration.unit}`)
    });
  }
  if (failure.setHp === 0) {
    return failure.deathTimer === undefined
      ? L("GTNPCMULTIATTACK.Consequences.ZeroHp")
      : F("GTNPCMULTIATTACK.Consequences.ZeroHpTimer", { timer: failure.deathTimer });
  }
  if (failure.abilityDamage) {
    return F("GTNPCMULTIATTACK.Consequences.AbilityDamage", {
      formula: failure.abilityDamage.formula,
      ability: abilityName(failure.abilityDamage.ability)
    });
  }
  return "";
}

async function rollTotal(formula, rollData = {}) {
  const roll = await new Roll(String(formula), rollData).evaluate();
  return { roll, total: Math.max(0, Math.floor(Number(roll.total) || 0)) };
}

function durationSeconds(amount, unit) {
  if (unit === "hours") return amount * 3600;
  if (unit === "days") return amount * 86400;
  return 0;
}

const LIMB_KEYS = Object.freeze(["Head", "Arm", "Arm", "Arm", "Leg", "Leg"]);

/**
 * Put a condition on the target as an ActiveEffect with the status id and, if
 * the effect declares one, a duration. Round durations are counted by Foundry
 * while a combat is active; longer ones stay until the GM clears them.
 */
export async function applyCondition(targetActor, failure, { rollData } = {}) {
  const details = { rolls: [] };
  let amount = null;
  if (failure.duration) {
    const { roll, total } = await rollTotal(failure.duration.formula, rollData);
    details.rolls.push(roll);
    amount = Math.max(1, total);
  }
  let effect = null;
  if (typeof targetActor.toggleStatusEffect === "function") {
    effect = await targetActor.toggleStatusEffect(failure.condition, { active: true, overlay: false });
  }
  if (!effect && typeof targetActor.createEmbeddedDocuments === "function") {
    [effect] = await targetActor.createEmbeddedDocuments("ActiveEffect", [{
      name: conditionLabel(failure.condition),
      img: CONDITION_ICONS[failure.condition] ?? "icons/svg/aura.svg",
      statuses: [failure.condition]
    }]);
  }
  if (effect && amount !== null && typeof effect.update === "function") {
    const duration = failure.duration.unit === "rounds"
      ? { rounds: amount, startRound: game.combat?.round ?? 0, startTurn: game.combat?.turn ?? 0 }
      : { seconds: durationSeconds(amount, failure.duration.unit), startTime: game.time?.worldTime ?? 0 };
    await effect.update({ duration, [`flags.${MODULE_ID}.appliedBy`]: "customRule" });
  }
  let limb = null;
  if (failure.limb) {
    const { roll, total } = await rollTotal("1d6");
    details.rolls.push(roll);
    limb = L(`GTNPCMULTIATTACK.Sever.${LIMB_KEYS[Math.min(5, Math.max(0, total - 1))]}`);
  }
  return {
    ...details,
    effect,
    amount,
    limb,
    label: limb
      ? F("GTNPCMULTIATTACK.Consequences.AppliedLimb", { condition: conditionLabel(failure.condition), limb })
      : amount === null
        ? conditionLabel(failure.condition)
        : F("GTNPCMULTIATTACK.Consequences.AppliedFor", {
          condition: conditionLabel(failure.condition),
          amount,
          unit: L(`GTNPCMULTIATTACK.Duration.${failure.duration.unit}`)
        })
  };
}

/** Reduce an ability score, never below zero. */
export async function applyAbilityDamage(targetActor, { ability, formula }, { rollData } = {}) {
  const key = String(ability).toLowerCase();
  const current = Math.floor(Number(targetActor.system?.abilities?.[key]?.value) || 0);
  const { roll, total } = await rollTotal(formula, rollData);
  const next = Math.max(0, current - total);
  await targetActor.update({ [`system.abilities.${key}.value`]: next });
  return {
    rolls: [roll],
    amount: total,
    before: current,
    after: next,
    label: F("GTNPCMULTIATTACK.Consequences.AppliedAbilityDamage", {
      amount: total,
      ability: abilityName(key),
      after: next
    })
  };
}

/** Actor flag naming the forced result of the *next* death timer this actor starts. */
export const PENDING_DEATH_TIMER_FLAG = "pendingDeathTimer";

export async function applyZeroHp(targetActor, failure, { rule } = {}) {
  const update = { "system.attributes.hp.value": 0 };
  const rolls = [];
  let turns = null;
  if (failure.deathTimer !== undefined) {
    // Rolled against the target's own data so a CON modifier can be written in.
    const { roll, total } = await rollTotal(failure.deathTimer, targetActor.getRollData?.() ?? {});
    rolls.push(roll);
    turns = Math.max(1, total);
    update[`flags.${MODULE_ID}.${PENDING_DEATH_TIMER_FLAG}`] = {
      turns,
      sourceRuleId: rule?.id ?? null,
      at: Date.now()
    };
  }
  await targetActor.update(update);
  return {
    rolls,
    turns,
    label: turns === null
      ? L("GTNPCMULTIATTACK.Consequences.ZeroHp")
      : F("GTNPCMULTIATTACK.Consequences.ZeroHpTimer", { timer: turns })
  };
}

/** Whispered-to-everyone record of what a failed save did to the target. */
export async function postConsequence({ rule, attacker, targetActor, outcome, note, rollMode }) {
  const lines = [`<p><strong>${escapeHtml(rule.name)}</strong> — ${escapeHtml(F(
    "GTNPCMULTIATTACK.Consequences.Suffered",
    { target: targetActor.name, outcome: outcome.label }
  ))}</p>`];
  if (note) lines.push(`<p class="gt-npc-ma-consequence-note">${escapeHtml(note)}</p>`);
  const chatData = {
    content: lines.join(""),
    speaker: ChatMessage.getSpeaker({ actor: attacker }),
    author: game.user.id,
    rolls: outcome.rolls ?? [],
    flags: { [MODULE_ID]: { customRule: rule.id, consequence: true } }
  };
  if (rollMode) applyMessageMode(chatData, rollMode);
  return ChatMessage.create(chatData);
}

export const saveConsequencesTestApi = Object.freeze({
  applyAbilityDamage,
  applyCondition,
  applyZeroHp,
  conditionLabel,
  consequenceLabel
});
