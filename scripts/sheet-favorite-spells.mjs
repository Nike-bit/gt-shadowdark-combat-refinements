import { collectQuickSpells, launchQuickSpell, toggleFavoriteSpellId } from "./token-spell-launcher.mjs";
import { htmlRoot, L, MODULE_ID } from "./lib/dom.mjs";

// The Player sheet's Abilities tab lists attacks and special abilities as
// SD-boxes. A caster's favourite spells belong at the end of that column: the
// things a player reaches for most, castable from the same page as their
// weapons. Drawn only when the character has favourites, so a fighter's sheet
// is untouched.

export const SHEET_FAVORITES_SETTING = "showFavoriteSpellsOnSheet";
const QUICK_SPELL_SETTING = "enableQuickSpellButton";
const BOX_CLASS = "gt-npc-ma-favorite-spells";
const PLAYER_ACTOR_TYPE = "Player";

export function registerSheetFavoritesSetting() {
  game.settings.register(MODULE_ID, SHEET_FAVORITES_SETTING, {
    name: L("GTNPCMULTIATTACK.Settings.ShowFavoriteSpellsOnSheet"),
    hint: L("GTNPCMULTIATTACK.Settings.ShowFavoriteSpellsOnSheetHint"),
    scope: "client",
    config: true,
    type: Boolean,
    default: true
  });
}

function isEnabled() {
  try {
    return game.settings.get(MODULE_ID, QUICK_SPELL_SETTING) === true
      && game.settings.get(MODULE_ID, SHEET_FAVORITES_SETTING) !== false;
  }
  catch (_error) { return false; }
}

/**
 * Where the box goes: after Special Abilities when the character has any,
 * otherwise after Ranged Attacks. Boxes are matched by their localized
 * header, not by position.
 */
function anchorBox(root) {
  const boxes = Array.from(root.querySelectorAll(".tab-abilities .SD-box"))
    .filter(box => !box.classList?.contains?.(BOX_CLASS));
  const byLabel = key => {
    const label = L(key);
    return boxes.find(box => box.querySelector(":scope > .header > label")?.textContent?.trim() === label) ?? null;
  };
  return byLabel("SHADOWDARK.sheet.special_abilities.label")
    ?? byLabel("SHADOWDARK.sheet.player.ranged_attacks")
    ?? boxes[1]
    ?? null;
}

function spellRow(actor, entry, rerender) {
  const row = document.createElement("div");
  row.className = "attack item gt-npc-ma-favorite-spell";
  if (!entry.available) row.classList.add("is-unavailable");
  row.dataset.spellUuid = entry.spellUuid;

  const cast = document.createElement("a");
  cast.className = "rollable gt-npc-ma-favorite-spell-cast";
  cast.innerHTML = '<i class="fa-solid fa-dice-d20" aria-hidden="true"></i> ';
  const name = document.createElement("b");
  name.className = "item-name";
  name.textContent = entry.name;
  cast.append(name);
  if (!entry.available) {
    cast.setAttribute("aria-disabled", "true");
    cast.append(` (${L("GTNPCMULTIATTACK.QuickSpell.Lost")})`);
  }
  cast.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    if (!entry.available) {
      ui.notifications.warn(L("GTNPCMULTIATTACK.QuickSpell.Unavailable"));
      return;
    }
    void launchQuickSpell(actor, entry, { skipPrompt: event.shiftKey }).catch(error => {
      ui.notifications.error(L("GTNPCMULTIATTACK.QuickSpell.Failed"));
      console.error(`${MODULE_ID} | Favorite spell cast failed.`, error);
    });
  });

  const subtext = document.createElement("span");
  subtext.className = "item-subtext";
  const source = L(`GTNPCMULTIATTACK.QuickSpell.Source.${entry.source}`);
  subtext.textContent = [entry.subtext, source].filter(Boolean).join(" • ");

  const actions = document.createElement("span");
  actions.className = "gt-npc-ma-favorite-spell-actions";
  if (entry.requiresFocus && entry.available) {
    const focus = document.createElement("a");
    focus.href = "#";
    focus.dataset.tooltip = L("GTNPCMULTIATTACK.QuickSpell.Focus");
    focus.setAttribute("aria-label", focus.dataset.tooltip);
    focus.innerHTML = '<i class="fa-solid fa-brain" aria-hidden="true"></i>';
    focus.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      void launchQuickSpell(actor, entry, { focus: true, skipPrompt: event.shiftKey }).catch(error => {
        ui.notifications.error(L("GTNPCMULTIATTACK.QuickSpell.Failed"));
        console.error(`${MODULE_ID} | Favorite focus spell failed.`, error);
      });
    });
    actions.append(focus);
  }
  const star = document.createElement("a");
  star.href = "#";
  star.className = "gt-npc-ma-sheet-spell-favorite active";
  star.dataset.tooltip = L("GTNPCMULTIATTACK.QuickSpell.RemoveFavorite");
  star.setAttribute("aria-label", star.dataset.tooltip);
  star.innerHTML = '<i class="fa-solid fa-star" aria-hidden="true"></i>';
  star.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    void toggleFavoriteSpellId(actor, entry.id).then(rerender).catch(error => {
      ui.notifications.error(L("GTNPCMULTIATTACK.QuickSpell.FavoriteFailed"));
      console.error(`${MODULE_ID} | Could not update favorite spells.`, error);
    });
  });
  actions.append(star);

  row.append(cast, subtext, actions);
  return row;
}

/**
 * Draw (or redraw) the Favorite Spells box at the end of the abilities column. Returns the
 * box, or null when the sheet is not a Player's, the feature is off, or the
 * character has no favourites.
 */
export async function injectSheetFavoriteSpells(application, html) {
  const actor = application?.actor ?? application?.object;
  const root = htmlRoot(html);
  if (!root || actor?.type !== PLAYER_ACTOR_TYPE || !actor.isOwner || !isEnabled()) return null;
  const anchor = anchorBox(root);
  if (!anchor) return null;

  const favorites = (await collectQuickSpells(actor)).filter(entry => entry.favorite);
  const existing = root.querySelector(`.${BOX_CLASS}`);
  if (!favorites.length) {
    existing?.remove();
    return null;
  }
  const box = existing ?? document.createElement("div");
  box.className = `SD-box ${BOX_CLASS}`;
  box.replaceChildren();
  const header = document.createElement("div");
  header.className = "header";
  const label = document.createElement("label");
  label.textContent = L("GTNPCMULTIATTACK.QuickSpell.FavoritesHeading");
  header.append(label, document.createElement("span"));
  const content = document.createElement("div");
  content.className = "content";
  // The flag update re-renders the sheet, which redraws the box through the
  // same hook; the rerender callback only covers a sheet that does not.
  const rerender = () => injectSheetFavoriteSpells(application, html);
  for (const entry of favorites) content.append(spellRow(actor, entry, rerender));
  box.append(header, content);
  if (!existing) anchor.insertAdjacentElement("afterend", box);
  return box;
}

export function registerSheetFavoriteSpellHooks() {
  const handler = (application, html) => {
    void injectSheetFavoriteSpells(application, html).catch(error => {
      console.error(`${MODULE_ID} | Could not draw favorite spells on the sheet.`, error);
    });
  };
  Hooks.on("renderActorSheet", handler);
  Hooks.on("renderActorSheetV2", handler);
}

export const sheetFavoriteSpellsTestApi = Object.freeze({ injectSheetFavoriteSpells });
