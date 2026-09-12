import { attributeLabel } from "./token-attribute-launcher.mjs";
import { SAVE_META_KEY } from "./ability-saves.mjs";
import { L, htmlRoot } from "./lib/dom.mjs";

export const ATTRIBUTE_CHECK_META_KEY = "gtNpcAttributeCheck";
export const DEFAULT_ATTRIBUTE_DIFFICULTY = 15;
export const ATTRIBUTE_DIFFICULTIES = Object.freeze([9, 12, 15, 18]);

function actorForConfig(config) {
  try {
    return config?.actorUuid && typeof fromUuidSync === "function"
      ? fromUuidSync(config.actorUuid)
      : null;
  }
  catch (_error) {
    return null;
  }
}

export function normalizeAttributeDifficulty(value, fallback = DEFAULT_ATTRIBUTE_DIFFICULTY) {
  const difficulty = Number(value);
  if (!Number.isFinite(difficulty) || difficulty < 1) return fallback;
  return Math.floor(difficulty);
}

const CHECK_ACTOR_TYPES = new Set(["Player", "NPC"]);

export function prepareAttributeCheck(config) {
  const actor = actorForConfig(config);
  const ability = String(config?.check?.stat ?? "").toLowerCase();
  if (config?.type !== "check" || !CHECK_ACTOR_TYPES.has(actor?.type)
    || !Array.from(CONFIG.SHADOWDARK?.ABILITY_KEYS ?? []).includes(ability)) return null;
  config.mainRoll ??= {};
  config.mainRoll.dc = normalizeAttributeDifficulty(config.mainRoll.dc);
  const metadata = {
    ability,
    label: attributeLabel(actor, ability),
    dc: config.mainRoll.dc
  };
  config[ATTRIBUTE_CHECK_META_KEY] = metadata;
  return metadata;
}

function commitDifficulty(input, config, { restore = false } = {}) {
  const difficulty = normalizeAttributeDifficulty(input.value, null);
  if (difficulty === null) {
    if (restore) input.value = String(config?.mainRoll?.dc ?? DEFAULT_ATTRIBUTE_DIFFICULTY);
    return false;
  }
  config.mainRoll ??= {};
  config.mainRoll.dc = difficulty;
  if (config[ATTRIBUTE_CHECK_META_KEY]) config[ATTRIBUTE_CHECK_META_KEY].dc = difficulty;
  input.value = String(difficulty);
  return true;
}

export function injectAttributeDifficulty(_application, html, config) {
  const root = htmlRoot(html);
  const metadata = prepareAttributeCheck(config);
  if (!root || !metadata) return null;
  const existing = root.querySelector(".gt-npc-ma-attribute-difficulty");
  if (existing) return existing;
  const mainInput = root.querySelector('input[name="mainRoll.formula"]');
  const rollInput = mainInput?.closest(".roll-input");
  if (!rollInput) return null;

  const row = document.createElement("div");
  row.className = "roll-input flexrow gt-npc-ma-attribute-difficulty";
  const label = document.createElement("label");
  label.textContent = L("GTNPCMULTIATTACK.AttributeCheck.Difficulty");
  const input = document.createElement("input");
  input.type = "number";
  input.name = "gtNpcAttributeDifficulty";
  input.min = "1";
  input.step = "1";
  input.value = String(metadata.dc);
  input.setAttribute("inputmode", "numeric");
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "none");
  input.setAttribute("aria-expanded", "false");
  input.setAttribute("aria-label", L("GTNPCMULTIATTACK.AttributeCheck.DifficultyHint"));
  const combobox = document.createElement("div");
  combobox.className = "gt-npc-ma-difficulty-combobox";
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "gt-npc-ma-difficulty-toggle";
  toggle.tabIndex = -1;
  toggle.setAttribute("aria-label", L("GTNPCMULTIATTACK.AttributeCheck.Difficulty"));
  toggle.setAttribute("aria-expanded", "false");
  toggle.innerHTML = '<i class="fa-solid fa-caret-down" aria-hidden="true"></i>';
  const list = document.createElement("div");
  list.className = "gt-npc-ma-difficulty-options";
  list.hidden = true;
  list.setAttribute("role", "listbox");
  for (const difficulty of ATTRIBUTE_DIFFICULTIES) {
    const option = document.createElement("button");
    option.type = "button";
    option.className = "gt-npc-ma-difficulty-option";
    option.dataset.value = String(difficulty);
    option.textContent = String(difficulty);
    option.setAttribute("role", "option");
    option.addEventListener("click", event => {
      event.preventDefault();
      input.value = String(difficulty);
      commitDifficulty(input, config, { restore: true });
      closeOptions();
      input.focus();
    });
    list.append(option);
  }
  combobox.append(input, toggle, list);
  row.append(label, combobox);
  rollInput.insertAdjacentElement("afterend", row);
  // A save requested by an attack rule has its DC fixed by that rule.
  if (config[SAVE_META_KEY]) {
    input.readOnly = true;
    toggle.disabled = true;
    row.classList.add("is-locked");
    return row;
  }

  function setOptionsOpen(open) {
    list.hidden = !open;
    input.setAttribute("aria-expanded", String(open));
    toggle.setAttribute("aria-expanded", String(open));
  }

  function closeOptions() {
    setOptionsOpen(false);
  }

  toggle.addEventListener("click", event => {
    event.preventDefault();
    setOptionsOpen(list.hidden);
  });
  combobox.addEventListener("focusout", event => {
    if (!combobox.contains(event.relatedTarget)) closeOptions();
  });

  input.addEventListener("input", () => commitDifficulty(input, config));
  input.addEventListener("change", () => commitDifficulty(input, config, { restore: true }));
  // Not `once`: a cancelled and resubmitted dialog must commit again.
  root.addEventListener("submit", () => commitDifficulty(input, config, { restore: true }), {
    capture: true
  });
  return row;
}

export const attributeCheckTestApi = Object.freeze({
  ATTRIBUTE_DIFFICULTIES,
  normalizeAttributeDifficulty,
  prepareAttributeCheck
});
