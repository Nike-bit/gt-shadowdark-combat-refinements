import { escapeHtml, F, MODULE_ID } from "./lib/dom.mjs";
import { PENDING_DEATH_TIMER_FLAG } from "./save-consequences.mjs";

// MK-Shadowdark's Death Timer: at 0 HP a player presses the skull on their
// sheet and 1d4 + CON turns are rolled. A lethal poison in Shadowdark instead
// says "death timer of 1". MK exposes no way in, but its sheet button looks up
// `globalThis.MKShadowdarkDeathTimer.activate` at click time, so a wrapper can
// take over the *start* of a timer and leave every later tick to MK.
//
// The forced value lives in a one-shot flag written when the poison lands and
// consumed the first time a timer starts. Healing above 0 HP clears it, so a
// poison that never got as far as a timer cannot resurface on a later, unrelated
// drop to 0.

const MK_MODULE_ID = "mk-shadowdark";
const MK_STATUS_ID = "mk-death-timer";
const BRIDGED = Symbol.for(`${MODULE_ID}.deathTimerBridge`);

function timerIcon(turns) {
  const n = Math.max(1, Math.min(4, Number(turns) || 1));
  return `modules/${MK_MODULE_ID}/assets/icons/blood-drop-red-${n}.png`;
}

function conModifier(actor) {
  const mod = Number(actor?.system?.abilities?.con?.mod);
  return Number.isFinite(mod) ? mod : 0;
}

export function pendingDeathTimer(actor) {
  const pending = actor?.flags?.[MODULE_ID]?.[PENDING_DEATH_TIMER_FLAG];
  const turns = Math.floor(Number(pending?.turns));
  return Number.isFinite(turns) && turns >= 1 ? { ...pending, turns } : null;
}

async function clearPendingDeathTimer(actor) {
  if (!actor?.flags?.[MODULE_ID]?.[PENDING_DEATH_TIMER_FLAG]) return;
  await actor.update({ [`flags.${MODULE_ID}.-=${PENDING_DEATH_TIMER_FLAG}`]: null }, { render: false });
}

/**
 * Start a timer at a fixed number of turns, writing the same effect and flag
 * shape MK writes so its own tick handles everything from here on.
 */
async function startForcedDeathTimer(actor, pending, original) {
  const turns = pending.turns;
  // MK's own floor, if its setting is registered; otherwise 1.
  let minimum = 1;
  try { minimum = Number(game.settings.get(MK_MODULE_ID, "deathTimerMinTurns")); }
  catch (_error) { minimum = 1; }
  const forced = Math.max(Number.isFinite(minimum) ? minimum : 1, turns);
  const name = `Death Timer (${forced})`;
  const data = {
    name,
    img: timerIcon(forced),
    statuses: [MK_STATUS_ID],
    disabled: false,
    changes: [],
    flags: {
      [MK_MODULE_ID]: { isDeathTimer: true, turns: forced },
      core: { statusId: MK_STATUS_ID },
      [MODULE_ID]: { forcedBy: pending.sourceRuleId ?? null }
    }
  };
  const existing = Array.from(actor.effects ?? []).find(effect =>
    effect.flags?.[MK_MODULE_ID]?.isDeathTimer === true || effect.statuses?.has?.(MK_STATUS_ID));
  if (existing) await existing.update(data);
  else await actor.createEmbeddedDocuments("ActiveEffect", [data]);
  await actor.update({
    [`flags.${MK_MODULE_ID}.deathTimer`]: { turns: forced, conMod: conModifier(actor), updatedAt: Date.now() },
    [`flags.${MODULE_ID}.-=${PENDING_DEATH_TIMER_FLAG}`]: null
  });

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    author: game.user.id,
    content: `<p>${escapeHtml(F("GTNPCMULTIATTACK.DeathTimer.Forced", { actor: actor.name, turns: forced }))}</p>`,
    flags: { [MODULE_ID]: { forcedDeathTimer: true } }
  });

  // If MK cannot read what we wrote, its shape has changed: hand the actor to
  // MK's own start so the player is never left without a timer, and say so.
  const seen = original.getTurns?.(actor);
  if (Number(seen) !== forced) {
    console.warn(`${MODULE_ID} | MK-Shadowdark did not recognise the forced death timer; falling back to its own roll.`);
    ui.notifications?.warn?.(F("GTNPCMULTIATTACK.DeathTimer.Fallback", { turns: forced }));
    return original.activate(actor);
  }
  return forced;
}

/** Wrap MK's API object once it exists. Returns whether the wrapper is in place. */
export function installMkDeathTimerBridge() {
  const original = globalThis.MKShadowdarkDeathTimer;
  if (!original || typeof original.activate !== "function") return false;
  if (original[BRIDGED]) return true;
  const wrapped = Object.freeze({
    ...original,
    [BRIDGED]: true,
    async activate(actor) {
      const pending = pendingDeathTimer(actor);
      const hp = Number(actor?.system?.attributes?.hp?.value);
      const running = original.getTurns?.(actor);
      const timerRunning = running !== null && running !== undefined && !Number.isNaN(Number(running));
      if (!pending || !(hp <= 0) || timerRunning) return original.activate(actor);
      return startForcedDeathTimer(actor, pending, original);
    }
  });
  globalThis.MKShadowdarkDeathTimer = wrapped;
  return true;
}

export function registerDeathTimerBridgeHooks() {
  Hooks.once("ready", () => { installMkDeathTimerBridge(); });
  // A poisoned character healed above 0 before their turn never starts that
  // timer; the forced value must not wait around for the next unrelated drop.
  Hooks.on("updateActor", (actor, change) => {
    const hp = foundry.utils.getProperty(change, "system.attributes.hp.value");
    if (hp === undefined || !(Number(hp) > 0)) return;
    if (!actor?.isOwner) return;
    void clearPendingDeathTimer(actor).catch(error => {
      console.warn(`${MODULE_ID} | Could not clear a pending death timer.`, error);
    });
  });
}

export const deathTimerBridgeTestApi = Object.freeze({
  installMkDeathTimerBridge,
  pendingDeathTimer
});
