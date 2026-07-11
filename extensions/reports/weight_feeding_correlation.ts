/**
 * Weight vs. Feeding Intake report.
 *
 * @module
 */
import { runReport, weightFeedingCorrelation } from "./lib.ts";

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

/** Weight vs. Feeding Intake report definition. */
export const report = {
  name: "@kneel/babybuddy-weight-feeding-correlation",
  description:
    "Weight trajectory overlaid with daily feeding volume, from the latest sync",
  scope: "model",
  labels: ["babybuddy", "weight", "feeding"],
  execute: (
    context: ReportContext,
  ): Promise<{ markdown: string; json: Record<string, unknown> }> =>
    runReport(context, weightFeedingCorrelation),
};
