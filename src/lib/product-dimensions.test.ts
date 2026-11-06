import { buildPrompt } from "./generation-prompts";
import { describe, it, expect } from "vitest";
import { extractProductDimensions, shopifySize } from "./product-dimensions";
import { designInput } from "./validation";
describe("physical product sizes", () => {
  it("keeps pixel sizes separate from physical product dimensions", () => {
    expect(
      extractProductDimensions(
        '<meta property="og:image:width" content="1000"><script type="application/ld+json">{"@type":"ImageObject","width":1000,"height":1000}</script>',
      ),
    ).toBeUndefined();
    expect(
      extractProductDimensions(
        '<script type="application/ld+json">{"@type":"Product","width":{"value":1000,"unitText":"px"}}</script>',
      ),
    ).toBeUndefined();
    expect(
      extractProductDimensions(
        '<script type="application/ld+json">{"@type":"Product","width":{"value":18,"unitCode":"INH"},"height":{"value":24,"unitText":"inches"}}</script>',
      ),
    ).toBe("width: 18 in × height: 24 inches");
  });
  it("lists available sizes without assuming a variant when none is selected", () => {
    const p = {
      options: [{ name: "Size", position: 1, values: ["8″×10″", "18″×24″"] }],
      variants: [
        { id: 1, options: ["8″×10″"] },
        { id: 2, options: ["18″×24″"] },
      ],
    };
    expect(shopifySize(p)).toEqual({
      dimensions: undefined,
      availableSizes: ["8″×10″", "18″×24″"],
    });
    expect(shopifySize(p, "2").dimensions).toBe("18″×24″");
  });
  it("includes the chosen physical size and room-measurement brief in the image prompt", () => {
    const input = designInput.parse({
      roomId: crypto.randomUUID(),
      baseId: crypto.randomUUID(),
      notes: "The wall is 120 inches wide",
      style: "Japandi",
      assetIds: [],
    });
    const prompt = buildPrompt(
      "Living room",
      input,
      [{ name: "Print", kind: "product", dimensions: "18 × 24 inches" }],
      1,
    );
    expect(prompt).toContain("Print: 46 cm wide × 61 cm deep");
    expect(prompt).toContain("wall is 120 inches wide");
    expect(prompt).toContain("Image pixel dimensions are not physical measurements");
  });
});
