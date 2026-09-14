import {
  buildAttackPreview,
  collectQuickAttacks,
  launchQuickAttack,
  prepareQuickAttackEntries
} from "./token-attack-launcher.mjs";
import {
  buildSpellPreview,
  collectQuickSpells,
  launchQuickSpell,
  quickSpellTiers,
  quickSpellsForSelection,
  rememberedQuickSpellView,
  rememberQuickSpellView,
  sourceLabel,
  toggleFavoriteSpellId
} from "./token-spell-launcher.mjs";
import { offersUnarmedAttack, rollUnarmedAttack, UNARMED_CONFIG_KEY, UNARMED_ENTRY_ID, unarmedEntry } from "./unarmed-attack.mjs";
import { clearPreview, schedulePreview } from "./lib/palette.mjs";
import { dialogSelectorsEnabled, rememberLaunch } from "./lib/quick-launch.mjs";
import { F, L, MODULE_ID, htmlRoot, resolveUuidSync } from "./lib/dom.mjs";
import { tooltipHoverDelayMs } from "./tooltip-hover.mjs";

// The roll dialog as the place to choose *what* rolls. An attack dialog gets
// rows of weapon buttons above the roll; a spell dialog gets the quick-spell
// palette as a left column. Choosing something else does not edit the open
// config — Shadowdark's rollAttack/castSpell hold the chosen Item in a closure
// and act on it after the roll (ammunition, lost spells, scrolls, wands) — it
// opens the system's own for the new choice and cancels this one once the new
// dialog is on screen. Every entry point that opens the system dialog (sheet,
// HUD, MK-Shadowdark's token icons) therefore gets the selectors for free.

const PLAYER_ACTOR_TYPE = "Player";
const NPC_ACTOR_TYPE = "NPC";
const ATTACK_SELECTOR_CLASS = "gt-npc-ma-attack-selector";
const SPELL_BROWSER_CLASS = "gt-npc-ma-spell-browser";
const SPELL_LAYOUT_CLASS = "gt-npc-ma-spell-browser-layout";
const SPELL_DIALOG_WIDTH = 760;
const RELAUNCH_WINDOW_MS = 4000;

let pendingRelaunch = null;
// Where the spell list was scrolled when a spell was picked; the relaunched
// dialog's list starts there instead of scrolling the pick into view.
let pendingListScroll = null;

function actorFromConfig(config) {
  const document = resolveUuidSync(config?.actorUuid, { warn: false });
  return document?.documentName === "Token" ? document.actor : document;
}

function ownedCombatant(actor) {
  return actor?.isOwner === true && [PLAYER_ACTOR_TYPE, NPC_ACTOR_TYPE].includes(actor.type);
}

/**
 * Open the system's dialog for another choice in place of this one. The new
 * dialog is launched first: every RollDialogSD shares one element id, so its
 * first render swaps the new element in where the old one stands — one paint,
 * no gap. The render hook then restores the position and retires the old
 * dialog (no closing animation), which resolves its roll as cancelled. Should
 * the launch never render, the old dialog simply stays open.
 */
async function relaunch(application, config, launch) {
  const position = application?.position ?? {};
  pendingRelaunch = {
    actorUuid: config?.actorUuid ?? null,
    previous: application ?? null,
    left: position.left,
    top: position.top,
    until: Date.now() + RELAUNCH_WINDOW_MS
  };
  return launch();
}

/**
 * Cancel the dialog a relaunch replaced. Closing it deregisters the shared
 * element id, so the replacement is registered again afterwards — otherwise
 * Foundry would no longer know the open dialog (Escape, window resizing).
 */
function retireReplacedDialog(previous, replacement) {
  if (!previous || previous === replacement) return;
  Promise.resolve()
    .then(() => previous.close?.({ animate: false }))
    .then(() => {
      const instances = globalThis.foundry?.applications?.instances;
      if (instances && replacement?.rendered && replacement.id) instances.set(replacement.id, replacement);
    })
    .catch(error => console.warn(`${MODULE_ID} | Could not retire the replaced roll dialog.`, error));
}

/** Called on every roll-dialog render: put a relaunched dialog back where it was. */
export function restoreRelaunchPosition(application, config) {
  const pending = pendingRelaunch;
  if (!pending) return false;
  pendingRelaunch = null;
  if (pending.until < Date.now() || pending.actorUuid !== config?.actorUuid) return false;
  if (Number.isFinite(pending.left) && Number.isFinite(pending.top)) {
    application?.setPosition?.({ left: pending.left, top: pending.top });
  }
  retireReplacedDialog(pending.previous, application);
  return true;
}

// --- Attack selector ---------------------------------------------------------

function attackEntries(actor) {
  const entries = collectQuickAttacks(actor);
  if (offersUnarmedAttack(actor)) entries.push(unarmedEntry(actor));
  return entries;
}

function isSelectedAttack(entry, config, actor) {
  if (entry.unarmed) return config?.[UNARMED_CONFIG_KEY] === true;
  if (config?.[UNARMED_CONFIG_KEY] === true) return false;
  if (entry.itemUuid !== config?.itemUuid) return false;
  if (actor.type === NPC_ACTOR_TYPE) return true;
  const type = config?.attack?.type ?? entry.attackType;
  return type === entry.attackType;
}

function attackStatistics(entry) {
  const modifier = String(entry.attackModifier ?? "").replace(/\s+/g, "");
  return [modifier, entry.damageFormula, entry.ranges.join("/")].filter(Boolean).join(" · ");
}

function attackChoiceElement(entry, selected) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "gt-npc-ma-attack-choice";
  button.classList.toggle("is-selected", selected);
  button.setAttribute("aria-pressed", String(selected));
  button.dataset.attackId = entry.id;
  const icon = entry.img ? document.createElement("img") : document.createElement("i");
  if (entry.img) {
    icon.src = entry.img;
    icon.alt = "";
  }
  else {
    icon.className = "fa-solid fa-hand-fist";
    icon.setAttribute("aria-hidden", "true");
  }
  const text = document.createElement("span");
  text.className = "gt-npc-ma-attack-choice-text";
  const name = document.createElement("strong");
  name.textContent = entry.name;
  const statistics = document.createElement("small");
  statistics.className = "gt-npc-ma-attack-choice-statistics";
  statistics.textContent = attackStatistics(entry);
  text.append(name, statistics);
  button.append(icon, text);
  return button;
}

async function launchAttackEntry(actor, entry, rollMode) {
  void rememberLaunch(actor.uuid, "attack", entry.id).catch(() => undefined);
  if (entry.unarmed) return rollUnarmedAttack(actor, { rollMode });
  if (entry.actorType === NPC_ACTOR_TYPE) return actor.system.rollAttack(entry.itemId, { rollMode });
  return actor.system.rollAttack(entry.itemUuid, { attack: { type: entry.attackType }, rollMode });
}

/**
 * Rows of attack buttons above the attack roll: Melee, then Ranged. Drawn at
 * once from the Items; the +bonus · damage figures fill in a moment later,
 * since Shadowdark's generator is asynchronous.
 */
export function injectAttackSelector(application, html, config) {
  const root = htmlRoot(html);
  if (!root || config?.type !== "attack" || !dialogSelectorsEnabled()) return null;
  const existing = root.querySelector(`.${ATTACK_SELECTOR_CLASS}`);
  if (existing) return existing;
  const actor = actorFromConfig(config);
  if (!ownedCombatant(actor)) return null;
  const entries = attackEntries(actor);
  if (entries.length < 2) return null;
  const anchor = root.querySelector(".roll-input");
  if (!anchor) return null;

  const section = document.createElement("section");
  section.className = ATTACK_SELECTOR_CLASS;
  section.setAttribute("aria-label", L("GTNPCMULTIATTACK.QuickAttack.Choose"));
  const buttons = new Map();
  for (const type of ["melee", "ranged"]) {
    const rowEntries = entries.filter(entry => entry.attackType === type);
    if (!rowEntries.length) continue;
    const row = document.createElement("div");
    row.className = `gt-npc-ma-attack-row is-${type}`;
    const label = document.createElement("span");
    label.className = "gt-npc-ma-attack-row-label";
    label.textContent = L(type === "ranged" ? "GTNPCMULTIATTACK.QuickAttack.Ranged" : "GTNPCMULTIATTACK.QuickAttack.Melee");
    const choices = document.createElement("div");
    choices.className = "gt-npc-ma-attack-choices";
    for (const entry of rowEntries) {
      const selected = isSelectedAttack(entry, config, actor);
      const button = attackChoiceElement(entry, selected);
      buttons.set(entry.id, button);
      button.addEventListener("mouseenter", () => {
        schedulePreview(section, tooltipHoverDelayMs(), () => buildAttackPreview(entry));
      });
      button.addEventListener("mouseleave", () => clearPreview(section));
      button.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        if (selected) return;
        clearPreview(section);
        void relaunch(application, config, () => launchAttackEntry(actor, entry, config.rollMode)).catch(error => {
          ui.notifications.error(L("GTNPCMULTIATTACK.QuickAttack.Failed"));
          console.error(`${MODULE_ID} | Switching the attack failed.`, error);
        });
      });
      choices.append(button);
    }
    row.append(label, choices);
    section.append(row);
  }
  anchor.insertAdjacentElement("beforebegin", section);

  void prepareQuickAttackEntries(actor, entries.filter(entry => !entry.unarmed)).then(() => {
    if (!section.isConnected) return;
    for (const entry of entries) {
      const statistics = buttons.get(entry.id)?.querySelector(".gt-npc-ma-attack-choice-statistics");
      if (statistics) statistics.textContent = attackStatistics(entry);
    }
  }).catch(error => {
    console.warn(`${MODULE_ID} | Could not prepare attack figures for the selector.`, error);
  });
  return section;
}

// --- Spell browser -----------------------------------------------------------

function isSelectedSpell(entry, config) {
  if (entry.spellUuid !== config?.cast?.spellUuid) return false;
  if (entry.actorType === NPC_ACTOR_TYPE) return true;
  return (config?.itemUuid ?? entry.spellUuid) === entry.itemUuid;
}

function spellChoiceElement(actor, entry, selected, { onSelect, onFavorite, browser }) {
  const row = document.createElement("div");
  row.className = "gt-npc-ma-spell-choice";
  row.classList.toggle("is-selected", selected);
  row.classList.toggle("is-unavailable", !entry.available);
  row.classList.toggle("is-favorite", entry.favorite === true);
  row.dataset.spellUuid = entry.spellUuid;

  const pick = document.createElement("a");
  pick.className = "gt-npc-ma-spell-choice-pick";
  pick.setAttribute("role", "button");
  pick.setAttribute("aria-pressed", String(selected));
  if (!entry.available) pick.setAttribute("aria-disabled", "true");
  const image = document.createElement("img");
  image.src = entry.img || "icons/svg/book.svg";
  image.alt = "";
  const text = document.createElement("span");
  const name = document.createElement("strong");
  name.textContent = entry.name;
  const details = document.createElement("small");
  details.textContent = [entry.subtext, sourceLabel(entry.source), entry.available ? "" : L("GTNPCMULTIATTACK.QuickSpell.Lost")]
    .filter(Boolean).join(" · ");
  text.append(name, details);
  pick.append(image, text);
  pick.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    onSelect(entry, { immediate: event.shiftKey });
  });
  pick.addEventListener("dblclick", event => {
    event.preventDefault();
    event.stopPropagation();
    onSelect(entry, { immediate: true });
  });
  row.append(pick);

  const actions = document.createElement("span");
  actions.className = "gt-npc-ma-spell-choice-actions";
  if (entry.requiresFocus && entry.available) {
    const focus = document.createElement("button");
    focus.type = "button";
    focus.dataset.tooltip = L("GTNPCMULTIATTACK.QuickSpell.Focus");
    focus.setAttribute("aria-label", focus.dataset.tooltip);
    focus.innerHTML = '<i class="fa-solid fa-brain" aria-hidden="true"></i>';
    focus.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      onSelect(entry, { focus: true });
    });
    actions.append(focus);
  }
  if (actor.type === PLAYER_ACTOR_TYPE) {
    const star = document.createElement("button");
    star.type = "button";
    star.className = "gt-npc-ma-quick-spell-favorite";
    star.classList.toggle("active", entry.favorite === true);
    star.dataset.tooltip = L(entry.favorite ? "GTNPCMULTIATTACK.QuickSpell.RemoveFavorite" : "GTNPCMULTIATTACK.QuickSpell.AddFavorite");
    star.setAttribute("aria-label", star.dataset.tooltip);
    star.innerHTML = `<i class="${entry.favorite ? "fa-solid" : "fa-regular"} fa-star" aria-hidden="true"></i>`;
    star.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      onFavorite(entry);
    });
    actions.append(star);
  }
  if (actions.childElementCount) row.append(actions);
  if (String(entry.description ?? "").trim()) {
    row.addEventListener("mouseenter", () => {
      schedulePreview(browser, tooltipHoverDelayMs(), () => buildSpellPreview(row, entry));
    });
    row.addEventListener("mouseleave", () => clearPreview(browser));
  }
  return row;
}

async function launchSpellEntry(actor, entry, config, { immediate = false, focus = false } = {}) {
  void rememberLaunch(actor.uuid, "spell", entry.id).catch(() => undefined);
  if (entry.actorType === NPC_ACTOR_TYPE) {
    return actor.system.castSpell(entry.spellUuid, { rollMode: config.rollMode, ...(immediate ? { skipPrompt: true } : {}) });
  }
  return launchQuickSpell(actor, entry, { skipPrompt: immediate, focus, rollMode: config.rollMode });
}

function takeListScroll(actorUuid) {
  const pending = pendingListScroll;
  if (!pending) return null;
  pendingListScroll = null;
  if (pending.until < Date.now() || pending.actorUuid !== actorUuid) return null;
  return Number.isFinite(pending.scrollTop) ? pending.scrollTop : null;
}

function fillSpellBrowser(browser, application, actor, config, entries) {
  browser.replaceChildren();
  const memoryKey = actor.uuid;
  const remembered = rememberedQuickSpellView(memoryKey);
  let activeView = remembered.view;
  const activeSources = new Set(remembered.sources);
  const tiers = quickSpellTiers(entries);
  const populatedTiers = new Set(entries.filter(entry => !["scroll", "wand"].includes(entry.source)).map(entry => Number(entry.tier)));
  const saveView = () => {
    void rememberQuickSpellView(memoryKey, activeView, activeSources).catch(error => {
      console.warn(`${MODULE_ID} | Could not remember the spell view.`, error);
    });
  };

  const tabs = document.createElement("div");
  tabs.className = "gt-npc-ma-spell-browser-tabs";
  tabs.setAttribute("role", "tablist");
  const sources = document.createElement("div");
  sources.className = "gt-npc-ma-spell-browser-sources";
  sources.setAttribute("role", "group");
  sources.setAttribute("aria-label", L("GTNPCMULTIATTACK.QuickSpell.FilterSource"));
  const list = document.createElement("div");
  list.className = "gt-npc-ma-spell-browser-list";
  list.addEventListener("scroll", () => clearPreview(browser));
  const empty = document.createElement("p");
  empty.className = "gt-npc-ma-spell-browser-empty";
  empty.textContent = L("GTNPCMULTIATTACK.QuickSpell.NoMatches");
  empty.hidden = true;
  browser.append(tabs, sources, list, empty);

  const onSelect = (entry, options = {}) => {
    if (!entry.available) {
      ui.notifications.warn(L("GTNPCMULTIATTACK.QuickSpell.Unavailable"));
      return;
    }
    if (isSelectedSpell(entry, config) && !options.immediate && !options.focus) return;
    clearPreview(browser);
    pendingListScroll = { actorUuid: actor.uuid, scrollTop: list.scrollTop, until: Date.now() + RELAUNCH_WINDOW_MS };
    void relaunch(application, config, () => launchSpellEntry(actor, entry, config, options)).catch(error => {
      ui.notifications.error(L("GTNPCMULTIATTACK.QuickSpell.Failed"));
      console.error(`${MODULE_ID} | Switching the spell failed.`, error);
    });
  };
  const onFavorite = entry => {
    void toggleFavoriteSpellId(actor, entry.id).then(active => {
      entry.favorite = active;
      renderList();
    }).catch(error => {
      ui.notifications.error(L("GTNPCMULTIATTACK.QuickSpell.FavoriteFailed"));
      console.error(`${MODULE_ID} | Could not update favorite spells.`, error);
    });
  };

  const renderList = () => {
    clearPreview(browser);
    // Favourites can change under us; keep them first.
    entries.sort((left, right) => Number(right.favorite) - Number(left.favorite)
      || Number(right.available) - Number(left.available)
      || left.tier - right.tier
      || left.name.localeCompare(right.name, game.i18n.lang));
    const visible = quickSpellsForSelection(entries, activeView, activeSources);
    list.replaceChildren();
    const appendSection = (headingText, sectionEntries, favorites = false) => {
      if (!sectionEntries.length) return;
      const section = document.createElement("section");
      section.className = "gt-npc-ma-spell-browser-section";
      if (favorites) section.classList.add("is-favorites");
      const heading = document.createElement("h4");
      heading.textContent = headingText;
      section.append(heading);
      for (const entry of sectionEntries) {
        section.append(spellChoiceElement(actor, entry, isSelectedSpell(entry, config), { onSelect, onFavorite, browser }));
      }
      list.append(section);
    };
    if (actor.type === PLAYER_ACTOR_TYPE) {
      appendSection(L("GTNPCMULTIATTACK.QuickSpell.Favorites"), visible.filter(entry => entry.favorite), true);
    }
    const rest = visible.filter(entry => actor.type !== PLAYER_ACTOR_TYPE || !entry.favorite);
    const known = rest.filter(entry => !["scroll", "wand"].includes(entry.source));
    const shownTiers = activeView === "all" ? tiers : [Number(activeView)];
    for (const tier of shownTiers) {
      appendSection(F("GTNPCMULTIATTACK.QuickSpell.Tier", { tier }), known.filter(entry => Number(entry.tier) === tier));
    }
    for (const sourceName of ["wand", "scroll"]) {
      if (!activeSources.has(sourceName)) continue;
      appendSection(sourceLabel(sourceName), rest.filter(entry => entry.source === sourceName));
    }
    empty.hidden = visible.length !== 0;
    for (const tab of tabs.querySelectorAll("button")) {
      const active = tab.dataset.view === activeView;
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-selected", String(active));
    }
    for (const tab of sources.querySelectorAll("button")) {
      const active = activeSources.has(tab.dataset.source);
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-pressed", String(active));
    }
    const carried = takeListScroll(actor.uuid);
    if (carried !== null) list.scrollTop = carried;
    else list.querySelector(".gt-npc-ma-spell-choice.is-selected")?.scrollIntoView?.({ block: "nearest" });
  };

  const addTab = (view, label, disabled = false) => {
    const tab = document.createElement("button");
    tab.type = "button";
    tab.dataset.view = view;
    tab.setAttribute("role", "tab");
    tab.textContent = label;
    tab.disabled = disabled;
    tab.addEventListener("click", () => {
      activeView = view;
      saveView();
      renderList();
    });
    tabs.append(tab);
  };
  addTab("all", L("GTNPCMULTIATTACK.Settings.All"));
  for (const tier of tiers) addTab(String(tier), String(tier), !populatedTiers.has(tier));
  for (const [sourceName, iconClass] of [["wand", "fa-solid fa-wand-magic-sparkles"], ["scroll", "fa-solid fa-scroll"]]) {
    const tab = document.createElement("button");
    tab.type = "button";
    tab.dataset.source = sourceName;
    tab.setAttribute("aria-pressed", "false");
    tab.disabled = !entries.some(entry => entry.source === sourceName);
    tab.innerHTML = `<i class="${iconClass}" aria-hidden="true"></i><span>${sourceLabel(sourceName)}</span>`;
    tab.addEventListener("click", () => {
      if (activeSources.has(sourceName)) activeSources.delete(sourceName);
      else activeSources.add(sourceName);
      saveView();
      renderList();
    });
    sources.append(tab);
  }
  // The spell in hand must be visible: if it came from a wand or scroll, show that source.
  const current = entries.find(entry => isSelectedSpell(entry, config));
  if (current && ["wand", "scroll"].includes(current.source) && !activeSources.has(current.source)) {
    activeSources.add(current.source);
  }
  renderList();
}

/** A "Focus casting" checkbox under the cast roll, only for focus-duration spells. */
function injectFocusToggle(root, config) {
  if (config?.cast?.duration?.type !== "focus" || root.querySelector(".gt-npc-ma-focus-toggle")) return null;
  const anchor = root.querySelector(".roll-input");
  if (!anchor) return null;
  const label = document.createElement("label");
  label.className = "gt-npc-ma-focus-toggle";
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = config.cast.focus === true;
  checkbox.addEventListener("change", () => { config.cast.focus = checkbox.checked; });
  const text = document.createElement("span");
  text.textContent = L("GTNPCMULTIATTACK.QuickSpell.Focus");
  label.append(checkbox, text);
  anchor.insertAdjacentElement("afterend", label);
  return label;
}

/**
 * The quick-spell palette as the dialog's left column: tier tabs, wand and
 * scroll filters, favourites first, hover previews, a scrolling list. The
 * spell being cast is highlighted; choosing another relaunches the dialog.
 */
export function injectSpellBrowser(application, html, config) {
  const root = htmlRoot(html);
  if (!root || config?.type !== "spell" || !dialogSelectorsEnabled()) return null;
  const actor = actorFromConfig(config);
  if (!ownedCombatant(actor)) return null;
  injectFocusToggle(root, config);
  const existing = root.querySelector(`.${SPELL_BROWSER_CLASS}`);
  if (existing) return existing;
  // The parts live inside .window-content; that is what becomes two columns.
  const form = root.querySelector?.(".window-content") ?? root;
  const browser = document.createElement("aside");
  browser.className = SPELL_BROWSER_CLASS;
  browser.setAttribute("aria-label", L("GTNPCMULTIATTACK.QuickSpell.Choose"));
  const loading = document.createElement("p");
  loading.className = "gt-npc-ma-spell-browser-empty";
  loading.textContent = "…";
  browser.append(loading);
  form.classList.add(SPELL_LAYOUT_CLASS);
  form.prepend(browser);
  const position = application?.position ?? {};
  if (!(Number(position.width) >= SPELL_DIALOG_WIDTH)) application?.setPosition?.({ width: SPELL_DIALOG_WIDTH });

  void collectQuickSpells(actor).then(entries => {
    if (!browser.isConnected) return;
    if (entries.length < 2) {
      browser.remove();
      form.classList.remove(SPELL_LAYOUT_CLASS);
      application?.setPosition?.({ width: 380 });
      return;
    }
    fillSpellBrowser(browser, application, actor, config, entries);
  }).catch(error => {
    console.error(`${MODULE_ID} | Could not build the spell browser.`, error);
  });
  return browser;
}

/** Everything the render hook needs from this module, in one call. */
export function injectRollDialogSelectors(application, html, config) {
  restoreRelaunchPosition(application, config);
  injectAttackSelector(application, html, config);
  injectSpellBrowser(application, html, config);
}

export const rollDialogSelectorTestApi = Object.freeze({
  relaunch,
  injectAttackSelector,
  injectSpellBrowser,
  isSelectedAttack,
  isSelectedSpell,
  restoreRelaunchPosition
});
