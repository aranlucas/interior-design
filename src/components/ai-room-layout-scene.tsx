import { cameraInput } from "../lib/camera-input";
import { useEffect, useRef, useState } from "react";
import { Camera, Minus, Plus, RotateCcw, Sparkles } from "lucide-react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { AiRoomLayout } from "../lib/ai-room-layout";
import { createAiRoomGroup } from "../lib/ai-room-layout-geometry";
import type { RoomGuide } from "../lib/room-guide";

type View = {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  render: () => void;
  fit: (top?: boolean) => void;
  capture: () => Pick<RoomGuide, "image" | "camera">;
};
export function AiRoomLayoutScene({
  layout,
  resultId,
  disabled,
  onGenerate,
}: {
  layout: AiRoomLayout;
  resultId: string;
  disabled: boolean;
  onGenerate: (guide: RoomGuide) => void;
}) {
  const host = useRef<HTMLDivElement>(null),
    view = useRef<View | null>(null),
    latest = useRef(layout);
  latest.current = layout;
  const [inferred, setInferred] = useState(true),
    [fixtures, setFixtures] = useState(true),
    [error, setError] = useState("");
  const [captured, setCaptured] = useState<RoomGuide>();
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
    const render = () => renderer.render(scene, camera);
    function fit(top = false) {
      const current = latest.current;
      const xs = current.footprint.map((p) => p.x),
        zs = current.footprint.map((p) => p.z);
      const minX = Math.min(...xs),
        maxX = Math.max(...xs),
        minZ = Math.min(...zs),
        maxZ = Math.max(...zs);
      const radius = Math.hypot(maxX - minX, maxZ - minZ, current.ceilingHeight) / 2;
      const fov = THREE.MathUtils.degToRad(camera.fov / 2),
        limited = Math.min(fov, Math.atan(Math.tan(fov) * camera.aspect));
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
      controls.minDistance = 0.2;
      controls.maxDistance = distance * 3;
      controls.update();
      render();
    }
    controls.addEventListener("change", render);
    const resize = () => {
      const { width, height } = element.getBoundingClientRect();
      if (!width || !height) return;
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      fit();
    };
    const lost = (event: Event) => {
      event.preventDefault();
      setError("The 3D view was interrupted. Reload to restore the saved AI layout.");
    };
    renderer.domElement.addEventListener("webglcontextlost", lost);
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    function capture() {
      const size = renderer.getSize(new THREE.Vector2());
      const pixelRatio = renderer.getPixelRatio();
      // Match the chosen framing. Render synchronously before reading the drawing buffer.
      const width = Math.round(1536 * Math.min(1, camera.aspect));
      const height = Math.round(width / camera.aspect);
      try {
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
        renderer.setPixelRatio(pixelRatio);
        renderer.setSize(size.x, size.y, false);
        render();
      }
    }
    view.current = { scene, camera, controls, render, fit, capture };
    resize();
    return () => {
      view.current = null;
      observer.disconnect();
      controls.dispose();
      sun.shadow.dispose();
      renderer.domElement.removeEventListener("webglcontextlost", lost);
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }, []);
  useEffect(() => {
    const current = view.current;
    if (!current) return;
    const model = createAiRoomGroup(layout, inferred, fixtures);
    current.scene.add(model.group);
    current.render();
    return () => {
      current.scene.remove(model.group);
      model.dispose();
    };
  }, [layout, inferred, fixtures]);
  useEffect(() => {
    view.current?.fit();
  }, [layout]);
  const { zoom, keyboard } = cameraInput(() => view.current);

  return (
    <>
      <div className="room-viewport reconstructed-viewport ai-layout-viewport">
        <div
          ref={host}
          className="room-render"
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
            </div>
            <span className="room-orbit-hint">
              Drag to orbit · Scroll to zoom · Proportions are estimated
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
        <span className="room-help">Amber surfaces are inferred.</span>
      </div>
      <div className="room-guide-capture">
        <div>
          <h3>Design from this angle</h3>
          <p className="room-help">
            Orbit and zoom, then capture a clean view. AI uses its camera and layout, your original
            photos for appearance, and your brief and selected references.
          </p>
        </div>
        {captured && (
          <figure>
            <img src={captured.image} alt="Captured 3D view for image generation" />
            <figcaption>Captured view · AI-estimated geometry</figcaption>
          </figure>
        )}
        <div className="room-build-actions">
          <button
            className="button"
            disabled={disabled || !!error}
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
              disabled={disabled || !!error}
              onClick={() => onGenerate(captured)}
            >
              <Sparkles size={15} /> Generate this view
            </button>
          )}
        </div>
        {captured && (
          <p className="room-help">
            Generation uses the captured view above. Retake after changing the camera or visibility.
          </p>
        )}
      </div>
      <div className="ai-layout-explanation">
        <p>{layout.summary}</p>
        <details>
          <summary>Assumptions and photo evidence</summary>
          <ul>
            {layout.assumptions.map((assumption, i) => (
              <li key={i}>{assumption}</li>
            ))}
          </ul>
          <ul>
            {layout.fixtures.map((fixture, i) => (
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
