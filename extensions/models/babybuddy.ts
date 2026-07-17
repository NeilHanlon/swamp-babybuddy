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
  token: z.string().min(1).meta({ sensitive: true }).describe(
    "Baby Buddy API token",
  ),
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

const DeletedSchema = z.object({
  action: z.string(),
  kind: z.string(),
  id: z.number(),
  at: z.iso.datetime(),
});

const TimerSchema = z.object({
  action: z.string(),
  id: z.number(),
  name: z.string().nullable(),
  start: z.string(),
  at: z.iso.datetime(),
});

const TimersSchema = z.object({
  fetchedAt: z.iso.datetime(),
  timers: z.array(EntrySchema),
});

/** Tracked entry types and their Baby Buddy REST collection paths. */
const ENTRY_PATHS: Record<string, string> = {
  feeding: "feedings/",
  diaper: "changes/",
  sleep: "sleep/",
  pumping: "pumping/",
  "tummy-time": "tummy-times/",
  note: "notes/",
  temperature: "temperature/",
  medication: "medication/",
};

/**
 * Build the PATCH body used to backdate a timer-converted entry.
 * Converting via the `timer` param links the entry to its timer (Baby Buddy
 * provenance) but forces start=timer.start / end=now; we PATCH only the
 * caller-supplied fields on top. Returns null when nothing was supplied, so
 * the no-backdate path issues zero extra requests and is unchanged.
 */
export function backdatePatch(
  a: { start?: string; end?: string },
): Record<string, unknown> | null {
  const patch: Record<string, unknown> = {};
  if (a.start !== undefined) patch.start = a.start;
  if (a.end !== undefined) patch.end = a.end;
  return Object.keys(patch).length > 0 ? patch : null;
}

const EntryTypeEnum = z.enum([
  "feeding",
  "diaper",
  "sleep",
  "pumping",
  "tummy-time",
  "note",
  "temperature",
  "medication",
]);

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

/** Fetch the target timer by id, by name, or the most recently started one. */
async function resolveTimer(
  args: GlobalArgs,
  opts: { timerId?: number; name?: string },
): Promise<Record<string, unknown>> {
  if (opts.timerId !== undefined) {
    return await bbRequest(args, "GET", `timers/${opts.timerId}/`);
  }
  if (opts.name) {
    const { results } = await bbList(args, "timers/", {
      name: opts.name,
      limit: 10,
    });
    if (!results.length) {
      throw new Error(`No active timer found with name '${opts.name}'`);
    }
    return results[0];
  }
  const { results } = await bbList(args, "timers/", {
    limit: 1,
    ordering: "-start",
  });
  if (!results.length) throw new Error("No active timers found");
  return results[0];
}

/**
 * Guess which activity a timer converts into from its name. Returns null when
 * the name gives no hint, so the caller can require an explicit choice rather
 * than silently discard a running timer.
 */
export function inferTimerKind(
  name: unknown,
): "feeding" | "sleep" | "pumping" | "tummy-time" | null {
  const n = typeof name === "string" ? name.toLowerCase() : "";
  if (n.includes("feed")) return "feeding";
  if (n.includes("nap") || n.includes("sleep")) return "sleep";
  if (n.includes("pump")) return "pumping";
  if (n.includes("tummy")) return "tummy-time";
  return null;
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

/** The subset of the LogTape logger these methods use. */
interface Logger {
  info: (message: string, properties?: Record<string, unknown>) => void;
  warning: (message: string, properties?: Record<string, unknown>) => void;
}

interface MethodContext {
  globalArgs: GlobalArgs;
  logger: Logger;
  writeResource: (
    specName: string,
    name: string,
    data: Record<string, unknown>,
  ) => Promise<DataHandle>;
}

/**
 * POST a new entry to Baby Buddy, log entry/completion, and persist the created
 * record as a `logged` artifact.
 */
async function postAndLog(
  ctx: MethodContext,
  kind: string,
  path: string,
  body: Record<string, unknown>,
): Promise<{ dataHandles: DataHandle[] }> {
  ctx.logger.info("Logging {kind} to Baby Buddy", { kind });
  const entry = await bbRequest(ctx.globalArgs, "POST", path, { body });
  const id = (entry.id as number | undefined) ?? null;
  const handle = await ctx.writeResource("logged", "logged", {
    kind,
    id,
    at: nowIso(),
    entry,
  });
  ctx.logger.info("Logged {kind} entry {id}", { kind, id });
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

const DeleteEntryArgs = z.object({
  type: EntryTypeEnum.describe("The kind of entry to delete"),
  id: z.number().int().describe("Baby Buddy id of the entry to delete"),
});

const UpdateEntryArgs = z.object({
  type: EntryTypeEnum.describe("The kind of entry to update"),
  id: z.number().int().describe("Baby Buddy id of the entry to update"),
  fields: z.record(z.string(), z.unknown()).describe(
    "Partial set of fields to change (sent as a PATCH body)",
  ),
});

const StartTimerArgs = z.object({
  name: z.string().optional().describe(
    "Timer name; a name like 'feeding'/'sleep'/'pumping'/'tummy' lets stop-timer auto-convert",
  ),
});

const ListTimersArgs = z.object({});

const RenameTimerArgs = z.object({
  timerId: z.number().int().optional(),
  name: z.string().optional().describe(
    "Current name (used if timerId omitted)",
  ),
  newName: z.string().describe("New timer name"),
});

const StopTimerArgs = z.object({
  timerId: z.number().int().optional().describe(
    "Timer to stop; if omitted, resolved by name or the most recent timer",
  ),
  name: z.string().optional(),
  createEntry: z.enum(["feeding", "pumping", "sleep", "tummy-time", "discard"])
    .optional().describe(
      "What to convert the timer into. Omit to infer from the timer name; use 'discard' to delete without an entry",
    ),
  method: z.string().optional().describe(
    "feeding: left/right/both breasts, bottle, ...",
  ),
  type: z.string().default("breast milk").describe(
    "feeding: breast milk | formula | fortified breast milk | solid food",
  ),
  amount: z.number().optional(),
  amountUnit: z.string().default("ml"),
  nap: z.boolean().optional().describe("sleep: mark as nap"),
  milestone: z.string().optional().describe("tummy-time: milestone note"),
  start: z.string().optional().describe(
    "ISO-8601 start to backdate the converted entry to; PATCHed onto the entry after conversion (Baby Buddy otherwise keeps the timer's own start)",
  ),
  end: z.string().optional().describe(
    "ISO-8601 end for the converted entry; PATCHed on after conversion so a forgotten timer isn't closed at 'now'. The entry briefly has end='now' between the convert POST and this PATCH; the timer link (provenance) is preserved either way",
  ),
  notes: z.string().optional(),
  tags,
});

// ---------------------------------------------------------------------------
// Model definition
// ---------------------------------------------------------------------------

/** Consolidated Baby Buddy tracker model type. */
export const model = {
  type: "@kneel/babybuddy",
  version: "2026.07.10.4",
  globalArguments: GlobalArgsSchema,
  resources: {
    "entries": {
      description: "Snapshot of recent entries across all tracked types",
      schema: EntriesSchema,
      lifetime: "30d",
      garbageCollection: 10,
    },
    "logged": {
      description: "A single entry created by a log-* or update-entry method",
      schema: LoggedSchema,
      lifetime: "infinite",
      garbageCollection: 50,
    },
    "deleted": {
      description: "Record of an entry removed by delete-entry",
      schema: DeletedSchema,
      lifetime: "infinite",
      garbageCollection: 50,
    },
    "timer": {
      description: "A timer started or renamed by a timer method",
      schema: TimerSchema,
      lifetime: "infinite",
      garbageCollection: 50,
    },
    "timers": {
      description: "Snapshot of active timers from list-timers",
      schema: TimersSchema,
      lifetime: "30d",
      garbageCollection: 10,
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
    "@kneel/babybuddy-medication",
    "@kneel/babybuddy-weight-trend",
  ],
  checks: {
    "babybuddy-reachable": {
      description:
        "Verify the Baby Buddy API is reachable and the token resolves a child before writing an entry",
      labels: ["live"],
      appliesTo: [
        "log-feeding",
        "log-diaper",
        "log-pumping",
        "log-sleep",
        "log-tummy-time",
        "log-note",
        "log-temperature",
        "log-medication",
        "update-entry",
        "delete-entry",
        "start-timer",
        "stop-timer",
        "rename-timer",
      ],
      execute: async (
        context: { globalArgs: GlobalArgs; logger: Logger },
      ): Promise<{ pass: boolean; errors?: string[] }> => {
        try {
          const child = await resolveChild(context.globalArgs);
          context.logger.info("Baby Buddy reachable (child {child})", {
            child,
          });
          return { pass: true };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return {
            pass: false,
            errors: [
              `Baby Buddy is not reachable or the token/child is invalid: ${message}`,
            ],
          };
        }
      },
    },
  },
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
        context.logger.info("Syncing Baby Buddy entries (last {hours}h)", {
          hours: args.sinceHours,
        });
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
        context.logger.info(
          "Synced {feedings} feedings, {changes} diapers, {sleep} sleep, {pumping} pumping (truncated={truncated})",
          {
            feedings: feedings.results.length,
            changes: changes.results.length,
            sleep: sleep.results.length,
            pumping: pumping.results.length,
            truncated: lists.some((l) => l.truncated),
          },
        );
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
        return postAndLog(context, "feeding", "feedings/", body);
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
        return postAndLog(context, "diaper", "changes/", body);
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
        return postAndLog(context, "pumping", "pumping/", body);
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
        return postAndLog(context, "sleep", "sleep/", body);
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
        return postAndLog(context, "tummy-time", "tummy-times/", body);
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
        return postAndLog(context, "note", "notes/", body);
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
        return postAndLog(context, "temperature", "temperature/", body);
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
        return postAndLog(context, "medication", "medication/", body);
      },
    },
    "update-entry": {
      description: "Update fields on an existing Baby Buddy entry",
      arguments: UpdateEntryArgs,
      execute: async (
        a: z.infer<typeof UpdateEntryArgs>,
        context: MethodContext,
      ): Promise<{ dataHandles: DataHandle[] }> => {
        context.logger.info("Updating {type} entry {id}", {
          type: a.type,
          id: a.id,
        });
        const entry = await bbRequest(
          context.globalArgs,
          "PATCH",
          `${ENTRY_PATHS[a.type]}${a.id}/`,
          { body: a.fields },
        );
        const handle = await context.writeResource("logged", "logged", {
          kind: `update:${a.type}`,
          id: a.id,
          at: nowIso(),
          entry,
        });
        context.logger.info("Updated {type} entry {id}", {
          type: a.type,
          id: a.id,
        });
        return { dataHandles: [handle] };
      },
    },
    "delete-entry": {
      description: "Delete a Baby Buddy entry by type and id (idempotent)",
      arguments: DeleteEntryArgs,
      execute: async (
        a: z.infer<typeof DeleteEntryArgs>,
        context: MethodContext,
      ): Promise<{ dataHandles: DataHandle[] }> => {
        context.logger.info("Deleting {type} entry {id}", {
          type: a.type,
          id: a.id,
        });
        try {
          await bbRequest(
            context.globalArgs,
            "DELETE",
            `${ENTRY_PATHS[a.type]}${a.id}/`,
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          // Idempotent: a 404 means the entry is already gone.
          if (!/\b404\b/.test(message)) throw err;
          context.logger.warning("{type} entry {id} already absent", {
            type: a.type,
            id: a.id,
          });
        }
        const handle = await context.writeResource("deleted", "deleted", {
          action: "delete",
          kind: a.type,
          id: a.id,
          at: nowIso(),
        });
        context.logger.info("Deleted {type} entry {id}", {
          type: a.type,
          id: a.id,
        });
        return { dataHandles: [handle] };
      },
    },
    "start-timer": {
      description: "Start a Baby Buddy timer (name it to enable auto-convert)",
      arguments: StartTimerArgs,
      execute: async (
        a: z.infer<typeof StartTimerArgs>,
        context: MethodContext,
      ): Promise<{ dataHandles: DataHandle[] }> => {
        const g = context.globalArgs;
        const child = await resolveChild(g);
        context.logger.info("Starting timer {name}", {
          name: a.name ?? "(unnamed)",
        });
        const body: Record<string, unknown> = { child, start: nowIso() };
        if (a.name) body.name = a.name;
        const timer = await bbRequest(g, "POST", "timers/", { body });
        const handle = await context.writeResource("timer", "timer", {
          action: "start",
          id: timer.id as number,
          name: (timer.name as string | null) ?? null,
          start: String(timer.start),
          at: nowIso(),
        });
        context.logger.info("Started timer {id}", { id: timer.id });
        return { dataHandles: [handle] };
      },
    },
    "stop-timer": {
      description:
        "Stop a timer and convert it into its activity (or discard it)",
      arguments: StopTimerArgs,
      execute: async (
        a: z.infer<typeof StopTimerArgs>,
        context: MethodContext,
      ): Promise<{ dataHandles: DataHandle[] }> => {
        const g = context.globalArgs;
        const timer = await resolveTimer(g, {
          timerId: a.timerId,
          name: a.name,
        });
        const tid = timer.id as number;
        // Decide what to do: explicit createEntry, else infer from the name.
        // Never silently discard — an unnamed timer with no createEntry errors.
        let kind = a.createEntry;
        if (!kind) {
          const inferred = inferTimerKind(timer.name);
          if (!inferred) {
            throw new Error(
              `Cannot infer an activity from timer '${
                timer.name ?? ""
              }' (id ${tid}). Pass createEntry=feeding|pumping|sleep|tummy-time, or createEntry=discard to delete it.`,
            );
          }
          kind = inferred;
        }

        if (kind === "discard") {
          context.logger.info("Discarding timer {id}", { id: tid });
          await bbRequest(g, "DELETE", `timers/${tid}/`);
          const handle = await context.writeResource("deleted", "deleted", {
            action: "discard",
            kind: "timer",
            id: tid,
            at: nowIso(),
          });
          return { dataHandles: [handle] };
        }

        // Convert: POST to the activity with `timer` so Baby Buddy uses the
        // timer's start/end and consumes the timer.
        const child = await resolveChild(g);
        const body: Record<string, unknown> = { child, timer: tid };
        if (kind === "feeding") {
          body.type = a.type;
          body.method = a.method || "both breasts";
          if (a.amount !== undefined) {
            body.amount = a.amount;
            body.amount_unit = a.amountUnit;
          }
        } else if (kind === "pumping") {
          if (a.amount === undefined) {
            throw new Error(
              "amount is required to convert a timer into a pumping entry",
            );
          }
          body.amount = a.amount;
          body.amount_unit = a.amountUnit;
        } else if (kind === "sleep") {
          if (a.nap !== undefined) body.nap = a.nap;
        } else if (kind === "tummy-time") {
          if (a.milestone) body.milestone = a.milestone;
        }
        if (a.notes) body.notes = a.notes;
        if (a.tags?.length) body.tags = a.tags;

        context.logger.info("Converting timer {id} into {kind}", {
          id: tid,
          kind,
        });
        const entry = await bbRequest(g, "POST", ENTRY_PATHS[kind], { body });
        // Convert via the `timer` param keeps the entry LINKED to its timer
        // (Baby Buddy's provenance) but forces start=timer.start, end=now. To
        // honour a caller-supplied start/end we PATCH the freshly-created entry
        // rather than deleting the timer (which would drop that provenance).
        let finalEntry = entry;
        const patch = backdatePatch(a);
        if (patch) {
          const eid = entry.id as number | undefined;
          if (eid === undefined) {
            throw new Error(
              `Converted ${kind} entry has no id; cannot backdate start/end`,
            );
          }
          context.logger.info("Backdating {kind} entry {eid}", {
            kind,
            eid,
          });
          finalEntry = await bbRequest(
            g,
            "PATCH",
            `${ENTRY_PATHS[kind]}${eid}/`,
            {
              body: patch,
            },
          );
        }
        const handle = await context.writeResource("logged", "logged", {
          kind,
          id: (finalEntry.id as number | undefined) ?? null,
          at: nowIso(),
          entry: finalEntry,
        });
        context.logger.info("Converted timer {id} into {kind} entry {eid}", {
          id: tid,
          kind,
          eid: finalEntry.id,
        });
        return { dataHandles: [handle] };
      },
    },
    "rename-timer": {
      description: "Rename an active timer (e.g. to enable auto-convert)",
      arguments: RenameTimerArgs,
      execute: async (
        a: z.infer<typeof RenameTimerArgs>,
        context: MethodContext,
      ): Promise<{ dataHandles: DataHandle[] }> => {
        const g = context.globalArgs;
        const timer = await resolveTimer(g, {
          timerId: a.timerId,
          name: a.name,
        });
        const tid = timer.id as number;
        context.logger.info("Renaming timer {id} to {newName}", {
          id: tid,
          newName: a.newName,
        });
        const updated = await bbRequest(g, "PATCH", `timers/${tid}/`, {
          body: { name: a.newName },
        });
        const handle = await context.writeResource("timer", "timer", {
          action: "rename",
          id: tid,
          name: (updated.name as string | null) ?? null,
          start: String(updated.start),
          at: nowIso(),
        });
        return { dataHandles: [handle] };
      },
    },
    "list-timers": {
      description: "Snapshot the active timers into `timers` (read-only)",
      arguments: ListTimersArgs,
      execute: async (
        _a: z.infer<typeof ListTimersArgs>,
        context: MethodContext,
      ): Promise<{ dataHandles: DataHandle[] }> => {
        const g = context.globalArgs;
        context.logger.info("Listing active timers");
        const { results } = await bbList(g, "timers/", {
          limit: 50,
          ordering: "-start",
        });
        const handle = await context.writeResource("timers", "timers", {
          fetchedAt: nowIso(),
          timers: results,
        });
        context.logger.info("Found {count} active timer(s)", {
          count: results.length,
        });
        return { dataHandles: [handle] };
      },
    },
  },
};
