/**
 * Feeding Amounts report.
 *
 * @module
 */
import { feedingAmounts, runReport } from "./lib.ts";

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

/** Feeding Amounts report definition. */
export const report = {
  name: "@kneel/babybuddy-feeding-amounts",
  description:
    "Daily feeding counts and volume split by breast vs bottle, from the latest sync",
  scope: "model",
  labels: ["babybuddy", "feeding"],
  execute: (
    context: ReportContext,
  ): Promise<{ markdown: string; json: Record<string, unknown> }> =>
    runReport(context, feedingAmounts),
};
