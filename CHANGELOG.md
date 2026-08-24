# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versioning
follows [SemVer](https://semver.org/).

## [Unreleased]

## [0.1.3] - 2026-08-24

### Added
- CI on Node 20, 22, and 24 (typecheck, lint, format check, test, build) on every push and pull
  request.
- `outputSchema` on every tool — `get_study_set`, `update_study_set`, `notify_learner`, and
  `delete_study_set` previously shipped without one.
- A provenance-signed npm publish workflow, triggered by a GitHub Release.
- Network-layer tests for `HttpVocabitClient`: request building, error-body parsing (including a
  non-JSON body and one with no `detail` field), and timeout handling against a mocked `fetch`.
- ESLint and Prettier, wired into CI.
- `CHANGELOG.md` and `SECURITY.md`. GitHub private vulnerability reporting is now enabled on the repo.

### Changed
- `get_study_set` now returns a formatted summary in its text content instead of a raw
  `JSON.stringify` dump — the only tool that hadn't matched the rest of the surface.

### Fixed
- `SetResults.demoNote` is a declared field on the type now, removing the `as SetResults` cast in
  the demo client and the matching read-side cast in the tool handler.

## [0.1.2] - 2026-08-24

### Fixed
- Registry namespace corrected to `io.github.JohnBilousov/vocabit-mcp` — the MCP Registry grants
  and verifies the namespace case-sensitively, and the lowercase form was rejected on both counts.

## [0.1.1] - 2026-08-24

### Added
- `server.json` for listing on the [MCP Registry](https://registry.modelcontextprotocol.io).

## [0.1.0] - 2026-08-24

Initial release.

### Added
- Eight tools over the Vocabit agent API: `vocabit_health`, `create_study_set`, `list_study_sets`,
  `get_study_set`, `get_set_results`, `update_study_set`, `notify_learner`, `delete_study_set`.
- A listable `vocabit://set/{setId}` resource and a `study-session` prompt.
- Demo mode (`VOCABIT_DEMO=1` or no credentials set): an in-memory `DemoVocabitClient` implementing
  the same interface as the live client, seeded with two study sets and a deterministic simulated
  learner, so the server is runnable with no backend and no key.
