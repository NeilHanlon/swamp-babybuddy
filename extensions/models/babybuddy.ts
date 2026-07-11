/**
 * Consolidated Baby Buddy tracker model.
 *
 * A single model type that reads (sync) and writes (log-*) baby-tracking data
 * against a Baby Buddy instance's REST API, and produces a consolidated daily
 * summary report. Mirrors the payloads used by the babybuddy-mcp server.
 *
 * @module
 */
import { z } from "npm:zod@4";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const GlobalArgsSchema = z.object({
  baseUrl: z.url().describe(
    "Baby Buddy base URL, e.g. https://baby.example.com",
  ),
  token: z.string().min(1).describe("Baby Buddy API token").meta({
    sensitive: true,
  }),
  childId: z.number().int().optional().describe(
    "Child ID to operate on; if omitted, the first child is used",
  ),
});

type GlobalArgs = z.infer<typeof GlobalArgsSchema>;

/** A single Baby Buddy record, kept loose since the API returns many shapes. */
const EntrySchema = z.record(z.string(), z.unknown());

/** Schema for a `sync` snapshot: recent entries grouped by tracked type. */
const EntriesSchema = z.object({
  fetchedAt: z.iso.datetime(),
  sinceHours: z.number(),
  child: z.number(),
  feedings: z.array(EntrySchema),
  changes: z.array(EntrySchema),
  sleep: z.array(EntrySchema),
  pumping: z.array(EntrySchema),
  tummyTimes: z.array(EntrySchema),
  notes: z.array(EntrySchema),
  temperature: z.array(EntrySchema),
  medication: z.array(EntrySchema),
  weight: z.array(EntrySchema),
  truncated: z.boolean(),
});

const LoggedSchema = z.object({
  kind: z.string(),
  id: z.number().nullable(),
  at: z.iso.datetime(),
  entry: EntrySchema,
});

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

type QueryParams = Record<string, string | number | boolean>;

/** Build a `?a=b&c=d` query string from a params record (empty when no keys). */
function toQuery(params?: QueryParams): string {
  if (!params) return "";
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) sp.set(k, String(v));
  const s = sp.toString();
  return s ? `?${s}` : "";
}

/** Perform an authenticated request against the Baby Buddy REST API. */
async function bbRequest(
  args: GlobalArgs,
  method: string,
  path: string,
  opts?: { body?: Record<string, unknown>; query?: QueryParams },
): Promise<Record<string, unknown>> {
  const base = args.baseUrl.replace(/\/+$/, "");
  const url = `${base}/api/${path}${toQuery(opts?.query)}`;
  const headers: Record<string, string> = {
    "Authorization": `Token ${args.token}`,
  };
  let body: string | undefined;
  if (opts?.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  const r = await fetch(url, { method, headers, body });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(
      `Baby Buddy ${method} ${path} failed: ${r.status} ${r.statusText} ${text}`,
    );
  }
  if (r.status === 204) return {};
  return await r.json() as Record<string, unknown>;
}

/** Result of a list GET: the page of records plus whether more pages exist. */
interface ListResult {
  results: Array<Record<string, unknown>>;
  truncated: boolean;
}

/** GET a list endpoint, returning the `results` page and a truncation flag. */
async function bbList(
  args: GlobalArgs,
  path: string,
  query: QueryParams,
): Promise<ListResult> {
  const resp = await bbRequest(args, "GET", path, { query });
  return {
    results: (resp.results as Array<Record<string, unknown>>) ?? [],
    truncated: Boolean(resp.next),
  };
}

/** Resolve the child id, defaulting to the first child on the instance. */
async function resolveChild(args: GlobalArgs): Promise<number> {
  if (args.childId !== undefined) return args.childId;
  const { results } = await bbList(args, "children/", { limit: 1 });
  if (results.length === 0) throw new Error("No children found in Baby Buddy");
  return results[0].id as number;
}

function nowIso(): string {
  return new Date().toISOString();
}

/** Given a duration in minutes ending now, return [startIso, endIso]. */
function startFromDuration(minutes: number): [string, string] {
  const end = Date.now();
  const start = end - minutes * 60_000;
  return [new Date(start).toISOString(), new Date(end).toISOString()];
}

/**
 * Resolve start/end from the common (duration | start/end | now) inputs,
 * matching babybuddy-mcp's precedence.
 */
function resolveWindow(
  a: { durationMinutes?: number; start?: string; end?: string },
): { start: string; end: string } {
  if (a.start && a.end) return { start: a.start, end: a.end };
  if (a.durationMinutes) {
    const [s, e] = startFromDuration(a.durationMinutes);
    return { start: s, end: e };
  }
  if (a.start && !a.end) return { start: a.start, end: nowIso() };
  const n = nowIso();
  return { start: n, end: n };
}

// ---------------------------------------------------------------------------
// Daily summary (report logic — pure, unit-tested)
// ---------------------------------------------------------------------------

/** Parse a Baby Buddy "HH:MM:SS" duration string into hours. */
export function parseDurationHours(dur: unknown): number {
  if (typeof dur !== "string") return 0;
  const parts = dur.split(":");
  if (parts.length !== 3) return 0;
  return Number(parts[0]) + Number(parts[1]) / 60 + Number(parts[2]) / 3600;
}

/** Extract the YYYY-MM-DD date prefix from an ISO datetime string. */
export function dateFromIso(iso: unknown): string {
  return typeof iso === "string" ? iso.slice(0, 10) : "";
}

/** Group entries into buckets keyed by the date of `field`. */
export function aggregateByDate(
  entries: Array<Record<string, unknown>>,
  field: string,
): Record<string, Array<Record<string, unknown>>> {
  const out: Record<string, Array<Record<string, unknown>>> = {};
  for (const e of entries) {
    const d = dateFromIso(e[field]);
    if (d) (out[d] ??= []).push(e);
  }
  return out;
}

interface DailyRow {
  date: string;
  sleep: { totalH: number; sessions: number; longestH: number } | null;
  feedings: { count: number; breast: number; bottle: number; volMl: number };
  diapers: { count: number; wet: number; solid: number };
  pumping: { sessions: number; ml: number } | null;
  weightKg: number | null;
}

/**
 * Portable shape of a `sync` snapshot. Hand-written (rather than inferred from
 * the zod schema) so it can be part of the public API without leaking zod's
 * internal types.
 */
export interface EntriesSnapshot {
  /** ISO timestamp when the snapshot was fetched. */
  fetchedAt: string;
  /** Size of the history window, in hours. */
  sinceHours: number;
  /** Baby Buddy child id the snapshot is for. */
  child: number;
  /** Feeding records. */
  feedings: Array<Record<string, unknown>>;
  /** Diaper change records. */
  changes: Array<Record<string, unknown>>;
  /** Sleep records. */
  sleep: Array<Record<string, unknown>>;
  /** Pumping records. */
  pumping: Array<Record<string, unknown>>;
  /** Tummy time records. */
  tummyTimes: Array<Record<string, unknown>>;
  /** Note records. */
  notes: Array<Record<string, unknown>>;
  /** Temperature records. */
  temperature: Array<Record<string, unknown>>;
  /** Medication records. */
  medication: Array<Record<string, unknown>>;
  /** Weight records. */
  weight: Array<Record<string, unknown>>;
  /** True if any endpoint returned more records than the page cap. */
  truncated: boolean;
}

/** Parse and validate a `sync` snapshot from raw JSON bytes. */
export function parseEntriesSnapshot(bytes: Uint8Array): EntriesSnapshot {
  const parsed = EntriesSchema.parse(
    JSON.parse(new TextDecoder().decode(bytes)),
  );
  return parsed as EntriesSnapshot;
}

const BREAST_METHODS = new Set(["left breast", "right breast", "both breasts"]);

/** Build a consolidated per-day digest (markdown + json) from a sync snapshot. */
export function buildDailySummary(
  entries: EntriesSnapshot,
): { markdown: string; json: Record<string, unknown> } {
  const days = Math.max(1, Math.ceil(entries.sinceHours / 24));
  const sleepBy = aggregateByDate(entries.sleep, "start");
  const feedBy = aggregateByDate(entries.feedings, "start");
  const changeBy = aggregateByDate(entries.changes, "time");
  const pumpBy = aggregateByDate(entries.pumping, "start");

  const weightMap: Record<string, number> = {};
  for (const w of entries.weight) {
    const d = dateFromIso(w.date);
    if (d) weightMap[d] = Number(w.weight ?? 0);
  }

  const dates = [
    ...new Set([
      ...Object.keys(sleepBy),
      ...Object.keys(feedBy),
      ...Object.keys(changeBy),
      ...Object.keys(pumpBy),
    ]),
  ].sort();

  const rows: DailyRow[] = dates.map((d) => {
    const sleepE = sleepBy[d] ?? [];
    const durs = sleepE.map((s) => parseDurationHours(s.duration));
    const feedE = feedBy[d] ?? [];
    const changeE = changeBy[d] ?? [];
    const pumpE = pumpBy[d] ?? [];
    return {
      date: d,
      sleep: sleepE.length
        ? {
          totalH: durs.reduce((a, b) => a + b, 0),
          sessions: sleepE.length,
          longestH: Math.max(...durs),
        }
        : null,
      feedings: {
        count: feedE.length,
        breast: feedE.filter((f) => BREAST_METHODS.has(String(f.method)))
          .length,
        bottle: feedE.filter((f) => f.method === "bottle").length,
        volMl: feedE.reduce((a, f) => a + Number(f.amount ?? 0), 0),
      },
      diapers: {
        count: changeE.length,
        wet: changeE.filter((c) => c.wet).length,
        solid: changeE.filter((c) => c.solid).length,
      },
      pumping: pumpE.length
        ? {
          sessions: pumpE.length,
          ml: pumpE.reduce((a, p) => a + Number(p.amount ?? 0), 0),
        }
        : null,
      weightKg: d in weightMap ? weightMap[d] : null,
    };
  });

  const header = `## Daily Summary (last ${days} day${days === 1 ? "" : "s"})`;
  let markdown: string;
  if (rows.length === 0) {
    markdown = `${header}\n\n_No activity recorded in this window._`;
  } else {
    const lines = [
      header,
      "",
      "| Date | Sleep | Feedings | Diapers | Pumping | Weight |",
      "| --- | --- | --- | --- | --- | --- |",
    ];
    for (const r of rows) {
      const sleep = r.sleep
        ? `${r.sleep.totalH.toFixed(1)}h / ${r.sleep.sessions} (longest ${
          r.sleep.longestH.toFixed(1)
        }h)`
        : "—";
      const vol = r.feedings.volMl ? `, ${r.feedings.volMl.toFixed(0)}ml` : "";
      const feed = r.feedings.count
        ? `${r.feedings.count} (${r.feedings.breast}b/${r.feedings.bottle}bo${vol})`
        : "—";
      const dia = r.diapers.count
        ? `${r.diapers.count} (${r.diapers.wet}w/${r.diapers.solid}s)`
        : "—";
      const pump = r.pumping
        ? `${r.pumping.sessions} / ${r.pumping.ml.toFixed(0)}ml`
        : "—";
      const wt = r.weightKg !== null ? `${r.weightKg.toFixed(2)} kg` : "—";
      lines.push(
        `| ${r.date} | ${sleep} | ${feed} | ${dia} | ${pump} | ${wt} |`,
      );
    }
    markdown = lines.join("\n");
  }

  if (entries.truncated) {
    markdown +=
      "\n\n> ⚠️ Some endpoints hit their page cap — this window is incomplete. Sync a shorter window.";
  }

  return {
    markdown,
    json: {
      days,
      fetchedAt: entries.fetchedAt,
      child: entries.child,
      truncated: entries.truncated,
      rows,
    },
  };
}

// ---------------------------------------------------------------------------
// Execution context types
// ---------------------------------------------------------------------------

interface DataHandle {
  name: string;
}

interface MethodContext {
  globalArgs: GlobalArgs;
  writeResource: (
    specName: string,
    name: string,
    data: Record<string, unknown>,
  ) => Promise<DataHandle>;
}

/** Write a `logged` artifact for a single created entry and return its handle. */
async function writeLogged(
  ctx: MethodContext,
  kind: string,
  entry: Record<string, unknown>,
): Promise<{ dataHandles: DataHandle[] }> {
  const handle = await ctx.writeResource("logged", "logged", {
    kind,
    id: (entry.id as number | undefined) ?? null,
    at: nowIso(),
    entry,
  });
  return { dataHandles: [handle] };
}

// ---------------------------------------------------------------------------
// Method argument schemas
// ---------------------------------------------------------------------------

const tags = z.array(z.string()).optional().describe("Tag names");

const FeedingArgs = z.object({
  method: z.string().describe(
    "left breast | right breast | both breasts | bottle | parent fed | self fed",
  ),
  type: z.string().default("breast milk").describe(
    "breast milk | formula | fortified breast milk | solid food",
  ),
  durationMinutes: z.number().optional(),
  amount: z.number().optional(),
  amountUnit: z.string().default("ml"),
  start: z.string().optional(),
  end: z.string().optional(),
  notes: z.string().optional(),
  tags,
});

const DiaperArgs = z.object({
  wet: z.boolean().default(true),
  solid: z.boolean().default(false),
  color: z.string().optional().describe("black | brown | green | yellow"),
  amount: z.number().optional(),
  time: z.string().optional(),
  notes: z.string().optional(),
  tags,
});

const PumpingArgs = z.object({
  amount: z.number(),
  amountUnit: z.string().default("ml"),
  durationMinutes: z.number().optional(),
  start: z.string().optional(),
  end: z.string().optional(),
  notes: z.string().optional(),
  tags,
});

const SleepArgs = z.object({
  durationMinutes: z.number().optional(),
  start: z.string().optional(),
  end: z.string().optional(),
  nap: z.boolean().optional(),
  notes: z.string().optional(),
  tags,
});

const TummyTimeArgs = z.object({
  durationMinutes: z.number().optional(),
  start: z.string().optional(),
  end: z.string().optional(),
  milestone: z.string().optional(),
  tags,
});

const NoteArgs = z.object({
  note: z.string(),
  time: z.string().optional(),
  tags,
});

const TemperatureArgs = z.object({
  temperature: z.number(),
  temperatureUnit: z.string().default("°F"),
  time: z.string().optional(),
  notes: z.string().optional(),
  tags,
});

const MedicationArgs = z.object({
  name: z.string(),
  dosage: z.number(),
  dosageUnit: z.string().default("ml").describe("mg | ml | tablets | drops"),
  time: z.string().optional(),
  nextDoseInterval: z.string().optional().describe(
    "ISO 8601 duration, e.g. PT8H",
  ),
  notes: z.string().optional(),
  tags,
});

const SyncArgs = z.object({
  sinceHours: z.number().default(168).describe(
    "How many hours of history to pull (default 168 = 7 days)",
  ),
});

// ---------------------------------------------------------------------------
// Model definition
// ---------------------------------------------------------------------------

/** Consolidated Baby Buddy tracker model type. */
export const model = {
  type: "@kneel/babybuddy",
  version: "2026.07.10.1",
  globalArguments: GlobalArgsSchema,
  resources: {
    "entries": {
      description: "Snapshot of recent entries across all tracked types",
      schema: EntriesSchema,
      lifetime: "30d",
      garbageCollection: 10,
    },
    "logged": {
      description: "A single entry created by a log-* method",
      schema: LoggedSchema,
      lifetime: "infinite",
      garbageCollection: 50,
    },
  },
  reports: [
    "@kneel/babybuddy-daily-summary",
    "@kneel/babybuddy-sleep-feeding-correlation",
    "@kneel/babybuddy-sleep-longest-stretch",
    "@kneel/babybuddy-sleep-totals",
    "@kneel/babybuddy-weight-feeding-correlation",
    "@kneel/babybuddy-feeding-amounts",
    "@kneel/babybuddy-feeding-duration",
    "@kneel/babybuddy-feeding-intervals",
    "@kneel/babybuddy-diaper-intervals",
    "@kneel/babybuddy-diaper-types",
    "@kneel/babybuddy-pumping-amounts",
    "@kneel/babybuddy-temperature",
    "@kneel/babybuddy-tummy-time",
  ],
  methods: {
    sync: {
      description:
        "Pull recent entries across all tracked types into `entries`",
      arguments: SyncArgs,
      execute: async (
        args: z.infer<typeof SyncArgs>,
        context: MethodContext,
      ): Promise<{ dataHandles: DataHandle[] }> => {
        const g = context.globalArgs;
        const child = await resolveChild(g);
        const cutoff = new Date(Date.now() - args.sinceHours * 3_600_000)
          .toISOString();
        const [
          feedings,
          changes,
          sleep,
          pumping,
          tummyTimes,
          notes,
          temperature,
          medication,
          weight,
        ] = await Promise.all([
          bbList(g, "feedings/", {
            child,
            start_min: cutoff,
            limit: 500,
            ordering: "start",
          }),
          bbList(g, "changes/", {
            child,
            date_min: cutoff,
            limit: 500,
            ordering: "-time",
          }),
          bbList(g, "sleep/", {
            child,
            start_min: cutoff,
            limit: 500,
            ordering: "start",
          }),
          bbList(g, "pumping/", {
            child,
            start_min: cutoff,
            limit: 500,
            ordering: "start",
          }),
          bbList(g, "tummy-times/", {
            child,
            start_min: cutoff,
            limit: 500,
            ordering: "start",
          }),
          bbList(g, "notes/", { child, limit: 200, ordering: "-time" }),
          bbList(g, "temperature/", { child, limit: 200, ordering: "-time" }),
          bbList(g, "medication/", { child, limit: 200, ordering: "-time" }),
          bbList(g, "weight/", { child, limit: 50, ordering: "-date" }),
        ]);
        const lists = [
          feedings,
          changes,
          sleep,
          pumping,
          tummyTimes,
          notes,
          temperature,
          medication,
          weight,
        ];
        const handle = await context.writeResource("entries", "entries", {
          fetchedAt: nowIso(),
          sinceHours: args.sinceHours,
          child,
          feedings: feedings.results,
          changes: changes.results,
          sleep: sleep.results,
          pumping: pumping.results,
          tummyTimes: tummyTimes.results,
          notes: notes.results,
          temperature: temperature.results,
          medication: medication.results,
          weight: weight.results,
          truncated: lists.some((l) => l.truncated),
        });
        return { dataHandles: [handle] };
      },
    },
    "log-feeding": {
      description: "Log a feeding",
      arguments: FeedingArgs,
      execute: async (
        a: z.infer<typeof FeedingArgs>,
        context: MethodContext,
      ): Promise<{ dataHandles: DataHandle[] }> => {
        const g = context.globalArgs;
        const child = await resolveChild(g);
        const { start, end } = resolveWindow(a);
        const body: Record<string, unknown> = {
          child,
          start,
          end,
          type: a.type,
          method: a.method,
        };
        if (a.amount !== undefined) {
          body.amount = a.amount;
          body.amount_unit = a.amountUnit;
        }
        if (a.notes) body.notes = a.notes;
        if (a.tags?.length) body.tags = a.tags;
        const entry = await bbRequest(g, "POST", "feedings/", { body });
        return writeLogged(context, "feeding", entry);
      },
    },
    "log-diaper": {
      description: "Log a diaper change",
      arguments: DiaperArgs,
      execute: async (
        a: z.infer<typeof DiaperArgs>,
        context: MethodContext,
      ): Promise<{ dataHandles: DataHandle[] }> => {
        const g = context.globalArgs;
        const child = await resolveChild(g);
        const body: Record<string, unknown> = {
          child,
          time: a.time ?? nowIso(),
          wet: a.wet,
          solid: a.solid,
        };
        if (a.color) body.color = a.color;
        if (a.amount !== undefined) body.amount = a.amount;
        if (a.notes) body.notes = a.notes;
        if (a.tags?.length) body.tags = a.tags;
        const entry = await bbRequest(g, "POST", "changes/", { body });
        return writeLogged(context, "diaper", entry);
      },
    },
    "log-pumping": {
      description: "Log a pumping session",
      arguments: PumpingArgs,
      execute: async (
        a: z.infer<typeof PumpingArgs>,
        context: MethodContext,
      ): Promise<{ dataHandles: DataHandle[] }> => {
        const g = context.globalArgs;
        const child = await resolveChild(g);
        const { start, end } = resolveWindow(a);
        const body: Record<string, unknown> = {
          child,
          amount: a.amount,
          amount_unit: a.amountUnit,
          start,
          end,
        };
        if (a.notes) body.notes = a.notes;
        if (a.tags?.length) body.tags = a.tags;
        const entry = await bbRequest(g, "POST", "pumping/", { body });
        return writeLogged(context, "pumping", entry);
      },
    },
    "log-sleep": {
      description: "Log a sleep session",
      arguments: SleepArgs,
      execute: async (
        a: z.infer<typeof SleepArgs>,
        context: MethodContext,
      ): Promise<{ dataHandles: DataHandle[] }> => {
        const g = context.globalArgs;
        const child = await resolveChild(g);
        const { start, end } = resolveWindow(a);
        const body: Record<string, unknown> = { child, start, end };
        if (a.nap !== undefined) body.nap = a.nap;
        if (a.notes) body.notes = a.notes;
        if (a.tags?.length) body.tags = a.tags;
        const entry = await bbRequest(g, "POST", "sleep/", { body });
        return writeLogged(context, "sleep", entry);
      },
    },
    "log-tummy-time": {
      description: "Log tummy time",
      arguments: TummyTimeArgs,
      execute: async (
        a: z.infer<typeof TummyTimeArgs>,
        context: MethodContext,
      ): Promise<{ dataHandles: DataHandle[] }> => {
        const g = context.globalArgs;
        const child = await resolveChild(g);
        const { start, end } = resolveWindow(a);
        const body: Record<string, unknown> = { child, start, end };
        if (a.milestone) body.milestone = a.milestone;
        if (a.tags?.length) body.tags = a.tags;
        const entry = await bbRequest(g, "POST", "tummy-times/", { body });
        return writeLogged(context, "tummy-time", entry);
      },
    },
    "log-note": {
      description: "Add a note about the child",
      arguments: NoteArgs,
      execute: async (
        a: z.infer<typeof NoteArgs>,
        context: MethodContext,
      ): Promise<{ dataHandles: DataHandle[] }> => {
        const g = context.globalArgs;
        const child = await resolveChild(g);
        const body: Record<string, unknown> = {
          child,
          note: a.note,
          time: a.time ?? nowIso(),
        };
        if (a.tags?.length) body.tags = a.tags;
        const entry = await bbRequest(g, "POST", "notes/", { body });
        return writeLogged(context, "note", entry);
      },
    },
    "log-temperature": {
      description: "Log a temperature reading",
      arguments: TemperatureArgs,
      execute: async (
        a: z.infer<typeof TemperatureArgs>,
        context: MethodContext,
      ): Promise<{ dataHandles: DataHandle[] }> => {
        const g = context.globalArgs;
        const child = await resolveChild(g);
        const body: Record<string, unknown> = {
          child,
          temperature: a.temperature,
          temperature_unit: a.temperatureUnit,
          time: a.time ?? nowIso(),
        };
        if (a.notes) body.notes = a.notes;
        if (a.tags?.length) body.tags = a.tags;
        const entry = await bbRequest(g, "POST", "temperature/", { body });
        return writeLogged(context, "temperature", entry);
      },
    },
    "log-medication": {
      description: "Log a medication dose",
      arguments: MedicationArgs,
      execute: async (
        a: z.infer<typeof MedicationArgs>,
        context: MethodContext,
      ): Promise<{ dataHandles: DataHandle[] }> => {
        const g = context.globalArgs;
        const child = await resolveChild(g);
        const body: Record<string, unknown> = {
          child,
          name: a.name,
          dosage: a.dosage,
          dosage_unit: a.dosageUnit,
          time: a.time ?? nowIso(),
        };
        if (a.nextDoseInterval) body.next_dose_interval = a.nextDoseInterval;
        if (a.notes) body.notes = a.notes;
        if (a.tags?.length) body.tags = a.tags;
        const entry = await bbRequest(g, "POST", "medication/", { body });
        return writeLogged(context, "medication", entry);
      },
    },
  },
};
