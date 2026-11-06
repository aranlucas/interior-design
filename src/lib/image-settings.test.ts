import { expect, it } from "vitest";
import { outputCost } from "./image-settings";

// The documented $30/1M output-token rate covers both families and variants.
// Catch missing pricing for 2.6 or losing pricing for a configured 2.5 model.
it.each([
  "gpt-image-2.5-sunburst",
  "gpt-image-2.5-flare-2026-09-08",
  "gpt-image-2.6-sunburst",
  "gpt-image-2.6-flare",
])("prices %s output tokens at the documented rate", (model) => {
  expect(outputCost(model, 1_000_000)).toBe(30);
});

it("leaves cost unknown without usage or verified model pricing", () => {
  expect(outputCost("gpt-image-2.6-sunburst", undefined)).toBeUndefined();
  expect(outputCost("custom-image-model", 1_000_000)).toBeUndefined();
});
