import { F, MODULE_ID, htmlRoot } from "./lib/dom.mjs";
import { ATTRIBUTE_CHECK_META_KEY } from "./attribute-checks.mjs";
import { SAVE_META_KEY } from "./ability-saves.mjs";
import { SPELL_MISHAP_FLAG_KEY } from "./spell-mishaps.mjs";

export const CHAT_META_KEY = "gtNpcMultiattackChat";
const NUMBER_SETTING = "numberMultiattackMessages";
const ATTACK_TINT_SETTING = "tintMultiattackMessages";
const SPELL_TINT_SETTING = "tintSpellMessages";
const CHAT_FLAG_KEY = "attackBatch";
const SPELL_MISHAP_FILL_COLOR = "#660033";
const ATTACK_COLOR_SETTINGS = Object.freeze({
  failure: "attackMessageMissColor",
  criticalFailure: "attackMessageCriticalFailureColor",
  success: "attackMessageSuccessColor",
  criticalSuccess: "attackMessageCriticalSuccessColor"
});
const SPELL_COLOR_SETTINGS = Object.freeze({
  failure: "spellMessageFailureColor",
  criticalFailure: "spellMessageCriticalFailureColor",
  success: "spellMessageSuccessColor",
  criticalSuccess: "spellMessageCriticalSuccessColor"
});

export function normalizeAttackChatMetadata(value) {
  const index = Math.floor(Number(value?.index));
  const total = Math.floor(Number(value?.total));
  if (!Number.isFinite(index) || !Number.isFinite(total) || index < 1 || total < 1 || index > total) return null;
  return { index, total };
}

function messageMetadata(message) {
  const mainRoll = message?.getRoll?.("main")
    ?? Array.from(message?.rolls ?? []).find(candidate => candidate?.options?.type === "main");
  return normalizeAttackChatMetadata(mainRoll?.options?.[CHAT_META_KEY]
    ?? message?.getFlag?.(MODULE_ID, CHAT_FLAG_KEY)
    ?? message?.rollConfig?.[CHAT_META_KEY]
    ?? message?.getFlag?.("shadowdark", "rollConfig")?.[CHAT_META_KEY]);
}

function messageRollConfig(message) {
  return message?.rollConfig
    ?? message?.getFlag?.("shadowdark", "rollConfig")
    ?? message?._source?.flags?.shadowdark?.rollConfig
    ?? null;
}

export function bridgeAttackChatMetadata(document, data = {}) {
  const rollConfig = data?.flags?.["shadowdark.rollConfig"]
    ?? data?.flags?.shadowdark?.rollConfig
    ?? document?._source?.flags?.shadowdark?.rollConfig;
  const mainRoll = Array.from(data?.rolls ?? []).find(roll => roll?.options?.type === "main");
  const metadata = normalizeAttackChatMetadata(mainRoll?.options?.[CHAT_META_KEY]
    ?? rollConfig?.mainRoll?.[CHAT_META_KEY]
    ?? rollConfig?.[CHAT_META_KEY]);
  if (!metadata || typeof document?.updateSource !== "function") return null;
  document.updateSource({ [`flags.${MODULE_ID}.${CHAT_FLAG_KEY}`]: metadata });
  return metadata;
}

export function attackOutcome(message) {
  const roll = message?.getRoll?.("main")
    ?? Array.from(message?.rolls ?? []).find(candidate => candidate?.options?.type === "main");
  if (!roll) return null;
  if (roll.criticalSuccess === true) return "criticalSuccess";
  if (roll.criticalFailure === true) return "criticalFailure";
  if (roll.success === true) return "success";
  if (roll.success === false) return "failure";
  return null;
}

function renderedAttackOutcome(root) {
  const result = root?.querySelector?.(".message-content .dice-result")
    ?? root?.querySelector?.(".dice-result");
  if (!result) return null;
  if (result.classList.contains("critical-success")) return "criticalSuccess";
  if (result.classList.contains("critical-failure")) return "criticalFailure";
  if (result.classList.contains("success")) return "success";
  if (result.classList.contains("failure")) return "failure";
  return null;
}

function presentationElements(root) {
  const message = root.matches?.(".chat-message")
    ? root
    : root.closest?.(".chat-message") ?? root.querySelector?.(".chat-message");
  const content = message?.querySelector?.(".message-content")
    ?? (root.matches?.(".message-content") ? root : root.querySelector?.(".message-content"))
    ?? root;
  const shadowdarkCard = content.querySelector?.(".shadowdark.chat-card") ?? null;
  return {
    content,
    numberContainer: shadowdarkCard ?? content,
    tintSurface: message ?? shadowdarkCard ?? content
  };
}

export function attackResultGradient(color) {
  const normalized = /^#[0-9a-f]{6}$/i.test(String(color)) ? String(color) : "#808080";
  return `linear-gradient(180deg, ${normalized}66 0, ${normalized}2e 72px, transparent 155px)`;
}

function colorWithAlpha(color, alpha) {
  const normalized = /^#[0-9a-f]{6}$/i.test(String(color)) ? String(color) : "#808080";
  const channel = Math.max(0, Math.min(255, Math.round(Number(alpha) * 255)));
  return `${normalized}${channel.toString(16).padStart(2, "0")}`;
}

function resultTintOverlay(tintSurface) {
  let overlay = tintSurface.querySelector?.(":scope > .gt-npc-ma-result-tint-overlay") ?? null;
  if (overlay) return overlay;
  overlay = document.createElement("div");
  overlay.className = "gt-npc-ma-result-tint-overlay";
  overlay.setAttribute("aria-hidden", "true");
  tintSurface.prepend(overlay);
  return overlay;
}

export function injectAttackChatPresentation(message, html) {
  const root = htmlRoot(html);
  const rollConfig = messageRollConfig(message);
  const rollType = rollConfig?.type;
  if (!root || !["attack", "spell", "check"].includes(rollType)) return null;
  const metadata = rollType === "attack" ? messageMetadata(message) : null;
  const { numberContainer, tintSurface } = presentationElements(root);

  if (metadata && game.settings.get(MODULE_ID, NUMBER_SETTING) && metadata.total > 1
    && !numberContainer.querySelector(".gt-npc-ma-attack-number")) {
    const number = document.createElement("div");
    number.className = "gt-npc-ma-attack-number";
    number.textContent = F("GTNPCMULTIATTACK.Chat.AttackNumber", metadata);
    const firstHeading = numberContainer.querySelector(".sub-heading");
    if (firstHeading) firstHeading.insertAdjacentElement("beforebegin", number);
    else numberContainer.prepend(number);
  }

  const outcome = attackOutcome(message) ?? renderedAttackOutcome(root);
  const check = rollType === "check" ? rollConfig?.[ATTRIBUTE_CHECK_META_KEY] : null;
  if (check?.label && outcome && !numberContainer.querySelector(".gt-npc-ma-attribute-outcome")) {
    const resultKeys = {
      criticalFailure: "CriticalFailure",
      failure: "Failure",
      success: "Success",
      criticalSuccess: "CriticalSuccess"
    };
    const summary = document.createElement("div");
    summary.className = "gt-npc-ma-attribute-outcome";
    const attribute = document.createElement("span");
    attribute.textContent = check.label;
    const result = document.createElement("span");
    result.textContent = game.i18n.localize(
      `GTNPCMULTIATTACK.AttributeCheck.${resultKeys[outcome]}`
    );
    summary.append(attribute, result);
    // A save made against a custom rule says what was at stake, and whether it
    // was resisted, in place of a bare pass/fail.
    const save = rollConfig?.[SAVE_META_KEY];
    if (save?.resisting) {
      const resisted = outcome === "success" || outcome === "criticalSuccess";
      summary.classList.add("is-save", resisted ? "is-resisted" : "is-suffered");
      result.textContent = game.i18n.format(
        resisted ? "GTNPCMULTIATTACK.Saves.Resisted" : "GTNPCMULTIATTACK.Saves.FailedToResist",
        { resisting: save.resisting }
      );
    }
    const firstHeading = numberContainer.querySelector(".sub-heading");
    if (firstHeading) firstHeading.insertAdjacentElement("beforebegin", summary);
    else numberContainer.prepend(summary);
  }

  const tintSetting = rollType === "spell" ? SPELL_TINT_SETTING : ATTACK_TINT_SETTING;
  const colorSettings = rollType === "spell" ? SPELL_COLOR_SETTINGS : ATTACK_COLOR_SETTINGS;
  if (game.settings.get(MODULE_ID, tintSetting) && outcome) {
    const configured = game.settings.get(MODULE_ID, colorSettings[outcome]);
    const color = /^#[0-9a-f]{6}$/i.test(String(configured)) ? configured : "#808080";
    tintSurface.classList.add("gt-npc-ma-attack-result-tint", `is-${outcome}`);
    tintSurface.style.setProperty("--gt-npc-ma-attack-result-color", color);
    const mishap = rollType === "spell" ? message?.getFlag?.(MODULE_ID, SPELL_MISHAP_FLAG_KEY) : null;
    const mishapFill = mishap?.status === "complete"
      ? `, linear-gradient(${colorWithAlpha(SPELL_MISHAP_FILL_COLOR, 0.5)}, ${colorWithAlpha(SPELL_MISHAP_FILL_COLOR, 0.5)})`
      : "";
    const overlay = resultTintOverlay(tintSurface);
    overlay.style.background = `${attackResultGradient(color)}${mishapFill}`;
    overlay.style.backgroundRepeat = mishapFill ? "no-repeat, no-repeat" : "no-repeat";
    // Earlier releases wrote the tint into the message background. Clear that
    // inline value so system and third-party textures remain authoritative.
    tintSurface.style.removeProperty("background");
    tintSurface.style.removeProperty("background-repeat");
  }
  return { metadata, outcome, rollType, numberContainer, tintSurface };
}

export const attackPresentationTestApi = Object.freeze({
  attackOutcome,
  attackResultGradient,
  bridgeAttackChatMetadata,
  colorWithAlpha,
  messageRollConfig,
  messageMetadata,
  normalizeAttackChatMetadata,
  presentationElements,
  resultTintOverlay,
  renderedAttackOutcome
});
