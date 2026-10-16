/**
 * Shared report logic for the @kneel/babybuddy extension.
 *
 * Pure compute functions (one per report) that turn a `sync` snapshot into
 * markdown + JSON, plus a `runReport` helper that loads the snapshot and hands
 * it to a compute function. Not a report entrypoint itself — it exports no
 * `report`, so the loader skips it and each report file delegates to
 * `runReport`.
 *
 * @module
 */
import {
  aggregateByDate,
  dateFromIso,
  type EntriesSnapshot,
  parseDurationHours,
  parseEntriesSnapshot,
} from "../models/babybuddy.ts";

// ---------------------------------------------------------------------------
// Report wiring
// ---------------------------------------------------------------------------

/** Markdown + JSON produced by a report. */
export interface ReportResult {
  /** Human-readable markdown. */
  markdown: string;
  /** Machine-readable structured data. */
  json: Record<string, unknown>;
}

/** Minimal view of the data repository passed to a report context. */
export interface DataRepository {
  /** Read the raw bytes of a named data artifact (latest version by default). */
  getContent: (
    type: unknown,
    modelId: string,
    dataName: string,
    version?: number,
  ) => Promise<Uint8Array | null> | Uint8Array | null;
}

/** The subset of the swamp report context these reports use. */
export interface ReportContext {
  /** Opaque model type, forwarded to the data repository. */
  modelType: unknown;
  /** Model instance id. */
  modelId: string;
  /** Handle for reading persisted data. */
  dataRepository: DataRepository;
}

/** A swamp report definition. */
export interface ReportDefinition {
  /** Collective-qualified report name. */
  name: string;
  /** One-line human description. */
  description: string;
  /** Report scope (always model scope here). */
  scope: "model";
  /** Filtering labels. */
  labels: string[];
  /** Load the latest snapshot and render the report. */
  execute: (context: ReportContext) => Promise<ReportResult>;
}

/** A pure compute function that renders a snapshot into a report result. */
export type Compute = (entries: EntriesSnapshot) => ReportResult;

/** Load the latest `entries` snapshot and render it with `compute`. */
export async function runReport(
  context: ReportContext,
  compute: Compute,
): Promise<ReportResult> {
  const bytes = await context.dataRepository.getContent(
    context.modelType,
    context.modelId,
    "entries",
  );
  if (!bytes) {
    return {
      markdown:
        "## Report\n\n_No `entries` snapshot found. Run the `sync` method first._",
      json: { error: false, message: "no entries snapshot" },
    };
  }
  return compute(parseEntriesSnapshot(bytes));
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

const BREAST_METHODS = new Set(["left breast", "right breast", "both breasts"]);

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function daysOf(e: EntriesSnapshot): number {
  return Math.max(1, Math.ceil(e.sinceHours / 24));
}

function header(title: string, days: number): string {
  return `## ${title} (last ${days} day${days === 1 ? "" : "s"})`;
}

function empty(title: string, days: number, message: string): ReportResult {
  return {
    markdown: `${header(title, days)}\n\n_${message}_`,
    json: { title, days, empty: true, message },
  };
}

function table(cols: string[], rows: string[][]): string {
  const head = `| ${cols.join(" | ")} |`;
  const sep = `| ${cols.map(() => "---").join(" | ")} |`;
  const body = rows.map((r) => `| ${r.join(" | ")} |`).join("\n");
  return `${head}\n${sep}\n${body}`;
}

/** Format hours as "Hh MMm". */
export function fmtHM(h: number): string {
  const hh = Math.floor(h);
  const mm = Math.floor((h - hh) * 60);
  return `${hh}h ${String(mm).padStart(2, "0")}m`;
}

/** Sum the `amount` field across records, coercing to number. */
export function sumAmount(rows: Array<Record<string, unknown>>): number {
  return rows.reduce((a, r) => a + Number(r.amount ?? 0), 0);
}

/** Count records whose feeding `method` is one of the breast methods. */
function countBreast(rows: Array<Record<string, unknown>>): number {
  return rows.filter((r) => BREAST_METHODS.has(String(r.method))).length;
}

/** One gap between two consecutive entries. */
export interface IntervalPair {
  /** Timestamp of the later entry. */
  time: string;
  /** Hours since the previous entry. */
  gapHours: number;
}

/** Positive gaps (in hours) between consecutive entries, sorted ascending. */
export function intervalPairs(
  rows: Array<Record<string, unknown>>,
  field: string,
): IntervalPair[] {
  const sorted = rows
    .filter((r) => typeof r[field] === "string")
    .map((r) => ({ t: Date.parse(r[field] as string), s: r[field] as string }))
    .filter((x) => !Number.isNaN(x.t))
    .sort((a, b) => a.t - b.t);
  const pairs: IntervalPair[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const gap = (sorted[i].t - sorted[i - 1].t) / 3_600_000;
    if (gap > 0) pairs.push({ time: sorted[i].s, gapHours: round1(gap) });
  }
  return pairs;
}

function intervalStats(
  title: string,
  days: number,
  pairs: IntervalPair[],
  total: number,
  recent: boolean,
): ReportResult {
  const gaps = pairs.map((p) => p.gapHours);
  const avg = round1(gaps.reduce((a, b) => a + b, 0) / gaps.length);
  const shortest = round1(Math.min(...gaps));
  const longest = round1(Math.max(...gaps));
  const lines = [
    header(title, days),
    "",
    `- Average: ${avg}h`,
    `- Shortest: ${shortest}h`,
    `- Longest: ${longest}h`,
    `- Total entries: ${total}`,
  ];
  const recentPairs = recent ? pairs.slice(-10) : [];
  if (recentPairs.length) {
    lines.push("", "Recent intervals:");
    for (const p of recentPairs) lines.push(`- ${p.time}: ${p.gapHours}h`);
  }
  return {
    markdown: lines.join("\n"),
    json: {
      title,
      days,
      avgHours: avg,
      shortestHours: shortest,
      longestHours: longest,
      total,
      recent: recentPairs,
    },
  };
}

// ---------------------------------------------------------------------------
// Report compute functions
// ---------------------------------------------------------------------------

/** Daily sleep hours alongside feeding count and volume. */
export function sleepFeedingCorrelation(e: EntriesSnapshot): ReportResult {
  const title = "Sleep vs. Feeding Correlation";
  const days = daysOf(e);
  const sleepBy = aggregateByDate(e.sleep, "start");
  const feedBy = aggregateByDate(e.feedings, "start");
  const dates = [...new Set([...Object.keys(sleepBy), ...Object.keys(feedBy)])]
    .sort();
  if (!dates.length) {
    return empty(title, days, "No sleep or feeding data found.");
  }
  const rows = dates.map((d) => {
    const sleepH = round1(
      (sleepBy[d] ?? []).reduce(
        (a, s) => a + parseDurationHours(s.duration),
        0,
      ),
    );
    const feeds = (feedBy[d] ?? []).length;
    const volMl = round1(sumAmount(feedBy[d] ?? []));
    return { date: d, sleepH, feeds, volMl };
  });
  const md = `${header(title, days)}\n\n${
    table(
      ["Date", "Sleep (h)", "Feeds", "Volume (ml)"],
      rows.map((r) => [
        r.date,
        String(r.sleepH),
        String(r.feeds),
        r.volMl ? String(r.volMl) : "—",
      ]),
    )
  }`;
  return { markdown: md, json: { title, days, rows } };
}

/** Longest and average sleep stretch per day. */
export function sleepLongestStretch(e: EntriesSnapshot): ReportResult {
  const title = "Longest Sleep Stretch";
  const days = daysOf(e);
  const by = aggregateByDate(e.sleep, "start");
  const dates = Object.keys(by).sort();
  if (!dates.length) return empty(title, days, "No sleep data found.");
  const rows = dates.map((d) => {
    const durs = by[d].map((s) => parseDurationHours(s.duration));
    const longest = Math.max(...durs);
    const avg = durs.reduce((a, b) => a + b, 0) / durs.length;
    return {
      date: d,
      longestH: round2(longest),
      avgH: round2(avg),
      sessions: durs.length,
    };
  });
  const md = `${header(title, days)}\n\n${
    table(
      ["Date", "Longest", "Average", "Sessions"],
      rows.map((r) => [
        r.date,
        fmtHM(r.longestH),
        fmtHM(r.avgH),
        String(r.sessions),
      ]),
    )
  }`;
  return { markdown: md, json: { title, days, rows } };
}

/** Weight trajectory overlaid with daily feeding volume. */
export function weightFeedingCorrelation(e: EntriesSnapshot): ReportResult {
  const title = "Weight vs. Feeding Intake";
  const days = daysOf(e);
  const weights = e.weight
    .map((w) => ({
      date: String(w.date ?? "?"),
      weightKg: round2(Number(w.weight ?? 0)),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const feedBy = aggregateByDate(e.feedings, "start");
  const feedRows = Object.keys(feedBy).sort().map((d) => ({
    date: d,
    volMl: round1(sumAmount(feedBy[d])),
    feeds: feedBy[d].length,
  }));
  if (!weights.length && !feedRows.length) {
    return empty(title, days, "No weight or feeding data found.");
  }
  const parts = [header(title, days), ""];
  if (weights.length) {
    parts.push("Weight measurements:");
    for (const w of weights) parts.push(`- ${w.date}: ${w.weightKg} kg`);
    parts.push("");
  }
  if (feedRows.length) {
    parts.push(
      table(
        ["Date", "Volume (ml)", "Feeds"],
        feedRows.map((r) => [
          r.date,
          r.volMl ? String(r.volMl) : "—",
          String(r.feeds),
        ]),
      ),
    );
  }
  return {
    markdown: parts.join("\n"),
    json: { title, days, weights, feedings: feedRows },
  };
}

/** Daily feeding counts and volume, split by breast vs bottle. */
export function feedingAmounts(e: EntriesSnapshot): ReportResult {
  const title = "Feeding Amounts";
  const days = daysOf(e);
  const by = aggregateByDate(e.feedings, "start");
  const dates = Object.keys(by).sort();
  if (!dates.length) return empty(title, days, "No feeding data found.");
  const rows = dates.map((d) => ({
    date: d,
    total: by[d].length,
    breast: countBreast(by[d]),
    bottle: by[d].filter((f) => f.method === "bottle").length,
    volMl: round1(sumAmount(by[d])),
  }));
  const md = `${header(title, days)}\n\n${
    table(
      ["Date", "Total", "Breast", "Bottle", "Volume (ml)"],
      rows.map((r) => [
        r.date,
        String(r.total),
        String(r.breast),
        String(r.bottle),
        r.volMl ? String(r.volMl) : "—",
      ]),
    )
  }`;
  return { markdown: md, json: { title, days, rows } };
}

/** Average and total feeding duration per day. */
export function feedingDuration(e: EntriesSnapshot): ReportResult {
  const title = "Feeding Duration";
  const days = daysOf(e);
  const by = aggregateByDate(e.feedings, "start");
  const dates = Object.keys(by).sort();
  if (!dates.length) return empty(title, days, "No feeding data found.");
  const rows = dates.map((d) => {
    const mins = by[d].map((f) => parseDurationHours(f.duration) * 60);
    const total = mins.reduce((a, b) => a + b, 0);
    return {
      date: d,
      totalMin: round1(total),
      avgMin: round1(total / mins.length),
      sessions: mins.length,
    };
  });
  const md = `${header(title, days)}\n\n${
    table(
      ["Date", "Total", "Avg", "Sessions"],
      rows.map((r) => [
        r.date,
        `${r.totalMin}m`,
        `${r.avgMin}m`,
        String(r.sessions),
      ]),
    )
  }`;
  return { markdown: md, json: { title, days, rows } };
}

/** Time between consecutive feedings, with stats and recent gaps. */
export function feedingIntervals(e: EntriesSnapshot): ReportResult {
  const title = "Feeding Intervals";
  const days = daysOf(e);
  if (e.feedings.length < 2) {
    return empty(title, days, "Not enough feeding data to compute intervals.");
  }
  const pairs = intervalPairs(e.feedings, "start");
  if (!pairs.length) return empty(title, days, "Could not compute intervals.");
  return intervalStats(title, days, pairs, e.feedings.length, true);
}

/** Time between consecutive diaper changes, with stats. */
export function diaperIntervals(e: EntriesSnapshot): ReportResult {
  const title = "Diaper Change Intervals";
  const days = daysOf(e);
  if (e.changes.length < 2) {
    return empty(title, days, "Not enough diaper data to compute intervals.");
  }
  const pairs = intervalPairs(e.changes, "time");
  if (!pairs.length) return empty(title, days, "Could not compute intervals.");
  return intervalStats(title, days, pairs, e.changes.length, false);
}

/** Daily wet/solid diaper breakdown with color counts. */
export function diaperTypes(e: EntriesSnapshot): ReportResult {
  const title = "Diaper Types";
  const days = daysOf(e);
  const by = aggregateByDate(e.changes, "time");
  const dates = Object.keys(by).sort();
  if (!dates.length) return empty(title, days, "No diaper data found.");
  const rows = dates.map((d) => {
    const colors: Record<string, number> = {};
    for (const c of by[d]) {
      const col = c.color ? String(c.color) : "";
      if (col) colors[col] = (colors[col] ?? 0) + 1;
    }
    return {
      date: d,
      total: by[d].length,
      wet: by[d].filter((c) => c.wet).length,
      solid: by[d].filter((c) => c.solid).length,
      colors,
    };
  });
  const md = `${header(title, days)}\n\n${
    table(
      ["Date", "Total", "Wet", "Solid", "Colors"],
      rows.map((r) => {
        const cstr = Object.entries(r.colors).map(([k, v]) => `${v}×${k}`).join(
          ", ",
        );
        return [
          r.date,
          String(r.total),
          String(r.wet),
          String(r.solid),
          cstr || "—",
        ];
      }),
    )
  }`;
  return { markdown: md, json: { title, days, rows } };
}

/** Total sleep hours per day with nap vs night split. */
export function sleepTotals(e: EntriesSnapshot): ReportResult {
  const title = "Sleep Totals";
  const days = daysOf(e);
  const by = aggregateByDate(e.sleep, "start");
  const dates = Object.keys(by).sort();
  if (!dates.length) return empty(title, days, "No sleep data found.");
  const rows = dates.map((d) => {
    const total = by[d].reduce((a, s) => a + parseDurationHours(s.duration), 0);
    const nap = by[d]
      .filter((s) => s.nap === true)
      .reduce((a, s) => a + parseDurationHours(s.duration), 0);
    return {
      date: d,
      totalH: round2(total),
      napH: round2(nap),
      nightH: round2(total - nap),
      sessions: by[d].length,
    };
  });
  const md = `${header(title, days)}\n\n${
    table(
      ["Date", "Total", "Naps", "Night", "Sessions"],
      rows.map((r) => [
        r.date,
        fmtHM(r.totalH),
        fmtHM(r.napH),
        fmtHM(r.nightH),
        String(r.sessions),
      ]),
    )
  }`;
  return { markdown: md, json: { title, days, rows } };
}

// ---------------------------------------------------------------------------
// Sleep regression watch
// ---------------------------------------------------------------------------

const NIGHT_START_HOUR = 21; // 21:00 — a session ending at/after this counts as night
// 09:00 (exclusive). The nominal night window is 21:00–08:00, but the morning
// wake-up boundary is stretched an hour so a healthy overnight block that ends
// at, say, 08:15 still counts as night sleep instead of being silently dropped.
const NIGHT_END_HOUR = 9;
const MIN_NIGHT_TOTAL_H = 4; // below this, a night is treated as sparse/partial
// Baseline ends this many nights before the latest. Set to 10 (was 7) so a
// regression onset in the days just before the recent window doesn't bleed into
// the baseline tail and desensitize it — the slow-onset blind spot.
const BASELINE_GAP_DAYS = 10;
const BASELINE_DAYS_DEFAULT = 28; // default trailing baseline length (tracks the child's stage)
const RECENT_DAYS = 7; // recent window length, in nights
const MIN_BASELINE_NIGHTS = 14; // need a real distribution (post-trim) before we alarm
const SUSTAIN_NIGHTS = 3; // a signal must persist this many nights
const SIGMA_K = 1.5; // alarm at μ ± this many σ
const SIGMA_WATCH = 1.0; // softer band for the early-warning "watch" tier
const WATCH_MAJORITY_NIGHTS = 4; // single-axis breaches on this many of the recent nights ⇒ watch
// Baseline onset-guard: if the trailing block of the baseline is already drifting
// in the regression direction (so the onset bled in despite the gap), trim it and
// recompute, down to a retained floor. Keeps a trailing baseline from chasing a
// slow onset. A plain one-pass trim — not CUSUM/PELT (over-engineering here).
const ONSET_TRIM_BLOCK = 7; // newest baseline nights tested as the trailing block
const ONSET_TRIM_SIGMA_K = 0.5; // tail drifts if beyond μ_head ± this × σ_head
const BASELINE_MIN_RETAINED = 14; // never trim below this many baseline nights
// σ floors (shrinkage) for the SEM denominators, so a pathologically clean
// baseline can't shrink SEM until z explodes on ordinary noise.
const SIGMA_FLOOR_STRETCH_H = 0.5;
const SIGMA_FLOOR_WAKES = 1.0;
// Single-axis "stretch collapse" → regression. All three gates must hold. (The
// design here was LLM-assisted, NOT reviewed by a medical professional — these
// are statistical heuristics, not clinical thresholds.) G1 is variance-aware in
// SEM units (self-tightens for a high-variance child instead of becoming
// unreachable, the flaw in the earlier per-night-σ-on-the-mean spec); G2 is an
// absolute-magnitude floor; G3 is a sustain/pattern check on the SOFT band.
const COLLAPSE_SEM_K = 2.0; // G1: recent mean ≤ μ − this × SEM
const COLLAPSE_DROP_FRAC = 0.85; // G2: recent mean ≤ this × μ (≥15% drop) …
const COLLAPSE_DROP_MIN_H = 45 / 60; // G2: … OR absolute drop ≥ this (45m)
const COLLAPSE_PATTERN_NIGHTS = 3; // G3: ≥ this many recent nights below μ−1σ
// Wake-elevation (corroborating) arm: recent mean wakes ≥ μ + this × SEM(wakes).
// Lower K than the stretch collapse because wakes are noisier/behavior-confounded
// — it corroborates, it is never a standalone regression trigger.
const WAKE_SEM_K = 1.5;
const ABSOLUTE_TRIGGER_H = 2 + 40 / 60; // 2h40m advisory floor (from handoff)
const MAX_STALE_DAYS = 2; // if the latest night trails the sync by more, refuse a verdict

/** Wall-clock hour (0–23) parsed naively from an ISO datetime prefix. */
function hourFromIso(iso: unknown): number | null {
  if (typeof iso !== "string" || iso.length < 13) return null;
  const h = Number(iso.slice(11, 13));
  return Number.isInteger(h) && h >= 0 && h <= 23 ? h : null;
}

/** Add `delta` days to a YYYY-MM-DD date string (UTC-safe). */
function addDays(date: string, delta: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/**
 * Timezone designator at the end of an ISO datetime ("Z" or "±HH:MM"), so a
 * boundary instant can be built in the same frame as the source timestamp.
 * Defaults to "Z" for offset-less (naive) strings.
 */
function tzOffsetOf(iso: string): string {
  const m = iso.match(/(Z|[+-]\d{2}:?\d{2})$/);
  return m ? m[1] : "Z";
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

/** Population standard deviation about `mu`. */
function popStd(xs: number[], mu: number): number {
  if (!xs.length) return 0;
  return Math.sqrt(mean(xs.map((x) => (x - mu) ** 2)));
}

/** Median of `xs`; 0 for an empty list. */
function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Age-band → advisory profile: an absolute longest-stretch floor (hours, or null
 * to suppress it) and a note about the nearby developmental regression window.
 * Floors are coarse and advisory; only `<4mo` overrides the generic
 * {@link ABSOLUTE_TRIGGER_H} (a newborn's sleep isn't consolidated, so an
 * absolute floor would be alarmist). Per-band floor *values* beyond that are a
 * deliberate TODO pending an actual clinician's age-specific curve — do not invent them.
 * A null/unknown band keeps the generic floor and emits no window note.
 */
function ageProfile(
  band: string | null,
): { floorH: number | null; windowNote: string } {
  switch (band) {
    case "<4mo":
      return {
        floorH: null,
        windowNote:
          "Under ~4 months sleep isn't consolidated yet, so the absolute-stretch floor is suppressed; the ~4-month regression (a lasting change in sleep architecture) is still ahead.",
      };
    case "4-5mo":
      return {
        floorH: ABSOLUTE_TRIGGER_H,
        windowNote:
          "In the ~4-month regression window — this is a lasting change in sleep architecture, not a phase that simply reverts.",
      };
    case "6-7mo":
      return {
        floorH: ABSOLUTE_TRIGGER_H,
        windowNote: "Between the ~4-month and ~8–10-month regression windows.",
      };
    case "8-10mo":
      return {
        floorH: ABSOLUTE_TRIGGER_H,
        windowNote:
          "In the ~8–10-month regression window — often driven by separation anxiety and motor milestones (pulling to stand).",
      };
    case "11-13mo":
      return {
        floorH: ABSOLUTE_TRIGGER_H,
        windowNote:
          "Around the ~12-month regression — frequently a nap transition in disguise.",
      };
    case "14-17mo":
      return {
        floorH: ABSOLUTE_TRIGGER_H,
        windowNote: "Between the ~12-month and ~18-month regression windows.",
      };
    case "18-24mo":
      return {
        floorH: ABSOLUTE_TRIGGER_H,
        windowNote: "Around the ~18-month regression.",
      };
    case "24mo+":
      return {
        floorH: ABSOLUTE_TRIGGER_H,
        windowNote: "Past the common infant regression windows.",
      };
    default:
      return { floorH: ABSOLUTE_TRIGGER_H, windowNote: "" };
  }
}

/** Longest run of consecutive list entries (by position) satisfying `pred`. */
function maxRun<T>(items: T[], pred: (x: T) => boolean): number {
  let best = 0;
  let cur = 0;
  for (const it of items) {
    if (pred(it)) {
      cur += 1;
      if (cur > best) best = cur;
    } else {
      cur = 0;
    }
  }
  return best;
}

/** One night's derived sleep metrics. */
interface NightRow {
  nightDate: string;
  longestStretchH: number;
  wakes: number; // total intra-night awakenings (the alarm axis)
  fedWakes: number; // awakenings with a feed in the gap (displayed context)
  spontaneousWakes: number; // wakes − fedWakes (displayed context)
  nightTotalH: number;
  excluded: boolean;
  stretchLow: boolean;
  wakesHigh: boolean;
}

/**
 * Detect a sustained sleep regression vs. benign daytime nap fragmentation.
 *
 * Groups sleep sessions *ending* in the night window (21:00–09:00, the extra
 * morning hour catching real wake-ups) into nights, derives each night's longest
 * stretch and intra-night wake count, then compares the last {@link RECENT_DAYS}
 * nights against a baseline that ends {@link BASELINE_GAP_DAYS} nights ago. By
 * default the baseline is a trailing {@link BASELINE_DAYS_DEFAULT}-night window
 * (so it tracks the child's current stage, not blended newborn history); pass
 * `baselineDays: 0` to span the whole synced window, or a positive N for a fixed
 * length. The wake axis is *total* wakes measured against the child's own
 * baseline — excluding fed wakings blinded the detector for a breastfed infant
 * (almost every waking has a nurse in the gap), while a per-child baseline keeps
 * a stable night-feeder from reading as pathology. It also appends a
 * non-diagnostic safety layer (see {@link safetyNotes}). A regression is flagged
 * only when BOTH the longest stretch craters
 * (< μ − 1.5σ) AND wakes spike (> μ + 1.5σ) for ≥3 consecutive nights; a single
 * condition alone is labelled `nap_fragmentation`. Short of those, an
 * early-warning `watch` fires on any of: ≥3 soft μ±1σ breaches, a single metric
 * past its hard threshold on a majority (≥{@link WATCH_MAJORITY_NIGHTS}) of
 * recent nights, a conservative absolute-drop in the recent longest-stretch
 * mean, or an age-aware absolute floor breached on a majority of nights. An
 * optional anonymized age band (`e.ageBand`) tunes the absolute floor and adds a
 * developmental-window note. Detects; does not predict.
 *
 * Assumes Baby Buddy timestamps are in the child's local timezone (the same
 * naive-local convention {@link aggregateByDate} uses). Needs ≥{@link
 * MIN_BASELINE_NIGHTS} complete baseline nights — sync a wide enough window
 * (`sinceHours`) or it returns `insufficient_data`. It also refuses a verdict
 * when its latest night trails `fetchedAt` by more than {@link MAX_STALE_DAYS},
 * rather than calling stale data "normal".
 */
export function regressionWatch(
  e: EntriesSnapshot,
  opts: { baselineDays?: number } = {},
): ReportResult {
  const title = "Sleep Regression Watch";
  const days = daysOf(e);

  // Feeding start instants (sorted) — used to tell a fed waking from a
  // spontaneous arousal. A gap counts as fed iff a feed falls strictly inside the
  // awake window between two sleep sessions (gaps are disjoint, so a single feed
  // can't be credited to two wakes, and a feed logged during a sleep session
  // isn't in any gap).
  const feedMs = e.feedings
    .map((f) => (typeof f.start === "string" ? Date.parse(f.start) : NaN))
    .filter((x) => !Number.isNaN(x))
    .sort((a, b) => a - b);
  const fedInGap = (gapStart: number, gapEnd: number): boolean =>
    gapEnd > gapStart && feedMs.some((t) => t >= gapStart && t <= gapEnd);

  // Bucket night-window sessions by attributed night date. Each bucket keeps the
  // source timezone offset so night boundaries stay in the child's local frame,
  // and per-session start/end so awakenings (gaps) can be classified. startMs may
  // be NaN (missing/bad start) — the session still counts toward longest/total,
  // it just can't anchor a gap.
  interface Sess {
    startMs: number;
    endMs: number;
    durH: number;
  }
  const byNight: Record<string, { sessions: Sess[]; offset: string }> = {};
  for (const s of e.sleep) {
    if (typeof s.end !== "string") continue;
    const endHour = hourFromIso(s.end);
    if (endHour === null) continue;
    const inWindow = endHour >= NIGHT_START_HOUR || endHour < NIGHT_END_HOUR;
    if (!inWindow) continue;
    const endDate = dateFromIso(s.end);
    if (!endDate) continue;
    const durH = parseDurationHours(s.duration);
    if (!(durH > 0)) continue; // skip missing/malformed durations
    const endMs = Date.parse(s.end);
    if (Number.isNaN(endMs)) continue;
    const startMs = typeof s.start === "string" ? Date.parse(s.start) : NaN;
    // A block ending after midnight belongs to the previous evening's night.
    const nightDate = endHour >= NIGHT_START_HOUR
      ? endDate
      : addDays(endDate, -1);
    const bucket = (byNight[nightDate] ??= {
      sessions: [],
      offset: tzOffsetOf(s.end),
    });
    bucket.sessions.push({ startMs, endMs, durH });
  }

  const nightDates = Object.keys(byNight).sort();
  if (!nightDates.length) {
    return empty(
      title,
      days,
      "No night-time sleep sessions with end times found.",
    );
  }

  const latest = nightDates[nightDates.length - 1];
  const fetchedMs = Date.parse(e.fetchedAt);

  // Instant of a night's morning boundary, built in that night's own tz frame.
  const morningMsOf = (night: string): number => {
    const hh = String(NIGHT_END_HOUR).padStart(2, "0");
    return Date.parse(
      `${addDays(night, 1)}T${hh}:00:00${byNight[night].offset}`,
    );
  };

  // A night is complete once the wall clock is past its morning boundary.
  // Compared as instants so a UTC `fetchedAt` and a locally-offset sleep
  // timestamp don't disagree.
  const isComplete = (night: string): boolean => {
    if (Number.isNaN(fetchedMs)) return true; // no clock to judge by
    const morningMs = morningMsOf(night);
    return Number.isNaN(morningMs) ? true : fetchedMs >= morningMs;
  };

  // How far the latest *sleep* night trails the sync. A large gap means recent
  // nights are missing (e.g. truncation dropped them). This is sleep-specific —
  // unlike e.truncated, which is a global OR across every record type — so it
  // doesn't misfire when some unrelated endpoint (e.g. diapers) hit the cap.
  const DAY_MS = 86_400_000;
  const latestMorningMs = morningMsOf(latest);
  const staleMs = Number.isNaN(fetchedMs) || Number.isNaN(latestMorningMs)
    ? 0
    : Math.max(0, fetchedMs - latestMorningMs);
  const staleDays = Math.floor(staleMs / DAY_MS); // for display/JSON
  const isStale = staleMs > MAX_STALE_DAYS * DAY_MS; // exact gap, not floored

  const rows: NightRow[] = nightDates.map((nightDate) => {
    const all = byNight[nightDate].sessions;
    // longest/total use every valid session (even one with a bad start).
    const durs = all.map((s) => s.durH);
    const nightTotalH = round2(durs.reduce((a, b) => a + b, 0));
    const wakes = Math.max(0, all.length - 1);
    // Gaps (awakenings) can only be anchored by sessions with a valid start.
    const timed = all.filter((s) => !Number.isNaN(s.startMs)).sort((a, b) =>
      a.startMs - b.startMs
    );
    let fedWakes = 0;
    for (let i = 0; i < timed.length - 1; i++) {
      if (fedInGap(timed[i].endMs, timed[i + 1].startMs)) fedWakes++;
    }
    return {
      nightDate,
      longestStretchH: round2(Math.max(...durs)),
      wakes,
      fedWakes,
      spontaneousWakes: Math.max(0, wakes - fedWakes),
      nightTotalH,
      excluded: nightTotalH < MIN_NIGHT_TOTAL_H || !isComplete(nightDate),
      stretchLow: false,
      wakesHigh: false,
    };
  });

  // Baseline ends BASELINE_GAP_DAYS before the latest night. Default is a
  // trailing BASELINE_DAYS_DEFAULT-night window (tracks the child's current
  // developmental stage rather than blending in newborn history); baselineDays=0
  // opts into spanning the whole synced window; baselineDays=N sets a fixed length.
  // Clamp: undefined ⇒ default; negatives are nonsense ⇒ treat as 0 (span-all)
  // rather than silently inverting the window.
  const baselineDays = opts.baselineDays === undefined
    ? BASELINE_DAYS_DEFAULT
    : Math.max(0, opts.baselineDays);
  const baselineHi = addDays(latest, -BASELINE_GAP_DAYS);
  const baselineLo = baselineDays === 0
    ? nightDates[0]
    : addDays(latest, -(BASELINE_GAP_DAYS + baselineDays - 1));
  const recentLo = addDays(latest, -(RECENT_DAYS - 1));

  const baselineFull = rows.filter((r) =>
    !r.excluded && r.nightDate >= baselineLo && r.nightDate <= baselineHi
  ); // date-ascending (rows derives from sorted nightDates)
  const recent = rows.filter((r) => r.nightDate >= recentLo); // incl. excluded

  // Onset-guard: iteratively drop the trailing block while it drifts in the
  // regression direction (shorter stretch OR more wakes) relative to the head,
  // so a slow onset that bled into the baseline tail doesn't desensitize it.
  // Floored σ keeps a very clean head from trimming everything.
  const nightsTrimmed = (() => {
    let b = baselineFull;
    let trimmed = 0;
    while (b.length - ONSET_TRIM_BLOCK >= BASELINE_MIN_RETAINED) {
      const head = b.slice(0, b.length - ONSET_TRIM_BLOCK);
      const tail = b.slice(b.length - ONSET_TRIM_BLOCK);
      const muHStretch = mean(head.map((r) => r.longestStretchH));
      const muHWakes = mean(head.map((r) => r.wakes));
      const sHStretch = Math.max(
        popStd(head.map((r) => r.longestStretchH), muHStretch),
        SIGMA_FLOOR_STRETCH_H,
      );
      const sHWakes = Math.max(
        popStd(head.map((r) => r.wakes), muHWakes),
        SIGMA_FLOOR_WAKES,
      );
      const tailStretch = mean(tail.map((r) => r.longestStretchH));
      const tailWakes = mean(tail.map((r) => r.wakes));
      if (
        tailStretch < muHStretch - ONSET_TRIM_SIGMA_K * sHStretch ||
        tailWakes > muHWakes + ONSET_TRIM_SIGMA_K * sHWakes
      ) {
        b = head;
        trimmed += ONSET_TRIM_BLOCK;
      } else break;
    }
    return { baseline: b, trimmed };
  })();
  const baseline = nightsTrimmed.baseline;

  // The wake axis is TOTAL wakes. Excluding fed wakings (an earlier design)
  // blinded the detector for a breastfed infant, where nearly every real waking
  // has a nurse logged in the gap — it filtered 4–5 wakes/night down to ~1 and
  // the wake arm could never fire. Total wakes against the child's OWN baseline
  // self-normalizes: a baby who always feeds 4×/night has a high μ and won't
  // trip; only a rise ABOVE that baseline does. (fed/spontaneous are kept for
  // display so a human can still see whether a spike is feeding-associated.)
  const rawMuStretch = mean(baseline.map((r) => r.longestStretchH));
  const rawMuWakes = mean(baseline.map((r) => r.wakes));
  const rawSigmaStretch = popStd(
    baseline.map((r) => r.longestStretchH),
    rawMuStretch,
  );
  const rawSigmaWakes = popStd(
    baseline.map((r) => r.wakes),
    rawMuWakes,
  );

  // Compare against raw (unrounded) thresholds to avoid compounding rounding at a
  // boundary; a longest stretch can't be negative, so clamp its floor at 0.
  const stretchLowH = Math.max(0, rawMuStretch - SIGMA_K * rawSigmaStretch);
  const wakesHighCount = rawMuWakes + SIGMA_K * rawSigmaWakes;

  const muStretch = round2(rawMuStretch);
  const sigmaStretch = round2(rawSigmaStretch);
  const muWakes = round2(rawMuWakes);
  const sigmaWakes = round2(rawSigmaWakes);
  const stretchLowHR = round2(stretchLowH); // rounded, for display only
  const wakesHighCountR = round2(wakesHighCount);

  for (const r of recent) {
    if (r.excluded) continue;
    r.stretchLow = r.longestStretchH < stretchLowH;
    r.wakesHigh = r.wakes > wakesHighCount;
  }

  const recentActive = recent.filter((r) => !r.excluded);
  const sevenDayMeanStretchH = recentActive.length
    ? round2(mean(recentActive.map((r) => r.longestStretchH)))
    : null;
  const absoluteTriggerHit = sevenDayMeanStretchH !== null &&
    sevenDayMeanStretchH < ABSOLUTE_TRIGGER_H;

  // Early-warning ("watch") signals: recent nights breaching a softer μ±1σ band.
  const softStretchLowH = Math.max(
    0,
    rawMuStretch - SIGMA_WATCH * rawSigmaStretch,
  );
  const softWakesHighCount = rawMuWakes + SIGMA_WATCH * rawSigmaWakes;
  const watchNights =
    recentActive.filter((r) =>
      r.longestStretchH < softStretchLowH ||
      r.wakes > softWakesHighCount
    ).length;

  // Trend as a robust recent-vs-baseline median shift (minutes). An OLS slope
  // over ~7 noisy nights is dominated by night-to-night variance and misreads
  // direction (it once printed "improving" on a clearly bad week), so it no
  // longer gates the verdict — this median delta is display-only context.
  const baselineMedianStretchH = round2(
    median(baseline.map((r) => r.longestStretchH)),
  );
  const recentMedianStretchH = recentActive.length
    ? round2(median(recentActive.map((r) => r.longestStretchH)))
    : null;
  const stretchShiftMin = recentMedianStretchH === null
    ? null
    : round1((recentMedianStretchH - baselineMedianStretchH) * 60);

  // Age-aware absolute floor (null ⇒ suppressed, e.g. newborns) + window note.
  const { floorH: absoluteFloorH, windowNote } = ageProfile(e.ageBand ?? null);

  // Single-axis STRETCH COLLAPSE → regression (not just watch). For a child
  // whose baseline waking is already high, the wake axis is saturated and can't
  // register a regression, so a sustained collapse of the night longest stretch
  // must qualify on its own. Three gates, all required:
  //   G1 variance-aware mean shift: recent mean ≤ μ − 2·SEM (SEM = σ/√n). Tightens
  //      for a high-variance child instead of becoming unreachable.
  //   G2 absolute magnitude: recent mean ≤ 85% of μ (≥15% drop) OR drop ≥ 45m.
  //   G3 pattern: ≥3 recent nights below the SOFT (μ−1σ) per-night floor — a
  //      pattern, so two catastrophic nights can't carry it alone.
  const recentActiveN = recentActive.length;
  // σ floored so a very clean baseline can't shrink SEM until z explodes on noise.
  const sigmaStretchEff = Math.max(rawSigmaStretch, SIGMA_FLOOR_STRETCH_H);
  const stretchSem = recentActiveN > 0
    ? sigmaStretchEff / Math.sqrt(recentActiveN)
    : 0;
  const collapseG1 = sevenDayMeanStretchH !== null &&
    sevenDayMeanStretchH <= rawMuStretch - COLLAPSE_SEM_K * stretchSem;
  const collapseG2 = sevenDayMeanStretchH !== null &&
    (sevenDayMeanStretchH <= COLLAPSE_DROP_FRAC * rawMuStretch ||
      rawMuStretch - sevenDayMeanStretchH >= COLLAPSE_DROP_MIN_H);
  const softFloorNights =
    recentActive.filter((r) => r.longestStretchH < softStretchLowH).length;
  const collapseG3 = softFloorNights >= COLLAPSE_PATTERN_NIGHTS;
  const stretchCollapse = collapseG1 && collapseG2 && collapseG3;

  // Wake-elevation (corroborating): recent mean wakes risen ≥ WAKE_SEM_K·SEM above
  // baseline. Not a standalone regression trigger (wakes are noisier); it raises
  // confidence when paired with a stretch collapse (concordant onset), and on its
  // own only reaches `watch`.
  const sigmaWakesEff = Math.max(rawSigmaWakes, SIGMA_FLOOR_WAKES);
  const wakeSem = recentActiveN > 0
    ? sigmaWakesEff / Math.sqrt(recentActiveN)
    : 0;
  const recentMeanWakes = recentActiveN > 0
    ? round2(mean(recentActive.map((r) => r.wakes)))
    : null;
  const wakeElevated = recentMeanWakes !== null &&
    recentMeanWakes >= rawMuWakes + WAKE_SEM_K * wakeSem;
  const concordant = stretchCollapse && wakeElevated;

  // --- Early-warning (watch) arms; each is a distinct signal and the verdict
  // records which fired. None escalates past `watch` on its own.
  // 1. Soft μ±1σ breaches on either axis, on ≥3 recent nights.
  const softBreach = watchNights >= 3;
  // 2. Single-axis majority: a metric past its HARD threshold on a majority of
  //    recent nights — catches "most nights bad, one good night", which the
  //    strict consecutive-run rule misses, short of a full collapse.
  const stretchLowNights = recentActive.filter((r) => r.stretchLow).length;
  const wakesHighNights = recentActive.filter((r) => r.wakesHigh).length;
  const majorityBreach = stretchLowNights >= WATCH_MAJORITY_NIGHTS ||
    wakesHighNights >= WATCH_MAJORITY_NIGHTS;
  // 3. Age-aware absolute floor breached on a majority of recent nights.
  const floorBreachNights = absoluteFloorH === null
    ? 0
    : recentActive.filter((r) => r.longestStretchH < absoluteFloorH).length;
  const floorBreach = absoluteFloorH !== null &&
    floorBreachNights >= WATCH_MAJORITY_NIGHTS;

  // 4. Wake elevation (SEM-based) on its own — wakes risen vs baseline but no
  //    stretch collapse. Corroborating-only, so it reaches `watch`, not regression.
  const watchTriggered = softBreach || majorityBreach || floorBreach ||
    wakeElevated;

  const bothRun = maxRun(recentActive, (r) => r.stretchLow && r.wakesHigh);
  const stretchOnlyRun = maxRun(
    recentActive,
    (r) => r.stretchLow && !r.wakesHigh,
  );
  const wakesOnlyRun = maxRun(
    recentActive,
    (r) => r.wakesHigh && !r.stretchLow,
  );

  let status: string;
  let note: string;
  if (isStale) {
    // Recent sleep nights are missing — refuse a verdict rather than call stale
    // data "normal". (Keyed off sleep recency, not the global truncated flag.)
    status = "insufficient_data";
    note =
      `⚠️ No verdict emitted — the latest analyzed night (${latest}) is ${staleDays} days behind the sync, so recent sleep is missing. Re-sync a smaller window (e.g. sinceHours=720) so recent nights are present.`;
  } else if (
    baseline.length < MIN_BASELINE_NIGHTS || recentActive.length === 0
  ) {
    status = "insufficient_data";
    note =
      `Need ≥${MIN_BASELINE_NIGHTS} complete baseline nights (have ${baseline.length}) and ≥1 recent night (have ${recentActive.length}). Re-run sync with sinceHours ≥ 720 (30d) for enough history.`;
  } else if (bothRun >= SUSTAIN_NIGHTS) {
    status = "regression";
    note = `Longest stretch < ${
      fmtHM(stretchLowHR)
    } AND wakes > ${wakesHighCountR} for ${bothRun} consecutive nights.`;
  } else if (stretchCollapse) {
    // Collapse of the night longest stretch — a regression in its own right. When
    // wakes are ALSO elevated vs baseline it's a concordant two-axis onset (higher
    // confidence); otherwise the wake axis may just be saturated at a high baseline.
    status = "regression";
    note = `Longest stretch collapsed: recent mean ${
      sevenDayMeanStretchH === null ? "—" : fmtHM(sevenDayMeanStretchH)
    } vs baseline ${fmtHM(muStretch)} (${
      stretchShiftMin === null ? "—" : `${stretchShiftMin} min`
    } shift), ${softFloorNights}/${recentActiveN} nights below ${
      fmtHM(round2(softStretchLowH))
    }. ${
      concordant
        ? `Night wakes are also elevated (recent mean ${recentMeanWakes} vs baseline ${muWakes}) — a concordant two-axis regression.`
        : "Night wakes aren't elevated vs baseline (consolidation-only collapse)."
    }`;
  } else if (stretchOnlyRun >= SUSTAIN_NIGHTS) {
    // Night longest stretch low but short of a full collapse — not the daytime
    // "nap fragmentation" concept; a milder night-consolidation concern.
    status = "night_consolidation_loss";
    note =
      `Longest stretch low but wakes normal for ${stretchOnlyRun} consecutive nights — a night-consolidation dip short of a full collapse.`;
  } else if (wakesOnlyRun >= SUSTAIN_NIGHTS) {
    status = "nap_fragmentation";
    note =
      `Wakes elevated but longest stretch holding for ${wakesOnlyRun} nights — fragmentation, not regression.`;
  } else if (watchTriggered) {
    status = "watch";
    const reasons: string[] = [];
    if (softBreach) {
      reasons.push(
        `${watchNights} of the last ${recentActive.length} nights breached the soft μ±1σ band`,
      );
    }
    if (majorityBreach) {
      reasons.push(
        `low longest stretch on ${stretchLowNights}/${recentActive.length} and high wakes on ${wakesHighNights}/${recentActive.length} recent nights`,
      );
    }
    if (floorBreach && absoluteFloorH !== null) {
      reasons.push(
        `longest stretch under the ${
          fmtHM(round2(absoluteFloorH))
        } floor on ${floorBreachNights}/${recentActive.length} nights`,
      );
    }
    if (wakeElevated) {
      reasons.push(
        `night wakes risen (recent mean ${recentMeanWakes} vs baseline ${muWakes})`,
      );
    }
    note = `Early warning: ${
      reasons.join("; ")
    }. Not a regression yet — worth keeping an eye out.`;
  } else {
    status = "normal";
    note =
      "No sustained (≥3-night) drop in longest stretch combined with elevated wakes.";
  }

  // Age context (advisory) rides along with any verdict when a band is present.
  if (windowNote) note += ` ${windowNote}`;

  // Truncation is advisory only — it doesn't suppress a verdict (the sleep data
  // may be complete even if some other record type hit the cap), but flag it so
  // a capped snapshot isn't read as fully authoritative.
  if (e.truncated) {
    note +=
      " ⚠️ Note: the snapshot is truncated (some record type hit Baby Buddy's page cap).";
  }

  const safety = safetyNotes(e);
  const json = {
    title,
    status,
    note,
    truncated: e.truncated,
    latestNight: latest,
    staleDays,
    baselineDays,
    ageBand: e.ageBand ?? null,
    windowNote: windowNote || null,
    baseline: {
      nights: baseline.length,
      nightsTrimmed: nightsTrimmed.trimmed, // onset-guard: tail nights dropped
      muStretchH: muStretch,
      sigmaStretchH: sigmaStretch,
      muWakes, // total wakes
      sigmaWakes,
    },
    thresholds: {
      stretchLowH: stretchLowHR,
      wakesHighCount: wakesHighCountR, // on total wakes
      absoluteFloorH: absoluteFloorH === null ? null : round2(absoluteFloorH),
    },
    sevenDayMeanStretchH,
    absoluteTriggerHit,
    baselineMedianStretchH,
    recentMedianStretchH,
    stretchShiftMin,
    watchNights,
    stretchCollapse: {
      triggered: stretchCollapse,
      g1SemShift: collapseG1,
      g2Magnitude: collapseG2,
      g3Pattern: collapseG3,
      semThresholdH: round2(rawMuStretch - COLLAPSE_SEM_K * stretchSem),
      softFloorNights,
    },
    wakeElevation: {
      elevated: wakeElevated,
      concordant, // stretch collapse AND wakes elevated = two-axis onset
      recentMeanWakes,
      semThreshold: round2(rawMuWakes + WAKE_SEM_K * wakeSem),
    },
    watchArms: {
      softBreach,
      majorityBreach,
      floorBreach,
      stretchLowNights,
      wakesHighNights,
    },
    recent: recent.map((r) => ({
      nightDate: r.nightDate,
      longestStretchH: r.longestStretchH,
      wakes: r.wakes,
      fedWakes: r.fedWakes,
      spontaneousWakes: r.spontaneousWakes,
      nightTotalH: r.nightTotalH,
      stretchLow: r.stretchLow,
      wakesHigh: r.wakesHigh,
      excluded: r.excluded,
    })),
    safety,
  };

  const statusLabel: Record<string, string> = {
    regression: "🔴 REGRESSION",
    night_consolidation_loss: "🟠 night consolidation loss",
    nap_fragmentation: "🟠 nap fragmentation",
    watch: "🟡 watch (early warning)",
    normal: "🟢 normal",
    insufficient_data: "⚪ insufficient data",
  };
  const lines = [
    header(title, days),
    "",
    `**Status: ${statusLabel[status] ?? status}** — ${note}`,
    "",
    `Baseline (${baseline.length} nights, trailing): longest stretch μ=${
      fmtHM(muStretch)
    } σ=${fmtHM(sigmaStretch)}; wakes μ=${muWakes} σ=${sigmaWakes}.`,
    `Alarm thresholds: longest < ${
      fmtHM(stretchLowHR)
    }, wakes > ${wakesHighCountR}.`,
    `7-night mean longest stretch: ${
      sevenDayMeanStretchH === null ? "—" : fmtHM(sevenDayMeanStretchH)
    } (absolute floor ${
      absoluteFloorH === null
        ? "n/a (suppressed for age)"
        : fmtHM(round2(absoluteFloorH))
    }${absoluteTriggerHit ? " — generic 2h40m trigger HIT" : ""}).`,
    `Longest-stretch shift (recent median vs baseline median): ${
      stretchShiftMin === null
        ? "—"
        : `${stretchShiftMin >= 0 ? "+" : ""}${stretchShiftMin} min ${
          stretchShiftMin > 0 ? "↑" : stretchShiftMin < 0 ? "↓" : "→"
        }`
    }; ${watchNights} recent night(s) breaching the soft μ±1σ band.${
      e.ageBand ? ` Age band: ${e.ageBand}.` : ""
    }`,
    "",
    table(
      ["Night", "Longest", "Wakes (total; spont+fed)", "Night total", "Flags"],
      recent.map((r) => [
        r.nightDate,
        fmtHM(r.longestStretchH),
        `${r.wakes} (${r.spontaneousWakes}+${r.fedWakes})`,
        fmtHM(r.nightTotalH),
        r.excluded ? "excluded" : ([
          r.stretchLow ? "stretch↓" : "",
          r.wakesHigh ? "wakes↑" : "",
        ].filter(Boolean).join(" ") || "—"),
      ]),
    ),
    "",
    "### Safety",
    `_${safety.disclaimer}_`,
    "",
    ...(safety.redFlags.length
      ? [
        "**Red flags to raise with your pediatrician:**",
        ...safety.redFlags.map(
          (f) => `- ⚠️ ${f}`,
        ),
        "",
      ]
      : ["_No data-derived red flags in the logged window._", ""]),
    "Safe sleep (AAP):",
    ...safety.safeSleep.map((s) => `- ${s}`),
  ];

  return { markdown: lines.join("\n"), json };
}

/**
 * Non-diagnostic safety layer for the sleep report: an AAP safe-sleep reminder,
 * heuristic red flags derived from the weight/feeding/diaper data Baby Buddy
 * already holds, and a disclaimer. These are coarse prompts to raise with a
 * pediatrician — NOT clinical assessments.
 */
export function safetyNotes(
  e: EntriesSnapshot,
): { disclaimer: string; safeSleep: string[]; redFlags: string[] } {
  const redFlags: string[] = [];
  const DAY = 86_400_000;
  const fetchedMs = Date.parse(e.fetchedAt);

  // Weight: only hint at a problem with ≥3 readings AND a net decline beyond
  // home-scale noise — two noisy readings shouldn't manufacture a growth scare.
  const WEIGHT_TOL_KG = 0.1;
  const weights = e.weight
    .map((w) => ({ date: String(w.date ?? ""), kg: Number(w.weight ?? NaN) }))
    .filter((w) => w.date && !Number.isNaN(w.kg))
    .sort((a, b) => a.date.localeCompare(b.date));
  if (weights.length === 0) {
    redFlags.push("No weight logged — growth can't be checked from this data.");
  } else if (
    weights.length >= 3 &&
    weights[weights.length - 1].kg < weights[0].kg - WEIGHT_TOL_KG
  ) {
    redFlags.push(
      `Logged weight is lower at the end of the window than the start (${
        weights[0].kg
      }→${
        weights[weights.length - 1].kg
      } kg over ${weights.length} readings) — ` +
        "worth asking your pediatrician about growth (home-scale readings are noisy).",
    );
  }

  // Recent feeding/diaper rate — divide by the days actually observed, and only
  // judge once ~a week of data exists (so brand-new users aren't false-alarmed).
  const eventMs = [
    ...e.feedings.map((f) => f.start),
    ...e.changes.map((c) => c.time),
  ]
    .map((x) => (typeof x === "string" ? Date.parse(x) : NaN))
    .filter((x) => !Number.isNaN(x));
  const firstMs = eventMs.length ? Math.min(...eventMs) : NaN;
  const weekAgo = Number.isNaN(fetchedMs) ? NaN : fetchedMs - 7 * DAY;
  const observedDays = Number.isNaN(fetchedMs) || Number.isNaN(firstMs)
    ? 0
    : Math.min(
      7,
      Math.max(1, Math.round((fetchedMs - Math.max(firstMs, weekAgo)) / DAY)),
    );
  const inLastWeek = (iso: unknown): boolean => {
    if (Number.isNaN(weekAgo) || typeof iso !== "string") return false;
    const t = Date.parse(iso);
    return !Number.isNaN(t) && t >= weekAgo;
  };
  if (observedDays >= 6) {
    const feedsWk = e.feedings.filter((f) => inLastWeek(f.start)).length;
    if (feedsWk === 0) {
      redFlags.push(
        "No feeds logged in the last week — if that's a logging gap it's fine, otherwise check feeding.",
      );
    } else if (feedsWk / observedDays < 6) {
      redFlags.push(
        `Only ~${
          Math.round(feedsWk / observedDays)
        } feeds/day logged recently (breastfed infants often 8–12/day) — worth checking feeding is adequate.`,
      );
    }
    const wetWk = e.changes.filter((c) => c.wet === true && inLastWeek(c.time))
      .length;
    if (wetWk === 0) {
      redFlags.push(
        "No wet diapers logged in the last week — if that's a logging gap it's fine, otherwise watch hydration.",
      );
    } else if (wetWk / observedDays < 5) {
      redFlags.push(
        `Only ~${
          Math.round(wetWk / observedDays)
        } wet diapers/day logged recently (≥6 is typical) — worth watching hydration.`,
      );
    }
  }

  return {
    disclaimer:
      "This flags patterns in logged data only. It does not assess growth, feeding adequacy, breathing (snoring/pauses/apnea), reflux, or the sleep environment, and is not a substitute for pediatric evaluation. Ask your pediatrician about snoring or breathing pauses, reflux, and weight gain.",
    safeSleep: [
      "Back to sleep, every sleep.",
      "Firm, flat, separate surface (crib/bassinet) — room-share, don't bed-share.",
      "Nothing soft in the sleep space: no pillows, blankets, bumpers, or toys.",
      "Stop swaddling once they show signs of rolling (~4 months).",
      "Avoid overheating; keep the room comfortable.",
    ],
    redFlags,
  };
}

/** Daily pumping totals, session counts, and averages. */
export function pumpingAmounts(e: EntriesSnapshot): ReportResult {
  const title = "Pumping Amounts";
  const days = daysOf(e);
  const by = aggregateByDate(e.pumping, "start");
  const dates = Object.keys(by).sort();
  if (!dates.length) return empty(title, days, "No pumping data found.");
  const rows = dates.map((d) => {
    const total = sumAmount(by[d]);
    return {
      date: d,
      totalMl: round1(total),
      sessions: by[d].length,
      avgMl: round1(total / by[d].length),
    };
  });
  const md = `${header(title, days)}\n\n${
    table(
      ["Date", "Total (ml)", "Sessions", "Avg (ml)"],
      rows.map((r) => [
        r.date,
        String(r.totalMl),
        String(r.sessions),
        String(r.avgMl),
      ]),
    )
  }`;
  return { markdown: md, json: { title, days, rows } };
}

/** All temperature readings over the window, in °C and °F. */
export function temperature(e: EntriesSnapshot): ReportResult {
  const title = "Temperature Readings";
  const days = daysOf(e);
  if (!e.temperature.length) {
    return empty(title, days, "No temperature data found.");
  }
  const rows = e.temperature.map((t) => {
    const c = round1(Number(t.temperature ?? 0));
    return {
      time: String(t.time ?? "?"),
      celsius: c,
      fahrenheit: round1(c * 9 / 5 + 32),
      notes: t.notes ? String(t.notes) : null,
    };
  });
  const lines = [header(title, days), ""];
  for (const r of rows) {
    lines.push(
      `- ${r.time}: ${r.celsius}°C / ${r.fahrenheit}°F${
        r.notes ? ` — ${r.notes}` : ""
      }`,
    );
  }
  return { markdown: lines.join("\n"), json: { title, days, rows } };
}

/** Daily tummy-time totals and session counts. */
export function tummyTime(e: EntriesSnapshot): ReportResult {
  const title = "Tummy Time";
  const days = daysOf(e);
  const by = aggregateByDate(e.tummyTimes, "start");
  const dates = Object.keys(by).sort();
  if (!dates.length) return empty(title, days, "No tummy time data found.");
  const rows = dates.map((d) => ({
    date: d,
    totalMin: round1(
      by[d].reduce((a, x) => a + parseDurationHours(x.duration) * 60, 0),
    ),
    sessions: by[d].length,
  }));
  const md = `${header(title, days)}\n\n${
    table(
      ["Date", "Total", "Sessions"],
      rows.map((r) => [
        r.date,
        `${r.totalMin}m`,
        String(r.sessions),
      ]),
    )
  }`;
  return { markdown: md, json: { title, days, rows } };
}

/** Per-medication dose counts, latest dosage, and average interval. */
export function medicationDoses(e: EntriesSnapshot): ReportResult {
  const title = "Medication";
  const days = daysOf(e);
  if (!e.medication.length) {
    return empty(title, days, "No medication data found.");
  }
  const byName: Record<string, Array<Record<string, unknown>>> = {};
  for (const m of e.medication) {
    const name = String(m.name ?? "?");
    (byName[name] ??= []).push(m);
  }
  const rows = Object.keys(byName).sort().map((name) => {
    const list = [...byName[name]].sort((a, b) =>
      Date.parse(String(a.time)) - Date.parse(String(b.time))
    );
    const latest = list[list.length - 1];
    const gaps = intervalPairs(list, "time").map((p) => p.gapHours);
    const avgIntervalH = gaps.length
      ? round1(gaps.reduce((a, b) => a + b, 0) / gaps.length)
      : null;
    return {
      name,
      doses: list.length,
      dosage: `${latest.dosage ?? "?"}${latest.dosage_unit ?? ""}`,
      avgIntervalH,
      lastDose: String(latest.time ?? "?"),
    };
  });
  const md = `${header(title, days)}\n\n${
    table(
      ["Medication", "Doses", "Latest dosage", "Avg gap", "Last dose"],
      rows.map((r) => [
        r.name,
        String(r.doses),
        r.dosage,
        r.avgIntervalH !== null ? `${r.avgIntervalH}h` : "—",
        r.lastDose,
      ]),
    )
  }`;
  return { markdown: md, json: { title, days, rows } };
}

/** Weight measurements over the window with per-reading and net deltas. */
export function weightTrend(e: EntriesSnapshot): ReportResult {
  const title = "Weight Trend";
  const days = daysOf(e);
  if (!e.weight.length) return empty(title, days, "No weight data found.");
  const sorted = [...e.weight]
    .map((w) => ({
      date: String(w.date ?? "?"),
      weightKg: round2(Number(w.weight ?? 0)),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const rows = sorted.map((w, i) => ({
    date: w.date,
    weightKg: w.weightKg,
    deltaKg: i === 0 ? null : round2(w.weightKg - sorted[i - 1].weightKg),
  }));
  const net = round2(sorted[sorted.length - 1].weightKg - sorted[0].weightKg);
  const md = `${header(title, days)}\n\n${
    table(
      ["Date", "Weight (kg)", "Δ (kg)"],
      rows.map((r) => [
        r.date,
        String(r.weightKg),
        r.deltaKg === null
          ? "—"
          : (r.deltaKg >= 0 ? `+${r.deltaKg}` : String(r.deltaKg)),
      ]),
    )
  }\n\nNet change: ${
    net >= 0 ? "+" : ""
  }${net} kg over ${sorted.length} reading${sorted.length === 1 ? "" : "s"}.`;
  return { markdown: md, json: { title, days, net, rows } };
}
