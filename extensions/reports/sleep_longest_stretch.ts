/**
 * Longest Sleep Stretch report.
 *
 * @module
 */
import { runReport, sleepLongestStretch } from "./lib.ts";

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

/** Longest Sleep Stretch report definition. */
export const report = {
  name: "@kneel/babybuddy-sleep-longest-stretch",
  description:
    "Longest and average consecutive sleep block per day, from the latest sync",
  scope: "model",
  labels: ["babybuddy", "sleep"],
  execute: (
    context: ReportContext,
  ): Promise<{ markdown: string; json: Record<string, unknown> }> =>
    runReport(context, sleepLongestStretch),
};
