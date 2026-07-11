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
