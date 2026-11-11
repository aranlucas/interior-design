import { describe, expect, it } from "vitest";
import {
  correctHandedness,
  mirrorAiRoomLayout,
  repairAiRoomLayout,
  scaleAiRoomLayout,
  validateAiRoomLayout,
  wallLength,
  type AiRoomLayout,
} from "./ai-room-layout";
import { scenePhotoCamera, toSceneLayout } from "./ai-room-layout-geometry";
import { describeGuide, guideView } from "./guide-projection";
import { exampleAiRoomLayout } from "./ai-room-layout.fixture";

/** A 4 × 6 room with a sofa on the left and a TV on the right of a camera facing plan +z. */
function livingRoom(order: string[]): AiRoomLayout {
  const layout = exampleAiRoomLayout();
  const box = { bottom: 0, depth: 0.8, height: 0.8, yawDegrees: 0, color: "#888888" };
  const evidence = { support: "visible" as const, photoNumbers: [1] };
  layout.fixtures = [
    { ...box, ...evidence, label: "Sofa", kind: "sofa", x: 0.8, z: 4, width: 1.2 },
    { ...box, ...evidence, label: "Lamp", kind: "other", x: 2, z: 5, width: 0.4 },
    { ...box, ...evidence, label: "TV", kind: "tv", x: 3.2, z: 4, width: 1.2 },
  ];
  layout.cameras = [
    {
      photoNumber: 1,
      x: 2,
      z: 0.5,
      height: 1.5,
      yawDegrees: 0,
      hfovDegrees: 70,
      leftToRight: order,
    },
  ];
  return layout;
}

describe("photo handedness", () => {
  it("keeps a plan whose positions match the photo's left-to-right order", () => {
    // Facing plan +z, larger x is on the right, so the sofa (x 0.8) is left of the TV (x 3.2).
    const layout = livingRoom(["Sofa", "Lamp", "TV"]);
    expect(correctHandedness(layout)).toBe(layout);
  });

  it("mirrors a plan whose positions contradict the photo's left-to-right order", () => {
    const corrected = correctHandedness(livingRoom(["TV", "Lamp", "Sofa"]));
    const sofa = corrected.fixtures.find((f) => f.label === "Sofa")!;
    const tv = corrected.fixtures.find((f) => f.label === "TV")!;
    expect(sofa.x).toBeCloseTo(3.2);
    expect(tv.x).toBeCloseTo(0.8);
    expect(corrected.assumptions.at(-1)).toContain("swapped automatically");
    expect(() => validateAiRoomLayout(corrected, 1)).not.toThrow();
  });

  it("ignores weak evidence rather than flipping on a single pair", () => {
    const layout = livingRoom(["TV", "Sofa"]);
    expect(correctHandedness(layout)).toBe(layout);
  });

  it("mirrors reversibly and keeps each opening on its wall", () => {
    const layout = exampleAiRoomLayout();
    layout.fixtures[0].yawDegrees = 30;
    const mirrored = mirrorAiRoomLayout(layout);
    expect(mirrored.fixtures[0].yawDegrees).toBe(-30);
    expect(mirrored.walls).toEqual(layout.walls);
    expect(wallLength(mirrored, 0)).toBeCloseTo(wallLength(layout, 0));
    expect(mirrorAiRoomLayout(mirrored)).toEqual(layout);
  });
});

describe("layout repair and calibration", () => {
  it("fixes unambiguous slips: an offset plan, an oversized opening, a raised doorway", () => {
    const layout = exampleAiRoomLayout();
    for (const item of [...layout.footprint, ...layout.fixtures]) {
      item.x += 1;
      item.z += 2;
    }
    layout.walls[0].openings = [
      { ...layout.walls[0].openings[0], width: 4.5, center: 0.9 },
      {
        kind: "door",
        center: 0.2,
        width: 0.8,
        bottom: 0.3,
        height: 2,
        support: "visible",
        photoNumbers: [1, 3],
      },
    ];
    expect(() => validateAiRoomLayout(layout, 1)).toThrow();
    const repaired = repairAiRoomLayout(layout, 1);
    expect(Math.min(...repaired.footprint.map((p) => p.x))).toBe(0);
    expect(Math.min(...repaired.footprint.map((p) => p.z))).toBe(0);
    expect(repaired.fixtures[0]).toMatchObject({ x: 2, z: 3 });
    const [window, door] = repaired.walls[0].openings;
    // A 4 m wall leaves 3.96 m once a 2 cm margin is kept at each end.
    expect(window.width).toBeCloseTo(3.96);
    // Center 0.9 is pulled in until the 3.96 m window ends at the wall: 1 − 1.98 / 4 = 0.505.
    expect(window.center).toBeCloseTo(0.505, 3);
    expect(door).toMatchObject({ bottom: 0, photoNumbers: [1] });
  });

  it("scales estimated geometry to one measured wall while products keep their confirmed size", () => {
    const layout = exampleAiRoomLayout();
    layout.products = [
      {
        assetId: crypto.randomUUID(),
        label: "Sofa",
        x: 2,
        z: 3,
        width: 2.11,
        depth: 0.88,
        height: 0.83,
        yawDegrees: 0,
      },
    ];
    // The 4 m wall measures 5 m: everything estimated grows by 1.25.
    const scaled = scaleAiRoomLayout(layout, 5 / wallLength(layout, 0));
    expect(wallLength(scaled, 0)).toBeCloseTo(5);
    expect(scaled.ceilingHeight).toBeCloseTo(3.25);
    expect(scaled.fixtures[0].width).toBeCloseTo(1.875);
    expect(scaled.products![0]).toMatchObject({ x: 2.5, z: 3.75, width: 2.11, depth: 0.88 });
  });

  it("rejects placed products that leave the room", () => {
    const layout = exampleAiRoomLayout();
    layout.products = [
      {
        assetId: crypto.randomUUID(),
        label: "Sofa",
        x: 3.8,
        z: 3,
        width: 2.11,
        depth: 0.88,
        height: 0.83,
        yawDegrees: 0,
      },
    ];
    expect(() => validateAiRoomLayout(layout, 1)).toThrow("outside the room");
  });
});

describe("cameras", () => {
  it("points a photo viewpoint the way the photo faced, after the scene reflection", () => {
    const layout = exampleAiRoomLayout();
    // Yaw 90 faces plan +x; the scene reflects x, so the camera must look toward smaller scene x.
    layout.cameras = [{ ...layout.cameras![0], x: 1, z: 3, yawDegrees: 90 }];
    const pose = scenePhotoCamera(toSceneLayout(layout).cameras![0], 1.5);
    expect(pose.position[0]).toBeCloseTo(3);
    expect(pose.target[0]).toBeLessThan(pose.position[0]);
    expect(pose.target[2]).toBeCloseTo(pose.position[2]);
    // 70° horizontal at 3:2 is 2·atan(tan 35° / 1.5) ≈ 50° vertical.
    expect(pose.fov).toBeCloseTo(50, 0);
  });

  it("projects plan-right fixtures into the right half of an image facing plan +z", () => {
    const layout = livingRoom(["Sofa", "Lamp", "TV"]);
    const scene = scenePhotoCamera(toSceneLayout(layout).cameras![0], 1.5);
    const capture = {
      resultId: crypto.randomUUID(),
      camera: { position: scene.position, target: scene.target, fov: scene.fov, aspect: 1.5 },
      showInferred: true,
      showFixtures: true,
    };
    expect(guideView(layout, capture)).toMatchObject({ interior: true, eyeLevel: true });
    const text = describeGuide(layout, capture, () => undefined, true);
    const left = (label: string) =>
      Number(new RegExp(`${label} \\(.*?image 1 x (\\d\\.\\d\\d)`).exec(text)![1]);
    expect(left("Sofa")).toBeLessThan(0.5);
    expect(left("TV")).toBeGreaterThan(0.5);
    expect(left("Sofa")).toBeLessThan(left("Lamp"));
    expect(left("Lamp")).toBeLessThan(left("TV"));
  });

  it("labels fixtures behind the camera as outside the frame", () => {
    const layout = livingRoom(["Sofa"]);
    const capture = {
      resultId: crypto.randomUUID(),
      // Scene camera at the back of the room looking toward z = 0, away from every fixture.
      camera: {
        position: [2, 1.5, 5.8] as [number, number, number],
        target: [2, 1.5, 0] as [number, number, number],
        fov: 40,
        aspect: 1.5,
      },
      showInferred: true,
      showFixtures: true,
    };
    layout.fixtures = layout.fixtures.map((f) => ({ ...f, z: 5.9, depth: 0.1 }));
    expect(describeGuide(layout, capture, () => undefined, true)).toContain(
      "Sofa (sofa, visible in photo 1), about 1.2 m × 0.1 m × 0.8 m, outside the captured frame",
    );
  });
});
