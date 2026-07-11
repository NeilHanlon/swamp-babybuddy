/**
 * Temperature Readings report.
 *
 * @module
 */
import { runReport, temperature } from "./lib.ts";

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

/** Temperature Readings report definition. */
export const report = {
  name: "@kneel/babybuddy-temperature",
  description:
    "All temperature readings over the window in Celsius and Fahrenheit, from the latest sync",
  scope: "model",
  labels: ["babybuddy", "temperature"],
  execute: (
    context: ReportContext,
  ): Promise<{ markdown: string; json: Record<string, unknown> }> =>
    runReport(context, temperature),
};
