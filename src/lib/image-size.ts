/** Read JPEG SOF dimensions without decoding pixels. Malformed headers are ignored. */
export function jpegDimensions(bytes: Uint8Array) {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return;
  let offset = 2;
  while (offset + 3 < bytes.length) {
    if (bytes[offset++] !== 0xff) return;
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0xda || marker === 0xd9) return;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    const length = (bytes[offset] << 8) | bytes[offset + 1];
    if (length < 2 || offset + length > bytes.length) return;
    if (
      [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(
        marker,
      )
    ) {
      if (length < 8) return;
      const height = (bytes[offset + 3] << 8) | bytes[offset + 4];
      const width = (bytes[offset + 5] << 8) | bytes[offset + 6];
      if (width && height) return { width, height };
      return;
    }
    offset += length;
  }
}
/** Read PNG IHDR dimensions without decoding pixels. Malformed headers are ignored. */
export function pngDimensions(bytes: Uint8Array) {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 24 || !signature.every((b, i) => bytes[i] === b)) return;
  if (bytes[12] !== 0x49 || bytes[13] !== 0x48 || bytes[14] !== 0x44 || bytes[15] !== 0x52) return;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  return width && height ? { width, height } : undefined;
}
/** Read WebP canvas dimensions from VP8X, VP8 (lossy) or VP8L (lossless) headers. */
export function webpDimensions(bytes: Uint8Array) {
  const text = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));
  if (bytes.length < 30 || text(0, 4) !== "RIFF" || text(8, 12) !== "WEBP") return;
  const chunk = text(12, 16);
  const u24 = (at: number) => bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16);
  if (chunk === "VP8X") return { width: u24(24) + 1, height: u24(27) + 1 };
  if (chunk === "VP8 ") {
    if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) return;
    const width = (bytes[26] | (bytes[27] << 8)) & 0x3fff;
    const height = (bytes[28] | (bytes[29] << 8)) & 0x3fff;
    return width && height ? { width, height } : undefined;
  }
  if (chunk === "VP8L") {
    if (bytes[20] !== 0x2f) return;
    const bits = bytes[21] | (bytes[22] << 8) | (bytes[23] << 16) | (bytes[24] << 24);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
}
export function imageDimensions(bytes: Uint8Array) {
  return jpegDimensions(bytes) ?? pngDimensions(bytes) ?? webpDimensions(bytes);
}
export function outputSize(bytes: Uint8Array): `${number}x${number}` {
  const dimensions = imageDimensions(bytes);
  if (!dimensions) return "3840x2160";
  const ratio = Math.max(1 / 3, Math.min(3, dimensions.width / dimensions.height));
  const height = Math.min(3840, 3840 / ratio, Math.sqrt(8_294_400 / ratio));
  // Round down to meet the API's edge, pixel-count, and multiple-of-16 limits.
  const width = Math.floor((height * ratio) / 16) * 16;
  const roundedHeight = Math.floor(height / 16) * 16;
  return `${width}x${roundedHeight}`;
}

export function orientationSize(
  orientation: "landscape" | "portrait" | "square",
): "1024x1536" | "1024x1024" | "1536x1024" {
  return orientation === "portrait"
    ? "1024x1536"
    : orientation === "square"
      ? "1024x1024"
      : "1536x1024";
}
