import { enrichHTML, htmlRoot, itemList, L, MODULE_ID } from "./lib/dom.mjs";
import {
  clearPreview,
  insertQuickButton,
  QUICK_BUTTON_ORDER,
  schedulePalettePosition,
  schedulePreview,
  setPaletteOpen,
  togglePalette
} from "./lib/palette.mjs";
import { tooltipHoverDelayMs } from "./tooltip-hover.mjs";

const QUICK_ABILITY_SETTING = "enableQuickAbilityButton";
const NPC_ACTOR_TYPE = "NPC";
const PLAYER_ACTOR_TYPE = "Player";
const NPC_SPECIAL_ATTACK_TYPE = "NPC Special Attack";
const NPC_FEATURE_TYPE = "NPC Feature";
const CLASS_ABILITY_TYPE = "Class Ability";
const BUTTON_CLASS = "gt-npc-ma-quick-ability";
const PALETTE_ID = "gtNpcMultiattackQuickAbility";

function groupLabel(group) {
  return L(`GTNPCMULTIATTACK.QuickAbility.Group.${group}`);
}

function abilityEntry(item, actorType, group) {
  const limited = item.system?.limitedUses === true;
  const uses = Number(item.system?.uses?.available);
  const maximum = Number(item.system?.uses?.max);
  return {
    id: `${group}:${item.uuid}`,
    itemId: item.id,
    itemUuid: item.uuid,
    name: item.name,
    img: item.img,
    description: String(item.system?.description ?? ""),
    actorType,
    group,
    attackBonus: group === "specials" ? item.system?.bonuses?.attackBonus : null,
    uses: limited && Number.isFinite(uses) && Number.isFinite(maximum) ? `${uses}/${maximum}` : "",
    unavailable: item.system?.lost === true || (limited && Number.isFinite(uses) && uses <= 0)
  };
}

async function buildAbilityPreview(entry) {
  const preview = document.createElement("aside");
  preview.className = "gt-npc-ma-quick-ability-preview";
  preview.setAttribute("role", "tooltip");
  const title = document.createElement("strong");
  title.textContent = entry.name;
  const description = document.createElement("div");
  description.innerHTML = await enrichHTML(entry.description);
  preview.append(title, description);
  return preview;
}

function scheduleAbilityPreview(palette, entry) {
  if (!entry.description.trim()) return;
  schedulePreview(palette, tooltipHoverDelayMs(), () => buildAbilityPreview(entry));
}

export function collectQuickAbilities(actor) {
  if (actor?.type === NPC_ACTOR_TYPE) {
    return itemList(actor)
      .filter(item => [NPC_SPECIAL_ATTACK_TYPE, NPC_FEATURE_TYPE].includes(item.type))
      .map(item => abilityEntry(item, actor.type,
        item.type === NPC_SPECIAL_ATTACK_TYPE ? "specials" : "features"))
      .sort((left, right) => left.group.localeCompare(right.group)
        || left.name.localeCompare(right.name, game.i18n.lang));
  }
  if (actor?.type !== PLAYER_ACTOR_TYPE) return [];
  return itemList(actor)
    .filter(item => item.type === CLASS_ABILITY_TYPE && item.system?.isAbility !== false)
    .map(item => abilityEntry(item, actor.type, "abilities"))
    .sort((left, right) => left.name.localeCompare(right.name, game.i18n.lang));
}

export async function launchQuickAbility(actor, entry) {
  if (!actor?.isOwner || !entry || entry.unavailable) return false;
  if (entry.actorType === PLAYER_ACTOR_TYPE) return actor.system.useAbility(entry.itemUuid);
  if (entry.group === "specials" && entry.attackBonus !== "" && entry.attackBonus !== null
    && entry.attackBonus !== undefined) {
    return actor.system.rollAttack(entry.itemId);
  }
  return shadowdark.chat.showItemCard(entry.itemUuid);
}

function abilityEntryElement(application, actor, entry, palette, button) {
  const link = document.createElement("a");
  link.className = "palette-list-entry gt-npc-ma-quick-ability-entry";
  link.classList.toggle("is-unavailable", entry.unavailable);
  link.dataset.abilityId = entry.id;
  link.setAttribute("aria-disabled", String(entry.unavailable));

  if (entry.img) {
    const image = document.createElement("img");
    image.src = entry.img;
    image.alt = "";
    link.append(image);
  }
  else {
    const icon = document.createElement("i");
    icon.className = "fa-solid fa-burst fa-fw";
    icon.setAttribute("aria-hidden", "true");
    link.append(icon);
  }
  const name = document.createElement("strong");
  name.textContent = entry.name;
  link.append(name);
  if (entry.uses) {
    const uses = document.createElement("small");
    uses.textContent = entry.uses;
    link.append(uses);
  }
  link.addEventListener("mouseenter", () => scheduleAbilityPreview(palette, entry));
  link.addEventListener("mouseleave", () => clearPreview(palette));
  link.addEventListener("focus", () => scheduleAbilityPreview(palette, entry));
  link.addEventListener("blur", () => clearPreview(palette));
  link.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    if (entry.unavailable) return;
    setPaletteOpen(application, palette, button, false);
    clearPreview(palette);
    void launchQuickAbility(actor, entry).catch(error => {
      ui.notifications.error(L("GTNPCMULTIATTACK.QuickAbility.Failed"));
      console.error(`${MODULE_ID} | Quick ability failed.`, error);
    });
  });
  return link;
}

function abilityGroup(application, actor, entries, groupName, palette, button) {
  const filtered = entries.filter(entry => entry.group === groupName);
  if (!filtered.length) return null;
  const group = document.createElement("section");
  group.className = `gt-npc-ma-quick-ability-group is-${groupName}`;
  const heading = document.createElement("h4");
  heading.textContent = groupLabel(groupName);
  group.append(heading);
  for (const entry of filtered) group.append(abilityEntryElement(application, actor, entry, palette, button));
  return group;
}

export function injectQuickAbilityLauncher(application, html) {
  if (!game.settings.get(MODULE_ID, QUICK_ABILITY_SETTING)) return;
  const root = htmlRoot(html);
  if (!root || root.querySelector(`.${BUTTON_CLASS}`)) return;
  const actor = application?.actor ?? application?.object?.document?.actor ?? application?.object?.actor;
  if (!actor?.isOwner || ![NPC_ACTOR_TYPE, PLAYER_ACTOR_TYPE].includes(actor.type)) return;
  const abilities = collectQuickAbilities(actor);
  if (!abilities.length) return;
  const column = root.querySelector(".col.right");
  if (!column) return;

  const button = document.createElement("button");
  button.type = "button";
  button.className = `control-icon ${BUTTON_CLASS}`;
  button.dataset.tooltip = L("GTNPCMULTIATTACK.QuickAbility.Tooltip");
  button.setAttribute("aria-label", button.dataset.tooltip);
  button.innerHTML = '<i class="fa-solid fa-burst" inert></i>';

  const palette = document.createElement("div");
  palette.className = "palette palette-list gt-npc-ma-quick-ability-palette";
  palette.dataset.palette = PALETTE_ID;
  if (typeof application.togglePalette !== "function") palette.hidden = true;
  palette.setAttribute("aria-label", button.dataset.tooltip);
  button.dataset.palette = PALETTE_ID;
  for (const groupName of ["specials", "features", "abilities"]) {
    const group = abilityGroup(application, actor, abilities, groupName, palette, button);
    if (group) palette.append(group);
  }

  button.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    togglePalette(application, palette, button);
    schedulePalettePosition(button, palette, column);
  });

  insertQuickButton(column, button, palette, QUICK_BUTTON_ORDER.ability);
  return button;
}

export const quickAbilityTestApi = Object.freeze({
  collectQuickAbilities,
  launchQuickAbility
});
