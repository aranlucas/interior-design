import { cameraInput } from "../lib/camera-input";
import { useEffect, useRef, useState } from "react";
import { Minus, Plus, RotateCcw } from "lucide-react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { Asset } from "../lib/types";
import type { ReconstructedScene } from "../lib/reconstruction";

type View = {
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  render: () => void;
  fit: () => void;
  photo: (index: number) => void;
};

export function ReconstructedRoomScene({
  data,
  photos,
}: {
  data: ReconstructedScene;
  photos: Asset[];
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<View | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const element = host.current!;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch {
      setError(
        "3D needs WebGL. Enable hardware acceleration or try another browser. Your reconstruction has been saved.",
      );
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor("#eeede9");
    element.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 1000);
    const controls = new OrbitControls(camera, renderer.domElement);
    const render = () => renderer.render(scene, camera);
    controls.addEventListener("change", render);
    const axes = [0, 1, 2].map((axis) =>
      data.positions.filter((_, i) => i % 3 === axis).sort((a, b) => a - b),
    );
    const low = axes.map((values) => values[Math.floor(values.length * 0.02)] ?? 0);
    const high = axes.map((values) => values[Math.floor(values.length * 0.98)] ?? 1);
    const center = new THREE.Vector3(
      ...(low.map((v, i) => (v + high[i]) / 2) as [number, number, number]),
    );
    const extent = Math.max(...high.map((v, i) => v - low[i]), 0.01);
    const scale = 10 / extent;
    const up = new THREE.Vector3();
    data.cameras.forEach((pose) =>
      up.add(new THREE.Vector3(0, -1, 0).applyQuaternion(new THREE.Quaternion(...pose.rotation))),
    );
    if (up.lengthSq() < 0.0001) up.set(0, 1, 0);
    const upright = new THREE.Quaternion().setFromUnitVectors(
      up.normalize(),
      new THREE.Vector3(0, 1, 0),
    );
    const transform = (point: THREE.Vector3) =>
      point.sub(center).applyQuaternion(upright).multiplyScalar(scale);
    const positions: number[] = [],
      colors: number[] = [];
    const color = new THREE.Color();
    for (let i = 0; i < data.positions.length; i += 3) {
      const point = transform(
        new THREE.Vector3(data.positions[i], data.positions[i + 1], data.positions[i + 2]),
      );
      if (point.length() > 60) continue;
      positions.push(point.x, point.y, point.z);
      color.setRGB(
        data.colors[i] / 255,
        data.colors[i + 1] / 255,
        data.colors[i + 2] / 255,
        THREE.SRGBColorSpace,
      );
      colors.push(color.r, color.g, color.b);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    const material = new THREE.PointsMaterial({
      vertexColors: true,
      size: 2.5,
      sizeAttenuation: false,
    });
    scene.add(new THREE.Points(geometry, material));
    const cameraPoints: THREE.Vector3[] = [];
    const recovered = data.cameras.map((pose) => ({
      position: transform(new THREE.Vector3(...pose.position)),
      rotation: upright.clone().multiply(new THREE.Quaternion(...pose.rotation)),
      pose,
    }));
    for (const { position, rotation, pose } of recovered) {
      const z = 0.45;
      const corners = [
        [0, 0],
        [pose.width, 0],
        [pose.width, pose.height],
        [0, pose.height],
      ].map(([x, y]) =>
        new THREE.Vector3(((x - pose.cx) / pose.fx) * z, ((y - pose.cy) / pose.fy) * z, z)
          .applyQuaternion(rotation)
          .add(position),
      );
      for (let i = 0; i < 4; i++)
        cameraPoints.push(position, corners[i], corners[i], corners[(i + 1) % 4]);
    }
    const cameraGeometry = new THREE.BufferGeometry().setFromPoints(cameraPoints);
    const cameraMaterial = new THREE.LineBasicMaterial({ color: "#a8502c" });
    scene.add(new THREE.LineSegments(cameraGeometry, cameraMaterial));
    geometry.computeBoundingSphere();
    const sphere = geometry.boundingSphere ?? new THREE.Sphere(new THREE.Vector3(), 5);
    function fit() {
      const halfFov = THREE.MathUtils.degToRad(45 / 2);
      const fov = Math.min(halfFov, Math.atan(Math.tan(halfFov) * camera.aspect));
      camera.fov = 45;
      const distance = (Math.max(sphere.radius, 1) / Math.sin(fov)) * 1.15;
      controls.target.copy(sphere.center);
      camera.position
        .copy(sphere.center)
        .add(new THREE.Vector3(0.8, 0.6, 1).normalize().multiplyScalar(distance));
      controls.minDistance = 0.1;
      controls.maxDistance = distance * 4;
      camera.updateProjectionMatrix();
      controls.update();
      render();
    }
    function photo(index: number) {
      const recoveredCamera = recovered[index];
      if (!recoveredCamera) return;
      const { position, rotation, pose } = recoveredCamera;
      camera.position.copy(position);
      camera.up.copy(new THREE.Vector3(0, -1, 0).applyQuaternion(rotation));
      controls.target
        .copy(position)
        .add(
          new THREE.Vector3(0, 0, 1)
            .applyQuaternion(rotation)
            .multiplyScalar(Math.max(sphere.radius, 1)),
        );
      camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(pose.height / (2 * pose.fy)));
      camera.updateProjectionMatrix();
      controls.update();
      render();
    }
    const resize = () => {
      const { width, height } = element.getBoundingClientRect();
      if (!width || !height) return;
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.up.set(0, 1, 0);
      fit();
    };
    const lost = (event: Event) => {
      event.preventDefault();
      setError("The 3D view was interrupted. Reload to restore your saved preview.");
    };
    renderer.domElement.addEventListener("webglcontextlost", lost);
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    view.current = { camera, controls, render, fit, photo };
    resize();
    return () => {
      view.current = null;
      observer.disconnect();
      controls.dispose();
      geometry.dispose();
      material.dispose();
      cameraGeometry.dispose();
      cameraMaterial.dispose();
      renderer.domElement.removeEventListener("webglcontextlost", lost);
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }, [data]);
  const { zoom, keyboard } = cameraInput(() => view.current);

  return (
    <>
      <div className="room-viewport reconstructed-viewport">
        <div
          className="room-render"
          ref={host}
          role="region"
          tabIndex={0}
          aria-label="Reconstructed 3D room. Drag to orbit, scroll to zoom. Use arrow keys to rotate and plus or minus to zoom."
          onKeyDown={keyboard}
        />
        {error ? (
          <p className="room-render-error" role="alert">
            {error}
          </p>
        ) : (
          <>
            <div className="room-camera-controls" role="group" aria-label="Reconstruction camera">
              <button className="icon-button" aria-label="Zoom in" onClick={() => zoom(0.85)}>
                <Plus size={16} />
              </button>
              <button className="icon-button" aria-label="Zoom out" onClick={() => zoom(1.15)}>
                <Minus size={16} />
              </button>
              <button
                className="icon-button"
                aria-label="Fit reconstruction"
                onClick={() => {
                  view.current?.camera.up.set(0, 1, 0);
                  view.current?.fit();
                }}
              >
                <RotateCcw size={16} />
              </button>
            </div>
            <span className="room-orbit-hint">
              Drag to orbit · Scroll or pinch to zoom · Blue outlines show cameras
            </span>
          </>
        )}
      </div>
      <div className="recovered-angles" role="group" aria-label="Recovered photo angles">
        <span className="room-help">View from:</span>
        {data.cameras.map((pose, i) => (
          <button
            className="button ghost"
            key={pose.assetId}
            title={photos.find((p) => p.id === pose.assetId)?.name}
            onClick={() => view.current?.photo(i)}
          >
            Photo {i + 1}
          </button>
        ))}
      </div>
    </>
  );
}
