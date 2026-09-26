/**
 * "Key literature" flagging (REQUIREMENTS: none yet -- added by request):
 * a plain manual Zotero tag rather than a new DB table. Two reasons:
 *
 * 1. It's the only way to make a flagged item visually stand out in
 *    Zotero's OWN items list (the request: a subtle highlight visible in
 *    the Extract Coding collection) without reimplementing item-tree row
 *    rendering, which isn't a supported plugin API -- Zotero's native
 *    "colored tag" feature already does exactly this (tints the item's
 *    title in every list the item appears in, not just Extract Coding;
 *    Zotero doesn't support per-collection-only styling, so that's the
 *    closest achievable match to "highlight in the collection").
 * 2. hasTag()/addTag()/removeTag() are already synchronous, real-time,
 *    and don't need a project_id scope -- "this is important literature"
 *    is a property of the item itself, not a per-project fact, so a
 *    shared tag name across every Evidence project in the library is
 *    correct, not a limitation.
 *
 * The color is assigned once per library the first time it's needed
 * (Zotero.Tags.setColor is additive -- it only ever adds/updates this
 * tag's own color entry, never touches the user's other colored tags).
 */
const KEY_LITERATURE_TAG = "⭐ Key Literature (Evidence)";
const KEY_LITERATURE_COLOR = "#e5a50a";

export function isKeyLiterature(item: Zotero.Item): boolean {
  return item.hasTag(KEY_LITERATURE_TAG);
}

async function ensureTagColor(libraryID: number): Promise<void> {
  if (Zotero.Tags.getColor(libraryID, KEY_LITERATURE_TAG)) return;
  const position = Zotero.Tags.getColors(libraryID).size;
  await Zotero.Tags.setColor(
    libraryID,
    KEY_LITERATURE_TAG,
    KEY_LITERATURE_COLOR,
    position,
  );
}

export async function setKeyLiterature(
  item: Zotero.Item,
  flagged: boolean,
): Promise<void> {
  if (flagged) {
    await ensureTagColor(item.libraryID);
    item.addTag(KEY_LITERATURE_TAG);
  } else {
    item.removeTag(KEY_LITERATURE_TAG);
  }
  await item.saveTx();
}
