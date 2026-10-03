import { assertEquals } from "jsr:@std/assert@1";
import { report } from "./sleep_regression_watch.ts";

Deno.test("sleep_regression_watch report identity and no-snapshot path", async () => {
  assertEquals(report.name, "@kneel/babybuddy-sleep-regression-watch");
  assertEquals(report.scope, "model");
  assertEquals(Array.isArray(report.labels), true);
  const res = await report.execute({
    modelType: "t",
    modelId: "m",
    dataRepository: { getContent: () => null },
  });
  assertEquals(
    (res.json as { message?: string }).message,
    "no entries snapshot",
  );
});
