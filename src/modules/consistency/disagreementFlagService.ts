/**
 * "Reviewer disagreement" flagging: a plain colored Zotero tag, same
 * approach as keyLiteratureService.ts's "Key Literature" flag -- the only
 * way to make an item visually stand out in Zotero's OWN items list
 * (specifically TA-Screen Queue, where applyAgreedResults leaves a
 * disagreement pending for a third reviewer -- see
 * humanConsistencyService.ts) without reimplementing item-tree row
 * rendering, which isn't a supported plugin API. The sidebar already shows
 * both reviewers' calls once you open the item (see screenQueuePane.ts),
 * but there was no way to tell WHICH items in a long queue needed that
 * look without opening each one -- Zotero's native colored-tag feature
 * already solves exactly that (a colored square next to the title in
 * every list the item appears in).
 *
 * The color is assigned once per library the first time it's needed
 * (Zotero.Tags.setColor is additive -- it only ever adds/updates this
 * tag's own color entry, never touches the user's other colored tags).
 * Distinct from Key Literature's amber star -- this is a "needs a
 * decision" warning, not an endorsement, so it uses a red/orange more in
 * line with Zotero's own default warning-colored tags.
 */
const DISAGREEMENT_TAG = "⚠ Reviewer Disagreement (Evidence)";
const DISAGREEMENT_COLOR = "#e5462b";

export function isDisagreementFlagged(item: Zotero.Item): boolean {
  return item.hasTag(DISAGREEMENT_TAG);
}

async function ensureTagColor(libraryID: number): Promise<void> {
  if (Zotero.Tags.getColor(libraryID, DISAGREEMENT_TAG)) return;
  const position = Zotero.Tags.getColors(libraryID).size;
  await Zotero.Tags.setColor(
    libraryID,
    DISAGREEMENT_TAG,
    DISAGREEMENT_COLOR,
    position,
  );
}

/**
 * Sets or clears the flag. Safe to call unconditionally either way --
 * removeTag on a tag the item doesn't have is a no-op, and this is exactly
 * what a re-run of applyAgreedResults (an item that WAS a disagreement but
 * isn't anymore) and taScreeningService.ts's confirmDecision (a decision
 * finally got made, resolving whatever disagreement was pending) both
 * need: set the flag to whatever's true right now, no prior-state check.
 */
export async function setDisagreementFlag(
  item: Zotero.Item,
  flagged: boolean,
): Promise<void> {
  if (flagged) {
    await ensureTagColor(item.libraryID);
    item.addTag(DISAGREEMENT_TAG);
  } else {
    item.removeTag(DISAGREEMENT_TAG);
  }
  await item.saveTx();
}
