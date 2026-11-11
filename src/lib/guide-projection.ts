import * as THREE from "three";
import { polygonContains, wallLength, type AiRoomLayout } from "./ai-room-layout";
import { toSceneLayout } from "./ai-room-layout-geometry";
import type { RoomGuideConstraints } from "./room-guide";

type Capture = RoomGuideConstraints["capture"];
export type ScreenBox = {
  left: number;
  right: number;
  top: number;
  bottom: number;
  partial: boolean;
};

const m = (value: number) => `${value.toFixed(1)} m`;
const pct = (value: number) => value.toFixed(2);
const evidence = (item: { support: string; photoNumbers: number[] }) =>
  item.support === "visible"
    ? `visible in photo${item.photoNumbers.length === 1 ? "" : "s"} ${item.photoNumbers.join(", ")}`
    : "inferred";

export function captureCamera(capture: Capture) {
  const camera = new THREE.PerspectiveCamera(capture.camera.fov, capture.camera.aspect, 0.01, 500);
  camera.position.set(...capture.camera.position);
  camera.up.set(0, 1, 0);
  camera.lookAt(new THREE.Vector3(...capture.camera.target));
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();
  return camera;
}

/** Normalized image-space bounds of world points (x right, y down, 0–1), or undefined if unseen. */
export function screenBox(
  camera: THREE.PerspectiveCamera,
  points: THREE.Vector3[],
): ScreenBox | undefined {
  let left = Infinity,
    right = -Infinity,
    top = Infinity,
    bottom = -Infinity,
    partial = false;
  for (const point of points) {
    const view = point.clone().applyMatrix4(camera.matrixWorldInverse);
    if (view.z > -camera.near) {
      partial = true;
      continue;
    }
    const ndc = view.applyMatrix4(camera.projectionMatrix);
    const u = (ndc.x + 1) / 2,
      v = (1 - ndc.y) / 2;
    left = Math.min(left, u);
    right = Math.max(right, u);
    top = Math.min(top, v);
    bottom = Math.max(bottom, v);
  }
  if (!Number.isFinite(left) || right < 0 || left > 1 || bottom < 0 || top > 1) return undefined;
  if (left < 0 || right > 1 || top < 0 || bottom > 1) partial = true;
  const clamp = (value: number) => Math.min(1, Math.max(0, value));
  return {
    left: clamp(left),
    right: clamp(right),
    top: clamp(top),
    bottom: clamp(bottom),
    partial,
  };
}

function boxCorners(
  item: { x: number; z: number; width: number; depth: number; height: number; yawDegrees: number },
  bottom: number,
) {
  const yaw = THREE.MathUtils.degToRad(item.yawDegrees);
  const cos = Math.cos(yaw),
    sin = Math.sin(yaw);
  const corners: THREE.Vector3[] = [];
  for (const lx of [-item.width / 2, item.width / 2])
    for (const lz of [-item.depth / 2, item.depth / 2])
      for (const y of [bottom, bottom + item.height])
        corners.push(
          new THREE.Vector3(item.x + lx * cos + lz * sin, y, item.z - lx * sin + lz * cos),
        );
  return corners;
}

function where(box: ScreenBox | undefined, image: number) {
  if (!box) return "outside the captured frame";
  return `image ${image} x ${pct(box.left)}–${pct(box.right)}, y ${pct(box.top)}–${pct(box.bottom)}${box.partial ? " (partly out of frame)" : ""}`;
}

export function guideView(layout: AiRoomLayout, capture: Capture) {
  const scene = toSceneLayout(layout);
  const [x, y, z] = capture.camera.position;
  const [tx, ty, tz] = capture.camera.target;
  const interior = y < scene.ceilingHeight && polygonContains(scene.footprint, x, z);
  const pitch = THREE.MathUtils.radToDeg(Math.atan2(ty - y, Math.hypot(tx - x, tz - z)));
  return { interior, eyeLevel: interior && y <= 2 && pitch > -35, pitch, height: y };
}

/**
 * A compact, prose description of the saved layout as seen from the captured camera. Positions
 * are projected in code so the image model receives screen locations instead of raw coordinates.
 */
export function describeGuide(
  layout: AiRoomLayout,
  capture: Capture,
  productImage: (assetId: string) => number | undefined,
  includeProducts: boolean,
) {
  const scene = toSceneLayout(layout);
  const camera = captureCamera(capture);
  const xs = layout.footprint.map((p) => p.x),
    zs = layout.footprint.map((p) => p.z);
  const width = Math.max(...xs) - Math.min(...xs),
    depth = Math.max(...zs) - Math.min(...zs);
  const lines = [
    `Estimated room (AI estimates, NOT measurements): ${layout.footprint.length === 4 ? "a roughly rectangular" : `a ${layout.footprint.length}-sided`} footprint about ${m(width)} × ${m(depth)} overall, ceiling about ${m(layout.ceilingHeight)}. ${layout.summary}`,
  ];
  const walls: string[] = [];
  for (const wall of scene.walls) {
    const length = wallLength(scene, wall.edgeIndex);
    const hidden = wall.support === "inferred" && !capture.showInferred;
    const a = scene.footprint[wall.edgeIndex],
      b = scene.footprint[(wall.edgeIndex + 1) % scene.footprint.length];
    const along = (t: number, height: number) =>
      new THREE.Vector3(a.x + (b.x - a.x) * t, height, a.z + (b.z - a.z) * t);
    const openings = wall.openings
      .filter((o) => capture.showInferred || o.support === "visible")
      .map((o) => {
        const half = o.width / 2 / length;
        const box = screenBox(camera, [
          along(o.center - half, o.bottom),
          along(o.center + half, o.bottom),
          along(o.center - half, o.bottom + o.height),
          along(o.center + half, o.bottom + o.height),
        ]);
        const size =
          o.kind === "window" ? `${m(o.width)} wide, sill ${m(o.bottom)}` : `${m(o.width)} wide`;
        return `${o.kind} (${evidence(o)}), ${size}, ${where(box, 1)}`;
      });
    walls.push(
      `- ${wall.label} (${evidence(wall)}), about ${m(length)}${hidden ? ", hidden in the render" : ""}${openings.length ? `: ${openings.join("; ")}` : ""}.`,
    );
  }
  lines.push(`Walls and openings:\n${walls.join("\n")}`);
  const fixtures = capture.showFixtures
    ? scene.fixtures
        .filter((f) => capture.showInferred || f.support === "visible")
        .map(
          (f) =>
            `- ${f.label} (${f.kind}, ${evidence(f)}), about ${m(f.width)} × ${m(f.depth)} × ${m(f.height)}, ${where(screenBox(camera, boxCorners(f, f.bottom)), 1)}.`,
        )
    : [];
  if (fixtures.length) lines.push(`Existing fixtures and furniture boxes:\n${fixtures.join("\n")}`);
  const products = includeProducts
    ? (scene.products ?? []).map((p) => {
        const image = productImage(p.assetId);
        return `- ${p.label}${image ? ` = the product in image ${image}` : " (no reference image supplied)"}: placed box ${Math.round(p.width * 100)} × ${Math.round(p.depth * 100)} × ${Math.round(p.height * 100)} cm (client-confirmed size), ${where(screenBox(camera, boxCorners(p, 0)), 1)}. Its light front marker shows which way it faces.`;
      })
    : [];
  if (products.length)
    lines.push(
      `Client-placed products (solid colored boxes in image 1; these placements are the client's decision and override suggested placement):\n${products.join("\n")}`,
    );
  return lines.join("\n");
}
