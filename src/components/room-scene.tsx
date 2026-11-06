import { cameraInput } from "../lib/camera-input";
import { useEffect, useRef, useState } from "react";
import { Minus, Plus, RotateCcw } from "lucide-react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { assetUrl, type Asset, type RoomModel } from "../lib/types";
import { roomSurfaces } from "../lib/room-model";

type Scene = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  render: () => void;
  fit: (top?: boolean) => void;
};

export function RoomScene({
  model,
  photos,
  textures,
}: {
  model: RoomModel;
  photos: Asset[];
  textures: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const setup = useRef<Scene | null>(null);
  const currentModel = useRef(model);
  currentModel.current = model;
  const [error, setError] = useState("");
  const [textureError, setTextureError] = useState(false);

  useEffect(() => {
    const element = host.current!;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch {
      setError(
        "3D needs WebGL. Enable hardware acceleration or try another browser. You can still set and save your room below.",
      );
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor("#eeede9");
    element.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 500);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enablePan = false;
    controls.maxPolarAngle = Math.PI / 2 - 0.03;
    controls.minPolarAngle = 0.01;
    const render = () => renderer.render(scene, camera);
    function fit(top = false) {
      const { width, depth, height } = currentModel.current;
      const radius = Math.hypot(width, depth, height) / 2;
      const halfFov = THREE.MathUtils.degToRad(camera.fov / 2);
      const limitingFov = Math.min(halfFov, Math.atan(Math.tan(halfFov) * camera.aspect));
      const distance = (radius / Math.sin(limitingFov)) * 1.1;
      controls.target.set(0, height * 0.35, 0);
      camera.position
        .copy(controls.target)
        .add(
          new THREE.Vector3(top ? 0 : -1, top ? 1 : 0.85, top ? 0.001 : 1.2)
            .normalize()
            .multiplyScalar(distance),
        );
      controls.minDistance = radius * 0.6;
      controls.maxDistance = distance * 3;
      camera.far = Math.max(500, distance * 5);
      camera.updateProjectionMatrix();
      controls.update();
      render();
    }
    let previousAspect = 0;
    const resize = () => {
      const { width, height } = element.getBoundingClientRect();
      if (!width || !height) return;
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      if (Math.abs(previousAspect - camera.aspect) > 0.01) fit();
      previousAspect = camera.aspect;
      render();
    };
    controls.addEventListener("change", render);
    const lost = (event: Event) => {
      event.preventDefault();
      setError(
        "The 3D view was interrupted. Reload the page to restore it; save your layout first.",
      );
    };
    renderer.domElement.addEventListener("webglcontextlost", lost);
    const observer = new ResizeObserver(resize);
    setup.current = { renderer, scene, camera, controls, render, fit };
    observer.observe(element);
    resize();
    return () => {
      setup.current = null;
      observer.disconnect();
      controls.dispose();
      renderer.domElement.removeEventListener("webglcontextlost", lost);
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }, []);

  const photoKeys = JSON.stringify(photos.map((photo) => [photo.id, photo.key]));
  const modelKey = JSON.stringify(model);
  const dimensionsKey = `${model.width}:${model.depth}:${model.height}`;
  useEffect(() => {
    const view = setup.current;
    if (!view) return;
    let disposed = false;
    setTextureError(false);
    const { width, depth, height, walls } = JSON.parse(modelKey) as RoomModel;
    const keys = new Map<string, string>(JSON.parse(photoKeys));
    const group = new THREE.Group();
    const loaded: THREE.Texture[] = [];
    const geometries: THREE.BufferGeometry[] = [];
    const materials: THREE.Material[] = [];
    const loader = new THREE.TextureLoader();
    const positions: Record<string, [number, number, number, number, number]> = {
      back: [width, 0, height / 2, -depth / 2, 0],
      right: [depth, width / 2, height / 2, 0, -Math.PI / 2],
      front: [width, 0, height / 2, depth / 2, Math.PI],
      left: [depth, -width / 2, height / 2, 0, Math.PI / 2],
    };
    for (const surface of roomSurfaces) {
      const [span, x, y, z, rotation] = positions[surface];
      const geometry = new THREE.PlaneGeometry(span, height);
      const material = new THREE.MeshBasicMaterial({
        color: surface === "back" || surface === "front" ? "#dedcd5" : "#e8e6df",
      });
      const wall = new THREE.Mesh(geometry, material);
      wall.position.set(x, y, z);
      wall.rotation.y = rotation;
      group.add(wall);
      geometries.push(geometry);
      materials.push(material);
      const key = keys.get(walls[surface] ?? "");
      if (textures && key) {
        const texture = loader.load(
          assetUrl(key),
          (image) => {
            if (disposed) {
              image.dispose();
              return;
            }
            image.colorSpace = THREE.SRGBColorSpace;
            image.anisotropy = Math.min(4, view.renderer.capabilities.getMaxAnisotropy());
            material.map = image;
            material.color.set("#ffffff");
            material.needsUpdate = true;
            view.render();
          },
          undefined,
          () => {
            if (!disposed) setTextureError(true);
          },
        );
        loaded.push(texture);
      }
    }
    const floorGeometry = new THREE.PlaneGeometry(width, depth);
    const floorMaterial = new THREE.MeshBasicMaterial({ color: "#cec6b7", side: THREE.DoubleSide });
    const floor = new THREE.Mesh(floorGeometry, floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    group.add(floor);
    geometries.push(floorGeometry);
    materials.push(floorMaterial);
    const points: THREE.Vector3[] = [];
    for (let x = -width / 2; x <= width / 2; x += 0.5)
      points.push(new THREE.Vector3(x, 0.005, -depth / 2), new THREE.Vector3(x, 0.005, depth / 2));
    for (let z = -depth / 2; z <= depth / 2; z += 0.5)
      points.push(new THREE.Vector3(-width / 2, 0.005, z), new THREE.Vector3(width / 2, 0.005, z));
    const gridGeometry = new THREE.BufferGeometry().setFromPoints(points);
    const gridMaterial = new THREE.LineBasicMaterial({ color: "#b1a896" });
    group.add(new THREE.LineSegments(gridGeometry, gridMaterial));
    geometries.push(gridGeometry);
    materials.push(gridMaterial);
    view.scene.add(group);
    view.render();
    return () => {
      disposed = true;
      view.scene.remove(group);
      loaded.forEach((texture) => texture.dispose());
      geometries.forEach((geometry) => geometry.dispose());
      materials.forEach((material) => material.dispose());
    };
  }, [modelKey, photoKeys, textures]);

  useEffect(() => {
    setup.current?.fit();
  }, [dimensionsKey]);

  const { zoom, keyboard } = cameraInput(() => setup.current);

  return (
    <div className="room-viewport">
      <div
        ref={host}
        className="room-render"
        tabIndex={0}
        role="region"
        aria-label="Interactive 3D room. Drag to rotate, scroll or pinch to zoom. Keyboard: arrow keys to rotate, plus and minus to zoom."
        onKeyDown={keyboard}
      />
      {error ? (
        <p className="room-render-error" role="alert">
          {error}
        </p>
      ) : (
        <>
          <span className="room-scale">
            {model.width} × {model.depth} × {model.height} m
          </span>
          <div className="room-camera-controls" role="group" aria-label="3D camera">
            <button
              className="icon-button"
              type="button"
              onClick={() => zoom(0.85)}
              aria-label="Zoom in"
            >
              <Plus size={16} />
            </button>
            <button
              className="icon-button"
              type="button"
              onClick={() => zoom(1.15)}
              aria-label="Zoom out"
            >
              <Minus size={16} />
            </button>
            <button
              className="icon-button"
              type="button"
              onClick={() => setup.current?.fit()}
              aria-label="Reset 3D view"
            >
              <RotateCcw size={15} />
            </button>
            <button className="button ghost" type="button" onClick={() => setup.current?.fit(true)}>
              Top view
            </button>
          </div>
          <span className="room-orbit-hint">Drag to orbit · Scroll or pinch to zoom</span>
        </>
      )}
      {textureError && (
        <p className="room-texture-error" role="status">
          A wall photo couldn’t load. Try reselecting it or reloading.
        </p>
      )}
    </div>
  );
}
