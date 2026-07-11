/**
 * Feeding Duration report.
 *
 * @module
 */
import { feedingDuration, runReport } from "./lib.ts";

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

/** Feeding Duration report definition. */
export const report = {
  name: "@kneel/babybuddy-feeding-duration",
  description:
    "Average and total feeding duration per day, from the latest sync",
  scope: "model",
  labels: ["babybuddy", "feeding"],
  execute: (
    context: ReportContext,
  ): Promise<{ markdown: string; json: Record<string, unknown> }> =>
    runReport(context, feedingDuration),
};
