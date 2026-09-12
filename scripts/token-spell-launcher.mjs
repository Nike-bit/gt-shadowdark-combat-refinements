import {
  actorItem,
  documentFlag,
  enrichHTML,
  htmlRoot,
  itemList,
  L,
  F,
  MODULE_ID,
  resolveUuid
} from "./lib/dom.mjs";
import {
  clearPreview,
  closePalette,
  insertQuickButton,
  isPaletteOpen,
  QUICK_BUTTON_ORDER,
  schedulePalettePosition,
  schedulePreview,
  setPaletteOpen,
  togglePalette
} from "./lib/palette.mjs";
import { tooltipHoverDelayMs } from "./tooltip-hover.mjs";

const QUICK_SPELL_SETTING = "enableQuickSpellButton";
const NPC_ACTOR_TYPE = "NPC";
const PLAYER_ACTOR_TYPE = "Player";
const SPELL_TYPE = "Spell";
const BUTTON_CLASS = "gt-npc-ma-quick-spell";
const PALETTE_ID = "gtNpcMultiattackQuickSpell";
const PENDING_DATASET_KEY = "gtNpcMaQuickSpellPending";
const FAVORITES_FLAG = "favoriteSpells";
const VIEW_MEMORY_SETTING = "quickSpellViewMemory";
const PALETTE_RESTORE_WINDOW_MS = 3000;
const MAX_VIEW_MEMORY_ENTRIES = 250;
const paletteRestoreDeadlines = new WeakMap();
let quickSpellViewMemoryCache;
let quickSpellViewMemoryWrite = Promise.resolve();

export function favoriteSpellId(source, itemUuid, spellUuid) {
  if (!source || !itemUuid || !spellUuid) return null;
  return `${source}:${itemUuid}:${spellUuid}`;
}

function favoriteSpellIds(actor) {
  const stored = documentFlag(actor, FAVORITES_FLAG);
  return new Set(Array.isArray(stored) ? stored.filter(String) : []);
}

function spellEntry({ actorType, spell, itemUuid, source, available = true, favorites = new Set() }) {
  const tier = Math.max(0, Math.floor(Number(spell?.system?.tier) || 0));
  const id = favoriteSpellId(source, itemUuid, spell.uuid);
  return {
    id,
    actorType,
    spellUuid: spell.uuid,
    itemUuid,
    name: spell.name,
    img: spell.img,
    tier,
    source,
    description: String(spell.system?.description ?? ""),
    available: available && spell.system?.lost !== true,
    requiresFocus: spell.system?.duration?.type === "focus",
    favorite: actorType === PLAYER_ACTOR_TYPE && favorites.has(id)
  };
}

export async function collectQuickSpells(actor) {
  if (!actor?.isOwner || ![NPC_ACTOR_TYPE, PLAYER_ACTOR_TYPE].includes(actor.type)) return [];
  const entries = [];
  const favorites = actor.type === PLAYER_ACTOR_TYPE ? favoriteSpellIds(actor) : new Set();
  for (const item of itemList(actor)) {
    if (item.type !== SPELL_TYPE) continue;
    entries.push(spellEntry({
      actorType: actor.type,
      spell: item,
      itemUuid: item.uuid,
      source: actor.type === NPC_ACTOR_TYPE ? "npc" : "known",
      favorites
    }));
  }

  if (actor.type === PLAYER_ACTOR_TYPE) {
    for (const item of itemList(actor)) {
      if (item.system?.isWand && item.system?.isIdentified !== false) {
        for (const reference of item.system.spells ?? []) {
          const spell = await resolveUuid(reference.uuid);
          if (!spell) continue;
          entries.push(spellEntry({
            actorType: actor.type,
            spell,
            itemUuid: item.uuid,
            source: "wand",
            available: item.system.broken !== true && reference.lost !== true,
            favorites
          }));
        }
      }
      else if (item.system?.isScroll && item.system?.isIdentified !== false) {
        const spell = await resolveUuid(item.system.spellUuid);
        if (!spell) continue;
        entries.push(spellEntry({
          actorType: actor.type,
          spell,
          itemUuid: item.uuid,
          source: "scroll",
          favorites
        }));
      }
    }
  }

  const sourceOrder = { npc: 0, known: 0, wand: 1, scroll: 2 };
  return entries.sort((left, right) =>
    Number(right.favorite) - Number(left.favorite)
      || Number(right.available) - Number(left.available)
      || left.tier - right.tier
      || left.name.localeCompare(right.name, game.i18n.lang)
      || (sourceOrder[left.source] ?? 9) - (sourceOrder[right.source] ?? 9));
}

export function quickSpellTiers(entries = []) {
  const tiers = new Set([1, 2, 3, 4, 5]);
  for (const entry of entries) {
    if (["scroll", "wand"].includes(entry?.source)) continue;
    const tier = Number(entry?.tier);
    if (Number.isInteger(tier) && tier >= 0) tiers.add(tier);
  }
  return [...tiers].sort((left, right) => left - right);
}

export function quickSpellsForSelection(entries = [], view = "all", sources = []) {
  const selectedTier = Number(view);
  const showAllKnown = view === "all" || view === null || view === undefined;
  const selectedSources = new Set(sources);
  return entries.filter(entry => {
    if (entry?.favorite) return true;
    if (["scroll", "wand"].includes(entry?.source)) return selectedSources.has(entry.source);
    return showAllKnown || Number(entry?.tier) === selectedTier;
  });
}

export function normalizeQuickSpellView(value = {}) {
  const rawView = value?.view;
  const numericTier = Number(rawView);
  const view = rawView === "all" || !Number.isInteger(numericTier) || numericTier < 0
    ? "all"
    : String(numericTier);
  const sources = [...new Set(Array.isArray(value?.sources) ? value.sources : [])]
    .filter(source => ["scroll", "wand"].includes(source));
  return { view, sources };
}

export function quickSpellViewMemoryKey(application, actor) {
  return application?.object?.document?.uuid
    ?? application?.object?.uuid
    ?? actor?.uuid
    ?? actor?.id
    ?? null;
}

function rememberedQuickSpellView(memoryKey) {
  if (!memoryKey) return normalizeQuickSpellView();
  if (!quickSpellViewMemoryCache) {
    const stored = game.settings.get(MODULE_ID, VIEW_MEMORY_SETTING);
    quickSpellViewMemoryCache = stored && typeof stored === "object" && !Array.isArray(stored)
      ? { ...stored }
      : {};
  }
  return normalizeQuickSpellView(quickSpellViewMemoryCache[memoryKey]);
}

async function rememberQuickSpellView(memoryKey, view, sources) {
  if (!memoryKey) return;
  rememberedQuickSpellView(memoryKey);
  delete quickSpellViewMemoryCache[memoryKey];
  quickSpellViewMemoryCache[memoryKey] = normalizeQuickSpellView({ view, sources: [...sources] });
  quickSpellViewMemoryCache = Object.fromEntries(
    Object.entries(quickSpellViewMemoryCache).slice(-MAX_VIEW_MEMORY_ENTRIES)
  );
  const snapshot = structuredClone(quickSpellViewMemoryCache);
  quickSpellViewMemoryWrite = quickSpellViewMemoryWrite
    .catch(() => undefined)
    .then(() => game.settings.set(MODULE_ID, VIEW_MEMORY_SETTING, snapshot));
  await quickSpellViewMemoryWrite;
}

export async function launchQuickSpell(actor, entry, { skipPrompt = false, focus = false } = {}) {
  if (!actor?.isOwner || !entry?.available || typeof actor.system?.castSpell !== "function") return false;
  const cast = focus ? { cast: { focus: true } } : {};
  if (skipPrompt) cast.skipPrompt = true;
  if (entry.actorType === NPC_ACTOR_TYPE) {
    return actor.system.castSpell(entry.spellUuid, cast);
  }
  const config = { itemUuid: entry.itemUuid, ...cast };
  return actor.system.castSpell(entry.spellUuid, config);
}

export async function toggleFavoriteSpellId(actor, id) {
  if (actor?.type !== PLAYER_ACTOR_TYPE || !actor.isOwner || !id) return false;
  const favorites = favoriteSpellIds(actor);
  if (favorites.has(id)) favorites.delete(id);
  else favorites.add(id);
  const stored = [...favorites].slice(0, 200);
  await actor.setFlag(MODULE_ID, FAVORITES_FLAG, stored);
  return stored.includes(id);
}

async function toggleFavoriteSpell(actor, entry) {
  if (!entry) return false;
  entry.favorite = await toggleFavoriteSpellId(actor, entry.id);
  return entry.favorite;
}

export function playerSpellRowDescriptor(actor, row) {
  if (actor?.type !== PLAYER_ACTOR_TYPE || !row?.dataset?.itemId) return null;
  const item = actorItem(actor, row.dataset.itemId);
  if (!item?.uuid) return null;

  if (item.type === SPELL_TYPE) {
    return {
      id: favoriteSpellId("known", item.uuid, item.uuid),
      itemUuid: item.uuid,
      source: "known",
      spellUuid: item.uuid
    };
  }

  if (item.system?.isWand) {
    const spellUuid = row.dataset.spellId ?? row.dataset.wandSpellUuid;
    if (!spellUuid) return null;
    return {
      id: favoriteSpellId("wand", item.uuid, spellUuid),
      itemUuid: item.uuid,
      source: "wand",
      spellUuid
    };
  }

  if (item.system?.isScroll) {
    const spellUuid = item.system.spellUuid ?? row.dataset.spellId;
    if (!spellUuid) return null;
    return {
      id: favoriteSpellId("scroll", item.uuid, spellUuid),
      itemUuid: item.uuid,
      source: "scroll",
      spellUuid
    };
  }
  return null;
}

function updateSheetFavorite(row, control, active) {
  row.classList.add("gt-npc-ma-spell-favorite-row");
  row.classList.toggle("is-favorite", active);
  row.closest("ol.SD-list")?.classList.add("gt-npc-ma-spell-favorites-list");
  control.classList.toggle("active", active);
  control.dataset.tooltip = L(active
    ? "GTNPCMULTIATTACK.QuickSpell.RemoveFavorite"
    : "GTNPCMULTIATTACK.QuickSpell.AddFavorite");
  control.setAttribute("aria-label", control.dataset.tooltip);
  control.setAttribute("aria-pressed", String(active));
  const icon = control.querySelector("i");
  if (icon) icon.className = `${active ? "fa-solid" : "fa-regular"} fa-star`;
}

export function injectPlayerSpellFavorites(application, html) {
  if (!game.settings.get(MODULE_ID, QUICK_SPELL_SETTING)) return [];
  const actor = application?.actor ?? application?.object;
  const root = htmlRoot(html);
  if (!root || actor?.type !== PLAYER_ACTOR_TYPE || !actor.isOwner) return [];

  const favorites = favoriteSpellIds(actor);
  const controls = [];
  for (const row of root.querySelectorAll(".tab-spells .SD-list > li.item")) {
    const descriptor = playerSpellRowDescriptor(actor, row);
    const actions = row.querySelector(":scope > .actions");
    if (!descriptor?.id || !actions) continue;

    for (const node of [...actions.childNodes]) {
      if (node.nodeType === 3 && !node.textContent.trim()) node.remove();
    }
    const lostControl = actions.querySelector('[data-action="toggle-lost"]');
    row.classList.toggle("gt-npc-ma-spell-row-has-lost", Boolean(lostControl));

    let control = actions.querySelector("[data-gt-npc-ma-spell-favorite]");
    if (!control) {
      control = document.createElement("a");
      control.href = "#";
      control.dataset.gtNpcMaSpellFavorite = descriptor.id;
      control.setAttribute("role", "button");
      control.className = "gt-npc-ma-sheet-spell-favorite";
      control.innerHTML = '<i class="fa-regular fa-star" aria-hidden="true"></i>';
      control.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        if (control.dataset.pending === "true") return;
        control.dataset.pending = "true";
        control.setAttribute("aria-disabled", "true");
        void toggleFavoriteSpellId(actor, descriptor.id).then(active => {
          updateSheetFavorite(row, control, active);
        }).catch(error => {
          ui.notifications.error(L("GTNPCMULTIATTACK.QuickSpell.FavoriteFailed"));
          console.error(`${MODULE_ID} | Could not update the sheet spell favorite.`, error);
        }).finally(() => {
          delete control.dataset.pending;
          control.removeAttribute("aria-disabled");
        });
      });
      if (lostControl) lostControl.before(control);
      else actions.append(control);
    }
    updateSheetFavorite(row, control, favorites.has(descriptor.id));
    controls.push(control);
  }
  return controls;
}

function sourceLabel(source) {
  return L(`GTNPCMULTIATTACK.QuickSpell.Source.${source}`);
}

function preserveOpenPalette(application) {
  if (application && typeof application === "object") {
    paletteRestoreDeadlines.set(application, Date.now() + PALETTE_RESTORE_WINDOW_MS);
  }
}

function restoreOpenPalette(application, palette, button) {
  const deadline = paletteRestoreDeadlines.get(application) ?? 0;
  paletteRestoreDeadlines.delete(application);
  if (deadline < Date.now()) return false;
  setPaletteOpen(application, palette, button, true);
  return true;
}

async function buildSpellPreview(row, entry) {
  const description = String(entry?.description ?? "").trim();
  if (!description) return null;
  const html = await enrichHTML(description);
  if (!row.isConnected || !row.matches(":hover")) return null;
  const preview = document.createElement("aside");
  preview.className = "gt-npc-ma-quick-spell-preview";
  preview.setAttribute("role", "tooltip");
  const title = document.createElement("strong");
  title.textContent = entry.name;
  const body = document.createElement("div");
  body.className = "gt-npc-ma-quick-spell-preview-description";
  body.innerHTML = html;
  preview.append(title, body);
  return preview;
}

function attachSpellPreview(palette, row, entry) {
  if (!String(entry?.description ?? "").trim()) return;
  row.addEventListener("mouseenter", () => {
    schedulePreview(palette, tooltipHoverDelayMs(), () => buildSpellPreview(row, entry));
  });
  row.addEventListener("mouseleave", () => clearPreview(palette));
}

function spellEntryElement(application, actor, entry, palette, button, rerender) {
  const row = document.createElement("div");
  row.className = "gt-npc-ma-quick-spell-entry";
  if (!entry.available) row.classList.add("is-unavailable");
  row.classList.toggle("is-favorite", entry.favorite);

  const cast = document.createElement("a");
  cast.className = "palette-list-entry gt-npc-ma-quick-spell-cast";
  if (!entry.available) cast.setAttribute("aria-disabled", "true");
  const image = document.createElement("img");
  image.src = entry.img || "icons/svg/book.svg";
  image.alt = "";
  const content = document.createElement("span");
  const name = document.createElement("strong");
  name.textContent = entry.name;
  const details = document.createElement("small");
  details.textContent = entry.available
    ? sourceLabel(entry.source)
    : `${sourceLabel(entry.source)} · ${L("GTNPCMULTIATTACK.QuickSpell.Lost")}`;
  content.append(name, details);
  cast.append(image, content);
  cast.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    if (!entry.available) {
      ui.notifications.warn(L("GTNPCMULTIATTACK.QuickSpell.Unavailable"));
      return;
    }
    closePalette(application, palette, button);
    void launchQuickSpell(actor, entry, { skipPrompt: event.shiftKey }).catch(error => {
      ui.notifications.error(L("GTNPCMULTIATTACK.QuickSpell.Failed"));
      console.error(`${MODULE_ID} | Quick spell failed.`, error);
    });
  });
  row.append(cast);

  const actions = document.createElement("span");
  actions.className = "gt-npc-ma-quick-spell-actions";
  if (entry.requiresFocus && entry.available) {
    const focus = document.createElement("button");
    focus.type = "button";
    focus.dataset.tooltip = L("GTNPCMULTIATTACK.QuickSpell.Focus");
    focus.setAttribute("aria-label", focus.dataset.tooltip);
    focus.innerHTML = '<i class="fa-solid fa-brain" aria-hidden="true"></i>';
    focus.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      closePalette(application, palette, button);
      void launchQuickSpell(actor, entry, { focus: true, skipPrompt: event.shiftKey }).catch(error => {
        ui.notifications.error(L("GTNPCMULTIATTACK.QuickSpell.Failed"));
        console.error(`${MODULE_ID} | Quick focus spell failed.`, error);
      });
    });
    actions.append(focus);
  }
  if (actor.type === PLAYER_ACTOR_TYPE) {
    const favorite = document.createElement("button");
    favorite.type = "button";
    favorite.className = "gt-npc-ma-quick-spell-favorite";
    favorite.classList.toggle("active", entry.favorite);
    favorite.dataset.tooltip = L(entry.favorite
      ? "GTNPCMULTIATTACK.QuickSpell.RemoveFavorite"
      : "GTNPCMULTIATTACK.QuickSpell.AddFavorite");
    favorite.setAttribute("aria-label", favorite.dataset.tooltip);
    favorite.innerHTML = `<i class="${entry.favorite ? "fa-solid" : "fa-regular"} fa-star" aria-hidden="true"></i>`;
    favorite.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      preserveOpenPalette(application);
      void toggleFavoriteSpell(actor, entry).then(rerender).catch(error => {
        ui.notifications.error(L("GTNPCMULTIATTACK.QuickSpell.FavoriteFailed"));
        console.error(`${MODULE_ID} | Could not update favorite spells.`, error);
      });
    });
    actions.append(favorite);
  }
  if (actions.childElementCount) row.append(actions);
  attachSpellPreview(palette, row, entry);
  return row;
}

function createSpellPalette(application, actor, entries, button, column) {
  const palette = document.createElement("div");
  palette.className = "palette gt-npc-ma-quick-spell-palette";
  palette.dataset.palette = PALETTE_ID;
  palette.setAttribute("aria-label", L("GTNPCMULTIATTACK.QuickSpell.Choose"));
  if (typeof application.togglePalette !== "function") palette.hidden = true;

  const tiers = quickSpellTiers(entries);
  const populatedTiers = new Set(entries
    .filter(entry => !["scroll", "wand"].includes(entry.source))
    .map(entry => Number(entry.tier)));
  const memoryKey = quickSpellViewMemoryKey(application, actor);
  const rememberedView = rememberedQuickSpellView(memoryKey);
  let activeView = rememberedView.view;
  const activeSources = new Set(rememberedView.sources);
  const saveView = () => {
    void rememberQuickSpellView(memoryKey, activeView, activeSources).catch(error => {
      console.warn(`${MODULE_ID} | Could not remember the Quick Spell view.`, error);
    });
  };
  const tierTabs = document.createElement("div");
  tierTabs.className = "gt-npc-ma-quick-spell-tier-tabs";
  tierTabs.setAttribute("role", "tablist");
  tierTabs.setAttribute("aria-label", L("GTNPCMULTIATTACK.QuickSpell.Choose"));
  palette.append(tierTabs);

  const sourceTabs = document.createElement("div");
  sourceTabs.className = "gt-npc-ma-quick-spell-source-tabs";
  sourceTabs.setAttribute("role", "group");
  sourceTabs.setAttribute("aria-label", L("GTNPCMULTIATTACK.QuickSpell.FilterSource"));
  palette.append(sourceTabs);

  const list = document.createElement("div");
  list.className = "gt-npc-ma-quick-spell-list";
  list.addEventListener("scroll", () => clearPreview(palette));
  palette.append(list);
  const noMatches = document.createElement("p");
  noMatches.className = "gt-npc-ma-quick-spell-empty";
  noMatches.textContent = L("GTNPCMULTIATTACK.QuickSpell.NoMatches");
  noMatches.hidden = true;
  palette.append(noMatches);

  const renderList = () => {
    clearPreview(palette);
    const visible = quickSpellsForSelection(entries, activeView, activeSources);
    list.replaceChildren();

    const appendSection = (headingText, sectionEntries, favoriteSection = false) => {
      if (!sectionEntries.length) return;
      const section = document.createElement("section");
      section.className = "gt-npc-ma-quick-spell-tier";
      if (favoriteSection) section.classList.add("is-favorites");
      const heading = document.createElement("h4");
      heading.textContent = headingText;
      section.append(heading);
      for (const entry of sectionEntries) {
        section.append(spellEntryElement(application, actor, entry, palette, button, renderList));
      }
      list.append(section);
    };

    if (actor.type === PLAYER_ACTOR_TYPE) {
      appendSection(
        L("GTNPCMULTIATTACK.QuickSpell.Favorites"),
        visible.filter(entry => entry.favorite),
        true
      );
    }
    const nonFavorites = visible.filter(entry => actor.type !== PLAYER_ACTOR_TYPE || !entry.favorite);
    const knownEntries = nonFavorites.filter(entry => !["scroll", "wand"].includes(entry.source));
    if (activeView === "all") {
      for (const tier of tiers) {
        appendSection(
          F("GTNPCMULTIATTACK.QuickSpell.Tier", { tier }),
          knownEntries.filter(entry => Number(entry.tier) === tier)
        );
      }
    }
    else {
      const activeTier = Number(activeView);
      appendSection(
        F("GTNPCMULTIATTACK.QuickSpell.Tier", { tier: activeTier }),
        knownEntries.filter(entry => Number(entry.tier) === activeTier)
      );
    }
    for (const sourceName of ["scroll", "wand"]) {
      if (!activeSources.has(sourceName)) continue;
      appendSection(
        sourceLabel(sourceName),
        nonFavorites.filter(entry => entry.source === sourceName)
      );
    }
    noMatches.hidden = visible.length !== 0;
    for (const tab of tierTabs.querySelectorAll("button")) {
      const active = tab.dataset.view === activeView;
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-selected", String(active));
    }
    for (const tab of sourceTabs.querySelectorAll("button")) {
      const active = activeSources.has(tab.dataset.source);
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-pressed", String(active));
    }
    schedulePalettePosition(button, palette, column);
  };

  const allTab = document.createElement("button");
  allTab.type = "button";
  allTab.dataset.view = "all";
  allTab.setAttribute("role", "tab");
  allTab.textContent = L("GTNPCMULTIATTACK.Settings.All");
  allTab.addEventListener("click", () => {
    activeView = "all";
    saveView();
    renderList();
  });
  tierTabs.append(allTab);
  for (const tier of tiers) {
    const tab = document.createElement("button");
    tab.type = "button";
    tab.dataset.view = String(tier);
    tab.setAttribute("role", "tab");
    tab.textContent = F("GTNPCMULTIATTACK.QuickSpell.Tier", { tier });
    tab.disabled = !populatedTiers.has(tier);
    tab.addEventListener("click", () => {
      activeView = String(tier);
      saveView();
      renderList();
    });
    tierTabs.append(tab);
  }
  for (const [sourceName, iconClass] of [
    ["scroll", "fa-solid fa-scroll"],
    ["wand", "fa-solid fa-wand-magic-sparkles"]
  ]) {
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
    sourceTabs.append(tab);
  }
  renderList();
  return palette;
}

export async function injectQuickSpellLauncher(application, html) {
  if (!game.settings.get(MODULE_ID, QUICK_SPELL_SETTING)) return null;
  const root = htmlRoot(html);
  if (!root || root.querySelector(`.${BUTTON_CLASS}`) || root.dataset[PENDING_DATASET_KEY] === "true") return null;
  const actor = application?.actor
    ?? application?.object?.document?.actor
    ?? application?.object?.actor;
  if (!actor?.isOwner || ![NPC_ACTOR_TYPE, PLAYER_ACTOR_TYPE].includes(actor.type)) return null;

  root.dataset[PENDING_DATASET_KEY] = "true";
  try {
    const spells = await collectQuickSpells(actor);
    if (!spells.length || root.querySelector(`.${BUTTON_CLASS}`)) return null;
    const column = root.querySelector(".col.right");
    if (!column) return null;

    const button = document.createElement("button");
    button.type = "button";
    button.className = `control-icon ${BUTTON_CLASS}`;
    button.dataset.tooltip = L("GTNPCMULTIATTACK.QuickSpell.Tooltip");
    button.setAttribute("aria-label", button.dataset.tooltip);
    button.dataset.palette = PALETTE_ID;
    button.innerHTML = '<i class="fa-solid fa-hand-sparkles" inert></i>';
    const palette = createSpellPalette(application, actor, spells, button, column);

    button.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      togglePalette(application, palette, button);
      schedulePalettePosition(button, palette, column);
      if (isPaletteOpen(application, palette)) palette.querySelector(".gt-npc-ma-quick-spell-tier-tabs button.active:not(:disabled)")?.focus();
    });

    insertQuickButton(column, button, palette, QUICK_BUTTON_ORDER.spell);
    if (restoreOpenPalette(application, palette, button)) schedulePalettePosition(button, palette, column);
    return button;
  }
  finally {
    delete root.dataset[PENDING_DATASET_KEY];
  }
}

export const quickSpellTestApi = Object.freeze({
  collectQuickSpells,
  favoriteSpellId,
  normalizeQuickSpellView,
  playerSpellRowDescriptor,
  quickSpellTiers,
  quickSpellsForSelection,
  quickSpellViewMemoryKey,
  launchQuickSpell,
  toggleFavoriteSpellId,
  toggleFavoriteSpell
});
