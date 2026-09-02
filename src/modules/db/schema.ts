// Table definitions match REQUIREMENTS.md section 3.2.
// SQLite has no native BOOLEAN/JSON types: booleans are stored as INTEGER 0/1,
// JSON blobs are stored as TEXT and (de)serialized in the service layer.
export const SCHEMA_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS evidence_projects (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    collection_key TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    settings TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS item_sources (
    id INTEGER PRIMARY KEY,
    project_id INTEGER NOT NULL,
    item_key TEXT NOT NULL,
    source_database TEXT NOT NULL,
    imported_at TEXT NOT NULL,
    original_record TEXT,
    is_duplicate_of TEXT,
    FOREIGN KEY (project_id) REFERENCES evidence_projects(id)
  )`,
  `CREATE TABLE IF NOT EXISTS screening_criteria (
    id INTEGER PRIMARY KEY,
    project_id INTEGER NOT NULL,
    stage TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    criteria TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (project_id) REFERENCES evidence_projects(id)
  )`,
  `CREATE TABLE IF NOT EXISTS codebooks (
    id INTEGER PRIMARY KEY,
    project_id INTEGER NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    locked INTEGER NOT NULL DEFAULT 0,
    variables TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (project_id) REFERENCES evidence_projects(id)
  )`,
  `CREATE TABLE IF NOT EXISTS screening_records (
    id INTEGER PRIMARY KEY,
    project_id INTEGER NOT NULL,
    item_key TEXT NOT NULL,
    stage TEXT NOT NULL,
    criteria_id INTEGER,
    fulltext_ready INTEGER NOT NULL DEFAULT 0,
    fulltext_ready_at TEXT,
    fulltext_ready_by TEXT,
    decision TEXT,
    exclusion_reason TEXT,
    annotation_key TEXT,
    pending_position TEXT,
    ai_decision TEXT,
    ai_reasoning TEXT,
    human_decision TEXT,
    human_reasoning TEXT,
    decided_by TEXT,
    decided_at TEXT,
    FOREIGN KEY (project_id) REFERENCES evidence_projects(id),
    FOREIGN KEY (criteria_id) REFERENCES screening_criteria(id)
  )`,
  `CREATE TABLE IF NOT EXISTS coding_records (
    id INTEGER PRIMARY KEY,
    project_id INTEGER NOT NULL,
    codebook_id INTEGER NOT NULL,
    item_key TEXT NOT NULL,
    annotation_key TEXT,
    pending_position TEXT,
    variable_name TEXT,
    variable_value TEXT,
    page_number INTEGER,
    quote TEXT,
    is_pilot INTEGER NOT NULL DEFAULT 0,
    source TEXT,
    confirmed INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (project_id) REFERENCES evidence_projects(id),
    FOREIGN KEY (codebook_id) REFERENCES codebooks(id)
  )`,
  // Synthesis themes deliberately live in their own table rather than a
  // column on coding_records: that table is shared by every other coding
  // flow, and this feature is layered entirely on top of it (one row per
  // coding_records id that's been through a Synthesis run) -- keeping it
  // separate means Synthesis can never risk that shared table's shape or
  // existing data, and this table only needs a plain CREATE TABLE IF NOT
  // EXISTS (see database.ts), not an ALTER-TABLE column migration.
  `CREATE TABLE IF NOT EXISTS synthesis_themes (
    id INTEGER PRIMARY KEY,
    coding_record_id INTEGER NOT NULL UNIQUE,
    theme TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (coding_record_id) REFERENCES coding_records(id)
  )`,
  // One row per callChatCompletion() call (aiClient.ts), recorded right
  // after the HTTP response is parsed there -- the single choke point every
  // AI-calling feature (TA/FT-Screening, Coding, Synthesis) already goes
  // through. provider_id/provider_name/model are a snapshot at call time,
  // not a live reference: providers live in prefs (providerConfig.ts), not
  // this DB, and can be renamed/deleted later without invalidating history.
  `CREATE TABLE IF NOT EXISTS ai_usage_log (
    id INTEGER PRIMARY KEY,
    created_at TEXT NOT NULL,
    provider_id TEXT NOT NULL,
    provider_name TEXT NOT NULL,
    model TEXT NOT NULL,
    purpose TEXT NOT NULL,
    prompt_tokens INTEGER NOT NULL DEFAULT 0,
    completion_tokens INTEGER NOT NULL DEFAULT 0,
    total_tokens INTEGER NOT NULL DEFAULT 0
  )`,
  // One row per human-human consistency round (humanConsistencyService.ts).
  // `phase` is 'pilot' (a sampled subset, drawn from the stage's queue
  // collection) or 'full' (the remaining not-yet-decided items once the
  // pilot round is reconciled); `status` walks 'sampled' -> 'collected' ->
  // 'reconciled' as the two reviewers' CSVs come back and get resolved.
  // `item_keys` is a JSON array frozen at round-start time, so items added
  // to the project afterward don't retroactively change what this round
  // covers. Kept (not deleted) once reconciled, as a history of past
  // rounds -- the "active" round for a project/stage is just the latest.
  `CREATE TABLE IF NOT EXISTS consistency_rounds (
    id INTEGER PRIMARY KEY,
    project_id INTEGER NOT NULL,
    stage TEXT NOT NULL,
    phase TEXT NOT NULL,
    status TEXT NOT NULL,
    item_keys TEXT NOT NULL,
    reviewer_a_csv_path TEXT,
    reviewer_b_csv_path TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (project_id) REFERENCES evidence_projects(id)
  )`,
  // One row per eligibility-criterion check for one item at the full-text
  // stage (ftCriterionCheckService.ts) -- replaces the old single
  // decision+exclusion_reason model on screening_records with a checklist:
  // every inclusion criterion gets a row (verdict='include' if satisfied,
  // 'exclude' if not), while an exclusion criterion only gets a row when it
  // actually applies (always verdict='exclude'; a non-applicable exclusion
  // criterion is simply never written). screening_records.decision stays
  // the final human roll-up call; this table is the per-criterion detail
  // and evidence backing it.
  `CREATE TABLE IF NOT EXISTS ft_criterion_checks (
    id INTEGER PRIMARY KEY,
    project_id INTEGER NOT NULL,
    item_key TEXT NOT NULL,
    criterion_type TEXT NOT NULL,
    criterion_text TEXT NOT NULL,
    verdict TEXT NOT NULL,
    reasoning TEXT,
    quote TEXT,
    annotation_key TEXT,
    pending_position TEXT,
    source TEXT NOT NULL DEFAULT 'ai',
    confirmed INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (project_id) REFERENCES evidence_projects(id)
  )`,
  // One free-text analytic memo per project+item, written by the human
  // during Full-Text Coding once they've reviewed the AI's suggestions and
  // formed their own understanding of the paper -- deliberately NOT tied to
  // any single Codebook variable/coding_records row (a coding decision),
  // and deliberately NOT exported alongside coding/synthesis data (by
  // request -- this is the researcher's own working notes, not a data
  // column). One row per item, overwritten in place on every save (no
  // version history, unlike coding_records/screening_records -- there's no
  // "decision" here to keep an audit trail of, just current thinking).
  `CREATE TABLE IF NOT EXISTS coding_notes (
    id INTEGER PRIMARY KEY,
    project_id INTEGER NOT NULL,
    item_key TEXT NOT NULL,
    note TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(project_id, item_key),
    FOREIGN KEY (project_id) REFERENCES evidence_projects(id)
  )`,
  // One row per item that was part of a human-human consistency round
  // (humanConsistencyService.ts) -- a snapshot of what each reviewer's own
  // CSV said, written when the round's "apply agreed results" step runs
  // (both for items it auto-applied and ones left disagreeing). Purely for
  // display: taQueuePane.ts reads this to show both reviewers'
  // verdicts next to a still-pending, disagreed item, so whoever screens
  // it next (a third opinion, or the coordinator) has that context without
  // needing to go find and re-open the two CSVs. One row per project+item
  // -- like coding_notes, overwritten in place if a later round somehow
  // covers the same item again, no version history needed for a snapshot.
  `CREATE TABLE IF NOT EXISTS consistency_item_results (
    id INTEGER PRIMARY KEY,
    project_id INTEGER NOT NULL,
    item_key TEXT NOT NULL,
    round_id INTEGER NOT NULL,
    a_reviewer TEXT,
    a_verdict TEXT,
    a_exclusion_reason TEXT,
    b_reviewer TEXT,
    b_verdict TEXT,
    b_exclusion_reason TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(project_id, item_key),
    FOREIGN KEY (project_id) REFERENCES evidence_projects(id)
  )`,
];

// Tables from removed features. Dropped unconditionally (idempotent) on
// every init rather than left orphaned in existing dev databases -- none
// of the tables above have a foreign key into any of these, so this is
// safe. `coding_records.is_pilot` and `codebooks.locked` stay in their
// CREATE TABLE statements above unchanged: those columns are also read/
// written by ordinary (non-pilot, non-lock) coding flows, and the
// ADD-COLUMN-only migration pattern below doesn't support dropping a
// column from a shared table.
//
// Order matters: real Zotero enforces foreign keys (the test harness's
// SQLite doesn't), so a child table with a FK into a parent must be
// dropped before that parent -- consistency_records/consistency_summary
// both reference pilot_rounds(id), so they're listed first.
export const DROPPED_TABLES: string[] = [
  "consistency_records",
  "consistency_summary",
  "pilot_rounds",
];

// Columns added to tables after their original CREATE TABLE shipped.
// `CREATE TABLE IF NOT EXISTS` above only helps brand-new databases -- an
// existing database (e.g. a dev profile from before this column existed)
// keeps its old shape unless explicitly migrated. database.ts checks each
// of these via PRAGMA table_info and ALTER TABLE ADD COLUMN if missing.
export const COLUMN_MIGRATIONS: {
  table: string;
  column: string;
  definition: string;
}[] = [
  { table: "screening_records", column: "annotation_key", definition: "TEXT" },
  {
    table: "screening_records",
    column: "pending_position",
    definition: "TEXT",
  },
  { table: "coding_records", column: "pending_position", definition: "TEXT" },
  // Nullable, not backfilled here on purpose: every project created before
  // this column existed lived in the personal library by definition (group-
  // library support didn't exist yet), so the service layer's read path
  // (projectManager.ts's rowToProject) treats a NULL here as
  // Zotero.Libraries.userLibraryID rather than needing a data migration.
  { table: "evidence_projects", column: "library_id", definition: "INTEGER" },
  // Snapshotted at judgment time (same reasoning as ai_usage_log's
  // provider/model columns in schema.ts above): the active provider's
  // model can be renamed or switched later without rewriting history, so
  // this must be captured when ai_decision is written, not looked up live.
  // Nullable/not backfilled -- rows written before this column existed
  // simply have no recorded model.
  { table: "screening_records", column: "ai_model", definition: "TEXT" },
  // Same reasoning as screening_records.ai_model just above, but this one
  // was missed when ft_criterion_checks was introduced -- FT-Screening's
  // per-criterion AI checks never recorded which model produced them, so
  // refreshAggregate() below had nothing to snapshot back onto
  // screening_records.ai_model either, leaving FT-stage rows in the
  // Export Screening Log with an empty ai_model while TA-stage rows (which
  // always had it) did not.
  { table: "ft_criterion_checks", column: "model", definition: "TEXT" },
];
