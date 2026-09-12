import { htmlRoot, L, MODULE_ID } from "./lib/dom.mjs";
import {
  insertQuickButton,
  QUICK_BUTTON_ORDER,
  schedulePalettePosition,
  setPaletteOpen,
  togglePalette
} from "./lib/palette.mjs";

export const QUICK_ATTRIBUTE_SETTING = "enableQuickAttributeButton";
const PLAYER_ACTOR_TYPE = "Player";
const BUTTON_CLASS = "gt-npc-ma-quick-attribute";
const PALETTE_ID = "gtNpcMultiattackQuickAttribute";

function localizeLabel(value, fallback) {
  const label = String(value ?? "").trim();
  if (!label) return fallback;
  return game.i18n.localize(label);
}

export function attributeLabel(actor, key) {
  const fallback = String(key ?? "").toUpperCase();
  const configured = actor?.system?.abilities?.[key]?.label
    ?? CONFIG.SHADOWDARK?.ABILITIES_LONG?.[key]
    ?? `SHADOWDARK.ability_${key}`;
  return localizeLabel(configured, fallback);
}

function signedModifier(value) {
  const modifier = Number(value);
  if (!Number.isFinite(modifier)) return "+0";
  return modifier >= 0 ? `+${modifier}` : String(modifier);
}

export function collectQuickAttributes(actor) {
  if (actor?.type !== PLAYER_ACTOR_TYPE) return [];
  const keys = Array.from(CONFIG.SHADOWDARK?.ABILITY_KEYS ?? []);
  return keys
    .filter(key => actor.system?.abilities?.[key])
    .map(key => ({
      key,
      label: attributeLabel(actor, key),
      modifier: Number(actor.system.abilities[key].mod) || 0,
      modifierLabel: signedModifier(actor.system.abilities[key].mod)
    }));
}

export async function launchQuickAttribute(actor, key) {
  if (!actor?.isOwner || actor.type !== PLAYER_ACTOR_TYPE) return false;
  if (!collectQuickAttributes(actor).some(attribute => attribute.key === key)) return false;
  return actor.system.rollStatCheck(key);
}

function attributeEntry(application, actor, attribute, palette, button) {
  const link = document.createElement("a");
  link.className = "palette-list-entry gt-npc-ma-quick-attribute-entry";
  link.dataset.attribute = attribute.key;
  const name = document.createElement("strong");
  name.textContent = attribute.label;
  const modifier = document.createElement("span");
  modifier.textContent = `(${attribute.modifierLabel})`;
  link.append(name, modifier);
  link.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    setPaletteOpen(application, palette, button, false);
    void launchQuickAttribute(actor, attribute.key).catch(error => {
      ui.notifications.error(L("GTNPCMULTIATTACK.QuickAttribute.Failed"));
      console.error(`${MODULE_ID} | Quick attribute check failed.`, error);
    });
  });
  return link;
}

export function injectQuickAttributeLauncher(application, html) {
  if (!game.settings.get(MODULE_ID, QUICK_ATTRIBUTE_SETTING)) return;
  const root = htmlRoot(html);
  if (!root || root.querySelector(`.${BUTTON_CLASS}`)) return;
  const actor = application?.actor ?? application?.object?.document?.actor ?? application?.object?.actor;
  if (!actor?.isOwner || actor.type !== PLAYER_ACTOR_TYPE) return;
  const attributes = collectQuickAttributes(actor);
  if (!attributes.length) return;
  const column = root.querySelector(".col.right");
  if (!column) return;

  const button = document.createElement("button");
  button.type = "button";
  button.className = `control-icon ${BUTTON_CLASS}`;
  button.dataset.tooltip = L("GTNPCMULTIATTACK.QuickAttribute.Tooltip");
  button.setAttribute("aria-label", button.dataset.tooltip);
  button.innerHTML = '<i class="fa-solid fa-dice-d20" inert></i>';

  const palette = document.createElement("div");
  palette.className = "palette palette-list gt-npc-ma-quick-attribute-palette";
  palette.dataset.palette = PALETTE_ID;
  palette.setAttribute("aria-label", button.dataset.tooltip);
  if (typeof application.togglePalette !== "function") palette.hidden = true;
  button.dataset.palette = PALETTE_ID;
  for (const attribute of attributes) {
    palette.append(attributeEntry(application, actor, attribute, palette, button));
  }

  button.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    togglePalette(application, palette, button);
    schedulePalettePosition(button, palette, column);
  });

  insertQuickButton(column, button, palette, QUICK_BUTTON_ORDER.attribute);
  return button;
}

export const quickAttributeTestApi = Object.freeze({
  attributeLabel,
  collectQuickAttributes,
  launchQuickAttribute
});
