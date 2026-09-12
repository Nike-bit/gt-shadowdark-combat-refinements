import { MODULE_ID } from "./lib/dom.mjs";

// Keep the established setting key so existing client preferences survive the
// broader Quick Attack/Spell/Ability use introduced after v0.16.0.
export const TOOLTIP_HOVER_DELAY_SETTING = "quickSpellHoverDelay";

export function tooltipHoverDelayMs(
  value = game.settings.get(MODULE_ID, TOOLTIP_HOVER_DELAY_SETTING)
) {
  const seconds = Number(value);
  const normalized = Number.isFinite(seconds) ? seconds : 0.5;
  return Math.round(Math.min(10, Math.max(0, normalized)) * 1000);
}

export function calculateTooltipLeft(
  paletteRect,
  previewWidth,
  viewportWidth,
  scaleX = 1,
  margin = 8
) {
  const scale = Math.max(0.01, Number(scaleX) || 1);
  const width = Math.max(0, Number(previewWidth) || 0);
  const viewport = Math.max(0, Number(viewportWidth) || 0);
  const edge = Math.max(0, Number(margin) || 0);
  const paletteLeft = Number(paletteRect?.left) || 0;
  const paletteWidth = Math.max(0, Number(paletteRect?.width) || 0);
  const desiredViewportLeft = paletteLeft + ((paletteWidth - width) / 2);
  const maximumViewportLeft = Math.max(edge, viewport - width - edge);
  const clampedViewportLeft = Math.min(maximumViewportLeft, Math.max(edge, desiredViewportLeft));
  return (clampedViewportLeft - paletteLeft) / scale;
}

export function positionTooltipAbove(palette, preview, { gap = 8, margin = 8 } = {}) {
  if (!palette?.getBoundingClientRect || !preview?.getBoundingClientRect) return;
  const paletteRect = palette.getBoundingClientRect();
  const scaleX = palette.offsetWidth ? paletteRect.width / palette.offsetWidth : 1;
  const scaleY = palette.offsetHeight ? paletteRect.height / palette.offsetHeight : 1;
  const viewportWidth = globalThis.innerWidth ?? document.documentElement?.clientWidth ?? 0;
  const availableHeight = Math.max(64, (
    (Number(paletteRect.top) || 0) - Math.max(0, Number(gap) || 0) - Math.max(0, Number(margin) || 0)
  ) / Math.max(0.01, Number(scaleY) || 1));

  preview.classList.remove("opens-left");
  preview.style.top = "auto";
  preview.style.right = "auto";
  preview.style.bottom = `calc(100% + ${Math.max(0, Number(gap) || 0)}px)`;
  preview.style.maxHeight = `${Math.min(preview.offsetHeight || availableHeight, availableHeight)}px`;
  const previewRect = preview.getBoundingClientRect();
  preview.style.left = `${calculateTooltipLeft(
    paletteRect,
    previewRect.width,
    viewportWidth,
    scaleX,
    margin
  )}px`;
}
