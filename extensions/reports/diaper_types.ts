/**
 * Diaper Types report.
 *
 * @module
 */
import { diaperTypes, runReport } from "./lib.ts";

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

/** Diaper Types report definition. */
export const report = {
  name: "@kneel/babybuddy-diaper-types",
  description:
    "Daily wet/solid diaper breakdown with color counts, from the latest sync",
  scope: "model",
  labels: ["babybuddy", "diaper"],
  execute: (
    context: ReportContext,
  ): Promise<{ markdown: string; json: Record<string, unknown> }> =>
    runReport(context, diaperTypes),
};
