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
}

export const MANIFEST_FILENAME = "manifest.json";
