/**
 * Medication report.
 *
 * @module
 */
import { medicationDoses, runReport } from "./lib.ts";

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

/** Medication report definition. */
export const report = {
  name: "@kneel/babybuddy-medication",
  description:
    "Per-medication dose counts, latest dosage, and average interval, from the latest sync",
  scope: "model",
  labels: ["babybuddy", "medication"],
  execute: (
    context: ReportContext,
  ): Promise<{ markdown: string; json: Record<string, unknown> }> =>
    runReport(context, medicationDoses),
};
