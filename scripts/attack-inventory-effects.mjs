import { L, F, MODULE_ID, escapeHtml } from "./lib/dom.mjs";

export const STOLEN_FOLDER_NAME = "Stolen";
export const STOLEN_FOLDER_COLOR = "#808080";
export const COIN_DENOMINATIONS = Object.freeze(["gp", "sp", "cp"]);

/** Shadowdark's FREE_COIN_CARRY: one slot holds this many coins. */
export function coinsPerSlot() {
  const configured = Number(globalThis.shadowdark?.defaults?.FREE_COIN_CARRY);
  return Number.isFinite(configured) && configured > 0 ? Math.floor(configured) : 100;
}

function physicalItems(actor) {
  const viaSystem = actor?.system?.getPhysicalItems?.();
  if (Array.isArray(viaSystem) || viaSystem?.[Symbol.iterator]) {
    return Array.from(viaSystem).filter(item => Number(item.system?.quantity ?? 1) > 0);
  }
  // Fallback for tests and for any actor model without the system helper.
  return Array.from(actor?.items ?? []).filter(item =>
    item.system?.isPhysical && item.system?.stashed !== true
    && Number(item.system?.quantity ?? 1) > 0);
}

function canUpdate(document) {
  return document?.canUserModify?.(game.user, "update") ?? document?.isOwner ?? false;
}

/**
 * The Items shown in Shadowdark's **Carried Gear** section: physical, not
 * stashed, not equipped, not a gem. The system files treasure Items into this
 * same section, so they are deliberately included.
 */
export function carriedGear(actor) {
  return physicalItems(actor)
    .filter(item => item.system?.equipped !== true && item.system?.isGem !== true);
}

/** Carried gems, which Shadowdark shows in their own sidebar box. */
export function carriedGems(actor) {
  return physicalItems(actor)
    .filter(item => item.system?.equipped !== true && item.system?.isGem === true);
}

/** Coin pools holding at least one coin, as `{ denomination, amount }`. */
export function carriedCoins(actor) {
  const coins = actor?.system?.coins;
  if (!coins) return [];
  return COIN_DENOMINATIONS
    .map(denomination => ({ denomination, amount: Math.floor(Number(coins[denomination]) || 0) }))
    .filter(entry => entry.amount > 0);
}

/** Item types that are never "gear" for Shatter, whatever their other flags. */
const NOT_GEAR_TYPES = Object.freeze(new Set(["Scroll", "Potion", "Wand", "Gem"]));

/**
 * What Shatter may destroy: nonmagical gear on the person — equipped or
 * carried — but never magic items, scrolls, potions, wands, gems or treasure,
 * none of which are "gear".
 */
export function breakableGear(actor) {
  return physicalItems(actor).filter(item =>
    !NOT_GEAR_TYPES.has(item.type)
    && item.system?.isGem !== true
    && item.system?.treasure !== true
    && item.system?.magicItem !== true);
}

export function eligibleGear(actor, mode) {
  if (!actor || !canUpdate(actor)) return [];
  if (mode === "shatter") return breakableGear(actor);
  return [...carriedGear(actor), ...carriedGems(actor)];
}

export function chooseRandomGear(actor, mode, random = Math.random) {
  const eligible = eligibleGear(actor, mode);
  if (!eligible.length) return null;
  const index = Math.min(eligible.length - 1, Math.floor(Math.max(0, random()) * eligible.length));
  return eligible[index];
}

/** True when there is anything at all a theft effect could take. */
export function hasStealableProperty(actor) {
  if (!actor || !canUpdate(actor)) return false;
  return carriedGear(actor).length > 0
    || carriedGems(actor).length > 0
    || carriedCoins(actor).length > 0;
}

async function removeOneItem(item) {
  const quantity = Math.max(1, Math.floor(Number(item.system?.quantity) || 1));
  if (quantity > 1) return item.update({ "system.quantity": quantity - 1 });
  return item.parent.deleteEmbeddedDocuments("Item", [item.id]);
}

const MAX_STOLEN_NOTE_ENTRIES = 20;

/** Keep only the most recent stolen-item blocks so Notes cannot grow forever. */
function trimStolenNotes(notes) {
  const blocks = String(notes).split(/(?=<p><strong>)/);
  if (blocks.length <= MAX_STOLEN_NOTE_ENTRIES) return String(notes);
  return blocks.slice(-MAX_STOLEN_NOTE_ENTRIES).join("");
}

async function appendStolenNote(attacker, sourceActor, bodyHtml, headingText = L("GTNPCMULTIATTACK.Inventory.StolenFrom")) {
  const current = String(attacker.system?.notes ?? "");
  const heading = `${headingText} ${escapeHtml(sourceActor.name)}`;
  const addition = `<p><strong>${heading}</strong></p>${bodyHtml}`;
  await attacker.update(
    { "system.notes": trimStolenNotes(`${current}${addition}`) },
    { render: false }
  );
}

// A single in-flight creation shared by every caller, so two thefts resolving
// back to back cannot each decide the folder is missing and create their own.
let stolenFolderRequest = null;

function findStolenFolder() {
  return Array.from(game.folders ?? []).find(folder =>
    folder.type === "Item" && folder.name === STOLEN_FOLDER_NAME && !folder.folder) ?? null;
}

/**
 * The world's grey "Stolen" Item folder, created on first use. Requires GM
 * permission; returns null rather than throwing when it cannot be made.
 */
export async function stolenItemFolder() {
  const existing = findStolenFolder();
  if (existing) return existing;
  if (stolenFolderRequest) return stolenFolderRequest;
  if (!game.user?.isGM) return null;
  stolenFolderRequest = (async () => {
    // Re-check inside the critical section: an earlier awaited call may have
    // created the folder while this one was queued.
    const raced = findStolenFolder();
    if (raced) return raced;
    return Folder.create({
      name: STOLEN_FOLDER_NAME,
      type: "Item",
      color: STOLEN_FOLDER_COLOR
    });
  })();
  try { return await stolenFolderRequest; }
  catch (error) {
    console.error(`${MODULE_ID} | Could not create the Stolen Item folder.`, error);
    return null;
  }
  finally { stolenFolderRequest = null; }
}

function stolenItemData(source) {
  const itemData = source.toObject();
  delete itemData._id;
  itemData.system ??= {};
  itemData.system.quantity = 1;
  itemData.system.equipped = false;
  itemData.system.stashed = false;
  return itemData;
}

/** How many of a stack a shattering blow ruins: 1dN for a stack of N. */
export async function drawShatterCount(quantity, rollFactory = formula => new Roll(formula)) {
  const stack = Math.max(1, Math.floor(Number(quantity) || 1));
  if (stack === 1) return { count: 1, roll: null };
  const roll = await rollFactory(`1d${stack}`).evaluate();
  return { count: Math.min(stack, Math.max(1, Math.floor(Number(roll.total) || 1))), roll };
}

async function removeItems(item, count) {
  const quantity = Math.max(1, Math.floor(Number(item.system?.quantity) || 1));
  if (count < quantity) return item.update({ "system.quantity": quantity - count });
  return item.parent.deleteEmbeddedDocuments("Item", [item.id]);
}

/**
 * Destroy one piece of gear — or 1dN of a stack of N — and record it on the
 * attacker the way Grab does: an embedded copy of what was ruined, and a Notes
 * entry linking it. No world folder; ruined gear is not loot.
 */
export async function shatterGear(attacker, targetActor, itemId) {
  if (!attacker || !targetActor || !canUpdate(attacker) || !canUpdate(targetActor)) return false;
  const item = targetActor.items?.get?.(itemId)
    ?? Array.from(targetActor.items ?? []).find(value => value.id === itemId);
  if (!item || !breakableGear(targetActor).some(value => value.id === item.id)) return false;

  const { count, roll } = await drawShatterCount(item.system?.quantity);
  const record = stolenItemData(item);
  record.system.quantity = count;
  record.flags ??= {};
  record.flags[MODULE_ID] = { ...(record.flags[MODULE_ID] ?? {}), destroyed: true };
  const [copy] = await attacker.createEmbeddedDocuments("Item", [record]);
  try {
    await removeItems(item, count);
    const label = count > 1 ? `${escapeHtml(copy.name)} ×${count}` : escapeHtml(copy.name);
    await appendStolenNote(
      attacker,
      targetActor,
      `<ul><li>${F("GTNPCMULTIATTACK.Inventory.Destroyed", { link: `@UUID[${copy.uuid}]{${label}}` })}</li></ul>`,
      L("GTNPCMULTIATTACK.Inventory.DestroyedFrom")
    );
  }
  catch (error) {
    await attacker.deleteEmbeddedDocuments("Item", [copy.id]).catch(() => {});
    throw error;
  }
  const chatData = {
    speaker: ChatMessage.getSpeaker({ actor: attacker }),
    author: game.user.id,
    rolls: roll ? [roll] : [],
    content: `<p><strong>${L("GTNPCMULTIATTACK.Presets.ShatterName")}</strong>: ${escapeHtml(F(
      "GTNPCMULTIATTACK.Inventory.Shattered",
      { target: targetActor.name, item: item.name, count }
    ))}</p>`,
    flags: { [MODULE_ID]: { shattered: true } }
  };
  await ChatMessage.create(chatData);
  return { item: copy, count };
}


/**
 * Move one unit of an Item from the target to the attacker.
 *
 * Two copies are made on purpose: an embedded one on the NPC, which is the
 * honest model but which Shadowdark's NPC sheet never renders, and a world Item
 * in the grey "Stolen" folder, which is the copy a GM can actually find.
 */
export async function stealGear(attacker, targetActor, itemId) {
  if (!attacker || !targetActor || !canUpdate(attacker) || !canUpdate(targetActor)) return false;
  const source = targetActor.items?.get?.(itemId)
    ?? Array.from(targetActor.items ?? []).find(value => value.id === itemId);
  if (!source || !eligibleGear(targetActor, "carried").some(value => value.id === source.id)) return false;

  const [carried] = await attacker.createEmbeddedDocuments("Item", [stolenItemData(source)]);
  let archived = null;
  try {
    const folder = await stolenItemFolder();
    if (folder && typeof Item?.create === "function") {
      archived = await Item.create({ ...stolenItemData(source), folder: folder.id });
    }
    await removeOneItem(source);
    const links = [`<li>${F("GTNPCMULTIATTACK.Inventory.StolenCarried", {
      link: `@UUID[${carried.uuid}]{${escapeHtml(carried.name)}}`
    })}</li>`];
    if (archived) {
      links.push(`<li>${F("GTNPCMULTIATTACK.Inventory.StolenArchived", {
        link: `@UUID[${archived.uuid}]{${escapeHtml(archived.name)}}`,
        folder: escapeHtml(STOLEN_FOLDER_NAME)
      })}</li>`);
    }
    await appendStolenNote(attacker, targetActor, `<ul>${links.join("")}</ul>`);
  }
  catch (error) {
    await attacker.deleteEmbeddedDocuments("Item", [carried.id]).catch(() => {});
    await archived?.delete?.().catch(() => {});
    throw error;
  }
  return carried;
}

/**
 * Take up to one slot's worth of coins. Coins are not Items and NPCs have no
 * coin pool, so nothing is created anywhere: the amount is recorded only in the
 * attacker's Notes.
 */
export async function stealCoins(attacker, targetActor, denomination, amount) {
  if (!attacker || !targetActor || !canUpdate(attacker) || !canUpdate(targetActor)) return false;
  if (!COIN_DENOMINATIONS.includes(denomination)) return false;
  const held = Math.floor(Number(targetActor.system?.coins?.[denomination]) || 0);
  const taken = Math.min(held, Math.max(0, Math.floor(Number(amount) || 0)));
  if (taken <= 0) return false;

  await targetActor.update({ [`system.coins.${denomination}`]: held - taken });
  const label = L(`GTNPCMULTIATTACK.Inventory.Coin.${denomination}`);
  await appendStolenNote(
    attacker,
    targetActor,
    `<ul><li>${escapeHtml(F("GTNPCMULTIATTACK.Inventory.StolenCoins", { amount: taken, coin: label }))}</li></ul>`
  );
  return { denomination, amount: taken };
}

export const inventoryEffectsTestApi = Object.freeze({
  breakableGear,
  drawShatterCount,
  carriedCoins,
  carriedGear,
  carriedGems,
  chooseRandomGear,
  coinsPerSlot,
  eligibleGear,
  hasStealableProperty
});
