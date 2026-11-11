import { cameraInput } from "../lib/camera-input";
import { useEffect, useRef, useState } from "react";
import {
  Camera,
  FlipHorizontal2,
  Minus,
  Move,
  Plus,
  RotateCcw,
  RotateCw,
  Ruler,
  Sparkles,
  Trash2,
} from "lucide-react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  mirrorAiRoomLayout,
  polygonContains,
  scaleAiRoomLayout,
  wallLength,
  type AiRoomLayout,
} from "../lib/ai-room-layout";
import {
  createAiRoomGroup,
  sceneReflection,
  scenePhotoCamera,
  toSceneLayout,
} from "../lib/ai-room-layout-geometry";
import { parseDimensions } from "../lib/scale";
import type { RoomGuide } from "../lib/room-guide";

type Selection = { collection: "fixtures" | "products"; index: number };
type View = {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  render: () => void;
  fit: (top?: boolean) => void;
  eyeLevel: () => void;
  fromPhoto: (index: number) => void;
  capture: () => Pick<RoomGuide, "image" | "camera">;
};
export type PlaceableProduct = { id: string; name: string; dimensions?: string };

const CAPTURE_EDGE = 2048;
const wrapYaw = (yaw: number) => ((((yaw + 180) % 360) + 360) % 360) - 180;
const toMeters = (cm: number | undefined, fallback: number) =>
  cm ? THREE.MathUtils.clamp(Math.round(cm) / 100, 0.1, 15) : fallback;

export function AiRoomLayoutScene({
  layout,
  resultId,
  disabled,
  products,
  onGenerate,
  onSave,
}: {
  layout: AiRoomLayout;
  resultId: string;
  disabled: boolean;
  products: PlaceableProduct[];
  onGenerate: (guide: RoomGuide, placedAssetIds: string[]) => void;
  onSave: (layout: AiRoomLayout) => Promise<void>;
}) {
  const host = useRef<HTMLDivElement>(null),
    view = useRef<View | null>(null),
    model = useRef<ReturnType<typeof createAiRoomGroup> | null>(null),
    highlight = useRef<THREE.BoxHelper | null>(null);
  const [draft, setDraft] = useState(layout);
  const latest = useRef(draft);
  latest.current = draft;
  const dirty = draft !== layout;
  const [inferred, setInferred] = useState(true),
    [fixtures, setFixtures] = useState(true),
    [error, setError] = useState(""),
    [editing, setEditing] = useState(false),
    [selection, setSelection] = useState<Selection>(),
    [fov, setFov] = useState(40),
    [saving, setSaving] = useState(false),
    [saveError, setSaveError] = useState(""),
    [scaleWall, setScaleWall] = useState(0),
    [scaleMeters, setScaleMeters] = useState(""),
    [productId, setProductId] = useState("");
  const editingRef = useRef(editing);
  editingRef.current = editing;
  const [captured, setCaptured] = useState<RoomGuide>();
  useEffect(() => setDraft(layout), [layout]);
  useEffect(() => {
    const element = host.current!;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch {
      setError(
        "3D needs WebGL. Enable hardware acceleration or try another browser. The estimated layout has been saved.",
      );
      return;
    }
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    renderer.setClearColor("#eeede9");
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    element.appendChild(renderer.domElement);
    const scene = new THREE.Scene(),
      camera = new THREE.PerspectiveCamera(40, 1, 0.01, 500);
    scene.add(new THREE.HemisphereLight("#ffffff", "#c4b9a3", 1.8));
    const sun = new THREE.DirectionalLight("#fff5e4", 2.4);
    sun.position.set(-4, 12, 8);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -20;
    sun.shadow.camera.right = 20;
    sun.shadow.camera.top = 20;
    sun.shadow.camera.bottom = -20;
    sun.shadow.camera.far = 50;
    sun.shadow.bias = -0.0002;
    sun.shadow.normalBias = 0.02;
    scene.add(sun);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.maxPolarAngle = Math.PI / 2 - 0.02;
    controls.minPolarAngle = 0.01;
    controls.enablePan = true;
    controls.minDistance = 0.2;
    const render = () => {
      const current = model.current;
      if (current) {
        // Interior views get a ceiling; exterior and cutaway views stay open.
        const footprint = toSceneLayout(latest.current).footprint;
        current.ceiling.visible =
          camera.position.y < latest.current.ceilingHeight &&
          polygonContains(footprint, camera.position.x, camera.position.z);
      }
      renderer.render(scene, camera);
    };
    const bounds = () => {
      const footprint = toSceneLayout(latest.current).footprint;
      const xs = footprint.map((p) => p.x),
        zs = footprint.map((p) => p.z);
      return {
        footprint,
        minX: Math.min(...xs),
        maxX: Math.max(...xs),
        minZ: Math.min(...zs),
        maxZ: Math.max(...zs),
      };
    };
    function fit(top = false) {
      const current = latest.current;
      const { minX, maxX, minZ, maxZ } = bounds();
      const radius = Math.hypot(maxX - minX, maxZ - minZ, current.ceilingHeight) / 2;
      const half = THREE.MathUtils.degToRad(camera.fov / 2),
        limited = Math.min(half, Math.atan(Math.tan(half) * camera.aspect));
      const distance = (radius / Math.sin(limited)) * 1.08;
      controls.target.set((minX + maxX) / 2, current.ceilingHeight * 0.3, (minZ + maxZ) / 2);
      camera.position
        .copy(controls.target)
        .add(
          new THREE.Vector3(top ? 0 : 1, top ? 1 : 0.9, top ? 0.001 : 1.2)
            .normalize()
            .multiplyScalar(distance),
        );
      camera.up.set(0, 1, 0);
      controls.maxDistance = distance * 3;
      controls.update();
      render();
    }
    function eyeLevel() {
      const { footprint, minX, maxX, minZ, maxZ } = bounds();
      const center = new THREE.Vector3((minX + maxX) / 2, 0, (minZ + maxZ) / 2);
      const direction = controls.target.clone().sub(camera.position).setY(0);
      if (direction.lengthSq() < 1e-6) direction.set(0, 0, -1);
      direction.normalize();
      // Stand near the wall behind the current view direction, looking across the room.
      const reach = Math.max(maxX - minX, maxZ - minZ) * 0.35;
      let position = center.clone().addScaledVector(direction, -reach);
      if (!polygonContains(footprint, position.x, position.z)) position = center.clone();
      position.y = 1.5;
      camera.position.copy(position);
      controls.target.copy(position).addScaledVector(direction, 2).setY(1.35);
      controls.update();
      render();
    }
    function fromPhoto(index: number) {
      const cam = toSceneLayout(latest.current).cameras?.[index];
      if (!cam) return;
      const pose = scenePhotoCamera(cam, camera.aspect);
      camera.fov = pose.fov;
      camera.updateProjectionMatrix();
      setFov(Math.round(pose.fov));
      camera.position.set(...pose.position);
      controls.target.set(...pose.target);
      controls.update();
      render();
    }
    controls.addEventListener("change", render);
    let fitted = false;
    const resize = () => {
      const { width, height } = element.getBoundingClientRect();
      if (!width || !height) return;
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      // Fit once; later resizes keep the client's chosen camera.
      if (!fitted) {
        fitted = true;
        fit();
      } else render();
    };
    const lost = (event: Event) => {
      event.preventDefault();
      setError("The 3D view was interrupted. Reload to restore the saved AI layout.");
    };
    renderer.domElement.addEventListener("webglcontextlost", lost);
    const observer = new ResizeObserver(resize);
    observer.observe(element);

    // Edit mode: click selects a fixture or product; dragging moves it across the floor.
    const raycaster = new THREE.Raycaster(),
      floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0),
      pointer = new THREE.Vector2();
    let drag:
      | { object: THREE.Object3D; offset: THREE.Vector3; selection: Selection; moved: boolean }
      | undefined;
    const hitFloor = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(pointer, camera);
      return raycaster.ray.intersectPlane(floor, new THREE.Vector3());
    };
    const down = (event: PointerEvent) => {
      if (!editingRef.current || !model.current) return;
      hitFloor(event);
      const hit = raycaster
        .intersectObject(model.current.group, true)
        .map((h) => {
          let object: THREE.Object3D | null = h.object;
          while (object && !object.userData.collection) object = object.parent;
          return object;
        })
        .find((object) => !!object);
      if (!hit) {
        setSelection(undefined);
        return;
      }
      const point = hitFloor(event);
      const selection = { collection: hit.userData.collection, index: hit.userData.index };
      setSelection(selection);
      if (!point) return;
      controls.enabled = false;
      renderer.domElement.setPointerCapture(event.pointerId);
      drag = { object: hit, offset: hit.position.clone().sub(point), selection, moved: false };
    };
    const move = (event: PointerEvent) => {
      if (!drag) return;
      const point = hitFloor(event);
      if (!point) return;
      const { minX, maxX, minZ, maxZ } = bounds();
      drag.object.position.x = THREE.MathUtils.clamp(point.x + drag.offset.x, minX, maxX);
      drag.object.position.z = THREE.MathUtils.clamp(point.z + drag.offset.z, minZ, maxZ);
      drag.moved = true;
      highlight.current?.update();
      render();
    };
    const up = () => {
      controls.enabled = true;
      if (!drag) return;
      const { object, selection, moved } = drag;
      drag = undefined;
      if (!moved) return;
      const across = sceneReflection(latest.current);
      const round = (value: number) => Math.round(value * 1000) / 1000;
      setDraft((current) => {
        const next = structuredClone(current);
        const item =
          selection.collection === "fixtures"
            ? next.fixtures[selection.index]
            : next.products?.[selection.index];
        if (item) {
          item.x = Math.max(0, round(across - object.position.x));
          item.z = Math.max(0, round(object.position.z));
        }
        return next;
      });
    };
    // Capture phase runs before OrbitControls' own listener, so a drag never also orbits.
    renderer.domElement.addEventListener("pointerdown", down, { capture: true });
    renderer.domElement.addEventListener("pointermove", move);
    renderer.domElement.addEventListener("pointerup", up);
    renderer.domElement.addEventListener("pointercancel", up);

    function capture() {
      const size = renderer.getSize(new THREE.Vector2());
      const pixelRatio = renderer.getPixelRatio();
      // Match the chosen framing at the largest edge the server accepts.
      const width = Math.round(CAPTURE_EDGE * Math.min(1, camera.aspect));
      const height = Math.round(width / camera.aspect);
      const helper = highlight.current;
      try {
        if (helper) helper.visible = false;
        renderer.setPixelRatio(1);
        renderer.setSize(width, height, false);
        render();
        return {
          image: renderer.domElement.toDataURL("image/jpeg", 0.92),
          camera: {
            position: camera.position.toArray() as [number, number, number],
            target: controls.target.toArray() as [number, number, number],
            fov: camera.fov,
            aspect: camera.aspect,
          },
        };
      } finally {
        if (helper) helper.visible = true;
        renderer.setPixelRatio(pixelRatio);
        renderer.setSize(size.x, size.y, false);
        render();
      }
    }
    view.current = { scene, camera, controls, render, fit, eyeLevel, fromPhoto, capture };
    resize();
    return () => {
      view.current = null;
      observer.disconnect();
      controls.dispose();
      sun.shadow.dispose();
      renderer.domElement.removeEventListener("webglcontextlost", lost);
      renderer.domElement.removeEventListener("pointerdown", down, { capture: true });
      renderer.domElement.removeEventListener("pointermove", move);
      renderer.domElement.removeEventListener("pointerup", up);
      renderer.domElement.removeEventListener("pointercancel", up);
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }, []);
  useEffect(() => {
    const current = view.current;
    if (!current) return;
    const built = createAiRoomGroup(draft, inferred, fixtures);
    model.current = built;
    current.scene.add(built.group);
    const target =
      editing && selection
        ? built.group.children.find(
            (o) =>
              o.userData.collection === selection.collection &&
              o.userData.index === selection.index,
          )
        : undefined;
    const helper = target ? new THREE.BoxHelper(target, "#c23a2b") : null;
    if (helper) current.scene.add(helper);
    highlight.current = helper;
    current.render();
    return () => {
      current.scene.remove(built.group);
      built.dispose();
      if (helper) {
        current.scene.remove(helper);
        helper.dispose();
      }
      if (model.current === built) model.current = null;
      highlight.current = null;
    };
  }, [draft, inferred, fixtures, editing, selection]);
  useEffect(() => {
    const current = view.current;
    if (!current) return;
    current.camera.fov = fov;
    current.camera.updateProjectionMatrix();
    current.render();
  }, [fov]);
  const { zoom, keyboard } = cameraInput(() => view.current);

  const selected =
    selection &&
    (selection.collection === "fixtures"
      ? draft.fixtures[selection.index]
      : draft.products?.[selection.index]);
  function edit(change: (next: AiRoomLayout) => void) {
    setDraft((current) => {
      const next = structuredClone(current);
      change(next);
      return next;
    });
  }
  function rotate(degrees: number) {
    if (!selection) return;
    edit((next) => {
      const item =
        selection.collection === "fixtures"
          ? next.fixtures[selection.index]
          : next.products?.[selection.index];
      if (item) item.yawDegrees = wrapYaw(item.yawDegrees + degrees);
    });
  }
  function removeSelected() {
    if (!selection) return;
    edit((next) => {
      if (selection.collection === "fixtures") next.fixtures.splice(selection.index, 1);
      else next.products?.splice(selection.index, 1);
    });
    setSelection(undefined);
  }
  const placed = new Set((draft.products ?? []).map((p) => p.assetId));
  const available = products.filter((p) => !placed.has(p.id));
  function addProduct() {
    const product = available.find((p) => p.id === productId) ?? available[0];
    if (!product) return;
    const size = parseDimensions(product.dimensions);
    const xs = draft.footprint.map((p) => p.x),
      zs = draft.footprint.map((p) => p.z);
    edit((next) => {
      next.products = [
        ...(next.products ?? []),
        {
          assetId: product.id,
          label: product.name.slice(0, 120) || "Product",
          x: (Math.min(...xs) + Math.max(...xs)) / 2,
          z: (Math.min(...zs) + Math.max(...zs)) / 2,
          width: toMeters(size?.widthCm, 0.8),
          depth: toMeters(size?.depthCm, 0.8),
          height: toMeters(size?.heightCm, 0.8),
          yawDegrees: 0,
        },
      ];
    });
    setSelection({ collection: "products", index: draft.products?.length ?? 0 });
    setProductId("");
  }
  const currentWall = wallLength(draft, draft.walls[scaleWall]?.edgeIndex ?? 0);
  const targetMeters = Number(scaleMeters);
  async function save() {
    setSaving(true);
    setSaveError("");
    try {
      await onSave(draft);
      setCaptured(undefined);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Could not save the layout edits.");
    } finally {
      setSaving(false);
    }
  }
  const cameras = draft.cameras ?? [];

  return (
    <>
      <div className="room-viewport reconstructed-viewport ai-layout-viewport">
        <div
          ref={host}
          className={`room-render${editing ? " editing" : ""}`}
          role="region"
          tabIndex={0}
          aria-label="AI-estimated 3D room. Drag to orbit, scroll to zoom, or use arrow keys to rotate."
          onKeyDown={keyboard}
        />
        {error ? (
          <p className="room-render-error" role="alert">
            {error}
          </p>
        ) : (
          <>
            <div className="room-camera-controls" role="group" aria-label="AI layout camera">
              <button className="icon-button" aria-label="Zoom in" onClick={() => zoom(0.85)}>
                <Plus size={16} />
              </button>
              <button className="icon-button" aria-label="Zoom out" onClick={() => zoom(1.15)}>
                <Minus size={16} />
              </button>
              <button
                className="icon-button"
                aria-label="Reset AI layout view"
                onClick={() => view.current?.fit()}
              >
                <RotateCcw size={16} />
              </button>
              <button className="button ghost" onClick={() => view.current?.fit(true)}>
                Top view
              </button>
              <button className="button ghost" onClick={() => view.current?.eyeLevel()}>
                Eye level
              </button>
            </div>
            <span className="room-orbit-hint">
              {editing
                ? "Click a box to select it, then drag to move"
                : "Drag to orbit, scroll to zoom. Proportions are estimated."}
            </span>
          </>
        )}
      </div>
      <div className="ai-layout-options">
        <label className="checkbox">
          <input
            type="checkbox"
            checked={inferred}
            onChange={(e) => setInferred(e.target.checked)}
          />
          Show inferred structure
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={fixtures}
            onChange={(e) => setFixtures(e.target.checked)}
          />
          Show fixtures
        </label>
        <label className="ai-layout-lens">
          <span>Field of view {fov}°</span>
          <input
            type="range"
            min={25}
            max={90}
            value={fov}
            onChange={(e) => setFov(Number(e.target.value))}
          />
        </label>
        <span className="room-help">
          Amber surfaces are inferred; colored boxes are placed products.
        </span>
      </div>
      {cameras.length > 0 && (
        <div className="ai-layout-options" role="group" aria-label="Estimated photo viewpoints">
          <span className="room-help">View from photo:</span>
          {cameras.map((cam, index) => (
            <button
              key={cam.photoNumber}
              className="button ghost"
              onClick={() => view.current?.fromPhoto(index)}
            >
              {cam.photoNumber}
            </button>
          ))}
          <span className="room-help">Viewpoints are AI estimates.</span>
        </div>
      )}
      <div className="ai-layout-edit">
        <div className="room-build-actions">
          <button
            className="button ghost"
            aria-pressed={editing}
            onClick={() => {
              setEditing((v) => !v);
              setSelection(undefined);
            }}
          >
            <Move size={15} /> {editing ? "Done editing" : "Edit layout"}
          </button>
          {editing && (
            <button className="button ghost" onClick={() => setDraft((d) => mirrorAiRoomLayout(d))}>
              <FlipHorizontal2 size={15} /> Mirror left/right
            </button>
          )}
        </div>
        {editing && (
          <>
            {selected ? (
              <div className="room-build-actions" role="group" aria-label="Selected element">
                <span className="room-help">
                  <strong>{selected.label}</strong>
                </span>
                <button
                  className="icon-button"
                  aria-label="Rotate left"
                  onClick={() => rotate(-15)}
                >
                  <RotateCcw size={15} />
                </button>
                <button
                  className="icon-button"
                  aria-label="Rotate right"
                  onClick={() => rotate(15)}
                >
                  <RotateCw size={15} />
                </button>
                <button
                  className="icon-button"
                  aria-label="Delete selected"
                  onClick={removeSelected}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ) : (
              <p className="room-help">
                Select a fixture or product box in the 3D view to edit it.
              </p>
            )}
            <div className="room-build-actions">
              <div className="select">
                <select
                  aria-label="Product to place"
                  value={productId}
                  onChange={(e) => setProductId(e.target.value)}
                  disabled={!available.length}
                >
                  {available.length ? (
                    available.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                        {p.dimensions ? `, ${p.dimensions}` : ", size unknown"}
                      </option>
                    ))
                  ) : (
                    <option value="">No unplaced product references</option>
                  )}
                </select>
              </div>
              <button className="button ghost" disabled={!available.length} onClick={addProduct}>
                <Plus size={15} /> Place product
              </button>
            </div>
            <div className="room-build-actions" role="group" aria-label="Calibrate scale">
              <Ruler size={15} />
              <div className="select">
                <select
                  aria-label="Wall to measure"
                  value={scaleWall}
                  onChange={(e) => setScaleWall(Number(e.target.value))}
                >
                  {draft.walls.map((wall, i) => (
                    <option key={wall.edgeIndex} value={i}>
                      {wall.label}, now {wallLength(draft, wall.edgeIndex).toFixed(2)} m
                    </option>
                  ))}
                </select>
              </div>
              <input
                className="ai-layout-meters"
                type="number"
                min={0.5}
                max={30}
                step={0.01}
                placeholder="Measured m"
                aria-label="Measured wall length in meters"
                value={scaleMeters}
                onChange={(e) => setScaleMeters(e.target.value)}
              />
              <button
                className="button ghost"
                disabled={!(targetMeters > 0) || !currentWall}
                onClick={() => {
                  setDraft((d) => scaleAiRoomLayout(d, targetMeters / currentWall));
                  setScaleMeters("");
                }}
              >
                Scale room
              </button>
            </div>
            <p className="room-help">
              Measuring one wall rescales the whole estimate. Placed products keep their confirmed
              size, so they show true scale.
            </p>
          </>
        )}
        {dirty && (
          <div className="room-build-actions">
            <button className="button primary" disabled={saving} onClick={() => void save()}>
              {saving ? "Saving…" : "Save layout edits"}
            </button>
            <button className="button ghost" disabled={saving} onClick={() => setDraft(layout)}>
              Discard
            </button>
            {saveError && (
              <span className="room-build-error" role="alert">
                {saveError}
              </span>
            )}
          </div>
        )}
      </div>
      <div className="room-guide-capture">
        <div>
          <h3>Design from this angle</h3>
          <p className="room-help">
            Orbit and zoom, or pick a photo viewpoint or eye level, then capture a clean view. AI
            uses its camera and layout, your original photos for appearance, and your brief and
            selected references. Placed product photos are sent automatically.
          </p>
        </div>
        {captured && (
          <figure>
            <img src={captured.image} alt="Captured 3D view for image generation" />
            <figcaption>Captured view with AI-estimated geometry</figcaption>
          </figure>
        )}
        <div className="room-build-actions">
          <button
            className="button"
            disabled={disabled || !!error || dirty}
            onClick={() => {
              try {
                const image = view.current?.capture();
                if (image)
                  setCaptured({
                    ...image,
                    resultId,
                    showInferred: inferred,
                    showFixtures: fixtures,
                  });
              } catch {
                setError("Could not capture this view. Reload and try again.");
              }
            }}
          >
            <Camera size={15} /> {captured ? "Retake view" : "Capture this view"}
          </button>
          {captured && (
            <button
              className="button primary"
              disabled={disabled || !!error || dirty}
              onClick={() =>
                onGenerate(
                  captured,
                  (layout.products ?? []).map((p) => p.assetId),
                )
              }
            >
              <Sparkles size={15} /> Generate this view
            </button>
          )}
        </div>
        {dirty ? (
          <p className="room-help">Save or discard layout edits before capturing.</p>
        ) : (
          captured && (
            <p className="room-help">
              Generation uses the captured view above. Retake after changing the camera or
              visibility.
            </p>
          )
        )}
      </div>
      <div className="ai-layout-explanation">
        <p>{draft.summary}</p>
        <details>
          <summary>Assumptions and photo evidence</summary>
          <ul>
            {draft.assumptions.map((assumption, i) => (
              <li key={i}>{assumption}</li>
            ))}
          </ul>
          <ul>
            {draft.fixtures.map((fixture, i) => (
              <li key={i}>
                <strong>{fixture.label}</strong> —{" "}
                {fixture.support === "visible"
                  ? `visible in photo${fixture.photoNumbers.length === 1 ? "" : "s"} ${fixture.photoNumbers.join(", ")}`
                  : "inferred"}
                ; position and size estimated.
              </li>
            ))}
          </ul>
        </details>
      </div>
    </>
  );
}
