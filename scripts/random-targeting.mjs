import { applyMessageMode, escapeHtml, F, L, MODULE_ID } from "./lib/dom.mjs";

export async function drawRandomTargets(targets, attackCount, rollFactory = formula => new Roll(formula)) {
  const pool = Array.from(targets ?? []);
  const count = Math.max(0, Math.floor(Number(attackCount) || 0));
  if (!pool.length || !count) return { pool, formula: null, rolls: [], assignments: [], counts: [] };

  // One roll for the whole allocation. `kdN` has the same distribution as k
  // independent 1dN draws, but produces a single dice animation and one entry
  // in the log instead of k of them.
  const formula = `${count}d${pool.length}`;
  const roll = await rollFactory(formula).evaluate();
  const drawn = Array.from(roll?.dice?.[0]?.results ?? [])
    .filter(result => result?.active !== false)
    .map(result => Number(result.result));
  const rolls = [];
  const assignments = [];
  const counts = pool.map(() => 0);
  for (let index = 0; index < count; index += 1) {
    const raw = Number.isFinite(drawn[index]) ? drawn[index] : 1;
    const result = Math.min(pool.length, Math.max(1, Math.floor(raw)));
    rolls.push(result);
    assignments.push(pool[result - 1]);
    counts[result - 1] += 1;
  }
  return { pool, formula, roll, rolls, assignments, counts };
}

export async function postRandomTargetSummary(config, selection) {
  if (!selection?.pool?.length || !globalThis.ChatMessage) return null;
  const rows = selection.pool.map((target, index) => {
    const count = selection.counts[index] || "";
    return `<li><span><b>${index + 1}.</b> ${escapeHtml(target.name)}</span><strong>${count}</strong></li>`;
  }).join("");
  const content = [
    '<section class="gt-npc-ma-random-summary">',
    `<h3>${escapeHtml(L("GTNPCMULTIATTACK.Random.SummaryTitle"))}</h3>`,
    `<p>${escapeHtml(F("GTNPCMULTIATTACK.Random.RollResults", {
      formula: selection.formula,
      results: selection.rolls.join(", ")
    }))}</p>`,
    `<ol>${rows}</ol>`,
    "</section>"
  ].join("");
  const actor = typeof fromUuid === "function" ? await fromUuid(config.actorUuid) : null;
  const chatData = {
    content,
    flags: {
      "core.canPopout": true,
      [MODULE_ID]: { randomTargetSummary: true }
    },
    speaker: ChatMessage.getSpeaker({ actor }),
    author: game.user.id
  };
  const style = globalThis.CONST?.CHAT_MESSAGE_STYLES?.OTHER;
  if (style !== undefined) chatData.style = style;
  applyMessageMode(chatData, "gm");
  return ChatMessage.create(chatData);
}

export const randomTargetingTestApi = Object.freeze({
  drawRandomTargets,
  escapeHtml
});
