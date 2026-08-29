// zotero-types has no usable typings for Zotero.Translate/Zotero.Translators
// (both are stubbed `any`), so this module talks to them through `any` casts.
// See REQUIREMENTS.md Phase 1 plan notes for why we drive Zotero's own
// built-in RIS/BibTeX/MEDLINE/PubMed-XML translators instead of hand-parsing
// each format ourselves.

/**
 * Runs Zotero's import Translate architecture against a file, letting
 * Zotero auto-detect the format via its built-in translators.
 */
export async function importItemsFromFile(
  filePath: string,
  libraryID: number,
): Promise<Zotero.Item[]> {
  const ZoteroAny = Zotero as any;
  const ImportTranslate = ZoteroAny.Translate?.Import;
  if (!ImportTranslate) {
    throw new Error(
      "Zotero.Translate.Import is not available in this Zotero build.",
    );
  }

  const translation = new ImportTranslate();
  translation.setLocation(Zotero.File.pathToFile(filePath));

  const itemDoneItems: unknown[] = [];
  translation.setHandler("itemDone", (_obj: unknown, item: unknown) => {
    itemDoneItems.push(item);
  });

  const translators = await translation.getTranslators();
  if (!translators || translators.length === 0) {
    throw new Error(
      `No Zotero import translator recognized this file: ${filePath}`,
    );
  }
  translation.setTranslator(translators[0]);

  if (typeof translation.setLibraryID === "function") {
    translation.setLibraryID(libraryID);
  }

  await translation.translate();

  // `translation.newItems` holds the actually-saved Zotero.Item instances;
  // the objects seen by the `itemDone` handler above are not guaranteed to
  // be full Item instances (see REQUIREMENTS.md Phase 1 plan notes on the
  // Zotero.Translate typing gap).
  const saved = translation.newItems;
  if (
    Array.isArray(saved) &&
    saved.every((it) => typeof it?.getField === "function")
  ) {
    return saved as Zotero.Item[];
  }

  if (
    itemDoneItems.length > 0 &&
    itemDoneItems.every((it: any) => typeof it?.getField === "function")
  ) {
    return itemDoneItems as Zotero.Item[];
  }

  const sample = itemDoneItems[0] as any;
  throw new Error(
    "Zotero.Translate.Import did not yield usable Zotero.Item instances. " +
      `newItems=${JSON.stringify(saved)?.slice(0, 200)} ` +
      `itemDoneSampleKeys=${sample ? Object.keys(sample).join(",") : "(none)"} ` +
      `itemDoneSampleCtor=${sample?.constructor?.name}`,
  );
}
