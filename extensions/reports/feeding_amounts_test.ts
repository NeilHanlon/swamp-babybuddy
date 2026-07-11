import { assertEquals } from "jsr:@std/assert@1";
import { report } from "./feeding_amounts.ts";

Deno.test("feeding_amounts report identity and no-snapshot path", async () => {
  assertEquals(report.name, "@kneel/babybuddy-feeding-amounts");
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
