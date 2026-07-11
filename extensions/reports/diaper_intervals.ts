/**
 * Diaper Change Intervals report.
 *
 * @module
 */
import { diaperIntervals, runReport } from "./lib.ts";

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

/** Diaper Change Intervals report definition. */
export const report = {
  name: "@kneel/babybuddy-diaper-intervals",
  description:
    "Time between consecutive diaper changes with stats, from the latest sync",
  scope: "model",
  labels: ["babybuddy", "diaper"],
  execute: (
    context: ReportContext,
  ): Promise<{ markdown: string; json: Record<string, unknown> }> =>
    runReport(context, diaperIntervals),
};
