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
  ageBand: null,
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
  ageBand: null,
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

/**
 * Feedings placed strictly inside the first `count` awake gaps of the sleep
 * sessions {@link nightSessions} builds for `night`, so each lands in a distinct
 * gap and credits one fed wake. Mirrors the breastfed case where nearly every
 * waking has a nurse logged in it.
 */
function fedFeedings(
  night: string,
  count: number,
): Array<Record<string, unknown>> {
  const morning = ad(night, 1);
  const out: Array<Record<string, unknown>> = [];
  for (let g = 0; g < count; g++) {
    const t = g === 0 ? "01:15" : `${String(g + 1).padStart(2, "0")}:45`;
    out.push({ start: `${morning}T${t}:00Z`, method: "both breasts" });
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
  // 18 uniform baseline nights (longest 3.5h, 2 wakes) inside the baseline window
  // [latest-37, latest-10] (BASELINE_GAP_DAYS=10 ⇒ baseline ends at latest-10).
  for (let k = 10; k <= 27; k++) {
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
  assertEquals((j.baseline as { nights: number }).nights, 18);
  // Uniform baseline ⇒ σ=0 ⇒ thresholds equal the baseline means.
  assertEquals(j.thresholds, {
    stretchLowH: 3.5,
    wakesHighCount: 2,
    absoluteFloorH: 2.67,
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

Deno.test("regressionWatch counts fed wakes (breastfed) toward the wake axis", () => {
  // Baseline: 12 calm nights (3.5h, 2 wakes, no feeds). Recent: 3 bad nights
  // where EVERY waking has a nurse in the gap. The old spontaneous-only axis
  // wrote these off (spontaneous≈0 ⇒ nap_fragmentation at most); total wakes
  // against the child's own baseline now flags the regression.
  const sleep: Array<Record<string, unknown>> = [];
  const feedings: Array<Record<string, unknown>> = [];
  for (let k = 10; k <= 27; k++) {
    sleep.push(...nightSessions(ad(LATEST, -k), 3.5, 2));
  }
  const recent = [
    { k: 6, longestH: 3.5, wakes: 2 },
    { k: 5, longestH: 3.5, wakes: 2 },
    { k: 4, longestH: 3.5, wakes: 2 },
    { k: 3, longestH: 3.5, wakes: 2 },
    { k: 2, longestH: 1.5, wakes: 5 },
    { k: 1, longestH: 1.5, wakes: 5 },
    { k: 0, longestH: 1.5, wakes: 5 },
  ];
  for (const r of recent) {
    sleep.push(...nightSessions(ad(LATEST, -r.k), r.longestH, r.wakes));
    if (r.longestH < 3) {
      feedings.push(...fedFeedings(ad(LATEST, -r.k), r.wakes));
    }
  }
  const snap: EntriesSnapshot = {
    ...empty,
    fetchedAt: "2026-09-14T12:00:00Z",
    sinceHours: 720,
    sleep,
    feedings,
  };
  const j = regressionWatch(snap).json as Record<string, unknown>;
  assertEquals(j.status, "regression");
  const rows = j.recent as Array<Record<string, unknown>>;
  const last = rows.find((r) => r.nightDate === LATEST)!;
  assertEquals(last.wakes, 5);
  assertEquals(last.fedWakes, 5); // every waking was a nurse
  assertEquals(last.spontaneousWakes, 0); // old axis would read ~0 and miss it
  assertEquals(last.wakesHigh, true); // total-wakes axis fires
});

Deno.test("regressionWatch raises 'watch' on a non-consecutive majority of low-stretch nights", () => {
  // 4 of 7 nights low on longest stretch but interleaved (no 3 consecutive) ⇒
  // not nap_fragmentation; the majority arm still raises an early warning. 2.75h
  // keeps the night total above the sparse floor and above the absolute floor,
  // so the low-stretch majority (not an excluded-night or floor artifact) drives it.
  const snap = watchSnapshot([
    { k: 6, longestH: 2.75, wakes: 2 },
    { k: 5, longestH: 3.5, wakes: 2 },
    { k: 4, longestH: 2.75, wakes: 2 },
    { k: 3, longestH: 3.5, wakes: 2 },
    { k: 2, longestH: 2.75, wakes: 2 },
    { k: 1, longestH: 3.5, wakes: 2 },
    { k: 0, longestH: 2.75, wakes: 2 },
  ]);
  const j = regressionWatch(snap).json as Record<string, unknown>;
  assertEquals(j.status, "watch");
  assertEquals((j.watchArms as Record<string, unknown>).majorityBreach, true);
});

Deno.test("regressionWatch applies an anonymized age band (floor + window note)", () => {
  const base = [
    { k: 6, longestH: 3.5, wakes: 2 },
    { k: 5, longestH: 3.5, wakes: 2 },
    { k: 4, longestH: 3.5, wakes: 2 },
    { k: 3, longestH: 3.5, wakes: 2 },
    { k: 2, longestH: 3.5, wakes: 2 },
    { k: 1, longestH: 3.5, wakes: 2 },
    { k: 0, longestH: 3.5, wakes: 2 },
  ];
  // <4mo: the absolute floor is suppressed (newborn sleep isn't consolidated)
  // and the note flags the architectural ~4-month regression ahead.
  const newborn = { ...watchSnapshot(base), ageBand: "<4mo" };
  const jn = regressionWatch(newborn).json as Record<string, unknown>;
  assertEquals(jn.ageBand, "<4mo");
  assertEquals((jn.thresholds as Record<string, unknown>).absoluteFloorH, null);
  assertEquals((jn.windowNote as string).includes("4-month"), true);

  // 8-10mo: generic floor applies, note names the window.
  const older = { ...watchSnapshot(base), ageBand: "8-10mo" };
  const jo = regressionWatch(older).json as Record<string, unknown>;
  assertEquals((jo.thresholds as Record<string, unknown>).absoluteFloorH, 2.67);
  assertEquals((jo.windowNote as string).includes("8"), true);
});

Deno.test("regressionWatch flags a single-axis stretch collapse as regression (flat wakes)", () => {
  // Longest stretch sustained-low but wakes NORMAL — the high-baseline-waker
  // case where the wake axis can't register the event, so the stretch collapse
  // must qualify on its own (would have been mislabeled nap_fragmentation before).
  const snap = watchSnapshot([
    { k: 6, longestH: 2.6, wakes: 2 },
    { k: 5, longestH: 2.6, wakes: 2 },
    { k: 4, longestH: 2.6, wakes: 2 },
    { k: 3, longestH: 2.6, wakes: 2 },
    { k: 2, longestH: 2.6, wakes: 2 },
    { k: 1, longestH: 2.6, wakes: 2 },
    { k: 0, longestH: 2.6, wakes: 2 },
  ]);
  const j = regressionWatch(snap).json as Record<string, unknown>;
  assertEquals(j.status, "regression");
  assertEquals(
    (j.stretchCollapse as Record<string, unknown>).triggered,
    true,
  );
  // It's the single-axis path: no night had elevated wakes.
  const rows = j.recent as Array<Record<string, unknown>>;
  assertEquals(rows.every((r) => r.wakesHigh === false), true);
});

Deno.test("regressionWatch marks a concordant two-axis onset (stretch collapse + wake elevation)", () => {
  // Stretch collapses AND wakes rise together ⇒ wakeElevated corroborates,
  // concordant=true (highest-confidence regression).
  const snap = watchSnapshot([
    { k: 6, longestH: 2.0, wakes: 4 },
    { k: 5, longestH: 2.0, wakes: 4 },
    { k: 4, longestH: 2.0, wakes: 4 },
    { k: 3, longestH: 2.0, wakes: 4 },
    { k: 2, longestH: 2.0, wakes: 4 },
    { k: 1, longestH: 2.0, wakes: 4 },
    { k: 0, longestH: 2.0, wakes: 4 },
  ]);
  const j = regressionWatch(snap).json as Record<string, unknown>;
  assertEquals(j.status, "regression");
  const we = j.wakeElevation as Record<string, unknown>;
  assertEquals(we.elevated, true);
  assertEquals(we.concordant, true);
});

Deno.test("regressionWatch onset-guard trims a baseline tail already drifting into the regression", () => {
  // Baseline head (older) is healthy; the newest 7 baseline nights are degraded
  // (a slow onset that bled past the gap). The guard trims that block so the
  // baseline stats reflect the pre-onset head, not the contamination.
  const sleep: Array<Record<string, unknown>> = [];
  // 14 healthy head nights (k=17..30) + 7 degraded trailing baseline nights (k=10..16).
  for (let k = 17; k <= 30; k++) {
    sleep.push(...nightSessions(ad(LATEST, -k), 3.9, 2));
  }
  for (let k = 10; k <= 16; k++) {
    sleep.push(...nightSessions(ad(LATEST, -k), 2.5, 5)); // onset bleed
  }
  for (let k = 0; k <= 6; k++) {
    sleep.push(...nightSessions(ad(LATEST, -k), 3.9, 2)); // benign recent
  }
  const snap: EntriesSnapshot = {
    ...empty,
    fetchedAt: "2026-09-14T12:00:00Z",
    sinceHours: 2160,
    sleep,
  };
  const base = regressionWatch(snap).json.baseline as {
    nights: number;
    nightsTrimmed: number;
    muStretchH: number;
  };
  assertEquals(base.nightsTrimmed, 7); // the degraded trailing block was dropped
  assertEquals(base.nights, 14); // only the healthy head retained
  assertEquals(base.muStretchH, 3.9); // stats reflect the pre-onset head
});

Deno.test("regressionWatch labels a mild sustained stretch dip as night_consolidation_loss", () => {
  // Below baseline and sustained, but short of the collapse magnitude (G2) ⇒ the
  // renamed intermediate tier, not regression and not the daytime 'fragmentation'.
  const snap = watchSnapshot([
    { k: 6, longestH: 3.2, wakes: 2 },
    { k: 5, longestH: 3.2, wakes: 2 },
    { k: 4, longestH: 3.2, wakes: 2 },
    { k: 3, longestH: 3.2, wakes: 2 },
    { k: 2, longestH: 3.2, wakes: 2 },
    { k: 1, longestH: 3.2, wakes: 2 },
    { k: 0, longestH: 3.2, wakes: 2 },
  ]);
  assertEquals(regressionWatch(snap).json.status, "night_consolidation_loss");
});

Deno.test("regressionWatch raises 'watch' on 3 soft breaches, but not on 2", () => {
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

  // Only 2 soft breaches (<3) and no majority ⇒ bar not met ⇒ normal (no crying wolf).
  const two = watchSnapshot([
    { k: 6, longestH: 3.5, wakes: 2 },
    { k: 5, longestH: 3.5, wakes: 2 },
    { k: 4, longestH: 3.5, wakes: 2 },
    { k: 3, longestH: 3.5, wakes: 2 },
    { k: 2, longestH: 3.5, wakes: 3 }, // breach
    { k: 1, longestH: 3.5, wakes: 2 },
    { k: 0, longestH: 3.5, wakes: 3 }, // breach (non-consecutive)
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
  // Default: trailing 28-night window (latest-37 .. latest-10, gap=10).
  const def = regressionWatch(snap).json.baseline as { nights: number };
  assertEquals(def.nights, 28);
  // baselineDays=0: span every available night before the gap (k=10..46 = 37).
  const spanned = regressionWatch(snap, { baselineDays: 0 }).json.baseline as {
    nights: number;
  };
  assertEquals(spanned.nights, 37);
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
