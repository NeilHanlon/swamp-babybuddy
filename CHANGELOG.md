# Changelog

All notable changes to `@kneel/babybuddy`. Versions use swamp CalVer
(`YYYY.MM.DD.N`). Dates are the publish date.

## 2026.10.03.2

- Docs: add this CHANGELOG and backfill the model `upgrades` lineage with a
  per-version description for every prior type version. No functional change to
  the model or reports.

## 2026.10.03.1

- **New report `sleep-regression-watch`** — a sustained sleep-regression detector
  (vs. benign nap fragmentation) with an early-warning "watch" tier, a trailing
  baseline, fed-vs-spontaneous wake classification, a longest-stretch trend, and
  a non-diagnostic safety/red-flag layer (AAP safe-sleep reminder + disclaimer).
- **Paginated `sync`** — drains Baby Buddy's 500-record/type cap (all pages,
  descending, with dedup-by-id + per-page retry); `truncated` now signals a real
  >20k overflow, not a cap artifact.
- `EntriesSchema.truncated` is now tolerant (defaults to `false`) so an `entries`
  snapshot persisted before the field existed still parses.
- Model type version → `2026.10.03.1` with an `upgrades` entry.

## 2026.07.18.1

- `stop-timer` backdates a converted entry's end via convert-then-PATCH.
- Methods accept JSON-string object/array inputs (not just native objects).

## 2026.07.10.4

- Timer methods: `start-timer` / `stop-timer` / `rename-timer` / `list-timers`,
  with convert-timer-into-activity.

## 2026.07.10.3

- `delete-entry` / `update-entry` methods (delete is idempotent).
- New reports: `medication` and `weight-trend`.

## 2026.07.10.2

- Per-method logging and a `babybuddy-reachable` live pre-flight check.

## 2026.07.10.1

- Initial release: the `@kneel/babybuddy` model (`sync` + `log-*` methods over
  the Baby Buddy REST API) and the `daily-summary` report, plus the first report
  suite (sleep, feeding, diaper, pumping, temperature, tummy-time). Vault-sourced
  API token; sensitive-tagged and never logged.
