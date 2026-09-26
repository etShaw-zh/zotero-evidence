// One project's full round-trip snapshot: bibliographic data + PDFs +
// annotations + every DB row this plugin owns for it (REQUIREMENTS: Archive
// & Share -- one-click archive to .zip, later restorable, for peer review).
//
// Zotero item/annotation keys are per-library and get reassigned on import
// (a fresh Zotero.Item has no relationship to the archive's original key),
// so every cross-reference below is expressed via a stable *archive-local*
// identifier instead of a live database id:
//   - items are keyed by their original item `key`
//   - screening_criteria / codebooks are keyed by (stage,) version, since
//     both are already versioned per-project (see criteriaService.ts /
//     codebookService.ts)
//   - coding_records have no natural business key, so they get an
//     archive-local `index` (position in the codingRecords array) that
//     synthesisThemes references
// archiveImportService.ts builds old-key -> new-key/id maps while it
// recreates everything, then rewrites every reference through that map.

export interface ArchiveAnnotation {
  key: string;
  type: string;
  color: string;
  text: string;
  comment: string;
  position: string;
  sortIndex: string;
  pageLabel: string;
}

export interface ArchiveAttachment {
  key: string;
  // Path inside the zip, relative to its root (under files/<item key>/).
  relPath: string;
  title: string;
  contentType: string;
  annotations: ArchiveAnnotation[];
}

export interface ArchiveItem {
  key: string;
  // This plugin's own cross-library-stable id for the item (see
  // stableItemId.ts) -- deliberately a SIBLING of `json`, not a field
  // inside it: it lives only in this plugin's own item_stable_ids table on
  // each side, never in the item's own bibliographic data (Extra field,
  // tags), so it can never collide with Better BibTeX or any other
  // plugin's own use of those fields, or be touched by a user editing the
  // item normally. "" for an item that somehow has none yet (shouldn't
  // happen -- exportProjectArchive always calls ensureStableItemId first).
  stableId: string;
  // Every Collection this item currently belongs to within the project
  // tree, tagged by role (e.g. "sources:Web of Science", "taQueue",
  // "taInclude", ...) -- see archiveExportService.ts's ROLE_* helpers for
  // the full tag list. An item can legitimately carry more than one (e.g.
  // Sources + TA-Screen Queue at once).
  roles: string[];
  // Zotero.Item#toJSON() output -- itemType, title, creators, every
  // bibliographic field. Attachments/collections are handled separately
  // (below / via roles) rather than trusting whatever toJSON() includes for
  // them.
  json: Record<string, unknown>;
  attachments: ArchiveAttachment[];
}

// One row per record identification/dedup pipeline outcome
// (dedupService.ts's processImportedItems): a kept item (isDuplicateOf
// null) or a duplicate that was matched against one and erased
// (isDuplicateOf set to the kept item's own key). `itemKey` for a
// duplicate row refers to an item that no longer exists by the time this
// export runs (it was erased right after this row was first written) --
// there's no live item to attach it to, so it's carried through as inert
// historical data: nothing ever looks it up to find a live item, it only
// ever gets COUNT()'d (see computePrismaData's identification box).
export interface ArchiveItemSource {
  itemKey: string;
  sourceDatabase: string;
  importedAt: string;
  originalRecord: string | null;
  isDuplicateOf: string | null;
}

export interface ArchiveScreeningCriteria {
  stage: "ta" | "ft";
  version: number;
  criteria: string;
  createdAt: string;
}

export interface ArchiveScreeningRecord {
  itemKey: string;
  stage: string;
  // Resolves against ArchiveScreeningCriteria (same `stage`) by version.
  criteriaVersion: number | null;
  fulltextReady: number;
  fulltextReadyAt: string | null;
  fulltextReadyBy: string | null;
  decision: string | null;
  exclusionReason: string | null;
  // Original annotation key -- remapped to the newly recreated annotation.
  annotationKey: string | null;
  pendingPosition: string | null;
  aiDecision: string | null;
  aiReasoning: string | null;
  aiModel: string | null;
  humanDecision: string | null;
  humanReasoning: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
}

export interface ArchiveFtCriterionCheck {
  itemKey: string;
  criterionType: string;
  criterionText: string;
  verdict: string;
  reasoning: string | null;
  quote: string | null;
  // Original annotation key -- remapped to the newly recreated annotation,
  // same as ArchiveScreeningRecord.annotationKey.
  annotationKey: string | null;
  pendingPosition: string | null;
  source: string;
  confirmed: number;
  createdAt: string;
  updatedAt: string;
}

export interface ArchiveCodebook {
  version: number;
  locked: number;
  variables: string;
  createdAt: string;
  updatedAt: string;
}

export interface ArchiveCodingRecord {
  index: number;
  itemKey: string;
  codebookVersion: number;
  annotationKey: string | null;
  pendingPosition: string | null;
  variableName: string | null;
  variableValue: string | null;
  pageNumber: number | null;
  quote: string | null;
  isPilot: number;
  source: string | null;
  confirmed: number;
  createdAt: string;
  updatedAt: string;
}

export interface ArchiveSynthesisTheme {
  codingRecordIndex: number;
  theme: string | null;
  createdAt: string;
  updatedAt: string;
}

// A human-human consistency round (humanConsistencyService.ts), archived
// only alongside a FULL project export (never a scoped sample archive --
// see archiveExportService.ts's exportProjectArchive) since it's the
// coordinator's own bookkeeping, meaningless in a reviewer's independently-
// imported copy. `itemKeys` here are archive-local (the original item
// `key`s, same convention as every other itemKey in this file) --
// importProjectArchive remaps them through its itemKeyMap like everything
// else. reviewerACsvPath/reviewerBCsvPath are intentionally NOT carried
// here: they're local filesystem paths on the machine that ran the round,
// meaningless (and potentially misleading) on whatever machine later
// imports this archive -- see importProjectArchive's own comment.
export interface ArchiveConsistencyRound {
  status: "sampled" | "collected" | "reconciled";
  itemKeys: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ArchiveConsistencyItemResult {
  itemKey: string;
  // Position in the manifest's consistencyRounds array -- same
  // archive-local-index convention as ArchiveSynthesisTheme.codingRecordIndex,
  // since the live round_id it references is a local DB id that gets
  // reassigned on import same as everything else here.
  roundIndex: number;
  aReviewer: string;
  aVerdict: string | null;
  aExclusionReason: string;
  bReviewer: string;
  bVerdict: string | null;
  bExclusionReason: string;
  createdAt: string;
  updatedAt: string;
}

export interface ArchiveManifest {
  formatVersion: 1;
  exportedAt: string;
  project: {
    name: string;
    status: string;
  };
  items: ArchiveItem[];
  screeningCriteria: ArchiveScreeningCriteria[];
  screeningRecords: ArchiveScreeningRecord[];
  // Optional: absent in archives written before this table existed --
  // importProjectArchive treats a missing array as empty, not an error.
  ftCriterionChecks?: ArchiveFtCriterionCheck[];
  codebooks: ArchiveCodebook[];
  codingRecords: ArchiveCodingRecord[];
  synthesisThemes: ArchiveSynthesisTheme[];
  // Optional, same reasoning as ftCriterionChecks -- absent in archives
  // written before human-human consistency rounds were archived at all
  // (importProjectArchive treats a missing array as empty), and always
  // absent from a scoped sample archive (see ArchiveConsistencyRound).
  consistencyRounds?: ArchiveConsistencyRound[];
  consistencyItemResults?: ArchiveConsistencyItemResult[];
  // Optional, same reasoning as ftCriterionChecks -- absent in archives
  // written before item_sources was carried through export/import at all.
  // A project restored from one of those has an empty PRISMA
  // "identification" box (see computePrismaData/isPrismaDataEmpty in
  // screeningExport.ts) even though its screening/eligibility numbers are
  // still real.
  itemSources?: ArchiveItemSource[];
}

export const MANIFEST_FILENAME = "manifest.json";
