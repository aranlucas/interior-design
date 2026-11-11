import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { footprintArea, type AiRoomLayout } from "./ai-room-layout";

/**
 * AI layouts use plan coordinates: facing +z, +x is on the right.
 * In the y-up Three.js scene, facing +z puts +x on the left.
 * Reflect the plan once at this boundary, keeping the stored evidence unchanged.
 * Edge order is preserved, so opening fractions still refer to the same endpoints.
 */
export function toSceneLayout(layout: AiRoomLayout): AiRoomLayout {
  const xs = layout.footprint.map((point) => point.x);
  const across = Math.min(...xs) + Math.max(...xs);
  return {
    ...layout,
    footprint: layout.footprint.map((point) => ({ ...point, x: across - point.x })),
    fixtures: layout.fixtures.map((fixture) => ({
      ...fixture,
      x: across - fixture.x,
      yawDegrees: -fixture.yawDegrees,
    })),
  };
}

export function createAiRoomGroup(
  layout: AiRoomLayout,
  showInferred: boolean,
  showFixtures: boolean,
) {
  layout = toSceneLayout(layout);
  const group = new THREE.Group();
  const geometries: THREE.BufferGeometry[] = [],
    materials: THREE.Material[] = [];
  const textures: THREE.Texture[] = [];
  function finish(color: string, material?: AiRoomLayout["floorMaterial"]) {
    const roughness =
      material === "fabric"
        ? 0.98
        : material === "metal"
          ? 0.28
          : material === "glass"
            ? 0.12
            : material === "tile" || material === "stone"
              ? 0.38
              : material === "wood"
                ? 0.65
                : 0.9;
    return new THREE.MeshStandardMaterial({
      color,
      roughness,
      metalness: material === "metal" ? 0.65 : 0,
      transparent: material === "glass",
      opacity: material === "glass" ? 0.35 : 1,
    });
  }
  function mesh(
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    parent: THREE.Object3D = group,
  ) {
    geometries.push(geometry);
    materials.push(material);
    const object = new THREE.Mesh(geometry, material);
    object.castShadow = true;
    object.receiveShadow = true;
    parent.add(object);
    return object;
  }
  function box(
    width: number,
    height: number,
    depth: number,
    color: string,
    parent: THREE.Object3D = group,
    material?: AiRoomLayout["floorMaterial"],
    rounded = false,
  ) {
    return mesh(
      rounded
        ? new RoundedBoxGeometry(width, height, depth, 2, Math.min(width, height, depth) * 0.12)
        : new THREE.BoxGeometry(width, height, depth),
      finish(color, material),
      parent,
    );
  }
  const outline = new THREE.Shape(
    layout.footprint.map((point) => new THREE.Vector2(point.x, -point.z)),
  );
  const floorFinish = finish(layout.floorColor, layout.floorMaterial);
  floorFinish.side = THREE.DoubleSide;
  // Small generic material patterns, only for a photo-supported category. No
  // external textures, full-room photo projections, or per-frame allocations.
  if (layout.floorMaterial === "wood" || layout.floorMaterial === "tile") {
    const width = 64,
      height = 128;
    const pixels = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const seam = x < 1 || y < 1;
        const grain =
          layout.floorMaterial === "wood" ? Math.sin(x * 2.1 + Math.sin(y * 0.08) * 2) * 4 : 0;
        const value = seam ? 195 : Math.round(248 + grain);
        const offset = (y * width + x) * 4;
        pixels.set([value, value, value, 255], offset);
      }
    const texture = new THREE.DataTexture(pixels, width, height);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(
      layout.floorMaterial === "wood" ? 5 : 2,
      layout.floorMaterial === "wood" ? 0.8 : 2,
    );
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = THREE.LinearFilter;
    texture.needsUpdate = true;
    textures.push(texture);
    floorFinish.map = texture;
  }
  const floor = mesh(new THREE.ShapeGeometry(outline), floorFinish);
  floor.rotation.x = -Math.PI / 2;
  floor.castShadow = false;
  floor.userData = { kind: "floor" };
  const wallSide = footprintArea(layout.footprint) > 0 ? THREE.FrontSide : THREE.BackSide;
  for (const wall of layout.walls) {
    if (wall.support === "inferred" && !showInferred) continue;
    const a = layout.footprint[wall.edgeIndex],
      b = layout.footprint[(wall.edgeIndex + 1) % layout.footprint.length];
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.lineTo(length, 0);
    shape.lineTo(length, layout.ceilingHeight);
    shape.lineTo(0, layout.ceilingHeight);
    shape.closePath();
    const openings = wall.openings.filter(
      (opening) => showInferred || opening.support === "visible",
    );
    for (const opening of openings) {
      const x = opening.center * length - opening.width / 2,
        y = opening.bottom;
      const hole = new THREE.Path();
      hole.moveTo(x, y);
      hole.lineTo(x, y + opening.height);
      hole.lineTo(x + opening.width, y + opening.height);
      hole.lineTo(x + opening.width, y);
      hole.closePath();
      shape.holes.push(hole);
    }
    const inferred = wall.support === "inferred";
    const surface = mesh(
      new THREE.ShapeGeometry(shape),
      new THREE.MeshStandardMaterial({
        color: inferred ? "#d8c29b" : wall.color,
        roughness: wall.material === "tile" || wall.material === "stone" ? 0.38 : 0.9,
        side: wallSide,
        transparent: inferred,
        opacity: inferred ? 0.45 : 1,
        depthWrite: !inferred,
      }),
    );
    surface.position.set(a.x, 0, a.z);
    surface.rotation.y = -Math.atan2(b.z - a.z, b.x - a.x);
    surface.userData = { kind: "wall", label: wall.label, support: wall.support };
    for (const opening of openings) {
      const local = new THREE.Group();
      local.position.copy(surface.position);
      local.rotation.copy(surface.rotation);
      local.userData = { kind: "opening", openingKind: opening.kind, edgeIndex: wall.edgeIndex };
      group.add(local);
      const x = opening.center * length,
        y = opening.bottom,
        w = opening.width,
        h = opening.height;
      if (opening.kind === "window") {
        const glass = mesh(
          new THREE.PlaneGeometry(w, h),
          new THREE.MeshStandardMaterial({
            color: "#b9d9df",
            transparent: true,
            opacity: 0.25,
            side: THREE.DoubleSide,
            roughness: 0.2,
          }),
          local,
        );
        glass.position.set(x, y + h / 2, 0.012);
      }
      const frameColor = opening.support === "inferred" ? "#b39460" : "#d0cdc5";
      for (const direction of [-1, 1]) {
        const jamb = box(0.045, h, 0.065, frameColor, local);
        jamb.position.set(x + (direction * w) / 2, y + h / 2, 0);
      }
      const lintel = box(w, 0.045, 0.065, frameColor, local);
      lintel.position.set(x, y + h, 0);
      if (opening.kind === "window") {
        const sill = box(w, 0.045, 0.09, frameColor, local);
        sill.position.set(x, y, 0);
      }
    }
  }
  if (showFixtures)
    for (const fixture of layout.fixtures) {
      if (fixture.support === "inferred" && !showInferred) continue;
      const object = new THREE.Group();
      object.position.set(fixture.x, fixture.bottom, fixture.z);
      object.rotation.y = THREE.MathUtils.degToRad(fixture.yawDegrees);
      object.userData = { kind: fixture.kind, label: fixture.label, support: fixture.support };
      group.add(object);
      const color = fixture.support === "inferred" ? "#c9af87" : fixture.color;
      if (fixture.kind === "stairs") {
        for (let i = 0; i < 8; i++) {
          const step = box(
            fixture.width,
            (fixture.height * (i + 1)) / 8,
            fixture.depth / 8,
            color,
            object,
          );
          step.position.set(
            0,
            (fixture.height * (i + 1)) / 16,
            -fixture.depth / 2 + (fixture.depth * (i + 0.5)) / 8,
          );
        }
        continue;
      }
      const { width: w, height: h, depth: d } = fixture;
      const part = (
        width: number,
        height: number,
        depth: number,
        x: number,
        y: number,
        z: number,
        partColor = color,
        material = fixture.material,
        rounded = false,
      ) => {
        const piece = box(width, height, depth, partColor, object, material, rounded);
        piece.position.set(x, y, z);
        return piece;
      };
      if (fixture.kind === "sofa") {
        const arm = Math.min(w * 0.12, 0.18),
          back = Math.min(d * 0.18, 0.2);
        part(w, h * 0.3, d, 0, h * 0.25, 0, color, "fabric", true);
        part(w - 2 * arm, h * 0.2, d - back, 0, h * 0.5, back / 2, color, "fabric", true);
        part(w - 2 * arm, h * 0.6, back, 0, h * 0.7, -d / 2 + back / 2, color, "fabric", true);
        for (const side of [-1, 1])
          part(arm, h * 0.65, d, (side * (w - arm)) / 2, h * 0.425, 0, color, "fabric", true);
        continue;
      }
      if (fixture.kind === "bed") {
        const head = Math.min(d * 0.08, 0.12);
        part(w, h * 0.25, d, 0, h * 0.2, 0);
        part(w, h * 0.35, d - head, 0, h * 0.5, head / 2, color, "fabric", true);
        part(w, h, head, 0, h / 2, -(d - head) / 2);
        for (const side of [-1, 1])
          part(
            w * 0.38,
            h * 0.12,
            d * 0.18,
            side * w * 0.23,
            h * 0.735,
            -d * 0.27,
            "#eeeae2",
            "fabric",
            true,
          );
        continue;
      }
      if (fixture.kind === "table") {
        const thickness = Math.min(h * 0.12, 0.07),
          leg = Math.min(w, d) * 0.08;
        part(w, thickness, d, 0, h - thickness / 2, 0);
        for (const x of [-1, 1])
          for (const z of [-1, 1])
            part(
              leg,
              h - thickness,
              leg,
              x * (w / 2 - leg),
              (h - thickness) / 2,
              z * (d / 2 - leg),
            );
        continue;
      }
      const hasCounter =
        fixture.kind === "island" ||
        (fixture.kind === "cabinet" && fixture.bottom < 0.1 && h < 1.4);
      const cap = hasCounter || fixture.kind === "range" ? Math.min(0.035, h * 0.1) : 0;
      part(w, h - cap, d, 0, (h - cap) / 2, 0);
      if (hasCounter) part(w, cap, d, 0, h - cap / 2, 0, "#c9c6bd", "stone");
      if (fixture.kind === "range") part(w, cap, d, 0, h - cap / 2, 0, "#30312f", "metal");
    }
  return {
    group,
    dispose: () => {
      geometries.forEach((geometry) => geometry.dispose());
      materials.forEach((material) => material.dispose());
      textures.forEach((texture) => texture.dispose());
    },
  };
}
