import { resolveUuidSync } from "./lib/dom.mjs";

/** Casting difficulty belongs to the Spell Item, never to its target's AC. */
export function spellcastingDifficulty(spell) {
  if (spell?.type !== "Spell" && spell?.system?.isSpell !== true) return null;
  const dc = spell.system?.dc;
  if (dc !== null && dc !== undefined && dc !== "" && Number.isFinite(Number(dc))) {
    return Number(dc);
  }
  const tier = spell.system?.tier;
  return tier !== null && tier !== undefined && tier !== "" && Number.isFinite(Number(tier))
    ? 10 + Number(tier)
    : null;
}

/**
 * Repair the NPC 4.0.6 path: setRollTarget seeds AC before the spell generator
 * uses `dc ??= spell.system.dc`, leaving AC in place. Also used by rerolls so
 * older cards cannot carry that incorrect difficulty into a new roll.
 */
export function prepareSpellcastingDifficulty(config, spell) {
  if (config?.type !== "spell") return null;
  spell ??= resolveUuidSync(config.cast?.spellUuid ?? config.itemUuid, { warn: false });
  const dc = spellcastingDifficulty(spell);
  if (dc === null) return null;
  config.mainRoll ??= {};
  config.mainRoll.dc = dc;
  return dc;
}
