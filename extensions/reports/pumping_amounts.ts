/**
 * Pumping Amounts report.
 *
 * @module
 */
import { pumpingAmounts, runReport } from "./lib.ts";

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

/** Pumping Amounts report definition. */
export const report = {
  name: "@kneel/babybuddy-pumping-amounts",
  description:
    "Daily pumping totals, session counts, and averages, from the latest sync",
  scope: "model",
  labels: ["babybuddy", "pumping"],
  execute: (
    context: ReportContext,
  ): Promise<{ markdown: string; json: Record<string, unknown> }> =>
    runReport(context, pumpingAmounts),
};
