# Contributing to Zotero Evidence

Thank you for helping improve Zotero Evidence. Contributions can include bug
reports, feature proposals, documentation improvements, tests, and code.

## Before opening an issue

Search existing issues first. Use the bug form for reproducible defects and the
feature form for proposed capabilities. For support questions, follow
[SUPPORT.md](SUPPORT.md).

## Development setup

Requirements: Node.js and npm, plus a development installation and profile for
Zotero.

```sh
git clone https://github.com/etShaw-zh/zotero-evidence.git
cd zotero-evidence
npm install
cp .env.example .env
```

Set `ZOTERO_PLUGIN_ZOTERO_BIN_PATH` and `ZOTERO_PLUGIN_PROFILE_PATH` in `.env`.
Use a dedicated development profile rather than a profile containing important
research data. Run `npm start` for development with hot reload.

## Making a change

- Keep each change focused and avoid unrelated refactoring.
- Follow the existing TypeScript, localization, and module conventions.
- Add or update tests for changed behavior.
- Update user-facing documentation when behavior or configuration changes.
- Never commit API keys, credentials, copyrighted PDFs, personal data, or
  confidential research materials.

## Validation

Run before submitting a pull request:

```sh
npm run lint:check
npm run build
npm test
```

The test command launches Zotero and therefore requires the executable and
development profile configured above. If a test cannot be run locally, explain
why in the pull request; CI must still pass before merge.

## Pull requests

Open pull requests against `main`. Explain the problem, the chosen solution,
user-visible effects, and how the change was tested. Link relevant issues and
include screenshots for interface changes. By contributing, you agree that
your contribution is licensed under the repository's
[AGPL-3.0-or-later license](LICENSE).

## Sensitive reports

Do not open a public issue for a security, privacy, or other sensitive matter.
Follow the private contact instructions in [SUPPORT.md](SUPPORT.md).
