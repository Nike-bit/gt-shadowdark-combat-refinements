import { L, MODULE_ID } from "./lib/dom.mjs";
import { isMirroringTargets, mirrorTargetsToCanvas, yieldToMkTargeting } from "./mk-targeting-bridge.mjs";

const NPC_ACTOR_TYPE = "NPC";
const PLAYER_ACTOR_TYPE = "Player";
const TARGET_META_KEY = "gtNpcMultiattackTargets";
const TARGET_SELECTOR_CLASS = "gt-npc-ma-target-selector";
const NPC_FONT_STYLE_SETTING = "npcTargetFontStyle";
const NPC_FONT_COLOR_SETTING = "npcTargetFontColor";
const PC_FONT_STYLE_SETTING = "pcTargetFontStyle";
const PC_FONT_COLOR_SETTING = "pcTargetFontColor";
export const TARGET_MODE_CONTROLLED = "controlled";
export const TARGET_MODE_RANDOM = "random";
const activeTargetSelectors = new Set();
let liveHooksRegistered = false;
let liveRefreshQueued = false;

function tokenDocument(value) {
  if (value?.document?.documentName === "Token") return value.document;
  if (value?.documentName === "Token") return value;
  return null;
}

function targetDescriptor(value) {
  const document = tokenDocument(value);
  const actor = document?.actor ?? value?.actor;
  if (!document || ![NPC_ACTOR_TYPE, PLAYER_ACTOR_TYPE].includes(actor?.type)) return null;
  const acValue = Number(actor.system?.attributes?.ac?.value);
  return {
    uuid: document.uuid,
    actorUuid: actor.uuid,
    name: document.name ?? actor.name,
    actorType: actor.type,
    hidden: Boolean(document.hidden),
    img: document.texture?.src ?? actor.img ?? "icons/svg/mystery-man.svg",
    ac: Number.isFinite(acValue) ? acValue : null
  };
}

function canTargetDescriptor(target, config) {
  return Boolean(target) && (!target.hidden || config?.[TARGET_META_KEY]?.seesHidden === true);
}

function descriptorFromUuid(uuid, config = null) {
  if (!uuid || typeof fromUuidSync !== "function") return null;
  try {
    const target = targetDescriptor(fromUuidSync(uuid));
    return canTargetDescriptor(target, config) ? target : null;
  }
  catch (error) {
    console.warn(`${MODULE_ID} | Could not resolve target UUID.`, error);
    return null;
  }
}

function visibleSceneTargets(config) {
  const attackerUuid = config?.actorUuid;
  const eligible = (globalThis.canvas?.tokens?.placeables ?? [])
    .map(targetDescriptor)
    .filter(target => canTargetDescriptor(target, config));
  // Excluding by Actor UUID also removed the other tokens of a *linked* attacker,
  // which are legitimate targets. The roll config does not say which token is
  // attacking, so only self-exclude when the answer is unambiguous.
  const own = eligible.filter(target => target.actorUuid === attackerUuid);
  const excluded = own.length === 1 ? new Set([own[0].uuid]) : new Set();
  return eligible
    .filter(target => !excluded.has(target.uuid))
    .sort((left, right) => left.name.localeCompare(right.name, game.i18n.lang));
}

function currentCanvasTargets(config) {
  const attackerUuid = config?.actorUuid;
  const unique = new Map();
  for (const value of Array.from(game.user.targets ?? [])) {
    const target = targetDescriptor(value);
    if (canTargetDescriptor(target, config) && target.actorUuid !== attackerUuid) unique.set(target.uuid, target);
  }
  return Array.from(unique.values());
}

function latestCanvasTarget(config) {
  return currentCanvasTargets(config).at(-1) ?? null;
}

export function targetMode(configOrMetadata) {
  const metadata = configOrMetadata?.[TARGET_META_KEY] ?? configOrMetadata;
  if (!metadata) return null;
  return metadata?.mode === TARGET_MODE_RANDOM ? TARGET_MODE_RANDOM : TARGET_MODE_CONTROLLED;
}

function setTargetMode(metadata, mode) {
  metadata.mode = mode === TARGET_MODE_RANDOM ? TARGET_MODE_RANDOM : TARGET_MODE_CONTROLLED;
}

function matchesFilters(target, filters) {
  if (target.actorType === NPC_ACTOR_TYPE) return filters.npcs;
  if (target.actorType === PLAYER_ACTOR_TYPE) return filters.pcs;
  return false;
}

function rowTotal(metadata) {
  return metadata.rows.reduce((total, row) => total + row.count, 0);
}

function setConfigTarget(config, target) {
  if (target) {
    config.targetUuid = target.uuid;
    if (config.mainRoll) {
      if (Number.isFinite(target.ac)) config.mainRoll.dc = target.ac;
      else delete config.mainRoll.dc;
    }
  }
  else {
    delete config.targetUuid;
    if (config.mainRoll) delete config.mainRoll.dc;
  }
}

function synchronizePrimaryTarget(config) {
  const target = config[TARGET_META_KEY]?.rows?.[0]?.target ?? null;
  setConfigTarget(config, target);
}

function restoreSimpleTarget(config) {
  setConfigTarget(config, config[TARGET_META_KEY]?.simpleTarget ?? null);
}

export function reconcileTargetPool(config) {
  const metadata = config?.[TARGET_META_KEY];
  if (!metadata?.rows?.length) return metadata;
  const targets = new Map(visibleSceneTargets(config).map(target => [target.uuid, target]));
  metadata.rows = metadata.rows.map(row => ({
    ...row,
    target: row.target ? targets.get(row.target.uuid) ?? null : null
  }));
  metadata.randomTargets = Array.from(metadata.randomTargets ?? [])
    .map(target => targets.get(target.uuid) ?? null)
    .filter(Boolean);

  if (targetMode(metadata) === TARGET_MODE_CONTROLLED) {
    synchronizePrimaryTarget(config);
    return metadata;
  }

  restoreSimpleTarget(config);
  return metadata;
}

export function initializeTargetPool(config, selected = 1) {
  if (config[TARGET_META_KEY]) return config[TARGET_META_KEY];
  const initial = latestCanvasTarget(config) ?? descriptorFromUuid(config.targetUuid, config);
  const simpleAdvantage = Number(config.mainRoll?.advantage ?? 0);
  const metadata = {
    mode: TARGET_MODE_CONTROLLED,
    simpleTarget: initial,
    simpleAdvantage: Number.isFinite(simpleAdvantage) ? simpleAdvantage : 0,
    filters: { npcs: true, pcs: true },
    seesHidden: false,
    nextRowId: 2,
    randomTargets: [],
    randomSequence: [],
    rows: [{
      id: 1,
      target: initial,
      count: Math.max(1, Math.floor(Number(selected) || 1)),
      advantage: Number.isFinite(simpleAdvantage) ? simpleAdvantage : 0
    }]
  };
  config[TARGET_META_KEY] = metadata;
  synchronizePrimaryTarget(config);
  return metadata;
}

export function clearTargetMetadata(config) {
  if (config) delete config[TARGET_META_KEY];
}

export function setTargetAttackTotal(config, requested, maximum) {
  const metadata = config?.[TARGET_META_KEY];
  const limit = Math.max(1, Math.floor(Number(maximum) || 1));
  if (!metadata?.rows?.length || targetMode(metadata) !== TARGET_MODE_CONTROLLED) {
    return Math.min(limit, Math.max(1, Math.floor(Number(requested) || 1)));
  }
  const minimum = metadata.rows.length;
  const desired = Math.min(limit, Math.max(minimum, Math.floor(Number(requested) || minimum)));
  let difference = desired - rowTotal(metadata);

  if (difference > 0) metadata.rows[0].count += difference;
  while (difference < 0) {
    let changed = false;
    for (let index = metadata.rows.length - 1; index >= 0 && difference < 0; index -= 1) {
      const row = metadata.rows[index];
      if (row.count <= 1) continue;
      row.count -= 1;
      difference += 1;
      changed = true;
    }
    if (!changed) break;
  }
  return rowTotal(metadata);
}

export function resetTargetAttackRows(config, selected, maximum) {
  const metadata = config?.[TARGET_META_KEY];
  if (!metadata?.rows?.length) return;
  const limit = Math.max(1, Math.floor(Number(maximum) || 1));
  const count = Math.min(limit, Math.max(1, Math.floor(Number(selected) || 1)));
  if (targetMode(metadata) === TARGET_MODE_CONTROLLED) {
    metadata.rows = [{ ...metadata.rows[0], count }];
    synchronizePrimaryTarget(config);
  }
  else restoreSimpleTarget(config);
}

function attackSequence(metadata) {
  return metadata.rows.flatMap(row => Array.from({ length: row.count }, () => row));
}

export function applyTargetToAttackConfig(attackConfig, sessionConfig, relativeIndex) {
  const metadata = sessionConfig?.[TARGET_META_KEY];
  if (!metadata) return null;
  const mode = targetMode(metadata);
  let target = null;
  let advantage = sessionConfig.mainRoll?.advantage ?? metadata?.simpleAdvantage ?? 0;
  if (mode === TARGET_MODE_CONTROLLED && metadata.rows?.length) {
    const sequence = attackSequence(metadata);
    const row = sequence[Math.max(0, relativeIndex) % sequence.length] ?? null;
    target = row?.target ?? null;
    advantage = row?.advantage ?? advantage;
  }
  else if (mode === TARGET_MODE_RANDOM) {
    target = metadata?.randomSequence?.[Math.max(0, relativeIndex)] ?? null;
  }
  if (attackConfig.mainRoll) attackConfig.mainRoll.advantage = Number(advantage ?? 0);
  if (target) {
    const current = descriptorFromUuid(target.uuid, sessionConfig) ?? target;
    attackConfig.targetUuid = current.uuid;
    if (attackConfig.mainRoll) {
      if (Number.isFinite(current.ac)) attackConfig.mainRoll.dc = current.ac;
      else delete attackConfig.mainRoll.dc;
    }
    return current;
  }
  delete attackConfig.targetUuid;
  if (attackConfig.mainRoll) delete attackConfig.mainRoll.dc;
  return null;
}

export function randomTargetPool(config) {
  reconcileTargetPool(config);
  return Array.from(config?.[TARGET_META_KEY]?.randomTargets ?? []);
}

export function setRandomTargetSequence(config, targets) {
  const metadata = config?.[TARGET_META_KEY];
  if (!metadata) return;
  metadata.randomSequence = Array.from(targets ?? []);
}

export function addRandomTarget(config, value) {
  const metadata = config?.[TARGET_META_KEY];
  if (!metadata) return false;
  const supplied = value?.uuid && value?.actorUuid ? value : targetDescriptor(value);
  const target = visibleSceneTargets(config).find(candidate => candidate.uuid === supplied?.uuid) ?? null;
  if (!target || target.actorUuid === config.actorUuid) return false;
  metadata.randomTargets ??= [];
  if (metadata.randomTargets.some(candidate => candidate.uuid === target.uuid)) return false;
  metadata.randomTargets.push(target);
  return true;
}

function targetAppearance(target) {
  const npc = target?.actorType === NPC_ACTOR_TYPE;
  const style = game.settings.get(MODULE_ID, npc ? NPC_FONT_STYLE_SETTING : PC_FONT_STYLE_SETTING);
  const color = game.settings.get(MODULE_ID, npc ? NPC_FONT_COLOR_SETTING : PC_FONT_COLOR_SETTING);
  const italic = style === "italic";
  const bold = style === "bold";
  return {
    fontStyle: italic ? "italic" : "normal",
    fontWeight: bold ? "700" : "400",
    color: /^#[0-9a-f]{6}$/i.test(color) ? color : ""
  };
}

function applyTargetAppearance(element, target) {
  const appearance = targetAppearance(target);
  element.style.fontStyle = appearance.fontStyle;
  element.style.fontWeight = appearance.fontWeight;
  element.style.color = appearance.color;
}

function selectedUuids(metadata, exceptRowId = null) {
  return new Set(metadata.rows
    .filter(row => row.id !== exceptRowId && row.target)
    .map(row => row.target.uuid));
}

export function addControlledCanvasTarget(config, value, maximum) {
  const metadata = config?.[TARGET_META_KEY];
  if (!metadata || targetMode(metadata) !== TARGET_MODE_CONTROLLED) {
    return { handled: false, changed: false, selected: false, total: 0 };
  }
  const supplied = value?.uuid && value?.actorUuid ? value : targetDescriptor(value);
  const target = visibleSceneTargets(config).find(candidate => candidate.uuid === supplied?.uuid) ?? null;
  if (!target || target.actorUuid === config.actorUuid || !matchesFilters(target, metadata.filters)) {
    return { handled: false, changed: false, selected: false, total: rowTotal(metadata) };
  }
  const limit = Math.max(1, Math.floor(Number(maximum) || 1));
  const existing = metadata.rows.find(row => row.target?.uuid === target.uuid);
  if (existing) {
    return { handled: true, changed: false, selected: true, total: rowTotal(metadata) };
  }
  else {
    const empty = metadata.rows.find(row => !row.target);
    if (empty) empty.target = target;
    else {
      if (rowTotal(metadata) >= limit) {
        return { handled: true, changed: false, selected: false, total: rowTotal(metadata) };
      }
      metadata.rows.push({
        id: metadata.nextRowId++,
        target,
        count: 1,
        advantage: metadata.simpleAdvantage
      });
    }
  }
  synchronizePrimaryTarget(config);
  return { handled: true, changed: true, selected: true, total: rowTotal(metadata) };
}

export function decreaseControlledCanvasTarget(config, value) {
  const metadata = config?.[TARGET_META_KEY];
  if (!metadata || targetMode(metadata) !== TARGET_MODE_CONTROLLED) {
    return { handled: false, changed: false, removed: false, total: 0 };
  }
  const target = value?.uuid && value?.actorUuid ? value : targetDescriptor(value);
  const row = metadata.rows.find(entry => entry.target?.uuid === target?.uuid);
  if (!row) return { handled: false, changed: false, removed: false, total: rowTotal(metadata) };
  let removed = false;
  if (row.count > 1) row.count -= 1;
  else if (metadata.rows.length > 1) {
    metadata.rows = metadata.rows.filter(entry => entry.id !== row.id);
    removed = true;
  }
  else {
    row.target = null;
    removed = true;
  }
  synchronizePrimaryTarget(config);
  return { handled: true, changed: true, removed, total: rowTotal(metadata) };
}

export function increaseControlledTargetAttacks(config, value, maximum) {
  const metadata = config?.[TARGET_META_KEY];
  if (!metadata || targetMode(metadata) !== TARGET_MODE_CONTROLLED) {
    return { handled: false, changed: false, total: 0 };
  }
  const target = value?.uuid && value?.actorUuid ? value : targetDescriptor(value);
  const row = metadata.rows.find(entry => entry.target?.uuid === target?.uuid);
  if (!row) return { handled: false, changed: false, total: rowTotal(metadata) };
  const limit = Math.max(1, Math.floor(Number(maximum) || 1));
  if (rowTotal(metadata) >= limit) {
    return { handled: true, changed: false, total: rowTotal(metadata) };
  }
  row.count += 1;
  synchronizePrimaryTarget(config);
  return { handled: true, changed: true, total: rowTotal(metadata) };
}

export function addOrIncreaseControlledTarget(config, value, maximum) {
  const metadata = config?.[TARGET_META_KEY];
  const target = value?.uuid && value?.actorUuid ? value : targetDescriptor(value);
  if (!metadata || !target || targetMode(metadata) !== TARGET_MODE_CONTROLLED) {
    return { handled: false, changed: false, total: metadata?.rows?.length ? rowTotal(metadata) : 0 };
  }
  const existing = metadata.rows.some(row => row.target?.uuid === target.uuid);
  return existing
    ? increaseControlledTargetAttacks(config, target, maximum)
    : addControlledCanvasTarget(config, target, maximum);
}

function hoveredCanvasToken() {
  if (!globalThis.canvas?.ready) return null;
  return canvas.activeLayer?.hover ?? canvas.tokens?.hover ?? null;
}

function adjustHoveredSelectTarget(direction) {
  const token = hoveredCanvasToken();
  if (!token) return false;
  let handled = false;
  for (const entry of Array.from(activeTargetSelectors)) {
    if (entry.section.isConnected === false) {
      activeTargetSelectors.delete(entry);
      continue;
    }
    if (targetMode(entry.config) !== TARGET_MODE_CONTROLLED) continue;
    const before = rowTotal(entry.config[TARGET_META_KEY]);
    const result = direction > 0
      ? increaseControlledTargetAttacks(entry.config, token, entry.section._gtNpcMultiattackMaximum)
      : decreaseControlledCanvasTarget(entry.config, token);
    if (!result.handled) continue;
    handled = true;
    if (result.total !== before) entry.section._gtNpcMultiattackOnQuantityChange(result.total);
    if (result.changed) renderTargetSelector(entry.section, entry.config);
  }
  return handled;
}

export function registerTargetSelectorKeybindings() {
  game.keybindings.register(MODULE_ID, "increaseSelectAttacks", {
    name: L("GTNPCMULTIATTACK.Keybindings.IncreaseSelectAttacks"),
    hint: L("GTNPCMULTIATTACK.Keybindings.IncreaseSelectAttacksHint"),
    editable: [{ key: "Period", modifiers: ["Shift"] }],
    onDown: () => adjustHoveredSelectTarget(1)
  });
  game.keybindings.register(MODULE_ID, "decreaseSelectAttacks", {
    name: L("GTNPCMULTIATTACK.Keybindings.DecreaseSelectAttacks"),
    hint: L("GTNPCMULTIATTACK.Keybindings.DecreaseSelectAttacksHint"),
    editable: [{ key: "Comma", modifiers: ["Shift"] }],
    onDown: () => adjustHoveredSelectTarget(-1)
  });
}

function populateTargetSelect(select, row, metadata, config) {
  const excluded = selectedUuids(metadata, row.id);
  select.replaceChildren();

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = L("GTNPCMULTIATTACK.Targets.SelectTarget");
  placeholder.style.color = "#777777";
  placeholder.style.fontStyle = "italic";
  placeholder.style.fontWeight = "400";
  select.append(placeholder);

  const options = visibleSceneTargets(config);
  for (const target of options) {
    if (excluded.has(target.uuid)) continue;
    if (target.uuid !== row.target?.uuid && !matchesFilters(target, metadata.filters)) continue;
    const option = document.createElement("option");
    option.value = target.uuid;
    option.textContent = target.name;
    option.selected = target.uuid === row.target?.uuid;
    applyTargetAppearance(option, target);
    select.append(option);
  }
  select.value = row.target?.uuid ?? "";
  select.classList.toggle("is-placeholder", !select.value);
  if (row.target) applyTargetAppearance(select, row.target);
  else {
    select.style.color = "";
    select.style.fontStyle = "";
    select.style.fontWeight = "";
  }
}

function populateRandomTargetSelect(select, metadata, config) {
  const selected = new Set((metadata.randomTargets ?? []).map(target => target.uuid));
  select.replaceChildren();
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = L("GTNPCMULTIATTACK.Targets.SelectTarget");
  placeholder.selected = true;
  select.append(placeholder);
  for (const target of visibleSceneTargets(config)) {
    if (selected.has(target.uuid)) continue;
    const option = document.createElement("option");
    option.value = target.uuid;
    option.textContent = target.name;
    applyTargetAppearance(option, target);
    select.append(option);
  }
  select.value = "";
}

function renderRandomTargetPool(panel, config) {
  const metadata = config[TARGET_META_KEY];
  const select = panel.querySelector(".gt-npc-ma-random-add");
  const pool = panel.querySelector(".gt-npc-ma-random-pool");
  populateRandomTargetSelect(select, metadata, config);
  pool.replaceChildren();
  for (const [index, target] of (metadata.randomTargets ?? []).entries()) {
    const chip = document.createElement("div");
    chip.className = "gt-npc-ma-random-target";
    chip.dataset.targetUuid = target.uuid;
    chip.dataset.tooltip = L("GTNPCMULTIATTACK.Random.RemoveTarget");
    const image = document.createElement("img");
    image.src = target.img;
    image.alt = "";
    const name = document.createElement("span");
    name.textContent = `${index + 1}. ${target.name}`;
    applyTargetAppearance(name, target);
    chip.append(image, name);
    chip.addEventListener("contextmenu", event => {
      event.preventDefault();
      metadata.randomTargets = metadata.randomTargets.filter(entry => entry.uuid !== target.uuid);
      renderRandomTargetPool(panel, config);
    });
    pool.append(chip);
  }
  if (!metadata.randomTargets?.length) {
    const empty = document.createElement("p");
    empty.className = "gt-npc-ma-random-empty";
    empty.textContent = L("GTNPCMULTIATTACK.Random.EmptyPool");
    pool.append(empty);
  }
}

function renderTargetSelector(section, config, maximum = null) {
  if (maximum !== null) {
    section._gtNpcMultiattackMaximum = Math.max(1, Math.floor(Number(maximum) || 1));
  }
  const limit = section._gtNpcMultiattackMaximum;
  reconcileTargetPool(config);
  const metadata = config[TARGET_META_KEY];
  const rows = section.querySelector(".gt-npc-ma-target-rows");
  const controlledPanel = section.querySelector(".gt-npc-ma-target-controlled");
  const randomPanel = section.querySelector(".gt-npc-ma-random-panel");
  const random = section.querySelector('[data-action="target-random"]');
  const add = section.querySelector('[data-action="add-target-row"]');
  const onQuantityChange = section._gtNpcMultiattackOnQuantityChange;
  const total = rowTotal(metadata);
  const mode = targetMode(metadata);

  random.checked = mode === TARGET_MODE_RANDOM;
  controlledPanel.hidden = mode !== TARGET_MODE_CONTROLLED;
  randomPanel.hidden = mode !== TARGET_MODE_RANDOM;
  rows.replaceChildren();

  if (mode === TARGET_MODE_CONTROLLED) {
    for (const [index, row] of metadata.rows.entries()) {
      const wrapper = document.createElement("div");
      wrapper.className = "gt-npc-ma-target-row";
      wrapper.dataset.rowId = String(row.id);
      if (index > 0) wrapper.classList.add("has-remove");

      const select = document.createElement("select");
      select.setAttribute("aria-label", L("GTNPCMULTIATTACK.Targets.Choose"));
      populateTargetSelect(select, row, metadata, config);
      select.addEventListener("change", () => {
        row.target = descriptorFromUuid(select.value, config);
        synchronizePrimaryTarget(config);
        renderTargetSelector(section, config);
      });

      const rollMode = document.createElement("select");
      rollMode.className = "gt-npc-ma-target-roll-mode";
      rollMode.setAttribute("aria-label", L("GTNPCMULTIATTACK.Targets.RollMode"));
      for (const [value, labelKey] of [
        ["1", "GTNPCMULTIATTACK.Targets.AdvantageAbbreviation"],
        ["0", "GTNPCMULTIATTACK.Targets.NormalAbbreviation"],
        ["-1", "GTNPCMULTIATTACK.Targets.DisadvantageAbbreviation"]
      ]) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = L(labelKey);
        option.selected = Number(value) === Number(row.advantage ?? 0);
        rollMode.append(option);
      }
      rollMode.value = String(Number(row.advantage ?? 0));
      rollMode.addEventListener("change", () => {
        row.advantage = Number.parseInt(rollMode.value, 10);
      });

      const decrease = document.createElement("button");
      decrease.type = "button";
      decrease.dataset.action = "decrease-target-attacks";
      decrease.dataset.tooltip = L("GTNPCMULTIATTACK.Targets.DecreaseAttacks");
      decrease.setAttribute("aria-label", decrease.dataset.tooltip);
      decrease.innerHTML = '<i class="fas fa-minus" aria-hidden="true"></i>';
      decrease.disabled = !row.target;
      decrease.addEventListener("click", () => {
        if (!row.target) return;
        const before = rowTotal(metadata);
        const result = decreaseControlledCanvasTarget(config, row.target);
        if (result.total !== before) onQuantityChange(result.total);
        renderTargetSelector(section, config);
      });

      const count = document.createElement("output");
      count.className = "gt-npc-ma-target-count";
      count.textContent = String(row.count);
      count.setAttribute("aria-label", L("GTNPCMULTIATTACK.Targets.AttacksForTarget"));

      const increase = document.createElement("button");
      increase.type = "button";
      increase.dataset.action = "increase-target-attacks";
      increase.dataset.tooltip = L("GTNPCMULTIATTACK.Targets.IncreaseAttacks");
      increase.setAttribute("aria-label", increase.dataset.tooltip);
      increase.innerHTML = '<i class="fas fa-plus" aria-hidden="true"></i>';
      increase.disabled = total >= limit;
      increase.addEventListener("click", () => {
        if (rowTotal(metadata) >= limit) return;
        row.count += 1;
        onQuantityChange(rowTotal(metadata));
        renderTargetSelector(section, config);
      });

      wrapper.append(select, rollMode, decrease, count, increase);
      if (index > 0) {
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "gt-npc-ma-target-remove";
        remove.dataset.tooltip = L("GTNPCMULTIATTACK.Targets.Remove");
        remove.setAttribute("aria-label", remove.dataset.tooltip);
        remove.innerHTML = '<i class="fas fa-xmark" aria-hidden="true"></i>';
        remove.addEventListener("click", () => {
          metadata.rows = metadata.rows.filter(entry => entry.id !== row.id);
          synchronizePrimaryTarget(config);
          onQuantityChange(rowTotal(metadata));
          renderTargetSelector(section, config);
        });
        wrapper.append(remove);
      }
      else {
        const spacer = document.createElement("span");
        spacer.className = "gt-npc-ma-target-remove-spacer";
        spacer.setAttribute("aria-hidden", "true");
        wrapper.append(spacer);
      }
      rows.append(wrapper);
    }
  }

  add.disabled = total >= limit;
  if (mode === TARGET_MODE_RANDOM) renderRandomTargetPool(randomPanel, config);
  if (section._gtNpcMultiattackYieldsMk) mirrorTargetsToCanvas(selectedTargetUuids(metadata));
}

/** The tokens the dialog currently names, whichever mode it is in. */
function selectedTargetUuids(metadata) {
  if (targetMode(metadata) === TARGET_MODE_RANDOM) {
    return (metadata.randomTargets ?? []).map(target => target.uuid);
  }
  return (metadata.rows ?? []).map(row => row.target?.uuid).filter(Boolean);
}

export function refreshTargetSelector(root, config, maximum) {
  const section = root?.querySelector?.(`.${TARGET_SELECTOR_CLASS}`);
  if (section) renderTargetSelector(section, config, maximum);
}

export function refreshOpenTargetSelectors() {
  for (const entry of Array.from(activeTargetSelectors)) {
    if (entry.section.isConnected === false) {
      activeTargetSelectors.delete(entry);
      continue;
    }
    renderTargetSelector(entry.section, entry.config);
  }
}

export function unregisterOpenTargetSelector(config) {
  for (const entry of Array.from(activeTargetSelectors)) {
    if (entry.config === config || entry.section.isConnected === false) {
      activeTargetSelectors.delete(entry);
    }
  }
}

function queueLiveTargetRefresh() {
  if (liveRefreshQueued) return;
  liveRefreshQueued = true;
  globalThis.setTimeout(() => {
    liveRefreshQueued = false;
    refreshOpenTargetSelectors();
  }, 0);
}

export function registerLiveTargetHooks() {
  if (liveHooksRegistered) return;
  liveHooksRegistered = true;
  registerTargetSelectorKeybindings();
  for (const hook of ["createToken", "updateToken", "deleteToken", "updateActor", "canvasReady"]) {
    Hooks.on(hook, queueLiveTargetRefresh);
  }
  Hooks.on("targetToken", (user, token, targeted) => {
    if (user !== game.user && user?.id !== game.user?.id) return;
    if (isMirroringTargets()) return;
    const hoveredUuid = tokenDocument(hoveredCanvasToken())?.uuid;
    let changed = false;
    for (const entry of activeTargetSelectors) {
      const mode = targetMode(entry.config);
      if (mode === TARGET_MODE_RANDOM && targeted) changed = addRandomTarget(entry.config, token) || changed;
      else if (mode === TARGET_MODE_CONTROLLED && tokenDocument(token)?.uuid === hoveredUuid) {
        const before = rowTotal(entry.config[TARGET_META_KEY]);
        const result = addOrIncreaseControlledTarget(
          entry.config,
          token,
          entry.section._gtNpcMultiattackMaximum
        );
        if (result.total !== before) entry.section._gtNpcMultiattackOnQuantityChange(result.total);
        changed = result.changed || changed;
      }
    }
    if (changed) queueLiveTargetRefresh();
  });
}

export function injectTargetSelector(root, config, maximum, insertionPoint, onQuantityChange) {
  if (!root) return null;
  const existing = root.querySelector(`.${TARGET_SELECTOR_CLASS}`);
  if (existing) return existing;
  const limit = Math.max(1, Math.floor(Number(maximum) || 1));
  const metadata = initializeTargetPool(config, 1);

  const section = document.createElement("section");
  section.className = TARGET_SELECTOR_CLASS;
  section._gtNpcMultiattackOnQuantityChange = onQuantityChange;
  section._gtNpcMultiattackMaximum = limit;

  const header = document.createElement("div");
  header.className = "gt-npc-ma-target-header";
  const heading = document.createElement("span");
  heading.textContent = L("GTNPCMULTIATTACK.Targets.Title");

  const headingGroup = document.createElement("div");
  headingGroup.className = "gt-npc-ma-target-heading-group";
  const seesHiddenLabel = document.createElement("label");
  seesHiddenLabel.className = "gt-npc-ma-sees-hidden";
  const seesHidden = document.createElement("input");
  seesHidden.type = "checkbox";
  seesHidden.checked = metadata.seesHidden === true;
  const seesHiddenText = document.createElement("span");
  seesHiddenText.textContent = L("GTNPCMULTIATTACK.Targets.SeesHidden");
  seesHidden.addEventListener("change", () => {
    metadata.seesHidden = seesHidden.checked;
    renderTargetSelector(section, config);
  });
  seesHiddenLabel.append(seesHidden, seesHiddenText);
  headingGroup.append(heading, seesHiddenLabel);

  const modes = document.createElement("div");
  modes.className = "gt-npc-ma-target-modes";
  const randomLabel = document.createElement("label");
  const randomText = document.createElement("span");
  randomText.textContent = L("GTNPCMULTIATTACK.Targets.Random");
  const random = document.createElement("input");
  random.type = "checkbox";
  random.dataset.action = "target-random";
  randomLabel.append(randomText, random);
  modes.append(randomLabel);

  const changeMode = mode => {
    const currentLimit = section._gtNpcMultiattackMaximum;
    const checkedAdvantage = Number.parseInt(
      root.querySelector('input[name="advantage"]:checked')?.value ?? metadata.simpleAdvantage,
      10
    );
    metadata.simpleTarget = latestCanvasTarget(config)
      ?? descriptorFromUuid(config.targetUuid, config)
      ?? metadata.simpleTarget;
    metadata.simpleAdvantage = Number.isFinite(checkedAdvantage) ? checkedAdvantage : 0;
    setTargetMode(metadata, mode);
    if (mode === TARGET_MODE_CONTROLLED) {
      const total = Math.min(currentLimit, Math.max(1, rowTotal(metadata)));
      metadata.rows[0] = {
        ...metadata.rows[0],
        target: metadata.rows[0]?.target ?? metadata.simpleTarget,
        advantage: metadata.rows[0]?.advantage ?? metadata.simpleAdvantage
      };
      setTargetAttackTotal(config, total, currentLimit);
      synchronizePrimaryTarget(config);
      onQuantityChange(rowTotal(metadata));
    }
    else {
      restoreSimpleTarget(config);
      if (config.mainRoll) config.mainRoll.advantage = metadata.simpleAdvantage;
      if (mode === TARGET_MODE_RANDOM) {
        for (const target of currentCanvasTargets(config)) addRandomTarget(config, target);
      }
    }
    renderTargetSelector(section, config);
  };
  random.addEventListener("change", () => {
    changeMode(random.checked ? TARGET_MODE_RANDOM : TARGET_MODE_CONTROLLED);
  });
  header.append(headingGroup, modes);

  const rows = document.createElement("div");
  rows.className = "gt-npc-ma-target-rows";

  const controlledPanel = document.createElement("div");
  controlledPanel.className = "gt-npc-ma-target-expanded gt-npc-ma-target-controlled";
  const filters = document.createElement("div");
  filters.className = "gt-npc-ma-target-filters";
  for (const [key, labelKey] of [
    ["npcs", "GTNPCMULTIATTACK.Targets.ShowNPCs"],
    ["pcs", "GTNPCMULTIATTACK.Targets.ShowPCs"]
  ]) {
    const label = document.createElement("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = metadata.filters[key];
    checkbox.addEventListener("change", () => {
      metadata.filters[key] = checkbox.checked;
      renderTargetSelector(section, config);
    });
    label.append(checkbox, document.createTextNode(L(labelKey)));
    filters.append(label);
  }

  const add = document.createElement("button");
  add.type = "button";
  add.className = "gt-npc-ma-target-add-row";
  add.dataset.action = "add-target-row";
  add.dataset.tooltip = L("GTNPCMULTIATTACK.Targets.Add");
  add.setAttribute("aria-label", add.dataset.tooltip);
  add.innerHTML = '<i class="fas fa-plus" aria-hidden="true"></i>';
  add.addEventListener("click", () => {
    const currentLimit = section._gtNpcMultiattackMaximum;
    if (rowTotal(metadata) >= currentLimit) return;
    metadata.rows.push({
      id: metadata.nextRowId++,
      target: null,
      count: 1,
      advantage: metadata.simpleAdvantage
    });
    onQuantityChange(rowTotal(metadata));
    renderTargetSelector(section, config);
  });
  controlledPanel.append(filters, rows, add);

  const randomPanel = document.createElement("div");
  randomPanel.className = "gt-npc-ma-random-panel";
  const randomSelect = document.createElement("select");
  randomSelect.className = "gt-npc-ma-random-add";
  randomSelect.setAttribute("aria-label", L("GTNPCMULTIATTACK.Random.AddTarget"));
  randomSelect.addEventListener("change", () => {
    if (randomSelect.value) addRandomTarget(config, descriptorFromUuid(randomSelect.value, config));
    renderRandomTargetPool(randomPanel, config);
  });
  const randomPool = document.createElement("div");
  randomPool.className = "gt-npc-ma-random-pool";
  randomPool.dataset.tooltip = L("GTNPCMULTIATTACK.Random.PoolHint");
  randomPool.addEventListener("click", event => {
    if (event.target.closest?.(".gt-npc-ma-random-target")) return;
    if (typeof randomSelect.showPicker === "function") randomSelect.showPicker();
    else randomSelect.focus();
  });
  randomPanel.append(randomSelect, randomPool);

  section.append(header, controlledPanel, randomPanel);
  insertionPoint.insertAdjacentElement("afterend", section);
  section._gtNpcMultiattackYieldsMk = yieldToMkTargeting(root);
  activeTargetSelectors.add({ section, config });
  renderTargetSelector(section, config, limit);
  return section;
}

export const targetSelectorTestApi = Object.freeze({
  addControlledCanvasTarget,
  addOrIncreaseControlledTarget,
  addRandomTarget,
  applyTargetToAttackConfig,
  latestCanvasTarget,
  randomTargetPool,
  reconcileTargetPool,
  decreaseControlledCanvasTarget,
  increaseControlledTargetAttacks,
  rowTotal,
  setRandomTargetSequence,
  targetMode,
  targetAppearance,
  targetDescriptor,
  visibleSceneTargets
});
