// Ties the quote locator to a real Zotero PDF annotation. The
// `createHighlightAnnotation`-equivalent below is loosely modeled on
// beaver-zotero's function of the same name (AGPL-3.0), adapted to this
// project's simpler geometry/worker pipeline -- see annotationGeometry.ts
// and quoteLocator.ts.
import { mupdfWorkerClient } from "./mupdfWorkerClient";
import { locateQuoteInPage, type LocatedQuote } from "./quoteLocator";

async function readPdfBytes(
  attachment: Zotero.Item,
): Promise<ArrayBuffer | null> {
  const path = await attachment.getFilePathAsync();
  if (!path) return null;
  const bytes = await IOUtils.read(path);
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

/** Search every page of a PDF attachment for `quote`, stopping at the first
 * hit. Returns null (never throws) if the file can't be read or the quote
 * isn't found anywhere -- callers treat that as "fall back to manual". */
export async function locateQuoteInAttachment(
  attachment: Zotero.Item,
  quote: string,
): Promise<LocatedQuote | null> {
  if (!quote.trim()) return null;
  const pdfData = await readPdfBytes(attachment);
  if (!pdfData) return null;

  const pageCount = await mupdfWorkerClient.getPageCount(pdfData);
  for (let i = 0; i < pageCount; i++) {
    const page = await mupdfWorkerClient.extractPage(pdfData, i);
    const located = locateQuoteInPage(page, i, quote);
    if (located) return located;
  }
  return null;
}

/**
 * Create the real Zotero highlight annotation for an already-located quote.
 * `text` becomes annotationText -- the highlighted passage itself, shown as
 * the quote in Zotero's own reader-sidebar annotation list -- and `comment`
 * (optional) becomes annotationComment, the small note shown alongside it;
 * callers use that for "{variable}: {value}"-style context so the list
 * entry isn't just a bare quote with no indication of what it was coded/
 * decided as.
 */
export async function createLocatedHighlight(
  attachment: Zotero.Item,
  located: LocatedQuote,
  color: string,
  text: string,
  comment?: string,
): Promise<string> {
  const annotation = new Zotero.Item("annotation");
  annotation.libraryID = attachment.libraryID;
  (annotation as any).parentID = attachment.id;
  (annotation as any).annotationType = "highlight";
  (annotation as any).annotationText = text;
  (annotation as any).annotationColor = color;
  if (comment) (annotation as any).annotationComment = comment;
  (annotation as any).annotationPosition = JSON.stringify({
    pageIndex: located.pageIndex,
    rects: located.rects,
  });
  (annotation as any).annotationSortIndex = located.sortIndex;
  await annotation.saveTx();
  return annotation.key;
}

/**
 * Materialize a previously-located-but-not-yet-created highlight (the
 * `pending_position` JSON stashed by generateSuggestions/runAIJudgment)
 * into a real Zotero annotation. Called only once the human has actually
 * confirmed the suggestion/decision -- generation itself only locates
 * (see locateQuoteInAttachment), it never creates anything on its own.
 */
export async function materializePendingHighlight(
  attachment: Zotero.Item,
  pendingPositionJson: string,
  color: string,
  text: string,
  comment?: string,
): Promise<string> {
  const located: LocatedQuote = JSON.parse(pendingPositionJson);
  return createLocatedHighlight(attachment, located, color, text, comment);
}
