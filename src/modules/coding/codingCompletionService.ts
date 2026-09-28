/**
 * "Coding complete" flagging (issue #9), same tag-based approach as
 * keyLiteratureService.ts/disagreementFlagService.ts: a plain colored
 * Zotero tag rather than a new DB column. Two reasons, mirroring those
 * services' own:
 *
 * 1. It makes a fully-coded item visually stand out in Zotero's OWN items
 *    list (a colored square next to the title, in every list the item
 *    appears in) without reimplementing item-tree row rendering, which
 *    isn't a supported plugin API.
 * 2. It's what turns "filter items by completion status" (the issue's
 *    other ask) into something Zotero already does for free: the sidebar
 *    tag selector filters TO items carrying this tag (i.e. "completed");
 *    for "incomplete", a Saved Search with a "Tag / does not contain" /
 *    this tag name condition covers the inverse -- both built on the exact
 *    same tag, so there's no need for a second "incomplete" tag that would
 *    otherwise put a colored dot on every not-yet-finished item (most of
 *    them, for most of a project's life) purely to make the inverse
 *    clickable in the sidebar too.
 *
 * Completion itself (isCodingComplete in codingService.ts: every REQUIRED
 * Codebook variable has a confirmed, non-empty value) is always computed
 * live from coding_records -- this tag is only ever a cached mirror of
 * that, synced from codingPane.ts every time its render functions run (on
 * open, and after every add/confirm/unconfirm/edit/delete action, since
 * all of those already trigger a rerender). An item that changed via a
 * path that never re-renders the pane -- bulk archive restore being the
 * one real example (archiveImportService.ts inserts coding_records rows
 * directly) -- simply keeps whatever tag state it had (usually none) until
 * the next time its Coding pane is actually opened or browsed; the live
 * completion check itself is never stale, only this convenience tag can
 * lag, and only for items nobody has looked at since.
 *
 * The color is assigned once per library the first time it's needed
 * (Zotero.Tags.setColor is additive -- it only ever adds/updates this
 * tag's own color entry, never touches the user's other colored tags).
 */
const CODING_COMPLETE_TAG = "✅ Coding Complete (Evidence)";
const CODING_COMPLETE_COLOR = "#2e7d32";

export function isCodingCompleteTag(item: Zotero.Item): boolean {
  return item.hasTag(CODING_COMPLETE_TAG);
}

async function ensureTagColor(libraryID: number): Promise<void> {
  if (Zotero.Tags.getColor(libraryID, CODING_COMPLETE_TAG)) return;
  const position = Zotero.Tags.getColors(libraryID).size;
  await Zotero.Tags.setColor(
    libraryID,
    CODING_COMPLETE_TAG,
    CODING_COMPLETE_COLOR,
    position,
  );
}

/**
 * Sets or clears the tag to match `complete`. `complete: null` means "not
 * applicable" (the Codebook has no required variables at all, so there's
 * nothing meaningful to call complete/incomplete) and always clears the
 * tag, the same as `false` -- a Codebook edited to drop its last required
 * variable must not leave a stale "complete" tag behind from before.
 */
export async function syncCodingCompleteTag(
  item: Zotero.Item,
  complete: boolean | null,
): Promise<void> {
  if (complete) {
    await ensureTagColor(item.libraryID);
    item.addTag(CODING_COMPLETE_TAG);
  } else {
    item.removeTag(CODING_COMPLETE_TAG);
  }
  await item.saveTx();
}
