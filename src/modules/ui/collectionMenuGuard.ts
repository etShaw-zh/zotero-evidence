import { isProjectOwnedCollectionSync } from "../project/projectContext";
import { getSelectedCollectionIdCompat } from "./paneHelpers";

// Zotero.getString ids buildCollectionContextMenu() (zoteroPane.js) assigns
// to `#zotero-collectionmenu`'s <menuitem> elements, fresh on every
// right-click, matching an internal options array by index -- these are the
// structural-editing ones that would desync a project's fixed Collection
// tree from what resolveProjectCollections() expects by name
// (collectionStructure.ts): renaming/moving/deleting any Collection zotero-
// evidence created, or adding an arbitrary subcollection under one.
const GUARDED_MENU_ITEM_IDS = [
  "newSubcollection",
  "editSelectedCollection", // "Rename Collection"
  "moveCollection", // "Move To…"
  "copyCollection", // "Copy To…"
  "deleteCollection", // "Delete Collection…"
  "deleteCollectionAndItems", // "Delete Collection and Items…"
];

/**
 * Hides those menu items whenever the right-clicked Collection belongs to an
 * Evidence project (root or any descendant -- Sources, its source-database
 * children, TA-/FT-Screening parents, every stage collection). Export/
 * Create Bibliography/Generate Report and everything else stay untouched.
 *
 * Timing: the tree's own context-menu-open handler
 * (onCollectionsContextMenuOpen) awaits buildCollectionContextMenu() --
 * which is what assigns these ids and their default shown/hidden state --
 * BEFORE calling openPopup(), so by the time openPopupAtScreen() fires the
 * native "popupshowing" event this listener reacts to, Zotero's own menu has
 * already been built. This only ever narrows it further, never races it.
 */
export function registerCollectionMenuGuard(win: _ZoteroTypes.MainWindow) {
  const doc = win.document;
  const menu = doc.getElementById("zotero-collectionmenu");
  if (!menu) return;
  menu.addEventListener("popupshowing", (event: Event) => {
    // Nested submenus (Move To/Copy To's own <menupopup>) live inside this
    // element and bubble their own "popupshowing" here too -- only act on
    // the outer collection menu itself.
    if (event.target !== menu) return;
    const ZoteroPaneGlobal = ztoolkit.getGlobal("ZoteroPane");
    const collectionId = getSelectedCollectionIdCompat(ZoteroPaneGlobal);
    if (!isProjectOwnedCollectionSync(collectionId)) return;
    for (const id of GUARDED_MENU_ITEM_IDS) {
      doc.getElementById(id)?.setAttribute("hidden", "true");
    }
  });
}
