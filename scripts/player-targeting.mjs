import { L, MODULE_ID, htmlRoot, resolveUuidSync } from "./lib/dom.mjs";
import { mirrorTargetsToCanvas, yieldToMkTargeting } from "./mk-targeting-bridge.mjs";

const PLAYER_ACTOR_TYPE = "Player";
const TARGET_ACTOR_TYPES = new Set(["NPC", PLAYER_ACTOR_TYPE]);

export const PLAYER_ATTACK_TARGETING_SETTING = "enablePlayerAttackTargeting";
export const SPELL_TARGETING_SETTING = "enableSpellTargeting";
export const PLAYER_TARGET_META_KEY = "gtNpcMultiattackPlayerTargets";

const activePanels = new Set();
let hooksRegistered = false;
let refreshQueued = false;

function tokenDescriptor(value, { seesHidden = false } = {}) {
  const token = value?.document?.documentName === "Token"
    ? value.document
    : value?.documentName === "Token" ? value : null;
  const actor = token?.actor ?? value?.actor;
  if (!token || !TARGET_ACTOR_TYPES.has(actor?.type)) return null;
  if (token.hidden && !seesHidden) return null;
  return {
    uuid: token.uuid,
    actorUuid: actor.uuid,
    name: token.name ?? actor.name,
    hidden: Boolean(token.hidden),
    img: token.texture?.src ?? actor.img ?? "icons/svg/mystery-man.svg",
    ac: Number(actor.system?.attributes?.ac?.value)
  };
}

/** Scoped to the open dialog, exactly like the NPC selector's own checkbox. */
function seesHidden(config) {
  return config?.[PLAYER_TARGET_META_KEY]?.seesHidden === true;
}

function currentTargets(config) {
  const unique = new Map();
  const options = { seesHidden: seesHidden(config) };
  for (const token of Array.from(game.user.targets ?? [])) {
    const target = tokenDescriptor(token, options);
    if (target && target.actorUuid !== config.actorUuid) unique.set(target.uuid, target);
  }
  return Array.from(unique.values());
}

function refreshStoredTarget(config, value) {
  const document = resolveUuidSync(value?.uuid);
  const target = tokenDescriptor(document, { seesHidden: seesHidden(config) });
  return target?.actorUuid !== config.actorUuid ? target : null;
}

export function addRandomPlayerTarget(config, value) {
  const metadata = config?.[PLAYER_TARGET_META_KEY];
  if (!metadata?.random) return false;
  if (metadata.randomPoolInitialized !== true) {
    metadata.targets = currentTargets(config);
    metadata.randomPoolInitialized = true;
  }
  const supplied = value?.uuid && value?.actorUuid
    ? value
    : tokenDescriptor(value, { seesHidden: seesHidden(config) });
  const target = supplied ? refreshStoredTarget(config, supplied) : null;
  if (!target) return false;
  metadata.targets ??= [];
  if (metadata.targets.some(candidate => candidate.uuid === target.uuid)) return false;
  metadata.targets.push(target);
  metadata.targetUuids = metadata.targets.map(candidate => candidate.uuid);
  return true;
}

export function removeRandomPlayerTarget(config, uuid) {
  const metadata = config?.[PLAYER_TARGET_META_KEY];
  if (!metadata?.random) return false;
  const previousLength = metadata.targets?.length ?? 0;
  metadata.targets = Array.from(metadata.targets ?? []).filter(target => target.uuid !== uuid);
  metadata.targetUuids = metadata.targets.map(target => target.uuid);
  return metadata.targets.length !== previousLength;
}

function actorForConfig(config) {
  const document = resolveUuidSync(config?.actorUuid);
  return document?.documentName === "Token" ? document.actor : document;
}

/** True for a spell whose range is Self: it can only ever land on its caster. */
export function isSelfRangeSpell(config) {
  if (config?.type !== "spell") return false;
  const spell = resolveUuidSync(config.cast?.spellUuid ?? config.itemUuid, { warn: false });
  return spell?.system?.range === "self";
}

/** The caster's own token — the one behind the config, else its first active token. */
function casterTokenDescriptor(config) {
  const document = resolveUuidSync(config?.actorUuid, { warn: false });
  let token = document?.documentName === "Token" ? document : null;
  if (!token) {
    const actor = document?.documentName === "Token" ? document.actor : document;
    const tokens = Array.from(actor?.getActiveTokens?.(true, true) ?? []);
    token = tokens.find(candidate => candidate?.parent?.id === canvas?.scene?.id) ?? tokens[0] ?? null;
  }
  return tokenDescriptor(token, { seesHidden: true });
}

/**
 * A Self-range spell targets its caster, whatever is targeted on the canvas.
 * Sets `config.targetUuid` so the chat card names the caster; returns the
 * descriptor, or null when the config is not such a spell or has no token.
 */
export function applySelfRangeTarget(config) {
  if (!isSelfRangeSpell(config)) return null;
  const caster = casterTokenDescriptor(config);
  if (!caster) return null;
  config.targetUuid = caster.uuid;
  const metadata = config[PLAYER_TARGET_META_KEY];
  if (metadata) {
    metadata.self = true;
    metadata.targets = [caster];
    metadata.targetUuids = [caster.uuid];
    metadata.selectedTargetUuid = caster.uuid;
  }
  return caster;
}

function releaseCanvasTarget(uuid) {
  const token = Array.from(canvas?.tokens?.placeables ?? [])
    .find(candidate => candidate?.document?.uuid === uuid || candidate?.uuid === uuid);
  token?.setTarget?.(false, { releaseOthers: false });
}

function setAttackTarget(config, target) {
  if (!target) {
    delete config.targetUuid;
    if (config.mainRoll) delete config.mainRoll.dc;
    return;
  }
  config.targetUuid = target.uuid;
  if (config.mainRoll) {
    if (Number.isFinite(target.ac)) config.mainRoll.dc = target.ac;
    else delete config.mainRoll.dc;
  }
}

function setSpellTarget(config, target) {
  if (target) config.targetUuid = target.uuid;
  else delete config.targetUuid;
}

function randomTarget(targets, random = Math.random) {
  if (!targets.length) return null;
  if (targets.length === 1) return targets[0];
  const value = Math.max(0, Math.min(0.999999999, Number(random()) || 0));
  return targets[Math.floor(value * targets.length)];
}

function synchronizeMetadata(config) {
  const metadata = config?.[PLAYER_TARGET_META_KEY];
  if (!metadata) return [];
  if (metadata.self === true) {
    const caster = casterTokenDescriptor(config);
    metadata.targets = caster ? [caster] : [];
    metadata.targetUuids = metadata.targets.map(target => target.uuid);
    return metadata.targets;
  }
  const selected = currentTargets(config);
  let targets;
  if (metadata.random === true) {
    if (metadata.randomPoolInitialized !== true) {
      metadata.targets = selected;
      metadata.randomPoolInitialized = true;
    }
    const unique = new Map();
    for (const stored of metadata.targets ?? []) {
      const target = refreshStoredTarget(config, stored);
      if (target) unique.set(target.uuid, target);
    }
    for (const target of selected) unique.set(target.uuid, target);
    targets = Array.from(unique.values());
  }
  else targets = metadata.area === true ? selected : selected.slice(-1);
  metadata.targets = targets;
  metadata.targetUuids = targets.map(target => target.uuid);
  return targets;
}

function renderPanel(panel, config) {
  const metadata = config[PLAYER_TARGET_META_KEY];
  const targets = synchronizeMetadata(config);
  const pool = panel.querySelector(".gt-npc-ma-player-target-pool");
  pool.replaceChildren();
  for (const target of targets) {
    const chip = document.createElement("div");
    chip.className = "gt-npc-ma-player-target";
    const image = document.createElement("img");
    image.src = target.img;
    image.alt = "";
    const name = document.createElement("span");
    name.textContent = target.name;
    chip.classList.toggle("is-hidden-token", target.hidden === true);
    chip.classList.toggle("is-self", metadata.self === true);
    chip.append(image, name);
    if (metadata.self === true) chip.dataset.tooltip = L("GTNPCMULTIATTACK.Targets.SelfRange");
    if (metadata.random === true) {
      chip.dataset.tooltip = L("GTNPCMULTIATTACK.Random.RemoveTarget");
      chip.addEventListener("contextmenu", event => {
        event.preventDefault();
        event.stopPropagation();
        if (removeRandomPlayerTarget(config, target.uuid)) {
          releaseCanvasTarget(target.uuid);
          renderPanel(panel, config);
        }
      });
    }
    pool.append(chip);
  }
  if (!targets.length) {
    const empty = document.createElement("p");
    empty.className = "gt-npc-ma-player-target-empty";
    empty.textContent = L("GTNPCMULTIATTACK.Targets.UseTargetTool");
    pool.append(empty);
  }
  panel.classList.toggle("is-area", metadata.area === true);
  panel.classList.toggle("is-random", metadata.random === true);
}

function refreshPanels() {
  for (const entry of Array.from(activePanels)) {
    if (entry.panel.isConnected === false) {
      activePanels.delete(entry);
      continue;
    }
    renderPanel(entry.panel, entry.config);
  }
}

function queuePanelRefresh() {
  if (refreshQueued) return;
  refreshQueued = true;
  setTimeout(() => {
    refreshQueued = false;
    refreshPanels();
  }, 0);
}

export function injectPlayerRollTargeting(_application, html, config) {
  const root = htmlRoot(html);
  const actor = actorForConfig(config);
  if (!root || actor?.type !== PLAYER_ACTOR_TYPE || !["attack", "spell"].includes(config?.type)) return null;
  if (config.type === "attack" && !game.settings.get(MODULE_ID, PLAYER_ATTACK_TARGETING_SETTING)) return null;
  if (config.type === "spell" && !game.settings.get(MODULE_ID, SPELL_TARGETING_SETTING)) return null;
  const existing = root.querySelector(".gt-npc-ma-player-targeting");
  if (existing) return existing;

  const metadata = config[PLAYER_TARGET_META_KEY] ??= {
    kind: config.type,
    area: false,
    random: false,
    seesHidden: false,
    randomPoolInitialized: false,
    targetUuids: [],
    targets: []
  };
  metadata.kind = config.type;
  const self = isSelfRangeSpell(config);
  metadata.self = self;

  const section = document.createElement("section");
  section.className = "gt-npc-ma-player-targeting";
  section.classList.toggle("is-self", self);
  const heading = document.createElement("div");
  heading.className = "gt-npc-ma-player-target-heading";
  const headingText = document.createElement("span");
  headingText.textContent = L("GTNPCMULTIATTACK.Targets.Title");
  const options = document.createElement("div");
  options.className = "gt-npc-ma-player-target-options";

  const hiddenLabel = document.createElement("label");
  hiddenLabel.className = "gt-npc-ma-player-sees-hidden";
  const hidden = document.createElement("input");
  hidden.type = "checkbox";
  hidden.checked = metadata.seesHidden === true;
  hidden.addEventListener("change", () => {
    metadata.seesHidden = hidden.checked;
    renderPanel(section, config);
  });
  hiddenLabel.append(hidden, document.createTextNode(L("GTNPCMULTIATTACK.Targets.SeesHidden")));
  options.append(hiddenLabel);
  heading.append(headingText, options);

  let area = null;
  let random = null;

  if (config.type === "spell") {
    const areaLabel = document.createElement("label");
    area = document.createElement("input");
    area.type = "checkbox";
    area.checked = metadata.area === true;
    area.addEventListener("change", () => {
      metadata.area = area.checked;
      if (area.checked) {
        metadata.random = false;
        if (random) random.checked = false;
      }
      renderPanel(section, config);
    });
    areaLabel.append(area, document.createTextNode(L("GTNPCMULTIATTACK.Targets.Area")));
    options.append(areaLabel);
  }

  const randomLabel = document.createElement("label");
  random = document.createElement("input");
  random.type = "checkbox";
  random.checked = metadata.random === true;
  random.addEventListener("change", () => {
    metadata.random = random.checked;
    metadata.randomPoolInitialized = false;
    if (random.checked && area) {
      metadata.area = false;
      area.checked = false;
    }
    renderPanel(section, config);
  });
  randomLabel.append(random, document.createTextNode(L("GTNPCMULTIATTACK.Targets.Random")));
  options.append(randomLabel);

  // A Self spell has one possible target; the pool controls would only mislead.
  if (self) {
    options.replaceChildren();
    const note = document.createElement("span");
    note.className = "gt-npc-ma-player-target-self-note";
    note.textContent = L("GTNPCMULTIATTACK.Targets.SelfRange");
    options.append(note);
  }

  const pool = document.createElement("div");
  pool.className = "gt-npc-ma-player-target-pool";
  section.append(heading, pool);

  const mainKey = config.mainRoll?.key ?? "mainRoll.formula";
  const mainInput = root.querySelector(`input[name="${CSS.escape(mainKey)}"]`)
    ?? root.querySelector('input[name="mainRoll.formula"]');
  const insertionPoint = mainInput?.closest(".roll-input");
  if (!insertionPoint) return null;
  insertionPoint.insertAdjacentElement("afterend", section);
  yieldToMkTargeting(root);
  activePanels.add({ panel: section, config });
  renderPanel(section, config);
  // MK-Shadowdark's assistant refuses to roll with nothing targeted on the
  // canvas; a Self spell's only target is the caster, so target them there.
  if (self) {
    const caster = casterTokenDescriptor(config);
    if (caster) mirrorTargetsToCanvas([caster.uuid]);
  }
  return section;
}

export function preparePlayerAttackTarget(config, random = Math.random) {
  const metadata = config?.[PLAYER_TARGET_META_KEY];
  if (!metadata || metadata.kind !== "attack") return null;
  const targets = synchronizeMetadata(config);
  const target = metadata.random ? randomTarget(targets, random) : targets.at(-1) ?? null;
  metadata.selectedTargetUuid = target?.uuid ?? null;
  setAttackTarget(config, target);
  return target;
}

export function preparePlayerSpellTargets(config, random = Math.random) {
  const metadata = config?.[PLAYER_TARGET_META_KEY];
  if (!metadata || metadata.kind !== "spell") {
    const caster = applySelfRangeTarget(config);
    return caster ? [caster] : [];
  }
  if (metadata.self === true || isSelfRangeSpell(config)) {
    const caster = applySelfRangeTarget(config);
    if (caster) return [caster];
  }
  const targets = synchronizeMetadata(config);
  const target = metadata.random ? randomTarget(targets, random) : targets.at(-1) ?? null;
  setSpellTarget(config, target);
  metadata.selectedTargetUuid = target?.uuid ?? null;
  metadata.targetUuids = targets.map(target => target.uuid);
  return targets;
}

function messageRollConfig(message) {
  return message?.rollConfig ?? message?.getFlag?.("shadowdark", "rollConfig") ?? null;
}

function messageRoot(html) {
  const root = htmlRoot(html);
  if (!root) return null;
  return root.matches?.(".chat-message") ? root : root.closest?.(".chat-message") ?? root;
}

export function injectAreaSpellTargets(message, html) {
  const root = messageRoot(html);
  const config = messageRollConfig(message);
  const metadata = config?.[PLAYER_TARGET_META_KEY];
  const targetUuids = Array.isArray(metadata?.targetUuids) ? metadata.targetUuids : [];
  if (!root || config?.type !== "spell" || !metadata?.area || targetUuids.length < 2) return null;
  if (root.querySelector(".gt-npc-ma-area-spell-targets")) return null;

  const content = root.querySelector(".message-content") ?? root;
  const nativeWrapper = content.querySelector(".target-wrapper");
  if (nativeWrapper) {
    nativeWrapper.hidden = true;
    if (nativeWrapper.previousElementSibling?.classList.contains("sub-heading")) {
      nativeWrapper.previousElementSibling.hidden = true;
    }
  }

  const section = document.createElement("section");
  section.className = "gt-npc-ma-area-spell-targets";
  const heading = document.createElement("h3");
  heading.className = "sub-heading";
  heading.textContent = L("GTNPCMULTIATTACK.Targets.Title");
  const list = document.createElement("div");
  list.className = "gt-npc-ma-area-spell-list";
  const damageRoll = message.getRoll?.("damage")
    ?? Array.from(message.rolls ?? []).find(roll => roll?.options?.type === "damage");
  const applied = new Set(message.getFlag?.(MODULE_ID, "areaDamageApplied") ?? []);

  for (const uuid of targetUuids) {
    const token = resolveUuidSync(uuid);
    const target = tokenDescriptor(token);
    if (!target) continue;
    const row = document.createElement("div");
    row.className = "gt-npc-ma-area-spell-target";
    const image = document.createElement("img");
    image.src = target.img;
    image.alt = "";
    const name = document.createElement("span");
    name.textContent = target.name;
    row.append(image, name);
    if (game.user.isGM && damageRoll) {
      const apply = document.createElement("button");
      apply.type = "button";
      apply.className = "gt-npc-ma-area-apply-damage";
      apply.disabled = applied.has(uuid);
      apply.title = L("GTNPCMULTIATTACK.Targets.ApplySpellDamage");
      apply.setAttribute("aria-label", apply.title);
      apply.innerHTML = '<i class="fa-solid fa-heart-crack" aria-hidden="true"></i>';
      apply.addEventListener("click", async () => {
        const actor = resolveUuidSync(uuid)?.actor;
        if (!actor) return;
        apply.disabled = true;
        const amount = config.cast?.damageType === "healing" ? -Number(damageRoll.total) : Number(damageRoll.total);
        try {
          await actor.applyDamage(amount);
          applied.add(uuid);
          await message.setFlag(MODULE_ID, "areaDamageApplied", Array.from(applied));
        }
        catch (error) {
          apply.disabled = false;
          ui.notifications.error(error.message);
        }
      });
      row.append(apply);
    }
    list.append(row);
  }
  section.append(heading, list);
  content.append(section);
  return section;
}

/** Drop a closed dialog's panel, mirroring unregisterOpenTargetSelector. */
export function unregisterPlayerTargetingPanel(config) {
  for (const entry of Array.from(activePanels)) {
    if (entry.config === config || entry.panel.isConnected === false) activePanels.delete(entry);
  }
}

export function registerPlayerTargetingHooks() {
  if (hooksRegistered) return;
  hooksRegistered = true;
  Hooks.on("closeRollDialogSD", application => unregisterPlayerTargetingPanel(application?.config));
  Hooks.on("targetToken", (user, token, targeted) => {
    if (user !== game.user && user?.id !== game.user?.id) return;
    if (targeted) {
      for (const entry of Array.from(activePanels)) {
        if (entry.panel.isConnected === false) {
          activePanels.delete(entry);
          continue;
        }
        addRandomPlayerTarget(entry.config, token);
      }
    }
    queuePanelRefresh();
  });
  for (const hook of ["createToken", "updateToken", "deleteToken", "canvasReady"]) {
    Hooks.on(hook, queuePanelRefresh);
  }
  Hooks.on("SD-Player-Attack", config => {
    preparePlayerAttackTarget(config);
    return true;
  });
  Hooks.on("SD-Player-Spell", config => {
    preparePlayerSpellTargets(config);
    return true;
  });
  Hooks.on("SD-NPC-Spell-Cast", config => {
    applySelfRangeTarget(config);
    return true;
  });
  Hooks.on("renderChatMessageHTML", injectAreaSpellTargets);
}

export const playerTargetingTestApi = Object.freeze({
  applySelfRangeTarget,
  isSelfRangeSpell,
  addRandomPlayerTarget,
  unregisterPlayerTargetingPanel,
  currentTargets,
  preparePlayerAttackTarget,
  preparePlayerSpellTargets,
  randomTarget,
  removeRandomPlayerTarget,
  synchronizeMetadata,
  tokenDescriptor
});
