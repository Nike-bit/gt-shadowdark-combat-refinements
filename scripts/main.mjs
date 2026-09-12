import {
  applyTargetToAttackConfig,
  clearTargetMetadata,
  initializeTargetPool,
  injectTargetSelector,
  registerLiveTargetHooks,
  refreshTargetSelector,
  resetTargetAttackRows,
  randomTargetPool,
  setRandomTargetSequence,
  setTargetAttackTotal,
  targetMode,
  TARGET_MODE_RANDOM,
  unregisterOpenTargetSelector
} from "./target-selector.mjs";
import { drawRandomTargets, postRandomTargetSummary } from "./random-targeting.mjs";
import { injectChatRerollModes } from "./chat-reroll-mode.mjs";
import {
  beginCustomRuleBatch,
  clearCustomRuleMetadata,
  evaluateCustomRules,
  hasActiveCustomRules,
  activeManualAttackLimit,
  initializeCustomRuleSession,
  injectCustomRuleItemEditor,
  injectManualRuleControls,
  linkCustomRuleAttack,
  prepareCustomRuleAttack,
  recordCustomRuleResult,
  setManualRuleActive
} from "./custom-attack-rules.mjs";
import { registerSwallowSystem } from "./swallow-system.mjs";
import { enhanceSettingsConfig } from "./settings-ui.mjs";
import { registerPresetLibrary } from "./preset-library.mjs";
import { injectQuickAttackLauncher } from "./token-attack-launcher.mjs";
import { injectPlayerSpellFavorites, injectQuickSpellLauncher } from "./token-spell-launcher.mjs";
import { injectQuickAbilityLauncher } from "./token-ability-launcher.mjs";
import {
  injectQuickAttributeLauncher,
  QUICK_ATTRIBUTE_SETTING
} from "./token-attribute-launcher.mjs";
import { injectAttributeDifficulty, prepareAttributeCheck } from "./attribute-checks.mjs";
import {
  bridgeAttackChatMetadata,
  CHAT_META_KEY,
  injectAttackChatPresentation
} from "./chat-attack-presentation.mjs";
import {
  registerSpellMishapHooks,
  registerSpellMishapSettings
} from "./spell-mishaps.mjs";
import { registerSpellMishapConfiguration } from "./spell-mishap-configuration.mjs";
import { TOOLTIP_HOVER_DELAY_SETTING } from "./tooltip-hover.mjs";
import {
  injectPlayerRollTargeting,
  PLAYER_ATTACK_TARGETING_SETTING,
  registerPlayerTargetingHooks,
  SPELL_TARGETING_SETTING
} from "./player-targeting.mjs";
import { F, L, MODULE_ID, htmlRoot, resolveUuidSync } from "./lib/dom.mjs";
import { migrateLegacyModuleId, registerMigration } from "./migration.mjs";
import { registerMkTargetingSetting } from "./mk-targeting-bridge.mjs";
import { registerDeathTimerBridgeHooks } from "./mk-death-timer-bridge.mjs";
import { registerSaveRequestHooks, registerSaveResolutionSetting } from "./save-requests.mjs";
import { registerSheetFavoriteSpellHooks, registerSheetFavoritesSetting } from "./sheet-favorite-spells.mjs";

const SHADOWDARK_SYSTEM_ID = "shadowdark";
const NPC_ACTOR_TYPE = "NPC";
const NPC_ATTACK_TYPE = "NPC Attack";
const CONTROL_CLASS = "gt-npc-ma-counter";
const META_KEY = "gtNpcMultiattack";
const AUTOCOUNTER_SETTING = "enableAttackAutocounter";
const DEFAULT_QUANTITY_SETTING = "defaultChosenAttacks";
const TARGET_SELECTOR_SETTING = "enableTargetSelector";
const QUICK_ATTACK_SETTING = "enableQuickAttackButton";
const QUICK_SPELL_SETTING = "enableQuickSpellButton";
const QUICK_ABILITY_SETTING = "enableQuickAbilityButton";
const QUICK_SPELL_VIEW_MEMORY_SETTING = "quickSpellViewMemory";
const CHAT_REROLL_SETTING = "enableChatRerollModes";
const SINGLE_COMPARISON_REROLL_SETTING = "enableSingleRollComparisonRerolls";
const NUMBER_ATTACK_MESSAGES_SETTING = "numberMultiattackMessages";
const TINT_ATTACK_MESSAGES_SETTING = "tintMultiattackMessages";
const TINT_SPELL_MESSAGES_SETTING = "tintSpellMessages";
const SPELL_SUCCESS_COLOR_SETTING = "spellMessageSuccessColor";
const DEFAULT_SPELL_SUCCESS_COLOR = "#4DA2C7";
const CUSTOM_RULES_SETTING = "enableCustomAttackRules";
const NPC_TARGET_FONT_STYLE_SETTING = "npcTargetFontStyle";
const NPC_TARGET_FONT_COLOR_SETTING = "npcTargetFontColor";
const PC_TARGET_FONT_STYLE_SETTING = "pcTargetFontStyle";
const PC_TARGET_FONT_COLOR_SETTING = "pcTargetFontColor";
const DEFAULT_ONE = "one";
const DEFAULT_ALL = "all";

function registerSettings() {
  game.settings.register(MODULE_ID, AUTOCOUNTER_SETTING, {
    name: L("GTNPCMULTIATTACK.Settings.EnableAttackAutocounter"),
    hint: L("GTNPCMULTIATTACK.Settings.EnableAttackAutocounterHint"),
    scope: "client",
    config: true,
    type: Boolean,
    default: true
  });
  game.settings.register(MODULE_ID, DEFAULT_QUANTITY_SETTING, {
    name: L("GTNPCMULTIATTACK.Settings.DefaultChosenAttacks"),
    hint: L("GTNPCMULTIATTACK.Settings.DefaultChosenAttacksHint"),
    scope: "client",
    config: true,
    type: String,
    choices: {
      [DEFAULT_ONE]: "1",
      [DEFAULT_ALL]: L("GTNPCMULTIATTACK.Settings.All")
    },
    default: DEFAULT_ONE
  });
  game.settings.register(MODULE_ID, TARGET_SELECTOR_SETTING, {
    name: L("GTNPCMULTIATTACK.Settings.EnableTargetSelector"),
    hint: L("GTNPCMULTIATTACK.Settings.EnableTargetSelectorHint"),
    scope: "client",
    config: true,
    type: Boolean,
    default: true
  });
  game.settings.register(MODULE_ID, PLAYER_ATTACK_TARGETING_SETTING, {
    name: L("GTNPCMULTIATTACK.Settings.EnablePlayerAttackTargeting"),
    hint: L("GTNPCMULTIATTACK.Settings.EnablePlayerAttackTargetingHint"),
    scope: "client",
    config: true,
    type: Boolean,
    default: true
  });
  game.settings.register(MODULE_ID, SPELL_TARGETING_SETTING, {
    name: L("GTNPCMULTIATTACK.Settings.EnableSpellTargeting"),
    hint: L("GTNPCMULTIATTACK.Settings.EnableSpellTargetingHint"),
    scope: "client",
    config: true,
    type: Boolean,
    default: true
  });
  game.settings.register(MODULE_ID, QUICK_ATTACK_SETTING, {
    name: L("GTNPCMULTIATTACK.Settings.EnableQuickAttackButton"),
    hint: L("GTNPCMULTIATTACK.Settings.EnableQuickAttackButtonHint"),
    scope: "client",
    config: true,
    type: Boolean,
    default: true
  });
  game.settings.register(MODULE_ID, QUICK_SPELL_SETTING, {
    name: L("GTNPCMULTIATTACK.Settings.EnableQuickSpellButton"),
    hint: L("GTNPCMULTIATTACK.Settings.EnableQuickSpellButtonHint"),
    scope: "client",
    config: true,
    type: Boolean,
    default: true
  });
  game.settings.register(MODULE_ID, QUICK_ABILITY_SETTING, {
    name: L("GTNPCMULTIATTACK.Settings.EnableQuickAbilityButton"),
    hint: L("GTNPCMULTIATTACK.Settings.EnableQuickAbilityButtonHint"),
    scope: "client",
    config: true,
    type: Boolean,
    default: true
  });
  game.settings.register(MODULE_ID, QUICK_ATTRIBUTE_SETTING, {
    name: L("GTNPCMULTIATTACK.Settings.EnableQuickAttributeButton"),
    hint: L("GTNPCMULTIATTACK.Settings.EnableQuickAttributeButtonHint"),
    scope: "client",
    config: true,
    type: Boolean,
    default: true
  });
  game.settings.register(MODULE_ID, TOOLTIP_HOVER_DELAY_SETTING, {
    name: L("GTNPCMULTIATTACK.Settings.TooltipHoverDelay"),
    hint: L("GTNPCMULTIATTACK.Settings.TooltipHoverDelayHint"),
    scope: "client",
    config: true,
    type: Number,
    default: 0.5,
    range: { min: 0, max: 10, step: 0.5 }
  });
  game.settings.register(MODULE_ID, CHAT_REROLL_SETTING, {
    name: L("GTNPCMULTIATTACK.Settings.EnableChatRerollModes"),
    hint: L("GTNPCMULTIATTACK.Settings.EnableChatRerollModesHint"),
    scope: "client",
    config: true,
    type: Boolean,
    default: true
  });
  game.settings.register(MODULE_ID, SINGLE_COMPARISON_REROLL_SETTING, {
    name: L("GTNPCMULTIATTACK.Settings.EnableSingleRollComparisonRerolls"),
    hint: L("GTNPCMULTIATTACK.Settings.EnableSingleRollComparisonRerollsHint"),
    scope: "client",
    config: true,
    type: Boolean,
    default: true
  });
  game.settings.register(MODULE_ID, NUMBER_ATTACK_MESSAGES_SETTING, {
    name: L("GTNPCMULTIATTACK.Settings.NumberMultiattackMessages"),
    hint: L("GTNPCMULTIATTACK.Settings.NumberMultiattackMessagesHint"),
    scope: "client",
    config: true,
    type: Boolean,
    default: true
  });
  game.settings.register(MODULE_ID, TINT_ATTACK_MESSAGES_SETTING, {
    name: L("GTNPCMULTIATTACK.Settings.TintMultiattackMessages"),
    hint: L("GTNPCMULTIATTACK.Settings.TintMultiattackMessagesHint"),
    scope: "client",
    config: true,
    type: Boolean,
    default: true
  });
  for (const [key, nameKey, defaultValue] of [
    ["attackMessageMissColor", "GTNPCMULTIATTACK.Settings.AttackMessageMissColor", "#d6b82c"],
    ["attackMessageCriticalFailureColor", "GTNPCMULTIATTACK.Settings.AttackMessageCriticalFailureColor", "#c62828"],
    ["attackMessageSuccessColor", "GTNPCMULTIATTACK.Settings.AttackMessageSuccessColor", "#3f9b4f"],
    ["attackMessageCriticalSuccessColor", "GTNPCMULTIATTACK.Settings.AttackMessageCriticalSuccessColor", "#66d43f"]
  ]) {
    game.settings.register(MODULE_ID, key, {
      name: L(nameKey),
      hint: L("GTNPCMULTIATTACK.Settings.AttackMessageColorHint"),
      scope: "client",
      config: true,
      type: String,
      default: defaultValue
    });
  }
  game.settings.register(MODULE_ID, TINT_SPELL_MESSAGES_SETTING, {
    name: L("GTNPCMULTIATTACK.Settings.EnableSpellMessageColors"),
    hint: L("GTNPCMULTIATTACK.Settings.EnableSpellMessageColorsHint"),
    scope: "client",
    config: true,
    type: Boolean,
    default: true
  });
  for (const [key, nameKey, defaultValue] of [
    ["spellMessageCriticalSuccessColor", "GTNPCMULTIATTACK.Settings.SpellMessageCriticalSuccessColor", "#49E5DD"],
    [SPELL_SUCCESS_COLOR_SETTING, "GTNPCMULTIATTACK.Settings.SpellMessageSuccessColor", DEFAULT_SPELL_SUCCESS_COLOR],
    ["spellMessageFailureColor", "GTNPCMULTIATTACK.Settings.SpellMessageFailureColor", "#442C4C"],
    ["spellMessageCriticalFailureColor", "GTNPCMULTIATTACK.Settings.SpellMessageCriticalFailureColor", "#660033"]
  ]) {
    game.settings.register(MODULE_ID, key, {
      name: L(nameKey),
      hint: L("GTNPCMULTIATTACK.Settings.SpellMessageColorHint"),
      scope: "client",
      config: true,
      type: String,
      default: defaultValue
    });
  }
  game.settings.register(MODULE_ID, CUSTOM_RULES_SETTING, {
    name: L("GTNPCMULTIATTACK.Settings.EnableCustomAttackRules"),
    hint: L("GTNPCMULTIATTACK.Settings.EnableCustomAttackRulesHint"),
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });
  for (const [key, nameKey, hintKey, defaultValue] of [
    [NPC_TARGET_FONT_STYLE_SETTING, "GTNPCMULTIATTACK.Settings.NpcTargetFontStyle", "GTNPCMULTIATTACK.Settings.NpcTargetFontStyleHint", "bold"],
    [PC_TARGET_FONT_STYLE_SETTING, "GTNPCMULTIATTACK.Settings.PcTargetFontStyle", "GTNPCMULTIATTACK.Settings.PcTargetFontStyleHint", "italic"]
  ]) {
    game.settings.register(MODULE_ID, key, {
      name: L(nameKey),
      hint: L(hintKey),
      scope: "client",
      config: true,
      type: String,
      choices: {
        regular: L("GTNPCMULTIATTACK.Settings.Regular"),
        bold: L("GTNPCMULTIATTACK.Settings.Bold"),
        italic: L("GTNPCMULTIATTACK.Settings.Italic")
      },
      default: defaultValue
    });
  }
  for (const [key, nameKey, hintKey, defaultValue] of [
    [NPC_TARGET_FONT_COLOR_SETTING, "GTNPCMULTIATTACK.Settings.NpcTargetFontColor", "GTNPCMULTIATTACK.Settings.NpcTargetFontColorHint", "#d4a373"],
    [PC_TARGET_FONT_COLOR_SETTING, "GTNPCMULTIATTACK.Settings.PcTargetFontColor", "GTNPCMULTIATTACK.Settings.PcTargetFontColorHint", "#8ecae6"]
  ]) {
    game.settings.register(MODULE_ID, key, {
      name: L(nameKey),
      hint: L(hintKey),
      scope: "client",
      config: true,
      type: String,
      default: defaultValue
    });
  }
  registerMkTargetingSetting();
  registerSaveResolutionSetting();
  registerSheetFavoritesSetting();
  registerMigration();
  registerPresetLibrary();
  registerSpellMishapSettings();
  registerSpellMishapConfiguration();
  game.settings.register(MODULE_ID, QUICK_SPELL_VIEW_MEMORY_SETTING, {
    scope: "client",
    config: false,
    type: Object,
    default: {}
  });
}

function isAutocounterEnabled() {
  return game.settings.get(MODULE_ID, AUTOCOUNTER_SETTING);
}

function defaultQuantity() {
  return game.settings.get(MODULE_ID, DEFAULT_QUANTITY_SETTING) === DEFAULT_ALL
    ? DEFAULT_ALL
    : DEFAULT_ONE;
}

function isTargetSelectorEnabled() {
  return game.settings.get(MODULE_ID, TARGET_SELECTOR_SETTING);
}

function areCustomRulesEnabled() {
  return game.settings.get(MODULE_ID, CUSTOM_RULES_SETTING);
}

function clampSelected(value, maximum) {
  const max = Math.max(1, Math.floor(Number(maximum) || 1));
  const numeric = value === "" || value === null || value === undefined ? max : Number(value);
  const selected = Number.isFinite(numeric) ? Math.floor(numeric) : max;
  return Math.min(max, Math.max(1, selected));
}

function getNativeNpcAttack(config) {
  if (!config?.itemUuid) return null;
  const item = resolveUuidSync(config.itemUuid);
  const actor = item?.parent;
  if (item?.type !== NPC_ATTACK_TYPE || actor?.type !== NPC_ACTOR_TYPE) return null;
  const maximum = Math.floor(Number(item.system?.attack?.num));
  if (!Number.isFinite(maximum) || maximum < 1) return null;
  return { item, actor, maximum };
}

function initializeCounter(config, maximum) {
  if (config[META_KEY]) return;
  const max = Math.max(1, Math.floor(Number(maximum) || 1));
  config[META_KEY] = {
    initialMaximum: max,
    maximum: max,
    selected: defaultQuantity() === DEFAULT_ALL ? max : 1,
    spent: 0,
    rolling: false
  };
}

function clearMetadata(config) {
  if (config) delete config[META_KEY];
  clearTargetMetadata(config);
  clearCustomRuleMetadata(config);
}

function updateControl(control, config, selected, { synchronizeTargets = true } = {}) {
  const metadata = config[META_KEY];
  const maximum = Math.max(1, Math.floor(Number(metadata?.maximum) || 1));
  let value = clampSelected(selected, maximum);
  if (synchronizeTargets) value = setTargetAttackTotal(config, value, maximum);
  metadata.selected = value;

  const input = control.querySelector("input");
  const output = control.querySelector("output");
  const decrease = control.querySelector('[data-action="decrease"]');
  const increase = control.querySelector('[data-action="increase"]');
  input.value = String(value);
  output.textContent = `${value}/${maximum}`;
  control.dataset.tooltip = F("GTNPCMULTIATTACK.AttackQuantityHint", { selected: value, maximum });
  control.setAttribute("aria-label", control.dataset.tooltip);
  decrease.disabled = value <= 1;
  increase.disabled = value >= maximum;
  if (synchronizeTargets) {
    refreshTargetSelector(control.closest?.("form") ?? control.parentElement, config, maximum);
  }
}

function consumeAttacks(metadata, count, quantityDefault = DEFAULT_ONE) {
  const maximum = Math.max(1, Math.floor(Number(metadata?.maximum) || 1));
  const consumed = clampSelected(count, maximum);
  const remaining = Math.max(0, maximum - consumed);
  metadata.maximum = remaining;
  metadata.selected = remaining > 0 && quantityDefault === DEFAULT_ONE ? 1 : remaining;
  metadata.spent = Math.max(0, Math.floor(Number(metadata.spent) || 0)) + consumed;
  return { consumed, remaining };
}

function syncFormula(formData, config, rollKey) {
  const formulaKey = `${rollKey}.formula`;
  const rollConfig = config?.[rollKey];
  if (formData[formulaKey] === undefined || !rollConfig) return;
  if (formData[formulaKey] !== rollConfig.formula) {
    rollConfig.modified = true;
    const replaced = game.i18n.format(
      "SHADOWDARK.roll.tooltip.formula_replaced",
      { formula: rollConfig.formula }
    );
    rollConfig.tooltips = rollConfig.tooltips ? `${replaced}, ${rollConfig.tooltips}` : replaced;
  }
  rollConfig.formula = formData[formulaKey];
}

function syncRollDialogConfig(form, config) {
  const formData = new foundry.applications.ux.FormDataExtended(form).object;
  syncFormula(formData, config, "mainRoll");
  syncFormula(formData, config, "damageRoll");

  if (formData.advantage !== undefined && config?.mainRoll) {
    config.mainRoll.advantage = Number.parseInt(formData.advantage, 10);
  }
  if (formData.ammunitionId !== undefined && config?.attack) {
    config.attack.selectedAmmunition = formData.ammunitionId;
  }
  if (formData.rollMode !== undefined) config.rollMode = formData.rollMode;
}

function setRollingState(form, control, rolling) {
  control.classList.toggle("is-rolling", rolling);
  const input = control.querySelector("input");
  const decrease = control.querySelector('[data-action="decrease"]');
  const increase = control.querySelector('[data-action="increase"]');
  if (rolling) {
    decrease.disabled = true;
    increase.disabled = true;
  }
  else {
    const selected = Number(input.value);
    const maximum = Number(input.max);
    decrease.disabled = selected <= 1;
    increase.disabled = selected >= maximum;
  }
  const rollButton = form.querySelector('button[type="submit"]');
  if (rollButton) rollButton.disabled = rolling;
  const targetSelector = form.querySelector(".gt-npc-ma-target-selector");
  if (targetSelector) targetSelector.inert = rolling;
}

async function handleAutocounterSubmit(event, application, control, config) {
  if (!isAutocounterEnabled()) return;
  event.preventDefault();
  event.stopImmediatePropagation();

  const metadata = config[META_KEY];
  if (!metadata || metadata.rolling) return;
  const form = event.currentTarget;
  const input = control.querySelector("input");
  updateControl(control, config, input.value);
  syncRollDialogConfig(form, config);

  metadata.rolling = true;
  setRollingState(form, control, true);
  try {
    const result = await executeSelectedAttacks(config);
    const completed = result.results.filter(value => value !== false).length;
    if (completed <= 0) return;

    const { remaining } = consumeAttacks(metadata, completed, defaultQuantity());
    if (remaining <= 0) {
      await application.close();
      return;
    }

    resetTargetAttackRows(config, metadata.selected, remaining);
    metadata.rolling = false;
    input.max = String(remaining);
    updateControl(control, config, metadata.selected, { synchronizeTargets: false });
    refreshTargetSelector(form, config, remaining);
    setRollingState(form, control, false);
  }
  catch (error) {
    ui.notifications.error(L("GTNPCMULTIATTACK.MultiAttackFailed"));
    console.error(`${MODULE_ID} | Multiattack execution failed.`, error);
  }
  finally {
    if (metadata.maximum > 0 && metadata.rolling) {
      metadata.rolling = false;
      setRollingState(form, control, false);
    }
  }
}

function injectControl(application, root, config) {
  const metadata = config?.[META_KEY];
  if (!metadata) return null;
  const existing = root.querySelector(`.${CONTROL_CLASS}`);
  if (existing) return existing;
  const mainKey = config.mainRoll?.key ?? "mainRoll.formula";
  const mainInput = root.querySelector(`input[name="${CSS.escape(mainKey)}"]`)
    ?? root.querySelector('input[name="mainRoll.formula"]');
  const rollInput = mainInput?.closest(".roll-input");
  if (!rollInput) {
    console.warn(`${MODULE_ID} | Shadowdark attack-roll input was not found; the selector was not injected.`);
    return null;
  }

  const control = document.createElement("div");
  control.className = CONTROL_CLASS;
  const label = document.createElement("span");
  label.className = "gt-npc-ma-counter-label";
  label.textContent = L("GTNPCMULTIATTACK.AttackQuantity");

  const decrease = document.createElement("button");
  decrease.type = "button";
  decrease.dataset.action = "decrease";
  decrease.dataset.tooltip = L("GTNPCMULTIATTACK.DecreaseAttackQuantity");
  decrease.setAttribute("aria-label", decrease.dataset.tooltip);
  decrease.innerHTML = '<i class="fas fa-minus" aria-hidden="true"></i>';

  const input = document.createElement("input");
  input.type = "number";
  input.name = "gtNpcMultiattackQuantity";
  input.min = "1";
  input.max = String(metadata.maximum);
  input.step = "1";
  input.className = "gt-npc-ma-counter-input";
  input.setAttribute("aria-label", L("GTNPCMULTIATTACK.SelectedAttacks"));

  const output = document.createElement("output");
  output.className = "gt-npc-ma-counter-output";
  output.setAttribute("aria-live", "polite");

  const increase = document.createElement("button");
  increase.type = "button";
  increase.dataset.action = "increase";
  increase.dataset.tooltip = L("GTNPCMULTIATTACK.IncreaseAttackQuantity");
  increase.setAttribute("aria-label", increase.dataset.tooltip);
  increase.innerHTML = '<i class="fas fa-plus" aria-hidden="true"></i>';

  control.append(label, decrease, input, output, increase);
  rollInput.insertAdjacentElement("afterend", control);
  updateControl(control, config, metadata.selected);

  decrease.addEventListener("click", () => updateControl(control, config, Number(input.value) - 1));
  increase.addEventListener("click", () => updateControl(control, config, Number(input.value) + 1));
  input.addEventListener("change", () => updateControl(control, config, input.value));
  input.addEventListener("input", () => {
    const numeric = Number(input.value);
    if (Number.isFinite(numeric)) metadata.selected = clampSelected(numeric, metadata.maximum);
  });
  const form = root.matches("form") ? root : root.querySelector("form") ?? root.closest("form");
  form?.addEventListener("submit", event => {
    if (isAutocounterEnabled()) {
      void handleAutocounterSubmit(event, application, control, config);
    }
    else {
      updateControl(control, config, input.value);
    }
  }, { capture: true });
  return control;
}

async function executePreparedAttack(config) {
  clearMetadata(config);
  if (!await Hooks.call("SD-NPC-Attack", config)) return false;
  return shadowdark.dice.rollFromConfig(config);
}

async function executeSelectedAttacks(config) {
  const metadata = config?.[META_KEY];
  if (!metadata) return { handled: false, count: 0, results: [] };
  const selected = clampSelected(metadata.selected, metadata.maximum);
  if (targetMode(config) === TARGET_MODE_RANDOM) {
    const pool = randomTargetPool(config);
    if (!pool.length) {
      ui.notifications.warn(L("GTNPCMULTIATTACK.Random.NoTargets"));
      return { handled: true, count: selected, results: [] };
    }
    const selection = await drawRandomTargets(pool, selected);
    setRandomTargetSequence(config, selection.assignments);
    await postRandomTargetSummary(config, selection);
  }
  const pristine = foundry.utils.deepClone(config);
  const results = [];
  const spentBeforeBatch = Math.max(0, Math.floor(Number(metadata.spent) || 0));
  const sessionTotal = spentBeforeBatch + Math.max(1, Math.floor(Number(metadata.maximum) || selected));
  const rulesActive = areCustomRulesEnabled() && hasActiveCustomRules(config);
  const batchId = rulesActive ? beginCustomRuleBatch(config) : 0;
  for (let index = 0; index < selected; index += 1) {
    const attackConfig = foundry.utils.deepClone(pristine);
    attackConfig[META_KEY].attackIndex = index + 1;
    attackConfig[META_KEY].selected = selected;
    const chatMetadata = {
      index: spentBeforeBatch + index + 1,
      total: sessionTotal
    };
    attackConfig[CHAT_META_KEY] = chatMetadata;
    attackConfig.mainRoll ??= {};
    attackConfig.mainRoll[CHAT_META_KEY] = chatMetadata;
    applyTargetToAttackConfig(attackConfig, pristine, index);
    if (rulesActive) linkCustomRuleAttack(config, attackConfig, batchId, index + 1);
    if (rulesActive) await prepareCustomRuleAttack(config, attackConfig, batchId, index + 1);
    const result = await executePreparedAttack(attackConfig);
    results.push(result);
    if (rulesActive) recordCustomRuleResult(config, attackConfig, result, batchId);
  }
  if (rulesActive) await evaluateCustomRules(config, batchId);
  setRandomTargetSequence(config, []);
  return { handled: true, count: selected, results };
}

function onRenderRollDialog(application, html) {
  const root = htmlRoot(html);
  const config = application?.config;
  if (!root || !config) return;

  injectAttributeDifficulty(application, root, config);
  injectPlayerRollTargeting(application, root, config);

  const resolved = getNativeNpcAttack(config);
  if (!resolved) return;
  if (areCustomRulesEnabled()) initializeCustomRuleSession(config, resolved.item);
  initializeCounter(config, resolved.maximum);
  const counter = resolved.maximum > 1 ? injectControl(application, root, config) : null;
  const mainKey = config.mainRoll?.key ?? "mainRoll.formula";
  const mainInput = root.querySelector(`input[name="${CSS.escape(mainKey)}"]`)
    ?? root.querySelector('input[name="mainRoll.formula"]');
  const rollInput = mainInput?.closest(".roll-input");
  const manualRules = areCustomRulesEnabled()
    ? injectManualRuleControls(root, config, (changedRule, checked, checkbox) => {
      const metadata = config[META_KEY];
      const nativeRemaining = Math.max(1, metadata.initialMaximum - metadata.spent);
      let limit = activeManualAttackLimit(config);
      if (checked && limit !== null && metadata.spent >= limit) {
        setManualRuleActive(config, changedRule.id, false);
        checkbox.checked = false;
        ui.notifications.warn(L("GTNPCMULTIATTACK.Rules.AttackLimitSpent"));
        limit = activeManualAttackLimit(config);
      }
      const limitedRemaining = limit === null ? nativeRemaining : Math.max(1, limit - metadata.spent);
      metadata.maximum = Math.min(nativeRemaining, limitedRemaining);
      metadata.selected = clampSelected(metadata.selected, metadata.maximum);
      if (counter) {
        const input = counter.querySelector("input");
        input.max = String(metadata.maximum);
        resetTargetAttackRows(config, metadata.selected, metadata.maximum);
        updateControl(counter, config, metadata.selected, { synchronizeTargets: false });
      }
      refreshTargetSelector(root, config, metadata.maximum);
    })
    : null;
  if (manualRules) (counter ?? rollInput)?.insertAdjacentElement("afterend", manualRules);
  if (isTargetSelectorEnabled()) {
    const insertionPoint = manualRules ?? counter ?? rollInput;
    if (!insertionPoint) return;
    initializeTargetPool(config, config[META_KEY].selected);
    injectTargetSelector(root, config, resolved.maximum, insertionPoint, quantity => {
      if (!counter) return;
      updateControl(counter, config, quantity, { synchronizeTargets: false });
    });
  }
}

function onRenderItemSheet(application, html) {
  if (!areCustomRulesEnabled()) return;
  const root = htmlRoot(html);
  const item = application?.item ?? application?.document ?? application?.object;
  if (!root || !item) return;
  if (item.type === NPC_ATTACK_TYPE) injectCustomRuleItemEditor(root, item);
}

function onNpcAttack(config) {
  if (!config?.[META_KEY]) return true;
  if (config[META_KEY].initialMaximum <= 1) {
    if (targetMode(config) === TARGET_MODE_RANDOM
      || (areCustomRulesEnabled() && hasActiveCustomRules(config))) {
      void executeSelectedAttacks(config).catch(error => {
        ui.notifications.error(L("GTNPCMULTIATTACK.MultiAttackFailed"));
        console.error(`${MODULE_ID} | Module-managed attack execution failed.`, error);
      });
      return false;
    }
    applyTargetToAttackConfig(config, config, 0);
    clearMetadata(config);
    return true;
  }
  if (isAutocounterEnabled()) return true;
  void executeSelectedAttacks(config).catch(error => {
    ui.notifications.error(L("GTNPCMULTIATTACK.MultiAttackFailed"));
    console.error(`${MODULE_ID} | Multiattack execution failed.`, error);
  });
  return false;
}

Hooks.once("init", () => {
  registerSettings();
  Hooks.on("renderSettingsConfig", enhanceSettingsConfig);
  if (game.system.id !== SHADOWDARK_SYSTEM_ID) return;
  registerSwallowSystem();
  registerDeathTimerBridgeHooks();
  registerSaveRequestHooks();
  registerSpellMishapHooks();
  registerLiveTargetHooks();
  registerPlayerTargetingHooks();
  Hooks.on("renderRollDialogSD", onRenderRollDialog);
  // ApplicationV2 sheets fire a hook per class in their inheritance chain, so
  // register both spellings. Every injector is idempotent, so a sheet that
  // fires both is harmless.
  Hooks.on("renderItemSheet", onRenderItemSheet);
  Hooks.on("renderItemSheetV2", onRenderItemSheet);
  Hooks.on("closeRollDialogSD", application => unregisterOpenTargetSelector(application?.config));
  Hooks.on("SD-NPC-Attack", onNpcAttack);
  Hooks.on("SD-Stat-Check", prepareAttributeCheck);
  Hooks.on("renderTokenHUD", (application, html) => {
    void injectQuickAttackLauncher(application, html).catch(error => {
      console.error(`${MODULE_ID} | Could not build the Quick Attack launcher.`, error);
    });
  });
  Hooks.on("renderTokenHUD", (application, html) => {
    void injectQuickSpellLauncher(application, html).catch(error => {
      console.error(`${MODULE_ID} | Could not build the Quick Spell launcher.`, error);
    });
  });
  Hooks.on("renderTokenHUD", injectQuickAbilityLauncher);
  Hooks.on("renderTokenHUD", injectQuickAttributeLauncher);
  Hooks.on("renderActorSheet", injectPlayerSpellFavorites);
  Hooks.on("renderActorSheetV2", injectPlayerSpellFavorites);
  registerSheetFavoriteSpellHooks();
  Hooks.on("preCreateChatMessage", bridgeAttackChatMetadata);
  Hooks.on("renderChatMessageHTML", injectChatRerollModes);
  Hooks.on("renderChatMessageHTML", injectAttackChatPresentation);
  console.log(`${MODULE_ID} | Registered GT Combat Refinements.`);
});

Hooks.once("ready", () => {
  if (game.system.id !== SHADOWDARK_SYSTEM_ID) {
    ui.notifications.warn(L("GTNPCMULTIATTACK.WrongSystem"));
    return;
  }
  void migrateLegacyModuleId().catch(error => {
    ui.notifications.error(L("GTNPCMULTIATTACK.Migration.Failed"));
    console.error(`${MODULE_ID} | Migration from the legacy module id failed.`, error);
  });
});

export const testApi = Object.freeze({
  clampSelected,
  consumeAttacks,
  getNativeNpcAttack,
  handleAutocounterSubmit,
  initializeCounter,
  executeSelectedAttacks
});
