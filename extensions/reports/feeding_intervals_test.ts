import { assertEquals } from "jsr:@std/assert@1";
import { report } from "./feeding_intervals.ts";

Deno.test("feeding_intervals report identity and no-snapshot path", async () => {
  assertEquals(report.name, "@kneel/babybuddy-feeding-intervals");
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
