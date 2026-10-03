/**
 * Sleep Regression Watch report.
 *
 * Flags a sustained sleep regression (longest stretch craters AND night wakes
 * spike for >=3 nights) versus benign daytime nap fragmentation, comparing the
 * last week against a trailing baseline. Detects, does not predict.
 *
 * @module
 */
import { regressionWatch, runReport } from "./lib.ts";

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

/** Sleep Regression Watch report definition. */
export const report = {
  name: "@kneel/babybuddy-sleep-regression-watch",
  description:
    "Sustained sleep-regression detector vs. nap fragmentation; needs sync with sinceHours >= 720 (30d)",
  scope: "model",
  labels: ["babybuddy", "sleep"],
  execute: (
    context: ReportContext,
  ): Promise<{ markdown: string; json: Record<string, unknown> }> =>
    runReport(context, regressionWatch),
};
