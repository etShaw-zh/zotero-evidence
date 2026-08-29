// Ported from beaver-zotero's src/services/annotations/annotationGeometry.ts
// (AGPL-3.0, see addon/content/lib/mupdf-LICENSE), trimmed to the single
// case this project needs: a top-left/Y-down bbox (MuPDF's structured-text
// native frame -- confirmed empirically via test/mupdfWorker.test.ts) ->
// a Zotero PDF annotation rect (`[left, bottom, right, top]`, unrotated PDF
// user space, Y-up). Dropped: the "legacy bottom-left" input variant and
// the display-frame note-placement variant, neither used here.
import type { MupdfPageGeometry } from "./worker/mupdfBridge";

export type TopLeftBox = { l: number; t: number; r: number; b: number };

/** Convert a top-left/Y-down bbox to a Zotero annotation rect [l, bottom, r, top]. */
export function topLeftBoxToZoteroRect(
  bbox: TopLeftBox,
  geometry: MupdfPageGeometry,
): [number, number, number, number] {
  const dx = geometry.viewBox[0];
  const dy = geometry.viewBox[1];
  let l: number, r: number, bottom: number, top: number;
  switch (geometry.rotation) {
    case 90:
      l = bbox.t + dx;
      r = bbox.b + dx;
      bottom = bbox.l + dy;
      top = bbox.r + dy;
      break;
    case 180:
      l = geometry.width - bbox.r + dx;
      r = geometry.width - bbox.l + dx;
      bottom = bbox.t + dy;
      top = bbox.b + dy;
      break;
    case 270:
      l = geometry.width - bbox.b + dx;
      r = geometry.width - bbox.t + dx;
      bottom = geometry.height - bbox.r + dy;
      top = geometry.height - bbox.l + dy;
      break;
    case 0:
    default:
      l = bbox.l + dx;
      r = bbox.r + dx;
      bottom = geometry.height - bbox.b + dy;
      top = geometry.height - bbox.t + dy;
      break;
  }
  return [l, bottom, r, top];
}

/**
 * Zotero PDF annotation sort index, canonical `page|offset|top` format
 * (`^\d{5}\|\d{6}\|\d{5}$`, enforced by Zotero itself). `top` is derived
 * the same way beaver's buildSortIndex does (display-top = viewBox height
 * above the rect's top edge); `offset` falls back to the same display-top
 * value since this project has no backend-supplied reading-order offset.
 */
export function buildSortIndex(
  pageIndex: number,
  geometry: MupdfPageGeometry,
  rect: [number, number, number, number],
): string {
  const clamp = (value: number, max: number): number => {
    if (!Number.isFinite(value)) return 0;
    const floored = Math.floor(value);
    if (floored <= 0) return 0;
    return floored > max ? max : floored;
  };
  const displayTop = clamp(geometry.viewBox[3] - rect[3], 99999);
  const page = clamp(pageIndex, 99999);
  return [
    page.toString().padStart(5, "0"),
    displayTop.toString().padStart(6, "0"),
    displayTop.toString().padStart(5, "0"),
  ].join("|");
}
