import { assertEquals } from "jsr:@std/assert@1";
import type { EntriesSnapshot } from "../models/babybuddy.ts";
import {
  diaperIntervals,
  diaperTypes,
  feedingAmounts,
  feedingDuration,
  feedingIntervals,
  fmtHM,
  intervalPairs,
  pumpingAmounts,
  runReport,
  sleepFeedingCorrelation,
  sleepLongestStretch,
  sleepTotals,
  sumAmount,
  temperature,
  tummyTime,
  weightFeedingCorrelation,
} from "./lib.ts";

const fixture: EntriesSnapshot = {
  fetchedAt: "2026-07-11T12:00:00Z",
  sinceHours: 48,
  child: 1,
  sleep: [
    { start: "2026-07-10T01:00:00Z", duration: "1:00:00", nap: false },
    { start: "2026-07-10T13:00:00Z", duration: "2:30:00", nap: true },
    { start: "2026-07-11T02:00:00Z", duration: "3:00:00", nap: false },
  ],
  feedings: [
    {
      start: "2026-07-10T02:00:00Z",
      method: "left breast",
      duration: "0:20:00",
    },
    {
      start: "2026-07-10T05:00:00Z",
      method: "bottle",
      amount: 90,
      duration: "0:10:00",
    },
    {
      start: "2026-07-11T03:00:00Z",
      method: "both breasts",
      duration: "0:15:00",
    },
  ],
  changes: [
    { time: "2026-07-10T02:10:00Z", wet: true, solid: false, color: "yellow" },
    { time: "2026-07-10T06:10:00Z", wet: true, solid: true, color: "brown" },
    { time: "2026-07-11T03:10:00Z", wet: true, solid: false },
  ],
  pumping: [
    { start: "2026-07-10T04:00:00Z", amount: 120 },
    { start: "2026-07-10T16:00:00Z", amount: 100 },
  ],
  tummyTimes: [{ start: "2026-07-10T09:00:00Z", duration: "0:05:00" }],
  notes: [],
  temperature: [{
    time: "2026-07-10T08:00:00Z",
    temperature: 37.0,
    notes: "fine",
  }],
  medication: [],
  weight: [{ date: "2026-07-10", weight: 5.25 }],
  truncated: false,
};

const empty: EntriesSnapshot = {
  fetchedAt: "2026-07-11T12:00:00Z",
  sinceHours: 24,
  child: 1,
  sleep: [],
  feedings: [],
  changes: [],
  pumping: [],
  tummyTimes: [],
  notes: [],
  temperature: [],
  medication: [],
  weight: [],
  truncated: false,
};

Deno.test("fmtHM formats hours", () => {
  assertEquals(fmtHM(2.5), "2h 30m");
  assertEquals(fmtHM(3), "3h 00m");
  assertEquals(fmtHM(0), "0h 00m");
});

Deno.test("sumAmount coerces and sums", () => {
  assertEquals(sumAmount([{ amount: 90 }, { amount: "10" }, {}]), 100);
});

Deno.test("intervalPairs sorts then diffs, drops non-positive", () => {
  const pairs = intervalPairs([
    { t: "2026-07-10T05:00:00Z" },
    { t: "2026-07-10T02:00:00Z" },
    { t: "2026-07-10T05:00:00Z" },
  ], "t");
  assertEquals(pairs.map((p) => p.gapHours), [3]);
});

Deno.test("sleepFeedingCorrelation", () => {
  assertEquals(sleepFeedingCorrelation(fixture).json.rows, [
    { date: "2026-07-10", sleepH: 3.5, feeds: 2, volMl: 90 },
    { date: "2026-07-11", sleepH: 3, feeds: 1, volMl: 0 },
  ]);
});

Deno.test("sleepLongestStretch", () => {
  assertEquals(sleepLongestStretch(fixture).json.rows, [
    { date: "2026-07-10", longestH: 2.5, avgH: 1.75, sessions: 2 },
    { date: "2026-07-11", longestH: 3, avgH: 3, sessions: 1 },
  ]);
});

Deno.test("weightFeedingCorrelation", () => {
  const j = weightFeedingCorrelation(fixture).json;
  assertEquals(j.weights, [{ date: "2026-07-10", weightKg: 5.25 }]);
  assertEquals(j.feedings, [
    { date: "2026-07-10", volMl: 90, feeds: 2 },
    { date: "2026-07-11", volMl: 0, feeds: 1 },
  ]);
});

Deno.test("feedingAmounts", () => {
  assertEquals(feedingAmounts(fixture).json.rows, [
    { date: "2026-07-10", total: 2, breast: 1, bottle: 1, volMl: 90 },
    { date: "2026-07-11", total: 1, breast: 1, bottle: 0, volMl: 0 },
  ]);
});

Deno.test("feedingDuration", () => {
  assertEquals(feedingDuration(fixture).json.rows, [
    { date: "2026-07-10", totalMin: 30, avgMin: 15, sessions: 2 },
    { date: "2026-07-11", totalMin: 15, avgMin: 15, sessions: 1 },
  ]);
});

Deno.test("feedingIntervals", () => {
  const j = feedingIntervals(fixture).json;
  assertEquals(j.total, 3);
  assertEquals(j.avgHours, 12.5);
  assertEquals(j.shortestHours, 3);
  assertEquals(j.longestHours, 22);
  assertEquals(j.recent, [
    { time: "2026-07-10T05:00:00Z", gapHours: 3 },
    { time: "2026-07-11T03:00:00Z", gapHours: 22 },
  ]);
});

Deno.test("feedingIntervals needs >= 2", () => {
  assertEquals(
    feedingIntervals({
      ...empty,
      feedings: [{ start: "2026-07-10T02:00:00Z" }],
    })
      .json.empty,
    true,
  );
});

Deno.test("diaperIntervals (no recent list)", () => {
  const j = diaperIntervals(fixture).json;
  assertEquals(j.total, 3);
  assertEquals(j.avgHours, 12.5);
  assertEquals(j.shortestHours, 4);
  assertEquals(j.longestHours, 21);
  assertEquals(j.recent, []);
});

Deno.test("diaperTypes", () => {
  assertEquals(diaperTypes(fixture).json.rows, [
    {
      date: "2026-07-10",
      total: 2,
      wet: 2,
      solid: 1,
      colors: { yellow: 1, brown: 1 },
    },
    { date: "2026-07-11", total: 1, wet: 1, solid: 0, colors: {} },
  ]);
});

Deno.test("sleepTotals splits nap vs night", () => {
  assertEquals(sleepTotals(fixture).json.rows, [
    { date: "2026-07-10", totalH: 3.5, napH: 2.5, nightH: 1, sessions: 2 },
    { date: "2026-07-11", totalH: 3, napH: 0, nightH: 3, sessions: 1 },
  ]);
});

Deno.test("pumpingAmounts", () => {
  assertEquals(pumpingAmounts(fixture).json.rows, [
    { date: "2026-07-10", totalMl: 220, sessions: 2, avgMl: 110 },
  ]);
});

Deno.test("temperature converts C to F", () => {
  assertEquals(temperature(fixture).json.rows, [
    {
      time: "2026-07-10T08:00:00Z",
      celsius: 37,
      fahrenheit: 98.6,
      notes: "fine",
    },
  ]);
});

Deno.test("tummyTime totals minutes", () => {
  assertEquals(tummyTime(fixture).json.rows, [
    { date: "2026-07-10", totalMin: 5, sessions: 1 },
  ]);
});

Deno.test("runReport returns no-snapshot message when data is missing", async () => {
  const res = await runReport(
    {
      modelType: "t",
      modelId: "m",
      dataRepository: { getContent: () => null },
    },
    sleepTotals,
  );
  assertEquals(
    (res.json as { message?: string }).message,
    "no entries snapshot",
  );
});

Deno.test("runReport decodes the snapshot and dispatches to compute", async () => {
  const bytes = new TextEncoder().encode(JSON.stringify(fixture));
  const res = await runReport(
    {
      modelType: "t",
      modelId: "m",
      dataRepository: { getContent: () => bytes },
    },
    sleepTotals,
  );
  assertEquals(res.json.rows, sleepTotals(fixture).json.rows);
});

Deno.test("empty snapshots report empty", () => {
  for (
    const fn of [
      sleepFeedingCorrelation,
      sleepLongestStretch,
      feedingAmounts,
      feedingDuration,
      diaperTypes,
      sleepTotals,
      pumpingAmounts,
      temperature,
      tummyTime,
    ]
  ) {
    assertEquals(fn(empty).json.empty, true);
  }
});
