import { F, L } from "./lib/dom.mjs";

/** Shadowdark's six ability keys, as used by `rollConfigGenerators.check`. */
export const ABILITY_KEYS = Object.freeze(["str", "dex", "con", "int", "wis", "cha"]);

/** Localized long name of an ability, falling back to the upper-cased key. */
export function abilityName(ability) {
  const key = String(ability ?? "").toLowerCase();
  const configured = globalThis.CONFIG?.SHADOWDARK?.ABILITIES_LONG?.[key];
  const label = configured ? L(configured) : L(`SHADOWDARK.ability_${key}`);
  return label && label !== `SHADOWDARK.ability_${key}` ? label : key.toUpperCase();
}

/** Roll-config key carrying what the target is resisting; read by the chat layer. */
export const SAVE_META_KEY = "gtNpcSave";

/**
 * Roll a Shadowdark ability check for `actor` against a DC, through the
 * system's own generator so the card, tint and reroll controls all apply.
 * Returns the RollSD result, or null when the actor cannot make checks or the
 * player closed an interactive prompt. `requestId` ties the resulting card to
 * the save-request message it answers.
 */
export async function rollAbilitySave(
  actor, { ability, dc, rollMode, title, heading, resisting, interactive = false, requestId = null } = {}
) {
  const generator = actor?.system?.rollConfigGenerators?.check;
  const stat = String(ability ?? "").toLowerCase();
  if (typeof generator !== "function" || !ABILITY_KEYS.includes(stat)) return null;
  const difficulty = Math.max(1, Math.floor(Number(dc) || 1));
  const config = {
    actorUuid: actor.uuid,
    check: { stat },
    title: title ?? L("GTNPCMULTIATTACK.Saves.Title"),
    heading: heading ?? (resisting
      ? F("GTNPCMULTIATTACK.Saves.HeadingResisting", { ability: abilityName(stat), dc: difficulty, resisting })
      : F("GTNPCMULTIATTACK.Saves.Heading", { ability: abilityName(stat), dc: difficulty })),
    rollMode
  };
  if (resisting || requestId) config[SAVE_META_KEY] = { resisting: resisting ?? "", title: title ?? "", requestId };
  generator(config);
  config.mainRoll ??= {};
  config.mainRoll.dc = difficulty;
  // An interactive save goes through the system's roll prompt so the player
  // can pick advantage or a roll mode; closing it rolls nothing.
  if (interactive && typeof shadowdark?.dice?.rollDialog === "function") {
    if (!await shadowdark.dice.rollDialog(config)) return null;
    config.mainRoll.dc = difficulty;
  }
  if (!await Hooks.call("SD-Stat-Check", config)) return null;
  return shadowdark.dice.rollFromConfig(config);
}

export const abilitySavesTestApi = Object.freeze({ abilityName });
