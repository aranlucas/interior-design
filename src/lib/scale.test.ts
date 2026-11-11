import { describe, it, expect } from "vitest";
import { parseDimensions, parseRoomMeasurements, scaleNotes } from "./scale";

describe("parseDimensions", () => {
  it("reads positional metric triples", () => {
    expect(parseDimensions("211 × 88 × 83 cm")).toEqual({
      widthCm: 211,
      depthCm: 88,
      heightCm: 83,
    });
    expect(parseDimensions("88x209x83 mm")).toEqual({
      widthCm: 8.8,
      depthCm: 20.9,
      heightCm: 8.3,
    });
    expect(parseDimensions("200x90 cm")).toEqual({ widthCm: 200, depthCm: 90 });
    expect(parseDimensions("300 cm wide")).toEqual({ widthCm: 300 });
  });

  it("reads labeled dimensions", () => {
    expect(parseDimensions("Width: 228 cm × Depth: 98 cm × Height: 80 cm")).toEqual({
      widthCm: 228,
      depthCm: 98,
      heightCm: 80,
    });
    expect(parseDimensions("W:228cm D:98cm H:80cm")).toEqual({
      widthCm: 228,
      depthCm: 98,
      heightCm: 80,
    });
  });

  it("reads fractional inches", () => {
    expect(parseDimensions('W: 84 1/4" D: 37 3/4" H: 29 1/8"')).toEqual({
      widthCm: 214,
      depthCm: 95.9,
      heightCm: 74,
    });
  });

  it("combines labeled and positional parts and rejects noise", () => {
    expect(parseRoomMeasurements("4.2 × 3.6 m, ceiling 2.6 m")).toEqual({
      widthCm: 420,
      depthCm: 360,
      heightCm: 260,
    });
    expect(parseRoomMeasurements("Room is 5 by 4 meters")).toEqual({
      widthCm: 500,
      depthCm: 400,
    });
    expect(parseDimensions(undefined)).toBeUndefined();
    expect(parseDimensions("no sizes here")).toBeUndefined();
    expect(parseDimensions("")).toBeUndefined();
  });
});

describe("scaleNotes", () => {
  it("relates sizes to familiar objects and states ratios against each measured room side", () => {
    const notes = scaleNotes(
      [{ name: "Sofa", kind: "product", dimensions: "211 × 88 × 83 cm" }],
      "4.2 × 3.6 m",
    );
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain("Sofa: 211 cm wide × 88 cm deep × 83 cm high");
    // 211 / 80 cm door ≈ 2.6; 83 / 90 cm counter ≈ 0.9.
    expect(notes[0]).toContain("about 2.6 interior-door widths (~80 cm) across");
    expect(notes[0]).toContain("about 0.9× kitchen-counter height");
    // The target wall is unknown: 211 / 420 ≈ 50%, 211 / 360 ≈ 59%.
    expect(notes[0]).toContain("50% of the room's 420 cm side or 59% of the room's 360 cm side");
    expect(notes[0]).not.toContain("walkways");
  });

  it("compares tall pieces with a door and warns when a piece dominates the shorter side", () => {
    const notes = scaleNotes(
      [{ name: "Wardrobe", kind: "product", dimensions: "300 × 60 × 210 cm" }],
      "4.2 × 3.6 m",
    );
    // 210 / 203 cm door ≈ 103%; 300 / 360 ≈ 83% of the shorter side.
    expect(notes[0]).toContain("about 103% of a standard door's height");
    expect(notes[0]).toContain("83% of the room's 360 cm side");
    expect(notes[0]).toContain("keep walkways clear");
  });

  it("omits room ratios without room data and falls back to raw unparseable sizes", () => {
    expect(scaleNotes([{ name: "Table", kind: "product", dimensions: "200 × 90 cm" }])).toEqual([
      "Table: 200 cm wide × 90 cm deep — about 2.5 interior-door widths (~80 cm) across.",
    ]);
    expect(scaleNotes([{ name: "Vase", kind: "inspiration", dimensions: "large" }])).toEqual([
      "Vase: size large (interpret conservatively).",
    ]);
  });
});
