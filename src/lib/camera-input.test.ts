import { expect, it, vi } from "vitest";
import { PerspectiveCamera, Vector3 } from "three";
import type { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { cameraInput } from "./camera-input";

function setup() {
  const camera = new PerspectiveCamera();
  camera.position.set(0, 0, 10);
  const controls = {
    target: new Vector3(),
    minDistance: 5,
    maxDistance: 15,
    minPolarAngle: Math.PI / 2,
    maxPolarAngle: Math.PI / 2,
    update: vi.fn(),
  } as unknown as OrbitControls;
  const render = vi.fn();
  return { camera, controls, render };
}
it("keeps button zoom within the scene's configured distances", () => {
  const view = setup();
  const input = cameraInput(() => view);
  input.zoom(0.01);
  expect(view.camera.position.distanceTo(view.controls.target)).toBeCloseTo(5);
  input.zoom(100);
  expect(view.camera.position.distanceTo(view.controls.target)).toBeCloseTo(15);
  expect(view.render).toHaveBeenCalledTimes(2);
});
it("keeps keyboard rotation within polar limits and ignores nested control events", () => {
  const view = setup();
  const input = cameraInput(() => view);
  const host = new EventTarget();
  const preventDefault = vi.fn();
  input.keyboard({ key: "ArrowUp", target: host, currentTarget: host, preventDefault });
  expect(view.camera.position.y).toBeCloseTo(0);
  expect(preventDefault).toHaveBeenCalledOnce();
  const before = view.camera.position.clone();
  input.keyboard({
    key: "ArrowLeft",
    target: new EventTarget(),
    currentTarget: host,
    preventDefault,
  });
  expect(view.camera.position).toEqual(before);
  expect(view.render).toHaveBeenCalledOnce();
});
