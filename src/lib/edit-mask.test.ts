import { afterEach, expect, it, vi } from "vitest";
import { exportEditMask } from "./edit-mask";

afterEach(() => vi.unstubAllGlobals());
// Canvas is the platform boundary: check the exported backing resolution and PNG
// encoding, while leaving rasterization to the browser.
it.each([
  [3840, 2160],
  [1024, 1536],
])("exports a mask matching a %ix%i source", async (width, height) => {
  const png = new Blob(["mask"], { type: "image/png" });
  const drawImage = vi.fn();
  const output = {
    width: 0,
    height: 0,
    getContext: () => ({ drawImage }),
    toBlob: (callback: BlobCallback, type: string) => {
      expect([output.width, output.height, type]).toEqual([width, height, "image/png"]);
      callback(png);
    },
  };
  vi.stubGlobal("document", { createElement: () => output });
  const painted = { width: 1536, height: 864 } as HTMLCanvasElement;
  expect(await exportEditMask(painted, { width, height })).toBe(png);
  expect(drawImage).toHaveBeenCalledWith(painted, 0, 0, width, height);
});
