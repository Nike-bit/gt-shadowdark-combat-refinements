import { TOOLTIP_HOVER_DELAY_SETTING } from "./tooltip-hover.mjs";
import { L, MODULE_ID, htmlRoot } from "./lib/dom.mjs";

const TARGET_SELECTOR_SETTING = "enableTargetSelector";
const NPC_FONT_STYLE_SETTING = "npcTargetFontStyle";
const NPC_FONT_COLOR_SETTING = "npcTargetFontColor";
const PC_FONT_STYLE_SETTING = "pcTargetFontStyle";
const PC_FONT_COLOR_SETTING = "pcTargetFontColor";
const CUSTOM_RULES_SETTING = "enableCustomAttackRules";
const SAVE_RESOLUTION_SETTING = "saveResolution";
const PRESET_LIBRARY_MENU = "presetLibrary";
const QUICK_ATTACK_SETTING = "enableQuickAttackButton";
const QUICK_SPELL_SETTING = "enableQuickSpellButton";
const QUICK_ABILITY_SETTING = "enableQuickAbilityButton";
const QUICK_ATTRIBUTE_SETTING = "enableQuickAttributeButton";
const TINT_ATTACK_MESSAGES_SETTING = "tintMultiattackMessages";
const TINT_SPELL_MESSAGES_SETTING = "tintSpellMessages";
const ENABLE_MISHAPS_SETTING = "enableAutomaticSpellMishaps";
const MISHAP_CONFIGURATION_MENU = "spellMishapConfiguration";
const ATTACK_MESSAGE_COLOR_SETTINGS = Object.freeze([
  "attackMessageMissColor",
  "attackMessageCriticalFailureColor",
  "attackMessageSuccessColor",
  "attackMessageCriticalSuccessColor"
]);
const SPELL_MESSAGE_COLOR_SETTINGS = Object.freeze([
  "spellMessageCriticalSuccessColor",
  "spellMessageSuccessColor",
  "spellMessageFailureColor",
  "spellMessageCriticalFailureColor"
]);

export function normalizeHex(value) {
  const match = String(value ?? "").trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!match) return null;
  const digits = match[1].length === 3
    ? match[1].split("").map(character => character.repeat(2)).join("")
    : match[1];
  return `#${digits.toLowerCase()}`;
}

function settingInput(root, key) {
  return root.querySelector(`[name="${MODULE_ID}.${key}"]`);
}

function controlsConfigClass() {
  return globalThis.foundry?.applications?.sidebar?.apps?.ControlsConfig
    ?? globalThis.KeybindingsConfig
    ?? null;
}

export function openTargetKeybindingsConfig() {
  const ControlsConfig = controlsConfigClass();
  if (!ControlsConfig) {
    console.error(`${MODULE_ID} | Foundry's controls configuration application is unavailable.`);
    return null;
  }
  const application = new ControlsConfig();
  if (ControlsConfig.DEFAULT_OPTIONS) application.render({ force: true });
  else application.render(true);
  return application;
}

function injectTargetKeybindingsSetting(targetGroup) {
  const root = targetGroup.parentElement;
  const existing = root?.querySelector(".gt-npc-ma-keybindings-setting");
  if (existing) return existing;

  const group = document.createElement("div");
  group.className = "form-group gt-npc-ma-keybindings-setting";

  const label = document.createElement("label");
  label.textContent = L("GTNPCMULTIATTACK.Settings.TargetKeybindings");

  const fields = document.createElement("div");
  fields.className = "form-fields";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "gt-npc-ma-keybindings-button";
  const icon = document.createElement("i");
  icon.className = "fa-solid fa-keyboard";
  icon.setAttribute("aria-hidden", "true");
  const text = document.createElement("span");
  text.textContent = L("GTNPCMULTIATTACK.Settings.ConfigureTargetKeybindings");
  button.append(icon, text);
  button.addEventListener("click", event => {
    event.preventDefault();
    openTargetKeybindingsConfig();
  });
  fields.append(button);

  const hint = document.createElement("p");
  hint.className = "hint";
  hint.textContent = L("GTNPCMULTIATTACK.Settings.TargetKeybindingsHint");
  group.append(label, fields, hint);
  targetGroup.insertAdjacentElement("afterend", group);
  return group;
}

function createColorControl(colorInput) {
  const initial = normalizeHex(colorInput.value) ?? "#000000";
  colorInput.type = "text";
  colorInput.classList.add("gt-npc-ma-color-text");
  colorInput.value = initial;

  const control = document.createElement("div");
  control.className = "gt-npc-ma-color-control";

  const nativeColor = document.createElement("input");
  nativeColor.type = "color";
  nativeColor.className = "gt-npc-ma-native-color";
  nativeColor.setAttribute("aria-label", colorInput.getAttribute("aria-label") ?? colorInput.name);

  let current = initial;

  function commit(value) {
    const normalized = normalizeHex(value);
    if (!normalized) return false;
    current = normalized;
    colorInput.value = normalized;
    colorInput.setCustomValidity("");
    nativeColor.value = normalized;
    return true;
  }

  colorInput.addEventListener("input", () => {
    if (commit(colorInput.value)) return;
    else colorInput.setCustomValidity(L("GTNPCMULTIATTACK.Settings.InvalidColor"));
  });
  colorInput.addEventListener("change", () => {
    colorInput.value = current;
    colorInput.setCustomValidity("");
  });
  nativeColor.addEventListener("input", () => {
    commit(nativeColor.value);
  });

  control.append(colorInput, nativeColor);
  commit(initial);
  return control;
}

function buildFontRow(root, actorType) {
  const pc = actorType === "pc";
  const styleKey = pc ? PC_FONT_STYLE_SETTING : NPC_FONT_STYLE_SETTING;
  const colorKey = pc ? PC_FONT_COLOR_SETTING : NPC_FONT_COLOR_SETTING;
  const styleInput = settingInput(root, styleKey);
  const colorInput = settingInput(root, colorKey);
  if (!styleInput || !colorInput) return null;

  const styleGroup = styleInput.closest(".form-group");
  const colorGroup = colorInput.closest(".form-group");
  const group = document.createElement("div");
  group.className = "form-group gt-npc-ma-font-row";

  const label = document.createElement("label");
  label.textContent = L(pc
    ? "GTNPCMULTIATTACK.Settings.PcTargetFont"
    : "GTNPCMULTIATTACK.Settings.NpcTargetFont");

  const fields = document.createElement("div");
  fields.className = "form-fields gt-npc-ma-font-fields";
  styleInput.classList.add("gt-npc-ma-font-style");
  fields.append(styleInput, createColorControl(colorInput));

  const hint = document.createElement("p");
  hint.className = "hint gt-npc-ma-font-hint";
  hint.textContent = L(pc
    ? "GTNPCMULTIATTACK.Settings.PcTargetFontStyleHint"
    : "GTNPCMULTIATTACK.Settings.NpcTargetFontStyleHint");

  group.append(label, fields, hint);
  styleGroup?.remove();
  if (colorGroup !== styleGroup) colorGroup?.remove();
  return group;
}

export function enhanceSettingsConfig(_application, html) {
  const root = htmlRoot(html);
  if (!root) return;
  enhanceCustomRuleSettings(root);
  enhanceQuickSpellSettings(root);
  enhanceMessageColorSettings(root, {
    toggleSetting: TINT_ATTACK_MESSAGES_SETTING,
    colorSettings: ATTACK_MESSAGE_COLOR_SETTINGS,
    containerClass: "gt-npc-ma-attack-message-colors",
    rowClass: "gt-npc-ma-attack-message-color"
  });
  enhanceMessageColorSettings(root, {
    toggleSetting: TINT_SPELL_MESSAGES_SETTING,
    colorSettings: SPELL_MESSAGE_COLOR_SETTINGS,
    containerClass: "gt-npc-ma-spell-message-colors",
    rowClass: "gt-npc-ma-spell-message-color"
  });
  enhanceSpellMishapMenu(root);
  const targetToggle = settingInput(root, TARGET_SELECTOR_SETTING);
  const targetGroup = targetToggle?.closest(".form-group");
  if (!targetToggle || !targetGroup) return;
  const keybindingsGroup = injectTargetKeybindingsSetting(targetGroup);
  if (root.querySelector(".gt-npc-ma-font-settings")) return;

  const pcRow = buildFontRow(root, "pc");
  const npcRow = buildFontRow(root, "npc");
  if (!pcRow || !npcRow) return;

  const container = document.createElement("section");
  container.className = "gt-npc-ma-font-settings";
  container.append(pcRow, npcRow);
  (keybindingsGroup ?? targetGroup).insertAdjacentElement("afterend", container);

  const updateVisibility = () => {
    container.hidden = !targetToggle.checked;
  };
  targetToggle.addEventListener("change", updateVisibility);
  updateVisibility();
}

/**
 * Group the four result-colour rows under their tint toggle and hide them while
 * the toggle is off. Used for both the attack/attribute and spellcasting sets.
 */
function enhanceMessageColorSettings(root, { toggleSetting, colorSettings, containerClass, rowClass }) {
  if (root.querySelector(`.${containerClass}`)) return;
  const toggle = settingInput(root, toggleSetting);
  const toggleGroup = toggle?.closest(".form-group");
  if (!toggle || !toggleGroup) return;

  const groups = colorSettings.map(key => {
    const input = settingInput(root, key);
    const group = input?.closest(".form-group");
    const fields = group?.querySelector(".form-fields");
    if (!input || !group || !fields) return null;
    fields.replaceChildren(createColorControl(input));
    group.classList.add(rowClass);
    return group;
  });
  if (groups.some(group => !group)) return;

  const container = document.createElement("section");
  container.className = containerClass;
  container.append(...groups);
  toggleGroup.insertAdjacentElement("afterend", container);
  const updateVisibility = () => { container.hidden = !toggle.checked; };
  toggle.addEventListener("change", updateVisibility);
  updateVisibility();
}

function enhanceQuickSpellSettings(root) {
  const toggles = [QUICK_ATTACK_SETTING, QUICK_SPELL_SETTING, QUICK_ABILITY_SETTING]
    .map(key => settingInput(root, key))
    .filter(Boolean);
  const toggle = settingInput(root, QUICK_SPELL_SETTING);
  const delay = settingInput(root, TOOLTIP_HOVER_DELAY_SETTING);
  const toggleGroup = toggle?.closest(".form-group");
  const delayGroup = delay?.closest(".form-group");
  if (!toggle || !delay || !toggleGroup || !delayGroup) return;
  delayGroup.classList.add("gt-npc-ma-tooltip-hover-setting");
  const lastToggleGroup = settingInput(root, QUICK_ATTRIBUTE_SETTING)?.closest(".form-group")
    ?? settingInput(root, QUICK_ABILITY_SETTING)?.closest(".form-group")
    ?? toggleGroup;
  lastToggleGroup.insertAdjacentElement("afterend", delayGroup);
  const updateVisibility = () => { delayGroup.hidden = !toggles.some(input => input.checked); };
  for (const input of toggles) input.addEventListener("change", updateVisibility);
  updateVisibility();
}

/**
 * Locate a registered settings submenu's form group. Core has moved the
 * identifying attribute between releases, so try each known form before falling
 * back to matching the menu's localized label.
 */
function settingsMenuGroup(root, menuKey, labelKey) {
  for (const attribute of ["data-key", "data-setting-id", "name", "data-action"]) {
    const element = root.querySelector(`[${attribute}="${MODULE_ID}.${menuKey}"]`);
    const group = element?.closest(".form-group");
    if (group) return group;
  }
  const label = L(labelKey);
  return Array.from(root.querySelectorAll(".form-group")).find(group =>
    group.querySelector("label")?.textContent?.trim() === label
    || group.textContent?.includes(label)
  ) ?? null;
}

function presetLibraryGroup(root) {
  return settingsMenuGroup(root, PRESET_LIBRARY_MENU, "GTNPCMULTIATTACK.Presets.LibraryName");
}

function spellMishapMenuGroup(root) {
  return settingsMenuGroup(root, MISHAP_CONFIGURATION_MENU, "GTNPCMULTIATTACK.Mishaps.ConfigurationName");
}

function enhanceSpellMishapMenu(root) {
  const toggle = settingInput(root, ENABLE_MISHAPS_SETTING);
  const toggleGroup = toggle?.closest(".form-group");
  const menuGroup = spellMishapMenuGroup(root);
  if (!toggle || !toggleGroup || !menuGroup) return;
  menuGroup.classList.add("gt-npc-ma-mishap-menu-setting");
  toggleGroup.insertAdjacentElement("afterend", menuGroup);
}

function enhanceCustomRuleSettings(root) {
  if (root.querySelector(".gt-npc-ma-preset-library-setting")) return;
  const toggle = settingInput(root, CUSTOM_RULES_SETTING);
  const toggleGroup = toggle?.closest(".form-group");
  const libraryGroup = presetLibraryGroup(root);
  if (!toggle || !toggleGroup || !libraryGroup) return;
  libraryGroup.classList.add("gt-npc-ma-preset-library-setting");
  toggleGroup.insertAdjacentElement("afterend", libraryGroup);
  // The save-resolution choice only matters while rules can ask for saves.
  const saveGroup = settingInput(root, SAVE_RESOLUTION_SETTING)?.closest(".form-group") ?? null;
  if (saveGroup) {
    saveGroup.classList.add("gt-npc-ma-save-resolution-setting");
    libraryGroup.insertAdjacentElement("afterend", saveGroup);
  }
  const updateVisibility = () => {
    libraryGroup.hidden = !toggle.checked;
    if (saveGroup) saveGroup.hidden = !toggle.checked;
  };
  toggle.addEventListener("change", updateVisibility);
  updateVisibility();
}

export const settingsUiTestApi = Object.freeze({
  normalizeHex,
  openTargetKeybindingsConfig,
  spellMishapMenuGroup
});
