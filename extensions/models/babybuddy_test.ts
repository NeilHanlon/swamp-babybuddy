import { assertEquals } from "jsr:@std/assert@1";
import {
  aggregateByDate,
  buildDailySummary,
  dateFromIso,
  inferTimerKind,
  parseDurationHours,
} from "./babybuddy.ts";

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
