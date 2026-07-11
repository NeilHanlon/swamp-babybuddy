/**
 * Weight Trend report.
 *
 * @module
 */
import { runReport, weightTrend } from "./lib.ts";

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

/** Weight Trend report definition. */
export const report = {
  name: "@kneel/babybuddy-weight-trend",
  description:
    "Weight measurements with per-reading and net change, from the latest sync",
  scope: "model",
  labels: ["babybuddy", "weight"],
  execute: (
    context: ReportContext,
  ): Promise<{ markdown: string; json: Record<string, unknown> }> =>
    runReport(context, weightTrend),
};
