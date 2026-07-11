/**
 * Tummy Time report.
 *
 * @module
 */
import { runReport, tummyTime } from "./lib.ts";

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

/** Tummy Time report definition. */
export const report = {
  name: "@kneel/babybuddy-tummy-time",
  description:
    "Daily tummy-time totals and session counts, from the latest sync",
  scope: "model",
  labels: ["babybuddy", "tummy-time"],
  execute: (
    context: ReportContext,
  ): Promise<{ markdown: string; json: Record<string, unknown> }> =>
    runReport(context, tummyTime),
};
