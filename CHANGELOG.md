# Changelog

All notable changes to this project will be documented in this file.
This project adheres to [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

### Added
- DuckDB-compatible SQL export generator (produces .sql with {{INPUT_PATH}} / {{OUTPUT_PATH}} placeholders).
- RBQL WebView: display mapping between positional column names (a1, a2, ...) and original header names.
- Export action for DuckDB SQL in RBQL console.
- Cleaner, marketplace-ready README and a dedicated ARCHITECTURE.md.
- About panel UI refresh with updated GitHub and LinkedIn links.
- Activation events in package.json to activate on CSV/TSV language and on VizFlow commands.

### Changed
- RBQL results display now shows `Header (aN)` where possible so users can easily reference positional columns.
- README trimmed for Marketplace; architecture details moved to ARCHITECTURE.md.

### Fixed
- ActivationEvents were empty; now properly register onLanguage/onCommand triggers to ensure activation.

## [0.0.1] - YYYY-MM-DD

- Initial public release notes placeholder.


---

How to release
1. Move changes from `Unreleased` to a new version heading (e.g., `## [0.0.1] - 2026-08-09`).
2. Update `package.json` version.
3. Tag the release: `git tag -a v0.0.1 -m "Release v0.0.1"` and push tags.
4. Update this CHANGELOG.md with details of the release.