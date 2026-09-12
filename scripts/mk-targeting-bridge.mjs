import { L, MODULE_ID } from "./lib/dom.mjs";

// MK-Shadowdark 1.9.16 added a "Targeting Assistant" that wraps
// RollDialogSD._onRender/_onSubmit, draws its own Targets panel from
// game.user.targets, and refuses to roll when that set is empty. This module's
// Select rows can set a target from a dropdown without ever touching the canvas,
// so the two disagree. When both are on the same dialog we yield: MK's panel is
// hidden and our selection is mirrored into game.user.targets so its gate passes.
//
// Everything here is scoped to "MK's panel is present in this dialog" and can be
// turned off, so it is inert for anyone without MK-Shadowdark.

export const YIELD_SETTING = "yieldToMkTargetingAssistant";
export const MK_MODULE_ID = "mk-shadowdark";
export const MK_PANEL_SELECTOR = ".mk-targeting-assistant";
export const YIELD_CLASS = "gt-npc-ma-yields-mk";

let mirroring = false;

export function registerMkTargetingSetting() {
  game.settings.register(MODULE_ID, YIELD_SETTING, {
    name: L("GTNPCMULTIATTACK.Settings.YieldToMkTargeting"),
    hint: L("GTNPCMULTIATTACK.Settings.YieldToMkTargetingHint"),
    scope: "client",
    config: true,
    type: Boolean,
    default: true
  });
}

function yieldEnabled() {
  try { return game.settings.get(MODULE_ID, YIELD_SETTING) !== false; }
  catch (_error) { return true; }
}

function mkActive() {
  return game.modules?.get?.(MK_MODULE_ID)?.active === true;
}

/** True while a canvas update originates from this module's own mirroring. */
export function isMirroringTargets() {
  return mirroring;
}

/**
 * Mark a dialog as one where MK's panel should stay hidden. Returns whether the
 * bridge is in effect for this dialog. The class is what hides the panel, so it
 * survives MK re-rendering its markup on every targetToken.
 */
export function yieldToMkTargeting(root) {
  if (!root || !yieldEnabled() || !mkActive()) return false;
  const form = root.matches?.("form") ? root : root.closest?.("form") ?? root;
  form.classList?.add(YIELD_CLASS);
  return true;
}

function sceneTokenByUuid(uuid) {
  return Array.from(globalThis.canvas?.tokens?.placeables ?? [])
    .find(token => token?.document?.uuid === uuid) ?? null;
}

/**
 * Make game.user.targets equal to `uuids`, touching only tokens whose state
 * actually differs. An empty selection leaves the canvas alone: with nothing
 * chosen anywhere, MK's refusal to roll is the right outcome.
 */
export function mirrorTargetsToCanvas(uuids, { force = false } = {}) {
  if (!force && (!yieldEnabled() || !mkActive())) return 0;
  const wanted = new Set(Array.from(uuids ?? []).filter(Boolean));
  if (!wanted.size || !globalThis.canvas?.ready) return 0;
  const user = game.user;
  const current = new Map(Array.from(user?.targets ?? []).map(token => [token.document?.uuid, token]));
  let changed = 0;
  mirroring = true;
  try {
    for (const [uuid, token] of current) {
      if (wanted.has(uuid) || typeof token?.setTarget !== "function") continue;
      token.setTarget(false, { user, releaseOthers: false, groupSelection: true });
      changed += 1;
    }
    for (const uuid of wanted) {
      if (current.has(uuid)) continue;
      const token = sceneTokenByUuid(uuid);
      if (typeof token?.setTarget !== "function") continue;
      token.setTarget(true, { user, releaseOthers: false, groupSelection: true });
      changed += 1;
    }
    if (changed && typeof user?.broadcastActivity === "function") {
      user.broadcastActivity({ targets: Array.from(user.targets ?? []).map(token => token.id) });
    }
  }
  finally { mirroring = false; }
  return changed;
}

export const mkTargetingBridgeTestApi = Object.freeze({
  mirrorTargetsToCanvas,
  yieldToMkTargeting
});
