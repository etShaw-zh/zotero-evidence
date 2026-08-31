// zotero-types has no typings for the low-level XPCOM zip-reader
// (Zotero.File.zipDirectory covers writing, but there's no `unzip`
// counterpart), so this talks to it through `any` casts -- same approach
// import/translate.ts already takes for a different untyped Zotero API.
// Contract id and interface match Zotero's own usage in
// chrome/content/zotero/xpcom/storage/storageLocal.js and reader.js.

/**
 * Extracts every file entry in `zipPath` into `destDirPath`, recreating
 * whatever subdirectory structure the zip entries' names imply. Directory
 * entries themselves are skipped -- extracting each file already creates
 * its parent directories on demand, so a separate directory-entry pass
 * would be redundant.
 */
export function unzipToDirectory(zipPath: string, destDirPath: string): void {
  const ComponentsAny = Components as any;
  const zipReader = ComponentsAny.classes[
    "@mozilla.org/libjar/zip-reader;1"
  ].createInstance(ComponentsAny.interfaces.nsIZipReader);
  zipReader.open(Zotero.File.pathToFile(zipPath));
  try {
    const entries = zipReader.findEntries("*");
    while (entries.hasMore()) {
      const entryName: string = entries.getNext();
      const entry = zipReader.getEntry(entryName);
      if (entry.isDirectory) continue;

      const outFile = Zotero.File.pathToFile(destDirPath) as any;
      for (const part of entryName.split("/")) {
        if (part) outFile.append(part);
      }
      const parent = outFile.parent;
      if (parent && !parent.exists()) {
        parent.create(ComponentsAny.interfaces.nsIFile.DIRECTORY_TYPE, 0o755);
      }
      zipReader.extract(entryName, outFile);
    }
  } finally {
    zipReader.close();
  }
}
