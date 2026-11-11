/**
 * Read the 35 mm-equivalent focal length (EXIF tag 0xA405) from a JPEG, without decoding pixels.
 * Returns undefined for other formats, stripped metadata, or malformed headers.
 */
export function focalLength35mm(bytes: Uint8Array): number | undefined {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return;
  let offset = 2;
  while (offset + 4 < bytes.length) {
    if (bytes[offset] !== 0xff) return;
    const marker = bytes[offset + 1];
    if (marker === 0xda || marker === 0xd9) return;
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (length < 2) return;
    const start = offset + 4;
    if (
      marker === 0xe1 &&
      String.fromCharCode(...bytes.subarray(start, start + 4)) === "Exif" &&
      bytes[start + 4] === 0 &&
      bytes[start + 5] === 0
    )
      return readTiff(bytes.subarray(start + 6, offset + 2 + length));
    offset += 2 + length;
  }
}

function readTiff(tiff: Uint8Array) {
  if (tiff.length < 8) return;
  const little = tiff[0] === 0x49 && tiff[1] === 0x49;
  if (!little && !(tiff[0] === 0x4d && tiff[1] === 0x4d)) return;
  const view = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength);
  const u16 = (at: number) => (at + 2 <= tiff.length ? view.getUint16(at, little) : undefined);
  const u32 = (at: number) => (at + 4 <= tiff.length ? view.getUint32(at, little) : undefined);
  const entry = (ifd: number, tag: number) => {
    const count = u16(ifd);
    if (count === undefined) return;
    for (let i = 0; i < count; i++) {
      const at = ifd + 2 + i * 12;
      if (u16(at) === tag) return at;
    }
  };
  const ifd0 = u32(4);
  if (ifd0 === undefined) return;
  const pointer = entry(ifd0, 0x8769);
  const exif = pointer === undefined ? undefined : u32(pointer + 8);
  if (exif === undefined) return;
  const focal = entry(exif, 0xa405);
  const value = focal === undefined ? undefined : u16(focal + 8);
  return value && value >= 8 && value <= 400 ? value : undefined;
}

/** Field of view across the image's long edge for a 35 mm-equivalent focal length (36 mm frame). */
export function longEdgeFov(focal35: number) {
  return (2 * Math.atan(36 / (2 * focal35)) * 180) / Math.PI;
}
