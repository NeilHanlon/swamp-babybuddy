# Changelog

All notable changes to `@kneel/babybuddy`. Versions use swamp CalVer
(`YYYY.MM.DD.N`). Dates are the publish date.

## 2026.10.16.1

- **`sleep-regression-watch` detection retune** so a real regression stops
  reading as "watch". These are heuristic/statistical changes; the design
  reasoning was LLM-assisted and has **not** been reviewed by a medical
  professional — the report stays non-diagnostic (see its safety disclaimer):
  - **Wake axis is now TOTAL wakes** vs the child's own baseline. The previous
    fed-vs-spontaneous exclusion blinded the detector for a breastfed infant
    (nearly every waking has a nurse in the gap); fed/spontaneous are kept as
    displayed context only.
  - **Single-axis stretch collapse → `regression`.** A sustained collapse of the
    night longest stretch now flags on its own (variance-aware SEM shift +
    ≥15%/≥45 min magnitude + a ≥3-night soft-floor pattern) — for a child whose
    baseline waking is already high, the wake axis can't register a regression,
    so requiring both axes was the wrong bar.
  - **Baseline onset-guard.** The trailing baseline gap widens to 10 nights and a
    trailing-block trim drops baseline nights already drifting into the onset, so
    a slow-onset regression can't contaminate (and desensitize) its own baseline.
  - **SEM-based wake corroboration.** Elevated wakes (μ + 1.5·SEM) corroborate a
    stretch collapse (concordant two-axis onset) and on their own reach `watch`.
  - OLS trend dropped from the verdict (replaced by a recent-vs-baseline median
    shift, display only); stretch-only run relabeled `night_consolidation_loss`
    (it was mislabeled `nap_fragmentation`, a daytime concept).
- **Opt-in anonymized age band.** `sync --includeAge` reads the child's
  birth_date, coarsens it to a band (`<4mo`…`24mo+`), stores ONLY the band, and
  discards the exact date. Off by default (fully anonymous). The report uses the
  band to tune the absolute floor and add a developmental-window note.
- Model type version → `2026.10.16.1`. Snapshot `ageBand` is tolerant-defaulted
  (pre-existing snapshots parse as age-agnostic); model attributes unchanged.

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
