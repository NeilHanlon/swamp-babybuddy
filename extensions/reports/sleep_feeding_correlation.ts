/**
 * Sleep vs. Feeding Correlation report.
 *
 * @module
 */
import { runReport, sleepFeedingCorrelation } from "./lib.ts";

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

/** Sleep vs. Feeding Correlation report definition. */
export const report = {
  name: "@kneel/babybuddy-sleep-feeding-correlation",
  description:
    "Daily sleep totals alongside feeding count and volume, from the latest sync",
  scope: "model",
  labels: ["babybuddy", "sleep", "feeding"],
  execute: (
    context: ReportContext,
  ): Promise<{ markdown: string; json: Record<string, unknown> }> =>
    runReport(context, sleepFeedingCorrelation),
};
