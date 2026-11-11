import { focalLength35mm, longEdgeFov } from "./exif";
import { expect, it } from "vitest";
import {
  jpegDimensions,
  outputSize,
  orientationSize,
  pngDimensions,
  webpDimensions,
} from "./image-size";
function jpeg(width: number, height: number, marker = 0xc0) {
  return new Uint8Array([
    255,
    216,
    255,
    224,
    0,
    4,
    0,
    0,
    255,
    marker,
    0,
    8,
    8,
    height >> 8,
    height & 255,
    width >> 8,
    width & 255,
    0,
  ]);
}
it("preserves photo framing within the image API pixel and edge limits", () => {
  expect(jpegDimensions(jpeg(800, 1200))).toEqual({ width: 800, height: 1200 });
  expect(outputSize(jpeg(1920, 1080))).toBe("3840x2160");
  expect(outputSize(jpeg(1080, 1920))).toBe("2160x3840");
  for (const [width, height] of [
    [800, 1200],
    [1050, 1000],
    [1200, 800],
    [10000, 100],
    [100, 10000],
    [1600, 1200],
  ]) {
    const [w, h] = outputSize(jpeg(width, height, 0xc2))
      .split("x")
      .map(Number);
    expect(w % 16).toBe(0);
    expect(h % 16).toBe(0);
    expect(Math.max(w, h)).toBeLessThanOrEqual(3840);
    expect(w * h).toBeLessThanOrEqual(8_294_400);
    expect(w * h).toBeGreaterThanOrEqual(655_360);
    expect(Math.max(w / h, h / w)).toBeLessThanOrEqual(3);
    expect(w / h).toBeCloseTo(Math.min(3, Math.max(1 / 3, width / height)), 1);
  }
});
it("falls back safely for unsupported, truncated, and malformed headers", () => {
  for (const bytes of [
    new Uint8Array(),
    new Uint8Array([255, 216, 255, 224, 0, 0]),
    jpeg(0, 100),
    jpeg(100, 100).slice(0, 14),
  ]) {
    expect(jpegDimensions(bytes)).toBeUndefined();
    expect(outputSize(bytes)).toBe("3840x2160");
  }
});
it("maps freestyle orientations to render sizes", () => {
  expect(orientationSize("landscape")).toBe("1536x1024");
  expect(orientationSize("portrait")).toBe("1024x1536");
  expect(orientationSize("square")).toBe("1024x1024");
});
function png(width: number, height: number) {
  const bytes = new Uint8Array(24);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
  bytes.set([0, 0, 0, 13, 73, 72, 68, 82], 8);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}
it("reads PNG dimensions for designs and masks", () => {
  expect(pngDimensions(png(1024, 1536))).toEqual({ width: 1024, height: 1536 });
  expect(outputSize(png(800, 1200))).toBe("2336x3520");
  expect(outputSize(png(1200, 800))).toBe("3520x2336");
  expect(pngDimensions(png(100, 100).slice(0, 12))).toBeUndefined();
  expect(pngDimensions(new Uint8Array([1, 2, 3]))).toBeUndefined();
});

it("reads WebP photo dimensions so their framing is preserved instead of defaulting to 16:9", () => {
  // RIFF/WEBP with a VP8X chunk: canvas width-1 and height-1 as 24-bit little-endian values.
  const webp = new Uint8Array(30);
  webp.set(
    [..."RIFF"].map((c) => c.charCodeAt(0)),
    0,
  );
  webp.set(
    [..."WEBPVP8X"].map((c) => c.charCodeAt(0)),
    8,
  );
  webp.set([10, 0, 0, 0], 16);
  webp.set([0xbf, 0x0f, 0x00], 24); // 4031 → 4032 wide
  webp.set([0xcf, 0x0b, 0x00], 27); // 3023 → 3024 high
  expect(webpDimensions(webp)).toEqual({ width: 4032, height: 3024 });
  const [width, height] = outputSize(webp).split("x").map(Number);
  expect(width / height).toBeCloseTo(4 / 3, 1);
  expect(webpDimensions(new Uint8Array(30))).toBeUndefined();
});

it("reads the 35 mm-equivalent focal length from JPEG EXIF", () => {
  // Little-endian TIFF: IFD0 at 8 points to an Exif IFD at 26 holding tag 0xA405 = 26 mm.
  // prettier-ignore
  const tiff = [
    0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00,
    0x01, 0x00, 0x69, 0x87, 0x04, 0x00, 0x01, 0x00, 0x00, 0x00, 0x1a, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
    0x01, 0x00, 0x05, 0xa4, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, 0x1a, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
  ];

  const app1 = [...[..."Exif"].map((c) => c.charCodeAt(0)), 0, 0, ...tiff];
  const jpeg = new Uint8Array([
    0xff,
    0xd8,
    0xff,
    0xe1,
    (app1.length + 2) >> 8,
    (app1.length + 2) & 0xff,
    ...app1,
    0xff,
    0xd9,
  ]);
  expect(focalLength35mm(jpeg)).toBe(26);
  // A 26 mm lens spans 2·atan(36 / 52) ≈ 69.4° across a 36 mm frame's long edge.
  expect(longEdgeFov(26)).toBeCloseTo(69.4, 1);
  expect(focalLength35mm(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]))).toBeUndefined();
});
