import {
  actorItem,
  enrichHTML,
  htmlRoot,
  itemList,
  L,
  MODULE_ID,
  resolveUuid
} from "./lib/dom.mjs";
import {
  clearPreview,
  closePalette,
  insertQuickButton,
  QUICK_BUTTON_ORDER,
  schedulePalettePosition,
  schedulePreview,
  togglePalette
} from "./lib/palette.mjs";
import { tooltipHoverDelayMs } from "./tooltip-hover.mjs";
import { quickButtonMode, rememberedLaunch, rememberLaunch } from "./lib/quick-launch.mjs";
import { offersUnarmedAttack, rollUnarmedAttack, UNARMED_ENTRY_ID, unarmedEntry } from "./unarmed-attack.mjs";

const QUICK_ATTACK_SETTING = "enableQuickAttackButton";
const NPC_ACTOR_TYPE = "NPC";
const PLAYER_ACTOR_TYPE = "Player";
const NPC_ATTACK_TYPE = "NPC Attack";
const NPC_FEATURE_TYPE = "NPC Feature";
const WEAPON_TYPE = "Weapon";
const BUTTON_CLASS = "gt-npc-ma-quick-attack";
const PALETTE_ID = "gtNpcMultiattackQuickAttack";
const PENDING_DATASET_KEY = "gtNpcMaQuickAttackPending";

function localizeConfigValue(collection, key) {
  const localizationKey = collection?.[key];
  return localizationKey ? L(localizationKey) : String(key ?? "");
}

function signedBonus(value) {
  if (typeof value === "string" && /^[+-]/.test(value.trim())) return value.trim();
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return String(value ?? "");
  return numeric >= 0 ? `+${numeric}` : String(numeric);
}

function damageFormula(item) {
  const base = String(item?.system?.damage?.value ?? "").trim();
  if (!base) return "";
  const bonus = Number(item?.system?.bonuses?.damageBonus ?? 0);
  return `${base}${bonus ? signedBonus(bonus) : ""}`;
}

function npcAttackType(item) {
  return Array.from(item?.system?.ranges ?? [])[0] === "close" ? "melee" : "ranged";
}

function attackTypeLabel(type) {
  return L(type === "ranged"
    ? "GTNPCMULTIATTACK.QuickAttack.Ranged"
    : "GTNPCMULTIATTACK.QuickAttack.Melee");
}

function baseEntry(actorType, item, attackType) {
  return {
    id: `${actorType === NPC_ACTOR_TYPE ? "npc" : "pc"}:${item.uuid}:${attackType}`,
    actorType,
    itemId: item.id,
    itemUuid: item.uuid,
    item,
    name: item.name,
    img: item.img,
    attackType,
    typeLabel: attackTypeLabel(attackType),
    attackModifier: "",
    damageFormula: "",
    description: String(item.system?.description ?? ""),
    ranges: [],
    qualities: []
  };
}

export function collectQuickAttacks(actor) {
  if (actor?.type === NPC_ACTOR_TYPE) {
    return itemList(actor)
      .filter(item => item.type === NPC_ATTACK_TYPE)
      .map(item => baseEntry(NPC_ACTOR_TYPE, item, npcAttackType(item)))
      .sort((left, right) => left.attackType.localeCompare(right.attackType)
        || left.name.localeCompare(right.name, game.i18n.lang));
  }
  if (actor?.type !== PLAYER_ACTOR_TYPE) return [];
  const entries = [];
  for (const item of itemList(actor)) {
    if (item.type !== WEAPON_TYPE || !item.system?.isWeapon || !item.system?.equipped) continue;
    const baseType = ["melee", "ranged"].includes(item.system.type) ? item.system.type : null;
    if (baseType) entries.push(baseEntry(PLAYER_ACTOR_TYPE, item, baseType));
    if (item.system.isThrown && baseType !== "ranged") {
      entries.push(baseEntry(PLAYER_ACTOR_TYPE, item, "ranged"));
    }
  }
  return entries.sort((left, right) => left.attackType.localeCompare(right.attackType)
    || left.name.localeCompare(right.name, game.i18n.lang));
}

async function prepareWeaponQualities(item) {
  const qualities = [];
  for (const uuid of item?.system?.properties ?? []) {
    const property = await resolveUuid(uuid);
    if (!property) continue;
    qualities.push({ name: property.name, description: String(property.system?.description ?? "") });
  }
  return qualities;
}

function prepareNpcQualities(actor, item) {
  const names = String(item?.system?.damage?.special ?? "")
    .split(/[,;]+/).map(name => name.trim()).filter(Boolean);
  const features = itemList(actor).filter(candidate => candidate.type === NPC_FEATURE_TYPE);
  return names.map(name => {
    const feature = features.find(candidate => candidate.name.localeCompare(name, undefined, {
      sensitivity: "accent"
    }) === 0);
    return { name, description: String(feature?.system?.description ?? "") };
  });
}

export async function prepareQuickAttackEntries(actor, entries = collectQuickAttacks(actor)) {
  for (const entry of entries) {
    const item = entry.item ?? actorItem(actor, entry.itemId);
    if (!item) continue;
    if (entry.actorType === NPC_ACTOR_TYPE) {
      entry.attackModifier = signedBonus(item.system?.bonuses?.attackBonus ?? 0);
      entry.damageFormula = damageFormula(item);
      entry.ranges = Array.from(item.system?.ranges ?? [])
        .map(range => localizeConfigValue(CONFIG.SHADOWDARK?.RANGES, range));
      entry.qualities = prepareNpcQualities(actor, item);
      continue;
    }
    const config = { actorUuid: actor.uuid, itemUuid: entry.itemUuid, attack: { type: entry.attackType } };
    await actor.system?.rollConfigGenerators?.attack?.(config);
    entry.attackModifier = signedBonus(config.mainRoll?.bonus ?? 0);
    entry.damageFormula = String(config.damageRoll?.formula
      ?? item.system?.getDamageFormula?.(item.system?.handedness)
      ?? "");
    entry.ranges = [localizeConfigValue(CONFIG.SHADOWDARK?.RANGES, item.system?.range)].filter(Boolean);
    entry.qualities = await prepareWeaponQualities(item);
  }
  return entries;
}

export async function launchQuickAttack(actor, entry, { skipPrompt = false } = {}) {
  if (!actor?.isOwner || !entry) return false;
  void rememberLaunch(actor.uuid, "attack", entry.id).catch(() => undefined);
  const extra = skipPrompt ? { skipPrompt: true } : {};
  if (entry.unarmed) return rollUnarmedAttack(actor, extra);
  if (entry.actorType === NPC_ACTOR_TYPE) {
    return skipPrompt ? actor.system.rollAttack(entry.itemId, extra) : actor.system.rollAttack(entry.itemId);
  }
  return actor.system.rollAttack(entry.itemUuid, { attack: { type: entry.attackType }, ...extra });
}

/** The attack the HUD button opens in dialog mode: last used, else the first melee entry. */
export function defaultQuickAttack(actor, entries = collectQuickAttacks(actor)) {
  const all = offersUnarmedAttack(actor) ? [...entries, unarmedEntry(actor)] : entries;
  if (!all.length) return null;
  const remembered = rememberedLaunch(actor?.uuid, "attack");
  return all.find(entry => entry.id === remembered)
    ?? all.find(entry => entry.attackType === "melee" && !entry.unarmed)
    ?? all[0];
}

export async function buildAttackPreview(entry) {
  const preview = document.createElement("aside");
  preview.className = "gt-npc-ma-quick-attack-preview";
  preview.setAttribute("role", "tooltip");
  const title = document.createElement("strong");
  title.textContent = entry.name;
  preview.append(title);

  const description = String(entry.description ?? "").trim();
  if (description) {
    const body = document.createElement("div");
    body.className = "gt-npc-ma-quick-attack-preview-description";
    body.innerHTML = await enrichHTML(description);
    preview.append(body);
  }

  if (entry.qualities.length) {
    for (const quality of entry.qualities) {
      const section = document.createElement("section");
      const name = document.createElement("b");
      name.textContent = quality.name;
      section.append(name);
      if (quality.description) {
        const description = document.createElement("div");
        description.innerHTML = await enrichHTML(quality.description);
        section.append(description);
      }
      preview.append(section);
    }
  }
  return preview;
}

function scheduleAttackPreview(palette, entry) {
  schedulePreview(palette, tooltipHoverDelayMs(), () => buildAttackPreview(entry));
}

function attackEntryElement(application, actor, entry, palette, button) {
  const link = document.createElement("a");
  link.className = "palette-list-entry gt-npc-ma-quick-attack-entry";
  link.dataset.attackId = entry.id;
  const icon = entry.img ? document.createElement("img") : document.createElement("i");
  if (entry.img) {
    icon.src = entry.img;
    icon.alt = "";
  }
  else {
    icon.className = "fa-solid fa-hand-fist fa-fw";
    icon.setAttribute("aria-hidden", "true");
  }
  const identity = document.createElement("span");
  identity.className = "gt-npc-ma-quick-attack-identity";
  const name = document.createElement("strong");
  name.className = "gt-npc-ma-quick-attack-name";
  name.textContent = entry.name;
  const range = document.createElement("small");
  range.className = "gt-npc-ma-quick-attack-range";
  range.textContent = `${L("GTNPCMULTIATTACK.QuickAttack.Range")}: ${entry.ranges.join(" / ") || "—"}`;
  identity.append(name, range);
  const statistics = document.createElement("small");
  statistics.className = "gt-npc-ma-quick-attack-statistics";
  statistics.textContent = [entry.attackModifier, entry.damageFormula].filter(Boolean).join(" · ");
  link.append(icon, identity, statistics);
  link.addEventListener("mouseenter", () => scheduleAttackPreview(palette, entry));
  link.addEventListener("mouseleave", () => clearPreview(palette));
  link.addEventListener("focus", () => scheduleAttackPreview(palette, entry));
  link.addEventListener("blur", () => clearPreview(palette));
  link.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    closePalette(application, palette, button);
    void launchQuickAttack(actor, entry).catch(error => {
      ui.notifications.error(L("GTNPCMULTIATTACK.QuickAttack.Failed"));
      console.error(`${MODULE_ID} | Quick attack failed.`, error);
    });
  });
  return link;
}

function attackGroup(application, actor, entries, type, palette, button) {
  const group = document.createElement("section");
  group.className = `gt-npc-ma-quick-attack-group is-${type}`;
  const heading = document.createElement("h4");
  heading.textContent = attackTypeLabel(type);
  group.append(heading);
  for (const entry of entries.filter(candidate => candidate.attackType === type)) {
    group.append(attackEntryElement(application, actor, entry, palette, button));
  }
  return group.children.length > 1 ? group : null;
}

export async function injectQuickAttackLauncher(application, html) {
  if (!game.settings.get(MODULE_ID, QUICK_ATTACK_SETTING)) return;
  const root = htmlRoot(html);
  if (!root || root.querySelector(`.${BUTTON_CLASS}`) || root.dataset[PENDING_DATASET_KEY] === "true") return;
  const actor = application?.actor ?? application?.object?.document?.actor ?? application?.object?.actor;
  if (!actor?.isOwner || ![NPC_ACTOR_TYPE, PLAYER_ACTOR_TYPE].includes(actor.type)) return;

  root.dataset[PENDING_DATASET_KEY] = "true";
  try {
    const dialogMode = quickButtonMode() === "dialog";
    const attacks = dialogMode ? collectQuickAttacks(actor) : await prepareQuickAttackEntries(actor);
    if (!attacks.length || root.querySelector(`.${BUTTON_CLASS}`)) return;
    const column = root.querySelector(".col.right");
    if (!column) return;

    const button = document.createElement("button");
    button.type = "button";
    button.className = `control-icon ${BUTTON_CLASS}`;
    button.dataset.tooltip = L("GTNPCMULTIATTACK.QuickAttack.Tooltip");
    button.setAttribute("aria-label", button.dataset.tooltip);
    button.innerHTML = '<i class="fa-solid fa-hand-fist" inert></i>';

    if (dialogMode) {
      // Straight into the attack dialog, where the weapon rows live.
      const placeholder = document.createElement("div");
      placeholder.className = "palette gt-npc-ma-quick-attack-palette";
      placeholder.hidden = true;
      button.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        const entry = defaultQuickAttack(actor, attacks);
        if (!entry) return;
        void launchQuickAttack(actor, entry, { skipPrompt: event.shiftKey }).catch(error => {
          ui.notifications.error(L("GTNPCMULTIATTACK.QuickAttack.Failed"));
          console.error(`${MODULE_ID} | Quick attack failed.`, error);
        });
      });
      insertQuickButton(column, button, placeholder, QUICK_BUTTON_ORDER.attack);
      return button;
    }

    const palette = document.createElement("div");
    palette.className = "palette palette-list gt-npc-ma-quick-attack-palette";
    palette.dataset.palette = PALETTE_ID;
    if (typeof application.togglePalette !== "function") palette.hidden = true;
    palette.setAttribute("aria-label", L("GTNPCMULTIATTACK.QuickAttack.Choose"));
    button.dataset.palette = PALETTE_ID;
    for (const type of ["melee", "ranged"]) {
      const group = attackGroup(application, actor, attacks, type, palette, button);
      if (group) palette.append(group);
    }

    button.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      clearPreview(palette);
      togglePalette(application, palette, button);
      schedulePalettePosition(button, palette, column);
    });

    insertQuickButton(column, button, palette, QUICK_BUTTON_ORDER.attack);
    return button;
  }
  finally { delete root.dataset[PENDING_DATASET_KEY]; }
}

export const quickAttackTestApi = Object.freeze({
  defaultQuickAttack,
  collectQuickAttacks,
  prepareQuickAttackEntries,
  launchQuickAttack
});
