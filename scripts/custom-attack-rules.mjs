import {
  ATTACKER_SCOPED_CONDITIONS,
  DEFAULT_CUSTOM_RULE_SOURCE,
  TARGET_SCOPED_CONDITIONS,
  TRIGGER_BEFORE,
  validateCustomRules
} from "./custom-rule-schema.mjs";
import {
  applyPresetToRuleSource,
  formatValidationError,
  getPresetCatalog,
  openPresetLibrary
} from "./preset-library.mjs";
import {
  chooseRandomGear,
  hasStealableProperty,
  shatterGear,
  stealCoins,
  stealGear
} from "./attack-inventory-effects.mjs";
import {
  drawCoinAmount,
  drawTheftWinner,
  promptGearTheft,
  theftCandidates
} from "./gear-theft-dialog.mjs";
import { swallowTarget } from "./swallow-system.mjs";
import { rollAbilitySave } from "./ability-saves.mjs";
import { postSaveRequest, registerSaveRequestResolver, shouldRequestSave } from "./save-requests.mjs";
import {
  applyAbilityDamage,
  applyCondition,
  applyZeroHp,
  consequenceLabel,
  postConsequence
} from "./save-consequences.mjs";
import { actorItem, applyMessageMode, documentFlag, escapeHtml, F, L, MODULE_ID } from "./lib/dom.mjs";
import { parameterOptions, ruleParameters, sourceWithParameter } from "./rule-parameters.mjs";

const RULE_META_KEY = "gtNpcMultiattackRules";
const RULE_LINK_KEY = "gtNpcMultiattackRuleLink";
const RULES_FLAG = "customRules";
const ENABLED_FLAG = "customRulesEnabled";
const MAX_SESSION_REGISTRY_SIZE = 100;
/**
 * Effects that fire once per qualifying hit rather than once per target.
 * `oncePerTarget` on the effect narrows any of them back to one firing.
 */
const PER_HIT_EFFECTS = new Set(["severLimb", "save", "abilityDamage", "shatterGear", "stealGear"]);
const SESSION_TTL_MS = 60 * 60 * 1000;
const ruleSessionRegistry = new Map();
let fallbackSessionId = 0;

function createSessionId() {
  if (typeof globalThis.foundry?.utils?.randomID === "function") return globalThis.foundry.utils.randomID();
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  fallbackSessionId += 1;
  return `${Date.now().toString(36)}-${fallbackSessionId.toString(36)}`;
}

function pruneRuleSessionRegistry() {
  const cutoff = Date.now() - SESSION_TTL_MS;
  for (const [sessionId, entry] of ruleSessionRegistry) {
    if (entry.lastUsed < cutoff) ruleSessionRegistry.delete(sessionId);
  }
  while (ruleSessionRegistry.size >= MAX_SESSION_REGISTRY_SIZE) {
    ruleSessionRegistry.delete(ruleSessionRegistry.keys().next().value);
  }
}

function registerRuleSession(config, session) {
  pruneRuleSessionRegistry();
  ruleSessionRegistry.set(session.sessionId, { config, session, lastUsed: Date.now() });
}

function registeredRuleSession(sessionId) {
  pruneRuleSessionRegistry();
  const registered = ruleSessionRegistry.get(sessionId);
  if (!registered) return null;
  registered.lastUsed = Date.now();
  return registered;
}

function sourceFromItem(item) {
  const stored = documentFlag(item, RULES_FLAG);
  if (typeof stored === "string") return stored;
  if (stored && typeof stored === "object") return JSON.stringify(stored, null, 2);
  return DEFAULT_CUSTOM_RULE_SOURCE;
}

async function updateItemFlags(item, values) {
  const update = Object.fromEntries(Object.entries(values)
    .map(([key, value]) => [`flags.${MODULE_ID}.${key}`, value]));
  if (typeof item?.update === "function") return item.update(update, { render: false });
  return Promise.all(Object.entries(values).map(([key, value]) => item.setFlag(MODULE_ID, key, value)));
}

function updateSessionValidation(session, source) {
  session.source = source;
  session.validation = validateCustomRules(source);
  session.rules = session.validation.valid ? session.validation.rules : [];
  return session.validation;
}

export function initializeCustomRuleSession(config, item) {
  if (config[RULE_META_KEY]) {
    registerRuleSession(config, config[RULE_META_KEY]);
    return config[RULE_META_KEY];
  }
  const source = sourceFromItem(item);
  const session = {
    sessionId: createSessionId(),
    itemUuid: item?.uuid,
    enabled: documentFlag(item, ENABLED_FLAG) === true,
    source,
    validation: null,
    rules: [],
    ledger: [],
    currentBatchId: 0,
    nextBatchId: 1,
    activeManual: {},
    preparedBatches: {},
    actionPlans: {},
    fired: {}
  };
  updateSessionValidation(session, source);
  config[RULE_META_KEY] = session;
  registerRuleSession(config, session);
  return session;
}

export function clearCustomRuleMetadata(config) {
  if (config) delete config[RULE_META_KEY];
}

export function hasActiveCustomRules(config) {
  const session = config?.[RULE_META_KEY];
  return Boolean(session?.enabled && session.validation?.valid
    && session.rules.some(rule => rule.enabled && isRuleActive(session, rule)));
}

function isRuleActive(session, rule) {
  return rule.activation !== "manual" || session.activeManual?.[rule.id] === true;
}

export function manualRuleDefinitions(config) {
  const session = config?.[RULE_META_KEY];
  if (!session?.enabled || !session.validation?.valid) return [];
  return session.rules.filter(rule => rule.enabled && rule.activation === "manual");
}

export function activeManualAttackLimit(config) {
  const session = config?.[RULE_META_KEY];
  const limits = manualRuleDefinitions(config)
    .filter(rule => session.activeManual?.[rule.id] === true && Number.isInteger(rule.attackLimit))
    .map(rule => rule.attackLimit);
  return limits.length ? Math.min(...limits) : null;
}

export function setManualRuleActive(config, ruleId, active) {
  const session = config?.[RULE_META_KEY];
  const rule = manualRuleDefinitions(config).find(value => value.id === ruleId);
  if (!session || !rule) return false;
  session.activeManual[ruleId] = active === true;
  return session.activeManual[ruleId];
}

export function beginCustomRuleBatch(config) {
  const session = config?.[RULE_META_KEY];
  if (!session) return 0;
  session.currentBatchId = session.nextBatchId++;
  return session.currentBatchId;
}

export function linkCustomRuleAttack(config, attackConfig, batchId, attackIndex) {
  const session = config?.[RULE_META_KEY];
  if (!session || !attackConfig) return null;
  const link = {
    sessionId: session.sessionId,
    resultId: `${session.sessionId}:${batchId}:${attackIndex}`,
    batchId
  };
  attackConfig[RULE_LINK_KEY] = link;
  return link;
}

export function naturalAttackRoll(result) {
  const dice = Array.from(result?.dice ?? result?.terms ?? []).filter(term => Number(term?.faces) === 20);
  for (const die of dice) {
    const results = Array.from(die?.results ?? []);
    const active = results.find(value => value?.active === true)
      ?? results.find(value => value?.discarded !== true && value?.active !== false)
      ?? (results.length === 1 ? results[0] : null);
    const natural = Number(active?.result);
    if (Number.isInteger(natural) && natural >= 1 && natural <= 20) return natural;
  }
  return null;
}

export function recordCustomRuleResult(config, attackConfig, result, batchId) {
  const session = config?.[RULE_META_KEY];
  if (!session || !result || result === false) return null;
  const link = attackConfig?.[RULE_LINK_KEY];
  const resultId = link?.resultId ?? `${session.sessionId}:legacy:${session.ledger.length + 1}`;
  const existing = session.ledger.find(value => value.resultId === resultId);
  const entry = existing ?? {
    resultId,
    batchId: link?.batchId ?? batchId,
    attackIndex: session.ledger.length + 1,
    itemUuid: session.itemUuid,
    targetUuid: null,
    success: false,
    criticalSuccess: false,
    attackTotal: null,
    naturalAttackRoll: null
  };
  Object.assign(entry, {
    targetUuid: attackConfig?.targetUuid ?? entry.targetUuid,
    success: result.success === true,
    criticalSuccess: result.criticalSuccess === true,
    attackTotal: Number.isFinite(Number(result.total)) ? Number(result.total) : null,
    naturalAttackRoll: naturalAttackRoll(result)
  });
  if (!existing) session.ledger.push(entry);
  return entry;
}

export async function recordCustomRuleReroll(rollConfig, result) {
  const link = rollConfig?.[RULE_LINK_KEY];
  if (!link?.sessionId || !link.resultId || !result || result === false) return [];
  const registered = registeredRuleSession(link.sessionId);
  if (!registered) return [];
  recordCustomRuleResult(registered.config, rollConfig, result, link.batchId);
  return evaluateCustomRules(registered.config, link.batchId);
}

/**
 * Targets an afterAttackBatch rule applies to.
 *
 * Attacker-scoped conditions gate the whole rule; target-scoped conditions name
 * which targets qualify. A rule whose only conditions are attacker-scoped used to
 * qualify nobody and silently never fire, so it now falls back to every target
 * successfully hit within the rule's scope.
 */
function qualifyingTargetUuids(rule, entries, attackerState = {}) {
  for (const condition of rule.conditions) {
    if (!ATTACKER_SCOPED_CONDITIONS.has(condition.type)) continue;
    if (condition.type === "attackerInjured" && attackerState.injured !== true) return [];
  }
  if (!rule.conditions.some(condition => TARGET_SCOPED_CONDITIONS.has(condition.type))) {
    return Array.from(new Set(entries
      .filter(entry => entry.success && entry.targetUuid)
      .map(entry => entry.targetUuid)));
  }

  let qualified = null;
  for (const condition of rule.conditions) {
    let current = null;
    if (condition.type === "sameTargetHits") {
      const hits = new Map();
      for (const entry of entries) {
        if (!entry.success || !entry.targetUuid) continue;
        hits.set(entry.targetUuid, (hits.get(entry.targetUuid) ?? 0) + 1);
      }
      current = new Set(Array.from(hits)
        .filter(([_uuid, count]) => count >= condition.minimum)
        .map(([uuid]) => uuid));
    }
    else if (condition.type === "naturalAttackRollAtLeast") {
      current = new Set(entries
        .filter(entry => entry.success && entry.targetUuid
          && Number(entry.naturalAttackRoll) >= condition.minimum)
        .map(entry => entry.targetUuid));
    }
    if (!current) continue;
    qualified = qualified === null
      ? current
      : new Set(Array.from(qualified).filter(uuid => current.has(uuid)));
  }
  return Array.from(qualified ?? []);
}

function standardDamageParts(formula) {
  const match = String(formula ?? "").replace(/\s+/g, "").match(/^(\d*)d(\d+)([+-]\d+)?$/i);
  if (!match) return null;
  return {
    count: Number(match[1] || 1),
    faces: Number(match[2]),
    flat: Number(match[3] || 0)
  };
}

function activeRules(config) {
  const session = config?.[RULE_META_KEY];
  if (!session?.enabled || !session.validation?.valid) return [];
  return session.rules.filter(rule => rule.enabled && isRuleActive(session, rule));
}

async function actorFromConfig(config) {
  return typeof fromUuid === "function" ? fromUuid(config?.actorUuid) : null;
}

/** Whether an effect may act on this target, per its targetActorTypes field. */
function effectAllowsTargetActor(effect, targetActor) {
  if (!Array.isArray(effect.targetActorTypes)) return true;
  return Boolean(targetActor) && effect.targetActorTypes.includes(targetActor.type);
}

async function targetActorFromUuid(uuid) {
  const document = typeof fromUuid === "function" ? await fromUuid(uuid) : null;
  return document?.actor ?? (document?.documentName === "Actor" ? document : null);
}

function isAttackerInjured(actor) {
  const hp = actor?.system?.attributes?.hp;
  return Number(hp?.value) < Number(hp?.max);
}

/**
 * Whether a rule's pre-attack effects may apply. The schema guarantees that any
 * condition reaching this point is knowable before the roll, so only the
 * attacker-scoped ones actually gate anything.
 */
function ruleConditionsAllowPreEffects(rule, actor) {
  return rule.conditions.every(condition =>
    condition.type !== "attackerInjured" || isAttackerInjured(actor));
}

function appendDamageBonus(formula, amount) {
  const numeric = Number(amount) || 0;
  if (!formula || !numeric) return formula;
  return `${formula}${numeric > 0 ? "+" : ""}${numeric}`;
}

function replaceDamageDie(formula, from, to) {
  return String(formula ?? "").replace(new RegExp(`d${from}(?!\\d)`, "gi"), `d${to}`);
}

async function executeSelfDamage(config, rule, effect) {
  const actor = await actorFromConfig(config);
  if (!actor?.applyDamage) return false;
  const rollConfig = {
    label: rule.name,
    formula: effect.formula,
    base: effect.formula,
    type: "damage",
    needed: true,
    criticalHit: false
  };
  const roll = await shadowdark.dice.roll(rollConfig, actor.getRollData());
  const chatConfig = {
    actorUuid: actor.uuid,
    targetUuid: actor.getActiveTokens?.(true, true)?.[0]?.document?.uuid,
    type: "damage",
    heading: rule.name,
    damageRoll: rollConfig
  };
  const chatData = await shadowdark.chat.renderRollMessage(chatConfig, [roll]);
  chatData.flags ??= {};
  chatData.flags[MODULE_ID] = { customRule: rule.id, selfDamage: true };
  await ChatMessage.create(chatData);
  await actor.applyDamage(roll.total);
  return true;
}

export async function prepareCustomRuleAttack(config, attackConfig, batchId, attackIndex) {
  const session = config?.[RULE_META_KEY];
  if (!session) return attackConfig;
  const actor = await actorFromConfig(config);
  for (const rule of activeRules(config)) {
    if (!ruleConditionsAllowPreEffects(rule, actor)) continue;
    for (const [effectIndex, effect] of rule.effects.entries()) {
      if (effect.type === "forceAdvantage" && attackConfig.mainRoll) {
        attackConfig.mainRoll.advantage = 1;
      }
      else if (effect.type === "selfDamage") {
        // Paid per attack, before its dice: Algae-Eater's 1d4 buys one
        // advantaged swing, not a whole batch of them.
        await executeSelfDamage(config, rule, effect);
      }
      else if (effect.type === "damageBonus" && attackConfig.damageRoll?.formula) {
        attackConfig.damageRoll.formula = appendDamageBonus(attackConfig.damageRoll.formula, effect.amount);
      }
      else if (effect.type === "replaceDamageDie" && attackConfig.damageRoll?.formula) {
        attackConfig.damageRoll.formula = replaceDamageDie(attackConfig.damageRoll.formula, effect.from, effect.to);
      }
      else if (["shatterGear", "stealGear"].includes(effect.type) && attackConfig.targetUuid) {
        const targetActor = await targetActorFromUuid(attackConfig.targetUuid);
        if (!effectAllowsTargetActor(effect, targetActor)) continue;
        // One plan per attack: two hits in a batch ruin two pieces of gear.
        const planKey = actionPlanKey(rule, effectIndex, attackConfig[RULE_LINK_KEY]?.resultId ?? attackConfig.targetUuid);
        // A GM-curated theft cannot choose its item yet, but it still has to
        // know whether there is anything at all to take before it suppresses
        // damage. Gems and coins count, not just carried gear.
        if (effect.type === "stealGear" && effect.selection === "prompt") {
          if (!hasStealableProperty(targetActor)) continue;
          session.actionPlans[planKey] = {
            batchId,
            attackIndex,
            prompt: true,
            targetUuid: attackConfig.targetUuid
          };
        }
        else {
          const mode = effect.type === "shatterGear" ? "shatter" : effect.mode;
          const item = chooseRandomGear(targetActor, mode);
          if (!item) continue;
          session.actionPlans[planKey] = {
            batchId,
            attackIndex,
            itemId: item.id,
            targetUuid: attackConfig.targetUuid
          };
        }
        if (effect.type === "shatterGear" || effect.replaceDamage) {
          attackConfig.damageRoll ??= {};
          attackConfig.damageRoll.formula = "";
          attackConfig.damageRoll.base = "";
          attackConfig.damageRoll.needed = false;
        }
      }
    }
  }
  return attackConfig;
}

function actionPlanKey(rule, effectIndex, occasion) {
  return `${rule.id}:${effectIndex}:${occasion}`;
}

function formulaForEffect(config, effect) {
  if (effect.type === "extraDamage") return effect.formula;
  const parts = standardDamageParts(config.damageRoll?.formula ?? config.damageRoll?.base);
  if (!parts) return null;
  if (effect.type === "extraDamageDie") return `${effect.count}d${parts.faces}`;
  if (effect.type === "extraBaseDamage") {
    const dice = parts.count * effect.multiplier;
    const flat = parts.flat * effect.multiplier;
    return `${dice}d${parts.faces}${flat === 0 ? "" : flat > 0 ? `+${flat}` : flat}`;
  }
  return null;
}

async function executeExtraDamage(
  config, session, rule, effect, effectIndex, targetUuid, formula, { criticalHit = false } = {}
) {
  const firedKey = `${rule.id}:${effectIndex}`;
  session.fired[firedKey] ??= [];
  if (effect.oncePerTarget && session.fired[firedKey].includes(targetUuid)) return false;

  const actor = typeof fromUuid === "function" ? await fromUuid(config.actorUuid) : null;
  if (!actor) return false;
  const damageConfig = {
    actorUuid: config.actorUuid,
    type: "attack",
    heading: rule.name,
    targetUuid,
    rollMode: config.rollMode,
    damageRoll: {
      label: L("GTNPCMULTIATTACK.Rules.ExtraDamage"),
      formula,
      base: formula,
      type: "damage",
      needed: true,
      criticalHit: effect.crits === true && criticalHit === true
    }
  };
  const damageRoll = await shadowdark.dice.roll(damageConfig.damageRoll, actor.getRollData());
  const chatData = await shadowdark.chat.renderRollMessage(damageConfig, [damageRoll]);
  chatData.flags ??= {};
  chatData.flags[MODULE_ID] = {
    customRule: rule.id,
    sourceItemUuid: session.itemUuid,
    targetUuid
  };
  await ChatMessage.create(chatData);
  if (effect.oncePerTarget) session.fired[firedKey].push(targetUuid);
  return true;
}

function firedKey(rule, effectIndex) {
  return `${rule.id}:${effectIndex}`;
}

function alreadyFired(session, rule, effectIndex, targetUuid) {
  return session.fired[firedKey(rule, effectIndex)]?.includes(targetUuid) === true;
}

function markFired(session, rule, effectIndex, targetUuid) {
  const key = firedKey(rule, effectIndex);
  session.fired[key] ??= [];
  if (!session.fired[key].includes(targetUuid)) session.fired[key].push(targetUuid);
}

function severLimbKey(total) {
  if (total === 1) return "Head";
  if (total >= 2 && total <= 4) return "Arm";
  return "Leg";
}

async function executeSeverLimb(config, session, rule, effect, effectIndex, entry) {
  // With oncePerTarget (the default) a target loses at most one limb per
  // session, however many qualifying attacks land.
  const resultKey = effect.oncePerTarget === false ? entry.resultId : entry.targetUuid;
  if (!resultKey || alreadyFired(session, rule, effectIndex, resultKey)) return false;
  const target = typeof fromUuid === "function" ? await fromUuid(entry.targetUuid) : null;
  const actor = await actorFromConfig(config);
  if (!target || !actor) return false;
  const roll = await new Roll("1d6").evaluate();
  const total = Math.max(1, Math.min(6, Math.floor(Number(roll.total) || 1)));
  const limb = L(`GTNPCMULTIATTACK.Sever.${severLimbKey(total)}`);
  const targetName = target.name ?? target.actor?.name ?? entry.targetUuid;
  const content = await foundry.applications.handlebars.renderTemplate(
    `modules/${MODULE_ID}/templates/sever-result.hbs`,
    {
      title: rule.name,
      result: F("GTNPCMULTIATTACK.Sever.Result", {
        target: targetName,
        limb,
        roll: total
      })
    }
  );
  const chatData = {
    content,
    rolls: [roll],
    speaker: ChatMessage.getSpeaker({ actor }),
    author: game.user.id,
    flags: {
      [MODULE_ID]: {
        customRule: rule.id,
        sourceItemUuid: session.itemUuid,
        targetUuid: entry.targetUuid,
        severLimb: limb
      }
    }
  };
  const style = globalThis.CONST?.CHAT_MESSAGE_STYLES?.ROLL;
  if (style !== undefined) chatData.style = style;
  applyMessageMode(chatData, config.rollMode);
  await ChatMessage.create(chatData);
  markFired(session, rule, effectIndex, resultKey);
  return true;
}

/**
 * GM-curated theft: show everything the target is carrying, let the GM narrow
 * the field, then let the dice pick from what is left.
 */
async function executePromptedTheft(config, rule, attacker, targetActor) {
  const candidates = theftCandidates(targetActor);
  if (!candidates.length) return false;
  const chosen = await promptGearTheft({
    attacker,
    target: targetActor,
    ruleName: rule.name,
    candidates
  });
  if (!chosen.length) {
    await postTheftResult(config, rule, attacker, targetActor, { taken: null });
    return false;
  }
  const { entry, formula, roll } = await drawTheftWinner(chosen);
  if (!entry) return false;

  if (entry.kind === "coin") {
    const { amount, rolled, roll: amountRoll } = await drawCoinAmount(entry);
    const taken = await stealCoins(attacker, targetActor, entry.denomination, amount);
    if (!taken) return false;
    await postTheftResult(config, rule, attacker, targetActor, {
      taken: { label: `${taken.amount} ${entry.name}` },
      pool: chosen.length,
      formula,
      roll,
      coinRolled: rolled,
      coinRoll: amountRoll
    });
    return true;
  }

  const stolen = await stealGear(attacker, targetActor, entry.itemId);
  if (!stolen) return false;
  await postTheftResult(config, rule, attacker, targetActor, {
    taken: { label: entry.name, uuid: stolen.uuid },
    pool: chosen.length,
    formula,
    roll
  });
  return true;
}

/** Whispered record of what Greedy did, including the "nothing" outcome. */
async function postTheftResult(config, rule, attacker, targetActor, outcome) {
  const lines = [`<p><strong>${escapeHtml(rule.name)}</strong></p>`];
  if (!outcome.taken) {
    lines.push(`<p>${escapeHtml(F("GTNPCMULTIATTACK.Inventory.TookNothing", {
      attacker: attacker.name,
      target: targetActor.name
    }))}</p>`);
  }
  else {
    const label = outcome.taken.uuid
      ? `@UUID[${outcome.taken.uuid}]{${escapeHtml(outcome.taken.label)}}`
      : escapeHtml(outcome.taken.label);
    lines.push(`<p>${F("GTNPCMULTIATTACK.Inventory.TookItem", {
      attacker: escapeHtml(attacker.name),
      target: escapeHtml(targetActor.name),
      item: label
    })}</p>`);
    if (outcome.formula) {
      lines.push(`<p class="gt-npc-ma-theft-roll">${escapeHtml(F("GTNPCMULTIATTACK.Inventory.TheftRoll", {
        formula: outcome.formula,
        result: outcome.roll?.total ?? "",
        pool: outcome.pool
      }))}</p>`);
    }
    if (outcome.coinRolled !== undefined) {
      lines.push(`<p class="gt-npc-ma-theft-roll">${escapeHtml(F("GTNPCMULTIATTACK.Inventory.CoinRoll", {
        rolled: outcome.coinRolled
      }))}</p>`);
    }
  }
  const rolls = [outcome.roll, outcome.coinRoll].filter(Boolean);
  const chatData = {
    content: lines.join(""),
    speaker: ChatMessage.getSpeaker({ actor: attacker }),
    author: game.user.id,
    rolls,
    flags: { [MODULE_ID]: { customRule: rule.id, gearTheft: true } }
  };
  applyMessageMode(chatData, "gm");
  await ChatMessage.create(chatData);
}

/** Post one damage card against the target and apply it. */
async function dealEffectDamage(config, rule, attacker, targetActor, targetUuid, formula, label) {
  const damageConfig = {
    label,
    formula,
    base: formula,
    type: "damage",
    needed: true,
    criticalHit: false
  };
  const roll = await shadowdark.dice.roll(damageConfig, attacker.getRollData());
  const chatData = await shadowdark.chat.renderRollMessage({
    actorUuid: attacker.uuid,
    targetUuid,
    type: "damage",
    heading: rule.name,
    rollMode: config.rollMode,
    damageRoll: damageConfig
  }, [roll]);
  chatData.flags ??= {};
  chatData.flags[MODULE_ID] = { customRule: rule.id, saveDamage: true, targetUuid };
  await ChatMessage.create(chatData);
  await targetActor.applyDamage?.(roll.total);
  return roll;
}

/** Carry out one structured consequence and post the record of it. */
async function applyFailure(config, rule, attacker, targetActor, targetUuid, failure) {
  const rollData = attacker.getRollData?.() ?? {};
  if (failure.damage) {
    await dealEffectDamage(
      config, rule, attacker, targetActor, targetUuid, failure.damage,
      L("GTNPCMULTIATTACK.Saves.FailureDamage")
    );
    if (failure.note) {
      await postConsequence({
        rule, attacker, targetActor, note: failure.note, rollMode: config.rollMode,
        outcome: { label: consequenceLabel(failure), rolls: [] }
      });
    }
    return true;
  }
  let outcome = null;
  if (failure.condition) outcome = await applyCondition(targetActor, failure, { rollData });
  else if (failure.setHp === 0) outcome = await applyZeroHp(targetActor, failure, { rule });
  else if (failure.abilityDamage) outcome = await applyAbilityDamage(targetActor, failure.abilityDamage, { rollData });
  if (!outcome) return false;
  await postConsequence({
    rule, attacker, targetActor, outcome, note: failure.note, rollMode: config.rollMode
  });
  return true;
}

/** Request kind under which a rule's failed save comes back to `applyFailure`. */
const SAVE_REQUEST_KIND = "customRuleSave";

registerSaveRequestResolver(SAVE_REQUEST_KIND, async request => {
  const attacker = typeof fromUuid === "function" ? await fromUuid(request.attackerUuid) : null;
  const targetActor = await targetActorFromUuid(request.targetUuid);
  if (!attacker || !targetActor || !request.payload?.onFailure) return false;
  return applyFailure(
    { rollMode: request.rollMode },
    { id: request.ruleId, name: request.ruleName },
    attacker, targetActor, request.targetUuid, request.payload.onFailure
  );
});

/**
 * The target makes an ability check against the rule's DC; on failure the
 * declared consequence is applied. Fires once per qualifying hit. In the
 * interactive mode the check is handed to the player as a request card and
 * the consequence follows from the GM's client once it is answered.
 */
async function executeSave(config, session, rule, effect, effectIndex, entry) {
  const key = effect.oncePerTarget ? entry.targetUuid : entry.resultId;
  if (!key || alreadyFired(session, rule, effectIndex, key)) return false;
  const attacker = await actorFromConfig(config);
  const targetActor = await targetActorFromUuid(entry.targetUuid);
  if (!attacker || !targetActor || !effectAllowsTargetActor(effect, targetActor)) return false;
  const resisting = consequenceLabel(effect.onFailure);
  if (shouldRequestSave(targetActor)) {
    const posted = await postSaveRequest({
      kind: SAVE_REQUEST_KIND,
      ruleId: rule.id,
      ruleName: rule.name,
      attackerUuid: config.actorUuid,
      targetUuid: entry.targetUuid,
      ability: effect.ability,
      dc: effect.dc,
      resisting,
      rollMode: config.rollMode,
      payload: { onFailure: effect.onFailure }
    });
    if (!posted) return false;
    markFired(session, rule, effectIndex, key);
    return true;
  }
  const save = await rollAbilitySave(targetActor, {
    ability: effect.ability,
    dc: effect.dc,
    rollMode: config.rollMode,
    title: rule.name,
    resisting
  });
  if (!save) return false;
  markFired(session, rule, effectIndex, key);
  if (save.success === true) return true;
  await applyFailure(config, rule, attacker, targetActor, entry.targetUuid, effect.onFailure);
  return true;
}

/** Ability score damage with no save: Drain, Life Drain. Once per qualifying hit. */
async function executeAbilityDamage(config, session, rule, effect, effectIndex, entry) {
  const key = effect.oncePerTarget ? entry.targetUuid : entry.resultId;
  if (!key || alreadyFired(session, rule, effectIndex, key)) return false;
  const attacker = await actorFromConfig(config);
  const targetActor = await targetActorFromUuid(entry.targetUuid);
  if (!attacker || !targetActor || !effectAllowsTargetActor(effect, targetActor)) return false;
  markFired(session, rule, effectIndex, key);
  return applyFailure(config, rule, attacker, targetActor, entry.targetUuid, {
    abilityDamage: { ability: effect.ability, formula: effect.formula },
    note: effect.note
  });
}

/**
 * Inventory and swallow effects. Per-hit effects pass the hit `entry`, and fire
 * once per hit unless `oncePerTarget` narrows them; Swallow has no entry and
 * is once per target by nature.
 */
async function executeDocumentEffect(config, session, rule, effect, effectIndex, targetUuid, entry = null) {
  const key = effect.oncePerTarget || !entry?.resultId ? targetUuid : entry.resultId;
  if (alreadyFired(session, rule, effectIndex, key)) return false;
  const attacker = await actorFromConfig(config);
  const targetActor = await targetActorFromUuid(targetUuid);
  if (!attacker || !targetActor) return false;
  if (!effectAllowsTargetActor(effect, targetActor)) return false;
  const plan = session.actionPlans[actionPlanKey(rule, effectIndex, entry?.resultId)]
    ?? session.actionPlans[actionPlanKey(rule, effectIndex, targetUuid)];
  let result = false;
  if (effect.type === "shatterGear") {
    // Planned before the roll when the target was known then; otherwise drawn
    // now, so a target that only became known at roll time still loses gear.
    const planned = plan?.itemId ? actorItem(targetActor, plan.itemId) : null;
    const item = planned ? { id: planned.id } : chooseRandomGear(targetActor, "shatter");
    if (!item) {
      console.warn(`${MODULE_ID} | Shatter: ${targetActor.name} carries nothing breakable, or the current user may not update it.`);
      return false;
    }
    result = await shatterGear(attacker, targetActor, item.id);
    if (!result) console.warn(`${MODULE_ID} | Shatter: could not destroy item ${item.id} on ${targetActor.name}.`);
  }
  else if (effect.type === "stealGear" && effect.selection === "prompt") {
    if (!game.user?.isGM) return false;
    result = await executePromptedTheft(config, rule, attacker, targetActor);
  }
  else if (effect.type === "stealGear") {
    const item = plan?.itemId ? { id: plan.itemId } : chooseRandomGear(targetActor, effect.mode);
    if (item) result = await stealGear(attacker, targetActor, item.id);
  }
  else if (effect.type === "swallow") {
    result = await swallowTarget(config, rule, effect, targetUuid);
  }
  if (result) markFired(session, rule, effectIndex, key);
  return Boolean(result);
}

export async function evaluateCustomRules(config, batchId) {
  const session = config?.[RULE_META_KEY];
  if (!hasActiveCustomRules(config)) return [];
  const attackerState = { injured: isAttackerInjured(await actorFromConfig(config)) };
  const fired = [];
  for (const rule of session.rules) {
    if (!rule.enabled || !isRuleActive(session, rule) || rule.trigger === TRIGGER_BEFORE) continue;
    const entries = rule.scope === "currentBatch"
      ? session.ledger.filter(entry => entry.batchId === batchId)
      : session.ledger;
    const targetUuids = qualifyingTargetUuids(rule, entries, attackerState);
    const qualifiedTargets = new Set(targetUuids);
    const criticalTargets = new Set(entries
      .filter(entry => entry.criticalSuccess && entry.targetUuid)
      .map(entry => entry.targetUuid));
    // Per-hit effects: each qualifying hit is its own occasion.
    const qualifyingHits = entries.filter(value => value.success && value.targetUuid
      && qualifiedTargets.has(value.targetUuid)
      && rule.conditions.every(condition => condition.type !== "naturalAttackRollAtLeast"
        || Number(value.naturalAttackRoll) >= condition.minimum));
    for (const [effectIndex, effect] of rule.effects.entries()) {
      if (!PER_HIT_EFFECTS.has(effect.type)) continue;
      for (const entry of qualifyingHits) {
        const executed = effect.type === "severLimb"
          ? await executeSeverLimb(config, session, rule, effect, effectIndex, entry)
          : effect.type === "abilityDamage"
            ? await executeAbilityDamage(config, session, rule, effect, effectIndex, entry)
            : ["shatterGear", "stealGear"].includes(effect.type)
              ? await executeDocumentEffect(config, session, rule, effect, effectIndex, entry.targetUuid, entry)
              : await executeSave(config, session, rule, effect, effectIndex, entry);
        if (executed) fired.push({ ruleId: rule.id, effectIndex, targetUuid: entry.targetUuid });
      }
    }
    for (const targetUuid of targetUuids) {
      for (const [effectIndex, effect] of rule.effects.entries()) {
        if (PER_HIT_EFFECTS.has(effect.type)) continue;
        if (["forceAdvantage", "selfDamage", "damageBonus", "replaceDamageDie"].includes(effect.type)) continue;
        if (effect.type === "swallow") {
          if (await executeDocumentEffect(config, session, rule, effect, effectIndex, targetUuid)) {
            fired.push({ ruleId: rule.id, effectIndex, targetUuid });
          }
          continue;
        }
        const formula = formulaForEffect(config, effect);
        if (!formula) {
          console.warn(`${MODULE_ID} | Could not derive custom-rule damage from`, config.damageRoll?.formula);
          ui.notifications.warn(L("GTNPCMULTIATTACK.Rules.UnsupportedDamageFormula"));
          continue;
        }
        if (await executeExtraDamage(
          config, session, rule, effect, effectIndex, targetUuid, formula,
          { criticalHit: criticalTargets.has(targetUuid) }
        )) {
          fired.push({ ruleId: rule.id, effectIndex, targetUuid });
        }
      }
    }
  }
  return fired;
}

export function injectManualRuleControls(root, config, onChange) {
  if (!root || root.querySelector(".gt-npc-ma-manual-rules")) return null;
  const rules = manualRuleDefinitions(config);
  if (!rules.length) return null;
  const section = document.createElement("section");
  section.className = "gt-npc-ma-manual-rules";
  const heading = document.createElement("strong");
  heading.textContent = L("GTNPCMULTIATTACK.Rules.ConditionalFeatures");
  section.append(heading);
  for (const rule of rules) {
    const label = document.createElement("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = config[RULE_META_KEY].activeManual?.[rule.id] === true;
    checkbox.dataset.ruleId = rule.id;
    const text = document.createElement("span");
    text.textContent = rule.name;
    label.append(checkbox, text);
    section.append(label);
    checkbox.addEventListener("change", () => {
      setManualRuleActive(config, rule.id, checkbox.checked);
      onChange?.(rule, checkbox.checked, checkbox);
    });
  }
  return section;
}

/**
 * Shadowdark's own "Attack Features" field (`system.damage.special`) is a
 * comma list of names that the attack card prints and, where an NPC Feature of
 * that name exists on the creature, quotes. Applied features keep their names
 * in that list: names of rules that were listed and are now gone are dropped,
 * new ones appended; anything the GM typed by hand is left alone.
 */
export function mergeFeatureNames(current, previous, next) {
  const entries = String(current ?? "").split(",").map(entry => entry.trim()).filter(Boolean);
  const lower = value => value.toLocaleLowerCase();
  const nextLower = new Set(next.map(lower));
  const dropped = new Set(previous.map(lower).filter(name => !nextLower.has(name)));
  const kept = entries.filter(entry => !dropped.has(lower(entry)));
  const present = new Set(kept.map(lower));
  for (const name of next) {
    if (!present.has(lower(name))) { kept.push(name); present.add(lower(name)); }
  }
  return kept.join(", ");
}

function ruleNames(rules) {
  return Array.from(new Set((rules ?? []).map(rule => String(rule.name ?? "").trim()).filter(Boolean)));
}

function sourceWithRuleChange(session, ruleId, change) {
  if (!session.validation?.valid) return null;
  const document = JSON.parse(session.source);
  const index = document.rules.findIndex(rule => rule.id === ruleId);
  if (index < 0) return null;
  if (change === "remove") document.rules.splice(index, 1);
  else document.rules[index].enabled = change === true;
  return JSON.stringify(document, null, 2);
}

function renderAppliedFeatures(section, session, canEdit, onSourceChange) {
  const list = section.querySelector(".gt-npc-ma-applied-features");
  if (!list) return;
  list.replaceChildren();
  if (!session.validation.valid || !session.rules.length) {
    const empty = document.createElement("p");
    empty.className = "gt-npc-ma-no-features";
    empty.textContent = session.validation.valid
      ? L("GTNPCMULTIATTACK.Rules.NoFeatures")
      : L("GTNPCMULTIATTACK.Rules.InvalidFeatures");
    list.append(empty);
    return;
  }
  for (const rule of session.rules) {
    const row = document.createElement("div");
    row.className = "gt-npc-ma-feature-row";
    const toggleLabel = document.createElement("label");
    const toggle = document.createElement("input");
    toggle.type = "checkbox";
    toggle.checked = rule.enabled;
    toggle.disabled = !canEdit;
    const name = document.createElement("span");
    name.textContent = rule.name;
    toggleLabel.append(toggle, name);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "gt-npc-ma-remove-feature";
    remove.disabled = !canEdit;
    remove.dataset.tooltip = L("GTNPCMULTIATTACK.Rules.RemoveFeature");
    remove.setAttribute("aria-label", remove.dataset.tooltip);
    remove.innerHTML = '<i class="fa-solid fa-xmark" aria-hidden="true"></i>';
    toggle.addEventListener("change", () => {
      const source = sourceWithRuleChange(session, rule.id, toggle.checked);
      if (source) void onSourceChange(source, true);
    });
    remove.addEventListener("click", () => {
      const source = sourceWithRuleChange(session, rule.id, "remove");
      if (source) void onSourceChange(source, true);
    });
    row.append(toggleLabel, remove);
    list.append(row);
    const parameters = renderRuleParameters(session, rule, canEdit, onSourceChange);
    if (parameters) list.append(parameters);
  }
}

/**
 * Inline fields for the parts of an applied feature that vary from monster to
 * monster — DC, damage, condition, duration — so one preset can serve every
 * creature that shares a mechanic. Each change is validated against the schema
 * before it is written back; an invalid value is refused and the field reverts.
 */
function renderRuleParameters(session, rule, canEdit, onSourceChange) {
  const descriptors = ruleParameters(rule);
  if (!descriptors.length) return null;
  const panel = document.createElement("div");
  panel.className = "gt-npc-ma-feature-parameters";
  for (const parameter of descriptors) {
    const field = document.createElement("label");
    field.className = `gt-npc-ma-parameter is-${parameter.kind}`;
    const caption = document.createElement("span");
    caption.textContent = parameter.label;
    let input;
    if (["ability", "condition", "unit", "die"].includes(parameter.kind)) {
      input = document.createElement("select");
      for (const option of parameterOptions(parameter.kind)) {
        const element = document.createElement("option");
        element.value = String(option.value);
        element.textContent = option.label;
        element.selected = String(option.value) === String(parameter.value);
        input.append(element);
      }
    }
    else if (parameter.kind === "boolean") {
      input = document.createElement("input");
      input.type = "checkbox";
      input.checked = parameter.value === true;
    }
    else {
      input = document.createElement("input");
      input.type = ["dc", "integer"].includes(parameter.kind) ? "number" : "text";
      if (parameter.kind === "dc") { input.min = "1"; input.max = "40"; }
      if (parameter.min !== undefined) input.min = String(parameter.min);
      if (parameter.max !== undefined) input.max = String(parameter.max);
      input.value = String(parameter.value ?? "");
      if (parameter.kind === "formula") input.spellcheck = false;
      if (parameter.optional) input.placeholder = L("GTNPCMULTIATTACK.Parameters.OptionalPlaceholder");
    }
    input.disabled = !canEdit;
    input.dataset.parameterId = parameter.id;
    input.addEventListener("change", () => {
      const raw = parameter.kind === "boolean" ? input.checked : input.value;
      const result = sourceWithParameter(session.source, rule.id, parameter, raw);
      if (!result.source) {
        ui.notifications.warn(formatValidationError(result.validation));
        if (parameter.kind === "boolean") input.checked = parameter.value === true;
        else input.value = String(parameter.value ?? "");
        return;
      }
      void onSourceChange(result.source, true);
    });
    field.append(caption, input);
    panel.append(field);
  }
  return panel;
}

function renderEditorState(section, session) {
  const content = section.querySelector(".gt-npc-ma-rule-content");
  const script = section.querySelector(".gt-npc-ma-rule-script");
  const scriptToggle = section.querySelector(".gt-npc-ma-script-toggle input");
  const status = section.querySelector(".gt-npc-ma-rule-status");
  if (content) content.hidden = !session.enabled;
  if (!session.validation.valid && session.enabled && scriptToggle) scriptToggle.checked = true;
  if (script) script.hidden = !session.enabled || !scriptToggle?.checked;
  if (!session.enabled) {
    status.textContent = L("GTNPCMULTIATTACK.Rules.Disabled");
    status.dataset.state = "disabled";
  }
  else if (session.validation.valid) {
    status.textContent = L("GTNPCMULTIATTACK.Rules.Valid");
    status.dataset.state = "valid";
  }
  else {
    status.textContent = formatValidationError(session.validation);
    status.dataset.state = "invalid";
  }
}

export function injectCustomRuleItemEditor(root, item) {
  if (!root || root.querySelector(".gt-npc-ma-custom-rules")) return null;
  const insertionPoint = root.querySelector('.tab-details[data-tab="tab-details"] .grid-3-columns');
  if (!insertionPoint) return null;

  const session = {
    enabled: documentFlag(item, ENABLED_FLAG) === true,
    source: sourceFromItem(item),
    validation: null,
    rules: []
  };
  updateSessionValidation(session, session.source);
  const canEdit = item?.isOwner ?? item?.parent?.isOwner ?? false;
  // Drawn as one of Shadowdark's own SD-box panels — the same frame and
  // "Old Newspaper" header the sheet uses for its other boxes.
  const section = document.createElement("section");
  section.className = "SD-box gt-npc-ma-custom-rules";
  const header = document.createElement("div");
  header.className = "header light gt-npc-ma-rule-header";
  const label = document.createElement("label");
  label.textContent = L("GTNPCMULTIATTACK.Rules.Custom");
  const enabled = document.createElement("input");
  enabled.type = "checkbox";
  enabled.id = `gt-npc-ma-rules-enabled-${createSessionId()}`;
  enabled.checked = session.enabled;
  enabled.disabled = !canEdit;
  enabled.setAttribute("aria-label", label.textContent);
  label.htmlFor = enabled.id;
  const headerActions = document.createElement("span");
  headerActions.className = "gt-npc-ma-rule-header-actions";
  headerActions.append(enabled);
  header.append(label, headerActions);

  const body = document.createElement("div");
  body.className = "content";
  const content = document.createElement("div");
  content.className = "gt-npc-ma-rule-content";
  const hint = document.createElement("p");
  hint.className = "gt-npc-ma-rule-hint";
  hint.textContent = L("GTNPCMULTIATTACK.Rules.CustomHint");
  content.append(hint);

  const presetControls = document.createElement("div");
  presetControls.className = "gt-npc-ma-rule-presets";
  const presetLabel = document.createElement("label");
  presetLabel.textContent = L("GTNPCMULTIATTACK.Presets.Preset");
  const presetSelect = document.createElement("select");
  presetSelect.setAttribute("aria-label", presetLabel.textContent);
  const catalog = getPresetCatalog();
  for (const [builtIn, groupKey] of [
    [true, "GTNPCMULTIATTACK.Presets.BuiltIn"],
    [false, "GTNPCMULTIATTACK.Presets.CustomPresets"]
  ]) {
    const entries = catalog.filter(preset => preset.builtIn === builtIn);
    if (!entries.length) continue;
    const group = document.createElement("optgroup");
    group.label = L(groupKey);
    for (const preset of entries) {
      const option = document.createElement("option");
      option.value = preset.key;
      option.textContent = preset.name;
      option.title = preset.description;
      group.append(option);
    }
    presetSelect.append(group);
  }
  presetLabel.append(presetSelect);
  const addPreset = document.createElement("button");
  addPreset.type = "button";
  addPreset.textContent = L("GTNPCMULTIATTACK.Presets.Add");
  const replacePreset = document.createElement("button");
  replacePreset.type = "button";
  replacePreset.textContent = L("GTNPCMULTIATTACK.Presets.Replace");
  replacePreset.dataset.tooltip = L("GTNPCMULTIATTACK.Presets.ReplaceHint");
  replacePreset.setAttribute("aria-label", replacePreset.dataset.tooltip);
  const libraryButton = document.createElement("button");
  libraryButton.type = "button";
  libraryButton.className = "gt-npc-ma-open-preset-library";
  libraryButton.dataset.tooltip = L("GTNPCMULTIATTACK.Presets.OpenLibrary");
  libraryButton.setAttribute("aria-label", libraryButton.dataset.tooltip);
  libraryButton.innerHTML = '<i class="fa-solid fa-book" aria-hidden="true"></i>';
  libraryButton.hidden = !game.user.isGM;
  addPreset.disabled = !canEdit || !catalog.length;
  replacePreset.disabled = !canEdit || !catalog.length;
  presetSelect.disabled = !canEdit || !catalog.length;
  presetControls.append(presetLabel, addPreset, replacePreset, libraryButton);

  const appliedHeading = document.createElement("strong");
  appliedHeading.className = "gt-npc-ma-applied-heading";
  appliedHeading.textContent = L("GTNPCMULTIATTACK.Rules.AppliedFeatures");
  const appliedFeatures = document.createElement("div");
  appliedFeatures.className = "gt-npc-ma-applied-features";

  const scriptToggle = document.createElement("label");
  scriptToggle.className = "gt-npc-ma-script-toggle";
  const scriptCheckbox = document.createElement("input");
  scriptCheckbox.type = "checkbox";
  const scriptLabel = document.createElement("span");
  scriptLabel.textContent = L("GTNPCMULTIATTACK.Rules.Script");
  scriptToggle.append(scriptCheckbox, scriptLabel);

  const script = document.createElement("div");
  script.className = "gt-npc-ma-rule-script";

  const textarea = document.createElement("textarea");
  textarea.className = "gt-npc-ma-rule-source";
  textarea.value = session.source;
  textarea.rows = 9;
  textarea.disabled = !canEdit;
  textarea.setAttribute("aria-label", L("GTNPCMULTIATTACK.Rules.EditorLabel"));
  textarea.spellcheck = false;
  const status = document.createElement("p");
  status.className = "gt-npc-ma-rule-status";
  status.setAttribute("aria-live", "polite");
  const scriptActions = document.createElement("div");
  scriptActions.className = "gt-npc-ma-script-actions";
  const resetRules = document.createElement("button");
  resetRules.type = "button";
  resetRules.textContent = L("GTNPCMULTIATTACK.Rules.Reset");
  resetRules.disabled = !canEdit;
  scriptActions.append(resetRules);
  script.append(textarea, status, scriptActions);
  content.append(presetControls, appliedHeading, appliedFeatures, scriptToggle, script);
  body.append(content);
  section.append(header, body);
  insertionPoint.insertAdjacentElement("afterend", section);

  // Keep the system's Attack Features list in step with the applied rules.
  const featureInput = root.querySelector('input[name="system.damage.special"]');
  let listedNames = session.validation.valid ? ruleNames(session.rules) : [];
  const syncFeatureNames = async () => {
    if (!canEdit || !session.validation?.valid) return;
    const next = ruleNames(session.rules);
    const current = featureInput?.value ?? String(item.system?.damage?.special ?? "");
    const merged = mergeFeatureNames(current, listedNames, next);
    listedNames = next;
    if (merged === current) return;
    if (featureInput) featureInput.value = merged;
    if (typeof item?.update === "function") await item.update({ "system.damage.special": merged }, { render: false });
  };
  const persistRules = async (extra = {}) => {
    await updateItemFlags(item, { [RULES_FLAG]: session.source, ...extra });
    await syncFeatureNames();
  };
  // Features applied before the list was shared are written in on first open.
  listedNames = [];
  void syncFeatureNames().catch(error => {
    console.warn(`${MODULE_ID} | Could not list applied features on the attack.`, error);
  });

  let saveTimer = null;
  const persistSource = () => {
    if (!canEdit) return;
    if (saveTimer) globalThis.clearTimeout(saveTimer);
    saveTimer = null;
    void persistRules().catch(error => {
      console.error(`${MODULE_ID} | Could not save custom attack rules.`, error);
    });
  };
  const applySource = async (source, persistImmediately = false) => {
    textarea.value = source;
    updateSessionValidation(session, source);
    renderAppliedFeatures(section, session, canEdit, applySource);
    renderEditorState(section, session);
    if (persistImmediately) await persistRules();
  };
  enabled.addEventListener("change", () => {
    session.enabled = enabled.checked;
    renderEditorState(section, session);
    if (canEdit) void updateItemFlags(item, { [ENABLED_FLAG]: session.enabled }).catch(error => {
      console.error(`${MODULE_ID} | Could not save the custom-rules toggle.`, error);
    });
  });
  textarea.addEventListener("input", () => {
    updateSessionValidation(session, textarea.value);
    renderAppliedFeatures(section, session, canEdit, applySource);
    renderEditorState(section, session);
    if (saveTimer) globalThis.clearTimeout(saveTimer);
    saveTimer = globalThis.setTimeout(persistSource, 500);
  });
  textarea.addEventListener("change", persistSource);
  const applySelectedPreset = async mode => {
    if (!canEdit) return;
    const preset = catalog.find(value => value.key === presetSelect.value);
    if (!preset) return;
    const applied = applyPresetToRuleSource(session.source, preset, mode);
    if (!applied.valid) {
      ui.notifications.error(formatValidationError(applied.validation));
      return;
    }
    await applySource(applied.source, false);
    session.enabled = true;
    enabled.checked = true;
    renderEditorState(section, session);
    await persistRules({ [ENABLED_FLAG]: true });
    ui.notifications.info(L("GTNPCMULTIATTACK.Presets.Applied"));
  };
  addPreset.addEventListener("click", () => void applySelectedPreset("add"));
  replacePreset.addEventListener("click", () => void (async () => {
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: L("GTNPCMULTIATTACK.Presets.Replace") },
      content: `<p>${L("GTNPCMULTIATTACK.Presets.ConfirmReplace")}</p>`,
      yes: { label: L("GTNPCMULTIATTACK.Rules.Yes"), default: false },
      no: { label: L("GTNPCMULTIATTACK.Rules.Cancel"), default: true },
      rejectClose: false,
      modal: true
    });
    if (confirmed) await applySelectedPreset("replace");
  })());
  scriptCheckbox.addEventListener("change", () => renderEditorState(section, session));
  resetRules.addEventListener("click", () => void (async () => {
    if (!canEdit) return;
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: L("GTNPCMULTIATTACK.Rules.Reset") },
      content: `<p>${L("GTNPCMULTIATTACK.Rules.ConfirmReset")}</p>`,
      yes: { label: L("GTNPCMULTIATTACK.Rules.Yes"), default: true },
      no: { label: L("GTNPCMULTIATTACK.Rules.Cancel"), default: false },
      rejectClose: false,
      modal: true
    });
    if (!confirmed) return;
    await applySource(DEFAULT_CUSTOM_RULE_SOURCE, true);
  })());
  libraryButton.addEventListener("click", () => openPresetLibrary());
  renderAppliedFeatures(section, session, canEdit, applySource);
  renderEditorState(section, session);
  return section;
}

export const customRulesTestApi = Object.freeze({
  mergeFeatureNames,
  appendDamageBonus,
  formulaForEffect,
  naturalAttackRoll,
  qualifyingTargetUuids,
  replaceDamageDie,
  ruleSessionRegistry,
  validateCustomRules
});
