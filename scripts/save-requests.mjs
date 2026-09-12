import { abilityName, rollAbilitySave, SAVE_META_KEY } from "./ability-saves.mjs";
import { escapeHtml, F, isPublicMessageMode, L, MODULE_ID, htmlRoot, resolveUuid, resolveUuidSync } from "./lib/dom.mjs";

// Interactive saves. When a custom attack effect calls for an ability check
// by the target, the engine can either roll it on the spot (the old
// behaviour) or post a request card and let the targeted player roll it
// themselves. Only the target's owner or a GM may answer a request; a grey
// Cancel button withdraws one that was a misfire.
//
// The roll itself happens on whichever client pressed the button, through the
// system's own roll dialog, and lands in chat as a normal check card tagged
// with the request's message id. The *active GM's* client watches for that
// card, records the outcome on the request and applies the consequence — so
// the consequence logic stays where the attack's session lives, and a player
// never has to update a document they do not own.

export const SAVE_RESOLUTION_SETTING = "saveResolution";
export const SAVE_REQUEST_FLAG = "saveRequest";
export const SAVE_REQUEST_STATUS = Object.freeze({
  pending: "pending",
  resisted: "resisted",
  failed: "failed",
  cancelled: "cancelled"
});
const SOCKET_NAME = `module.${MODULE_ID}`;

/** Consequence appliers by request kind, registered by the engines that post requests. */
const resolvers = new Map();
/** Requests whose outcome is being written right now, so a double card cannot fire twice. */
const resolving = new Set();

export function registerSaveResolutionSetting() {
  game.settings.register(MODULE_ID, SAVE_RESOLUTION_SETTING, {
    name: L("GTNPCMULTIATTACK.Settings.SaveResolution"),
    hint: L("GTNPCMULTIATTACK.Settings.SaveResolutionHint"),
    scope: "world",
    config: true,
    type: String,
    choices: {
      prompt: L("GTNPCMULTIATTACK.Settings.SaveResolutionPrompt"),
      automatic: L("GTNPCMULTIATTACK.Settings.SaveResolutionAutomatic")
    },
    default: "prompt"
  });
}

/** True when saves are handed to the player rather than rolled by the engine. */
export function isInteractiveSaveMode() {
  try { return game.settings.get(MODULE_ID, SAVE_RESOLUTION_SETTING) !== "automatic"; }
  catch (_error) { return false; }
}

/**
 * Whether a check by this target should be asked for on a card. Player
 * characters always are — a GM running the table alone presses Roll for
 * them. A monster no player owns has nobody to ask, so its checks are rolled
 * on the spot even in the interactive mode.
 */
export function shouldRequestSave(targetActor) {
  if (!isInteractiveSaveMode()) return false;
  if (targetActor?.type === "Player") return true;
  return targetActor?.hasPlayerOwner === true;
}

export function registerSaveRequestResolver(kind, resolver) {
  resolvers.set(kind, resolver);
}

function isActiveGm() {
  return game.users?.activeGM?.id ? game.users.activeGM.id === game.user.id : game.user?.isGM === true;
}

function actorFromDocument(document) {
  return document?.actor ?? (document?.documentName === "Actor" ? document : null);
}

export function requestFromMessage(message) {
  const request = message?.flags?.[MODULE_ID]?.[SAVE_REQUEST_FLAG]
    ?? message?.getFlag?.(MODULE_ID, SAVE_REQUEST_FLAG);
  return request && typeof request === "object" ? request : null;
}

/** Whether `user` may roll or cancel this request: a GM, or an owner of the target. */
export function canAnswerSaveRequest(request, user = game.user) {
  if (!request) return false;
  if (user?.isGM) return true;
  const actor = actorFromDocument(resolveUuidSync(request.targetUuid, { warn: false }));
  if (!actor) return false;
  if (typeof actor.testUserPermission === "function") return actor.testUserPermission(user, "OWNER");
  return actor.isOwner === true;
}

function outcomeText(request) {
  if (request.status === SAVE_REQUEST_STATUS.resisted) {
    return F("GTNPCMULTIATTACK.Saves.Resisted", { resisting: request.resisting });
  }
  if (request.status === SAVE_REQUEST_STATUS.failed) {
    return F("GTNPCMULTIATTACK.Saves.FailedToResist", { resisting: request.resisting });
  }
  if (request.status === SAVE_REQUEST_STATUS.cancelled) {
    return F("GTNPCMULTIATTACK.SaveRequests.Cancelled", { user: request.cancelledBy ?? "" });
  }
  return "";
}

/** The card's HTML for a request in its current state. */
export function renderSaveRequest(request) {
  const ability = abilityName(request.ability);
  const status = request.status ?? SAVE_REQUEST_STATUS.pending;
  const lines = [
    `<div class="gt-npc-ma-save-request" data-status="${escapeHtml(status)}">`,
    `<p class="gt-npc-ma-save-request-title"><strong>${escapeHtml(request.ruleName)}</strong></p>`,
    `<p class="gt-npc-ma-save-request-prompt">${escapeHtml(F("GTNPCMULTIATTACK.SaveRequests.Prompt", {
      target: request.targetName,
      ability,
      dc: request.dc,
      resisting: request.resisting
    }))}</p>`
  ];
  if (status === SAVE_REQUEST_STATUS.pending) {
    lines.push(
      '<div class="gt-npc-ma-save-request-actions">',
      `<button type="button" data-action="rollSave"><i class="fa-solid fa-dice-d20" aria-hidden="true"></i> ${escapeHtml(F(
        "GTNPCMULTIATTACK.SaveRequests.Roll", { ability, dc: request.dc }
      ))}</button>`,
      `<button type="button" data-action="cancelSave" class="gt-npc-ma-save-request-cancel">${escapeHtml(L(
        "GTNPCMULTIATTACK.SaveRequests.Cancel"
      ))}</button>`,
      "</div>"
    );
  }
  else {
    lines.push(`<p class="gt-npc-ma-save-request-outcome is-${escapeHtml(status)}">${escapeHtml(outcomeText(request))}</p>`);
  }
  lines.push("</div>");
  return lines.join("");
}

function whisperRecipients(rollMode, targetActor) {
  if (isPublicMessageMode(rollMode)) return [];
  const users = Array.from(game.users ?? []);
  return users
    .filter(user => user.isGM || targetActor?.testUserPermission?.(user, "OWNER"))
    .map(user => user.id);
}

/**
 * Post a request card. `request` carries everything the eventual consequence
 * needs (`kind` selects the registered resolver; `payload` is handed to it),
 * so that the GM's client can act on it long after the attack session is gone.
 */
export async function postSaveRequest(request) {
  const attacker = actorFromDocument(await resolveUuid(request.attackerUuid, { warn: false }));
  const targetActor = actorFromDocument(await resolveUuid(request.targetUuid, { warn: false }));
  if (!targetActor) return null;
  const stored = {
    ...request,
    targetName: request.targetName ?? targetActor.name,
    status: SAVE_REQUEST_STATUS.pending,
    requestedAt: Date.now()
  };
  const chatData = {
    content: renderSaveRequest(stored),
    speaker: ChatMessage.getSpeaker({ actor: attacker ?? targetActor }),
    author: game.user.id,
    flags: { [MODULE_ID]: { [SAVE_REQUEST_FLAG]: stored, customRule: request.ruleId ?? null } }
  };
  const whisper = whisperRecipients(request.rollMode, targetActor);
  if (whisper.length) chatData.whisper = whisper;
  return ChatMessage.create(chatData);
}

/** Write an outcome onto the request card and, on a failure, apply its consequence. */
export async function resolveSaveRequest(message, status, extra = {}) {
  const request = requestFromMessage(message);
  if (!request || request.status !== SAVE_REQUEST_STATUS.pending) return null;
  const next = { ...request, ...extra, status, resolvedAt: Date.now() };
  await message.update({
    content: renderSaveRequest(next),
    [`flags.${MODULE_ID}.${SAVE_REQUEST_FLAG}`]: next
  });
  if (status !== SAVE_REQUEST_STATUS.failed) return next;
  const resolver = resolvers.get(next.kind);
  if (!resolver) {
    console.warn(`${MODULE_ID} | No consequence handler registered for save request kind "${next.kind}".`);
    return next;
  }
  try { await resolver(next); }
  catch (error) {
    console.error(`${MODULE_ID} | Applying a failed save's consequence failed.`, error);
    ui.notifications?.error?.(L("GTNPCMULTIATTACK.SaveRequests.ConsequenceFailed"));
  }
  return next;
}

/** The target (or a GM) rolls the requested check through the system's dialog. */
export async function rollRequestedSave(message) {
  const request = requestFromMessage(message);
  if (!request || request.status !== SAVE_REQUEST_STATUS.pending) return null;
  if (!canAnswerSaveRequest(request)) {
    ui.notifications?.warn?.(L("GTNPCMULTIATTACK.SaveRequests.NotYours"));
    return null;
  }
  const actor = actorFromDocument(await resolveUuid(request.targetUuid, { warn: false }));
  if (!actor) {
    ui.notifications?.warn?.(L("GTNPCMULTIATTACK.SaveRequests.NoTarget"));
    return null;
  }
  return rollAbilitySave(actor, {
    ability: request.ability,
    dc: request.dc,
    rollMode: request.rollMode,
    title: request.ruleName,
    resisting: request.resisting,
    interactive: true,
    requestId: message.id
  });
}

/** Withdraw a pending request. A player asks the active GM to do the write. */
export async function cancelRequestedSave(message) {
  const request = requestFromMessage(message);
  if (!request || request.status !== SAVE_REQUEST_STATUS.pending) return null;
  if (!canAnswerSaveRequest(request)) {
    ui.notifications?.warn?.(L("GTNPCMULTIATTACK.SaveRequests.NotYours"));
    return null;
  }
  if (game.user.isGM) {
    return resolveSaveRequest(message, SAVE_REQUEST_STATUS.cancelled, { cancelledBy: game.user.name });
  }
  if (!game.users?.activeGM) {
    ui.notifications?.warn?.(L("GTNPCMULTIATTACK.SaveRequests.NoGm"));
    return null;
  }
  game.socket?.emit?.(SOCKET_NAME, { type: "cancelSaveRequest", messageId: message.id, userId: game.user.id });
  return true;
}

function rollConfigOf(message) {
  return message?.rollConfig
    ?? message?.getFlag?.("shadowdark", "rollConfig")
    ?? message?.flags?.shadowdark?.rollConfig
    ?? null;
}

function mainRollOf(message) {
  return message?.getRoll?.("main")
    ?? Array.from(message?.rolls ?? []).find(roll => roll?.options?.type === "main")
    ?? null;
}

/**
 * The active GM sees every check card; one tagged with a pending request's id
 * settles that request. A card for an already settled request — a luck-token
 * reroll, say — is left for the GM to adjudicate by hand.
 */
export async function settleSaveRequestFromRoll(message) {
  if (!isActiveGm()) return null;
  const requestId = rollConfigOf(message)?.[SAVE_META_KEY]?.requestId;
  if (!requestId || resolving.has(requestId)) return null;
  const requestMessage = game.messages?.get?.(requestId);
  const request = requestFromMessage(requestMessage);
  if (!request || request.status !== SAVE_REQUEST_STATUS.pending) return null;
  const roll = mainRollOf(message);
  if (!roll || typeof roll.success !== "boolean") return null;
  resolving.add(requestId);
  try {
    return await resolveSaveRequest(
      requestMessage,
      roll.success ? SAVE_REQUEST_STATUS.resisted : SAVE_REQUEST_STATUS.failed,
      { rollMessageId: message.id, rolledBy: message.author?.id ?? message.user?.id ?? null }
    );
  }
  finally { resolving.delete(requestId); }
}

async function onSocketMessage(data) {
  if (data?.type !== "cancelSaveRequest" || !isActiveGm()) return;
  const message = game.messages?.get?.(data.messageId);
  const request = requestFromMessage(message);
  const user = game.users?.get?.(data.userId);
  if (!request || !user || !canAnswerSaveRequest(request, user)) return;
  await resolveSaveRequest(message, SAVE_REQUEST_STATUS.cancelled, { cancelledBy: user.name });
}

/** Bind the card's buttons and grey them out for anyone who may not answer. */
export function injectSaveRequestControls(message, html) {
  const root = htmlRoot(html);
  const card = root?.querySelector?.(".gt-npc-ma-save-request");
  const request = requestFromMessage(message);
  if (!card || !request || card.dataset.bound === "true") return null;
  card.dataset.bound = "true";
  const buttons = Array.from(card.querySelectorAll("button[data-action]"));
  if (!buttons.length) return card;
  if (!canAnswerSaveRequest(request)) {
    for (const button of buttons) {
      button.disabled = true;
      button.title = L("GTNPCMULTIATTACK.SaveRequests.NotYours");
    }
    return card;
  }
  for (const button of buttons) {
    button.addEventListener("click", async event => {
      event.preventDefault();
      for (const other of buttons) other.disabled = true;
      try {
        if (button.dataset.action === "rollSave") await rollRequestedSave(message);
        else await cancelRequestedSave(message);
      }
      catch (error) {
        console.error(`${MODULE_ID} | Save request action failed.`, error);
      }
      finally {
        // Re-enable only while the request is still open; a settled card is
        // re-rendered without buttons anyway.
        if (requestFromMessage(message)?.status === SAVE_REQUEST_STATUS.pending) {
          for (const other of buttons) other.disabled = false;
        }
      }
    });
  }
  return card;
}

export function registerSaveRequestHooks() {
  Hooks.on("renderChatMessageHTML", injectSaveRequestControls);
  Hooks.on("createChatMessage", message => {
    void settleSaveRequestFromRoll(message).catch(error => {
      console.error(`${MODULE_ID} | Could not settle a save request.`, error);
    });
  });
  Hooks.once("ready", () => {
    game.socket?.on?.(SOCKET_NAME, data => {
      void onSocketMessage(data).catch(error => {
        console.error(`${MODULE_ID} | Save request socket message failed.`, error);
      });
    });
  });
}

export const saveRequestsTestApi = Object.freeze({
  canAnswerSaveRequest,
  onSocketMessage,
  renderSaveRequest,
  resolvers
});
