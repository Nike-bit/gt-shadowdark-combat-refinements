// Shared Token HUD palette behaviour for the Quick Attack, Quick Spell,
// Quick Ability and Quick Attribute launchers. Before v0.19.2 each launcher
// carried its own byte-identical copy of the positioning maths and its own
// hover-preview timer bookkeeping.

import { MODULE_ID } from "./dom.mjs";
import { positionTooltipAbove } from "../tooltip-hover.mjs";

const previewStates = new WeakMap();

/**
 * Vertical offset, in the palette's own coordinate space, that centres the
 * palette on its Token HUD button while keeping it inside the anchor.
 */
export function calculatePaletteTop(buttonRect, anchorRect, paletteHeight, scaleY = 1) {
  const scale = Math.max(0.01, Number(scaleY) || 1);
  const height = Math.max(0, Number(paletteHeight) || 0);
  const anchorHeight = Math.max(0, Number(anchorRect?.height) || 0) / scale;
  const centered = ((Number(buttonRect?.top) || 0) - (Number(anchorRect?.top) || 0)) / scale
    + ((((Number(buttonRect?.height) || 0) / scale) - height) / 2);
  return Math.max(0, Math.min(centered, Math.max(0, anchorHeight - height)));
}

export function positionPaletteBesideButton(button, palette, column) {
  const anchor = palette.offsetParent ?? column;
  if (!anchor?.getBoundingClientRect || !button?.getBoundingClientRect) return;
  const buttonRect = button.getBoundingClientRect();
  const scaleY = button.offsetHeight ? buttonRect.height / button.offsetHeight : 1;
  palette.style.top = `${calculatePaletteTop(
    buttonRect, anchor.getBoundingClientRect(), palette.offsetHeight, scaleY
  )}px`;
}

export function schedulePalettePosition(button, palette, column) {
  const schedule = globalThis.requestAnimationFrame ?? (callback => callback());
  schedule(() => positionPaletteBesideButton(button, palette, column));
}

/** True when the palette is currently visible, under either HUD implementation. */
export function isPaletteOpen(application, palette) {
  return typeof application?.togglePalette === "function"
    ? palette.classList.contains("active")
    : !palette.hidden;
}

/** Open or close without knowing which HUD implementation is present. */
export function setPaletteOpen(application, palette, button, open) {
  if (typeof application?.togglePalette === "function") {
    application.togglePalette(null);
    if (open) application.togglePalette(palette.dataset.palette, true);
    return;
  }
  palette.hidden = !open;
  palette.classList.toggle("active", open);
  button.classList.toggle("active", open);
}

export function togglePalette(application, palette, button) {
  if (typeof application?.togglePalette === "function") {
    application.togglePalette(palette.dataset.palette);
    return;
  }
  setPaletteOpen(application, palette, button, palette.hidden);
}

export function closePalette(application, palette, button) {
  clearPreview(palette);
  setPaletteOpen(application, palette, button, false);
}

/** Cancel any pending or visible hover preview attached to this palette. */
export function clearPreview(palette) {
  const state = previewStates.get(palette);
  if (!state) return;
  if (state.timer) clearTimeout(state.timer);
  state.element?.remove();
  previewStates.delete(palette);
}

/**
 * Schedule a hover preview. `build` is an async factory returning the element to
 * show; it is only appended if the hover has not been superseded or cancelled.
 */
export function schedulePreview(palette, delayMs, build) {
  clearPreview(palette);
  const state = { timer: null, element: null, cancelled: false };
  previewStates.set(palette, state);
  state.timer = setTimeout(() => {
    state.timer = null;
    void Promise.resolve()
      .then(build)
      .then(element => {
        if (state.cancelled || previewStates.get(palette) !== state || !element) return;
        palette.append(element);
        state.element = element;
        positionTooltipAbove(palette, element);
      })
      .catch(error => {
        console.warn(`${MODULE_ID} | Could not prepare the quick-action preview.`, error);
      });
  }, delayMs);
  return state;
}

/**
 * Re-exported so launchers need only import this module. Note the separate
 * import above: `export { x as y } from` alone creates no local binding, and an
 * earlier version of this file called the re-exported name and threw.
 */
export { positionTooltipAbove as positionPreviewAbove };

/**
 * Top-to-bottom rank of the module's Token HUD buttons. These are ranks, not
 * slots: the buttons are sorted by comparison and re-inserted as one contiguous
 * block, so a disabled launcher simply never enters the DOM and the remaining
 * buttons close up with no gap and no change in relative order.
 */
export const QUICK_BUTTON_ORDER = Object.freeze({
  attribute: 1,
  ability: 2,
  spell: 3,
  attack: 4
});

const ORDER_DATASET_KEY = "gtQuickOrder";
const ORDER_SELECTOR = "[data-gt-quick-order]";

/** Re-sort the module's HUD buttons, carrying each button's palette with it. */
export function orderQuickButtons(column) {
  // Pairs are captured before anything moves, so nextElementSibling is reliable.
  const pairs = Array.from(column?.querySelectorAll?.(ORDER_SELECTOR) ?? [])
    .map(button => {
      const next = button.nextElementSibling;
      return {
        button,
        palette: next?.classList?.contains("palette") ? next : null,
        order: Number(button.dataset[ORDER_DATASET_KEY]) || 0
      };
    })
    .sort((left, right) => left.order - right.order);
  if (!pairs.length) return;
  const anchor = column.querySelector('[data-action="combat"]');
  for (const { button, palette } of pairs) {
    const nodes = palette ? [button, palette] : [button];
    if (anchor) anchor.before(...nodes);
    else column.append(...nodes);
  }
}

/**
 * Insert a launcher's button and palette, then restore the declared order. Each
 * injection re-sorts, so the asynchronous launchers can land in any sequence and
 * still end up where they belong.
 */
export function insertQuickButton(column, button, palette, order) {
  button.dataset[ORDER_DATASET_KEY] = String(order);
  const anchor = column.querySelector('[data-action="combat"]');
  if (anchor) anchor.before(button, palette);
  else column.append(button, palette);
  orderQuickButtons(column);
}
