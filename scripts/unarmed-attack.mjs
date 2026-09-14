import { F, itemList, L, MODULE_ID, resolveUuidSync } from "./lib/dom.mjs";
import { unarmedAttacksEnabled } from "./lib/quick-launch.mjs";

// An unarmed attack has no Item behind it, so the roll config is built here
// and sent down the same road a weapon takes: rollDialog → SD-Player-Attack →
// rollFromConfig. Shadowdark's own generator is not involved, which is why the
// ability and active-effect bonuses are worked out by hand below.

export const UNARMED_ENTRY_ID = "unarmed";
export const UNARMED_CONFIG_KEY = "gtNpcMultiattackUnarmed";
const PLAYER_ACTOR_TYPE = "Player";
const CLASS_TYPE = "Class";
const DEX_CLASSES = ["thief", "dieb", "voleur", "ladrón", "ladron", "ladro", "złodziej", "ladrão", "вор", "hırsız", "盗贼", "シーフ", "κλέφτης"];
const BEST_CLASSES = ["fighter", "kämpfer", "guerrier", "guerrero", "guerriero", "wojownik", "guerreiro", "воин", "savaşçı", "战士", "ファイター", "μαχητής"];

function classNames(actor) {
  const names = itemList(actor)
    .filter(item => item.type === CLASS_TYPE)
    .map(item => String(item.name ?? "").toLocaleLowerCase());
  const linked = resolveUuidSync(actor?.system?.class, { warn: false });
  if (linked?.name) names.push(String(linked.name).toLocaleLowerCase());
  return names;
}

function abilityModifier(actor, key) {
  const mod = Number(actor?.system?.abilities?.[key]?.mod);
  return Number.isFinite(mod) ? mod : 0;
}

/**
 * Which ability an unarmed blow uses: Strength, except that a Thief strikes
 * with Dexterity and a Fighter with whichever of the two is higher.
 */
export function unarmedAbility(actor) {
  const names = classNames(actor);
  const matches = list => names.some(name => list.some(candidate => name.includes(candidate)));
  const str = abilityModifier(actor, "str");
  const dex = abilityModifier(actor, "dex");
  if (matches(DEX_CLASSES)) return { ability: "dex", modifier: dex };
  if (matches(BEST_CLASSES) && dex > str) return { ability: "dex", modifier: dex };
  return { ability: "str", modifier: str };
}

/** Whether this actor gets an Unarmed entry among its attacks. */
export function offersUnarmedAttack(actor) {
  return unarmedAttacksEnabled() && actor?.type === PLAYER_ACTOR_TYPE && actor.isOwner === true;
}

function signed(value) {
  const number = Number(value) || 0;
  return number >= 0 ? `+${number}` : String(number);
}

/** A quick-attack entry shaped like the weapon entries, for palettes and selectors. */
export function unarmedEntry(actor) {
  const { ability, modifier } = unarmedAbility(actor);
  return {
    id: UNARMED_ENTRY_ID,
    unarmed: true,
    actorType: PLAYER_ACTOR_TYPE,
    itemId: null,
    itemUuid: null,
    item: null,
    name: L("GTNPCMULTIATTACK.Unarmed.Name"),
    img: null,
    attackType: "melee",
    typeLabel: L("GTNPCMULTIATTACK.QuickAttack.Melee"),
    attackModifier: signed(modifier),
    damageFormula: "1d2",
    description: F("GTNPCMULTIATTACK.Unarmed.Description", { ability: ability.toUpperCase() }),
    ranges: [L("SHADOWDARK.range.close")],
    qualities: []
  };
}

function formatBonus(value) {
  const format = globalThis.shadowdark?.dice?.formatBonus;
  return typeof format === "function" ? format(value) : (Number(value) ? signed(value) : "");
}

/** Build the roll config for an unarmed attack onto `config`, mutating it. */
export function prepareUnarmedConfig(actor, config = {}) {
  const { ability, modifier } = unarmedAbility(actor);
  config.actorUuid = actor.uuid;
  config.type = "attack";
  config[UNARMED_CONFIG_KEY] = true;
  config.attack = { type: "melee", range: "close", handedness: "oneHanded", unarmed: true };
  globalThis.shadowdark?.dice?.setRollTarget?.(config);
  config.heading = F("SHADOWDARK.dialog.roll_attacking_with", { name: L("GTNPCMULTIATTACK.Unarmed.Name") });
  if (typeof globalThis.shadowdark?.dice?.initializeD20Check === "function") shadowdark.dice.initializeD20Check(config);
  else {
    config.mainRoll ??= {};
    Object.assign(config.mainRoll, { type: "main", base: "d20", canCritical: true });
    config.situational = [];
  }
  config.mainRoll.label = L("SHADOWDARK.roll.attack");
  // The same active-effect keys the weapon generator honours for melee.
  let bonus = modifier;
  let advantage = 0;
  const tooltips = [];
  const keys = typeof actor.system?._getActiveEffectKeys === "function"
    ? (key, base) => actor.system._getActiveEffectKeys(key, base, null, config)
    : null;
  if (keys) {
    try {
      const bonusKey = keys("roll.melee.bonus", modifier);
      bonus = Number(bonusKey?.value ?? modifier);
      if (bonusKey?.tooltips) tooltips.push(bonusKey.tooltips);
      const advantageKey = keys("roll.melee.advantage", 0);
      advantage = Number(advantageKey?.value) || 0;
      if (advantageKey?.tooltips) tooltips.push(advantageKey.tooltips);
    }
    catch (error) {
      console.warn(`${MODULE_ID} | Unarmed attack: active-effect bonuses unavailable.`, error);
    }
  }
  tooltips.unshift(F("GTNPCMULTIATTACK.Unarmed.Tooltip", { ability: ability.toUpperCase(), modifier: signed(modifier) }));
  config.mainRoll.bonus = formatBonus(bonus);
  config.mainRoll.formula = `${config.mainRoll.base}${config.mainRoll.bonus}`;
  config.mainRoll.advantage = advantage;
  config.mainRoll.tooltips = tooltips.filter(Boolean).join(", ");
  config.damageRoll = {
    label: L("SHADOWDARK.roll.damage"),
    base: "1d2",
    formula: "1d2",
    type: "damage"
  };
  return config;
}

/** Roll an unarmed attack through Shadowdark's dialog and roll pipeline. */
export async function rollUnarmedAttack(actor, config = {}) {
  if (!offersUnarmedAttack(actor)) return false;
  prepareUnarmedConfig(actor, config);
  if (!await shadowdark.dice.rollDialog(config)) return false;
  if (!await Hooks.call("SD-Player-Attack", config)) return false;
  const roll = await shadowdark.dice.rollFromConfig(config);
  return roll?.success ?? false;
}

export const unarmedTestApi = Object.freeze({ prepareUnarmedConfig, unarmedAbility, unarmedEntry });
