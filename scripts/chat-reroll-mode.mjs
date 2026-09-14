import { recordCustomRuleReroll } from "./custom-attack-rules.mjs";
import { escapeHtml, F, htmlRoot, L, MODULE_ID } from "./lib/dom.mjs";

const SETTING_KEY = "enableChatRerollModes";
const SINGLE_COMPARISON_SETTING = "enableSingleRollComparisonRerolls";
// The chosen kh./kl. mode is a per-viewer UI preference, not shared state. It
// used to be written to the ChatMessage, which meant a database write plus a
// re-render on every client for every click, and baked the choice into the log.
const FLAG_KEY = "rerollMode";
const selectedRerollModes = new Map();
const COMPARISON_FLAG_KEY = "comparisonBaseMode";
const REROLL_MARK_KEY = "gtNpcMultiattackRerolled";
/** On a reroll's config: the id of the message it rerolled, and whether a luck token paid for it. */
const REROLL_ORIGIN_KEY = "gtNpcMultiattackRerollOf";
const REROLL_LUCK_KEY = "gtNpcMultiattackRerollLuck";
const SUPPORTED_REROLL_TYPES = new Set(["attack", "spell", "check"]);

export function stripAppliedAdvantage(formula) {
  return String(formula ?? "").replace(/^2d(\d+)(?:kh|kl)/i, "d$1");
}

export function formulaAdvantageMode(formula) {
  const match = String(formula ?? "").match(/^2d\d+(kh|kl)/i);
  if (!match) return 0;
  return match[1].toLowerCase() === "kh" ? 1 : -1;
}

export function originalAdvantageMode(message) {
  const comparisonMode = message?.getFlag?.(MODULE_ID, COMPARISON_FLAG_KEY);
  if (comparisonMode !== undefined && comparisonMode !== null) return Number(comparisonMode) || 0;
  const configured = Number(message?.rollConfig?.mainRoll?.advantage);
  if ([1, -1].includes(configured)) return configured;
  return formulaAdvantageMode(message?.rollConfig?.mainRoll?.formula);
}

export function isSupportedRerollConfig(config) {
  if (!SUPPORTED_REROLL_TYPES.has(config?.type)) return false;
  const formula = stripAppliedAdvantage(config?.mainRoll?.formula).replace(/\s+/g, "");
  return /^(?:1)?d20(?:$|[+\-])/i.test(formula);
}

function selectedRerollMode(message) {
  const local = selectedRerollModes.get(message?.id);
  if (local !== undefined) return local;
  // Messages written by earlier releases still carry the flag; honour it once.
  const stored = message?.getFlag?.(MODULE_ID, FLAG_KEY);
  if (stored !== undefined && stored !== null) return Number(stored) || 0;
  return originalAdvantageMode(message);
}

export function setSelectedRerollMode(message, mode) {
  const value = Math.sign(Number(mode) || 0);
  if (!message?.id) return value;
  selectedRerollModes.set(message.id, value);
  return value;
}

export function isRerolledMessage(message) {
  return (message?.rollConfig ?? message)?.[REROLL_MARK_KEY] === true;
}

function markReroll(prepared, { originId = null, luckSpent = false } = {}) {
  prepared[REROLL_MARK_KEY] = true;
  if (originId) prepared[REROLL_ORIGIN_KEY] = originId;
  prepared[REROLL_LUCK_KEY] = luckSpent === true;
  return prepared;
}

export function prepareRerollConfig(config, mode, origin = {}) {
  const prepared = foundry.utils.deepClone(config);
  if (!prepared?.mainRoll) return prepared;
  prepared.mainRoll.formula = stripAppliedAdvantage(prepared.mainRoll.formula);
  prepared.mainRoll.advantage = Math.sign(Number(mode) || 0);
  prepared.mainRoll.reroll = true;
  return markReroll(prepared, origin);
}

export function prepareComparisonConfig(config, mode, origin = {}) {
  const prepared = foundry.utils.deepClone(config);
  if (!prepared?.mainRoll) return prepared;
  const modifier = Number(mode) > 0 ? "kh" : "kl";
  const neutral = stripAppliedAdvantage(prepared.mainRoll.formula);
  prepared.mainRoll.formula = neutral.replace(/^(?:1)?d(\d+)/i, `2d$1${modifier}`);
  prepared.mainRoll.advantage = 0;
  prepared.mainRoll.reroll = true;
  return markReroll(prepared, origin);
}

/** The message a reroll card rerolled, if it still exists. */
export function rerollOrigin(message) {
  const id = message?.rollConfig?.[REROLL_ORIGIN_KEY];
  return id ? game.messages?.get?.(id) ?? null : null;
}

function originalD20Result(message) {
  const die = message?.getRoll?.("main")?.dice?.[0];
  const active = die?.results?.find(result => result.active)?.result ?? die?.total;
  const value = Math.floor(Number(active));
  return Number.isFinite(value) && value >= 1 && value <= 20 ? value : null;
}

async function actorForConfig(config) {
  return typeof fromUuid === "function" ? fromUuid(config?.actorUuid) : null;
}

/**
 * Spend a luck token for a player's reroll. Returns "spent", "free" or false.
 * A GM never pays, and neither does a keep-lowest reroll: taking the worse of
 * two dice is a correction, not a favour from fortune.
 */
async function consumeRerollLuck(actor, mode) {
  if (game.user.isGM || Number(mode) < 0) return "free";
  if (actor?.system?.hasLuckToken) {
    await actor.system.useLuckToken(true);
    return "spent";
  }
  ui.notifications.warn(L("GTNPCMULTIATTACK.Reroll.NoLuckToken"));
  return false;
}

/** Give back what consumeRerollLuck took, in whichever luck mode the world runs. */
async function refundRerollLuck(actor) {
  if (typeof actor?.update !== "function") return false;
  let pulp = false;
  try { pulp = game.settings.get("shadowdark", "usePulpMode") === true; }
  catch (_error) { pulp = false; }
  if (pulp) {
    const remaining = Math.max(0, Math.floor(Number(actor.system?.luck?.remaining) || 0));
    await actor.update({ "system.luck.remaining": remaining + 1 });
  }
  else await actor.update({ "system.luck.available": true });
  return true;
}

async function rollComparisonFromMessage(message, mode, actor, origin) {
  const original = originalD20Result(message);
  if (original === null) throw new Error("The original d20 result could not be resolved.");
  const config = prepareComparisonConfig(message.rollConfig, mode, origin);
  const mainRoll = new shadowdark.dice.RollSD(
    config.mainRoll.formula,
    actor.getRollData(),
    config.mainRoll
  );
  const baseDie = mainRoll.dice[0];
  if (!baseDie || baseDie.faces !== 20 || baseDie.number !== 2) {
    throw new Error("The comparison reroll requires a standard d20 formula.");
  }
  baseDie.results.push({ result: original, active: true });
  await mainRoll.evaluate();

  const rolls = [mainRoll];
  if (config?.damageRoll?.formula) {
    let needsDamage = mainRoll.success;
    if (config.attack && !config.targetUuid) needsDamage = true;
    config.damageRoll.needed = needsDamage;
  }
  if (game.settings.get("shadowdark", "rollDamage") && config?.damageRoll?.needed) {
    rolls.push(await shadowdark.dice.rollDamage(config, mainRoll.criticalSuccess));
  }

  const chatData = await shadowdark.chat.renderRollMessage(config, rolls);
  chatData.flags ??= {};
  chatData.flags[MODULE_ID] = {
    [COMPARISON_FLAG_KEY]: 0,
    [FLAG_KEY]: Number(mode)
  };
  await ChatMessage.create(chatData);
  return mainRoll;
}

async function synchronizeSpellReroll(config, result) {
  if (config?.type !== "spell" || !config?.cast?.spellUuid) return;
  const spell = await fromUuid(config.cast.spellUuid);
  if (config.cast.spellUuid !== config.itemUuid) {
    const triggeringItem = await fromUuid(config.itemUuid);
    if (triggeringItem?.system?.isWand) {
      await triggeringItem.system.setSpellLost(
        spell?.uuid,
        !result?.success,
        result?.criticalFailure
      );
    }
  }
  else if (spell) {
    await spell.update({ "system.lost": !result?.success });
  }
}

export async function rerollRollWithMode(message, requestedMode) {
  if (!isSupportedRerollConfig(message?.rollConfig)) return false;
  if (isRerolledMessage(message)) {
    ui.notifications.warn(L("GTNPCMULTIATTACK.Reroll.AlreadyRerolled"));
    return false;
  }
  const originalMode = originalAdvantageMode(message);
  let mode = Math.sign(Number(requestedMode) || 0);
  if (!originalMode && !mode) {
    ui.notifications.error(L("GTNPCMULTIATTACK.Reroll.SelectMode"));
    return false;
  }
  if (originalMode && !mode) mode = originalMode;

  const actor = await actorForConfig(message.rollConfig);
  if (!actor) return false;
  const luck = await consumeRerollLuck(actor, mode);
  if (!luck) return false;
  const origin = { originId: message.id, luckSpent: luck === "spent" };
  const result = !originalMode
    ? await rollComparisonFromMessage(message, mode, actor, origin)
    : await shadowdark.dice.rollFromConfig(prepareRerollConfig(message.rollConfig, mode, origin));
  await synchronizeSpellReroll(message.rollConfig, result);
  if (message.rollConfig.type === "attack") {
    try {
      await recordCustomRuleReroll(message.rollConfig, result);
    }
    catch (error) {
      console.error(`${MODULE_ID} | Custom attack-rule evaluation after reroll failed.`, error);
    }
  }
  return result;
}

/**
 * Withdraw a reroll made by mistake: the reroll card is removed, the luck
 * token it cost comes back, and the original roll's consequences — lost
 * spell, broken wand, attack features — are re-applied from the original
 * result. Damage a third-party module already applied from the reroll is not
 * touched; the note it posts says so.
 */
export async function undoReroll(message) {
  const config = message?.rollConfig;
  if (!isRerolledMessage(message)) return false;
  const original = rerollOrigin(message);
  if (!original) {
    ui.notifications.warn(L("GTNPCMULTIATTACK.Reroll.UndoNoOriginal"));
    return false;
  }
  const actor = await actorForConfig(config);
  if (!actor) return false;
  if (config[REROLL_LUCK_KEY] === true) await refundRerollLuck(actor);
  const originalResult = original.getRoll?.("main")
    ?? Array.from(original.rolls ?? []).find(roll => roll?.options?.type === "main")
    ?? null;
  await synchronizeSpellReroll(original.rollConfig, originalResult);
  if (original.rollConfig?.type === "attack" && originalResult) {
    try { await recordCustomRuleReroll(original.rollConfig, originalResult); }
    catch (error) {
      console.error(`${MODULE_ID} | Custom attack-rule evaluation after undoing a reroll failed.`, error);
    }
  }
  await message.delete();
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    author: game.user.id,
    content: `<p>${escapeHtml(F("GTNPCMULTIATTACK.Reroll.Undone", { actor: actor.name }))}</p>`,
    flags: { [MODULE_ID]: { rerollUndone: original.id } }
  });
  return true;
}

function createUndoButton(message) {
  const undo = document.createElement("a");
  undo.className = "gt-npc-ma-reroll-undo";
  undo.dataset.tooltip = L("GTNPCMULTIATTACK.Reroll.Undo");
  undo.setAttribute("aria-label", undo.dataset.tooltip);
  undo.innerHTML = '<i class="fa-solid fa-rotate-left" aria-hidden="true"></i>';
  undo.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    undo.classList.add("is-pending");
    void undoReroll(message).catch(error => {
      ui.notifications.error(L("GTNPCMULTIATTACK.Reroll.UndoFailed"));
      console.error(`${MODULE_ID} | Undoing a reroll failed.`, error);
    }).finally(() => undo.classList.remove("is-pending"));
  });
  return undo;
}

function makeModeButton(message, mode, currentMode) {
  const advantage = mode === 1;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "gt-npc-ma-reroll-mode";
  button.dataset.mode = String(mode);
  button.textContent = L(advantage
    ? "GTNPCMULTIATTACK.Targets.AdvantageAbbreviation"
    : "GTNPCMULTIATTACK.Targets.DisadvantageAbbreviation");
  button.dataset.tooltip = L(advantage
    ? "GTNPCMULTIATTACK.Reroll.Advantage"
    : "GTNPCMULTIATTACK.Reroll.Disadvantage");
  button.setAttribute("aria-label", button.dataset.tooltip);
  button.setAttribute("aria-pressed", String(currentMode === mode));
  button.classList.toggle("active", currentMode === mode);
  button.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    const next = setSelectedRerollMode(message, selectedRerollMode(message) === mode ? 0 : mode);
    for (const control of button.parentElement?.querySelectorAll(".gt-npc-ma-reroll-mode") ?? []) {
      const active = Number(control.dataset.mode) === next && next !== 0;
      control.classList.toggle("active", active);
      control.setAttribute("aria-pressed", String(active));
    }
  });
  return button;
}

function createSuccessRerollButton() {
  const reroll = document.createElement("a");
  reroll.dataset.action = "reroll";
  reroll.dataset.rollType = "main";
  reroll.dataset.tooltip = L("GTNPCMULTIATTACK.Reroll.Attack");
  reroll.setAttribute("aria-label", reroll.dataset.tooltip);
  reroll.innerHTML = '<i class="fa-solid fa-arrows-rotate reroll-icon" aria-hidden="true"></i>';
  return reroll;
}

export function injectChatRerollModes(message, html) {
  if (!game.settings.get(MODULE_ID, SETTING_KEY)) return;
  const root = htmlRoot(html);
  if (!root || root.querySelector(".gt-npc-ma-reroll-modes")) return;
  if (!isSupportedRerollConfig(message?.rollConfig)) return;
  if (!(game.user.isGM || game.user.id === message.author?.id)) return;
  // A reroll card cannot be rerolled again, but it can be taken back.
  if (isRerolledMessage(message)) {
    if (!rerollOrigin(message) || root.querySelector(".gt-npc-ma-reroll-undo")) return;
    const heading = root.querySelector(".shadowdark.chat-card .sub-heading")
      ?? root.querySelector(".sub-heading");
    heading?.append(createUndoButton(message));
    return;
  }

  const originalMode = originalAdvantageMode(message);
  const comparisonEnabled = game.settings.get(MODULE_ID, SINGLE_COMPARISON_SETTING);
  if (!originalMode && !comparisonEnabled) return;

  const heading = root.querySelector(".shadowdark.chat-card .sub-heading")
    ?? root.querySelector(".sub-heading");
  if (!heading) return;
  let reroll = heading.querySelector('[data-action="reroll"][data-roll-type="main"]');
  if (!reroll) {
    reroll = createSuccessRerollButton();
    heading.append(reroll);
  }

  const currentMode = selectedRerollMode(message);
  const controls = document.createElement("span");
  controls.className = "gt-npc-ma-reroll-modes";
  controls.append(
    makeModeButton(message, 1, currentMode),
    makeModeButton(message, -1, currentMode)
  );
  reroll.before(controls);
  reroll.addEventListener("click", event => {
    event.preventDefault();
    event.stopImmediatePropagation();
    const mode = selectedRerollMode(message);
    void rerollRollWithMode(message, mode).catch(error => {
      ui.notifications.error(L("GTNPCMULTIATTACK.Reroll.Failed"));
      console.error(`${MODULE_ID} | Roll reroll failed.`, error);
    });
  }, { capture: true });
}

export const chatRerollTestApi = Object.freeze({
  undoReroll,
  rerollOrigin,
  formulaAdvantageMode,
  isRerolledMessage,
  selectedRerollMode,
  setSelectedRerollMode,
  originalAdvantageMode,
  isSupportedRerollConfig,
  prepareComparisonConfig,
  prepareRerollConfig,
  stripAppliedAdvantage
});
