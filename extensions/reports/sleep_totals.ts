/**
 * Sleep Totals report.
 *
 * @module
 */
import { runReport, sleepTotals } from "./lib.ts";

interface ReportContext {
  modelType: unknown;
  modelId: string;
  dataRepository: {
    getContent: (
      type: unknown,
      modelId: string,
      dataName: string,
      version?: number,
    ) => Promise<Uint8Array | null> | Uint8Array | null;
  };
}

/** Sleep Totals report definition. */
export const report = {
  name: "@kneel/babybuddy-sleep-totals",
  description:
    "Total sleep hours per day with nap vs night breakdown, from the latest sync",
  scope: "model",
  labels: ["babybuddy", "sleep"],
  execute: (
    context: ReportContext,
  ): Promise<{ markdown: string; json: Record<string, unknown> }> =>
    runReport(context, sleepTotals),
};
