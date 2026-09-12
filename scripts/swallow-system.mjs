import { documentFlag, L, MODULE_ID, escapeHtml } from "./lib/dom.mjs";
import { registerModuleStatusEffects } from "./save-consequences.mjs";
import { rollAbilitySave } from "./ability-saves.mjs";
import { postSaveRequest, registerSaveRequestResolver, shouldRequestSave } from "./save-requests.mjs";

const SWALLOWED_FLAG = "swallowed";
// Deliberately unchanged across the 1.0 rename: existing ActiveEffects on
// swallowed tokens carry this id and must stay recognisable.
const STATUS_ID = "gt-npc-multiattack-swallowed";
const HUD_CLASS = "gt-npc-ma-release-swallowed";

function activeGm() {
  return game.users?.activeGM?.id ? game.users.activeGM.id === game.user.id : game.user.isGM;
}

function combatRound() {
  return Math.max(0, Number(game.combat?.round) || 0);
}

function turnKey(combat = game.combat) {
  return `${Math.max(0, Number(combat?.round) || 0)}:${Math.max(0, Number(combat?.turn) || 0)}`;
}

function sceneTokens(scene = canvas?.scene) {
  return Array.from(scene?.tokens ?? []);
}

/**
 * Every token in the world carrying swallow state. Swallowed creatures must be
 * findable even when the GM is looking at a different scene, otherwise release
 * and cleanup silently do nothing and the token stays hidden forever.
 */
function allSwallowedTokens() {
  const scenes = Array.from(game.scenes ?? []);
  if (!scenes.length) return sceneTokens().filter(token => swallowedState(token));
  return scenes.flatMap(scene => sceneTokens(scene).filter(token => swallowedState(token)));
}

function swallowedState(tokenDocument) {
  return documentFlag(tokenDocument, SWALLOWED_FLAG) ?? null;
}

async function resolveTokenDocument(uuid) {
  const document = typeof fromUuid === "function" ? await fromUuid(uuid) : null;
  return document?.actor ? document : document?.document?.actor ? document.document : null;
}

function rollAutomaticStrengthSave(actor, dc, rollMode) {
  return rollAbilitySave(actor, {
    ability: "str",
    dc,
    rollMode,
    title: L("GTNPCMULTIATTACK.Swallow.SaveTitle"),
    heading: game.i18n.format("GTNPCMULTIATTACK.Swallow.SaveHeading", { dc })
  });
}

async function createSwallowedEffect(actor, tokenUuid) {
  const existing = Array.from(actor?.effects ?? []).find(effect =>
    effect.statuses?.has?.(STATUS_ID) || effect.getFlag?.(MODULE_ID, "swallowedTokenUuid") === tokenUuid);
  if (existing || typeof actor?.createEmbeddedDocuments !== "function") return existing;
  const [effect] = await actor.createEmbeddedDocuments("ActiveEffect", [{
    name: L("GTNPCMULTIATTACK.Swallow.Status"),
    img: "icons/svg/net.svg",
    statuses: [STATUS_ID],
    flags: { [MODULE_ID]: { swallowedTokenUuid: tokenUuid } }
  }]);
  return effect;
}

async function removeSwallowedEffects(actor, tokenUuid) {
  const ids = Array.from(actor?.effects ?? []).filter(effect =>
    effect.statuses?.has?.(STATUS_ID) || effect.getFlag?.(MODULE_ID, "swallowedTokenUuid") === tokenUuid)
    .map(effect => effect.id);
  if (ids.length) await actor.deleteEmbeddedDocuments("ActiveEffect", ids);
}

export async function releaseSwallowedToken(tokenDocument, { chat = true } = {}) {
  const state = swallowedState(tokenDocument);
  if (!state) return false;
  await removeSwallowedEffects(tokenDocument.actor, tokenDocument.uuid);
  await tokenDocument.update({ hidden: state.previousHidden === true });
  await tokenDocument.unsetFlag(MODULE_ID, SWALLOWED_FLAG);
  if (chat) {
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: tokenDocument.actor }),
      content: `<p>${game.i18n.format("GTNPCMULTIATTACK.Swallow.Released", {
        target: escapeHtml(tokenDocument.name)
      })}</p>`
    });
  }
  return true;
}

export async function releaseAllFromSwallower(swallowerTokenUuid) {
  const swallowed = allSwallowedTokens()
    .filter(token => swallowedState(token).swallowerTokenUuid === swallowerTokenUuid);
  for (const token of swallowed) await releaseSwallowedToken(token);
  return swallowed.length;
}

const SWALLOW_REQUEST_KIND = "swallow";

registerSaveRequestResolver(SWALLOW_REQUEST_KIND, request => engulfTarget(
  { actorUuid: request.attackerUuid },
  { id: request.ruleId },
  request.payload ?? {},
  request.targetUuid
));

export async function swallowTarget(config, rule, effect, targetUuid) {
  if (!activeGm()) return false;
  const targetToken = await resolveTokenDocument(targetUuid);
  const swallowerActor = typeof fromUuid === "function" ? await fromUuid(config.actorUuid) : null;
  if (!targetToken?.actor || !swallowerActor || swallowedState(targetToken)) return false;
  if (shouldRequestSave(targetToken.actor)) {
    const posted = await postSaveRequest({
      kind: SWALLOW_REQUEST_KIND,
      ruleId: rule.id,
      ruleName: rule.name ?? L("GTNPCMULTIATTACK.Swallow.SaveTitle"),
      attackerUuid: config.actorUuid,
      targetUuid,
      ability: "str",
      dc: effect.dc,
      resisting: L("GTNPCMULTIATTACK.Swallow.Resisting"),
      rollMode: config.rollMode,
      payload: { damage: effect.damage, releaseDamage: effect.releaseDamage }
    });
    return Boolean(posted);
  }
  const save = await rollAutomaticStrengthSave(targetToken.actor, effect.dc, config.rollMode);
  if (!save || save.success === true) return false;
  return engulfTarget(config, rule, effect, targetUuid);
}

/** The part after a failed check: hide the token, mark it, and say so. */
async function engulfTarget(config, rule, effect, targetUuid) {
  const targetToken = await resolveTokenDocument(targetUuid);
  const swallowerActor = typeof fromUuid === "function" ? await fromUuid(config.actorUuid) : null;
  if (!targetToken?.actor || !swallowerActor || swallowedState(targetToken)) return false;
  const swallowerToken = sceneTokens().find(token => token.actor?.uuid === swallowerActor.uuid)
    ?? swallowerActor.getActiveTokens?.(true, true)?.[0]?.document;
  if (!swallowerToken) {
    ui.notifications.warn(L("GTNPCMULTIATTACK.Swallow.NoSwallowerToken"));
    return false;
  }
  const state = {
    swallowerTokenUuid: swallowerToken.uuid,
    swallowerActorUuid: swallowerActor.uuid,
    sourceRuleId: rule.id,
    damage: effect.damage,
    releaseDamage: effect.releaseDamage,
    previousHidden: targetToken.hidden === true,
    swallowedAtTurn: turnKey(),
    lastDamageTurn: null,
    gulletDamageRound: combatRound(),
    gulletDamage: 0
  };
  await targetToken.setFlag(MODULE_ID, SWALLOWED_FLAG, state);
  await targetToken.update({ hidden: true });
  await createSwallowedEffect(targetToken.actor, targetToken.uuid);
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: swallowerActor }),
    content: `<p>${game.i18n.format("GTNPCMULTIATTACK.Swallow.Swallowed", {
      target: escapeHtml(targetToken.name)
    })}</p>`
  });
  return true;
}

async function applyOngoingDamage(token, state, combat) {
  const currentTurn = turnKey(combat);
  if (state.swallowedAtTurn === currentTurn || state.lastDamageTurn === currentTurn) return false;
  const swallower = await resolveTokenDocument(state.swallowerTokenUuid);
  if (!swallower?.actor || !token.actor) return false;
  const damageRollConfig = {
    label: L("GTNPCMULTIATTACK.Swallow.OngoingDamage"),
    formula: state.damage,
    base: state.damage,
    type: "damage",
    needed: true,
    criticalHit: false
  };
  const roll = await shadowdark.dice.roll(damageRollConfig, swallower.actor.getRollData());
  const chatConfig = {
    actorUuid: swallower.actor.uuid,
    targetUuid: token.uuid,
    type: "damage",
    heading: L("GTNPCMULTIATTACK.Swallow.Status"),
    damageRoll: damageRollConfig
  };
  const chatData = await shadowdark.chat.renderRollMessage(chatConfig, [roll]);
  chatData.flags ??= {};
  chatData.flags[MODULE_ID] = { swallowDamage: true, targetUuid: token.uuid };
  await ChatMessage.create(chatData);
  await token.actor.applyDamage(roll.total);
  await token.setFlag(MODULE_ID, SWALLOWED_FLAG, { ...state, lastDamageTurn: currentTurn });
  return true;
}

async function onCombatTurn(combat, changed) {
  if (!activeGm() || !("turn" in changed || "round" in changed)) return;
  const swallowerTokenUuid = combat.combatant?.token?.uuid;
  if (!swallowerTokenUuid) return;
  const swallowed = allSwallowedTokens()
    .filter(token => swallowedState(token).swallowerTokenUuid === swallowerTokenUuid);
  for (const token of swallowed) await applyOngoingDamage(token, swallowedState(token), combat);
}

function sourceSwallowedToken(actorUuid) {
  return allSwallowedTokens().find(token => token.actor?.uuid === actorUuid);
}

async function onDamageApplied(message, changed) {
  if (!activeGm()) return;
  const applied = foundry.utils.getProperty(changed, "flags.shadowdark.damageApplied")
    ?? changed?.flags?.shadowdark?.damageApplied;
  if (applied !== true) return;
  const config = message.rollConfig;
  if (!config?.actorUuid || !config.targetUuid) return;
  const sourceToken = sourceSwallowedToken(config.actorUuid);
  const state = swallowedState(sourceToken);
  if (!state || state.swallowerTokenUuid !== config.targetUuid) return;
  const damage = Math.max(0, Number(message.getRoll?.("damage")?.total) || 0);
  if (!damage) return;
  const round = combatRound();
  const previous = state.gulletDamageRound === round ? Number(state.gulletDamage) || 0 : 0;
  const total = previous + damage;
  await sourceToken.setFlag(MODULE_ID, SWALLOWED_FLAG, {
    ...state,
    gulletDamageRound: round,
    gulletDamage: total
  });
  if (total >= Number(state.releaseDamage)) await releaseAllFromSwallower(state.swallowerTokenUuid);
}

function injectReleaseButton(application, html) {
  if (!game.user.isGM) return null;
  const root = html instanceof HTMLElement ? html : html?.[0];
  const token = application?.object?.document ?? application?.object;
  if (!root || !swallowedState(token) || root.querySelector(`.${HUD_CLASS}`)) return null;
  const column = root.querySelector(".col.left") ?? root.querySelector(".col.right");
  if (!column) return null;
  const button = document.createElement("button");
  button.type = "button";
  button.className = `control-icon ${HUD_CLASS}`;
  button.dataset.tooltip = L("GTNPCMULTIATTACK.Swallow.ReleaseAction");
  button.setAttribute("aria-label", button.dataset.tooltip);
  button.innerHTML = '<i class="fa-solid fa-person-circle-xmark" aria-hidden="true"></i>';
  button.addEventListener("click", () => void releaseSwallowedToken(token).catch(error => {
    ui.notifications.error(L("GTNPCMULTIATTACK.Swallow.ReleaseFailed"));
    console.error(`${MODULE_ID} | Could not release swallowed token.`, error);
  }));
  column.append(button);
  return button;
}

function registerSwallowStatusEffect() {
  const statusEffects = globalThis.CONFIG?.statusEffects;
  if (!Array.isArray(statusEffects) || statusEffects.some(effect => effect.id === STATUS_ID)) return;
  statusEffects.push({
    id: STATUS_ID,
    name: "GTNPCMULTIATTACK.Swallow.Status",
    img: "icons/svg/net.svg"
  });
}

export function registerSwallowSystem() {
  // Registered at "setup" rather than "init": the system may still replace
  // CONFIG.statusEffects wholesale while init hooks are running.
  Hooks.once("setup", () => {
    registerSwallowStatusEffect();
    registerModuleStatusEffects();
  });
  Hooks.on("updateCombat", onCombatTurn);
  Hooks.on("updateChatMessage", onDamageApplied);
  Hooks.on("renderTokenHUD", injectReleaseButton);
  Hooks.on("deleteToken", token => {
    if (activeGm()) void releaseAllFromSwallower(token.uuid);
  });
}
