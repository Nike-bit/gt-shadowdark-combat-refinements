// Shared helpers used across the module's feature scripts. Every one of these
// existed as a near-identical private copy in several files before v0.19.2.

export const MODULE_ID = "gt-shadowdark-combat-refinements";

/**
 * The pre-1.0 identity. Retained so that flags written by earlier releases
 * stay readable until scripts/migration.mjs has carried them across.
 */
export const LEGACY_MODULE_ID = "gt-npc-multiattack";

/** Read a module-owned document flag, falling back to the legacy namespace. */
export function documentFlag(document, key) {
  // Read the raw flags object rather than going through Document#getFlag:
  // getFlag throws for any scope that is not an *active* module, and the
  // legacy id is, by design, no longer active once the old module is removed.
  const flags = document?.flags ?? document?._source?.flags ?? null;
  const current = flags?.[MODULE_ID]?.[key];
  if (current !== undefined) return current;
  const legacy = flags?.[LEGACY_MODULE_ID]?.[key];
  if (legacy !== undefined) return legacy;
  // Test doubles and exotic documents may expose flags only through getFlag.
  if (!flags && typeof document?.getFlag === "function") {
    try { return document.getFlag(MODULE_ID, key); }
    catch (_error) { return undefined; }
  }
  return undefined;
}

export function L(key) {
  return game.i18n.localize(key);
}

export function F(key, data = {}) {
  return game.i18n.format(key, data);
}

/**
 * Normalize the second argument of a Foundry render hook to a plain element.
 * Accepts an HTMLElement, a jQuery-like wrapper, or anything else (null).
 */
export function htmlRoot(html) {
  const HTMLElementClass = globalThis.HTMLElement;
  if (HTMLElementClass && html instanceof HTMLElementClass) return html;
  if (HTMLElementClass && html?.[0] instanceof HTMLElementClass) return html[0];
  return null;
}

const HTML_ESCAPES = Object.freeze({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#039;"
});

/**
 * Escape text for interpolation into a chat-card or Notes HTML string. This is
 * deliberately independent of foundry.utils.escapeHTML so that the behaviour is
 * identical under test and at runtime.
 */
export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => HTML_ESCAPES[character]);
}

export function resolveUuidSync(uuid, { warn = true } = {}) {
  if (!uuid || typeof fromUuidSync !== "function") return null;
  try { return fromUuidSync(uuid); }
  catch (error) {
    if (warn) console.warn(`${MODULE_ID} | Could not resolve UUID ${uuid}.`, error);
    return null;
  }
}

export async function resolveUuid(uuid, { warn = true } = {}) {
  if (!uuid || typeof fromUuid !== "function") return null;
  try { return await fromUuid(uuid); }
  catch (error) {
    if (warn) console.warn(`${MODULE_ID} | Could not resolve UUID ${uuid}.`, error);
    return null;
  }
}

/** Enrich item/spell description HTML through whichever TextEditor this core version exposes. */
export async function enrichHTML(text) {
  const value = String(text ?? "");
  const editor = globalThis.foundry?.applications?.ux?.TextEditor?.implementation
    ?? globalThis.TextEditor;
  if (!value || typeof editor?.enrichHTML !== "function") return value;
  return editor.enrichHTML(value);
}

export function itemList(actor) {
  return Array.from(actor?.items ?? []);
}

export function actorItem(actor, itemId) {
  return actor?.items?.get?.(itemId)
    ?? itemList(actor).find(item => item?.id === itemId || item?._id === itemId)
    ?? null;
}

const LEGACY_MESSAGE_MODES = Object.freeze({
  publicroll: "public", gmroll: "gm", blindroll: "blind", selfroll: "self"
});

/**
 * Apply a roll/message mode to chat data. Foundry 14 renamed
 * ChatMessage.applyRollMode to applyMode and its modes from `gmroll` to `gm`;
 * Shadowdark's dialogs still hand out the old names, so both are accepted.
 */
export function applyMessageMode(chatData, mode) {
  if (!mode) return chatData;
  if (typeof ChatMessage.applyMode === "function") {
    return ChatMessage.applyMode(chatData, LEGACY_MESSAGE_MODES[mode] ?? mode);
  }
  if (typeof ChatMessage.applyRollMode === "function") return ChatMessage.applyRollMode(chatData, mode);
  if (["gm", "gmroll", "blind", "blindroll"].includes(mode) && typeof ChatMessage.getWhisperRecipients === "function") {
    chatData.whisper = ChatMessage.getWhisperRecipients("gm").map(user => user.id);
  }
  return chatData;
}

/** Whether a mode means "everyone sees it". */
export function isPublicMessageMode(mode) {
  return !mode || mode === "public" || mode === "publicroll" || mode === "roll";
}
