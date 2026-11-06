import * as THREE from "three";
import type { OrbitControls } from "three/addons/controls/OrbitControls.js";

type CameraView = {
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  render: () => void;
};
type KeyboardEvent = {
  key: string;
  target: EventTarget;
  currentTarget: EventTarget;
  preventDefault: () => void;
};

export function cameraInput(current: () => CameraView | null) {
  function zoom(factor: number) {
    const view = current();
    if (!view) return;
    const offset = view.camera.position.clone().sub(view.controls.target);
    offset.setLength(
      THREE.MathUtils.clamp(
        offset.length() * factor,
        view.controls.minDistance,
        view.controls.maxDistance,
      ),
    );
    view.camera.position.copy(view.controls.target).add(offset);
    view.controls.update();
    view.render();
  }
  function keyboard(event: KeyboardEvent) {
    if (event.target !== event.currentTarget) return;
    const view = current();
    if (!view) return;
    if (event.key.startsWith("Arrow")) {
      event.preventDefault();
      const offset = new THREE.Spherical().setFromVector3(
        view.camera.position.clone().sub(view.controls.target),
      );
      if (event.key === "ArrowLeft") offset.theta -= 0.12;
      if (event.key === "ArrowRight") offset.theta += 0.12;
      if (event.key === "ArrowUp") offset.phi -= 0.12;
      if (event.key === "ArrowDown") offset.phi += 0.12;
      offset.phi = THREE.MathUtils.clamp(
        offset.phi,
        view.controls.minPolarAngle,
        view.controls.maxPolarAngle,
      );
      view.camera.position
        .copy(view.controls.target)
        .add(new THREE.Vector3().setFromSpherical(offset));
      view.controls.update();
      view.render();
    } else if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      zoom(0.85);
    } else if (event.key === "-") {
      event.preventDefault();
      zoom(1.15);
    }
  }

  return { zoom, keyboard };
}
