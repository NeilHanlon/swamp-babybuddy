import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import type { EntriesSnapshot } from "../models/babybuddy.ts";
import {
  diaperIntervals,
  diaperTypes,
  feedingAmounts,
  feedingDuration,
  feedingIntervals,
  fmtHM,
  intervalPairs,
  medicationDoses,
  pumpingAmounts,
  regressionWatch,
  runReport,
  safetyNotes,
  sleepFeedingCorrelation,
  sleepLongestStretch,
  sleepTotals,
  sumAmount,
  temperature,
  tummyTime,
  weightFeedingCorrelation,
  weightTrend,
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

Deno.test("medicationDoses groups by name with dose count and avg interval", () => {
  const snap = {
    ...empty,
    sinceHours: 48,
    medication: [
      {
        name: "Vitamin D",
        dosage: 1,
        dosage_unit: "ml",
        time: "2026-07-10T08:00:00Z",
      },
      {
        name: "Vitamin D",
        dosage: 1,
        dosage_unit: "ml",
        time: "2026-07-11T08:00:00Z",
      },
      {
        name: "Tylenol",
        dosage: 2.5,
        dosage_unit: "ml",
        time: "2026-07-10T14:00:00Z",
      },
    ],
  };
  assertEquals(medicationDoses(snap).json.rows, [
    {
      name: "Tylenol",
      doses: 1,
      dosage: "2.5ml",
      avgIntervalH: null,
      lastDose: "2026-07-10T14:00:00Z",
    },
    {
      name: "Vitamin D",
      doses: 2,
      dosage: "1ml",
      avgIntervalH: 24,
      lastDose: "2026-07-11T08:00:00Z",
    },
  ]);
});

Deno.test("weightTrend computes per-reading and net deltas", () => {
  const snap = {
    ...empty,
    sinceHours: 72,
    weight: [
      { date: "2026-07-08", weight: 5.10 },
      { date: "2026-07-10", weight: 5.25 },
      { date: "2026-07-11", weight: 5.20 },
    ],
  };
  const j = weightTrend(snap).json;
  assertEquals(j.net, 0.1);
  assertEquals(j.rows, [
    { date: "2026-07-08", weightKg: 5.1, deltaKg: null },
    { date: "2026-07-10", weightKg: 5.25, deltaKg: 0.15 },
    { date: "2026-07-11", weightKg: 5.2, deltaKg: -0.05 },
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
      medicationDoses,
      weightTrend,
      regressionWatch,
    ]
  ) {
    assertEquals(fn(empty).json.empty, true);
  }
});

// --- Sleep Regression Watch ------------------------------------------------

/** Add `delta` days to a YYYY-MM-DD date (UTC-safe). */
function ad(date: string, delta: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/** Hours → "H:MM:SS". */
function dur(h: number): string {
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  return `${hh}:${String(mm).padStart(2, "0")}:00`;
}

/**
 * Build the sleep sessions for one night, all ending in the early-morning hours
 * of `night + 1` (so they attribute to `night`). The first session is the
 * longest stretch; the remaining `wakes` sessions are short fillers (0.75h) so
 * the night total clears the sparse floor unless `sparse` forces it under.
 */
function nightSessions(
  night: string,
  longestH: number,
  wakes: number,
  sparse = false,
): Array<Record<string, unknown>> {
  const morning = ad(night, 1);
  const fillerH = sparse ? 0.25 : 0.75;
  const out: Array<Record<string, unknown>> = [
    {
      start: `${morning}T00:00:00Z`,
      end: `${morning}T01:00:00Z`,
      duration: dur(longestH),
      nap: false,
    },
  ];
  for (let i = 0; i < wakes; i++) {
    const hour = String(i + 2).padStart(2, "0"); // 02, 03, ... (< 08)
    out.push({
      start: `${morning}T${hour}:00:00Z`,
      end: `${morning}T${hour}:30:00Z`,
      duration: dur(fillerH),
      nap: false,
    });
  }
  return out;
}

const LATEST = "2026-09-13";

/** Snapshot with a uniform baseline; `recent` overrides the last 7 nights. */
function watchSnapshot(
  recent: Array<
    { k: number; longestH: number; wakes: number; sparse?: boolean }
  >,
): EntriesSnapshot {
  const sleep: Array<Record<string, unknown>> = [];
  // 12 uniform baseline nights (longest 3.5h, 2 wakes) inside [latest-27, latest-7].
  for (let k = 7; k <= 18; k++) {
    sleep.push(...nightSessions(ad(LATEST, -k), 3.5, 2));
  }
  for (const r of recent) {
    sleep.push(
      ...nightSessions(ad(LATEST, -r.k), r.longestH, r.wakes, r.sparse),
    );
  }
  return {
    ...empty,
    fetchedAt: "2026-09-14T12:00:00Z",
    sinceHours: 720,
    sleep,
  };
}

Deno.test("regressionWatch flags a sustained regression (stretch↓ AND wakes↑)", () => {
  // Recent: 4 normal nights then 3 regression nights (short stretch, many wakes).
  const snap = watchSnapshot([
    { k: 6, longestH: 3.5, wakes: 2 },
    { k: 5, longestH: 3.5, wakes: 2 },
    { k: 4, longestH: 3.5, wakes: 2 },
    { k: 3, longestH: 3.5, wakes: 2 },
    { k: 2, longestH: 1.5, wakes: 5 },
    { k: 1, longestH: 1.5, wakes: 5 },
    { k: 0, longestH: 1.5, wakes: 5 },
  ]);
  const j = regressionWatch(snap).json as Record<string, unknown>;
  assertEquals(j.status, "regression");
  assertEquals((j.baseline as { nights: number }).nights, 12);
  // Uniform baseline ⇒ σ=0 ⇒ thresholds equal the baseline means.
  assertEquals(j.thresholds, {
    stretchLowH: 3.5,
    wakesHighCount: 2,
    absoluteTriggerH: 2.67,
  });
  const recent = j.recent as Array<Record<string, unknown>>;
  assertEquals(recent.length, 7);
  assertEquals(recent[6].nightDate, LATEST);
  assertEquals(recent[6].stretchLow, true);
  assertEquals(recent[6].wakesHigh, true);
  assertEquals(recent[0].stretchLow, false);
});

Deno.test("regressionWatch labels a single-condition run as nap_fragmentation", () => {
  // Wakes spike but the longest stretch holds ⇒ fragmentation, not regression.
  const snap = watchSnapshot([
    { k: 6, longestH: 3.5, wakes: 2 },
    { k: 5, longestH: 3.5, wakes: 2 },
    { k: 4, longestH: 3.5, wakes: 2 },
    { k: 3, longestH: 3.5, wakes: 2 },
    { k: 2, longestH: 3.5, wakes: 5 },
    { k: 1, longestH: 3.5, wakes: 5 },
    { k: 0, longestH: 3.5, wakes: 5 },
  ]);
  assertEquals(regressionWatch(snap).json.status, "nap_fragmentation");
});

Deno.test("regressionWatch reports normal when recent tracks baseline", () => {
  const snap = watchSnapshot([
    { k: 6, longestH: 3.5, wakes: 2 },
    { k: 5, longestH: 3.5, wakes: 2 },
    { k: 4, longestH: 3.5, wakes: 2 },
    { k: 3, longestH: 3.5, wakes: 2 },
    { k: 2, longestH: 3.5, wakes: 2 },
    { k: 1, longestH: 3.5, wakes: 2 },
    { k: 0, longestH: 3.5, wakes: 2 },
  ]);
  assertEquals(regressionWatch(snap).json.status, "normal");
});

Deno.test("regressionWatch raises 'watch' on 3 soft breaches, but not on 2 with a flat trend", () => {
  // 3 non-consecutive soft breaches (no 3-night hard run) ⇒ watch.
  const three = watchSnapshot([
    { k: 6, longestH: 3.5, wakes: 3 }, // breach
    { k: 5, longestH: 3.5, wakes: 2 },
    { k: 4, longestH: 3.5, wakes: 3 }, // breach
    { k: 3, longestH: 3.5, wakes: 2 },
    { k: 2, longestH: 3.5, wakes: 3 }, // breach
    { k: 1, longestH: 3.5, wakes: 2 },
    { k: 0, longestH: 3.5, wakes: 2 },
  ]);
  const j = regressionWatch(three).json;
  assertEquals(j.status, "watch");
  assertEquals(j.watchNights, 3);

  // Only 2 breaches and a flat trend ⇒ raised bar not met ⇒ normal (no crying wolf).
  const two = watchSnapshot([
    { k: 6, longestH: 3.5, wakes: 2 },
    { k: 5, longestH: 3.5, wakes: 2 },
    { k: 4, longestH: 3.5, wakes: 2 },
    { k: 3, longestH: 3.5, wakes: 2 },
    { k: 2, longestH: 3.5, wakes: 3 }, // breach
    { k: 1, longestH: 3.5, wakes: 2 },
    { k: 0, longestH: 3.5, wakes: 3 }, // breach (non-consecutive), flat trend
  ]);
  assertEquals(regressionWatch(two).json.status, "normal");
});

Deno.test("regressionWatch excludes sparse nights", () => {
  const snap = watchSnapshot([
    { k: 6, longestH: 3.5, wakes: 2 },
    { k: 5, longestH: 3.5, wakes: 2 },
    { k: 4, longestH: 3.5, wakes: 2 },
    { k: 3, longestH: 3.5, wakes: 2 },
    { k: 2, longestH: 1.5, wakes: 5 },
    { k: 1, longestH: 0.5, wakes: 0, sparse: true }, // total < 4h ⇒ excluded
    { k: 0, longestH: 1.5, wakes: 5 },
  ]);
  const recent = regressionWatch(snap).json.recent as Array<
    Record<string, unknown>
  >;
  const sparse = recent.find((r) => r.nightDate === ad(LATEST, -1))!;
  assertEquals(sparse.excluded, true);
});

Deno.test("regressionWatch returns insufficient_data without enough baseline", () => {
  // Only a handful of recent nights, no baseline history.
  const sleep: Array<Record<string, unknown>> = [];
  for (let k = 0; k <= 3; k++) {
    sleep.push(...nightSessions(ad(LATEST, -k), 3.5, 2));
  }
  const snap: EntriesSnapshot = {
    ...empty,
    fetchedAt: "2026-09-14T12:00:00Z",
    sinceHours: 168,
    sleep,
  };
  assertEquals(regressionWatch(snap).json.status, "insufficient_data");
});

Deno.test("regressionWatch keeps overnight blocks ending in the morning (~08:15)", () => {
  // With a hard 08:00 cutoff this healthy 9h block would vanish entirely.
  const snap: EntriesSnapshot = {
    ...empty,
    fetchedAt: "2026-09-14T18:00:00Z",
    sinceHours: 720,
    sleep: [{
      start: "2026-09-13T23:00:00Z",
      end: "2026-09-14T08:15:00Z",
      duration: "9:15:00",
    }],
  };
  const recent = regressionWatch(snap).json.recent as Array<
    Record<string, unknown>
  >;
  const night = recent.find((r) => r.nightDate === "2026-09-13")!;
  assertEquals(night.longestStretchH, 9.25);
  assertEquals(night.excluded, false);
});

Deno.test("regressionWatch judges completeness by instant, not naive wall clock", () => {
  // Child at UTC-04:00. Sessions end 05:00 local; sync ran 07:00 local (11:00Z),
  // before the 09:00-local morning boundary ⇒ the night is still incomplete.
  const base = {
    ...empty,
    sinceHours: 720,
    sleep: [
      {
        start: "2026-09-14T01:00:00-04:00",
        end: "2026-09-14T05:00:00-04:00",
        duration: "4:00:00",
      },
      {
        start: "2026-09-14T00:00:00-04:00",
        end: "2026-09-14T00:30:00-04:00",
        duration: "0:30:00",
      },
    ],
  };
  const findNight = (snap: EntriesSnapshot) =>
    (regressionWatch(snap).json.recent as Array<Record<string, unknown>>)
      .find((r) => r.nightDate === "2026-09-13")!;
  // 07:00 local ⇒ incomplete. A naive UTC-hour check (11 >= 9) would wrongly pass.
  assertEquals(
    findNight({ ...base, fetchedAt: "2026-09-14T11:00:00Z" }).excluded,
    true,
  );
  // 11:00 local (15:00Z) ⇒ past the boundary ⇒ complete.
  assertEquals(
    findNight({ ...base, fetchedAt: "2026-09-14T15:00:00Z" }).excluded,
    false,
  );
});

Deno.test("regressionWatch ignores sessions with missing/zero duration", () => {
  const snap: EntriesSnapshot = {
    ...empty,
    fetchedAt: "2026-09-14T18:00:00Z",
    sinceHours: 720,
    sleep: [
      {
        start: "2026-09-13T23:00:00Z",
        end: "2026-09-14T04:00:00Z",
        duration: "5:00:00",
      },
      { end: "2026-09-14T06:00:00Z" }, // no duration ⇒ must not count as a wake
    ],
  };
  const night = (regressionWatch(snap).json.recent as Array<
    Record<string, unknown>
  >).find((r) => r.nightDate === "2026-09-13")!;
  assertEquals(night.wakes, 0);
  assertEquals(night.longestStretchH, 5);
});

const healthyRecent = [
  { k: 6, longestH: 3.5, wakes: 2 },
  { k: 5, longestH: 3.5, wakes: 2 },
  { k: 4, longestH: 3.5, wakes: 2 },
  { k: 3, longestH: 3.5, wakes: 2 },
  { k: 2, longestH: 3.5, wakes: 2 },
  { k: 1, longestH: 3.5, wakes: 2 },
  { k: 0, longestH: 3.5, wakes: 2 },
];

Deno.test("regressionWatch treats truncation as advisory, not a verdict-suppressor", () => {
  // Sleep is fresh & healthy; some OTHER record type hit the cap (global
  // truncated=true). The sleep verdict must still stand, with an advisory note.
  const snap = { ...watchSnapshot(healthyRecent), truncated: true };
  const j = regressionWatch(snap).json;
  assertEquals(j.status, "normal");
  assertEquals(j.truncated, true);
  assertStringIncludes(j.note as string, "truncated");
});

Deno.test("regressionWatch refuses a verdict when recent sleep is stale", () => {
  // The sync happened weeks after the latest sleep night ⇒ recent sleep missing.
  const snap = {
    ...watchSnapshot(healthyRecent),
    fetchedAt: "2026-10-05T12:00:00Z",
  };
  const j = regressionWatch(snap).json;
  assertEquals(j.status, "insufficient_data");
  assertStringIncludes(j.note as string, "behind the sync");
});

Deno.test("regressionWatch baseline defaults to a 28-night trailing window (baselineDays=0 spans)", () => {
  // 40 baseline nights available (k=7..46) plus 7 recent nights.
  const sleep: Array<Record<string, unknown>> = [];
  for (let k = 7; k <= 46; k++) {
    sleep.push(...nightSessions(ad(LATEST, -k), 3.5, 2));
  }
  for (let k = 0; k <= 6; k++) {
    sleep.push(...nightSessions(ad(LATEST, -k), 3.5, 2));
  }
  const snap: EntriesSnapshot = {
    ...empty,
    fetchedAt: "2026-09-14T12:00:00Z",
    sinceHours: 2160,
    sleep,
  };
  // Default: trailing 28-night window (latest-34 .. latest-7).
  const def = regressionWatch(snap).json.baseline as { nights: number };
  assertEquals(def.nights, 28);
  // baselineDays=0: span every available night before the recent window.
  const spanned = regressionWatch(snap, { baselineDays: 0 }).json.baseline as {
    nights: number;
  };
  assertEquals(spanned.nights, 40);
  // baselineDays=21: fixed trailing 21-night window.
  const capped = regressionWatch(snap, { baselineDays: 21 }).json.baseline as {
    nights: number;
  };
  assertEquals(capped.nights, 21);
});

Deno.test("regressionWatch classifies a wake as fed when a feeding falls in the gap", () => {
  const snap: EntriesSnapshot = {
    ...empty,
    fetchedAt: "2026-09-14T18:00:00Z",
    sinceHours: 720,
    sleep: [
      {
        start: "2026-09-14T00:00:00Z",
        end: "2026-09-14T02:00:00Z",
        duration: "2:00:00",
      },
      {
        start: "2026-09-14T03:00:00Z",
        end: "2026-09-14T04:00:00Z",
        duration: "1:00:00",
      }, // gap1 = 02:00–03:00
      {
        start: "2026-09-14T05:00:00Z",
        end: "2026-09-14T06:00:00Z",
        duration: "1:00:00",
      }, // gap2 = 04:00–05:00
    ],
    feedings: [{ start: "2026-09-14T02:30:00Z" }], // falls in gap1 ⇒ fed wake
  };
  const night = (regressionWatch(snap).json.recent as Array<
    Record<string, unknown>
  >).find((r) => r.nightDate === "2026-09-13")!;
  assertEquals(night.wakes, 2);
  assertEquals(night.fedWakes, 1);
  assertEquals(night.spontaneousWakes, 1);
});

Deno.test("safetyNotes: always includes a disclaimer + safe-sleep, flags missing weight", () => {
  const s = safetyNotes(empty);
  assertStringIncludes(s.disclaimer, "not a substitute for pediatric");
  assertEquals(s.safeSleep.length > 0, true);
  assertEquals(s.redFlags.some((f) => /No weight logged/.test(f)), true);
});

Deno.test("safetyNotes: flags a sustained weight decline (>=3 readings, beyond noise)", () => {
  const s = safetyNotes({
    ...empty,
    weight: [
      { date: "2026-08-01", weight: 6.0 },
      { date: "2026-08-15", weight: 5.95 },
      { date: "2026-09-01", weight: 5.8 },
    ],
  });
  assertEquals(s.redFlags.some((f) => /lower at the end/.test(f)), true);
});

Deno.test("safetyNotes: two noisy weight readings do NOT trigger a flag", () => {
  const s = safetyNotes({
    ...empty,
    weight: [
      { date: "2026-08-01", weight: 6.0 },
      { date: "2026-09-01", weight: 5.9 },
    ],
  });
  assertEquals(s.redFlags.some((f) => /lower at the end/.test(f)), false);
});

Deno.test("regressionWatch staleness uses the exact gap, not floored days", () => {
  // Latest night 2026-09-13 ⇒ morning boundary 2026-09-14T09:00Z.
  // 2.5 days past it ⇒ stale (a floored '>2 days' check would miss this).
  const stale = {
    ...watchSnapshot(healthyRecent),
    fetchedAt: "2026-09-16T21:00:00Z",
  };
  assertEquals(regressionWatch(stale).json.status, "insufficient_data");
  // 1.5 days past ⇒ still fresh enough for a verdict.
  const fresh = {
    ...watchSnapshot(healthyRecent),
    fetchedAt: "2026-09-15T21:00:00Z",
  };
  assertEquals(regressionWatch(fresh).json.status, "normal");
});
