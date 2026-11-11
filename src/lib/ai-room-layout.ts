import type { Asset } from "./types";
import { z } from "zod";

const distance = z.number().min(0).max(30);
const extent = z.number().min(0.1).max(15);
const yaw = z.number().min(-180).max(180);
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const roomMaterial = z.enum([
  "paint",
  "wood",
  "tile",
  "stone",
  "concrete",
  "metal",
  "fabric",
  "glass",
  "unknown",
]);
const evidence = {
  support: z.enum(["visible", "inferred"]),
  photoNumbers: z.array(z.number().int().min(1).max(8)).max(8),
};
export const fixtureKinds = [
  "cabinet",
  "island",
  "refrigerator",
  "range",
  "sink",
  "stairs",
  "sofa",
  "armchair",
  "chair",
  "bed",
  "table",
  "desk",
  "wardrobe",
  "shelving",
  "tv",
  "fireplace",
  "radiator",
  "toilet",
  "bathtub",
  "shower",
  "rug",
  "other",
] as const;
/**
 * OpenAI strict structured output requires every property to be listed as required, so the
 * model-facing schema uses required materials ("unknown" when uncertain). Stored layouts keep
 * them optional because builds from before material support have none.
 */
const layoutShape = <M extends z.ZodType>(material: M) => {
  const fixture = z.object({
    label: z.string().min(1).max(80),
    kind: z.enum(fixtureKinds),
    x: distance,
    z: distance,
    bottom: z.number().min(0).max(5),
    width: extent,
    depth: z.number().min(0.01).max(15),
    height: z.number().min(0.01).max(15),
    yawDegrees: yaw,
    color,
    material,
    ...evidence,
  });
  return {
    summary: z.string().min(1).max(500),
    assumptions: z.array(z.string().min(1).max(250)).max(10),
    footprint: z
      .array(z.object({ x: distance, z: distance }))
      .min(3)
      .max(12),
    ceilingHeight: z.number().min(1.8).max(6),
    floorColor: color,
    floorMaterial: material,
    walls: z
      .array(
        z.object({
          edgeIndex: z.number().int().min(0).max(11),
          label: z.string().min(1).max(80),
          color,
          material,
          ...evidence,
          openings: z
            .array(
              z.object({
                kind: z.enum(["window", "door", "passage"]),
                center: z.number().min(0).max(1),
                width: extent,
                bottom: z.number().min(0).max(5),
                height: z.number().min(0.2).max(6),
                ...evidence,
              }),
            )
            .max(6),
        }),
      )
      .min(3)
      .max(12),
    fixtures: z.array(fixture).max(40),
  };
};
const camera = z.object({
  photoNumber: z.number().int().min(1).max(8),
  x: distance,
  z: distance,
  height: z.number().min(0.2).max(4),
  yawDegrees: yaw,
  hfovDegrees: z.number().min(20).max(130),
  leftToRight: z.array(z.string().min(1).max(80)).max(12),
});
const product = z.object({
  assetId: z.uuid(),
  label: z.string().min(1).max(120),
  x: distance,
  z: distance,
  width: extent,
  depth: extent,
  height: extent,
  yawDegrees: yaw,
});
/** The schema the vision model must fill: every field required for strict structured output. */
export const aiRoomLayoutInput = z.object({
  ...layoutShape(roomMaterial),
  cameras: z.array(camera).max(8),
});
/** Stored layouts: older builds have no cameras; client-placed products exist only after edits. */
export const storedAiRoomLayout = z.object({
  ...layoutShape(roomMaterial.optional()),
  cameras: z.array(camera).max(8).optional(),
  products: z.array(product).max(10).optional(),
});
/** Stored plan coordinates: +x is right when facing +z; convert before Three.js rendering. */
export type AiRoomLayout = z.infer<typeof storedAiRoomLayout>;
export type AiRoomFixture = AiRoomLayout["fixtures"][number];
export type AiRoomCamera = NonNullable<AiRoomLayout["cameras"]>[number];
export type AiRoomProduct = NonNullable<AiRoomLayout["products"]>[number];

export function footprintArea(points: AiRoomLayout["footprint"]) {
  return (
    points.reduce((sum, point, i) => {
      const next = points[(i + 1) % points.length];
      return sum + point.x * next.z - next.x * point.z;
    }, 0) / 2
  );
}

export function wallLength(layout: AiRoomLayout, edgeIndex: number) {
  const a = layout.footprint[edgeIndex],
    b = layout.footprint[(edgeIndex + 1) % layout.footprint.length];
  return a && b ? Math.hypot(b.x - a.x, b.z - a.z) : 0;
}

const round = (value: number) => Math.round(value * 1000) / 1000;

/**
 * Fix small, unambiguous model slips instead of failing a paid build: shift the plan so its
 * minimum corner is the origin, fit openings inside their walls, and downgrade evidence that
 * cites photos that were not supplied. Topology, fixture extents and heights are left for
 * validation to reject, since guessing a fix there would hide a misread room.
 */
export function repairAiRoomLayout(layout: AiRoomLayout, photoCount: number): AiRoomLayout {
  const next = structuredClone(layout);
  const minX = Math.min(...next.footprint.map((p) => p.x)),
    minZ = Math.min(...next.footprint.map((p) => p.z));
  if (minX > 0 || minZ > 0) {
    const shift = <T extends { x: number; z: number }>(item: T) => {
      item.x = Math.max(0, round(item.x - minX));
      item.z = Math.max(0, round(item.z - minZ));
    };
    next.footprint.forEach(shift);
    next.fixtures.forEach(shift);
    next.cameras?.forEach(shift);
    next.products?.forEach(shift);
  }
  const cite = (item: { support: "visible" | "inferred"; photoNumbers: number[] }) => {
    item.photoNumbers = [...new Set(item.photoNumbers.filter((n) => n <= photoCount))];
    if (item.support === "visible" && !item.photoNumbers.length) item.support = "inferred";
  };
  next.fixtures.forEach(cite);
  next.cameras = next.cameras?.filter((c) => c.photoNumber <= photoCount);
  for (const wall of next.walls) {
    cite(wall);
    const length = wallLength(next, wall.edgeIndex);
    if (!length) continue;
    for (const opening of wall.openings) {
      cite(opening);
      if (opening.kind !== "window") opening.bottom = 0;
      opening.width = round(Math.max(0.1, Math.min(opening.width, length - 0.04)));
      const half = opening.width / 2 / length;
      opening.center = round(Math.min(1 - half, Math.max(half, opening.center)));
      if (opening.bottom > next.ceilingHeight - 0.3) opening.bottom = round(next.ceilingHeight / 3);
      opening.height = round(
        Math.max(0.2, Math.min(opening.height, next.ceilingHeight - opening.bottom)),
      );
    }
  }
  return next;
}

/** Validate references and topology beyond the provider's JSON-schema checks. */
export function validateAiRoomLayout(value: unknown, photoCount: number): AiRoomLayout {
  const layout = storedAiRoomLayout.parse(value);
  const points = layout.footprint;
  if (Math.abs(footprintArea(points)) < 1)
    throw new Error(
      "The AI layout has an invalid floor outline. Try another build with clearer room views.",
    );
  const cross = (a: (typeof points)[number], b: typeof a, c: typeof a) =>
    (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
  const between = (x: number, a: number, b: number) =>
    x >= Math.min(a, b) - 1e-8 && x <= Math.max(a, b) + 1e-8;
  const onSegment = (a: (typeof points)[number], b: typeof a, p: typeof a) =>
    Math.abs(cross(a, b, p)) < 1e-8 && between(p.x, a.x, b.x) && between(p.z, a.z, b.z);
  for (let i = 0; i < points.length; i++) {
    const a = points[i],
      b = points[(i + 1) % points.length];
    if (Math.hypot(b.x - a.x, b.z - a.z) < 0.1)
      throw new Error("The AI layout contains a collapsed wall.");
    for (let j = i + 1; j < points.length; j++) {
      if (j === i + 1 || (i === 0 && j === points.length - 1)) continue;
      const c = points[j],
        d = points[(j + 1) % points.length];
      if (
        (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0) ||
        onSegment(a, b, c) ||
        onSegment(a, b, d) ||
        onSegment(c, d, a) ||
        onSegment(c, d, b)
      )
        throw new Error("The AI layout has intersecting walls. Try again with clearer room views.");
    }
  }
  if (
    layout.walls.length !== points.length ||
    new Set(layout.walls.map((wall) => wall.edgeIndex)).size !== points.length
  )
    throw new Error("The AI layout did not describe each wall exactly once.");
  const supports = [
    ...layout.walls,
    ...layout.walls.flatMap((wall) => wall.openings),
    ...layout.fixtures,
  ];
  if (
    supports.some(
      (item) =>
        item.photoNumbers.some((n) => n > photoCount) ||
        (item.support === "visible" && !item.photoNumbers.length),
    ) ||
    layout.cameras?.some((c) => c.photoNumber > photoCount)
  )
    throw new Error("The AI layout referenced a photo that was not provided.");
  if (
    layout.products &&
    new Set(layout.products.map((p) => p.assetId)).size !== layout.products.length
  )
    throw new Error("Each product can be placed once in the layout.");
  for (const wall of layout.walls) {
    const length = wallLength(layout, wall.edgeIndex);
    if (!length) throw new Error("The AI layout referenced an unknown wall.");
    for (const opening of wall.openings) {
      if (
        opening.center * length - opening.width / 2 < -0.02 ||
        opening.center * length + opening.width / 2 > length + 0.02 ||
        opening.bottom + opening.height > layout.ceilingHeight + 0.02
      )
        throw new Error("An AI-estimated opening does not fit its wall. Try another build.");
      if (opening.kind !== "window" && opening.bottom > 0.02)
        throw new Error("An AI-estimated doorway must meet the floor.");
    }
    const spans = wall.openings.map((opening) => ({
      left: opening.center * length - opening.width / 2,
      right: opening.center * length + opening.width / 2,
      bottom: opening.bottom,
      top: opening.bottom + opening.height,
    }));
    if (
      spans.some((a, i) =>
        spans
          .slice(i + 1)
          .some(
            (b) =>
              Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.02 &&
              Math.min(a.top, b.top) - Math.max(a.bottom, b.bottom) > 0.02,
          ),
      )
    )
      throw new Error("AI-estimated openings overlap on the same wall.");
  }
  const inside = (p: (typeof points)[number]) => {
    let result = false;
    for (let i = 0; i < points.length; i++) {
      const a = points[i],
        b = points[(i + 1) % points.length];
      if (onSegment(a, b, p)) return true;
      if (a.z > p.z !== b.z > p.z && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x)
        result = !result;
    }
    return result;
  };
  const footprintBoxes = [
    ...layout.fixtures.map((f) => ({ ...f, bottom: f.bottom })),
    ...(layout.products ?? []).map((p) => ({ ...p, bottom: 0 })),
  ];
  for (const fixture of footprintBoxes) {
    if (fixture.bottom + fixture.height > layout.ceilingHeight + 0.02)
      throw new Error(`The AI-estimated ${fixture.label} extends above the ceiling.`);
    const yaw = (fixture.yawDegrees * Math.PI) / 180;
    const corners = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ].map(([x, z]) => ({
      x:
        fixture.x +
        ((x * fixture.width) / 2) * Math.cos(yaw) +
        ((z * fixture.depth) / 2) * Math.sin(yaw),
      z:
        fixture.z -
        ((x * fixture.width) / 2) * Math.sin(yaw) +
        ((z * fixture.depth) / 2) * Math.cos(yaw),
    }));
    // Corners alone do not catch a box spanning the missing part of an L-shaped room.
    const crossesBoundary = corners.some((a, i) => {
      const b = corners[(i + 1) % corners.length];
      return points.some((c, j) => {
        const d = points[(j + 1) % points.length];
        return cross(a, b, c) * cross(a, b, d) < -1e-8 && cross(c, d, a) * cross(c, d, b) < -1e-8;
      });
    });
    if (!corners.every(inside) || !inside({ x: fixture.x, z: fixture.z }) || crossesBoundary)
      throw new Error(`The AI-estimated ${fixture.label} extends outside the room.`);
  }
  return layout;
}

/** Spread the vision budget across the upload sequence, retaining evidence order. */
export function selectAiRoomPhotos<T extends Asset>(photos: T[]) {
  if (photos.length <= 8) return photos;
  return Array.from({ length: 8 }, (_, i) => photos[Math.round((i * (photos.length - 1)) / 7)]);
}

/** Facing direction and right-hand vector of a plan yaw (0 faces +z, positive turns toward +x). */
export function planBasis(yawDegrees: number) {
  const radians = (yawDegrees * Math.PI) / 180;
  return {
    forward: { x: Math.sin(radians), z: Math.cos(radians) },
    right: { x: Math.cos(radians), z: -Math.sin(radians) },
  };
}

/**
 * Agreement between each camera's perceived left-to-right order and the plan positions of the
 * fixtures it names: +1 when every pair agrees, -1 when every pair is reversed (a mirrored plan).
 * Returns the number of comparable pairs so callers can ignore weak evidence.
 */
export function handednessAgreement(layout: AiRoomLayout) {
  let score = 0,
    pairs = 0;
  for (const cam of layout.cameras ?? []) {
    const { forward, right } = planBasis(cam.yawDegrees);
    const screen = cam.leftToRight.flatMap((label) => {
      const fixture = layout.fixtures.find(
        (f) => f.label.trim().toLowerCase() === label.trim().toLowerCase(),
      );
      if (!fixture) return [];
      const dx = fixture.x - cam.x,
        dz = fixture.z - cam.z;
      const depth = dx * forward.x + dz * forward.z;
      return depth > 0.05 ? [(dx * right.x + dz * right.z) / depth] : [];
    });
    for (let i = 0; i < screen.length; i++)
      for (let j = i + 1; j < screen.length; j++) {
        if (Math.abs(screen[j] - screen[i]) < 1e-6) continue;
        score += Math.sign(screen[j] - screen[i]);
        pairs++;
      }
  }
  return { agreement: pairs ? score / pairs : 0, pairs };
}

/** Reflect the plan left-to-right, keeping edge order so openings stay on the same walls. */
export function mirrorAiRoomLayout(layout: AiRoomLayout): AiRoomLayout {
  const xs = layout.footprint.map((p) => p.x);
  const across = Math.min(...xs) + Math.max(...xs);
  const flip = <T extends { x: number; yawDegrees: number }>(item: T): T => ({
    ...item,
    x: round(across - item.x),
    yawDegrees: item.yawDegrees === -180 ? 180 : -item.yawDegrees || 0,
  });
  return {
    ...layout,
    footprint: layout.footprint.map((p) => ({ ...p, x: round(across - p.x) })),
    fixtures: layout.fixtures.map(flip),
    cameras: layout.cameras?.map(flip),
    products: layout.products?.map(flip),
  };
}

/** Mirror the plan when photo left/right order strongly contradicts the estimated positions. */
export function correctHandedness(layout: AiRoomLayout): AiRoomLayout {
  const { agreement, pairs } = handednessAgreement(layout);
  if (pairs < 3 || agreement > -0.5) return layout;
  const mirrored = mirrorAiRoomLayout(layout);
  return {
    ...mirrored,
    assumptions: [
      ...mirrored.assumptions.slice(0, 9),
      "Left and right were swapped automatically to match the order of fixtures in the photos.",
    ],
  };
}

/** Uniformly rescale estimated geometry, e.g. after the client measures one wall. */
export function scaleAiRoomLayout(layout: AiRoomLayout, factor: number): AiRoomLayout {
  if (!(factor > 0) || !Number.isFinite(factor)) return layout;
  const s = (value: number) => round(value * factor);
  return {
    ...layout,
    footprint: layout.footprint.map((p) => ({ x: s(p.x), z: s(p.z) })),
    ceilingHeight: s(layout.ceilingHeight),
    walls: layout.walls.map((wall) => ({
      ...wall,
      openings: wall.openings.map((o) => ({
        ...o,
        width: s(o.width),
        bottom: s(o.bottom),
        height: s(o.height),
      })),
    })),
    fixtures: layout.fixtures.map((f) => ({
      ...f,
      x: s(f.x),
      z: s(f.z),
      bottom: s(f.bottom),
      width: s(f.width),
      depth: s(f.depth),
      height: s(f.height),
    })),
    cameras: layout.cameras?.map((c) => ({ ...c, x: s(c.x), z: s(c.z), height: s(c.height) })),
    // Products keep their client-confirmed physical size; only their placement scales.
    products: layout.products?.map((p) => ({ ...p, x: s(p.x), z: s(p.z) })),
  };
}

export function polygonContains(points: { x: number; z: number }[], x: number, z: number) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i],
      b = points[j];
    if (a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}
