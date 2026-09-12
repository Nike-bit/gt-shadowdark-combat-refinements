import { carriedCoins, carriedGear, carriedGems, coinsPerSlot } from "./attack-inventory-effects.mjs";
import { F, L, MODULE_ID } from "./lib/dom.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Everything a GM-curated theft may take from one target, grouped the way the
 * Shadowdark character sheet groups it.
 */
export function theftCandidates(actor) {
  const entry = (item, section) => ({
    id: `item:${item.id}`,
    kind: "item",
    section,
    itemId: item.id,
    name: item.name,
    img: item.img,
    quantity: Math.max(1, Math.floor(Number(item.system?.quantity) || 1)),
    value: coinLabel(item.system?.cost)
  });
  const perSlot = coinsPerSlot();
  return [
    ...carriedGear(actor).map(item => entry(item, "gear")),
    ...carriedGems(actor).map(item => entry(item, "gems")),
    ...carriedCoins(actor).map(({ denomination, amount }) => ({
      id: `coin:${denomination}`,
      kind: "coin",
      section: "coins",
      denomination,
      name: L(`GTNPCMULTIATTACK.Inventory.Coin.${denomination}`),
      held: amount,
      // A coin row can never yield more than one slot's worth.
      maximum: Math.min(perSlot, amount)
    }))
  ];
}

function coinLabel(cost) {
  if (!cost) return "";
  return ["gp", "sp", "cp"]
    .filter(denomination => Number(cost[denomination]) > 0)
    .map(denomination => `${Number(cost[denomination])} ${L(`GTNPCMULTIATTACK.Inventory.Coin.${denomination}`)}`)
    .join(" ");
}

/**
 * Pick one entry uniformly at random. Highlighting a single entry resolves
 * directly rather than rolling a pointless 1d1.
 */
export async function drawTheftWinner(selected, rollFactory = formula => new Roll(formula)) {
  if (!selected.length) return { entry: null, roll: null, formula: null };
  if (selected.length === 1) return { entry: selected[0], roll: null, formula: null };
  const formula = `1d${selected.length}`;
  const roll = await rollFactory(formula).evaluate();
  const index = Math.min(selected.length, Math.max(1, Math.floor(Number(roll.total) || 1))) - 1;
  return { entry: selected[index], roll, formula };
}

/** Coins taken when a coin row wins: 1d100, capped by what is actually held. */
export async function drawCoinAmount(entry, rollFactory = formula => new Roll(formula)) {
  const perSlot = coinsPerSlot();
  const roll = await rollFactory(`1d${perSlot}`).evaluate();
  const rolled = Math.min(perSlot, Math.max(1, Math.floor(Number(roll.total) || 1)));
  return { amount: Math.min(rolled, entry.held), rolled, roll };
}

/** Right-hand caption for one row: coin count, or value and stack size. */
function entryDetail(entry) {
  if (entry.kind === "coin") {
    return `${L("GTNPCMULTIATTACK.Inventory.CoinHeld")} ${entry.held}`;
  }
  return [entry.value, entry.quantity > 1 ? `×${entry.quantity}` : ""]
    .filter(Boolean)
    .join(" ");
}

const SECTIONS = Object.freeze([
  ["gear", "GTNPCMULTIATTACK.Inventory.Section.Gear"],
  ["gems", "GTNPCMULTIATTACK.Inventory.Section.Gems"],
  ["coins", "GTNPCMULTIATTACK.Inventory.Section.Coins"]
]);

export class GearTheftDialog extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "gt-shadowdark-combat-refinements-gear-theft",
    tag: "form",
    classes: ["gt-npc-ma-gear-theft"],
    position: { width: 520, height: 620 },
    window: {
      icon: "fa-solid fa-hand-holding-hand",
      resizable: true,
      contentClasses: ["standard-form"]
    },
    form: { closeOnSubmit: false, handler: () => undefined },
    actions: {
      toggleEntry: GearTheftDialog.onToggleEntry,
      steal: GearTheftDialog.onSteal,
      stealNothing: GearTheftDialog.onStealNothing
    }
  };

  static PARTS = {
    main: {
      template: `modules/${MODULE_ID}/templates/gear-theft.hbs`,
      scrollable: [".gt-npc-ma-theft-list"]
    }
  };

  constructor({ attacker, target, ruleName, candidates, resolve, ...options } = {}) {
    super(options);
    this.attacker = attacker;
    this.target = target;
    this.ruleName = ruleName;
    this.candidates = candidates;
    this.selected = new Set();
    this._resolve = resolve;
    this._settled = false;
  }

  get title() {
    return F("GTNPCMULTIATTACK.Inventory.TheftTitle", {
      rule: this.ruleName,
      target: this.target?.name ?? ""
    });
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    return {
      ...context,
      ruleName: this.ruleName,
      targetName: this.target?.name ?? "",
      attackerName: this.attacker?.name ?? "",
      hint: F("GTNPCMULTIATTACK.Inventory.TheftHint", { attacker: this.attacker?.name ?? "" }),
      hasSelection: this.selected.size > 0,
      sections: SECTIONS.map(([key, labelKey]) => ({
        key,
        label: L(labelKey),
        entries: this.candidates
          .filter(entry => entry.section === key)
          .map(entry => ({
            ...entry,
            selected: this.selected.has(entry.id),
            detail: entryDetail(entry)
          }))
      })).filter(section => section.entries.length)
    };
  }

  static onToggleEntry(_event, target) {
    const id = target.dataset.entryId;
    if (this.selected.has(id)) this.selected.delete(id);
    else this.selected.add(id);
    return this.render();
  }

  static onSteal() {
    const chosen = this.candidates.filter(entry => this.selected.has(entry.id));
    if (!chosen.length) return;
    this.#settle(chosen);
  }

  static onStealNothing() {
    this.#settle([]);
  }

  #settle(chosen) {
    if (this._settled) return;
    this._settled = true;
    this._resolve?.(chosen);
    void this.close();
  }

  // Closing the window is a real outcome, not an escape hatch: it resolves as
  // "steal nothing", and the caller still posts a record of what happened.
  async close(options) {
    if (!this._settled) {
      this._settled = true;
      this._resolve?.([]);
    }
    return super.close(options);
  }
}

/**
 * Open the picker and resolve with the entries the GM highlighted. Resolves with
 * an empty array when they chose to take nothing or dismissed the window.
 */
export function promptGearTheft({ attacker, target, ruleName, candidates }) {
  return new Promise(resolve => {
    const dialog = new GearTheftDialog({ attacker, target, ruleName, candidates, resolve });
    dialog.render({ force: true });
  });
}

export const gearTheftTestApi = Object.freeze({
  drawCoinAmount,
  drawTheftWinner,
  theftCandidates
});
