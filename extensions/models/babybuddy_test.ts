import { assertEquals, assertRejects, assertThrows } from "jsr:@std/assert@1";
import { z } from "npm:zod@4";
import {
  aggregateByDate,
  backdatePatch,
  buildDailySummary,
  dateFromIso,
  dedupeById,
  inferTimerKind,
  jsonish,
  paginate,
  parseDurationHours,
  withRetry,
} from "./babybuddy.ts";

/** Build a fake pager over `total` records that serves fixed-size pages. */
function fakePager(total: number) {
  const all = Array.from({ length: total }, (_, i) => ({ id: i }));
  let calls = 0;
  const fetchPage = (offset: number, limit: number) => {
    calls++;
    const results = all.slice(offset, offset + limit);
    return Promise.resolve({
      results,
      hasNext: offset + results.length < total,
    });
  };
  return { fetchPage, calls: () => calls };
}

Deno.test("paginate: single full page with no successor ⇒ one call, not truncated", async () => {
  const p = fakePager(300);
  const r = await paginate(p.fetchPage, { pageSize: 500 });
  assertEquals(r.results.length, 300);
  assertEquals(r.truncated, false);
  assertEquals(p.calls(), 1);
});

Deno.test("paginate: drains multiple pages and concatenates them", async () => {
  const p = fakePager(1250);
  const r = await paginate(p.fetchPage, { pageSize: 500 });
  assertEquals(r.results.length, 1250);
  assertEquals(r.truncated, false);
  assertEquals(p.calls(), 3); // 500 + 500 + 250
  assertEquals((r.results[0] as { id: number }).id, 0);
  assertEquals((r.results[1249] as { id: number }).id, 1249);
});

Deno.test("paginate: caps at exactly maxRecords (trims overshoot) and reports truncated", async () => {
  const p = fakePager(100_000);
  const r = await paginate(p.fetchPage, { pageSize: 500, maxRecords: 1000 });
  assertEquals(r.truncated, true);
  assertEquals(r.results.length, 1000);
});

Deno.test("paginate: caps exactly even when maxRecords is not a multiple of pageSize", async () => {
  const p = fakePager(100_000);
  const r = await paginate(p.fetchPage, { pageSize: 500, maxRecords: 1200 });
  assertEquals(r.truncated, true);
  assertEquals(r.results.length, 1200);
});

Deno.test("dedupeById drops duplicate ids, keeps id-less rows and first occurrence", () => {
  const out = dedupeById([
    { id: 1, v: "a" },
    { id: 2, v: "b" },
    { id: 1, v: "dup" }, // duplicate from offset drift ⇒ dropped
    { v: "no-id" }, // kept
    { id: null, v: "null-id" }, // kept
  ]);
  assertEquals(out.map((r) => r.v), ["a", "b", "no-id", "null-id"]);
});

Deno.test("withRetry: succeeds after a transient failure", async () => {
  let calls = 0;
  const r = await withRetry(
    () => {
      calls++;
      if (calls < 2) return Promise.reject(new Error("flaky"));
      return Promise.resolve("ok");
    },
    3,
    0,
  );
  assertEquals(r, "ok");
  assertEquals(calls, 2);
});

Deno.test("withRetry: throws the last error after exhausting attempts", async () => {
  let calls = 0;
  await assertRejects(
    () =>
      withRetry(
        () => {
          calls++;
          return Promise.reject(new Error("always"));
        },
        3,
        0,
      ),
    Error,
    "always",
  );
  assertEquals(calls, 3);
});

Deno.test("paginate: a zero-length page terminates the loop", async () => {
  let calls = 0;
  const r = await paginate((_o, _l) => {
    calls++;
    return Promise.resolve({ results: [], hasNext: true }); // lies about next
  });
  assertEquals(r.results.length, 0);
  assertEquals(r.truncated, false);
  assertEquals(calls, 1);
});

Deno.test("backdatePatch: no start/end -> null (no extra PATCH, backward compatible)", () => {
  assertEquals(backdatePatch({}), null);
});

Deno.test("backdatePatch: end only patches end (the forgotten-timer case)", () => {
  assertEquals(
    backdatePatch({ end: "2026-07-10T08:50:00Z" }),
    { end: "2026-07-10T08:50:00Z" },
  );
});

Deno.test("backdatePatch: start only patches start", () => {
  assertEquals(
    backdatePatch({ start: "2026-07-10T07:22:00Z" }),
    { start: "2026-07-10T07:22:00Z" },
  );
});

Deno.test("backdatePatch: both start and end are patched", () => {
  assertEquals(
    backdatePatch({
      start: "2026-07-10T07:22:00Z",
      end: "2026-07-10T08:50:00Z",
    }),
    { start: "2026-07-10T07:22:00Z", end: "2026-07-10T08:50:00Z" },
  );
});

Deno.test("parseDurationHours parses HH:MM:SS", () => {
  assertEquals(parseDurationHours("1:30:00"), 1.5);
  assertEquals(parseDurationHours("0:00:00"), 0);
  assertEquals(parseDurationHours("2:15:36"), 2 + 15 / 60 + 36 / 3600);
});

Deno.test("parseDurationHours tolerates junk", () => {
  assertEquals(parseDurationHours(null), 0);
  assertEquals(parseDurationHours(undefined), 0);
  assertEquals(parseDurationHours("nope"), 0);
});

Deno.test("dateFromIso extracts the date prefix", () => {
  assertEquals(dateFromIso("2026-07-10T08:30:00Z"), "2026-07-10");
  assertEquals(dateFromIso(""), "");
  assertEquals(dateFromIso(42), "");
});

Deno.test("aggregateByDate buckets by the given field", () => {
  const out = aggregateByDate([
    { start: "2026-07-10T01:00:00Z", v: 1 },
    { start: "2026-07-10T09:00:00Z", v: 2 },
    { start: "2026-07-11T02:00:00Z", v: 3 },
    { other: "x" },
  ], "start");
  assertEquals(Object.keys(out).sort(), ["2026-07-10", "2026-07-11"]);
  assertEquals(out["2026-07-10"].length, 2);
  assertEquals(out["2026-07-11"].length, 1);
});

const emptyEntries = {
  fetchedAt: "2026-07-10T12:00:00Z",
  sinceHours: 24,
  child: 1,
  feedings: [],
  changes: [],
  sleep: [],
  pumping: [],
  tummyTimes: [],
  notes: [],
  temperature: [],
  medication: [],
  weight: [],
  truncated: false,
};

Deno.test("buildDailySummary handles an empty window", () => {
  const { markdown, json } = buildDailySummary(emptyEntries);
  assertEquals((json.rows as unknown[]).length, 0);
  assertEquals(json.days, 1);
  assertEquals(markdown.includes("No activity recorded"), true);
});

Deno.test("buildDailySummary aggregates a day across types", () => {
  const { json } = buildDailySummary({
    ...emptyEntries,
    sinceHours: 48,
    sleep: [
      { start: "2026-07-10T01:00:00Z", duration: "1:00:00" },
      { start: "2026-07-10T05:00:00Z", duration: "2:30:00" },
    ],
    feedings: [
      { start: "2026-07-10T02:00:00Z", method: "left breast" },
      { start: "2026-07-10T06:00:00Z", method: "bottle", amount: 90 },
    ],
    changes: [
      { time: "2026-07-10T02:10:00Z", wet: true, solid: false },
      { time: "2026-07-10T06:10:00Z", wet: true, solid: true },
    ],
    pumping: [{ start: "2026-07-10T03:00:00Z", amount: 120 }],
    weight: [{ date: "2026-07-10", weight: 5.25 }],
  });
  const rows = json.rows as Array<Record<string, unknown>>;
  assertEquals(json.days, 2);
  assertEquals(rows.length, 1);
  const row = rows[0];
  assertEquals(row.date, "2026-07-10");
  assertEquals(row.sleep, { totalH: 3.5, sessions: 2, longestH: 2.5 });
  assertEquals(row.feedings, { count: 2, breast: 1, bottle: 1, volMl: 90 });
  assertEquals(row.diapers, { count: 2, wet: 2, solid: 1 });
  assertEquals(row.pumping, { sessions: 1, ml: 120 });
  assertEquals(row.weightKg, 5.25);
});

Deno.test("jsonish: parses a JSON-string record (the --input path)", () => {
  const schema = jsonish(z.record(z.string(), z.unknown()));
  assertEquals(schema.parse('{"amount":110.85}'), { amount: 110.85 });
});

Deno.test("jsonish: passes through an already-parsed record (the --stdin path)", () => {
  const schema = jsonish(z.record(z.string(), z.unknown()));
  assertEquals(schema.parse({ amount: 110.85 }), { amount: 110.85 });
});

Deno.test("jsonish: parses a JSON-string array (tags via --input)", () => {
  const schema = jsonish(z.array(z.string()));
  assertEquals(schema.parse('["gas","fussy"]'), ["gas", "fussy"]);
  assertEquals(schema.parse(["gas", "fussy"]), ["gas", "fussy"]);
});

Deno.test("jsonish: malformed JSON still fails validation", () => {
  const schema = jsonish(z.record(z.string(), z.unknown()));
  assertThrows(() => schema.parse("{not json"));
});

Deno.test("jsonish: non-JSON-looking string is left for the inner schema", () => {
  // A scalar string is not {..}/[..], so it passes through and the record
  // schema rejects it — same behavior as before the wrapper.
  const schema = jsonish(z.record(z.string(), z.unknown()));
  assertThrows(() => schema.parse("just a string"));
});

Deno.test("inferTimerKind maps names to activities", () => {
  assertEquals(inferTimerKind("Feeding"), "feeding");
  assertEquals(inferTimerKind("nap"), "sleep");
  assertEquals(inferTimerKind("night sleep"), "sleep");
  assertEquals(inferTimerKind("Pumping session"), "pumping");
  assertEquals(inferTimerKind("tummy time"), "tummy-time");
  assertEquals(inferTimerKind("Timer 1"), null);
  assertEquals(inferTimerKind(null), null);
  assertEquals(inferTimerKind(42), null);
});
