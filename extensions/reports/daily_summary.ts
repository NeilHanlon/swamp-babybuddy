/**
 * Consolidated Baby Buddy daily summary report.
 *
 * Renders the latest `entries` snapshot as a per-day digest (sleep, feedings,
 * diapers, pumping, weight) in markdown and JSON.
 *
 * @module
 */
import { buildDailySummary } from "../models/babybuddy.ts";
import { runReport } from "./lib.ts";

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

/** Consolidated daily summary report definition. */
export const report = {
  name: "@kneel/babybuddy-daily-summary",
  description:
    "Consolidated per-day digest (sleep, feedings, diapers, pumping, weight) from the latest sync",
  scope: "model",
  labels: ["babybuddy", "summary"],
  execute: (
    context: ReportContext,
  ): Promise<{ markdown: string; json: Record<string, unknown> }> =>
    runReport(context, buildDailySummary),
};
