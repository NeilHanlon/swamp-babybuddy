/**
 * Feeding Intervals report.
 *
 * @module
 */
import { feedingIntervals, runReport } from "./lib.ts";

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

/** Feeding Intervals report definition. */
export const report = {
  name: "@kneel/babybuddy-feeding-intervals",
  description:
    "Time between consecutive feedings with stats and recent gaps, from the latest sync",
  scope: "model",
  labels: ["babybuddy", "feeding"],
  execute: (
    context: ReportContext,
  ): Promise<{ markdown: string; json: Record<string, unknown> }> =>
    runReport(context, feedingIntervals),
};
