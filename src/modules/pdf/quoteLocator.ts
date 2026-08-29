// Locates an AI-cited quote string within a PDF page's extracted character
// stream and computes the Zotero annotation rects for it. This step has no
// beaver-zotero equivalent to port -- beaver's AI cites by a sentence ID
// resolved on their own backend (see the Phase-6-followup plan's research
// notes), not by searching a raw quote string, so this "plain text -> char
// range -> rects" search is original to this project.
import type { ExtractedLine, ExtractedPage } from "./worker/mupdfWorkerEntry";
import {
  buildSortIndex,
  topLeftBoxToZoteroRect,
  type TopLeftBox,
} from "./annotationGeometry";
import type { QuadTuple } from "./worker/mupdfBridge";

export interface LocatedQuote {
  pageIndex: number;
  rects: [number, number, number, number][];
  sortIndex: string;
}

// AI-generated quotes are typically plain ASCII ("straight" quotes, plain
// hyphens) while PDF text extraction often preserves the source's actual
// typography (curly quotes, en/em dashes). Both sides get folded through
// this same table so a purely-typographic difference doesn't defeat an
// otherwise-exact match. Kept 1-char-in/1-char-out on purpose (see
// buildFlatChars below, which relies on that to stay position-preserving).
const TYPOGRAPHY_FOLD: Record<string, string> = {
  "‘": "'",
  "’": "'",
  "‚": "'",
  "‛": "'",
  "“": '"',
  "”": '"',
  "„": '"',
  "‟": '"',
  "«": '"',
  "»": '"',
  "–": "-",
  "—": "-",
  "−": "-",
};
const TYPOGRAPHY_FOLD_RE = /[‘’‚‛“”„‟«»–—−]/g;

function foldTypography(ch: string): string {
  return TYPOGRAPHY_FOLD[ch] ?? ch;
}

/** Collapse whitespace runs to a single space, fold quote/dash typography
 * variants to their plain-ASCII equivalent, and lowercase -- so line-wrap
 * breaks, multi-space gaps, curly-vs-straight punctuation, and case
 * differences between the AI's quote and the extracted text don't defeat an
 * otherwise-exact match. */
export function normalizeForMatch(s: string): string {
  return s
    .replace(TYPOGRAPHY_FOLD_RE, foldTypography)
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// A line ending in one of these immediately followed by the next line
// starting mid-word is almost always a PDF line-break hyphenation (e.g.
// "informa-" / "tion"), not a real character the AI would quote -- see
// buildFlatChars's dehyphenate pass.
const SOFT_HYPHEN_CHARS = new Set(["-", "‐"]);

function quadToTopLeftBox(quad: QuadTuple): TopLeftBox {
  const [ulx, uly, urx, ury, llx, lly, lrx, lry] = quad;
  return {
    l: Math.min(ulx, llx),
    t: Math.min(uly, ury),
    r: Math.max(urx, lrx),
    b: Math.max(lly, lry),
  };
}

interface FlatChar {
  c: string;
  lineIdx: number;
  quad: QuadTuple | null; // null for the synthetic space inserted between lines
}

// "space" is the original, always-correct-for-non-hyphen-boundaries join.
// The other two only change behavior where a line actually ends in a
// soft-hyphen char, and cover the two different things that can mean:
// "hyphen-join" keeps the hyphen but drops the space, for a real compound
// word split across the line break (e.g. "design-" / "based" ->
// "design-based"); "hyphen-drop" drops the hyphen too, for the PDF's own
// line-wrap hyphenation of a single word (e.g. "informa-" / "tion" ->
// "information", the word an AI would actually quote).
type JoinMode = "space" | "hyphen-join" | "hyphen-drop";

/**
 * Flattens a page's lines into one char stream per `mode` (see JoinMode).
 */
function buildFlatChars(lines: ExtractedLine[], mode: JoinMode): FlatChar[] {
  const flat: FlatChar[] = [];
  lines.forEach((line, lineIdx) => {
    if (lineIdx > 0) {
      const prevLast = lines[lineIdx - 1].chars.at(-1);
      const isSoftHyphen = prevLast && SOFT_HYPHEN_CHARS.has(prevLast.c);
      if (mode !== "space" && isSoftHyphen) {
        if (mode === "hyphen-drop") flat.pop(); // drop the trailing hyphen too
      } else {
        flat.push({ c: " ", lineIdx: -1, quad: null });
      }
    }
    for (const ch of line.chars) flat.push({ c: ch.c, lineIdx, quad: ch.quad });
  });
  return flat;
}

/** Searches one already-flattened char stream for `normalizedQuote`, folding
 * whitespace/typography the same way normalizeForMatch does so the two
 * sides compare on equal footing. */
function matchInFlat(
  flat: FlatChar[],
  normalizedQuote: string,
): { lineIdx: number; box: TopLeftBox }[] | null {
  let normalized = "";
  const normToFlat: number[] = [];
  let pendingSpace = false;
  for (let i = 0; i < flat.length; i++) {
    const ch = flat[i].c;
    if (/\s/.test(ch)) {
      pendingSpace = normalized.length > 0;
      continue;
    }
    if (pendingSpace) {
      normalized += " ";
      normToFlat.push(i);
      pendingSpace = false;
    }
    normalized += foldTypography(ch).toLowerCase();
    normToFlat.push(i);
  }

  const matchStart = normalized.indexOf(normalizedQuote);
  if (matchStart < 0) return null;
  const matchEnd = matchStart + normalizedQuote.length - 1;
  const flatStart = normToFlat[matchStart];
  const flatEnd = normToFlat[matchEnd];

  const boxesByLine = new Map<number, TopLeftBox>();
  const lineOrder: number[] = [];
  for (let i = flatStart; i <= flatEnd; i++) {
    const item = flat[i];
    if (!item.quad || item.lineIdx < 0) continue;
    const box = quadToTopLeftBox(item.quad);
    const existing = boxesByLine.get(item.lineIdx);
    if (!existing) {
      boxesByLine.set(item.lineIdx, box);
      lineOrder.push(item.lineIdx);
    } else {
      existing.l = Math.min(existing.l, box.l);
      existing.t = Math.min(existing.t, box.t);
      existing.r = Math.max(existing.r, box.r);
      existing.b = Math.max(existing.b, box.b);
    }
  }
  if (lineOrder.length === 0) return null;
  return lineOrder.map((lineIdx) => ({
    lineIdx,
    box: boxesByLine.get(lineIdx)!,
  }));
}

/**
 * Pure matching core (no worker/Zotero dependency, unit-testable): given a
 * page's lines-of-chars and a quote, find the char range it corresponds to
 * and return one merged bbox per line it spans. Returns null if the
 * (whitespace/typography-normalized) quote isn't found anywhere on the
 * page. Tries each JoinMode in turn (see buildFlatChars) so a quote that
 * only matches once a line-break hyphen is handled one way or the other
 * still gets found.
 */
export function locateQuoteInLines(
  lines: ExtractedLine[],
  quote: string,
): { lineIdx: number; box: TopLeftBox }[] | null {
  const normalizedQuote = normalizeForMatch(quote);
  if (!normalizedQuote) return null;

  const modes: JoinMode[] = ["space", "hyphen-join", "hyphen-drop"];
  for (const mode of modes) {
    const result = matchInFlat(buildFlatChars(lines, mode), normalizedQuote);
    if (result) return result;
  }
  return null;
}

/** Locate a quote within one already-extracted page and convert to Zotero rects. */
export function locateQuoteInPage(
  page: ExtractedPage,
  pageIndex: number,
  quote: string,
): LocatedQuote | null {
  const matches = locateQuoteInLines(page.lines, quote);
  if (!matches) return null;
  const rects = matches.map((m) =>
    topLeftBoxToZoteroRect(m.box, page.geometry),
  );
  return {
    pageIndex,
    rects,
    sortIndex: buildSortIndex(pageIndex, page.geometry, rects[0]),
  };
}
