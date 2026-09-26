# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.9.1] - 2026-09-20

### Added

- Stable item identifiers and multi-step archive recovery.
- Archive support for item sources and stage-specific agreement statistics.

## [0.9.0] - 2026-09-04

### Added

- AI keyword highlighting in title and abstract screening.

### Changed

- Screening panes now fetch current state when rendering.

## [0.8.0] - 2026-09-04

### Changed

- AI reasoning follows the active Zotero locale.

## [0.7.0] - 2026-09-04

### Fixed

- Registered the AI provider settings pane and restored the User Guide action.

## [0.6.0] - 2026-09-03

### Added

- Project Overview pane, AI run tracking, provider-specific concurrency, batch
  runs, and codebook CSV export.

### Fixed

- Batch failure reporting and several dialog and sidebar layout issues.

## [0.5.1] - 2026-09-03

### Added

- Reviewer-disagreement flags with automated tests.

## [0.5.0] - 2026-09-03

### Added

- Human-human screening consistency workflow and multi-reviewer guidance.

### Fixed

- Project pane scoping and safeguards around unconfirmed inclusion and exclusion
  decisions.

## [0.4.0] - 2026-09-02

### Added

- Coding notes, key-literature tools, and codebook-variable deletion.

## [0.3.3] - 2026-09-02

### Added

- DOI fields in coding and synthesis exports.

### Changed

- Full-text criterion checks retain the AI model and refresh annotation choices.

## [0.3.2] - 2026-09-02

### Added

- AI provider presets and configuration migration.

### Fixed

- Provider error handling, reviewer matching, project cleanup, screening
  rollups, and PRISMA export fields.

## [0.3.1] - 2026-09-01

### Fixed

- Zotero 10 collection selection compatibility and consistency/synthesis module
  placement.

## [0.3.0] - 2026-09-01

### Added

- Per-criterion full-text checks, unified screening criteria, human-AI and
  human-human agreement workflows, group-library projects, and attributed
  exports.

### Fixed

- SQLite shutdown handling and project archive restoration into a selected
  library.

## [0.2.0] - 2026-08-31

### Added

- Project archive export and restoration, AI usage tracking, protected project
  collections, and permanent project deletion.

### Fixed

- Evidence-coding layout and sidebar spacing.

## [0.1.0] - 2026-08-31

### Added

- Initial Zotero Evidence workflow for importing and deduplicating literature,
  title/abstract and full-text screening, codebook-driven extraction,
  evidence-linked PDF annotations, thematic synthesis, CSV export,
  localization, and automated tests.

[Unreleased]: https://github.com/etShaw-zh/zotero-evidence/compare/v0.9.1...HEAD
[0.9.1]: https://github.com/etShaw-zh/zotero-evidence/compare/v0.9.0...v0.9.1
[0.9.0]: https://github.com/etShaw-zh/zotero-evidence/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/etShaw-zh/zotero-evidence/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/etShaw-zh/zotero-evidence/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/etShaw-zh/zotero-evidence/compare/v0.5.1...v0.6.0
[0.5.1]: https://github.com/etShaw-zh/zotero-evidence/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/etShaw-zh/zotero-evidence/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/etShaw-zh/zotero-evidence/compare/v0.3.3...v0.4.0
[0.3.3]: https://github.com/etShaw-zh/zotero-evidence/compare/v0.3.2...v0.3.3
[0.3.2]: https://github.com/etShaw-zh/zotero-evidence/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/etShaw-zh/zotero-evidence/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/etShaw-zh/zotero-evidence/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/etShaw-zh/zotero-evidence/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/etShaw-zh/zotero-evidence/releases/tag/v0.1.0
