// Not every item type has every field (e.g. some types have no DOI field at
// all) -- Zotero's getField() throws in that case rather than returning "".
// Any field we read speculatively should degrade to "absent" instead of
// crashing whatever loop is processing a batch of items.
export function safeGetField(item: Zotero.Item, field: string): string {
  try {
    return (item.getField(field) as string) || "";
  } catch {
    return "";
  }
}
