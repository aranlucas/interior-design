import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { exampleAiRoomLayout, exampleListingRoomLayout } from "./ai-room-layout.fixture";
import { validateAiRoomLayout, footprintArea } from "./ai-room-layout";
import { createAiRoomGroup, toSceneLayout } from "./ai-room-layout-geometry";

describe("AI architectural layout validation", () => {
  it("accepts a coherent polygon with bounded openings and valid photo evidence", () => {
    const layout = exampleAiRoomLayout();
    expect(validateAiRoomLayout(layout, 1)).toEqual(layout);
    expect(footprintArea(layout.footprint)).toBe(24);
  });
  it("rejects intersecting or collapsed floor outlines", () => {
    const layout = exampleAiRoomLayout();
    layout.footprint = [
      { x: 0, z: 0 },
      { x: 4, z: 5 },
      { x: 0, z: 6 },
      { x: 4, z: 0 },
    ];
    expect(() => validateAiRoomLayout(layout, 1)).toThrow();
    layout.footprint = [
      { x: 0, z: 0 },
      { x: 4, z: 0 },
      { x: 4, z: 6 },
      { x: 4, z: 6 },
    ];
    expect(() => validateAiRoomLayout(layout, 1)).toThrow();
  });
  it("rejects missing walls, false evidence references, and openings outside their wall", () => {
    const layout = exampleAiRoomLayout();
    layout.walls[1].edgeIndex = 0;
    expect(() => validateAiRoomLayout(layout, 1)).toThrow("exactly once");
    layout.walls[1].edgeIndex = 1;
    layout.fixtures[0].photoNumbers = [2];
    expect(() => validateAiRoomLayout(layout, 1)).toThrow("not provided");
    layout.fixtures[0].photoNumbers = [1];
    layout.walls[0].openings[0].center = 0;
    expect(() => validateAiRoomLayout(layout, 1)).toThrow("does not fit");
  });
});
function area(geometry: THREE.BufferGeometry) {
  const position = geometry.getAttribute("position"),
    index = geometry.index;
  let result = 0;
  for (let i = 0; i < (index?.count ?? position.count); i += 3) {
    const points = [0, 1, 2].map((n) =>
      new THREE.Vector3().fromBufferAttribute(position, index ? index.getX(i + n) : i + n),
    );
    result += new THREE.Triangle(points[0], points[1], points[2]).getArea();
  }
  return result;
}
describe("AI layout geometry", () => {
  it("converts plan handedness without mutating evidence, including rotated fixtures and offset outlines", () => {
    const layout = exampleAiRoomLayout();
    layout.footprint.forEach((point) => {
      point.x += 7;
    });
    layout.fixtures[0].x = 7.75;
    layout.fixtures[0].yawDegrees = 35;
    const original = structuredClone(layout);
    const scene = toSceneLayout(layout);
    expect(scene.fixtures[0]).toMatchObject({ x: 10.25, yawDegrees: -35 });
    expect(footprintArea(scene.footprint)).toBe(-footprintArea(layout.footprint));
    expect(scene.walls).toEqual(layout.walls);
    expect(toSceneLayout(scene)).toEqual(layout);
    expect(layout).toEqual(original);
  });
  it("keeps stairs and doors on the photographed sides when viewed from either end", () => {
    const model = createAiRoomGroup(exampleListingRoomLayout(), true, true);
    try {
      model.group.updateMatrixWorld(true);
      const stairs = model.group.children.find((object) => object.userData.kind === "stairs")!;
      const door = (edgeIndex: number) =>
        model.group.children.find(
          (object) => object.userData.kind === "opening" && object.userData.edgeIndex === edgeIndex,
        )!;
      function screenX(object: THREE.Object3D, fromKitchen: boolean) {
        const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
        camera.position.set(2.6, 1.5, fromKitchen ? 9.8 : 0.3);
        camera.lookAt(2.6, 1.5, fromKitchen ? 0 : 10);
        camera.updateMatrixWorld();
        return new THREE.Box3().setFromObject(object).getCenter(new THREE.Vector3()).project(camera)
          .x;
      }
      // Kitchen looking toward living: stairs right, living sliding door left.
      expect(screenX(stairs, true)).toBeGreaterThan(0);
      expect(screenX(door(0), true)).toBeLessThan(0);
      // Living looking toward kitchen: stairs left, kitchen balcony door right.
      expect(screenX(stairs, false)).toBeLessThan(0);
      expect(screenX(door(2), false)).toBeGreaterThan(0);
    } finally {
      model.dispose();
    }
  });
  it("cuts a real window hole in a wall instead of drawing a window over a solid plane", () => {
    const model = createAiRoomGroup(exampleAiRoomLayout(), true, true);
    const walls = model.group.children.filter((object) => object.userData.kind === "wall");
    expect(walls).toHaveLength(4);
    const first = walls[0];
    if (!(first instanceof THREE.Mesh)) throw new Error("Wall mesh missing");
    expect(area(first.geometry)).toBeCloseTo(4 * 2.6 - 1.2 * 1.1);
    const floor = model.group.children.find((object) => object.userData.kind === "floor");
    if (!(floor instanceof THREE.Mesh)) throw new Error("Floor mesh missing");
    expect(area(floor.geometry)).toBeCloseTo(24);
    model.dispose();
  });
  it("can hide inferred structure and fixtures independently", () => {
    const model = createAiRoomGroup(exampleAiRoomLayout(), false, false);
    expect(model.group.children.filter((object) => object.userData.kind === "wall")).toHaveLength(
      2,
    );
    expect(model.group.children.some((object) => object.userData.kind === "island")).toBe(false);
    model.dispose();
  });
});

// Rotating a box changes its occupied floor area even when its center stays inside.
it("rejects a rotated fixture crossing a wall and a fixture above the ceiling", () => {
  const layout = exampleAiRoomLayout();
  layout.fixtures[0] = { ...layout.fixtures[0], x: 0.5, width: 1, depth: 2, yawDegrees: 90 };
  expect(() => validateAiRoomLayout(layout, 1)).toThrow("outside the room");
  layout.fixtures[0].x = 2;
  expect(validateAiRoomLayout(layout, 1)).toEqual(layout);
  layout.fixtures[0].bottom = 2;
  expect(() => validateAiRoomLayout(layout, 1)).toThrow("ceiling");
});

it("rejects overlapping wall openings while allowing vertically separated ones", () => {
  const layout = exampleAiRoomLayout();
  const window = layout.walls[0].openings[0];
  layout.walls[0].openings.push({ ...window, center: 0.6 });
  expect(() => validateAiRoomLayout(layout, 1)).toThrow("overlap");
  layout.walls[0].openings[1] = { ...window, bottom: 0, height: 0.8 };
  expect(validateAiRoomLayout(layout, 1)).toEqual(layout);
});

it("rejects furniture spanning the missing corner of an L-shaped footprint", () => {
  const layout = exampleAiRoomLayout();
  layout.footprint = [
    { x: 0, z: 0 },
    { x: 4, z: 0 },
    { x: 4, z: 2 },
    { x: 2, z: 2 },
    { x: 2, z: 4 },
    { x: 0, z: 4 },
  ];
  layout.walls = layout.footprint.map((_, edgeIndex) => ({
    ...layout.walls[1],
    edgeIndex,
    openings: [],
  }));
  layout.fixtures[0] = { ...layout.fixtures[0], x: 1.8, z: 1.8, width: 2, depth: 2 };
  expect(() => validateAiRoomLayout(layout, 1)).toThrow("outside the room");
});

it("keeps detailed furniture inside its declared box and disposes material textures", () => {
  const layout = exampleAiRoomLayout();
  layout.floorMaterial = "wood";
  layout.fixtures = ["sofa", "bed", "table"].map((kind) => ({
    ...layout.fixtures[0],
    kind: kind as "sofa" | "bed" | "table",
    width: 2,
    depth: 1.5,
    height: 1,
  }));
  const model = createAiRoomGroup(layout, true, true);
  for (const fixture of model.group.children.filter((o) =>
    ["sofa", "bed", "table"].includes(o.userData.kind),
  )) {
    const bounds = new THREE.Box3().setFromObject(fixture);
    expect(bounds.min.x).toBeGreaterThanOrEqual(1 - 1e-6);
    expect(bounds.max.x).toBeLessThanOrEqual(3 + 1e-6);
    expect(bounds.min.y).toBeGreaterThanOrEqual(0 - 1e-6);
    expect(bounds.max.y).toBeLessThanOrEqual(1 + 1e-6);
    expect(bounds.min.z).toBeGreaterThanOrEqual(2.25 - 1e-6);
    expect(bounds.max.z).toBeLessThanOrEqual(3.75 + 1e-6);
  }
  const floor = model.group.children.find((o) => o.userData.kind === "floor") as THREE.Mesh<
    THREE.BufferGeometry,
    THREE.MeshStandardMaterial
  >;
  expect(floor.material.map).toBeInstanceOf(THREE.DataTexture);
  let disposed = false;
  floor.material.map!.addEventListener("dispose", () => {
    disposed = true;
  });
  model.dispose();
  expect(disposed).toBe(true);
});
