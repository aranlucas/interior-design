import { describe, it, expect } from "vitest";
import { formatPlan, layoutPlanSchema } from "./layout.server";

const plan = layoutPlanSchema.parse({
  roomEstimate: "back wall ~420 cm (door leaf 200 cm used as reference), ceiling ~260 cm",
  placements: [
    {
      name: "Sofa",
      position: "against the back wall, left of the window",
      widthRatio: 0.5,
      notes: "facing the window wall",
    },
    { name: "Coffee table", position: "in front of the sofa", widthRatio: 0, notes: "" },
  ],
  cautions: "Keep the radiator on the right wall unobstructed.",
});

describe("formatPlan", () => {
  it("renders the plan as compact placement sentences", () => {
    const text = formatPlan(plan);
    expect(text).toContain("Estimated room geometry: back wall ~420 cm");
    expect(text).toContain(
      "- Sofa: against the back wall, left of the window (spans about 50% of that wall's width) — facing the window wall",
    );
    expect(text).toContain("Watch out: Keep the radiator");
  });

  it("treats zero ratios and empty strings as unknown rather than stating them", () => {
    const text = formatPlan(plan);
    expect(text).toContain("- Coffee table: in front of the sofa");
    expect(text).not.toMatch(/Coffee table[^-]*spans about/);
    expect(
      formatPlan({
        roomEstimate: "",
        placements: [{ name: "", position: "", widthRatio: 0, notes: "" }],
        cautions: "",
      }),
    ).toBe("- Item: placement flexible");
  });

  it("rejects ratios outside one wall's width", () => {
    expect(
      layoutPlanSchema.safeParse({
        roomEstimate: "",
        placements: [{ name: "Sofa", position: "", widthRatio: 1.4, notes: "" }],
        cautions: "",
      }).success,
    ).toBe(false);
  });
});
